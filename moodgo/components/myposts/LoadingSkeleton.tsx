// スケルトンUI: 追加読み込み/初期ロード時に2カラムのグレーカードを脈動表示。
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '@/lib/settingsStore';
import { MP } from './types';

const T = {
  ja: { loadingMore: 'さらに読み込み中…' },
  en: { loadingMore: 'Loading more…' },
} as const;

export default function LoadingSkeleton({ label }: { label?: string }) {
  const { lang } = useSettings();
  // label 未指定時は言語別の既定（「さらに読み込み中…」）を表示
  const shownLabel = label ?? T[lang].loadingMore;
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 620, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View>
      <View style={s.row}>
        <Animated.View style={[s.block, { opacity: pulse, aspectRatio: 0.9 }]} />
        <Animated.View style={[s.block, { opacity: pulse, aspectRatio: 1.15 }]} />
      </View>
      <Text style={s.label}>{shownLabel}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: MP.GAP },
  block: { flex: 1, borderRadius: MP.R, backgroundColor: '#E9E7EF' },
  label: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: MP.SUB, marginTop: 12 },
});
