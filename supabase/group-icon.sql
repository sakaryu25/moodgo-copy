-- グループアイコン（絵文字）列。Supabase SQLエディタで実行。
-- 未実行でもアプリは動作する（アイコン変更時に「準備中」と表示されるだけ）。
alter table mood_groups add column if not exists icon text;
