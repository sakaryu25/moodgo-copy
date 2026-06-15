// ── components/SpotRating.tsx ─────────────────────────────────────────────────
// MoodGo独自の星評価（詳細の総合星の下）。星を選ぶ→「送信」で確定→平均(件数)を表示。
// 一度評価したスポットは端末にキャッシュし、次回以降はGET取得しない（ユーザー要望）。
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Star, Send } from 'lucide-react-native';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

export default function SpotRating({ placeId, placeName, onFirstRate }: { placeId?: string; placeName: string; onFirstRate?: () => void }) {
  const KEY = placeId || placeName;
  const cacheKey = `moodgo-rating-${KEY}`;
  const [selected, setSelected] = useState(0);   // タップ中（送信前）
  const [submitted, setSubmitted] = useState(0); // 確定済みの自分の評価
  const [avg, setAvg] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      // 既に評価済みなら端末キャッシュを使い、サーバー取得しない
      const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
      if (cached) {
        const c = JSON.parse(cached);
        setSubmitted(c.myStars ?? 0); setSelected(c.myStars ?? 0);
        setAvg(c.avg ?? null); setCount(c.count ?? 0);
        return;
      }
      const did = await getDeviceId().catch(() => '');
      const qs = new URLSearchParams();
      if (placeId) qs.set('placeId', placeId);
      if (placeName) qs.set('placeName', placeName);
      if (did) qs.set('deviceId', did);
      const res = await apiFetch(`/api/spot-rating?${qs.toString()}`);
      const d = await res.json();
      if (d?.ok) {
        setSubmitted(d.myStars ?? 0); setSelected(d.myStars ?? 0);
        setAvg(d.avg ?? null); setCount(d.count ?? 0);
        if (d.myStars > 0) await AsyncStorage.setItem(cacheKey, JSON.stringify({ myStars: d.myStars, avg: d.avg, count: d.count })).catch(() => {});
      }
    } catch { /* 取得失敗は未評価表示 */ }
  }, [placeId, placeName, cacheKey]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (busy || selected < 1 || selected === submitted) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const wasFirst = submitted === 0;
    try {
      const did = await getDeviceId();
      const res = await apiFetch('/api/spot-rating', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId, placeName, deviceId: did, stars: selected }),
      });
      const d = await res.json();
      if (d?.ok) {
        setAvg(d.avg ?? null); setCount(d.count ?? 0); setSubmitted(selected);
        await AsyncStorage.setItem(cacheKey, JSON.stringify({ myStars: selected, avg: d.avg, count: d.count })).catch(() => {});
        if (wasFirst) onFirstRate?.();
      }
    } catch { /* 失敗時は据え置き */ } finally { setBusy(false); }
  };

  const canSend = selected >= 1 && selected !== submitted;

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Text style={s.label}>あなたの評価</Text>
        <View style={s.stars}>
          {[1, 2, 3, 4, 5].map(n => (
            <TouchableOpacity key={n} onPress={() => setSelected(n)} hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }} activeOpacity={0.7}>
              <Star size={26} color="#F59E0B" fill={n <= selected ? '#F59E0B' : 'transparent'} strokeWidth={1.8} />
            </TouchableOpacity>
          ))}
        </View>
        {canSend ? (
          <TouchableOpacity style={[s.sendBtn, busy && { opacity: 0.6 }]} onPress={send} disabled={busy} activeOpacity={0.85}>
            <Send size={13} color="#fff" strokeWidth={2.4} />
            <Text style={s.sendText}>{busy ? '送信中' : '送信'}</Text>
          </TouchableOpacity>
        ) : submitted > 0 ? (
          <Text style={s.done}>評価済み</Text>
        ) : null}
      </View>
      {count > 0 && avg != null ? (
        <Text style={s.agg}>MoodGo評価 <Text style={s.aggNum}>{avg.toFixed(1)}</Text>（{count}件）</Text>
      ) : (
        <Text style={s.hint}>星をタップして「送信」で評価</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 2, paddingHorizontal: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  label: { fontSize: 12.5, fontWeight: '800', color: '#7C3AED' },
  stars: { flexDirection: 'row', gap: 3 },
  sendBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#7C3AED', borderRadius: 12, paddingVertical: 5, paddingHorizontal: 11 },
  sendText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  done: { fontSize: 11.5, color: '#16A34A', fontWeight: '800' },
  agg: { fontSize: 12, color: '#9B89BE', fontWeight: '700', marginTop: 5 },
  aggNum: { color: '#7C3AED', fontWeight: '800' },
  hint: { fontSize: 11.5, color: '#B0A2C8', fontWeight: '600', marginTop: 5 },
});
