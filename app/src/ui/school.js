// Flight school UI: the School tab (credit, next session, log) and the end-of-session card.
// Every value the course suggests can be changed: the next session through an override,
// past sessions by editing the log (the plan re-derives from it), the lesson by a jump.

import { h, seg, toggle, slider } from "./ui.js";
import { CREDIT, LESSONS, lessonById, planNext, restLeft, dailyStatus, toCSV, nextLessonId } from "../school/school.js";
import { entryKey, exportJSON, parseImport, mergeLogs, looksLikeToken } from "../school/backup.js";

const DIRS = [["ccw", "CCW"], ["cw", "CW"], ["both", "Both"]];
const ORIENT = [["upright", "Upright"], ["inverted", "Inverted"]];
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const dirLabel = (d) => ({ cw: "CW", ccw: "CCW", both: "CW + CCW" }[d] || d);

export function schoolChip(app) {
  const ss = app.session;
  if (!ss) return null;
  const left = Math.max(0, app.settings.school.sessionMinutes * 60 - ss.elapsed);
  return h("span", { class: "chip school" }, `L${ss.plan.lesson} ${mmss(left)} · ${ss.crashes} crash${ss.crashes === 1 ? "" : "es"}`);
}

function creditBlock() {
  return h("p", { class: "credit" },
    "Course: ", h("b", {}, `“${CREDIT.title}”`), ` by ${CREDIT.author} (${CREDIT.where}). The lessons, session rules and log follow his guide; the text here is a short summary. `,
    h("a", { href: CREDIT.source, target: "_blank", rel: "noopener" }, "HeliFreak thread"),
    " — read the full guide there; it has videos for every lesson.");
}

function lessonCard(lesson) {
  return h("div", { class: "lesson" },
    h("h3", {}, `Lesson ${lesson.id}: ${lesson.title}`),
    h("p", {}, lesson.summary),
    h("p", { class: "goal" }, h("b", {}, "Pass: "), lesson.goal),
    lesson.tips ? h("ul", {}, lesson.tips.map((t) => h("li", {}, t))) : null);
}

