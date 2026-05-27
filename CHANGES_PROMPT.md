# MoodGo 最新アップデート内容（開発引き継ぎ・共有用）

このドキュメントは、MoodGo アプリに追加・変更した機能の詳細です。
友人・チームメンバーへの共有や、Claude への引き継ぎプロンプトとして使えます。

---

## プロジェクト概要

**MoodGo** は「今の気分に合ったお出かけスポットを提案する」お出かけアプリです。

- **フロントエンド**: Expo（React Native）→ `moodgo/` フォルダ
- **バックエンド API**: Next.js App Router → `app/api/` フォルダ
- **データベース**: Supabase（PostgreSQL + PostGIS）
- **デプロイ**: Vercel（`https://moodgo-main.vercel.app`）
- **GitHub**: `https://github.com/sakaryu25/moodgo`

---

## 今回追加・変更した機能

---

### ① HotPepper グルメ API 全国店舗一括登録システム

**目的**: 飲食店を Supabase に蓄積し、Google Places API コストを下げながら精度を上げる。

#### ファイル: `lib/hotpepper-sync-config.ts`

- **18ジャンル**対応（居酒屋・和食・洋食・イタリアン・中華・焼肉・韓国・アジア系・各国料理・ラーメン・お好み焼き・カフェスイーツ・高層料理・ダイニングバー・創作料理・鍋料理・その他グルメ）
- `generateJapanGrid()` 関数：日本全国を **約25,000〜30,000地点** のグリッドに分割
  - 全エリア **0.05°（約5.5km）刻み** に統一 → 3km 検索半径で完全カバー
  - 以前は地方で 15km 間隔 → 9km の空白地帯あり（今回解消）
  - 47都道府県庁所在地＋主要都市（50都市）に個別の高密度ゾーンを設定
- `assignTagsFromConfig()` 関数：ルールベースのタグ付け（OpenAI コスト不要）

**タグ体系**（`#お腹すいた` は全飲食店に必ず付与）:
```
居酒屋        → #居酒屋 + [#居酒屋個室 or #大衆酒場]
和食          → #和食 + [#海鮮 or #天ぷら or #うどんそば or #懐石料理]
洋食          → #洋食 + [#ハンバーグ or #オムライス or #ステーキ or #レトロ洋食]
焼肉          → #焼肉 + [#焼肉食べ放題 or #高級焼肉 or #焼肉単品あり]
アジア系統    → #アジア系統 + [#インドネパール料理 or #タイ料理 or #ベトナム料理 or #アジアンエスタニック料理]
各国料理      → #各国料理 + [#メキシコ料理 or #ブラジル料理 or #ロシア料理 or #他国料理]
ラーメン      → #ラーメン + [#こってりラーメン or #あっさりラーメン or #味噌ラーメン or #つけ麺まぜそば]
カフェスイーツ → #カフェスイーツ + [#スイーツカフェ or #喫茶店 or #流行りカフェ]
（全18ジャンル対応）
```

#### ファイル: `app/api/admin/hotpepper-sync/route.ts`

- `POST { secret, genreId, batchIndex, batchSize, dryRun }` でジャンル別バッチ同期
- 1グリッド点あたり最大300件取得（ページネーション対応）
- **2段階重複チェック**で同じ店を二重登録しない：
  1. `hotpepper_id` で一致チェック
  2. 名前+住所の先頭30文字が一致したら同一店舗とみなす
- タグはマージ（既存タグ + 新タグ）
- `GET` で現在のジャンル一覧と DB 登録件数を返す

#### 管理画面: `app/admin/page.tsx` HotPepperSyncPanel

- **「🚀 全18ジャンルを一括同期する」** ボタンで全ジャンルを順番に自動同期
- ⛔ 停止ボタンで途中停止可能（途中から再開可能）
- バッチ進捗バー・件数表示（「新規追加 1675件 / 更新 0件」形式）
- ジャンル別登録件数の統計表示
- ログ表示を改善（ダークターミナル廃止 → グレーのシンプルテキスト）

---

### ② PostGIS 高速空間検索システム

**目的**: 「現在地から〇〇km以内でタグが一致する店を近い順に取得」をミリ秒単位で実現。

#### Supabase で実行済みの SQL

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE places ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);
UPDATE places SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
WHERE lat IS NOT NULL AND lng IS NOT NULL;
CREATE INDEX idx_places_location_gist ON places USING GIST(location);
```

26,754件すべての lat/lng を location カラムに変換済み。

#### ファイル: `lib/spatial-search.ts`

```typescript
spatialSearch(opts)  // PostGIS → フォールバックの順で検索
```

**フォールバック設計**:
```
① PostGIS RPC find_nearby_places で検索
  ↓ 結果が少なければ
② タグを緩めて再検索（fallbackTags + 半径×1.5）
  ↓ まだ少なければ
③ 半径×2 で再検索
  ↓ それでも0件なら
