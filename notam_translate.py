# -*- coding: utf-8 -*-
"""תרגום תבניתי של נוטמים לעברית — משותף ל-updater.py ולדף המפה (translate-dict.json הוא המילון היחיד)."""
import json, os, re

_DIR = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_DIR, 'translate-dict.json'), encoding='utf-8') as _f:
    _DICT = json.load(_f)

def _compile():
    out = []
    for en, he in sorted(_DICT, key=lambda p: -len(p[0])):
        pat = r'(^|[^A-Z0-9/])' + re.escape(en).replace(r'\ ', r'\s+') + r'(?![A-Z0-9])'
        out.append((re.compile(pat), he))
    return out
_RX = _compile()

_ENGLISH = set('''FOR AND THE OF WITH WILL BE IS ARE ON IN FROM SHALL NOT NO ALL ANY PILOT GET APPROVAL ACT AREA AIRSPACE RELEVANT
WHEN WHILE DURING AFTER BEFORE DUE REQ REQUIRED AVBL ONLY ALSO CONTACT PLS PLEASE INFO AIRPORT AIRFIELD'''.split())
_KEEP = {'UTC','AIP','NOTAM','AMSL','AGL','GND','VFR','IFR','CVFR','UAS','UAV','PSN','NM','KM','FT','TMA','CTR','ILS','VOR','DME'}

def fmt_coord(a, b, c, d, e, f):
    return f"{int(a)}°{int(b):02d}'{round(float(c)):02d}\"N {int(d)}°{int(e):02d}'{round(float(f)):02d}\"E"

def translate(raw, e_text):
    t = ' ' + re.sub(r'\s+', ' ', e_text).strip() + ' '
    t = re.sub(r'(\d{2})(\d{2})(\d{2}(?:\.\d+)?)N\s?0?(\d{2})(\d{2})(\d{2}(?:\.\d+)?)E',
               lambda m: fmt_coord(*m.groups()), t)
    t = re.sub(r'N(\d{2})(\d{2})(\d{2}(?:\.\d+)?)E\s?0?(\d{2})(\d{2})(\d{2}(?:\.\d+)?)',
               lambda m: fmt_coord(*m.groups()), t)
    # יחידות ומרחקים
    t = re.sub(r'RADIUS (\d[\d\.]*)\s?NM', r'ברדיוס \1 מייל ימי', t)
    t = re.sub(r'RADIUS (\d[\d\.]*)\s?KM', r'ברדיוס \1 ק"מ', t)
    t = re.sub(r'RADIUS (\d[\d\.]*)\s?M\b', r'ברדיוס \1 מטר', t)
    t = re.sub(r'(\d[\d,\.]*)\s?NM RADIUS', r'ברדיוס \1 מייל ימי', t)
    t = re.sub(r'(\d[\d,\.]*)\s?KM RADIUS', r'ברדיוס \1 ק"מ', t)
    t = re.sub(r'(\d[\d,\.]*)\s?M RADIUS', r'ברדיוס \1 מטר', t)
    t = re.sub(r'(\d[\d,]*)\s?FT AMSL', r'\1 רגל מעל פני הים', t)
    t = re.sub(r'(\d[\d,]*)\s?FT AGL', r'\1 רגל מעל הקרקע', t)
    t = re.sub(r'(\d[\d,]*)\s?M AGL', r'\1 מטר מעל הקרקע', t)
    t = re.sub(r'(\d[\d,]*)\s?M AMSL', r'\1 מטר מעל פני הים', t)
    t = re.sub(r'(\d)(?:\s?)FT\b', r'\1 רגל', t)
    t = re.sub(r'(\d[\d\.]*)\s?NM\b', r'\1 מייל ימי', t)
    t = re.sub(r'(\d[\d\.]*)\s?KM\b', r'\1 ק"מ', t)
    t = re.sub(r'(\d) ENGINE ACFT', r'כלי טיס בעלי \1 מנועים', t)
    for rx, he in _RX:
        t = rx.sub(lambda m, he=he: m.group(1) + he, t)
    t = re.sub(r'(\d)\s?MIN\b', r'\1 דקות', t)
    t = re.sub(r'(ב-|מ-|ל-) +', r'\1', t)
    t = re.sub(r'\s+,', ',', t); t = re.sub(r'\s+\.', '.', t); t = re.sub(r'\)\s*$', '', t); t = re.sub(r'\s{2,}', ' ', t).strip()
    left = {w for w in re.findall(r'[A-Za-z]{2,}', re.sub(r'\([^)]*\)', ' ', t)) if w.upper() in _ENGLISH and w.upper() not in _KEEP}
    partial = bool(left)
    b = re.search(r'B\)\s*(\d{10})', raw); c = re.search(r'C\)\s*(\d{10})', raw)
    perm = bool(re.search(r'C\)\s*PERM', raw))
    fmt = lambda s: f"{s[4:6]}/{s[2:4]}/20{s[0:2]} {s[6:8]}:{s[8:10]} UTC"
    if partial:
        t += '\n⚠ תרגום אוטומטי חלקי — יש לקרוא גם את הנוטמ המקורי.'
    if b:
        t += '\nבתוקף: מ-' + fmt(b.group(1)) + (' (קבוע)' if perm else (' עד ' + fmt(c.group(1)) if c else ''))
    d = re.search(r'D\)\s*([^\n]*)', raw)
    if d: t += '\nלו"ז: ' + d.group(1).strip()
    return t

