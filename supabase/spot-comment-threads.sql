-- ─── コメントの返信(1階層)＋いいね（2026-07-09）──────────────────────────────────
-- spot_comments に parent_id(返信先) と like_count を追加し、spot_comment_reactions で
-- コメントいいねの二重防止＋集計を持つ。
alter table spot_comments add column if not exists parent_id uuid;
alter table spot_comments add column if not exists like_count int not null default 0;
create index if not exists idx_spot_comments_parent on spot_comments (parent_id);

create table if not exists spot_comment_reactions (
  id         uuid primary key default gen_random_uuid(),
  comment_id uuid not null,
  device_id  text not null,
  created_at timestamptz not null default now(),
  unique (comment_id, device_id)
);
create index if not exists idx_scr_comment on spot_comment_reactions (comment_id);

alter table spot_comment_reactions enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'spot_comment_reactions' and policyname = 'service_only'
  ) then
    create policy service_only on spot_comment_reactions for all using (false) with check (false);
  end if;
end $$;
