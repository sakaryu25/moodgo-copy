-- ═══════════════════════════════════════════════════════════════════════════
-- MoodGo PostGIS 統合マイグレーション
-- Supabase Dashboard > SQL Editor で実行してください
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. PostGIS 拡張を有効化 ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── 2. places テーブルにカラム追加 ───────────────────────────────────────
-- 空間インデックス用ジオメトリカラム（SRID 4326 = WGS84 緯度経度）
ALTER TABLE places ADD COLUMN IF NOT EXISTS location         geometry(Point, 4326);
-- 生存確認（閉店チェック）の最終実施日時
ALTER TABLE places ADD COLUMN IF NOT EXISTS last_checked_at  TIMESTAMPTZ;
-- Google Places ID（未登録の場合 null, 生存確認に使用）
-- ※ すでに存在する場合は何もしない
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id  TEXT;

-- ── 3. 既存レコードの location を lat/lng から一括生成 ───────────────────
UPDATE places
SET    location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
WHERE  lat IS NOT NULL
  AND  lng IS NOT NULL
  AND  location IS NULL;

-- ── 4. インデックス ───────────────────────────────────────────────────────
-- 空間インデックス（GiST）：ST_DWithin / ST_Distance を高速化
CREATE INDEX IF NOT EXISTS idx_places_location_gist
  ON places USING GIST(location);

-- 生存確認日時インデックス（未チェック or 古いレコードを高速抽出）
CREATE INDEX IF NOT EXISTS idx_places_last_checked_at
  ON places(last_checked_at NULLS FIRST);

-- source_type インデックス（既存）
CREATE INDEX IF NOT EXISTS idx_places_source_type ON places(source_type);

-- ── 5. トリガー：lat/lng 変更時に location を自動同期 ────────────────────
CREATE OR REPLACE FUNCTION sync_place_location()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_place_location ON places;
CREATE TRIGGER trg_sync_place_location
  BEFORE INSERT OR UPDATE OF lat, lng ON places
  FOR EACH ROW EXECUTE FUNCTION sync_place_location();

-- ── 6. RPC: find_nearby_places ────────────────────────────────────────────
-- 「現在地から近い順 × タグ一致 × アクティブ」で高速検索
-- 用途: ユーザー検索（全気分・全スポット種別に対応）
--
-- 引数:
--   user_lat     緯度
--   user_lng     経度
--   radius_m     検索半径（メートル）
--   req_tags     必須タグ配列（空配列なら全件）
--   result_limit 最大件数
--
-- 戻り値: distance_m（メートル）付きで近い順に返す
DROP FUNCTION IF EXISTS find_nearby_places(FLOAT8, FLOAT8, FLOAT8, TEXT[], INT);

CREATE OR REPLACE FUNCTION find_nearby_places(
  user_lat     DOUBLE PRECISION,
  user_lng     DOUBLE PRECISION,
  radius_m     DOUBLE PRECISION,
  req_tags     TEXT[]  DEFAULT '{}',
  result_limit INT     DEFAULT 60
)
RETURNS TABLE (
  id               UUID,
  name             TEXT,
  address          TEXT,
  nearest_station  TEXT,
  lat              DOUBLE PRECISION,
  lng              DOUBLE PRECISION,
  google_place_id  TEXT,
  tags             TEXT[],
  area             TEXT,
  description      TEXT,
  photo_url        TEXT,
  open_hours       TEXT,
  close_day        TEXT,
  budget           TEXT,
  hotpepper_url    TEXT,
  source_type      TEXT,
  report_count     INT,
  last_checked_at  TIMESTAMPTZ,
  distance_m       DOUBLE PRECISION
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  user_geom geometry;
BEGIN
  user_geom := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326);

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.address,
    p.nearest_station,
    p.lat,
    p.lng,
    p.google_place_id,
    p.tags,
    p.area,
    p.description,
    p.photo_url,
    p.open_hours,
    p.close_day,
    p.budget,
    p.hotpepper_url,
    p.source_type,
    COALESCE(p.report_count, 0)::INT,
    p.last_checked_at,
    ST_Distance(p.location::geography, user_geom::geography) AS distance_m
  FROM  places p
  WHERE p.is_active = TRUE
    AND p.location  IS NOT NULL
    AND ST_DWithin(p.location::geography, user_geom::geography, radius_m)
    AND (
      array_length(req_tags, 1) IS NULL
      OR req_tags = '{}'::TEXT[]
      OR p.tags @> req_tags
    )
  ORDER BY distance_m ASC
  LIMIT  result_limit;
END;
$$;

-- ── 7. RPC: find_places_needing_vitality_check ────────────────────────────
-- 閉店チェック未実施 or 1週間以上経過のアクティブスポットを返す
-- 用途: Admin バッチ or バックグラウンド自浄処理
CREATE OR REPLACE FUNCTION find_places_needing_vitality_check(
  batch_size  INT     DEFAULT 50,
  max_age_days INT    DEFAULT 7
)
RETURNS TABLE (
  id              UUID,
  name            TEXT,
  google_place_id TEXT,
  hotpepper_id    TEXT,
  address         TEXT,
  source_type     TEXT,
  last_checked_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.name,
    p.google_place_id,
    p.hotpepper_id,
    p.address,
    p.source_type,
    p.last_checked_at
  FROM  places p
  WHERE p.is_active = TRUE
    AND (
      p.last_checked_at IS NULL
      OR p.last_checked_at < NOW() - make_interval(days => max_age_days)
    )
  ORDER BY p.last_checked_at ASC NULLS FIRST
  LIMIT  batch_size;
$$;

-- ── 8. 確認クエリ ─────────────────────────────────────────────────────────
-- 実行後、以下で確認できます:
-- SELECT COUNT(*) FROM places WHERE location IS NOT NULL;
-- SELECT find_nearby_places(35.6895, 139.6917, 3000, ARRAY['#お腹すいた','#居酒屋'], 10);
-- SELECT find_places_needing_vitality_check(5, 7);
