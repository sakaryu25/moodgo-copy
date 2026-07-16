-- ─────────────────────────────────────────────────────────────────────────────
-- 特集ページの「対象範囲(scope)・掲載位置(slot)・公開期間」＋「人気エリア」追加
--   仕様: 特集TOPを 神奈川(=ユーザー設定都道府県) / 関東(地方) / 全国 で切替可能にし、
--         Adminから hero / sub_1 / sub_2 / normal の掲載位置と公開期間を管理する。
--   既存の featured_pages_v2 / _moods / _spots はそのまま活かし、カラム追加のみ。
--   Supabase SQL Editor でそのまま実行してください（既存データは保持されます）。
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) featured_pages_v2 に scope / slot / 公開期間 を追加 ─────────────────────
ALTER TABLE featured_pages_v2
  -- 対象範囲: prefecture(都道府県) / region(地方) / nationwide(全国)
  ADD COLUMN IF NOT EXISTS scope_type    text        DEFAULT 'prefecture',
  -- 範囲キー: 既存データ(日本語県名)との整合を優先し日本語キーを使用
  --   prefecture → 「神奈川」「東京」等 / region → 「関東」「近畿」等 / nationwide → 「全国」
  ADD COLUMN IF NOT EXISTS scope_key     text        DEFAULT '',
  -- 掲載位置: hero(メイン) / sub_1(サブ左) / sub_2(サブ右) / normal(通常) / hidden(TOP非表示)
  ADD COLUMN IF NOT EXISTS slot_type     text        DEFAULT 'normal',
  -- 公開期間（NULL=制限なし）。is_active と併用: 表示条件は
  --   is_active AND (publish_start IS NULL OR publish_start <= now())
  --             AND (publish_end   IS NULL OR publish_end   >  now())
  ADD COLUMN IF NOT EXISTS publish_start timestamptz,
  ADD COLUMN IF NOT EXISTS publish_end   timestamptz;

-- 既存行の移行:
--   ・scope_key を prefecture からコピー
--   ・「全国」行は scope_type='nationwide'、地方名の行は 'region'
--   ・既存ページは各県の顔として使われてきたため slot_type='hero' に昇格
--     （同一scopeに複数heroがある場合、アプリは sort_order 昇順でカルーセル表示）
UPDATE featured_pages_v2 SET scope_key = COALESCE(NULLIF(scope_key, ''), prefecture) WHERE TRUE;
UPDATE featured_pages_v2 SET scope_type = 'nationwide' WHERE scope_key = '全国';
UPDATE featured_pages_v2 SET scope_type = 'region'
  WHERE scope_key IN ('北海道・東北','関東','中部','近畿','中国','四国','九州・沖縄');
UPDATE featured_pages_v2 SET slot_type = 'hero' WHERE slot_type = 'normal' OR slot_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_fp2_scope ON featured_pages_v2 (scope_type, scope_key, slot_type);

-- ── 2) 人気エリア（特集TOPの横スクロールカード）────────────────────────────────
CREATE TABLE IF NOT EXISTS popular_areas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,                 -- 例: 横浜
  description       text DEFAULT '',               -- 例: みなとみらい・中華街
  image_url         text DEFAULT '',
  scope_type        text NOT NULL DEFAULT 'prefecture',  -- どのタブで表示するか
  scope_key         text NOT NULL DEFAULT '',            -- 例: 神奈川 / 関東 / 全国
  -- タップ時の遷移: pref(その都道府県タブへ切替) / feature(特集ページを開く) / url(外部URL)
  destination_type  text NOT NULL DEFAULT 'pref',
  destination_value text DEFAULT '',               -- pref: 県名 / feature: featured_pages_v2.id / url: URL
  sort_order        int  DEFAULT 0,
  is_active         boolean DEFAULT true,
  start_at          timestamptz,                   -- NULL=制限なし
  end_at            timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_popular_areas_scope ON popular_areas (scope_type, scope_key, sort_order);

-- ── 3) 人気エリアの初期データ（存在しない場合のみ投入）───────────────────────────
INSERT INTO popular_areas (name, description, scope_type, scope_key, destination_type, destination_value, sort_order)
SELECT * FROM (VALUES
  ('横浜',   'みなとみらい・中華街',       'prefecture', '神奈川', 'pref', '神奈川', 1),
  ('鎌倉',   '歴史と自然のまち歩き',       'prefecture', '神奈川', 'pref', '神奈川', 2),
  ('湘南',   '海とカフェのリラックスタイム', 'prefecture', '神奈川', 'pref', '神奈川', 3),
  ('箱根',   '温泉と絶景でリフレッシュ',    'prefecture', '神奈川', 'pref', '神奈川', 4),
  ('江の島', '海辺の散策とグルメ',         'prefecture', '神奈川', 'pref', '神奈川', 5),
  ('東京',   '流行と文化の中心',           'region',     '関東',   'pref', '東京',   1),
  ('横浜',   'みなとみらい・中華街',       'region',     '関東',   'pref', '神奈川', 2),
  ('鎌倉',   '歴史と自然のまち歩き',       'region',     '関東',   'pref', '神奈川', 3),
  ('千葉',   '海と遊びの大型スポット',      'region',     '関東',   'pref', '千葉',   4),
  ('埼玉',   '自然と小江戸さんぽ',         'region',     '関東',   'pref', '埼玉',   5),
  ('北海道', '雄大な自然とグルメ',         'nationwide', '全国',   'pref', '北海道', 1),
  ('東京',   '流行と文化の中心',           'nationwide', '全国',   'pref', '東京',   2),
  ('京都',   '歴史と風情のまち',           'nationwide', '全国',   'pref', '京都',   3),
  ('大阪',   '食い倒れとエンタメ',         'nationwide', '全国',   'pref', '大阪',   4),
  ('沖縄',   '海とリゾートの島時間',       'nationwide', '全国',   'pref', '沖縄',   5),
  ('福岡',   '屋台とグルメの九州玄関',      'nationwide', '全国',   'pref', '福岡',   6)
) AS v(name, description, scope_type, scope_key, destination_type, destination_value, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM popular_areas);
