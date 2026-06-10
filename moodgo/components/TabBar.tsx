// ── TabBar ─────────────────────────────────────────────────────────────────
// Liquid Glass バー: ほぼ素通しのブラー＋指に吸い付くドゥるんブロブ
// タップでも、押しながらスライド→離して選択でも操作できる
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, View } from 'react-native';
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

const ACTIVE   = '#A855F7'; // purple-500
const INACTIVE = '#6E6E73'; // 濃いめグレー（素通しでも見える濃さ）

const PAD_H  = 12; // inner の左右 padding
const BLOB_H = 46; // ガラスブロブの高さ
const N_TABS = 4;

function IconHome({ active }: { active: boolean }) {
  const fill = active ? ACTIVE : INACTIVE;
  return (
    <Svg width={26} height={26} viewBox="0 0 21.5 21.5" fill={fill}>
      <Path fillRule="evenodd" clipRule="evenodd" d="M7.75 16C7.33579 16 7 16.3358 7 16.75C7 17.1642 7.33579 17.5 7.75 17.5H13.75C14.1642 17.5 14.5 17.1642 14.5 16.75C14.5 16.3358 14.1642 16 13.75 16H7.75Z" />
      <Path fillRule="evenodd" clipRule="evenodd" d="M10.75 0C10.0419 0 9.39853 0.20282 8.70055 0.54224C8.02585 0.870345 7.24642 1.35409 6.27286 1.95832L4.20628 3.2409C3.28509 3.81261 2.54744 4.2704 1.9789 4.70581C1.39015 5.15669 0.937948 5.61589 0.61131 6.21263C0.285355 6.80812 0.138567 7.44174 0.06819 8.1907C0 8.91654 0 9.80411 0 10.9172V12.5299C0 14.4337 0 15.9366 0.152703 17.1116C0.309372 18.317 0.638563 19.2901 1.38236 20.0594C2.12958 20.8324 3.08046 21.1777 4.25761 21.3414C5.39849 21.5 6.85556 21.5 8.69185 21.5H12.8081C14.6444 21.5 16.1015 21.5 17.2424 21.3414C18.4195 21.1777 19.3704 20.8324 20.1176 20.0594C20.8614 19.2901 21.1906 18.317 21.3473 17.1116C21.5 15.9366 21.5 14.4338 21.5 12.5299V10.9172C21.5 9.80414 21.5 8.91652 21.4318 8.1907C21.3614 7.44174 21.2146 6.80812 20.8887 6.21263C20.5621 5.61589 20.1099 5.15669 19.5211 4.70581C18.9526 4.2704 18.2149 3.81262 17.2937 3.24091L15.2271 1.95831C14.2536 1.35409 13.4741 0.870342 12.7994 0.54224C12.1015 0.202819 11.4581 0 10.75 0Z" />
    </Svg>
  );
}

function IconHistory({ active }: { active: boolean }) {
  const fill = active ? ACTIVE : INACTIVE;
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill={fill}>
      <Path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8z" />
      <Path d="M12.5 7H11v6l5.2 3.2.8-1.3-4.5-2.7V7z" />
    </Svg>
  );
}

function IconFavorites({ active }: { active: boolean }) {
  const fill = active ? ACTIVE : INACTIVE;
  return (
    <Svg width={26} height={26} viewBox="0 0 21.5 18.7157" fill={fill}>
      <Path fillRule="evenodd" clipRule="evenodd" d="M4.37436 1.88993C2.71537 2.64825 1.5 4.45196 1.5 6.60283C1.5 8.80023 2.39922 10.494 3.68829 11.9455C4.75072 13.1418 6.03684 14.1334 7.29113 15.1003C7.58904 15.33 7.88515 15.5583 8.17605 15.7876C8.70208 16.2023 9.17132 16.5663 9.62361 16.8306C10.0761 17.095 10.4404 17.2157 10.75 17.2157C11.0596 17.2157 11.4239 17.095 11.8764 16.8306C12.3287 16.5663 12.7979 16.2023 13.324 15.7876C13.6149 15.5583 13.911 15.33 14.2089 15.1003C15.4632 14.1334 16.7493 13.1418 17.8117 11.9455C19.1008 10.494 20 8.80023 20 6.60283C20 4.45196 18.7846 2.64825 17.1256 1.88993C15.5139 1.15321 13.3483 1.34831 11.2904 3.48647C11.149 3.63336 10.9539 3.71637 10.75 3.71637C10.5461 3.71637 10.351 3.63336 10.2096 3.48647C8.15166 1.34831 5.98607 1.15321 4.37436 1.88993Z" />
    </Svg>
  );
}

