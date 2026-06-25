-- ============================================================================
-- Google写真のSupabaseからの削除（ライセンス対応・2026-06-25）
-- ----------------------------------------------------------------------------
-- 目的: 永続キャッシュ不可なGoogle写真をDBから消す。Wikimedia(CC)・ユーザー投稿は温存。
-- 実行: Supabase SQL Editor で上から順に。REST(supabase-js)では実行不可。
-- 安全: 行は消さず写真カラムをNULL化(place_photosのみNOT NULLのためdelete)。先にバックアップ。
-- 前提: コード側の「出血(writeback/30日キャッシュ)」は commit 10fb489 で停止済み。
--       これを先に入れてからSQLを流すこと(でないと次の検索でまた溜まる)。
--
-- 実件数(2026-06-25検証時): places.photo_url google=44 / places.image_urls=~2,076 /
--   place_photos google=1,344(全1,357) / api_cache enr:=3,184 / curated_spots=0 / place_details=18
-- ============================================================================

-- 【確認1: 実行前の件数】--------------------------------------------------------
select 'places.photo_url google' as target, count(*) from places
 where photo_url ~* '(places\.googleapis\.com/v1/.*/media|maps\.googleapis\.com/maps/api/place/photo|googleusercontent\.com)'
   and photo_url not ilike '%wikimedia%' and photo_url not ilike '%Special:FilePath%'
   and photo_url not ilike '%/storage/v1/object/public/%'
union all select 'places.image_urls 非NULL', count(*) from places where image_urls is not null
union all select 'place_photos google', count(*) from place_photos
 where photo_url ~* '(googleapis\.com|googleusercontent\.com)' and photo_url not ilike '%wikimedia%' and photo_url not ilike '%/storage/v1/object/public/%'
union all select 'api_cache enr:', count(*) from api_cache where cache_key like 'enr:%';

-- 【0. バックアップ(可逆性)】問題時に書き戻せるよう退避。確認後に drop してよい。-----------
create table if not exists _photo_backup_20260625 as
  select id::text as id, 'places' as tbl, 'photo_url' as col, photo_url as val
    from places where photo_url is not null
  union all select id::text, 'places', 'image_urls', array_to_string(image_urls,'|')
    from places where image_urls is not null
  union all select id::text, 'place_photos', 'photo_url', photo_url
    from place_photos where photo_url is not null;

-- 【1. places.photo_url: Google行だけNULL化（Wikimedia/Storageは温存）】-------------
update places set photo_url = null
 where photo_url is not null
   and ( photo_url ilike '%places.googleapis.com/v1/%/media%'
      or photo_url ilike '%maps.googleapis.com/maps/api/place/photo%'
      or photo_url ilike '%googleusercontent.com%'
      or (photo_url ilike '%/api/photo-proxy%' and (photo_url ilike '%googleapis.com%' or photo_url ilike '%googleusercontent%')) )
   and photo_url not ilike '%wikimedia%'
   and photo_url not ilike '%Special:FilePath%'
   and photo_url not ilike '%/storage/v1/object/public/%';

-- 【2. places.image_urls: 配列からGoogle URLだけ除去（空になればNULL）】--------------
update places set image_urls = (
   select array_agg(u) from unnest(image_urls) u
    where u not ilike '%googleapis.com%' and u not ilike '%googleusercontent.com%')
 where image_urls is not null
   and exists (select 1 from unnest(image_urls) u
               where u ilike '%googleapis.com%' or u ilike '%googleusercontent.com%');
update places set image_urls = null where image_urls = '{}';

-- 【3. curated_spots: Google写真除去（現状0件だが将来分の保険・writebackは停止済）】------
update curated_spots set
   image_url = case when image_url ilike '%wikimedia%' or image_url ilike '%/storage/v1/object/public/%'
                    then image_url else null end,
   photo_urls = (select array_agg(u) from unnest(photo_urls) u
                 where u ilike '%wikimedia%' or u ilike '%/storage/v1/object/public/%')
 where photo_urls is not null or image_url is not null;

-- 【4. place_photos: Google行を delete（NOT NULL列のためNULL化不可）約1,344件】---------
delete from place_photos
 where ( photo_url ilike '%googleapis.com%' or photo_url ilike '%googleusercontent.com%' )
   and photo_url not ilike '%wikimedia%'
   and photo_url not ilike '%/storage/v1/object/public/%';

-- 【5. api_cache: 写真入りキャッシュ一掃（=「写真の30日キャッシュ」本体）約3,184件+】------
delete from api_cache where cache_key like 'enr:%';
delete from api_cache
 where data::text ilike '%/api/photo-proxy%'
    or data::text ilike '%googleapis.com%'
    or data::text ilike '%googleusercontent.com%';
--  ※ st2:(駅) / geo:(座標) は写真でないので残る

-- 【6. place_details: Google Place Details(写真name/レビュー含む)18件】※厳格対応する場合のみ
--  詳細画面のキャッシュ。truncateしても検索で再取得され機能影響は軽微。
--  ただし place-detail route が再度書き込むため、表示方針確定までは再蓄積する。
-- truncate place_details;

-- 【7. featured_page_spots: 手動キュレーション中心 → 一括NGリスク。まず確認→個別対応】------
-- select id, image_url, gallery_image_urls from featured_page_spots
--  where image_url ilike '%googleapis%' or array_to_string(gallery_image_urls, ',') ilike '%googleapis%';

-- 【確認2: 実行後の件数（全部0になるはず／image_urlsは0に近づく）】------------------------
select 'places.photo_url google(後)' as target, count(*) from places
 where photo_url ilike '%googleapis.com%' or photo_url ilike '%googleusercontent.com%'
union all select 'places.image_urls 残google(後)', count(*) from places
 where image_urls is not null and exists(select 1 from unnest(image_urls) u where u ilike '%googleapis%')
union all select 'place_photos google(後)', count(*) from place_photos
 where photo_url ilike '%googleapis.com%' or photo_url ilike '%googleusercontent.com%'
union all select 'api_cache enr:(後)', count(*) from api_cache where cache_key like 'enr:%';

-- 【復元】問題時: update places p set photo_url = b.val from _photo_backup_20260625 b
--   where b.tbl='places' and b.col='photo_url' and p.id::text=b.id;  等で書き戻し。
--   絶対に触らない: spot_photos / blog_posts / blog_post_photos / suggestions / storageバケット / Wikimedia行
-- 確認後: drop table _photo_backup_20260625;
