// ── VoicesSection「みんなの声」───────────────────────────────────────────────
// 場所詳細の口コミ系（評価・みんなのMoodログ・コメント）を1つの見出しに集約する
// ラッパー。先頭に社会的証明のサマリーバー（★評価 / いいね / 行った！等）を任意で出し、
// その下に各セクション(children)を順に並べる。place.tsx と community-spot で共通利用。
import { Footprints, Heart, MessagesSquare, Star } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type VoiceStat = { kind: 'star' | 'heart' | 'foot'; value: string; label: string };

export default function VoicesSection({
  stats, subtitle, children,
}: {
  stats?: VoiceStat[];
  subtitle?: string;
  children: React.ReactNode;
}) {
  const shown = (stats ?? []).filter((st) => st.value !== '' && st.value !== '0');
  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <MessagesSquare size={17} color="#9B6BFF" strokeWidth={2.2} />
        <Text style={s.title}>みんなの声</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      {shown.length > 0 && (
        <View style={s.statBar}>
          {shown.map((st, i) => (
            <React.Fragment key={`${st.kind}-${i}`}>
              {i > 0 && <View style={s.statDivider} />}
              <View style={s.statCell}>
                <View style={s.statValRow}>
                  {st.kind === 'star' && <Star size={13} color="#F59E0B" fill="#F59E0B" strokeWidth={0} />}
                  {st.kind === 'heart' && <Heart size={12} color="#F56CB3" fill="#F56CB3" strokeWidth={0} />}
                  {st.kind === 'foot' && <Footprints size={13} color="#10B981" strokeWidth={2.2} />}
                  <Text style={s.statVal}>{st.value}</Text>
                </View>
                <Text style={s.statLabel} numberOfLines={1}>{st.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

      {children}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 18 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12, paddingHorizontal: 2 },
  title: { fontSize: 16.5, fontWeight: '900', color: '#1A0A2E', letterSpacing: -0.2 },
  subtitle: { fontSize: 12, fontWeight: '600', color: '#9B95AE', flexShrink: 1 },

  statBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 16, paddingVertical: 13, marginBottom: 14,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 1,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 3 },
  statValRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statVal: { fontSize: 16, fontWeight: '800', color: '#1A0A2E', letterSpacing: -0.3 },
  statLabel: { fontSize: 10.5, fontWeight: '600', color: '#8B88A6' },
  statDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: 'rgba(0,0,0,0.09)' },
});
