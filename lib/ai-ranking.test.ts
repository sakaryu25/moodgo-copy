import { describe, it, expect } from "vitest";
import { applyAiRanking } from "./ai-ranking";

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
const ids = (arr: { id: number }[]) => arr.map((x) => x.id);

describe("applyAiRanking", () => {
  it("order が空なら元順・aiRanked=false（AI未適用）", () => {
    const scored = mk(10);
    const r = applyAiRanking(scored, [], []);
    expect(r.aiRanked).toBe(false);
    expect(r.ranked).toBe(scored);
  });

  it("並べ替えのみ（rejectなし）", () => {
    const scored = mk(10);
    const r = applyAiRanking(scored, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], []);
    expect(r.aiRanked).toBe(true);
    expect(ids(r.ranked)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it("order に抜けがあれば元順で末尾補完", () => {
    const scored = mk(5);
    const r = applyAiRanking(scored, [3, 1], []); // 0,2,4 が抜け
    expect(r.aiRanked).toBe(true);
    expect(ids(r.ranked)).toEqual([3, 1, 0, 2, 4]);
  });

  it("reject適用: 残数 ≥ minKeep なら場違いを除外", () => {
    const scored = mk(10);
    const r = applyAiRanking(scored, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [3, 7]); // 残8 = minKeep
    expect(r.aiRanked).toBe(true);
    expect(ids(r.ranked)).toEqual([0, 1, 2, 4, 5, 6, 8, 9]);
  });

  it("AIが reject番号を order から省いても、補完→除外で正しく落ちる", () => {
    const scored = mk(10);
    const r = applyAiRanking(scored, [0, 1, 2, 4, 5, 6, 8, 9], [3, 7]); // order が 3,7 を省略
    expect(r.aiRanked).toBe(true);
    expect(ids(r.ranked)).toEqual([0, 1, 2, 4, 5, 6, 8, 9]);
  });

  it("過剰reject: 残数 < minKeep なら排除を丸ごと無視（痩せ過ぎ防止）。並べ替えは効く", () => {
    const scored = mk(10);
    const r = applyAiRanking(scored, [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], [0, 1, 2, 3, 4]); // 残5 < 8
    expect(r.aiRanked).toBe(true);
    expect(ids(r.ranked)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]); // 全件・reject無視
  });

  it("minKeep ちょうどなら reject する（境界）", () => {
    const scored = mk(10);
    const r = applyAiRanking(scored, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1], 8); // 残8 = minKeep
    expect(ids(r.ranked)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("order の不正/範囲外/重複/非整数は無視", () => {
    const scored = mk(3);
    const r = applyAiRanking(scored, [2, 2, -1, 99, 0, 1.5, 1], [99, -5]);
    expect(r.aiRanked).toBe(true);
    expect(ids(r.ranked)).toEqual([2, 0, 1]); // 重複/範囲外/小数除去・reject無効値は無視
  });

  it("カスタム minKeep を尊重", () => {
    const scored = mk(6);
    const r = applyAiRanking(scored, [0, 1, 2, 3, 4, 5], [0, 1, 2], 3); // 残3 = minKeep3
    expect(ids(r.ranked)).toEqual([3, 4, 5]);
  });
});
