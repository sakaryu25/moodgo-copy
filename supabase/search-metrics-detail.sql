-- ─── search_metrics に Place Details 内訳列を追加（2026-07-05 監査対応）────────
-- recommend の ★評価取得(Place Details GET /v1/places/{id})が「other」に落ちて
-- ¥コスト集計から漏れていたため、内訳列 google_detail を追加する。
-- 未適用でもコードは安全（logSearchMetric が列無しを検知して従来列のみでリトライ）。
-- Supabase SQL Editor で実行:
alter table search_metrics add column if not exists google_detail integer default 0;
