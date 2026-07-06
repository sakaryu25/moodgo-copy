-- ─── 未使用テーブル整理（2026-07-06 全37テーブル+8RPC監査の結果）──────────────
-- 監査方法: 本番PostgRESTの全テーブル一覧×リポジトリ全体のコード参照
--   (.from()/.rpc()/REST /rest/v1/・/rpc/・SQL関数本体・FK) を突き合わせ。
--
-- 結論: 削除して安全なのは hotpepper_sync_logs の1つだけ。
--   - 0行・コード参照ゼロ（唯一の言及は作成時のmigrationファイルのみ）
--   - HotPepper連携は全削除済み（再導入予定なし）
--   - 他テーブルからのFKなし・RPC関数本体からの参照なし
--
-- ⚠ 0行でも消してはいけないテーブル（休眠中の計画機能・デプロイ直後）:
--   spot_posts / spot_post_reactions   … 穴場投稿・Moodログ（新機能・これから貯まる）
--   curated_spots                      … API実装済み・管理画面UIが未実装なだけ
--   featured_pages                     … 有料掲載パートナーページのデータモデル（事業計画）
--   blog_post_reports / closed_reports … 通報・閉店掃除パイプライン（通報が来たら書かれる）
--   freeword_rules                     … LLM蒸留学習（蓄積待ち）
--
-- Supabase SQL Editor で実行:

drop table if exists hotpepper_sync_logs;
-- （付随インデックス idx_sync_logs_genre_id / idx_sync_logs_created も自動削除される）

-- ─── 任意・今回は非推奨: places の HotPepper 残存列について ─────────────────
-- places.hotpepper_id / places.hotpepper_url、closed_reports.hotpepper_id は残す。
-- 理由: find_nearby_places RPC の returns table に hotpepper_url が含まれており、
--       列を消すとRPCが壊れる（消すならRPC再定義とコード側の型も同時に変更が必要）。
--       列自体の容量は無視できるレベルのため、触らないのが安全。
