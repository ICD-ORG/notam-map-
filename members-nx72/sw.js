/* Service Worker — מפת פמ"ת א-17: עבודה גם ללא רשת.
   רשת קודם (network-first) לכל דבר — בלי cache-first: קבצי האתר והנתונים תמיד טריים כשיש קליטה, והמטמון משמש גיבוי.
   * הבקשות לרשת הן עם revalidation (cache:'no-cache' — 304 זול עם ETag), כדי שה-max-age=600 של GitHub Pages לא ייצור
     שילוב של דף חדש עם קובץ ישן מה-HTTP cache.
   * timeout של ~4 שניות: ברשת איטית/מתה מוצג מיד מה שבמטמון, והרשת ממשיכה ברקע ומעדכנת את המטמון.
   * ב-install נשמרים מראש (precache) הדף, קבצי הנתונים ו-Leaflet מה-CDN — כבר הביקור הראשון עובד אופליין.
   * נשמרות רק תשובות תקינות (לא שגיאות ולא opaque); אריחי המפה לא נשמרים בכלל. בקשה שאינה בדף (JSON/תמונה) שלא במטמון נכשלת — לא מחזירים לה HTML.
   למטמון קידומת ייחודית לאפליקציה הזו — SW של המפה הראשית לא מוחק אותו, וכאן לא נמחק מטמון של אחרים. */
const PREFIX = "a17-members-";
const CACHE = PREFIX + "v3";
const LEGACY = ["notam-v1"];   // השם הישן של המטמון של אפליקציה זו
const LEAFLET_CDN = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\//;
const LEAFLET_FILES = ["https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css", "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"];
const DATA_V = "20261003";   // חייב להתאים ל-?v= של data/inpa-zones.json ב-index.html
const PRECACHE = ["./", "./manifest.json", "./icon-192.png", "../notam-data.json", "../data/inpa-zones.json?v=" + DATA_V];
const NET_TIMEOUT = 4000;

/* מפתח המטמון: לבקשת ניווט — קבוע (שורש האפליקציה, בלי query ובלי index.html), כך שאין צבירת עותקים;
   קובץ הנוט"מים — גם אם נוסף לו ?t=; כל השאר — הכתובת המלאה */
function cacheKey(req, url) {
  if (req && req.mode === "navigate") return new URL("./", self.registration.scope).href;
  return /notam-data\.json$/.test(url.pathname) ? url.origin + url.pathname : url.href;
}

async function store(key, url, res) {
  try {
    if (!res || !res.ok || res.status !== 200 || res.type === "opaque") return;
    const c = await caches.open(CACHE);
    // מסירים גרסאות ישנות של אותו נתיב (למשל ?v= קודם)
    const ks = await c.keys();
    await Promise.all(ks.filter(k => { const u = new URL(k.url); return u.origin === url.origin && u.pathname === url.pathname && k.url !== key; }).map(k => c.delete(k)));
    await c.put(key, res);
  } catch (err) {}
}

async function pre(c, u, cors) {
  try {
    const url = new URL(u, self.location.href);
    const r = await fetch(url.href, cors ? { mode: "cors", credentials: "omit" } : { cache: "reload" });
    if (r.ok && r.status === 200) await c.put(cacheKey(null, url), r);
  } catch (err) {}
}

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(PRECACHE.map(u => pre(c, u, false)).concat(LEAFLET_FILES.map(u => pre(c, u, true))))));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => (k.startsWith(PREFIX) && k !== CACHE) || LEGACY.includes(k)).map(k => caches.delete(k))
  )));
  self.clients.claim();
});

async function fromCache(req, url) {
  const c = await caches.open(CACHE);
  return (await c.match(cacheKey(req, url))) || (req.mode === "navigate" ? undefined : await c.match(req, { ignoreSearch: true }));
}

function netFetch(req, cdn) {
  // Leaflet מה-CDN נטען כברירת מחדל ב-no-cors (opaque) — מבקשים cors כדי שאפשר יהיה לשמור אותו לאופליין
  if (cdn) return fetch(req.url, { mode: "cors", credentials: "omit" });
  if (req.mode === "navigate") { try { return fetch(new Request(req, { cache: "no-cache" })); } catch (err) { return fetch(req); } }
  return fetch(req, { cache: "no-cache" });
}

/* תשובת הרשת אם הגיעה תוך NET_TIMEOUT; אחרת (או בכישלון/שגיאת שרת) — מהמטמון אם יש, והרשת ממשיכה לעדכן אותו ברקע */
function race(net, req, url) {
  return new Promise(resolve => {
    let done = false;
    const fin = r => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(async () => { const c = await fromCache(req, url); if (c) fin(c); }, NET_TIMEOUT);
    net.then(async r => { if (r.status >= 500) { const c = await fromCache(req, url); fin(c || r); } else fin(r); },
             async () => { const c = await fromCache(req, url); fin(c || Response.error()); });
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url), cdn = LEAFLET_CDN.test(req.url);
  if (url.origin !== location.origin && !cdn) return;   // אריחי מפה וכל שאר הבקשות החיצוניות — ישירות מהדפדפן, בלי מטמון
  const key = cacheKey(req, url);
  const net = netFetch(req, cdn).then(r => { if (r.ok) e.waitUntil(store(key, url, r.clone())); return r; });
  e.waitUntil(net.catch(() => {}));   // שהרשת תסיים ותעדכן את המטמון גם אחרי שהוצג המטמון
  e.respondWith(race(net, req, url));
});
