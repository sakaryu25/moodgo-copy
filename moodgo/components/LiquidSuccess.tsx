// LiquidSuccess — 「投稿しました」用の液体サクセスアニメーション（再利用可能）。
//   一滴の液体が落下 → 着地でスカッシュ → 水しぶき → ぷるんと反発 → 真円へ →
//   集光 → チェックがストロークで描かれる → 波紋 → 泡 → 小さく呼吸して終了。
//   Apple / Liquid Glass 風の静かで上品なマイクロインタラクション（紙吹雪・派手演出なし）。
//
// 実装メモ:
//   ・RN Animated（transform/opacity は useNativeDriver:true ＝ 60fps GPU合成）
//   ・チェックの描画のみ react-native-svg の strokeDashoffset（SVG propsはJSドライバ限定）
//   ・スカッシュ(scaleX/Y)とポップ(popScale)は Animated.multiply で合成（相互干渉なし）
//   ・「視差効果を減らす」ON時はアニメーションを省略して完成形を即表示
//   ・親レイアウトへの影響はゼロ（size×size のViewに収まり、はみ出しは overflow で描くだけ）
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// 水しぶき（左右へ6〜8滴・20〜35px・白/水色/紫・50%）— 決定論的な配置（毎回同じ気持ちよさ）
const SPLASH = [
  { dx: -34, dy: -14, r: 7, c: 'rgba(255,255,255,0.9)' },
  { dx: -26, dy: -22, r: 5, c: 'rgba(169,217,255,0.9)' },
  { dx: -21, dy: -4,  r: 6, c: 'rgba(203,183,255,0.9)' },
  { dx: -30, dy:  6,  r: 4, c: 'rgba(255,255,255,0.9)' },
  { dx:  35, dy: -12, r: 7, c: 'rgba(169,217,255,0.9)' },
  { dx:  24, dy: -24, r: 5, c: 'rgba(255,255,255,0.9)' },
  { dx:  28, dy:  4,  r: 6, c: 'rgba(203,183,255,0.9)' },
  { dx:  20, dy: -6,  r: 4, c: 'rgba(169,217,255,0.9)' },
];
// 泡（4〜6個・4〜8px・ゆっくり上へ）
const BUBBLES = [
  { x: -30, y: 14,  r: 5, rise: 26, delay: 520,  dur: 1150 },
  { x:  32, y: 8,   r: 4, rise: 22, delay: 660,  dur: 1250 },
  { x: -18, y: 30,  r: 7, rise: 30, delay: 780,  dur: 1050 },
  { x:  22, y: 26,  r: 6, rise: 24, delay: 900,  dur: 1200 },
  { x:   6, y: 34,  r: 4, rise: 20, delay: 1020, dur: 1000 },
];

