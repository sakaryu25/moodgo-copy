import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Defs,
  G,
  LinearGradient as SvgGradient,
  Path,
  Stop,
  Text as SvgText,
} from "react-native-svg";

// ─── Design tokens ───────────────────────────────────────────────
const { width: W, height: H } = Dimensions.get("window");

const BG     = "#F3F1EF";   // 背景色
const PINK   = "#F56CB3";
const PURPLE = "#9B6BFF";
const BLUE   = "#4FA3FF";

// ─── BackgroundPattern ───────────────────────────────────────────
// 「太くてぷっくりしたM」を四隅にだけ配置する
// 実装: Mの骨格パスに大きな strokeWidth + round cap/join → チューブ型M

// Mの骨格パス (center 基準)
// strokeWidth を大きく取ることでぷっくりした太いMになる
function mSkeleton(cx: number, cy: number, w: number, h: number): string {
  const x1     = cx - w / 2;       // 左脚 x
  const x2     = cx + w / 2;       // 右脚 x
  const yTop   = cy - h / 2;       // 脚の上端
  const yBot   = cy + h / 2;       // 脚の下端
  const yNotch = yTop + h * 0.46;  // 谷の深さ (0.4〜0.5 で調整)
  return `M ${x1},${yBot} L ${x1},${yTop} L ${cx},${yNotch} L ${x2},${yTop} L ${x2},${yBot}`;
}

type MDef = {
  cx: number; cy: number;
  w: number;  h: number;
  rot: number;
  sw: number; // strokeWidth: Mの太さ
};

// 四隅に1つずつ、散らしすぎない配置
const SHAPES: MDef[] = [
  // 左上: 大きめ・少し画面外
  { cx:  52, cy: 126, w: 130, h: 104, rot: -11, sw: 27 },
  // 右上: やや小さめ
  { cx: W - 48, cy: 96, w: 110, h:  88, rot:  10, sw: 23 },
  // 左下: 大きめ
  { cx:  48, cy: H - 155, w: 124, h:  98, rot:   9, sw: 26 },
  // 右下: 中くらい
  { cx: W - 54, cy: H - 124, w: 116, h:  92, rot:  -9, sw: 24 },
];

// ── 色設定 ──────────────────────────────────────────────────────
// M本体: 背景より少し明るい白（浮き上がって見える）
// 濃くしたい → opacity を上げる / 薄くしたい → 下げる
const M_COLOR  = "rgba(255,255,255,0.58)";   // Mの塗り色
const M_SHADOW = "rgba(148,136,124,0.13)";   // 影（かなり薄め）
const PATTERN_OPACITY = 1.0; // Svg全体の透明度（薄く → 0.7 / 濃く → 1.0）

function BgM({ s }: { s: MDef }) {
  const d = mSkeleton(s.cx, s.cy, s.w, s.h);
  const sharedProps = {
    fill: "none" as const,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <G transform={`rotate(${s.rot}, ${s.cx}, ${s.cy})`}>
      {/* 影レイヤー: +2px 下右にずらして薄くのせる */}
      <Path
        d={mSkeleton(s.cx + 2, s.cy + 2, s.w, s.h)}
        stroke={M_SHADOW}
        strokeWidth={s.sw + 2}
        {...sharedProps}
      />
      {/* 本体: 明るい白系で塗る → エンボス感 */}
      <Path
        d={d}
        stroke={M_COLOR}
        strokeWidth={s.sw}
        {...sharedProps}
      />
    </G>
  );
}

function BackgroundPattern() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={W} height={H} opacity={PATTERN_OPACITY}>
        {SHAPES.map((s, i) => (
          <BgM key={i} s={s} />
        ))}
      </Svg>
    </View>
  );
}

// ─── GradientLogo ────────────────────────────────────────────────
// ロゴサイズ: LOGO_SIZE_RATIO を変えると大きさが変わる
// 0.14 = 小さめ / 0.165 = 標準 / 0.19 = 大きめ
const LOGO_SIZE_RATIO = 0.165;

function GradientLogo() {
  const fontSize = Math.round(W * LOGO_SIZE_RATIO);
  const svgW     = W * 0.88;
  const svgH     = fontSize * 1.5;

  return (
    <Svg width={svgW} height={svgH}>
      <Defs>
        <SvgGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor={PINK}   />
          <Stop offset="48%"  stopColor={PURPLE}  />
          <Stop offset="100%" stopColor={BLUE}   />
        </SvgGradient>
      </Defs>
      <SvgText
        x="50%"
        y={fontSize}
        textAnchor="middle"
        fill="url(#grad)"
        fontSize={fontSize}
        fontWeight="800"
        letterSpacing={-0.5}
      >
        MoodGo
      </SvgText>
    </Svg>
  );
}

// ─── LoadingDots ─────────────────────────────────────────────────
const DOT_COLORS = [PINK, PURPLE, BLUE] as const;
const DOT_SIZE   = 10;
const STEP_MS    = 380;
const BOUNCE_MS  = 210;

function LoadingDots() {
  const anims = useRef(DOT_COLORS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const total = DOT_COLORS.length;
    const loops = anims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * STEP_MS),
          Animated.timing(anim, { toValue: 1, duration: BOUNCE_MS, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: BOUNCE_MS, useNativeDriver: true }),
          Animated.delay((total - 1 - i) * STEP_MS),
        ]),
      ),
    );
    Animated.parallel(loops).start();
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={st.dotsRow}>
      {DOT_COLORS.map((color, i) => {
        const scale   = anims[i].interpolate({ inputRange: [0, 1], outputRange: [1, 1.32] });
        const opacity = anims[i].interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
        return (
          <Animated.View
            key={i}
            style={[st.dot, { backgroundColor: color, transform: [{ scale }], opacity }]}
          />
        );
      })}
    </View>
  );
}

// ─── SplashScreen ────────────────────────────────────────────────
export type SplashScreenProps = {
  onFinish?: () => void;
  duration?: number;
};

export default function SplashScreen({ onFinish, duration = 2400 }: SplashScreenProps) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!onFinish) return;
    const t = setTimeout(onFinish, duration);
    return () => clearTimeout(t);
  }, [onFinish, duration]);

  return (
    <View style={[st.root, { paddingBottom: insets.bottom }]}>
      <BackgroundPattern />
      <View style={st.center}>
        <GradientLogo />
        <View style={st.dotsWrap}>
          <LoadingDots />
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root:     { flex: 1, backgroundColor: BG },
  center:   { flex: 1, alignItems: "center", justifyContent: "center" },
  dotsWrap: { marginTop: 34 },
  dotsRow:  { flexDirection: "row", alignItems: "center", gap: 14 },
  dot:      { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
});
