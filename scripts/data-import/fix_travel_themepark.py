#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""旅行「別世界のテーマパーク」(weak)の混入除去。#テーマパーク(1,326件)に
児童遊園地(osm-nature leisure=park)や像/寺/庭園/コリアンタウン等の非アトラクションが
過剰付与され、児童遊園地が混入していた。これらから #テーマパーク を除去(本物の遊園地は温存)。

環境: APPLY=1で実反映, SUPABASE_URL/SERVICE_KEY。バックアップ: /tmp/themepark_backup.json
"""
import urllib.request, json, os, urllib.parse, time, re
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
TP="#テーマパーク"
# 非アトラクションの名前パターン
NON_ATTR=re.compile(r"児童遊園|児童公園|団地|丁目.*遊園|像$|コリアンタウン|庭園|植物園|花壇|緑地|(寺|院)$|神社|大明神|稲荷|八幡")

def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        r=urllib.request.urlopen(req,timeout=50); return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

# #テーマパーク は1,326件と小さい。タグフィルタ+offsetで取得(retry付)
TP_ENC="tags=cs."+urllib.parse.quote('{"'+TP+'"}')
off=0; rows_all=[]
while True:
    page=None
    for _ in range(4):
        st,raw=http("GET", f"places?select=id,name,tags,source_type&{TP_ENC}&is_active=eq.true&limit=1000&offset={off}")
        j=json.loads(raw)
        if isinstance(j,list): page=j; break
        time.sleep(2)
    if not page: break
    rows_all+=page
    off+=len(page)
    if len(page)<1000: break

remove=[]
for r in rows_all:
    src=r.get("source_type") or ""; nm=r.get("name") or ""
    if src=="osm-nature" or NON_ATTR.search(nm):
        remove.append(r)
print(f"#テーマパーク {len(rows_all)}件 / 除去対象 {len(remove)}件 (osm-nature児童遊園地＋像/寺/庭園等)")
print("除去例:", [r["name"][:16] for r in remove[:12]])
if not APPLY:
    print("(ドライラン)"); raise SystemExit
json.dump({str(r["id"]): r.get("tags") for r in remove}, open("/tmp/themepark_backup.json","w"), ensure_ascii=False)
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=[t for t in (r.get("tags") or []) if t!=TP]
    st,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock: cnt["ok" if st in (200,204) else "ng"]+=1
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(patch_one, remove))
print(f"=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(remove)}件から #テーマパーク 除去 ===")
