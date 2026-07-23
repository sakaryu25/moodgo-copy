// アプリ内通知のクライアントヘルパー。
// サーバーは通知テーブルを持たず「自分に起きたこと」を導出して返すだけ＝既読状態は
// クライアントが保持する。既読管理は per-通知の「初回に見た時刻(readAt)」を端末に記録し、
//   ・まだ見ていない通知 = 未読（ドット表示・消えない）
//   ・見てから3日経った通知 = 一覧から消す
// という2要件を満たす（旧: 単一 lastSeen 透かし → readMap へ移行。旧値は移行ブリッジに使う）。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

const LAST_SEEN_KEY = 'moodgo-notif-last-seen';   // 旧・単一透かし（移行時のみ参照）
const READ_MAP_KEY = 'moodgo-notif-read-v1';      // { [key]: readAtISO } 通知ごとの初回既読時刻
const EXPIRE_MS = 3 * 24 * 60 * 60 * 1000;        // 既読から3日で一覧から消す
const MAX_ENTRIES = 1000;                          // readMap の上限（超過は古い順に破棄）

export type Notice = {
  type: 'like' | 'visited' | 'follow' | 'comment' | 'reply' | 'mention';
  at: string;
  spotName?: string;
  targetId?: string;
  actorId?: string | null;
  actorHandle?: string | null;
  actorIcon?: string | null;
  commentText?: string;   // コメント/返信/メンションの本文（何とコメントしたか）
};

export type LoadedNotifications = { items: Notice[]; unread: Set<string>; failed?: boolean };

/** 同一イベントを一意に識別する安定キー（type＋時刻＋相手＋対象）。 */
export function noticeKey(n: Notice): string {
  return `${n.type}|${n.at}|${n.actorId ?? ''}|${n.targetId ?? ''}`;
}

// ⚠ 失敗時はthrow（握りつぶさない）。「通信失敗」を「通知0件」と区別できるようにするため。
//   呼び出し側: loadNotifications=failedフラグに変換 / hasUnread=falseに丸める。
export async function fetchNotifications(limit = 50): Promise<Notice[]> {
  const deviceId = await getDeviceId();
  const d = await apiFetch('/api/notifications', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, limit }),
  }).then((r) => r.json());
  if (!d?.ok || !Array.isArray(d.items)) throw new Error('notifications fetch failed');
  return d.items;
}

type ReadMap = Record<string, string>;
async function loadReadMap(): Promise<ReadMap> {
  try {
    const raw = await AsyncStorage.getItem(READ_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as ReadMap) : {};
  } catch { return {}; }
}
async function saveReadMap(m: ReadMap): Promise<void> {
  // 上限超過分は readAt が古い順に破棄（ストレージ肥大防止）。
  const keys = Object.keys(m);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => Date.parse(m[a]) - Date.parse(m[b]));
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete m[k];
  }
  try { await AsyncStorage.setItem(READ_MAP_KEY, JSON.stringify(m)); } catch { /* noop */ }
}

async function getLastSeen(): Promise<string> {
  try { return (await AsyncStorage.getItem(LAST_SEEN_KEY)) ?? ''; } catch { return ''; }
}

/**
 * 通知を取得し、既読管理を適用して返す。
 *   - 未表示（readMap に無い）通知 → 今回の表示で既読化（readAt=now）し unread に入れる（今回だけドット）
 *   - 既読から3日超 → 一覧から除外（readMap には残し、再表示・タイマー再開を防ぐ）
 *   - 旧 lastSeen 以前の通知は移行として lastSeen 時刻で既読化（アップデート直後の全件未読化を回避）
 * 画面を開いた＝表示分は既読、という従来の「開いたら既読」挙動を per-通知で厳密化したもの。
 */
export async function loadNotifications(limit = 50): Promise<LoadedNotifications> {
  let raw: Notice[];
  const [readMap, lastSeen] = await Promise.all([loadReadMap(), getLastSeen()]);
  try {
    raw = await fetchNotifications(limit);
  } catch {
    // 通信失敗＝「通知はありません」と誤表示しない（画面側でエラー＋再試行を出す）
    return { items: [], unread: new Set(), failed: true };
  }
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const unread = new Set<string>();
  const items: Notice[] = [];
  let changed = false;

  for (const n of raw) {
    if (!n.at) continue;
    const key = noticeKey(n);
    let readAtIso = readMap[key];
    // 移行ブリッジ: readMap 未記録でも旧 lastSeen 以前なら「その時に既読だった」とみなす
    if (!readAtIso && lastSeen && n.at <= lastSeen) {
      readAtIso = lastSeen;
      readMap[key] = lastSeen;
      changed = true;
    }
    if (readAtIso) {
      const readAt = Date.parse(readAtIso);
      if (Number.isFinite(readAt) && now - readAt > EXPIRE_MS) continue;   // 既読3日超＝非表示
      items.push(n);                                                        // 既読・期限内
    } else {
      unread.add(key);              // 新着（今回の表示で既読化）
      readMap[key] = nowIso;
      changed = true;
      items.push(n);
    }
  }

  if (changed) await saveReadMap(readMap);
  return { items, unread };
}

/** 未読があるか（readMap に無い＝一度も見ていない通知が直近に存在するか）。ベルのドット用。
 *  取得失敗は「未読なし」に丸める（ドットは飾りのためエラーUI不要）。 */
export async function hasUnread(): Promise<boolean> {
  let raw: Notice[];
  const [readMap, lastSeen] = await Promise.all([loadReadMap(), getLastSeen()]);
  try { raw = await fetchNotifications(8); } catch { return false; }
  return raw.some((n) => {
    if (!n.at) return false;
    const key = noticeKey(n);
    if (readMap[key]) return false;                       // 既読
    if (lastSeen && n.at <= lastSeen) return false;       // 移行: 旧透かし以前は既読扱い
    return true;                                          // 未読
  });
}
