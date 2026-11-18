import test from "node:test";
import assert from "node:assert/strict";
import { MODELS } from "../src/sim/models.js";
import { TUNABLES, applyTuning, exportTuning, bounds, getPath } from "../src/sim/tuning.js";
import { Heli } from "../src/sim/heli.js";
import { v3 } from "../src/sim/math.js";

test("tuning: every tunable exists on every heli, with the models.js value inside its range", () => {
  for (const [id, def] of Object.entries(MODELS)) for (const t of TUNABLES) {
    const b = bounds(def, t);
    assert.ok(Number.isFinite(b.base) && b.base > 0, `${id} ${t.path}`);
    assert.ok(b.min <= b.base && b.base <= b.max && b.step > 0, `${id} ${t.path}`);
  }
});

test("tuning: overrides apply to a copy; bad and out-of-range values can't break the model", () => {
  const def = MODELS.fbl450;
  const out = applyTuning(def, { "rotor.hubStiffness": 25, mass: Infinity, "drag.x": "big", "rotor.flapTau": 99, "not.a.path": 3 });
  assert.equal(out.rotor.hubStiffness, 25);
  assert.equal(out.mass, def.mass, "non-finite ignored");
  assert.equal(out.drag.x, def.drag.x, "non-numbers ignored");
  assert.equal(out.rotor.flapTau, bounds(def, TUNABLES.find((t) => t.path === "rotor.flapTau")).max, "clamped to the slider range");
  assert.equal(def.rotor.hubStiffness, 18, "models.js untouched");
  assert.equal(out.notA, undefined);
});

test("tuning: export lists only the changed values, ready for models.js", () => {
  const def = MODELS.fbl450;
  assert.match(exportTuning("fbl450", def, {}), /no changes/);
  const txt = exportTuning("fbl450", def, { mass: 0.85, "tail.damping": 0.3 });
  assert.match(txt, /mass: 0\.85,\s+\/\/ was 0\.78/);
  assert.match(txt, /tail\.damping: 0\.3,/);
  assert.equal(txt.split("\n").length, 3);
});

test("tuning: a heavier heli needs more collective to hover", () => {
  const hoverVy = (def) => {
    const h = new Heli(def);
    h.reset({ pos: v3(0, 30, -5), airborne: true });
    for (let i = 0; i < 1000; i++) h.step({ roll: 0, pitch: 0, yaw: 0, coll: 0.311, mode: "idle" }, { wind: v3() }, 0.001);
    return h.vel.y;
  };
  const base = hoverVy(MODELS.fbl450);
  const heavy = hoverVy(applyTuning(MODELS.fbl450, { mass: getPath(MODELS.fbl450, "mass") * 1.3 }));
  assert.ok(Math.abs(base) < 0.3, `baseline holds height (${base.toFixed(2)} m/s)`);
  assert.ok(heavy < -0.5, `heavier sinks at the same stick (${heavy.toFixed(2)} m/s)`);
});
