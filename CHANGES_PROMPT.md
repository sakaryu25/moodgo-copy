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

## 今回追加・変更した機能（4つの大きな柱）

---

### ① HotPepper グルメ API 全国店舗一括登録システム

**目的**: TikTokで話題の穴場カフェや流行りの飲食店を Supabase に蓄積し、Google Places API コストを下げながら精度を上げる。

#### 追加ファイル

**`lib/hotpepper-sync-config.ts`**
- 14ジャンル（居酒屋・和食・洋食・イタリアン・中華・焼肉・韓国・アジア系・各国料理・ラーメン・お好み焼き・カフェスイーツ・高層料理）のジャンル設定
- `generateJapanGrid()` 関数：全国を **3,417地点** のグリッドに分割（260地点→大幅拡充）
  - 主要21都市：0.04° 刻み（密）
  - 近郊エリア：0.08° 刻み（中）
  - 地方：0.14〜0.35° 刻み（粗）
- `assignTagsFromConfig()` 関数：OpenAI コスト不要のルールベースタグ付け
  - 例：居酒屋で「個室」を含む店名 → `#居酒屋個室` タグを自動付与
  - 例：焼肉で「食べ放題」を含む → `#焼肉食べ放題` タグを自動付与

**タグ体系**（`#お腹すいた` は全飲食店に必ず付与）:
```
居酒屋   → #居酒屋 + [#居酒屋個室 or #大衆酒場]
和食     → #和食 + [#寿司 or #天ぷら or #しゃぶしゃぶ etc.]
焼肉     → #焼肉 + [#焼肉食べ放題 or #高級焼肉 or #焼肉単品あり]
カフェ   → #癒しカフェ + [#スイーツカフェ or #ブックカフェ etc.]
...（全14ジャンル）
```

**`app/api/admin/hotpepper-sync/route.ts`**
- `POST { secret, genreId, batchIndex, batchSize, dryRun }` でジャンル別バッチ同期
- 1グリッド点あたり最大300件取得（ページネーション対応）
- `hotpepper_id` で重複排除し upsert（同じ店が2度登録されない）
- `GET` で現在のジャンル一覧と DB 登録件数を返す
- `maxDuration = 300`（Vercel Pro 5分制限対応）

**`app/api/report-closed/route.ts`**
- `POST { placeId, hotpepperId?, sessionId? }` で閉店報告を受付
- `report_count` を +1 し、**3件以上で `is_active = false`**（自動非表示）
- `closed_reports` テーブルにログを残す

**`supabase-hotpepper-migration.sql`**
- `places` テーブルに追加するカラム：
  - `hotpepper_id TEXT` (UNIQUE INDEX付き)
  - `source_type TEXT` (`admin` / `hotpepper` / `google` / `user`)
  - `report_count INT DEFAULT 0`
  - `last_reported_at TIMESTAMPTZ`
  - `photo_url TEXT`
  - `open_hours TEXT`
  - `close_day TEXT`
  - `budget TEXT`
  - `hotpepper_url TEXT`
- `closed_reports` テーブル（閉店報告ログ）
- `hotpepper_sync_logs` テーブル（同期ログ）

#### 管理画面への追加
`app/admin/page.tsx` に「🍽 HotPepper同期」タブを追加。
ジャンル選択 → バッチ番号指定 → 「▶ 同期開始」ボタンで実行できる。

---

### ② PostGIS 高速空間検索システム

**目的**: 「現在地から〇〇km以内でタグが一致する店を近い順に取得」をミリ秒単位で実現。従来のハバーサイン（JavaScript での距離計算）より大幅に高速。

#### 追加ファイル

**`supabase-postgis-migration.sql`**（Supabase SQL Editor で実行済み）
```sql
-- PostGIS 拡張（すでに有効化済み: 3.3.7）
CREATE EXTENSION IF NOT EXISTS postgis;

-- places テーブルに空間カラムを追加
ALTER TABLE places ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);
ALTER TABLE places ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id TEXT;

-- 既存 26,754 件の lat/lng を location に一括変換（実行済み）
UPDATE places
SET location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
WHERE lat IS NOT NULL AND lng IS NOT NULL AND location IS NULL;

-- GiST 空間インデックス（ST_DWithin を高速化）
CREATE INDEX idx_places_location_gist ON places USING GIST(location);

-- auto-sync トリガー（lat/lng 変更時に location を自動更新）
CREATE TRIGGER trg_sync_place_location ...

-- RPC: 近い順×タグ検索
CREATE OR REPLACE FUNCTION find_nearby_places(
  user_lat, user_lng, radius_m, req_tags, result_limit
) ...

-- RPC: 閉店チェック対象取得
CREATE OR REPLACE FUNCTION find_places_needing_vitality_check(
  batch_size, max_age_days
) ...
```

