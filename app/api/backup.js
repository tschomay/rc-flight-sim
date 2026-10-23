// Cloud backup for the flight-school log, stored in the pilot's own Vercel Blob store.
// The caller sends that store's read-write token as a bearer token: it is the pilot's
// password. This function keeps nothing and uses the token only for the one request, so
// one deployment serves any pilot with their own store.
//
// GET  → the latest backup JSON (404 if none yet)
// POST → save the backup JSON: the latest copy, plus one copy per day as a safety net

import { put, get } from "@vercel/blob";

const LATEST = "rc-flight-sim/backup.json";
const daily = () => `rc-flight-sim/daily/${new Date().toISOString().slice(0, 10)}.json`;
const MAX_BYTES = 2_000_000;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

function tokenOf(request) {
  const t = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return /^vercel_blob_rw_\S+$/.test(t) ? t : null;
}

// A store is either private or public; try private first and fall back.
async function withAccess(fn) {
  try { return await fn("private"); } catch (e) {
    if (!/access|public|private/i.test(String(e?.message))) throw e;
    return fn("public");
  }
}

const fail = (e) => {
  const msg = String(e?.message || e);
  const status = /token|unauthori[sz]ed|forbidden|access denied/i.test(msg) ? 401 : 502;
  return json(status, { error: status === 401 ? "The Blob token was rejected. Check it in Vercel → Storage → your Blob store." : msg });
};

export async function GET(request) {
  const token = tokenOf(request);
  if (!token) return json(401, { error: "Missing or malformed Blob token." });
  try {
    const got = await withAccess((access) => get(LATEST, { access, token, useCache: false }));
    if (!got || !got.stream) return json(404, { error: "No backup yet." });
    return new Response(got.stream, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    if (/not.?found|404/i.test(String(e?.message))) return json(404, { error: "No backup yet." });
    return fail(e);
  }
}

export async function POST(request) {
  const token = tokenOf(request);
  if (!token) return json(401, { error: "Missing or malformed Blob token." });
  const text = await request.text();
  if (text.length > MAX_BYTES) return json(413, { error: "Backup too large." });
  let data;
  try { data = JSON.parse(text); } catch { return json(400, { error: "Not JSON." }); }
  if (data?.app !== "rc-flight-sim") return json(400, { error: "Not an rc-flight-sim backup." });
  const opts = (access) => ({ access, token, contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
  try {
    await withAccess(async (access) => {
      await put(LATEST, text, opts(access));
      await put(daily(), text, opts(access));
    });
    return json(200, { ok: true, savedAt: data.savedAt });
  } catch (e) {
    return fail(e);
  }
}
