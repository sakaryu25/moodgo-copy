#!/usr/bin/env python3
# QuizFlow.tsx の DEEP_DIVE（RN専用・lucideアイコン依存）から、Web の企業フォームが使える
# 純データ版 lib/mood-deepdive.ts を再生成する。DEEP_DIVE を更新したらこれを実行すること。
#   使い方: python3 scripts/data-import/gen-mood-deepdive.py
import re, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "moodgo/components/QuizFlow.tsx")
OUT = os.path.join(ROOT, "lib/mood-deepdive.ts")

src = open(SRC).read()
m = re.search(r"export const DEEP_DIVE[^{]*\{(.*?)\n\};", src, re.S)
block = m.group(1)
mood_starts = [(mm.start(), mm.group(1)) for mm in re.finditer(r"\n  '([^']+)':\s*\{", block)]
mood_starts.append((len(block), None))
data = {}
for i in range(len(mood_starts) - 1):
    start, mood = mood_starts[i]
    end = mood_starts[i + 1][0]
    seg = block[start:end]
    pairs = re.findall(r"key:\s*'([^']+)',\s*label:\s*'([^']+)'", seg)
    data[mood] = [{"key": k, "label": l} for k, l in pairs if k != "こだわらない"]

# 気分タグ(#...) → DEEP_DIVE短縮キー（moodgo/app/post.tsx の MOOD_TAG_TO_DIVE と同一）
tag_to_dive = {
    "#お腹すいた": "お腹すいた", "#まったりしたい": "まったり", "#自然感じたい": "自然",
    "#わいわい楽しみたい": "楽しみたい", "#ドライブしたい": "ドライブ", "#集中したい": "集中",
    "#体動かしたい": "運動", "#遠くに行きたい": "旅行", "#ショッピング": "ショッピング",
    "#スリル味わいたい": "スリル",
}
by_tag = {tag: data.get(dive, []) for tag, dive in tag_to_dive.items()}

lines = [
    "// 気分タグ → 深掘り(サブジャンル)候補。QuizFlow.tsx の DEEP_DIVE から機械抽出した純データ版。",
    "//   Web(企業フォーム)は lucide-react-native 依存の QuizFlow を import できないため、",
    "//   キー/ラベルだけを取り出してここへ複製する（Iconは持たない）。検索の実タグは '#'+key。",
    "//   ⚠ DEEP_DIVE を更新したら scripts/data-import/gen-mood-deepdive.py で再生成すること。",
    "export type DeepDiveOption = { key: string; label: string };",
    "",
    "export const MOOD_DEEP_DIVE: Record<string, DeepDiveOption[]> = {",
]
for tag, opts in by_tag.items():
    lines.append(f"  {json.dumps(tag, ensure_ascii=False)}: [")
    for o in opts:
        lines.append(f"    {{ key: {json.dumps(o['key'], ensure_ascii=False)}, label: {json.dumps(o['label'], ensure_ascii=False)} }},")
    lines.append("  ],")
lines.append("};")
lines.append("")
open(OUT, "w").write("\n".join(lines))
print(f"generated {OUT}: {len(by_tag)} moods, {sum(len(v) for v in by_tag.values())} options")
