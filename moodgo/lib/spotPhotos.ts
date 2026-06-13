// セッション内で投稿された心霊スポット写真の共有ストア。
// 詳細ページで投稿 → 一覧カードへ即反映（画面をまたいでリアルタイム同期）する。
// 端末ID/タイトルの両方をキーに持ち、どちらで照合しても拾えるようにする。
import { useEffect, useState } from 'react';

const byId = new Map<string, string[]>();
const byName = new Map<string, string[]>();
const listeners = new Set<() => void>();

/** 投稿成功時に呼ぶ。placeId(=places UUID)とtitleの両方に登録して通知 */
export function addSpotPhoto(placeId: string | undefined, title: string | undefined, url: string) {
  if (!url) return;
  if (placeId) { const c = byId.get(placeId) ?? []; if (!c.includes(url)) byId.set(placeId, [url, ...c]); }
  if (title)   { const c = byName.get(title) ?? []; if (!c.includes(url)) byName.set(title, [url, ...c]); }
  listeners.forEach((l) => l());
}

export function getSpotPhotos(placeId?: string, title?: string): string[] {
  const a = placeId ? (byId.get(placeId) ?? []) : [];
  const b = title ? (byName.get(title) ?? []) : [];
  return a.length || b.length ? [...new Set([...a, ...b])] : [];
}

/** 共有ストアを購読し、対象スポットの投稿写真を返す（追加されると再レンダー） */
export function useSpotPhotos(placeId?: string, title?: string): string[] {
  const [photos, setPhotos] = useState<string[]>(() => getSpotPhotos(placeId, title));
  useEffect(() => {
    const update = () => setPhotos(getSpotPhotos(placeId, title));
    update();
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, [placeId, title]);
  return photos;
}
