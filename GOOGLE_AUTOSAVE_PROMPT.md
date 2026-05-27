# Google Places 自動保存機能（実装済み）

## やりたいこと

HotPepperグルメだけだと出てこない場所があるので、
利用者が Google Maps API で検索した結果のお店を、
押されたボタン（ジャンルタグ）に応じて自動で # をつけて Supabase に保存する。

- Google Maps API の消費を減らしたい（次回以降は Supabase から返す）
- 「これは気分じゃない」を押した場合は保存しなくて OK
- 同じお店の重複保存は防ぐ

---

## タグ体系（押されたボタン → 保存するタグ）

### #お腹すいた 配下のジャンルボタン

| 押されたボタン | 保存する baseTags | サブタグ（店名キーワードで自動判定） |
|---|---|---|
| #居酒屋 | `["#お腹すいた", "#居酒屋"]` | 個室→ #居酒屋個室 / 大衆→ #大衆酒場 |
| #和食 | `["#お腹すいた", "#和食"]` | 海鮮→ #海鮮 / 天ぷら→ #天ぷら / うどん・そば→ #うどんそば / 懐石→ #懐石料理 |
| #洋食 | `["#お腹すいた", "#洋食"]` | ハンバーグ→ #ハンバーグ / オムライス→ #オムライス / ステーキ→ #ステーキ / レトロ→ #レトロ洋食 |
| #イタリアン | `["#お腹すいた", "#イタリアン"]` | サブタグなし |
| #中華 | `["#お腹すいた", "#中華"]` | サブタグなし |
| #焼肉 | `["#お腹すいた", "#焼肉"]` | 食べ放題→ #焼肉食べ放題 / 高級・和牛→ #高級焼肉 / どれでもなければ→ #焼肉単品あり |
| #韓国 | `["#お腹すいた", "#韓国"]` | サブタグなし |
| #アジア系統 | `["#お腹すいた", "#アジア系統"]` | インド・ネパール→ #インドネパール料理 / タイ→ #タイ料理 / ベトナム→ #ベトナム料理 / どれでもなければ→ #アジアンエスタニック料理 |
| #各国料理 | `["#お腹すいた", "#各国料理"]` | メキシコ→ #メキシコ料理 / ブラジル→ #ブラジル料理 / ロシア→ #ロシア料理 / どれでもなければ→ #他国料理 |
| #ラーメン | `["#お腹すいた", "#ラーメン"]` | こってり・豚骨→ #こってりラーメン / あっさり・塩→ #あっさりラーメン / 味噌→ #味噌ラーメン / つけ麺→ #つけ麺まぜそば |
| #お好み焼きもんじゃ | `["#お腹すいた", "#お好み焼きもんじゃ"]` | サブタグなし |
| #カフェスイーツ | `["#お腹すいた", "#カフェスイーツ"]` | スイーツ・ケーキ→ #スイーツカフェ / 喫茶・昭和→ #喫茶店 / どれでもなければ→ #流行りカフェ |
| #高層ビル料理 | `["#お腹すいた", "#高層ビル料理"]` | サブタグなし |

---

## 重複チェックの仕組み（2段階）

```
① google_place_id（Google の場所ID）が Supabase に存在する → スキップ
② 店名 + 住所先頭30文字が一致する → スキップ
③ どちらも一致しない → 新規保存
```

---

## 実装ファイル

### 新規作成: `lib/google-places-auto-save.ts`

```typescript
// メイン関数
autoSaveGooglePlaces(places, genreTag)
// 例: autoSaveGooglePlaces(googleResults, "#居酒屋")

// HotPepper ライブ結果の保存
autoSaveHotPepperShops(shops, genreTag)

// fire-and-forget ラッパー（3秒後にバックグラウンドで実行）
scheduleAutoSave(places, genreTag)
scheduleHotPepperAutoSave(shops, genreTag)

// 動的質問の回答文字列からジャンルタグを検出
detectFoodGenreTag("居酒屋でおしゃれな個室") // → "#居酒屋"
```

### 変更: `app/api/recommend/route.ts`

**高層ビル料理（Google Places）の自動保存**:
```typescript
// hiShops（Google Places 結果）を返す直前に追加
scheduleAutoSave(hiShops.map(s => ({
  googlePlaceId: s.id,
  name: s.name,
  address: s.address,
  lat: s.lat, lng: s.lng,
  photoUrl: s.photoUrl,
})), "#高層ビル料理");
```

**食ジャンル全般（HotPepper ライブ結果）の自動保存**:
```typescript
// HotPepper の結果を返す直前に追加
const dqText = getDynamicQs(answers).map(q => q.answer).join(" ");
const detectedTag = detectFoodGenreTag(dqText); // 動的質問からジャンルを検出
if (detectedTag && !hpData.isFallback) {
  scheduleHotPepperAutoSave(hpData.shops, detectedTag);
}
```

---

## Supabase で実行が必要な SQL（1回だけ）

```sql
-- google_place_id カラムを追加（重複防止用）
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id text;

-- NULL を除いた重複防止インデックス
CREATE INDEX IF NOT EXISTS idx_places_google_place_id
  ON places(google_place_id)
  WHERE google_place_id IS NOT NULL;
```

Supabase Dashboard → SQL Editor で貼り付けて「Run」を押すだけ。

---

## 全体の流れ

```
ユーザーが #居酒屋 ボタンを押して検索
        ↓
HotPepper API / Google Places API が結果を返す
        ↓（ユーザーには即座に表示される）
3秒後、バックグラウンドで自動保存が走る
        ↓
重複チェック（google_place_id → 名前+住所）
        ↓
新規のみ Supabase に保存
タグ: ["#お腹すいた", "#居酒屋"] + サブタグ
        ↓
次回同じエリアで #居酒屋 を検索したとき
→ Supabase から返す（Google API を叩かない）
```

「これは気分ではない」ボタンを押した場合は、
そもそも検索結果が返ってきていないため保存されない。
