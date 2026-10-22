// Flight model for a single-rotor RC helicopter with a flybarless controller.
//
// Runs at a fixed 1 kHz step. Main pieces:
//   - 6-DOF rigid body (world: y up; body: x nose, y mast, z right)
//   - main rotor: blade-element thrust with momentum-theory inflow solved each step and
//     lagged (dynamic inflow), translational lift, ground effect, vortex-ring roughness,
//     blade drag torque driving a headspeed state, autorotation falls out naturally
//   - rotor disc tilt as a first-order flapping state: follows the swash cyclic, lags the
//     fuselage (rotor damping), and blows back with airspeed; hub stiffness + thrust
//     offset give the control moments
//   - governor + power-limited motor, throttle hold
//   - tail rotor with lag, aerodynamic damping and weathervaning
//   - flybarless rate controller on all three axes (heading-hold tail)
//   - skid contacts, blade/tail/nose strikes and hard landings end the flight
// See docs/physics.md for the equations and the reasoning behind each term.

import { v3, add, sub, scale, dot, cross, len, norm, clamp, DEG, quat, qmul, qaxis, rot, irot, qintegrate, heading, rng } from "./math.js";

export const G = 9.81;
export const RHO = 1.225;
const RPM = (2 * Math.PI) / 60;

export class Heli {
  constructor(def) {
    this.setModel(def);
    this.noise = rng(7);
    this.reset();
  }

  setModel(def) {
    this.def = def;
    const r = def.rotor;
    this.R = r.radius;
    this.A = Math.PI * r.radius * r.radius;
    this.sigma = (r.blades * r.chord) / (Math.PI * r.radius);
    this.sa2 = (this.sigma * r.liftSlope) / 2 * r.tipLoss * r.tipLoss;
    this.omegaNom = def.headspeed.idle * RPM;
    this.vh = Math.sqrt((def.mass * G) / (2 * RHO * this.A));  // hover induced velocity
    this.qRef = def.motor.maxPower / this.omegaNom;
    this.hub = v3(0, r.hubHeight, 0);
    const gm = def.geometry, L = def.tail.arm;
    this.contacts = [];
    for (const x of gm.skidX) for (const z of [-gm.skidZ, gm.skidZ]) this.contacts.push({ p: v3(x, gm.skidY, z), kind: "skid" });
    this.contacts.push({ p: v3(gm.noseX, gm.noseY, 0), kind: "body" });
    this.contacts.push({ p: v3(-L, gm.finY, 0), kind: "body" });
    this.contacts.push({ p: v3(-L, gm.tailY - def.tail.radius, 0), kind: "tail" });
    this.contacts.push({ p: v3(-L, gm.tailY + def.tail.radius, 0), kind: "tail" });
  }

  /** Put the heli somewhere. `airborne` spawns it already in a spooled-up hover. */
  reset({ pos = v3(0, 0, -5), yaw = 90 * DEG, inverted = false, airborne = false, mode = "idle" } = {}) {
    const d = this.def;
    let q = qaxis(v3(0, 1, 0), yaw);
    if (inverted) q = qmul(q, qaxis(v3(1, 0, 0), Math.PI));
    const y = airborne ? pos.y : -d.geometry.skidY + 0.002;
    this.pos = v3(pos.x, y, pos.z);
    this.vel = v3();
    this.q = q;
    this.w = v3();
    this.mode = mode;
    const target = this.targetOmega(mode);
    this.omega = mode === "hold" ? 0 : target;
    this.govTarget = this.omega;
    this.vi = airborne ? (inverted ? -this.vh : this.vh) : 0;
    this.lamSS = this.omega > 0 ? this.vi / (this.omega * this.R) : 0;
    this.beta = { r: 0, p: 0 };
    const qHover = airborne ? this.hoverTorqueEstimate() : 0;
    this.govI = qHover;
    this.qMotor = qHover;
    this.tailT = -qHover / d.tail.arm * -d.rotor.direction;
    this.fbl = { r: 0, p: 0, y: 0 };
    this.vrs = 0; this.vrsN = v3();
    this.crashed = null;
    this.onGround = !airborne;
    for (const c of this.contacts) c.anchor = null;
    this.azimuth = 0;
    this.t = 0;
    this.thrust = 0;
    this.collPitch = 0;
    this.groundFactor = 1;
  }

