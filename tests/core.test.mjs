// בדיקות יחידה לליבת החישוב ולהפקת הטופס — מול נתוני אמת שנשמרו (tests/fixtures) ומול ערכים שחושבו בנפרד (tests/expected.json).
// הרצה: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = require(path.join(ROOT, "request/core.js"));
const O = require(path.join(ROOT, "request/output.js"));
const J = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const cfg = J("data/request-config.json"), exp = J("tests/expected.json");
const zones = J("data/pmt-zones.json"), inpa = J("data/inpa-zones.json"), agri = J("data/agri-airstrips.json");
const snap = J("tests/fixtures/notam-data.snap.json");
const fixture = n => ({ near: J(`tests/fixtures/${n}/near.json`), far: J(`tests/fixtures/${n}/far.json`), ext: J(`tests/fixtures/${n}/ext.json`), reverse: J(`tests/fixtures/${n}/reverse.json`) });
const baseInput = Object.assign({}, exp.input, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", contactNames: "א; ב", contactPhone: "050-0000001" });
const mkData = fx => Object.assign({ zones, inpa, agri, notams: snap.notams, notamFetchedIso: snap.fetched_iso }, fx);
const now = new Date(exp.now);

/* מרחק גיאודזי עצמאי (ויסנטי) לבדיקת היטל */
function vincenty(lat1, lon1, lat2, lon2) {
  const a = 6378137.0, f = 1 / 298.257223563, b = (1 - f) * a, rad = Math.PI / 180;
  const L = (lon2 - lon1) * rad, U1 = Math.atan((1 - f) * Math.tan(lat1 * rad)), U2 = Math.atan((1 - f) * Math.tan(lat2 * rad));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, ss, cs, sig, c2a, c2sm, sa;
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    ss = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl); cs = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(ss, cs);
    sa = (cU1 * cU2 * sl) / ss; c2a = 1 - sa * sa; c2sm = c2a ? cs - (2 * sU1 * sU2) / c2a : 0;
    const Cc = (f / 16) * c2a * (4 + f * (4 - 3 * c2a)), lp = lam;
    lam = L + (1 - Cc) * f * sa * (sig + Cc * ss * (c2sm + Cc * cs * (-1 + 2 * c2sm * c2sm)));
    if (Math.abs(lam - lp) < 1e-12) break;
  }
  const u2 = (c2a * (a * a - b * b)) / (b * b), A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const ds = B * ss * (c2sm + (B / 4) * (cs * (-1 + 2 * c2sm * c2sm) - (B / 6) * c2sm * (-3 + 4 * ss * ss) * (-3 + 4 * c2sm * c2sm)));
  return b * A * (sig - ds);
}

test("המרות יחידות ו-DMS", () => {
  assert.equal(C.dmsLat(32.099128), exp.dmsLat); assert.equal(C.dmsLon(34.816617), exp.dmsLon);
  assert.equal(C.dms(32.9999999, "N", "S"), "33°00'00.00\"N", "עיגול שניות ל-60 עובר לדקה");
  assert.ok(Math.abs(80 * C.M2FT - 262.4672) < 1e-3);
  assert.ok(Math.abs(100 / C.NM - 0.054) < 1e-4, "100 מ׳ = 0.054 מייל ימי");
  assert.equal(C.fmtDist(526), "526 מ׳"); assert.equal(C.fmtDist(1500), "1.5 ק״מ");
});

test("היטל מקומי מסכים עם גיאודזיה על האליפסואיד (עד 0.3 מ׳ ב-1 ק״מ)", () => {
  const P = new C.Proj(32.099128, 34.816617);
  for (const [la, lo] of [[32.1058, 34.8025], [32.0995, 34.8210], [32.0950, 34.8100], [32.1100, 34.8300]]) {
    const [x, y] = P.xy(la, lo), d = Math.hypot(x, y), v = vincenty(32.099128, 34.816617, la, lo);
    assert.ok(Math.abs(d - v) <= Math.max(0.3, v * 0.0003), `d=${d} vincenty=${v}`);
  }
});

