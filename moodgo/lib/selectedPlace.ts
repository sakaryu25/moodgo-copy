// ── selectedPlace ─────────────────────────────────────────────────────────────
// 詳細ページへ渡す Recommendation を一時保持するモジュールレベルストア
// (URL パラメータでは写真 URL 配列など大きなデータを渡せないため)

import type { Recommendation } from '@/types/app';

// 詳細ページの星評価を「気分に合う/合わない」の学習に使うための文脈（検索から来た時のみ設定）。
export type DetailContext = { mood?: string; companion?: string; subCategory?: string };

let _selected: Recommendation | null = null;
let _ctx: DetailContext = {};

export function setSelectedPlace(rec: Recommendation | null, ctx: DetailContext = {}): void {
  _selected = rec;
  _ctx = ctx ?? {};
}

export function getSelectedPlace(): Recommendation | null {
  return _selected;
}

export function getSelectedContext(): DetailContext {
  return _ctx;
}
