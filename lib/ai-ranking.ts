// ── AI最終審査の適用ロジック（純関数・テスト可能） ─────────────────────────
// OpenAI(gpt-4o-mini)が返した「並べ替え順(order)」と「場違い排除(reject)」を
// 候補配列に適用する。recommend/route.ts の検索本体から切り出した本番ロジック。
//
// 設計上の安全装置:
//   1. order が空 / 不正なら元の配列をそのまま返し aiRanked=false（AI未適用扱い）。
//   2. order に全番号が無くても、抜けた番号は末尾に元順で補完する（AIが reject分を
//      order から省いても破綻しない）。補完後に全件揃わなければ AI未適用扱いにフォールバック。
//   3. reject は「残数が minKeep 未満になるなら丸ごと無視」。過剰rejectでも結果が痩せない。
//
// aiRanked が true のときだけ、呼び出し側は順位(_aiRank)を最終ソートのboostに使う。

export interface AiRankingResult<T> {
  /** 並べ替え＋reject適用後の候補（aiRanked=false のときは入力そのまま） */
  ranked: T[];
  /** AI判別順が実際に適用されたか。false なら元順を使う合図 */
  aiRanked: boolean;
}

export function applyAiRanking<T>(
  scored: T[],
  order: number[],
  reject: number[],
  minKeep = 8,
): AiRankingResult<T> {
  if (!Array.isArray(order) || order.length === 0) {
    return { ranked: scored, aiRanked: false };
  }

  // order の番号順に並べる（重複・範囲外は無視）。outIdx は out と並行する「元index」。
  const seen = new Set<number>();
  const out: T[] = [];
  const outIdx: number[] = [];
  for (const x of order) {
    const i = Number(x);
    if (Number.isInteger(i) && i >= 0 && i < scored.length && !seen.has(i)) {
      seen.add(i);
      out.push(scored[i]);
      outIdx.push(i);
    }
  }
  // order から漏れた番号を元順で末尾に補完
  for (let i = 0; i < scored.length; i++) {
    if (!seen.has(i)) {
      out.push(scored[i]);
      outIdx.push(i);
    }
  }
  // 補完しても全件揃わない（理論上起きないが防御）→ AI未適用にフォールバック
  if (out.length !== scored.length) {
    return { ranked: scored, aiRanked: false };
  }

  // reject(場違い排除)を適用。安全装置: 残数が minKeep 未満になるなら排除を無視。
  const rejectSet = new Set(
    (reject ?? []).filter((n) => Number.isInteger(n) && n >= 0 && n < scored.length),
  );
  if (rejectSet.size > 0 && scored.length - rejectSet.size >= minKeep) {
    return { ranked: out.filter((_, p) => !rejectSet.has(outIdx[p])), aiRanked: true };
  }
  return { ranked: out, aiRanked: true };
}
