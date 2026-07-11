// アプリ内通知のクライアントヘルパー。
// 未読はサーバー状態を持たず、最後に通知画面を開いた時刻(lastSeen)をローカル保持して比較する。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

const LAST_SEEN_KEY = 'moodgo-notif-last-seen';

export type Notice = {
  type: 'like' | 'visited' | 'follow' | 'comment' | 'reply' | 'mention';
  at: string;
  spotName?: string;
  targetId?: string;
  actorId?: string | null;
  actorHandle?: string | null;
  actorIcon?: string | null;
};

export async function fetchNotifications(limit = 50): Promise<Notice[]> {
  try {
    const deviceId = await getDeviceId();
    const d = await apiFetch('/api/notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, limit }),
    }).then((r) => r.json());
    return d?.ok && Array.isArray(d.items) ? d.items : [];
  } catch { return []; }
}

export async function getLastSeen(): Promise<string> {
  try { return (await AsyncStorage.getItem(LAST_SEEN_KEY)) ?? ''; } catch { return ''; }
}

export async function markSeen(): Promise<void> {
  try { await AsyncStorage.setItem(LAST_SEEN_KEY, new Date().toISOString()); } catch { /* noop */ }
}

/** 未読があるか（最新の通知が lastSeen より新しいか） */
export async function hasUnread(): Promise<boolean> {
  const [items, seen] = await Promise.all([fetchNotifications(1), getLastSeen()]);
  const newest = items[0]?.at ?? '';
  return !!newest && (!seen || newest > seen);
}
