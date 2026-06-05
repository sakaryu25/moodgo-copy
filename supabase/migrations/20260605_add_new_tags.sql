-- ─────────────────────────────────────────────────────────────────────────────
-- MoodGo タグ体系 v2 マイグレーション
-- 実行方法: Supabase Studio > SQL Editor に貼り付けて Run
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. 体動かしたい 系タグの追加・変換 ──────────────────────────────────────
-- 屋外スポーツ → #外で運動 を追加（既存タグは保持）
UPDATE places
SET tags = array_append(tags, '#外で運動')
WHERE '#屋外スポーツ' = ANY(tags)
  AND NOT '#外で運動' = ANY(tags);

-- スポーツ → #外で運動 を追加
UPDATE places
SET tags = array_append(tags, '#外で運動')
WHERE '#スポーツ' = ANY(tags)
  AND NOT '#外で運動' = ANY(tags)
  AND NOT '#外で運動' = ANY(tags);

-- ガッツリ運動 → #室内で運動 を追加（ジム・プール系は室内と判断）
UPDATE places
SET tags = array_append(tags, '#室内で運動')
WHERE '#ガッツリ運動' = ANY(tags)
  AND NOT '#室内で運動' = ANY(tags);

-- ボウリング・体験型ゲーム → #ゲーム感覚で運動 を追加
UPDATE places
SET tags = array_append(tags, '#ゲーム感覚で運動')
WHERE ('#ボウリング' = ANY(tags) OR '#体験型ゲーム' = ANY(tags))
  AND NOT '#ゲーム感覚で運動' = ANY(tags);

-- ─── 2. 焼肉 タグ ────────────────────────────────────────────────────────────
-- #焼肉 かつ 食べ放題・高級 以外のお店に #焼肉単品 を追加
UPDATE places
SET tags = array_append(tags, '#焼肉単品')
WHERE '#焼肉' = ANY(tags)
  AND NOT '#焼肉食べ放題' = ANY(tags)
  AND NOT '#高級焼肉' = ANY(tags)
  AND NOT '#焼肉単品' = ANY(tags);

-- ─── 3. カフェスイーツ → #フルーツ タグ追加 ─────────────────────────────────
-- カフェスイーツスポットに #フルーツ を追加
UPDATE places
SET tags = array_append(tags, '#フルーツ')
WHERE '#カフェスイーツ' = ANY(tags)
  AND NOT '#フルーツ' = ANY(tags);

-- ─── 4. ドライブ関連 → #道の駅 タグ ─────────────────────────────────────────
-- ご当地グルメ + ドライブ系スポット名に「道の駅」が含まれる場合
UPDATE places
SET tags = array_append(tags, '#道の駅')
WHERE '#ご当地グルメ' = ANY(tags)
  AND (name ILIKE '%道の駅%')
  AND NOT '#道の駅' = ANY(tags);

-- ─── 5. ショッピング 系タグ追加 ──────────────────────────────────────────────
-- ショッピング全般に #服アクセサリー #雑貨インテリア 等は手動付与が必要なため、
-- ショッピングタグ持ちスポットに大括りで #ショッピング を確認（既存確認のみ）
-- ※ 細分化タグ (#服アクセサリー, #雑貨インテリア, #コスメ美容, #お土産ギフト) は
--   各スポットを見て管理画面から手動で付けてください

-- ─── 6. 補足タグ: カラオケ・ダーツ・ビリヤード・ボウリング ───────────────────
-- 既存の体験型ゲームスポットに補足タグを付ける
UPDATE places
SET tags = array_append(tags, '#カラオケ')
WHERE name ILIKE '%カラオケ%'
  AND NOT '#カラオケ' = ANY(tags);

UPDATE places
SET tags = array_append(tags, '#ボウリング')
WHERE name ILIKE '%ボウリング%'
  AND NOT '#ボウリング' = ANY(tags);

UPDATE places
SET tags = array_append(tags, '#ダーツ')
WHERE name ILIKE '%ダーツ%'
  AND NOT '#ダーツ' = ANY(tags);

UPDATE places
SET tags = array_append(tags, '#ビリヤード')
WHERE name ILIKE '%ビリヤード%'
  AND NOT '#ビリヤード' = ANY(tags);

-- ─── 確認クエリ（実行後に件数確認）──────────────────────────────────────────
SELECT
  UNNEST(ARRAY[
    '#外で運動', '#室内で運動', '#ゲーム感覚で運動',
    '#焼肉単品', '#フルーツ', '#道の駅',
    '#カラオケ', '#ボウリング', '#ダーツ', '#ビリヤード'
  ]) AS tag,
  COUNT(*) FILTER (WHERE tag = ANY(tags)) AS place_count
FROM UNNEST(ARRAY[
  '#外で運動', '#室内で運動', '#ゲーム感覚で運動',
  '#焼肉単品', '#フルーツ', '#道の駅',
  '#カラオケ', '#ボウリング', '#ダーツ', '#ビリヤード'
]) AS t(tag)
CROSS JOIN places
GROUP BY tag
ORDER BY tag;
