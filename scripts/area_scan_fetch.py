# -*- coding: utf-8 -*-
"""
area_scan_fetch.py — משיכת נתוני סביבה (OpenStreetMap) סביב נקודה, ושמירתם כקובצי JSON גולמיים.
  near.json    מכשולים ותשתיות עד near_r מטר (Overpass)
  far.json     שדות תעופה ומנחתים עד far_r מטר + האזורים שמכילים את הנקודה + ישובים קרובים (Overpass)
  reverse.json שם המקום (Nominatim, בעברית)
  meta.json    זמן, מראה השרת שענה, וספירת אלמנטים
שימוש: python scripts/area_scan_fetch.py --lat 32.099128 --lon 34.816617 --out data/source/scan-test
"""
import argparse, datetime, json, os, sys, time, urllib.error, urllib.parse, urllib.request

UA = "icd-notam-map/1.0 (https://github.com/icd-org/notam-map-)"
MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]


def queries(lat, lon, near_r, far_r, place_r):
    c = f"{lat},{lon}"
    a = f"(around:{near_r},{c})"
    near = (
        "[out:json][timeout:120];("
        f'nwr{a}[man_made~"^(tower|mast|chimney|crane|water_tower|silo|storage_tank|flare|lighthouse|communications_tower|antenna|windmill)$"];'
        f'nwr{a}[power~"^(line|tower|substation|plant|generator)$"];'
        f"nwr{a}[aerialway];"
        f'nwr{a}[building][height~"^([2-9][0-9]|[1-9][0-9][0-9]+)"];'
        f'nwr{a}[building]["building:levels"~"^([6-9]|[1-9][0-9]+)$"];'
        f"nwr{a}[aeroway];"
        f"nwr{a}[emergency=helipad];"
        f"nwr{a}[military];"
        f"nwr{a}[landuse=military];"
        f'nwr{a}[highway~"^(motorway|trunk)$"];'
        f'nwr{a}[railway~"^(rail|light_rail|subway)$"];'
        f'nwr{a}[amenity~"^(hospital|prison|police)$"];'
        f"nwr{a}[leisure=stadium];"
        ");out geom tags;"
    )
    far = (
        "[out:json][timeout:90];"
        f'nwr(around:{far_r},{c})[aeroway~"^(aerodrome|heliport|helipad)$"];out center tags;'
        f"is_in({c});out tags;"
        f"node(around:{place_r},{c})[place];out tags;"
    )
    return near, far


def overpass(q, log):
    last = None
    for mirror in MIRRORS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(mirror, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": UA})
                raw = urllib.request.urlopen(req, timeout=180).read().decode("utf-8")
                d = json.loads(raw)
                if "elements" not in d:
                    raise RuntimeError("תשובה בלי elements: " + raw[:200])
                log(f"  {mirror}: {len(d['elements'])} אלמנטים")
                return d, mirror
            except Exception as e:  # noqa
                last = f"{mirror}: {e}"
                log(f"  נכשל ({last}); ממתין 20 שניות")
                time.sleep(20)
    raise RuntimeError("כל שרתי Overpass נכשלו. אחרון: " + str(last))


def nominatim(lat, lon):
    url = "https://nominatim.openstreetmap.org/reverse?" + urllib.parse.urlencode({"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 18, "accept-language": "he", "addressdetails": 1})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--near-r", type=int, default=800)
    ap.add_argument("--far-r", type=int, default=15000)
    ap.add_argument("--place-r", type=int, default=3000)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    meta = {"fetched_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "lat": a.lat, "lon": a.lon, "near_r": a.near_r, "far_r": a.far_r, "place_r": a.place_r, "errors": []}
    def log(s): print(s, flush=True)
    near_q, far_q = queries(a.lat, a.lon, a.near_r, a.far_r, a.place_r)
    for name, q in (("near", near_q), ("far", far_q)):
        log(f"שאילתה {name}")
        try:
            d, mirror = overpass(q, log)
            json.dump(d, open(f"{a.out}/{name}.json", "w", encoding="utf-8"), ensure_ascii=False)
            meta[name] = {"mirror": mirror, "elements": len(d["elements"]), "osm_base": d.get("osm3s", {}).get("timestamp_osm_base")}
        except Exception as e:  # noqa
            meta["errors"].append(f"{name}: {e}"); log(f"שגיאה: {e}")
    try:
        r = nominatim(a.lat, a.lon)
        json.dump(r, open(f"{a.out}/reverse.json", "w", encoding="utf-8"), ensure_ascii=False)
        meta["reverse"] = {"display_name": r.get("display_name")}
        log("Nominatim: " + str(r.get("display_name")))
    except Exception as e:  # noqa
        meta["errors"].append(f"reverse: {e}"); log(f"שגיאה ב-Nominatim: {e}")
    json.dump(meta, open(f"{a.out}/meta.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(json.dumps(meta, ensure_ascii=False))
    return 1 if meta["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
