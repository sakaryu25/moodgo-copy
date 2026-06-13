-- ═══════════════════════════════════════════════════════════════════════════
-- MoodGo 未実行SQL まとめ版（5ファイル結合）
--   Supabase ダッシュボード → SQL Editor → New query に貼り付けて Run。
--   すべて「if not exists」なので何回流しても安全（既にあればスキップ）。
--   未実行でもアプリはクラッシュせず、該当機能だけ静かにスキップされる。
-- ───────────────────────────────────────────────────────────────────────────
--   ① learning-tables    … AI自己学習（暗黙フィードバック / 自由ワード蒸留）
--   ② group-features     … トークの投票😍😕＋絵文字リアクション
--   ③ group-icon         … グループのアイコン変更
--   ④ group-reply        … トーク長押し「返信」の引用表示
--   ⑤ suggestion-poster  … 穴場フィードの投稿者アイコン＋名前
-- ═══════════════════════════════════════════════════════════════════════════


-- ① ─── AI成長ループ用テーブル ──────────────────────────────────────────────
--   実行で有効化: 暗黙フィードバック学習 / 自由ワードLLM解釈ログ / 昇格ルール

-- 暗黙フィードバック（検索結果への行動ログ）
create table if not exists spot_engagement (
  id uuid primary key default gen_random_uuid(),
  place_name text not null,
  mood text,
  action text not null check (action in ('map_click','detail_view','favorite','visited','share')),
  created_at timestamptz not null default now()
);
create index if not exists idx_spot_engagement_mood_name on spot_engagement (mood, place_name);
create index if not exists idx_spot_engagement_created on spot_engagement (created_at desc);

-- 自由ワードのLLM解釈ログ（頻出パターン分析→ルール昇格の材料）
create table if not exists freeword_interpretations (
  id uuid primary key default gen_random_uuid(),
  freeword_norm text not null,
  freeword_raw text,
  interpretation jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_fw_interp_norm on freeword_interpretations (freeword_norm);

-- 昇格ルール（一致したらLLMを呼ばず構造化検索へ直行）
create table if not exists freeword_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,
  text_hint text,
  skip_llm boolean default false,
  enabled boolean default true,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_fw_rules_enabled on freeword_rules (enabled);


-- ② ─── トークの投票＋絵文字リアクション ────────────────────────────────────
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


-- ③ ─── グループアイコン（絵文字）列 ────────────────────────────────────────
alter table mood_groups add column if not exists icon text;


-- ④ ─── トークの「返信（引用）」用の列 ──────────────────────────────────────
alter table mood_group_posts add column if not exists reply_to_name text;
alter table mood_group_posts add column if not exists reply_to_text text;


-- ⑤ ─── 穴場投稿に「投稿者」を紐付ける列 ────────────────────────────────────
alter table suggestions add column if not exists device_id  text;
alter table suggestions add column if not exists poster_name text;

-- ═══════════════════════════════════════════════════════════════════════════
-- 完了。Run後、トークの投票/リアクション/アイコン/返信引用・穴場の投稿者表示・
-- AI学習がすべて本稼働します。
-- ═══════════════════════════════════════════════════════════════════════════
