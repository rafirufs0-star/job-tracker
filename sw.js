/* Service worker: caches the whole app so every feature works offline. Change CACHE when you publish new files, so users get the update. */
const CACHE = "job-tracker-v1";
const FILES = [
  "./", "index.html", "manifest.webmanifest", "app.css",
  "util.js", "i18n.js", "db.js", "store.js", "csv.js", "ics.js", "app.js",
  "locale-en.js", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => (req.mode === "navigate" ? caches.match("index.html") : undefined));
    })
  );
});
