// Settings with defaults, saved in this browser. Storage can be unavailable (private
// windows, embedded previews), so every access is guarded and defaults always work.

import { DEFAULT_TRAINER } from "../sim/trainer.js";
import { DEFAULT_MODEL } from "../sim/models.js";

const KEY = "rc-heli-sim.settings.v1";

export const DEFAULTS = {
  model: DEFAULT_MODEL,
  trainer: DEFAULT_TRAINER,
  expo: { cyclic: 30, rudder: 30 },   // %
  rates: 100,                         // % of the model's rates
  mode: "idle",                       // flight mode when no transmitter switch is mapped
  input: { touch: "auto", map: null },
  view: { fov: 34, autoZoom: true, vrMode: "auto", lens: { k1: 0.28, k2: 0.12, zoom: 0.85, ipd: 0.064, fov: 80 } },
  wind: { speed: 0, from: 0, gust: 0.3 },
  autoReset: true,
};

function merge(base, over) {
  if (over == null || typeof base !== "object" || Array.isArray(base) || base === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = k in base ? merge(base[k], over[k]) : over[k];
  return out;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return merge(structuredClone(DEFAULTS), raw ? JSON.parse(raw) : {});
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: keep in memory */ }
}
