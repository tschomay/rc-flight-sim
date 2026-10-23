// DOM overlay: HUD, top buttons, flight-mode buttons, the settings sheet, and the
// transmitter setup wizard. Plain DOM, no framework; the sheet is rebuilt on open.

import { MODELS } from "../sim/models.js";
import { COMPASS, lessonProgress } from "../sim/exercises.js";
import { ORIENTATIONS } from "../sim/trainer.js";
import { schoolTab, sessionEndCard, schoolChip } from "./school.js";
import { FUNCTIONS, SWITCHES, snapshot, firstGamepad, channelFromCaptures, readMapped } from "../input/gamepad.js";

export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

let uid = 0;

export function seg(label, options, value, set) {
  const name = `seg${uid++}`;
  return h("fieldset", { class: "field seg" }, h("legend", {}, label),
    h("div", { class: "seg-row" }, options.map(([v, text]) => {
      const id = `${name}-${v}`;
      return [h("input", { type: "radio", name, id, value: v, checked: value === v, onchange: () => set(v) }), h("label", { for: id }, text)];
    })));
}

export function toggle(label, value, set, hint) {
  const id = `t${uid++}`;
  return h("div", { class: "field toggle" },
    h("input", { type: "checkbox", id, checked: !!value, onchange: (e) => set(e.target.checked) }),
    h("label", { for: id }, label, hint ? h("small", {}, hint) : null));
}

export function slider(label, min, max, step, value, set, fmt = (v) => v) {
  const id = `s${uid++}`;
  const out = h("output", { for: id }, fmt(value));
  return h("div", { class: "field slider" },
    h("label", { for: id }, label, out),
    h("input", { type: "range", id, min, max, step, value, oninput: (e) => { const v = +e.target.value; out.textContent = fmt(v); set(v); } }));
}

const fmt1 = (u) => (v) => `${(+v).toFixed(1)} ${u}`;

export class UI {
  constructor(app) {
    this.app = app;
    this.el = {
      hud: document.getElementById("hud"),
      toast: document.getElementById("toast"),
      modes: document.getElementById("modes"),
      sheet: document.getElementById("sheet"),
      wizard: document.getElementById("wizard"),
      vrExit: document.getElementById("vr-exit"),
    };
    document.getElementById("btn-menu").addEventListener("click", () => this.openSheet());
    document.getElementById("btn-reset").addEventListener("click", () => app.restart());
    document.getElementById("btn-vr").addEventListener("click", () => app.enterVR());
    const full = document.getElementById("btn-full");
    const root = document.documentElement;
    if (!root.requestFullscreen && !root.webkitRequestFullscreen) full.hidden = true;  // iPhone Safari: add to home screen instead
    full.addEventListener("click", () => app.toggleFullscreen());
    document.addEventListener("fullscreenchange", () => { full.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; });
    this.el.vrExit.addEventListener("click", () => app.exitVR());
    this.buildModes();
    this.tab = "train";
    this.hudLast = 0;
  }

  setStereoButton(on) { document.getElementById("btn-vr").textContent = on ? "Exit 3D" : "3D"; }

  buildModes() {
    const m = this.el.modes;
    m.innerHTML = "";
    for (const [v, text] of [["normal", "Normal"], ["idle", "Idle up"], ["hold", "Hold"]]) {
      m.append(h("button", { type: "button", "data-mode": v, onclick: () => this.app.setMode(v) }, text));
    }
  }

  setModeButtons(mode, switchesMapped) {
    this.el.modes.hidden = switchesMapped;
    for (const b of this.el.modes.querySelectorAll("button")) b.classList.toggle("on", b.dataset.mode === mode);
  }

  toast(text, ms = 1600) {
    const t = this.el.toast;
    t.textContent = text; t.hidden = false;
    clearTimeout(this.toastT);
    if (ms) this.toastT = setTimeout(() => (t.hidden = true), ms);
  }

  hideToast() { this.el.toast.hidden = true; }

