// ── PhotoViewer ───────────────────────────────────────────────────────────────
// 全画面フォトビューア（検索カード/場所詳細/投稿詳細で共通）。
// タップで拡大表示。横スワイプで写真切替、ピンチでズーム（iOS）。カウンター＋閉じるボタン。
// ⚠ New Arch(Fabric)の <Modal transparent> は中身を描画せず透明のままタッチを奪う不具合がある
//   （ConsentGate で実証・c5adb7c）。このビューアは表示した瞬間に visible=true でマウントされる
//   発火パターンなので transparent を避け、不透明フルスクリーンModal（実績のある描画経路）を使う。
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { Dimensions, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function PhotoViewer({ photos, initialIdx, onClose }: {
  photos: string[]; initialIdx: number; onClose: () => void;
}) {
  const { width: SW, height: SH } = Dimensions.get('window');
  const [idx, setIdx] = useState(initialIdx);
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={pv.root}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: initialIdx * SW, y: 0 }}
          onMomentumScrollEnd={e => setIdx(Math.round(e.nativeEvent.contentOffset.x / SW))}
        >
          {photos.map((uri, i) => (
            <ScrollView
              key={uri + i}
              style={{ width: SW, height: SH }}
              contentContainerStyle={{ width: SW, height: SH }}
              maximumZoomScale={3}
              minimumZoomScale={1}
              bouncesZoom
              centerContent
            >
              <Image source={{ uri }} style={{ width: SW, height: SH }} contentFit="contain" transition={150} />
            </ScrollView>
          ))}
        </ScrollView>
        {/* 閉じる */}
        <TouchableOpacity onPress={onClose} style={pv.closeBtn} activeOpacity={0.8}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={22} color="#fff" strokeWidth={2.5} />
        </TouchableOpacity>
        {/* カウンター */}
        {photos.length > 1 && (
          <View style={pv.counter}>
            <Text style={pv.counterText}>{idx + 1} / {photos.length}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const pv = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  closeBtn: {
    position: 'absolute', top: 56, right: 18,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  counter: {
    position: 'absolute', top: 64, alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  counterText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
