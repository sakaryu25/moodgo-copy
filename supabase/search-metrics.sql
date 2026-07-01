-- ─── 検索メトリクス（Google依存度＆コスト¥の可視化）────────────────────────────
-- 1検索ごとに「Googleを何回叩いたか（種別別）／何件返したか」を記録し、
-- 「Google 0回率」と「推定コスト¥」を主要KPIにする。
-- Supabase SQLエディタで実行。既存テーブルにも内訳列を追加＝再実行しても安全。
-- 未実行でも /api/recommend は普通に動く（記録だけスキップ）。
create table if not exists search_metrics (
  id uuid primary key default gen_random_uuid(),
  mood text,
  area text,
  deep_dive text,
  google_calls int,          -- 課金Google呼び出しの合計（searchText + searchNearby + photo）
  google_searchtext int,     -- 内訳: Text Search（coverage・Enterprise SKU ≈¥5.3/回）
  google_nearby int,         -- 内訳: Nearby Search（Enterprise SKU ≈¥5.3/回）
  google_photo int,          -- 内訳: 写真取得（Photo SKU ≈¥1.1/回・最安）
  total_calls int,           -- 全API呼び出し（geocode等含む）
  rec_count int,             -- 返した件数
  source text,               -- supabase / legacy 等
  elapsed_ms int,
  created_at timestamptz not null default now()
);
-- 既存テーブルへの内訳列追加（初回 create 時は無害。¥集計に必須）
alter table search_metrics add column if not exists google_searchtext int;
alter table search_metrics add column if not exists google_nearby int;
alter table search_metrics add column if not exists google_photo int;
create index if not exists idx_search_metrics_created on search_metrics (created_at desc);
create index if not exists idx_search_metrics_mood on search_metrics (mood);
