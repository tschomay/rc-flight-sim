// DOM overlay: HUD, top buttons, flight-mode buttons, the settings sheet, and the
// transmitter setup wizard. Plain DOM, no framework; the sheet is rebuilt on open.

import { ORIENTATIONS } from "../sim/trainer.js";
import { schoolTab, sessionEndCard } from "./school.js";
import { h, seg, toggle, slider, fmt1, radii } from "./dom.js";
import { hudMethods } from "./hud.js";
import { heliMethods } from "./heli.js";
import { transmitterMethods } from "./transmitter.js";

export { h, seg, toggle, slider, radii };

const CIRCLE_RADII = radii([0.5, 1, 1.5, 2, 3]);

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
      timer: document.getElementById("timer"),
    };
    this.el.timer.addEventListener("click", () => { app.togglePause(); this.hudLast = 0; });
    document.getElementById("btn-menu").addEventListener("click", () => this.openSheet());
    document.getElementById("btn-reset").addEventListener("click", () => app.restart());
    this.el.replay = document.getElementById("btn-replay");
    this.el.replay.addEventListener("click", () => app.toggleReplay());
    document.getElementById("btn-vr").addEventListener("click", () => app.enterVR());
    const full = document.getElementById("btn-full");
    const root = document.documentElement;
    // iPhone Safari has no full-screen API (add to home screen instead), and the installed
    // app already runs full screen. Checked once at start: a tab in full screen can match
    // the display-mode queries too.
    const installed = navigator.standalone || ["fullscreen", "standalone", "minimal-ui"].some((m) => matchMedia(`(display-mode: ${m})`).matches);
    if (installed || (!root.requestFullscreen && !root.webkitRequestFullscreen)) full.hidden = true;
    full.addEventListener("click", () => app.toggleFullscreen());
    document.addEventListener("fullscreenchange", () => { full.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; });
    this.el.vrExit.addEventListener("click", () => app.exitVR());
    this.buildModes();
    this.tab = "train";
    this.hudLast = 0;
  }

  setReplayButton(on) { this.el.replay.hidden = !on; }

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

  // ---------- settings sheet ----------
  openSheet(tab = this.tab) {
    const s = this.app.settings;
    const sheet = this.el.sheet;
    // refreshing the tab that's showing keeps its scroll position and open sections
    const old = !sheet.hidden && tab === this.tab ? sheet.querySelector(".sheet-body") : null;
    const keep = old && { top: old.scrollTop, open: [...old.querySelectorAll("details")].map((d) => d.open) };
    this.tab = tab;
    const tabs = [["train", "Training"], ["school", "Flight school"], ["heli", "Helicopter"], ["tx", "Transmitter"], ["view", "View & sound"]];
    const body = h("div", { class: "sheet-body" }, this[`tab_${tab}`](s));
    sheet.replaceChildren(
      h("div", { class: "sheet-head" },
        h("nav", { class: "tabs" }, tabs.map(([k, t]) => h("button", { type: "button", class: k === tab ? "on" : "", onclick: () => this.openSheet(k) }, t))),
        h("button", { type: "button", class: "close", "aria-label": "Close settings", onclick: () => this.closeSheet() }, "Fly")),
      body);
    sheet.hidden = false;
    if (keep) {
      body.querySelectorAll("details").forEach((d, i) => { if (keep.open[i] != null) d.open = keep.open[i]; });
      body.scrollTop = keep.top;
    }
    this.app.paused = true;
  }

  closeSheet() {
    this.el.sheet.hidden = true;
    this.app.paused = false;
    this.app.userPaused = false;
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
      seg("Circle radius", CIRCLE_RADII, t.circle, (v) => { t.circle = +v; this.changed("trainer"); }),
      h("fieldset", { class: "field" }, h("legend", {}, "Ground pattern (scored automatically)"),
        seg("Outline", [["none", "None"], ["circle", "Circle"], ["eight", "Figure 8"]], t.pattern?.kind || "none", (v) => { t.pattern = { ...t.pattern, kind: v }; this.changed("trainer"); }),
        slider("Circle radius", 3, 10, 0.5, t.pattern?.radius ?? 5, (v) => { t.pattern = { ...t.pattern, radius: v }; this.changed("trainer"); }, fmt1("m")),
        slider("Pattern distance", 8, 30, 1, t.pattern?.distance ?? 16, (v) => { t.pattern = { ...t.pattern, distance: v }; this.changed("trainer"); }, fmt1("m")),
        toggle("Compass points on the hover circle", t.compass, (v) => { t.compass = v; this.changed("trainer"); }, "scores 8-point piros: stop 1 s at each point in turn")),
      seg("Counts as inside", [[0, "Any height"], [1, "±1 m"], [2, "±2 m"]], t.heightWindow ?? 0, (v) => { t.heightWindow = +v; this.changed("trainer"); }),
      toggle("Show the column above the circle", s.view.column, (v) => { s.view.column = v; this.changed("trainer"); }, "the ring on the ground always shows"),
      toggle("Leaving the circle is a crash", t.leaveIsCrash, set("leaveIsCrash"), "wander out and the heli resets"),
      toggle("After a crash, carry on facing the same way", s.keepHeading, (v) => { s.keepHeading = v; this.changed("misc"); }, "the heli comes back pointing where it was, so a piro picks up where it left off. Also in flight school"),
      slider("Distance from you", 2, 12, 0.5, t.distance, set("distance", "trainer-restart"), fmt1("m")),
      slider("Trainer strength", 0, 1, 0.05, t.gain, set("gain"), (v) => (v < 0.35 ? "gentle" : v < 0.7 ? "normal" : "tight")),
      h("div", { class: "row" },
        h("button", { type: "button", class: "primary", onclick: () => { this.app.restart(); this.closeSheet(); } }, "Start exercise"),
        h("button", { type: "button", onclick: () => { this.app.trainer.resetScore(); this.app.ui.toast("Score cleared"); } }, "Clear score")),
    ];
  }

  tab_view(s) {
    const lens = s.view.lens;
    const setL = (k) => (v) => { lens[k] = v; this.changed("view"); };
    return [
      seg("Graphics", [["full", "Full"], ["light", "Light"]], s.view.quality, (v) => { s.view.quality = v; this.changed("view"); }),
      h("p", { class: "hint" }, "Light renders at normal resolution with a simpler shadow: smoother on slower phones and in Cardboard, which draws everything twice. If a \u201csim % of real time\u201d chip appears while flying, the phone is falling behind and the heli is flying slower than it should; switch to Light."),
      toggle("Sound", s.sound.on, (v) => { s.sound.on = v; this.changed("view"); }, "rotor, motor and wash, following headspeed and load: you hear a bog or a spool-down before you see it"),
      slider("Volume", 0, 100, 5, s.sound.volume, (v) => { s.sound.volume = v; this.changed("view"); }, (v) => `${v}%`),
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

}

Object.assign(UI.prototype, hudMethods, heliMethods, transmitterMethods);
