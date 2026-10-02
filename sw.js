/* Service Worker — מפת נוט"ם (הראשית): עבודה גם ללא רשת.
   מטמון בשם ייחודי לאפליקציה הזו: ה-SW של אפליקציית החברים (members-nx72) הוא בעל קידומת אחרת,
   ושניהם מוחקים רק מטמונים משלהם — כך הם לא מוחקים זה את זה. */
const PREFIX = "notam-main-";
const CACHE = PREFIX + "v4";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(["./", "./manifest.json", "./pmt-layer.js"].map(u => c.add(u)))));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  /* מוחקים רק מטמונים של האפליקציה הראשית (גרסאות ישנות, כולל השמות הישנים notam-v2/v3) */
  e.waitUntil(caches.keys().then(ks => Promise.all(ks
    .filter(k => (k.startsWith(PREFIX) && k !== CACHE) || k === "notam-v2" || k === "notam-v3")
    .map(k => caches.delete(k)))));
  self.clients.claim();
});

/* מפתח המטמון: בלי הפרמטר t= (מונע צבירה אינסופית של notam-data.json?t=...) */
function cacheKey(url) {
  const u = new URL(url.href);
  u.searchParams.delete("t");
  return u.href;
}

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes("/members-nx72/")) return;   // לאפליקציית החברים יש SW משלה

  // קודם רשת (תמיד הגרסה העדכנית), ואם אין קליטה — מהמטמון. שומרים רק תשובות תקינות (200, אותו origin)
  const key = cacheKey(url);
  e.respondWith(
    fetch(e.request).then(r => {
      if (r && r.status === 200 && r.type === "basic") {
        const cp = r.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(key, cp)));
      }
      return r;
    }).catch(() => caches.open(CACHE).then(c =>
      c.match(key).then(r => r || c.match(key, { ignoreSearch: true })).then(r => r || c.match("./"))))
  );
});
