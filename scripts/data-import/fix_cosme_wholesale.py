#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ショッピング「コスメ・美容」の純度クリーンアップ。#コスメ美容(826件・全深掘り最薄)から
実店舗でないコスメ卸オフィス/本社(名前に「株式会社」「営業所」)を除去し純度を上げる。
※recallは伸びない(卸は元々ノイズ)。本格的なrecall改善はOSM新規取込(shop=cosmetics/chemist/pharmacy)が別途必須。
環境: APPLY=1で実反映。バックアップ: /tmp/cosme_wholesale_backup.json
"""
import urllib.request, json, os, urllib.parse, time
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
RM="#コスメ美容"
OFFICE=["株式会社","有限会社","営業所","卸","本社"]
def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try: r=urllib.request.urlopen(req,timeout=50); return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
# #コスメ美容 全件取得(offset・小規模)
TAGENC=urllib.parse.quote('{"#コスメ美容"}')
pool=[]; off=0
while True:
    rows=None
    for _ in range(4):
        st,raw=http("GET", f"places?select=id,name,tags&tags=cs.{TAGENC}&is_active=eq.true&limit=1000&offset={off}")
        j=json.loads(raw)
        if isinstance(j,list): rows=j; break
        time.sleep(2)
    if not rows: break
    pool+=rows; off+=len(rows)
    if len(rows)<1000: break
targets=[r for r in pool if any(o in (r.get("name") or "") for o in OFFICE)]
print(f"#コスメ美容 総{len(pool)}件 / 卸オフィス除去対象 {len(targets)}件")
for r in targets[:20]: print("  -", (r.get("name") or "")[:32])
if not APPLY:
    print("(ドライラン)"); raise SystemExit
json.dump({str(r["id"]): r.get("tags") for r in targets}, open("/tmp/cosme_wholesale_backup.json","w"), ensure_ascii=False)
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=[t for t in (r.get("tags") or []) if t!=RM]
    st,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock: cnt["ok" if st in (200,204) else "ng"]+=1
with ThreadPoolExecutor(max_workers=10) as ex:
    list(ex.map(patch_one, targets))
print(f"=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(targets)}件から #コスメ美容 除去 ===")