④ 既存の searchPlacesByTags（ハバーサイン）にフォールバック
```

#### 全ルートへの適用

以下の全ルートで `spatialSearch` を使用するように変更済み：
`onsen` / `nature` / `waiwai` / `drive` / `focus` / `sports` / `travel` / `cafe` / `recommend`

---

### ③ 閉業自動検知システム（自浄作用）

#### 毎日自動チェック（Vercel Cron）

`vercel.json`:
```json
{ "crons": [{ "path": "/api/cron/vitality-check", "schedule": "0 18 * * *" }] }
```
→ 毎朝 3:00 JST に自動実行。Google Places API で `businessStatus` を確認。
`CLOSED_PERMANENTLY` → `is_active = false`（検索から即座に除外）

#### ユーザー検索のたびにバックグラウンドチェック

`lib/place-vitality-check.ts`:
- 検索結果を返した 3秒後に fire-and-forget で確認
- 7日以内チェック済みはスキップ（API コスト最大95%削減）

#### ユーザーによる手動報告

- 報告理由に「閉店・閉業」を追加
- `report_count` が 3件以上 → 自動的に `is_active = false`

---

### ④ 高層ビル料理フィルタ改善

**問題**: 「展望」という単語で公園（展望台）がヒットしていた

**修正** (`app/api/recommend/route.ts`):
1. Google Places API に `includedType: "restaurant"` を追加（根本解決）
2. NGワード強化: 「展望台」「展望所」「見晴台」「公園」「神社」「駅」「空港」など
3. ポジティブフィルタを厳格化:
   - 以前: 「展望」が含まれれば通過 → 「北台展望台」も通過してしまっていた
   - 修正後: 「展望レストラン」「展望ダイニング」などの**複合語**が必要

---

### ⑤ Google Places 結果の自動 Supabase 保存

**目的**: ユーザーが食ジャンルを選んで検索した際に Google Places / HotPepper から返ってきたお店を、自動でタグ付きして Supabase に蓄積する。次回以降は API を使わず Supabase から高速取得できる。

#### 仕組み

```
ユーザーが #居酒屋 を選んで検索
    ↓
HotPepper API / Google Places API が結果を返す（即座に表示）
    ↓（3秒後、バックグラウンドで）
autoSaveGooglePlaces() / autoSaveHotPepperShops() が実行される
    ↓
重複チェック（① google_place_id → ② 名前+住所先頭30文字）
    ↓
新規のみ Supabase に保存・タグ付与
    ↓
次回同じエリアで検索 → Supabase から返す（API コスト0）
```

#### ファイル: `lib/google-places-auto-save.ts`（NEW）

```typescript
// Google Places 結果を自動保存
autoSaveGooglePlaces(places, genreTag)
scheduleAutoSave(places, genreTag, delayMs)  // fire-and-forget ラッパー

// HotPepper ライブ結果を自動保存
autoSaveHotPepperShops(shops, genreTag)
scheduleHotPepperAutoSave(shops, genreTag, delayMs)  // fire-and-forget ラッパー

// 動的質問回答からジャンルタグを検出
detectFoodGenreTag(text)  // "居酒屋" → "#居酒屋"
```

**対応ジャンル（14種）と自動付与サブタグ**:

| ジャンルタグ | サブタグ判定ルール |
|---|---|
| #居酒屋 | 個室→#居酒屋個室、大衆→#大衆酒場 |
| #和食 | 海鮮/天ぷら/うどん/懐石 |
| #洋食 | ハンバーグ/オムライス/ステーキ/レトロ洋食 |
| #焼肉 | 食べ放題/高級/（default: #焼肉単品あり）|
| #アジア系統 | インド・ネパール/タイ/ベトナム/（default: #アジアンエスタニック料理）|
| #各国料理 | メキシコ/ブラジル/ロシア/（default: #他国料理）|
| #ラーメン | こってり/あっさり/味噌/つけ麺まぜそば |
| #カフェスイーツ | スイーツ系/喫茶店/（default: #流行りカフェ）|
| その他 | #イタリアン/#中華/#韓国/#お好み焼きもんじゃ/#高層ビル料理 |

**フックしている箇所**:
- `app/api/recommend/route.ts`：高層ビル料理（Google Places）
- `app/api/recommend/route.ts`：食ジャンル全般（HotPepper ライブ結果）

#### Supabase で実行が必要な SQL（1回だけ）

```sql
-- google_place_id カラムを追加（重複防止用）
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id text;

CREATE INDEX IF NOT EXISTS idx_places_google_place_id
  ON places(google_place_id)
  WHERE google_place_id IS NOT NULL;
```

---

## 環境変数（Vercel に設定が必要なもの）

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SUPABASE_URL` | ✅ | Supabase プロジェクト URL |
| `SUPABASE_SERVICE_KEY` | ✅ | Supabase サービスロールキー（RLS バイパス用）|
| `GOOGLE_PLACES_API_KEY` | ✅ | 閉業チェック・写真取得に使用 |
| `HOTPEPPER_API_KEY` | ✅ | HotPepper グルメ API キー |
| `ADMIN_SECRET` | ✅ | Admin ページ認証（デフォルト: `moodgoadmin123`）|
| `CRON_SECRET` | 推奨 | Vercel Cron 認証用（空でも動作する）|

