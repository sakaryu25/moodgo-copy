-- ─── 検索が壊れている根本原因の修正（2026-07-11・最優先）─────────────────────────
-- 症状: 検索がほぼ全ジャンルで壊れている。
--   ・「お腹すいた」→ 0件（渋谷2km四方に飲食店625件が実在するのに）
--   ・「集中したい」→ ショッピングモール/カラオケが出る（近場のadmin枠に広げた結果）
--   ・検索結果が admin(キュレーション)枠だけになり、OSM由来の15万件が一切出ない
--
-- 原因: 近傍検索RPC find_nearby_places が statement timeout(57014)で毎回死んでいる。
--   places が 454,567 行に膨れた（OSM飲食14万等の投入後）ため。
--   既存の空間索引は `USING GIST(location)` ＝ geometry型の索引。
--   だが RPC は `ST_DWithin(p.location::geography, ...)` と geography にキャストして検索する。
--   PostGISでは geometry索引は geography-cast クエリに使えない → 45万行を毎回フルスキャン → timeout。
--   （データが数千行だった頃はフルスキャンでも速く動いていたのが、量が増えて限界を超えた）
--
-- 修正: geography-cast に一致する「関数索引」を張る。これで ST_DWithin が索引を使えて即応答になる。
--   併せて tags @> req_tags 用の GIN 索引も張る（気分タグ絞り込みの高速化）。
--
-- 適用: Supabase SQL Editor でこのファイルを実行（1回だけ・45万行で索引構築に約1〜2分）。
--   実行後は検索が即回復する（アプリ側のデプロイ不要）。

-- ① 本丸: geography キャストに一致する GiST 関数索引（これが無いと45万行フルスキャン）
create index if not exists idx_places_location_geog
  on places using gist ((location::geography));

-- ② 気分タグ絞り込み（p.tags @> req_tags）用の GIN 索引
create index if not exists idx_places_tags_gin
  on places using gin (tags);

-- ③ プランナに最新の統計を渡す（索引を確実に使わせる）
analyze places;

-- ── 確認（任意）: 実行後、これが数十msで返れば回復 ──
-- select count(*) from find_nearby_places(35.6595, 139.7005, 3000, array['#お腹すいた'], 10);
