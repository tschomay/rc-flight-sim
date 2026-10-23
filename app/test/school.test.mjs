// Flight-school rules, replayed from the log.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCHOOL, planNext, replay, sessionEntry, restLeft, L4_CYCLE } from "../src/school/school.js";

let clock = Date.UTC(2026, 0, 1, 8);
function fly(school, crashes) {
  const { plan } = planNext(school);
  clock += 40 * 60000;
  school.log.push(sessionEntry(plan, { startedAt: clock, seconds: 900, crashes, outOfArea: 0 }));
  school.override = null;
  return planNext(school).plan;
}
const fresh = () => structuredClone(DEFAULT_SCHOOL);

test("lesson 1 starts with the trainer on collective and rudder at full speed", () => {
  const { plan } = planNext(fresh());
  assert.deepEqual([plan.lesson, plan.orientation, plan.speed, plan.collAssist, plan.rudderAssist], ["1", "upright", 100, true, true]);
});

test("lesson 1: crashes change speed, direction alternates, a clean session hands over the collective", () => {
  const s = fresh();
  const d0 = planNext(s).plan.direction;
  let p = fly(s, 10);
  assert.equal(p.speed, 90);
  assert.notEqual(p.direction, d0);
  p = fly(s, 6);
  assert.equal(p.speed, 90, "5–7 crashes keeps the speed");
  p = fly(s, 3);
  assert.equal(p.speed, 95);
  p = fly(s, 0);
  assert.equal(p.collAssist, false);
  assert.equal(p.speed, 100);
});

test("lesson 1 → 4 after clean CW and CCW sessions with own collective", () => {
  const s = fresh();
  fly(s, 0);            // hands over collective
  fly(s, 0);            // first clean, own collective
  const p = fly(s, 0);  // second, opposite direction
  assert.equal(p.lesson, "4");
  assert.deepEqual([p.orientation, p.direction], L4_CYCLE[0]);
});

test("lesson 4: orientation cycle, 50-crash rule, upright always full speed", () => {
  const s = fresh();
  s.log.push({ type: "jump", lesson: "4", date: new Date(clock).toISOString() });
  let p = fly(s, 60);
  assert.equal(p.speed, 50);
  assert.deepEqual([p.orientation, p.direction], L4_CYCLE[1]);
  p = fly(s, 20);
  assert.deepEqual([p.orientation, p.speed], ["upright", 100]);
  p = fly(s, 30);   // upright session doesn't touch inverted speed
  assert.deepEqual([p.orientation, p.speed], ["inverted", 40]);
});

test("editing a log entry re-derives the plan", () => {
  const s = fresh();
  fly(s, 10);
  assert.equal(planNext(s).plan.speed, 90);
  s.log[0].crashes = 2;
  assert.equal(planNext(s).plan.speed, 100);
});

test("an override changes only the next session", () => {
  const s = fresh();
  s.override = { speed: 60, orientation: "inverted" };
  const { plan } = planNext(s);
  assert.deepEqual([plan.speed, plan.orientation, plan.overridden], [60, "inverted", true]);
  const p = fly(s, 3);
  assert.equal(p.overridden, undefined);
});

test("lesson 5a passes after ten clean sessions in a row, alternating orientation", () => {
  const s = fresh();
  s.log.push({ type: "jump", lesson: "5a", date: new Date(clock).toISOString() });
  let p = fly(s, 0);
  const o1 = p.orientation;
  p = fly(s, 1);
  assert.notEqual(p.orientation, o1);
  assert.equal(replay(s.log).piroRun, 0);
  for (let i = 0; i < 10; i++) p = fly(s, 0);
  assert.equal(p.lesson, "5b");
});

test("rest timer counts from the end of the last session", () => {
  const s = fresh();
  s.log.push({ type: "session", date: new Date(0).toISOString(), minutes: 15, lesson: "1" });
  assert.equal(restLeft(s, 20 * 60000), 10);
  assert.equal(restLeft(s, 31 * 60000), 0);
});
