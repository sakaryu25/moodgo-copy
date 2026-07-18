-- ── places に連絡先列を追加（詳細ページのGoogle依存を無料源＝OSM/Wikidataで置き換えるための保存先）──
--   既存: open_hours / image_urls / lat / lng / nearest_station。無い: phone / website ← これを追加する。
--   これを適用すると:
--     ① community-spot（詳細）が places.phone/website を読み、埋まっていればGoogleを呼ばない＋Google取得分を保存
--     ② OSM Overpass harvest / Google補強 が phone/website を books へ永続化できる
--   未適用でも壊れない（列が無い時はGoogleにフォールバック＝現状動作）。適用後に節約が効き始める。
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS phone   text DEFAULT '',
  ADD COLUMN IF NOT EXISTS website text DEFAULT '';

-- 補強元の可視化（任意・デバッグ用）。OSM/Google/利用者のどれで埋めたか。既存運用に影響なし。
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS contact_source text DEFAULT NULL;
