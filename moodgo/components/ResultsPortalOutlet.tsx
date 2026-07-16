// ── 検索クイズ/結果のルート直下オーバーレイ描画 ─────────────────────────────
// _layout.tsx 直下（Stackの上・GroupShareSheetより下）に置く。indexが resultsPortal ストアへ
// 流し込んだ node を全画面の絶対配置ビューで描画する＝ネイティブタブバーごと覆える。
// visible=false（/place へ遷移中）は opacity:0 + pointerEvents:none にして前面を /place に譲る
// （node はマウントし続ける＝ScrollView位置や入力状態を保持したまま裏に退避）。
import React, { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { subscribeResultsPortal, getResultsPortalSnapshot } from '@/lib/resultsPortal';

export default function ResultsPortalOutlet() {
  const { node, visible } = useSyncExternalStore(subscribeResultsPortal, getResultsPortalSnapshot);
  if (!node) return null;   // クイズ/結果が始まっていない＝何も描画しない（ホームへタッチを通す）
  return (
    <View
      style={[StyleSheet.absoluteFillObject, styles.host, { opacity: visible ? 1 : 0 }]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {node}
    </View>
  );
}

const styles = StyleSheet.create({
  // GroupShareSheet(9999)/ConsentGate より下・Stackより上。/place遷移中はopacity0で裏に退避する。
  host: { zIndex: 4000, elevation: 4000 },
});
