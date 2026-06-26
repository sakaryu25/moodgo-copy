#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""室内でのんびり/外でひろびろ の肯定語regexを実プール名で検証(読み取りのみ・DB書き込み無し)。"""
import urllib.request, json, os, urllib.parse, time, re
SU=os.environ["SUPABASE_URL"].rstrip("/"); SK=os.environ["SUPABASE_SERVICE_KEY"]
H={"apikey":SK,"Authorization":"Bearer "+SK}
def http(path):
    req=urllib.request.Request(SU+"/rest/v1/"+path, headers=H)
    try: return json.loads(urllib.request.urlopen(req,timeout=50).read())
    except Exception as e: return {"err":str(e)}
def page_tag(tagenc, cap=4000):
    out=[]; off=0
    while len(out)<cap:
        p=http(f"places?select=name&tags=cs.{tagenc}&is_active=eq.true&limit=1000&offset={off}")
        if not isinstance(p,list) or not p: break
        out+=[r.get("name") or "" for r in p]; off+=len(p)
        if len(p)<1000: break
    return out

# === 室内でのんびり ===
INDOOR_NEW=re.compile(r"ヨガ|yoga|ピラティス|pilates|ストレッチ|スタジオ|ジム|gym|フィットネス|fitness|プール|pool|スイミング|swim|加圧|エニタイム|ちょこざっぷ|chocozap|コナミ|体育館|武道館|道場|ボルダリング|クライミング|climbing|卓球|エアロビ|トレーニング|training|スポーツクラブ|スポーツセンター|レッスン|ダンス|空手|柔道|剣道|温水|スケート|フィット|テニス|バドミントン", re.I)
INDOOR_OLD=re.compile(r"ボウリング|ボウル|バッティング|卓球|ビリヤード|ダーツ|ラウンドワン|スポッチャ|アミューズ|ゲーム|カラオケ|アーチェリー|ピンポン|射", re.I)
names=[]
for t in ['{"#室内で運動"}','{"#ジム"}','{"#プール"}']:
    names+=page_tag(urllib.parse.quote(t))
names=[n for n in names if n]
seen=set(); names=[n for n in names if not (n in seen or seen.add(n))]
mNew=[n for n in names if INDOOR_NEW.search(n)]; mOld=[n for n in names if INDOOR_OLD.search(n)]
unmatched=[n for n in names if not INDOOR_NEW.search(n)]
print(f"=== 室内でのんびり プール {len(names)}件(uniq名) ===")
print(f"  旧regex(ボウリング系)マッチ: {len(mOld)} ({100*len(mOld)//max(1,len(names))}%)  ← これだけ生き残ってた=ほぼ0が正解")
print(f"  新regex(室内運動)マッチ:    {len(mNew)} ({100*len(mNew)//max(1,len(names))}%)")
print(f"  新regexで未マッチ(drop)例: ", unmatched[:25])

# === 外でひろびろ: ゴルフposReq拡張の検証 ===
GOLF_OLD=re.compile(r"ゴルフ")
GOLF_NEW=re.compile(r"ゴルフ|カントリークラブ|カンツリー|カントリー倶楽部|ゴルフ倶楽部|ゴルフクラブ|ＣＣ")
gnames=list(dict.fromkeys(page_tag(urllib.parse.quote('{"#ゴルフ"}'))))
gnames=[n for n in gnames if n]
gold=[n for n in gnames if GOLF_OLD.search(n)]; gnew=[n for n in gnames if GOLF_NEW.search(n)]
recovered=[n for n in gnames if GOLF_NEW.search(n) and not GOLF_OLD.search(n)]
still=[n for n in gnames if not GOLF_NEW.search(n)]
print(f"\n=== 外でひろびろ #ゴルフ プール {len(gnames)}件(uniq名) ===")
print(f"  旧'ゴルフ'のみマッチ: {len(gold)} / 新regexマッチ: {len(gnew)}  (回収 +{len(recovered)})")
print(f"  回収される例(カントリー等):", recovered[:15])
print(f"  なお新regexでも未マッチ例:", still[:15])
