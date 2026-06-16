-- ─── サーバー側エラー監視テーブル ────────────────────────────────────────────
-- recommend 等の fire-and-forget 書戻し/OpenAI生成/検索フローで起きた
-- 「想定外の」失敗を記録する（lib/server-log.ts の logServerError が書き込む）。
-- 列/テーブル未作成・該当行なし等の想定内エラーは記録側でフィルタ済み。
-- 管理画面 /admin/server-errors（GET /api/admin/server-errors）で閲覧する。

create table if not exists server_errors (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null,                 -- 失敗箇所の識別子（例: writeback.photo / describe_gen / recommend.fatal）
  message     text,                          -- エラーメッセージ（最大600字）
  code        text,                          -- DB/PostgREST/OpenAI のエラーコード（任意）
  meta        jsonb,                         -- 付帯情報（対象スポット名など）
  created_at  timestamptz not null default now()
);

create index if not exists idx_server_errors_created on server_errors (created_at desc);
create index if not exists idx_server_errors_scope   on server_errors (scope, created_at desc);

-- 防御層（書き込みは service_role=API のみ。匿名クライアントは触れない）。
alter table server_errors enable row level security;

-- 古いログの自動掃除は運用に応じて（例: 30日より古い行を定期削除）。
-- delete from server_errors where created_at < now() - interval '30 days';
