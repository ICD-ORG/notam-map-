# -*- coding: utf-8 -*-
"""
updater.py — תוכנית ב': מחולל notam-data.json מאתר רש"ת
הארגון הישראלי לרחפנים · icd.org.il

שימוש: python updater.py
פלט:  notam-data.json (להעלאה לאתר לצד notam-map.html)
תזמון אוטומטי: Windows Task Scheduler / cron, פעם ביום.
"""
import re, json, sys, time, urllib.request, urllib.parse, datetime, html as H
from notam_translate import translate, make_name

LIST_URL = 'https://brin.iaa.gov.il/aeroinfo/AeroInfo.aspx?msgType=Notam'
HDRS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': LIST_URL}

# ===== סיווג לקטגוריות =====
ICAO_HE = {'LLBG':'נתב"ג','LLSD':'שדה דב','LLHZ':'הרצליה','LLHA':'חיפה','LLRM':'רמון',
 'LLES':'עין שמר','LLMG':'מגידו','LLIB':'ראש פינה','LLKS':'קרית שמונה','LLBS':'באר שבע',
 'LLEY':'עין יהב','LLMZ':'מצדה','LLYT':'יטבתה','LLGV':'גבעולים','LLFK':'פיק','LLZR':'זוהר'}

def classify(raw, loc):
    t = raw.upper()
    if re.search(r'\bUAS\b|\bUAV\b', t): return 'uas'
    if re.search(r'\bPJE\b|PARACHUT', t): return 'pje'
    if re.search(r'\bFRNG\b|FIRING', t): return 'frng'
    if re.search(r'CRANE|\bOBST\b', t): return 'obst'
    if re.search(r'BALLOON|AEROBATIC|MODEL ACFT|\bGLD\b|ULTRALIGHT', t): return 'act'
    if loc and loc != 'LLLL': return 'ad'
    if re.search(r'\bRWY\b|\bTWY\b|\bAPN\b|\bILS\b|\bVOR\b|\bDME\b|\bTWR\b', t): return 'ad'
    return 'other'

def http_get(url):
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HDRS)
            return urllib.request.urlopen(req, timeout=90).read().decode('utf-8', 'ignore')
        except Exception as e:
            last = e
            print(f'  משיכת הרשימה נכשלה (ניסיון {attempt+1}/3): {e} — ממתין 20 שניות...')
            time.sleep(20)
    raise last

def collect_fields(page):
    fields = {}
    for m in re.finditer(r'<input[^>]*name="([^"]+)"[^>]*>', page):
        tag, name = m.group(0), m.group(1)
        vm = re.search(r'value="([^"]*)"', tag)
        tp = re.search(r'type="([^"]*)"', tag); t = tp.group(1) if tp else 'text'
        if t in ('checkbox', 'radio'):
            if 'checked' in tag: fields[name] = vm.group(1) if vm else 'on'
        elif t not in ('submit', 'button'):
            fields[name] = vm.group(1) if vm else ''
    return fields

