-- ═══════════════════════════════════════════════════════════════════════════
-- MoodGo DB蓄積強化（検索のたびに貯まる仕組み）
--   Supabase SQL Editor で実行。すべて idempotent（if not exists）。
--   未実行でも各機能は「保存をスキップ」して安全に動く。
-- ───────────────────────────────────────────────────────────────────────────
--   places.image_urls   … 写真を複数枚保存（詳細カルーセルの再取得ゼロ化／item3）
--   place_details       … 口コミ・電話・公式サイト・営業時間のキャッシュ（item6）
--   place_mood_affinity … 場所×気分の好まれ度（協調フィルタの素地／item8）
--   search_snapshots    … (気分×エリアグリッド)の結果スナップショット（item10）
--   ※ 最寄り駅/営業時間/座標/閉店フラグ は既存列(nearest_station/open_hours/
--     last_checked_at/lat/lng/report_count/is_active)を使うので追加不要。
-- ═══════════════════════════════════════════════════════════════════════════

-- item3: 写真を複数枚
alter table places add column if not exists image_urls text[];

-- item3続き: find_nearby_places RPC に image_urls を追加（保存した複数写真を検索結果に流す）。
-- 戻り型変更のため DROP→CREATE。既存の列・並びは維持し image_urls を photo_url の直後に追加。
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
  order by distance_m asc
  limit result_limit;
end;
$$;

-- item6: 詳細情報キャッシュ（Google Place Details の再取得削減）。
-- 口コミ・電話・サイト・営業時間・写真URL等をまるごとJSONで保存。30日キャッシュ。
create table if not exists place_details (
  place_key text primary key,           -- google_place_id（詳細はplaceIdで引くため）
  data jsonb not null,                  -- 詳細レスポンス(place)まるごと
  checked_at timestamptz not null default now()
);
create index if not exists idx_place_details_checked on place_details (checked_at desc);

-- item8: 場所×気分アフィニティ（エンゲージメント加重スコア）
create table if not exists place_mood_affinity (
  place_name text not null,
  mood text not null,
  score int not null default 0,         -- visited+5 / favorite+3 / share+3 / detail+1 / map+1
  updated_at timestamptz not null default now(),
  primary key (place_name, mood)
);
create index if not exists idx_affinity_mood_score on place_mood_affinity (mood, score desc);

-- item8用: アフィニティ加算（原子的 upsert）。エンゲージメントのたびに呼ぶ。
create or replace function bump_affinity(p_place text, p_mood text, p_delta int)
returns void language plpgsql as $$
begin
  insert into place_mood_affinity (place_name, mood, score, updated_at)
  values (p_place, p_mood, p_delta, now())
  on conflict (place_name, mood)
  do update set score = place_mood_affinity.score + p_delta, updated_at = now();
end;
$$;

-- item5: 通報→report_count加算→闾値でis_active=false（閉店/無効の自動掃除・原子的）
create or replace function increment_report_count(p_name text, p_threshold int default 3)
returns int language plpgsql as $$
declare new_count int;
begin
  update places
  set report_count = coalesce(report_count, 0) + 1,
      last_reported_at = now(),
      is_active = case when coalesce(report_count, 0) + 1 >= p_threshold then false else is_active end
  where name = p_name
  returning report_count into new_count;
  return coalesce(new_count, 0);
end;
$$;

-- item10: 検索スナップショット（同条件の再検索をパイプライン丸ごとスキップ）
create table if not exists search_snapshots (
  cache_key text primary key,           -- mood|areaGrid|radius|deepDive
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_snapshots_created on search_snapshots (created_at desc);
