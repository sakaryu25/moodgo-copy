// 統計カード: 投稿したスポット / もらったいいね / 行った！された回数 / 訪れた都道府県。
// 白カード・角丸24・極薄シャドウ・パステルアイコン（Apple風）。保存の概念は無い。
import { Footprints, Heart, Image as ImageIcon, MapPin } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MP } from './types';

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

function Cell({ Icon, tint, bg, label, value, unit }: {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  tint: string; bg: string; label: string; value: number; unit: string;
}) {
  return (
    <View style={s.cell}>
      <View style={[s.iconCircle, { backgroundColor: bg }]}>
        <Icon size={17} color={tint} strokeWidth={2.1} />
      </View>
      <Text style={s.cellLabel} numberOfLines={1}>{label}</Text>
      <Text style={s.cellValue}>{fmt(value)}<Text style={s.cellUnit}> {unit}</Text></Text>
    </View>
  );
}

export default function StatsRow({
  posts, likes, visited, prefs,
}: { posts: number; likes: number; visited: number; prefs: number }) {
  return (
    <View style={s.card}>
      <Cell Icon={ImageIcon} tint="#8B6BF2" bg="#F1EBFF" label="投稿したスポット" value={posts} unit="箇所" />
      <View style={s.divider} />
      <Cell Icon={Heart} tint="#F06292" bg="#FDEBF2" label="もらったいいね" value={likes} unit="回" />
      <View style={s.divider} />
      <Cell Icon={Footprints} tint="#F5A623" bg="#FDF3E1" label="行った！された回数" value={visited} unit="回" />
      <View style={s.divider} />
      <Cell Icon={MapPin} tint="#34B27D" bg="#E5F5EE" label="訪れた都道府県" value={prefs} unit="県" />
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'stretch',
    marginHorizontal: MP.SIDE, marginTop: 18,
    backgroundColor: MP.CARD, borderRadius: MP.R, paddingVertical: 18, paddingHorizontal: 6,
    shadowColor: '#111', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.05, shadowRadius: 20, elevation: 2,
  },
  cell: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  cellLabel: { fontSize: 9.5, fontWeight: '600', color: MP.SUB, marginBottom: 3, textAlign: 'center' },
  cellValue: { fontSize: 16, fontWeight: '800', color: MP.INK, letterSpacing: -0.3 },
  cellUnit: { fontSize: 10, fontWeight: '600', color: MP.SUB },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.08)', marginVertical: 6 },
});
