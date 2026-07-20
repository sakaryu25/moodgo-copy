// ─── スクロールでヘッダー帯を自動格納する共通フック ──────────────────────────
// 下スクロール=ヘッダーが上へ格納 / 上スクロール=すぐ現れる / 最上部=常に表示（Instagram型）。
// ⚠2026-07-21 変更: 旧実装は diffClamp を translateY にそのまま補間していたため、スクロールを
//   途中で止めると translateY が 0〜-h の中間値で静止し「ヘッダー帯が上だけ少し出る」中途半端な
//   状態になっていた。→ スクロール“方向”で 0(表示) か -h(格納) の二択にスナップするモデルへ変更し
//   中間停止を根絶。scrollY は従来どおり native driver で公開（バナー等のパララックスで利用）。
// 使い方の前提（不変）:
//   1. ヘッダーは position:absolute の overlay にし、リスト側は contentPaddingTop で逃がす
//   2. スクロール要素は Animated.ScrollView / Animated.FlatList にする（useNativeDriver必須）
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
  const scrollY = useRef(new Animated.Value(0)).current;   // native driver（パララックス用に公開）
  const [headerH, setHeaderH] = useState(opts?.initialHeight ?? 0);

  const listenerRef = useRef(opts?.listener);
  listenerRef.current = opts?.listener;

  // ヘッダー格納用の transform（0=全表示 / -h=全格納）。中間値には静止させない＝スナップのみ。
  const headerTranslate = useRef(new Animated.Value(0)).current;
  const hRef = useRef(Math.max(1, headerH));
  hRef.current = Math.max(1, headerH);
  const shownRef = useRef(true);
  const lastYRef = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const snapTo = useCallback((toValue: number) => {
    animRef.current?.stop();
    const a = Animated.timing(headerTranslate, { toValue, duration: 200, useNativeDriver: true });
    animRef.current = a;
    a.start();
  }, [headerTranslate]);

  // スクロール方向で表示/格納をスナップ。指を離した位置で中途半端に止まらない。
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastYRef.current;
    lastYRef.current = y;
    const h = hRef.current;
    if (y <= 4) {
      if (!shownRef.current) { shownRef.current = true; snapTo(0); }          // 最上部は常に全表示
    } else if (dy > 6 && shownRef.current) {
      shownRef.current = false; snapTo(-h);                                    // 下スクロール→全格納
    } else if (dy < -6 && !shownRef.current) {
      shownRef.current = true; snapTo(0);                                      // 上スクロール→全表示
    }
    listenerRef.current?.(e);
  }, [snapTo]);

  const onScroll = useMemo(
    () => Animated.event(
      [{ nativeEvent: { contentOffset: { y: scrollY } } }],
      { useNativeDriver: true, listener: handleScroll },
    ),
    [scrollY, handleScroll],
  );

  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => {
    const measured = Math.round(e.nativeEvent.layout.height);
    if (measured > 0) setHeaderH((prev) => (prev === measured ? prev : measured));
  }, []);

  return { onScroll, onHeaderLayout, translateY: headerTranslate, headerH, setHeaderH, scrollY };
}
