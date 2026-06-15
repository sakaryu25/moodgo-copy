-- ─── Moodログ投稿 ＋ 投稿写真のスポット写真再利用 ─────────────────────────────
-- 目的: ユーザー投稿で既存スポットの写真を増やし、Google写真依存を下げ、
--       MoodGo独自の「気分ベースの口コミ」(Google口コミ代用)と写真DBを育てる。
-- 設計: 既存 spot_photos(心霊用)を拡張して全スポットの写真資産として使う。
--       本文(気分口コミ)は spot_posts、リアクションは spot_post_reactions。
-- 未適用でもアプリは従来動作(API/recommendは列ガードで安全)。Supabase SQL Editorで実行。

-- ── 1) 既存 spot_photos を拡張（全列 default 付き＝既存の心霊投稿行を温存）──────
alter table spot_photos add column if not exists post_id uuid;                        -- 紐づくMoodログ(NULL=旧心霊投稿)
alter table spot_photos add column if not exists photo_source text default 'user_uploaded';   -- user_uploaded|store_provided|admin_uploaded
alter table spot_photos add column if not exists can_use_as_spot_photo boolean default true;  -- スポット写真として再利用OK
alter table spot_photos add column if not exists license_declared boolean default true;       -- 権利確認済み
alter table spot_photos add column if not exists moderation_status text default 'approved';   -- approved|pending|rejected|hidden（既存行はapprovedで表示継続）
alter table spot_photos add column if not exists is_primary boolean default false;            -- 代表写真
alter table spot_photos add column if not exists score int default 0;                         -- 代表選定スコア
alter table spot_photos add column if not exists report_count int default 0;
alter table spot_photos add column if not exists updated_at timestamptz default now();
create index if not exists idx_spot_photos_reuse on spot_photos (place_id, moderation_status, can_use_as_spot_photo);
create index if not exists idx_spot_photos_post on spot_photos (post_id);

-- ── 2) spot_posts（Moodログ本文＝気分口コミ）──────────────────────────────────
create table if not exists spot_posts (
  id uuid primary key default gen_random_uuid(),
  device_id   text not null,            -- 投稿者(=ログイン相当)。ログイン認証は無くdevice_idで識別
  poster_name text,                     -- 公開名(spot_public_anonymous時は匿名表示)
  place_id    text,                     -- placesのUUID(sb-除去後) or google_place_id
  place_name  text,
  caption     text,                     -- ひとこと
  mood_tags   text[] default '{}',      -- 気分タグ(#まったりしたい等)
  companion   text,                     -- ひとり/友達/恋人/家族/グループ
  visibility  text default 'spot_public_anonymous',  -- private|group|spot_public_anonymous|public
  group_id    uuid,                     -- visibility=group用
  time_of_day text,                     -- 朝/昼/夕方/夜（気分口コミ）
  want_revisit  boolean,                -- また行きたい
  matches_photo boolean,                -- 写真どおりの雰囲気だったか
  status      text default 'approved',  -- approved|pending|rejected|hidden（ハイブリッド承認）
  like_count    int default 0,
  helpful_count int default 0,          -- 参考になった
  revisit_count int default 0,          -- また行きたい(集計用・冗長)
  report_count  int default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_spot_posts_place   on spot_posts (place_id, status, visibility);
create index if not exists idx_spot_posts_device  on spot_posts (device_id);
create index if not exists idx_spot_posts_created on spot_posts (created_at desc);

-- ── 3) spot_post_reactions（いいね/参考になった/また行きたい の二重防止）────────
create table if not exists spot_post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id   uuid not null,
  device_id text not null,
  rtype     text not null,              -- like|helpful|revisit
  created_at timestamptz not null default now(),
  unique (post_id, device_id, rtype)
);
create index if not exists idx_spot_post_reactions_post on spot_post_reactions (post_id);

-- ── 4) RLS（防御層。本体のアクセス制御はNext.js API＝service_role経由）──────────
--   匿名(anon)キーがクライアントに渡る構成ではないが、念のため公開可視のみ select 許可。
alter table spot_posts          enable row level security;
alter table spot_post_reactions enable row level security;
do $$ begin
  create policy spot_posts_public_read on spot_posts for select
    using (status = 'approved' and visibility in ('spot_public_anonymous','public'));
exception when duplicate_object then null; end $$;
-- insert/update/delete は service_role のみ（ポリシー未定義＝anon不可）。spot_photos も同様運用。

-- ── 5) リアクションのカウンタ加算RPC（原子的・任意。未作成でもAPIはread→+1でフォールバック）──
create or replace function increment_spot_post_counter(p_post uuid, p_col text)
returns void language plpgsql as $$
begin
  if p_col = 'like_count' then
    update spot_posts set like_count = coalesce(like_count,0)+1 where id = p_post;
  elsif p_col = 'helpful_count' then
    update spot_posts set helpful_count = coalesce(helpful_count,0)+1 where id = p_post;
  elsif p_col = 'revisit_count' then
    update spot_posts set revisit_count = coalesce(revisit_count,0)+1 where id = p_post;
  end if;
end; $$;

-- 参考: あるスポットのスポット写真候補（再利用可能・承認済み）
-- select image_url from spot_photos
-- where place_id = '<uuid>' and moderation_status='approved' and can_use_as_spot_photo
-- order by is_primary desc, score desc, created_at desc;
