-- ── 検索結果のスポットをグループチャットに共有できるように ──────────────────
alter table mood_group_posts add column if not exists spot_name text;
alter table mood_group_posts add column if not exists spot_address text;
alter table mood_group_posts add column if not exists spot_url text;
