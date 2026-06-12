-- ─── AI成長ループ用テーブル（Supabase SQLエディタで実行）──────────────────────
-- 未実行でもアプリは動作する（該当機能が静かにスキップされるだけ）。
-- 実行すると有効になる機能:
--   ② spot_engagement        … 暗黙フィードバック学習（地図クリック/詳細閲覧/お気に入り/行った）
--   ③ freeword_interpretations … 自由ワードのLLM解釈ログ（蒸留の材料）
--   ③ freeword_rules          … 昇格ルール（一致したらLLMを呼ばず構造化検索へヒント）

-- ② 暗黙フィードバック（検索結果への行動ログ）
create table if not exists spot_engagement (
  id uuid primary key default gen_random_uuid(),
  place_name text not null,
  mood text,
  action text not null check (action in ('map_click','detail_view','favorite','visited','share')),
  created_at timestamptz not null default now()
);
create index if not exists idx_spot_engagement_mood_name on spot_engagement (mood, place_name);
create index if not exists idx_spot_engagement_created on spot_engagement (created_at desc);

-- ③ 自由ワードのLLM解釈ログ（頻出パターン分析→ルール昇格の材料）
create table if not exists freeword_interpretations (
  id uuid primary key default gen_random_uuid(),
  freeword_norm text not null,         -- 正規化済み（小文字・空白/句読点除去）
  freeword_raw text,
  interpretation jsonb,                -- {partySize, genres[], vibes[]}
  created_at timestamptz not null default now()
);
create index if not exists idx_fw_interp_norm on freeword_interpretations (freeword_norm);

-- ③ 昇格ルール（adminが手動昇格 or 将来の自動昇格）
--   pattern: freeWordに含まれていたら発火する部分文字列（例: '人で'は広すぎるので'7人'等）
--   text_hint: 構造化検索のGoogleテキストクエリに使うヒント（例: '個室 宴会できる居酒屋'）
--   skip_llm: trueならLLM(OpenAI)を呼ばず構造化検索に直行（高速・無料）
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

-- 動作確認用のサンプルルール（必要なければ削除可）
-- insert into freeword_rules (pattern, text_hint, note) values
--   ('宴会', '個室 宴会できる居酒屋', '宴会ワード→個室宴会店へ誘導');
