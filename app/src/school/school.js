// Flight school: ArchmageAU's "From tail-in to all 8s and funnels in 6 months" (HeliFreak,
// 2013), built in as an optional course. Lesson text here is a short paraphrase; the
// pilot is pointed to the original for the full guide.
// A saved copy of the guide is in docs/ ("From tail-in to all 8s and funnels in 6 months -
// HeliFreak.pdf").
//
// The course state is never stored directly: it is replayed from the log every time, so
// editing or deleting an entry re-derives where the pilot is and what comes next. A
// "jump" entry moves to a lesson by hand (deviating from the plan, or marking a practice
// lesson passed), and an override changes only the next session.

import { patternFor, DEFAULT_PATTERN } from "../sim/exercises.js";

export const CREDIT = {
  title: "From tail-in to all 8s and funnels in 6 months",
  author: "ArchmageAU",
  where: "HeliFreak, RC Helicopter Flight School forum, 2013",
  source: "https://www.helifreak.com/showthread.php?t=531380",
  origin: "https://www.helifreak.com/showthread.php?t=493289",  // "Just confirming I am on the right track", which the guide summarises
};

export const PIRO_RATE = 6;        // °/s: one rotation per minute
export const SCHOOL_HEIGHT = 2.0;  // m
const SPEED_MIN = 20;              // % (the slowest this sim runs)

// kind: "hover" lessons are flown in the hover trainer with automatic rules;
//       "practice" lessons are free flight, logged by hand and passed by the pilot.
export const LESSONS = [
  { id: "1", title: "Slow upright piros", kind: "hover",
    summary: "Hover upright while the heli turns a slow, constant pirouette: one rotation a minute. The trainer flies collective and rudder; you fly the cyclic. Every correction must be made in whatever direction the heli is facing, so you can't cheat.",
    goal: "Two sessions in a row, one CW and one CCW, with no crashes and the collective under your own control.",
    tips: ["When nose-in, push the stick toward the side that is falling (“prop it up”).", "Nose left or right: push the stick toward the nose to bring the heli back to you."] },
  { id: "2", title: "Upright lazy 8s", kind: "play",
    summary: "Play-time lesson, started alongside Lesson 1. A lazy 8 is a left-to-right pass and back with a turn at each end, centred toward you. Work it up to a nose-leading 8.",
    goal: "Not logged. Smoother turns at the ends." },
  { id: "3", title: "Flips and rolls", kind: "play",
    summary: "Play-time lesson. From a level hover, climb a little, hold cyclic in the flip direction and swap from positive to negative collective as the disc passes vertical. Aim to lose as little height and travel as little distance as possible, inside the circle. Then stop halfway, inverted, and hold it.",
    goal: "Not logged. A flip or roll in every direction that stays in the circle: you will need it for Lesson 4." },
  { id: "4", title: "Slow inverted piros", kind: "hover",
    summary: "The same slow pirouette, inverted. Flip or roll to inverted to start; if you wander out of the area, that is a crash. Sessions follow a six-step orientation cycle that mixes in upright piros at full speed.",
    goal: "Two inverted sessions in a row, one CW and one CCW, with no crashes and your own collective.",
    tips: ["Expect 50 crashes the first time. That's normal.", "Play time matters most here: this lesson is the hardest grind."] },
  { id: "5a", title: "8-point piros", kind: "hover",
    summary: "Now you fly the rudder. Turn in steps, stopping for at least a second at each of the 8 compass points (N, NE, E, …). Ten rotations a session, five each way. Alternate days: one inverted, one upright.",
    goal: "Ten sessions running without a problem: five upright, five inverted.",
    tips: ["A good time to start taking your real heli high and flipping to inverted."] },
  { id: "5b", title: "Compass circles", kind: "practice",
    summary: "Hover at each compass point with the nose toward the centre, move into the centre, back out, then on to the next point. Once each CW and CCW, upright and inverted.",
    goal: "All four (CW/CCW, upright/inverted) cleanly." },
  { id: "5c", title: "Other hover exercises", kind: "practice",
    summary: "Travelling slow piros along lines on the ground (circles, squares), then travelling fast piros, then all the earlier hover exercises in 15–30 km/h wind and gusts.",
    goal: "Each exercise comfortably, then in wind." },
  { id: "6", title: "Upright forward circles", kind: "practice",
    summary: "Continuous banked circles, CW and CCW, not around yourself. A coordinated turn: rudder and aileron the same way, a little back elevator. Always keep the rudder moving. Rock the aileron to find the bank angle. Bail out by levelling the disc and pulling back.",
    goal: "Five each way; pass at three in a row each way without stopping or wandering." },
  { id: "7", title: "Upright backward circles", kind: "practice",
    summary: "An uncoordinated turn: rudder one way, aileron the other, forward elevator to keep it going. Don't over-steer: large, even circles. Keep the tail parallel to the ground.",
    goal: "Five each way; pass at three in a row each way." },
  { id: "8", title: "Inverted backward circles", kind: "practice",
    summary: "Like upright forward circles with the collective reversed and the steering reversed. Fly them higher than upright circles. Expect the heli to slip: tip it further into the circle with aileron.",
    goal: "Five each way; pass at three in a row each way." },
  { id: "9", title: "Inverted forward circles", kind: "practice",
    summary: "Like upright backward circles with collective and steering reversed; the rudder sets the direction, the aileron balances the turn. Practise the bail-out.",
    goal: "Five each way; pass at three in a row each way." },
  { id: "10", title: "True 8s", kind: "practice",
    summary: "Your first transitions. Even circles with the change at the centre; don't climb through it. Order: outward then inward upright forward 8s, upright backward 8s, inverted backward 8s.",
    goal: "Two of each in one session without crashing, bailing out or leaving the area." },
  { id: "11", title: "Funnels", kind: "practice",
    summary: "Deliberately messed-up circles: from a circle, use rudder to slide the tail out (or in). Aileron now holds the speed and elevator holds the bank. Rock the elevator to groove it.",
    goal: "Five of each: upright nose-in, upright tail-in, inverted tail-in, inverted nose-in." },
  { id: "11a", title: "Funnel 8s", kind: "practice",
    summary: "Slow, flat funnels chained into an 8, transitioning nose-in to tail-in while staying upright or inverted. Eight variations: outward and inward, upright and inverted, right and left side leading.",
    goal: "All eight, consistently." },
  { id: "12", title: "Transitional 8s including funnels", kind: "practice",
    summary: "The full sequence: every 8 and funnel 8, outward and inward, upright and inverted, joined by flips and traverses, bookended by inverted and upright 8-point piros.",
    goal: "The sequence in one flight. From here, the sky is the limit." },
];

