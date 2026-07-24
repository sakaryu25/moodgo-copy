/**
 * Onboarding.tsx — 初回起動の価値訴求スライド（プロフィール設定の前に表示）
 *   ・MoodGoが何をしてくれるアプリかを3枚で伝える
 *   ・横スワイプ or 「次へ」、最後に「はじめる」→ onDone()
 *   ・どのスライドからでも「スキップ」で即終了
 */
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Compass, MapPinned, Sparkles } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import {
  Dimensions, NativeScrollEvent, NativeSyntheticEvent,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PINK = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const { width: W } = Dimensions.get('window');

type Slide = { icon: React.ReactNode; title: string; body: string; emoji: string };
const SLIDES: Slide[] = [
  {
    icon: <Compass size={40} color="#fff" strokeWidth={1.8} />,
    emoji: '🧭',
    title: '気分で、行き先が決まる',
    body: '「まったりしたい」「わいわい楽しみたい」\nそんな“気分”を選ぶだけで、\nぴったりの場所をMoodGoが提案します。',
  },
  {
    icon: <MapPinned size={40} color="#fff" strokeWidth={1.8} />,
    emoji: '🗺️',
    title: '全国の穴場も、名所も',
    body: '温泉・絶景・図書館・心霊スポットまで。\n地図アプリに載りにくい場所や、\nみんなが見つけた穴場に出会えます。',
  },
  {
    icon: <Sparkles size={40} color="#fff" strokeWidth={1.8} />,
    emoji: '✨',
    title: 'Moodログでシェア',
    body: '行った場所の気分や写真を記録して、\n全国のみんなにシェア。\nあなたの一枚が、誰かの発見になります。',
  },
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const scRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const last = SLIDES.length - 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / W);
    if (p !== page) setPage(p);
  };
  const next = () => {
    if (page >= last) { onDone(); return; }
    scRef.current?.scrollTo({ x: (page + 1) * W, animated: true });
    setPage(page + 1);
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* スキップ */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => { Haptics.selectionAsync().catch(() => {}); onDone(); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel="スキップ">
          <Text style={s.skip}>スキップ</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {SLIDES.map((sl, i) => (
          <View key={i} style={[s.slide, { width: W }]}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.iconCircle}>
              {sl.icon}
            </LinearGradient>
            <Text style={s.emoji}>{sl.emoji}</Text>
            <Text style={s.title}>{sl.title}</Text>
            <Text style={s.body}>{sl.body}</Text>
          </View>
        ))}
      </ScrollView>

      {/* ドット */}
      <View style={s.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[s.dot, i === page && s.dotActive]} />
        ))}
      </View>

      {/* 次へ / はじめる */}
      <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }}>
        <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); next(); }} activeOpacity={0.88} style={s.ctaWrap} accessibilityRole="button" accessibilityLabel={page >= last ? 'はじめる' : '次へ'}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cta}>
            <Text style={s.ctaText}>{page >= last ? 'はじめる' : '次へ'}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingVertical: 8, height: 40 },
  skip: { fontSize: 14, color: '#A78BFA', fontWeight: '600' },

  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconCircle: {
    width: 96, height: 96, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 20, elevation: 10,
  },
  emoji: { fontSize: 30, marginTop: 20 },
  title: { fontSize: 24, fontWeight: '900', color: '#1E0753', textAlign: 'center', marginTop: 10, letterSpacing: -0.4 },
  body: { fontSize: 15, color: '#7C6BA8', textAlign: 'center', lineHeight: 24, marginTop: 14 },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DDD6FE' },
  dotActive: { width: 22, backgroundColor: PURPLE },

  ctaWrap: {
    width: '100%', borderRadius: 18, overflow: 'hidden',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.38, shadowRadius: 20, elevation: 10,
  },
  cta: { height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 18, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
});
