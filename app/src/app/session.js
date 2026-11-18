// Flight school sessions: start with the lesson's settings, end with a draft log entry. Mixed into App.

import { planNext, trainerFor, sessionEntry } from "../school/school.js";
import { saveSettings } from "../ui/settings.js";

export const sessionMethods = {
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
  },

  /** Stop the session and hand the draft log entry to the UI to confirm or edit. */
  endSession() {
    const ss = this.session;
    if (!ss) return;
    this.session = null;
    this.userPaused = false;
    const s = this.settings;
    const tr = this.trainer;
    const inCircle = ss.plan.kind === "hover" && tr.timeTotal > 5 ? Math.round((100 * tr.timeIn) / tr.timeTotal) : null;
    const entry = sessionEntry(ss.plan, { startedAt: ss.startedAt, seconds: ss.elapsed, crashes: ss.crashes, outOfArea: ss.outOfArea, inCircle });
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
  },
};
