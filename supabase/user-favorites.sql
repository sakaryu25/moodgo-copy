-- ─── user_favorites: お気に入り(=行きたいリスト)のサーバー同期（2026-07-09）────────
-- 端末IDのKeychain永続化(SecureStore)と併せ、再インストールしてもお気に入りを復元できるようにする。
-- device_hash(公開ハッシュ)をキーに、item(表示用の全情報)をjsonbで丸ごと保持する。
create table if not exists user_favorites (
  id          uuid primary key default gen_random_uuid(),
  device_hash text not null,
  fav_key     text not null,        -- supabaseId | placeId | title（同一判定・sameFavと同思想）
  item        jsonb not null,       -- FavoriteItem 全体（画像・住所等の表示情報を含む）
  saved_at    timestamptz not null default now(),
  unique (device_hash, fav_key)
);
create index if not exists idx_user_favorites_device on user_favorites (device_hash);

-- 防御層: 全アクセスは Next.js API(service_role)経由。匿名/authロールは全拒否。
alter table user_favorites enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'user_favorites' and policyname = 'service_only'
  ) then
    create policy service_only on user_favorites for all using (false) with check (false);
  end if;
end $$;
