-- ─── コンバージョン計測（ファネル）───────────────────────────────────────────
-- spot_engagement を「1検索→詳細→ナビ→来店」を店舗ID・ユーザー・検索単位で
-- 再構成できるよう拡張する。これにより
--   ・有料掲載のレポート（あなたの店: 表示N回 / 詳細N回 / ナビN回）
--   ・リテンション/ファネル分析（impression→detail_view→map_click→visited）
--   ・学習ループの精度（同名店の混線を place_id で解消）
-- が可能になる。すべて NULL 許容なので既存の書き込み（place_name のみ）は無改修で動く。
--
-- 適用後、/api/engagement が place_id/device_id/search_id/position も保存する。

alter table spot_engagement add column if not exists place_id   text;  -- places.id(UUID) または Google Place ID（同名店の混線解消）
alter table spot_engagement add column if not exists device_id  text;  -- 端末ID（ユーザー単位ファネル・継続率）
alter table spot_engagement add column if not exists search_id  text;  -- 1検索を識別（検索→詳細→来店の経路再構成）
alter table spot_engagement add column if not exists position   int;   -- 検索結果での掲載順位（impression品質・有料枠効果測定）

-- 集計でよく使うキーに索引
create index if not exists idx_spot_engagement_place_id  on spot_engagement (place_id);
create index if not exists idx_spot_engagement_device_id on spot_engagement (device_id);
create index if not exists idx_spot_engagement_search_id on spot_engagement (search_id);

-- 参考: 店舗別ファネル集計の例
-- select place_id,
--   count(*) filter (where action='detail_view') as details,
--   count(*) filter (where action='map_click')   as nav,
--   count(*) filter (where action='visited')      as visits
-- from spot_engagement where place_id is not null group by place_id order by details desc;
