-- ─── user_blocks: ブロック / ミュート（2026-07-08）──────────────────────────────
-- UGCアプリのApp Store審査で必須の「嫌なユーザーを遮断する手段」。
-- device_id はベアラ資格情報のため生値を保存しない。blocker/blocked とも
-- deviceHash(sha256先頭16) で持つ（= poster_id と同じ公開識別子）。
--   kind='block' … フォロー相互解除＋自分のフィード/コメントから完全非表示
--   kind='mute'  … 相手に気づかれず、自分のフィード/コメントから静かに非表示
create table if not exists user_blocks (
  id           uuid primary key default gen_random_uuid(),
  blocker_hash text not null,
  blocked_hash text not null,
  kind         text not null default 'block',   -- block | mute
  created_at   timestamptz not null default now(),
  unique (blocker_hash, blocked_hash)
);
create index if not exists idx_user_blocks_blocker on user_blocks (blocker_hash);
create index if not exists idx_user_blocks_blocked on user_blocks (blocked_hash);

-- クライアントは匿名keyを持たず、全アクセスは Next.js API(service_role)経由。
-- 防御層として RLS を有効化し、匿名/authロールからは一切触れないよう全拒否する。
alter table user_blocks enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'user_blocks' and policyname = 'service_only'
  ) then
    create policy service_only on user_blocks for all using (false) with check (false);
  end if;
end $$;
