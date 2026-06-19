#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
非food気分（nature/sports/fun/focus/shopping/travel…）の汎用 OSM フェッチ。
osm_spot_tagging.py の derive_<mood>_tags でタグ付けする。food版と同じ並列対応。

環境変数:
  MOOD          : nature / sports / fun / focus / shopping / travel （必須）
  ONLY_PREFS    : 県をカンマ区切りで限定（並列実行で分担）
  OSM_ENDPOINT  : Overpassミラー
  OUT_FILE/DONE_FILE : 出力/レジューム
  SLEEP_SEC / BACKOFF : クエリ間スリープ / リトライ待機
"""
import urllib.request, urllib.parse, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import osm_spot_tagging as ST

EP = os.environ.get("OSM_ENDPOINT", "https://overpass-api.de/api/interpreter")
MOOD = os.environ.get("MOOD", "nature")
OUT = os.environ.get("OUT_FILE", f"/tmp/osm_{MOOD}_records.json")
DONE = os.environ.get("DONE_FILE", f"/tmp/osm_{MOOD}_done.json")
SLEEP_SEC = float(os.environ.get("SLEEP_SEC", "4"))
BACKOFF = [int(x) for x in os.environ.get("BACKOFF", "20,40,60,90").split(",")]

PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県",
         "埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県",
         "岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
         "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県",
         "佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"]

# 気分 → (カテゴリ一覧, deriver, source_type)
REGISTRY = {
    "nature":   (ST.NATURE_CATS,   ST.derive_nature_tags,   "osm-nature"),
    "sports":   (ST.SPORTS_CATS,   ST.derive_sports_tags,   "osm-sports"),
    "fun":      (ST.FUN_CATS,      ST.derive_fun_tags,      "osm-fun"),
    "focus":    (ST.FOCUS_CATS,    ST.derive_focus_tags,    "osm-focus"),
    "shopping": (ST.SHOPPING_CATS, ST.derive_shopping_tags, "osm-shopping"),
    "travel":   (ST.TRAVEL_CATS,   ST.derive_travel_tags,   "osm-travel"),
}
if MOOD not in REGISTRY:
    print(f"未対応のMOOD: {MOOD}（対応: {list(REGISTRY)}）", flush=True); sys.exit(1)
CATS, DERIVE, SOURCE = REGISTRY[MOOD]


def post(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    req = urllib.request.Request(EP, data=data, headers={"User-Agent": "MoodGo/1.0 (kento.ryuto25@gmail.com)"})
    for a in range(5):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=600).read())
        except Exception as e:
            wait = BACKOFF[min(a, len(BACKOFF) - 1)]
            print(f"   retry {a+1}/5 in {wait}s ({e})", flush=True)
            if a < 4: time.sleep(wait); continue
            raise


def parse(d, recs, seen):
    n = 0
    for el in d.get("elements", []):
        t = el.get("tags", {})
        name = (t.get("name:ja") or t.get("name") or "").strip()
        if not name: continue
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
        d2 = DERIVE(t, name)
        recs.append({"name": name[:120], "address": addr, "area": pref or None,
                     "lat": float(lat), "lng": float(lng), "source": SOURCE,
                     "osm_id": el.get("id"), "osm_type": el.get("type"),
                     "tags": d2["tags"], "tag_confidence": d2["tag_confidence"], "tag_source": d2["tag_source"]})
        n += 1
    return n


recs = json.load(open(OUT)) if os.path.exists(OUT) else []
done = set(json.load(open(DONE))) if os.path.exists(DONE) else set()
seen = set(r["name"] + "|" + f"{round(r['lat'],4)},{round(r['lng'],4)}" for r in recs)
print(f"[{MOOD}] レジューム: 既取得 {len(recs)} / 完了 {len(done)}", flush=True)


def save():
    json.dump(recs, open(OUT, "w"), ensure_ascii=False)
    json.dump(sorted(done), open(DONE, "w"), ensure_ascii=False)


ONLY_PREFS = os.environ.get("ONLY_PREFS")
prefs = [p.strip() for p in ONLY_PREFS.split(",") if p.strip()] if ONLY_PREFS else PREFS

# COMBINE=1（既定）: 県ごとに全カテゴリを1クエリに統合してOverpass往復を激減（429も減）。
#   キー別に値をまとめ node/way の union を作る。done は県単位。
COMBINE = os.environ.get("COMBINE", "1") == "1"

if COMBINE:
    by_key = {}
    for (k, v) in CATS:
        by_key.setdefault(k, []).append(v)
    for pref in prefs:
        tid = f"{MOOD}|ALL|{pref}"
        if tid in done: continue
        parts = []
        for k, vs in by_key.items():
            rx = "^(" + "|".join(vs) + ")$"
            parts.append(f'node["{k}"~"{rx}"](area.a);way["{k}"~"{rx}"](area.a);')
        q = (f'[out:json][timeout:300];area["name"="{pref}"]["admin_level"="4"]->.a;'
             f'({"".join(parts)});out center tags;')
        try:
            d = post(q); n = parse(d, recs, seen)
            done.add(tid); save()
            print(f"[{MOOD}] {pref}(全{len(CATS)}カテゴリ): +{n} (累計{len(recs)})", flush=True)
        except Exception as e:
            print(f"[{MOOD}] {pref} 失敗 {e}", flush=True)
        time.sleep(SLEEP_SEC)
else:
    for (k, v) in CATS:
        for pref in prefs:
            tid = f"{MOOD}|{k}={v}|{pref}"
            if tid in done: continue
            q = (f'[out:json][timeout:300];area["name"="{pref}"]["admin_level"="4"]->.a;'
                 f'(node["{k}"="{v}"](area.a);way["{k}"="{v}"](area.a););out center tags;')
            try:
                d = post(q); n = parse(d, recs, seen)
                done.add(tid); save()
                print(f"[{MOOD}] {v} {pref}: +{n} (累計{len(recs)})", flush=True)
            except Exception as e:
                print(f"[{MOOD}] {v} {pref} 失敗 {e}", flush=True)
            time.sleep(SLEEP_SEC)

save()
print(f"=== [{MOOD}] 完了 合計 {len(recs)}件 → {OUT} ===", flush=True)
