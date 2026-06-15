-- ─── 有料掲載（スポンサー枠）のデータモデル ─────────────────────────────────
-- 店舗からの有料掲載モデルの土台。places に「これは有料枠か／掲載期間／課金状態／
-- 広告主」を表す列を追加する。すべて NULL 許容なので既存スポットは無改修で『非スポンサー』。
--
-- recommend は billing_status='active' かつ paid_from<=今日<=paid_until のスポットを
-- 関連度(気分タグ)・距離(半径内)を満たす範囲で上位に確保し、PR/広告ラベルを付けて表示する。
-- 景表法・ストア審査の広告明示要件のため、表示側で必ず PR バッジを出すこと。
--
-- 適用後、lib/sponsored.ts のフェッチが有効化される（列が無い間は no-op）。

alter table places add column if not exists sponsor_tier   text;   -- 例: 'gold' | 'silver' | null(非スポンサー)。並び優先度に使用
alter table places add column if not exists paid_from      date;   -- 掲載開始日（含む）
alter table places add column if not exists paid_until     date;   -- 掲載終了日（含む）
alter table places add column if not exists billing_status text;   -- 'active' | 'paused' | 'unpaid' | null
alter table places add column if not exists advertiser_id  text;   -- 広告主（店舗オーナー）識別子。レポート/本人確認に使用

-- アクティブなスポンサー枠の絞り込みに使う部分索引（active のみ）
create index if not exists idx_places_sponsor_active
  on places (billing_status, paid_until)
  where billing_status = 'active';

-- 参考: 今日有効なスポンサー枠
-- select id, name, sponsor_tier, advertiser_id from places
-- where billing_status='active' and (paid_from is null or paid_from <= current_date)
--   and (paid_until is null or paid_until >= current_date);
