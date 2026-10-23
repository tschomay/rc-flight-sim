// Backups of the flight-school log (and optionally settings): CSV/JSON files, and a cloud
// copy in the pilot's own Vercel Blob store through /api/backup. The Blob read-write token
// is the pilot's password: it lives only in this browser and is sent to our function,
// which uses it for the one request and keeps nothing.
//
// Logs from two places are merged, never overwritten: entries are matched by id, the most
// recently edited copy wins, and deletions travel as tombstones (school.deleted).

import { toCSV } from "./school.js";

export const BACKUP_VERSION = 1;

/** Stable key for an entry; older entries from before ids were added fall back to type+date. */
export const entryKey = (e) => e.id || `${e.type}@${e.date}`;

export function mergeLogs(a, b) {
  const deleted = [...new Set([...(a.deleted || []), ...(b.deleted || [])])];
  const gone = new Set(deleted);
  const byKey = new Map();
  for (const e of [...a.log, ...b.log]) {
    const k = entryKey(e);
    if (gone.has(k)) continue;
    const prev = byKey.get(k);
    if (!prev || (e.editedAt || "") > (prev.editedAt || "")) byKey.set(k, e);
  }
  const log = [...byKey.values()].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return { log, deleted };
}

/** Everything worth keeping, minus the cloud token. */
export function backupData(settings) {
  const s = structuredClone(settings);
  delete s.backup;
  return { app: "rc-flight-sim", version: BACKUP_VERSION, savedAt: new Date().toISOString(), settings: s };
}

export function exportJSON(settings) { return JSON.stringify(backupData(settings), null, 1); }
export { toCSV };

const NUM = ["minutes", "speed", "crashes", "outOfArea"];
const BOOL = ["collAssist", "rudderAssist"];

/** Parse a CSV written by toCSV (quoted fields, embedded commas, quotes and newlines). */
export function parseCSV(text) {
  const rows = [];
  let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ""));
  if (!head || !head.includes("date") || !head.includes("lesson")) throw new Error("That CSV isn't a flight-school log export.");
  return body.map((r) => {
    const e = {};
    head.forEach((k, i) => { if (r[i] !== undefined && r[i] !== "") e[k] = r[i]; });
    for (const k of NUM) if (k in e) e[k] = +e[k];
    for (const k of BOOL) if (k in e) e[k] = e[k] === "true";
    if (e.tally) { try { e.tally = JSON.parse(e.tally); } catch { delete e.tally; } }
    e.type ||= "session";
    if (e.notes == null) e.notes = "";
    return e;
  });
}

/**
 * Read an import file. Returns { log, deleted, settings? } where settings is present only
 * for a JSON backup.
 */
export function parseImport(text) {
  const t = text.trim();
  if (t.startsWith("{")) {
    const d = JSON.parse(t);
    const sc = d.settings?.school;
    if (d.app !== "rc-flight-sim" || !sc) throw new Error("That file isn't an rc-flight-sim backup.");
    return { log: sc.log || [], deleted: sc.deleted || [], settings: d.settings };
  }
  return { log: parseCSV(t), deleted: [] };
}

// ---------- cloud (Vercel Blob through /api/backup) ----------

export const looksLikeToken = (t) => /^vercel_blob_rw_\S+$/.test((t || "").trim());

async function call(method, token, body) {
  const res = await fetch("/api/backup", {
    method,
    headers: { authorization: `Bearer ${token.trim()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 404 && method === "GET") return null;
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error || text; } catch { /* plain text */ }
    throw new Error(msg || `Backup failed (${res.status})`);
  }
  return text ? JSON.parse(text) : null;
}

export const cloudLoad = (token) => call("GET", token);
export const cloudSave = (token, settings) => call("POST", token, backupData(settings));