  updateHud(now, heli, trainer, mode, source) {
    if (now - this.hudLast < 100) return;
    this.hudLast = now;
    const tr = trainer.cfg.kind === "hover";
    const pct = trainer.timeTotal > 0 ? Math.round((100 * trainer.timeIn) / trainer.timeTotal) : 0;
    const label = { normal: "NORMAL", idle: "IDLE UP", hold: "HOLD" }[mode];
    const rows = [
      h("span", { class: `chip mode-${mode}` }, label),
      h("span", { class: "chip" }, `${Math.round(heli.rpm)} rpm`),
      h("span", { class: "chip" }, `${heli.height.toFixed(1)} m`),
      heli.inverted ? h("span", { class: "chip inv" }, "INVERTED") : null,
      this.app.settings.timeScale < 100 ? h("span", { class: "chip slow" }, `${this.app.settings.timeScale}% speed`) : null,
      schoolChip(this.app),
      h("span", { class: "chip dim" }, source),
    ];
    const score = tr ? h("div", { class: `score ${trainer.zone}` },
      h("b", {}, { in: "In circle", edge: "Near the edge", out: "Outside" }[trainer.zone]),
      ` ${trainer.streak.toFixed(1)} s · best ${trainer.best.toFixed(1)} s · ${pct}% of ${Math.round(trainer.timeTotal)} s`) : null;
    let ex = null;
    if (trainer.cfg.pattern?.kind !== "none" || (tr && trainer.cfg.compass)) {
      const sc = trainer.exercise;
      const lesson = this.app.session?.plan.lesson;
      const prog = lesson ? lessonProgress(lesson, sc.tally()) : null;
      const next = sc.nextPoint;
      const text = prog?.text || sc.summary() || (trainer.cfg.compass ? "Stop for 1 s at each compass point" : "Fly the outline: laps count automatically");
      ex = h("div", { class: `score ex ${prog?.passed ? "in" : ""}` }, text, trainer.cfg.compass && next != null ? h("b", {}, ` \u2192 ${COMPASS[next]}`) : null);
    }
    this.el.hud.replaceChildren(...[h("div", { class: "chips" }, rows), score, ex].filter(Boolean));
  }

  // ---------- settings sheet ----------
  openSheet(tab = this.tab) {
    this.tab = tab;
    const s = this.app.settings;
    const sheet = this.el.sheet;
    const tabs = [["train", "Training"], ["school", "Flight school"], ["heli", "Helicopter"], ["tx", "Transmitter"], ["view", "View & wind"]];
    const body = h("div", { class: "sheet-body" }, this[`tab_${tab}`](s));
    sheet.replaceChildren(
      h("div", { class: "sheet-head" },
        h("nav", { class: "tabs" }, tabs.map(([k, t]) => h("button", { type: "button", class: k === tab ? "on" : "", onclick: () => this.openSheet(k) }, t))),
        h("button", { type: "button", class: "close", "aria-label": "Close settings", onclick: () => this.closeSheet() }, "Fly")),
      body);
    sheet.hidden = false;
    this.app.paused = true;
  }

  closeSheet() {
    this.el.sheet.hidden = true;
    this.app.paused = false;
    clearInterval(this.monitorT);
  }

  changed(what) { this.app.saveAndApply(what); }

  tab_school(s) { return schoolTab(this, s); }

  sessionEnded(entry) { sessionEndCard(this, entry); }

