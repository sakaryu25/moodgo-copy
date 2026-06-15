// ── components/SpotRating.tsx ─────────────────────────────────────────────────
// MoodGo独自の星評価セレクタ（詳細の総合星の下に表示）。ユーザーが1〜5の星をちょこんと付け、
// MoodGo平均（avg/件数）を表示。Google評価から自前評価へ移行する受け皿（POST /api/spot-rating）。
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Star } from 'lucide-react-native';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

export default function SpotRating({ placeId, placeName }: { placeId?: string; placeName: string }) {
  const [myStars, setMyStars] = useState(0);
  const [avg, setAvg] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const did = await getDeviceId().catch(() => '');
      const qs = new URLSearchParams();
      if (placeId) qs.set('placeId', placeId);
      if (placeName) qs.set('placeName', placeName);
      if (did) qs.set('deviceId', did);
      const res = await apiFetch(`/api/spot-rating?${qs.toString()}`);
      const d = await res.json();
      if (d?.ok) { setMyStars(d.myStars ?? 0); setAvg(d.avg ?? null); setCount(d.count ?? 0); }
    } catch { /* 取得失敗は未評価表示 */ }
  }, [placeId, placeName]);

  useEffect(() => { load(); }, [load]);

  const rate = async (stars: number) => {
    if (busy) return;
    setBusy(true);
    const prev = myStars;
    setMyStars(stars);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const did = await getDeviceId();
      const res = await apiFetch('/api/spot-rating', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId, placeName, deviceId: did, stars }),
      });
      const d = await res.json();
      if (d?.ok) { setAvg(d.avg ?? null); setCount(d.count ?? 0); }
      else setMyStars(prev);
    } catch { setMyStars(prev); } finally { setBusy(false); }
  };

  return (
    <View style={s.wrap}>
      <Text style={s.label}>あなたの評価</Text>
      <View style={s.stars}>
        {[1, 2, 3, 4, 5].map(n => (
          <TouchableOpacity key={n} onPress={() => rate(n)} hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }} activeOpacity={0.7}>
            <Star size={26} color="#F59E0B" fill={n <= myStars ? '#F59E0B' : 'transparent'} strokeWidth={1.8} />
          </TouchableOpacity>
        ))}
      </View>
      {count > 0 && avg != null ? (
        <Text style={s.agg}>MoodGo評価 <Text style={s.aggNum}>{avg.toFixed(1)}</Text>（{count}件）</Text>
      ) : (
        <Text style={s.hint}>{myStars > 0 ? 'ありがとう！' : 'タップで評価'}</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 2, paddingHorizontal: 2, flexWrap: 'wrap' },
  label: { fontSize: 12.5, fontWeight: '800', color: '#7C3AED' },
  stars: { flexDirection: 'row', gap: 3 },
  agg: { fontSize: 12, color: '#9B89BE', fontWeight: '700' },
  aggNum: { color: '#7C3AED', fontWeight: '800' },
  hint: { fontSize: 11.5, color: '#B0A2C8', fontWeight: '600' },
});
