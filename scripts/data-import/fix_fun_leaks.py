#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""楽しみたいの少数leak掃除(高精度監査の結果)。名前限定・admin中心・少数で安全:
- アクティブに遊ぶ: 物販ダーツ店(DARTS HIVE/ダーツショップ)から遊びタグ除去
- 王道で遊ぶ: 物販(POP MART/ガシャポンのデパート)から#テーマパーク除去
- 観て楽しむ: ビール/ワイン博物館等の飲み系から#わいわい楽しみたい除去
環境: APPLY=1で実反映, SUPABASE_URL/SERVICE_KEY。バックアップ: /tmp/fun_leaks_backup.json
"""
import urllib.request, json, os, urllib.parse, time
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
# (名前パターン群, 除去タグ群)
RULES=[
  (["ダーツショップ","DARTS HIVE","Darts Shop","ダーツハイブ"], ["#体験型ゲーム","#ダーツ","#わいわい楽しみたい"]),
  (["POP MART","ポップマート","ガシャポンのデパート"], ["#テーマパーク"]),
  (["ビール博物館","ワイン博物館","地ビール","日本酒博物館"], ["#わいわい楽しみたい"]),
]
def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        r=urllib.request.urlopen(req,timeout=50); return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

seen={}; plan=[]   # id -> (row, removeTags)
for names, rm in RULES:
    for nm in names:
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
                tags=r.get("tags") or []
                toRemove=[t for t in rm if t in tags]
                if not toRemove: continue
                if r["id"] in seen:
                    seen[r["id"]][1].extend(t for t in toRemove if t not in seen[r["id"]][1])
                else:
                    seen[r["id"]]=(r, list(toRemove)); plan.append(r["id"])
            last=rows[-1]["id"]
            if len(rows)<1000: break

print(f"掃除対象 {len(plan)}件")
for pid in plan[:15]:
    r,rm=seen[pid]; print(f"  {r['name'][:24]:26} 除去{rm}")
if not APPLY:
    print("(ドライラン)"); raise SystemExit
json.dump({pid: seen[pid][0].get("tags") for pid in plan}, open("/tmp/fun_leaks_backup.json","w"), ensure_ascii=False)
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(pid):
    r,rm=seen[pid]
    new=[t for t in (r.get("tags") or []) if t not in rm]
    st,_=http("PATCH", f"places?id=eq.{pid}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock: cnt["ok" if st in (200,204) else "ng"]+=1
with ThreadPoolExecutor(max_workers=10) as ex:
    list(ex.map(patch_one, plan))
print(f"=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(plan)}件 掃除 ===")
