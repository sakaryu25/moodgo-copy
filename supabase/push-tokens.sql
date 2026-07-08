-- ─── プッシュトークン登録テーブル ────────────────────────────────────────────
-- 端末の Expo プッシュトークンを保持する（POST /api/push-token が upsert）。
-- 将来の配信（お気に入りスポットの近況・Moodログへの反応 等）の宛先。
-- token をユニークキーにし、端末の再インストールで新トークンが来ても重複しない。

create table if not exists push_tokens (
  token       text primary key,                  -- "ExponentPushToken[...]"
  device_id   text not null,
  platform    text,                              -- ios | android
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_push_tokens_device on push_tokens (device_id);

-- 公開ハッシュでの宛先解決用（フォロー通知は相手の生device_idを知らずハッシュしか持たないため）。
alter table push_tokens add column if not exists device_hash text;
create index if not exists idx_push_tokens_hash on push_tokens (device_hash);

-- 防御層（書き込みは service_role=API のみ）。
alter table push_tokens enable row level security;

-- 配信時の例（参考・サーバーから Expo Push API へ）:
--   select token from push_tokens where device_id = $1;
--   → https://exp.host/--/api/v2/push/send に {to: token, title, body} をPOST
