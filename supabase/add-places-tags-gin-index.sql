-- places.tags（text[]）への GIN インデックス。
--   目的: 配列包含クエリ `tags @> '{"#時間潰し"}'`（PostgREST の tags=cs.{...}）が
--   フルスキャン→statement timeout(57014) していたのを解消する。タグ別カウント/絞り込み検索が高速化。
--   ※ find_nearby_places(PostGIS RPC)経由の空間検索とは別系統だが、タグ集計・admin・cron品質スイープに効く。
--   適用は任意（未適用でもアプリは動くが #タグ の集計クエリが遅い/タイムアウトする）。
CREATE INDEX IF NOT EXISTS idx_places_tags_gin ON places USING GIN (tags);

-- 併せて、is_active との複合的な絞り込みが多いので部分索引も用意（active な行だけ対象＝小さく速い）。
CREATE INDEX IF NOT EXISTS idx_places_tags_gin_active ON places USING GIN (tags) WHERE is_active = true;
