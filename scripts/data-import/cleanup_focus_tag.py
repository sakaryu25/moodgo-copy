import urllib.request, urllib.parse, json, os, re, sys, time

# 一回限りの掃除: #集中したい / #勉強場 タグの汚染除去
#   純粋な美術館/博物館/ギャラリー/ジム等から focus 系タグだけを剥がす（行は消さない・他タグは温存）
#   図書館系トークンを含む行は除外（郷土資料館などのコンボは温存）
#   PostgREST count=exact で前後カウントを検証。冪等（剥がした行は次回ヒットしない）。
#   使い方: python3 cleanup_focus_tag.py           # ドライラン（変更なし・対象一覧表示）
#           python3 cleanup_focus_tag.py --apply   # 実適用（PATCH）

SU = os.environ["SUPABASE_URL"].rstrip("/")
SK = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": SK, "Authorization": "Bearer " + SK, "Content-Type": "application/json"}
APPLY = "--apply" in sys.argv

TARGET_TAGS = ["#集中したい", "#勉強場"]
# 美術館/博物館/ギャラリー/ジム系（剥がす候補）。英語名(PARCO MUSEUM TOKYO等)・画廊も拾う
MUSEUM_RE = re.compile(r"美術館|博物館|ギャラリー|ミュージアム|工芸館|史料|文学館|画廊|ジム|フィットネス"
                       r"|\bGYM\b|BEYOND|\bMUSEUM\b|\bGALLERY\b", re.I)
# 図書館系トークン（含むなら温存＝剥がさない）。英語LIBRARY/ARCHIVEも保険で温存側へ
LIBRARY_RE = re.compile(r"図書|文庫|書店|ブック|資料館|学習|アーカイブ|\bLIBRARY\b|\bARCHIVE\b", re.I)


def http(method, path, body=None, extra=None):
    h = dict(H)
    if extra: h.update(extra)
    req = urllib.request.Request(SU + "/rest/v1/" + path,
                                 data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
                                 headers=h, method=method)
    try:
        r = urllib.request.urlopen(req, timeout=60)
        return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}


def cs_qs(tag):
    # PostgREST 配列contains: tags=cs.{"#集中したい"}
    return "tags=" + urllib.parse.quote('cs.{"' + tag + '"}')


def count_tag(tag):
    st, raw, hdr = http("GET", "places?select=id&" + cs_qs(tag), None,
                        {"Prefer": "count=exact", "Range-Unit": "items", "Range": "0-0"})
    cr = hdr.get("content-range", "")
    return cr.split("/")[-1] if "/" in cr else "?"


def fetch_with_tag(tag):
    rows, off = [], 0
    while True:
        st, raw, hdr = http("GET", f"places?select=id,name,tags,source_type&{cs_qs(tag)}&limit=1000&offset={off}")
        chunk = json.loads(raw)
        if not chunk: break
        rows += chunk; off += 1000
        if len(chunk) < 1000: break
    return rows


print("=== BEFORE (PostgREST count=exact) ===", flush=True)
for t in TARGET_TAGS:
    print(f"  {t}: {count_tag(t)}", flush=True)

# 両タグの候補をid重複排除で集約
by_id = {}
for t in TARGET_TAGS:
    for row in fetch_with_tag(t):
        by_id[row["id"]] = row

# 剥がし対象を判定
targets = []
for row in by_id.values():
    name = row.get("name") or ""
    tags = row.get("tags") or []
    if MUSEUM_RE.search(name) and not LIBRARY_RE.search(name):
        new_tags = [x for x in tags if x not in TARGET_TAGS]
        if new_tags != tags:
            targets.append((row["id"], name, tags, new_tags, row.get("source_type")))

# source別内訳
src_breakdown = {}
for _, _, _, _, src in targets:
    src_breakdown[src or "(null)"] = src_breakdown.get(src or "(null)", 0) + 1

print(f"\n=== 候補 {len(by_id)} 行中 / 剥がし対象 {len(targets)} 行 ===", flush=True)
print("  source別:", json.dumps(src_breakdown, ensure_ascii=False), flush=True)
print("  サンプル(先頭20):", flush=True)
for tid, name, tags, new_tags, src in sorted(targets, key=lambda r: r[1])[:20]:
    removed = [x for x in tags if x in TARGET_TAGS]
    print(f"    [{src}] {name}  剥がす{removed} -> 残り{new_tags}", flush=True)

if not APPLY:
    print("\n[ドライラン] --apply を付けると上記を PATCH します。変更なしで終了。", flush=True)
    sys.exit(0)

print(f"\n=== APPLY: {len(targets)} 行を PATCH 中... ===", flush=True)
ok = ng = 0
for i, (tid, name, tags, new_tags, src) in enumerate(targets):
    st, raw, hdr = http("PATCH", f"places?id=eq.{tid}", {"tags": new_tags}, {"Prefer": "return=minimal"})
    if st in (200, 204): ok += 1
    else:
        ng += 1; print("   PATCH失敗", name, st, raw[:120], flush=True)
    if (i + 1) % 100 == 0: print(f"   ...{i+1}/{len(targets)}", flush=True)
print(f"  成功 {ok} / 失敗 {ng}", flush=True)

print("\n=== AFTER (PostgREST count=exact) ===", flush=True)
for t in TARGET_TAGS:
    print(f"  {t}: {count_tag(t)}", flush=True)
