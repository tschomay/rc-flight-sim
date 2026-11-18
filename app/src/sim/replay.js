// Crash replay: the last few seconds of flight kept in a ring buffer, played back after a
// crash (slowed down by default) so you can see what went wrong.
//
// A frame holds what the renderer and the sound need: position, attitude, disc tilt,
// headspeed, thrust and motor torque, the flight mode and whether it had crashed.

const FIELDS = ["omega", "thrust", "qMotor", "mode", "crashed"];

export class Recorder {
  constructor(seconds = 10, maxFrames = 6000) {  // 10 s at 120 Hz and 20% sim speed
    this.seconds = seconds;
    this.buf = new Array(maxFrames);
    this.start = 0;
    this.n = 0;
  }

  clear() { this.start = 0; this.n = 0; }

  /** Record the heli at sim time t (s). Times must increase. */
  record(heli, t) {
    const f = {
      t,
      pos: { ...heli.pos },
      q: { ...heli.q },
      beta: { ...heli.beta },
    };
    for (const k of FIELDS) f[k] = heli[k];
    const cap = this.buf.length;
    if (this.n === cap) { this.start = (this.start + 1) % cap; this.n--; }
    this.buf[(this.start + this.n) % cap] = f;
    this.n++;
    // drop what's older than the window
    while (this.n > 1 && t - this.buf[this.start].t > this.seconds) { this.start = (this.start + 1) % cap; this.n--; }
  }

  /** The recorded frames, oldest first. */
  frames() {
    const out = [];
    for (let i = 0; i < this.n; i++) out.push(this.buf[(this.start + i) % this.buf.length]);
    return out;
  }
}

const lerp = (a, b, k) => a + (b - a) * k;

/** Normalised lerp between quaternions, taking the short way round. */
function nlerp(a, b, k) {
  const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const q = { x: lerp(a.x, s * b.x, k), y: lerp(a.y, s * b.y, k), z: lerp(a.z, s * b.z, k), w: lerp(a.w, s * b.w, k) };
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** Plays frames back. `speed` 0.5 is half speed; the clip holds a moment on the last frame. */
export class Player {
  constructor(frames, { speed = 0.5, hold = 1 } = {}) {
    this.frames = frames;
    this.speed = speed;
    this.hold = hold;
    this.t0 = frames.length ? frames[0].t : 0;
    this.length = frames.length ? frames[frames.length - 1].t - this.t0 : 0;
    this.time = 0;   // s of recording played
    this.i = 0;
  }

  get done() { return this.time >= this.length + this.hold * this.speed; }

  /** Advance by dt seconds of clock time; returns the interpolated frame. */
  step(dt) {
    this.time += dt * this.speed;
    return this.sample(this.time);
  }

  sample(time) {
    const fr = this.frames;
    if (!fr.length) return null;
    const t = this.t0 + Math.max(0, Math.min(this.length, time));
    if (this.i >= fr.length - 1 || fr[this.i].t > t) this.i = 0;
    while (this.i < fr.length - 2 && fr[this.i + 1].t <= t) this.i++;
    const a = fr[this.i], b = fr[Math.min(this.i + 1, fr.length - 1)];
    const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
    return {
      ...a,
      t,
      pos: { x: lerp(a.pos.x, b.pos.x, k), y: lerp(a.pos.y, b.pos.y, k), z: lerp(a.pos.z, b.pos.z, k) },
      q: nlerp(a.q, b.q, k),
      beta: { r: lerp(a.beta.r, b.beta.r, k), p: lerp(a.beta.p, b.beta.p, k) },
      omega: lerp(a.omega, b.omega, k),
      thrust: lerp(a.thrust, b.thrust, k),
      qMotor: lerp(a.qMotor, b.qMotor, k),
    };
  }
}
