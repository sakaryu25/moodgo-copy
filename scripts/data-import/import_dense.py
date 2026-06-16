#!/usr/bin/env python3
# 高密度POI(飲食/ショッピング等チェーン含む)用インポーター。
#   汎用 import_records.py は「同名は同県の既存行に統合」するためチェーン店が県に1件へ潰れる。
#   こちらは「名前＋座標(小数3桁≈111m)」で大域dedupし、各店舗を別行として新規挿入する。
#   既存places(名前＋座標)に一致する行はスキップ＝再実行しても重複しない（冪等）。
#   使い方: SUPABASE_URL/SUPABASE_SERVICE_KEY を環境変数に入れて
#           python3 import_dense.py /tmp/osm_foodshop_records.json
import urllib.request, urllib.error, json, os, re, sys, time

SU = os.environ["SUPABASE_URL"].rstrip("/")
SK = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json"}

records = json.load(open(sys.argv[1]))
print(f"投入対象 {len(records)}件", flush=True)

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
        except Exception as e:
            if a < 3: time.sleep(5); continue
            return 0, str(e).encode()

def norm(s): return re.sub(r"\s+", "", (s or "")).strip().lower()
def gkey(name, lat, lng): return norm(name) + f"|{round(lat,3)},{round(lng,3)}"

# 既存places(名前＋座標)を読み込み、再投入をスキップ（冪等）
print("既存places読み込み中...", flush=True)
seen = set(); off = 0
while True:
    st, raw = http("GET", f"places?select=name,lat,lng&limit=1000&offset={off}")
    try: rows = json.loads(raw)
    except Exception: break
    if not rows: break
    for r in rows:
        if r.get("lat") is not None and r.get("lng") is not None:
            seen.add(gkey(r["name"], r["lat"], r["lng"]))
        else:
            seen.add(norm(r.get("name")))
    off += 1000
    if len(rows) < 1000: break
print(f"既存キー {len(seen)}件", flush=True)

def insert_chunk(rows):
    if not rows: return 0
    st, raw = http("POST", "places", rows, {"Prefer": "return=minimal"})
    if st in (200, 201): return len(rows)
    # バッチ失敗時は1行ずつ（不正行を特定して残りを通す）
    ok = 0
    for r in rows:
        s2, b2 = http("POST", "places", [r], {"Prefer": "return=minimal"})
        if s2 in (200, 201): ok += 1
        else: print("   行失敗", r.get("name"), s2, b2[:80], flush=True)
    return ok

buf = []; ins = skip = 0; run = set()
for rec in records:
    name = (rec.get("name") or "").strip()
    lat, lng = rec.get("lat"), rec.get("lng")
    if not name or lat is None or lng is None: skip += 1; continue
    k = gkey(name, lat, lng)
    if k in seen or k in run: skip += 1; continue
    run.add(k)
    addr = (rec.get("address") or rec.get("area") or "日本").strip() or "日本"
    buf.append({"name": name[:120], "address": addr, "tags": rec.get("tags") or [],
                "area": rec.get("area") or None, "nearest_station": None,
                "source_type": rec.get("source") or "osm-foodshop", "is_active": True,
                "lat": lat, "lng": lng})
    if len(buf) >= 200:
        ins += insert_chunk(buf); buf = []
        if ins % 4000 == 0: print(f"   挿入 {ins} / skip {skip}", flush=True)
ins += insert_chunk(buf)
print(f"=== 完了: 新規 {ins} / skip(既存・重複・座標欠落) {skip} ===", flush=True)
