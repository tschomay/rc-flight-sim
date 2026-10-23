// Behavioural checks on the flight model and trainer. Numbers are sanity bands from
// real 450 / micro helis, not exact targets; they catch sign errors and regressions.
import test from "node:test";
import assert from "node:assert/strict";
import { Heli } from "../src/sim/heli.js";
import { MODELS } from "../src/sim/models.js";
import { Trainer, DEFAULT_TRAINER } from "../src/sim/trainer.js";
import { Wind } from "../src/sim/wind.js";
import { v3, DEG, wrapPi, rot } from "../src/sim/math.js";

const DT = 0.001;
const calm = { wind: v3() };
const sticks = (o = {}) => ({ roll: 0, pitch: 0, yaw: 0, coll: 0, mode: "idle", ...o });

function airborne(id, opts = {}) {
  const h = new Heli(MODELS[id]);
  h.reset({ pos: v3(0, 30, -5), airborne: true, ...opts });
  return h;
}

function run(h, ctl, seconds, each) {
  for (let i = 0; i < seconds / DT; i++) {
    h.step(typeof ctl === "function" ? ctl(i * DT, h) : ctl, calm, DT);
    each?.(h, i * DT);
  }
  return h;
}

/** Collective stick that holds altitude, found by bisection. */
function hoverStick(id, inverted = false) {
  let lo = -1, hi = 1;
  for (let k = 0; k < 25; k++) {
    const c = (lo + hi) / 2;
    const h = run(airborne(id, { inverted }), sticks({ coll: c }), 1.2);
    if ((h.vel.y > 0) !== inverted) hi = c; else lo = c;
  }
  return (lo + hi) / 2;
}

