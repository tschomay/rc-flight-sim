// Regression pins for the flight model: how each heli hovers today. The sanity tests in
// sim.test.mjs allow wide bands; these are tight, so any change to the model's feel
// shows up here. When you retune a heli on purpose, run the tests, check the new numbers
// feel right on the sticks, and update BASELINE.
import test from "node:test";
import assert from "node:assert/strict";
import { Heli, G } from "../src/sim/heli.js";
import { MODELS } from "../src/sim/models.js";
import { v3, irot } from "../src/sim/math.js";

const DT = 0.001;
const calm = { wind: v3() };
const sticks = (o = {}) => ({ roll: 0, pitch: 0, yaw: 0, coll: 0, mode: "idle", ...o });

// collective stick (−1…1) that holds altitude, per flight mode
const BASELINE = {
  fbl450: { idle: 0.311, normal: 0.082 },
  fbl600: { idle: 0.270, normal: 0.009 },
  mcpx: { idle: 0.358, normal: 0.191 },
};
const TOL = 0.02;

function airborne(id, opts = {}) {
  const h = new Heli(MODELS[id]);
  h.reset({ pos: v3(0, 30, -5), airborne: true, ...opts });
  return h;
}

function run(h, ctl, seconds, each) {
  for (let i = 0; i < seconds / DT; i++) { h.step(ctl, calm, DT); each?.(h); }
  return h;
}

function hoverStick(id, mode) {
  let lo = -1, hi = 1;
  for (let k = 0; k < 22; k++) {
    const c = (lo + hi) / 2;
    const h = run(airborne(id, { mode }), sticks({ coll: c, mode }), 1.2);
    if (h.vel.y > 0) hi = c; else lo = c;
  }
  return (lo + hi) / 2;
}

test("every heli has a baseline", () => {
  assert.deepEqual(Object.keys(BASELINE).sort(), Object.keys(MODELS).sort());
});

for (const id of Object.keys(MODELS)) {
  const def = MODELS[id];

  for (const mode of ["idle", "normal"]) {
    test(`${id}: hover collective in ${mode} is unchanged`, () => {
      const c = hoverStick(id, mode);
      assert.ok(Math.abs(c - BASELINE[id][mode]) < TOL, `hover stick ${c.toFixed(3)}, baseline ${BASELINE[id][mode]}`);
    });
  }

  test(`${id}: hover power is a small part of the motor's`, () => {
    const h = run(airborne(id), sticks({ coll: BASELINE[id].idle }), 2);
    const watts = h.qMotor * h.omega;
    assert.ok(watts > 0.03 * def.motor.maxPower && watts < 0.3 * def.motor.maxPower, `${watts.toFixed(0)} W of ${def.motor.maxPower}`);
  });

  test(`${id}: hands off, the tail rotor pushes the heli sideways (translating tendency)`, () => {
    let tail = 0;
    const h = run(airborne(id), sticks({ coll: BASELINE[id].idle }), 2, (x) => { tail += x.tailT; });
    const side = irot(h.q, h.vel).z;          // body right
    const expect = (tail / 2000 / def.mass) * 2;  // tail thrust / mass × 2 s, before drag
    // a clockwise rotor needs the tail pushed left, so the heli drifts left
    assert.equal(Math.sign(side), Math.sign(def.rotor.direction), `drift ${side.toFixed(2)} m/s`);
    const ratio = side / expect;
    assert.ok(ratio > 0.4 && ratio < 1.0, `drift ${side.toFixed(2)} m/s is ${ratio.toFixed(2)} of tail thrust alone`);
  });

  test(`${id}: the flight model is deterministic`, () => {
    const ctl = sticks({ coll: 0.4, roll: 0.2, yaw: -0.3 });
    const a = run(airborne(id), ctl, 1.5), b = run(airborne(id), ctl, 1.5);
    assert.deepEqual([a.pos, a.vel, a.q, a.omega], [b.pos, b.vel, b.q, b.omega]);
  });

  // a little over the weight: the downwash on the fuselage pushes it down too
  test(`${id}: thrust in a steady hover is just over the weight`, () => {
    const h = run(airborne(id), sticks({ coll: BASELINE[id].idle }), 1.5);
    const w = def.mass * G;
    assert.ok(h.thrust > 0.98 * w && h.thrust < 1.08 * w, `thrust ${h.thrust.toFixed(2)} N, weight ${w.toFixed(2)} N`);
  });
}
