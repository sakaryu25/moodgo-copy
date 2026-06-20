#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全国のwikidata付き公園/庭園/自然保護区をOverpassで取得（=著名・大型公園の同定）。
OSMの leisure=park は日本では小さな児童公園が大多数で、deriverが全部 #大型公園 にしてしまう。
「広い芝生でゴロゴロ」等は本当に大きい公園が欲しいのに名前(代々木公園/砧公園)では大小を判別できない。
→ 編集者が wikidata を紐付けた公園 = 著名・大型 とみなし、後段の patch で #名所公園 マーカーを付与する。
（神社で実績のある手法と同じ。fix_park_prominence.py が osm_id 一致で既存DB行にタグ追加する）

出力: /tmp/notable_parks.json  [{osm_type, osm_id, name, lat, lng}]
環境: ONLY_PREFS（カンマ区切り県名で限定）, OSM_ENDPOINT, OUT_FILE。
"""
import urllib.request, urllib.parse, json, os, time, sys

OUT_FILE = os.environ.get("OUT_FILE", "/tmp/notable_parks.json")
# 日本データが完全に取れる実績ミラーを優先。de/kumi はフォールバック。
ENDPOINTS = [os.environ["OSM_ENDPOINT"]] if os.environ.get("OSM_ENDPOINT") else [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
REQ_TIMEOUT = int(os.environ.get("REQ_TIMEOUT", "45"))  # 1リクエストのタイムアウト（夜間混雑でハング防止）
PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県",
         "埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県",
         "岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
         "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県",
         "佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"]
only = os.environ.get("ONLY_PREFS")
if only:
    want = set(p.strip() for p in only.split(","))
    PREFS = [p for p in PREFS if p in want]

def query(pref, idx):
    q = f'''
[out:json][timeout:50];
area["name"="{pref}"]["admin_level"="4"]->.a;
(
  nwr["leisure"~"^(park|garden|nature_reserve)$"]["wikidata"](area.a);
);
out center tags;
'''
    last = None
    # 県ごとに開始ミラーをずらして1ミラーへの集中アクセス（レート制限）を避ける
    order = ENDPOINTS[idx % len(ENDPOINTS):] + ENDPOINTS[:idx % len(ENDPOINTS)]
    for ep in order:
        for attempt in range(2):
            try:
                req = urllib.request.Request(ep, data=urllib.parse.urlencode({"data": q}).encode())
                data = json.loads(urllib.request.urlopen(req, timeout=REQ_TIMEOUT).read())
                return data.get("elements", [])
            except Exception as e:
                last = f"{ep.split('/')[2]}:{e}"
                time.sleep(3)
    print(f"  [{pref}] 全ミラー失敗: {last}", file=sys.stderr, flush=True)
    return None  # None=失敗（resume対象）。[]=成功で0件。

# resume: 既存の途中ファイルがあれば読み込み、取得済み県はスキップ
records = []
done_prefs = set()
if os.path.exists(OUT_FILE):
    try:
        prev = json.load(open(OUT_FILE))
        records = prev.get("records", []) if isinstance(prev, dict) else prev
        done_prefs = set(prev.get("done", [])) if isinstance(prev, dict) else set()
    except Exception:
        records = []
seen = set((r["osm_type"], r["osm_id"]) for r in records)

def save():
    json.dump({"records": records, "done": sorted(done_prefs)}, open(OUT_FILE, "w"), ensure_ascii=False)

for i, pref in enumerate(PREFS, 1):
    if pref in done_prefs:
        print(f"[{i}/{len(PREFS)}] {pref}: skip(取得済)", flush=True)
        continue
    els = query(pref, i)
    if els is None:
        print(f"[{i}/{len(PREFS)}] {pref}: 失敗→後で再実行", flush=True)
        continue
    n = 0
    for e in els:
        oid = e.get("id"); otype = e.get("type")
        if oid is None:
            continue
        key = (otype, oid)
        if key in seen:
            continue
        seen.add(key)
        c = e.get("center") or {}
        lat = e.get("lat", c.get("lat")); lng = e.get("lon", c.get("lon"))
        if lat is None or lng is None:
            continue
        nm = (e.get("tags", {}) or {}).get("name") or ""
        records.append({"osm_type": otype, "osm_id": oid, "name": nm, "lat": lat, "lng": lng})
        n += 1
    done_prefs.add(pref)
    save()
    print(f"[{i}/{len(PREFS)}] {pref}: {n}件 (累計{len(records)})", flush=True)
    time.sleep(2)

save()
miss = [p for p in PREFS if p not in done_prefs]
print(f"=== 完了: {len(records)}件 → {OUT_FILE}  (未取得県={miss}) ===", flush=True)
