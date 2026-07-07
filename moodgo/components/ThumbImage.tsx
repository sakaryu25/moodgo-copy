/**
 * ThumbImage — フィード用サムネイル優先の画像
 *
 * 自前ストレージ(spot-photos)の画像は投稿時に 400px の縮小版を
 * 「<name>_thumb.jpg」規約で保存している（app/api/spot-posts）。
 * まずサムネイルを試し、無い（旧投稿など）場合は onError で元画像へフォールバック。
 * 外部URL・規約外URLはそのまま表示する。
 */
import { Image, type ImageProps } from 'expo-image';
import { useEffect, useState } from 'react';

// 元画像URL → サムネイルURL（規約外はそのまま）
export function thumbOf(url?: string | null): string | null {
  if (!url) return null;
  if (!url.includes('/spot-photos/') || url.includes('_thumb.')) return url;
  const replaced = url.replace(/\.jpe?g(\?[^#]*)?$/i, (_m, q: string | undefined) => `_thumb.jpg${q ?? ''}`);
  return replaced;
}

type Props = Omit<ImageProps, 'source'> & { uri: string };

export default function ThumbImage({ uri, onError, ...rest }: Props) {
  const thumb = thumbOf(uri) ?? uri;
  const [src, setSrc] = useState(thumb);
  useEffect(() => { setSrc(thumbOf(uri) ?? uri); }, [uri]);
  return (
    <Image
      {...rest}
      source={{ uri: src }}
      onError={(e) => {
        // サムネ規約のファイルが無い旧投稿 → 元画像で再試行
        if (src !== uri) setSrc(uri);
        else onError?.(e);
      }}
    />
  );
}
