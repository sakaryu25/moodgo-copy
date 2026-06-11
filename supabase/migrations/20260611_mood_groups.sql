-- ── 仲良しグループで「今の気分」をつぶやく機能 ──────────────────────────────
-- グループ（招待コードで参加）
create table if not exists mood_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by text not null,                 -- 作成者の device_id
  created_at timestamptz not null default now()
);

-- メンバー（端末ID＋ニックネーム。アカウント不要）
create table if not exists mood_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references mood_groups(id) on delete cascade,
  device_id text not null,
  nickname text not null,
  joined_at timestamptz not null default now(),
  unique (group_id, device_id)
);

-- 気分のつぶやき
create table if not exists mood_group_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references mood_groups(id) on delete cascade,
  device_id text not null,
  nickname text not null,
  mood text not null,                       -- 気分キー（例: まったり / 疲れた・眠い）
  comment text,                             -- 一言（任意）
  created_at timestamptz not null default now()
);

create index if not exists idx_mood_group_members_device on mood_group_members (device_id);
create index if not exists idx_mood_group_posts_group_time on mood_group_posts (group_id, created_at desc);
