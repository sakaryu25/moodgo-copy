#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""adminスポット(source_type=admin)で #自然感じたい を持つもののうち、
明らかに自然でない（寺/神社/像/市/通り/館/モール等）かつ自然系タグも無いものから
#自然感じたい を外す。本物の自然admin（海岸/庭園/展望/山/滝…）は温存。

環境: APPLY=1で実反映(既定ドライラン), SUPABASE_URL/SERVICE_KEY。
バックアップ: /tmp/admin_nature_backup.json
"""
import urllib.request, json, os, re

SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK,"Content-Type":"application/json"}
APPLY=os.environ.get("APPLY")=="1"
NAT="#自然感じたい"

# 明らかに非自然の名前パターン
NON_NATURE=re.compile(
    r"(寺|院|庵|坊|閣|堂|社|宮)$|神社|神宮|大社|稲荷|八幡|天満宮|東照宮|権現|明神|不動|観音|地蔵|薬師|大師|霊場|弁財天|弁天|"
    r"像$|碑$|塚$|跡$|門$|城$|城跡|"
    r"(市|区|町|村)$|丁目|通り$|商店街|横丁|仲見世|参道|CROSSING|クロッシング|スクランブル|"
    r"アウトレット|モール|百貨店|デパート|プラザ|マルイ|ルミネ|パルコ|ビル$|"
    r"駅$|空港|"
    r"館$|水族館|動物園|植物園|遊園地|"
    r"スタジアム|アリーナ|ドーム|ホール|劇場|映画館|会館|役所|学校|大学|病院|"
    r"ホテル|旅館|温泉|スパ|サウナ|健康ランド|"
    r"カフェ|珈琲|喫茶|レストラン|食堂|居酒屋|ラーメン"
)
# これらの自然系タグがあれば「本物の自然」とみなし温存
SCENIC_KEEP={"#絶景スポット","#展望台","#滝","#海辺","#庭園","#山","#湖","#岬","#渓谷",
             "#大型公園","#花畑","#高原","#紅葉","#桜","#海","#ビーチ","#自然公園","#名所公園"}

def http(method, path, body=None, extra=None):
    h=dict(H); h.update(extra or {})
    req=urllib.request.Request(SU+"/rest/v1/"+path, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        r=urllib.request.urlopen(req,timeout=60); return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

# offsetページングはタイムアウトするので keyset(id範囲)＋リトライで堅牢に全件走査
last_id=""; total=0; remove=[]; kept_scenic=0; kept_namok=0; pages=0
while True:
    flt=f"&id=gt.{last_id}" if last_id else ""
    rows=None
    for attempt in range(4):
        st,raw=http("GET", f"places?select=id,name,tags&source_type=eq.admin&is_active=eq.true&order=id.asc{flt}&limit=800")
        j=json.loads(raw)
        if isinstance(j, list): rows=j; break
        import time as _t; _t.sleep(2)   # タイムアウト等→リトライ
    if rows is None:
        print("リトライ尽きた。中断（再実行で続行可）", str(j)[:120]); break
    if not rows: break
    for r in rows:
        tags=r.get("tags") or []
        if NAT not in tags: continue
        total+=1
        nm=r.get("name") or ""
        if any(t in SCENIC_KEEP for t in tags): kept_scenic+=1; continue
        if NON_NATURE.search(nm): remove.append(r)
        else: kept_namok+=1
    pages+=1; last_id=rows[-1]["id"]
    if len(rows)<800: break

print(f"admin×#自然感じたい: {total}件")
print(f"  外す(非自然名＆自然タグ無し): {len(remove)}件")
print(f"  温存(自然系タグあり): {kept_scenic}件 / (名前が非自然パターン外): {kept_namok}件")
print("\n外す例:", [r["name"] for r in remove[:12]])
print("温存例(タグ理由):", "(下でサンプル)")

if not APPLY:
    print("\n(ドライラン。APPLY=1 で実反映)")
    raise SystemExit

backup={str(r["id"]): r.get("tags") or [] for r in remove}
json.dump(backup, open("/tmp/admin_nature_backup.json","w"), ensure_ascii=False)
print(f"バックアップ: {len(backup)}件 → /tmp/admin_nature_backup.json")
from concurrent.futures import ThreadPoolExecutor
import threading
lock=threading.Lock(); cnt={"ok":0,"ng":0}
def patch_one(r):
    new=[t for t in (r.get("tags") or []) if t!=NAT]
    st,_=http("PATCH", f"places?id=eq.{r['id']}", {"tags":new}, {"Prefer":"return=minimal"})
    with lock:
        if st in (200,204): cnt["ok"]+=1
        else: cnt["ng"]+=1
        n=cnt["ok"]+cnt["ng"]
        if n%2000==0: print(f"  {n}/{len(remove)}...",flush=True)
with ThreadPoolExecutor(max_workers=12) as ex:
    list(ex.map(patch_one, remove))
print(f"\n=== 完了: 成功{cnt['ok']} 失敗{cnt['ng']} / {len(remove)}件から #自然感じたい を除去 ===")
