#!/usr/bin/env python3
"""
スリル気分の在庫強化のため、OSM(Overpass)から日本のスリル系施設を取得して JSON 保存。
取得カテゴリ（named のみ）:
  tourism=theme_park / attraction=roller_coaster / leisure=trampoline_park
  / leisure=escape_game / sport=climbing
出力: osm_thrill_raw.json  [{name, lat, lng, cat, osm}]
import はしない（取得のみ）。次段で dedup→ドライ run→承認→反映。
"""
import json, time, os, urllib.request, urllib.parse

OUT = os.path.join(os.path.dirname(__file__), "osm_thrill_raw.json")
CATS = [
    ("theme_park",      'nwr["tourism"="theme_park"]["name"](area.a);'),
    ("roller_coaster",  'nwr["attraction"="roller_coaster"]["name"](area.a);'),
    ("trampoline",      'nwr["leisure"="trampoline_park"]["name"](area.a);'),
    ("escape_game",     'nwr["leisure"="escape_game"]["name"](area.a);'),
    ("climbing",        'nwr["sport"="climbing"]["name"](area.a);'),
]
MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

def run(ql):
    data = urllib.parse.urlencode({"data": ql}).encode()
    last = ""
    for mirror in MIRRORS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(mirror, data=data, headers={
                    "User-Agent": "moodgo-enrichment/1.0 (ryuki.m.0325@icloud.com)",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json"})
                return json.loads(urllib.request.urlopen(req, timeout=290).read())
            except Exception as e:
                last = str(e)[:100]; time.sleep(3)
    raise RuntimeError(f"all mirrors failed: {last}")

records = []
per = {}
for cat, filt in CATS:
    ql = f'[out:json][timeout:280];area["ISO3166-1"="JP"][admin_level=2]->.a;({filt});out center tags;'
    print(f"fetching {cat} ...", flush=True)
    j = run(ql)
    n = 0
    for el in j.get("elements", []):
        tags = el.get("tags", {})
        name = (tags.get("name") or "").strip()
        if not name:
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lng is None:
            continue
        records.append({"name": name, "lat": lat, "lng": lng, "cat": cat,
                        "osm": f"{el.get('type')}/{el.get('id')}"})
        n += 1
    per[cat] = n
    print(f"  -> {cat}: {n}", flush=True)
    time.sleep(2)

json.dump(records, open(OUT, "w"), ensure_ascii=False)
print(f"\n=== 取得完了: {len(records)} 件 -> {OUT} ===")
for c, n in per.items():
    print(f"  {c:<16} {n}")
