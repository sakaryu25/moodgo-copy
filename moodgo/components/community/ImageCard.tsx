// 画像ありカード: 上に写真＋下に本文。写真の右下に「都道府県 / スポット名」を重ねる。
//   写真は縦長・横長を問わず正方形(1:1)に統一（cover切り抜き）。
//   複数写真は横スワイプ（paging）＋ドットで全部見られる（Instagram型・タップは従来どおり詳細へ）。
import { LinearGradient } from 'expo-linear-gradient';
import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import {
  NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import ThumbImage from '../ThumbImage';
import CardBody from './CardBody';
import type { Post } from './postTypes';

export default function ImageCard({ post, onMenu }: { post: Post; onMenu: () => void }) {
  const loc = post.prefecture ? `${post.prefecture} / ${post.title}` : post.title;
  const images = post.images.length > 0 ? post.images : (post.image ? [post.image] : []);
  const multi = images.length > 1;
  const [idx, setIdx] = useState(0);
  const [w, setW] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (w <= 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / w);
    if (i !== idx) setIdx(i);
  };
  return (
    <View>
      <View style={s.imgWrap} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {multi && w > 0 ? (
          <ScrollView
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            decelerationRate="fast" onMomentumScrollEnd={onScroll}
            // 縦のフィードスクロールを妨げない（横に確定した時だけ奪う）
            nestedScrollEnabled
          >
            {images.map((uri, i) => (
              <ThumbImage key={i} uri={uri} style={{ width: w, height: w }} contentFit="cover" transition={220} />
            ))}
          </ScrollView>
        ) : (
          <ThumbImage uri={images[0]!} style={s.img} contentFit="cover" transition={220} />
        )}

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

        {/* 複数写真: 枚数バッジ(右上)＋ドット(下中央) */}
        {multi && (
          <>
            <View style={s.countBadge} pointerEvents="none">
              <Text style={s.countText}>{idx + 1}/{images.length}</Text>
            </View>
            <View style={s.dots} pointerEvents="none">
              {images.map((_, i) => (
                <View key={i} style={[s.dot, i === idx && s.dotActive]} />
              ))}
            </View>
          </>
        )}
      </View>
      {/* タイトルは写真上に出したので本文側では省略 */}
      <CardBody post={post} onMenu={onMenu} showTitleFirst={false} />
    </View>
  );
}

const s = StyleSheet.create({
  imgWrap: { width: '100%', aspectRatio: 1, backgroundColor: '#ECEAF2' },
  img: { width: '100%', height: '100%' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 52 },
  locWrap: {
    position: 'absolute', right: 9, bottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '88%',
  },
  locText: {
    color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: -0.1, flexShrink: 1,
    // 明るい写真でもスクリム頼みにせず読めるように（BlogViewのタイルラベルと同処理）
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  countBadge: {
    position: 'absolute', top: 8, right: 8, borderRadius: 999,
    backgroundColor: 'rgba(12,8,22,0.55)', paddingHorizontal: 8, paddingVertical: 3,
  },
  countText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  dots: {
    position: 'absolute', bottom: 26, alignSelf: 'center',
    flexDirection: 'row', gap: 4,
  },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { backgroundColor: '#fff', width: 12 },
});
