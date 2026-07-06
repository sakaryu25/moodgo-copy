// 画像なしカード: 左上にカテゴリアイコン・右上に都道府県、その下にタイトル＋本文。
import { MapPin } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import CardBody from './CardBody';
import type { Post } from './postTypes';

export default function TextCard({ post, onMenu }: { post: Post; onMenu: () => void }) {
  const { Icon, color, bg } = post.category;
  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <View style={[s.iconBox, { backgroundColor: bg }]}>
          <Icon size={19} color={color} strokeWidth={2} />
        </View>
        {!!post.prefecture && (
          <View style={s.prefRow}>
            <MapPin size={10} color="#9B96A6" strokeWidth={2.2} />
            <Text style={s.pref}>{post.prefecture}</Text>
          </View>
        )}
      </View>
      {/* タイトルは head の下・CardBodyの先頭に出す */}
      <CardBody post={post} onMenu={onMenu} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingTop: 13 },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  prefRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  pref: { fontSize: 11, color: '#777', fontWeight: '600' },
});
