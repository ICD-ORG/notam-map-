/* Service Worker — מפת נוט"ם (הראשית): עבודה גם ללא רשת.
   מטמון בשם ייחודי לאפליקציה הזו: ה-SW של אפליקציית החברים (members-nx72) הוא בעל קידומת אחרת,
   ושניהם מוחקים רק מטמונים משלהם — כך הם לא מוחקים זה את זה.
   אסטרטגיה: רשת קודם (עם revalidation — לא מתקבל קובץ ישן ממטמון ה-HTTP של GitHub Pages), עם timeout של 4 שניות שאחריו
   מוגש המטמון (והרשת ממשיכה ומעדכנת אותו ברקע). Leaflet מה-CDN: מהמטמון קודם (גרסה קבועה). */
const PREFIX = "preview-main-";
const CACHE = PREFIX + "v5";
const BUILD = "20261004";   // חייב להיות זהה ל-BUILD ב-index.html, ל-PMT_BUILD ב-pmt-layer.js ול-?v= שלו ושל קבצי הנתונים
const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
const LEAFLET_CDN = /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\//;
const NET_TIMEOUT = 4000, NET_SLOW_TIMEOUT = 900;
let slowUntil = 0;   // עד מתי הרשת נחשבת איטית (אחרי חריגה מהזמן)
/* קבצים שנשמרים מראש (כדי שגם אחרי ביקור יחיד האפליקציה תעבוד בלי רשת) */
const SHELL = ["./", "./manifest.json", "./icon-192.png", "./pmt-layer.js?v=" + BUILD, "../notam-data.json",
  "./data/pmt-zones.json?v=" + BUILD, "./data/inpa-zones.json?v=" + BUILD, "./translate-dict.json"];
const CDN_SHELL = [LEAFLET + "leaflet.min.js", LEAFLET + "leaflet.min.css"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled([
    // cache:"reload" — תמיד העותק העדכני מהרשת (לא ממטמון ה-HTTP)
    ...SHELL.map(u => c.add(new Request(u, { cache: "reload" }))),
    // Leaflet נשמר כ-cors (בלי opaque) כדי שאפשר יהיה להגיש אותו אופליין
    ...CDN_SHELL.map(u => fetch(u, { mode: "cors", credentials: "omit" }).then(r => r.ok ? c.put(u, r) : null))
  ])));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  /* מוחקים רק מטמונים של האפליקציה הראשית (גרסאות ישנות, כולל השמות הישנים notam-v2/v3) */
  e.waitUntil(caches.keys().then(ks => Promise.all(ks
    .filter(k => (k.startsWith(PREFIX) && k !== CACHE))
    .map(k => caches.delete(k)))));
  self.clients.claim();
});

/* מפתח המטמון: לניווט — תמיד כתובת האפליקציה (בלי query: אין צבירת עותק לכל ?fbclid/?utm/?r), לשאר — בלי הפרמטר t= (notam-data.json?t=...) */
function cacheKey(req, url) {
  if (req.mode === "navigate") return self.registration.scope;
  const u = new URL(url.href);
  u.searchParams.delete("t");
  return u.href;
}

async function store(key, res) {
  try {
    const c = await caches.open(CACHE), u = new URL(key);
    // מסירים גרסאות ישנות של אותו נתיב (למשל ?v= קודם)
    if (u.search) {
      const ks = await c.keys();
      await Promise.all(ks.filter(k => { const x = new URL(k.url); return x.origin === u.origin && x.pathname === u.pathname && k.url !== key; }).map(k => c.delete(k)));
    }
    await c.put(key, res);
  } catch (err) {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function handle(e, req, url, key, cdn) {
  const c = await caches.open(CACHE);
  let hit = await c.match(key);
  if (cdn && hit) return hit;
  const nav = req.mode === "navigate";
  const netReq = cdn ? fetch(req.url, { mode: "cors", credentials: "omit" })
    : nav ? fetch(req.url, { cache: "no-cache", credentials: "same-origin", redirect: "manual" })
    : fetch(req, { cache: "no-cache" });          // revalidation (ETag → 304 זול) — לא קובץ ישן ממטמון ה-HTTP
  const net = netReq.then(r => {
    if (r && r.status === 200 && (r.type === "basic" || r.type === "cors")) e.waitUntil(store(key, r.clone()));
    return r;
  });
  net.catch(() => {});
  if (!hit && !nav) hit = await c.match(req, { ignoreSearch: true });   // למשל ?v= ישן של אותו קובץ
  if (!hit && nav) hit = await c.match(self.registration.scope);
  if (!hit) return net.catch(() => Response.error());      // אין במטמון: מחכים לרשת; כשלון = כשלון רשת (לא HTML בטעות)
  /* יש מטמון: רשת קודם, אבל לא מחכים יותר מ-NET_TIMEOUT (הרשת ממשיכה ומעדכנת את המטמון ברקע).
     אחרי שבקשה אחת חרגה מהזמן, הבקשות הבאות (טעינת הדף היא שרשרת של בקשות) מחכות פחות — אחרת רשת מתה מצטברת ל-4 שניות לכל חוליה */
  e.waitUntil(net.catch(() => {}));
  let answered = false;
  const r = await Promise.race([
    net.then(x => { answered = true; return x; }, () => { answered = true; return null; }),
    sleep(Date.now() < slowUntil ? NET_SLOW_TIMEOUT : NET_TIMEOUT).then(() => null)
  ]);
  slowUntil = answered ? 0 : Date.now() + 60000;
  return r && r.status < 500 ? r : hit;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url), cdn = LEAFLET_CDN.test(req.url);
  if (url.origin !== location.origin && !cdn) return;   // אריחי מפה, גופנים וכל שאר הבקשות החיצוניות — ישירות מהדפדפן
  if (!cdn && url.pathname.includes("/members-nx72/")) return;   // לאפליקציית החברים יש SW משלה
  e.respondWith(handle(e, req, url, cdn ? req.url : cacheKey(req, url), cdn));
});
