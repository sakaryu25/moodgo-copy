-- ─── 同名スポット一括統合用の索引（2026-07-11）─────────────────────────────────
-- admin「重複統合」タブの一括統合/一覧は places を name 昇順でストリーミングする。
-- 45万行を毎回フルソートすると statement timeout になるため (name, id) の索引が必須。
--   適用: Supabase SQL Editor でこのファイルを実行（数十秒・1回だけ）
create index if not exists idx_places_name_id on places (name, id);
analyze places;
