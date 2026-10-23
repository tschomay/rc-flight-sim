// App entry: wires the flight model, trainer, inputs, renderer and UI together.
// The physics runs at a fixed 1 kHz inside each animation frame; input is sampled once
// per frame (the display rate, 60–120 Hz).

import * as THREE from "three";
import { AnaglyphEffect } from "three/examples/jsm/effects/AnaglyphEffect.js";
import { Heli } from "./sim/heli.js";
import { MODELS } from "./sim/models.js";
import { Trainer, selfLevel } from "./sim/trainer.js";
import { Wind } from "./sim/wind.js";
import { buildWorld } from "./render/world.js";
import { HeliMesh } from "./render/heliMesh.js";
import { FlatView, CardboardView, EYE } from "./render/view.js";
import { firstGamepad, readMapped } from "./input/gamepad.js";
import { TouchSticks } from "./input/touch.js";
import { Keyboard } from "./input/keyboard.js";
import { loadSettings, saveSettings } from "./ui/settings.js";
import { UI } from "./ui/ui.js";
import { planNext, trainerFor, sessionEntry } from "./school/school.js";
import { mergeLogs, cloudLoad, cloudSave, looksLikeToken } from "./school/backup.js";
import { DEFAULTS } from "./ui/settings.js";

const DT = 0.001;
const expo = (x, p) => (1 - p) * x + p * x * x * x;

