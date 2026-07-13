// ─── lib/google-places-auto-save.ts ──────────────────────────────────────────
// Google Places API で返ってきた飲食店を、使用タグに基づいて Supabase に自動保存する
// ・重複チェック: ① google_place_id → ② 名前+住所先頭30文字
// ・fire-and-forget で呼ぶ（scheduleAutoSave を使う）
// ・Supabase に google_place_id カラムが必要（下記 SQL を実行済みであること）
//
// 【Supabase で1回だけ実行する SQL】
//   ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id text;
//   CREATE INDEX IF NOT EXISTS idx_places_google_place_id
//     ON places(google_place_id) WHERE google_place_id IS NOT NULL;

import { after } from "next/server";
import { supabase } from "@/lib/supabase";
import { isLikelySamePlace } from "@/lib/normalize-name";

// 応答返却後に実行（Vercelサーバーレスでも凍結されず確実に走る）。
// setTimeoutのfire-and-forgetは応答後に関数が凍結され実行されない＝保存が消える罠の対策。
// request context外（テスト等）ではsetTimeoutへフォールバック。
export function runAfterResponse(fn: () => Promise<void>): void {
  try {
    after(async () => { await fn().catch(() => {}); });
  } catch {
    setTimeout(() => { fn().catch(() => {}); }, 0);
  }
}

// ── ジャンルタグ → タグルール（hotpepper-sync-config と同じ体系）───────────────
const FOOD_TAG_RULES: Record<string, {
  baseTags: string[];
  subTagRules: { keywords: string[]; tag: string }[];
  defaultSubTag?: string;
}> = {
  "#居酒屋": {
    baseTags: ["#お腹すいた", "#居酒屋"],
    subTagRules: [
      { keywords: ["個室", "完全個室", "半個室"], tag: "#居酒屋個室" },
      { keywords: ["大衆", "大衆酒場", "せんべろ", "コスパ", "立ち飲み"], tag: "#大衆酒場" },
    ],
  },
  "#和食": {
    baseTags: ["#お腹すいた", "#和食"],
    subTagRules: [
      { keywords: ["海鮮", "魚介", "寿司", "刺身", "鮮魚"], tag: "#海鮮" },
      { keywords: ["天ぷら", "揚げ物", "フライ"], tag: "#天ぷら" },
      { keywords: ["うどん", "そば", "蕎麦"], tag: "#うどんそば" },
      { keywords: ["懐石", "会席", "割烹", "料亭"], tag: "#懐石料理" },
    ],
  },
  "#洋食": {
    baseTags: ["#お腹すいた", "#洋食"],
    subTagRules: [
      { keywords: ["ハンバーグ", "hamburg"], tag: "#ハンバーグ" },
      { keywords: ["オムライス", "omelet"], tag: "#オムライス" },
      { keywords: ["ステーキ", "steak"], tag: "#ステーキ" },
      { keywords: ["レトロ", "昭和", "老舗"], tag: "#レトロ洋食" },
    ],
  },
  "#イタリアン": {
    baseTags: ["#お腹すいた", "#イタリアン"],
    subTagRules: [],
  },
  "#中華": {
    baseTags: ["#お腹すいた", "#中華"],
    subTagRules: [],
  },
  "#焼肉": {
    baseTags: ["#お腹すいた", "#焼肉"],
    subTagRules: [
      { keywords: ["食べ放題", "放題", "all you can eat"], tag: "#焼肉食べ放題" },
      { keywords: ["高級", "黒毛和牛", "和牛", "特選", "銘柄牛"], tag: "#高級焼肉" },
    ],
    defaultSubTag: "#焼肉単品あり",
  },
  "#韓国": {
    baseTags: ["#お腹すいた", "#韓国"],
    subTagRules: [],
  },
  "#アジア系統": {
    baseTags: ["#お腹すいた", "#アジア系統"],
    subTagRules: [
      { keywords: ["インド", "ネパール", "カレー", "ナン", "タンドール"], tag: "#インドネパール料理" },
      { keywords: ["タイ", "Thai", "パッタイ", "トムヤム"], tag: "#タイ料理" },
      { keywords: ["ベトナム", "フォー", "バインミー", "Vietnam"], tag: "#ベトナム料理" },
    ],
    defaultSubTag: "#アジアンエスタニック料理",
  },
  "#各国料理": {
    baseTags: ["#お腹すいた", "#各国料理"],
    subTagRules: [
      { keywords: ["メキシコ", "タコス", "ブリトー"], tag: "#メキシコ料理" },
      { keywords: ["ブラジル", "シュラスコ"], tag: "#ブラジル料理" },
      { keywords: ["ロシア", "ボルシチ"], tag: "#ロシア料理" },
    ],
    defaultSubTag: "#他国料理",
  },
  "#ラーメン": {
    baseTags: ["#お腹すいた", "#ラーメン"],
    subTagRules: [
      { keywords: ["こってり", "豚骨", "家系", "濃厚", "二郎", "背脂"], tag: "#こってりラーメン" },
      { keywords: ["あっさり", "塩", "鶏", "淡麗", "清湯"], tag: "#あっさりラーメン" },
      { keywords: ["味噌", "みそ", "miso"], tag: "#味噌ラーメン" },
      { keywords: ["つけ麺", "まぜそば", "油そば", "汁なし"], tag: "#つけ麺まぜそば" },
    ],
  },
  "#お好み焼きもんじゃ": {
    baseTags: ["#お腹すいた", "#お好み焼きもんじゃ"],
    subTagRules: [],
  },
  "#カフェスイーツ": {
    baseTags: ["#お腹すいた", "#カフェスイーツ"],
    subTagRules: [
      { keywords: ["スイーツ", "パンケーキ", "ケーキ", "パフェ", "タルト", "クレープ"], tag: "#カフェスイーツ" },
      { keywords: ["喫茶", "純喫茶", "昭和", "レトロ", "老舗"], tag: "#喫茶店" },
    ],
    defaultSubTag: "#流行りカフェ",
  },
  "#高層ビル料理": {
    baseTags: ["#お腹すいた", "#高層ビル料理"],
    subTagRules: [],
  },
};

