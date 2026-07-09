// ── components/SpotRating.tsx ─────────────────────────────────────────────────
// MoodGo独自の星評価（詳細の総合星の下）。星を選ぶ→「送信」で確定→平均(件数)を表示。
// 一度評価したスポットは端末にキャッシュし、次回以降はGET取得しない（ユーザー要望）。
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Star, Send } from 'lucide-react-native';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { useSettings } from '@/lib/settingsStore';

const T = {
  ja: {
    yourRating: 'あなたの評価',
    send: '送信',
    sending: '送信中',
    rated: '評価済み',
    moodgoRating: 'MoodGo評価',
    count: (n: number) => `（${n}件）`,
    hint: '星をタップして「送信」で評価',
  },
  en: {
    yourRating: 'Your rating',
    send: 'Send',
    sending: 'Sending…',
    rated: 'Rated',
    moodgoRating: 'MoodGo rating',
    count: (n: number) => `(${n})`,
    hint: 'Tap the stars, then Send to rate',
  },
} as const;

export default function SpotRating({ placeId, placeName, mood, companion, subCategory, onFirstRate, onAvg, hideAggregate }: { placeId?: string; placeName: string; mood?: string; companion?: string; subCategory?: string; onFirstRate?: () => void; onAvg?: (avg: number | null, count: number) => void; hideAggregate?: boolean }) {
  const { lang } = useSettings();
  const t = T[lang];
  const KEY = placeId || placeName;
  const cacheKey = `moodgo-rating-${KEY}`;
  // 総合評価(平均)を親(投稿詳細のバー等)へ通知する。inline関数でも load を作り直さないよう ref 経由。
  const onAvgRef = useRef(onAvg); onAvgRef.current = onAvg;
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
        // onAvgは呼ばない（キャッシュは古い可能性＝バーは親がライブ取得する。送信時のみ通知）
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const prevSubmitted = submitted;
    const wasFirst = submitted === 0;
    setSubmitted(selected);   // 楽観的: 押した瞬間に「評価済み」表示（失敗時はロールバック）
    setBusy(true);
    try {
      const did = await getDeviceId();
      const res = await apiFetch('/api/spot-rating', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId, placeName, deviceId: did, stars: selected }),
      });
      const d = await res.json();
      if (d?.ok) {
        setAvg(d.avg ?? null); setCount(d.count ?? 0);   // submitted は楽観的に設定済み
        onAvgRef.current?.(d.avg ?? null, d.count ?? 0);
        await AsyncStorage.setItem(cacheKey, JSON.stringify({ myStars: selected, avg: d.avg, count: d.count })).catch(() => {});
        if (wasFirst) onFirstRate?.();
        // 旧「気分に合う/合わない」の学習を★評価へ移管: ★4-5=good / ★1-2=bad を気分別評価に送る。
        //   検索文脈の気分がある時のみ（履歴/いいね閲覧など気分なしの時は表示用の★だけ）。
        if (mood) {
          const verdict = selected >= 4 ? 'good' : selected <= 2 ? 'bad' : null;
          if (verdict) {
            apiFetch('/api/mood-rating', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ place_name: placeName, mood, sub_category: subCategory || undefined, verdict }),
            }).catch(() => {});
            apiFetch('/api/feedback', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mood, companion: companion || undefined, rating: selected, visitedPlace: placeName, likedPlaces: verdict === 'good' ? [placeName] : [] }),
            }).catch(() => {});
          }
        }
      } else { setSubmitted(prevSubmitted); }   // 失敗はロールバック
    } catch { setSubmitted(prevSubmitted); } finally { setBusy(false); }
  };

  const canSend = selected >= 1 && selected !== submitted;

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        <Text style={s.label}>{t.yourRating}</Text>
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
            <Text style={s.sendText}>{busy ? t.sending : t.send}</Text>
          </TouchableOpacity>
        ) : submitted > 0 ? (
          <Text style={s.done}>{t.rated}</Text>
        ) : null}
      </View>
      {!hideAggregate && count > 0 && avg != null ? (
        <Text style={s.agg}>{t.moodgoRating} <Text style={s.aggNum}>{avg.toFixed(1)}</Text>{t.count(count)}</Text>
      ) : submitted === 0 ? (
        <Text style={s.hint}>{t.hint}</Text>
      ) : null}
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
