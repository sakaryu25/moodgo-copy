#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""道の駅(source_type=michi-no-eki)に #ご当地グルメ を付与。
深掘り「道の駅でご当地グルメ」は #ご当地グルメ で絞るが、道の駅1,149件中25件しか持たず
自分の深掘りに出てこなかった。道の駅は直売所・ご当地グルメの聖地なのでタグとして正しい。

環境: APPLY=1で実反映(既定ドライラン), SUPABASE_URL/SERVICE_KEY。
バックアップ: /tmp/michinoeki_gourmet_backup.json
"""
import urllib.request, json, os, time
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
GOURMET="#ご当地グルメ"

def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        r=urllib.request.urlopen(req,timeout=60); return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

last=""; targets=[]
while True:
    flt=f"&id=gt.{last}" if last else ""
    rows=None
    for _ in range(4):
        st,raw=http("GET", f"places?select=id,name,tags&source_type=eq.michi-no-eki&order=id.asc{flt}&limit=1000")
        j=json.loads(raw)
        if isinstance(j,list): rows=j; break
        time.sleep(2)
    if rows is None: print("中断:", str(j)[:120]); break
    if not rows: break
    for r in rows:
        if GOURMET not in (r.get("tags") or []): targets.append(r)
    last=rows[-1]["id"]
    if len(rows)<1000: break

print(f"道の駅で #ご当地グルメ 未付与: {len(targets)}件")
if not APPLY:
    print("(ドライラン。APPLY=1 で実反映)"); raise SystemExit
json.dump({str(r["id"]): r.get("tags") for r in targets}, open("/tmp/michinoeki_gourmet_backup.json","w"), ensure_ascii=False)
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=list(dict.fromkeys((r.get("tags") or [])+[GOURMET]))
    st,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock:
        cnt["ok" if st in (200,204) else "ng"]+=1
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(patch_one, targets))
print(f"=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(targets)}件に #ご当地グルメ 付与 ===")
