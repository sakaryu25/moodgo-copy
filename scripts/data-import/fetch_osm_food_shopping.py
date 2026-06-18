#!/usr/bin/env python3
# OSM 飲食(restaurant/cafe/fast_food)＋ショッピング(mall/百貨店/市場)を取得。
#   飲食は件数が巨大(restaurant≈17万)なので「都道府県area単位」で分割取得（全国一括はOverpassがタイムアウト）。
#   ショッピングは小さいので全国BBOX一括。
#   レジューム可: 取得済み(pref,cat)は /tmp/osm_food_done.json でスキップ。結果は /tmp/osm_foodshop_records.json。
#   座標で大域dedup（チェーン店は各店舗が別座標＝別物として残す）。
import urllib.request, urllib.parse, json, os, sys, time

# 同ディレクトリの osm_food_tagging を import 可能にする
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osm_food_tagging import derive_food_tags

EP = "https://overpass-api.de/api/interpreter"
BBOX = "24,122,46,154"
OUT = "/tmp/osm_foodshop_records.json"
DONE = "/tmp/osm_food_done.json"

PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県",
         "埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県",
         "岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
         "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県",
         "佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"]

# 飲食(food)は osm_food_tagging.derive_food_tags で cuisine/店名/チェーンから動的にタグ付け。
#   pub/bar を追加して居酒屋を取り込む。tags 列は parse() 内で生成するためここは (key, value) のみ。
FOOD = [
    ("amenity", "restaurant"),
    ("amenity", "cafe"),
    ("amenity", "fast_food"),
    ("amenity", "pub"),
    ("amenity", "bar"),
]
# ショッピングは静的タグ（フェーズ1では飲食のみ動的化。shop系は従来通り）。
SHOP = [
    ("shop", "mall",             ["#ショッピング"]),
    ("shop", "department_store", ["#ショッピング"]),
    ("amenity", "marketplace",   ["#ショッピング", "#お土産ギフト"]),
]

def post(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    req = urllib.request.Request(EP, data=data, headers={"User-Agent": "MoodGo/1.0 (kento.ryuto25@gmail.com)"})
    backoff = [30, 60, 120, 180]
    for a in range(5):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=600).read())
        except Exception as e:
            wait = backoff[min(a, len(backoff) - 1)]
            print(f"   retry {a+1}/5 in {wait}s ({e})", flush=True)
            if a < 4: time.sleep(wait); continue
            raise

def parse(d, recs, seen, static_tags=None):
    """static_tags=None なら飲食 → derive_food_tags で動的タグ付け。
    static_tags 指定（ショッピング）ならそのタグを使用。"""
    n = 0
    for el in d.get("elements", []):
        t = el.get("tags", {})
        name = (t.get("name:ja") or t.get("name") or "").strip()
        if not name: continue
        # 日本語名のみ（英語のみのチェーンを除外）
        if not any(0x3040 <= ord(c) <= 0x9fff or 0x30a0 <= ord(c) <= 0x30ff for c in name): continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lng is None: continue
        pref = t.get("addr:province") or t.get("addr:state") or ""
        city = t.get("addr:city") or ""
        addr = (pref + city + (t.get("addr:full") or t.get("addr:street") or t.get("addr:housenumber") or "")) or pref or "日本"
        key = name + "|" + f"{round(lat,4)},{round(lng,4)}"
        if key in seen: continue
        seen.add(key)
        rec = {"name": name[:120], "address": addr, "area": pref or None,
               "lat": float(lat), "lng": float(lng), "source": "osm-foodshop",
               "osm_id": el.get("id"), "osm_type": el.get("type")}
        if static_tags is None:
            d2 = derive_food_tags(t, name)
            rec["tags"] = d2["tags"]
            rec["tag_confidence"] = d2["tag_confidence"]
            rec["tag_source"] = d2["tag_source"]
        else:
            rec["tags"] = static_tags
            rec["tag_confidence"] = "high"
            rec["tag_source"] = "amenity"
        recs.append(rec)
        n += 1
    return n

# レジューム
recs = json.load(open(OUT)) if os.path.exists(OUT) else []
done = set(json.load(open(DONE))) if os.path.exists(DONE) else set()
seen = set(r["name"] + "|" + f"{round(r['lat'],4)},{round(r['lng'],4)}" for r in recs)
print(f"レジューム: 既取得 {len(recs)}件 / 完了タスク {len(done)}", flush=True)

def save():
    json.dump(recs, open(OUT, "w"), ensure_ascii=False)
    json.dump(sorted(done), open(DONE, "w"), ensure_ascii=False)

# 単県のみ実行する場合: 環境変数 ONLY_PREF（例: ONLY_PREF=香川県）でテスト用に絞れる。
ONLY_PREF = os.environ.get("ONLY_PREF")
prefs = [ONLY_PREF] if ONLY_PREF else PREFS

# ショッピング（全国一括）。ONLY_PREF 指定時は飲食テストに集中するためスキップ。
if not ONLY_PREF:
    for k, v, tags in SHOP:
        tid = f"shop|{k}={v}"
        if tid in done: continue
        q = f'[out:json][timeout:300];(node["{k}"="{v}"]({BBOX});way["{k}"="{v}"]({BBOX}););out center tags;'
        try:
            d = post(q); n = parse(d, recs, seen, static_tags=tags)
            done.add(tid); save()
            print(f"[shop] {k}={v}: +{n} (累計{len(recs)})", flush=True)
        except Exception as e:
            print(f"[shop] {k}={v} 失敗 {e}", flush=True)
        time.sleep(6)

# 飲食（都道府県area単位）。tags は parse() 内で derive_food_tags が動的生成。
for ci, (k, v) in enumerate(FOOD):
    for pi, pref in enumerate(prefs):
        tid = f"food|{k}={v}|{pref}"
        if tid in done: continue
        q = (f'[out:json][timeout:300];area["name"="{pref}"]["admin_level"="4"]->.a;'
             f'(node["{k}"="{v}"](area.a);way["{k}"="{v}"](area.a););out center tags;')
        try:
            d = post(q); n = parse(d, recs, seen)
            done.add(tid); save()
            print(f"[food] {v} {pref}: +{n} (累計{len(recs)})", flush=True)
        except Exception as e:
            print(f"[food] {v} {pref} 失敗 {e}", flush=True)
        time.sleep(6)

save()
print(f"=== 完了 合計 {len(recs)}件 → {OUT} ===", flush=True)
