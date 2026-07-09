// ── feedRefresh ───────────────────────────────────────────────────────────────
// 投稿の作成/編集/削除で「みんなの穴場フィード」が古くなるので、次にフィードが
// フォーカスされた時だけ再取得させるための軽量シグナル（毎フォーカス再取得＝スクロール
// リセットを避けるため、変更があった時のみ立てる）。
let dirty = false;

/** 投稿を作成/編集/削除したら呼ぶ。次のフィード表示で再取得される。 */
export function markFeedStale(): void { dirty = true; }

/** フィードのフォーカス時に呼ぶ。stale なら true を返しフラグを消す（=再取得のトリガ）。 */
export function consumeFeedStale(): boolean { const d = dirty; dirty = false; return d; }
