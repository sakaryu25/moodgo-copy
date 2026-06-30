#!/usr/bin/env python3
"""
スリル気分の在庫強化(テーマパーク): 主要遊園地のキュレーション。
OSM/DBの "テーマパーク/遊園地" タグは近所の児童公園・ゲーセン・庭園まで含み自動選別不可。
そこで日本の主要スリル系遊園地を名前で精密マッチし、#スリル味わいたい 未保有に付与する。
本社オフィス/沿道飲食/物販店/植物園 等のマッチ汚染は EXCLUDE で除去。
既存タグは保持・追記のみ・可逆(backup同梱)。デフォルトはドライ run、--apply で本実行。
"""
import sys, json, time, os, urllib.request, urllib.parse

ADD = "#スリル味わいたい"
PARKS = ["ディズニーランド", "ディズニーシー", "ユニバーサル・スタジオ・ジャパン", "富士急ハイランド",
         "ナガシマスパーランド", "よみうりランド", "西武園ゆうえんち", "ひらかたパーク", "八景島シーパラダイス",
         "那須ハイランドパーク", "浜名湖パルパル", "花やしき", "東武動物公園", "志摩スペイン村", "パルケエスパーニャ",
         "三井グリーンランド", "ルスツリゾート遊園地", "鈴鹿サーキット", "城島高原パーク", "よこはまコスモワールド",
         "ナンジャタウン", "東京ジョイポリス", "桐生が岡遊園地", "華蔵寺公園遊園地", "渋川スカイランドパーク",
         "むさしの村", "東京サマーランド", "スパリゾートハワイアンズ"]
EXC = ["ストア", "ショップ", "物販", "レストラン", "食堂", "ホテル", "温泉", "ゴルフ", "ランゲージ", "駐車",
       "バス停", "植物園", "チケット", "インフォメーション", "売店", "クリニック", "保育",
       "株式会社", "警備", "管財", "総務", "経理", "人事", "オフィス", "本社", "事務",
       "通り", "道とん堀", "牛角", "セレクト", "スーベニア", "店", "センター"]
BACKUP = os.path.join(os.path.dirname(__file__), "themepark_thrill_backup.json")

env = {}
for line in open(os.path.join(os.path.dirname(__file__), "..", "..", ".env.retag")):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k] = v.strip().strip('"').strip("'")
URL = env["SUPABASE_URL"].rstrip("/"); KEY = env["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def http(method, path, body=None, extra=None):
    last = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(f"{URL}/rest/v1/{path}", method=method,
                                         data=json.dumps(body).encode() if body is not None else None)
            for k, v in H.items(): req.add_header(k, v)
            if body is not None: req.add_header("Content-Type", "application/json")
            for k, v in (extra or {}).items(): req.add_header(k, v)
            r = urllib.request.urlopen(req, timeout=90)
            return r.status, r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code >= 500 and attempt < 4: time.sleep(2 * (attempt + 1)); continue
            raise
        except Exception as e:
            last = e
            if attempt < 4: time.sleep(2 * (attempt + 1)); continue
            raise
    raise last

seen = {}
for p in PARKS:
    st, raw = http("GET", "places?" + f"select=id,name,tags&is_active=eq.true&name=ilike.{urllib.parse.quote('*'+p+'*', safe='*')}&limit=200")
    for r in json.loads(raw):
        if ADD in (r.get("tags") or []): continue
        if any(e in r["name"] for e in EXC): continue
        seen[r["id"]] = r

targets = list(seen.values())
print(f"=== 付与対象（主要パークで {ADD} 未保有）: {len(targets)} 件 ===")
for r in targets:
    print("  +", r["name"])

if "--apply" not in sys.argv:
    print("\n[ドライ run] 書き込みなし。本実行は --apply。")
    sys.exit(0)

json.dump({str(r["id"]): r.get("tags") for r in targets}, open(BACKUP, "w"), ensure_ascii=False)
print(f"\nバックアップ保存: {BACKUP}")
ok = ng = 0
for r in targets:
    new = list(dict.fromkeys((r.get("tags") or []) + [ADD]))
    try:
        st, _ = http("PATCH", f"places?id=eq.{r['id']}", {"tags": new}, {"Prefer": "return=minimal"})
        ok += 1 if st in (200, 204) else 0; ng += 0 if st in (200, 204) else 1
    except Exception:
        ng += 1
print(f"=== 完了: 成功{ok} 失敗{ng} / {len(targets)}件に {ADD} 付与 ===")
