-- ═══════════════════════════════════════════════════════════════════════════
-- MoodGo データ整合性・性能 強化（監査Batch3）
--   Supabase SQL Editor で実行。idempotent。索引追加は安全。
--   ※ google_place_id のユニーク化だけは「重複の解消」を伴うので、節【B】の
--     確認SELECTを見てから実行してください（破壊的になりうる箇所はコメントで明示）。
-- ═══════════════════════════════════════════════════════════════════════════

-- ───【A】索引追加（安全・即実行可）──────────────────────────────────────────
-- places.name は writeback / report-count / dedup の絞り込みキーなのに索引が無く
-- seq scan していた。28k→100k と増えるほど効く。
create index if not exists idx_places_name on places (name);

-- name+address で1行に絞る writeback の高速化（チェーン混線対策の複合キー）
create index if not exists idx_places_name_address on places (name, address);

-- 学習集計 fetchEngagementAgg は place_mood_affinity を score 降順で全件読む
-- （mood 絞り無し）。score 単独索引で order by を index 化。
create index if not exists idx_affinity_score on place_mood_affinity (score desc);

-- ───【B】google_place_id のユニーク化（重複防止）──────────────────────────────
-- 自動保存の dedup は read-then-insert でレース時に重複行ができうる。
-- ユニーク索引で根本防止する。ただし既存重複があると作成が失敗するため、
-- まず重複を確認 → 重複を解消（重複側の google_place_id を NULL 化）→ 索引作成 の順。

-- B-1) 重複の確認（まずこれを実行して件数を見る。0 件なら B-2 をスキップして B-3 へ）
-- select google_place_id, count(*) c
-- from places
-- where google_place_id is not null
-- group by google_place_id having count(*) > 1
-- order by c desc;

-- B-2) 重複解消（重複がある場合のみ実行）: 各 google_place_id について最小 id の
--      1行だけ残し、それ以外の行の google_place_id を NULL にする（行は消さない＝
--      写真/タグ等のデータは保持。再リンクは merge-duplicates 管理画面で）。
-- update places p set google_place_id = null
-- from (
--   select id from (
--     select id, row_number() over (partition by google_place_id order by id) rn
--     from places where google_place_id is not null
--   ) t where rn > 1
-- ) dup
-- where p.id = dup.id;

-- B-3) 部分ユニーク索引を作成（NULL は対象外＝Yahoo等の id 無し行は影響なし）
create unique index if not exists uq_places_google_place_id
  on places (google_place_id)
  where google_place_id is not null;

-- ───【C】スキーマのドリフト（要対応・別途）──────────────────────────────────
-- 以下のテーブルは backend が read/write しているが、repo に CREATE 文が無い
-- （= 本番DBにしか定義が存在しない）。再構築可能にするため、本番から
-- `pg_dump --schema-only -t <table>` 等で定義を吸い出し supabase/ に保存推奨:
--   mood_place_ratings / api_cache / feedback / curated_spots /
--   globally_blocked_places / closed_reports / featured_pages(_v2) /
--   featured_page_spots / featured_page_moods / contacts / client_errors
-- （このファイルではスキーマを推測で作らない＝誤った列定義で本番と乖離させないため）
