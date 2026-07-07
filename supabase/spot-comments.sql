-- ─── 投稿へのコメント（2026-07-08）─────────────────────────────────────────
-- 全国みんなの穴場/Moodログの投稿への1階層コメント（返信なし）。
--   post_id は suggestions.id / spot_posts.id のどちらも入る（FKなし・spot_post_reactionsと同思想）。
--   ⚠ device_id は資格情報だが「本人の削除権確認」に必要なので保存する。
--     APIレスポンスには deviceHash と @handle のみ出す（生値は返さない）。
--   未適用でもアプリは安全に動作（コメント欄は「準備中」表示）。
-- Supabase SQL Editor で実行:

create table if not exists spot_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null,          -- suggestions.id / spot_posts.id
  device_id  text not null,          -- コメント者（本人削除の照合用・レスポンスには出さない）
  body       text not null,          -- 本文（API側で1〜200文字・NGワード検証）
  status     text not null default 'visible',   -- visible | hidden（通報閾値で自動非表示）
  report_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_spot_comments_post on spot_comments (post_id, status, created_at desc);
create index if not exists idx_spot_comments_device on spot_comments (device_id);

-- クライアントは匿名キーを持たずAPI(service_role)経由のみ。防御層としてRLS有効化。
alter table spot_comments enable row level security;