// ── 型定義 ─────────────────────────────────────────────────────────────────────
export interface GooglePlaceEntry {
  googlePlaceId: string; // Google Places の places.id (例: "ChIJxxxxxxxx")
  name: string;
  address: string;
  lat: number;
  lng: number;
  photoUrl?: string | null;
  rating?: number | null;
  openNow?: boolean | null;
}

// ── タグ付けロジック ────────────────────────────────────────────────────────────
function assignTags(genreTag: string, placeName: string): string[] {
  const rule = FOOD_TAG_RULES[genreTag];
  if (!rule) return ["#お腹すいた"];

  const tags = [...rule.baseTags];
  const text = placeName.toLowerCase();

  let subTagAssigned = false;
  for (const sr of rule.subTagRules) {
    if (sr.keywords.some(kw => text.includes(kw.toLowerCase()))) {
      if (!tags.includes(sr.tag)) tags.push(sr.tag);
      subTagAssigned = true;
    }
  }
  if (!subTagAssigned && rule.defaultSubTag) {
    tags.push(rule.defaultSubTag);
  }
  return tags;
}

// ── 住所から都道府県を抽出 ────────────────────────────────────────────────────
function extractArea(address: string): string | null {
  const m = address.match(/^(.+?[都道府県])/);
  return m ? m[1] : null;
}

