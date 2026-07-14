-- ── place-search 高速化: pg_trgm トライグラム索引（2026-07-15 QA監査#6）────────
-- 投稿画面の場所候補検索(/api/place-search)は name ILIKE '%語%' の中間一致で、
-- 索引が無いと places 全行スキャン＝コールド時7〜8秒かかる。
-- pg_trgm のGIN索引で ILIKE '%…%' が索引スキャンになり数百ms級に短縮される。
-- 適用: Supabase SQL Editor でこのファイルを実行（数十秒・オンラインで安全）。
create extension if not exists pg_trgm;

-- 名前の中間一致用（place-search / admin検索の name ilike が対象）
create index if not exists idx_places_name_trgm
  on places using gin (name gin_trgm_ops);

-- 住所の中間一致用（admin search-places の address ilike も速くなる・任意だが推奨）
create index if not exists idx_places_address_trgm
  on places using gin (address gin_trgm_ops);
