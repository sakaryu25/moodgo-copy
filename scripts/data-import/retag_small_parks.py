#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""面積測定(/tmp/osm_park_sizes.json)を使い、小さい公園を自然タグから格下げする。
DBの #大型公園 で、OSM面積が THRESHOLD 未満のものから #大型公園 と #自然感じたい を外す
（#まったりしたい 等は残す＝近所の公園は"まったり"では出る）。面積不明(node等)は安全側で据え置き。

環境: THRESHOLD(m²,既定30000), APPLY=1 で実反映(既定はドライラン), SUPABASE_URL/SERVICE_KEY。
バックアップ: /tmp/park_retag_backup.json（id→元tags）。復元可。
"""
import urllib.request, json, os, time

SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
THRESH=int(os.environ.get("THRESHOLD","30000"))
APPLY=os.environ.get("APPLY")=="1"
DEMOTE_TAGS={"#大型公園","#自然感じたい"}

def http(method, path, body=None, extra=None):
    h=dict(H);  h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        r=urllib.request.urlopen(req,timeout=60); return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers

# 面積マップ
areas={}
d=json.load(open("/tmp/osm_park_sizes.json"))
for r in d.get("records",[]):
    areas[(r["osm_type"], r["osm_id"])]=r["area_m2"]
print(f"面積データ: {len(areas)}件 / しきい値 {THRESH}m² / {'★APPLY(実反映)' if APPLY else 'ドライラン'}")

# #大型公園 の places をページング
TAG_ENC="tags=cs.%7B%22%23%E5%A4%A7%E5%9E%8B%E5%85%AC%E5%9C%92%22%7D"
off=0; total=0; matched=0; demote=[]
while True:
    st,raw,_=http("GET", f"places?select=id,osm_id,osm_type,tags&{TAG_ENC}&is_active=eq.true&order=id&limit=1000&offset={off}")
    rows=json.loads(raw)
    if not rows: break
    for row in rows:
        total+=1
        oid=row.get("osm_id"); otype=row.get("osm_type")
        if oid is None or otype is None: continue
        a=areas.get((otype, int(oid)))
        if a is None: continue
        matched+=1
        if a < THRESH:
            demote.append(row)
    off+=1000
    if len(rows)<1000: break

print(f"#大型公園: {total}件 / 面積照合できた: {matched}件 / 格下げ対象(<{THRESH}m²): {len(demote)}件")
print(f"  → 残す大型公園: {matched-len(demote)}件 (＋照合不可{total-matched}件は据え置き)")

if not APPLY:
    print("\n(ドライラン。実反映するには APPLY=1 で再実行)")
    raise SystemExit

# バックアップ（復元用に id→元tags）
backup={str(r["id"]): r.get("tags") or [] for r in demote}
json.dump(backup, open("/tmp/park_retag_backup.json","w"), ensure_ascii=False)
print(f"バックアップ: /tmp/park_retag_backup.json ({len(backup)}件)")

# 個別PATCH（部分列更新）を並列で高速反映。tagsから DEMOTE_TAGS を除去。
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=[t for t in (r.get("tags") or []) if t not in DEMOTE_TAGS]
    st,_,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock:
        if st in (200,204): cnt["ok"]+=1
        else: cnt["ng"]+=1
        n=cnt["ok"]+cnt["ng"]
        if n % 5000 == 0: print(f"  {n}/{len(demote)} 反映...", flush=True)
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(patch_one, demote))
print(f"\n=== 完了: 成功{cnt['ok']} / 失敗{cnt['ng']} / 計{len(demote)}件を格下げ（#大型公園・#自然感じたい 除去）===")
