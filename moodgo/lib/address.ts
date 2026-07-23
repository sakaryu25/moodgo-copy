// 住所の表示整形。Google の formattedAddress は「日本、〒153-0042 東京都目黒区…」形式で来るため、
//   先頭の「日本、」「〒郵便番号」を落として日本のユーザーに自然な住所にする。
//   ⚠ サーバーは formattedAddress を verbatim 保存/返却するため、剥がすのは表示のこの1箇所に集約する。
//   （app/api/reverse-geocode の cleanFull と同じ規則。カード/詳細で共用）

// 表示用に整形した住所を返す。国名・郵便番号プレフィックスを除去。
//   「日本」だけ・都道府県だけ等の実質未登録は空文字を返す（呼び出し側でエリア名や非表示に切替）。
export function cleanAddress(address: string | null | undefined): string {
  if (!address) return '';
  const s = String(address)
    .replace(/^日本[、,]\s*/, '')          // 「日本、」除去
    .replace(/^〒?\s*\d{3}-?\d{4}\s*/, '')  // 「〒153-0042 」除去（日本、の後に来るケース）
    .replace(/^日本[、,]\s*/, '')          // 〒除去後にもう一度「日本、」が来る形に対応
    .trim();
  // 実質「未登録」＝空 / 「日本」「日本国」/ 都道府県名だけ → 住所として出さない
  if (!s || s === '日本' || s === '日本国') return '';
  if (/^(北海道|東京都|(?:大阪|京都)府|.{2,3}県)$/.test(s)) return '';
  return s;
}
