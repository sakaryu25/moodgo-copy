/**
 * AppBackground.tsx — 全画面共通背景
 * HomeView と同じ M 字パターン + ベージュ地
 * index.tsx のルートに absolute で敷き、各画面は transparent にする。
 */
import React from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');

export const APP_BG = '#F3F1EF';

// ─── M 字パターン ─────────────────────────────────────────────────────────────

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

// ─── Export ───────────────────────────────────────────────────────────────────

export default function AppBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={W} height={H}>
        {SHAPES.map((s, i) => <BgM key={i} s={s} />)}
      </Svg>
    </View>
  );
}
