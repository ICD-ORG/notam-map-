/* Service Worker — מפת פמ"ת א-17: עבודה גם ללא רשת.
   רשת קודם (network-first) לכל דבר — בלי cache-first: קבצי האתר והנתונים תמיד טריים כשיש קליטה,
   והמטמון משמש רק גיבוי כשאין רשת. נשמרות רק תשובות תקינות (לא שגיאות ולא opaque), ואריחי המפה לא נשמרים בכלל.
   למטמון קידומת ייחודית לאפליקציה הזו — SW של המפה הראשית לא מוחק אותו, וכאן לא נמחק מטמון של אחרים. */
const PREFIX = "a17-members-";
const CACHE = PREFIX + "v2";
const LEGACY = ["notam-v1"];   // השם הישן של המטמון של אפליקציה זו
const LEAFLET_CDN = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\//;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(["./", "./manifest.json"].map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => (k.startsWith(PREFIX) && k !== CACHE) || LEGACY.includes(k)).map(k => caches.delete(k))
  )));
  self.clients.claim();
});

/* מפתח קבוע לקובץ הנוט"מים (גם אם נוסף לו ?t=) — בלי צבירת עותקים */
function cacheKey(url) {
  return /notam-data\.json$/.test(url.pathname) ? url.origin + url.pathname : url.href;
}

async function store(url, res) {
  try {
    if (!res || !res.ok || res.status !== 200 || res.type === "opaque") return;
    const c = await caches.open(CACHE), key = cacheKey(url);
    // מסירים גרסאות ישנות של אותו נתיב (למשל ?v= קודם)
    const ks = await c.keys();
    await Promise.all(ks.filter(k => { const u = new URL(k.url); return u.origin === url.origin && u.pathname === url.pathname && k.url !== key; }).map(k => c.delete(k)));
    await c.put(key, res);
  } catch (err) {}
}

async function fromCache(req, url) {
  const c = await caches.open(CACHE);
  return (await c.match(cacheKey(url))) || (await c.match(req, { ignoreSearch: true })) ||
         (req.mode === "navigate" ? await c.match("./") : undefined) || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url), cdn = LEAFLET_CDN.test(req.url);
  if (url.origin !== location.origin && !cdn) return;   // אריחי מפה וכל שאר הבקשות החיצוניות — ישירות מהדפדפן, בלי מטמון
  e.respondWith(
    // Leaflet מה-CDN נטען כברירת מחדל ב-no-cors (opaque) — מבקשים cors כדי שאפשר יהיה לשמור אותו לאופליין
    (cdn ? fetch(req.url, { mode: "cors", credentials: "omit" }) : fetch(req))
      .then(r => { if (r.ok) e.waitUntil(store(url, r.clone())); return r; })
      .catch(() => fromCache(req, url))
  );
});
