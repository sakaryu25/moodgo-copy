// ─── favoritesServer ─────────────────────────────────────────────────────────
// お気に入り(=行きたいリスト)のサーバー同期。端末IDのKeychain永続化と併せ、再インストールしても
// お気に入りを復元できるようにする。方針は「丸ごと置き換え」:
//   - ローカルにお気に入りがある → それをサーバーへ反映（この端末が真実）。
//   - ローカルが空（新規/再インストール直後）→ サーバーから取り戻してローカルへ復元。
// user_favorites 未適用/オフラインでも従来どおりローカルのみで安全に動く。
import { FAVORITES_KEY, loadJSON, saveJSON } from '@/lib/storage';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import type { FavoriteItem } from '@/types/app';

export async function pullServerFavorites(): Promise<FavoriteItem[]> {
  try {
    const deviceId = await getDeviceId();
    if (!deviceId) return [];
    const d = await apiFetch('/api/user-favorites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', deviceId }),
    }).then((r) => r.json());
    return Array.isArray(d?.items) ? (d.items as FavoriteItem[]) : [];
  } catch { return []; }
}

export async function pushServerFavorites(items: FavoriteItem[]): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    if (!deviceId) return;
    await apiFetch('/api/user-favorites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'replace', deviceId, items }),
    });
  } catch { /* オフライン等はローカルのみで動作 */ }
}

// ローカルとサーバーを突き合わせ、実効リストを返す（必要ならローカルへ復元保存）。
export async function syncFavorites(): Promise<FavoriteItem[]> {
  const local = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
  if (Array.isArray(local) && local.length > 0) {
    pushServerFavorites(local);            // ローカルが真実 → サーバーへ反映（await不要）
    return local;
  }
  const server = await pullServerFavorites();   // 空ならサーバーから復元
  if (server.length > 0) await saveJSON(FAVORITES_KEY, server);
  return server;
}
