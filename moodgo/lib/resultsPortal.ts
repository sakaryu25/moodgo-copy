// ── 検索クイズ/結果を「ルート直下」で描画するためのポータル機構 ─────────────────
// 背景: クイズ/結果は元々 (tabs)/index の全画面 <Modal presentationStyle="fullScreen"> で
//   表示していたが、iOSの全画面Modalは presenter(ルートのStack)を描画から外すため、
//   Modal内から router.push した /place が「Modal退避まで描画されず」、退避の瞬間に裏の
//   ホームが一瞬見えるチラつきが不可避だった（＋Modal再表示でScrollViewが最上部に戻る）。
// 対策: クイズ/結果を **ネイティブModalでなく root(_layout)直下のツリーオーバーレイ** で描画する。
//   ツリーオーバーレイは presenter を外さないので /place は通常のstack pushで“裏に”描画され、
//   オーバーレイを opacity:0/pointerEvents:none にするだけで即座に前面を譲れる＝隙間ゼロ。
//   さらにオーバーレイをマウントし続けるのでScrollView位置も自然に保持される。
// 実装: indexが自分のstateから作った node を useLayoutEffect でこのストアへ流し込み（描画前に
//   同期＝1フレームの遅延も出さない）、_layout の <ResultsPortalOutlet/> が購読して描画する。
import type { ReactNode } from 'react';

type Snapshot = { node: ReactNode; visible: boolean };

let snapshot: Snapshot = { node: null, visible: false };
const listeners = new Set<() => void>();

export function setResultsPortal(node: ReactNode, visible: boolean): void {
  // 同一内容なら再通知しない（useSyncExternalStoreの無限ループ回避＝visibleとnodeが両方同じ時）
  if (snapshot.node === node && snapshot.visible === visible) return;
  snapshot = { node, visible };
  listeners.forEach((l) => l());
}

export function subscribeResultsPortal(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getResultsPortalSnapshot(): Snapshot {
  return snapshot;
}
