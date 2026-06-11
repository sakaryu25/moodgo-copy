// ── TabBar ─────────────────────────────────────────────────────────────────
// Instagram風フローティングタブバー（ライト/ホワイトベース）:
//   ・画面下に浮かぶ白いガラス調の角丸ピル型バー（画面幅に合わせた大きめサイズ）
//   ・選択タブの背後に白いピル。タブ切替時はスプリングでスライド移動
//   ・指でバーを左右にドラッグするとピルが指に追従し、離すと最寄りタブに吸着
//   ・アイコンは選択時に濃色＋少しスケールアップ、非選択時はグレー
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { EdgeInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

type Tab = 'home' | 'history' | 'favorites' | 'featured';

type Props = {
  homeView: Tab;
  onChangeView: (v: Tab) => void;
  onReset?: (v: Tab) => void;
  insets: EdgeInsets;
  lang?: 'ja' | 'en';
};

// ── レイアウト定数（画面幅基準で大きめに）──────────────────────────────────────
const SCREEN_W = Dimensions.get('window').width;
const H_MARGIN = 16;                       // 画面端からの余白
const BAR_W = SCREEN_W - H_MARGIN * 2;     // バー全体の幅（ほぼ全幅）
const BAR_PAD = 7;                         // バー内側の余白
const BAR_H = 68;                          // バーの高さ（Instagram比率に近く）
const TAB_COUNT = 4;
const TAB_W = (BAR_W - BAR_PAD * 2) / TAB_COUNT; // 1タブ分の幅
const PILL_W = TAB_W - 4;                  // インジケーター（ピル）の幅
const PILL_H = BAR_H - BAR_PAD * 2;
const MAX_X = (TAB_COUNT - 1) * TAB_W;     // ピル移動量の上限

// ── 配色（ホワイトベースのグラスモーフィズム）─────────────────────────────────
const ACTIVE_ICON = '#1C1C1E';
const INACTIVE_ICON = 'rgba(28,28,30,0.42)';
const BAR_BG = 'rgba(255,255,255,0.72)';   // 白いガラス下地
const PILL_BG = 'rgba(255,255,255,0.95)';  // 白いピル

// スプリング設定（バネ感のある自然な追従）
const SPRING = { useNativeDriver: true, mass: 0.9, damping: 16, stiffness: 180 } as const;

const A11Y_LABELS: Record<'ja' | 'en', Record<Tab, string>> = {
  ja: { home: 'ホーム', history: '履歴', favorites: 'お気に入り', featured: '特集' },
  en: { home: 'Home', history: 'History', favorites: 'Favorites', featured: 'Featured' },
};

// ── アイコン（既存のMoodGo SVGパスを単色で使用）──────────────────────────────
function IconHome({ active }: { active: boolean }) {
  const fill = active ? ACTIVE_ICON : INACTIVE_ICON;
  return (
    <Svg width={26} height={26} viewBox="0 0 21.5 21.5" fill={fill}>
      <Path fillRule="evenodd" clipRule="evenodd" d="M7.75 16C7.33579 16 7 16.3358 7 16.75C7 17.1642 7.33579 17.5 7.75 17.5H13.75C14.1642 17.5 14.5 17.1642 14.5 16.75C14.5 16.3358 14.1642 16 13.75 16H7.75Z" />
      <Path fillRule="evenodd" clipRule="evenodd" d="M10.75 0C10.0419 0 9.39853 0.20282 8.70055 0.54224C8.02585 0.870345 7.24642 1.35409 6.27286 1.95832L4.20628 3.2409C3.28509 3.81261 2.54744 4.2704 1.9789 4.70581C1.39015 5.15669 0.937948 5.61589 0.61131 6.21263C0.285355 6.80812 0.138567 7.44174 0.06819 8.1907C0 8.91654 0 9.80411 0 10.9172V12.5299C0 14.4337 0 15.9366 0.152703 17.1116C0.309372 18.317 0.638563 19.2901 1.38236 20.0594C2.12958 20.8324 3.08046 21.1777 4.25761 21.3414C5.39849 21.5 6.85556 21.5 8.69185 21.5H12.8081C14.6444 21.5 16.1015 21.5 17.2424 21.3414C18.4195 21.1777 19.3704 20.8324 20.1176 20.0594C20.8614 19.2901 21.1906 18.317 21.3473 17.1116C21.5 15.9366 21.5 14.4338 21.5 12.5299V10.9172C21.5 9.80414 21.5 8.91652 21.4318 8.1907C21.3614 7.44174 21.2146 6.80812 20.8887 6.21263C20.5621 5.61589 20.1099 5.15669 19.5211 4.70581C18.9526 4.2704 18.2149 3.81262 17.2937 3.24091L15.2271 1.95831C14.2536 1.35409 13.4741 0.870342 12.7994 0.54224C12.1015 0.202819 11.4581 0 10.75 0Z" />
    </Svg>
  );
}

function IconHistory({ active }: { active: boolean }) {
  const fill = active ? ACTIVE_ICON : INACTIVE_ICON;
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill={fill}>
      <Path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8z" />
      <Path d="M12.5 7H11v6l5.2 3.2.8-1.3-4.5-2.7V7z" />
    </Svg>
  );
}