  targetOmega(mode) {
    const hs = this.def.headspeed;
    return (mode === "normal" ? hs.normal : hs.idle) * RPM;
  }

  hoverTorqueEstimate() {
    const tip = this.omegaNom * this.R;
    const ct = (this.def.mass * G) / (RHO * this.A * tip * tip);
    const lam = Math.sqrt(ct / 2);
    const cd = this.def.rotor.cd0 + this.def.rotor.cd2 * Math.pow((6 * ct) / this.sigma / this.def.rotor.liftSlope, 2);
    const cq = ct * lam + (this.sigma * cd) / 8;
    return cq * RHO * this.A * tip * tip * this.R;
  }

  /** Collective blade pitch (rad) for a stick value in [-1, 1] in a flight mode. */
  pitchFor(stick, mode = this.mode) {
    const [lo, hi] = this.def.pitch[mode];
    return (lo + (hi - lo) * (stick + 1) / 2) * DEG;
  }

  stickForPitch(theta, mode = this.mode) {
    const [lo, hi] = this.def.pitch[mode];
    return clamp(((theta / DEG - lo) / (hi - lo)) * 2 - 1, -1, 1);
  }

  /** Blade pitch that would give thrust T (N, signed along the mast) in the current flow. */
  pitchForThrust(T) {
    const tip = Math.max(this.omega * this.R, 1);
    const ct = T / (RHO * this.A * tip * tip * this.groundFactor);
    const mu = this._mu || 0, lam = this._lam || 0;
    return (ct / this.sa2 + lam / 2) / (1 / 3 + (mu * mu) / 2);
  }

  get rpm() { return this.omega / RPM; }
  get up() { return rot(this.q, v3(0, 1, 0)); }
  get inverted() { return this.up.y < 0; }
  get heading() { return heading(this.q); }
  /** Height of the CG above the ground. */
  get height() { return this.pos.y; }

