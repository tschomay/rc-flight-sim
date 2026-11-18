// Live tuning of a heli's flight-model parameters (docs/physics.md, "Model parameters").
// Overrides are stored per heli as { "rotor.hubStiffness": 22, ... } and laid over the
// definition in models.js; the export gives the same values as a snippet to paste back
// into models.js once they feel right on the sticks.

/** What can be tuned, as a factor range around the models.js value. */
export const TUNABLES = [
  { path: "mass", label: "Mass", unit: "kg", range: [0.6, 1.6], hint: "heavier: more collective to hover, slower to stop" },
  { path: "rotor.hubStiffness", label: "Hub stiffness", unit: "N·m/rad", range: [0.4, 2.5], hint: "how hard the disc pulls the body: crisper cyclic" },
  { path: "rotor.flapTau", label: "Disc response time", unit: "s", range: [0.4, 2.5], hint: "longer: softer, laggier cyclic" },
  { path: "rotor.inflowTau", label: "Inflow lag", unit: "s", range: [0.3, 3], hint: "the float after a collective punch" },
  { path: "rotor.inertia", label: "Rotor inertia", unit: "kg·m²", range: [0.4, 2.5], hint: "more: headspeed sags less, longer autorotation" },
  { path: "inertia.roll", label: "Roll inertia", unit: "kg·m²", range: [0.4, 2.5] },
  { path: "inertia.pitch", label: "Pitch inertia", unit: "kg·m²", range: [0.4, 2.5] },
  { path: "inertia.yaw", label: "Yaw inertia", unit: "kg·m²", range: [0.4, 2.5] },
  { path: "tail.damping", label: "Tail damping", unit: "", range: [0.2, 4], hint: "weathervaning and how the tail settles" },
  { path: "tail.tau", label: "Tail response time", unit: "s", range: [0.4, 3] },
  { path: "motor.maxPower", label: "Motor power", unit: "W", range: [0.5, 1.6], hint: "less: bogs on a hard punch" },
  { path: "drag.x", label: "Drag forward", unit: "m²", range: [0.3, 3], hint: "top speed and how fast it coasts down" },
  { path: "drag.z", label: "Drag sideways", unit: "m²", range: [0.3, 3] },
  { path: "drag.y", label: "Drag vertical", unit: "m²", range: [0.3, 3], hint: "how fast it sinks with no collective" },
];

export const getPath = (o, path) => path.split(".").reduce((x, k) => x?.[k], o);

function setPath(o, path, v) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((x, k) => x[k], o);
  parent[last] = v;
}

/** Slider bounds for a tunable on a heli: its models.js value × the factor range. */
export function bounds(def, t) {
  const base = getPath(def, t.path);
  const [lo, hi] = t.range.map((f) => base * f);
  return { base, min: lo, max: hi, step: niceStep((hi - lo) / 100) };
}

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x);
}

/**
 * The definition with overrides applied (a copy). Only known paths, finite numbers and
 * values within the slider range are used: a stale or hand-edited backup can't break
 * the flight model.
 */
export function applyTuning(def, overrides = {}) {
  const out = structuredClone(def);
  for (const t of TUNABLES) {
    const v = overrides?.[t.path];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const { min, max } = bounds(def, t);
    setPath(out, t.path, Math.min(max, Math.max(min, v)));
  }
  return out;
}

const fmt = (v) => +v.toPrecision(4);

/** A models.js-ready snippet of the changed values, grouped like the definition. */
export function exportTuning(id, def, overrides = {}) {
  const tuned = applyTuning(def, overrides);
  const lines = [];
  for (const t of TUNABLES) {
    const was = getPath(def, t.path), now = getPath(tuned, t.path);
    if (fmt(was) !== fmt(now)) lines.push(`  ${t.path}: ${fmt(now)},  // was ${fmt(was)}`);
  }
  if (!lines.length) return `// ${id}: no changes from models.js`;
  return `// ${id} (${def.name}): tuned values for src/sim/models.js\n${lines.join("\n")}`;
}
