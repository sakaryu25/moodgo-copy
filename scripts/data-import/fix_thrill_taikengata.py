#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""スリル「体験型」のリコール改善。#体験型ゲーム のうちスリル本命(脱出/謎解き/VR/ボルダリング/
トランポリン/アスレチック/サバゲ/ジップライン)に #スリル味わいたい を付与(東京中心の在庫を拾う)。
★#体験型ゲーム全体への一括付与は厳禁(ビリヤード/カラオケがleakする)→名前で本命に限定。
※大阪/地方の本命は在庫ゼロ=本質改善は別途OSM新規取込が必要(本スクリプト対象外)。
環境: APPLY=1で実反映。バックアップ: /tmp/thrill_taikengata_backup.json
"""
import urllib.request, json, os, urllib.parse, time
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
ADD="#スリル味わいたい"
NAMES=["脱出ゲーム","脱出リアル","リアル脱出","謎解き","ボルダリング","クライミング",
       "トランポリン","アスレチック","サバゲ","サバイバルゲーム","ジップライン","VRパーク","VR ZONE","VRゲーム"]
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
            # スリル本命らしさ: #体験型ゲーム持ち or 明確な本命名。#スリル味わいたい 未保有のみ。
            if ADD in tags: continue
            if "#体験型ゲーム" in tags or any(k in (r.get("name") or "") for k in ["脱出","謎解き","ボルダリング","クライミング","トランポリン","アスレチック","サバゲ","ジップライン","VR"]):
                targets.append(r)
        last=rows[-1]["id"]
        if len(rows)<1000: break
print(f"体験型本命ヒット {len(seen)} / 付与対象 {len(targets)}件")
print("付与例:", [r["name"][:20] for r in targets[:12]])
if not APPLY:
    print("(ドライラン)"); raise SystemExit
json.dump({str(r["id"]): r.get("tags") for r in targets}, open("/tmp/thrill_taikengata_backup.json","w"), ensure_ascii=False)
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=list(dict.fromkeys((r.get("tags") or [])+[ADD]))
    st,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock: cnt["ok" if st in (200,204) else "ng"]+=1
with ThreadPoolExecutor(max_workers=10) as ex:
    list(ex.map(patch_one, targets))
print(f"=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(targets)}件に #スリル味わいたい 付与 ===")
