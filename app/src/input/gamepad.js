// Transmitter input through the Gamepad API (the WS2000 dongle shows up as a plain HID
// joystick). A mapping says which axis is which stick, its range and direction, and which
// axes or buttons act as switches. The setup wizard builds the mapping by having the
// pilot hold each stick at its two ends.

export const FUNCTIONS = [
  { key: "coll", label: "Collective", lo: "fully DOWN", hi: "fully UP", centering: false },
  { key: "yaw", label: "Rudder", lo: "fully LEFT", hi: "fully RIGHT", centering: true },
  { key: "pitch", label: "Elevator", lo: "fully BACK (toward you)", hi: "fully FORWARD", centering: true },
  { key: "roll", label: "Aileron", lo: "fully LEFT", hi: "fully RIGHT", centering: true },
];

export const SWITCHES = [
  { key: "idle", label: "Idle-up (flight mode)", off: "NORMAL", on: "IDLE UP" },
  { key: "hold", label: "Throttle hold", off: "OFF", on: "HOLD" },
  { key: "reset", label: "Reset heli (optional)", off: "OFF", on: "ON" },
];

/** Every axis then every button as one flat list of numbers. */
export function snapshot(gp) {
  return [...gp.axes, ...gp.buttons.map((b) => b.value)];
}

export function firstGamepad(preferId) {
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  return pads.find((p) => p.id === preferId) || pads.find((p) => p.axes.length >= 4) || pads[0] || null;
}

/** From two snapshots (stick at its low end, then its high end), pick the channel that moved most. */
export function channelFromCaptures(lo, hi, exclude = []) {
  let best = -1, bestD = 0;
  for (let i = 0; i < Math.min(lo.length, hi.length); i++) {
    if (exclude.includes(i)) continue;
    const d = Math.abs(hi[i] - lo[i]);
    if (d > bestD) { bestD = d; best = i; }
  }
  return bestD > 0.25 ? { index: best, lo: lo[best], hi: hi[best] } : null;
}

const clamp1 = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);

/** Read sticks and switches from a gamepad with a mapping. Returns null if unmapped. */
export function readMapped(gp, map) {
  if (!gp || !map || !map.axes) return null;
  const v = snapshot(gp);
  const out = { roll: 0, pitch: 0, yaw: 0, coll: -1, switches: {} };
  for (const f of FUNCTIONS) {
    const a = map.axes[f.key];
    if (!a || v[a.index] === undefined) { if (f.key === "coll") return null; continue; }
    const raw = v[a.index];
    if (f.centering) {
      const c = a.center ?? (a.lo + a.hi) / 2;
      // scale each side of centre separately so an off-centre trim still reaches ±1
      const towardHi = (raw - c) * (a.hi - c) >= 0;
      out[f.key] = clamp1(towardHi ? (raw - c) / (a.hi - c || 1) : -(raw - c) / (a.lo - c || 1));
      if (Math.abs(out[f.key]) < (map.deadband ?? 0.02)) out[f.key] = 0;
    } else {
      out[f.key] = clamp1(((raw - a.lo) / (a.hi - a.lo || 1)) * 2 - 1);
    }
  }
  for (const s of SWITCHES) {
    const m = map.switches?.[s.key];
    if (!m || v[m.index] === undefined) continue;
    const mid = (m.off + m.on) / 2;
    out.switches[s.key] = m.on > m.off ? v[m.index] > mid : v[m.index] < mid;
  }
  return out;
}
