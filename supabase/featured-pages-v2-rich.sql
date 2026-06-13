-- ─────────────────────────────────────────────────────────────────────────────
-- 特集スポット（featured_page_spots）のリッチ化
--   システムB（featured_pages_v2 / _moods / _spots）をアプリの唯一の特集データ源に
--   一本化するため、スポットに詳細項目を追加する。
--   ・メニュー専用セクション（menu_items）
--   ・期間限定イベント（events）
--   ・営業時間/定休日の構造化（hours / closed_days）
--   ・詳細ページ用の基本情報（catch_copy, tags, features, gallery, 連絡先 等）
--
-- Supabase SQL Editor でそのまま実行してください（既存データは保持されます）。
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE featured_page_spots
  ADD COLUMN IF NOT EXISTS shop_name          text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS catch_copy         text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS tags               text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS features           text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS gallery_image_urls text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS address            text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS access             text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone              text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS website            text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS instagram          text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS congestion_info    text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS closed_days        text    DEFAULT '',
  -- 構造化営業時間: { mon:{open,close,closed}, ... , note }
  ADD COLUMN IF NOT EXISTS hours              jsonb   DEFAULT '{}'::jsonb,
  -- メニュー: [{ name, category, price, description, image_url }]
  ADD COLUMN IF NOT EXISTS menu_items         jsonb   DEFAULT '[]'::jsonb,
  -- 期間限定イベント: [{ title, start_date, end_date, description, image_url }]
  ADD COLUMN IF NOT EXISTS events             jsonb   DEFAULT '[]'::jsonb;

-- 既存行の NULL を空デフォルトで埋める（古い行対策）
UPDATE featured_page_spots
SET
  shop_name          = COALESCE(shop_name, ''),
  catch_copy         = COALESCE(catch_copy, ''),
  tags               = COALESCE(tags, '{}'),
  features           = COALESCE(features, '{}'),
  gallery_image_urls = COALESCE(gallery_image_urls, '{}'),
  address            = COALESCE(address, ''),
  access             = COALESCE(access, ''),
  phone              = COALESCE(phone, ''),
  website            = COALESCE(website, ''),
  instagram          = COALESCE(instagram, ''),
  congestion_info    = COALESCE(congestion_info, ''),
  closed_days        = COALESCE(closed_days, ''),
  hours              = COALESCE(hours, '{}'::jsonb),
  menu_items         = COALESCE(menu_items, '[]'::jsonb),
  events             = COALESCE(events, '[]'::jsonb)
WHERE TRUE;
