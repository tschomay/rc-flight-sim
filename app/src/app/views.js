// Full screen, red/cyan anaglyph, Cardboard and WebXR. Mixed into App.

import { AnaglyphEffect } from "three/examples/jsm/effects/AnaglyphEffect.js";
import { EYE } from "../render/view.js";

export const viewMethods = {
  async toggleFullscreen() {
    const root = document.documentElement;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else await (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: "hide" });
    } catch { this.ui.toast("Full screen isn't available here"); }
  },

  /** Red/cyan glasses: the flat view, HUD and sticks, rendered as an anaglyph. */
  toggleAnaglyph() {
    this.anaglyph ||= new AnaglyphEffect(this.renderer, innerWidth, innerHeight);
    this.view = this.view === "anaglyph" ? "flat" : "anaglyph";
    this.ui.setStereoButton(this.view === "anaglyph");
    this.resize();
  },

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
    if (!document.fullscreenElement) {
      try { await document.documentElement.requestFullscreen?.({ navigationUI: "hide" }); } catch { /* fullscreen optional */ }
    }
    try { await screen.orientation?.lock?.("landscape"); } catch { /* lock optional */ }
    try { this.wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* optional */ }
    this.cardboard.start();
    this.resize();
    this.ui.toast(this.settings.view.headTracking ? "Tap once to centre the view, twice to reset" : "Tap twice to reset", 3000);
  },

  /** Back to the flat view. Full screen stays on: the Full screen button turns it off. */
  exitVR() {
    this.view = "flat";
    document.body.classList.remove("vr");
    this.cardboard.stop();
    try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
    this.wakeLock?.release?.().catch(() => {});
    this.resize();
  },
};
