// 画像ありカード: 上に写真＋下に本文。写真の右下に「都道府県 / スポット名」を重ねる。
//   写真は縦長・横長を問わず正方形(1:1)に統一（cover切り抜き）。
//   縦長が巨大化せず、横長も小さくならず、全カードの画像高さが揃う＋読込時のレイアウト飛びも無い。
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MapPin } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import CardBody from './CardBody';
import type { Post } from './postTypes';

export default function ImageCard({ post, onMenu }: { post: Post; onMenu: () => void }) {
  const loc = post.prefecture ? `${post.prefecture} / ${post.title}` : post.title;
  return (
    <View>
      <View>
        <Image
          source={{ uri: post.image! }}
          style={s.img}
          contentFit="cover"
          transition={220}
        />
        {/* 右下の場所ラベル（読みやすさのため下部に薄いスクリム）*/}
        <LinearGradient
          colors={['transparent', 'rgba(12,8,22,0.5)']}
          style={s.scrim}
          pointerEvents="none"
        />
        <View style={s.locWrap} pointerEvents="none">
          <MapPin size={10} color="#FFFFFF" strokeWidth={2.4} />
          <Text style={s.locText} numberOfLines={1}>{loc}</Text>
        </View>
      </View>
      {/* タイトルは写真上に出したので本文側では省略 */}
      <CardBody post={post} onMenu={onMenu} showTitleFirst={false} />
    </View>
  );
}

const s = StyleSheet.create({
  img: { width: '100%', aspectRatio: 1, backgroundColor: '#ECEAF2' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 52 },
  locWrap: {
    position: 'absolute', right: 9, bottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '88%',
  },
  locText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: -0.1, flexShrink: 1 },
});
