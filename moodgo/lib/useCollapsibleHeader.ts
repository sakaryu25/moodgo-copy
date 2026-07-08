// ─── スクロールでヘッダー帯を自動格納する共通フック ──────────────────────────
// 下スクロール=ヘッダーが1:1で上に閉じる / 上スクロール=どこからでもすぐ現れる（Twitter型）。
// 仕組み: scrollY(native driver) → diffClamp(0..headerH) → translateY(0..-headerH)。
// ⚠ 使い方の前提:
//   1. ヘッダーは position:absolute の overlay にし、リスト側は contentPaddingTop で逃がす
//   2. スクロール要素は Animated.ScrollView / Animated.FlatList にする（useNativeDriver必須）
//   3. iOSバウンス(負offset)はclamp済み＝バウンス戻りで誤って閉じない
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

export function useCollapsibleHeader(opts?: {
  /** onLayout測定前に使う初期高さ（レイアウト一瞬のズレ防止） */
  initialHeight?: number;
  /** 既存のonScrollロジック（無限スクロール検知等）を続けて呼ぶ */
  listener?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) {
  const scrollY = useRef(new Animated.Value(0)).current;
  const [headerH, setHeaderH] = useState(opts?.initialHeight ?? 0);

  // listenerは毎レンダー再生成されても Animated.event を作り直さない（refで最新を呼ぶ）
  const listenerRef = useRef(opts?.listener);
  listenerRef.current = opts?.listener;

  const h = Math.max(1, headerH);
  const translateY = useMemo(() => {
    // バウンス対策: 負のoffsetを0に丸めてから差分クランプ
    const clamped = Animated.diffClamp(
      scrollY.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' }),
      0, h,
    );
    return clamped.interpolate({ inputRange: [0, h], outputRange: [0, -h], extrapolate: 'clamp' });
  }, [scrollY, h]);

  const onScroll = useMemo(
    () => Animated.event(
      [{ nativeEvent: { contentOffset: { y: scrollY } } }],
      { useNativeDriver: true, listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => listenerRef.current?.(e) },
    ),
    [scrollY],
  );

  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    const measured = Math.round(e.nativeEvent.layout.height);
    if (measured > 0) setHeaderH((prev) => (prev === measured ? prev : measured));
  }, []);

  return { onScroll, onHeaderLayout, translateY, headerH, setHeaderH, scrollY };
}
