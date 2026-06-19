#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OSM飲食データの ID維持 再タグ付けインポーター（DELETEしない）。

  既存 source_type='osm-foodshop' 行を「osm_id」または「名前+座標(3桁)」で特定し、
  tags / area / tag_confidence / tag_source / osm_id / osm_type / ライセンスのみ更新する。
  → places.id は不変。spot_photos・Moodログ・お気に入り・履歴・engagement・評価の紐づきを保持。
  既存に一致しない新規recordは INSERT する。

使い方:
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 retag_dense.py /tmp/osm_foodshop_records.json
  （事前に supabase/osm-retag-migration.sql を適用しておくこと）

安全策:
  - PATCH/upsert 前に対象 id・旧tags・新tags を /tmp/retag_backup.json に保存。
  - 既存行の更新は Prefer: resolution=merge-duplicates, on_conflict=id（id指定の bulk upsert）→ id 不変。
  - バッチ失敗時は 1 行ずつ再試行。
"""
import urllib.request, urllib.error, json, os, re, sys, time

SU = os.environ["SUPABASE_URL"].rstrip("/")
SK = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json"}

records = json.load(open(sys.argv[1]))
print(f"投入対象 {len(records)}件", flush=True)


def http(method, path, body=None, extra=None):
    h = dict(H)
    if extra:
        h.update(extra)
    req = urllib.request.Request(SU + "/rest/v1/" + path,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers=h, method=method)
    for a in range(4):
        try:
            r = urllib.request.urlopen(req, timeout=120)
            return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()
        except Exception as e:
            if a < 3:
                time.sleep(5)
                continue
            return 0, str(e).encode()


def norm(s):
    return re.sub(r"\s+", "", (s or "")).strip().lower()


def gkey(name, lat, lng):
    return norm(name) + f"|{round(lat,3)},{round(lng,3)}"


# ── 既存行を読み込み（id付き）。osm_id と 名前+座標 の2索引を作る ──────
#   MATCH_SOURCES 環境変数でマッチ対象の source_type を指定（例: nature は "osm,osm-nature"）。
#   未指定なら従来どおり osm-foodshop（食事の再タグ）。
MATCH_SOURCES = os.environ.get("MATCH_SOURCES", "osm-foodshop")
_src_list = [s.strip() for s in MATCH_SOURCES.split(",") if s.strip()]
_src_filter = (f"source_type=eq.{_src_list[0]}" if len(_src_list) == 1
               else "source_type=in.(" + ",".join(_src_list) + ")")
print(f"既存 [{MATCH_SOURCES}] 行を読み込み中...", flush=True)
by_osm = {}     # osm_id -> {id, tags}
by_key = {}     # name+coords -> {id, tags}
off = 0
while True:
    st, raw = http("GET",
                   f"places?{_src_filter}&select=id,name,lat,lng,osm_id,tags"
                   f"&limit=1000&offset={off}")
    try:
        rows = json.loads(raw)
    except Exception:
        break
    if not rows:
        break
    for r in rows:
        rid, oid = r.get("id"), r.get("osm_id")
        tags = r.get("tags") or []
        if oid is not None:
            by_osm[oid] = {"id": rid, "tags": tags}
        if r.get("lat") is not None and r.get("lng") is not None:
            by_key[gkey(r["name"], r["lat"], r["lng"])] = {"id": rid, "tags": tags}
    off += 1000
    print(f"   読込 {off}...", flush=True)
    if len(rows) < 1000:
        break
print(f"既存 [{MATCH_SOURCES}]: osm_id索引 {len(by_osm)} / 座標索引 {len(by_key)}", flush=True)


# ── record を「更新（既存id一致）」と「新規INSERT」に振り分け ──────────────────────
updates = []   # 既存id一致 → upsert(by id)
inserts = []   # 新規
backup = []    # 安全策
seen_run = set()

for rec in records:
    name = (rec.get("name") or "").strip()
    lat, lng = rec.get("lat"), rec.get("lng")
    if not name or lat is None or lng is None:
        continue
    new_tags = rec.get("tags") or []
    common = {
        "tags": new_tags,
        "area": rec.get("area") or None,
        "tag_confidence": rec.get("tag_confidence"),
        "tag_source": rec.get("tag_source"),
        "osm_id": rec.get("osm_id"),
        "osm_type": rec.get("osm_type"),
        "source_license": "ODbL",
        "attribution_required": True,
    }

    existing = None
    if rec.get("osm_id") is not None and rec["osm_id"] in by_osm:
        existing = by_osm[rec["osm_id"]]
    else:
        existing = by_key.get(gkey(name, lat, lng))

    if existing:
        eid = existing["id"]
        if eid in seen_run:
            continue
        seen_run.add(eid)
        old_tags = existing["tags"]
        # タグに変化がなく osm_id も既設なら何もしない（無駄PATCH回避）
        if sorted(old_tags) == sorted(new_tags) and rec.get("osm_id") in (None, *by_osm.keys()):
            continue
        row = {"id": eid}
        row.update(common)
        updates.append(row)
        backup.append({"id": eid, "old_tags": old_tags, "new_tags": new_tags})
    else:
        k = gkey(name, lat, lng)
        if k in seen_run:
            continue
        seen_run.add(k)
        row = {"name": name[:120], "address": (rec.get("address") or rec.get("area") or "日本").strip() or "日本",
               "nearest_station": None, "source_type": rec.get("source") or "osm-foodshop",
               "is_active": True, "lat": lat, "lng": lng}
        row.update(common)
        inserts.append(row)

print(f"振り分け: 更新 {len(updates)} / 新規 {len(inserts)}", flush=True)

# 安全策: バックアップ保存
json.dump(backup, open("/tmp/retag_backup.json", "w"), ensure_ascii=False)
print(f"バックアップ /tmp/retag_backup.json に {len(backup)}件保存", flush=True)


def patch_one(row):
    rid = row["id"]
    body = {k: v for k, v in row.items() if k != "id"}
    st, raw = http("PATCH", f"places?id=eq.{rid}", body, {"Prefer": "return=minimal"})
    return st in (200, 204)


def upsert_chunk(rows, on_conflict_id):
    """on_conflict_id=True: id指定の merge-duplicates（既存更新）。False: 新規insert。"""
    if not rows:
        return 0
    extra = {"Prefer": "return=minimal"}
    path = "places"
    if on_conflict_id:
        extra["Prefer"] = "resolution=merge-duplicates,return=minimal"
        path = "places?on_conflict=id"
    st, raw = http("POST", path, rows, extra)
    if st in (200, 201, 204):
        return len(rows)
    # バッチ失敗 → 1行ずつ
    ok = 0
    for r in rows:
        if on_conflict_id:
            if patch_one(r):
                ok += 1
            else:
                print("   更新失敗", r.get("id"), flush=True)
        else:
            s2, b2 = http("POST", "places", [r], {"Prefer": "return=minimal"})
            if s2 in (200, 201):
                ok += 1
            else:
                print("   新規失敗", r.get("name"), s2, b2[:80], flush=True)
    return ok


# ── 並列実行（idキーのバッチは独立＝安全に並列化。WORKERS で同時実行数指定）──────────
from concurrent.futures import ThreadPoolExecutor
import threading
WORKERS = int(os.environ.get("RETAG_WORKERS", "8"))
_lock = threading.Lock()


def run_parallel(items, on_conflict_id, label):
    total = len(items)
    batches = [items[i:i + 200] for i in range(0, total, 200)]
    done = [0]

    def work(batch):
        n = upsert_chunk(batch, on_conflict_id=on_conflict_id)
        with _lock:
            done[0] += n
            if done[0] % 4000 < 200:
                print(f"   {label} {done[0]}/{total}", flush=True)
        return n

    got = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for n in ex.map(work, batches):
            got += n
    return got


upd = run_parallel(updates, True, "更新")
print(f"更新完了 {upd}件", flush=True)
ins = run_parallel(inserts, False, "新規")
print(f"=== 完了: 更新 {upd} / 新規 {ins} ===", flush=True)
