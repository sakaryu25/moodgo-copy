-- ─── source_type 索引（投稿/手厳選の高速取得・2026-07-22）────────────────────────────
-- recommend の「投稿/手厳選(source∈user/manual)を最大8転載」機能は、これらを別クエリで取得する。
-- source_type が未索引だと places(約52万行)の seq scan で ~12秒かかり、コールドスタート時に
-- 60秒ゲートウェイtimeout を起こす(サウナ等の検索が0件化)。この部分索引で ~50ms に短縮する。
--
-- 適用前でもアプリは動く: loadFeaturedPlaces は非同期リフレッシュで、失効中は古い値/空を即返し
-- ホットパスをブロックしない(初回だけ手厳選が薄いことがある)。索引適用後は初回からすぐ埋まる。
--
-- Supabase SQL Editor で1回実行。CONCURRENTLY はトランザクション外で。
create index concurrently if not exists idx_places_featured_source
  on places (source_type)
  where source_type in ('user', 'manual') and is_active = true;

-- 参考: 現在の該当件数
-- select source_type, count(*) from places where source_type in ('user','manual') group by source_type;
