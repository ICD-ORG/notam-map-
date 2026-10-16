// בדיקת שאילתות Overpass לגבולות מדינה (חד-פעמית): איזו שאילתה מחזירה את גבול לבנון/מצרים/סוריה ליד נקודות בדיקה.
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../request/core.js");
const UA = "icd-notam-map/1.0 (https://github.com/icd-org/notam-map-)";
const f = (u, o) => fetch(u, { ...(o || {}), headers: { "User-Agent": UA, ...((o && o.headers) || {}) } });
const wait = ms => new Promise(r => setTimeout(r, ms));
const POINTS = { metula: [33.279, 35.578], nitzana: [30.887, 34.424], golan: [33.10, 35.82], sderot: [31.52, 34.60] };
const bb = (la, lo, km) => { const d = km / 111, e = km / (111 * Math.cos(la * Math.PI / 180)); return [la - d, lo - e, la + d, lo + e].map(v => v.toFixed(5)).join(","); };
const out = {};
for (const [n, [la, lo]] of Object.entries(POINTS)) {
  const c = la + "," + lo, box = bb(la, lo, 7);
  const Q = {
    ways_admin: `[out:json][timeout:60];way(around:7000,${c})["boundary"="administrative"];out tags 40;`,
    ways_admin2: `[out:json][timeout:60];way(around:7000,${c})["boundary"="administrative"]["admin_level"="2"];out tags 40;`,
    rels_admin2: `[out:json][timeout:60];rel(around:7000,${c})["boundary"="administrative"]["admin_level"="2"];out tags;`,
    rels_admin2_geom: `[out:json][timeout:90];rel(around:7000,${c})["boundary"="administrative"]["admin_level"="2"];out geom(${box}) tags;`,
    ways_border_type: `[out:json][timeout:60];way(around:7000,${c})["border_type"];out tags 40;`,
    ways_any_adm_geom: `[out:json][timeout:60];way(around:7000,${c})["boundary"="administrative"]["admin_level"~"^[2-3]$"];out geom(${box}) tags;`
  };
  out[n] = {};
  for (const [k, q] of Object.entries(Q)) {
    try {
      const { data, mirror } = await C.overpass(q, { fetch: f, wait, rounds: 1 });
      out[n][k] = { mirror, count: data.elements.length, sample: data.elements.slice(0, 12).map(e => ({ type: e.type, id: e.id, tags: e.tags, geom: e.geometry ? e.geometry.length : (e.members ? e.members.filter(m => m.geometry).length + "/" + e.members.length : 0) })) };
    } catch (e) { out[n][k] = { error: e.message }; }
    console.log(n, k, JSON.stringify(out[n][k]).slice(0, 300));
    await wait(2500);
  }
}
fs.mkdirSync("tests/fixtures/probe", { recursive: true });
fs.writeFileSync("tests/fixtures/probe/borders.json", JSON.stringify(out, null, 1));