export const lessonById = (id) => LESSONS.find((l) => l.id === id) || LESSONS[0];
const TRACK = LESSONS.filter((l) => l.kind !== "play").map((l) => l.id);
export const nextLessonId = (id) => TRACK[Math.min(TRACK.indexOf(id) + 1, TRACK.length - 1)];

// Lesson 4's orientation cycle; upright steps are always flown at full speed.
export const L4_CYCLE = [["inverted", "cw"], ["inverted", "ccw"], ["upright", "cw"], ["inverted", "cw"], ["inverted", "ccw"], ["upright", "ccw"]];

export const DEFAULT_SCHOOL = {
  sessionMinutes: 15,
  restMinutes: 15,
  circle: 4,       // m diameter of the hover area (shown as a 2 m radius)
  log: [],         // entries, oldest first (see sessionEntry)
  deleted: [],     // keys of deleted entries, so a deletion survives merging with a backup
  override: null,  // { lesson?, orientation?, direction?, speed?, collAssist? } for the next session only
};

const clampSpeed = (v) => Math.max(SPEED_MIN, Math.min(100, Math.round(v)));
const opposite = (d) => (d === "cw" ? "ccw" : "cw");

/**
 * Replay the log. Returns where the pilot is and the plan for the next session, plus a
 * list of notes explaining each rule that fired on the most recent entry.
 */
export function replay(log) {
  const st = {
    lesson: "1",
    up: { speed: 100, coll: true },
    inv: { speed: 100, coll: true },
    nextDir: "ccw",
    cycle: 0,
    clean: null,      // direction of the previous clean, own-collective session in this lesson
    piroRun: 0,       // 5a: consecutive clean sessions
    piroNext: "inverted",
    notes: [],
  };
  for (const e of log) {
    st.notes = [];
    if (e.type === "jump") {
      st.lesson = e.lesson; st.clean = null; st.piroRun = 0; st.cycle = 0;
      st.notes.push(`Moved to Lesson ${e.lesson}.`);
      continue;
    }
    if (e.type !== "session" || e.lesson !== st.lesson) continue;  // sessions off the plan's lesson are kept but don't drive it
    const L = st.lesson;
    if (L === "1" || (L === "4" && e.orientation === "inverted")) {
      const o = L === "1" ? st.up : st.inv;
      if (e.crashes === 0 && e.collAssist && o.coll) { o.coll = false; st.notes.push("No crashes: you fly the collective from now on."); }
      if (L === "4" && e.crashes > 50) { o.speed = Math.min(o.speed, 50); st.notes.push("Over 50 crashes: next inverted session at 50% speed."); }
      else if (e.crashes > 7) { o.speed = clampSpeed(o.speed - 10); st.notes.push(`Over 7 crashes: speed down to ${o.speed}%.`); }
      else if (e.crashes < 5 && o.speed < 100) { o.speed = clampSpeed(o.speed + 5); st.notes.push(`Under 5 crashes: speed up to ${o.speed}%.`); }
      const clean = e.crashes === 0 && !e.collAssist;
      if (clean && st.clean && st.clean !== e.direction) {
        st.lesson = nextLessonId(L); st.clean = null; st.cycle = 0;
        st.notes.push(`Two clean sessions, CW and CCW: on to Lesson ${st.lesson}!`);
        continue;
      }
      st.clean = clean ? e.direction : null;
    }
    if (L === "1") st.nextDir = opposite(e.direction);
    if (L === "4") st.cycle = (st.cycle + 1) % L4_CYCLE.length;
    if (L === "5a") {
      // clean: no crashes and, when the sim counted them, the ten rotations (five each way)
      const p = e.tally?.piros;
      const clean = e.crashes === 0 && (!p || (p.cw >= 5 && p.ccw >= 5));
      st.piroRun = clean ? st.piroRun + 1 : 0;
      st.piroNext = e.orientation === "inverted" ? "upright" : "inverted";
      if (st.piroRun >= 10) { st.lesson = nextLessonId(L); st.piroRun = 0; st.notes.push(`Ten clean sessions in a row: on to Lesson ${st.lesson}!`); }
      else st.notes.push(clean ? `${st.piroRun} of 10 clean sessions in a row.` : "Run reset: ten clean sessions in a row needed (no crashes, 5 rotations each way).");
    }
  }
  return st;
}