  tab_train(s) {
    const t = s.trainer;
    const speed = slider("Sim speed", 20, 100, 5, s.timeScale, (v) => { s.timeScale = v; this.changed("misc"); }, (v) => `${v}%`);
    const set = (k, what = "trainer") => (v) => { t[k] = v; this.changed(what); };
    const preset = (label, cfg) => h("button", { type: "button", class: "preset", onclick: () => {
      Object.assign(t, { kind: "hover", ...cfg, assist: { ...t.assist, ...(cfg.assist || {}) } });
      this.changed("trainer-restart"); this.closeSheet();
    } }, label);
    return [
      h("div", { class: "presets" },
        preset("Rotating hover", { inverted: false, rotation: "ccw", rotationSpeed: 15, assist: { collective: true, rudder: true, cyclic: false } }),
        preset("Inverted hover", { inverted: true, rotation: "off", orientation: "tail", assist: { collective: true, rudder: true, cyclic: false } }),
        preset("Inverted, rotating", { inverted: true, rotation: "ccw", rotationSpeed: 10, assist: { collective: true, rudder: true, cyclic: false } }),
        preset("Nose-in hover", { inverted: false, rotation: "off", orientation: "nose", assist: { collective: true, rudder: true, cyclic: false } }),
        preset("Free flight", { kind: "free" }),
      ),
      speed,
      h("p", { class: "hint" }, "Slows the whole sim. Keyboard: [ slower, ] faster."),
      seg("Exercise", [["hover", "Hover trainer"], ["free", "Free flight"]], t.kind, set("kind", "trainer-restart")),
      h("fieldset", { class: "field" }, h("legend", {}, "The trainer flies"),
        toggle("Collective", t.assist.collective, (v) => { t.assist.collective = v; this.changed("trainer"); }, "holds the height"),
        toggle("Rudder", t.assist.rudder, (v) => { t.assist.rudder = v; this.changed("trainer"); }, "holds or turns the heading"),
        toggle("Cyclic", t.assist.cyclic, (v) => { t.assist.cyclic = v; this.changed("trainer"); }, "holds position over the circle")),
      seg("Facing you", Object.entries(ORIENTATIONS).map(([k, o]) => [k, o.label]), t.orientation, set("orientation", "trainer-restart")),
      toggle("Inverted", t.inverted, set("inverted", "trainer-restart")),
      seg("Heading", [["off", "Hold"], ["ccw", "Rotate left"], ["cw", "Rotate right"], ["swing", "Swing ±90°"]], t.rotation, set("rotation")),
      slider("Rotation speed", 3, 90, 1, t.rotationSpeed, set("rotationSpeed"), (v) => `${v}°/s`),
      slider("Swing period", 4, 20, 1, t.swingPeriod, set("swingPeriod"), (v) => `${v} s`),
      slider("Height", 0.5, 5, 0.1, t.height, set("height"), fmt1("m")),
      seg("Circle diameter", [[1, "1 m"], [2, "2 m"], [3, "3 m"], [4, "4 m"]].map(([v, l]) => [v, l]), t.circle, (v) => { t.circle = +v; this.changed("trainer"); }),
      h("fieldset", { class: "field" }, h("legend", {}, "Ground pattern (scored automatically)"),
        seg("Outline", [["none", "None"], ["circle", "Circle"], ["eight", "Figure 8"]], t.pattern?.kind || "none", (v) => { t.pattern = { ...t.pattern, kind: v }; this.changed("trainer"); }),
        slider("Circle radius", 3, 10, 0.5, t.pattern?.radius ?? 5, (v) => { t.pattern = { ...t.pattern, radius: v }; this.changed("trainer"); }, fmt1("m")),
        slider("Pattern distance", 8, 30, 1, t.pattern?.distance ?? 16, (v) => { t.pattern = { ...t.pattern, distance: v }; this.changed("trainer"); }, fmt1("m")),
        toggle("Compass points on the hover circle", t.compass, (v) => { t.compass = v; this.changed("trainer"); }, "scores 8-point piros: stop 1 s at each point in turn")),
      seg("Counts as inside", [[0, "Any height"], [1, "±1 m"], [2, "±2 m"]], t.heightWindow ?? 0, (v) => { t.heightWindow = +v; this.changed("trainer"); }),
      toggle("Show the column above the circle", s.view.column, (v) => { s.view.column = v; this.changed("trainer"); }, "the ring on the ground always shows"),
      toggle("Leaving the circle is a crash", t.leaveIsCrash, set("leaveIsCrash"), "like HELI-X: wander out and the heli resets"),
      slider("Distance from you", 2, 12, 0.5, t.distance, set("distance", "trainer-restart"), fmt1("m")),
      slider("Trainer strength", 0, 1, 0.05, t.gain, set("gain"), (v) => (v < 0.35 ? "gentle" : v < 0.7 ? "normal" : "tight")),
      h("div", { class: "row" },
        h("button", { type: "button", class: "primary", onclick: () => { this.app.restart(); this.closeSheet(); } }, "Start exercise"),
        h("button", { type: "button", onclick: () => { this.app.trainer.resetScore(); this.app.ui.toast("Score cleared"); } }, "Clear score")),
    ];
  }

