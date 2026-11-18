// Service worker: keeps the app working at the flying field with no signal. The build
// replaces the VERSION placeholder with a hash of the page, so each deploy gets a fresh cache.
// Pages are network-first (a deploy shows up as soon as there's signal), with the cached
// copy as the fallback; the other app files are cache-first. The backup API is never cached.

const VERSION = "__VERSION__";
const CACHE = `hover-trainer-${VERSION}`;
const FILES = ["./", "index.html", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hover-trainer-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/** Network, but give up after a few seconds: a weak signal at the field shouldn't stall the app. */
function fromNetwork(req, ms = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    e.respondWith(fromNetwork(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("index.html", copy)); }
        return res;
      })
      .catch(() => caches.match("index.html").then((r) => r || Response.error())));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
