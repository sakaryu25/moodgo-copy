-- ─── 認証 / 店舗アカウントの種別（2026-07-09）────────────────────────────────────
-- user_handles に account_type を追加。プロフィール等に認証/店舗バッジを表示する機構。
--   user     … 一般（既定）
--   store    … 店舗アカウント（有料掲載/事業連動で付与）
--   official … 公式・認証アカウント
alter table user_handles add column if not exists account_type text not null default 'user';

-- 付与例（admin が手動、または有料掲載と連動して）:
--   update user_handles set account_type = 'store'    where handle = 'your_shop_id';
--   update user_handles set account_type = 'official' where handle = 'moodgo_official';