  tab_heli(s) {
    const preset = (label, rates, cyc, rud) => h("button", { type: "button", class: `preset ${s.rates === rates && s.expo.cyclic === cyc ? "on" : ""}`, onclick: () => {
      s.rates = rates; s.expo.cyclic = cyc; s.expo.rudder = rud; this.changed("model"); this.openSheet("heli");
    } }, label);
    return [
      seg("Helicopter", Object.entries(MODELS).map(([k, m]) => [k, m.name]), s.model, (v) => { s.model = v; this.changed("model"); }),
      h("p", { class: "hint" }, MODELS[s.model].blurb),
      h("fieldset", { class: "field" }, h("legend", {}, "Stick feel"),
        h("div", { class: "presets" },
          preset("Gentle: 50% rates, 45% expo", 50, 45, 40),
          preset("Sport: 75%, 30%", 75, 30, 30),
          preset("3D: 100%, 20%", 100, 20, 20))),
      slider("Rates", 30, 130, 5, s.rates, (v) => { s.rates = v; this.changed("model"); }, (v) => `${v}%`),
      seg("Idle-up collective range", [[8, "\u00b18\u00b0"], [10, "\u00b110\u00b0"], [12, "\u00b112\u00b0"]], s.idlePitch, (v) => { s.idlePitch = +v; this.changed("model"); }),
      h("p", { class: "hint" }, "Idle up feels twitchier than Normal because the same stick travel covers \u221212\u2026+12\u00b0 instead of \u22124\u2026+12\u00b0, at higher headspeed. A smaller range softens the collective; \u00b112\u00b0 is a typical 3D setup."),
      slider("Cyclic expo", 0, 80, 5, s.expo.cyclic, (v) => { s.expo.cyclic = v; this.changed("expo"); }, (v) => `${v}%`),
      slider("Rudder expo", 0, 80, 5, s.expo.rudder, (v) => { s.expo.rudder = v; this.changed("expo"); }, (v) => `${v}%`),
      seg("Blades", [["dark", "Dark"], ["white", "White"]], s.bladeColor, (v) => { s.bladeColor = v; this.changed("model"); }),
      toggle("Self-levelling (stability mode)", s.selfLevel, (v) => { s.selfLevel = v; this.changed("misc"); }, "the stick sets a tilt and letting go levels the heli, like Blade SAFE. Upright only; off for real 3D practice"),
      h("details", {}, h("summary", {}, "Feels twitchy? Every input over-corrects?"),
        h("ol", {},
          h("li", {}, "Make sure the transmitter isn't adding its own expo or dual rates on top of the sim's: in the radio, D/R 100% and expo 0 for the sim model. Two layers of curves make the centre feel odd and the ends jumpy."),
          h("li", {}, "Start with the Gentle preset. Rates are how fast the heli rolls at full stick; lower rates make small inputs smaller. Raise them as you get steadier."),
          h("li", {}, "Expo softens the centre of the stick, where all hover corrections live. 30–50% is normal for hovering."),
          h("li", {}, "Use small, brief inputs and let go: this is a flybarless heli, so it holds whatever tilt you leave it at. Correct, then centre the stick."),
          h("li", {}, "Slow the sim down (Training → Sim speed). Learning at 60–70% and working up is exactly what the flight school does."),
          h("li", {}, "Turn on self-levelling for a few sessions if you just want to get a feel for it."))),
      toggle("Reset automatically after a crash", s.autoReset, (v) => { s.autoReset = v; this.changed("misc"); }),
      h("p", { class: "hint" }, "Flight modes: Normal uses lower headspeed and −4…+12° pitch. Idle up uses full headspeed and symmetric −12…+12° for inverted. Hold cuts the motor for autorotation."),
    ];
  }

