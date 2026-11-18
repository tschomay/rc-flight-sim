// Flight school progress: two small bar charts of the last sessions, oldest to newest:
// crashes per session and % of the time inside the hover circle. Two charts rather than
// one with two axes, since the measures don't share a scale. Each bar has a hover
// tooltip; the log below the charts is the table view.

import { progressSeries } from "../school/school.js";
import { h } from "./dom.js";

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of kids) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

const W = 420, H = 96, PAD = { l: 28, r: 6, t: 8, b: 16 };

/** A rounded-top bar from the baseline (4px data end, square at the axis). */
function barPath(x, y0, w, hgt) {
  const r = Math.min(4, w / 2, hgt);
  const y = y0 - hgt;
  return `M${x},${y0}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y0}Z`;
}

function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

/** One single-series bar chart; points without a value leave a gap. */
function barChart(points, { title, value, max, fmt, tip }) {
  const n = Math.max(points.length, 8);
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const slot = plotW / n, gap = Math.max(2, slot * 0.25), bw = slot - gap;
  const y0 = PAD.t + plotH;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "spark", role: "img", "aria-label": title });
  for (const f of [0, 0.5, 1]) {
    const y = y0 - f * plotH;
    svg.append(s("line", { x1: PAD.l, x2: W - PAD.r, y1: y, y2: y, class: f ? "grid" : "axis" }));
    svg.append(s("text", { x: PAD.l - 4, y: y + 3.5, "text-anchor": "end", class: "tick" }, fmt(max * f)));
  }
  points.forEach((p, i) => {
    const v = value(p);
    const x = PAD.l + i * slot + gap / 2;
    // hit target: the whole column, wider and taller than the bar
    const g = s("g", { class: "col" }, s("title", {}, tip(p)), s("rect", { x: PAD.l + i * slot, y: PAD.t, width: slot, height: plotH, class: "hit" }));
    if (v != null) g.append(v > 0 ? s("path", { d: barPath(x, y0, bw, Math.max(1.5, (Math.min(v, max) / max) * plotH)), class: "vbar" }) : s("rect", { x, y: y0 - 1.5, width: bw, height: 1.5, class: "vbar zero" }));
    svg.append(g);
  });
  // where the lesson changes: the new lesson's number under its first session
  points.forEach((p, i) => {
    if (i > 0 && p.lesson === points[i - 1].lesson) return;
    svg.append(s("text", { x: PAD.l + i * slot + gap / 2, y: H - 3, class: "tick" }, `L${p.lesson}`));
  });
  return h("figure", { class: "chart" }, h("figcaption", {}, title), svg);
}

const day = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The progress section of the Flight school tab, or null before the first session. */
export function progressCharts(log) {
  const pts = progressSeries(log, 30);
  if (!pts.length) return null;
  const tip = (extra) => (p) => `Lesson ${p.lesson}, ${day(p.date)}, ${p.minutes} min: ${extra(p)}`;
  const crashMax = niceMax(Math.max(...pts.map((p) => p.crashes)));
  const charts = [
    barChart(pts, {
      title: "Crashes per session", value: (p) => p.crashes, max: crashMax,
      fmt: (v) => String(Math.round(v)), tip: tip((p) => `${p.crashes} crash${p.crashes === 1 ? "" : "es"}`),
    }),
  ];
  if (pts.some((p) => p.inCircle != null)) {
    charts.push(barChart(pts, {
      title: "Time inside the circle (hover sessions)", value: (p) => p.inCircle, max: 100,
      fmt: (v) => `${Math.round(v)}%`, tip: tip((p) => (p.inCircle == null ? "not recorded" : `${p.inCircle}% inside`)),
    }));
  }
  return h("div", { class: "progress" },
    h("h2", {}, "Progress"),
    h("p", { class: "hint" }, `Last ${pts.length} session${pts.length === 1 ? "" : "s"}, oldest on the left. L marks where each lesson starts. Hover or tap a bar for details; the log below has every number.`),
    charts);
}
