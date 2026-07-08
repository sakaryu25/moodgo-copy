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

-- ID変更の2週間ロック（2026-07-06追加）:
--   handle を変更したら14日間は再変更不可。次に変更できる時刻を保持する。
--   null = まだ一度も変更していない（初回設定はロック対象外＝いつでも変更可）。
--   ※コード側は列が無くてもフォールバック動作するが、この列があるとロックが有効になる。
alter table user_handles add column if not exists locked_until timestamptz;

-- 一言メッセージ(bio・2026-07-08追加): プロフィールに公開表示する自己紹介（80字以内・API側で検証）。
--   列が無くてもコードはフォールバックする（bioは保存されず表示されないだけ）。
alter table user_handles add column if not exists bio text;

-- クライアントは匿名キーを持たずAPI(service_role)経由のみ。防御層としてRLS有効化。
alter table user_handles enable row level security;