  tab_tx(s) {
    const gp = firstGamepad(s.input.map?.id);
    const status = gp ? `Connected: ${gp.id}` : "No transmitter seen. Plug in the dongle and move a stick.";
    const mon = h("div", { class: "monitor" });
    const draw = () => {
      const g = firstGamepad(s.input.map?.id);
      const r = g && readMapped(g, s.input.map);
      mon.replaceChildren(...["coll", "yaw", "pitch", "roll"].map((k) => {
        const v = r ? r[k] : 0;
        return h("div", { class: "mon-row" }, h("span", {}, { coll: "Collective", yaw: "Rudder", pitch: "Elevator", roll: "Aileron" }[k]),
          h("div", { class: "bar" }, h("i", { style: `left:${50 + v * 50}%` })), h("code", {}, r ? v.toFixed(2) : "—"));
      }), h("div", { class: "mon-row" }, h("span", {}, "Switches"), h("code", {}, r ? Object.entries(r.switches).map(([k, on]) => `${k}:${on ? "on" : "off"}`).join("  ") || "none mapped" : "—")));
    };
    clearInterval(this.monitorT);
    this.monitorT = setInterval(draw, 100);
    draw();
    return [
      h("p", { class: "status" }, status),
      h("div", { class: "row" },
        h("button", { type: "button", class: "primary", onclick: () => this.startWizard() }, s.input.map ? "Set up again" : "Set up transmitter"),
        s.input.map ? h("button", { type: "button", onclick: () => { s.input.map = null; this.changed("input"); this.openSheet("tx"); } }, "Forget mapping") : null),
      s.input.map ? mon : null,
      seg("On-screen sticks", [["auto", "Auto"], ["on", "Always"], ["off", "Never"]], s.input.touch, (v) => { s.input.touch = v; this.changed("input"); }),
      h("p", { class: "hint" }, "Auto shows the touch sticks whenever no transmitter is set up. Left stick: collective (stays put) and rudder. Right stick: elevator and aileron."),
      h("details", {}, h("summary", {}, "DX6i sim setup"),
        h("ol", {},
          h("li", {}, "Make a new model memory and set it to ACRO (airplane) type, so the radio sends raw sticks."),
          h("li", {}, "Dual rates 100%, expo 0, no mixes, all trims centred. The sim does curves, expo and flight modes."),
          h("li", {}, "Bind the radio to the WS2000 (hold the dongle's button while plugging it in, then bind as usual)."),
          h("li", {}, "Pick two switches (GEAR and FLAP/MIX) for idle-up and throttle hold in the wizard."))),
      h("details", {}, h("summary", {}, "More switches on a DX6i (only one recognised?)"),
        h("p", { class: "hint" }, "The DX6i sends six channels, so the sim can see at most two switch channels: ch 5 and ch 6. In an ACRO model:"),
        h("ol", {},
          h("li", {}, "GEAR drives ch 5. That's usually the one that works."),
          h("li", {}, "FLAP drives ch 6, but only through the FLAPS menu. If both its positions are set to 0 (common), the switch moves nothing. In FLAPS, set NORM to 0 and LAND to 100 (leave the elevator values at 0), then run the wizard again and use FLAP for throttle hold."),
          h("li", {}, "Want a third switch (e.g. reset)? Two switches can share one channel if each moves it to a different value. If your radio can mix a switch into ch 6 (a programmable mix turned on by the MIX switch), FLAP and MIX can then give ch 6 three positions. The wizard checks that each switch is distinguishable."),
          h("li", {}, "The dual-rate, trainer and throttle-cut switches don't send channels in sim mode, so they can't be used."))),
      h("details", {}, h("summary", {}, "Heli model memory vs ACRO: what's the difference?"),
        h("p", { class: "hint" }, "A heli model memory works, but the radio shapes the sticks before the sim sees them:"),
        h("ol", {},
          h("li", {}, "Flight mode (F MODE) and throttle hold don't get channels of their own. They switch the throttle and pitch curves, so the sim can't see them as switches. That is why your switches didn't show up."),
          h("li", {}, "The collective comes through the pitch curve, so its range and centre depend on the flight mode you're in. If the wizard picked the throttle channel instead, idle up turns it into a V-shaped curve."),
          h("li", {}, "The radio's dual rates and expo stack with the sim's, which can make the sticks feel twitchy or uneven."),
          h("li", {}, "If the swash type is CCPM (120°) rather than 1-servo, aileron, elevator and pitch are mixed together and the sticks won't separate cleanly."),
          h("li", {}, "The gyro gain is usually on the GEAR channel, which then can't be a switch.")),
        h("p", { class: "hint" }, "In ACRO, channels 1–4 are the raw sticks and channels 5–6 are the GEAR and FLAP/MIX switches. That gives the sim clean, linear sticks and two real switches, and the sim does the heli part (curves, idle up, hold) itself, like HELI-X. Keep your heli model for the real heli and use a separate ACRO memory for the sim.")),
      h("p", { class: "hint" }, "Keyboard (desktop): W/S collective, A/D rudder, arrow keys cyclic, 1/2/3 flight mode, R reset."),
    ];
  }

