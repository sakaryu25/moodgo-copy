#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全国の「映える自然」をOverpassで取得（滝・展望・海岸・山頂・庭園・岬・湖・渓谷）。
自然タグの92%が児童公園(#大型公園)で渋いのを是正するため、公園以外の景観スポットを補充する。
fetch_osm_notable_parks.py と同じ流儀（県ごと・ミラーfallback・resume）。

各要素のOSMタグから kind を判定し、MoodGoタグ(tags)を付与してJSON出力。
出力: /tmp/osm_scenic.json  {records:[{osm_type,osm_id,name,lat,lng,kind,prefecture,addr,tags}], done:[...]}
環境: ONLY_PREFS, OSM_ENDPOINT, OUT_FILE, REQ_TIMEOUT。
"""
import urllib.request, urllib.parse, json, os, time, sys

OUT_FILE = os.environ.get("OUT_FILE", "/tmp/osm_scenic.json")
ENDPOINTS = [os.environ["OSM_ENDPOINT"]] if os.environ.get("OSM_ENDPOINT") else [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
REQ_TIMEOUT = int(os.environ.get("REQ_TIMEOUT", "90"))
PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県",
         "埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県",
         "岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
         "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県",
         "佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"]
only = os.environ.get("ONLY_PREFS")
if only:
    want = set(p.strip() for p in only.split(","))
    PREFS = [p for p in PREFS if p in want]

# OSMタグ → (kind, MoodGoタグ群)。上から順に最初に当たったもので判定。
def classify(t):
    if t.get("waterway") == "waterfall":      return ("滝",   ["#自然感じたい", "#絶景スポット", "#滝"])
    if t.get("tourism")  == "viewpoint":      return ("展望", ["#自然感じたい", "#絶景スポット", "#展望台"])
    if t.get("natural")  == "beach":          return ("海岸", ["#自然感じたい", "#海辺"])
    if t.get("natural")  == "cape":           return ("岬",   ["#自然感じたい", "#絶景スポット", "#岬"])
    if t.get("natural")  == "peak":           return ("山頂", ["#自然感じたい", "#絶景スポット", "#山"])
    if t.get("leisure")  == "garden":         return ("庭園", ["#自然感じたい", "#まったりしたい", "#庭園"])
    if t.get("natural")  == "valley":         return ("渓谷", ["#自然感じたい", "#絶景スポット", "#渓谷"])
    if t.get("natural")  == "water":          return ("湖",   ["#自然感じたい", "#湖"])
    return (None, None)

def addr_of(t, pref):
    parts = [t.get("addr:province") or t.get("addr:state") or pref,
             t.get("addr:city"), t.get("addr:suburb") or t.get("addr:neighbourhood"),
             t.get("addr:block_number"), t.get("addr:housenumber")]
    a = "".join(p for p in parts if p)
    return a or pref

def query(pref, idx):
    q = f'''
[out:json][timeout:120];
area["name"="{pref}"]["admin_level"="4"]->.a;
(
  nwr["waterway"="waterfall"](area.a);
  nwr["tourism"="viewpoint"](area.a);
  nwr["natural"="beach"](area.a);
  nwr["natural"="cape"]["name"](area.a);
  nwr["natural"="peak"]["name"](area.a);
  nwr["leisure"="garden"]["name"](area.a);
  nwr["natural"="valley"]["name"](area.a);
  nwr["natural"="water"]["name"]["wikidata"](area.a);
);
out center tags;
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

records = []
done_prefs = set()
if os.path.exists(OUT_FILE):
    try:
        prev = json.load(open(OUT_FILE))
        records = prev.get("records", [])
        done_prefs = set(prev.get("done", []))
    except Exception:
        records = []
seen = set((r["osm_type"], r["osm_id"]) for r in records)

def save():
    json.dump({"records": records, "done": sorted(done_prefs)}, open(OUT_FILE, "w"), ensure_ascii=False)

from collections import Counter
for i, pref in enumerate(PREFS, 1):
    if pref in done_prefs:
        print(f"[{i}/{len(PREFS)}] {pref}: skip", flush=True); continue
    els = query(pref, i)
    if els is None:
        print(f"[{i}/{len(PREFS)}] {pref}: 失敗→後で再実行", flush=True); continue
    n = 0; kinds = Counter()
    for e in els:
        oid = e.get("id"); otype = e.get("type")
        if oid is None: continue
        key = (otype, oid)
        if key in seen: continue
        t = e.get("tags", {}) or {}
        kind, tags = classify(t)
        if kind is None: continue
        nm = t.get("name") or ""
        if not nm: continue                          # 名前なしは表示に不向き→除外
        c = e.get("center") or {}
        lat = e.get("lat", c.get("lat")); lng = e.get("lon", c.get("lon"))
        if lat is None or lng is None: continue
        seen.add(key)
        records.append({"osm_type": otype, "osm_id": oid, "name": nm, "lat": lat, "lng": lng,
                        "kind": kind, "prefecture": pref, "addr": addr_of(t, pref), "tags": tags})
        n += 1; kinds[kind] += 1
    done_prefs.add(pref); save()
    print(f"[{i}/{len(PREFS)}] {pref}: +{n} ({dict(kinds)}) 累計{len(records)}", flush=True)
    time.sleep(2)

save()
miss = [p for p in PREFS if p not in done_prefs]
ktot = Counter(r["kind"] for r in records)
print(f"=== 完了: {len(records)}件 {dict(ktot)} → {OUT_FILE} (未取得={miss}) ===", flush=True)
