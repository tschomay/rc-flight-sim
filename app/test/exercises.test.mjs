// Pattern scoring: synthetic helis flown along exact paths.
import test from "node:test";
import assert from "node:assert/strict";
import { ExerciseScorer, compassHeading, lessonProgress } from "../src/sim/exercises.js";
import { v3, qaxis, qmul, rot, DEG } from "../src/sim/math.js";

const Y = v3(0, 1, 0), X = v3(1, 0, 0);
function fake(pos, vel, heading, { inverted = false, yawRate = 0 } = {}) {
  let q = qaxis(Y, heading);
  if (inverted) q = qmul(q, qaxis(X, Math.PI));
  return { pos, vel, q, up: rot(q, Y), heading, w: v3(0, yawRate, 0), onGround: false, crashed: null };
}

/** Fly n laps of a circle; attitude picks the nose from the travel and radial directions. */
function circle(sc, center, R, { laps = 1, dir = 1, attitude = "forward", inverted = false, speed = 4, start = 0 } = {}) {
  const w = (dir * speed) / R, dt = 0.01, T = (laps * 2 * Math.PI) / Math.abs(w);
  let th = start;
  for (let t = 0; t < T + 0.05; t += dt, th += w * dt) {
    const pos = v3(center.x + R * Math.cos(th), 2, center.z - R * Math.sin(th));
    const vel = v3(-R * w * Math.sin(th), 0, -R * w * Math.cos(th));
    const travel = Math.atan2(-vel.z, vel.x), outward = Math.atan2(Math.sin(th), Math.cos(th));
    const hd = { forward: travel, backward: travel + Math.PI, "nose-in": outward + Math.PI, "tail-in": outward }[attitude];
    sc.update(fake(pos, vel, hd, { inverted }), dt);
  }
}

test("circles: counts laps by direction and attitude, with runs", () => {
  const sc = new ExerciseScorer({ kind: "circle" });
  circle(sc, sc.center, 5, { laps: 3, dir: 1 });
  circle(sc, sc.center, 5, { laps: 2, dir: -1, attitude: "backward" });
  assert.equal(sc.counts["circle|upright:forward|ccw"], 3);
  assert.equal(sc.runs["circle|upright:forward|ccw"], 3);
  assert.equal(sc.counts["circle|upright:backward|cw"], 2);
  assert.equal(lessonProgress("6", sc.tally()).passed, false, "no CW forward circles yet");
  circle(sc, sc.center, 5, { laps: 3, dir: -1 });
  assert.equal(lessonProgress("6", sc.tally()).passed, true);
});

test("circles: inverted and funnels are told apart; wandering off the outline doesn't count", () => {
  const sc = new ExerciseScorer({ kind: "circle" });
  circle(sc, sc.center, 5, { laps: 1, inverted: true, attitude: "backward" });
  circle(sc, sc.center, 5, { laps: 1, attitude: "nose-in" });
  circle(sc, sc.center, 5, { laps: 1, inverted: true, attitude: "tail-in" });
  circle(sc, sc.center, 10, { laps: 1 });  // far outside the band
  assert.deepEqual(sc.counts, { "circle|inverted:backward|ccw": 1, "circle|upright:nose-in|ccw": 1, "circle|inverted:tail-in|ccw": 1 });
});

test("8s: alternate lobes in opposite directions make an 8, outward or inward", () => {
  const sc = new ExerciseScorer({ kind: "eight" });
  const c = sc.center, R = sc.p.radius;
  // start at the crossing (angle π on the right lobe, 0 on the left one)
  for (let i = 0; i < 2; i++) {
    circle(sc, v3(c.x + R, 0, c.z), R, { laps: 1, dir: 1, start: Math.PI });   // right lobe CCW: leaves the crossing heading toward the pilot
    circle(sc, v3(c.x - R, 0, c.z), R, { laps: 1, dir: -1, start: 0 });        // left lobe CW
  }
  const n = Object.entries(sc.counts).filter(([k]) => k.startsWith("eight|"));
  assert.equal(n.length, 1, JSON.stringify(sc.counts));
  assert.equal(n[0][1], 2);
  assert.match(n[0][0], /^eight\|(outward|inward)\|upright:forward$/);
});

test("8-point piros: one rotation needs a 1 s stop at each point in turn", () => {
  const sc = new ExerciseScorer({ kind: "none" }, { center: v3(0, 0, -5), radius: 1.5 });
  const dt = 0.02;
  const stop = (k, s = 1.2) => { for (let t = 0; t < s; t += dt) sc.update(fake(v3(0, 2, -5), v3(), compassHeading(k)), dt, { inside: true }); };
  const swing = () => sc.update(fake(v3(0, 2, -5), v3(), 0, { yawRate: 1 }), dt, { inside: true });
  for (let k = 0; k <= 8; k++) { stop(k % 8); swing(); }       // N → NE → … → N clockwise
  assert.equal(sc.piro.cw, 1);
  for (let k = 8; k >= 0; k--) { stop(k % 8, k === 4 ? 0.5 : 1.2); swing(); }  // too short a stop at S
  assert.equal(sc.piro.ccw, 0, "a short stop breaks the rotation");
});
