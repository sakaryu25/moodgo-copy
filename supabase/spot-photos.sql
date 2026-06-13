-- ─── 心霊スポットなどへの利用者投稿写真 ──────────────────────────────────────
-- 誰でもその場で写真を追加でき、削除は管理者のみ（adminのDELETE）。
-- Supabase SQL Editor で実行。未実行でも /api/spot-photo は「準備中」を返すだけで安全。
-- 画像本体は Storage バケット spot-photos に保存され、URLをここに記録する。
create table if not exists spot_photos (
  id uuid primary key default gen_random_uuid(),
  place_id text,                 -- placesのUUID（あれば。地名POI心霊スポットは sb- 除去後のUUID）
  place_name text,               -- スポット名（place_id照合できない場合のフォールバック）
  image_url text not null,       -- Storage公開URL
  storage_path text,             -- 削除用のStorage内パス
  device_id text,                -- 投稿者の端末ID
  created_at timestamptz not null default now()
);
create index if not exists idx_spot_photos_place_id on spot_photos (place_id);
create index if not exists idx_spot_photos_place_name on spot_photos (place_name);
create index if not exists idx_spot_photos_created on spot_photos (created_at desc);