  tab_view(s) {
    const lens = s.view.lens;
    const setL = (k) => (v) => { lens[k] = v; this.changed("view"); };
    return [
      slider("Field of view", 20, 60, 1, s.view.fov, (v) => { s.view.fov = v; this.changed("view"); }, (v) => `${v}°`),
      toggle("Auto-zoom", s.view.autoZoom, (v) => { s.view.autoZoom = v; this.changed("view"); }, "narrows the view as the heli gets farther away"),
      seg("3D button", [["cardboard", "Cardboard / VR"], ["plain", "Side by side, no lenses"], ["anaglyph", "Red/cyan glasses"]], s.view.stereo, (v) => { s.view.stereo = v; this.changed("view"); }),
      h("p", { class: "hint" }, "A plain phone screen can't show 3D by itself; something has to give each eye its own picture. Cardboard does it with lenses (the image is pre-distorted to match them). Side by side drops the distortion, for a viewer without lenses or for parallel free-viewing. Red/cyan glasses (a few dollars) give 3D on the normal full screen, with the HUD and touch sticks still there."),
      seg("VR headset", [["auto", "WebXR if available"], ["cardboard", "Built-in Cardboard"]], s.view.vrMode, (v) => { s.view.vrMode = v; this.changed("view"); }),
      toggle("Head tracking in Cardboard", s.view.headTracking, (v) => { s.view.headTracking = v; this.changed("view"); }, "off: 3D stereo that keeps the heli in view for you, no head movement needed"),
      h("details", {}, h("summary", {}, "Cardboard lens"),
        slider("Distortion k1", 0, 0.6, 0.01, lens.k1, setL("k1"), (v) => (+v).toFixed(2)),
        slider("Distortion k2", 0, 0.6, 0.01, lens.k2, setL("k2"), (v) => (+v).toFixed(2)),
        slider("Image scale", 0.6, 1.2, 0.01, lens.zoom, setL("zoom"), (v) => (+v).toFixed(2)),
        slider("Field of view", 60, 100, 1, lens.fov, setL("fov"), (v) => `${v}°`),
        slider("Eye separation", 0.05, 0.075, 0.001, lens.ipd, setL("ipd"), (v) => `${(v * 1000).toFixed(0)} mm`)),
      slider("Wind", 0, 10, 0.5, s.wind.speed, (v) => { s.wind.speed = v; this.changed("wind"); }, fmt1("m/s")),
      slider("Wind from", 0, 345, 15, s.wind.from, (v) => { s.wind.from = v; this.changed("wind"); }, (v) => (["ahead", "ahead-right", "right", "behind-right", "behind", "behind-left", "left", "ahead-left"][Math.round(v / 45) % 8]) + ` (${v}°)`),
      slider("Gusts", 0, 0.8, 0.05, s.wind.gust, (v) => { s.wind.gust = v; this.changed("wind"); }, (v) => `${Math.round(v * 100)}%`),
    ];
  }