function IconFavorites({ active }: { active: boolean }) {
  const fill = active ? ACTIVE_ICON : INACTIVE_ICON;
  return (
    <Svg width={26} height={26} viewBox="0 0 21.5 18.7157" fill={fill}>
      <Path fillRule="evenodd" clipRule="evenodd" d="M4.37436 1.88993C2.71537 2.64825 1.5 4.45196 1.5 6.60283C1.5 8.80023 2.39922 10.494 3.68829 11.9455C4.75072 13.1418 6.03684 14.1334 7.29113 15.1003C7.58904 15.33 7.88515 15.5583 8.17605 15.7876C8.70208 16.2023 9.17132 16.5663 9.62361 16.8306C10.0761 17.095 10.4404 17.2157 10.75 17.2157C11.0596 17.2157 11.4239 17.095 11.8764 16.8306C12.3287 16.5663 12.7979 16.2023 13.324 15.7876C13.6149 15.5583 13.911 15.33 14.2089 15.1003C15.4632 14.1334 16.7493 13.1418 17.8117 11.9455C19.1008 10.494 20 8.80023 20 6.60283C20 4.45196 18.7846 2.64825 17.1256 1.88993C15.5139 1.15321 13.3483 1.34831 11.2904 3.48647C11.149 3.63336 10.9539 3.71637 10.75 3.71637C10.5461 3.71637 10.351 3.63336 10.2096 3.48647C8.15166 1.34831 5.98607 1.15321 4.37436 1.88993Z" />
    </Svg>
  );
}

function IconFeatured({ active }: { active: boolean }) {
  const fill = active ? ACTIVE_ICON : INACTIVE_ICON;
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill={fill}>
      <Path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </Svg>
  );
}

const TABS: { key: Tab; Icon: React.ComponentType<{ active: boolean }> }[] = [
  { key: 'home',      Icon: IconHome },
  { key: 'history',   Icon: IconHistory },
  { key: 'favorites', Icon: IconFavorites },
  { key: 'featured',  Icon: IconFeatured },
];

// ── タブ1個分（アイコンのスケール＆押下フィードバック）───────────────────────
function TabItem({
  active, Icon, label, onPress, onReset,
}: {
  active: boolean;
  Icon: React.ComponentType<{ active: boolean }>;
  label: string;
  onPress: () => void;
  onReset?: () => void;
}) {
  const scale = useRef(new Animated.Value(active ? 1.08 : 1)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: active ? 1.08 : 1, ...SPRING }).start();
  }, [active]);

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.85, duration: 70, useNativeDriver: true }),
      Animated.spring(scale, { toValue: active ? 1.08 : 1, ...SPRING }),
    ]).start();
    if (active) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onReset?.();
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={s.tab}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      hitSlop={4}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon active={active} />
      </Animated.View>
    </Pressable>
  );
}

