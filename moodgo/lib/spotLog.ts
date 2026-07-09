// ─── spotLog ─────────────────────────────────────────────────────────────────
// プロフィールの「バッジ」「最近チェックしたスポット」用のローカル記録（2026-07-06）。
//   - visited: 「行った！」を確定したスポット（バッジの元。達成日=初回のみ保持）
//   - viewed : 詳細画面(place)を開いたスポット（最近チェック。最新が先頭・同一スポットは先頭へ）
// どちらも端末ローカル(AsyncStorage)のみ・サーバー送信なし。記録開始前の過去分は存在しない。
import AsyncStorage from '@react-native-async-storage/async-storage';

export type SpotLogItem = {
  title: string;
  photoUrl?: string;
  area?: string;        // 都道府県など短い場所表記
  address?: string;
  placeId?: string;
  supabaseId?: string;
  tags?: string[];
  at: string;           // ISO日時（visited=達成日 / viewed=最終閲覧日時）
};

export const VISITED_LOG_KEY = 'moodgo-visited-log';
export const VIEWED_LOG_KEY  = 'moodgo-viewed-spots';
const CAP = 200;
const VIEWED_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 最近チェックは1週間で自動消去（バッジ=visitedは永続）

// 1週間より古い閲覧記録を除外（visited=達成バッジには適用しない）
function pruneViewed(list: SpotLogItem[]): SpotLogItem[] {
  const cutoff = Date.now() - VIEWED_TTL_MS;
  return list.filter((e) => {
    const t = new Date(e.at).getTime();
    return isFinite(t) && t >= cutoff;
  });
}

// 同一スポット判定（お気に入りのsameFavと同思想: ID優先→title互換）
function keyOf(x: Pick<SpotLogItem, 'title' | 'placeId' | 'supabaseId'>): string {
  return x.supabaseId ?? x.placeId ?? x.title;
}

async function loadLog(key: string): Promise<SpotLogItem[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function loadVisitedLog(): Promise<SpotLogItem[]> { return loadLog(VISITED_LOG_KEY); }
// 読み込み時に1週間超を除去。実データも掃除して古い記録が溜まり続けないようにする。
export async function loadViewedLog(): Promise<SpotLogItem[]> {
  const list = await loadLog(VIEWED_LOG_KEY);
  const fresh = pruneViewed(list);
  if (fresh.length !== list.length) {
    try { await AsyncStorage.setItem(VIEWED_LOG_KEY, JSON.stringify(fresh)); } catch { /* noop */ }
  }
  return fresh;
}

/** 行った！バッジ: 既に達成済みなら日付を上書きしない（達成日は初回を保持） */
export async function addVisitedLog(item: Omit<SpotLogItem, 'at'>): Promise<void> {
  try {
    if (!item.title) return;
    const list = await loadLog(VISITED_LOG_KEY);
    if (list.some((e) => keyOf(e) === keyOf(item))) return;
    const next = [{ ...item, at: new Date().toISOString() }, ...list].slice(0, CAP);
    await AsyncStorage.setItem(VISITED_LOG_KEY, JSON.stringify(next));
  } catch { /* 記録失敗は無害（バッジが増えないだけ） */ }
}

/** 行った！の解除: 同一スポット判定(keyOf=ID優先→title互換)で記録を外す（バッジ/訪れた県も減る） */
export async function removeVisitedLog(item: Pick<SpotLogItem, 'title' | 'placeId' | 'supabaseId'>): Promise<void> {
  try {
    const list = await loadLog(VISITED_LOG_KEY);
    const next = list.filter((e) => keyOf(e) !== keyOf(item));
    if (next.length !== list.length) {
      await AsyncStorage.setItem(VISITED_LOG_KEY, JSON.stringify(next));
    }
  } catch { /* noop */ }
}

/** 最近チェック: 同一スポットは先頭へ移動（最終閲覧日時で更新） */
export async function addViewedLog(item: Omit<SpotLogItem, 'at'>): Promise<void> {
  try {
    if (!item.title) return;
    const list = pruneViewed(await loadLog(VIEWED_LOG_KEY));   // 書き込み時にも1週間超を掃除
    const next = [
      { ...item, at: new Date().toISOString() },
      ...list.filter((e) => keyOf(e) !== keyOf(item)),
    ].slice(0, CAP);
    await AsyncStorage.setItem(VIEWED_LOG_KEY, JSON.stringify(next));
  } catch { /* noop */ }
}

/** 「3分前」「昨日」等の相対表記（プロフィール表示用） */
export function relativeTime(iso: string, lang: 'ja' | 'en' = 'ja'): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  const en = lang === 'en';
  if (min < 1) return en ? 'just now' : 'たった今';
  if (min < 60) return en ? `${min}m ago` : `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return en ? `${hr}h ago` : `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return en ? 'yesterday' : '昨日';
  if (day < 7) return en ? `${day}d ago` : `${day}日前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
