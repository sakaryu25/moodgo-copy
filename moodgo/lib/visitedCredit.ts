// 行った！のサーバークレジット: 検索結果/履歴の「行った！」押下時に、
// その場所に紐づく投稿の投稿者へ「行った！された回数」を加算する（fire-and-forget）。
// ローカル記録(addVisitedLog=バッジ/訪れた県)とは独立。失敗しても体験に影響しない。
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

// 投稿IDが分かっている時の直付与/解除（お気に入りの投稿カード等）。場所解決を挟まず正確。
export function creditVisitedPost(spotId: string, on: boolean = true): void {
  (async () => {
    try {
      const deviceId = await getDeviceId();
      await apiFetch('/api/spot-like', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: on ? 'like' : 'unlike', rtype: 'visited', targetId: spotId, deviceId }),
      });
    } catch { /* noop */ }
  })();
}

export function creditVisited(rec: {
  title: string;
  supabaseId?: string;
  placeId?: string;
  address?: string;
}, on: boolean = true): void {
  (async () => {
    try {
      const deviceId = await getDeviceId();
      await apiFetch('/api/place-visited', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          action: on ? 'credit' : 'uncredit',
          placeName: rec.title,
          supabaseId: rec.supabaseId || undefined,
          placeId: rec.placeId || undefined,
          address: rec.address || undefined,
        }),
      });
    } catch { /* noop */ }
  })();
}
