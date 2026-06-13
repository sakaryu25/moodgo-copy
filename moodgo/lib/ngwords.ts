// 不適切語フィルタ（サーバ側＝/api/suggestions で投稿を弾く）。
// moodgo/lib/ngwords.ts とロジックを揃えること（クライアント側の事前チェック用）。
// 完全自動の検閲ではなく、明らかな違反の一次フィルタ。最終判断はadmin承認で行う。

// 差別・性的・暴力/脅迫・強い侮辱など、UGCとして明確に不可なもの。
const NG_PATTERNS: string[] = [
  // 侮辱・差別（強）
  "死ね", "しね", "殺す", "ころす", "殺害", "自殺しろ",
  "きちがい", "キチガイ", "気違い", "障害者しね",
  "デブ死", "ブス死",
  // 性的・露骨
  "セックス", "セフレ", "援交", "援助交際", "童貞", "処女厨",
  "ちんこ", "まんこ", "ちんぽ", "おっぱい揉", "射精", "ペニス", "ヴァギナ",
  "av女優", "風俗嬢", "デリヘル", "ソープ嬢",
  "fuck", "shit", "bitch", "dick", "pussy", "nigger", "cunt",
  // 脅迫・犯罪誘発
  "爆破", "爆弾しかけ", "テロ予告", "ぶっ殺", "リンチ",
  // 薬物・違法
  "覚醒剤", "大麻売", "麻薬売",
];

/** 正規化（全半角統一・小文字化・空白/記号の簡易除去）して部分一致で判定 */
function normalize(input: string): string {
  return (input ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・、。!！?？.,_\-]+/g, "");
}

/** 不適切語を含むか。含む場合は最初にヒットした語を返す */
export function findNgWord(text: string): string | null {
  if (!text) return null;
  const n = normalize(text);
  for (const w of NG_PATTERNS) {
    if (n.includes(normalize(w))) return w;
  }
  return null;
}

export function containsNgWord(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && findNgWord(t) !== null);
}
