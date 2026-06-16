// 履歴・いいね画面で「利用者投稿写真を先頭に差し込む」ための共通ユーティリティ。
//   保存済みカード（検索時のGoogle写真）に対し、開いた時点の承認済み利用者写真をDBから取得して優先表示する。
import { apiFetch } from './api';

export type UserPhotoMaps = { byId: Record<string, string[]>; byName: Record<string, string[]> };

/** 複数スポットの利用者写真をまとめて取得（Google課金なし・DBのみ）。失敗時は空マップ。 */
export async function fetchUserPhotoMaps(items: { name?: string; supabaseId?: string }[]): Promise<UserPhotoMaps> {
  try {
    const res = await apiFetch('/api/user-photos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const d = await res.json();
    if (d?.ok) return { byId: d.byId ?? {}, byName: d.byName ?? {} };
  } catch { /* 取得失敗は従来表示 */ }
  return { byId: {}, byName: {} };
}

/** そのスポットの利用者写真配列を取り出す（id優先・無ければ名前）。 */
export function userPhotosFor(maps: UserPhotoMaps, supabaseId?: string, name?: string): string[] {
  return (supabaseId ? maps.byId[supabaseId] : undefined) ?? (name ? maps.byName[name] : undefined) ?? [];
}

/** 利用者写真を先頭に。3枚以上ならGoogle等(existing)を捨て利用者写真のみ／未満は先頭+既存で補完。 */
export function mergeUserPhotos(existing: string[] | undefined, up: string[] | undefined): string[] {
  const u = up ?? []; const ex = existing ?? [];
  if (u.length === 0) return ex;
  return u.length >= 3 ? [...u] : [...u, ...ex.filter(x => !u.includes(x))];
}
