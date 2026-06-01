// ── selectedPlace ─────────────────────────────────────────────────────────────
// 詳細ページへ渡す Recommendation を一時保持するモジュールレベルストア
// (URL パラメータでは写真 URL 配列など大きなデータを渡せないため)

import type { Recommendation } from '@/types/app';

let _selected: Recommendation | null = null;

export function setSelectedPlace(rec: Recommendation | null): void {
  _selected = rec;
}

export function getSelectedPlace(): Recommendation | null {
  return _selected;
}
