-- トークの「返信（引用）」用の列。Supabase SQLエディタで実行。
-- 未実行でもアプリは動作する（返信時に引用が保存されないだけ）。
alter table mood_group_posts add column if not exists reply_to_name text;
alter table mood_group_posts add column if not exists reply_to_text text;
