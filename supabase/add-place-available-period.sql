-- ─── places に「期間限定の穴場」公開期間の列を追加 ──────────────────────────────
-- ユーザー投稿の穴場スポット(post.tsx → /api/spot-posts)で入力できる「期間限定の公開」を保存する列。
--   available_from  : 公開開始日（null=即日）
--   available_until : 公開終了日（null=無期限）
--
-- この2列が無くてもアプリ/APIは壊れない設計（spot-posts=耐性update / community-spot=列欠損フォールバック）だが、
-- この列を追加すると「期間限定の穴場」がplacesベースの新スポットでも保存・表示されるようになる。
-- Supabase の SQL Editor で1回実行すればOK（IF NOT EXISTS で再実行も安全）。

ALTER TABLE places ADD COLUMN IF NOT EXISTS available_from  date;
ALTER TABLE places ADD COLUMN IF NOT EXISTS available_until date;
