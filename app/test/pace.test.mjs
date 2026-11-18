import test from "node:test";
import assert from "node:assert/strict";
import { Pace } from "../src/sim/pace.js";

test("pace: a phone keeping up reads 100% and isn't slow", () => {
  const p = new Pace();
  for (let i = 0; i < 300; i++) p.sample(1 / 60, 1 / 60, 1 / 60);
  assert.ok(Math.abs(p.ratio - 1) < 1e-9);
  assert.equal(p.slow, false);
});

test("pace: frames too long to catch up on show as slow", () => {
  const p = new Pace();
  // 80 ms frames: the loop only simulates 50 ms of each
  for (let i = 0; i < 100; i++) p.sample(0.08, 0.08, 0.05);
  assert.ok(Math.abs(p.ratio - 0.625) < 0.01, p.ratio);
  assert.equal(p.slow, true);
});

test("pace: slow motion on purpose isn't 'slow'", () => {
  const p = new Pace();
  for (let i = 0; i < 300; i++) p.sample(1 / 60, 0.5 / 60, 0.5 / 60);
  assert.equal(p.slow, false);
});

test("pace: a single hitch or a hidden tab doesn't trip it", () => {
  const p = new Pace();
  for (let i = 0; i < 120; i++) p.sample(1 / 60, 1 / 60, 1 / 60);
  p.sample(5, 5, 0.05);           // back from a hidden tab: ignored
  p.sample(0.12, 0.12, 0.05);     // one long frame
  assert.equal(p.slow, false, p.ratio);
});
