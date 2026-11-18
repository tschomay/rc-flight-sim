import test from "node:test";
import assert from "node:assert/strict";
import { Recorder, Player } from "../src/sim/replay.js";

const fakeHeli = (t) => ({ pos: { x: t, y: 2, z: -5 }, q: { x: 0, y: Math.sin(t / 4), z: 0, w: Math.cos(t / 4) }, beta: { r: 0, p: 0 }, omega: 290, thrust: 7.6, qMotor: 0.3, mode: "idle", crashed: null });

test("replay: keeps only the last 10 s, oldest first", () => {
  const r = new Recorder(10);
  for (let i = 0; i <= 30 * 60; i++) r.record(fakeHeli(i / 60), i / 60);
  const f = r.frames();
  assert.ok(Math.abs(f[f.length - 1].t - 30) < 1e-9);
  assert.ok(f[0].t >= 20 - 1e-9 && f[0].t < 20.05, `oldest ${f[0].t}`);
  assert.ok(f.every((x, i) => i === 0 || x.t > f[i - 1].t));
});

test("replay: a full buffer overwrites the oldest frames", () => {
  const r = new Recorder(100, 50);
  for (let i = 0; i < 120; i++) r.record(fakeHeli(i), i);
  const f = r.frames();
  assert.equal(f.length, 50);
  assert.equal(f[0].t, 70);
  assert.equal(f[49].t, 119);
});

test("replay: frames are copies, not live references", () => {
  const r = new Recorder();
  const h = fakeHeli(1);
  r.record(h, 0);
  h.pos.x = 99;
  assert.equal(r.frames()[0].pos.x, 1);
});

test("replay: plays at the chosen speed and interpolates", () => {
  const r = new Recorder();
  for (let i = 0; i <= 120; i++) r.record(fakeHeli(i / 60), i / 60);   // 2 s
  const p = new Player(r.frames(), { speed: 0.5, hold: 1 });
  const f = p.step(1);   // 1 s of clock = 0.5 s of recording
  assert.ok(Math.abs(f.pos.x - 0.5) < 1e-6, f.pos.x);
  assert.ok(Math.abs(Math.hypot(f.q.x, f.q.y, f.q.z, f.q.w) - 1) < 1e-9, "unit quaternion");
  const mid = p.sample(1.005);  // between frames
  assert.ok(Math.abs(mid.pos.x - 1.005) < 1e-6);
  p.step(2.9);
  assert.equal(p.done, false, "holds on the last frame for a moment");
  p.step(1.2);   // the 1 s hold also runs at half speed
  assert.equal(p.done, true);
  assert.ok(Math.abs(p.sample(p.time).pos.x - 2) < 1e-9, "ends on the crash frame");
});

test("replay: nothing recorded plays nothing", () => {
  const p = new Player([]);
  assert.equal(p.step(1), null);
  assert.equal(p.done, true);
});
