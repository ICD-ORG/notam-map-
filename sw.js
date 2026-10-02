/* Service Worker — מפת נוט"מ: עבודה גם ללא רשת */
const CACHE = "notam-v3";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "./manifest.json", "./pmt-layer.js"])));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // קודם רשת (תמיד הגרסה העדכנית), ואם אין קליטה — מהמטמון
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("./")))
  );
});
