-- トークの投票（行きたい/微妙）と絵文字リアクション用テーブル。
-- Supabase SQLエディタで実行。未実行でもアプリは動作する
-- （リアクション操作時に「準備中」と表示されるだけ）。
create table if not exists mood_group_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  group_id uuid not null,
  device_id text not null,
  rtype text not null check (rtype in ('vote', 'emoji')),  -- vote=行きたい/微妙, emoji=絵文字
  value text not null,                                     -- vote: 'want'|'meh' / emoji: '👍' など
  created_at timestamptz not null default now(),
  unique (post_id, device_id, rtype)                       -- 1投稿につき投票1つ＋絵文字1つまで
);
create index if not exists idx_mgr_post on mood_group_reactions (post_id);
create index if not exists idx_mgr_group on mood_group_reactions (group_id);
