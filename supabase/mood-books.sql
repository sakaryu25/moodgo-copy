-- ─── Mood Book（2026-07-18）─────────────────────────────────────────────────
-- プロフィール「自分の投稿」を進化させる思い出BOOK機能。
--   ・mood_books      = BOOK本体（1ユーザー複数冊）
--   ・mood_book_pages = 1ページ=1スポット（元投稿の参照＋表示用スナップショット）
--   ⚠ device_id はベアラ資格情報のため生値は保存しない。
--     所有者 = deviceHash(sha256先頭16, lib/device-hash.ts) のみを保存する。
--   写真は既存投稿（spot_photos / suggestions.image_urls / blog_post_photos）の
--   公開URLを photo_urls へスナップショットし、閲覧時はAPIが元投稿から最新値へ
--   自動同期する（元投稿が削除されてもページはスナップショットで壊れない）。
--   独立の media テーブルは作らない（既存URLの参照のみで複製不要のため）。
--   未適用でもアプリは安全に動作（API側 42P01/PGRST205 フォールバックで空を返す）。
-- Supabase SQL Editor で実行:

-- ── 1) BOOK本体 ──────────────────────────────────────────────────────────────
create table if not exists mood_books (
  id              uuid primary key default gen_random_uuid(),
  device_hash     text not null,                     -- 所有者（16hex公開ハッシュ）
  title           text not null default '',
  description     text not null default '',
  cover_image_url text not null default '',          -- 空なら先頭ページの写真を表紙に使う
  visibility      text not null default 'private',   -- private | friends | public（v1表示は本人のみ）
  theme_key       text not null default '',          -- 将来のテーマ切替用（紙色など）
  page_count      int  not null default 0,           -- 非正規化（APIがページ増減時に更新）
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_mood_books_device on mood_books (device_hash, is_archived, updated_at desc);

-- ── 2) ページ（1ページ=1スポット）────────────────────────────────────────────
create table if not exists mood_book_pages (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null,
  -- 元投稿の参照（/api/my-posts のitem id形式: 穴場=UUID / Moodログ=ml-UUID / ブログ=bp-UUID）
  post_id      text not null default '',
  place_key    text not null default '',             -- places UUID等（スポット詳細への遷移用・空可）
  page_order   int  not null default 0,
  layout_type  text not null default 'auto',         -- auto | single_photo | one_large_two_small | photo_and_text
  custom_title text not null default '',             -- 空なら元投稿のスポット名を表示
  custom_text  text not null default '',             -- 空なら元投稿の本文抜粋を表示
  -- ── 表示用スナップショット（元投稿の削除に耐える）──
  spot_name    text not null default '',
  area         text not null default '',             -- 都道府県などの短い場所表記
  excerpt      text not null default '',             -- 本文の抜粋
  photo_urls   text[] not null default '{}',
  mood_tags    text[] not null default '{}',
  visited_at   timestamptz,                          -- ページ日付（投稿日）
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_mbp_book on mood_book_pages (book_id, page_order);
-- 同じ投稿を同じBOOKへ二重追加しない（投稿由来ページのみ・自由ページは対象外）
create unique index if not exists uq_mbp_book_post on mood_book_pages (book_id, post_id) where post_id <> '';

-- ── 3) RLS（防御層）──────────────────────────────────────────────────────────
-- アクセスは全て Next.js API（service_role）経由。anonキーからは全拒否。
alter table mood_books enable row level security;
alter table mood_book_pages enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'mood_books' and policyname = 'service_only') then
    create policy service_only on mood_books for all using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'mood_book_pages' and policyname = 'service_only') then
    create policy service_only on mood_book_pages for all using (false) with check (false);
  end if;
end $$;
