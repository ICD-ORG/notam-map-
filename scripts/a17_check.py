# -*- coding: utf-8 -*-
"""
a17_check.py — בדיקה רבעונית: האם פורסם עדכון חדש לפמ"ת פנים ארצי פרק א-17
הארגון הישראלי לרב להב · icd.org.il

מה הסקריפט עושה:
  1. מוריד את הקובץ הרשמי מאתר רשות התעופה האזרחית (gov.il).
  2. קורא מהקובץ את מספר העדכון האחרון (למשל 1/26) ואת תאריכו.
  3. משווה למה שמוגדר ב-data/pmt-zones.json (השדה "edition").
  4. עדכון חדש / שינוי בתוך אותו עדכון / כשל בהורדה  ->  שומר את הקובץ ב-data/source/
     ופותח Issue ב-GitHub (GitHub שולח על כך מייל), ואם הוגדרו פרטי SMTP — גם מייל ישיר.
  5. אין שינוי -> לא עושה כלום (לא מרעיש), ושומר קובץ בסיס להשוואות עתידיות אם עוד אין.

הסקריפט לא משנה את data/pmt-zones.json. את הנתונים מעדכנים לפי הקובץ שנשמר (ריצת העדכון הרבעונית של Claude).
שימוש:  python scripts/a17_check.py [--file קובץ.pdf] [--dry-run] [--assume-repo-edition N/YY]
"""
import argparse, datetime, hashlib, json, os, pathlib, re, shutil, smtplib, subprocess, sys, time, urllib.request
from email.message import EmailMessage

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = "https://www.gov.il/BlobFolder/guide/aip/he/aip_%D7%90'-17.pdf"
DATA = ROOT / "data" / "pmt-zones.json"
SRC = ROOT / "data" / "source"
MARK = "[a17-check]"
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


def repo_edition(override=None):
    if override:
        n, yy = override.split("/")
        return (int(yy), int(n), None)
    ed = clean(json.load(open(DATA, encoding="utf-8")).get("edition", ""))
    m = ED_RE.search(ed)
    if not m:
        raise SystemExit("לא נמצא מספר עדכון בשדה edition של data/pmt-zones.json")
    return (int(m.group(2)), int(m.group(1)), parse_date(ed))


def fmt(ed):
    return f"{ed[1]}/{ed[0]:02d}" + (f" ({ed[2].strftime('%d.%m.%Y')})" if ed[2] else "")


def fetch():
    last = None
    for i in range(3):
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "application/pdf,*/*"})
            data = urllib.request.urlopen(req, timeout=90).read()
            if data[:4] != b"%PDF" or len(data) < 100_000:
                raise RuntimeError(f"התשובה אינה קובץ PDF תקין ({len(data)} בייטים)")
            return data
        except Exception as e:  # noqa
            last = e
            print(f"  הורדה נכשלה (ניסיון {i+1}/3): {e}")
            time.sleep(15)
    raise RuntimeError(f"לא הצלחתי להוריד את {URL}: {last}")


def pdftotext(path):
    if not shutil.which("pdftotext"):
        raise RuntimeError("pdftotext (poppler-utils) לא מותקן")
    r = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, timeout=180)
    if r.returncode != 0:
        raise RuntimeError("pdftotext נכשל: " + r.stderr.decode("utf-8", "ignore")[:200])
    return r.stdout.decode("utf-8", "ignore")


def norm_hash(text):
    return hashlib.sha256(re.sub(r"\s+", " ", clean(text)).encode()).hexdigest()


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
        with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", "587"))) as s:
            s.starttls(); s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"]); s.send_message(msg)
        print("נשלח מייל אל", os.environ["MAIL_TO"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", help="קובץ PDF מקומי במקום הורדה (לבדיקות)")
    ap.add_argument("--dry-run", action="store_true", help="לא פותח Issue/מייל ולא כותב ל-data/source")
    ap.add_argument("--assume-repo-edition", help="לבדיקות: להניח שהעדכון בריפו הוא N/YY")
    ap.add_argument("--src-dir", help="לבדיקות: תיקיית יעד אחרת במקום data/source")
    a = ap.parse_args()
    src = pathlib.Path(a.src_dir) if a.src_dir else SRC
    base = repo_edition(a.assume_repo_edition)
    print("בריפו (data/pmt-zones.json):", fmt(base))

    try:
        data = pathlib.Path(a.file).read_bytes() if a.file else fetch()
        tmp = src / "_tmp.pdf"
        if not a.dry_run:
            src.mkdir(parents=True, exist_ok=True); tmp.write_bytes(data)
        else:
            tmp = pathlib.Path("/tmp/_a17_tmp.pdf"); tmp.write_bytes(data)
        text = pdftotext(tmp)
        site = max_edition(text)
        if not site:
            raise RuntimeError("לא נמצא מספר עדכון בכותרות התחתון של הקובץ שהורד")
    except Exception as e:  # noqa
        notify("לא הצלחתי להוריד/לקרוא את א-17 — נדרש הקובץ",
               f"הבדיקה הרבעונית נכשלה: {e}\n\nהמקור שנבדק: {URL}\n\n"
               "מה צריך לעשות: להוריד את הקובץ העדכני של פמ\"ת פרק א-17 מאתר רת\"א ולהעלות אותו לתיקייה data/source/ בריפו "
               "(Add file → Upload files), או לשלוח אותו ל-Claude. עד אז המפה ממשיכה להציג את העדכון "
               f"{fmt(base)}.", a.dry_run)
        return 0

    print("באתר:", fmt(site))
    tag = f"a17-{site[1]}-{site[0]:02d}"
    pdf_path, txt_path = src / f"{tag}.pdf", src / f"{tag}.txt"
    newer, same = site[:2] > base[:2], site[:2] == base[:2]

    def keep():
        if a.dry_run:
            return
        shutil.copyfile(tmp, pdf_path); txt_path.write_text(clean(text), encoding="utf-8")

    if newer:
        keep()
        notify(f"פורסם עדכון חדש לפמ\"ת א-17: {fmt(site)}",
               f"במפה כרגע: עדכון {fmt(base)}. באתר רת\"א: עדכון {fmt(site)}.\n"
               f"הקובץ נשמר ב-data/source/{tag}.pdf (וטקסט מחולץ: {tag}.txt).\n\n"
               "נתוני המפה (data/pmt-zones.json) עדיין לא עודכנו — העדכון מתבצע בריצה הרבעונית של Claude (ב-3 לחודש) ומוגש כ-Pull Request לאישור. "
               f"קישור ישיר לקובץ: {URL}", a.dry_run)
    elif same:
        if txt_path.exists():
            if norm_hash(text) != norm_hash(txt_path.read_text(encoding="utf-8")):
                if not a.dry_run:
                    shutil.copyfile(tmp, src / f"{tag}-changed-{datetime.date.today():%Y%m%d}.pdf")
                notify(f"הקובץ של א-17 השתנה בלי מספר עדכון חדש ({fmt(site)})",
                       "הטקסט בקובץ באתר שונה מהקובץ ששמרנו כבסיס לאותו עדכון. כדאי לבדוק מה השתנה.", a.dry_run)
            else:
                print("אין שינוי. הכול מעודכן.")
        else:
            keep(); print("נשמר קובץ בסיס לעדכון הנוכחי:", pdf_path.name)
    else:
        print(f"באתר עדכון ישן מזה שבמפה ({fmt(site)} < {fmt(base)}) — לא נעשה כלום.")
    if not a.dry_run and tmp.exists():
        tmp.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main())
