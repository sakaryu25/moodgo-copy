// Pinterest風 2カラム Masonry（貪欲割当・高さ可変）。カード間/左右16。
// アスペクトはidから決定的に選ぶので読み込みでレイアウトが飛ばない。
import { useMemo } from 'react';
import { View } from 'react-native';
import MyPostCard from './MyPostCard';
import { MP, aspectOf, type MyPost } from './types';

export default function MyPostGrid({
  posts, containerWidth, onPressPost,
}: { posts: MyPost[]; containerWidth: number; onPressPost: (p: MyPost) => void }) {
  const cardW = (containerWidth - MP.GAP) / 2;

  const [colA, colB] = useMemo(() => {
    const a: MyPost[] = [], b: MyPost[] = [];
    let ha = 0, hb = 0;
    for (const p of posts) {
      const est = cardW / aspectOf(p.id);   // 画像のみカード=高さは幅/アスペクト
      if (ha <= hb) { a.push(p); ha += est + MP.GAP; }
      else { b.push(p); hb += est + MP.GAP; }
    }
    return [a, b];
  }, [posts, cardW]);

  if (cardW <= 0) return null;
  const renderCol = (col: MyPost[], offset: number) => (
    <View style={{ flex: 1, gap: MP.GAP }}>
      {col.map((p, i) => (
        <MyPostCard key={p.id} post={p} index={offset + i * 2} onPress={() => onPressPost(p)} />
      ))}
    </View>
  );

  return (
    <View style={{ flexDirection: 'row', gap: MP.GAP }}>
      {renderCol(colA, 0)}
      {renderCol(colB, 1)}
    </View>
  );
}
