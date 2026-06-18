-- ── OSM再タグ付け用 列追加（フェーズ1: 飲食ジャンル）─────────────────────────────
-- 既存行・既存 places.id は保持したまま列だけ追加する（破壊的変更なし）。
--   osm_id / osm_type        : 今後のOSM行の確実な同定キー（再タグ・差分更新用）
--   tag_confidence/tag_source: タグの根拠と自信度（後から低信頼タグだけ見直すため）
--   source_license           : OSMデータのライセンス（ODbL）
--   attribution_required     : 帰属表示（© OpenStreetMap contributors）が必要か
-- 冪等: IF NOT EXISTS。再実行しても安全。

ALTER TABLE places ADD COLUMN IF NOT EXISTS osm_id              BIGINT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS osm_type            TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS tag_confidence      TEXT;   -- 'high' | 'medium' | 'low'
ALTER TABLE places ADD COLUMN IF NOT EXISTS tag_source          TEXT;   -- 'chain_dictionary' | 'cuisine' | 'name_regex' | 'amenity' | 'fallback'
ALTER TABLE places ADD COLUMN IF NOT EXISTS source_license      TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS attribution_required BOOLEAN;

-- osm_id 索引（再タグ時の既存行特定を高速化）。NULL は対象外。
CREATE INDEX IF NOT EXISTS idx_places_osm_id ON places(osm_id) WHERE osm_id IS NOT NULL;

-- 既存 osm-foodshop 行にライセンス情報を一括付与（タグ自体は retag_dense.py で更新）。
UPDATE places
   SET source_license = 'ODbL', attribution_required = TRUE
 WHERE source_type = 'osm-foodshop'
   AND source_license IS NULL;
