// 投稿カード: 画像を大きく魅せる（画像のみ＋下部スクリム）。
//   左上=都道府県タグ / 左下=スポット名＋♥いいね・行った！人数。
//   角丸24・自然な影・押下scale0.98(0.15s)・初回fade-up(0.3s)。
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Footprints, Heart, MapPin } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { MP, aspectOf, type MyPost } from './types';

function statusLabel(status?: string | null): string | null {
  if (status === 'pending') return '審査中';
  if (status === 'rejected') return '非公開';
  return null;
}

export default function MyPostCard({
  post, index = 0, onPress,
}: { post: MyPost; index?: number; onPress: () => void }) {
  const img = post.image_urls?.[0] ?? null;
  const st = statusLabel(post.status);
  const scale = useRef(new Animated.Value(1)).current;
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1, duration: 300, delay: Math.min(index, 8) * 40,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [enter, index]);

  const to = (v: number) =>
    Animated.timing(scale, { toValue: v, duration: 150, useNativeDriver: true }).start();
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }, { scale }] }}>
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
        onPressIn={() => to(0.98)} onPressOut={() => to(1)}
        style={s.card}
        accessibilityRole="button" accessibilityLabel={`${post.spot_name}の投稿を開く`}
      >
        <View style={[s.imgWrap, { aspectRatio: aspectOf(post.id) }]}>
          {img ? (
            <Image source={{ uri: img }} style={StyleSheet.absoluteFill} contentFit="cover" transition={220} />
          ) : (
            <LinearGradient colors={['#EDE9FF', '#E3ECFF']} style={[StyleSheet.absoluteFill, s.ph]}>
              <MapPin size={30} color={MP.MAIN} strokeWidth={1.6} />
            </LinearGradient>
          )}
          {/* 下部の半透明ブラックグラデーション */}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.62)']} style={s.scrim} pointerEvents="none" />

          {/* 左上: 都道府県タグ */}
          {!!post.prefecture && (
            <View style={s.prefTag}><Text style={s.prefTagText}>{post.prefecture}</Text></View>
          )}
          {/* 右上: 審査中/非公開（本人にだけ見える既存仕様を維持）*/}
          {st && <View style={s.statusTag}><Text style={s.prefTagText}>{st}</Text></View>}

          {/* 左下: スポット名 + いいね/行った！ */}
          <View style={s.info} pointerEvents="none">
            <Text style={s.name} numberOfLines={2}>{post.spot_name}</Text>
            <View style={s.metaRow}>
              <Heart size={12} color="#fff" fill="#fff" strokeWidth={0} />
              <Text style={s.metaText}>いいね {post.likes ?? 0}</Text>
              <View style={{ width: 10 }} />
              <Footprints size={12} color="#fff" strokeWidth={2.4} />
              <Text style={s.metaText}>行った {post.visited ?? 0}</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: MP.R, backgroundColor: MP.CARD,
    shadowColor: '#111', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.09, shadowRadius: 18, elevation: 3,
  },
  imgWrap: { borderRadius: MP.R, overflow: 'hidden', backgroundColor: '#ECEAF2', width: '100%' },
  ph: { alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '52%' },
  prefTag: {
    position: 'absolute', top: 12, left: 12, borderRadius: 999,
    backgroundColor: 'rgba(20,16,34,0.62)', paddingHorizontal: 11, paddingVertical: 5,
  },
  statusTag: {
    position: 'absolute', top: 12, right: 12, borderRadius: 999,
    backgroundColor: 'rgba(244,63,94,0.9)', paddingHorizontal: 11, paddingVertical: 5,
  },
  prefTagText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  info: { position: 'absolute', left: 14, right: 14, bottom: 12 },
  name: {
    color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.2, lineHeight: 20,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  metaText: {
    color: '#fff', fontSize: 11.5, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
});
