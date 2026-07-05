-- ─── 投稿(spot_posts)に 価格帯/おすすめ度/連絡先 の独立カラムを追加（2026-07-06）────
-- ⚠ データ設計の改善: 従来は「【目安価格】〜¥500」「【おすすめ度】★3」を説明文(caption)に
--    文字列で埋め込んでおり、検索カードの説明にそのまま出て後段の除去処理が必要だった。
--    → 独立カラムで保存し、表示側でバッジ等に整形する。caption には利用者の本文だけを入れる。
-- 未適用でもコードは安全（insert失敗時に新カラム無しで自動リトライ＝投稿は成功する）。
-- Supabase SQL Editor で実行:

alter table spot_posts add column if not exists price_chip text;      -- 例: 無料/〜¥500/〜¥1,000/〜¥3,000/¥3,000〜
alter table spot_posts add column if not exists price_note text;      -- 自由記入（例: ランチ800円、ディナー2,000円〜）
alter table spot_posts add column if not exists rating integer;       -- おすすめ度 1〜5（0/nullは未評価）
alter table spot_posts add column if not exists contact text;         -- 掲載連絡用（任意・特典送付先）
