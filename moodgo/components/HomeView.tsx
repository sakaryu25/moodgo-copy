/**
 * HomeView.tsx
 * スクリーンショット準拠のホーム画面
 * - M文字背景パターン (SplashScreen準拠)
 * - MoodGoグラデーションロゴ
 * - START ボタン
 * - 今月の特集カード (moodgo-home-hero.png)
 * - 今日のおすすめ気分 横スクロール
 */

import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MapPin, Settings } from 'lucide-react-native';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AiChatFab from './AiChatFab';
import CommunityFeed from './CommunityFeed';
import Svg, {
  Defs,
  G,
  LinearGradient as SvgGradient,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

// ─── Design tokens ───────────────────────────────────────────────────────────

const { width: W } = Dimensions.get('window');

const BG     = '#F3F1EF';
const PINK   = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE   = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];

// ─── BackgroundPattern (M-letters) ───────────────────────────────────────────

const { height: H } = Dimensions.get('window');

function mSkeleton(cx: number, cy: number, w: number, h: number): string {
  const x1 = cx - w / 2;
  const x2 = cx + w / 2;
  const yTop = cy - h / 2;
  const yBot = cy + h / 2;
  const yNotch = yTop + h * 0.46;
  return `M ${x1},${yBot} L ${x1},${yTop} L ${cx},${yNotch} L ${x2},${yTop} L ${x2},${yBot}`;
}

type MDef = { cx: number; cy: number; w: number; h: number; rot: number; sw: number };

const SHAPES: MDef[] = [
  { cx: 52,        cy: 126,      w: 130, h: 104, rot: -11, sw: 27 },
  { cx: W - 48,    cy: 96,       w: 110, h: 88,  rot: 10,  sw: 23 },
  { cx: 48,        cy: H - 155,  w: 124, h: 98,  rot: 9,   sw: 26 },
  { cx: W - 54,    cy: H - 124,  w: 116, h: 92,  rot: -9,  sw: 24 },
];

const M_COLOR  = 'rgba(255,255,255,0.58)';
const M_SHADOW = 'rgba(148,136,124,0.13)';

function BgM({ s }: { s: MDef }) {
  const d = mSkeleton(s.cx, s.cy, s.w, s.h);
  const shared = { fill: 'none' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <G transform={`rotate(${s.rot}, ${s.cx}, ${s.cy})`}>
      <Path d={mSkeleton(s.cx + 2, s.cy + 2, s.w, s.h)} stroke={M_SHADOW} strokeWidth={s.sw + 2} {...shared} />
      <Path d={d} stroke={M_COLOR} strokeWidth={s.sw} {...shared} />
    </G>
  );
}

function BackgroundPattern() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={W} height={H}>
        {SHAPES.map((s, i) => <BgM key={i} s={s} />)}
      </Svg>
    </View>
  );
}

// ─── GradientLogo ─────────────────────────────────────────────────────────────

const LOGO_SIZE_RATIO = 0.145;

