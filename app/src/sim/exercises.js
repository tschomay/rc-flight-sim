// Automatic scoring for the patterned exercises: circles (and funnels) around a ground
// outline, figure-8s on two outlines, and 8-point piros on the hover circle's compass.
//
// Circles: the heli's angle around the outline's centre is accumulated while it flies in a
// band around the outline (airborne, moving). A full turn is a lap, CW or CCW seen from
// above. Each lap is labelled by how it was flown for most of the way round: upright or
// inverted, and forward, backward, nose-in or tail-in (the funnels). Leaving the band,
// landing or crashing starts the lap again.
//
// 8s: two outlines touching at the centre. Laps on alternate lobes in opposite directions
// make an 8; outward or inward is the direction of travel through the crossing (away from
// or toward the pilot).
//
// Piros: a stop is the heading held within 12° of a compass point for a second, at low yaw
// rate, inside the hover circle. Eight stops in a row going the same way are a rotation.

import { v3, rot, wrapPi, DEG } from "./math.js";

export const DEFAULT_PATTERN = {
  kind: "none",   // "none" | "circle" | "eight"
  radius: 5,      // m, each circle (or each lobe of the 8)
  distance: 16,   // m from the pilot to the pattern's centre
  band: 2.5,      // m either side of the outline that still counts
};

export const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** Heading (rad, math.heading convention) of compass point k; N is nose away from the pilot. */
export const compassHeading = (k) => (90 - 45 * k) * DEG;

const ATTITUDES = { forward: "forward", backward: "backward", "nose-in": "nose-in funnel", "tail-in": "tail-in funnel" };
export const catLabel = (cat) => {
  if (!cat || cat === "mixed") return "mixed";
  const [o, a] = cat.split(":");
  return `${o} ${ATTITUDES[a] || a}`;
};

/** How the heli is flying right now, relative to its travel and the circle's centre. */
export function attitude(heli, center) {
  const v = heli.vel;
  const sp = Math.hypot(v.x, v.z);
  if (sp < 1) return null;
  const f = rot(heli.q, v3(1, 0, 0));
  const fl = Math.hypot(f.x, f.z) || 1;
  const nx = f.x / fl, nz = f.z / fl;
  const along = (nx * v.x + nz * v.z) / sp;
  const o = heli.up.y < 0 ? "inverted" : "upright";
  if (along > 0.7) return `${o}:forward`;
  if (along < -0.7) return `${o}:backward`;
  const rx = heli.pos.x - center.x, rz = heli.pos.z - center.z, rl = Math.hypot(rx, rz) || 1;
  const out = (nx * rx + nz * rz) / rl;
  if (out < -0.75) return `${o}:nose-in`;
  if (out > 0.75) return `${o}:tail-in`;
  return "mixed";
}

class LapTracker {
  constructor(center, radius, band) {
    this.c = center; this.R = radius; this.band = band;
    this.reset();
  }

  reset() { this.acc = 0; this.prev = null; this.time = {}; this.t = 0; }

  /** Returns { dir, cat, seconds } when a lap completes. */
  update(heli, dt) {
    const dx = heli.pos.x - this.c.x, dz = heli.pos.z - this.c.z;
    const r = Math.hypot(dx, dz);
    if (heli.onGround || heli.crashed || Math.abs(r - this.R) > this.band) { this.reset(); return null; }
    const a = Math.atan2(-dz, dx);   // increases counter-clockwise seen from above
    if (this.prev != null) this.acc += wrapPi(a - this.prev);
    this.prev = a;
    this.t += dt;
    const cat = attitude(heli, this.c);
    if (cat) this.time[cat] = (this.time[cat] || 0) + dt;
    if (Math.abs(this.acc) < 2 * Math.PI) return null;
    const dir = this.acc > 0 ? "ccw" : "cw";
    const total = Object.values(this.time).reduce((s, x) => s + x, 0) || 1;
    const [best, bt] = Object.entries(this.time).sort((p, q) => q[1] - p[1])[0] || ["mixed", 0];
    const lap = { dir, cat: best !== "mixed" && bt / total >= 0.6 ? best : "mixed", seconds: this.t };
    this.acc -= Math.sign(this.acc) * 2 * Math.PI;
    this.time = {}; this.t = 0;
    return lap;
  }
}

