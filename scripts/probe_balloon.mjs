// בדיקה חד-פעמית: האם ב-OpenStreetMap מסומן בלון מעוגן / אטרקציה סביב הירקון
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const C = require("../request/core.js");
const UA = "icd-notam-map/1.0 (https://github.com/icd-org/notam-map-)";
const f = (u, o) => fetch(u, { ...(o || {}), headers: { "User-Agent": UA, ...((o && o.headers) || {}) } });
const wait = ms => new Promise(r => setTimeout(r, ms));
const c = "32.099128,34.816617";
const Q = {
  by_name: `[out:json][timeout:60];nwr(around:3500,${c})[~"^(name|name:he|name:en|alt_name|description)$"~"בלון|בלונ|balloon|Balloon|בועה|בועת|dome",i];out center tags;`,
  attractions: `[out:json][timeout:60];(nwr(around:3500,${c})[tourism~"attraction|theme_park|zoo"];nwr(around:3500,${c})[attraction];nwr(around:3500,${c})[aerialway];nwr(around:3500,${c})[man_made~"balloon|tethered|mast|tower"];nwr(around:3500,${c})["aeroway"];);out center tags;`,
  structures: `[out:json][timeout:60];(nwr(around:2500,${c})[building~"dome|stadium|sports_hall|roof|hangar"];nwr(around:2500,${c})[leisure~"stadium|sports_centre|water_park|amusement|park"][name];nwr(around:2500,${c})[amenity~"events_venue|exhibition_centre|conference_centre|theatre"];);out center tags;`
};
const out = {};
for (const [k, q] of Object.entries(Q)) {
  try {
    const { data, mirror } = await C.overpass(q, { fetch: f, wait });
    out[k] = { mirror, count: data.elements.length, items: data.elements.map(e => ({ type: e.type, id: e.id, lat: e.lat || (e.center && e.center.lat), lon: e.lon || (e.center && e.center.lon), tags: e.tags })) };
  } catch (e) { out[k] = { error: e.message }; }
  console.log(k, out[k].error || out[k].count);
  await wait(3000);
}
fs.mkdirSync("tests/fixtures/probe", { recursive: true });
fs.writeFileSync("tests/fixtures/probe/balloon.json", JSON.stringify(out, null, 1));
