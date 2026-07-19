-- ─── P1: match_places_semantic の性能修正（意味検索の常時化キーストーン）────────────
-- 問題: 既存 match_places_semantic は半径フィルタに
--   `ST_DistanceSphere(ST_MakePoint(p.lng, p.lat), ST_MakePoint(user_lng, user_lat)) <= radius_m`
--   を使っていた。これは p.lng/p.lat から都度 ST_MakePoint を作る式で、既存の空間索引
--   （GiST 関数索引 `(location::geography)` = fix-nearby-geography-index.sql）を一切使えず、
--   20万件を毎回フルスキャン → statement timeout(57014・実測~8.5秒)で**常に空を返す=看板機能が死んでいた**。
--
-- 修正: 高速な find_nearby_places と全く同じ索引フレンドリーな述語
--   `ST_DWithin(p.location::geography, user_geom::geography, radius_m)` に置換する。
--   これで半径フィルタが GiST 索引を使い、半径内の数百〜数千件だけに絞ってから
--   その集合に対して厳密kNN(embedding <=> query)を取る=「半径先行の厳密最近傍」で高速化。
--   ※ HNSW索引もProプランも不要（半径で絞るので厳密kNNでも軽い）。返却型・引数は不変=後方互換。
--
-- ⚠ Supabase SQL Editor で実行してください。適用後、Vercel環境変数 RECOMMEND_SEMANTIC_ALWAYS=1 で
--    「気分だけ検索でも常時セマンティック融合」を有効化できます（未設定=従来の在庫薄時のみ発火）。
create or replace function match_places_semantic(
  query_embedding vector(1536),
  user_lat double precision,
  user_lng double precision,
  radius_m double precision,
  match_limit int default 30
) returns table (place jsonb, distance_m double precision, similarity double precision)
language plpgsql stable as $$
declare
  user_geom geometry;
begin
  user_geom := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326);
  return query
  select
    (to_jsonb(p) - 'embedding') as place,
    ST_Distance(p.location::geography, user_geom::geography) as distance_m,
    (1 - (p.embedding <=> query_embedding)) as similarity
  from places p
  where p.is_active = true
    and p.embedding is not null
    and p.location is not null
    and ST_DWithin(p.location::geography, user_geom::geography, radius_m)   -- ← 索引を使う述語（本丸）
  order by p.embedding <=> query_embedding
  limit match_limit;
end;
$$;
