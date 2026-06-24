// ── GlassSurface ───────────────────────────────────────────────────────────
// iOS 26 の本物の Liquid Glass（expo-glass-effect の GlassView）を使い、
// 非対応端末（iOS25以下 / Android）では従来の expo-blur すりガラスにフォールバックする
// 共通ラッパー。MoodGo の各サーフェス（TabBar / AIボタン / chip / カード等）で使う。
import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  type GlassStyle,
} from 'expo-glass-effect';
import React from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

// 本物の Liquid Glass が使えるか（iOS26+ かつ API 利用可能）。
//   一部 iOS26 beta は API 未実装でクラッシュするため isGlassEffectAPIAvailable で二重ガード。
export const LIQUID_GLASS: boolean = (() => {
  if (Platform.OS !== 'ios') return false;
  try {
    return isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

type Props = ViewProps & {
  /** ガラスの質感。regular=曇りガラス（既定）, clear=より透明 */
  glassStyle?: GlassStyle;
  /** ガラスに薄く乗せる色（ブランドのvioletを微量に等） */
  tint?: string;
  /** 指に反応してにじむインタラクティブガラス（ボタン/タブ向け） */
  interactive?: boolean;
  // ── フォールバック（blur）用 ──
  blurIntensity?: number;
  blurTint?: 'light' | 'dark' | 'default';
  /** blur に重ねる曇り（ガラスの白み）。null で無し */
  fallbackOverlay?: string | null;
};

/**
 * 角丸は呼び出し側の style で borderRadius を指定し、overflow:'hidden' を付けること。
 * 子要素はガラスの上にそのまま乗る。
 */
export default function GlassSurface({
  glassStyle = 'regular',
  tint,
  interactive = false,
  blurIntensity = 55,
  blurTint = 'light',
  fallbackOverlay = 'rgba(255,255,255,0.5)',
  style,
  children,
  ...rest
}: Props) {
  if (LIQUID_GLASS) {
    return (
      <GlassView
        glassEffectStyle={glassStyle}
        tintColor={tint}
        isInteractive={interactive}
        style={style}
        {...rest}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View style={style} {...rest}>
      <BlurView
        intensity={blurIntensity}
        tint={blurTint}
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      {fallbackOverlay ? (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: fallbackOverlay }]} />
      ) : null}
      {children}
    </View>
  );
}
