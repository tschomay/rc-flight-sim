// Pattern scoring: synthetic helis flown along exact paths.
import test from "node:test";
import assert from "node:assert/strict";
import { ExerciseScorer, compassHeading, lessonProgress, patternFor, SEQUENCE } from "../src/sim/exercises.js";
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

// ---------- lesson 12: the full sequence in one flight ----------

/** One 8 on the scorer's two lobes; `reverse` flies it the other way through the crossing. */
function eight(sc, { a1 = "forward", a2 = a1, inverted = false, reverse = false } = {}) {
  const c = sc.center, R = sc.p.radius;
  const right = (dir, attitude) => circle(sc, v3(c.x + R, 0, c.z), R, { laps: 1, dir, start: Math.PI, attitude, inverted });
  const left = (dir, attitude) => circle(sc, v3(c.x - R, 0, c.z), R, { laps: 1, dir, start: 0, attitude, inverted });
  if (!reverse) { right(1, a1); left(-1, a2); } else { left(1, a1); right(-1, a2); }
  // the flip or traverse to the next 8 leaves the outline, which restarts the lap count
  sc.update(fake(v3(c.x, 4, c.z - 3 * R), v3(3, 0, 0), 0, { inverted }), 0.02);
}

/** An 8-point piro over the crossing, stopping at each point. */
function piro(sc, inverted) {
  const dt = 0.02, at = v3(sc.center.x, 3, sc.center.z);
  for (let k = 0; k <= 8; k++) {
    for (let t = 0; t < 1.2; t += dt) sc.update(fake(at, v3(), compassHeading(k % 8), { inverted }), dt);
    sc.update(fake(at, v3(), 0, { inverted, yawRate: 1 }), dt);
  }
}

function fullSequence(sc, skip = null) {
  const kinds = [
    { a1: "forward" }, { a1: "backward" }, { a1: "backward", inverted: true },
    { a1: "nose-in", a2: "tail-in" }, { a1: "tail-in", a2: "nose-in", inverted: true },
  ];
  piro(sc, true);
  for (const k of kinds) for (const reverse of [false, true]) if (skip !== `${kinds.indexOf(k)}${reverse}`) eight(sc, { ...k, reverse });
  piro(sc, false);
}

test("lesson 12: the whole sequence in one flight passes", () => {
  const sc = new ExerciseScorer(patternFor("12"));
  assert.equal(lessonProgress("12", sc.tally()).passed, false);
  fullSequence(sc);
  const t = sc.tally();
  assert.deepEqual([...t.seq.best].sort(), [...SEQUENCE].sort(), `missing: ${SEQUENCE.filter((k) => !t.seq.best.includes(k))}`);
  const p = lessonProgress("12", t);
  assert.equal(p.passed, true, p.text);
  assert.match(p.text, /12\/12/);
});

test("lesson 12: a crash or a landing starts a new flight, keeping the best", () => {
  const sc = new ExerciseScorer(patternFor("12"));
  fullSequence(sc, "2true");   // one inverted backward 8 missing
  const before = sc.tally().seq;
  assert.equal(before.now.length, 11);
  assert.equal(lessonProgress("12", sc.tally()).passed, false);
  assert.match(lessonProgress("12", sc.tally()).text, /Still to fly this flight: (inward|outward) inverted backward 8/);
  sc.update({ ...fake(v3(0, 0.2, -16), v3(), 0), onGround: true }, 0.02);
  assert.equal(sc.tally().seq.now.length, 0, "landing ends the flight");
  assert.equal(sc.tally().seq.best.length, 11, "the best flight is kept");
  eight(sc, { a1: "backward", inverted: true, reverse: true });
  assert.equal(lessonProgress("12", sc.tally()).passed, false, "the missing 8 alone, in a new flight, isn't the sequence");
});

test("lesson 12's pattern scores piros over the crossing; other 8 lessons don't", () => {
  assert.equal(new ExerciseScorer(patternFor("10")).hover, null);
  assert.equal(new ExerciseScorer(patternFor("10")).tally().seq, undefined);
  const sc = new ExerciseScorer(patternFor("12"));
  piro(sc, false);
  assert.equal(sc.piro.cw, 1);
  assert.deepEqual(sc.tally().seq.now, ["piro|upright"]);
});