function IconFeatured({ active }: { active: boolean }) {
  const fill = active ? ACTIVE : INACTIVE;
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

const clampIdx = (i: number) => Math.min(N_TABS - 1, Math.max(0, i));

export default function TabBar({ homeView, onChangeView, onReset, insets }: Props) {
  const bottomOffset = Math.max(insets.bottom, 8) + 16;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const tabW  = size.w > 0 ? (size.w - PAD_H * 2) / N_TABS : 0;
  const blobW = Math.min(64, tabW * 0.82);
  const idx   = Math.max(0, TABS.findIndex(t => t.key === homeView));

  // ドラッグ中に指が乗っているタブ（null = ドラッグしていない）
  const [hover, setHover] = useState<number | null>(null);

  const tx = useRef(new Animated.Value(0)).current; // ブロブの横位置
  const sx = useRef(new Animated.Value(1)).current; // ドゥるん用 横伸び
  const sy = useRef(new Animated.Value(1)).current; // ドゥるん用 縦つぶれ
  const ready = useRef(false);

  // PanResponder（1回だけ生成）から最新値を読むための ref 群
  const innerRef  = useRef<View>(null);
  const innerX    = useRef(0);
  const tabWRef   = useRef(0);
  const idxRef    = useRef(idx);
  const hoverRef  = useRef<number | null>(null);
  const movedRef  = useRef(false);
  const skipAnim  = useRef(false); // ドラッグ確定時は useEffect 側のアニメを抑制
  const changeRef = useRef(onChangeView);
  const resetRef  = useRef(onReset);
  tabWRef.current   = tabW;
  idxRef.current    = idx;
  changeRef.current = onChangeView;
  resetRef.current  = onReset;

  // ドゥるん（横にびよーん→ぷるんと戻る）
  const druun = (stretch = 1.4, squash = 0.72) => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(sx, { toValue: stretch, duration: 110, useNativeDriver: true }),
        Animated.timing(sy, { toValue: squash,  duration: 110, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(sx, { toValue: 1, useNativeDriver: true, mass: 1, damping: 7, stiffness: 170 }),
        Animated.spring(sy, { toValue: 1, useNativeDriver: true, mass: 1, damping: 7, stiffness: 170 }),
      ]),
    ]).start();
  };

  useEffect(() => {
    if (tabW <= 0) return;
    const to = idx * tabW;
    if (!ready.current) {
      tx.setValue(to);
      ready.current = true;
      return;
    }
    if (skipAnim.current) {
      // ドラッグ側で着地アニメ済み
      skipAnim.current = false;
      return;
    }
    Animated.spring(tx, {
      toValue: to, useNativeDriver: true, mass: 0.9, damping: 11, stiffness: 140,
    }).start();
    druun();
  }, [idx, tabW]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        movedRef.current = false;
        const fx = e.nativeEvent.pageX - innerX.current;
        hoverRef.current = clampIdx(Math.floor((fx - PAD_H) / tabWRef.current));
        // 掴んだ感: ブロブがむにっと潰れる
        Animated.parallel([
          Animated.spring(sx, { toValue: 1.12, useNativeDriver: true, mass: 0.6, damping: 12, stiffness: 220 }),
          Animated.spring(sy, { toValue: 0.9,  useNativeDriver: true, mass: 0.6, damping: 12, stiffness: 220 }),
        ]).start();
      },
      onPanResponderMove: (e, g) => {
        if (Math.abs(g.dx) > 6) movedRef.current = true;
        if (!movedRef.current) return;
        const w = tabWRef.current;
        if (w <= 0) return;
        const fx = e.nativeEvent.pageX - innerX.current;
        // ブロブ中心が指に吸い付く（端でクランプ）
        const t = Math.min((N_TABS - 1) * w, Math.max(0, fx - PAD_H - w / 2));
        tx.setValue(t);
        const hi = clampIdx(Math.round(t / w));
        if (hi !== hoverRef.current) {
          hoverRef.current = hi;
          setHover(hi);
          Haptics.selectionAsync(); // タブをまたぐたびにカチッ
        } else if (hover === null) {
          setHover(hi);
        }
      },
      onPanResponderRelease: () => {
        const w = tabWRef.current;
        const hi = hoverRef.current ?? idxRef.current;
        const wasDrag = movedRef.current;
        hoverRef.current = null;
        setHover(null);
        if (!wasDrag) {
          // タップ
          if (hi === idxRef.current) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            resetRef.current?.(TABS[hi].key);
            druun(1.2, 0.85); // その場でぷるん
          } else {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            changeRef.current(TABS[hi].key); // 着地アニメは useEffect 側
          }
          return;
        }
        // ドラッグして離した → 指の位置のタブに確定
        if (hi !== idxRef.current) {
          skipAnim.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          changeRef.current(TABS[hi].key);
        }
        Animated.spring(tx, {
          toValue: hi * w, useNativeDriver: true, mass: 0.9, damping: 11, stiffness: 140,
        }).start();
        druun(); // 着地でドゥるん
      },
      onPanResponderTerminate: () => {
        // 中断時は現在のタブへ戻す
        hoverRef.current = null;
        setHover(null);
        Animated.spring(tx, {
          toValue: idxRef.current * tabWRef.current, useNativeDriver: true, mass: 0.9, damping: 11, stiffness: 140,
        }).start();
        druun(1.15, 0.88);
      },
    })
  ).current;

  // アイコンの点灯: ドラッグ中は指の下のタブ、通常時はアクティブタブ
  const litIdx = hover ?? idx;

  return (
    <View style={[s.container, { bottom: bottomOffset }]}>
      <BlurView
        intensity={55}
        tint="light"
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      {/* ごく薄い白（ガラスの曇り） */}
      <View style={s.overlay} />
      <View
        ref={innerRef}
        style={s.inner}
        onLayout={e => {
          setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
          innerRef.current?.measureInWindow((x) => { innerX.current = x; });
        }}
        {...pan.panHandlers}
      >
        {/* 液体ガラスブロブ — タップでも指追従でもドゥるんと動く */}
        {tabW > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              s.blob,
              {
                width: blobW,
                left: PAD_H + (tabW - blobW) / 2,
                top: (size.h - BLOB_H) / 2,
                transform: [{ translateX: tx }, { scaleX: sx }, { scaleY: sy }],
              },
            ]}
          />
        )}
        {TABS.map(({ key, Icon }, i) => (
          <View key={key} style={s.tab} pointerEvents="none">
            <Icon active={i === litIdx} />
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 200,
    borderRadius: 32,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 18,
    elevation: 8,
    borderWidth: 1,
    // ガラスのエッジ（白いハイライト）
    borderColor: 'rgba(255,255,255,0.45)',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // Androidの実ブラーは弱めなので、白をわずかに足して視認性を担保
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.16)',
  },
  inner: {
    flexDirection: 'row',
    paddingVertical: 15,
    paddingHorizontal: PAD_H,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
  },
  blob: {
    position: 'absolute',
    height: BLOB_H,
    borderRadius: BLOB_H / 2,
    backgroundColor: 'rgba(255,255,255,0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
});
