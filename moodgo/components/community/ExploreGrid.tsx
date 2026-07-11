// ─── ExploreGrid — Instagram発見タブ風 3列Masonry（全国みんなの穴場・一覧ページ用）───
// 画像が主役: 写真をタイル全面に敷き、下部の薄いスクリムにタイトル/場所/いいねを重ねる。
// 左上の気分チップ（lucideアイコン＋短ラベル）で「気分で探す」というMoodGoの軸を明示。
// 写真なし投稿は気分色の淡いグラデタイルにして同じ文法（チップ＋タイトル＋場所）に揃える。
// ホーム埋め込みの2列カード(PostGrid)とは独立（あちらは従来デザインのまま）。
import { LinearGradient } from 'expo-linear-gradient';
import { Heart, Images, MapPin } from 'lucide-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import ThumbImage from '../ThumbImage';
import { useSettings } from '@/lib/settingsStore';
import type { Post } from './postTypes';

const COL = 3;      // Instagram発見タブと同じ3列
const GAP = 6;      // タイル間（角丸タイルが映える最小限の隙間・端の余白を詰めてギチギチ寄りに）

// 画像タイルの高さ比率（幅×ratio）。単調にならないようカード順に巡回＝Masonryの段差。
const RATIOS = [1.3, 1.02, 1.5, 1.16, 1.42, 1.08];
const TEXT_RATIO = 0.95;   // 写真なしタイルはやや低め

// 気分タグ → チップの短いラベル（アイコン/色は postTypes.categoryStyle の表と対応）
const MOOD_LABEL: Record<string, { ja: string; en: string }> = {
  '#お腹すいた': { ja: 'グルメ', en: 'Food' },
  '#まったりしたい': { ja: 'まったり', en: 'Chill' },
  '#自然感じたい': { ja: '自然', en: 'Nature' },
  '#わいわい楽しみたい': { ja: 'わいわい', en: 'Fun' },
  '#ドライブしたい': { ja: 'ドライブ', en: 'Drive' },
  '#体動かしたい': { ja: '運動', en: 'Active' },
  '#遠くに行きたい': { ja: '旅行', en: 'Travel' },
  '#ショッピング': { ja: '買い物', en: 'Shop' },
  '#穴場スポット': { ja: '穴場', en: 'Gem' },
};
const FALLBACK_LABEL = { ja: '穴場', en: 'Gem' };

// いいね数の短縮表記（1.2万 / 1.2K）
function fmtCount(n: number, en: boolean): string {
  if (en) return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);
  return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(n);
}

type TileProps = { post: Post; ratio: number; index: number; lang: 'ja' | 'en'; onPress: () => void; onMenu: () => void };

