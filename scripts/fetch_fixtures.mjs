// מושך נתוני OpenStreetMap אמיתיים סביב נקודות בדיקה, בדיוק עם השאילתות של האפליקציה (request/core.js).
// הפלט נשמר ב-tests/fixtures/<שם>/ ומשמש בדיקות אוטומטיות. רץ ב-GitHub Actions (בסביבת הפיתוח הרשת חסומה).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const C = require("../request/core.js");
const cfg = JSON.parse(fs.readFileSync("data/request-config.json", "utf8"));
const UA = "icd-notam-map/1.0 (https://github.com/icd-org/notam-map-)";

const POINTS = [
  { name: "yarkon", lat: 32.099128, lon: 34.816617, R: 200 },
  { name: "metula", lat: 33.2790, lon: 35.5780, R: 100 },
  { name: "nitzana", lat: 30.8870, lon: 34.4240, R: 100 },
  { name: "hula", lat: 33.0900, lon: 35.6000, R: 300 }
];
const only = process.argv[2];
const outRoot = "tests/fixtures";
let failed = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
const f = (u, o) => fetch(u, { ...(o || {}), headers: { "User-Agent": UA, ...((o && o.headers) || {}) } });

for (const p of POINTS) {
  if (only && only !== p.name) continue;
  const dir = `${outRoot}/${p.name}`; fs.mkdirSync(dir, { recursive: true });
  const q = C.buildQueries(p.lat, p.lon, p.R, cfg), meta = { name: p.name, lat: p.lat, lon: p.lon, R: p.R, fetched_utc: new Date().toISOString(), errors: [] };
  for (const k of ["near", "far", "ext"]) {
    try {
      const { data, mirror } = await C.overpass(q[k], { fetch: f, log: s => console.log(p.name, k, s), wait });
      fs.writeFileSync(`${dir}/${k}.json`, JSON.stringify(data));
      meta[k] = { mirror, elements: data.elements.length, osm_base: data.osm3s && data.osm3s.timestamp_osm_base };
      console.log(p.name, k, data.elements.length, "elements via", mirror);
    } catch (e) { meta.errors.push(k + ": " + e.message); failed++; console.log("FAIL", p.name, k, e.message); }
    await wait(3000);
  }
  try {
    const r = await f("https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({ format: "jsonv2", lat: p.lat, lon: p.lon, zoom: 18, "accept-language": "he", addressdetails: 1 }));
    const j = await r.json(); fs.writeFileSync(`${dir}/reverse.json`, JSON.stringify(j)); meta.reverse = j.display_name;
  } catch (e) { meta.errors.push("reverse: " + e.message); failed++; }
  fs.writeFileSync(`${dir}/meta.json`, JSON.stringify(meta, null, 1));
  await wait(2000);
}
process.exit(failed ? 1 : 0);
