#!/usr/bin/env python3
"""
ドライブ気分の在庫強化:
車で行く定番の目的地カテゴリで #ドライブしたい 未保有のものに付与する。

- クリーンなカテゴリ(道の駅/SA/PA/アウトレット/ダム/キャンプ場/鍾乳洞/灯台/渓谷)は全件。
- 展望台/牧場は誤マッチ(都市ビル展望・焼肉牧場 等)を EXCLUDE で除外。
- 高原は地名ノイズが多いため対象外。
- 既存ジャンルタグは保持・追記のみ・可逆(backup同梱)。
- デフォルトはドライ run。--apply で本実行。
"""
import sys, json, time, urllib.request, urllib.parse, os

ADD = "#ドライブしたい"
INCLUDE = ["道の駅", "サービスエリア", "パーキングエリア", "アウトレット", "ダム",
           "キャンプ場", "鍾乳洞", "灯台", "渓谷", "牧場"]
# name にこれらを含むものは除外。
#   ・都市ビル/飲食系（車目的地ではない）
#   ・"ダム"の英語由来誤マッチ（キングダム/ランダム等）
EXCLUDE = ["タワー", "スカイツリー", "ヒルズ", "ランドマーク", "屋上", "展望室", "デパート",
           "ヨドバシ", "空港", "駅ビル", "ビル", "会館", "焼肉", "ステーキ", "レストラン", "食堂", "ホテル",
           "キングダム", "ランダム", "フリーダム", "マダム", "アダム", "ダムカレー"]
BACKUP = os.path.join(os.path.dirname(__file__), "drive_categories_backup.json")

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

def excluded(name):
    n = name or ""
    return any(x in n for x in EXCLUDE)

# カテゴリ別に単一ilikeで取得 → ADD未保有 かつ 除外語なし を抽出
seen = {}
per_cat = {}
for cat in INCLUDE:
    cnt = 0
    for off in (0, 1000, 2000):
        q = (f"select=id,name,tags&is_active=eq.true"
             f"&name=ilike.{urllib.parse.quote('*'+cat+'*', safe='*')}&limit=1000&offset={off}")
        st, raw = http("GET", "places?" + q)
        rows = json.loads(raw)
        if not rows: break
        for r in rows:
            if ADD in (r.get("tags") or []): continue
            if excluded(r.get("name")): continue
            if r["id"] not in seen:
                seen[r["id"]] = r; cnt += 1
        if len(rows) < 1000: break
    per_cat[cat] = cnt

targets = list(seen.values())
print(f"=== 対象（{ADD} 未保有・除外後・active）: {len(targets)} 件 ===")
for c, n in sorted(per_cat.items(), key=lambda x: -x[1]):
    print(f"  {c:<12} {n}")
print("\n--- サンプル（各カテゴリ先頭3件）---")
def cat_of(name):
    for c in INCLUDE:
        if c in (name or ""): return c
    return "?"
shown = {}
for r in targets:
    c = cat_of(r.get("name"))
    shown.setdefault(c, [])
    if len(shown[c]) < 3: shown[c].append(r.get("name"))
for c in INCLUDE:
    if shown.get(c): print(f"  [{c}] " + " / ".join(shown[c]))

if "--apply" not in sys.argv:
    print("\n[ドライ run] 書き込みなし。本実行は --apply。")
    sys.exit(0)

json.dump({str(r["id"]): r.get("tags") for r in targets}, open(BACKUP, "w"), ensure_ascii=False)
print(f"\nバックアップ保存: {BACKUP}")
ok = ng = 0
for i, r in enumerate(targets):
    new = list(dict.fromkeys((r.get("tags") or []) + [ADD]))
    try:
        st, _ = http("PATCH", f"places?id=eq.{r['id']}", {"tags": new}, {"Prefer": "return=minimal"})
        ok += 1 if st in (200, 204) else 0; ng += 0 if st in (200, 204) else 1
    except Exception:
        ng += 1
    if (i + 1) % 500 == 0: print(f"  ...{i+1}/{len(targets)} (ok={ok} ng={ng})")
    time.sleep(0.01)
print(f"=== 完了: 成功{ok} 失敗{ng} / {len(targets)}件に {ADD} 付与 ===")
