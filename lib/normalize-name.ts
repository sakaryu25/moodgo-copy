// ── lib/normalize-name.ts ─────────────────────────────────────────────────────
// スポット名の表記ゆれ吸収用の正規化。カタカナ/ひらがな/全角半角/大小/区切り記号の違いを
// 潰して「同じ表記」を同一キーにする（例: 東京ドリームパーク ≈ 東京ﾄﾞﾘｰﾑﾊﾟｰｸ ≈ 東京どりーむぱーく）。
//   ※日本語↔英語（東京 vs Tokyo）は別軸なので座標近接で吸収する（重複防止の役割分担）。

// カタカナ(ァ-ヶ)→ひらがな。長音符ー(U+30FC)は範囲外なので保持される。
function kataToHira(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 区切り/記号/空白を除去（長音符ーは意味を持つので残す）。
const STRIP_RE = /[\s　・･,、.。'"’”「」『』（）()\[\]【】{}<>_\-‐-―/／\\!?！？#＃&＆@＠~〜:：;；]/g;

export function normalizeName(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFKC")   // 全角→半角・互換文字（ﾄﾞﾘｰﾑ→ドリーム 等）
    .toLowerCase()
    .replace(STRIP_RE, "")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))   // カタカナ→ひらがな
    .trim();
}

// 2つの名前が「表記ゆれの範囲で同じ」とみなせるか（完全一致 or 一方が他方を包含）。
// 包含を許すのは「東京ドリームパーク」と「ドリームパーク」のような部分名の重複を拾うため。
// ※短すぎる語での誤一致を避けるため、包含判定は正規化後3文字以上のときだけ有効にする。
export function isSameNameLoose(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}
