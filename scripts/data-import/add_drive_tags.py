#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ドライブ(2,000件と渋い)を強化。映える自然(osm-scenic)のうち車で行ける目的地
（展望台/岬/海辺/湖/滝/庭園/渓谷）に #ドライブしたい を付与する。山頂(#山のみ)は車不可なので除外。

環境: APPLY=1で実反映(既定ドライラン), SUPABASE_URL/SERVICE_KEY。
バックアップ: /tmp/drive_tag_backup.json
"""
import urllib.request, json, os, time

SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
DRV="#ドライブしたい"
# 車で行ける景観目的地のタグ（どれか1つでも持てば対象）
DRIVE_DEST={"#展望台","#岬","#海辺","#湖","#滝","#庭園","#渓谷"}  # #絶景/#山は除外（山頂は車不可）

def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        r=urllib.request.urlopen(req,timeout=60); return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

# keyset で osm-scenic を全走査
last_id=""; total=0; add=[]; skip_peak=0; have=0
while True:
    flt=f"&id=gt.{last_id}" if last_id else ""
    rows=None
    for _ in range(4):
        st,raw=http("GET", f"places?select=id,name,tags&source_type=eq.osm-scenic&order=id.asc{flt}&limit=800")
        j=json.loads(raw)
        if isinstance(j,list): rows=j; break
        time.sleep(2)
    if rows is None: print("中断:", str(j)[:120]); break
    if not rows: break
    for r in rows:
        total+=1
        tags=r.get("tags") or []
        if DRV in tags: have+=1; continue
        if any(t in DRIVE_DEST for t in tags):  # 車で行ける目的地
            add.append(r)
        else:
            skip_peak+=1   # #山のみ等＝車不可
    last_id=rows[-1]["id"]
    if len(rows)<800: break

print(f"osm-scenic {total}件: 付与対象 {len(add)} / 既に有 {have} / 除外(山頂等) {skip_peak}")
print("付与例:", [r["name"] for r in add[:10]])
if not APPLY:
    print("\n(ドライラン。APPLY=1 で実反映)"); raise SystemExit

backup={str(r["id"]): r.get("tags") or [] for r in add}
json.dump(backup, open("/tmp/drive_tag_backup.json","w"), ensure_ascii=False)
print(f"バックアップ: {len(backup)}件")
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=list(dict.fromkeys((r.get("tags") or [])+[DRV]))  # 末尾に追加(重複排除)
    st,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock:
        if st in (200,204): cnt["ok"]+=1
        else: cnt["ng"]+=1
        n=cnt["ok"]+cnt["ng"]
        if n%2000==0: print(f"  {n}/{len(add)}...",flush=True)
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(patch_one, add))
print(f"\n=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(add)}件に #ドライブしたい 付与 ===")
