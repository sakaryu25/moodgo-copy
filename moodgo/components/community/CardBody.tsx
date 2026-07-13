// カード本文の共通部分: タイトル → 星 → 説明 → 価格 → 投稿者。
// ImageCard / TextCard が上部（画像 or カテゴリ行）を足して使う。
import { Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Stars from './Stars';
import UserInfo from './UserInfo';
import type { Post } from './postTypes';

// 本文＝既定3行。3行を超える時だけ「もっと見る…」（本文より小さい字）でその場展開。
//   overflow判定は numberOfLines を付けない“隠しText”で実測（不可視・レイアウト非干渉＝ちらつき無し）。
function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState<boolean | null>(null);   // null=未計測
  return (
    <View style={s.descWrap}>
      <Text style={s.desc} numberOfLines={expanded ? undefined : 3}>{text}</Text>
      {overflow === null && (
        <Text style={[s.desc, s.measure]} onTextLayout={(e) => setOverflow(e.nativeEvent.lines.length > 3)}>{text}</Text>
      )}
      {overflow && (
        <Text style={s.more} onPress={() => setExpanded((v) => !v)} suppressHighlighting>
          {expanded ? '閉じる' : 'もっと見る…'}
        </Text>
      )}
    </View>
  );
}

export default function CardBody({
  post, onMenu, showTitleFirst = true,
}: { post: Post; onMenu: () => void; showTitleFirst?: boolean }) {
  return (
    <View style={s.body}>
      {showTitleFirst && <Text style={s.title} numberOfLines={2}>{post.title}</Text>}
      {post.rating > 0 && <View style={s.starRow}><Stars n={post.rating} /></View>}
      {!!post.description && <Description text={post.description} />}
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
  descWrap: { marginBottom: 9 },
  desc: { fontSize: 12, color: '#555', lineHeight: 17.5 },
  // 実測用の隠しText（画面には出さない・可視Textと同じ幅で行数だけ測る）
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  more: { fontSize: 11, lineHeight: 15, color: '#9B6BFF', fontWeight: '700', marginTop: 3 },
  priceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', backgroundColor: '#F4F2F8', borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 3.5,
  },
  priceText: { fontSize: 11, color: '#5B5570', fontWeight: '700' },
});
