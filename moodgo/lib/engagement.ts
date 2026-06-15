// 暗黙フィードバック（学習ループ②）の送信ヘルパ。どの画面/コンポーネントからも呼べる共通版。
// 検索結果の昇格学習に使われる。fire-and-forget・失敗無視。
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

export type EngagementAction = 'map_click' | 'detail_view' | 'favorite' | 'visited' | 'share';

// ファネル計測用の任意メタ。placeId=同名店の混線解消 / searchId=1検索の経路再構成 /
//   position=掲載順位。device_id は内部で getDeviceId から自動付与（ユーザー単位ファネル）。
export interface EngagementMeta {
  placeId?: string;
  searchId?: string;
  position?: number;
}

export function sendEngagement(
  placeName: string,
  action: EngagementAction,
  mood?: string,
  meta?: EngagementMeta,
): void {
  if (!placeName) return;
  getDeviceId()
    .catch(() => '')
    .then((deviceId) =>
      apiFetch('/api/engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place_name: placeName,
          mood: mood ?? '',
          action,
          place_id: meta?.placeId,
          search_id: meta?.searchId,
          position: meta?.position,
          device_id: deviceId || undefined,
        }),
      }).catch(() => {}),
    )
    .catch(() => {});
}
