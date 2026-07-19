-- ─── P1: match_places_semantic の性能修正 v3（意味検索の常時化キーストーン）──────────
-- 診断結果(EXPLAIN)で判明: geometry GiST索引(idx_places_location_gist)は存在し KNN( <-> )も索引スキャン。
--   だが places は513k件に成長し、GiST-KNNで4000件取るだけで2.6秒(Supabaseの共有IOで~0.65ms/行)。
--   さらに旧版は候補4000件すべての「全カラム＋embedding(各6KB)」を読み、20km密集地で8秒timeoutしていた。
-- v3の要点（どのエリア・半径でもサブ〜1.5秒に）:
--   ① 近い候補は「id＋location だけ」軽く束ねる(embeddingを読まない=KNNを軽量化)。上限1200件。
--   ② 先に半径で絞る（この時点でもembeddingを読まない）。
--   ③ 半径内の候補だけ embedding を読んで意味距離を計算し、上位 match_limit を選ぶ。
--   ④ 重い to_jsonb は最終 match_limit 件のみ。
--   ＝「近め」検索では読むembeddingが数百件で済み高速、密集20kmでも候補が1200件に上限され安定。
--   位置ベースのアプリなので「近い中での意味最良」で十分（遠方の意味一致より近さを優先）。
--
-- ⚠ Supabase SQL Editor で再実行してください（create or replace で上書き）。診断関数も掃除します。
--   適用後、Vercel環境変数 RECOMMEND_SEMANTIC_ALWAYS=1 で「気分だけ検索でも常時融合」を有効化。

drop function if exists _diag_semantic();

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
  with near as materialized (          -- ① 近い候補ID＋位置だけ（embeddingは読まない＝KNNを軽く）。上限1200。
    select p.id, p.location
    from places p
    where p.is_active = true and p.embedding is not null and p.location is not null
    order by p.location <-> user_geom
    limit 1200
  ),
  inrad as (                           -- ② 半径内に絞る（まだembeddingを読まない）。
    select n.id, ST_Distance(n.location::geography, user_geom::geography) as distance_m
    from near n
    where ST_DWithin(n.location::geography, user_geom::geography, radius_m)
  ),
  ranked as (                          -- ③ 半径内だけembeddingを読み意味距離で上位match_limitを選ぶ。
    select i.id, i.distance_m, (p.embedding <=> query_embedding) as vdist
    from inrad i join places p on p.id = i.id
    order by vdist
    limit match_limit
  )
  select (to_jsonb(p) - 'embedding') as place, r.distance_m, (1 - r.vdist) as similarity  -- ④ 最終行だけjsonb化。
  from ranked r join places p on p.id = r.id
  order by r.vdist;
end;
$$;
