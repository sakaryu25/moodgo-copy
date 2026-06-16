-- ─── セマンティック検索（pgvector 埋め込み）#1 ────────────────────────────────
-- places を「名前＋説明＋タグ」のベクトルで意味検索できるようにする。
-- 自由ワード/気分の“意図”を、語彙が一致しなくても近傍検索でヒットさせる（MoodGoの看板機能）。
--   モデル: text-embedding-3-small（1536次元）。
-- ⚠ Supabaseの SQL Editor で実行してください。実行後、scripts/data-import/embed_places.py で
--   全 places の embedding を投入 → /api/recommend が match_places_semantic を呼ぶようになります。
--   （未適用・未投入でも recommend は graceful に従来検索へフォールバックします）

-- 1) pgvector 拡張
create extension if not exists vector;

-- 2) embedding カラム（1536次元）
alter table places add column if not exists embedding vector(1536);

-- 3) 近似最近傍インデックス（HNSW・cosine）。【任意・FREEプランでは作成不可】
--    ⚠ 209k×1536次元のHNSW構築は大きなRAMが必要で、Supabase FREE（共有CPU/少RAM・500MB上限）
--      では SQL Editor の上流タイムアウト(約1〜2分)で中断・ロールバックされる（＝作れない）。
--    ✅ 無くても match_places_semantic は動く: RPCは「半径で絞ってからベクトル順」なので、
--       近傍検索は半径内の数百〜数千件だけが対象＝実用速度。しかも厳密kNN＝再現率100%（HNSWは近似）。
--    → 当面は作成不要。recommend は graceful に動作する。
--    ▼ 作るなら Supabase Pro 等にアップグレード後、ダッシュボードではなく直接接続(psql)で:
--        psql "postgresql://postgres:<PASS>@db.<ref>.supabase.co:5432/postgres"
--        set statement_timeout = 0;            -- ゲートウェイのタイムアウト回避
--        set maintenance_work_mem = '512MB';   -- 構築を速く（プランの範囲で）
--        create index if not exists idx_places_embedding
--          on places using hnsw (embedding vector_cosine_ops);
--      （より軽い IVFFlat 代替: using ivfflat (embedding vector_cosine_ops) with (lists = 200);
--        query側で set ivfflat.probes = 20; で再現率調整）
-- create index if not exists idx_places_embedding
--   on places using hnsw (embedding vector_cosine_ops);

-- 4) 半径内のセマンティック近傍検索 RPC。
--    返却は to_jsonb(p)-'embedding'（巨大なベクトルは除外）＋距離＋類似度。
--    クライアントは place(jsonb) を NearbyPlaceRow として読み spatialSearch と同型に変換する。
create or replace function match_places_semantic(
  query_embedding vector(1536),
  user_lat double precision,
  user_lng double precision,
  radius_m double precision,
  match_limit int default 30
) returns table (place jsonb, distance_m double precision, similarity double precision)
language sql stable as $$
  select
    (to_jsonb(p) - 'embedding') as place,
    ST_DistanceSphere(ST_MakePoint(p.lng, p.lat), ST_MakePoint(user_lng, user_lat)) as distance_m,
    (1 - (p.embedding <=> query_embedding)) as similarity
  from places p
  where p.is_active = true
    and p.embedding is not null
    and p.lat is not null and p.lng is not null
    and ST_DistanceSphere(ST_MakePoint(p.lng, p.lat), ST_MakePoint(user_lng, user_lat)) <= radius_m
  order by p.embedding <=> query_embedding
  limit match_limit;
$$;

-- 5) 埋め込み一括投入用（embed_places.py が batch で呼ぶ）。id配列とvector文字列配列を受けて更新。
create or replace function set_place_embeddings(ids uuid[], embs text[])
returns int language plpgsql as $$
declare i int;
begin
  for i in 1 .. array_length(ids, 1) loop
    update places set embedding = embs[i]::vector where id = ids[i];
  end loop;
  return array_length(ids, 1);
end;
$$;