---

## Supabase で実行が必要な SQL まとめ

```sql
-- ① PostGIS 有効化（1回だけ）
CREATE EXTENSION IF NOT EXISTS postgis;

-- ② places テーブルへのカラム追加
ALTER TABLE places ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);
ALTER TABLE places ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS hotpepper_id text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS report_count int DEFAULT 0;
ALTER TABLE places ADD COLUMN IF NOT EXISTS photo_url text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS open_hours text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS close_day text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS budget text;
ALTER TABLE places ADD COLUMN IF NOT EXISTS hotpepper_url text;

-- ③ 既存データを location カラムに変換（全件）
UPDATE places
SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;

-- ④ インデックス作成
CREATE INDEX IF NOT EXISTS idx_places_location_gist ON places USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_places_google_place_id
  ON places(google_place_id) WHERE google_place_id IS NOT NULL;

-- ⑤ RPC 関数（spatial-search.ts から呼ばれる）
CREATE OR REPLACE FUNCTION find_nearby_places(
  user_lat float, user_lng float, radius_m float,
  req_tags text[], result_limit int
)
RETURNS TABLE(
  id uuid, name text, address text, lat float, lng float,
  tags text[], photo_url text, source_type text,
  hotpepper_id text, google_place_id text,
  distance_m float
) LANGUAGE sql AS $$
  SELECT id, name, address, lat, lng, tags, photo_url, source_type,
         hotpepper_id, google_place_id,
         ST_Distance(location::geography,
           ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography) AS distance_m
  FROM places
  WHERE is_active = true
    AND location IS NOT NULL
    AND ST_DWithin(
          location::geography,
          ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
          radius_m
        )
    AND tags && req_tags
  ORDER BY distance_m
  LIMIT result_limit;
$$;
```

---

## ファイル構成（追加・変更したもの一覧）

```
moodgo-main/
├── vercel.json                              ← NEW: Cron スケジュール設定
│
├── lib/
│   ├── hotpepper-sync-config.ts             ← MODIFIED: 18ジャンル・全国0.05°グリッド
│   ├── spatial-search.ts                    ← MODIFIED: 自動保存フック追加
│   ├── place-vitality-check.ts              ← NEW: 閉業チェックロジック
│   └── google-places-auto-save.ts           ← NEW: Google Places/HotPepper 自動保存
│
├── app/api/
│   ├── cron/vitality-check/route.ts         ← NEW: Vercel Cron エンドポイント
│   ├── admin/
│   │   ├── hotpepper-sync/route.ts          ← MODIFIED: 2段階重複チェック追加
│   │   └── vitality-check/route.ts          ← NEW: 管理者向け閉業チェック API
│   ├── report-closed/route.ts               ← NEW: ユーザー閉店報告 API
│   ├── recommend/route.ts                   ← MODIFIED: 自動保存・高層ビルフィルタ改善
│   ├── onsen/route.ts                       ← MODIFIED: spatialSearch を使用
│   ├── nature/route.ts                      ← MODIFIED: spatialSearch を使用
│   ├── waiwai/route.ts                      ← MODIFIED: spatialSearch を使用
│   ├── drive/route.ts                       ← MODIFIED: spatialSearch を使用
│   ├── focus/route.ts                       ← MODIFIED: spatialSearch を使用
│   ├── sports/route.ts                      ← MODIFIED: spatialSearch を使用
│   ├── travel/route.ts                      ← MODIFIED: spatialSearch を使用
│   └── cafe/route.ts                        ← MODIFIED: Supabase-first 追加
│
├── app/admin/page.tsx                       ← MODIFIED: 全18ジャンル一括同期・UI改善
│
└── moodgo/
    ├── types/app.ts                         ← MODIFIED: supabaseId フィールド追加
    ├── app/index.tsx                        ← MODIFIED: 閉店報告フロー追加
    └── components/ResultsView.tsx           ← MODIFIED: 閉店・閉業 報告理由追加
```

---

## アーキテクチャ全体像

```
ユーザーが気分・食ジャンルを選んで検索
        ↓
[Next.js API Routes]
        ↓
① PostGIS RPC find_nearby_places()
  「現在地から○km以内 × タグ一致」を距離順で瞬時に取得
        ↓ 結果十分 → そのまま返す
        ↓ 足りない → HotPepper / Google Places で補完
        ↓
② 結果を Expo アプリに返す（ユーザーはここで結果を見る）
        ↓
③ バックグラウンドで2つの処理が走る（fire-and-forget）

  [自動保存] 3秒後
  Google Places / HotPepper の結果を Supabase に保存
  → 次回同じエリアで検索 → Supabase から高速返却（API コスト0）

  [生存確認] 3秒後
  Google Places businessStatus を確認
  CLOSED_PERMANENTLY → is_active = false（次回から非表示）

[毎日自動 / Vercel Cron]
毎朝 3:00 JST → 未チェックスポット50件を Google Places で確認
→ 閉業していたら即座に非表示

[ユーザー報告]
「閉店・閉業」ボタン → report_count +1 → 3件以上で自動非表示
```