def fetch_detail(fields0, num, _retry=True):
    f = dict(fields0)
    f.update({'hidMsgNum': num, 'hidMode': 'more', 'hidCurOrHist': 'Current',
              'hidTblClientId': '', 'btnMoreInfo': 'btnMoreInfo'})
    body = urllib.parse.urlencode(f).encode()
    req = urllib.request.Request(LIST_URL, data=body,
        headers={**HDRS, 'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        out = urllib.request.urlopen(req, timeout=90).read().decode('utf-8', 'ignore')
    except Exception as e:
        if _retry:
            time.sleep(8)
            return fetch_detail(fields0, num, _retry=False)
        raise
    m = re.search(r"\(([A-Z]\d{4}/\d{2}\s+NOTAM[NRC][\s\S]*?)'\);", out)
    if not m: return None
    txt = m.group(1)
    txt = txt.replace('</MsgText><MsgText>', '\n')
    txt = re.sub(r'</?Msg(Text)?>', '', txt)
    txt = txt.replace('\\r\\n', '\n').replace('\\n', '\n').replace("\\'", "'")
    txt = re.sub(r'[ \t]+\n', '\n', txt)
    return txt.strip()

def main():
    print('מושך רשימת נוטמים...')
    page = http_get(LIST_URL)
    if 'NotamID' not in page:
        raise SystemExit('שגיאה: הרשימה לא נטענה (ייתכן שהכתובת חסומה מהרשת הזו)')

    num_map = {}
    for m in re.finditer(r'divMainInfo_(\d+)"[\s\S]{0,2500}?<td class="NotamID">\s*([A-Z]\d{4}/\d{2})', page):
        num_map.setdefault(m.group(2), m.group(1))

    cells = re.findall(r'<td class="(NotamID|Location|MsgText)">\s*([\s\S]*?)\s*</td>', page)
    previews, locs, cur = {}, {}, None
    i = 0
    while i < len(cells):
        typ, val = cells[i]; val = H.unescape(val).strip()
        if typ == 'NotamID' and val:
            cur = val; previews.setdefault(cur, '')
            if i + 1 < len(cells) and cells[i+1][0] == 'Location':
                locs[cur] = cells[i+1][1].strip(); i += 1
        elif typ == 'MsgText' and cur and val and val != '&nbsp;':
            previews[cur] += ' ' + val
        i += 1

    uas = list(previews.keys())  # כל הנוטמים הפנים-ארציים
    print(f'סה"כ {len(uas)} נוטמים. מושך פרטים מלאים לכולם...')

    fields0 = collect_fields(page)
    notams = []
    for k, nid in enumerate(uas, 1):
        num = num_map.get(nid)
        if not num: continue
        try:
            raw = fetch_detail(fields0, num)
            if not raw: print(f'[{k}/{len(uas)}] {nid} — אין פירוט'); continue
            eM = re.search(r'E\)\s*([\s\S]*?)(?=\n[FG]\)|$)', raw)
            e_text = eM.group(1).strip() if eM else raw
            loc = locs.get(nid, '')
            cat = classify(raw, loc)
            heb = translate(raw, e_text)
            name = make_name(raw, e_text, nid, heb)
            if cat == 'ad' and loc in ICAO_HE:
                name = ICAO_HE[loc] + ' (' + loc + ')'
            notams.append({'id': nid, 'loc': loc, 'name': name, 'cat': cat,
                           'heb': heb, 'raw': raw})
            print(f'[{k}/{len(uas)}] {nid} [{cat}] — OK')
            time.sleep(0.6)
            if k % 25 == 0:
                print('  ...הפסקה קצרה (עדינות מול השרת)...')
                time.sleep(5)
        except Exception as e:
            print(f'[{k}/{len(uas)}] {nid} — שגיאה: {e}')

    now = datetime.datetime.now(datetime.timezone.utc)
    now_iso = now.strftime('%Y-%m-%dT%H:%M:%SZ')

    # ===== מעקב "מה חדש" ו"מה ירד": משווים מול הקובץ הקודם (אם קיים בתיקייה) =====
    PRE_UPGRADE_DATE = '2026-07-01T00:00:00Z'
    RETENTION_DAYS = 21

    old_by_id, old_removed = {}, []
    try:
        with open('notam-data.json', encoding='utf-8') as f:
            prev = json.load(f)
        for it in prev.get('notams', []):
            old_by_id[it['id']] = it
        old_removed = prev.get('removed', [])
    except Exception:
        pass

    new_ids = set()
    for it in notams:
        new_ids.add(it['id'])
        prior = old_by_id.get(it['id'])
        if prior and prior.get('first_seen'):
            it['first_seen'] = prior['first_seen']
        elif prior:
            it['first_seen'] = PRE_UPGRADE_DATE
        else:
            it['first_seen'] = now_iso

    newly_removed = []
    for old_id, old_item in old_by_id.items():
        if old_id not in new_ids:
            newly_removed.append({
                'id': old_id, 'name': old_item.get('name', old_id), 'cat': old_item.get('cat', 'other'),
                'heb': old_item.get('heb', ''), 'removed_at': now_iso
            })
    removed = newly_removed + old_removed
    cutoff = now - datetime.timedelta(days=RETENTION_DAYS)
    removed = [r for r in removed if datetime.datetime.strptime(r['removed_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc) >= cutoff]

    out = {'fetched_at': now.strftime('%d/%m/%Y %H:%M UTC'),
           'fetched_iso': now_iso,
           'count': len(notams), 'notams': notams, 'removed': removed}
    with open('notam-data.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'נשמר notam-data.json עם {len(notams)} נוטמים ({len(newly_removed)} ירדו הפעם, {len(removed)} סה"כ בהיסטוריית הירידות). העלו את הקובץ לאתר.')

def retranslate():
    """תרגום מחדש של notam-data.json מהנוטמ המקורי (raw) — בלי גישה לרש"ת."""
    with open('notam-data.json', encoding='utf-8') as f:
        d = json.load(f)
    for it in d.get('notams', []) + d.get('removed', []):
        raw = it.get('raw')
        if not raw: continue
        eM = re.search(r'E\)\s*([\s\S]*?)(?=\n[FG]\)|$)', raw)
        e_text = eM.group(1).strip() if eM else raw
        it['heb'] = translate(raw, e_text)
        name = make_name(raw, e_text, it['id'], it['heb'])
        if it.get('cat') == 'ad' and it.get('loc') in ICAO_HE:
            name = ICAO_HE[it['loc']] + ' (' + it['loc'] + ')'
        it['name'] = name
    with open('notam-data.json', 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    print('תורגמו מחדש', len(d.get('notams', [])), 'נוטמים')

if __name__ == '__main__':
    if '--retranslate' in sys.argv: retranslate()
    else: main()
