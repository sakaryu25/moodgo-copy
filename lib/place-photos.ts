// ─── places の写真列マージの一元化（2026-07-06監査 #3）────────────────────────
// 歴史的経緯で「スポットの写真」が2列に分散している:
//   - photo_url   … 旧・単発写真（18,281件）。2026-06-22のライセンス対応で writeback 停止＝凍結列。
//   - image_urls  … 新・複数写真（1,795件）。新規書き込みはこちらのみ。
// 読み手はこのヘルパで統合すること（image_urls 優先・photo_url は末尾フォールバック・重複排除）。
// 列自体の統合(migration)は find_nearby_places RPC の返却型に両列が含まれるため保留。

export function mergedPlacePhotos(row: {
  photo_url?: string | null;
  image_urls?: string[] | null;
}): string[] {
  const imgs = (row.image_urls ?? []).filter(Boolean);
  if (row.photo_url && !imgs.includes(row.photo_url)) imgs.push(row.photo_url);
  return imgs;
}