for (const id of Object.keys(MODELS)) {
  const def = MODELS[id];

  test(`${id}: hover needs 3–6° of pitch at idle-up headspeed`, () => {
    const c = hoverStick(id);
    const h = airborne(id);
    const pitch = h.pitchFor(c, "idle") / DEG;
    assert.ok(pitch > 3 && pitch < 6, `hover pitch ${pitch.toFixed(2)}°`);
  });

  test(`${id}: inverted hover mirrors upright`, () => {
    const up = hoverStick(id), inv = hoverStick(id, true);
    assert.ok(Math.abs(up + inv) < 0.03, `upright ${up.toFixed(3)} inverted ${inv.toFixed(3)}`);
  });

  test(`${id}: full cyclic reaches the configured roll and pitch rates`, () => {
    const roll = run(airborne(id), sticks({ roll: 1, coll: 0.35 }), 0.5).w.x / DEG;
    const pitch = run(airborne(id), sticks({ pitch: 1, coll: 0.35 }), 0.5).w.z / DEG;
    assert.ok(Math.abs(roll - def.rates.roll) < 0.1 * def.rates.roll, `roll ${roll.toFixed(0)}°/s`);
    assert.ok(Math.abs(-pitch - def.rates.pitch) < 0.1 * def.rates.pitch, `pitch ${pitch.toFixed(0)}°/s`);
  });

  test(`${id}: rudder right yaws nose right at the configured rate, and stops within 0.3 s`, () => {
    let peak = 0;
    const h = run(airborne(id), (t) => sticks({ yaw: t < 1 ? 1 : 0, coll: 0.35 }), 1.6, (h, t) => {
      if (t > 1.3) peak = Math.max(peak, Math.abs(h.w.y / DEG));
    });
    const h2 = run(airborne(id), sticks({ yaw: 1, coll: 0.35 }), 1);
    const rate = -h2.w.y / DEG;
    assert.ok(Math.abs(rate - def.rates.yaw) < 0.08 * def.rates.yaw, `yaw ${rate.toFixed(0)}°/s`);
    assert.ok(peak < 0.1 * def.rates.yaw, `bounce after stop ${peak.toFixed(0)}°/s`);
    assert.equal(h.crashed, null);
  });

  test(`${id}: flybarless holds attitude after the stick returns to centre`, () => {
    let tilt0 = 0;
    const h = run(airborne(id), (t) => sticks({ roll: t < 0.1 ? 0.5 : 0, coll: 0.35 }), 0.8, (h, t) => {
      if (Math.abs(t - 0.3) < DT / 2) tilt0 = h.up.x;
    });
    assert.ok(Math.abs(h.up.x - tilt0) < 0.05, `drifted from ${tilt0.toFixed(3)} to ${h.up.x.toFixed(3)}`);
  });

  test(`${id}: full collective climbs hard without bogging the governor`, () => {
    const h = run(airborne(id), sticks({ coll: 1 }), 2);
    assert.ok(h.vel.y > 5, `climb ${h.vel.y.toFixed(1)} m/s`);
    assert.ok(h.rpm > 0.9 * def.headspeed.idle, `rpm ${h.rpm.toFixed(0)}`);
  });

  test(`${id}: throttle hold autorotates at a survivable rate and keeps headspeed`, () => {
    const h = run(airborne(id), (t) => sticks({ coll: t < 0.3 ? 0.35 : -0.15, mode: "hold" }), 6);
    assert.ok(h.vel.y < -2 && h.vel.y > -12, `descent ${h.vel.y.toFixed(1)} m/s`);
    assert.ok(h.rpm > 0.55 * def.headspeed.idle, `rpm ${h.rpm.toFixed(0)}`);
  });

  test(`${id}: sits on its skids when idle on the ground`, () => {
    const h = new Heli(def);
    h.reset({ pos: v3(0, 0, -5) });
    run(h, sticks({ coll: -1 }), 2);
    assert.equal(h.crashed, null);
    assert.ok(h.onGround);
    assert.ok(Math.hypot(h.vel.x, h.vel.y, h.vel.z) < 0.05);
    assert.ok(Math.abs(h.pos.y + def.geometry.skidY) < 0.01, `height ${h.pos.y}`);
  });

  test(`${id}: lifts off with collective and lands softly`, () => {
    const h = new Heli(def);
    h.reset({ pos: v3(0, 0, -5) });
    let maxH = 0;
    run(h, (t) => sticks({ coll: t < 1 ? -1 : t < 2.5 ? 0.6 : 0.2 }), 6, (h) => { maxH = Math.max(maxH, h.pos.y); });
    assert.ok(maxH > 1, `max height ${maxH.toFixed(2)}`);
    assert.equal(h.crashed, null);
  });

  test(`${id}: dropping from height is a crash`, () => {
    const h = run(airborne(id, { pos: v3(0, 8, -5) }), sticks({ coll: -1, mode: "hold" }), 3);
    assert.ok(h.crashed, "expected a crash");
  });

  test(`${id}: hard bank near the ground strikes the blades`, () => {
    const h = run(airborne(id, { pos: v3(0, -def.geometry.skidY + 0.15, -5) }), sticks({ roll: 1, coll: 0.3 }), 1);
    assert.equal(h.crashed, "Blade strike");
  });

  for (const inverted of [false, true]) {
    test(`${id}: trainer holds a ${inverted ? "inverted" : "upright"} hover in the circle with all assists, in gusty wind`, () => {
      const h = new Heli(def);
      const tr = new Trainer({ ...DEFAULT_TRAINER, inverted, height: 3, assist: { collective: true, cyclic: true, rudder: true } });
      const wind = new Wind(5);
      wind.set({ speed: 3, from: 30, gust: 0.3 });
      tr.start(h);
      for (let i = 0; i < 15 / DT; i++) h.step(tr.update(h, sticks(), DT), { wind: wind.step(DT) }, DT);
      assert.equal(h.crashed, null);
      assert.equal(h.inverted, inverted);
      assert.ok(tr.timeIn / tr.timeTotal > 0.9, `in circle ${(100 * tr.timeIn / tr.timeTotal).toFixed(0)}%`);
    });
  }

  for (const rotation of ["ccw", "cw", "swing"]) {
    test(`${id}: trainer ${rotation} heading tracks within 15°`, () => {
      const h = new Heli(def);
      const tr = new Trainer({ ...DEFAULT_TRAINER, rotation, rotationSpeed: 30, assist: { collective: true, cyclic: true, rudder: true } });
      tr.start(h);
      let worst = 0;
      for (let i = 0; i < 12 / DT; i++) {
        h.step(tr.update(h, sticks(), DT), calm, DT);
        if (i * DT > 2) worst = Math.max(worst, Math.abs(wrapPi(tr.headingT - h.heading)));
      }
      assert.equal(h.crashed, null);
      assert.ok(worst < 15 * DEG, `worst heading error ${(worst / DEG).toFixed(1)}°`);
    });
  }
}