export function schoolTab(ui, s) {
  const app = ui.app, sc = s.school;
  const save = () => ui.changed("school");
  const reopen = () => ui.openSheet("school");
  const { plan, state } = planNext(sc);
  const lesson = lessonById(plan.lesson);
  const over = (k) => (v) => { sc.override = { ...(sc.override || {}), [k]: v }; save(); reopen(); };
  const out = [creditBlock()];

  if (app.session) {
    const ss = app.session;
    out.push(h("div", { class: "callout live" },
      h("b", {}, `Session in progress: Lesson ${ss.plan.lesson}`),
      h("span", {}, `${mmss(Math.max(0, sc.sessionMinutes * 60 - ss.elapsed))} left · ${ss.crashes} crashes`),
      h("div", { class: "row" },
        h("button", { type: "button", class: "primary", onclick: () => ui.closeSheet() }, "Keep flying"),
        h("button", { type: "button", onclick: () => { ui.closeSheet(); app.endSession(); } }, "End session now"))));
  }

  // ---- next session ----
  const rest = restLeft(sc);
  const daily = dailyStatus(sc);
  const notices = [];
  if (state.notes.length) notices.push(h("p", { class: "callout" }, state.notes.join(" ")));
  if (rest > 0) notices.push(h("p", { class: "callout warn" }, `Rest ${rest} more min before the next training session: the break is when it sinks in. Play time doesn't count.`));
  if (daily.skipped) notices.push(h("p", { class: "callout warn" }, "You skipped a day: the guide says do two sessions today (with the break between)."));
  notices.push(h("p", { class: "hint" }, `${daily.today} training session${daily.today === 1 ? "" : "s"} today. At least one a day.`));

  const isHover = lesson.kind === "hover";
  out.push(h("h2", {}, "Next session"), ...notices, lessonCard(lesson),
    h("div", { class: "plan" },
      h("label", { class: "field" }, h("span", { class: "lbl" }, "Lesson"),
        h("select", { onchange: (e) => over("lesson")(e.target.value) },
          LESSONS.map((l) => h("option", { value: l.id, selected: l.id === plan.lesson }, `${l.id}. ${l.title}${l.kind === "play" ? " (play time)" : ""}`)))),
      isHover ? seg("Orientation", ORIENT, plan.orientation, over("orientation")) : null,
      isHover ? seg("Direction", DIRS, plan.direction, over("direction")) : null,
      isHover ? slider("Sim speed", 20, 100, 5, plan.speed, (v) => { sc.override = { ...(sc.override || {}), speed: v }; save(); }, (v) => `${v}%`) : null,
      isHover ? toggle("Trainer flies the collective", plan.collAssist, over("collAssist")) : null,
      isHover ? toggle("Trainer turns the rudder", plan.rudderAssist, over("rudderAssist"), "slow piro at 1 rotation a minute") : null,
      !isHover ? h("p", { class: "hint" }, "Free flight. Fly the exercise, then log what you managed and tick “passed” when you meet the goal.") : null,
      plan.overridden ? h("p", { class: "hint" }, "Changed from the plan for this session only. ",
        h("button", { type: "button", class: "link", onclick: () => { sc.override = null; save(); reopen(); } }, "Back to the plan")) : null),
    h("div", { class: "row" },
      h("button", { type: "button", class: "primary", onclick: () => { ui.closeSheet(); app.startSession(); ui.toast(`Lesson ${plan.lesson}: ${sc.sessionMinutes} min. Put some music on.`, 2500); } },
        app.session ? "Restart session" : `Start ${sc.sessionMinutes}-min session`),
      plan.lesson !== state.lesson ? h("button", { type: "button", onclick: () => {
        sc.log.push({ type: "jump", id: `j${Date.now()}`, lesson: plan.lesson, date: new Date().toISOString(), notes: "moved by hand" });
        sc.override = null; save(); reopen();
      } }, `Make Lesson ${plan.lesson} my lesson`) : null,
      h("button", { type: "button", onclick: () => { ui.closeSheet(); s.trainer.kind = "free"; s.trainer.leaveIsCrash = false; ui.changed("trainer-restart"); ui.toast("Play time: fly anything", 1600); } }, "Play time")));

  // ---- log ----
  const rows = [...sc.log].map((e, i) => [e, i]).reverse();
  out.push(h("h2", {}, "Log"),
    rows.length ? h("div", { class: "log" }, rows.map(([e, i]) => logRow(ui, sc, e, i))) : h("p", { class: "hint" }, "Sessions you finish are logged here automatically. Tap one to edit it."),
    h("div", { class: "row" },
      h("button", { type: "button", onclick: () => editEntry(ui, { type: "session", id: `m${Date.now()}`, date: new Date().toISOString(), minutes: sc.sessionMinutes, ...pick(plan), crashes: 0, outOfArea: 0, notes: "" }, null) }, "Add entry"),
      sc.log.length ? h("button", { type: "button", onclick: () => download("flight-school-log.csv", toCSV(sc.log), "text/csv") }, "Export CSV") : null));
  out.push(backupBlock(ui, s));

  // ---- course settings ----
  out.push(h("details", {}, h("summary", {}, "Course settings"),
    slider("Session length", 5, 20, 1, sc.sessionMinutes, (v) => { sc.sessionMinutes = v; save(); }, (v) => `${v} min`),
    slider("Rest between sessions", 0, 30, 1, sc.restMinutes, (v) => { sc.restMinutes = v; save(); }, (v) => `${v} min`),
    seg("Hover area", [[2, "2 m"], [3, "3 m"], [4, "4 m"]], sc.circle, (v) => { sc.circle = +v; save(); }),
    h("p", { class: "hint" }, "In hover lessons, leaving the area counts as a crash and resets the heli, as in HELI-X."),
    h("button", { type: "button", onclick: () => { if (confirm("Delete the whole log and start the course again?")) { sc.deleted = [...(sc.deleted || []), ...sc.log.map(entryKey)]; sc.log = []; sc.override = null; save(); reopen(); } } }, "Start the course over")));
  return out;
}

const pick = (p) => ({ lesson: p.lesson, orientation: p.orientation, direction: p.direction, speed: p.speed, collAssist: p.collAssist, rudderAssist: p.rudderAssist });