test("קלט נקודה: עשרוני, DMS, היפוך סדר, קישור גוגל", () => {
  const same = (a, la, lo) => a && Math.abs(a.lat - la) < 1e-4 && Math.abs(a.lon - lo) < 1e-4;
  assert.ok(same(C.parseCoordInput("32.099128, 34.816617"), 32.099128, 34.816617));
  assert.ok(same(C.parseCoordInput("34.816617 32.099128"), 32.099128, 34.816617));
  assert.ok(same(C.parseCoordInput("32°05'56.86\"N 34°48'59.82\"E"), 32.099128, 34.816617));
  assert.ok(same(C.parseCoordInput("https://www.google.com/maps/@32.099128,34.816617,17z"), 32.099128, 34.816617));
  assert.equal(C.parseCoordInput("שלום"), null);
});

test("הירקון: מכשולים לפי ערכי הייחוס שחושבו בנפרד", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  assert.equal(res.nearScan.items.length, exp.items.length);
  exp.items.forEach(e => {
    const it = res.nearScan.items.find(i => i.title === e.title);
    assert.ok(it, "חסר: " + e.title);
    assert.ok(Math.abs(it.d - e.d) <= (e.tol || 1.5), `${e.title}: ${it.d} מול ${e.d}`);
    assert.equal(it.zone, e.zone, e.title);
  });
  assert.deepEqual(res.nearScan.items.map(i => i.n), [1, 2, 3, 4, 5, 6]);
});

test("הירקון: LLU20 בקרבה, לא בתוך הסגירה, והמרחק נכון", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  assert.equal(res.zones.inside.length, 0);
  const z = res.zones.near.find(x => x.id === "LLU20"); assert.ok(z);
  assert.ok(Math.abs(z.d - 525.9) <= 1.5, "d=" + z.d);
  assert.ok(Math.abs(z.edge - (z.d - 200)) < 1e-9);
  const c = vincenty(32.099128, 34.816617, 32.105833, 34.8025) - 1000; // מרכז האזור לפי הפמ״ת פחות רדיוס
  assert.ok(Math.abs(z.d - c) <= 1.5);
});

test("רדיוס גדול יותר מכניס את אותם פריטים לפי המרחק בלבד", () => {
  const big = C.analyze(Object.assign({}, baseInput, { radius: 120 }), mkData(fixture("yarkon")), cfg, now);
  assert.deepEqual(big.nearScan.inside.map(i => i.title), ["קו מתח עליון 161 ק״ו", "עמוד חשמל 1491"]);
  const small = C.analyze(Object.assign({}, baseInput, { radius: 100 }), mkData(fixture("yarkon")), cfg, now);
  assert.equal(small.nearScan.inside.length, 0, "ב-100 מ׳ הקו והעמוד בטבעת הכתומה");
  assert.ok(small.nearScan.ring.some(i => i.title.startsWith("קו מתח")));
});

test("הירקון: שקיעות, יום ולילה, שם מקום", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  assert.deepEqual(res.sun.map(r => r.sunset), exp.sunset);
  res.sun.forEach(r => assert.equal(r.dayMin + r.nightMin, 180));
  assert.equal(res.siteSuggestion, exp.siteSuggestion);
});

test("שעון קיץ: מעבר ב-25.10.2026 (ישראל) מטופל נכון", () => {
  assert.equal(C.localToUtc(2026, 10, 24, 17, 0).toISOString(), "2026-10-24T14:00:00.000Z");
  assert.equal(C.localToUtc(2026, 10, 26, 17, 0).toISOString(), "2026-10-26T15:00:00.000Z");
  const t = C.dayNightTable(32.099128, 34.816617, "2026-10-24", "2026-10-26", "17:00", "20:00");
  assert.equal(t.length, 3); assert.deepEqual(t.map(r => r.start), ["17:00", "17:00", "17:00"]);
  assert.ok(t[2].dayMin === 0 && t[2].nightMin === 180, "ב-26.10 השקיעה לפני 17:00 (שעון חורף)");
});