/** Tallies laps, 8s and piro rotations for a session. */
export class ExerciseScorer {
  constructor(pattern = DEFAULT_PATTERN, hover = null) {
    this.p = { ...DEFAULT_PATTERN, ...pattern };
    this.hover = hover;   // { center: v3, radius } when scoring compass piros
    const c = this.center;
    if (this.p.kind === "circle") this.lobes = [new LapTracker(c, this.p.radius, this.p.band)];
    else if (this.p.kind === "eight") this.lobes = [-1, 1].map((s) => new LapTracker(v3(c.x + s * this.p.radius, 0, c.z), this.p.radius, this.p.band));
    else this.lobes = [];
    this.counts = {};     // "circle|<cat>|<dir>" or "eight|<outward|inward>|<cat>" → n
    this.runs = {};       // same keys → best consecutive run
    this.run = { key: null, n: 0 };
    this.lastLap = null;  // { lobe, dir, cat, cross }
    this.cross = null;    // "outward" | "inward" at the last pass through the 8's crossing
    this.last = null;     // last scored item, for the HUD
    this.piro = { k: null, held: 0, seq: [], dir: null, cw: 0, ccw: 0, reached: null };
  }

  get center() { return v3(0, 0, -this.p.distance); }

  bump(key) {
    this.counts[key] = (this.counts[key] || 0) + 1;
    this.run = this.run.key === key ? { key, n: this.run.n + 1 } : { key, n: 1 };
    this.runs[key] = Math.max(this.runs[key] || 0, this.run.n);
    this.last = key;
  }

  update(heli, dt, { inside = false } = {}) {
    if (heli.crashed) { this.run = { key: null, n: 0 }; for (const l of this.lobes) l.reset(); this.lastLap = null; }
    if (this.p.kind === "eight") {
      const c = this.center;
      if (Math.hypot(heli.pos.x - c.x, heli.pos.z - c.z) < 1.5 && Math.abs(heli.vel.z) > 0.5) this.cross = heli.vel.z < 0 ? "outward" : "inward";
    }
    this.lobes.forEach((lobe, i) => {
      const lap = lobe.update(heli, dt);
      if (!lap) return;
      if (this.p.kind === "circle") { this.bump(`circle|${lap.cat}|${lap.dir}`); return; }
      const prev = this.lastLap;
      if (prev && prev.lobe !== i && prev.dir !== lap.dir) {
        const cat = prev.cat === lap.cat ? lap.cat : prev.cat.split(":")[0] === lap.cat.split(":")[0] && /funnel|nose|tail/.test(prev.cat + lap.cat) ? `${lap.cat.split(":")[0]}:funnel` : "mixed";
        this.bump(`eight|${prev.cross || "?"}|${cat}`);
        this.lastLap = null;
      } else this.lastLap = { lobe: i, dir: lap.dir, cat: lap.cat, cross: this.cross };
    });
    if (this.hover) this.updatePiro(heli, dt, inside);
  }

  updatePiro(heli, dt, inside) {
    const pr = this.piro;
    if (!inside || heli.crashed) { pr.seq = []; pr.dir = null; pr.held = 0; pr.k = null; return; }
    let k = -1;
    for (let i = 0; i < 8; i++) if (Math.abs(wrapPi(heli.heading - compassHeading(i))) < 12 * DEG) k = i;
    const still = Math.abs(heli.w.y) < 25 * DEG;
    if (k < 0 || !still) { pr.held = 0; pr.k = k < 0 ? null : k; return; }
    if (pr.k !== k) { pr.k = k; pr.held = 0; }
    pr.held += dt;
    if (pr.held < 1 || pr.seq[pr.seq.length - 1] === k) return;
    // a new stop: continue the sequence if it's the next point in the same direction
    const last = pr.seq[pr.seq.length - 1];
    const step = last == null ? 0 : (k - last + 8) % 8;
    const dir = step === 1 ? "cw" : step === 7 ? "ccw" : null;
    if (last == null || !dir || (pr.dir && dir !== pr.dir)) { pr.seq = [k]; pr.dir = null; }
    else { pr.seq.push(k); pr.dir = dir; }
    pr.reached = k;
    if (pr.seq.length >= 9) {  // back at the starting point: eight stops, one full turn
      pr[pr.dir]++;
      this.last = `piro|${pr.dir}`;
      pr.seq = [k];
      pr.dir = null;
    }
  }

