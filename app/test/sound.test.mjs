import test from "node:test";
import assert from "node:assert/strict";
import { Heli } from "../src/sim/heli.js";
import { MODELS } from "../src/sim/models.js";
import { v3 } from "../src/sim/math.js";
import { soundParams } from "../src/audio/rotor.js";

const DT = 0.001;
const fly = (h, ctl, s) => { for (let i = 0; i < s / DT; i++) h.step({ roll: 0, pitch: 0, yaw: 0, mode: "idle", ...ctl }, { wind: v3() }, DT); return h; };
const hover = (id = "fbl450", pos = v3(0, 2, -5)) => { const h = new Heli(MODELS[id]); h.reset({ pos, airborne: true }); return h; };

test("sound: blade note is headspeed × blades", () => {
  const h = hover();
  const p = soundParams(h);
  assert.ok(Math.abs(p.bladeHz - (h.rpm / 60) * 2) < 1e-9);
  assert.ok(p.motorHz >= 4 * p.bladeHz, "the motor whines well above the blades");
});

test("sound: a punch sounds harder than a hover, autorotation softer", () => {
  const hov = soundParams(fly(hover(), { coll: 0.31 }, 0.5));
  const punch = soundParams(fly(hover(), { coll: 1 }, 0.3));
  const auto = soundParams(fly(hover("fbl450", v3(0, 30, -5)), { coll: -0.2, mode: "hold" }, 0.5));
  assert.ok(punch.blade > hov.blade && punch.cutoff > hov.cutoff);
  assert.equal(auto.motor, 0, "no motor in throttle hold");
});

test("sound: quieter far away, panned to the heli's side", () => {
  const near = soundParams(fly(hover("fbl450", v3(0, 2, -4)), { coll: 0.31 }, 0.2));
  const far = soundParams(fly(hover("fbl450", v3(0, 2, -40)), { coll: 0.31 }, 0.2));
  const right = soundParams(fly(hover("fbl450", v3(6, 2, -4)), { coll: 0.31 }, 0.2));
  const left = soundParams(fly(hover("fbl450", v3(-6, 2, -4)), { coll: 0.31 }, 0.2));
  assert.ok(far.blade < near.blade / 3);
  assert.ok(right.pan > 0.5 && left.pan < -0.5);
});

test("sound: silent with the rotor stopped", () => {
  const h = new Heli(MODELS.fbl450);
  h.reset({ mode: "hold" });
  const p = soundParams(h);
  assert.equal(p.blade + p.motor + p.wash, 0);
});

for (const id of Object.keys(MODELS)) {
  test(`sound: ${id} stays in a sensible range`, () => {
    const p = soundParams(fly(hover(id), { coll: 1 }, 0.5));
    for (const k of ["blade", "motor", "wash"]) assert.ok(p[k] >= 0 && p[k] <= 1.5, `${k} ${p[k]}`);
    assert.ok(p.bladeHz > 40 && p.bladeHz < 250, `blade ${p.bladeHz} Hz`);
  });
}
