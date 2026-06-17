#!/usr/bin/env python3
# 深掘り検索の「在庫被覆」監査ツール（常設）。
#   タグ語彙ミスマッチ（検索が引くタグ vs データの実タグ）でSBが空振りする箇所を一括検出する。
#   ・DRILL_ANSWER_TO_MUST（lib/predefined-tags.ts）= 深掘り回答→検索タグ
#   ・DEEPDIVE_SEARCH_KEYWORDS（lib/search-filters.ts）= 深掘り→名前ベース取得キーワード
#   各深掘りについて「タグ在庫(最大)」と「名前一致在庫」を表示し、薄い箇所に❌/⚠️を付ける。
#   使い方: SUPABASE_URL / SUPABASE_SERVICE_KEY を環境変数に入れて
#           python3 scripts/data-import/audit_search_coverage.py
import os, re, sys, json, urllib.request, urllib.parse

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_KEY"]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
THIN = 150   # これ未満は ❌（要改善）
WARN = 600   # これ未満は ⚠️

def http_count(qs):
    req = urllib.request.Request(
        f"{URL}/rest/v1/places?{qs}&select=id",
        headers={"apikey": KEY, "Authorization": "Bearer " + KEY,
                 "Prefer": "count=exact", "Range": "0-0"})
    try:
        r = urllib.request.urlopen(req, timeout=40)
        return int(r.headers.get("Content-Range", "/0").split("/")[-1])
    except Exception:
        return -1

_tag_cache = {}
def tag_count(tag):
    if tag not in _tag_cache:
        q = urllib.parse.quote(tag)
        _tag_cache[tag] = http_count(f'tags=cs.%7B%22{q}%22%7D')
    return _tag_cache[tag]

def name_count(keywords):
    # name が keywords のいずれかを含む件数（OR・ILIKE）。先頭4語で評価（searchPlacesByText と同条件）。
    kws = [k for k in keywords if len(k) >= 2][:4]
    if not kws:
        return 0
    clauses = ",".join(f"name.ilike.*{urllib.parse.quote(k)}*" for k in kws)
    return http_count(f"or=({clauses})")

def parse_map(path, const_name):
    src = open(os.path.join(ROOT, path), encoding="utf-8").read()
    i = src.find(const_name)
    if i < 0:
        return []
    j = src.find("};", i)
    block = src[i:j]
    out = []
    for m in re.finditer(r'"([^"#\n]+)":\s*\[([^\]]*)\]', block):
        key = m.group(1)
        vals = re.findall(r'"([^"]+)"', m.group(2))
        if vals:
            out.append((key, vals))
    return out

drill = parse_map("lib/predefined-tags.ts", "DRILL_ANSWER_TO_MUST")
kwmap = dict(parse_map("lib/search-filters.ts", "DEEPDIVE_SEARCH_KEYWORDS"))

def flag(n):
    return "❌" if n < THIN else ("⚠️" if n < WARN else "✅")

print("=== 深掘り検索 在庫被覆監査 ===", flush=True)
print(f"(タグ在庫 ❌<{THIN}  ⚠️<{WARN}  ✅。名前在庫は name ILIKE 上位4語のOR件数)\n", flush=True)
rows = []
for key, tags in drill:
    tag_best = max((tag_count(t) for t in tags), default=0)
    kws = kwmap.get(key)
    nm = name_count(kws) if kws else None
    rows.append((tag_best, key, tags, kws, nm))

rows.sort(key=lambda r: r[0])
for tag_best, key, tags, kws, nm in rows:
    line = f"{flag(tag_best)} {key:26s} タグ最大={tag_best:5d} [{', '.join(f'{t}={tag_count(t)}' for t in tags)}]"
    if kws is not None:
        line += f"  名前在庫={nm} (kw:{','.join(kws[:4])})"
    elif tag_best < WARN:
        line += "  ← 名前ベースKW未設定（薄ければ DEEPDIVE_SEARCH_KEYWORDS 追加を検討）"
    print(line, flush=True)

print("\n=== DEEPDIVE_SEARCH_KEYWORDS にあるが DRILL に無い深掘り ===", flush=True)
for key, kws in kwmap.items():
    if key not in dict(drill):
        print(f"  {key}: 名前在庫={name_count(kws)} (kw:{','.join(kws[:4])})  ※DRILLタグ無し→isApiOnly対象", flush=True)
