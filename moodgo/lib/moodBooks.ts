/**
 * Mood Book APIクライアント（/api/mood-books）
 * プロフィール「自分の投稿」を進化させた思い出BOOK。1ページ=1スポット（=1投稿）。
 *   ・全て POST + action のRPCスタイル。deviceId は資格情報なので必ずbodyで送る
 *   ・overview はプロフィール表示用に AsyncStorage キャッシュ（前回結果を即表示→裏で最新化）
 *   ・サーバー未デプロイ/テーブル未適用でも {books:[], primary:null} で安全に動く
 */
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { loadJSON, saveJSON } from '@/lib/storage';

export type MoodBookMeta = {
  id: string;
  title: string;
  description: string;
  cover_image_url: string;
  visibility: 'private' | 'friends' | 'public';
  theme_key: string;
  page_count: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type MoodBookPage = {
  id: string;
  post_id: string;
  kind: 'suggestion' | 'moodlog' | 'blog' | 'free';
  page_order: number;
  layout_type: string;
  title: string;
  text: string;
  area: string;
  photo_urls: string[];
  mood_tags: string[];
  date: string | null;
  place_key: string;
  post_deleted: boolean;
};

export type MoodBookOverview = {
  books: MoodBookMeta[];
  primary: { book: MoodBookMeta; pages: MoodBookPage[] } | null;
};

export const MOODBOOK_CACHE_KEY = 'moodgo-moodbook-overview-v1';

// タイトル候補（作成モーダルのチップ。入力の呼び水・言語別）
export const BOOK_TITLE_IDEAS = {
  ja: ['2026 Summer', '横浜さんぽ', 'カフェ巡り', '思い出BOOK', 'お気に入りスポット'],
  en: ['2026 Summer', 'City walks', 'Cafe hopping', 'Memory book', 'My favorites'],
} as const;

async function call<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const deviceId = await getDeviceId();
  const res = await apiFetch('/api/mood-books', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, deviceId }),
  });
  const d = await res.json();
  if (!d?.ok) throw new Error(String(d?.error ?? `API ${res.status}`));
  return d as T;
}

export async function loadCachedOverview(): Promise<MoodBookOverview | null> {
  try {
    const c = await loadJSON<MoodBookOverview | null>(MOODBOOK_CACHE_KEY, null);
    return c && Array.isArray(c.books) ? c : null;
  } catch { return null; }
}

export async function fetchOverview(): Promise<MoodBookOverview> {
  const d = await call<MoodBookOverview & { ok: boolean }>({ action: 'overview' });
  const overview: MoodBookOverview = { books: d.books ?? [], primary: d.primary ?? null };
  saveJSON(MOODBOOK_CACHE_KEY, overview);
  return overview;
}

export async function getBook(bookId: string, offset = 0, limit = 40): Promise<{ book: MoodBookMeta; pages: MoodBookPage[]; total: number }> {
  const d = await call<{ book: MoodBookMeta; pages: MoodBookPage[]; total: number }>({ action: 'get', bookId, offset, limit });
  return { book: d.book, pages: d.pages ?? [], total: d.total ?? 0 };
}

export async function createBook(opts: { title: string; description?: string; visibility?: string; postIds?: string[] }): Promise<MoodBookMeta> {
  const d = await call<{ book: MoodBookMeta }>({ action: 'create', ...opts });
  return d.book;
}

export async function updateBook(bookId: string, patch: {
  title?: string; description?: string; visibility?: string; coverImageUrl?: string; isArchived?: boolean;
}): Promise<MoodBookMeta> {
  const d = await call<{ book: MoodBookMeta }>({ action: 'update', bookId, ...patch });
  return d.book;
}

export async function deleteBook(bookId: string): Promise<void> {
  await call({ action: 'delete', bookId });
}

export async function addPages(bookId: string, postIds: string[]): Promise<{ added: number; pageCount: number }> {
  const d = await call<{ added: number; pageCount: number }>({ action: 'add-pages', bookId, postIds });
  return { added: d.added ?? 0, pageCount: d.pageCount ?? 0 };
}

export async function removePage(bookId: string, pageId: string): Promise<number> {
  const d = await call<{ pageCount: number }>({ action: 'remove-page', bookId, pageId });
  return d.pageCount ?? 0;
}

export async function reorderPages(bookId: string, pageIds: string[]): Promise<void> {
  await call({ action: 'reorder', bookId, pageIds });
}

export async function updatePage(bookId: string, pageId: string, patch: { customTitle?: string; customText?: string }): Promise<void> {
  await call({ action: 'update-page', bookId, pageId, ...patch });
}

// 投稿完了画面などから「一番最近使ったBOOK（無ければ作成）」へ1投稿を差し込む
export async function addPostToDefaultBook(postId: string, fallbackTitle: string): Promise<{ bookId: string; bookTitle: string }> {
  const ov = await fetchOverview();
  let book = ov.books[0] ?? null;
  if (!book) book = await createBook({ title: fallbackTitle });
  await addPages(book.id, [postId]);
  return { bookId: book.id, bookTitle: book.title };
}

// BOOKページの日付表示（例: 2026.06）。日単位より「アルバムの月」感を優先
export function fmtPageDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// BOOK作成日などの表示（例: 2026.06.01 作成）
export function fmtFullDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
