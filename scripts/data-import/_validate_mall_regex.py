#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""大型モールの名前ゲート(LARGE_MALL_NAME_KEYWORDS)を実DB名で検証(読み取りのみ)。
①欠落チェーンが実在し現regexでdropされるか ②拡張regexで拾えるか ③裸トークンの過剰一致(誤PASS)量。"""
import urllib.request, json, os, urllib.parse, time, re
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK}
def http(path):
    req=urllib.request.Request(SU+"/rest/v1/"+path, headers=H)
    try: return json.loads(urllib.request.urlopen(req,timeout=50).read())
    except Exception as e: return {"err":str(e)}
def names_ilike(word, limit=400):
    out=[]; last=""
    while True:
        flt=f"&id=gt.{last}" if last else ""
        p=http(f"places?select=id,name,tags&name=ilike.{urllib.parse.quote('*'+word+'*')}&is_active=eq.true&order=id.asc{flt}&limit=1000")
        if not isinstance(p,list) or not p: break
        out+=p; last=p[-1]["id"]
        if len(p)<1000 or len(out)>=limit: break
    return out

CUR=re.compile(r"モール|アウトレット|ショッピングセンター|ショッピングパーク|ショッピングプラザ|ショッピングタウン|ショッピングモール|ビナウォーク|ららぽーと|ラゾーナ|マークイズ|マルイ|丸井|MARUI|0101|パルコ|PARCO|ルミネ|LUMINE|ルクア|アトレ|エキュート|セレオ|グランデュオ|テラスモール|グランベリー|コレットマーレ|アリオ|ゆめタウン|イオン|ヴィーナスフォート|アクアシティ|ダイバーシティ|ソラマチ|ヒカリエ|高島屋|タカシマヤ|そごう|西武|東急百貨店|小田急百貨店|京王百貨店|三越|伊勢丹|大丸|松坂屋|百貨店|デパート|アウトレットパーク|プレミアム・アウトレット|プレミアムアウトレット|トレッサ|ノースポート|モザイク|MOSAIC|クイーンズスクエア|ランドマークプラザ|ワールドポーターズ|赤レンガ|キュービックプラザ|ジョイナス|ポルタ|モアーズ|MORE|ビブレ|VIVRE|オーロラモール|セレオ|グランツリー|ラスカ|ペリエ|シャル|セルバ|フォレオ|イーアス|プレナ|ピオレ|なんばパークス|ヒルズ|ガーデン|スクエア|プラザ|タウン|アネックス|EXPOCITY|エキスポシティ|キャナルシティ|マリノア|リバーウォーク|チャチャタウン", re.I)
# 拡張: 現行 + 欠落チェーン/百貨店。裸トークン(ヒルズ|ガーデン|スクエア|プラザ|タウン)と赤レンガは除去
ADD=r"阪急|阪神|京阪|名鉄|近鉄|東武|京急|大和百貨店|香林坊大和|フォーラス|エムザ|アピタ|ピアゴ|ラパーク|グランフロント|百番街|フォーリス|アル・?プラザ|平和堂|フレスポ|モレラ|スマーク|サンエー|エミフル|フジグラン|岩田屋|井筒屋|天満屋|藤崎|うすい百貨店|スズラン|まるひろ|丸広|名鉄百貨店|近鉄百貨店|東武百貨店|京阪百貨店"
NEW=re.compile(CUR.pattern + "|" + ADD, re.I)

print("=== ① 欠落チェーンの実在＋現regex DROP / 拡張regex PASS ===")
targets=["金沢フォーラス","エムザ","アピタ","香林坊大和","ラパーク","百番街","阪急うめだ","グランフロント大阪","岩田屋","天満屋","井筒屋","近鉄百貨店","名鉄百貨店","フジグラン","エミフル"]
recov=0; exist=0
for w in targets:
    rows=names_ilike(w, 60)
    shop=[r for r in rows if "#ショッピング" in (r.get("tags") or [])]
    samp=[r["name"] for r in shop[:3]] or [r["name"] for r in rows[:2]]
    if rows: exist+=1
    # 代表名で判定
    rep = samp[0] if samp else w
    cur = bool(CUR.search(rep)); new=bool(NEW.search(rep))
    if not cur and new: recov+=1
    print(f"  {w:14} 実在{len(rows):3}(#ショッピング{len(shop):3}) 現:{'PASS' if cur else 'DROP'}→拡:{'PASS' if new else 'DROP'}  例:{samp[:2]}")
print(f"  → 実在{exist}/{len(targets)} ・ 拡張で回収(DROP→PASS){recov}件")

print("\n=== ② 裸トークン(ヒルズ/ガーデン/タウン/スクエア/プラザ)＋赤レンガの過剰一致(現regexのみPASSで非モールの疑い) ===")
BARE=re.compile(r"ヒルズ|ガーデン|スクエア|プラザ|タウン|赤レンガ", re.I)
leak=[]; legit=[]
for w in ["ガーデン","ヒルズ","タウン","スクエア","赤レンガ"]:
    for r in names_ilike(w, 200):
        nm=r.get("name") or ""; tags=r.get("tags") or []
        if not CUR.search(nm): continue
        # 現regexで唯一マッチが裸トークン/赤レンガ由来か(他のモール語が無い)
        without_bare = re.sub(r"ヒルズ|ガーデン|スクエア|プラザ|タウン|赤レンガ","",nm)
        if not CUR.search(without_bare):  # 裸トークンだけで通っている
            (leak if "#ショッピング" not in tags else legit).append(nm)
seen=set()
leak=[x for x in leak if not (x in seen or seen.add(x))]
legit=[x for x in legit if not (x in seen or seen.add(x))]
print(f"  裸トークンのみでPASS: 非#ショッピング(leak疑い){len(leak)}件 / #ショッピング保持(モールかも){len(legit)}件")
print(f"  leak疑い例:", leak[:15])
print(f"  #ショッピング保持例:", legit[:15])
