// ── 検索結果オーバーレイの一時抑制 ─────────────────────────────────────────────
// 検索結果/クイズは (tabs)/index の全画面 <Modal> で表示される。RNのネイティブModalは
// JSツリー全体の上に描画されるため、Modal内から router.push した画面(/place等)や、
// ルート直下(_layout)の GroupShareSheet が Modal の裏に隠れ「押しても何も出ない／ホームに
// 戻ると遅れて出る」バグになる。ナビゲーション/シート表示の間だけ結果Modalを隠して前面を
// 譲るための共有スイッチ。index が setter を登録し、遷移側が suppress を叩く。
let setter: ((suppressed: boolean) => void) | null = null;

export function registerResultsOverlaySuppressor(fn: ((v: boolean) => void) | null): void {
  setter = fn;
}

export function suppressResultsOverlay(suppressed: boolean): void {
  setter?.(suppressed);
}
