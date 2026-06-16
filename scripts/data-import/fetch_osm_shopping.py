#!/usr/bin/env python3
# OSM ショッピング系（モール/百貨店/市場）を取得し import_records.py 用 JSON を出力。
#   食事(restaurant/cafe/fast_food ≈27万件・写真なし)は Google が強くUXを損ねるため取り込まない。
#   ショッピングは大型・命名済み施設が中心(≈6千件)で Supabase が手薄＝補完価値が高い。
# 使い方: python3 fetch_osm_shopping.py  → /tmp/osm_shopping_records.json
#         python3 import_records.py /tmp/osm_shopping_records.json   (本番投入・要 .env)
import urllib.request, urllib.parse, json, time
EP = "https://overpass-api.de/api/interpreter"
BBOX = "24,122,46,154"  # 日本
# (key, value, tags)。tags は predefined-tags.ts に実在するもののみ（#ショッピング系）。
CATS = [
    ("shop", "mall",             ["#ショッピング"]),
    ("shop", "department_store", ["#ショッピング"]),
    ("amenity", "marketplace",   ["#ショッピング", "#お土産ギフト"]),
]

def run(k, v):
    q = f'[out:json][timeout:180];(node["{k}"="{v}"]({BBOX});way["{k}"="{v}"]({BBOX}););out center tags;'
    data = urllib.parse.urlencode({"data": q}).encode()
    req = urllib.request.Request(EP, data=data, headers={"User-Agent": "MoodGo/1.0 (kento.ryuto25@gmail.com)"})
    for a in range(3):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=200).read())
        except Exception:
            if a < 2:
                time.sleep(20); continue
            raise

recs = []; seen = set()
for i, (k, v, tags) in enumerate(CATS):
    if i > 0: time.sleep(8)
    try:
        d = run(k, v)
    except Exception as e:
        print(k, v, "失敗", e, flush=True); continue
    n = 0
    for el in d.get("elements", []):
        t = el.get("tags", {})
        name = (t.get("name:ja") or t.get("name") or "").strip()
        if not name: continue
        # 日本語名のみ（英語のみのチェーン等を除外）
        if not any(0x3040 <= ord(c) <= 0x9fff or 0x30a0 <= ord(c) <= 0x30ff for c in name): continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lng is None: continue
        pref = t.get("addr:province") or t.get("addr:state") or ""
        city = t.get("addr:city") or ""
        addr = (pref + city + (t.get("addr:full") or t.get("addr:street") or "")) or pref or "日本"
        key = name + "|" + f"{round(lat,3)},{round(lng,3)}"
        if key in seen: continue
        seen.add(key)
        recs.append({"name": name[:120], "address": addr, "area": pref or None,
                     "lat": float(lat), "lng": float(lng), "tags": tags, "source": "osm-shopping"})
        n += 1
    print(f"{k}={v}: {n}件", flush=True)

json.dump(recs, open("/tmp/osm_shopping_records.json", "w"), ensure_ascii=False)
print("=== OSMショッピング合計", len(recs), "件 ===", flush=True)
