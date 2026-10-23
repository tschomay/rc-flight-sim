// Training modes, modelled on HELI-X's hover trainer.
//
// The pilot picks which functions the trainer flies (collective, cyclic, rudder). The
// trainer flies them through the same sticks and FBL a pilot would, like an instructor
// on a buddy box: nothing is pinned in place, so wind and the heli's own dynamics still
// show. Heading can be held, rotated continuously either way, or swung ±90°.

import { v3, sub, cross, clamp, wrapPi, DEG, irot } from "./math.js";
import { G } from "./heli.js";

export const ORIENTATIONS = {
  tail: { label: "Tail-in", heading: 90 },
  left: { label: "Left side in", heading: 0 },
  right: { label: "Right side in", heading: 180 },
  nose: { label: "Nose-in", heading: -90 },
};

export const DEFAULT_TRAINER = {
  kind: "hover",            // "free" | "hover"
  assist: { collective: true, cyclic: false, rudder: true },
  height: 1.5,              // m, CG above ground
  distance: 5,              // m in front of the pilot
  circle: 3,                // m diameter of the target circle
  orientation: "tail",
  inverted: false,
  rotation: "off",          // "off" | "ccw" | "cw" | "swing"
  rotationSpeed: 20,        // deg/s
  swingPeriod: 8,           // s for a full -90 → +90 → -90 swing
  gain: 0.6,                // 0 = gentle/robust, 1 = tight/fast
  heightWindow: 0,          // m either side of the target height that still counts; 0 = any height
  leaveIsCrash: false,      // HELI-X style: wandering out of the circle ends the attempt
};

const LEAVE_MARGIN = 0.25;  // m past the circle's edge before leaving counts as a crash

export class Trainer {
  constructor(cfg = DEFAULT_TRAINER) {
    this.cfg = structuredClone(cfg);
    this.resetScore();
  }

  resetScore() {
    this.t = 0;
    this.inside = false;
    this.timeIn = 0;
    this.timeTotal = 0;
    this.streak = 0;
    this.best = 0;
    this.crashes = 0;
  }

  get target() {
    return v3(0, this.cfg.height, -this.cfg.distance);
  }

  /** Spawn the heli for this exercise. */
  start(heli, mode = "idle") {
    const c = this.cfg;
    this.t = 0;
    this.collI = 0;
    this.headingT = ORIENTATIONS[c.orientation].heading * DEG;
    if (c.kind === "free") {
      heli.reset({ pos: v3(0, 0, -c.distance), yaw: 90 * DEG, airborne: false, mode });
    } else {
      heli.reset({ pos: this.target, yaw: this.headingT, inverted: c.inverted, airborne: true, mode: "idle" });
    }
  }

  /**
   * Blend trainer control into the pilot's sticks. `pilot` is post-expo stick input.
   * Returns the sticks the heli should fly with.
   */
  update(heli, pilot, dt) {
    const c = this.cfg;
    this.t += dt;
    const out = { ...pilot };
    if (c.kind !== "hover" || heli.crashed) return out;

    const g = 0.5 + c.gain;  // 0.5 … 1.5
    const up = heli.up;
    const sgn = up.y >= 0 ? 1 : -1;
    const base = ORIENTATIONS[c.orientation].heading * DEG;
    let rateT = 0;
    if (c.rotation === "ccw" || c.rotation === "cw") {
      rateT = (c.rotation === "ccw" ? 1 : -1) * c.rotationSpeed * DEG;
      this.headingT = wrapPi(this.headingT + rateT * dt);
    } else if (c.rotation === "swing") {
      const w = (2 * Math.PI) / c.swingPeriod;
      this.headingT = wrapPi(base + 90 * DEG * Math.sin(w * this.t));
      rateT = 90 * DEG * w * Math.cos(w * this.t);
    } else this.headingT = base;

    if (c.assist.collective) {
      const e = c.height - heli.pos.y;
      const wn = 2 * g;
      this.collI = clamp(this.collI + e * dt, -2, 2);
      const aDes = clamp(wn * wn * e - 2 * wn * heli.vel.y + 0.6 * this.collI, -6, 6);
      const uy = Math.abs(up.y) < 0.25 ? 0.25 * sgn : up.y;
      const T = clamp((heli.def.mass * (G + aDes)) / uy, -3 * heli.def.mass * G, 3 * heli.def.mass * G);
      out.coll = heli.stickForPitch(heli.pitchForThrust(T));
    }

    if (c.assist.cyclic) {
      const p = heli.pos, v = heli.vel, tgt = this.target;
      const wn = 1.1 * g;
      const amax = G * Math.tan(25 * DEG);
      let ax = wn * wn * (tgt.x - p.x) - 1.8 * wn * v.x;
      let az = wn * wn * (tgt.z - p.z) - 1.8 * wn * v.z;
      const am = Math.hypot(ax, az);
      if (am > amax) { ax *= amax / am; az *= amax / am; }
      const n = Math.hypot(ax, G, az);
      const mDes = v3((sgn * ax) / n, (sgn * G) / n, (sgn * az) / n);
      const errB = irot(heli.q, cross(up, mDes));
      const k = 7 * g;
      out.roll = clamp((k * errB.x) / (heli.def.rates.roll * DEG), -1, 1);
      out.pitch = clamp((-k * errB.z) / (heli.def.rates.pitch * DEG), -1, 1);
    }

    if (c.assist.rudder) {
      const e = wrapPi(this.headingT - heli.heading);
      const rw = rateT + 4 * g * e;
      out.yaw = clamp((-rw * sgn) / (heli.def.rates.yaw * DEG), -1, 1);
    }

    // score: the circle is a column. Inside means over the circle and off the ground, and,
    // if a height window is set, within it of the target height.
    const d = sub(heli.pos, this.target);
    const r = Math.hypot(d.x, d.z);
    const hw = c.heightWindow ?? 0;
    this.inside = r <= c.circle / 2 && !heli.onGround && (hw <= 0 || Math.abs(d.y) <= hw);
    if (c.leaveIsCrash && this.t > 0.5 && r > c.circle / 2 + LEAVE_MARGIN) heli.crash("Left the circle");
    this.timeTotal += dt;
    if (this.inside) { this.timeIn += dt; this.streak += dt; this.best = Math.max(this.best, this.streak); }
    else this.streak = 0;
    return out;
  }
}
