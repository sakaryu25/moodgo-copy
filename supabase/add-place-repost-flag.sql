-- ── 期間限定スポットの「場所詳細への転載」ON/OFFフラグ ──────────────────────────
-- repost_to_detail = false にすると、そのスポットは場所詳細の「期間限定イベント」カード
--   (/api/place-events) から除外される＝親スポットの詳細ページに転載されない。
-- 一方 recommend の検索注入(adminSpots/limitedEvents)はこのフラグを見ないので、
--   「検索には残るが、場所詳細には出さない」を実現する（ユーザー指定 2026-07-18）。
-- DEFAULT true・NOT NULL なので既存の期間限定スポットは全て「転載する(=従来通り出す)」で始まる。
-- Postgres 11+ は定数DEFAULTの列追加をメタデータ変更で処理する（209k行でも即時・テーブル書換なし）。
ALTER TABLE places ADD COLUMN IF NOT EXISTS repost_to_detail boolean NOT NULL DEFAULT true;

-- 期間限定スポット一覧(admin)を高速化する部分索引。available_until が入った行だけを対象にするので
--   巨大な places テーブルでも「WHERE available_until IS NOT NULL」が索引で瞬時に返る
--   （無索引だと全件スキャンで statement timeout する）。
CREATE INDEX IF NOT EXISTS idx_places_available_until
  ON places (available_until)
  WHERE available_until IS NOT NULL;

-- available_from 側も部分索引（一覧は available_from OR available_until で拾うため、
--   両方に索引があると PostgreSQL が BitmapOr で高速に返せる）。
CREATE INDEX IF NOT EXISTS idx_places_available_from
  ON places (available_from)
  WHERE available_from IS NOT NULL;
