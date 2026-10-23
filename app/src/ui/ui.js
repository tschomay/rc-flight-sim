// DOM overlay: HUD, top buttons, flight-mode buttons, the settings sheet, and the
// transmitter setup wizard. Plain DOM, no framework; the sheet is rebuilt on open.

import { MODELS } from "../sim/models.js";
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
    this.el.vrExit.addEventListener("click", () => app.exitVR());
    this.buildModes();
    this.tab = "train";
    this.hudLast = 0;
  }

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
    const score = tr ? h("div", { class: `score ${trainer.inside ? "in" : ""}` },
      h("b", {}, trainer.inside ? "In circle" : "Outside"),
      ` ${trainer.streak.toFixed(1)} s · best ${trainer.best.toFixed(1)} s · ${pct}% of ${Math.round(trainer.timeTotal)} s`) : null;
    this.el.hud.replaceChildren(h("div", { class: "chips" }, rows), score);
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
      seg("Counts as inside", [[0, "Any height"], [1, "±1 m"], [2, "±2 m"]], t.heightWindow ?? 0, (v) => { t.heightWindow = +v; this.changed("trainer"); }),
      toggle("Leaving the circle is a crash", t.leaveIsCrash, set("leaveIsCrash"), "like HELI-X: wander out and the heli resets"),
      slider("Distance from you", 2, 12, 0.5, t.distance, set("distance", "trainer-restart"), fmt1("m")),
      slider("Trainer strength", 0, 1, 0.05, t.gain, set("gain"), (v) => (v < 0.35 ? "gentle" : v < 0.7 ? "normal" : "tight")),
      h("div", { class: "row" },
        h("button", { type: "button", class: "primary", onclick: () => { this.app.restart(); this.closeSheet(); } }, "Start exercise"),
        h("button", { type: "button", onclick: () => { this.app.trainer.resetScore(); this.app.ui.toast("Score cleared"); } }, "Clear score")),
    ];
  }

  tab_heli(s) {
    return [
      seg("Helicopter", Object.entries(MODELS).map(([k, m]) => [k, m.name]), s.model, (v) => { s.model = v; this.changed("model"); }),
      h("p", { class: "hint" }, MODELS[s.model].blurb),
      slider("Rates", 40, 130, 5, s.rates, (v) => { s.rates = v; this.changed("model"); }, (v) => `${v}%`),
      slider("Cyclic expo", 0, 80, 5, s.expo.cyclic, (v) => { s.expo.cyclic = v; this.changed("expo"); }, (v) => `${v}%`),
      slider("Rudder expo", 0, 80, 5, s.expo.rudder, (v) => { s.expo.rudder = v; this.changed("expo"); }, (v) => `${v}%`),
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
          h("li", {}, "Pick two switches (for example GEAR and FLAP/MIX) for idle-up and throttle hold in the wizard."))),
      h("p", { class: "hint" }, "Keyboard (desktop): W/S collective, A/D rudder, arrow keys cyclic, 1/2/3 flight mode, R reset."),
    ];
  }

  tab_view(s) {
    const lens = s.view.lens;
    const setL = (k) => (v) => { lens[k] = v; this.changed("view"); };
    return [
      slider("Field of view", 20, 60, 1, s.view.fov, (v) => { s.view.fov = v; this.changed("view"); }, (v) => `${v}°`),
      toggle("Auto-zoom", s.view.autoZoom, (v) => { s.view.autoZoom = v; this.changed("view"); }, "narrows the view as the heli gets farther away"),
      seg("VR", [["auto", "WebXR if available"], ["cardboard", "Built-in Cardboard"]], s.view.vrMode, (v) => { s.view.vrMode = v; this.changed("view"); }),
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
        const ch = channelFromCaptures(caps[`sw-${sw.key}-off`], caps[`sw-${sw.key}-on`], used);
        if (ch) { used.push(ch.index); map.switches[sw.key] = { index: ch.index, off: ch.lo, on: ch.hi }; }
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
