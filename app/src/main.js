// App entry: wires the flight model, trainer, inputs, renderer and UI together.
// The physics runs at a fixed 1 kHz inside each animation frame; input is sampled once
// per frame (the display rate, 60–120 Hz).

import * as THREE from "three";
import { Heli } from "./sim/heli.js";
import { MODELS } from "./sim/models.js";
import { applyTuning } from "./sim/tuning.js";
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
import { cloudMethods } from "./app/cloud.js";
import { sessionMethods } from "./app/session.js";
import { viewMethods } from "./app/views.js";
import { RotorSound } from "./audio/rotor.js";
import { Pace } from "./sim/pace.js";
import { Recorder, Player } from "./sim/replay.js";

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
    this.userPaused = false;  // paused from the session timer (the settings sheet pauses too)
    this.waiting = null;  // the hover trainer waits for the pilot's throttle before handing over
    this.acc = 0;
    this.prevReset = false;
    this.crashAt = 0;
    this.sound = new RotorSound();
    this.pace = new Pace();
    this.recorder = new Recorder(10);
    this.simClock = 0;        // s of sim time flown, for the recorder
    this.lastCrash = null;    // frames leading up to the last crash
    this.replay = null;       // a Player while a crash replay runs

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
    registerServiceWorker();
  }

  /** The model definition with the user's rate scaling applied. */
  modelDef() {
    const s = this.settings;
    const def = applyTuning(MODELS[s.model], s.tuning[s.model]);
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
    // a recording of another heli isn't this one's crash
    this.lastCrash = null;
    this.replay = null;
    this.ui.setReplayButton(false);
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
    this.sound.enabled = s.sound.on;
    this.sound.volume = s.sound.volume / 100;
    this.applyQuality();
  }

  /**
   * Light graphics for slower phones (and Cardboard, which draws everything twice): no
   * high-DPI rendering and a smaller, hard-edged shadow. The shadow itself stays: under
   * the heli it's the best height cue there is.
   */
  applyQuality() {
    const light = this.settings.view.quality === "light";
    if (this.quality === light) return;
    this.quality = light;
    const sun = this.world.sun;
    this.renderer.shadowMap.type = light ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    sun.shadow.mapSize.set(light ? 512 : 1024, light ? 512 : 1024);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    // the shadow filter is compiled into each material: recompile them for the new one
    this.scene.traverse((o) => { for (const m of [o.material].flat()) if (m) m.needsUpdate = true; });
    this.resize();
  }

  saveAndApply(what) {
    saveSettings(this.settings);
    if (what === "school") this.scheduleBackup();
    if (what === "model") { this.applyModel(); this.applyAll(); this.restart(); return; }
    if (what === "tune") { this.heli.setModel(this.modelDef()); return; }  // live: the heli keeps flying
    this.applyAll();
    if (what === "trainer-restart") this.restart();
  }

  /** Pause or resume from the session timer. */
  togglePause() {
    if (!this.ui.el.sheet.hidden) { this.ui.closeSheet(); return; }  // settings open: back to flying
    this.userPaused = !this.userPaused;
    this.paused = this.userPaused;
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

  /**
   * Respawn the heli. In the hover trainer the sim then holds still until the pilot is on
   * the sticks: any throttle movement when the trainer flies the collective, or the stick
   * brought to the hover position when the pilot does. An automatic reset after a crash
   * only waits for the latter, so the heli isn't handed over with the throttle chopped.
   */
  restart({ auto = false } = {}) {
    const c = this.trainer.cfg;
    // after a crash, optionally come back facing the way the heli was, so a piro carries on
    // (only where the heading isn't fixed by the exercise: rotating, or the pilot's rudder)
    const keep = this.heli.crashed && this.settings.keepHeading && c.kind === "hover" &&
      (c.rotation === "cw" || c.rotation === "ccw" || !c.assist.rudder);
    this.crashAt = 0;
    this.replay = null;
    this.recorder.clear();
    this.ui.hideToast();
    this.trainer.start(this.heli, this.mode, { heading: keep ? this.heli.heading : null });
    if (c.kind === "hover") this.mode = "idle";
    this.waiting = c.kind !== "hover" ? null : !c.assist.collective ? { kind: "match" } : auto ? null : { kind: "move" };
    this.acc = 0;
  }

  /** Release the waiting hover trainer once the throttle stick says the pilot is ready. */
  checkHandover(sticks) {
    const w = this.waiting;
    if (w.kind === "move") {
      w.from ??= sticks.coll;
      w.done = Math.abs(sticks.coll - w.from) > 0.12;
    } else {
      // the collective that holds the hover, in the flight mode the pilot has selected
      const mode = sticks.mode === "normal" ? "normal" : "idle";
      const T = this.heli.def.mass * 9.81 * (this.heli.inverted ? -1 : 1);
      w.target = this.heli.stickForPitch(this.heli.pitchForThrust(T), mode);
      w.stick = sticks.coll;
      w.done = sticks.mode !== "hold" && Math.abs(sticks.coll - w.target) < 0.05;
    }
    if (w.done) { this.waiting = null; this.ui.toast("You have control", 1000); }
  }

  /** Play back the seconds before the last crash, at half speed; again to stop. */
  toggleReplay() {
    if (this.replay) return this.stopReplay();
    if (!this.lastCrash?.length) return;
    if (!this.ui.el.sheet.hidden) this.ui.closeSheet();  // keeps a session's pause, so Stop stays reachable
    this.replay = new Player(this.lastCrash, { speed: 0.5 });
    this.ui.hideToast();
  }

  /** End the replay and fly again from a fresh start. */
  stopReplay() {
    this.replay = null;
    this.restart();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const cap = this.settings.view.quality === "light" ? 1 : this.view === "cardboard" ? 1.6 : 2;
    const pr = Math.min(devicePixelRatio, cap);
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
    const real = (now - this.last) / 1000;
    const dt = Math.min(0.05, real);
    this.last = now;
    const { sticks, source } = this.readInput(dt);

    if (this.waiting && !this.paused && !this.replay) this.checkHandover(sticks);
    const held = this.paused || !!this.waiting || !!this.replay;
    if (this.session && !held) {
      this.session.elapsed += dt;
      if (this.session.elapsed >= this.settings.school.sessionMinutes * 60) { this.ui.toast("Session complete", 2000); this.endSession(); }
    }
    if (!held) {
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
      this.pace.sample(real, real * this.settings.timeScale / 100, n * DT);
      this.simClock += n * DT;
      if (!this.crashAt) this.recorder.record(this.heli, this.simClock);  // up to and including the crash
    }

    if (this.heli.crashed) {
      if (!this.crashAt) {
        this.crashAt = now;
        this.trainer.crashes++;
        this.sound.crash();
        this.lastCrash = this.recorder.frames();
        this.lastCrashReason = this.heli.crashed;
        this.ui.setReplayButton(true);
        if (this.session) { this.session.crashes++; if (this.heli.crashed === "Left the circle") this.session.outOfArea++; }
        this.ui.toast(`${this.heli.crashed}${this.settings.autoReset ? " — resetting" : this.session ? " — tap the timer, then Reset" : " — tap Reset"}`, 0);
      } else if (this.settings.autoReset && !this.replay && now - this.crashAt > 1500) this.restart({ auto: true });
    }

    // during a replay the mesh, camera and sound follow the recording instead of the sim
    let shown = this.heli, shownSpeed = this.paused ? 0 : dt * this.settings.timeScale / 100;
    if (this.replay) {
      // a replay runs while a session is paused from its timer, but not under the settings sheet
      const frozen = !this.ui.el.sheet.hidden;
      const f = this.replay.step(frozen ? 0 : dt);
      shown = { ...f, def: this.heli.def, omegaNom: this.heli.omegaNom };
      shownSpeed = frozen ? 0 : dt * this.replay.speed;
      if (this.replay.done) this.stopReplay();
    }
    const hp = new THREE.Vector3(shown.pos.x, shown.pos.y, shown.pos.z);
    this.mesh.update(shown, shownSpeed);
    this.world.update(hp, this.wind.current);
    this.world.setZone(this.trainer.zone);
    if (this.trainer.cfg.compass) this.world.highlightCompass(this.trainer.exercise.nextPoint);
    this.sound.update(shown, this.replay ? (this.ui.el.sheet.hidden ? this.replay.speed : 0) : held ? 0 : this.settings.timeScale / 100);
    this.ui.updateHud(now, this.heli, this.trainer, this.mode, source);

    if (this.renderer.xr.isPresenting) {
      this.renderer.render(this.scene, this.flat.camera);
    } else if (this.view === "cardboard") {
      this.cardboard.update(hp, dt);
      this.cardboard.render(this.renderer, this.scene);
    } else {
      const ground = this.trainer.cfg.kind === "hover" ? new THREE.Vector3(0, 0, -this.trainer.cfg.distance) : null;
      this.flat.update(hp, dt, { autoZoom: this.settings.view.autoZoom, refDistance: this.refDistance, baseFov: this.settings.view.fov, ground });
      if (this.view === "anaglyph") {
        this.flat.camera.focus = Math.max(1, this.flat.camera.position.distanceTo(hp));  // heli sits at screen depth
        this.anaglyph.render(this.scene, this.flat.camera);
      } else this.flat.render(this.renderer, this.scene);
    }
  }

}

Object.assign(App.prototype, cloudMethods, sessionMethods, viewMethods);

/**
 * Offline support. Only where the page came from a real web server with its manifest (the
 * artifact build has none and can't host a worker); localhost is skipped too, so the dev
 * server always shows the latest build.
 */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;
  if (!document.querySelector('link[rel="manifest"]')) return;
  const go = () => navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is optional */ });
  if (document.readyState === "complete") go(); else addEventListener("load", go, { once: true });
}

window.app = new App();
