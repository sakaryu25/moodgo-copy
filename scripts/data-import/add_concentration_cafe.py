#!/usr/bin/env python3
"""
集中(作業)気分の在庫強化:
作業向けカフェチェーン（電源/Wi-Fi/長居OKで日本の作業・勉強の定番）で
#集中したい 未保有のものに #集中したい を付与する。

- 既存ジャンルタグ(#カフェスイーツ 等)はそのまま、追記のみ。
- 実行前に現タグを backup JSON に保存（可逆）。
- デフォルトはドライ run（抽出＋サンプル表示のみ・書込なし）。--apply で本実行。

使い方:
  python3 add_concentration_cafe.py            # ドライ run（件数＋サンプル）
  python3 add_concentration_cafe.py --apply    # 本実行（バックアップ後に付与）
"""
import sys, json, time, urllib.request, urllib.parse, os

ADD = "#集中したい"
# 作業向けの定番チェーンのみ（個人喫茶や酒寄りの店は除外）
CHAINS = ["スターバックス", "ドトール", "コメダ", "タリーズ", "星乃珈琲",
          "サンマルクカフェ", "ベローチェ", "上島珈琲", "ルノアール", "エクセルシオール"]
BACKUP = os.path.join(os.path.dirname(__file__), "concentration_cafe_backup.json")

env = {}
for line in open(os.path.join(os.path.dirname(__file__), "..", "..", ".env.retag")):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1); env[k] = v.strip().strip('"').strip("'")
URL = env["SUPABASE_URL"].rstrip("/"); KEY = env["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def http(method, path, body=None, extra=None):
    # Supabaseのstatement timeoutで一時的に5xxが出るのでリトライ
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
            if e.code >= 500 and attempt < 4:
                time.sleep(2 * (attempt + 1)); continue
            raise
        except Exception as e:
            last = e
            if attempt < 4:
                time.sleep(2 * (attempt + 1)); continue
            raise
    raise last

# チェーンごとに単一ilikeでキーセット取得し、#集中したい 未保有のみをクライアント側で抽出。
#   （or=10ilike + not.cs を全42万行に効かせるとタイムアウトするため、軽い単一ilikeに分割）
seen = {}
for chain in CHAINS:
    for off in (0, 1000, 2000):  # 単一チェーンは2000件未満なので浅いoffsetで全件取れる（order無し＝タイムアウト回避）
        q = (f"select=id,name,tags&is_active=eq.true"
             f"&name=ilike.{urllib.parse.quote('*'+chain+'*', safe='*')}&limit=1000&offset={off}")
        st, raw = http("GET", "places?" + q)
        rows = json.loads(raw)
        if not rows:
            break
        for r in rows:
            if ADD not in (r.get("tags") or []):
                seen[r["id"]] = r
        if len(rows) < 1000:
            break
targets = list(seen.values())

print(f"=== 対象（{ADD} 未保有の作業向けカフェチェーン・active）: {len(targets)} 件 ===")
# チェーン別内訳
from collections import Counter
def which(name):
    for c in CHAINS:
        if c in (name or ""): return c
    return "?"
cnt = Counter(which(r.get("name")) for r in targets)
for c, n in cnt.most_common():
    print(f"  {c:<12} {n}")
print("\n--- サンプル20件（名前が本当にカフェか確認用）---")
for r in targets[:20]:
    print(f"  {r.get('name')}")

if "--apply" not in sys.argv:
    print("\n[ドライ run] 書き込みはしていません。本実行は --apply を付けてください。")
    sys.exit(0)

# 本実行: バックアップ → 付与
json.dump({str(r["id"]): r.get("tags") for r in targets}, open(BACKUP, "w"), ensure_ascii=False)
print(f"\nバックアップ保存: {BACKUP}（復元用・可逆）")
ok = ng = 0
for i, r in enumerate(targets):
    new = list(dict.fromkeys((r.get("tags") or []) + [ADD]))
    try:
        st, _ = http("PATCH", f"places?id=eq.{r['id']}", {"tags": new}, {"Prefer": "return=minimal"})
        ok += 1 if st in (200, 204) else 0
        ng += 0 if st in (200, 204) else 1
    except Exception:
        ng += 1
    if (i + 1) % 500 == 0:
        print(f"  ...{i+1}/{len(targets)} (ok={ok} ng={ng})")
    time.sleep(0.01)
print(f"=== 完了: 成功{ok} 失敗{ng} / {len(targets)}件に {ADD} 付与 ===")
