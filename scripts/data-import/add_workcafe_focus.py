#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""集中(カフェで作業)を強化。作業向きカフェチェーン/ファミレスに #カフェ作業 と #集中したい を付与。
深掘り「カフェで作業・勉強したい」は #カフェ作業 で絞るが、カフェ22,077件中292件しか持たず
渋谷でも7件しか出なかった。座席/電源/Wi-Fiが揃う主要チェーンは作業向きなのでタグ付けする。

環境: APPLY=1で実反映(既定ドライラン), SUPABASE_URL/SERVICE_KEY。
バックアップ: /tmp/workcafe_focus_backup.json
"""
import urllib.request, json, os, urllib.parse, time
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
ADD=["#集中したい","#カフェ作業"]
# 作業向きの主要チェーン（座席/電源/長居可）。ファミレスも作業定番。
CHAINS=["スターバックス","スタバ","ドトール","タリーズ","コメダ","星乃珈琲","上島珈琲",
        "ベローチェ","サンマルクカフェ","プロント","エクセルシオール","ルノアール","珈琲館",
        "カフェ・ド・クリエ","カフェドクリエ","ガスト","サイゼリヤ","デニーズ","ジョナサン",
        "ロイヤルホスト","ココス","ジョイフル","バーミヤン"]

def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        r=urllib.request.urlopen(req,timeout=50); return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

seen=set(); targets=[]
for ch in CHAINS:
    pat=urllib.parse.quote("*"+ch+"*"); last=""
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
            seen.add(r["id"])
            tags=r.get("tags") or []
            if not all(t in tags for t in ADD): targets.append(r)
        last=rows[-1]["id"]
        if len(rows)<1000: break

print(f"作業向きチェーン: {len(seen)}件ヒット / タグ付与対象 {len(targets)}件")
print("付与例:", [r["name"][:16] for r in targets[:10]])
if not APPLY:
    print("(ドライラン。APPLY=1 で実反映)"); raise SystemExit
json.dump({str(r["id"]): r.get("tags") for r in targets}, open("/tmp/workcafe_focus_backup.json","w"), ensure_ascii=False)
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=list(dict.fromkeys((r.get("tags") or [])+ADD))
    st,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock:
        cnt["ok" if st in (200,204) else "ng"]+=1
        n=cnt["ok"]+cnt["ng"]
        if n%2000==0: print(f"  {n}/{len(targets)}...",flush=True)
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(patch_one, targets))
print(f"\n=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(targets)}件に #カフェ作業+#集中したい 付与 ===")
