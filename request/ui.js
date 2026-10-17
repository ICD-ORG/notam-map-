/* ממשק "בקשת סגירה אווירית": קלט -> הרצת כל הבדיקות -> טופס, מפה, KML, מייל. כל כשל בבדיקה חוסם את "מוכן לשליחה". */
(function () {
  "use strict";
  const C = window.ReqCore, O = window.ReqOut, M = window.ReqMap, $ = id => document.getElementById(id);
  const S = { cfg: null, data: {}, res: null, statuses: {}, map: null, scanKey: null, stale: false, running: false, center: null, autoSite: "", lf: {}, report: null };
  const PERSON_KEY = "icd_req_person_v1";
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const esc = C.esc;

  /* ---------- עזרים ---------- */
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* פרטיות/חסימה */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  async function getJson(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(url + " — HTTP " + r.status);
    return r.json();
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function setStatus(k, ok, msg) { S.statuses[k] = { ok: !!ok, msg: msg || "" }; refreshGate(); }

  /* ---------- טעינת נתונים סטטיים ---------- */
  async function loadStatic() {
    try { S.cfg = await getJson("data/request-config.json"); }
    catch (e) { $("e_run").textContent = "לא נטען קובץ ההגדרות: " + e.message; return false; }
    buildControls();
    const jobs = [
      ["a17", Promise.all([getJson("data/pmt-zones.json"), getJson("data/inpa-zones.json")]).then(([z, i]) => { S.data.zones = z; S.data.inpa = i; return (z.edition || "") + " · " + z.zones.length + " אזורים, " + i.sites.length + " אתרי רט״ג"; })],
      ["agri", getJson("data/agri-airstrips.json").then(a => { S.data.agri = a; return a.airstrips.length + " מנחתים"; })],
      ["notam", loadNotams()]
    ];
    await Promise.all(jobs.map(([k, p]) => p.then(m => setStatus(k, true, m), e => setStatus(k, false, "לא נטען: " + (e && e.message ? e.message : e)))));
    return true;
  }
  async function loadNotams() {
    let d = null, err = "";
    for (const u of ["notam-data.json", "../notam-data.json"]) { try { d = await getJson(u); if (d && Array.isArray(d.notams)) break; d = null; } catch (e) { err = e.message; } }
    if (!d) throw new Error(err || "אין נתוני נוטמים");
    S.data.notams = d.notams; S.data.notamFetchedIso = d.fetched_iso;
    return d.notams.length + " נוטמים, נמשכו " + d.fetched_at;
  }

  /* ---------- בקרי הטופס ---------- */
  function buildControls() {
    $("purpose").innerHTML = '<option value="">בחרו…</option>' + S.cfg.purposes.map(p => '<option>' + esc(p) + "</option>").join("");
    $("aircraft").innerHTML = S.cfg.aircraft.map((a, i) => '<label><input type="checkbox" name="ac" value="' + esc(a) + '"' + (i === 0 ? " checked" : "") + "> " + esc(a) + "</label>").join("");
    $("radius").value = S.cfg.defaults.radius_m; $("radius").min = S.cfg.defaults.min_radius_m; $("radius").max = S.cfg.defaults.max_radius_m;
    $("mailTo").textContent = S.cfg.mail.to.join(", ");
    try {
      const p = JSON.parse(ls.get(PERSON_KEY) || "null");
      if (p) { $("reqName").value = p.reqName || ""; $("reqPhone").value = p.reqPhone || ""; $("contactNames").value = p.contactNames || ""; $("contactPhone").value = p.contactPhone || ""; $("personBox").open = !(p.reqName && p.contactNames); }
    } catch (e) { /* ignore */ }
  }
  function savePerson() {
    ls.set(PERSON_KEY, JSON.stringify({ reqName: $("reqName").value, reqPhone: $("reqPhone").value, contactNames: $("contactNames").value, contactPhone: $("contactPhone").value }));
  }
  function readInputs() {
    const c = C.parseCoordInput($("coord").value) || S.center || {};
    return {
      lat: c.lat, lon: c.lon, radius: parseFloat($("radius").value), heightM: parseFloat($("height").value),
      dateFrom: $("dateFrom").value, dateTo: $("dateTo").value || $("dateFrom").value, timeFrom: $("timeFrom").value, timeTo: $("timeTo").value,
      purpose: $("purpose").value, aircraft: [...document.querySelectorAll('input[name="ac"]:checked')].map(i => i.value),
      vlos: $("vlos").value === "yes", siteName: $("siteName").value.trim(),
      requesterName: $("reqName").value.trim(), requesterPhone: $("reqPhone").value.trim(), contactNames: $("contactNames").value.trim(), contactPhone: $("contactPhone").value.trim()
    };
  }
  const scanKey = () => { const i = readInputs(); return JSON.stringify([i.lat, i.lon, i.radius, i.heightM, i.dateFrom, i.dateTo, i.timeFrom, i.timeTo]); };
  function showErrors(errs) {
    document.querySelectorAll(".err[id^=e_]").forEach(e => { if (e.id !== "e_run") e.textContent = ""; });
    document.querySelectorAll("input.bad,select.bad").forEach(e => e.classList.remove("bad"));
    const idMap = { coord: "coord", radius: "radius", height: "height", dateFrom: "dateFrom", dateTo: "dateTo", timeFrom: "timeFrom", timeTo: "timeTo", purpose: "purpose", aircraft: null, siteName: "siteName", requester: "reqName", contacts: "contactNames" };
    errs.forEach(e => { const el = $("e_" + e.field); if (el) el.textContent = e.msg; const inp = idMap[e.field] && $(idMap[e.field]); if (inp) inp.classList.add("bad"); });
  }

  /* ---------- מפה חיה (Leaflet) ---------- */
  function initMap() {
    if (typeof L === "undefined") { $("map").innerHTML = '<div class="hint" style="padding:20px">המפה לא נטענה (אין חיבור לספריית המפות). אפשר להקליד קואורדינטות בשדה.</div>'; return; }
    const m = L.map("map").setView([31.9, 35.0], 8);
    const sat = L.tileLayer(ESRI, { maxZoom: 19, attribution: "Esri World Imagery" }), osm = L.tileLayer(OSM, { maxZoom: 19, attribution: "OpenStreetMap" });
    sat.addTo(m);
    $("baseSat").onclick = () => { m.removeLayer(osm); sat.addTo(m); };
    $("baseOsm").onclick = () => { m.removeLayer(sat); osm.addTo(m); };
    m.on("click", e => setCenter(e.latlng.lat, e.latlng.lng, false));
    S.lf = { m, sat, osm, marker: null, green: null, orange: null };
  }
  function drawCircles() {
    if (!S.lf.m || !S.center) return;
    const R = parseFloat($("radius").value) || 0, ll = [S.center.lat, S.center.lon];
    if (!S.lf.marker) {
      S.lf.marker = L.marker(ll, { draggable: true }).addTo(S.lf.m);
      S.lf.marker.on("dragend", () => { const p = S.lf.marker.getLatLng(); setCenter(p.lat, p.lng, true); });
      S.lf.orange = L.circle(ll, { radius: 2 * R, color: "#ff9500", weight: 3, fillColor: "#ff9500", fillOpacity: 0.12 }).addTo(S.lf.m);
      S.lf.green = L.circle(ll, { radius: R, color: "#22c55e", weight: 3, fillColor: "#22c55e", fillOpacity: 0.22 }).addTo(S.lf.m);
    } else { S.lf.marker.setLatLng(ll); S.lf.orange.setLatLng(ll).setRadius(2 * R); S.lf.green.setLatLng(ll).setRadius(R); }
  }
  function setCenter(lat, lon, fromInput) {
    S.center = { lat, lon };
    if (!fromInput) $("coord").value = lat.toFixed(6) + ", " + lon.toFixed(6);
    drawCircles();
    if (S.lf.m) { const z = S.lf.m.getZoom(); if (z < 15 || !S.lf.m.getBounds().contains([lat, lon])) S.lf.m.setView([lat, lon], Math.max(z, 16)); }
    onScanInputChange();
  }
  async function searchPlace() {
    const q = $("q").value.trim(); if (!q) return;
    $("qMsg").textContent = "מחפש…"; $("places").innerHTML = "";
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ format: "jsonv2", q, "accept-language": "he", countrycodes: "il,ps", limit: 6 }));
      const j = await r.json();
      $("qMsg").textContent = j.length ? "בחרו תוצאה:" : "לא נמצאו תוצאות.";
      $("places").innerHTML = j.map((x, i) => '<button type="button" data-i="' + i + '">' + esc(x.display_name) + "</button>").join("");
      $("places").querySelectorAll("button").forEach(b => b.onclick = () => { const x = j[+b.dataset.i]; setCenter(+x.lat, +x.lon, false); $("places").innerHTML = ""; $("qMsg").textContent = ""; });
    } catch (e) { $("qMsg").textContent = "החיפוש נכשל (" + e.message + "). אפשר להקליד קואורדינטות."; }
  }

  /* ---------- שער "מוכן לשליחה" ---------- */
  function refreshGate() {
    const box = $("gate"); if (!box) return;
    if (!S.res) { $("resultsSec").style.display = "none"; return; }
    $("resultsSec").style.display = "block";
    const g = C.gate(S.statuses);
    S.ready = g.ready && !S.stale;
    const w = warnings();
    let html = "";
    if (S.stale) html += '<div class="banner no">הנתונים בטופס השתנו מאז הרצת הבדיקות. יש ללחוץ שוב על "הרץ את כל הבדיקות" לפני שליחה.</div>';
    html += S.ready ? '<div class="banner ok">✔ כל הבדיקות הושלמו ללא כשל. הבקשה מוכנה לשליחה.</div>'
      : '<div class="banner no">✖ הבקשה אינה מוכנה לשליחה — בדיקות שלא הושלמו:<ul>' + g.failing.map(f => "<li>" + esc(f.label) + ": " + esc(f.msg) + "</li>").join("") + "</ul></div>";
    html += w.map(x => '<div class="banner warn">' + x + "</div>").join("");
    box.innerHTML = html;
    ["btnPrint", "btnKml", "btnPng", "btnCopy"].forEach(id => { $(id).disabled = !S.ready; });
    $("btnMail").querySelector("button").disabled = !S.ready;
    $("btnMail").style.pointerEvents = S.ready ? "" : "none";
    if (S.report) renderReport();
  }
  function warnings() {
    const out = [], r = S.res; if (!r) return out;
    const th = S.cfg.thresholds;
    if (r.nearScan.inside.length) out.push("<b>נמצאו מכשולים או תשתיות בתוך האזור המיועד לטיסה (" + r.nearScan.inside.length + "):</b> " + esc(r.nearScan.inside.map(O.itemText).join("; ")) + ".");
    if (r.zones.inside.length) out.push("<b>הסגירה המבוקשת חופפת לאזור איסור/הגבלה:</b> " + esc(r.zones.inside.map(z => z.id + " " + z.name).join("; ")) + ".");
    const bv = r.borders.filter(b => b.violates); if (bv.length) out.push("<b>הסגירה נכנסת לרצועת הגבול:</b> " + esc(bv.map(b => b.name + " (" + b.km + " ק״מ)").join("; ")) + ".");
    if (r.workingDays != null && r.workingDays < th.min_working_days) out.push("הבקשה מוגשת " + r.workingDays + " ימי עבודה לפני מועד הפעילות; הנוהל (א-11 סעיף 6.ב) דורש לפחות " + th.min_working_days + " ימי עבודה (ספירה א׳–ה׳, בלי חגים).");
    if (r.notamAgeH != null && r.notamAgeH > th.notam_warn_age_h) out.push("נתוני הנוטמים נמשכו לפני " + Math.round(r.notamAgeH) + " שעות.");
    return out;
  }

  /* ---------- הרצה ---------- */
  function progress(items) {
    $("progress").innerHTML = items.map(i => '<li><span class="s ' + i.s + '">' + ({ ok: "✔", no: "✖", wait: "…" }[i.s]) + "</span><span>" + esc(i.t) + (i.m ? ' <span class="hint">' + esc(i.m) + "</span>" : "") + "</span></li>").join("");
  }
  async function run() {
    if (S.running) return;
    $("e_run").textContent = "";
    const inp0 = readInputs();
    const errs = C.validateInput(Object.assign({}, inp0, { siteName: inp0.siteName || "-" }), S.cfg);
    showErrors(errs);
    if (errs.length) { setStatus("input", false, errs.map(e => e.msg).join(" · ")); $("e_run").textContent = "יש להשלים את השדות המסומנים."; return; }
    for (const k of ["a17", "agri", "notam"]) if (!(S.statuses[k] && S.statuses[k].ok)) { $("e_run").textContent = "נתונים סטטיים לא נטענו (" + k + "): " + (S.statuses[k] ? S.statuses[k].msg : "ממתין") + ". רעננו את הדף."; return; }
    S.running = true; $("runBtn").disabled = true;
    const steps = [
      { k: "osm_near", t: "מכשולים ותשתיות בסביבה (OpenStreetMap)" }, { k: "osm_far", t: "שדות תעופה, מנחתים וישובים (OpenStreetMap)" },
      { k: "osm_ext", t: "גבולות מדינה ושטחי טבע (OpenStreetMap)" }, { k: "reverse", t: "שם המקום (Nominatim)" },
      { k: "calc", t: "חישוב מרחקים ובדיקת א-17, רט״ג, מנחתים ונוטמים" }, { k: "map", t: "תמונת מפה עם רקע" }
    ].map(x => Object.assign(x, { s: "wait", m: "" }));
    const upd = () => progress(steps.map(x => ({ s: x.s, t: x.t, m: x.m })));
    const st = (k, s, m) => { const x = steps.find(y => y.k === k); x.s = s; x.m = m || ""; upd(); };
    upd();
    S.res = null; S.report = null; S.stale = false; S.map = null;
    ["osm_near", "osm_far", "osm_ext", "map"].forEach(k => { S.statuses[k] = { ok: false, msg: "לא הושלם" }; });
    const data = { zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notams: S.data.notams, notamFetchedIso: S.data.notamFetchedIso };
    const q = C.buildQueries(inp0.lat, inp0.lon, inp0.radius, S.cfg);
    const fetchOpts = { log: () => {} };
    try {
      for (const [k, key, sk] of [["near", "near", "osm_near"], ["far", "far", "osm_far"], ["ext", "ext", "osm_ext"]]) {
        try {
          const r = await C.overpass(q[k], fetchOpts); data[key] = r.data; st(sk, "ok", new URL(r.mirror).hostname + " · " + r.data.elements.length + " אלמנטים");
          setStatus(sk, true, "");
        } catch (e) { st(sk, "no", e.message); setStatus(sk, false, e.message); throw e; }
        await wait(500);
      }
      try {
        const ctl = new AbortController(); setTimeout(() => ctl.abort(), 20000);
        const rr = await fetch("https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({ format: "jsonv2", lat: inp0.lat, lon: inp0.lon, zoom: 18, "accept-language": "he", addressdetails: 1 }), { signal: ctl.signal });
        if (!rr.ok) throw new Error("HTTP " + rr.status);
        data.reverse = await rr.json(); st("reverse", "ok", data.reverse.display_name || "");
      } catch (e) { data.reverse = null; st("reverse", "ok", "לא התקבל שם מ-Nominatim — השם נגזר משכבות OpenStreetMap או מהקלדה"); }
      const inp = readInputs();
      const res = C.analyze(inp, data, S.cfg, new Date());
      const prevAuto = S.autoSite;
      if (!inp.siteName || inp.siteName === prevAuto) { if (res.siteSuggestion) { $("siteName").value = res.siteSuggestion; S.autoSite = res.siteSuggestion; res.inp.siteName = res.siteSuggestion; } }
      const errs2 = C.validateInput(res.inp, S.cfg); showErrors(errs2);
      if (errs2.length) { setStatus("input", false, errs2.map(e => e.msg).join(" · ")); st("calc", "no", errs2.map(e => e.msg).join(" · ")); throw new Error("חסרים פרטים בטופס"); }
      setStatus("input", true, "");
      const age = res.notamAgeH;
      if (age == null || age > S.cfg.thresholds.notam_max_age_h) { setStatus("notam", false, age == null ? "לא ידוע מתי נמשכו הנוטמים" : "נתוני הנוטמים ישנים (" + Math.round(age) + " שעות; מרבי " + S.cfg.thresholds.notam_max_age_h + "). יש לרענן: GitHub → Actions → עדכון נוטמים יומי → Run workflow"); }
      else setStatus("notam", true, "");
      S.data.near = data.near; S.data.far = data.far; S.data.ext = data.ext; S.data.reverse = data.reverse;
      S.res = res; S.scanKey = scanKey();
      st("calc", "ok", "נמצאו " + res.nearScan.items.length + " מכשולים/תשתיות עד פי 2 מהרדיוס · " + (res.zones.inside.length + res.zones.near.length) + " אזורי איסור בקרבה");
      await buildMapImage(steps, st);
      S.report = true;
      renderAll();
      $("resultsSec").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      $("e_run").textContent = "הבדיקות לא הושלמו: " + e.message + ". הבקשה אינה מסומנת כמוכנה לשליחה — אפשר להריץ שוב.";
      if (S.res) { S.report = true; renderAll(); } else { $("resultsSec").style.display = "none"; }
    } finally { S.running = false; $("runBtn").disabled = false; }
  }
  async function buildMapImage(steps, st) {
    try {
      const out = await M.render(S.res, { provider: $("provider").value });
      S.map = out;
      if (out.background) { st && st("map", "ok", "הרקע נטען (" + out.tiles + " אריחים)"); setStatus("map", true, ""); }
      else { const why = out.tainted ? "הדפדפן חסם יצוא תמונה" : out.failedTiles + " מתוך " + out.tiles + " אריחי רקע לא נטענו"; st && st("map", "no", why); setStatus("map", false, why); }
    } catch (e) { S.map = null; st && st("map", "no", e.message); setStatus("map", false, e.message); }
  }

  /* ---------- שינויי קלט אחרי הרצה ---------- */
  function onScanInputChange() {
    $("ftHint").textContent = isFinite(parseFloat($("height").value)) ? "= " + (parseFloat($("height").value) * C.M2FT).toFixed(1) + " רגל" : "";
    if (S.res && S.scanKey !== scanKey()) { S.stale = true; refreshGate(); }
  }
  let rebuildTimer = null;
  function onSoftInputChange() {
    if (!S.res) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(async () => {
      const i = readInputs();
      ["siteName", "purpose", "aircraft", "vlos", "requesterName", "requesterPhone", "contactNames", "contactPhone"].forEach(k => { S.res.inp[k] = i[k]; });
      const errs = C.validateInput(S.res.inp, S.cfg); showErrors(errs);
      setStatus("input", errs.length === 0, errs.map(e => e.msg).join(" · "));
      if (S.scanKey === scanKey()) { await buildMapImage(null, null); }
      renderAll();
    }, 450);
  }

  /* ---------- הדוח ---------- */
  function renderAll() { S.report = true; refreshGate(); renderLimits(); const m = O.mail(S.res, S.cfg); $("btnMail").href = m.mailto; $("mailInfo").textContent = "נושא: " + m.subject; }
  function renderLimits() { $("limits").innerHTML = O.sourceNotes(S.res, S.data.zones ? { zones: S.data.zones, inpa: S.data.inpa } : {}, S.cfg).map(x => "<li>" + esc(x) + "</li>").join(""); }
  function renderReport() {
    const res = S.res, cfg = S.cfg; if (!res) return;
    const data = { zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notamFetchedIso: S.data.notamFetchedIso, near: S.data.near };
    const rows = O.buildForm(res, cfg), draft = !S.ready;
    const rowsHtml = rows.map(r => "<tr><td class='k'>" + r.n + ". " + esc(r.label) + (r.sub ? "<small>" + esc(r.sub) + "</small>" : "") + "</td><td>" + r.html + "</td></tr>").join("");
    const draftBanner = draft ? "<div class='draft'>טיוטה — לא מוכן לשליחה: " + (S.stale ? "הנתונים השתנו מאז הרצת הבדיקות" : "יש בדיקות שלא הושלמו") + ".</div>" : "";
    const now = new Date();
    const p1 = "<div class='paper'>" + draftBanner + "<div class='hdr'><span>פמ״ת פנים ארצי א-11 — נספח ג׳</span><span>טופס בקשה לסגירה אווירית</span></div><table class='f'>" + rowsHtml + "</table>" +
      "<p style='margin-top:8px'><b>חובה לצרף מפה/תצ״א</b> — מצורפת: מפה בעמוד 2.<br>*את הבקשה יש להגיש לכתובות המייל: <span dir='ltr'>" + esc(cfg.mail.to.join(", ")) + "</span></p>" +
      "<div class='foot'><span>" + esc(cfg.form) + "</span><span>הופק " + esc(now.toLocaleDateString("he-IL")) + "</span></div></div>";
    const items = res.nearScan.items;
    const legend = items.length ? "<h2>מכשולים ותשתיות המסומנים במפה</h2><table class='t'><tr><th>#</th><th>מה</th><th>מרחק מהנקודה</th><th>איפה</th></tr>" +
      items.map(i => "<tr><td>" + i.n + "</td><td>" + esc(i.title) + (i.height ? " · גובה " + C.trimNum(i.height, 0) + " מ׳" : "") + "</td><td>" + esc(O.dLabel(i.d)) + "</td><td>" + (i.zone === "in" ? "בתוך האזור" : "בטבעת הכתומה") + "</td></tr>").join("") + "</table>" : "";
    const img = S.map && S.map.dataUrl ? "<img class='mapimg' alt='מפה' src='" + S.map.dataUrl + "'>" : "<div class='draft'>תמונת המפה לא נוצרה.</div>";
    const p2 = "<div class='paper'>" + draftBanner + "<div class='hdr'><span>מפה/תצ״א מצורפת לבקשה</span><span>" + esc((M.PROVIDERS[S.map ? S.map.provider : "esri"] || {}).name || "") + "</span></div>" + img + legend + "</div>";
    const checks = O.buildChecks(res, data, cfg);
    const chk = checks.map(r => "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td><td>" + r[2] + "</td></tr>").join("");
    const dn = res.sun.map(r => "<tr><td>יום " + esc(r.dayName) + " " + C.ddmmyyyy(r.date) + "</td><td>" + r.sunrise + "</td><td>" + r.sunset + "</td><td>" + C.fmtHM(r.dayMin) + "</td><td>" + C.fmtHM(r.nightMin) + "</td></tr>").join("");
    const wd = res.workingDays;
    const p3 = "<div class='paper checks'><div class='hdr'><span>דף בדיקות</span><span>לא חלק מהטופס הרשמי</span></div>" +
      "<h2>הנקודה</h2><p><span dir='ltr'>" + esc(C.dmsLat(res.inp.lat) + " " + C.dmsLon(res.inp.lon)) + "</span> · ירוק: " + res.R + " מ׳ · כתום: עד " + 2 * res.R + " מ׳ · גובה " + C.trimNum(res.inp.heightM, 2) + " מ׳ (" + res.ft.toFixed(1) + " רגל)</p>" +
      "<h2>הבדיקות שבוצעו</h2><table class='t ck'><tr><th>בדיקה</th><th>מקור</th><th>תוצאה</th></tr>" + chk + "</table>" +
      "<h2>יום ולילה בחלון הפעילות</h2><table class='t'><tr><th>תאריך</th><th>זריחה</th><th>שקיעה</th><th>שעות יום בחלון</th><th>שעות לילה בחלון</th></tr>" + dn + "</table>" +
      "<p class='muted'>זריחה ושקיעה לפי חישוב אסטרונומי לנקודה, לא לוח רשמי. ההתייחסות לגובה ולתנאים זהה ביום ובלילה.</p>" +
      "<h2>הגשה</h2><p>" + (wd != null ? "ימי עבודה (א׳–ה׳, בלי חגים) מיום ההגשה (" + esc(res.todayYmd.split("-").reverse().join(".")) + ") ועד תחילת הפעילות: <b>" + wd + "</b>. הנוהל (א-11 סעיף 6.ב) דורש לפחות " + cfg.thresholds.min_working_days + ". " : "") +
      "בנוסף יש להגיש את תוכנית הטיסה שוב למודיעין טיס ביום שלפני הטיסה: <span dir='ltr'>" + esc(cfg.mail.fpl) + "</span> (א-11 סעיף 3.ד.4).</p>" +
      "<h2>מגבלות המקורות</h2><ul>" + O.sourceNotes(res, data, cfg).map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" +
      "<div class='foot'><span>מקורות: " + esc((data.zones && data.zones.edition) || "") + " · פמ״ת א-11 עדכון 1/26 · OpenStreetMap · נוטמים</span><span>הופק " + esc(now.toLocaleString("he-IL")) + "</span></div></div>";
    $("report").className = $("incChecks").checked ? "" : "nochecks";
    $("report").innerHTML = p1 + p2 + p3;
    const style = document.getElementById("nochecksStyle") || Object.assign(document.createElement("style"), { id: "nochecksStyle" });
    style.textContent = ".nochecks .paper.checks{display:none !important}"; document.head.appendChild(style);
    S.reportHtml = true;
  }

  /* ---------- הורדות והעתקה ---------- */
  function download(name, mime, data) {
    const b = data instanceof Blob ? data : new Blob([data], { type: mime });
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const baseName = () => "closure_" + S.res.inp.dateFrom + "_" + S.res.inp.lat.toFixed(4) + "_" + S.res.inp.lon.toFixed(4);
  async function copyMail() {
    const m = O.mail(S.res, S.cfg), txt = "אל: " + m.to.join(", ") + "\nנושא: " + m.subject + "\n\n" + m.body;
    try { await navigator.clipboard.writeText(txt); } catch (e) { const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e2) { /* ignore */ } t.remove(); }
    $("btnCopy").textContent = "הועתק ✔"; setTimeout(() => { $("btnCopy").textContent = "העתק טקסט מייל"; }, 2000);
  }

  /* ---------- בדיקה עצמית ---------- */
  async function selfTest() {
    const out = [], add = (name, ok, detail) => out.push({ name, ok, detail: detail || "" });
    try {
      const [exp, near, far, ext, rev, nsnap] = await Promise.all(["tests/expected.json", "tests/fixtures/yarkon/near.json", "tests/fixtures/yarkon/far.json", "tests/fixtures/yarkon/ext.json", "tests/fixtures/yarkon/reverse.json", "tests/fixtures/notam-data.snap.json"].map(getJson));
      const cfg = S.cfg, inp = Object.assign({}, exp.input, { purpose: cfg.purposes[0], aircraft: [cfg.aircraft[0]], vlos: true, siteName: "בדיקה", requesterName: "בודק", requesterPhone: "050-0000000", contactNames: "א; ב", contactPhone: "050-0000001" });
      const data = { zones: S.data.zones, inpa: S.data.inpa, agri: S.data.agri, notams: nsnap.notams, notamFetchedIso: nsnap.fetched_iso, near, far, ext, reverse: rev };
      const res = C.analyze(inp, data, cfg, new Date(exp.now));
      const near1 = (a, b, tol) => Math.abs(a - b) <= tol;
      exp.items.forEach(e => { const it = res.nearScan.items.find(i => i.title === e.title); add("מכשול: " + e.title + " — " + e.d + " מ׳", !!it && near1(it.d, e.d, e.tol || 1.5) && it.zone === e.zone, it ? "חושב " + it.d.toFixed(1) + " מ׳" : "לא נמצא"); });
      add("מספר המכשולים והתשתיות (" + exp.items.length + ")", res.nearScan.items.length === exp.items.length, "נמצאו " + res.nearScan.items.length);
      exp.zones.forEach(e => { const z = [...res.zones.inside, ...res.zones.near].find(x => x.id === e.id); add("אזור " + e.id + " במרחק " + e.d + " מ׳", !!z && near1(z.d, e.d, e.tol || 1.5) && (e.where === "near" ? res.zones.near.includes(z) : res.zones.inside.includes(z)), z ? "חושב " + z.d.toFixed(1) : "לא נמצא"); });
      add("שקיעות " + exp.sunset.join(", "), JSON.stringify(res.sun.map(r => r.sunset)) === JSON.stringify(exp.sunset), res.sun.map(r => r.sunset).join(", "));
      add("המרה לרגל: " + exp.heightM + " מ׳ = " + exp.ft + " רגל", near1(res.ft, exp.ft, 0.01), res.ft.toFixed(3));
      add("DMS של הנקודה", C.dmsLat(inp.lat) === exp.dmsLat && C.dmsLon(inp.lon) === exp.dmsLon, C.dmsLat(inp.lat) + " " + C.dmsLon(inp.lon));
      add("הצעת שם המקום", res.siteSuggestion === exp.siteSuggestion, res.siteSuggestion);
      add("נוטמים רלוונטיים", JSON.stringify(res.notams.hits.map(h => h.id).sort()) === JSON.stringify(exp.notamHits.slice().sort()), res.notams.hits.map(h => h.id).join(", "));
      const rows = O.buildForm(res, cfg);
      add("בטופס 17 שדות", rows.length === 17, String(rows.length));
      add("אין מילות 'טרם נבדק' בטופס", !/טרם נבדק|לא נבדק/.test(rows.map(r => r.text).join(" ")), "");
      const kml = O.kml(res, data, cfg);
      add("KML תקין (XML)", new DOMParser().parseFromString(kml, "application/xml").getElementsByTagName("parsererror").length === 0, kml.length + " תווים");
    } catch (e) { add("טעינת נתוני הבדיקה", false, e.message); }
    const ok = out.every(x => x.ok);
    $("stList").innerHTML = out.map(x => '<li class="' + (x.ok ? "ok" : "no") + '">' + (x.ok ? "✔ " : "✖ ") + esc(x.name) + (x.detail ? ' <span class="hint">— ' + esc(x.detail) + "</span>" : "") + "</li>").join("");
    setStatus("selftest", ok, ok ? "" : out.filter(x => !x.ok).map(x => x.name).join("; "));
    const b = $("selftestBanner");
    if (ok) { b.style.display = "none"; } else { b.style.display = "block"; b.textContent = "הבדיקה העצמית של המערכת נכשלה — לא ניתן לסמן בקשה כמוכנה לשליחה. פתחו את 'בדיקה עצמית' למטה לפרטים."; $("stBox").open = true; }
    return ok;
  }

  /* ---------- אתחול ---------- */
  async function init() {
    initMap();
    const okCfg = await loadStatic();
    ["radius", "height", "dateFrom", "dateTo", "timeFrom", "timeTo"].forEach(id => $(id).addEventListener("input", () => { if (id === "radius") drawCircles(); onScanInputChange(); }));
    $("coord").addEventListener("change", () => { const c = C.parseCoordInput($("coord").value); if (c) setCenter(c.lat, c.lon, true); });
    ["siteName", "purpose", "vlos", "reqName", "reqPhone", "contactNames", "contactPhone"].forEach(id => $(id).addEventListener("input", () => { if (id.startsWith("req") || id.startsWith("contact")) savePerson(); onSoftInputChange(); }));
    $("aircraft").addEventListener("change", onSoftInputChange);
    $("incChecks").addEventListener("change", () => { if (S.res) renderReport(); });
    $("provider").addEventListener("change", () => { if (S.res) { S.stale = true; refreshGate(); } });
    $("runBtn").onclick = run; $("qBtn").onclick = searchPlace; $("q").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); searchPlace(); } });
    $("btnPrint").onclick = () => window.print();
    $("btnKml").onclick = () => download(baseName() + ".kml", "application/vnd.google-earth.kml+xml", O.kml(S.res, { zones: S.data.zones }, S.cfg));
    $("btnPng").onclick = async () => { const b = await (await fetch(S.map.dataUrl)).blob(); download(baseName() + ".png", "image/png", b); };
    $("btnCopy").onclick = copyMail;
    $("wipePerson").onclick = () => { ls.del(PERSON_KEY); ["reqName", "reqPhone", "contactNames", "contactPhone"].forEach(id => { $(id).value = ""; }); };
    $("stRun").onclick = selfTest;
    setStatus("selftest", false, "טרם הורצה");
    if (okCfg) await selfTest();
    window.__REQ = { S, C, O, M, run, selfTest, setCenter, readInputs };
    window.__REQ_READY = true;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