  // ---------- transmitter wizard ----------
  startWizard() {
    const steps = [];
    for (const f of FUNCTIONS) {
      steps.push({ kind: "stick", f, end: "lo", text: `Move the ${f.label.toLowerCase()} stick ${f.lo} and hold it there.` });
      steps.push({ kind: "stick", f, end: "hi", text: `Now move the ${f.label.toLowerCase()} stick ${f.hi} and hold it.` });
    }
    steps.push({ kind: "center", text: "Centre the rudder, elevator and aileron sticks and let go." });
    for (const sw of SWITCHES) {
      steps.push({ kind: "switch", sw, end: "off", text: `${sw.label}: set the switch you want to use to ${sw.off}.` });
      steps.push({ kind: "switch", sw, end: "on", text: `${sw.label}: now flip it to ${sw.on}.` });
    }
    const caps = {};
    let i = 0;
    const wiz = this.el.wizard;
    const live = h("div", { class: "live" });
    const render = () => {
      const st = steps[i];
      const optional = st.kind === "switch";
      wiz.replaceChildren(h("div", { class: "wiz-card" },
        h("p", { class: "wiz-step" }, `Step ${i + 1} of ${steps.length}`),
        h("p", { class: "wiz-text" }, st.text),
        live,
        h("div", { class: "row" },
          h("button", { type: "button", onclick: () => { wiz.hidden = true; clearInterval(t); } }, "Cancel"),
          optional ? h("button", { type: "button", onclick: () => skipSwitch(st.sw) }, "No switch for this") : null,
          h("button", { type: "button", class: "primary", onclick: next }, "Next"))));
    };
    // Which channels the sticks are on, from the captures so far.
    const stickChannels = () => {
      const used = [];
      for (const f of FUNCTIONS) {
        const ch = caps[`${f.key}-lo`] && channelFromCaptures(caps[`${f.key}-lo`], caps[`${f.key}-hi`], used);
        if (ch) used.push(ch.index);
      }
      return used;
    };
    // Two switches may share a channel (a 3-position channel, or one channel fed by two
    // switches through a radio mix) as long as each one moves it to its own value.
    const switchProblem = (c, sw) => {
      const off = c[`sw-${sw.key}-off`], on = c[`sw-${sw.key}-on`];
      const sticks = stickChannels();
      const ch = channelFromCaptures(off, on, sticks);
      if (ch) {
        const twin = SWITCHES.find((o) => {
          if (o === sw || c[`sw-${o.key}`] === "skip" || !c[`sw-${o.key}-on`]) return false;
          const oc = channelFromCaptures(c[`sw-${o.key}-off`], c[`sw-${o.key}-on`], sticks);
          return oc && oc.index === ch.index && Math.abs(oc.hi - ch.hi) < 0.25;
        });
        return twin ? `That switch moves ch ${ch.index + 1} to the same place as the ${twin.label.toLowerCase()} switch, so the sim can't tell them apart. Pick a different switch.` : null;
      }
      const any = channelFromCaptures(off, on);
      if (any && sticks.includes(any.index)) {
        const fn = FUNCTIONS[sticks.indexOf(any.index)];
        return `That switch moved the ${fn.label.toLowerCase()} channel (ch ${any.index + 1}) instead of a channel of its own. In a helicopter model memory, flight-mode and hold switches change the throttle and pitch curves rather than sending their own channel, so the sim can't see them as switches.`;
      }
      return "That switch didn't change any channel the dongle sends. On a DX6i in an ACRO model, only GEAR (ch 5) and FLAP (ch 6) send channels, and FLAP only moves ch 6 if the radio's FLAPS menu gives its positions different values.";
    };
    const showProblem = (text, sw) => {
      wiz.replaceChildren(h("div", { class: "wiz-card" },
        h("p", { class: "wiz-step" }, sw.label),
        h("p", { class: "wiz-text" }, "Switch not found"),
        h("p", {}, text),
        h("p", { class: "hint" }, "Fix: use an ACRO (airplane) model memory for the sim with the GEAR and FLAP switches (see Transmitter \u2192 \u201cMore switches\u201d). Or skip it and use the on-screen flight-mode buttons."),
        h("div", { class: "row" },
          h("button", { type: "button", onclick: () => skipSwitch(sw) }, "Skip this switch"),
          h("button", { type: "button", class: "primary", onclick: () => { i = steps.findIndex((x) => x.sw === sw); render(); } }, "Try another switch"))));
    };
    const skipSwitch = (sw) => {
      caps[`sw-${sw.key}`] = "skip";
      while (steps[i] && steps[i].sw === sw) i++;
      i < steps.length ? render() : finish();
    };
    const next = () => {
      const gp = firstGamepad();
      if (!gp) { this.toast("No transmitter seen. Move a stick first."); return; }
      const st = steps[i];
      const snap = snapshot(gp);
      caps.id = gp.id;
      if (st.kind === "stick") caps[`${st.f.key}-${st.end}`] = snap;
      if (st.kind === "center") caps.center = snap;
      if (st.kind === "switch") caps[`sw-${st.sw.key}-${st.end}`] = snap;
      if (st.kind === "switch" && st.end === "on") {
        const problem = switchProblem(caps, st.sw);
        if (problem) { showProblem(problem, st.sw); return; }
      }
      i++;
      i < steps.length ? render() : finish();
    };
    const finish = () => {
      clearInterval(t);
      const map = { id: caps.id, axes: {}, switches: {} };
      const used = [];
      for (const f of FUNCTIONS) {
        const ch = channelFromCaptures(caps[`${f.key}-lo`], caps[`${f.key}-hi`], used);
        if (!ch) { this.toast(`Couldn't find the ${f.label.toLowerCase()} channel. Try again and move the stick all the way.`, 4000); wiz.hidden = true; return; }
        used.push(ch.index);
        map.axes[f.key] = { index: ch.index, lo: ch.lo, hi: ch.hi, center: f.centering ? caps.center[ch.index] : undefined };
      }
      for (const sw of SWITCHES) {
        if (caps[`sw-${sw.key}`] === "skip") continue;
        const ch = channelFromCaptures(caps[`sw-${sw.key}-off`], caps[`sw-${sw.key}-on`], used);  // only stick channels are off limits
        if (ch) map.switches[sw.key] = { index: ch.index, off: ch.lo, on: ch.hi };
      }
      this.app.settings.input.map = map;
      this.changed("input");
      wiz.hidden = true;
      this.toast("Transmitter set up");
      this.openSheet("tx");
    };
    const t = setInterval(() => {
      const gp = firstGamepad();
      live.replaceChildren(...(gp ? snapshot(gp).slice(0, 12).map((v, k) => h("div", { class: "live-ch" }, h("span", {}, `ch ${k + 1}`), h("div", { class: "bar" }, h("i", { style: `left:${50 + Math.max(-1, Math.min(1, v)) * 50}%` })))) : [h("p", { class: "hint" }, "Waiting for the transmitter…")]));
    }, 60);
    wiz.hidden = false;
    render();
  }
}