function logRow(ui, sc, e, i) {
  const d = new Date(e.date);
  const when = `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  if (e.type === "jump") {
    return h("div", { class: "log-row jump" }, h("span", {}, when), h("span", {}, `→ Lesson ${e.lesson}`),
      h("button", { type: "button", class: "link", onclick: () => { removeAt(sc, i); ui.changed("school"); ui.openSheet("school"); } }, "Undo"));
  }
  const hover = lessonById(e.lesson).kind === "hover";
  const what = hover
    ? `${e.orientation === "inverted" ? "Inv" : "Up"} ${dirLabel(e.direction)} · ${e.speed}% · ${e.collAssist ? "sim coll" : "own coll"}${e.rudderAssist === false ? " · own rudder" : ""}`
    : "free flight";
  return h("button", { type: "button", class: "log-row", onclick: () => editEntry(ui, e, i) },
    h("span", {}, when), h("span", {}, `L${e.lesson} · ${what}`),
    h("b", { class: e.crashes === 0 ? "ok" : "" }, `${e.crashes} crash${e.crashes === 1 ? "" : "es"}`),
    e.notes ? h("small", {}, e.notes) : null);
}

/** Edit (or add, when index is null) a log entry in the overlay card. */
export function editEntry(ui, entry, index, { title = index == null ? "Add log entry" : "Edit log entry", onDone } = {}) {
  const sc = ui.app.settings.school;
  const e = structuredClone(entry);
  const wiz = ui.el.wizard;
  const hoverLesson = () => lessonById(e.lesson).kind === "hover";
  let passed = false;
  const num = (label, k, step = 1) => h("label", { class: "field" }, h("span", { class: "lbl" }, label),
    h("input", { type: "number", min: 0, step, value: e[k], oninput: (ev) => { e[k] = +ev.target.value; } }));
  const render = () => {
    const hover = hoverLesson();
    wiz.replaceChildren(h("div", { class: "wiz-card" },
      h("p", { class: "wiz-text" }, title),
      h("label", { class: "field" }, h("span", { class: "lbl" }, "Lesson"),
        h("select", { onchange: (ev) => { e.lesson = ev.target.value; render(); } }, LESSONS.map((l) => h("option", { value: l.id, selected: l.id === e.lesson }, `${l.id}. ${l.title}`)))),
      h("label", { class: "field" }, h("span", { class: "lbl" }, "Date and time"),
        h("input", { type: "datetime-local", value: localInput(e.date), onchange: (ev) => { if (ev.target.value) e.date = new Date(ev.target.value).toISOString(); } })),
      num("Length (min)", "minutes", 0.5),
      hover ? seg("Orientation", ORIENT, e.orientation, (v) => { e.orientation = v; }) : null,
      hover ? seg("Direction", DIRS, e.direction, (v) => { e.direction = v; }) : null,
      hover ? num("Sim speed (%)", "speed", 5) : null,
      num("Crashes (including out of area)", "crashes"),
      hover ? toggle("Trainer flew the collective", e.collAssist, (v) => { e.collAssist = v; }) : null,
      hover ? toggle("Trainer turned the rudder", e.rudderAssist, (v) => { e.rudderAssist = v; }) : null,
      h("label", { class: "field" }, h("span", { class: "lbl" }, hover ? "Comments" : "What you flew (e.g. 5 CW, 4 CCW circles)"),
        h("textarea", { rows: 3, oninput: (ev) => { e.notes = ev.target.value; } }, e.notes || "")),
      !hover && e.lesson === planNext(sc).state.lesson ? toggle(`I passed Lesson ${e.lesson}`, passed, (v) => { passed = v; }, lessonById(e.lesson).goal) : null,
      h("div", { class: "row" },
        index != null ? h("button", { type: "button", onclick: () => { removeAt(sc, index); done(); } }, "Delete") : h("button", { type: "button", onclick: () => { wiz.hidden = true; onDone?.(false); } }, "Discard"),
        h("button", { type: "button", class: "primary", onclick: () => {
          e.crashes = Math.max(0, Math.round(e.crashes || 0));
          const oldKey = entryKey(entry);
          e.id ||= `m${Date.now()}`;
          e.editedAt = new Date().toISOString();
          if (index != null) { sc.log.splice(index, 1); if (entryKey(e) !== oldKey) sc.deleted = [...(sc.deleted || []), oldKey]; }
          insertByDate(sc.log, e);
          if (passed) sc.log.push({ type: "jump", id: `j${Date.now()}`, lesson: nextLessonId(e.lesson), date: new Date(new Date(e.date).getTime() + 1).toISOString(), notes: `passed ${e.lesson}` });
          done(true);
        } }, "Save to log"))));
  };
  const done = (saved = true) => {
    wiz.hidden = true;
    ui.changed("school");
    onDone ? onDone(saved) : ui.openSheet("school");
  };
  wiz.hidden = false;
  render();
}

/** Remove an entry, leaving a tombstone so the deletion also reaches the cloud copy. */
function removeAt(sc, i) {
  const [e] = sc.log.splice(i, 1);
  if (e) sc.deleted = [...(sc.deleted || []), entryKey(e)];
}

function insertByDate(log, e) {
  const t = new Date(e.date).getTime();
  const i = log.findIndex((x) => new Date(x.date).getTime() > t);
  i < 0 ? log.push(e) : log.splice(i, 0, e);
}

function localInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function download(name, text, type) {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** After a session: confirm or edit the automatic log entry, then show what's next. */
export function sessionEndCard(ui, entry) {
  ui.app.paused = true;
  editEntry(ui, entry, null, {
    title: `Session done: ${entry.minutes} min, ${entry.crashes} crash${entry.crashes === 1 ? "" : "es"}. Check the log entry.`,
    onDone: (saved) => {
      ui.openSheet("school");
      if (saved) ui.toast("Logged. Now it's play time!", 2200);
    },
  });
}

// ---------- backup: files and the pilot's Vercel Blob store ----------
function backupBlock(ui, s) {
  const sc = s.school, b = s.backup, app = ui.app;
  const reopen = () => ui.openSheet("school");
  const file = h("input", { type: "file", accept: ".csv,.json,text/csv,application/json", hidden: true, onchange: async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      const got = parseImport(await f.text());
      const before = sc.log.length;
      Object.assign(sc, mergeLogs(sc, got));
      let msg = `Imported: ${sc.log.length - before} new entr${sc.log.length - before === 1 ? "y" : "ies"}.`;
      if (got.settings && confirm("This is a full backup. Also restore its settings (heli, sticks, view, transmitter)?")) {
        app.restoreSettings(got.settings);
        msg += " Settings restored.";
      }
      ui.changed("school");
      ui.toast(msg, 2500);
    } catch (e) { ui.toast(e.message || "Couldn't read that file", 3500); }
    reopen();
  } });
  const tokenIn = h("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: "vercel_blob_rw_\u2026", value: b.token || "",
    onchange: (ev) => { b.token = ev.target.value.trim(); ui.changed("misc"); reopen(); } });
  const status = b.lastError ? h("p", { class: "callout warn" }, `Cloud backup: ${b.lastError}`)
    : b.lastAt ? h("p", { class: "hint" }, `Last backed up ${new Date(b.lastAt).toLocaleString()}.`) : null;
  const ready = looksLikeToken(b.token);
  return h("details", {}, h("summary", {}, "Backup and other devices"),
    h("div", { class: "row" },
      h("button", { type: "button", onclick: () => download(`rc-flight-sim-backup-${new Date().toISOString().slice(0, 10)}.json`, exportJSON(s), "application/json") }, "Export full backup (JSON)"),
      h("button", { type: "button", onclick: () => file.click() }, "Import CSV or JSON"), file),
    h("p", { class: "hint" }, "Importing merges into your log: nothing already here is lost, and entries you have in both places aren't doubled."),
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Vercel Blob token (your backup password)"), tokenIn),
    b.token && !ready ? h("p", { class: "callout warn" }, "That doesn't look like a Blob read-write token: it starts with vercel_blob_rw_.") : null,
    toggle("Back up automatically", b.auto, (v) => { b.auto = v; ui.changed("misc"); }, "after every log change, and merge from the cloud when the app opens"),
    h("div", { class: "row" },
      h("button", { type: "button", disabled: !ready, onclick: async () => { await app.cloudSync({ manual: true }); reopen(); } }, "Sync now"),
      h("button", { type: "button", disabled: !ready, onclick: async () => {
        if (!confirm("Restore settings too (heli, sticks, view, transmitter) from the cloud backup? Your log is merged either way.")) { await app.cloudSync({ manual: true }); reopen(); return; }
        await app.cloudSync({ manual: true, restoreSettings: true }); reopen();
      } }, "Restore from cloud")),
    status,
    h("details", {}, h("summary", {}, "How to get a token"),
      h("ol", {},
        h("li", {}, "In Vercel, open Storage and create a Blob store (private is best). It doesn't need to be connected to this project."),
        h("li", {}, "Open the store's .env.local tab (or Settings) and copy BLOB_READ_WRITE_TOKEN."),
        h("li", {}, "Paste it here on each device you fly on. Anyone with the token can read and replace your backup, so treat it like a password."),
        h("li", {}, "The token is kept only in this browser. The app's /api/backup function uses it for each request and stores nothing; your backup is the file rc-flight-sim/backup.json in your store, plus a copy per day."))));
}