// ── 表記ゆれ重複ガード用: バッチ座標の外接矩形内にある既存 places を取得 ─────────
// STEP2 の「完全な名前一致」では別表記（カナ↔ひらがな, 全角半角, 記号ゆれ）の既存を拾えず、
// 同じ場所が二重登録される。座標近傍の既存を引いておき、isLikelySamePlace（名前ゆるふわ一致
// ＋近接）で挿入前に弾く。日本語↔英語の別名は座標だけでは同定できない（別スポットを誤結合し得る）
// ので、ここでは名前一致を伴う近接のみを重複とみなす（＝カナ/全角半角/記号ゆれを確実に防ぐ）。
async function fetchNearbyExistingPlaces(
  pts: Array<{ lat?: number | null; lng?: number | null }>,
): Promise<Array<{ name: string; lat: number | null; lng: number | null }>> {
  if (!supabase) return [];
  const lats = pts.map(p => p.lat).filter((v): v is number => v != null && !isNaN(v));
  const lngs = pts.map(p => p.lng).filter((v): v is number => v != null && !isNaN(v));
  if (lats.length === 0 || lngs.length === 0) return [];
  const pad = 0.002;   // ≈ 約200m の余白（座標が多少ズレていても拾えるように）
  const { data } = await supabase
    .from("places")
    .select("name, lat, lng")
    .gte("lat", Math.min(...lats) - pad).lte("lat", Math.max(...lats) + pad)
    .gte("lng", Math.min(...lngs) - pad).lte("lng", Math.max(...lngs) + pad)
    .limit(3000);   // 密集エリアの取り過ぎ防止（超過分は従来どおり名前完全一致で判定＝最悪でも現状維持）
  return (data ?? []) as Array<{ name: string; lat: number | null; lng: number | null }>;
}

// ── メイン保存関数 ─────────────────────────────────────────────────────────────
export async function autoSaveGooglePlaces(
  places: GooglePlaceEntry[],
  genreTag: string, // "#居酒屋" など FOOD_TAG_RULES のキー
): Promise<{ saved: number; skipped: number }> {
  if (!supabase || places.length === 0) return { saved: 0, skipped: 0 };
  if (!FOOD_TAG_RULES[genreTag]) return { saved: 0, skipped: 0 };

  try {
    // ── STEP 1: google_place_id で既存チェック ──────────────────────────────
    const ids = places.map(p => p.googlePlaceId).filter(Boolean);
    const { data: existingById } = await supabase
      .from("places")
      .select("google_place_id")
      .in("google_place_id", ids);

    const existingIdSet = new Set((existingById ?? []).map(e => e.google_place_id));
    const notFoundById = places.filter(p => !existingIdSet.has(p.googlePlaceId));
    if (notFoundById.length === 0) return { saved: 0, skipped: places.length };

    // ── STEP 2: 名前で追加チェック（google_place_id未登録の既存レコードを検出）──
    const names = [...new Set(notFoundById.map(p => p.name).filter(Boolean))];
    const { data: existingByName } = await supabase
      .from("places")
      .select("name, address")
      .in("name", names);

    const nameAddrSet = new Set(
      (existingByName ?? []).map(e =>
        `${e.name}||${(e.address ?? "").replace(/\s+/g, "").substring(0, 30)}`
      )
    );

    // 表記ゆれ（カナ/全角半角/記号ゆれ）＋近接の既存を弾くための座標近傍の既存 places
    const nearby = await fetchNearbyExistingPlaces(notFoundById);

    // ── STEP 3: 新規のみ insert ─────────────────────────────────────────────
    const toInsert = notFoundById
      .filter(p => {
        const key = `${p.name}||${(p.address ?? "").replace(/\s+/g, "").substring(0, 30)}`;
        if (nameAddrSet.has(key)) return false;
        // 名前がゆるふわ一致 かつ 近接（≈120m）の既存があれば別表記の重複とみなしスキップ
        if (nearby.some(e => isLikelySamePlace(p.name, p.lat, p.lng, e.name, e.lat, e.lng))) return false;
        return true;
      })
      .map(p => ({
        name: p.name,
        address: p.address ?? "",
        lat: p.lat,
        lng: p.lng,
        google_place_id: p.googlePlaceId || null,
        source_type: "google",
        tags: assignTags(genreTag, p.name),
        photo_url: null,   // 規約対応: Google由来の写真URLは恒久保存しない（recommendのwriteback無効化と整合）
        is_active: true,
        report_count: 0,
        area: extractArea(p.address ?? ""),
      }));

    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += 50) {
        await supabase.from("places").insert(toInsert.slice(i, i + 50));
      }
      console.log(`[autoSave] ${genreTag}: ${toInsert.length}件保存`);
    }

    return { saved: toInsert.length, skipped: places.length - toInsert.length };
  } catch (err) {
    console.error("[autoSaveGooglePlaces] error:", err);
    return { saved: 0, skipped: places.length };
  }
}

