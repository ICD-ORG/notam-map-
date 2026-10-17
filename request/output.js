/* הפקת הטופס (נספח ג׳), דף הבדיקות, KML וטקסט המייל מתוצאת הניתוח (request/core.js). בלי DOM — נבדק ב-Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./core.js"));
  else root.ReqOut = factory(root.ReqCore);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  const E = C.esc;
  const dLabel = d => (d < 1 ? "בתוך השטח" : C.fmtDist(d));

  /* ---------- התאמת אתרי רט״ג ללא גבולות מול שמות מ-OSM ---------- */
  const norm = s => String(s || "").replace(/["'׳״`]/g, "").replace(/(שמורת טבע|שמורת|גן לאומי|פארק|אתר|רזרבת)/g, " ").replace(/[-–—_.,()]/g, " ").replace(/\s+/g, " ").trim();
  function matchUnmapped(unmapped, prot) {
    const out = [];
    (unmapped || []).forEach(u => {
      const a = norm(u.name); if (a.length < 4) return;
      prot.forEach(p => { const b = norm(p.name); if (b.length >= 4 && (a.includes(b) || b.includes(a))) out.push({ site: u, osm: p }); });
    });
    return out;
  }

  /* ---------- רשימות לשדה "סגירה/הגבלה" ---------- */
  function itemText(it) {
    return it.n + ". " + it.title + " — " + dLabel(it.d) + (it.height ? " · גובה " + C.trimNum(it.height, 0) + " מ׳" : "");
  }
  function airInfraLines(res, data, cfg) {
    const th = cfg.thresholds, lines = [], R = res.R;
    res.zones.inside.forEach(z => lines.push("חופף לאזור " + z.id + " ״" + z.name + "״ — " + z.kind + ", " + z.alt + "."));
    res.zones.near.forEach(z => lines.push("בקרבת האזור: " + z.id + " ״" + z.name + "״ — במרחק " + C.fmtDist(z.d) + " מהנקודה (" + C.fmtDist(z.edge) + " מקצה הסגירה המבוקשת) — " + z.kind + ", " + z.alt + "."));
    const have = new Set(); res.nearScan.items.forEach(i => i.ids.forEach(x => have.add(x)));
    res.airfields.filter(a => a.d - R <= th.airfield_near_m && !have.has(a.id)).forEach(a =>
      lines.push("בקרבת האזור: " + (a.type === "aerodrome" ? "שדה תעופה" : "מנחת מסוקים") + (a.name ? " ״" + a.name + "״" : "") + (a.icao ? " (" + a.icao + ")" : "") + " — במרחק " + C.fmtDist(a.d) + " מהנקודה" + (a.inactive ? " (לא פעיל לפי OSM)" : "") + "."));
    res.agri.filter(a => a.d - R <= (th.agri_near_m || 3000)).forEach(a =>
      lines.push("בקרבת האזור: מנחת חקלאי ״" + a.name + "״ (" + a.ops.join(" / ") + ") — במרחק " + C.fmtDist(a.d) + " מהנקודה."));
    res.borders.filter(b => b.violates).forEach(b =>
      lines.push("קרבה לגבול " + b.name + ": הסגירה המבוקשת נמצאת " + C.fmtDist(Math.max(0, b.d - R)) + " מהגבול (פמ״ת א-17 סעיף 4: אין לטוס במרחק של פחות מ-" + b.km + " ק״מ מגבול " + b.name + ")."));
    return lines;
  }
  function listCapped(items, cap) {
    const shown = items.slice(0, cap).map(itemText);
    return shown.join("; ") + (items.length > cap ? "; ועוד " + (items.length - cap) + " פריטים (ראו דף הבדיקות)" : "");
  }

  /* ---------- מועדים ---------- */
  function datesText(res) {
    const inp = res.inp, a = C.parseDate(inp.dateFrom), b = C.parseDate(inp.dateTo);
    const one = d => "יום " + C.dayName(d) + " " + C.ddmmyyyy(d);
    const days = inp.dateFrom === inp.dateTo ? one(a) : one(a) + " עד " + one(b);
    const rows = res.sun, per = res.sun.length > 1 || true;
    const win = rows.length ? rows[0].start + "–" + rows[0].end : inp.timeFrom + "–" + inp.timeTo;
    let dn = "";
    if (rows.length) {
      const allDay = rows.every(r => r.nightMin === 0), allNight = rows.every(r => r.dayMin === 0);
      const sd = r => r.sunset + " ב-" + String(r.date.d).padStart(2, "0") + "." + String(r.date.m).padStart(2, "0");
      const f = rows[0], l = rows[rows.length - 1];
      const sunPhrase = rows.length === 1 ? "השקיעה " + f.sunset : "השקיעה: " + sd(f) + (rows.length > 1 ? ", " + sd(l) : "");
      if (allDay) dn = "כל החלון ביום (" + sunPhrase + ")";
      else if (allNight) dn = "כל החלון בלילה (אחרי השקיעה)";
      else dn = "יום: מ-" + f.start + " עד השקיעה · לילה: מהשקיעה עד " + f.end + " (" + sunPhrase + ")";
    }
    return days + "<br>" + (inp.dateFrom === inp.dateTo ? "" : "בכל יום: ") + win + " (שעון מקומי)" + (dn ? "<br>" + E(dn) : "");
  }

  /* ---------- 17 שדות הטופס ---------- */
  function buildForm(res, cfg) {
    const inp = res.inp, R = res.R;
    const air = airInfraLines(res, null, cfg);
    const ins = res.nearScan.inside, ring = res.nearScan.ring;
    let f8 = "<b>מעגל</b> — נ.צ. מרכזי:<br><span dir='ltr'>" + E(C.dmsLat(inp.lat)) + " &nbsp; " + E(C.dmsLon(inp.lon)) + "</span> <span class='muted'>(עשרוני: " + inp.lat + ", " + inp.lon + ")</span>";
    if (air.length) f8 += "<br>תשתית אווירית מושפעת: " + air.map(E).join(" ");
    if (ins.length) f8 += "<br>מכשולים ותשתיות בתוך האזור (עד " + R + " מ׳): " + E(listCapped(ins, 25)) + ".";
    if (ring.length) f8 += "<br>בקרבת האזור (עד " + 2 * R + " מ׳): " + E(listCapped(ring, 25)) + ".";
    const vl = inp.vlos ? "קיים קשר עין" : "ללא קשר עין";
    const rows = [
      ["מס׳ נוטאם", "(ימולא ע״י משרד נוטאם)", "<i class='muted'>(ריק – " + E(cfg.fixed.notam_notam_field) + ")</i>"],
      ["שם/גורם המבקש", "", E(cfg.org.name)],
      ["סוג כלי הטיס או מכשול", "כטמ״מ או רב להב = לציין האם קיים קשר עין", E(inp.aircraft.join(", ")) + " — רב להב, " + vl],
      ["מהות הפעילות המבוקשת", "", E(inp.purpose)],
      ["האם הסגירה חלה על מרססים", "(ימולא ע״י חיל האוויר)", "<span class='muted'>כן ☐ &nbsp; לא ☐ &nbsp;·&nbsp; " + E(cfg.fixed.sprayers_note) + "</span>"],
      ["מיקום קרקעי", "(שם ישוב או תשתית אווירית קרובה)", E(inp.siteName)],
      ["מועדי הפעילות", "(יום, תאריך, שעות בזמן מקומי)", datesText(res)],
      ["סגירה/הגבלה", "במקרה של פוליגון או מיקום נקודתי יש לציין תשתיות אוויריות מושפעות · נ״צ גאוגרפי דאטום WGS84 – מעלות/דקות/שניות (DMS)", f8],
      ["רדיוס הסגירה (אם רלוונטי)", "רדיוס ביחידות מטר או ק״מ או מייל ימי (רדיוס בק״מ / 1.852 = רדיוס במייל)", R + " מטר &nbsp;<span class='muted'>(= " + C.trimNum(R / 1000, 3) + " ק״מ = " + (R / C.NM).toFixed(3) + " מייל ימי)</span>"],
      ["גבהי הטיסה או גובה המכשול", "מטרים או רגל (m/feet) · מעפ״ש או מעפ״י (AGL/AMSL) · (גובה במטר × 3.28084 = גובה ברגל)", "מגובה: קרקע (0) &nbsp; עד גובה: <b>" + res.ft.toFixed(1) + " רגל</b> (" + C.trimNum(inp.heightM, 2) + " מ׳ × 3.28084)<br>בסיס: מעפ״ש (AGL)"],
      ["מבקש הבקשה + מס׳ טלפון", "", E(inp.requesterName) + ", <span dir='ltr'>" + E(inp.requesterPhone) + "</span>"],
      ["אנשי קשר בשטח בעת הפעלת הסגירה", "2 אנשי קשר + טלפונים", E(inp.contactNames) + " — <span dir='ltr'>" + E(inp.contactPhone) + "</span>"],
      ["אות קריאה", "(אם רלוונטי)", E(cfg.org.callsign)],
      ["מס׳ רישום כלי הטיס", "(אם רלוונטי)", E(cfg.org.registration)],
      ["גודל וצבע הבלון", "(רלוונטי לבלון מעוגן)", E(cfg.fixed.balloon)],
      ["סימוני אזהרה לתעופה (לגבי מכשולים בלבד)", "סימוני יום, תאורת לילה", E(cfg.fixed.warning_markings)],
      ["זמן קיפול מנוף בחירום", "(אם רלוונטי)", E(cfg.fixed.crane)]
    ];
    return rows.map((r, i) => ({ n: i + 1, label: r[0], sub: r[1], html: r[2], text: toText(r[2]) }));
  }
  function toText(h) {
    return String(h).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  }

  /* ---------- דף הבדיקות ---------- */
  function buildChecks(res, data, cfg) {
    const R = res.R, th = cfg.thresholds, inp = res.inp, rows = [];
    const z17 = x => x.src === "a17", zin = res.zones.inside, znear = res.zones.near;
    const zl = z => z.id + " ״" + z.name + "״ (" + z.kind + "; " + z.alt + ") — " + C.fmtDist(z.d) + " מהנקודה" + (z.note ? " · " + z.note.split("\n")[0].slice(0, 500) : "");
    const a17edition = (data.zones && data.zones.edition) || "";
    // א-17
    const a_in = zin.filter(z17), a_near = znear.filter(z17);
    rows.push(["אזורים אסורים, מוגבלים ומסוכנים (LLP, LLR, LLD, LLU) ובלונים מעוגנים", a17edition,
      (a_in.length ? "<b>חפיפה לסגירה המבוקשת:</b> " + a_in.map(zl).map(E).join("; ") + ". " : "בתוך הסגירה (" + R + " מ׳): אין. ") +
      (a_near.length ? "<b>בקרבת הסגירה (עד " + C.fmtDist(R + th.near_zone_m) + " מהנקודה):</b> " + a_near.map(zl).map(E).join("; ") + "." : "בטווח " + C.fmtDist(R + th.near_zone_m) + " מהנקודה: אין אזור נוסף.")]);
    // רט״ג
    const n_in = zin.filter(z => z.src === "inpa"), n_near = znear.filter(z => z.src === "inpa");
    const matches = matchUnmapped(data.inpa && data.inpa.unmapped, res.osmProtected.filter(p => p.d <= R + th.near_zone_m));
    rows.push(["שמורות טבע וגנים לאומיים", (data.inpa && data.inpa.edition) || "",
      (n_in.length ? "<b>חפיפה:</b> " + n_in.map(zl).map(E).join("; ") + ". " : "בתוך הסגירה: אין. ") +
      (n_near.length ? "<b>בקרבת הסגירה:</b> " + n_near.map(zl).map(E).join("; ") + ". " : "בטווח " + C.fmtDist(R + th.near_zone_m) + ": אין. ") +
      (matches.length ? "<b>אתרי נספח ה׳ ללא גבולות בקובץ שזוהו לפי שם ב-OpenStreetMap:</b> " + matches.map(m => E(m.site.id + " ״" + m.site.name + "״ (" + m.osm.name + ", " + C.fmtDist(m.osm.d) + ")")).join("; ") + "." : "")]);
    // מנחתים חקלאיים
    const ag = res.agri;
    rows.push(["מנחתים חקלאיים", (data.agri && data.agri.edition) || "",
      ag.length ? (ag[0].d - R <= (th.agri_near_m || 3000) ? "<b>בקרבת הסגירה:</b> " : "אין בסביבה. ") + "הקרוב ביותר: " + E(ag[0].name) + " (" + E(ag[0].ops.join(" / ")) + "), " + C.fmtDist(ag[0].d) + "." : "אין נתונים."]);
    // סריקת סביבה
    const items = res.nearScan.items, cnt = {};
    items.forEach(i => { cnt[i.label.replace(/ \(.*\)$/, "")] = (cnt[i.label.replace(/ \(.*\)$/, "")] || 0) + 1; });
    const osmBase = data.near && data.near.osm3s && data.near.osm3s.timestamp_osm_base;
    rows.push(["סריקת סביבה: מכשולים, תשתיות קרקעיות, שדות תעופה ומנחתים", "OpenStreetMap" + (osmBase ? ", נתונים מ-" + osmBase.slice(0, 16).replace("T", " ") + " UTC" : ""),
      (res.nearScan.inside.length ? "<b>בתוך " + R + " מ׳:</b> " + E(res.nearScan.inside.map(itemText).join("; ")) + ". " : "בתוך " + R + " מ׳: אין. ") +
      (res.nearScan.ring.length ? "<b>בקרבת האזור (עד " + 2 * R + " מ׳):</b> " + E(res.nearScan.ring.map(itemText).join("; ")) + "." : "בטבעת הכתומה (עד " + 2 * R + " מ׳): אין.") +
      " <span class='muted'>(חיפוש עד " + C.fmtDist(data.nearR || Math.max(800, 2 * R + 150)) + ": מגדלים, תרנים, ארובות, עגורנים, קווי ועמודי חשמל, רכבלים, מבנים גבוהים, תשתיות שדה תעופה ומנחתים, אזורים צבאיים, כבישים מהירים/ראשיים, מסילות, בתי חולים, בתי סוהר, משטרה, אצטדיונים.)</span>"]);
    // שדות תעופה
    const af = res.airfields.filter(a => a.type === "aerodrome").slice(0, 3), hp = res.airfields.filter(a => a.type !== "aerodrome").slice(0, 2);
    rows.push(["שדות תעופה ומנחתים בסביבה (עד " + C.fmtDist(th.airfield_scan_m) + ")", "OpenStreetMap",
      (af.length ? "שדות תעופה: " + af.map(a => E((a.name || "ללא שם") + (a.icao ? " (" + a.icao + ")" : "") + " — " + C.fmtDist(a.d))).join("; ") + ". " : "שדות תעופה: אין בטווח. ") +
      (hp.length ? "מנחתי מסוקים: " + hp.map(a => E((a.name || "ללא שם") + " — " + C.fmtDist(a.d))).join("; ") + "." : "")]);
    // גבולות
    rows.push(["קרבה לגבול מדינה (פמ״ת א-17 סעיף 4)", "OpenStreetMap",
      res.borders.length ? res.borders.map(b => E("גבול " + b.name + ": " + C.fmtDist(b.d) + " מהנקודה (מגבלה: " + b.km + " ק״מ) — " + (b.violates ? "הסגירה נכנסת לרצועה" : "הסגירה מחוץ לרצועה"))).join("; ") + "." : "אין גבול מצרים/סוריה/לבנון בטווח " + C.fmtDist(th.border_scan_m) + "."]);
    // נוטמים
    const fetched = data.notamFetchedIso ? data.notamFetchedIso.replace("T", " ").slice(0, 16) + " UTC" : "";
    const nh = res.notams.hits, ex = res.notams.excluded || [];
    const exBy = r => ex.filter(x => x.reason === r).map(x => x.id);
    const exParts = [];
    if (exBy("checklist").length) exParts.push("רשימות נוטמים (CHECKLIST): " + exBy("checklist").join(", "));
    if (exBy("cancel").length) exParts.push("ביטולים: " + exBy("cancel").join(", "));
    if (exBy("above").length) exParts.push("נוטמים בתוקף שגבולם התחתון גבוה מ-" + C.fmtInt(Math.round(res.ft + 9500)) + " רגל (הגובה המבוקש בתוספת הקרקע הגבוהה בישראל): " + exBy("above").join(", "));
    const exTxt = exParts.length ? "<br><span class='muted'>לא נכללו בתוצאה: " + E(exParts.join(" · ")) + ".</span>" : "";
    rows.push(["נוטמים בתוקף בחלון הפעילות", "נמשכו " + fetched,
      (nh.length ? nh.map(n => "<b>" + E(n.id) + "</b>: " + E((n.heb || n.name || "").split("\n")[0].slice(0, 220)) + (n.relation === "no-geometry" ? " (אין מיקום בנוטם — יש לקרוא)" : "")).join("<br>") : "אין נוטם בתוקף שחופף לסגירה ולמועד.") + exTxt]);
    // שיטת הבדיקה
    return rows;
  }

  function sourceNotes(res, data, cfg) {
    const n = (data.zones && data.zones.nocoord) ? data.zones.nocoord.length : 0;
    return [
      "מקור האיסורים: " + ((data.zones && data.zones.edition) || "") + ". " + n + " שטחי אש מופיעים בפמ״ת ללא קואורדינטות (הן בפרק ENR 5.1 של ה-AIP); הם נבדקו מול הנוטמים וסימוני אזור צבאי/מטווח ב-OpenStreetMap בלבד.",
      "אתרי טבע בנספח ה׳ שאין להם גבולות בקובץ: " + ((data.inpa && data.inpa.unmapped && data.inpa.unmapped.length) || 0) + " — נבדקו לפי שם מול OpenStreetMap.",
      "OpenStreetMap הוא מאגר ציבורי שנבנה על ידי מתנדבים: ייתכנו מכשולים שלא סומנו, וגבהים שלא צוינו. סקר האתר של המטיס נשאר בתוקף.",
      "גבולות מרחב מבוקר (CTR/ATZ) אינם בנתונים; מוצג המרחק לשדה התעופה הקרוב ביותר.",
      "הנוטמים נבדקים לפי המיקום והתאריכים בטקסט הנוטם (שורת E או שורת Q). נוטם בלי מיקום מוצג לקריאה."
    ];
  }

  /* ---------- KML ---------- */
  function kml(res, data, cfg) {
    const inp = res.inp, P = res.P, R = res.R, X = E;
    const coords = pts => pts.map(p => p[1] + "," + p[0] + ",0").join(" ");
    const poly = (outer, inner) => "<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>" + coords(outer) + "</coordinates></LinearRing></outerBoundaryIs>" +
      (inner ? "<innerBoundaryIs><LinearRing><coordinates>" + coords(inner) + "</coordinates></LinearRing></innerBoundaryIs>" : "") + "</Polygon>";
    const circ = r => C.circlePoints(P, r, 96);
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>');
    out.push("<name>" + X("בקשת סגירה אווירית — " + inp.siteName + " — " + C.ddmmyyyy(C.parseDate(inp.dateFrom)) + (inp.dateFrom !== inp.dateTo ? "–" + C.ddmmyyyy(C.parseDate(inp.dateTo)) : "")) + "</name>");
    out.push('<Style id="green"><LineStyle><color>ff3e8e1e</color><width>3</width></LineStyle><PolyStyle><color>663e8e1e</color></PolyStyle></Style>');
    out.push('<Style id="orange"><LineStyle><color>ff007be0</color><width>3</width></LineStyle><PolyStyle><color>55007be0</color></PolyStyle></Style>');
    out.push('<Style id="red"><LineStyle><color>ff202dd9</color><width>3</width></LineStyle><PolyStyle><color>55202dd9</color></PolyStyle></Style>');
    out.push('<Style id="dist"><LineStyle><color>ff202dd9</color><width>2</width></LineStyle></Style>');
    out.push('<Style id="powerline"><LineStyle><color>ff00d4ff</color><width>4</width></LineStyle></Style>');
    out.push('<Style id="obst"><IconStyle><color>ff00d4ff</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/caution.png</href></Icon></IconStyle><LineStyle><color>ff00d4ff</color><width>2</width></LineStyle><PolyStyle><color>5500d4ff</color></PolyStyle></Style>');
    out.push("<Placemark><name>נקודת ההטסה (מרכז)</name><description>" + X(C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon) + " · גובה " + inp.heightM + " מ׳ (" + res.ft.toFixed(1) + " רגל)") + "</description><Point><coordinates>" + inp.lon + "," + inp.lat + ",0</coordinates></Point></Placemark>");
    out.push("<Placemark><name>" + X("אזור ההטסה — רדיוס " + R + " מ׳") + '</name><styleUrl>#green</styleUrl>' + poly(circ(R)) + "</Placemark>");
    out.push("<Placemark><name>" + X(R + " מ׳ נוספים (עד " + 2 * R + " מ׳)") + '</name><styleUrl>#orange</styleUrl>' + poly(circ(2 * R), circ(R).slice().reverse()) + "</Placemark>");
    [...res.zones.inside, ...res.zones.near].forEach(z => {
      const rings = z.z.rings && z.z.rings.length ? z.z.rings : (z.z.c && z.z.r ? [C.circlePoints(new C.Proj(z.z.c[0], z.z.c[1]), z.z.r, 96)] : []);
      rings.forEach(rg => out.push("<Placemark><name>" + X(z.id + " " + z.name + " — " + z.kind + "; " + z.alt + " (" + z.d.toFixed(0) + " מ׳ מהנקודה)") + '</name><styleUrl>#red</styleUrl>' + poly(rg) + "</Placemark>"));
      if (z.d >= 1) out.push("<Placemark><name>" + X(Math.round(z.d) + " מ׳ עד " + z.id) + '</name><styleUrl>#dist</styleUrl><LineString><tessellate>1</tessellate><coordinates>' + inp.lon + "," + inp.lat + ",0 " + z.ll[1] + "," + z.ll[0] + ",0</coordinates></LineString></Placemark>");
    });
    if (res.nearScan.items.length) {
      out.push("<Folder><name>מכשולים ותשתיות בתוך האזור ובקרבתו (OpenStreetMap)</name>");
      res.nearScan.items.forEach(it => {
        const name = X(it.n + ". " + it.title + " — " + dLabel(it.d));
        it.geoms.forEach(g => {
          if (g.pt) out.push("<Placemark><name>" + name + '</name><styleUrl>#obst</styleUrl><Point><coordinates>' + g.pt[1] + "," + g.pt[0] + ",0</coordinates></Point></Placemark>");
          else if (g.closed) out.push("<Placemark><name>" + name + '</name><styleUrl>#obst</styleUrl>' + poly(g.pts) + "</Placemark>");
          else out.push("<Placemark><name>" + name + '</name><styleUrl>' + (it.tags.power === "line" ? "#powerline" : "#obst") + '</styleUrl><LineString><tessellate>1</tessellate><coordinates>' + coords(g.pts) + "</coordinates></LineString></Placemark>");
        });
      });
      out.push("</Folder>");
    }
    out.push("</Document></kml>");
    return out.join("\n");
  }

  /* ---------- מייל ---------- */
  function mail(res, cfg) {
    const inp = res.inp, a = C.parseDate(inp.dateFrom), b = C.parseDate(inp.dateTo);
    const dates = inp.dateFrom === inp.dateTo ? "יום " + C.dayName(a) + " " + C.ddmmyyyy(a) : "יום " + C.dayName(a) + " " + C.ddmmyyyy(a) + " עד יום " + C.dayName(b) + " " + C.ddmmyyyy(b);
    const subject = "בקשה לסגירה אווירית — " + inp.siteName + " — " + dates;
    const win = res.sun.length ? res.sun[0].start + "–" + res.sun[0].end : inp.timeFrom + "–" + inp.timeTo;
    const lines = [
      "שלום רב,", "",
      "מצורפת בקשה לסגירה אווירית על גבי הטופס שבנספח ג׳ לפמ״ת א-11 (עדכון 1/26).", "",
      "שם/גורם המבקש: " + cfg.org.name,
      "כלי טיס: " + inp.aircraft.join(", ") + " — רב להב, " + (inp.vlos ? "קיים קשר עין" : "ללא קשר עין"),
      "מהות הפעילות: " + inp.purpose,
      "מיקום: " + inp.siteName,
      "מועדים: " + dates + (inp.dateFrom === inp.dateTo ? "" : ", בכל יום") + " " + win + " (שעון מקומי)",
      "סגירה: מעגל ברדיוס " + res.R + " מטר סביב " + C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon),
      "גובה: " + res.ft.toFixed(1) + " רגל (" + C.trimNum(inp.heightM, 2) + " מטר) מעפ״ש (AGL)",
      "אנשי קשר בשטח: " + inp.contactNames + " — " + inp.contactPhone, "",
      "מצורפים: טופס הבקשה (PDF), מפה/תצ״א עם סימון האזור, וקובץ KML.", "",
      "בברכה,", inp.requesterName, cfg.org.name, inp.requesterPhone
    ];
    const body = lines.join("\n");
    return { to: cfg.mail.to, subject, body, mailto: "mailto:" + cfg.mail.to.join(",") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body) };
  }

  return { buildForm, buildChecks, sourceNotes, kml, mail, matchUnmapped, itemText, airInfraLines, toText, dLabel };
});
