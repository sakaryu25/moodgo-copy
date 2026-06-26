#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""運動「外でひろびろ」(weak=recall枯渇)を修復。運動公園/競技場/球場/グラウンド等の屋外運動施設は
#屋外スポーツ や #外で運動 を持つのに mood根タグ #体動かしたい が欠落し運動気分から不可視だった。
名前が運動施設 かつ #屋外スポーツ OR #外で運動 を既に持つものに限り #体動かしたい を付与(安全・可逆)。
※#屋外スポーツ/#外で運動 を必須条件にし、児童公園や誤名寄せへの誤付与を防ぐ(児童公園格下げ方針と非衝突)。
環境: APPLY=1で実反映。バックアップ: /tmp/exercise_parks_backup.json
"""
import urllib.request, json, os, urllib.parse, time
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
ADD="#体動かしたい"
GUARD={"#屋外スポーツ","#外で運動"}  # どちらか必須(既に屋外スポーツ分類済みのみ対象)
NAMES=["運動公園","総合公園","スポーツ公園","陸上競技場","競技場","球場","野球場","運動場","グラウンド","河川敷","運動広場","スポーツセンター","スポーツ広場"]
def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try: r=urllib.request.urlopen(req,timeout=50); return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
seen=set(); targets=[]
for nm in NAMES:
    pat=urllib.parse.quote("*"+nm+"*"); last=""
    while True:
        flt=f"&id=gt.{last}" if last else ""
        rows=None
        for _ in range(4):
            st,raw=http("GET", f"places?select=id,name,tags&name=ilike.{pat}&is_active=eq.true&order=id.asc{flt}&limit=1000")
            j=json.loads(raw)
            if isinstance(j,list): rows=j; break
            time.sleep(2)
        if not rows: break
        for r in rows:
            if r["id"] in seen: continue
            seen.add(r["id"]); tags=r.get("tags") or []
            if ADD in tags: continue
            if any(g in tags for g in GUARD):   # 屋外スポーツ分類済みのみ
                targets.append(r)
        last=rows[-1]["id"]
        if len(rows)<1000: break
print(f"運動施設名ヒット {len(seen)} / 付与対象(屋外スポーツ保有) {len(targets)}件")
print("付与例:", [r["name"][:18] for r in targets[:12]])
if not APPLY:
    print("(ドライラン)"); raise SystemExit
json.dump({str(r["id"]): r.get("tags") for r in targets}, open("/tmp/exercise_parks_backup.json","w"), ensure_ascii=False)
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=list(dict.fromkeys((r.get("tags") or [])+[ADD]))
    st,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock: cnt["ok" if st in (200,204) else "ng"]+=1
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(patch_one, targets))
print(f"=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(targets)}件に #体動かしたい 付与 ===")
