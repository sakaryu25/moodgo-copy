#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""旅行「知らない街をぶらぶら」(broken)を修復。商店街/横丁/中華街/仲見世/門前/参道 等の街歩き
スポットは #ショッピング しか持たず、深掘りの must-tag #お散歩 でヒットせず0件だった。
コードは商店街を肯定語として歓迎(GENRE_POSITIVE_REQUIRED L217)なので #お散歩+#遠くに行きたい を
付ければ純度ゲートを通って出る(集中カフェと違いコードの壁なし)。

環境: APPLY=1で実反映, SUPABASE_URL/SERVICE_KEY。バックアップ: /tmp/machiaruki_backup.json
"""
import urllib.request, json, os, urllib.parse, time
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
ADD=["#お散歩","#遠くに行きたい"]
# 明確な街歩きスポット名（純度重視・銀座等の曖昧語は除外）
NAMES=["商店街","横丁","横町","中華街","仲見世","門前町","参道","アーケード","レンガ街","レンガ通り"]

def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        r=urllib.request.urlopen(req,timeout=50); return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

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
            seen.add(r["id"])
            if not all(t in (r.get("tags") or []) for t in ADD): targets.append(r)
        last=rows[-1]["id"]
        if len(rows)<1000: break

print(f"街歩きスポット ヒット {len(seen)} / 付与対象 {len(targets)}件")
print("付与例:", [r["name"][:18] for r in targets[:10]])
if not APPLY:
    print("(ドライラン)"); raise SystemExit
json.dump({str(r["id"]): r.get("tags") for r in targets}, open("/tmp/machiaruki_backup.json","w"), ensure_ascii=False)
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=list(dict.fromkeys((r.get("tags") or [])+ADD))
    st,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock: cnt["ok" if st in (200,204) else "ng"]+=1
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(patch_one, targets))
print(f"=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(targets)}件に #お散歩+#遠くに行きたい 付与 ===")
