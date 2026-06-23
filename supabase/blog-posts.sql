-- ─── ユーザーおすすめブログ投稿（管理者承認制）─────────────────────────────────
-- 目的: ユーザーが「おすすめの場所/お店」を写真付きブログ形式で投稿し、運営が承認した
--       ものだけを検索結果・ブログ一覧・スポット詳細に反映する。Google口コミ/写真依存を
--       下げ、ユーザーと一緒に場所DBを育てる。
-- 設計: spot_posts（短文Moodログ）とは別概念の「ブログ投稿」。実装パターン（device_id識別／
--       Storage／ライセンス宣言／承認ステータス／検索注入）は spot_posts を踏襲。
-- 認証: 本アプリにSupabase Authは無く device_id で識別。書き込みは全てNext.js API＝service_role
--       経由なので、承認/可視制御の実体はAPI層。RLSは多層防御として approved のみ read 許可。
-- 安全: 未適用でもアプリは従来動作（API側は列ガード/try-catchで安全）。Supabase SQL Editorで実行。

-- ── 1) blog_posts（ブログ本体）────────────────────────────────────────────────
create table if not exists blog_posts (
  id                   uuid primary key default gen_random_uuid(),
  device_id            text not null,             -- 投稿者(=ログイン相当)。Auth無くdevice_idで識別
  poster_name          text,                      -- 公開名（匿名表示も可）
  place_id             text,                      -- 既存places.id(sb-除去後) or google_place_id（紐づく場合）
  title                text not null,             -- タイトル
  caption              text,                      -- ひとこと（短い要約）
  body                 text,                      -- ブログ本文（長文）
  place_name           text,                      -- 場所名/お店名
  address              text,                      -- 住所
  area                 text,                      -- エリア
  lat                  double precision,
  lng                  double precision,
  google_place_id      text,                      -- 任意
  google_maps_url      text,                      -- 任意
  official_url         text,                      -- 任意
  instagram_url        text,                      -- 任意
  mood_tags            text[] default '{}',       -- 気分タグ（#まったりしたい等）
  scene_tags           text[] default '{}',       -- ジャンルタグ（#カフェスイーツ等）
  companion_tags       text[] default '{}',       -- 誰と（#1人 #友達 #恋人 等）
  budget_level         text,                      -- 予算感（#無料 #〜3000 等 or 自由文）
  visibility           text default 'public',     -- public（基本公開）
  approval_status      text default 'pending',    -- pending|approved|rejected|hidden
  is_searchable        boolean default false,     -- 検索結果に出すか（管理者がapprove時にtrue）
  can_use_as_spot_source boolean default false,   -- 新スポット候補/写真源として使うか（管理者判断）
  approved_by          text,                      -- 承認した管理者
  approved_at          timestamptz,
  rejected_reason      text,
  report_count         int  default 0,            -- 通報数（閾値超で自動hidden）
  helpful_count        int  default 0,            -- 参考になった
  like_count           int  default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz default now()
);
create index if not exists idx_blog_posts_status   on blog_posts (approval_status, is_searchable, created_at desc);
create index if not exists idx_blog_posts_place     on blog_posts (place_id);
create index if not exists idx_blog_posts_device    on blog_posts (device_id);
create index if not exists idx_blog_posts_mood      on blog_posts using gin (mood_tags);

-- ── 2) blog_post_photos（投稿写真 1〜10枚）────────────────────────────────────
create table if not exists blog_post_photos (
  id                   uuid primary key default gen_random_uuid(),
  blog_post_id         uuid not null,
  photo_url            text not null,
  storage_path         text,
  photo_order          int  default 0,            -- 表示順（0=メイン）
  can_use_as_spot_photo boolean default false,    -- スポット写真として再利用OK（承認後に管理者がtrue）
  license_declared     boolean default true,      -- 権利確認済み（投稿時に必須）
  moderation_status    text default 'pending',    -- approved|pending|rejected|hidden
  created_at           timestamptz not null default now()
);
create index if not exists idx_blog_post_photos_post on blog_post_photos (blog_post_id, photo_order);
create index if not exists idx_blog_post_photos_reuse on blog_post_photos (moderation_status, can_use_as_spot_photo);

-- ── 3) blog_post_reactions（参考になった/いいね/保存。二重防止）──────────────────
create table if not exists blog_post_reactions (
  id            uuid primary key default gen_random_uuid(),
  blog_post_id  uuid not null,
  device_id     text not null,
  reaction_type text not null,             -- helpful|like|save
  created_at    timestamptz not null default now(),
  unique (blog_post_id, device_id, reaction_type)
);
create index if not exists idx_blog_post_reactions_post on blog_post_reactions (blog_post_id);

-- ── 4) blog_post_reports（通報。理由を保持し閾値で自動hidden）──────────────────
create table if not exists blog_post_reports (
  id            uuid primary key default gen_random_uuid(),
  blog_post_id  uuid not null,
  device_id     text,
  reason        text,                      -- 無断転載/Google由来/不適切/個人情報/無関係/スパム
  created_at    timestamptz not null default now()
);
create index if not exists idx_blog_post_reports_post on blog_post_reports (blog_post_id);

-- ── 5) RLS（防御層。本体のアクセス制御はNext.js API＝service_role経由）──────────
alter table blog_posts          enable row level security;
alter table blog_post_photos    enable row level security;
alter table blog_post_reactions enable row level security;
do $$ begin
  create policy blog_posts_public_read on blog_posts for select
    using (approval_status = 'approved' and visibility = 'public');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy blog_post_photos_public_read on blog_post_photos for select
    using (moderation_status = 'approved');
exception when duplicate_object then null; end $$;
-- insert/update/delete は service_role のみ（ポリシー未定義＝anon不可）。

-- ── 6) リアクション加算RPC（原子的・任意。未作成でもAPIはread→+1でフォールバック）──
create or replace function increment_blog_post_counter(p_post uuid, p_col text)
returns void language plpgsql as $$
begin
  if p_col = 'helpful_count' then
    update blog_posts set helpful_count = coalesce(helpful_count,0)+1 where id = p_post;
  elsif p_col = 'like_count' then
    update blog_posts set like_count = coalesce(like_count,0)+1 where id = p_post;
  elsif p_col = 'report_count' then
    update blog_posts set report_count = coalesce(report_count,0)+1 where id = p_post;
  end if;
end; $$;

-- 参考: 検索注入対象（承認済み・検索可・通報少）
-- select * from blog_posts
-- where approval_status='approved' and is_searchable and coalesce(report_count,0) < 5
--   and mood_tags && array['#まったりしたい']  -- 気分一致
-- order by created_at desc;
