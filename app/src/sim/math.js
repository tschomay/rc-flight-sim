// Small vector/quaternion helpers for the flight model. Kept free of three.js so the
// physics runs (and is tested) in plain Node. Conventions match three.js: y is up,
// quaternions are {x, y, z, w} and rotate body vectors into the world frame.

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const norm = (a) => { const l = len(a) || 1; return v3(a.x / l, a.y / l, a.z / l); };
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
export const DEG = Math.PI / 180;

export const quat = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });

export function qmul(a, b) {
  return quat(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  );
}

export function qnorm(q) {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return quat(q.x / l, q.y / l, q.z / l, q.w / l);
}

export function qaxis(axis, angle) {
  const s = Math.sin(angle / 2);
  const n = norm(axis);
  return quat(n.x * s, n.y * s, n.z * s, Math.cos(angle / 2));
}

/** Rotate body vector v into world frame by q. */
export function rot(q, v) {
  // v' = v + 2w(u×v) + 2u×(u×v)
  const u = v3(q.x, q.y, q.z);
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}

/** Rotate world vector v into body frame (inverse rotation). */
export function irot(q, v) {
  return rot(quat(-q.x, -q.y, -q.z, q.w), v);
}

/** Integrate orientation by body angular velocity w over dt. */
export function qintegrate(q, w, dt) {
  const dq = qmul(q, quat(w.x, w.y, w.z, 0));
  return qnorm(quat(q.x + 0.5 * dq.x * dt, q.y + 0.5 * dq.y * dt, q.z + 0.5 * dq.z * dt, q.w + 0.5 * dq.w * dt));
}

/** Heading (rad) of the body's nose projected on the ground. 0 = nose toward +x, +90° = nose toward -z (away from the pilot). */
export function heading(q) {
  const f = rot(q, v3(1, 0, 0));
  return Math.atan2(-f.z, f.x);
}

/** Deterministic PRNG so gusts and tests repeat. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
