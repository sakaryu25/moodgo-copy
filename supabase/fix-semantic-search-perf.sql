-- ─── P1: match_places_semantic の性能修正 v2（意味検索の常時化キーストーン）──────────
-- 経緯: v1 は半径フィルタを ST_DWithin(location::geography) に直したが、渋谷など超高密度エリアでは
--   半径5〜20km内に数万件が入り、その全件を厳密kNN(embedding <=> query)でソートすると8秒の
--   statement timeout を超えて落ちていた（@1kmは動くが@5km以上でtimeout・実測）。HNSW索引が無い環境でも
--   密集地で確実に速くするため、**先に「地理的に近い数千件」だけを地理KNN(GiST索引の <-> )で束ね、
--   その中だけを意味ベクトルで並べる**二段構えにする。位置ベースのアプリなので「近い中での意味最良」で十分。
-- これで HNSW/Pro プラン無しでも、どのエリア・半径でもサブ秒で応答する。返却型・引数は不変=後方互換。
--
-- ⚠ Supabase SQL Editor で「この関数を再実行」してください（v1適用済でも create or replace で上書き）。
--   適用後、Vercel環境変数 RECOMMEND_SEMANTIC_ALWAYS=1 で「気分だけ検索でも常時セマンティック融合」を有効化。

-- 前提索引: 地理KNN( location <-> point )が索引スキャンになるよう geometry型のGiST索引を保証する
--   （ベクトル用HNSWと違い軽量＝数秒で作成・FREEプランでも可）。既にあれば無害(IF NOT EXISTS)。
create index if not exists idx_places_location_gist on places using gist (location);

create or replace function match_places_semantic(
  query_embedding vector(1536),
  user_lat double precision,
  user_lng double precision,
  radius_m double precision,
  match_limit int default 30
) returns table (place jsonb, distance_m double precision, similarity double precision)
language plpgsql stable as $$
declare
  user_geom geometry := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326);
begin
  return query
  -- ① 地理的に近い候補だけを GiST の KNN( <-> ) で束ねる（索引スキャン＝密集地でも高速・上限4000件）
  with cand as materialized (
    select p.id, p.embedding, p.location, (to_jsonb(p) - 'embedding') as pj
    from places p
    where p.is_active = true
      and p.embedding is not null
      and p.location is not null
    order by p.location <-> user_geom
    limit 4000
  )
  -- ② その候補の中で「半径内」かつ「意味が近い順」に並べて返す（ベクトル計算は最大4000件＝軽い）
  select
    c.pj as place,
    ST_Distance(c.location::geography, user_geom::geography) as distance_m,
    (1 - (c.embedding <=> query_embedding)) as similarity
  from cand c
  where ST_DWithin(c.location::geography, user_geom::geography, radius_m)
  order by c.embedding <=> query_embedding
  limit match_limit;
end;
$$;
