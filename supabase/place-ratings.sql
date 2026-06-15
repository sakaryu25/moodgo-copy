-- ─── places に評価(★)を保持し検索結果に出す（事業化①）──────────────────────
-- 都市の食事/娯楽は Supabase キャッシュ(source_type=google)主体だが places に評価列が無く、
-- 全件★なしカードになっていた（有料掲載の主戦場で店が無評価表示＝最大ブロッカー）。
-- rating/rating_count を追加し、find_nearby_places が返すようにする。
-- 値の充填は検索時writeback(schedulePlaceWriteBack)＋管理バッチ(/api/admin/backfill-ratings)。
--
-- すべて NULL 許容。RPC は image_urls 同様 DROP→CREATE で戻り型に2列追加（既存列・並びは維持）。

alter table places add column if not exists rating          real;        -- Google/Yahoo 由来の★(0〜5)
alter table places add column if not exists rating_count    int;         -- 口コミ件数
alter table places add column if not exists rating_updated_at timestamptz; -- 取得日時(鮮度・再取得判定)

drop function if exists find_nearby_places(double precision, double precision, double precision, text[], int);
create or replace function find_nearby_places(
  user_lat     double precision,
  user_lng     double precision,
  radius_m     double precision,
  req_tags     text[]  default '{}',
  result_limit int     default 60
)
returns table (
  id               uuid,
  name             text,
  address          text,
  nearest_station  text,
  lat              double precision,
  lng              double precision,
  google_place_id  text,
  tags             text[],
  area             text,
  description      text,
  photo_url        text,
  image_urls       text[],
  open_hours       text,
  close_day        text,
  budget           text,
  hotpepper_url    text,
  source_type      text,
  report_count     int,
  last_checked_at  timestamptz,
  rating           real,
  rating_count     int,
  distance_m       double precision
)
language plpgsql stable as $$
declare
  user_geom geometry;
begin
  user_geom := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326);
  return query
  select
    p.id, p.name, p.address, p.nearest_station, p.lat, p.lng, p.google_place_id,
    p.tags, p.area, p.description, p.photo_url, p.image_urls, p.open_hours,
    p.close_day, p.budget, p.hotpepper_url, p.source_type,
    coalesce(p.report_count, 0)::int, p.last_checked_at,
    p.rating, p.rating_count,
    ST_Distance(p.location::geography, user_geom::geography) as distance_m
  from places p
  where p.is_active = true
    and p.location is not null
    and ST_DWithin(p.location::geography, user_geom::geography, radius_m)
    and (array_length(req_tags, 1) is null or req_tags = '{}'::text[] or p.tags @> req_tags)
  order by distance_m asc
  limit result_limit;
end;
$$;

-- 評価バックフィル対象（google_place_id があり rating 未取得 or 90日以上前）の確認用
-- select count(*) from places where google_place_id is not null
--   and (rating is null or rating_updated_at < now() - interval '90 days');