test("trainer: the circle counts at any height by default, and can be limited to a window", () => {
  const h = new Heli(MODELS.fbl450);
  const tr = new Trainer({ ...DEFAULT_TRAINER, height: 1.5 });
  tr.start(h);
  h.reset({ pos: v3(0.4, 5, -DEFAULT_TRAINER.distance), airborne: true });
  tr.update(h, sticks(), DT);
  assert.equal(tr.inside, true, "5 m above the circle is inside");
  tr.cfg.heightWindow = 1;
  tr.update(h, sticks(), DT);
  assert.equal(tr.inside, false, "outside a ±1 m window");
  h.reset({ pos: v3(4, 1.5, -DEFAULT_TRAINER.distance), airborne: true });
  tr.cfg.heightWindow = 0;
  tr.update(h, sticks(), DT);
  assert.equal(tr.inside, false, "beside the circle is outside");
});

test("trainer: leaving the circle can count as a crash", () => {
  const h = new Heli(MODELS.fbl450);
  const tr = new Trainer({ ...DEFAULT_TRAINER, circle: 3, leaveIsCrash: true });
  tr.start(h);
  for (let i = 0; i < 600; i++) tr.update(h, sticks(), DT);
  assert.equal(h.crashed, null, "still inside after spawning");
  h.reset({ pos: v3(2, 1.5, -DEFAULT_TRAINER.distance), airborne: true });
  tr.update(h, sticks(), DT);
  assert.equal(h.crashed, "Left the circle");
});

test("self-levelling: centred stick levels the heli, held stick holds a tilt", async () => {
  const { selfLevel } = await import("../src/sim/trainer.js");
  const { qaxis } = await import("../src/sim/math.js");
  const h = airborne("fbl450");
  h.q = qaxis(v3(1, 0, 0), 25 * DEG);  // banked 25°
  const c = hoverStick("fbl450");
  run(h, (t, hh) => selfLevel(hh, sticks({ coll: c })), 1.5);
  assert.ok(h.up.y > Math.cos(3 * DEG), `tilt after 1.5 s ${(Math.acos(h.up.y) / DEG).toFixed(1)}°`);
  run(h, (t, hh) => selfLevel(hh, sticks({ coll: c, roll: 0.5 })), 1.5);
  const tilt = Math.acos(h.up.y) / DEG;
  assert.ok(tilt > 11 && tilt < 19, `held tilt ${tilt.toFixed(1)}° (want ~15°)`);
  const right = rot(h.q, v3(0, 0, 1));
  assert.ok(right.y < 0, "right stick banks to the right");
});

test("trainer: zone is in, edge near the rim, out beyond it", () => {
  const h = new Heli(MODELS.fbl450);
  const tr = new Trainer({ ...DEFAULT_TRAINER, circle: 3 });
  tr.start(h);
  const at = (x) => { h.reset({ pos: v3(x, 2, -DEFAULT_TRAINER.distance), airborne: true }); tr.update(h, sticks(), DT); return tr.zone; };
  assert.deepEqual([at(0), at(1.3), at(1.7)], ["in", "edge", "out"]);
});