// ── 非飲食スポット汎用保存関数（nature / onsen / cafe / sports 等）──────────────
export async function autoSavePlacesWithTags(
  places: GooglePlaceEntry[],
  tags: string[],   // 直接 DB に入れるタグ配列（例: ["#温泉", "#自然感じたい"]）
  sourceType: string = "google",  // 由来ラベル（"google" / "yahoo"）。google_place_id無しでも保存可
): Promise<{ saved: number; skipped: number }> {
  if (!supabase || places.length === 0) return { saved: 0, skipped: 0 };

  try {
    // STEP 1: google_place_id で既存チェック
    const ids = places.map(p => p.googlePlaceId).filter(Boolean);
    const { data: existingById } = ids.length
      ? await supabase.from("places").select("google_place_id").in("google_place_id", ids)
      : { data: [] };

    const existingIdSet = new Set((existingById ?? []).map(e => e.google_place_id));
    const notFoundById = places.filter(p => !existingIdSet.has(p.googlePlaceId));
    if (notFoundById.length === 0) return { saved: 0, skipped: places.length };

    // STEP 2: 名前+住所で追加チェック
    const names = [...new Set(notFoundById.map(p => p.name).filter(Boolean))];
    const { data: existingByName } = await supabase
      .from("places")
      .select("name, address")
      .in("name", names);

    const nameAddrSet = new Set(
      (existingByName ?? []).map(e =>
        `${e.name}||${(e.address ?? "").replace(/\s+/g, "").substring(0, 30)}`
      )
    );

    const nearby = await fetchNearbyExistingPlaces(notFoundById);

    // STEP 3: 新規のみ insert
    const toInsert = notFoundById
      .filter(p => {
        const key = `${p.name}||${(p.address ?? "").replace(/\s+/g, "").substring(0, 30)}`;
        if (nameAddrSet.has(key)) return false;
        // 名前ゆるふわ一致＋近接の既存＝別表記の重複としてスキップ（カナ/全角半角/記号ゆれ対策）
        if (nearby.some(e => isLikelySamePlace(p.name, p.lat, p.lng, e.name, e.lat, e.lng))) return false;
        return true;
      })
      .map(p => ({
        name: p.name,
        address: p.address ?? "",
        lat: p.lat,
        lng: p.lng,
        google_place_id: p.googlePlaceId || null,
        source_type: sourceType,
        tags,
        photo_url: null,   // 規約対応: Google由来の写真URLは恒久保存しない（recommendのwriteback無効化と整合）
        is_active: true,
        report_count: 0,
        area: extractArea(p.address ?? ""),
      }));

    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += 50) {
        await supabase.from("places").insert(toInsert.slice(i, i + 50));
      }
      console.log(`[autoSave] ${tags.join(",")}: ${toInsert.length}件保存`);
    }

    return { saved: toInsert.length, skipped: places.length - toInsert.length };
  } catch (err) {
    console.error("[autoSavePlacesWithTags] error:", err);
    return { saved: 0, skipped: places.length };
  }
}

// ── fire-and-forget ラッパー（非飲食ルート用）────────────────────────────────
export function scheduleGenericAutoSave(
  places: GooglePlaceEntry[],
  tags: string[],
  sourceType: string = "google",
): void {
  if (!places.length || !tags.length) return;
  runAfterResponse(() => autoSavePlacesWithTags(places, tags, sourceType).then(() => {}));
}

// ── fire-and-forget ラッパー（ルートから呼ぶ用）──────────────────────────────
export function scheduleAutoSave(
  places: GooglePlaceEntry[],
  genreTag: string,
  delayMs = 3000,
): void {
  if (!places.length || !FOOD_TAG_RULES[genreTag]) return;
  runAfterResponse(() => autoSaveGooglePlaces(places, genreTag).then(() => {}));
}

