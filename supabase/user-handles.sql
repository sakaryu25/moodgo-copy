-- ─── ユーザーID（@ハンドル）─────────────────────────────────────────────────
-- ニックネーム下に表示する一意のユーザーID（2026-07-06）。
--   handle が主キー ＝ 同じIDは他の人が絶対に登録できない（DBレベルで保証）。
--   device_id unique ＝ 1端末につき1つのID（変更は行の更新）。
-- 形式はAPI側で検証: 半角英数と _ のみ・3〜20文字・小文字統一・予約語/NGワード拒否。
-- Supabase SQL Editor で実行:

create table if not exists user_handles (
  handle     text primary key,
  device_id  text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- クライアントは匿名キーを持たずAPI(service_role)経由のみ。防御層としてRLS有効化。
alter table user_handles enable row level security;
