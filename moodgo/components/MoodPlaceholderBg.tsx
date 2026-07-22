// ── 写真ゼロ時の「装飾プレースホルダー」カード ───────────────────────────────
// 気分/ジャンル別の映えグラデ＋ボケ玉(bokeh)風のあしらい＋lucideアイコン＋ラベルチップ。
// ⚠実在店の偽写真は作らない（誠実）。あくまで“飾り”。写真投稿CTAを兼ねる。
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';
import { Sparkles, Cake, Coffee, Moon, Shirt, Flame, Trees, Utensils, ShoppingBag, BookOpen, Waves, Mountain, Camera } from 'lucide-react-native';
import { moodPlaceholder, PhIcon } from '@/lib/moodPlaceholder';

const ICONS: Record<PhIcon, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  sparkles: Sparkles, cake: Cake, coffee: Coffee, moon: Moon, shirt: Shirt, flame: Flame,
  trees: Trees, utensils: Utensils, shopping: ShoppingBag, book: BookOpen, waves: Waves, mountain: Mountain,
};

const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];

// seedから決定的な散布ボケ玉（チラつかない）
function bokeh(seed: number, w: number, h: number) {
  const out: { cx: number; cy: number; r: number; o: number }[] = [];
  let s = seed || 1;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const n = 9;
  for (let i = 0; i < n; i++) {
    out.push({ cx: rnd() * w, cy: rnd() * h, r: 8 + rnd() * (Math.min(w, h) * 0.18), o: 0.05 + rnd() * 0.07 });
  }
  return out;
}

type Props = {
  tags?: string[];
  seed: string;
  width: number;
  height: number;
  compact?: boolean;
  placement?: 'lead' | 'tail';
  uploading?: boolean;
  onAddPhoto: () => void;
};

export default function MoodPlaceholderBg({ tags, seed, width, height, compact, placement = 'lead', uploading, onAddPhoto }: Props) {
  const ph = useMemo(() => moodPlaceholder(tags, seed), [tags, seed]);
  const dots = useMemo(() => bokeh((ph.patternIdx + 1) * 2654435761 ^ seed.length, Math.max(width, 1), height), [ph.patternIdx, seed, width, height]);
  const Icon = ICONS[ph.icon] ?? Sparkles;
  const ink = ph.dark ? '#FFFFFF' : '#2E2140';
  const sub = ph.dark ? 'rgba(255,255,255,0.82)' : 'rgba(46,33,64,0.62)';
  const chipBg = ph.dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.62)';
  const dotColor = ph.dark ? '#FFFFFF' : '#FFFFFF';

  return (
    <View style={[width > 0 ? { width, height } : { width: '100%', height }, s.wrap]}>
      <LinearGradient colors={ph.colors} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      {width > 0 ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          {dots.map((d, i) => <Circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill={dotColor} opacity={d.o} />)}
        </Svg>
      ) : null}

      <View style={s.center}>
        <View style={[s.chip, { backgroundColor: chipBg }]}>
          <Icon size={compact ? 15 : 17} color={ink} strokeWidth={2} />
          <Text style={[s.chipText, { color: ink }]}>{ph.label}</Text>
        </View>
        <Text style={[s.title, { color: ink }]}>{placement === 'lead' ? '一番乗りで1枚どうぞ' : 'あなたの1枚も、この場所に'}</Text>
        {!compact ? (
          <Text style={[s.sub, { color: sub }]}>{placement === 'lead' ? 'あなたの写真が、この場所の顔になります' : '違う角度・季節・時間帯の写真が魅力を伝えます'}</Text>
        ) : null}
        <TouchableOpacity onPress={onAddPhoto} disabled={uploading} activeOpacity={0.85} style={s.btn}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btnGrad}>
            {uploading ? <ActivityIndicator color="#fff" size="small" /> : <><Camera size={13} color="#fff" strokeWidth={2.3} /><Text style={s.btnText}>写真を追加</Text></>}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginBottom: 10 },
  chipText: { fontSize: 12.5, fontWeight: '800' },
  title: { fontSize: 14, fontWeight: '800', textAlign: 'center' },
  sub: { fontSize: 11.5, fontWeight: '600', textAlign: 'center', marginTop: 4, lineHeight: 16, maxWidth: 260 },
  btn: { marginTop: 12, borderRadius: 999, overflow: 'hidden' },
  btnGrad: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  btnText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
});
