-- P27: search_metrics に search_id を追加。spot_engagement.search_id（funnel-tracking.sql で追加済）と
--   突合して「検索→詳細閲覧/お気に入り/来店」の実満足度(CTR・ゼロクリック率・平均クリック順位)を集計する。
--   未適用でも logSearchMetric は列落ちを検知して従来列のみでリトライ＝安全。適用後 /api/admin/search-satisfaction が使える。
alter table search_metrics add column if not exists search_id text;
create index if not exists idx_search_metrics_search_id on search_metrics (search_id);
