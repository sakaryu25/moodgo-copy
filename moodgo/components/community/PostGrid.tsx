// Pinterest風 2カラム Masonry。CSS Gridではなく、各カードの推定高さで貪欲に
// 短い方の列へ割り当てる（列だけ揃い、高さはバラバラ＝Masonry）。
// 画像は正方形(1:1)に統一しているため推定が決定的で、読込後のレイアウト飛びも無い。
import { useMemo } from 'react';
import { View } from 'react-native';
import PostCard from './PostCard';
import type { Post } from './postTypes';

const COL_GAP = 12;   // 列間
const ROW_GAP = 12;   // カード間（縦）

// カード高さの推定（列割り当て用・ピクセルは概算でよい）
function estHeight(post: Post, cardW: number): number {
  let h = 10 + 12;                       // body上下パディング
  if (post.image) {
    h += cardW;                          // 画像（正方形=幅と同じ高さ）※タイトルは写真上なので本文には無し
  } else {
    h += 13 + 40;                        // カテゴリアイコン行（paddingTop+iconBox）
    h += 18 * (post.title.length > 12 ? 2 : 1) + 6;  // タイトル1〜2行
  }
  if (post.rating > 0) h += 18;          // 星
  if (post.description) {
    const lines = Math.min(3, Math.max(1, Math.ceil(post.description.length / 17)));
    h += 17.5 * lines + 9;
  }
  if (post.price) h += 24;
  h += 20 + 10;                          // 投稿者行＋marginTop
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

  const [colA, colB] = useMemo(() => {
    const a: Post[] = [], b: Post[] = [];
    let ha = 0, hb = 0;
    for (const p of posts) {
      const est = estHeight(p, cardW);
      if (ha <= hb) { a.push(p); ha += est + ROW_GAP; }
      else { b.push(p); hb += est + ROW_GAP; }
    }
    return [a, b];
  }, [posts, cardW]);

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
