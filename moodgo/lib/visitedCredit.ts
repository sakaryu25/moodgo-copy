// 行った！のサーバークレジット: 検索結果/履歴の「行った！」押下時に、
// その場所に紐づく投稿の投稿者へ「行った！された回数」を加算する（fire-and-forget）。
// ローカル記録(addVisitedLog=バッジ/訪れた県)とは独立。失敗しても体験に影響しない。
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

export function creditVisited(rec: {
  title: string;
  supabaseId?: string;
  placeId?: string;
  address?: string;
}): void {
  (async () => {
    try {
      const deviceId = await getDeviceId();
      await apiFetch('/api/place-visited', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          placeName: rec.title,
          supabaseId: rec.supabaseId || undefined,
          placeId: rec.placeId || undefined,
          address: rec.address || undefined,
        }),
      });
    } catch { /* noop */ }
  })();
}
