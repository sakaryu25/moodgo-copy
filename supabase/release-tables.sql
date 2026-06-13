-- ═══════════════════════════════════════════════════════════════════════════
-- MoodGo リリース準備テーブル（お問い合わせ・クラッシュ監視・モデレーション）
--   Supabase ダッシュボード → SQL Editor → 貼り付けて Run。
--   すべて idempotent（if not exists）。何回流しても安全。
--   未実行でもアプリはクラッシュせず該当機能が「準備中」/best-effortで安全動作。
-- ───────────────────────────────────────────────────────────────────────────
--   ① contacts        … お問い合わせフォームの保存（/api/contact）
--   ② client_errors   … アプリのクラッシュ／JSエラー監視（/api/client-error）
--   ③ reports 補強    … 通報テーブル（既存）＋通報対象の端末ID列（ユーザーブロック用）
-- ═══════════════════════════════════════════════════════════════════════════


-- ① ─── お問い合わせ ────────────────────────────────────────────────────────
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  message text not null,
  device_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_contacts_created on contacts (created_at desc);


-- ② ─── クラッシュ／エラー監視（内蔵の軽量Sentry相当）────────────────────────
create table if not exists client_errors (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  stack text,
  kind text default 'error',          -- 'fatal' | 'error' | 'unhandled_rejection' | 'boundary'
  device_id text,
  platform text,                      -- 'ios' | 'android'
  app_version text,
  context text,                       -- 任意のJSON文字列
  created_at timestamptz not null default now()
);
create index if not exists idx_client_errors_created on client_errors (created_at desc);
create index if not exists idx_client_errors_kind on client_errors (kind);


-- ③ ─── 通報（UGCモデレーション）────────────────────────────────────────────
-- reports は既存運用中。未作成環境向けに idempotent で定義しておく。
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  spot_name text not null,
  spot_address text,
  reason text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_reports_created on reports (created_at desc);
-- 通報対象の端末ID（同一投稿者をまとめてブロック/対応するため。任意）
alter table reports add column if not exists reported_device_id text;

-- ═══════════════════════════════════════════════════════════════════════════
-- 完了。お問い合わせ保存・クラッシュ監視・通報の端末ひも付けが有効になります。
-- ═══════════════════════════════════════════════════════════════════════════
