// 画像ありカード: 上に写真（上角のみ丸め・object-fit cover・自然な高さ）＋下に本文。
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import CardBody from './CardBody';
import type { Post } from './postTypes';

export default function ImageCard({
  post, onMenu, onImageAspect,
}: { post: Post; onMenu: () => void; onImageAspect?: (id: string, aspect: number) => void }) {
  // 縦横比は読み込み時に確定。初期は 4:5(=0.8) 寄りの縦長で見栄えよく（Pinterest風）
  const [aspect, setAspect] = useState(1.2);
  return (
    <View>
      <Image
        source={{ uri: post.image! }}
        style={[s.img, { aspectRatio: aspect }]}
        contentFit="cover"
        transition={220}
        onLoad={(e) => {
          const w = e.source?.width, h = e.source?.height;
          if (w && h) {
            // 極端な縦長/横長はカードが崩れるので 0.62〜1.9 にクランプ
            const a = Math.min(1.9, Math.max(0.62, w / h));
            setAspect(a);
            onImageAspect?.(post.id, a);
          }
        }}
      />
      <CardBody post={post} onMenu={onMenu} />
    </View>
  );
}

const s = StyleSheet.create({
  // 上角はカード側 overflow:hidden + radius24 で丸まる
  img: { width: '100%', backgroundColor: '#ECEAF2' },
});
