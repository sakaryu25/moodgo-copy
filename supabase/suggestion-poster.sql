-- 穴場投稿に「投稿者」を紐付けるための列。Supabase SQLエディタで実行。
-- 未実行でもアプリは動作する（投稿者欄が従来の「MoodGoユーザー」のままになるだけ）。
-- 実行すると、新規投稿に投稿者の端末ID＋名前が記録され、
-- フィードの投稿者アイコン（user-icons/{device_id}.jpg）と名前が反映される。
alter table suggestions add column if not exists device_id  text;
alter table suggestions add column if not exists poster_name text;
