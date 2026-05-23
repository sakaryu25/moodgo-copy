-- ─── HotPepper 統合用 マイグレーション SQL ──────────────────────────────────
-- Supabase Dashboard > SQL Editor で実行してください
-- https://supabase.com/dashboard → プロジェクト → SQL Editor → New query

-- ── places テーブルに HotPepper フィールドを追加 ──────────────────────────────
ALTER TABLE places ADD COLUMN IF NOT EXISTS hotpepper_id    TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS source_type     TEXT DEFAULT 'manual';
ALTER TABLE places ADD COLUMN IF NOT EXISTS report_count    INTEGER DEFAULT 0;
ALTER TABLE places ADD COLUMN IF NOT EXISTS last_reported_at TIMESTAMPTZ;
ALTER TABLE places ADD COLUMN IF NOT EXISTS photo_url       TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS open_hours      TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS close_day       TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS budget          TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS hotpepper_url   TEXT;

-- ── インデックス追加 ──────────────────────────────────────────────────────────
-- HotPepper ID でユニーク検索（重複登録防止）
CREATE UNIQUE INDEX IF NOT EXISTS idx_places_hotpepper_id
  ON places(hotpepper_id) WHERE hotpepper_id IS NOT NULL;

-- source_type インデックス（HotPepperだけ絞り込む際に使用）
CREATE INDEX IF NOT EXISTS idx_places_source_type ON places(source_type);

-- report_count インデックス（管理画面でソート）
CREATE INDEX IF NOT EXISTS idx_places_report_count ON places(report_count);

-- ── 閉店報告ログテーブル ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS closed_reports (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id        UUID        REFERENCES places(id) ON DELETE SET NULL,
  hotpepper_id    TEXT,
  user_session_id TEXT,
  reported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_closed_reports_place_id     ON closed_reports(place_id);
CREATE INDEX IF NOT EXISTS idx_closed_reports_reported_at  ON closed_reports(reported_at);

-- ── HotPepper 同期ログテーブル ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotpepper_sync_logs (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_id         TEXT        NOT NULL,
  genre_label      TEXT,
  batch_index      INTEGER     NOT NULL,
  total_batches    INTEGER,
  points_processed INTEGER     DEFAULT 0,
  shops_fetched    INTEGER     DEFAULT 0,
  inserted         INTEGER     DEFAULT 0,
  updated          INTEGER     DEFAULT 0,
  skipped          INTEGER     DEFAULT 0,
  dry_run          BOOLEAN     DEFAULT false,
  status           TEXT        DEFAULT 'completed',  -- completed / error
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_genre_id  ON hotpepper_sync_logs(genre_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created   ON hotpepper_sync_logs(created_at DESC);

-- ── RLS ポリシー ──────────────────────────────────────────────────────────────
ALTER TABLE closed_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotpepper_sync_logs ENABLE ROW LEVEL SECURITY;

-- closed_reports: サーバーサイド（service key）のみアクセス可
-- hotpepper_sync_logs: サーバーサイドのみアクセス可
-- ※ Service Role Key は RLS をバイパスするため追加ポリシー不要

-- ── 確認クエリ（実行後にこれで確認できます）──────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'places' ORDER BY ordinal_position;
-- SELECT COUNT(*) FROM places WHERE source_type = 'hotpepper';
-- SELECT COUNT(*) FROM places WHERE is_active = false AND source_type = 'hotpepper';