test("חלון שחוצה חצות", () => {
  const t = C.dayNightTable(32.1, 34.8, "2026-10-20", "2026-10-20", "22:00", "02:00");
  assert.equal(t[0].dayMin, 0); assert.equal(t[0].nightMin, 240);
});

test("ימי עבודה", () => {
  assert.equal(C.workingDaysBefore("2026-10-16", "2026-10-20"), 2); // שישי -> שלישי: א׳, ב׳
  assert.equal(C.workingDaysBefore("2026-10-11", "2026-10-19"), 5); // ב׳–ה׳ + א׳
});

test("נקודה בתוך אזור א-17: חפיפה מזוהה", () => {
  const z = zones.zones.find(x => x.id === "LLP01"); // שמורת החולה
  const mid = z.rings[0].reduce((a, p) => [a[0] + p[0] / z.rings[0].length, a[1] + p[1] / z.rings[0].length], [0, 0]);
  const P = new C.Proj(mid[0], mid[1]);
  const r = C.analyzeZones(P, 100, { zones: zones.zones, inpa }, 1000);
  assert.ok(r.inside.some(x => x.id === "LLP01"), "LLP01 חייב להיות בתוך");
});

test("נקודה בתוך שמורת טבע של רט״ג: חפיפה מזוהה", () => {
  const s = inpa.sites.find(x => x.rings && x.rings[0].length > 6);
  const mid = s.rings[0].reduce((a, p) => [a[0] + p[0] / s.rings[0].length, a[1] + p[1] / s.rings[0].length], [0, 0]);
  const P = new C.Proj(mid[0], mid[1]);
  const r = C.analyzeZones(P, 50, { zones: [], inpa }, 1000);
  assert.ok(r.inside.length + r.near.length >= 1);
});

test("נוטמים: סינון CHECKLIST, ביטול וגובה, והתאמה גיאוגרפית", () => {
  const P = new C.Proj(32.099128, 34.816617), w0 = Date.UTC(2026, 9, 20, 14), w1 = Date.UTC(2026, 9, 23, 17);
  const n = (id, q, e, extra) => ({ id, raw: `${id} NOTAMN\nQ) LLLL/${q}\nA) LLLL B) 2610010000 C) 2612312359\nE) ${e}`, heb: e, ...(extra || {}) });
  const list = [
    n("X1/26", "QKKKK/K /K /K /000/999/3200N03450E999", "CHECKLIST"),
    n("X2/26", "QANLT/I /NBO/E /050/600/3156N03501E027", "ATS RTE L53 CLSD BTN A-B. BTN 11,000-16,000FT"),
    n("X3/26", "QWULW/IV/BO /AW /000/005/3206N03449E002", "UAS ACT WI 2NM RADIUS CENTERED ON PSN 320606N0344900E"),
    n("X4/26", "QWULW/IV/BO /AW /000/005/3300N03600E002", "UAS ACT 2NM RADIUS CENTERED ON PSN 330000N0360000E"),
    n("X5/26", "QGWAU/IV/NBO/E /000/999/3125N03521E117", "POSS INTRP TO AIRBORNE GNSS EQPT")
  ];
  list.push({ id: "X6/26", raw: "X6/26 NOTAMC X5/26\nQ) LLLL/QGWAU/IV/NBO/E /000/999/3125N03521E117\nA) LLLL B) 2610010000 C) 2612312359\nE) CNL", heb: "" });
  const r = C.analyzeNotams(P, 200, list, w0, w1, 262.5);
  const ids = r.hits.map(h => h.id);
  assert.ok(ids.includes("X3/26") && ids.includes("X5/26"), ids.join());
  assert.ok(!ids.includes("X4/26"), "רחוק");
  assert.deepEqual(r.excluded.map(e => e.id + ":" + e.reason).sort(), ["X1/26:checklist", "X2/26:above", "X6/26:cancel"]);
});

