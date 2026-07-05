-- ─── find_nearby_places に期間限定フィルタを追加（2026-07-06 検証で発覚した穴の根本修正）──
-- 問題: 投稿フォームは「期間を設けると、期間外は検索結果に出ません」と約束しているが、
--       places本体の検索RPCに available_from/until の述語が無く、期間切れスポットが
--       候補に入っていた（本番RPC直叩きで実証）。admin注入(suggestions)経路のみフィルタ済みだった。
-- 対応: WHERE に公開期間の述語を追加（null=常時公開）。コード側にも同等の安全網を実装済みだが、
--       このSQLを適用すると候補生成の源流で確実に除外される。
-- 前提: add-place-available-period.sql 適用済み（available_from/until 列）。
-- Supabase SQL Editor で実行:

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
    ST_Distance(p.location::geography, user_geom::geography) as distance_m
  from places p
  where p.is_active = true
    and p.location is not null
    and ST_DWithin(p.location::geography, user_geom::geography, radius_m)
    and (array_length(req_tags, 1) is null or req_tags = '{}'::text[] or p.tags @> req_tags)
    -- 期間限定: 公開期間外は検索候補に出さない（null=常時公開）
    and (p.available_from  is null or p.available_from  <= current_date)
    and (p.available_until is null or p.available_until >= current_date)
  order by distance_m asc
  limit result_limit;
end;
$$;