**`lib/spatial-search.ts`**
```typescript
// 主要関数
spatialSearch(opts)         // PostGIS RPC → フォールバックの順で検索
findNearbyPlacesRaw(...)    // PostGIS RPC を直接呼び出す低レベル関数
nearbyRowToPlaceResponse()  // RPC 結果を PlaceResponse 型に変換
spatialSearchWithTransport() // 交通手段+時間から半径を自動計算して検索
```

**フォールバック設計**（PostGIS が未設定でも動く）:
```
① PostGIS RPC `find_nearby_places` で検索
  ↓ 結果が少なければ
② タグを緩めて再検索（fallbackTags + 半径×1.5）
  ↓ まだ少なければ
③ 半径×2 で再検索
  ↓ それでも0件 or PostGIS 未設定なら
④ 既存の searchPlacesByTags（ハバーサイン）にフォールバック
```

#### 全ルートへの適用（今回の主要変更）

以下の全8ルートで `searchPlacesByTags` → `spatialSearch` に変更し、
**交通手段＋所要時間から算出した半径**を PostGIS に直接渡すように統一：

| ルート | ファイル | 使用する半径変数 |
|--------|---------|----------------|
| 温泉   | `app/api/onsen/route.ts`   | `calcRadiusKm(transport)` |
| 自然   | `app/api/nature/route.ts`  | `calcRadiusKmFromTime(transportArr, time) * 1000` |
| わいわい | `app/api/waiwai/route.ts` | `googleRadiusM / 1000` |
| ドライブ | `app/api/drive/route.ts`  | `calcedRadiusM / 1000`（未指定時 30km）|
| 集中   | `app/api/focus/route.ts`   | `radiusM / 1000` |
| スポーツ | `app/api/sports/route.ts` | `radiusM / 1000` |
| 遠出   | `app/api/travel/route.ts`  | `donut.outerM / 1000`、`minRadiusKm: donut.innerM / 1000` |
| カフェ | `app/api/cafe/route.ts`    | `baseRadiusM / 1000`（今回新規追加）|

また `app/api/recommend/route.ts` のメインフローも `spatialSearch` を使用。

**半径計算の元になる関数** (`lib/calc-radius.ts` の既存ロジック):
```
徒歩 + 30分  → 約 2km
自転車 + 1時間 → 約 10km
電車 + 1時間  → 約 30km
車 + 1〜2時間 → 約 40〜80km
```

---

### ③ 閉業自動検知システム（自浄作用）

**目的**: 飲食店は閉店が多いため、閉業した店舗を自動的に検索結果から除外する仕組みを構築。

#### 検知の3段階

**段階 1: 毎日自動チェック（Vercel Cron）**

`vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/vitality-check",
      "schedule": "0 18 * * *"
    }
  ]
}
```
→ 毎朝 3:00 JST（UTC 18:00）に自動実行

`app/api/cron/vitality-check/route.ts`:
- Google Places API で `businessStatus` を確認（1回あたり最大50件）
- `CLOSED_PERMANENTLY` → `is_active = false`（即座に検索から除外）
- `OPERATIONAL` / `CLOSED_TEMPORARILY` → `last_checked_at` を更新
- 認証: `CRON_SECRET`（Vercel 自動付与）または `ADMIN_SECRET`

**段階 2: ユーザー検索のたびにバックグラウンドチェック**

`lib/place-vitality-check.ts`:
```typescript
scheduleBackgroundVitalityCheck(placeIds, apiKey, 3000)
// 検索結果を返した 3秒後に fire-and-forget で確認
// UX への影響ゼロ
```

- `lib/supabase-places.ts` と `lib/spatial-search.ts` の両方で呼び出す
- **7日ルール**: `last_checked_at` が7日以内なら API を叩かない（コスト節約）

**段階 3: ユーザーによる手動報告**

`moodgo/components/ResultsView.tsx`:
- 報告理由に **「閉店・閉業」** を追加
- `moodgo/types/app.ts` の `Recommendation` 型に `supabaseId?: string` を追加
- Supabase 由来のスポット（`sb-{uuid}` 形式）から UUID を抽出して渡す

`moodgo/app/index.tsx`:
```typescript
// 「閉店・閉業」報告時のみ /api/report-closed を追加で呼ぶ
if (reportReason === '閉店・閉業') {
  await apiFetch('/api/report-closed', {
    method: 'POST',
    body: JSON.stringify({ placeId: reportingSpot.supabaseId }),
  });
}
// 通常の報告ログは従来通り /api/reports へ
```

**`lib/place-vitality-check.ts`** の主要な関数:
```typescript
fetchBusinessStatus(googlePlaceId, apiKey)  // Google Places New API で businessStatus 確認
resolveGooglePlaceId(name, address, apiKey) // google_place_id 未登録時は名前+住所で検索して保存
checkSinglePlace(place, apiKey)             // 1件チェック → DB 更新
batchVitalityCheck(targets, apiKey)         // 5件並列 × バッチ処理（200ms インターバル）
fetchVitalityTargets(batchSize)             // RPC 優先、失敗時は直接クエリ
```