export default function TabBar({ homeView, onChangeView, onReset, insets, lang = 'ja' }: Props) {
  const labels = A11Y_LABELS[lang];
  const activeIndex = Math.max(0, TABS.findIndex(t => t.key === homeView));

  // ドラッグ中のハイライト用（指の位置に最も近いタブを即時反映）
  const [visualIndex, setVisualIndex] = useState(activeIndex);

  // インジケーター（ピル）のX位置
  const indicatorX = useRef(new Animated.Value(activeIndex * TAB_W)).current;
  const isDragging = useRef(false);
  const dragStartX = useRef(activeIndex * TAB_W);
  const lastTickIndex = useRef(activeIndex);

  // 外部からの homeView 変更（タップ・リセット含む）に追従
  useEffect(() => {
    setVisualIndex(activeIndex);
    if (!isDragging.current) {
      Animated.spring(indicatorX, { toValue: activeIndex * TAB_W, ...SPRING }).start();
    }
  }, [activeIndex]);

  // ── 指でのスライド（ドラッグ）対応 ──────────────────────────────────────────
  // 横に8px以上動いたらドラッグと判定（タップはPressable側で処理される）
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        isDragging.current = true;
        dragStartX.current = lastTickIndex.current * TAB_W;
        indicatorX.stopAnimation((v: number) => { dragStartX.current = v; });
      },
      onPanResponderMove: (_e, g) => {
        // ピルを指に追従させる（バーの範囲内にクランプ）
        const x = Math.min(Math.max(dragStartX.current + g.dx, 0), MAX_X);
        indicatorX.setValue(x);
        // 最寄りタブをハイライト＋境界をまたいだら軽いハプティクス
        const idx = Math.min(Math.max(Math.round(x / TAB_W), 0), TAB_COUNT - 1);
        if (idx !== lastTickIndex.current) {
          lastTickIndex.current = idx;
          setVisualIndex(idx);
          Haptics.selectionAsync();
        }
      },
      onPanResponderRelease: (_e, g) => {
        const x = Math.min(Math.max(dragStartX.current + g.dx, 0), MAX_X);
        const idx = Math.min(Math.max(Math.round(x / TAB_W), 0), TAB_COUNT - 1);
        isDragging.current = false;
        // 最寄りタブへスプリングで吸着
        Animated.spring(indicatorX, { toValue: idx * TAB_W, ...SPRING }).start();
        setVisualIndex(idx);
        lastTickIndex.current = idx;
        const tab = TABS[idx].key;
        if (tab !== homeView) onChangeView(tab);
      },
      onPanResponderTerminate: () => {
        // ジェスチャー中断時は現在のタブ位置に戻す
        isDragging.current = false;
        Animated.spring(indicatorX, { toValue: activeIndex * TAB_W, ...SPRING }).start();
        setVisualIndex(activeIndex);
        lastTickIndex.current = activeIndex;
      },
    })
  ).current;

  // lastTickIndex をタップ切替にも同期
  useEffect(() => { lastTickIndex.current = activeIndex; }, [activeIndex]);

  return (
    <View
      style={[s.root, { bottom: Math.max(insets.bottom, 12) + 4 }]}
      pointerEvents="box-none"
    >
      <View style={s.shadowWrap}>
        <BlurView intensity={45} tint="light" style={s.blur}>
          {/* 白いガラス下地 */}
          <View style={s.lightOverlay} />

          <View style={s.row} {...panResponder.panHandlers}>
            {/* スライドする白いピル（アイコンの背後） */}
            <Animated.View
              pointerEvents="none"
              style={[s.indicator, { transform: [{ translateX: indicatorX }] }]}
            />

            {TABS.map(({ key, Icon }, i) => (
              <TabItem
                key={key}
                active={visualIndex === i}
                Icon={Icon}
                label={labels[key]}
                onPress={() => onChangeView(key)}
                onReset={() => onReset?.(key)}
              />
            ))}
          </View>
        </BlurView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 200,
    alignItems: 'center',
  },
  // 影はBlurの外側に（iOSでoverflow:hiddenと影が両立しないため）
  shadowWrap: {
    borderRadius: BAR_H / 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 10,
  },
  blur: {
    width: BAR_W,
    borderRadius: BAR_H / 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  lightOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: BAR_BG,
  },
  row: {
    height: BAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: BAR_PAD,
  },
  tab: {
    width: TAB_W,
    height: BAR_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    left: BAR_PAD + (TAB_W - PILL_W) / 2,
    width: PILL_W,
    height: PILL_H,
    borderRadius: PILL_H / 2,
    backgroundColor: PILL_BG,
    // ピル自体にもうっすら影（白地に白ピルでも浮き上がって見えるように）
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 6,
    elevation: 3,
  },
});
