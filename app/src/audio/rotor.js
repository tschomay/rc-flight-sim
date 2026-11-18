// Rotor and motor sound, synthesised with Web Audio (no samples, nothing to download).
//
// What a pilot listens for, and what drives it here:
//   - blade "whop" at the blade-passing frequency (headspeed × blades): pitch follows
//     headspeed, so a bog or a spool-down is heard before it's seen
//   - its brightness and loudness follow rotor load (thrust): a punch or a hard stop
//     sounds harder, autorotation goes soft
//   - motor whine at motor rpm (headspeed × gear ratio), louder with motor torque, silent
//     in throttle hold
//   - wash noise from the rotor, with the same load
// Level falls off with distance from the pilot and pans left/right with the heli.
//
// soundParams() is the pure part (tested in node); RotorSound owns the audio graph.

import { G } from "../sim/heli.js";

const RPM = (2 * Math.PI) / 60;
const EAR = { x: 0, y: 1.6, z: 0 };  // the pilot stands at the origin

export function soundParams(heli) {
  const d = heli.def;
  const nom = d.headspeed.idle * RPM;
  const spin = Math.max(0, heli.omega / nom);              // 1 at idle-up headspeed
  const blades = d.rotor.blades || 2;
  const gear = d.motor.gear || 10;
  const weight = d.mass * G;
  const load = Math.min(2.5, Math.abs(heli.thrust || 0) / weight);  // 1 in a hover
  const qRef = d.motor.maxPower / nom;
  const motorLoad = Math.min(1.5, Math.max(0, (heli.qMotor || 0) / qRef));
  const dx = heli.pos.x - EAR.x, dy = heli.pos.y - EAR.y, dz = heli.pos.z - EAR.z;
  const dist = Math.hypot(dx, dy, dz);
  // scale distance by rotor size: a 600 at 10 m sounds like a 450 at about 5 m
  const near = 1 / (1 + dist / (d.rotor.radius * 14));
  const level = Math.min(1, spin * spin) * near;
  return {
    bladeHz: (heli.omega / (2 * Math.PI)) * blades,
    motorHz: (heli.omega / (2 * Math.PI)) * gear,
    cutoff: 180 + 260 * spin + 900 * Math.min(1.5, load),  // Hz: brighter under load
    blade: level * (0.35 + 0.45 * Math.min(1.5, load)),
    motor: heli.mode === "hold" ? 0 : level * 0.12 * (0.3 + motorLoad),
    wash: level * 0.25 * (0.4 + Math.min(1.5, load)),
    pan: Math.max(-1, Math.min(1, dx / Math.max(2, Math.hypot(dx, dz)))),
  };
}

export class RotorSound {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.enabled = true;
    // browsers only start audio from a tap or key press; iOS wants the end of the tap
    const unlock = () => { if (this.enabled && !document.hidden) this.start(); };
    for (const ev of ["pointerdown", "pointerup", "touchend", "click", "keydown"]) addEventListener(ev, unlock, { capture: true });
    // no rotor drone from a backgrounded app or a locked phone
    const vis = () => {
      if (!this.ctx) return;
      if (document.hidden || !this.enabled) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    };
    document.addEventListener("visibilitychange", vis);
    addEventListener("pagehide", () => this.ctx?.suspend().catch(() => {}));
  }

  /** True when sound is on but the browser hasn't let it start yet (needs a tap). */
  get blocked() { return this.enabled && (!this.ctx || this.ctx.state !== "running"); }

  start() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    // resume from "suspended" or iOS's "interrupted" (after a call or Siri)
    if (this.ctx) { if (this.ctx.state !== "running" && this.ctx.state !== "closed") this.ctx.resume().catch(() => {}); return; }
    const ctx = this.ctx = new AC();
    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    const pan = this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    pan.connect(master).connect(ctx.destination);

    // blade whop: a sawtooth through a low-pass, plus its octave for the slap
    this.blade = ctx.createOscillator(); this.blade.type = "sawtooth";
    this.slap = ctx.createOscillator(); this.slap.type = "triangle";
    this.bladeFilter = ctx.createBiquadFilter(); this.bladeFilter.type = "lowpass"; this.bladeFilter.Q.value = 2;
    this.bladeGain = ctx.createGain(); this.bladeGain.gain.value = 0;
    const slapGain = ctx.createGain(); slapGain.gain.value = 0.35;
    this.blade.connect(this.bladeFilter);
    this.slap.connect(slapGain).connect(this.bladeFilter);
    this.bladeFilter.connect(this.bladeGain).connect(pan);

    // motor whine: narrow band around motor rpm
    this.motor = ctx.createOscillator(); this.motor.type = "sawtooth";
    const motorBand = this.motorBand = ctx.createBiquadFilter(); motorBand.type = "bandpass"; motorBand.Q.value = 6;
    this.motorGain = ctx.createGain(); this.motorGain.gain.value = 0;
    this.motor.connect(motorBand).connect(this.motorGain).connect(pan);

    // rotor wash: looped noise through a low-pass
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
    this.washFilter = ctx.createBiquadFilter(); this.washFilter.type = "lowpass"; this.washFilter.frequency.value = 700;
    this.washGain = ctx.createGain(); this.washGain.gain.value = 0;
    this.noise.connect(this.washFilter).connect(this.washGain).connect(pan);
    this.noiseBuf = buf;

    for (const o of [this.blade, this.slap, this.motor, this.noise]) o.start();
    if (ctx.state !== "running") ctx.resume().catch(() => {});
  }

  /** Follow the heli; `speed` is the sim speed (0 when paused), which also lowers the pitch. */
  update(heli, speed = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    if (!this.enabled) { ctx.suspend().catch(() => {}); return; }  // off: stop the graph, not just mute it
    const t = ctx.currentTime, k = 0.04;
    const on = this.enabled && speed > 0;
    const p = soundParams(heli);
    const set = (param, v) => param.setTargetAtTime(v, t, k);
    // slow motion sounds slow: frequencies scale with sim speed
    const s = Math.max(0.2, speed);
    set(this.master.gain, on ? this.volume : 0);
    set(this.blade.frequency, Math.max(1, p.bladeHz * s));
    set(this.slap.frequency, Math.max(1, p.bladeHz * 2 * s));
    set(this.bladeFilter.frequency, p.cutoff * Math.sqrt(s));
    set(this.bladeGain.gain, p.blade);
    set(this.motor.frequency, Math.max(1, p.motorHz * s));
    set(this.motorBand.frequency, Math.max(20, p.motorHz * s));
    set(this.motorGain.gain, p.motor);
    set(this.washGain.gain, p.wash);
    set(this.washFilter.frequency, 400 + 600 * Math.min(1.5, p.wash * 4));
    if (this.pan.pan) set(this.pan.pan, p.pan);
  }

  /** A short thump and crunch for a crash. */
  crash() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.enabled) return;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(this.volume * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random()); src.stop(t + 0.65);
  }
}
