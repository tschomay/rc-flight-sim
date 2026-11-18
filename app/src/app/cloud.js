// Automatic backup to the pilot's own Vercel Blob store: merge, save, write back. Mixed into App.

import { mergeLogs, cloudLoad, cloudSave, looksLikeToken } from "../school/backup.js";
import { saveSettings, DEFAULTS } from "../ui/settings.js";

export const cloudMethods = {
  // ---------- backup ----------
  scheduleBackup() {
    const b = this.settings.backup;
    if (!b.auto || !looksLikeToken(b.token)) return;
    clearTimeout(this.backupT);
    this.backupT = setTimeout(() => this.cloudSync(), 4000);
  },

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
      if (manual) this.ui.toast(restoreSettings ? "Restored from the cloud" : "Backed up", 1600);
    } catch (e) {
      b.lastError = e.message || "failed";
      if (manual) this.ui.toast(`Backup failed: ${b.lastError}`, 3500);
    } finally {
      this.syncing = false;
      saveSettings(s);
    }
  },

  /** Take settings from a backup, keeping this device's cloud token and the merged log. */
  restoreSettings(from) {
    const s = this.settings;
    const keep = { backup: s.backup, school: s.school };
    for (const k of Object.keys(DEFAULTS)) if (k in from) s[k] = structuredClone(from[k]);
    Object.assign(s, keep);
    s.school = { ...from.school, log: keep.school.log, deleted: keep.school.deleted };
    saveSettings(s);
    this.applyModel(); this.applyAll(); this.restart();
  },
};