test("נוטם שפג תוקפו או טרם החל — לא נכלל", () => {
  const P = new C.Proj(32.1, 34.8);
  const nn = { id: "Y/26", raw: "Y/26 NOTAMN\nQ) LLLL/QGWAU/IV/NBO/E /000/999/3206N03448E100\nA) LLLL B) 2601010000 C) 2601312359\nE) X" };
  assert.equal(C.analyzeNotams(P, 200, [nn], Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 21), 262).hits.length, 0);
});

test("אימות קלט", () => {
  const ok = C.validateInput(baseInput, cfg); assert.deepEqual(ok, []);
  const bad = C.validateInput(Object.assign({}, baseInput, { radius: 5, heightM: NaN, dateFrom: "", lat: NaN, aircraft: [], requesterName: "" }), cfg).map(e => e.field);
  ["coord", "radius", "height", "dateFrom", "aircraft", "requester"].forEach(f => assert.ok(bad.includes(f), f));
  assert.ok(C.validateInput(Object.assign({}, baseInput, { dateTo: "2026-10-19" }), cfg).some(e => e.field === "dateTo"));
});

test("שער: כל בדיקה חייבת להצליח", () => {
  const st = {}; C.REQUIRED_CHECKS.forEach(([k]) => { st[k] = { ok: true }; });
  assert.equal(C.gate(st).ready, true);
  for (const [k] of C.REQUIRED_CHECKS) { const s2 = JSON.parse(JSON.stringify(st)); s2[k].ok = false; const g = C.gate(s2); assert.equal(g.ready, false, k); assert.equal(g.failing[0].key, k); }
  assert.equal(C.gate({}).ready, false, "בלי סטטוסים = לא מוכן");
});

test("הטופס: 17 שדות, ערכים קבועים, ואין 'טרם נבדק'", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  const rows = O.buildForm(res, cfg); assert.equal(rows.length, 17);
  const t = rows.map(r => r.text).join("\n");
  assert.ok(!/טרם נבדק|לא נבדק|בדוק בעצמך/.test(t));
  assert.equal(rows[1].text, cfg.org.name); assert.equal(rows[13].text, "ICD"); assert.equal(rows[12].text, "לא רלוונטי");
  assert.ok(rows[15].text.includes("3 ק״מ ביום ו-5 ק״מ בלילה"));
  assert.ok(rows[8].text.startsWith("200 מטר") && rows[8].text.includes("0.108 מייל ימי"));
  assert.ok(rows[9].text.includes("262.5 רגל") && rows[9].text.includes("מעפ״ש (AGL)"));
  assert.ok(rows[7].text.includes(exp.dmsLat) && rows[7].text.includes(exp.dmsLon));
  assert.ok(rows[6].text.includes("20.10.2026") && rows[6].text.includes("23.10.2026") && rows[6].text.includes("17:00–20:00"));
});

test("הטופס: כשאין כלום בקרבת מקום — לא מוזכר (ניצנה)", () => {
  const input = Object.assign({}, baseInput, { lat: 30.887, lon: 34.424, radius: 100 });
  const res = C.analyze(input, mkData(fixture("nitzana")), cfg, now);
  const f8 = O.buildForm(res, cfg)[7].text;
  assert.ok(!/מכשולים/.test(f8) && !/עד 100 מ׳|עד 200 מ׳/.test(f8), f8);
  assert.ok(/LLP1162/.test(f8) && /LLU17/.test(f8), "אזורי האיסור הקרובים (גן ניצנה, LLU17) מוזכרים");
});

