#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""まったり「景色良いカフェ」等のデータ修正(徹底監査の結果)。
- #高層ビルカフェ=0 を解消: 高層/展望/スカイ/ルーフ/タワー/天空名のカフェに付与
- #海辺カフェ blanket汚染: 海岸語を持たない osm-foodshop の素チェーンから #海辺カフェ 剥離
- 誤タグ掃除: #犬カフェ(YOLO cafe&bar/TOMBOY=bar) , #温泉(カントリークラブ=ゴルフ)
環境: APPLY=1で実反映。バックアップ: /tmp/relax_cafes_backup.json
"""
import urllib.request, json, os, urllib.parse, time, re
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
COASTAL=re.compile(r"海|浜|ビーチ|beach|シーサイド|オーシャン|ocean|湾|浦|渚|磯|マリン|ベイ|bay|coast|sea|岬|サンセット", re.I)
HIRISE=["展望","スカイ","ルーフ","タワー","天空","SKY","ROOF","高層","空中"]
def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try: r=urllib.request.urlopen(req,timeout=50); return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
def page_ilike(pat):
    out=[]; last=""
    while True:
        flt=f"&id=gt.{last}" if last else ""
        rows=None
        for _ in range(4):
            st,raw=http("GET", f"places?select=id,name,tags,source_type&name=ilike.{urllib.parse.quote('*'+pat+'*')}&is_active=eq.true&order=id.asc{flt}&limit=1000")
            j=json.loads(raw)
            if isinstance(j,list): rows=j; break
            time.sleep(2)
        if not rows: break
        out+=rows; last=rows[-1]["id"]
        if len(rows)<1000: break
    return out
def page_tag(tagenc):
    out=[]; off=0
    while True:
        page=None
        for _ in range(4):
            st,raw=http("GET", f"places?select=id,name,tags,source_type&tags=cs.{tagenc}&is_active=eq.true&limit=1000&offset={off}")
            j=json.loads(raw)
            if isinstance(j,list): page=j; break
            time.sleep(2)
        if not page: break
        out+=page; off+=len(page)
        if len(page)<1000: break
    return out

plan={}  # id -> (row, addTags, removeTags)
def mark(r, add=(), rm=()):
    if r["id"] not in plan: plan[r["id"]]=(r, set(), set())
    plan[r["id"]][1].update(add); plan[r["id"]][2].update(rm)

# (1) #高層ビルカフェ 付与: 高層系名のカフェ(#カフェスイーツ/#喫茶店/#まったりしたい保有)
seen=set()
for nm in HIRISE:
    for r in page_ilike(nm):
        if r["id"] in seen: continue
        seen.add(r["id"]); tags=r.get("tags") or []
        if "#高層ビルカフェ" in tags: continue
        if any(t in tags for t in ["#カフェスイーツ","#喫茶店","#まったりしたい"]) and (r.get("source_type") or "").startswith("osm-food"):
            mark(r, add=["#高層ビルカフェ"])
# (2) #海辺カフェ blanket剥離: osm-foodshopで海岸語なし
for r in page_tag(urllib.parse.quote('{"#海辺カフェ"}')):
    if (r.get("source_type") or "")=="osm-foodshop" and not COASTAL.search(r.get("name") or ""):
        mark(r, rm=["#海辺カフェ"])
# (3) 誤タグ: #犬カフェ(YOLO/TOMBOY) , #温泉(カントリークラブ)
for nm in ["YOLO","TOMBOY"]:
    for r in page_ilike(nm):
        if "#犬カフェ" in (r.get("tags") or []): mark(r, rm=["#犬カフェ"])
for r in page_ilike("カントリークラブ"):
    if "#温泉" in (r.get("tags") or []): mark(r, rm=["#温泉"])

addN=sum(1 for v in plan.values() if v[1]); rmN=sum(1 for v in plan.values() if v[2])
print(f"対象 {len(plan)}件 (付与含 {addN} / 除去含 {rmN})")
print("  高層ビルカフェ付与例:", [v[0]['name'][:16] for v in plan.values() if '#高層ビルカフェ' in v[1]][:6])
print("  海辺カフェ剥離例:", [v[0]['name'][:16] for v in plan.values() if '#海辺カフェ' in v[2]][:6])
if not APPLY:
    print("(ドライラン)"); raise SystemExit
json.dump({pid:list(v[0].get('tags') or []) for pid,v in plan.items()}, open("/tmp/relax_cafes_backup.json","w"), ensure_ascii=False)
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(pid):
    r,add,rm=plan[pid]
    new=[t for t in (r.get("tags") or []) if t not in rm]
    for t in add:
        if t not in new: new.append(t)
    st,_=http("PATCH", f"places?id=eq.{pid}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock: cnt["ok" if st in (200,204) else "ng"]+=1
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(patch_one, list(plan.keys())))
print(f"=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(plan)}件 ===")
