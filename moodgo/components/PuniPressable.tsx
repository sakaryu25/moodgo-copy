// ── PuniPressable ───────────────────────────────────────────────────────────
// 押すと「むにっ」と潰れ、離すと「ぷるん」と弾む共通ボタンラッパー。
// タブバーのブロブや選択肢カードと同じ squash & stretch 系の動き。
// 拡大は1.03までに抑える（それ以上はラスタライズ引き伸ばしで文字が荒れる）
import * as Haptics from 'expo-haptics';
import React, { useRef } from 'react';
import { AccessibilityProps, Animated, Insets, Pressable, StyleProp, ViewStyle } from 'react-native';

type Props = {
  onPress?: () => void;
  disabled?: boolean;
  /** 押した瞬間の軽いハプティクス（既定ON。呼び出し側で鳴らす場合はfalse） */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Pressable自体（当たり判定）のスタイル。alignSelf等のレイアウト指定はこちらに */
  containerStyle?: StyleProp<ViewStyle>;
  hitSlop?: Insets | number;
  children: React.ReactNode;
} & Pick<AccessibilityProps, 'accessible' | 'accessibilityLabel' | 'accessibilityHint' | 'accessibilityRole' | 'accessibilityState'>;

export default function PuniPressable({ onPress, disabled, haptic = true, style, containerStyle, hitSlop, children, ...a11y }: Props) {
  const sx = useRef(new Animated.Value(1)).current;
  const sy = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.parallel([
      Animated.spring(sx, { toValue: 1.03, useNativeDriver: true, mass: 0.6, damping: 14, stiffness: 260 }),
      Animated.spring(sy, { toValue: 0.92, useNativeDriver: true, mass: 0.6, damping: 14, stiffness: 260 }),
    ]).start();
  };
  const pressOut = () => {
    Animated.parallel([
      Animated.spring(sx, { toValue: 1, useNativeDriver: true, mass: 0.7, damping: 9, stiffness: 240 }),
      Animated.spring(sy, { toValue: 1, useNativeDriver: true, mass: 0.7, damping: 9, stiffness: 240 }),
    ]).start();
  };

  const handlePress = () => {
    if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress?.();
  };

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      style={containerStyle}
      {...a11y}
    >
      <Animated.View style={[style, { transform: [{ scaleX: sx }, { scaleY: sy }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
