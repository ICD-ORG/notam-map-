# -*- coding: utf-8 -*-
"""
a17_check.py — בדיקה רבעונית: האם פורסם עדכון חדש לפמ"ת פנים ארצי: א-17 (אזורים אסורים), א-11 (תוכנית טיסה וטופס סגירה אווירית), ב-09 (כטב"מים)
הארגון הישראלי לרב להב · icd.org.il

מה הסקריפט עושה, לכל מסמך:
  1. מוריד את הקובץ הרשמי מאתר רשות התעופה האזרחית (gov.il).
  2. קורא מהקובץ את מספר העדכון האחרון (למשל 1/26) ואת תאריכו.
  3. משווה לעדכון הידוע: ל-א-17 — השדה "edition" ב-data/pmt-zones.json; לשאר — הקובץ הגבוה ביותר ב-data/source/.
  4. עדכון חדש / שינוי בתוך אותו עדכון / כשל בהורדה -> שומר את הקובץ ב-data/source/ ופותח Issue ב-GitHub
     (GitHub שולח על כך מייל), ואם הוגדרו פרטי SMTP — גם מייל ישיר.
  5. אין שינוי -> לא עושה כלום (לא מרעיש), ושומר קובץ בסיס להשוואות עתידיות אם עוד אין.

הסקריפט לא משנה את data/pmt-zones.json. את הנתונים מעדכנים לפי הקובץ שנשמר (בסשן של Claude).
שימוש:  python scripts/a17_check.py [--doc A-17] [--file קובץ.pdf] [--dry-run] [--assume-repo-edition N/YY]
"""
import argparse, datetime, hashlib, json, os, pathlib, re, shutil, smtplib, subprocess, sys, time, urllib.request
from email.message import EmailMessage

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = "https://www.gov.il/BlobFolder/guide/aip/he/"
DATA = ROOT / "data" / "pmt-zones.json"
SRC = ROOT / "data" / "source"
MARK = "[a17-check]"
# critical=False: הכתובת לא אומתה — כשל בהורדה יירשם ביומן בלבד ולא יפתח Issue
DOCS = [
    dict(id="A-17", tag="a17", name='פמ"ת א-17', url=BASE + "aip_%D7%90'-17.pdf", critical=True),
    dict(id="B-09", tag="b09", name='פמ"ת ב-09', url=BASE + "aip_%D7%91'-09.pdf", critical=True),
    dict(id="A-11", tag="a11", name='פמ"ת א-11', url=BASE + "aip_%D7%90'-11.pdf", critical=False),
]
MONTHS = [("ינו", 1), ("פבר", 2), ("מרץ", 3), ("אפר", 4), ("מאי", 5), ("יונ", 6), ("יול", 7), ("אוג", 8), ("ספט", 9), ("אוק", 10), ("נוב", 11), ("דצמ", 12)]
CTRL = re.compile("[‎‏‪-‮⁦-⁩]")
ED_RE = re.compile(r"עדכון\s*(\d{1,2})\s*/\s*(\d{2})")
DATE_RE = re.compile(r"(\d{1,2})\s*(" + "|".join(m for m, _ in MONTHS) + r")\S*\s*(\d{4})")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


def clean(t):
    return CTRL.sub("", t)


def parse_date(s):
    m = DATE_RE.search(s)
    if not m:
        return None
    mon = next(n for p, n in MONTHS if m.group(2) == p)
    try:
        return datetime.date(int(m.group(3)), mon, int(m.group(1)))
    except ValueError:
        return None


def max_edition(text):
    """העדכון הגבוה ביותר מבין כל כותרות-התחתון של העמודים: (שנה, מספר, תאריך)"""
    best = None
    for page in clean(text).split("\f"):
        eds = ED_RE.findall(page)
        if not eds:
            continue
        n, yy = eds[-1]
        d = parse_date(page[page.rfind("עדכון") - 80:] if "עדכון" in page else page)
        cand = (int(yy), int(n), d)
        if best is None or cand[:2] > best[:2]:
            best = cand
    return best


