#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wikidata付き著名公園に #名所公園 マーカーを付与（id維持）。

背景: OSMの leisure=park は日本では小さな児童公園が大多数で、deriver が全部 #大型公園 にしている。
「広い芝生でゴロゴロ」等の検索は本当に大きい公園が欲しいが、代々木公園/砧公園のような有名公園は
名前(○○+公園)では大小を判別できず、名前正規表現の純度フィルタからも漏れる。
→ fetch_osm_notable_parks.py が取得した wikidata付き公園 = 著名・大型 とみなし、既存DB行に
   #名所公園 を付与する。検索側 route.ts は #大型公園 を信用する際に #名所公園 を要求し、
   小さな近所公園の混入を防ぎつつ有名公園を確実に拾う。

  入力: /tmp/notable_parks.json （{records:[{osm_type,osm_id,name,lat,lng}], done:[...]} or 旧list）
  マッチ: (osm_type, osm_id) 優先、無ければ name+座標(3桁)。
  既存に無い著名公園は INSERT（source_type=osm-nature）。id維持・既存タグは温存して和集合。
"""
import urllib.request, urllib.error, json, os, re, time, threading
from concurrent.futures import ThreadPoolExecutor

SU = os.environ["SUPABASE_URL"].rstrip("/"); SK = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json"}
IN_FILE = os.environ.get("IN_FILE", "/tmp/notable_parks.json")
MARK = "#名所公園"

raw_in = json.load(open(IN_FILE))
recs = raw_in.get("records", []) if isinstance(raw_in, dict) else raw_in
print(f"著名公園 入力 {len(recs)}件", flush=True)


def http(method, path, body=None, extra=None):
    h = dict(H)
    if extra: h.update(extra)
    req = urllib.request.Request(SU + "/rest/v1/" + path,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers=h, method=method)
    for a in range(4):
        try:
            r = urllib.request.urlopen(req, timeout=120); return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception:
            if a < 3: time.sleep(4); continue
            return 0, b""


def norm(s): return re.sub(r"\s+", "", (s or "")).strip().lower()
def gkey(name, lat, lng): return norm(name) + f"|{round(lat,3)},{round(lng,3)}"

# ── 既存 osm-nature 行を (osm_type,osm_id) と 名前+座標 で索引化 ──────────────────────
by_oid = {}; by_key = {}
off = 0
print("既存 osm-nature 読込中...", flush=True)
while True:
    st, raw = http("GET", f"places?source_type=eq.osm-nature&select=id,name,lat,lng,osm_id,osm_type,tags&limit=1000&offset={off}")
    try: rows = json.loads(raw)
    except Exception: break
    if not rows: break
    for r in rows:
        if r.get("osm_id") is not None and r.get("osm_type"):
            by_oid[(r["osm_type"], r["osm_id"])] = r
        if r.get("lat") is not None and r.get("lng") is not None:
            by_key[gkey(r["name"], r["lat"], r["lng"])] = r
    off += 1000
    if len(rows) < 1000: break
print(f"既存 osm-nature: oid索引 {len(by_oid)} / 座標索引 {len(by_key)}", flush=True)

updates = []   # 既存 → PATCH(tagsにMARK+#大型公園を和集合)
inserts = []   # 新規
seen_ids = set()
for rec in recs:
    nm = (rec.get("name") or "").strip()
    lat, lng = rec.get("lat"), rec.get("lng")
    if lat is None or lng is None: continue
    ex = by_oid.get((rec.get("osm_type"), rec.get("osm_id"))) or by_key.get(gkey(nm, lat, lng))
    if ex:
        if ex["id"] in seen_ids: continue
        seen_ids.add(ex["id"])
        tags = list(ex.get("tags") or [])
        add = [t for t in [MARK, "#大型公園", "#自然感じたい", "#まったりしたい"] if t not in tags]
        if not add: continue  # 既に全部付いている
        updates.append({"id": ex["id"], "tags": tags + add})
    else:
        if not nm: continue
        k = gkey(nm, lat, lng)
        if k in seen_ids: continue
        seen_ids.add(k)
        inserts.append({
            "name": nm[:120], "address": "日本", "nearest_station": None,
            "source_type": "osm-nature", "is_active": True, "lat": lat, "lng": lng,
            "tags": [MARK, "#大型公園", "#自然感じたい", "#まったりしたい"],
            "osm_id": rec.get("osm_id"), "osm_type": rec.get("osm_type"),
            "source_license": "ODbL", "attribution_required": True,
        })

print(f"振り分け: 更新 {len(updates)} / 新規 {len(inserts)}", flush=True)

lock = threading.Lock(); done = [0]
def patch(row):
    s, _ = http("PATCH", f"places?id=eq.{row['id']}", {"tags": row["tags"]}, {"Prefer": "return=minimal"})
    with lock: done[0] += 1
    return s in (200, 204)

with ThreadPoolExecutor(max_workers=8) as ex:
    list(ex.map(patch, updates))
print(f"更新完了 {done[0]}/{len(updates)}", flush=True)

# 新規はバッチINSERT
ins_ok = 0
for i in range(0, len(inserts), 200):
    batch = inserts[i:i+200]
    s, b = http("POST", "places", batch, {"Prefer": "return=minimal"})
    if s in (200, 201, 204): ins_ok += len(batch)
    else:
        for r in batch:
            s2, _ = http("POST", "places", [r], {"Prefer": "return=minimal"})
            if s2 in (200, 201): ins_ok += 1
print(f"=== 完了: 更新 {done[0]} / 新規 {ins_ok} ===", flush=True)
