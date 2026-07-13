// カード本文の共通部分: タイトル → 星 → 説明 → 価格 → 投稿者。
// ImageCard / TextCard が上部（画像 or カテゴリ行）を足して使う。
import { Wallet } from 'lucide-react-native';
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
      {/* 本文は全文表示（3行で切らない）＝「まだ文があるのに見えない」を解消。Masonryが可変高さを吸収 */}
      {!!post.description && <Text style={s.desc}>{post.description}</Text>}
      {!!post.price && (
        <View style={s.priceChip}>
          <Wallet size={12} color="#5B5570" strokeWidth={2} />
          <Text style={s.priceText}>{post.price}</Text>
        </View>
      )}
      <UserInfo post={post} onMenu={onMenu} />
    </View>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 },
  title: { fontSize: 14.5, fontWeight: '800', color: '#222', lineHeight: 19.5, letterSpacing: -0.2, marginBottom: 6 },
  starRow: { marginBottom: 7 },
  desc: { fontSize: 12, color: '#555', lineHeight: 17.5, marginBottom: 9 },
  priceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', backgroundColor: '#F4F2F8', borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 3.5,
  },
  priceText: { fontSize: 11, color: '#5B5570', fontWeight: '700' },
});