/** What the next session should be, from the replayed state and any override. */
export function planNext(school) {
  const st = replay(school.log);
  let p;
  const L = st.lesson;
  if (L === "1") p = { orientation: "upright", direction: st.nextDir, speed: st.up.speed, collAssist: st.up.coll, rudderAssist: true };
  else if (L === "4") {
    const [orientation, direction] = L4_CYCLE[st.cycle];
    p = orientation === "upright"
      ? { orientation, direction, speed: 100, collAssist: false, rudderAssist: true }
      : { orientation, direction, speed: st.inv.speed, collAssist: st.inv.coll, rudderAssist: true };
  } else if (L === "5a") p = { orientation: st.piroNext, direction: "both", speed: 100, collAssist: false, rudderAssist: false };
  else p = { orientation: "upright", direction: "both", speed: 100, collAssist: false, rudderAssist: false };
  p.lesson = L;
  const o = school.override;
  if (o) {
    for (const k of ["lesson", "orientation", "direction", "speed", "collAssist", "rudderAssist"]) if (o[k] != null) p[k] = o[k];
    p.overridden = true;
  }
  p.kind = lessonById(p.lesson).kind === "hover" ? "hover" : "free";
  return { plan: p, state: st };
}

/** Trainer settings for a planned session. */
export function trainerFor(plan, school, base) {
  const pattern = { ...DEFAULT_PATTERN, ...(base.pattern || {}), ...patternFor(plan.lesson) };
  if (plan.kind !== "hover") return { ...base, kind: "free", leaveIsCrash: false, pattern, compass: false };
  return {
    ...base,
    kind: "hover",
    assist: { collective: plan.collAssist, rudder: plan.rudderAssist, cyclic: false },
    height: SCHOOL_HEIGHT,
    circle: school.circle,
    distance: Math.max(base.distance, school.circle / 2 + 3),  // keep the area's near edge 3 m in front of the pilot
    orientation: "tail",
    inverted: plan.orientation === "inverted",
    rotation: plan.rudderAssist ? plan.direction : "off",
    rotationSpeed: PIRO_RATE,
    heightWindow: 0,
    leaveIsCrash: true,
    pattern,
    compass: plan.lesson === "5a",
  };
}

/** A log entry for a finished session. */
export function sessionEntry(plan, { startedAt, seconds, crashes, outOfArea }) {
  return {
    type: "session",
    id: `s${startedAt}`,
    date: new Date(startedAt).toISOString(),
    minutes: Math.round((seconds / 60) * 10) / 10,
    lesson: plan.lesson,
    orientation: plan.orientation,
    direction: plan.direction,
    speed: plan.speed,
    crashes,
    outOfArea,
    collAssist: plan.collAssist,
    rudderAssist: plan.rudderAssist,
    notes: "",
  };
}

/** Minutes of rest still owed before the next training session (0 when rested). */
export function restLeft(school, now = Date.now()) {
  const last = [...school.log].reverse().find((e) => e.type === "session");
  if (!last) return 0;
  const end = new Date(last.date).getTime() + last.minutes * 60000;
  return Math.max(0, Math.ceil((end + school.restMinutes * 60000 - now) / 60000));
}

/** Sessions flown on the calendar day of `now`, and whether yesterday was skipped. */
export function dailyStatus(school, now = new Date()) {
  const day = (d) => new Date(d).toDateString();
  const sessions = school.log.filter((e) => e.type === "session");
  const today = sessions.filter((e) => day(e.date) === day(now)).length;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const skipped = sessions.length > 0 && today === 0 && !sessions.some((e) => day(e.date) === day(y));
  return { today, skipped };
}

export function toCSV(log) {
  const cols = ["type", "id", "date", "minutes", "lesson", "orientation", "direction", "speed", "crashes", "outOfArea", "collAssist", "rudderAssist", "notes", "tally"];
  const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const val = (e, c) => (c === "tally" && e.tally ? JSON.stringify(e.tally) : e[c]);
  return [cols.join(","), ...log.map((e) => cols.map((c) => q(val(e, c))).join(","))].join("\n");
}
