#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全国の leisure=park の「面積」をOverpassで取得し、大型/小型を判定するための元データを作る。
自然タグの92%が #大型公園 だが実態は児童公園。面積で本当に大きい公園だけを残し、小さい公園を格下げする。
way(面積計算可) と relation(複合公園) を対象。node の公園は面積不明=小型扱い。

出力: /tmp/osm_park_sizes.json  {records:[{osm_type,osm_id,name,area_m2,lat,lng}], done:[...]}
判定しきい値は後段の retag スクリプトで適用（デフォルト 30000 m² 以上=大型）。
環境: ONLY_PREFS, OSM_ENDPOINT, OUT_FILE, REQ_TIMEOUT。
"""
import urllib.request, urllib.parse, json, os, time, sys, math

OUT_FILE = os.environ.get("OUT_FILE", "/tmp/osm_park_sizes.json")
ENDPOINTS = [os.environ["OSM_ENDPOINT"]] if os.environ.get("OSM_ENDPOINT") else [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
REQ_TIMEOUT = int(os.environ.get("REQ_TIMEOUT", "120"))
PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県",
         "埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県",
         "岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
         "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県",
         "佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"]
only = os.environ.get("ONLY_PREFS")
if only:
    want = set(p.strip() for p in only.split(","))
    PREFS = [p for p in PREFS if p in want]

def poly_area_m2(geom):
    """[{lat,lon},...] の緯度経度ポリゴン面積(m²)。等距円筒近似+シューレース。"""
    if not geom or len(geom) < 3:
        return 0.0
    lat0 = sum(p["lat"] for p in geom) / len(geom)
    k = math.cos(math.radians(lat0))
    pts = [(p["lon"] * 111320.0 * k, p["lat"] * 110540.0) for p in geom]
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0

def query(pref, idx):
    # way/relation のみ（面積計算に geom が要る）。out geom; でジオメトリ取得。
    q = f'''
[out:json][timeout:180];
area["name"="{pref}"]["admin_level"="4"]->.a;
(
  way["leisure"="park"](area.a);
  relation["leisure"="park"](area.a);
);
out geom;
'''
    last = None
    order = list(ENDPOINTS)  # maps.mail.ru(高速)を常に最優先。遅いミラーは後回し
    for ep in order:
        for attempt in range(2):
            try:
                req = urllib.request.Request(ep, data=urllib.parse.urlencode({"data": q}).encode())
                data = json.loads(urllib.request.urlopen(req, timeout=REQ_TIMEOUT).read())
                return data.get("elements", [])
            except Exception as e:
                last = f"{ep.split('/')[2]}:{str(e)[:50]}"
                time.sleep(3)
    print(f"  [{pref}] 全ミラー失敗: {last}", file=sys.stderr, flush=True)
    return None

def geom_of(e):
    if e.get("type") == "way":
        return e.get("geometry") or []
    # relation: outer メンバのジオメトリを連結（概算で十分）
    g = []
    for m in (e.get("members") or []):
        if m.get("role") == "outer" and m.get("geometry"):
            g.extend(m["geometry"])
    return g

records = []
done_prefs = set()
if os.path.exists(OUT_FILE):
    try:
        prev = json.load(open(OUT_FILE)); records = prev.get("records", []); done_prefs = set(prev.get("done", []))
    except Exception:
        records = []
seen = set((r["osm_type"], r["osm_id"]) for r in records)

def save():
    json.dump({"records": records, "done": sorted(done_prefs)}, open(OUT_FILE, "w"), ensure_ascii=False)

for i, pref in enumerate(PREFS, 1):
    if pref in done_prefs:
        print(f"[{i}/{len(PREFS)}] {pref}: skip", flush=True); continue
    els = query(pref, i)
    if els is None:
        print(f"[{i}/{len(PREFS)}] {pref}: 失敗→後で再実行", flush=True); continue
    n = 0; big = 0
    for e in els:
        oid = e.get("id"); otype = e.get("type")
        if oid is None: continue
        key = (otype, oid)
        if key in seen: continue
        g = geom_of(e)
        area = poly_area_m2(g)
        if area <= 0: continue
        lat = sum(p["lat"] for p in g) / len(g); lng = sum(p["lon"] for p in g) / len(g)
        nm = (e.get("tags", {}) or {}).get("name") or ""
        seen.add(key)
        records.append({"osm_type": otype, "osm_id": oid, "name": nm,
                        "area_m2": round(area), "lat": lat, "lng": lng})
        n += 1
        if area >= 30000: big += 1
    done_prefs.add(pref); save()
    print(f"[{i}/{len(PREFS)}] {pref}: +{n} (うち3万m²以上={big}) 累計{len(records)}", flush=True)
    time.sleep(2)

save()
miss = [p for p in PREFS if p not in done_prefs]
big = sum(1 for r in records if r["area_m2"] >= 30000)
print(f"=== 完了: {len(records)}件 (3万m²以上={big}) → {OUT_FILE} (未取得={miss}) ===", flush=True)
