// The heads-up display: flight chips, the hover score, exercise progress and the
// hand-over gauge. Mixed into UI.

import { h } from "./dom.js";
import { COMPASS, lessonProgress } from "../sim/exercises.js";
import { schoolChip, mmss } from "./school.js";

export const hudMethods = {
  updateHud(now, heli, trainer, mode, source) {
    if (now - this.hudLast < 100) return;
    this.hudLast = now;
    // during a training session only a small countdown shows; tapping it pauses and
    // brings the rest back
    const ss = this.app.session;
    const focus = !!ss && !this.app.userPaused && this.el.sheet.hidden;
    const low = !this.app.touch.visible;  // no touch sticks in the way: keep it out of view, bottom left
    document.body.classList.toggle("focus", focus);
    document.body.classList.toggle("session", !!ss);
    document.body.classList.toggle("timer-low", !!ss && low);
    const tm = this.el.timer;
    tm.hidden = !ss;
    if (ss) {
      const left = mmss(Math.max(0, this.app.settings.school.sessionMinutes * 60 - ss.elapsed));
      tm.textContent = this.app.userPaused ? `\u25B6 ${left} paused` : left;
      tm.setAttribute("aria-label", this.app.userPaused ? `Paused, ${left} left. Resume` : `${left} left. Pause`);
      tm.classList.toggle("paused", !!this.app.userPaused);
      tm.classList.toggle("low", low);
    }
    if (focus) { this.el.hud.replaceChildren(...[this.waitPanel()].filter(Boolean)); return; }
    const tr = trainer.cfg.kind === "hover";
    const pct = trainer.timeTotal > 0 ? Math.round((100 * trainer.timeIn) / trainer.timeTotal) : 0;
    const label = { normal: "NORMAL", idle: "IDLE UP", hold: "HOLD" }[mode];
    if (this.app.replay) {
      this.el.replay.textContent = "Stop replay";
      this.el.hud.replaceChildren(h("div", { class: "chips" }, h("span", { class: "chip warn" }, "REPLAY \u00bd speed"), h("span", { class: "chip" }, `${Math.round(this.app.replay.sample(this.app.replay.time).omega * 60 / (2 * Math.PI))} rpm`)), h("div", { class: "score out" }, h("b", {}, "Last crash: "), this.app.lastCrashReason || "replaying"));
      return;
    }
    this.el.replay.textContent = "Replay crash";
    const rows = [
      h("span", { class: `chip mode-${mode}` }, label),
      h("span", { class: "chip" }, `${Math.round(heli.rpm)} rpm`),
      h("span", { class: "chip" }, `${heli.height.toFixed(1)} m`),
      heli.inverted ? h("span", { class: "chip inv" }, "INVERTED") : null,
      this.app.settings.timeScale < 100 ? h("span", { class: "chip slow" }, `${this.app.settings.timeScale}% speed`) : null,
      this.app.pace.slow ? h("span", { class: "chip warn", title: "The phone can't keep the physics at full speed" }, `sim ${Math.round(this.app.pace.ratio * 100)}% of real time${this.app.settings.view.quality === "light" ? "" : " \u2014 try Light graphics"}`) : null,
      this.app.sound.blocked ? h("span", { class: "chip dim" }, "tap for sound") : null,
      schoolChip(this.app),
      h("span", { class: "chip dim" }, source),
    ];
    const score = tr ? h("div", { class: `score ${trainer.zone}` },
      h("b", {}, { in: "In circle", edge: "Drifting out", danger: "At the edge", out: "Outside" }[trainer.zone]),
      ` ${trainer.streak.toFixed(1)} s · best ${trainer.best.toFixed(1)} s · ${pct}% of ${Math.round(trainer.timeTotal)} s`) : null;
    let ex = null;
    if (trainer.cfg.pattern?.kind !== "none" || (tr && trainer.cfg.compass)) {
      const sc = trainer.exercise;
      const lesson = this.app.session?.plan.lesson;
      const prog = lesson ? lessonProgress(lesson, sc.tally()) : null;
      const next = sc.nextPoint;
      const text = prog?.text || sc.summary() || (trainer.cfg.compass ? "Stop for 1 s at each compass point" : "Fly the outline: laps count automatically");
      ex = h("div", { class: `score ex ${prog?.passed ? "in" : ""}` }, text, (trainer.cfg.compass || sc.p.sequence) && next != null ? h("b", {}, ` \u2192 ${COMPASS[next]}`) : null);
    }
    this.el.hud.replaceChildren(...[h("div", { class: "chips" }, rows), this.waitPanel(), score, ex].filter(Boolean));
  },

  /** While the trainer waits for the pilot: what to do with the throttle to take over. */
  waitPanel() {
    const w = this.app.waiting;
    if (!w) return null;
    if (w.kind === "move") return h("div", { class: "score wait" }, h("b", {}, "Paused. "), "Move the throttle stick to start.");
    if (w.target == null) return null;
    const pos = (v) => `left:${50 + Math.max(-1, Math.min(1, v)) * 50}%`;
    const hold = this.app.mode === "hold";
    return h("div", { class: "score wait" },
      h("b", {}, "Paused. "), hold ? "Switch off throttle hold, then bring" : "Bring", " the throttle to the hover mark to take control",
      w.stick < w.target ? " (raise it)." : " (lower it).",
      h("div", { class: "bar" }, h("i", { class: "goal", style: pos(w.target) }), h("i", { style: pos(w.stick) })));
  },
};