_STOP = r'(?=\s+(?:WI|UP|FM|AGL|AMSL|RADIUS|CTR|AREA|CLSD|BTN|PROHIBITED|EXC|DRG|NGT|ACT)\b|[,\.\n]|$)'
# שמות מקומות שמופיעים באנגלית בשדה AT — מוצגים בעברית (בסוגריים השם המקורי); אם אין התאמה נשאר השם הלועזי כפי שהוא
PLACE_HE = {
    'ADERET': 'עדרת', 'AFULA': 'עפולה', 'ASHDOD': 'אשדוד', 'ASHELIM/SDE-BOKER': 'אשלים/שדה בוקר',
    'BACH-GOLANI': 'בה"ד גולני', 'BARTAAH': 'ברטעה', 'CARMEL NORTH': 'כרמל צפון', 'DALIA/TZAFIT': 'דליה/צפית',
    'EITANIM-HOSPITAL': 'בית חולים איתנים', 'EL-AL JUNCTION': 'צומת אל על', 'EMEK HEFER': 'עמק חפר',
    'GAZA-STRIP': 'רצועת עזה', 'GEZER POWER PLANT': 'תחנת הכוח גזר', 'GOLANI-INTERCHANGE': 'מחלף גולני',
    'HACHULA-LAKE': 'אגמון החולה', 'JDEIDA': "ג'דיידה", 'JULIS': "ג'ולס", 'KELCH/LACHISH': 'כלח/לכיש',
    'KESARYA': 'קיסריה', 'KFAR-TAVOR': 'כפר תבור', 'KIRYAT SHMONA': 'קריית שמונה', 'KOHAV-MICHAL': 'כוכב מיכאל',
    'LATRUN': 'לטרון', 'MACCABIM': 'מכבים', 'MAGAL': 'מגל', 'MAGEN-SHAUL': 'מגן שאול', 'NAURA': 'נעורה',
    'NAZARETH': 'נצרת', 'NESHER': 'נשר', 'OLESH': 'עולש', 'OR-AKIVA INDUSTRY': 'אזור התעשייה אור עקיבא',
    'PARK-REEM': 'פארק רעים', 'TAANACHIM': 'תענכים', 'TAANACHIM AND GADISH': 'תענכים וגדיש', 'TAMRAH': 'תמרה',
    'TEL-NOF': 'תל נוף', 'TIBERIA': 'טבריה', 'YAHUD/IAI INDUSTRY': 'יהוד / התעשייה האווירית', 'YERUHAM': 'ירוחם',
    'TERMINAL 1': 'טרמינל 1',
}
# מילים שמסמנות שהשם נגמר והתחיל תיאור ההגבלה (גזירה של "GEZER POWER PLANT CLSD FM GND…")
_NAME_END = re.compile(r'\s+(?:WI|UP|FM|AGL|AMSL|RADIUS|CTR|AREA|CLSD|BTN|FLW|PSN|PROHIBITED|EXC|DRG|NGT|ACT|ACTIVATED|AVBL|REQ|U/S)\b.*$')

def _cut_words(text, n=48):
    """חיתוך בגבול מילה (לא באמצע מילה/מספר), עם … רק כשבאמת נחתך."""
    if len(text) <= n: return text
    cut = text[:n].rsplit(' ', 1)[0].rstrip(' ,:-/(')
    return cut + '…'

def make_name(raw, e_text, nid, heb=''):
    if re.search(r'\bCHECKLIST\b', e_text):
        return 'רשימת נוט"מים בתוקף (CHECKLIST)'
    if re.search(r'\bTRIGGER NOTAM\b', e_text):
        return 'נוט"ם מנהלי (TRIGGER NOTAM)'
    nm = re.search(r'\bAT\s+([A-Z][A-Z0-9\-/ ]{1,40}?)' + _STOP, e_text)
    if nm and nm.group(1).strip() not in ('GND', 'NIGHT', 'DAY'):
        name = _NAME_END.sub('', nm.group(1).strip()).strip()
        he = PLACE_HE.get(name)
        return he + ' (' + name + ')' if he else name
    first = re.split(r'[\.\n,:]|\s-\s', heb.split('\nבתוקף')[0])[0]
    first = re.sub(r'\d+°\d+\'\d+"N \d+°\d+\'\d+"E', '', first).strip(' ,:')
    first = re.sub(r'\s{2,}', ' ', first)
    return _cut_words(first) if first else nid