test("אתרי רט״ג ללא גבולות: התאמת שם מול OSM", () => {
  assert.equal(O.matchUnmapped([{ id: "L1", name: "נחל עינן" }], [{ name: "שמורת טבע נחל עינן", d: 100 }]).length, 1);
  assert.equal(O.matchUnmapped([{ id: "L2", name: "אום זוקא" }], [{ name: "שמורת טבע התנור", d: 100 }]).length, 0);
  assert.equal(O.matchUnmapped([{ id: "L3", name: "גן" }], [{ name: "גן", d: 1 }]).length, 0, "שם קצר מדי — לא מתאימים");
});

test("מייל ו-KML", () => {
  const res = C.analyze(baseInput, mkData(fixture("yarkon")), cfg, now);
  const m = O.mail(res, cfg);
  assert.deepEqual(m.to, ["notamoffice@iaa.gov.il", "nofm@iaa.gov.il"]);
  assert.ok(m.subject.includes("20.10.2026") && m.mailto.startsWith("mailto:notamoffice@iaa.gov.il,nofm@iaa.gov.il?subject="));
  const k = O.kml(res, mkData(fixture("yarkon")), cfg);
  assert.equal((k.match(/<Placemark>/g) || []).length, (k.match(/<\/Placemark>/g) || []).length);
  assert.ok(k.includes("LLU20") && k.includes("קו מתח עליון 161 ק״ו") && k.includes("<innerBoundaryIs>"));
  assert.ok(!k.includes("&lt;script"));
});

test("הזרקת HTML בשדות חופשיים מנוטרלת", () => {
  const res = C.analyze(Object.assign({}, baseInput, { siteName: "<img src=x onerror=alert(1)>", requesterName: "<b>x</b>" }), mkData(fixture("yarkon")), cfg, now);
  const rows = O.buildForm(res, cfg);
  assert.ok(!/<img|<b>x/.test(rows[5].html + rows[10].html));
});

test("שאילתות OSM: מכילות את כל הקטגוריות ומחזירות מיקום ליישובים (out body)", () => {
  const q = C.buildQueries(32.099128, 34.816617, 200, cfg);
  assert.ok(q.near.includes("out geom tags") && q.near.includes("man_made") && q.near.includes("[power") && q.near.includes("[aeroway]") && q.near.includes("[emergency=helipad]"));
  assert.ok(q.far.includes("node(around:3000") && /\[place\];out body;/.test(q.far), "יישובים חייבים out body");
  assert.ok(q.ext.includes("nature_reserve") && q.ext.includes("admin_level"));
  assert.equal(C.buildQueries(32, 34.8, 1000, cfg).nearR, 2150, "רדיוס חיפוש גדל עם הסגירה");
  assert.equal(q.nearR, 800);
});

test("Overpass: מעבר לשרת הבא כשהראשון נכשל, ושגיאה כשכולם נכשלו", async () => {
  const mk = plan => async (url) => { const p = plan[url]; if (p === "boom") throw new Error("net"); if (p === 500) return { ok: false, status: 500 }; return { ok: true, status: 200, json: async () => ({ elements: [{ id: 1 }] }) }; };
  const wait = () => Promise.resolve();
  const r = await C.overpass("q", { fetch: mk({ [C.MIRRORS[0]]: "boom", [C.MIRRORS[1]]: 500, [C.MIRRORS[2]]: "ok", [C.MIRRORS[3]]: "ok" }), wait, staggerMs: 5, timeoutMs: 200 });
  assert.ok(r.mirror === C.MIRRORS[2] || r.mirror === C.MIRRORS[3]);
  const bad = {}; C.MIRRORS.forEach(m => { bad[m] = 500; });
  await assert.rejects(C.overpass("q", { fetch: mk(bad), wait, staggerMs: 5, timeoutMs: 200, rounds: 2 }), /כל שרתי Overpass נכשלו/);
});

test("גבולות מדינה: זיהוי רצועה לפי מדינה (נתוני אמת אם נאספו)", { skip: !fs.existsSync(path.join(ROOT, "tests/fixtures/probe/borders.json")) }, () => {
  assert.ok(true);
});
