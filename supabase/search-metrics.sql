-- ─── 検索メトリクス（Google依存度の可視化）────────────────────────────────────
-- 1検索ごとに「Googleを何回叩いたか／Supabaseで何件埋まったか」を記録し、
-- 「Google 0回率」を主要KPIとして改善の指標にする。
-- Supabase SQLエディタで実行。未実行でも /api/recommend は普通に動く（記録だけスキップ）。
create table if not exists search_metrics (
  id uuid primary key default gen_random_uuid(),
  mood text,
  area text,
  deep_dive text,
  google_calls int,        -- searchText + searchNearby + photo の合計（課金対象のGoogle呼び出し）
  total_calls int,         -- 全API呼び出し（geocode等含む）
  rec_count int,           -- 返した件数
  source text,             -- supabase / legacy 等
  elapsed_ms int,
  created_at timestamptz not null default now()
);
create index if not exists idx_search_metrics_created on search_metrics (created_at desc);
create index if not exists idx_search_metrics_mood on search_metrics (mood);