class App {
  constructor() {
    this.settings = loadSettings();
    const stage = document.getElementById("stage");
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.world = buildWorld(this.scene);
    this.wind = new Wind();
    this.flat = new FlatView();
    this.cardboard = new CardboardView();
    this.xrRig = new THREE.Group();
    this.xrRig.position.copy(EYE);
    this.scene.add(this.cardboard.head);

    this.touch = new TouchSticks(document.getElementById("sticks"));
    this.keyboard = new Keyboard();
    this.mode = this.settings.mode;
    this.view = "flat";
    this.paused = false;
    this.acc = 0;
    this.prevReset = false;
    this.crashAt = 0;

    this.ui = new UI(this);
    this.applyModel();
    this.applyAll();
    this.restart();

    addEventListener("resize", () => this.resize());
    screen.orientation?.addEventListener?.("change", () => this.resize());
    addEventListener("keydown", (e) => {
      if (e.target.closest?.("input, select, textarea")) return;
      if (e.code === "Digit1") this.setMode("normal");
      if (e.code === "Digit2") this.setMode("idle");
      if (e.code === "Digit3") this.setMode("hold");
      if (e.code === "KeyR") this.restart();
      if (e.code === "BracketLeft") this.setTimeScale(this.settings.timeScale - 5);
      if (e.code === "BracketRight") this.setTimeScale(this.settings.timeScale + 5);
    });
    let lastTap = 0;
    this.renderer.domElement.addEventListener("pointerdown", () => {
      if (this.view !== "cardboard") return;
      const now = performance.now();
      if (now - lastTap < 350) this.restart(); else this.cardboard.recenter();
      lastTap = now;
    });
    document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && this.view === "cardboard") this.exitVR(); });
    this.resize();
    this.last = performance.now();
    this.renderer.setAnimationLoop((t, frame) => this.frame(t, frame));
    if (this.settings.backup.auto) this.cloudSync();
  }

  /** The model definition with the user's rate scaling applied. */
  modelDef() {
    const s = this.settings;
    const def = structuredClone(MODELS[s.model]);
    if (s.bladeColor === "white") def.look.blade = 0xf4f4f0;
    if (s.idlePitch) def.pitch.idle = def.pitch.hold = [-s.idlePitch, s.idlePitch];
    const k = this.settings.rates / 100;
    for (const a of ["roll", "pitch", "yaw"]) def.rates[a] *= k;
    return def;
  }

  applyModel() {
    const def = this.modelDef();
    if (!this.heli) this.heli = new Heli(def); else this.heli.setModel(def);
    if (this.mesh) this.scene.remove(this.mesh.root);
    this.mesh = new HeliMesh(def);
    this.scene.add(this.mesh.root);
    this.refDistance = def.rotor.radius * 17;  // auto-zoom keeps apparent size like a 450 at 6 m
  }

  applyAll() {
    const s = this.settings;
    if (!this.trainer) this.trainer = new Trainer(s.trainer);
    this.trainer.cfg = structuredClone(s.trainer);
    this.wind.set(s.wind);
    // side-by-side without lenses: no pre-distortion, and a field of view close to the flat view's
    this.cardboard.setLens(s.view.stereo === "plain" ? { ...s.view.lens, k1: 0, k2: 0, zoom: 1, fov: 55 } : s.view.lens);
    this.cardboard.headTracking = s.view.headTracking;
    this.world.setTarget(s.trainer, s.trainer.kind === "hover", s.view.column);
    this.world.setPattern(s.trainer.pattern);
    this.world.setCompass(s.trainer, s.trainer.kind === "hover" && s.trainer.compass);
  }

  saveAndApply(what) {
    saveSettings(this.settings);
    if (what === "school") this.scheduleBackup();
    if (what === "model") { this.applyModel(); this.applyAll(); this.restart(); return; }
    this.applyAll();
    if (what === "trainer-restart") this.restart();
  }

  // ---------- backup ----------
  scheduleBackup() {
    const b = this.settings.backup;
    if (!b.auto || !looksLikeToken(b.token)) return;
    clearTimeout(this.backupT);
    this.backupT = setTimeout(() => this.cloudSync(), 4000);
  }

  /** Merge the cloud log into ours, save locally, then write the merged copy back. */
  async cloudSync({ manual = false, restoreSettings = false } = {}) {
    const s = this.settings, b = s.backup;
    if (!looksLikeToken(b.token) || this.syncing) return;
    this.syncing = true;
    try {
      const remote = await cloudLoad(b.token);
      if (remote?.settings?.school) {
        const before = JSON.stringify(s.school.log);
        Object.assign(s.school, mergeLogs(s.school, remote.settings.school));
        if (restoreSettings) this.restoreSettings(remote.settings);
        if (JSON.stringify(s.school.log) !== before || restoreSettings) { saveSettings(s); this.applyAll(); }
      } else if (restoreSettings) this.ui.toast("No cloud backup yet", 2000);
      await cloudSave(b.token, s);
      b.lastAt = new Date().toISOString();
      b.lastError = null;
      if (manual) this.ui.toast("Backed up", 1400);
    } catch (e) {
      b.lastError = e.message || "failed";
      if (manual) this.ui.toast(`Backup failed: ${b.lastError}`, 3500);
    } finally {
      this.syncing = false;
      saveSettings(s);
    }
  }

  /** Take settings from a backup, keeping this device's cloud token and the merged log. */
  restoreSettings(from) {
    const s = this.settings;
    const keep = { backup: s.backup, school: s.school };
    for (const k of Object.keys(DEFAULTS)) if (k in from) s[k] = structuredClone(from[k]);
    Object.assign(s, keep);
    s.school = { ...from.school, log: keep.school.log, deleted: keep.school.deleted };
    saveSettings(s);
    this.applyModel(); this.applyAll(); this.restart();
  }

  setMode(m) {
    this.mode = m;
    this.settings.mode = m;
    saveSettings(this.settings);
  }

  setTimeScale(pct) {
    this.settings.timeScale = Math.max(20, Math.min(100, Math.round(pct)));
    saveSettings(this.settings);
    this.ui.toast(`Sim speed ${this.settings.timeScale}%`, 900);
  }

  // ---------- flight school sessions ----------
  startSession() {
    const s = this.settings;
    const { plan } = planNext(s.school);
    s.school.override = null;  // an override is for one session
    // restarting mid-session keeps the settings from before the first one
    const prev = this.session?.prev || { trainer: structuredClone(s.trainer), timeScale: s.timeScale };
    this.session = { plan, startedAt: Date.now(), elapsed: 0, crashes: 0, outOfArea: 0, prev };
    s.trainer = trainerFor(plan, s.school, s.trainer);
    s.timeScale = plan.speed;
    saveSettings(s);
    this.applyAll();
    this.trainer.resetScore();
    this.restart();
  }

  /** Stop the session and hand the draft log entry to the UI to confirm or edit. */
  endSession() {
    const ss = this.session;
    if (!ss) return;
    this.session = null;
    const s = this.settings;
    const entry = sessionEntry(ss.plan, { startedAt: ss.startedAt, seconds: ss.elapsed, crashes: ss.crashes, outOfArea: ss.outOfArea });
    // log what was actually flown, in case settings were changed mid-session
    entry.speed = s.timeScale;
    if (ss.plan.kind === "hover") { entry.collAssist = s.trainer.assist.collective; entry.rudderAssist = s.trainer.assist.rudder; }
    const ex = this.trainer.exercise;
    if (s.trainer.pattern?.kind !== "none" || s.trainer.compass) { entry.tally = ex.tally(); entry.notes = ex.summary(); }
    s.trainer = ss.prev.trainer;
    s.timeScale = ss.prev.timeScale;
    saveSettings(s);
    this.applyAll();
    this.ui.sessionEnded(entry);
  }

  restart() {
    this.crashAt = 0;
    this.ui.hideToast();
    this.trainer.start(this.heli, this.mode);
    if (this.trainer.cfg.kind === "hover") this.mode = "idle";
    this.acc = 0;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const pr = Math.min(devicePixelRatio, this.view === "cardboard" ? 1.6 : 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.flat.resize(w, h);
    this.cardboard.resize(w, h, pr);
    this.anaglyph?.setSize(w, h);
  }

  readInput(dt) {
    const s = this.settings;
    const map = s.input.map;
    const gp = map ? firstGamepad(map.id) : null;
    const tx = gp ? readMapped(gp, map) : null;
    const touchOn = this.view === "flat" && (s.input.touch === "on" || (s.input.touch === "auto" && !tx));
    this.touch.visible = touchOn;
    const keys = this.keyboard.read(dt);
    let raw, source;
    if (tx) { raw = tx; source = "transmitter"; }
    else if (this.keyboard.used) { raw = keys; source = "keyboard"; }
    else { raw = this.touch.read(); source = "touch"; }

    let mode = this.mode;
    const sw = tx?.switches || {};
    const switchesMapped = !!(map && (map.switches?.idle || map.switches?.hold));
    if (tx && switchesMapped) {
      mode = sw.hold ? "hold" : map.switches.idle ? (sw.idle ? "idle" : "normal") : this.mode === "hold" ? "idle" : this.mode;
      this.mode = mode;
    }
    if (tx && sw.reset && !this.prevReset) this.restart();
    this.prevReset = !!sw.reset;
    this.ui.setModeButtons(this.mode, !!(tx && switchesMapped));

    const ec = s.expo.cyclic / 100, er = s.expo.rudder / 100;
    return {
      sticks: { roll: expo(raw.roll, ec), pitch: expo(raw.pitch, ec), yaw: expo(raw.yaw, er), coll: raw.coll, mode },
      source,
    };
  }

  frame(t) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { sticks, source } = this.readInput(dt);

    if (this.session && !this.paused) {
      this.session.elapsed += dt;
      if (this.session.elapsed >= this.settings.school.sessionMinutes * 60) { this.ui.toast("Session complete", 2000); this.endSession(); }
    }
    if (!this.paused) {
      this.acc += dt * this.settings.timeScale / 100;
      let n = 0;
      while (this.acc >= DT && n < 60) {
        const wind = this.wind.step(DT);
        const pilot = this.settings.selfLevel ? selfLevel(this.heli, sticks) : sticks;
        const ctl = this.trainer.update(this.heli, pilot, DT);
        this.heli.step(ctl, { wind }, DT);
        this.acc -= DT; n++;
      }
      if (n === 60) this.acc = 0;
    }

    if (this.heli.crashed) {
      if (!this.crashAt) {
        this.crashAt = now;
        this.trainer.crashes++;
        if (this.session) { this.session.crashes++; if (this.heli.crashed === "Left the circle") this.session.outOfArea++; }
        this.ui.toast(`${this.heli.crashed}${this.settings.autoReset ? " — resetting" : " — tap Reset"}`, 0);
      } else if (this.settings.autoReset && now - this.crashAt > 1500) this.restart();
    }

    const hp = new THREE.Vector3(this.heli.pos.x, this.heli.pos.y, this.heli.pos.z);
    this.mesh.update(this.heli, this.paused ? 0 : dt * this.settings.timeScale / 100);
    this.world.update(hp, this.wind.current);
    this.world.setZone(this.trainer.zone);
    if (this.trainer.cfg.compass) this.world.highlightCompass(this.trainer.exercise.nextPoint);
    this.ui.updateHud(now, this.heli, this.trainer, this.mode, source);

    if (this.renderer.xr.isPresenting) {
      this.renderer.render(this.scene, this.flat.camera);
    } else if (this.view === "cardboard") {
      this.cardboard.update(hp, dt);
      this.cardboard.render(this.renderer, this.scene);
    } else {
      this.flat.update(hp, dt, { autoZoom: this.settings.view.autoZoom, refDistance: this.refDistance, baseFov: this.settings.view.fov });
      if (this.view === "anaglyph") {
        this.flat.camera.focus = Math.max(1, this.flat.camera.position.distanceTo(hp));  // heli sits at screen depth
        this.anaglyph.render(this.scene, this.flat.camera);
      } else this.flat.render(this.renderer, this.scene);
    }
  }

  async toggleFullscreen() {
    const root = document.documentElement;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else await (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: "hide" });
    } catch { this.ui.toast("Full screen isn't available here"); }
  }

  /** Red/cyan glasses: the flat view, HUD and sticks, rendered as an anaglyph. */
  toggleAnaglyph() {
    this.anaglyph ||= new AnaglyphEffect(this.renderer, innerWidth, innerHeight);
    this.view = this.view === "anaglyph" ? "flat" : "anaglyph";
    this.ui.setStereoButton(this.view === "anaglyph");
    this.resize();
  }

  async enterVR() {
    const s = this.settings;
    if (s.view.stereo === "anaglyph" || this.view === "anaglyph") return this.toggleAnaglyph();
    if (s.view.stereo === "cardboard" && s.view.vrMode === "auto" && navigator.xr && (await navigator.xr.isSessionSupported("immersive-vr").catch(() => false))) {
      try {
        const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local"] });
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType("local");
        this.scene.add(this.xrRig);
        this.xrRig.add(this.flat.camera);
        this.flat.camera.position.set(0, 0, 0);
        await this.renderer.xr.setSession(session);
        session.addEventListener("end", () => {
          this.renderer.xr.enabled = false;
          this.flat.camera.removeFromParent();
          this.flat.camera.position.copy(EYE);
          this.scene.remove(this.xrRig);
          this.resize();
        });
        return;
      } catch (e) {
        console.warn("WebXR failed, using built-in Cardboard view", e);
      }
    }
    this.view = "cardboard";
    document.body.classList.add("vr");
    try { await document.documentElement.requestFullscreen?.({ navigationUI: "hide" }); } catch { /* fullscreen optional */ }
    try { await screen.orientation?.lock?.("landscape"); } catch { /* lock optional */ }
    try { this.wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
    this.cardboard.start();
    this.resize();
    this.ui.toast(this.settings.view.headTracking ? "Tap once to centre the view, twice to reset" : "Tap twice to reset", 3000);
  }

  exitVR() {
    this.view = "flat";
    document.body.classList.remove("vr");
    this.cardboard.stop();
    try { document.fullscreenElement && document.exitFullscreen(); } catch { /* ignore */ }
    try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
    this.wakeLock?.release?.().catch(() => {});
    this.resize();
  }
}

window.app = new App();
