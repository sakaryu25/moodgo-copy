/**
 * MoodBookSkeleton — 見開きBOOKの形をしたローディングスケルトン
 * 読み込み後に高さが大きく動かないよう、実物と同じ紙＋2ページ構成で高さを確保する。
 * パルスは既存 myposts/LoadingSkeleton と同じ 620ms の opacity ループ。
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { PAPER, PAPER_LINE } from './shared';

function PageBones() {
  return (
    <View style={s.page}>
      <View style={[s.bone, { width: 44, height: 9 }]} />
      <View style={[s.bone, { width: '72%', height: 13, marginTop: 7 }]} />
      <View style={[s.bone, s.photo]} />
      <View style={s.subRow}>
        <View style={[s.bone, s.sub]} />
        <View style={[s.bone, s.sub]} />
      </View>
      <View style={[s.bone, { width: '92%', height: 8, marginTop: 9 }]} />
      <View style={[s.bone, { width: '64%', height: 8, marginTop: 5 }]} />
    </View>
  );
}

export default function MoodBookSkeleton() {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 620, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.5, duration: 620, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={[s.book, { opacity: pulse }]}>
      <PageBones />
      <View style={s.spine} />
      <PageBones />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  book: {
    flexDirection: 'row', borderRadius: 16, backgroundColor: PAPER,
    borderWidth: 1, borderColor: 'rgba(90,90,120,0.07)', overflow: 'hidden',
  },
  spine: { width: StyleSheet.hairlineWidth, backgroundColor: PAPER_LINE },
  page: { flex: 1, padding: 13 },
  bone: { borderRadius: 6, backgroundColor: '#E9E5DA' },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 10, marginTop: 9 },
  subRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  sub: { flex: 1, aspectRatio: 1.5, borderRadius: 8 },
});
