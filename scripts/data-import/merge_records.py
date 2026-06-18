#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
並列fetchの全出力ファイル（osm_grp_*.json / osm_grp_*b.json / osm_re_*.json）を
1つに統合し、座標+名前で大域dedupして /tmp/osm_foodshop_records.json に書き出す。

  - 書込中で壊れているファイルは try/except でスキップ（完全性は別途 .done で担保）。
  - dedup キー: name + round(lat,4),round(lng,4)（fetch時の dedup と同一）。
  - 統計（県別ではなくタグ別・信頼度別）を表示してタグ品質を即確認できる。
"""
import json, glob, sys, os
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osm_food_tagging import correct_baked_tags

OUT = "/tmp/osm_foodshop_records.json"

files = sorted(set(
    glob.glob("/tmp/osm_grp_*.json") +
    glob.glob("/tmp/osm_re_*.json") +
    glob.glob("/tmp/osm_sweep_*.json")
))

recs = []
seen = set()
skipped_files = []
dup = 0
for f in files:
    try:
        data = json.load(open(f))
    except Exception as e:
        skipped_files.append((f, str(e)[:40]))
        continue
    for r in data:
        try:
            k = r["name"] + "|" + f"{round(r['lat'],4)},{round(r['lng'],4)}"
        except Exception:
            continue
        if k in seen:
            dup += 1
            continue
        seen.add(k)
        # QA補正: 名前ベースの明白な誤タグ（洋麺屋→ラーメン, インドレストラン→洋食 等）を除去
        r["tags"] = correct_baked_tags(r.get("name", ""), r.get("tags", []))
        recs.append(r)

json.dump(recs, open(OUT, "w"), ensure_ascii=False)

print(f"統合: {len(files)}ファイル, ユニーク {len(recs)}件, 重複除去 {dup}件")
if skipped_files:
    print(f"スキップ(書込中/破損) {len(skipped_files)}ファイル: {[f for f,_ in skipped_files]}")

# ── タグ品質サマリー ──────────────────────────────────────────────────────────
srcc = Counter(); confc = Counter(); tagc = Counter()
for r in recs:
    srcc[r.get("tag_source")] += 1
    confc[r.get("tag_confidence")] += 1
    for t in r.get("tags", []):
        tagc[t] += 1
n = max(1, len(recs))
print("\n── tag_source ──")
for k, v in srcc.most_common():
    print(f"  {str(k):16s}{v:7d}  {v*100//n}%")
print("── confidence ──")
for k, v in confc.most_common():
    print(f"  {str(k):8s}{v:7d}  {v*100//n}%")
print(f"\n★ 実効fallback率(=#お腹すいたのみ): {srcc['fallback']*100//n}%")
print("\n── 主要ジャンルタグ件数 ──")
for k, v in tagc.most_common(40):
    if k != "#お腹すいた":
        print(f"  {k:18s}{v}")
