/**
 * MyPostsGlassCard — プロフィール「自分の投稿」専用のGlassmorphismカード
 *
 * コンセプト: Apple Vision Pro / iOSガラス / 高級ホテル / 旅行アルバム。
 * 差し替え専用: プロフィールの他セクション(ヒーロー/バッジ/最近チェック)には一切触れない。
 *   - シェル: 半透明ホワイト(0.2)＋blur24＋白1px内側ボーダー＋柔らかい外影＋角丸32
 *   - メイン: 最新投稿を横長ヒーロー(高さ220・角丸24)。黒→透明グラデ、
 *             左下=スポット名/都道府県/日付、右下=いいねのガラスカプセル(blur18)
 *   - 下段: 残り投稿のサムネイル横スクロール(80×80・角丸18・タップで投稿へ)
 *   - もっと見る: 中央の丸いガラスボタン(160×48・blur18・押下で微縮小)
 * 投稿が0件/ロード中の表示は呼び出し側(既存デザイン)が担当し、本カードは1件以上の時のみ使う。
 */
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, Heart, MapPin, Sparkles } from 'lucide-react-native';
import React, { useRef } from 'react';
import {
  Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

// プロフィールのデザイントークンと同値（ページ全体の統一感を維持）
const INK  = '#1E1548';
const SUB  = '#8B88A6';
const PINK = '#FF63A9';
const BLUE = '#5A8DFF';

// profile.tsx の MyPost と構造互換（likesはAPIが返すが型未宣言でも安全に拾う）
export type GlassPost = {
  id: string;
  kind?: string;
  spot_name: string;
  prefecture: string;
  image_urls: string[] | null;
  created_at: string;
  status?: string | null;
  likes?: number;
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return '';
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function statusLabel(status?: string | null): string | null {
  if (status === 'pending') return '審査中';
  if (status === 'rejected') return '非公開';
  return null;
}

// 押下で 0.97 に微縮小するガラス用Pressable（60fps: native driver）
function GlassPress({
  onPress, style, children, label,
}: { onPress: () => void; style?: object; children: React.ReactNode; label: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  return (
    <Pressable
      onPress={onPress} onPressIn={() => to(0.97)} onPressOut={() => to(1)}
      accessibilityRole="button" accessibilityLabel={label}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// ガラス面（blur＋半透明白＋白ボーダー）。Androidは実験的blurにフォールバック。
function GlassSurface({
  intensity, tint, style, children,
}: { intensity: number; tint: string; style?: object; children?: React.ReactNode }) {
  return (
    <View style={[style, { overflow: 'hidden' }]}>
      <BlurView
        intensity={intensity}
        tint="light"
        style={StyleSheet.absoluteFill}
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : 'none'}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
      {children}
    </View>
  );
}

export default function MyPostsGlassCard({
  posts, onMore, onPressPost,
}: {
  posts: GlassPost[];
  onMore: () => void;
  onPressPost: (p: GlassPost) => void;
}) {
  const hero = posts[0];
  const thumbs = posts.slice(1, 6);   // サムネイルは最大5枚
  const heroImg = hero.image_urls?.[0] ?? null;
  const heroStatus = statusLabel(hero.status);

  return (
    <View style={s.shadowWrap}>
      <GlassSurface intensity={24} tint="rgba(255,255,255,0.2)" style={s.shell}>
        <View style={s.inner}>
          {/* ── ヘッダー（既存デザイン踏襲: 左=アイコン+タイトル / 右=件数+ ＞）── */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Sparkles size={16} color={PINK} strokeWidth={2.2} />
              <Text style={s.title}>自分の投稿</Text>
            </View>
            <Pressable
              onPress={onMore} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button" accessibilityLabel="自分の投稿をすべて見る"
              style={s.headerRight}
            >
              <Text style={s.count}>{posts.length}件</Text>
              <ChevronRight size={18} color={SUB} strokeWidth={2.2} />
            </Pressable>
          </View>

          {/* ── メイン: 最新投稿のヒーロー（背後に写真色のガラスグロー）── */}
          <GlassPress onPress={() => onPressPost(hero)} label={`${hero.spot_name}の投稿を開く`}>
            {/* 写真自身をぼかして背後に敷く＝写真の色がにじむ「ガラスの影」（iOSアルバム風） */}
            {heroImg && (
              <Image
                source={{ uri: heroImg }} blurRadius={28} contentFit="cover"
                style={s.heroGlow} pointerEvents="none"
              />
            )}
            <View style={s.hero}>
              {heroImg ? (
                <Image source={{ uri: heroImg }} style={StyleSheet.absoluteFill} contentFit="cover" transition={220} />
              ) : (
                <LinearGradient colors={['#EDE9FF', '#E3ECFF']} style={[StyleSheet.absoluteFill, s.heroPh]}>
                  <MapPin size={40} color={BLUE} strokeWidth={1.5} />
                </LinearGradient>
              )}
              {/* 黒→透明グラデ（下部の文字可読性）*/}
              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.58)']} style={s.heroScrim} pointerEvents="none" />

              {/* 審査中/非公開は本人にだけ見せる既存仕様を維持 */}
              {heroStatus && (
                <View style={s.statusChip}><Text style={s.statusChipText}>{heroStatus}</Text></View>
              )}

              {/* 左下: スポット名 / 都道府県・日付 */}
              <View style={s.heroInfo} pointerEvents="none">
                <Text style={s.heroName} numberOfLines={1}>{hero.spot_name}</Text>
                <View style={s.heroMetaRow}>
                  {!!hero.prefecture && (
                    <>
                      <MapPin size={11} color="rgba(255,255,255,0.92)" strokeWidth={2.4} />
                      <Text style={s.heroMeta} numberOfLines={1}>{hero.prefecture}</Text>
                      <View style={s.metaDot} />
                    </>
                  )}
                  <Text style={s.heroMeta} numberOfLines={1}>{fmtDate(hero.created_at)}</Text>
                </View>
              </View>

              {/* 右下: いいねのガラスカプセル */}
              {typeof hero.likes === 'number' && (
                <GlassSurface intensity={18} tint="rgba(255,255,255,0.15)" style={s.likeCapsule}>
                  <View style={s.likeRow}>
                    <Heart size={12} color="#fff" fill="#fff" strokeWidth={0} />
                    <Text style={s.likeText}>{hero.likes}</Text>
                  </View>
                </GlassSurface>
              )}
            </View>
          </GlassPress>

          {/* ── サムネイル横スクロール（80×80・白リング・末尾に「+N」）── */}
          {thumbs.length > 0 && (
            <ScrollView
              horizontal showsHorizontalScrollIndicator={false}
              style={s.thumbScroll} contentContainerStyle={s.thumbRow}
            >
              {thumbs.map((p, i) => {
                const img = p.image_urls?.[0] ?? null;
                // 6件目以降がある時は最後のサムネに「+N」を重ね、タップで全件へ
                const extra = posts.length - 1 - thumbs.length;
                const isMore = extra > 0 && i === thumbs.length - 1;
                return (
                  <GlassPress
                    key={p.id}
                    onPress={() => (isMore ? onMore() : onPressPost(p))}
                    label={isMore ? `残り${extra}件の投稿を見る` : `${p.spot_name}の投稿を開く`}
                  >
                    <View style={s.thumbRing}>
                      <View style={s.thumb}>
                        {img ? (
                          <Image source={{ uri: img }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
                        ) : (
                          <LinearGradient colors={['#EDE9FF', '#E3ECFF']} style={[StyleSheet.absoluteFill, s.heroPh]}>
                            <MapPin size={20} color={BLUE} strokeWidth={1.6} />
                          </LinearGradient>
                        )}
                        {isMore && (
                          <View style={s.thumbMore}>
                            <Text style={s.thumbMoreText}>+{extra}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </GlassPress>
                );
              })}
            </ScrollView>
          )}

          {/* ── もっと見る（丸いガラスボタン 160×48）── */}
          <View style={s.moreWrap}>
            <GlassPress onPress={onMore} label="自分の投稿をもっと見る">
              <GlassSurface intensity={18} tint="rgba(255,255,255,0.18)" style={s.moreBtn}>
                <View style={s.moreInner}>
                  <Text style={s.moreText}>もっと見る</Text>
                </View>
              </GlassSurface>
            </GlassPress>
          </View>
        </View>
      </GlassSurface>
    </View>
  );
}

const s = StyleSheet.create({
  // 外影はクリッピングの外側に（iOSでoverflow:hiddenと影を両立）
  shadowWrap: {
    marginBottom: 16,   // ページ全体のカード間隔(GAP_Y)を崩さない
    borderRadius: 32,
    shadowColor: '#1E1548', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08, shadowRadius: 24, elevation: 4,
  },
  shell: {
    borderRadius: 32,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)',
  },
  inner: { padding: 24 },

  // ヘッダー（既存カードのタイポを踏襲）
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  title: { fontSize: 15, fontWeight: '800', color: INK, letterSpacing: -0.2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  count: { fontSize: 12.5, fontWeight: '700', color: SUB },

  // ヒーロー（heroGlow=写真をぼかした「ガラスの影」を背後に敷く）
  heroGlow: {
    position: 'absolute', left: 10, right: 10, top: 12, bottom: -8,
    borderRadius: 26, opacity: 0.55,
  },
  hero: { height: 220, borderRadius: 24, overflow: 'hidden', backgroundColor: '#EFEDF8' },
  heroPh: { alignItems: 'center', justifyContent: 'center' },
  heroScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 },
  heroInfo: { position: 'absolute', left: 16, right: 96, bottom: 14 },
  heroName: {
    color: '#fff', fontSize: 17, fontWeight: '800', letterSpacing: -0.2,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.7)', marginHorizontal: 2 },
  heroMeta: {
    color: 'rgba(255,255,255,0.92)', fontSize: 11.5, fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  statusChip: {
    position: 'absolute', top: 12, left: 12, borderRadius: 9,
    backgroundColor: 'rgba(244,63,94,0.9)', paddingHorizontal: 8, paddingVertical: 3,
  },
  statusChipText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  likeCapsule: {
    position: 'absolute', right: 12, bottom: 14, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  likeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5 },
  likeText: {
    color: '#fff', fontSize: 12, fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.25)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },

  // サムネイル（白リング＋薄影で写真を「浮かせる」）
  thumbScroll: { marginTop: 16, marginHorizontal: -24 },   // カード端までスクロール領域を広げる
  thumbRow: { gap: 14, paddingHorizontal: 24, paddingBottom: 2 },
  thumbRing: {
    borderRadius: 20, padding: 2, backgroundColor: 'rgba(255,255,255,0.9)',
    shadowColor: '#1E1548', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 7, elevation: 2,
  },
  thumb: { width: 80, height: 80, borderRadius: 18, overflow: 'hidden', backgroundColor: '#EFEDF8' },
  thumbMore: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(30,21,72,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbMoreText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.3 },

  // もっと見る
  moreWrap: { alignItems: 'center', marginTop: 18 },
  moreBtn: {
    width: 160, height: 48, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)',
  },
  moreInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 14, fontWeight: '800', color: INK, letterSpacing: 0.2 },
});