**Admin パネル**（`app/admin/page.tsx`）:
- 「🔍 生存確認・自浄」タブを追加
- `app/api/admin/vitality-check/route.ts`（POST: バッチ実行、GET: 統計表示）

---

### ④ 閉店報告ボタンの UI 実装

**`moodgo/components/ResultsView.tsx`** の変更点:
- `placeToRec()` 関数で `supabaseId` を抽出・セット
- `onSetReportingSpot` の型を拡張: `{ title, address, supabaseId? }`
- `onReport` コールバックで `supabaseId` を渡す

**`moodgo/types/app.ts`** の変更点:
```typescript
export type Recommendation = {
  // ... 既存フィールド
  supabaseId?: string; // 追加: Supabase places.id（report-closed 用）
};
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

## Supabase で実行済みの SQL

以下の SQL を Supabase Dashboard → SQL Editor で実行済み:

1. **PostGIS 有効化**: `CREATE EXTENSION IF NOT EXISTS postgis;`
2. **カラム追加** (`location`, `last_checked_at`, `google_place_id`, `hotpepper_id`, `source_type`, `report_count`, etc.)
3. **既存データ変換**: 26,754件すべての `lat/lng` → `location` カラムに変換済み
4. **インデックス作成**: GiST 空間インデックス、last_checked_at インデックスなど
5. **RPC 作成**:
   - `find_nearby_places(user_lat, user_lng, radius_m, req_tags, result_limit)`
   - `find_places_needing_vitality_check(batch_size, max_age_days)`

---

## 残りの作業（まだ実施していないもの）

### HotPepper データ投入
`https://moodgo-main.vercel.app/admin` にアクセス → 「🍽 HotPepper同期」タブ
→ ジャンルを選んで「▶ 同期開始」（14ジャンル × 171バッチ分）

### Google Places API キーの確認
Vercel 環境変数に `GOOGLE_PLACES_API_KEY` が設定されているか確認
→ 閉業自動チェックに必要

---

## ファイル構成（今回追加・変更したもの一覧）

```
moodgo-main/
├── vercel.json                              ← NEW: Cron スケジュール設定
├── supabase-postgis-migration.sql           ← NEW: PostGIS SQL（実行済み）
├── supabase-hotpepper-migration.sql         ← NEW: HotPepper カラム SQL
│
├── lib/
│   ├── hotpepper-sync-config.ts             ← NEW: ジャンル設定・グリッド3,417点
│   ├── spatial-search.ts                    ← NEW: PostGIS 空間検索ラッパー
│   └── place-vitality-check.ts             ← NEW: 閉業チェックロジック
│
├── app/api/
│   ├── cron/vitality-check/route.ts         ← NEW: Vercel Cron エンドポイント
│   ├── admin/
│   │   ├── hotpepper-sync/route.ts          ← NEW: HotPepper 一括同期 API
│   │   └── vitality-check/route.ts          ← NEW: 管理者向け閉業チェック API
│   ├── report-closed/route.ts               ← NEW: ユーザー閉店報告 API
│   ├── recommend/route.ts                   ← MODIFIED: spatialSearch を使用
│   ├── onsen/route.ts                       ← MODIFIED: spatialSearch を使用
│   ├── nature/route.ts                      ← MODIFIED: spatialSearch を使用
│   ├── waiwai/route.ts                      ← MODIFIED: spatialSearch を使用
│   ├── drive/route.ts                       ← MODIFIED: spatialSearch を使用
│   ├── focus/route.ts                       ← MODIFIED: spatialSearch を使用
│   ├── sports/route.ts                      ← MODIFIED: spatialSearch を使用
│   ├── travel/route.ts                      ← MODIFIED: spatialSearch を使用
│   └── cafe/route.ts                        ← MODIFIED: Supabase-first 追加
│
├── app/admin/page.tsx                       ← MODIFIED: 2タブ追加
│
└── moodgo/
    ├── types/app.ts                         ← MODIFIED: supabaseId フィールド追加
    ├── app/index.tsx                        ← MODIFIED: 閉店報告フロー追加
    └── components/ResultsView.tsx           ← MODIFIED: 閉店・閉業 報告理由追加
```

---

## アーキテクチャ全体像

```
ユーザーが気分を選んで検索
        ↓
[Next.js API Routes]
        ↓
① PostGIS RPC find_nearby_places()
  「現在地から○km以内 × タグ一致」を距離順で瞬時に取得
  （26,754件から数ミリ秒）
        ↓ 3件以上 → そのまま返す
        ↓ 足りない → Google Places / Yahoo で補完
        ↓
② 結果を Expo アプリに返す
        ↓
③ バックグラウンドで生存確認（3秒後 fire-and-forget）
   Google Places businessStatus を確認
   CLOSED_PERMANENTLY → is_active = false（次回から非表示）

[毎日自動]
Vercel Cron 3:00 JST
→ 未チェックスポット50件を Google Places で確認
→ 閉業していたら即座に非表示

[ユーザー報告]
「閉店・閉業」ボタン → report_count +1
3件以上報告 → 自動非表示
```
