#!/usr/bin/env python3
"""
climbing_records.json を places へ取り込む軽量importer。
import_records.py は既存全42万件をoffsetロードしようとして深offsetタイムアウトで落ちるため、
こちらは per-record の存在チェック（同名exact＋同県）だけ行い、新規のみ batch insert する。
デフォルトはドライ run（新規/既存件数＋サンプル）。--apply で本実行。
"""
import sys, json, time, os, urllib.request, urllib.parse

REC = os.path.join(os.path.dirname(__file__), "climbing_records.json")
env = {}
for line in open(os.path.join(os.path.dirname(__file__), "..", "..", ".env.retag")):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k] = v.strip().strip('"').strip("'")
URL = env["SUPABASE_URL"].rstrip("/"); KEY = env["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def http(method, path, body=None, extra=None):
    for attempt in range(5):
        try:
            req = urllib.request.Request(f"{URL}/rest/v1/{path}", method=method,
                                         data=json.dumps(body).encode() if body is not None else None)
            for k, v in H.items(): req.add_header(k, v)
            if body is not None: req.add_header("Content-Type", "application/json")
            for k, v in (extra or {}).items(): req.add_header(k, v)
            r = urllib.request.urlopen(req, timeout=60)
            return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and attempt < 4: time.sleep(2 * (attempt + 1)); continue
            return e.code, e.read()
        except Exception:
            if attempt < 4: time.sleep(2 * (attempt + 1)); continue
            raise

recs = json.load(open(REC))

def existing_match(rec):
    # 同名exact（active）を引き、県が住所に含まれれば既存とみなす
    q = f"places?select=id,tags,address&is_active=eq.true&name=eq.{urllib.parse.quote(rec['name'])}"
    st, raw = http("GET", q)
    if st != 200: return None
    pref = rec.get("area") or ""
    for row in json.loads(raw):
        if not pref or pref in (row.get("address") or ""):
            return row
    return None

new, dup = [], []
for i, rec in enumerate(recs):
    m = existing_match(rec)
    (dup if m else new).append((rec, m))
    if (i + 1) % 50 == 0: print(f"  ...{i+1}/{len(recs)} チェック済", flush=True)

print(f"\n=== 新規insert対象: {len(new)} / 既存(タグ追記): {len(dup)} / 計{len(recs)} ===")
print("--- 新規サンプル10件 ---")
for rec, _ in new[:10]:
    print(f"  {rec['name']}  /  {rec['address']}")

if "--apply" not in sys.argv:
    print("\n[ドライ run] 書き込みなし。本実行は --apply。")
    sys.exit(0)

# 既存はタグ追記
upd = 0
for rec, row in dup:
    merged = sorted(set((row.get("tags") or []) + rec["tags"]))
    st, _ = http("PATCH", f"places?id=eq.{row['id']}", {"tags": merged}, {"Prefer": "return=minimal"})
    upd += 1 if st in (200, 204) else 0
# 新規はbatch insert（全行同一キー）
buf = [{"name": rec["name"], "address": rec["address"], "tags": rec["tags"],
        "area": rec.get("area"), "nearest_station": None, "source_type": rec.get("source") or "osm-climbing",
        "is_active": True, "lat": rec["lat"], "lng": rec["lng"]} for rec, _ in new]
ins = 0
for c in range(0, len(buf), 100):
    chunk = buf[c:c+100]
    st, b = http("POST", "places", chunk, {"Prefer": "return=minimal"})
    if st in (200, 201, 204): ins += len(chunk)
    else: print("  chunk失敗", st, b[:150], flush=True)
print(f"=== 完了: 新規insert{ins} / 既存タグ追記{upd} ===")