// ── ジャンル文字列 → タグキーの変換（recommend route 用）─────────────────────
// answers の動的質問回答から食ジャンルタグを推定する
const GENRE_KEYWORD_MAP: [string, string][] = [
  ["高層ビル料理", "#高層ビル料理"],
  ["居酒屋", "#居酒屋"],
  ["和食", "#和食"],
  ["洋食", "#洋食"],
  ["イタリアン", "#イタリアン"],
  ["中華", "#中華"],
  ["焼肉", "#焼肉"],
  ["韓国", "#韓国"],
  ["アジア", "#アジア系統"],
  ["各国料理", "#各国料理"],
  ["ラーメン", "#ラーメン"],
  ["お好み焼き", "#お好み焼きもんじゃ"],
  ["もんじゃ", "#お好み焼きもんじゃ"],
  ["カフェ", "#カフェスイーツ"],
  ["スイーツ", "#カフェスイーツ"],
];

export function detectFoodGenreTag(text: string): string | null {
  for (const [keyword, tag] of GENRE_KEYWORD_MAP) {
    if (text.includes(keyword)) return tag;
  }
  return null;
}

// ── HotPepper ライブ結果の自動保存 ────────────────────────────────────────────
// recommend route の /api/hotpepper 呼び出し結果を保存するためのラッパー
// HotPepper の shop は display format（id, name, address, lat, lng, genre 等）
export interface HotPepperDisplayShop {
  id?: string;          // HotPepper shop ID（例: "J001234567"）
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  photoUrl?: string;
  genre?: string;       // ジャンル名（表示用）
  genreCatch?: string;
  shopCatch?: string;
}

export async function autoSaveHotPepperShops(
  shops: HotPepperDisplayShop[],
  genreTag: string,
): Promise<{ saved: number; skipped: number }> {
  if (!supabase || shops.length === 0) return { saved: 0, skipped: 0 };
  if (!FOOD_TAG_RULES[genreTag]) return { saved: 0, skipped: 0 };

  try {
    // ① hotpepper_id で既存チェック
    const hotpepperIds = shops.map(s => s.id).filter(Boolean) as string[];
    const { data: existingById } = await supabase
      .from("places")
      .select("hotpepper_id")
      .in("hotpepper_id", hotpepperIds);

    const existingIdSet = new Set((existingById ?? []).map(e => e.hotpepper_id));
    const notFoundById = shops.filter(s => s.id && !existingIdSet.has(s.id));
    if (notFoundById.length === 0) return { saved: 0, skipped: shops.length };

    // ② 名前+住所で追加チェック
    const names = [...new Set(notFoundById.map(s => s.name).filter(Boolean))];
    const { data: existingByName } = await supabase
      .from("places")
      .select("name, address")
      .in("name", names);

    const nameAddrSet = new Set(
      (existingByName ?? []).map(e =>
        `${e.name}||${(e.address ?? "").replace(/\s+/g, "").substring(0, 30)}`
      )
    );

    const toInsert = notFoundById
      .filter(s => {
        if (!s.lat || !s.lng || isNaN(s.lat) || isNaN(s.lng)) return false;
        const key = `${s.name}||${(s.address ?? "").replace(/\s+/g, "").substring(0, 30)}`;
        return !nameAddrSet.has(key);
      })
      .map(s => ({
        name: s.name,
        address: s.address ?? "",
        lat: s.lat!,
        lng: s.lng!,
        hotpepper_id: s.id ?? null,
        source_type: "hotpepper",
        tags: assignTags(genreTag, `${s.name} ${s.genreCatch ?? ""} ${s.shopCatch ?? ""}`),
        photo_url: null,   // 規約対応: 外部由来の写真URLは恒久保存しない
        is_active: true,
        report_count: 0,
        area: extractArea(s.address ?? ""),
      }));

    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += 50) {
        await supabase.from("places").insert(toInsert.slice(i, i + 50));
      }
      console.log(`[autoSaveHP] ${genreTag}: ${toInsert.length}件保存`);
    }
    return { saved: toInsert.length, skipped: shops.length - toInsert.length };
  } catch (err) {
    console.error("[autoSaveHotPepperShops] error:", err);
    return { saved: 0, skipped: shops.length };
  }
}

export function scheduleHotPepperAutoSave(
  shops: HotPepperDisplayShop[],
  genreTag: string,
  delayMs = 3000,
): void {
  if (!shops.length || !FOOD_TAG_RULES[genreTag]) return;
  setTimeout(() => {
    autoSaveHotPepperShops(shops, genreTag).catch(() => {});
  }, delayMs);
}
