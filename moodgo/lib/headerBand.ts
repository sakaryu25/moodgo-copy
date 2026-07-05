// ─── グラデヘッダー帯の統一高さ（お気に入り基準）─────────────────────────────
// お気に入り(FavoritesView)の帯 = paddingTop(inset+12) + タイトル行(32pt≈57)
//                                + セグ行(marginTop16 + 34) + paddingBottom20 ≈ inset + 139
// 特集(FeatureScreen)・みんなの穴場(BlogView)はコンテンツが少なく帯が低かったため、
// minHeight: insets.top + HERO_BAND_H で3タブの薄紫バーの高さを揃える。
// ⚠ FavoritesView のヘッダー構成を変えたらこの値も更新すること。
export const HERO_BAND_H = 139;
