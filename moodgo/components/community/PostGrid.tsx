// Pinterest風 2カラム Masonry。CSS Gridではなく、各カードの推定高さで貪欲に
// 短い方の列へ割り当てる（列だけ揃い、高さはバラバラ＝Masonry）。画像の実アスペクトが
// 読み込みで判明したら次回レイアウトで反映される。
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import PostCard from './PostCard';
import type { Post } from './postTypes';

const COL_GAP = 16;   // 列間
const ROW_GAP = 16;   // カード間（縦）

// カード高さの推定（列割り当て用・ピクセルは概算でよい）
function estHeight(post: Post, cardW: number, aspect: number): number {
  let h = 12 + 16;                       // body上下パディング
  h += 22 * (post.title.length > 12 ? 2 : 1);  // タイトル1〜2行
  if (post.rating > 0) h += 23;          // 星
  if (post.description) {
    const lines = Math.min(4, Math.max(1, Math.ceil(post.description.length / 18)));
    h += 20 * lines + 12;
  }
  if (post.price) h += 28;
  h += 40;                               // 投稿者行
  if (post.image) h += cardW / aspect;   // 画像（縦=幅/アスペクト）
  else h += 46 + 12;                     // カテゴリアイコン行
  return h;
}

export default function PostGrid({
  posts, containerWidth, onPressPost, onMenuPost,
}: {
  posts: Post[];
  containerWidth: number;          // 親から測った内側幅
  onPressPost: (p: Post) => void;
  onMenuPost: (p: Post) => void;
}) {
  const cardW = (containerWidth - COL_GAP) / 2;
  // 画像アスペクト（読み込みで判明したものを覚え、次のレイアウトに反映）
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const onImageAspect = (id: string, a: number) =>
    setAspects((prev) => (prev[id] === a ? prev : { ...prev, [id]: a }));

  const [colA, colB] = useMemo(() => {
    const a: Post[] = [], b: Post[] = [];
    let ha = 0, hb = 0;
    for (const p of posts) {
      const est = estHeight(p, cardW, aspects[p.id] ?? 1.2);
      if (ha <= hb) { a.push(p); ha += est + ROW_GAP; }
      else { b.push(p); hb += est + ROW_GAP; }
    }
    return [a, b];
  }, [posts, cardW, aspects]);

  if (cardW <= 0) return null;
  const renderCol = (col: Post[], offset: number) => (
    <View style={{ flex: 1, gap: ROW_GAP }}>
      {col.map((p, i) => (
        <PostCard
          key={p.id}
          post={p}
          index={offset + i * 2}
          onPress={() => onPressPost(p)}
          onMenu={() => onMenuPost(p)}
          onImageAspect={onImageAspect}
        />
      ))}
    </View>
  );

  return (
    <View style={{ flexDirection: 'row', gap: COL_GAP }}>
      {renderCol(colA, 0)}
      {renderCol(colB, 1)}
    </View>
  );
}
