#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ドライブのノイズ除去: osm-scenic で #ドライブしたい を持つが、車目的地タグが #庭園 だけ
（展望台/岬/海辺/湖/滝/渓谷 を持たない）ものから #ドライブしたい を外す。
OSMのleisure=gardenは学校花壇/町の緑地まで含むため、庭園クロスタグはノイズになる。

環境: APPLY=1で実反映, SUPABASE_URL/SERVICE_KEY。バックアップ: /tmp/drive_garden_backup.json
"""
import urllib.request, json, os, time
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
DRV="#ドライブしたい"
REAL_DEST={"#展望台","#岬","#海辺","#湖","#滝","#渓谷"}  # 本物の車目的地（これがあれば温存）

def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        r=urllib.request.urlopen(req,timeout=60); return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

last_id=""; total=0; remove=[]
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
        tags=r.get("tags") or []
        if DRV not in tags: continue
        total+=1
        if "#庭園" in tags and not any(t in REAL_DEST for t in tags):
            remove.append(r)
    last_id=rows[-1]["id"]
    if len(rows)<800: break

print(f"osm-scenic×ドライブ {total}件: 庭園のみで外す {len(remove)}件")
print("外す例:", [r["name"] for r in remove[:10]])
if not APPLY:
    print("\n(ドライラン)"); raise SystemExit
json.dump({str(r["id"]): r.get("tags") for r in remove}, open("/tmp/drive_garden_backup.json","w"), ensure_ascii=False)
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=[t for t in (r.get("tags") or []) if t!=DRV]
    st,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock:
        if st in (200,204): cnt["ok"]+=1
        else: cnt["ng"]+=1
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(patch_one, remove))
print(f"=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(remove)}件から #ドライブしたい 除去 ===")