def known_edition(doc, src, override=None):
    if override:
        n, yy = override.split("/")
        return (int(yy), int(n), None)
    if doc["id"] == "A-17":
        ed = clean(json.load(open(DATA, encoding="utf-8")).get("edition", ""))
        m = ED_RE.search(ed)
        if not m:
            raise SystemExit("לא נמצא מספר עדכון בשדה edition של data/pmt-zones.json")
        return (int(m.group(2)), int(m.group(1)), parse_date(ed))
    best = None
    for f in src.glob(f"{doc['tag']}-*-*.txt"):
        m = re.fullmatch(rf"{doc['tag']}-(\d+)-(\d{{2}})\.txt", f.name)
        if m and (best is None or (int(m.group(2)), int(m.group(1))) > best[:2]):
            best = (int(m.group(2)), int(m.group(1)), None)
    return best


def fmt(ed):
    return f"{ed[1]}/{ed[0]:02d}" + (f" ({ed[2].strftime('%d.%m.%Y')})" if ed[2] else "")


def fetch(url):
    last = None
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/pdf,*/*"})
            data = urllib.request.urlopen(req, timeout=90).read()
            if data[:4] != b"%PDF" or len(data) < 50_000:
                raise RuntimeError(f"התשובה אינה קובץ PDF תקין ({len(data)} בייטים)")
            return data
        except Exception as e:  # noqa
            last = e
            print(f"  הורדה נכשלה (ניסיון {i+1}/3): {e}")
            time.sleep(15)
    raise RuntimeError(f"לא הצלחתי להוריד את {url}: {last}")


def pdftotext(path):
    if not shutil.which("pdftotext"):
        raise RuntimeError("pdftotext (poppler-utils) לא מותקן")
    r = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError("pdftotext נכשל: " + r.stderr.decode("utf-8", "ignore")[:200])
    return r.stdout.decode("utf-8", "ignore")


def similarity(a, b):
    """דמיון בין שני טקסטים לפי קבוצת השורות (0..1). מתעלם מהבדלי מרווחים."""
    norm = lambda t: {re.sub(r"\s+", " ", l).strip() for l in clean(t).splitlines() if l.strip()}
    sa, sb = norm(a), norm(b)
    return len(sa & sb) / max(1, len(sa | sb))


def notify(title, body, dry):
    print("\n=== הודעה ===\n" + title + "\n" + body + "\n=============")
    if dry:
        return
    summ = os.environ.get("GITHUB_STEP_SUMMARY")
    if summ:
        open(summ, "a", encoding="utf-8").write(f"### {title}\n\n{body}\n")
    if shutil.which("gh") and os.environ.get("GH_TOKEN"):
        ex = subprocess.run(["gh", "issue", "list", "--state", "open", "--search", f"{MARK} in:title", "--json", "number", "--jq", ".[0].number"], capture_output=True, text=True)
        num = ex.stdout.strip()
        if num:
            subprocess.run(["gh", "issue", "comment", num, "--body", f"**{title}**\n\n{body}"], check=True)
        else:
            subprocess.run(["gh", "issue", "create", "--title", f"{MARK} {title}", "--body", body], check=True)
    if all(os.environ.get(k) for k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_TO")):
        msg = EmailMessage()
        msg["Subject"] = f"{MARK} {title}"; msg["From"] = os.environ["SMTP_USER"]; msg["To"] = os.environ["MAIL_TO"]
        msg.set_content(body)
        with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT") or "587")) as s:
            s.starttls(); s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"]); s.send_message(msg)
        print("נשלח מייל אל", os.environ["MAIL_TO"])


def check(doc, a, src):
    print(f"\n##### {doc['name']} #####")
    base = known_edition(doc, src, a.assume_repo_edition)
    print("הידוע בריפו:", fmt(base) if base else "אין (ריצה ראשונה — יישמר קובץ בסיס)")
    tmp = pathlib.Path("/tmp/_aip_tmp_%s.pdf" % doc["tag"])
    try:
        data = pathlib.Path(a.file).read_bytes() if a.file else fetch(doc["url"])
        tmp.write_bytes(data)
        text = pdftotext(tmp)
        site = max_edition(text)
        if not site:
            raise RuntimeError("לא נמצא מספר עדכון בכותרות התחתון של הקובץ שהורד")
    except Exception as e:  # noqa
        if doc["critical"]:
            notify(f"לא הצלחתי להוריד/לקרוא את {doc['name']} — נדרש הקובץ",
                   f"הבדיקה הרבעונית נכשלה: {e}\n\nהמקור שנבדק: {doc['url']}\n\n"
                   f"מה צריך לעשות: להוריד את הקובץ העדכני של {doc['name']} מאתר רת\"א ולהעלות אותו לתיקייה data/source/ בריפו "
                   "(Add file → Upload files), או לשלוח אותו ל-Claude. עד אז מתבססים על העדכון הידוע: "
                   f"{fmt(base) if base else 'הקיים'}.", a.dry_run)
        else:
            print(f"דילוג על {doc['name']}: {e}\n(הכתובת לא אומתה; לא נפתח Issue. אפשר להעלות ידנית את הקובץ ל-data/source/.)")
            summ = os.environ.get("GITHUB_STEP_SUMMARY")
            if summ and not a.dry_run:
                open(summ, "a", encoding="utf-8").write(f"- {doc['name']}: ההורדה נכשלה ({e}); הכתובת לא אומתה.\n")
        return
    print("באתר:", fmt(site))
    tag = f"{doc['tag']}-{site[1]}-{site[0]:02d}"
    pdf_path, txt_path = src / f"{tag}.pdf", src / f"{tag}.txt"

    def keep():
        if a.dry_run:
            return
        src.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(tmp, pdf_path); txt_path.write_text(clean(text), encoding="utf-8")

    if base is None or site[:2] > base[:2]:
        keep()
        if base is None:
            print("נשמר קובץ בסיס ראשון:", pdf_path.name)
        else:
            notify(f"פורסם עדכון חדש ל{doc['name']}: {fmt(site)}",
                   f"הידוע בריפו: עדכון {fmt(base)}. באתר רת\"א: עדכון {fmt(site)}.\n"
                   f"הקובץ נשמר ב-data/source/{tag}.pdf (וטקסט מחולץ: {tag}.txt).\n\n"
                   + ("נתוני המפה (data/pmt-zones.json) עדיין לא עודכנו — העדכון מתבצע בסשן של Claude לפי הקובץ שנשמר. "
                      if doc["id"] == "A-17" else
                      "יש לבדוק מה השתנה (בעיקר בטפסים) ולעדכן את הכלים שמבוססים על המסמך. ")
                   + f"קישור ישיר לקובץ: {doc['url']}", a.dry_run)
    elif site[:2] == base[:2]:
        if txt_path.exists():
            sim = similarity(text, txt_path.read_text(encoding="utf-8"))
            if sim < 0.97:
                if not a.dry_run:
                    shutil.copyfile(tmp, src / f"{tag}-changed-{datetime.date.today():%Y%m%d}.pdf")
                notify(f"הקובץ של {doc['name']} השתנה בלי מספר עדכון חדש ({fmt(site)})",
                       f"הטקסט בקובץ באתר שונה מהקובץ ששמרנו כבסיס לאותו עדכון (דמיון {sim:.1%}). כדאי לבדוק מה השתנה.", a.dry_run)
            else:
                print(f"אין שינוי. הכול מעודכן (דמיון לבסיס {sim:.1%}).")
        else:
            keep(); print("נשמר קובץ בסיס לעדכון הנוכחי:", pdf_path.name)
    else:
        print(f"באתר עדכון ישן מזה שבריפו ({fmt(site)} < {fmt(base)}) — לא נעשה כלום.")
    if tmp.exists():
        tmp.unlink()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--doc", help="מסמך בודד: A-17 / A-11 / B-09 (ברירת מחדל: כולם)")
    ap.add_argument("--file", help="קובץ PDF מקומי במקום הורדה (דורש --doc; לבדיקות ולשמירת קובץ בסיס)")
    ap.add_argument("--dry-run", action="store_true", help="לא פותח Issue/מייל ולא כותב ל-data/source")
    ap.add_argument("--assume-repo-edition", help="לבדיקות: להניח שהעדכון הידוע הוא N/YY (דורש --doc)")
    ap.add_argument("--src-dir", help="לבדיקות: תיקיית יעד אחרת במקום data/source")
    a = ap.parse_args()
    if (a.file or a.assume_repo_edition) and not a.doc:
        ap.error("--file / --assume-repo-edition דורשים --doc")
    src = pathlib.Path(a.src_dir) if a.src_dir else SRC
    for doc in DOCS:
        if a.doc and a.doc.upper() != doc["id"]:
            continue
        check(doc, a, src)
    return 0


if __name__ == "__main__":
    sys.exit(main())
