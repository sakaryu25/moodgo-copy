// 画像ありカード: 上に写真＋下に本文。写真の右下に「都道府県 / スポット名」を重ねる。
//   縦長写真がカードを占有しすぎないよう、アスペクト比は 0.86〜1.5 にクランプする。
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MapPin } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import CardBody from './CardBody';
import type { Post } from './postTypes';

// 縦長写真はカードが縦に伸びて巨大化するので「幅より縦長にはしない」= 最小1.0(正方形)に丸める。
// スマホ実写(3:4など縦長)でもカードは正方形どまりになり、横長写真だけ自然に横widen。
const MIN_ASPECT = 1.0;   // これ未満（＝縦長）は正方形に丸める
const MAX_ASPECT = 1.6;   // 横長すぎも抑える

export default function ImageCard({
  post, onMenu, onImageAspect,
}: { post: Post; onMenu: () => void; onImageAspect?: (id: string, aspect: number) => void }) {
  const [aspect, setAspect] = useState(1.2);
  const loc = post.prefecture ? `${post.prefecture} / ${post.title}` : post.title;
  return (
    <View>
      <View>
        <Image
          source={{ uri: post.image! }}
          style={[s.img, { aspectRatio: aspect }]}
          contentFit="cover"
          transition={220}
          onLoad={(e) => {
            const w = e.source?.width, h = e.source?.height;
            if (w && h) {
              const a = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
              setAspect(a);
              onImageAspect?.(post.id, a);
            }
          }}
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
  img: { width: '100%', backgroundColor: '#ECEAF2' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 52 },
  locWrap: {
    position: 'absolute', right: 9, bottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '88%',
  },
  locText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: -0.1, flexShrink: 1 },
});
