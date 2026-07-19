-- ─── find_nearby_places に「遠リング取得(min_radius_m)」を追加（2026-07-19）────────────
-- 問題: RPCは最寄り順(order by distance_m asc)＋limit で返すため、密集地(渋谷等)で大半径
--       (小旅行=96km/どこでも=160km)を指定しても、limit が近場で埋まり遠方リング(96km+)に届かない。
--       spatial-search 側で far/near split しても rows に遠方が入っていないため近場ばかり表示されていた。
-- 対応: min_radius_m パラメータ(既定0=従来挙動)を追加。
--         > 0 のとき WHERE に ST_Distance >= min_radius_m を足して「内円を除外＝リング[min,radius]だけ」取得し、
--         order を距離DESC(遠い順)にして limit が最遠スポットを優先的に残すようにする。
-- 性能: min>0 でも WHERE 述語が1つ増えるだけ。走査対象(タグGIN + ST_DWithin半径)は従来の大半径クエリと同一なので
--       追加コストは実質ゼロ（現行の小旅行クエリと同じ母数を距離計算→フィルタ→ソートするだけ）。
-- 後方互換: 旧5引数シグネチャをdrop→6引数(min_radius_m default 0)を作成。名前付きRPC呼び出しは
--           min_radius_m を省略すると 0 = 従来の最寄り順挙動になる。
-- 前提: add-place-available-period.sql / find-nearby-places-period.sql 適用済み。
-- Supabase SQL Editor で実行:

drop function if exists find_nearby_places(double precision, double precision, double precision, text[], int);
drop function if exists find_nearby_places(double precision, double precision, double precision, text[], int, double precision);
create or replace function find_nearby_places(
  user_lat     double precision,
  user_lng     double precision,
  radius_m     double precision,
  req_tags     text[]           default '{}',
  result_limit int              default 60,
  min_radius_m double precision default 0
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
    -- 遠リング: min_radius_m > 0 のとき内円(< min)を除外＝リング[min,radius]だけを候補にする
    and (min_radius_m <= 0
         or ST_Distance(p.location::geography, user_geom::geography) >= min_radius_m)
    -- 期間限定: 公開期間外は検索候補に出さない（null=常時公開）
    and (p.available_from  is null or p.available_from  <= current_date)
    and (p.available_until is null or p.available_until >= current_date)
  -- min>0(遠出): リング[min,radius]を「ランダム標本」で返す＝距離が全域(例:96〜120km)に散る。
  --   最遠だけをlimitで拾うと全て外縁(120km付近の2km幅)に密集するため、母集団を全域から取り、
  --   遠寄りの並べ替え(遠リングの層化スプレッド)はアプリ側(spatial-search/route)で行う。
  --   min=0(近め/通常): 従来どおり最寄り順。
  order by (case when min_radius_m > 0 then random() else distance_m end) asc
  limit result_limit;
end;
$$;