function ExploreTile({ post, ratio, index, lang, onPress, onMenu }: TileProps) {
  const { Icon, color, bg, tag } = post.category;
  const label = (tag ? MOOD_LABEL[tag] : null) ?? FALLBACK_LABEL;
  const scale = useRef(new Animated.Value(1)).current;
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1, duration: 280, delay: Math.min(index, 9) * 40,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [enter, index]);
  const pressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  const handlePress = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); };
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });

  const likes = post.raw.likes ?? 0;
  const loc = post.prefecture || '';

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }, { scale }] }}>
      <Pressable onPress={handlePress} onPressIn={pressIn} onPressOut={pressOut} onLongPress={onMenu}
        style={[s.tile, { aspectRatio: 1 / ratio }]}
        accessibilityRole="button" accessibilityLabel={post.title}>
        {post.image ? (
          <>
            <ThumbImage uri={post.image} style={StyleSheet.absoluteFill as any} contentFit="cover" transition={200} />
            {/* 下部スクリム: 明るい写真でも文字が読めるように */}
            <LinearGradient colors={['transparent', 'rgba(10,6,22,0.16)', 'rgba(10,6,22,0.66)']} locations={[0, 0.55, 1]} style={s.scrim} pointerEvents="none" />
            {post.images.length > 1 && (
              <View style={s.multiBadge} pointerEvents="none">
                <Images size={11} color="#fff" strokeWidth={2.2} />
              </View>
            )}
            <View style={s.overlay} pointerEvents="none">
              <Text style={s.title} numberOfLines={2}>{post.title}</Text>
              <View style={s.metaRow}>
                {!!loc && (
                  <View style={s.locRow}>
                    <MapPin size={8.5} color="rgba(255,255,255,0.9)" strokeWidth={2.4} />
                    <Text style={s.locText} numberOfLines={1}>{loc}</Text>
                  </View>
                )}
                {likes > 0 && (
                  <View style={s.likeRow}>
                    <Heart size={9} color="#fff" fill="#fff" strokeWidth={0} />
                    <Text style={s.likeText}>{fmtCount(likes, lang === 'en')}</Text>
                  </View>
                )}
              </View>
            </View>
          </>
        ) : (
          <>
            {/* 写真なし: 気分色の淡いグラデタイル（同じ位置にタイトル/場所を置いて文法を揃える）*/}
            <LinearGradient colors={[bg, '#FFFFFF']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
            <View style={s.phIconWrap} pointerEvents="none">
              <Icon size={26} color={color} strokeWidth={1.9} />
            </View>
            <View style={s.overlay} pointerEvents="none">
              <Text style={[s.title, s.titleDark]} numberOfLines={2}>{post.title}</Text>
              <View style={s.metaRow}>
                {!!loc && (
                  <View style={s.locRow}>
                    <MapPin size={8.5} color="#8B88A6" strokeWidth={2.4} />
                    <Text style={[s.locText, s.locTextDark]} numberOfLines={1}>{loc}</Text>
                  </View>
                )}
                {likes > 0 && (
                  <View style={s.likeRow}>
                    <Heart size={9} color="#E0559B" fill="#E0559B" strokeWidth={0} />
                    <Text style={[s.likeText, { color: '#8B88A6' }]}>{fmtCount(likes, lang === 'en')}</Text>
                  </View>
                )}
              </View>
            </View>
          </>
        )}
        {/* 左上の気分チップ（画像あり/なし共通・白の半透明ピル）*/}
        <View style={s.moodChip} pointerEvents="none">
          <Icon size={9.5} color={color} strokeWidth={2.4} />
          <Text style={s.moodChipText} numberOfLines={1}>{label[lang]}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function ExploreGrid({
  posts, containerWidth, onPressPost, onMenuPost,
}: {
  posts: Post[];
  containerWidth: number;
  onPressPost: (p: Post) => void;
  onMenuPost: (p: Post) => void;
}) {
  const { lang } = useSettings();
  const colW = Math.floor((containerWidth - GAP * (COL - 1)) / COL);

  // 各タイルに比率を割り当て、累積高さが最小の列へ積む（3列Masonry）
  const cols = useMemo(() => {
    const c: Array<Array<{ post: Post; ratio: number; index: number }>> = Array.from({ length: COL }, () => []);
    const h = new Array(COL).fill(0) as number[];
    posts.forEach((p, i) => {
      const ratio = p.image ? RATIOS[i % RATIOS.length] : TEXT_RATIO;
      let k = 0;
      for (let j = 1; j < COL; j++) if (h[j] < h[k]) k = j;
      c[k].push({ post: p, ratio, index: i });
      h[k] += ratio;
    });
    return c;
  }, [posts]);

  if (colW <= 0) return null;

  return (
    <View style={{ flexDirection: 'row', gap: GAP }}>
      {cols.map((col, ci) => (
        <View key={ci} style={{ width: colW, gap: GAP }}>
          {col.map(({ post, ratio, index }) => (
            <ExploreTile
              key={post.id}
              post={post}
              ratio={ratio}
              index={index}
              lang={lang}
              onPress={() => onPressPost(post)}
              onMenu={() => onMenuPost(post)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  tile: {
    width: '100%', borderRadius: 16, overflow: 'hidden', backgroundColor: '#ECEAF2',
    // ごく薄いシャドウ（白背景に沈まない程度）
    shadowColor: '#1A1330', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%' },
  overlay: { position: 'absolute', left: 8, right: 8, bottom: 7 },
  title: {
    color: '#FFFFFF', fontSize: 11.5, fontWeight: '800', lineHeight: 14.5, letterSpacing: -0.2,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  titleDark: { color: '#2A2344', textShadowColor: 'transparent' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 3, gap: 6 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 2.5, flexShrink: 1 },
  locText: {
    color: 'rgba(255,255,255,0.88)', fontSize: 9, fontWeight: '700', flexShrink: 1,
    textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  locTextDark: { color: '#8B88A6', textShadowColor: 'transparent' },
  likeRow: { flexDirection: 'row', alignItems: 'center', gap: 2.5, flexShrink: 0 },
  likeText: {
    color: '#fff', fontSize: 9, fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  moodChip: {
    position: 'absolute', top: 6, left: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.93)', borderRadius: 999,
    paddingHorizontal: 6.5, paddingVertical: 2.5, maxWidth: '82%',
  },
  moodChipText: { fontSize: 8.5, fontWeight: '800', color: '#4A4560', letterSpacing: -0.1, flexShrink: 1 },
  multiBadge: {
    position: 'absolute', top: 6, right: 6, borderRadius: 999,
    backgroundColor: 'rgba(12,8,22,0.5)', padding: 4,
  },
  phIconWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 26,
    alignItems: 'center', justifyContent: 'center',
  },
});
