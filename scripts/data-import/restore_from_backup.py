#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""バックアップJSON(id→元tags)から places.tags を復元する汎用ツール。
使い方: python3 restore_from_backup.py /tmp/xxx_backup.json
環境: SUPABASE_URL/SERVICE_KEY。
"""
import urllib.request, json, os, sys
from concurrent.futures import ThreadPoolExecutor
import threading
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
bak=json.load(open(sys.argv[1]))
print(f"復元対象: {len(bak)}件 ({sys.argv[1]})")
def http(path, body):
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode(), headers={**H,"Prefer":"return=minimal"}, method="PATCH")
    try: return urllib.request.urlopen(req,timeout=50).status
    except urllib.error.HTTPError as e: return e.code
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def one(item):
    pid, tags = item
    st=http(f"places?id=eq.{pid}", {"tags": tags})
    with lock: cnt["ok" if st in (200,204) else "ng"]+=1
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(one, bak.items()))
print(f"=== 復元完了: 成功{cnt['ok']} 失敗{cnt['ng']} ===")