export default function LiquidSuccess({
  size = 84,
  colors = ['#F56CB3', '#9B6BFF', '#4FA3FF'],
  style,
  onDone,
}: {
  size?: number;
  colors?: readonly [string, string, string];
  style?: ViewStyle;
  onDone?: () => void;
}) {
  const k = size / 84;                       // 84px基準の倍率（座標・距離を等比スケール）
  const CHECK_LEN = 51 * k;                  // チェックの全長（strokeDash用・実測+余白）
  const DROP_FROM = -size * 2.3;             // 落下開始位置（画面上部から）

  // ── Animated values ──────────────────────────────────────────────────────
  const dropY   = useRef(new Animated.Value(DROP_FROM)).current;  // 落下
  const blobO   = useRef(new Animated.Value(0)).current;          // 本体の出現
  const sqX     = useRef(new Animated.Value(0.92)).current;       // スカッシュ&ストレッチ（落下中は縦長の水滴形）
  const sqY     = useRef(new Animated.Value(1.12)).current;
  const pop     = useRef(new Animated.Value(1)).current;          // チェック完成時のポップ＋最後の呼吸
  const gloss   = useRef(new Animated.Value(0)).current;          // ガラスの光沢
  const glow    = useRef(new Animated.Value(0)).current;          // 集光ドット
  const checkO  = useRef(new Animated.Value(CHECK_LEN)).current;  // strokeDashoffset（JSドライバ）
  const rippleS = useRef(new Animated.Value(1)).current;          // 波紋
  const rippleO = useRef(new Animated.Value(0)).current;
  const splash  = useRef(SPLASH.map(() => new Animated.Value(0))).current;
  const bubbles = useRef(BUBBLES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!alive) return;
      if (reduced) {
        // 視差効果を減らす: 動きを省略して完成形を即表示
        dropY.setValue(0); blobO.setValue(1); sqX.setValue(1); sqY.setValue(1);
        gloss.setValue(1); checkO.setValue(0);
        onDone?.();
        return;
      }

      // 触覚: 着地（軽く）とチェック完成（成功）— Apple的な「手に伝わる」演出
      timers.push(setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 260));
      timers.push(setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 830));

      const N = { useNativeDriver: true } as const;
      Animated.parallel([
        // ── 本体: 落下(0.08-0.25s) → 着地スカッシュ → ぷるん反発(0.38s) → 真円(0.48s) ──
        Animated.sequence([
          Animated.delay(80),
          Animated.parallel([
            Animated.timing(blobO, { toValue: 1, duration: 70, easing: Easing.out(Easing.quad), ...N }),
            Animated.timing(dropY, { toValue: 0, duration: 170, easing: Easing.in(Easing.quad), ...N }),  // 自然な重力
          ]),
          // 着地: 縦に潰れ横に広がる（水風船）
          Animated.parallel([
            Animated.timing(sqX, { toValue: 1.2, duration: 70, easing: Easing.out(Easing.quad), ...N }),
            Animated.timing(sqY, { toValue: 0.7, duration: 70, easing: Easing.out(Easing.quad), ...N }),
          ]),
          Animated.delay(40),
          // ぷるんと反発: 縦へ少し伸びる
          Animated.parallel([
            Animated.timing(sqX, { toValue: 0.95, duration: 95, easing: Easing.out(Easing.quad), ...N }),
            Animated.timing(sqY, { toValue: 1.10, duration: 95, easing: Easing.out(Easing.quad), ...N }),
          ]),
          // 真円へ（弱いelastic・オーバーしすぎない）＋光沢が乗る
          Animated.parallel([
            Animated.spring(sqX, { toValue: 1, friction: 5, tension: 160, ...N }),
            Animated.spring(sqY, { toValue: 1, friction: 5, tension: 160, ...N }),
            Animated.timing(gloss, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), ...N }),
          ]),
        ]),

        // ── 水しぶき(0.30s): 左右へ透明の滴が飛んで消える ──
        Animated.sequence([
          Animated.delay(300),
          Animated.parallel(splash.map((v, i) =>
            Animated.timing(v, { toValue: 1, duration: 400 + i * 22, easing: Easing.out(Easing.quad), ...N }),
          )),
        ]),

        // ── 集光(0.55s): 中央に白い光が一点集まり、チェック描画とともに消える ──
        Animated.sequence([
          Animated.delay(550),
          Animated.timing(glow, { toValue: 1, duration: 150, easing: Easing.out(Easing.quad), ...N }),
          Animated.timing(glow, { toValue: 0, duration: 240, easing: Easing.in(Easing.quad), ...N }),
        ]),

        // ── チェック(0.60s): 手書き風ストローク（SVGはJSドライバ限定）──
        Animated.sequence([
          Animated.delay(600),
          Animated.timing(checkO, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        ]),

        // ── ポップ(0.82s): 105%→100% → 最後に小さく呼吸(98→101→100) ──
        Animated.sequence([
          Animated.delay(820),
          Animated.timing(pop, { toValue: 1.05, duration: 90, easing: Easing.out(Easing.quad), ...N }),
          Animated.spring(pop, { toValue: 1, friction: 5, tension: 220, ...N }),
          Animated.timing(pop, { toValue: 0.98, duration: 80, easing: Easing.inOut(Easing.quad), ...N }),
          Animated.timing(pop, { toValue: 1.01, duration: 60, easing: Easing.inOut(Easing.quad), ...N }),
          Animated.timing(pop, { toValue: 1, duration: 60, easing: Easing.out(Easing.quad), ...N }),
        ]),

        // ── 波紋(0.82s): 透明リングが一つだけ 100%→220% / 40%→0% ──
        Animated.sequence([
          Animated.delay(820),
          Animated.timing(rippleO, { toValue: 0.4, duration: 30, ...N }),
          Animated.parallel([
            Animated.timing(rippleS, { toValue: 2.2, duration: 500, easing: Easing.out(Easing.quad), ...N }),
            Animated.timing(rippleO, { toValue: 0, duration: 500, easing: Easing.out(Easing.quad), ...N }),
          ]),
        ]),

        // ── 泡: 球体の周りから4〜6個だけ、ゆっくり上へ（絶対に派手にしない）──
        ...bubbles.map((v, i) =>
          Animated.sequence([
            Animated.delay(BUBBLES[i].delay),
            Animated.timing(v, { toValue: 1, duration: BUBBLES[i].dur, easing: Easing.out(Easing.quad), ...N }),
          ]),
        ),
      ]).start(() => { if (alive) onDone?.(); });
    });

    return () => { alive = false; timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // スカッシュ×ポップの合成（別々のタイムラインが同じscaleを取り合わないように乗算）
  const scaleX = Animated.multiply(sqX, pop);
  const scaleY = Animated.multiply(sqY, pop);

  // チェックの経路（84基準→等比スケール）: 左下へ → 谷 → 右上へ（手書きの一筆）
  const checkPath = `M ${25 * k} ${44 * k} L ${37.5 * k} ${56.5 * k} L ${60 * k} ${33 * k}`;

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]} pointerEvents="none">
      {/* 波紋（ぼかしはshadowで表現） */}
      <Animated.View
        style={[
          s.ripple,
          { width: size, height: size, borderRadius: size / 2, borderColor: 'rgba(155,107,255,0.55)' },
          { opacity: rippleO, transform: [{ scale: rippleS }] },
        ]}
      />

      {/* 水しぶき（透明50%・白/水色/紫・ぼかし） */}
      {SPLASH.map((d, i) => (
        <Animated.View
          key={`sp${i}`}
          style={[
            s.drop,
            { width: d.r * k, height: d.r * k, borderRadius: (d.r * k) / 2, backgroundColor: d.c, shadowColor: d.c },
            {
              opacity: splash[i].interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.5, 0] }),
              transform: [
                { translateX: splash[i].interpolate({ inputRange: [0, 1], outputRange: [0, d.dx * k] }) },
                { translateY: splash[i].interpolate({ inputRange: [0, 1], outputRange: [0, d.dy * k] }) },
                { scale: splash[i].interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }) },
              ],
            },
          ]}
        />
      ))}

      {/* 泡（ゆっくり上へ・フェードアウト） */}
      {BUBBLES.map((b, i) => (
        <Animated.View
          key={`bb${i}`}
          style={[
            s.bubble,
            { width: b.r * k, height: b.r * k, borderRadius: (b.r * k) / 2 },
            {
              opacity: bubbles[i].interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.45, 0] }),
              transform: [
                { translateX: b.x * k },
                { translateY: bubbles[i].interpolate({ inputRange: [0, 1], outputRange: [b.y * k, (b.y - b.rise) * k] }) },
              ],
            },
          ]}
        />
      ))}

      {/* 本体ブロブ（落下→スカッシュ→ポップは transform 合成・全てGPU） */}
      <Animated.View
        style={{
          width: size, height: size,
          opacity: blobO,
          transform: [{ translateY: dropY }, { scaleX }, { scaleY }],
          shadowColor: colors[1], shadowOffset: { width: 0, height: 8 * k }, shadowOpacity: 0.28, shadowRadius: 16 * k, elevation: 8,
        }}
      >
        <LinearGradient colors={[...colors]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ flex: 1, borderRadius: size / 2, overflow: 'hidden' }}>
          {/* ガラスの光沢: 左上のハイライト＋下部の深み（Liquid Glass） */}
          <Animated.View style={[s.glossTop, {
            top: size * 0.10, left: size * 0.14, width: size * 0.38, height: size * 0.20, borderRadius: size * 0.19,
            opacity: gloss.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }),
          }]} />
          <Animated.View style={[s.glossBottom, {
            bottom: -size * 0.22, left: size * 0.08, width: size * 0.84, height: size * 0.5, borderRadius: size * 0.42,
            opacity: gloss.interpolate({ inputRange: [0, 1], outputRange: [0, 0.18] }),
          }]} />
        </LinearGradient>

        {/* 集光ドット（チェックの起点に光が集まる） */}
        <Animated.View style={[s.glow, {
          width: size * 0.16, height: size * 0.16, borderRadius: size * 0.08,
          left: size / 2 - size * 0.08, top: size / 2 - size * 0.08, opacity: glow,
        }]} />

        {/* チェックマーク（ストローク描画） */}
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <AnimatedPath
            d={checkPath}
            stroke="#fff"
            strokeWidth={5 * k}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={[CHECK_LEN, CHECK_LEN]}
            strokeDashoffset={checkO}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  ripple: { position: 'absolute', borderWidth: 1.5, shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 6 },
  drop: { position: 'absolute', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 3 },
  bubble: { position: 'absolute', backgroundColor: 'rgba(220,236,255,0.9)' },
  glossTop: { position: 'absolute', backgroundColor: '#FFFFFF', transform: [{ rotate: '-22deg' }] },
  glossBottom: { position: 'absolute', backgroundColor: '#FFFFFF' },
  glow: { position: 'absolute', backgroundColor: '#FFFFFF', shadowColor: '#FFFFFF', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 8 },
});