  /** The compass point the pilot should stop at next, or null. */
  get nextPoint() {
    const pr = this.piro;
    const last = pr.seq[pr.seq.length - 1];
    if (last == null || !pr.dir) return null;
    return (last + (pr.dir === "cw" ? 1 : 7)) % 8;
  }

  /** A plain summary for the log and the HUD. */
  summary() {
    const parts = Object.entries(this.counts).map(([key, n]) => {
      const [kind, a, b] = key.split("|");
      const label = kind === "circle" ? `${catLabel(a)} circles ${b.toUpperCase()}` : `${a} ${b.endsWith(":funnel") ? `${b.split(":")[0]} funnel` : catLabel(b)} 8s`;
      return `${label}: ${n} (best run ${this.runs[key]})`;
    });
    if (this.hover) parts.push(`8-point piros: ${this.piro.cw} CW, ${this.piro.ccw} CCW`);
    return parts.join("; ");
  }

  tally() {
    return { counts: { ...this.counts }, runs: { ...this.runs }, ...(this.hover ? { piros: { cw: this.piro.cw, ccw: this.piro.ccw } } : {}) };
  }
}

// ---------- what each lesson asks for ----------

const CIRCLE_CAT = { 6: "upright:forward", 7: "upright:backward", 8: "inverted:backward", 9: "inverted:forward" };
const EIGHT_KINDS = ["upright:forward", "upright:backward", "inverted:backward"];
const FUNNELS = ["upright:nose-in", "upright:tail-in", "inverted:tail-in", "inverted:nose-in"];

/** The ground pattern a lesson is flown on (school lessons only). */
export function patternFor(lessonId) {
  if (CIRCLE_CAT[lessonId] || lessonId === "11") return { kind: "circle" };
  if (["10", "11a", "12"].includes(lessonId)) return { kind: "eight" };
  return { kind: "none" };
}

/**
 * Whether a session's tally meets the lesson's goal, and a short line on what's left.
 * Returns null for lessons that aren't scored automatically.
 */
export function lessonProgress(lessonId, tally) {
  const c = tally?.counts || {}, r = tally?.runs || {};
  if (CIRCLE_CAT[lessonId]) {
    const cat = CIRCLE_CAT[lessonId];
    const run = (d) => r[`circle|${cat}|${d}`] || 0, n = (d) => c[`circle|${cat}|${d}`] || 0;
    return { passed: run("cw") >= 3 && run("ccw") >= 3, text: `${catLabel(cat)} circles: CCW ${n("ccw")} (run ${run("ccw")}/3), CW ${n("cw")} (run ${run("cw")}/3)` };
  }
  if (lessonId === "10") {
    const need = EIGHT_KINDS.flatMap((k) => ["outward", "inward"].map((w) => [w, k]));
    const have = need.map(([w, k]) => c[`eight|${w}|${k}`] || 0);
    return { passed: have.every((x) => x >= 2), text: need.map(([w, k], i) => `${w} ${catLabel(k)} ${have[i]}/2`).join(", ") };
  }
  if (lessonId === "11") {
    const have = FUNNELS.map((k) => (c[`circle|${k}|cw`] || 0) + (c[`circle|${k}|ccw`] || 0));
    return { passed: have.every((x) => x >= 5), text: FUNNELS.map((k, i) => `${catLabel(k)} ${have[i]}/5`).join(", ") };
  }
  if (lessonId === "11a") {
    const kinds = ["upright", "inverted"].flatMap((o) => ["outward", "inward"].map((w) => `eight|${w}|${o}:funnel`));
    const have = kinds.map((k) => c[k] || 0);
    return { passed: have.every((x) => x >= 2), text: kinds.map((k, i) => `${k.split("|")[1]} ${k.split("|")[2].split(":")[0]} ${have[i]}/2`).join(", ") };
  }
  if (lessonId === "5a") {
    const p = tally?.piros || { cw: 0, ccw: 0 };
    return { passed: p.cw >= 5 && p.ccw >= 5, text: `8-point piros: CW ${p.cw}/5, CCW ${p.ccw}/5` };
  }
  return null;
}
