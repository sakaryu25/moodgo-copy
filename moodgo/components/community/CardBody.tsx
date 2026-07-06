// カード本文の共通部分: タイトル → 星 → 説明 → 価格 → 投稿者。
// ImageCard / TextCard が上部（画像 or カテゴリ行）を足して使う。
import { StyleSheet, Text, View } from 'react-native';
import Stars from './Stars';
import UserInfo from './UserInfo';
import type { Post } from './postTypes';

export default function CardBody({
  post, onMenu, showTitleFirst = true,
}: { post: Post; onMenu: () => void; showTitleFirst?: boolean }) {
  return (
    <View style={s.body}>
      {showTitleFirst && <Text style={s.title} numberOfLines={2}>{post.title}</Text>}
      {post.rating > 0 && <View style={s.starRow}><Stars n={post.rating} /></View>}
      {!!post.description && <Text style={s.desc} numberOfLines={4}>{post.description}</Text>}
      {!!post.price && (
        <View style={s.priceChip}><Text style={s.priceText}>💴 {post.price}</Text></View>
      )}
      <UserInfo post={post} onMenu={onMenu} />
    </View>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  title: { fontSize: 16, fontWeight: '800', color: '#222', lineHeight: 21.5, letterSpacing: -0.2, marginBottom: 8 },
  starRow: { marginBottom: 10 },
  desc: { fontSize: 13, color: '#555', lineHeight: 19.5, marginBottom: 12 },
  priceChip: {
    alignSelf: 'flex-start', backgroundColor: '#F4F2F8', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  priceText: { fontSize: 12, color: '#5B5570', fontWeight: '700' },
});