function GradientLogo() {
  const fontSize = Math.round(W * LOGO_SIZE_RATIO);
  const svgW = W * 0.80;
  const svgH = fontSize * 1.2;
  return (
    <Svg width={svgW} height={svgH}>
      <Defs>
        <SvgGradient id="hgrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor={PINK}   />
          <Stop offset="48%"  stopColor={PURPLE}  />
          <Stop offset="100%" stopColor={BLUE}   />
        </SvgGradient>
      </Defs>
      <SvgText
        x="50%"
        y={fontSize}
        textAnchor="middle"
        fill="url(#hgrad)"
        fontSize={fontSize}
        fontWeight="800"
        letterSpacing={-0.5}
      >
        MoodGo
      </SvgText>
    </Svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  profileAge: string;
  profileGender: string;
  lang: 'ja' | 'en';
  onStart: () => void;
  onStartWithMood?: (moodKey: string) => void;  // （旧）気分ショートカット用・現在未使用
  onShowSettings: () => void;
  onShowFeatured: () => void;
  onOpenAiChat: () => void;  // AI相談を開く（位置情報自動取得）
};

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HomeView({ lang, onStart, onShowSettings, onShowFeatured, onOpenAiChat }: Props) {
  const insets = useSafeAreaInsets();

  // START ボタンのプレスアニメ
  const startScale = useRef(new Animated.Value(1)).current;
  const pressIn  = () => Animated.spring(startScale, { toValue: 0.96, tension: 300, friction: 10, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(startScale, { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }).start();

  // フェードイン
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 160, friction: 22, useNativeDriver: true }),
    ]).start();
  }, []);

  // 穴場ぷるぷるアニメ（大きく・小さく）
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.00, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const handleStart = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onStart();
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      <View style={s.header}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={s.suggestPill}
            activeOpacity={0.78}
            onPress={() => router.push({ pathname: '/suggest', params: { lang } })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MapPin size={13} color={PINK} strokeWidth={2.5} />
              <Text style={s.suggestText}>{lang === 'en' ? 'Share a spot!' : '穴場を教えて！'}</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
        <TouchableOpacity style={s.settingsBtn} onPress={onShowSettings} activeOpacity={0.72}>
          <Settings size={20} color="#888" strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {/* ── Scrollable body ── */}
      <Animated.View style={[s.flex, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <ScrollView
          style={s.flex}
          contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
        >

          {/* ── Hero: logo + tagline ── */}
          <View style={s.hero}>
            <GradientLogo />
            <Text style={s.tagline}>
              {lang === 'en' ? 'Find where to go\nby mood.' : '今の気分から、\n行きたい場所を見つけよう'}
            </Text>
            <Text style={s.heroSub}>
              {lang === 'en'
                ? 'AI suggests the perfect spot for your vibe.'
                : 'AIがあなたの気分にぴったりの場所を提案します'}
            </Text>
          </View>

          {/* ── START button ── */}
          <Animated.View style={[s.startWrap, { transform: [{ scale: startScale }] }]}>
            {/*
              ポイント: iOS では overflow:'hidden' があると shadow が外にはみ出せずクリップされる。
              → 3層に分離する
                1. startShadow  … shadow のみ担当（overflow なし・backgroundColor 必須）
                2. TouchableOpacity … overflow:'hidden' でグラデをクリップ
                3. LinearGradient … 実際のグラデーション
            */}
            <View style={s.startShadow}>
              <TouchableOpacity
                onPress={handleStart}
                onPressIn={pressIn}
                onPressOut={pressOut}
                activeOpacity={1}
                style={s.startTouchable}
              >
                <LinearGradient
                  colors={GRAD}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.startBtn}
                >
                  <Text style={s.startText}>✦  START  →</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* ── Featured card ── */}
          <View style={s.featuredCard}>
            <ImageBackground
              source={require('../assets/images/home-featured.png')}
              style={s.featuredBg}
              imageStyle={{ borderRadius: 20 }}
              resizeMode="cover"
            >
              <LinearGradient
                colors={['rgba(10,8,30,0.18)', 'rgba(10,8,30,0.72)']}
                style={s.featuredOverlay}
              >
                <View style={s.featuredContent}>
                  <Text style={s.featuredLabel}>今月のMoodGo特集 ──</Text>
                  <Text style={s.featuredTitle}>
                    {lang === 'en' ? "Check this month's\nmood picks" : '今月の気分特集を\nチェックしよう'}
                  </Text>
                  <TouchableOpacity
                    style={s.featuredBtn}
                    activeOpacity={0.82}
                    onPress={onShowFeatured}
                  >
                    <Text style={s.featuredBtnText}>
                      {lang === 'en' ? "See what's inside →" : '何があるか見てみる　→'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </LinearGradient>
            </ImageBackground>
          </View>

          {/* ── 区切り ── */}
          <View style={s.feedDivider} />

          {/* ── 全国のみんなの穴場（Masonryタイムライン）── */}
          <CommunityFeed />

        </ScrollView>
      </Animated.View>

      {/* ── ドラッグ可能なAI相談FAB（最前面・絶対配置）── */}
      <AiChatFab onPress={onOpenAiChat} bottomNavHeight={insets.bottom + 18} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const PAD = 20;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: PAD, paddingVertical: 10, zIndex: 10,
  },
  suggestPill: {
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1.5, borderColor: 'rgba(245,108,179,0.35)',
    shadowColor: PINK, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 6, elevation: 3,
  },
  suggestText: { color: PINK, fontSize: 13, fontWeight: '700' },
  settingsBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },

  // Scroll
  scrollContent: { paddingHorizontal: PAD, paddingTop: 2 },

  // Hero（全体を少し上に詰める）
  hero: { alignItems: 'center', paddingTop: 4, paddingBottom: 14, gap: 8 },
  tagline: {
    fontSize: 28, fontWeight: '900', color: '#1A0A2E',
    textAlign: 'center', lineHeight: 38, letterSpacing: -0.6,
  },
  // 要件④: 読みやすさ・信頼感向上 → fontSize 13→15, color #888→#555
  heroSub: {
    fontSize: 15, color: '#555', textAlign: 'center', lineHeight: 22, fontWeight: '500',
  },

  // START（上下の余白を広めにして窮屈さを解消）
  startWrap: { marginTop: 16, marginBottom: 44 },

  // ── シャドウ専用レイヤー ──
  // iOS では shadow + overflow:hidden を同じViewに書けないため分離。
  // backgroundColor: '#fff' はグラデで完全に覆われるため見えない。
  // borderRadius: 99 がそのままピル形の shadow 輪郭になる。
  startShadow: {
    borderRadius: 99,
    backgroundColor: '#ffffff',   // iOS shadow に必須（透明では shadow が出ない）
                                   // ← グラデーションで全面覆われるので見えない
    // ボタンのグラデと同系色（ピンク→パープル）のカラーシャドウ
    shadowColor: '#C060FF',        // パープル寄りのミックス色
    shadowOffset: { width: 0, height: 10 }, // 真下に落とす
    shadowOpacity: 0.42,           // 淡め（濃すぎず、でも存在感あり）
    shadowRadius: 18,              // ふわっと広がるぼかし
    // Android
    elevation: 14,
  },

  // ── overflow:hidden 担当 ── グラデをピル形にクリップするだけ
  startTouchable: {
    borderRadius: 99,
    overflow: 'hidden',
  },

  startBtn: {
    height: 60,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startText: { fontSize: 19, fontWeight: '900', color: '#fff', letterSpacing: 2 },

  // Featured
  // 要件①②: 背景から薄く浮かせる。marginは scrollContent の paddingHorizontal に統一
  featuredCard: {
    borderRadius: 20, overflow: 'hidden', marginBottom: 32,
    // 要件①: 薄くふわっと浮く shadow（backgroundと同化しない程度）
    shadowColor: '#1A0A2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 5,
  },
  featuredBg: { width: '100%', height: 200 },
  featuredOverlay: {
    flex: 1, borderRadius: 20, justifyContent: 'flex-end', padding: 20,
  },
  featuredContent: { gap: 8 },
  featuredLabel: { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: '600', letterSpacing: 0.4 },
  featuredTitle: {
    fontSize: 22, fontWeight: '900', color: '#fff', lineHeight: 30, letterSpacing: -0.3,
  },
  featuredBtn: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 99, paddingHorizontal: 16, paddingVertical: 8, marginTop: 4,
  },
  featuredBtnText: { fontSize: 13, fontWeight: '700', color: '#1A0A2E' },

  // 特集カードと穴場フィードの区切り
  feedDivider: {
    height: 1, backgroundColor: 'rgba(155,107,255,0.10)',
    marginTop: 6, marginBottom: 18,
  },
});
