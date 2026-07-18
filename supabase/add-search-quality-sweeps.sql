-- ⑪ 品質スイープの結果テーブル。/api/cron/quality-sweep が定点(気分×エリア)の件数・写真被覆・薄さを毎日保存する。
--   時系列で「どの気分×エリアが弱いか」「急に痩せた(回帰)」を可視化するための土台。未適用でもcronは動く(保存だけスキップ)。
CREATE TABLE IF NOT EXISTS search_quality_sweeps (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  swept_at   timestamptz NOT NULL DEFAULT now(),
  mood       text NOT NULL,
  area       text,
  lat        double precision,
  lng        double precision,
  count      int,           -- 返却件数
  photo_rate int,           -- 写真ありの割合(%)
  score      int,           -- 0-30 の簡易品質スコア
  thin       boolean,       -- 8件未満=薄い
  ok         boolean        -- 検索が成功したか(タイムアウト等はfalse)
);
CREATE INDEX IF NOT EXISTS idx_sqs_swept_at  ON search_quality_sweeps (swept_at DESC);
CREATE INDEX IF NOT EXISTS idx_sqs_mood_area ON search_quality_sweeps (mood, area);
