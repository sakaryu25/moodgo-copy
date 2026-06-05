/**
 * AiChatFab.tsx
 * ドラッグ可能なフローティングAIチャットボタン（FAB）
 *
 * - 円形・ピンク→ブルーのグラデーション
 * - 中央に「AI ✨」アイコン、上に「AI相談」ラベル
 * - 指でドラッグして自由移動 → 離すと左右どちらかの端にスナップ
 * - 画面外に出ないよう縦横ともにクランプ
 * - 少しのドラッグではタップ扱いにしない（しきい値判定）
 * - タップで onPress（openAIChatModal）を呼ぶ
 */

import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Sparkles } from 'lucide-react-native';
import React, { useRef } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Design tokens ───
const PINK = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];

const FAB_SIZE = 58;
const MARGIN = 14;          // 画面端からの余白
const TAP_THRESHOLD = 8;    // この距離未満の移動はタップ扱い

type Props = {
  /** タップ時に呼ばれる（OpenAI自由入力モーダルを開く） */
  onPress: () => void;
  /** 下部ナビの高さ（スナップ下限の計算に使用） */
  bottomNavHeight?: number;
};

export default function AiChatFab({ onPress, bottomNavHeight = 80 }: Props) {
  const insets = useSafeAreaInsets();

  // ── 移動可能範囲 ──
  const leftX = MARGIN;
  const rightX = SCREEN_W - FAB_SIZE - MARGIN;
  const topY = insets.top + 64;                               // ヘッダー下
  const bottomY = SCREEN_H - insets.bottom - bottomNavHeight - FAB_SIZE - 8;

  // ── 初期位置（右下） ──
  const startX = rightX;
  const startY = bottomY - 10;

  const pan = useRef(new Animated.ValueXY({ x: startX, y: startY })).current;
  // 現在の絶対座標を保持（リリース時のスナップ計算に使用）
  const posRef = useRef({ x: startX, y: startY });

  // pan の値変化を posRef に同期
  useRef(
    pan.addListener((v) => { posRef.current = v; })
  ).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,

      onPanResponderGrant: () => {
        // 現在地をオフセットに移し、値を0起点にする（標準パターン）
        pan.setOffset({ x: posRef.current.x, y: posRef.current.y });
        pan.setValue({ x: 0, y: 0 });
      },

      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),

      onPanResponderRelease: (_e, g) => {
        pan.flattenOffset();

        const movedDist = Math.hypot(g.dx, g.dy);
        // しきい値未満 → タップ扱い
        if (movedDist < TAP_THRESHOLD) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onPress();
          return;
        }

        // ── スナップ計算 ──
        const cur = posRef.current;
        // 縦はクランプのみ
        const clampedY = Math.min(Math.max(cur.y, topY), bottomY);
        // 横は近い方の端に吸着
        const centerX = cur.x + FAB_SIZE / 2;
        const snapX = centerX < SCREEN_W / 2 ? leftX : rightX;

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.spring(pan, {
          toValue: { x: snapX, y: clampedY },
          useNativeDriver: false,
          friction: 7,
          tension: 90,
        }).start();
      },
    })
  ).current;

  return (
    <Animated.View
      style={[
        styles.wrap,
        { transform: pan.getTranslateTransform() },
      ]}
      {...panResponder.panHandlers}
    >
      {/* ラベル（ボタンと連動して動く） */}
      <View style={styles.labelWrap}>
        <Text style={styles.labelText}>AI相談</Text>
      </View>

      {/* 本体ボタン */}
      <View style={styles.shadow}>
        <LinearGradient
          colors={GRAD}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fab}
        >
          <Sparkles size={18} color="#fff" strokeWidth={2.2} fill="#fff" />
          <Text style={styles.aiText}>AI</Text>
        </LinearGradient>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0, left: 0,
    zIndex: 999,
    alignItems: 'center',
    width: FAB_SIZE,
  },
  labelWrap: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginBottom: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  labelText: { fontSize: 10, fontWeight: '800', color: PURPLE },

  // シャドウ専用ラッパー（overflow:hidden と分離してグロー影を出す）
  shadow: {
    borderRadius: FAB_SIZE / 2,
    backgroundColor: BLUE,        // iOS shadow 描画用（グラデで覆われる）
    shadowColor: PURPLE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 10,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  aiText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.5,
    marginTop: -2,
  },
});
