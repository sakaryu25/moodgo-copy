-- ─── フォロー関係（2026-07-07）─────────────────────────────────────────────
-- 投稿者プロフィール（community-spotの投稿者タップ）からのフォロー/フォロー解除。
--   ⚠ device_id はベアラ資格情報のため生値は保存しない。
--     公開ID = deviceHash(sha256先頭16, lib/device-hash.ts) のみを両側に保存する。
--   未適用でもアプリは安全に動作（カウント0・フォローボタンは「準備中」扱い）。
-- Supabase SQL Editor で実行:

create table if not exists user_follows (
  id             uuid primary key default gen_random_uuid(),
  follower_hash  text not null,      -- フォローする人 (deviceHash)
  followee_hash  text not null,      -- フォローされる人 (deviceHash)
  created_at     timestamptz not null default now(),
  unique (follower_hash, followee_hash)   -- 二重フォロー防止
);

create index if not exists idx_user_follows_follower on user_follows (follower_hash);
create index if not exists idx_user_follows_followee on user_follows (followee_hash);

-- クライアントは匿名キーを持たずAPI(service_role)経由のみ。防御層としてRLS有効化。
alter table user_follows enable row level security;
