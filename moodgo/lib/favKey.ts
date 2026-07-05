// ─── favKey ──────────────────────────────────────────────────────────────────
// お気に入りの同一判定（2026-07-05監査CRITICAL対応）。
// 従来は title(名前)一致で判定していたため、同名の別スポット（例: 東京と大阪の同名店）を
// 両方保存すると片方の削除で両方消える・ハートの点灯が混線する問題があった。
// 判定規則: 両方に supabaseId があれば supabaseId、両方に placeId があれば placeId、
// それ以外（旧保存データ＝ID無し）は従来どおり title で互換判定する。
type FavLike = { title?: string; placeId?: string; supabaseId?: string };

export function sameFav(a: FavLike, b: FavLike): boolean {
  if (a.supabaseId && b.supabaseId) return a.supabaseId === b.supabaseId;
  if (a.placeId && b.placeId) return a.placeId === b.placeId;
  return (a.title ?? '') === (b.title ?? '');
}
