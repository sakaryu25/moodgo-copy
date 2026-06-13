// 暗黙フィードバック（学習ループ②）の送信ヘルパ。どの画面/コンポーネントからも呼べる共通版。
// 検索結果の昇格学習に使われる。fire-and-forget・失敗無視。
import { apiFetch } from '@/lib/api';

export type EngagementAction = 'map_click' | 'detail_view' | 'favorite' | 'visited' | 'share';

export function sendEngagement(placeName: string, action: EngagementAction, mood?: string): void {
  if (!placeName) return;
  apiFetch('/api/engagement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ place_name: placeName, mood: mood ?? '', action }),
  }).catch(() => {});
}