  /**
   * Advance by dt seconds.
   * ctl: { roll, pitch, yaw, coll } in [-1, 1] after expo (roll +right, pitch +forward/nose down,
   *       yaw +nose right, coll +up), mode: "normal" | "idle" | "hold".
   * env: { wind: v3 (m/s, world), rho }
   */
  step(ctl, env, dt) {
    if (this.crashed) return;
    const d = this.def, rd = d.rotor;
    const rho = env.rho || RHO;
    this.t += dt;
    if (ctl.mode && ctl.mode !== this.mode) this.mode = ctl.mode;

    // ---- headspeed: governor and motor ----
    const hold = this.mode === "hold";
    const omegaT = hold ? 0 : this.targetOmega(this.mode);
    const spool = d.motor.spool * RPM * dt;
    if (!hold) {
      if (this.govTarget < this.omega - 5 * spool && this.govTarget < omegaT) this.govTarget = this.omega; // re-engage from hold: bail-out
      this.govTarget += clamp(omegaT - this.govTarget, -spool * 2, spool);
    } else this.govTarget = this.omega;
    const qMax = d.motor.maxPower / Math.max(this.omega, 0.3 * this.omegaNom);
    if (hold) { this.qMotor = 0; this.govI = 0; }
    else {
      const kp = this.qRef / (0.04 * this.omegaNom), ki = kp * 10;
      const err = this.govTarget - this.omega;
      this.govI = clamp(this.govI + ki * err * dt, 0, qMax);
      this.qMotor = clamp(this.govI + kp * err, 0, qMax);
    }

    const omega = Math.max(this.omega, 1e-3);
    const tip = omega * this.R;
    const spin = clamp(omega / this.omegaNom, 0, 1.3);

    // ---- relative air ----
    const wind = env.wind || v3();
    const vbCG = irot(this.q, sub(this.vel, wind));
    const vbHub = add(vbCG, cross(this.w, this.hub));

    // ---- flybarless controller ----
    const ff = rd.flapTau / Math.max(spin, 0.3);
    const rateR = ctl.roll * d.rates.roll * DEG;
    const rateP = -ctl.pitch * d.rates.pitch * DEG;   // about +z (nose up positive)
    const rateY = -ctl.yaw * d.rates.yaw * DEG;       // about +y (nose left positive)
    const maxCyc = d.maxCyclic * DEG;
    const kpC = ff * 0.6, kiC = ff * 6;
    const eR = rateR - this.w.x, eP = rateP - this.w.z;
    const iLim = maxCyc / Math.max(kiC, 1e-6);
    const settle = this.onGround ? Math.exp(-dt * 8) : 1;  // FBL units bleed I-term when sitting on the ground
    // integrate only while the output isn't pinned in the error's direction (anti-windup)
    const integ = (acc, e, out, lo, hi, lim) => clamp(((out >= hi && e > 0) || (out <= lo && e < 0) ? acc : acc + e * dt) * settle, -lim, lim);
    const rawR = ff * rateR + kpC * eR + kiC * this.fbl.r;
    const rawP = ff * rateP + kpC * eP + kiC * this.fbl.p;
    this.fbl.r = integ(this.fbl.r, eR, rawR, -maxCyc, maxCyc, iLim);
    this.fbl.p = integ(this.fbl.p, eP, rawP, -maxCyc, maxCyc, iLim);
    const swR = clamp(rawR, -maxCyc, maxCyc);
    const swP = -clamp(rawP, -maxCyc, maxCyc);

    const L = d.tail.arm;
    const tailGain = d.tail.driven === "motor" ? 1 : spin * spin;
    const kpY = (d.inertia.yaw * (d.tail.bw ?? 30)) / L, kiY = kpY * (d.tail.ki ?? 4);
    const eY = rateY - this.w.y;
    const yLim = (d.tail.thrust[1] - d.tail.thrust[0]) / kiY;
    const torqueBody = -rd.direction * this.qMotor;     // reaction torque about +y
    const tailFF = -torqueBody / L + d.tail.damping * L * rateY;
    const [tMin, tMax] = d.tail.thrust;
    const tg = Math.max(tailGain, 0.15);
    this.fbl.y = integ(this.fbl.y, eY, (tailFF + kpY * eY + kiY * this.fbl.y) / tg, tMin, tMax, yLim);
    const tailCmd = (tailFF + kpY * eY + kiY * this.fbl.y) / tg;
    this.tailT += (clamp(tailCmd, tMin, tMax) - this.tailT) * Math.min(1, dt / d.tail.tau);

    // ---- main rotor ----
    const theta = this.pitchFor(ctl.coll);
    this.collPitch = theta;
    const nB = norm(v3(Math.tan(this.beta.p), 1, Math.tan(this.beta.r)));
    const vn = dot(vbHub, nB);
    const vtVec = sub(vbHub, scale(nB, vn));
    const vt = len(vtVec);
    const mu = vt / tip, lc = vn / tip;
    const sa2 = this.sa2;
    const ctBem = (li) => sa2 * (theta * (1 / 3 + (mu * mu) / 2) - (li + lc) / 2);
    // steady inflow: blade-element thrust = momentum thrust (Glauert), Newton from last solution
    let x = clamp(this.lamSS, -0.3, 0.3);
    for (let i = 0; i < 6; i++) {
      const s = Math.sqrt(mu * mu + (x + lc) * (x + lc)) + 1e-6;
      const f = ctBem(x) - 2 * x * s;
      const fp = -sa2 / 2 - 2 * s - (2 * x * (x + lc)) / s;
      x = clamp(x - f / fp, -0.3, 0.3);
    }
    this.lamSS = x;
    const viSS = x * tip;
    this.vi += (viSS - this.vi) * Math.min(1, dt / rd.inflowTau);
    const li = this.vi / tip;
    let ct = ctBem(li);
    this._mu = mu; this._lam = li + lc;

    // ground effect (Cheeseman-Bennett), fading with airspeed and disc bank
    const hubW = add(this.pos, rot(this.q, this.hub));
    const nW = rot(this.q, nB);
    let kge = 1;
    if (hubW.y > 0) {
      const z = Math.max(hubW.y, 0.45 * this.R);
      const r4 = this.R / (4 * z);
      const fade = (Math.abs(nW.y) ** 2) / (1 + (vt / (1.5 * this.vh)) ** 2);
      kge = 1 / (1 - r4 * r4 * fade);
    }
    this.groundFactor = kge;

    // vortex ring state: descending into your own downwash at low airspeed
    const desc = -vn * Math.sign(this.vi || 1) / this.vh;
    const vrsTarget = desc > 0.3 && desc < 1.8 && vt < 0.9 * this.vh ? Math.sin(((desc - 0.3) / 1.5) * Math.PI) * (1 - vt / (0.9 * this.vh)) : 0;
    this.vrs += (vrsTarget - this.vrs) * Math.min(1, dt * 3);
    if (this.vrs > 0.01) {
      const n = this.noise;
      this.vrsN = v3(this.vrsN.x * 0.995 + (n() - 0.5) * 0.1, this.vrsN.y * 0.995 + (n() - 0.5) * 0.1, this.vrsN.z * 0.995 + (n() - 0.5) * 0.1);
    }

    const qDyn = rho * this.A * tip * tip;
    let T = ct * qDyn * kge;
    T *= 1 - 0.35 * this.vrs * (0.6 + this.vrsN.y);
    this.thrust = T;

    // rotor drag torque: induced + climb + profile
    const alphaM = (6 * ct) / this.sigma / rd.liftSlope;
    const cd = rd.cd0 + rd.cd2 * alphaM * alphaM;
    const cq = ct * (li + lc) + ((this.sigma * cd) / 8) * (1 + 4.6 * mu * mu);
    const qAero = cq * qDyn * this.R;
    const hForce = ((this.sigma * cd) / 4) * mu * qDyn;

    // disc flapping: follow swash + blowback, lag the shaft
    const tauF = rd.flapTau / Math.max(spin, 0.15);
    const bbGain = 2 * ((4 / 3) * theta - (li + lc)) / Math.max(1 - (mu * mu) / 2, 0.5) * 0.8;
    const bbP = -(vtVec.x / tip) * bbGain;
    const bbR = -(vtVec.z / tip) * bbGain;
    const maxTilt = rd.maxTilt * DEG;
    this.beta.r = clamp(this.beta.r + ((swR + bbR - this.beta.r) / tauF - this.w.x) * dt, -maxTilt, maxTilt);
    this.beta.p = clamp(this.beta.p + ((swP + bbP - this.beta.p) / tauF + this.w.z) * dt, -maxTilt, maxTilt);

    // ---- forces (body frame) and moments about CG ----
    let F = scale(nB, T);
    if (vt > 1e-4) F = add(F, scale(vtVec, -hForce / vt));
    let M = cross(this.hub, F);
    const kHub = rd.hubStiffness * spin * spin;
    M = add(M, v3(kHub * this.beta.r, 0, -kHub * this.beta.p));
    if (this.vrs > 0.01) M = add(M, scale(v3(this.vrsN.x, 0, this.vrsN.z), this.vrs * kHub * 0.04));
    M.y += torqueBody;

    const tailP = v3(-L, d.geometry.tailY, 0);
    const vTail = vbCG.z + L * this.w.y;
    const fTail = v3(0, 0, this.tailT * tailGain - d.tail.damping * vTail);
    F = add(F, fTail);
    M = add(M, cross(tailP, fTail));

    const dr = d.drag;
    F = add(F, v3(
      -0.5 * rho * dr.x * vbCG.x * Math.abs(vbCG.x),
      -0.5 * rho * dr.y * vbCG.y * Math.abs(vbCG.y),
      -0.5 * rho * dr.z * vbCG.z * Math.abs(vbCG.z),
    ));

    // world-frame totals
    let Fw = rot(this.q, F);
    Fw.y -= d.mass * G;

    // ---- ground ----
    this.onGround = false;
    const k = 4000 * d.mass, c = 60 * d.mass;
    const contacts = [...this.contacts];
    // blade tips on the disc plane
    const e1 = norm(cross(nB, v3(0, 0, 1))), e2 = norm(cross(e1, nB));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI;
      contacts.push({ p: add(this.hub, add(scale(e1, this.R * Math.cos(a)), scale(e2, this.R * Math.sin(a)))), kind: "rotor" });
    }
    const kt = k * 0.5, ctD = 2 * Math.sqrt(kt * d.mass / 4), muG = 0.6;
    for (let i = 0; i < contacts.length; i++) {
      const ct_ = contacts[i];
      const rW = rot(this.q, ct_.p);
      const pW = add(this.pos, rW);
      if (pW.y >= 0) { if (i < this.contacts.length) this.contacts[i].anchor = null; continue; }
      const vP = add(this.vel, rot(this.q, cross(this.w, ct_.p)));
      const impact = -vP.y;
      if (ct_.kind === "rotor" && spin > 0.3) return this.crash("Blade strike");
      if (ct_.kind === "tail" && (d.tail.driven === "motor" || spin > 0.3)) return this.crash("Tail rotor strike");
      if (ct_.kind === "body" && impact > 1.5) return this.crash("Hit the ground");
      if (ct_.kind === "skid" && impact > 3.0) return this.crash("Hard landing");
      if (ct_.kind === "skid") this.onGround = true;
      const fn = Math.max(0, k * -pW.y - c * vP.y);
      // stick-slip friction: a tangential spring to where the contact first touched,
      // sliding (anchor drags along) once it would exceed mu * normal force
      if (!ct_.anchor) ct_.anchor = { x: pW.x, z: pW.z };
      let ftx = -kt * (pW.x - ct_.anchor.x) - ctD * vP.x;
      let ftz = -kt * (pW.z - ct_.anchor.z) - ctD * vP.z;
      const ft = Math.hypot(ftx, ftz), lim = muG * fn;
      if (ft > lim) {
        const s_ = lim / ft;
        ftx *= s_; ftz *= s_;
        ct_.anchor = { x: pW.x + (ftx + ctD * vP.x) / kt, z: pW.z + (ftz + ctD * vP.z) / kt };
      }
      const fc = v3(ftx, fn, ftz);
      Fw = add(Fw, fc);
      M = add(M, cross(ct_.p, irot(this.q, fc)));
    }

    // ---- integrate ----
    this.vel = add(this.vel, scale(Fw, dt / d.mass));
    this.pos = add(this.pos, scale(this.vel, dt));
    const I = d.inertia;
    const Iw = v3(I.roll * this.w.x, I.yaw * this.w.y, I.pitch * this.w.z);
    const gyro = cross(this.w, Iw);
    this.w = v3(
      this.w.x + ((M.x - gyro.x) / I.roll) * dt,
      this.w.y + ((M.y - gyro.y) / I.yaw) * dt,
      this.w.z + ((M.z - gyro.z) / I.pitch) * dt,
    );
    this.q = qintegrate(this.q, this.w, dt);

    const friction = rd.inertia * 0.05 * this.omega;
    this.omega = Math.max(0, this.omega + ((this.qMotor - qAero - friction) / rd.inertia) * dt);
    this.azimuth = (this.azimuth + this.omega * dt) % (2 * Math.PI);
    if (len(this.pos) > 2000) this.crash("Flew away");
  }

  crash(reason) {
    this.crashed = reason;
  }
}

export function makeHeli(def) { return new Heli(def); }
