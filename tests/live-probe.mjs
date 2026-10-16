// בדיקת תקשורת חיה מדפדפן אמיתי (רצה ב-GitHub Actions): האם אפשר לצלם את המפה לתמונה, והאם Overpass/Nominatim עונים לדפדפן.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = process.argv[2] || "data/source/live-probe";
fs.mkdirSync(OUT, { recursive: true });
const res = { at: new Date().toISOString(), checks: {} };
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("https://icd-org.github.io/notam-map-/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(e => { res.checks.origin = "goto failed: " + e.message; });

res.checks.tiles = await page.evaluate(async () => {
  const out = {};
  const tiles = {
    esri_world_imagery: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/52471/76336",
    osm: "https://tile.openstreetmap.org/17/76336/52471.png"
  };
  // x/y לפי תל אביב בקירוב; הערך המדויק אינו חשוב — רק היכולת לטעון וקרוא פיקסלים
  for (const [k, url] of Object.entries(tiles)) {
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => no(new Error("load error")); i.src = url; setTimeout(() => no(new Error("timeout")), 20000); });
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      let tainted = false; try { g.getImageData(0, 0, 1, 1); c.toDataURL("image/png"); } catch (e) { tainted = true; }
      out[k] = { loaded: true, w: img.naturalWidth, h: img.naturalHeight, canvasReadable: !tainted };
    } catch (e) { out[k] = { loaded: false, error: String(e.message || e) }; }
  }
  return out;
});

res.checks.overpass = await page.evaluate(async () => {
  const q = '[out:json][timeout:25];nwr(around:200,32.099128,34.816617)[power=line];out tags 3;';
  const r = {};
  for (const m of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]) {
    try {
      const c = new AbortController(); setTimeout(() => c.abort(), 40000);
      const x = await fetch(m, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: c.signal });
      const j = await x.json(); r[m] = { status: x.status, elements: (j.elements || []).length };
    } catch (e) { r[m] = { error: String(e.message || e) }; }
  }
  return r;
});

res.checks.nominatim = await page.evaluate(async () => {
  try {
    const x = await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=32.099128&lon=34.816617&zoom=18&accept-language=he&addressdetails=1");
    const j = await x.json(); return { status: x.status, name: j.display_name };
  } catch (e) { return { error: String(e.message || e) }; }
});

fs.writeFileSync(OUT + "/result.json", JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
await browser.close();
