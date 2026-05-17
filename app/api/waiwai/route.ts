import { NextRequest, NextResponse } from "next/server";
import type { WaiWaiSubCategory, WaiWaiRequest, WaiWaiApiResponse } from "@/types/waiwai";
import type { PlaceResponse } from "@/types/onsen";
import { calcRadiusKm as calcRadiusKmFromTime, isPriceWithinBudget } from "@/lib/calc-radius";

// ────────────────────────────────────────────────────────────────────────────
// わいわい楽しみたい専用 API
//
// サブカテゴリ別の検索戦略:
//   active      → Yahoo!ローカルサーチ(gc=スポーツ施設) + Google写真補完
//                  フォールバック: Google Text Search
//   party       → Yahoo!ローカルサーチ(gc=カラオケ/ダーツ/ビリヤード) + Google写真補完
//                  フォールバック: Google Text Search
//   experience  → Google Places Text Search (新業態はGoogleが強い)
//   food_drink  → HotPepper Gourmet(居酒屋/焼肉 × 食べ放題/飲み放題) + Google写真補完
//                  フォールバック: Google Text Search
// ────────────────────────────────────────────────────────────────────────────

// ── サブカテゴリ メタ情報 ─────────────────────────────────────────────────
interface SubCategoryMeta {
  label:            string;
  description:      string;
  usesYahoo:        boolean;
  yahooGcList:      string[];     // Yahoo genre codes (複数の場合は複数リクエスト)
  yahooKeywords:    string[];     // gc 補完用キーワード
  usesGoogle:       boolean;      // Google Text Search を使うか
  googleQueries:    string[];     // Google検索クエリ（{area}プレースホルダー対応）
  usesHotpepper:    boolean;
  hotpepperGenres:  string[];     // 複数ジャンル対応
  hotpepperKeyword: string | null;
  nameKeywords:     string[] | null; // 名前フィルタ（null=フィルタなし）
  ngKeywords:       string[] | null; // これを含む名前は除外（法人・協会等）
}

// 法人・非施設系の名前に含まれやすい NG ワード（全カテゴリ共通）
const COMMON_NG_KEYWORDS = [
  // 法人・団体系
  "株式会社", "合同会社", "有限会社", "一般社団", "社団法人", "財団法人",
  "NPO", "協会", "連盟", "組合", "委員会", "事務局",
  // 教育・指導系
  "インストラクター", "スクール", "教室", "コーチ", "レッスン", "塾",
  // 販売・修理系
  "販売", "ショップ", "専門店", "問屋", "卸", "修理", "メンテナンス",
  "通信販売", "オンライン",
  // 公園・野外施設系（わいわい遊び目的には不向き）
  // ※ "アミューズメントパーク" は "パーク" 表記のため誤マッチしない
  "公園", "緑地", "自然公園", "国立公園", "都立公園", "県立公園", "市立公園",
  "運動公園", "河川敷", "遊歩道", "ウォーキングコース", "児童遊園",
];

const SUB_CATEGORY_META: Record<WaiWaiSubCategory, SubCategoryMeta> = {
  active: {
    label:            "💪 体を動かしてはしゃぎたい",
    description:      "みんなで体を動かして全力で遊べるスポット！",
    usesYahoo:        true,
    yahooGcList:      ["0306"],
    yahooKeywords:    ["ボウリング", "トランポリン", "スポッチャ", "アミューズメント",
                       "バッティングセンター", "卓球", "ゴーカート"],
    usesGoogle:       true,
    googleQueries:    [
      "{area}ボウリング",
      "{area}トランポリンパーク",
      "{area}スポッチャ",
      "{area}アミューズメントパーク",
      "{area}バッティングセンター",
      "{area}卓球 施設",
      "{area}ゴーカート",
      "{area}スケートリンク",
    ],
    usesHotpepper:    false,
    hotpepperGenres:  [],
    hotpepperKeyword: null,
    // nameFilter廃止: Googleクエリが関連性を担保するため null に
    nameKeywords:     null,
    ngKeywords:       [...COMMON_NG_KEYWORDS, "練習場", "ドリル", "フォーム", "指導",
                       "広場", "スポーツ広場", "グラウンド", "球場", "競技場"],
  },
  party: {
    label:            "🎤 歌って飲んで騒ぎたい",
    description:      "歌って飲んで、朝まで盛り上がれる場所！",
    usesYahoo:        true,
    yahooGcList:      ["0305001", "0306014", "0306004"],  // カラオケボックス, ダーツ, ビリヤード
    yahooKeywords:    ["カラオケ", "ダーツバー", "ビリヤード", "ネットカフェ"],
    usesGoogle:       true,
    googleQueries:    [
      "{area}カラオケ",
      "{area}カラオケ BANBAN",      // バンバン系を直接取得
      "{area}カラオケ まねきねこ",  // まねきねこ系を直接取得
      "{area}ダーツバー",
      "{area}ビリヤード場",
      "{area}ゲームセンター",
      "{area}ネットカフェ 漫画",
      "{area}ラウンドワン",
    ],
    usesHotpepper:    false,
    hotpepperGenres:  [],
    hotpepperKeyword: null,
    // nameFilter廃止: Googleクエリが関連性を担保するため null に
    nameKeywords:     null,
    ngKeywords:       [...COMMON_NG_KEYWORDS],
  },
  experience: {
    label:            "🎲 非日常の体験で盛り上がりたい",
    description:      "いつもと違う体験で、ワイワイ盛り上がろう！",
    usesYahoo:        false,
    yahooGcList:      [],
    yahooKeywords:    [],
    usesGoogle:       true,
    googleQueries:    [
      "{area}脱出ゲーム",
      "{area}ボードゲームカフェ",
      "{area}謎解き",
      "{area}VR体験",
      "{area}体験型アトラクション",
      "{area}インドアアドベンチャー",
    ],
    usesHotpepper:    false,
    hotpepperGenres:  [],
    hotpepperKeyword: null,
    nameKeywords:     null,
    ngKeywords:       [...COMMON_NG_KEYWORDS],
  },
  food_drink: {
    label:            "🍻 美味しいご飯とお酒でワイワイ",
    description:      "美味しいご飯とお酒を囲んで、楽しく語り合おう！",
    usesYahoo:        false,
    yahooGcList:      [],
    yahooKeywords:    [],
    usesGoogle:       true,
    googleQueries:    [
      "{area}居酒屋 食べ放題 飲み放題",
      "{area}焼肉 食べ放題",
      "{area}居酒屋 個室",
      "{area}しゃぶしゃぶ 食べ放題",
      "{area}バイキング レストラン",
      "{area}寿司 食べ放題",
    ],
    usesHotpepper:    true,
    hotpepperGenres:  ["G001", "G008", "G004"],  // 居酒屋, 焼肉, 各国料理
    hotpepperKeyword: "食べ放題 飲み放題 個室",
    nameKeywords:     null,
    ngKeywords:       [...COMMON_NG_KEYWORDS],
  },
};

// ── Google Places Text Search FieldMask ──────────────────────────────────
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.photos",
  "places.googleMapsUri",
  "places.currentOpeningHours",
  "places.priceLevel",
].join(",");

// ── 交通手段 → 検索半径 ───────────────────────────────────────────────────
// ※ UIの選択肢: 徒歩 / 自転車・バイク / 電車 / バス / 車 / なんでも
function getRadii(transport?: string | string[]): {
  yahooDistKm:   number;
  googleRadiusM: number;
} {
  const modes = Array.isArray(transport) ? transport : (transport ? [transport] : []);

  // 未選択 or「なんでも」→ 20km
  if (modes.length === 0 || modes.some(m => m.includes("なんでも"))) {
    return { yahooDistKm: 20, googleRadiusM: 20_000 };
  }

  // デフォルトを 0 から始め、選択手段の最大値を採用
  // ※「自転車」は「車」の部分文字列のため先に判定する
  let yahooDistKm   = 0;
  let googleRadiusM = 0;

  for (const m of modes) {
    let y = 0, g = 0;
    if (m.includes("自転車")) {
      y = 5;  g = 5_000;   // 自転車・バイク → 5km
    } else if (m.includes("徒歩")) {
      y = 2;  g = 2_000;   // 徒歩 → 2km
    } else if (m.includes("電車")) {
      y = 15; g = 15_000;  // 電車 → 15km
    } else if (m.includes("バス")) {
      y = 10; g = 10_000;  // バス → 10km
    } else if (m.includes("バイク") || m.includes("車")) {
      y = 20; g = 20_000;  // 車・バイク → 20km
    }
    yahooDistKm   = Math.max(yahooDistKm,   y);
    googleRadiusM = Math.max(googleRadiusM, g);
  }

  // マッチなし → デフォルト
  if (yahooDistKm === 0) return { yahooDistKm: 10, googleRadiusM: 10_000 };

  return { yahooDistKm, googleRadiusM };
}

// HotPepper range パラメータ: 1=300m, 2=500m, 3=1km, 4=2km, 5=3km
function hotpepperRange(transport?: string | string[]): number {
  const modes = Array.isArray(transport) ? transport : (transport ? [transport] : []);
  if (modes.length === 0 || modes.some(m => m.includes("なんでも"))) return 5; // HotPepperは最大3kmなので5固定
  // 最も広い手段を採用（自転車を車より先に判定）
  if (modes.some(m => m.includes("バイク") || (!m.includes("自転車") && m.includes("車")) || m.includes("電車"))) return 5;
  if (modes.some(m => m.includes("バス"))) return 5;
  if (modes.some(m => m.includes("自転車"))) return 4; // 2km
  return 3; // 徒歩: 1km
}

// ── Google Places Text Search ─────────────────────────────────────────────
async function searchGooglePlaces(
  textQuery:  string,
  lat:        number,
  lng:        number,
  radiusM:    number,
  googleKey:  string,
  maxResults: number = 20,
): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   googleKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery,
        languageCode:   "ja",
        regionCode:     "JP",
        maxResultCount: maxResults,
        locationBias: {
          circle: { center: { latitude: lat, longitude: lng }, radius: radiusM },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.warn(`[waiwai] Google "${textQuery}" HTTP ${res.status} ${err.slice(0, 120)}`);
      return [];
    }
    const data   = await res.json();
    const places = (data.places ?? []) as Record<string, unknown>[];
    console.log(`[waiwai] Google "${textQuery}" → ${places.length}件`);
    return places;
  } catch (e) {
    console.warn(`[waiwai] Google "${textQuery}" 例外:`, e);
    return [];
  }
}

// ── Yahoo Local Search ────────────────────────────────────────────────────
interface YahooPlace {
  name:    string;
  address: string;
  lat:     number;
  lng:     number;
}

async function searchYahoo(
  gc:       string,
  keyword:  string,
  lat:      number,
  lng:      number,
  distKm:   number,
): Promise<YahooPlace[]> {
  const apiKey = process.env.YAHOO_LOCAL_SEARCH_API_KEY;
  if (!apiKey) { console.warn("[waiwai] YAHOO_LOCAL_SEARCH_API_KEY 未設定"); return []; }

  const params = new URLSearchParams({
    appid:   apiKey,
    lat:     String(lat),
    lon:     String(lng),
    dist:    String(Math.min(distKm, 20)),
    results: "50",
    sort:    "score",
    output:  "json",
    query:   keyword,
  });
  if (gc) params.append("gc", gc);

  try {
    const res = await fetch(
      `https://map.yahooapis.jp/search/local/V1/localSearch?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) { console.warn(`[waiwai] Yahoo gc=${gc} "${keyword}" HTTP ${res.status}`); return []; }
    const json     = await res.json();
    const features = (json.Feature ?? []) as Record<string, unknown>[];
    console.log(`[waiwai] Yahoo gc=${gc} "${keyword}" → ${features.length}件`);

    const results: YahooPlace[] = [];
    for (const f of features) {
      const name  = String(f.Name ?? "").trim();
      if (!name) continue;
      const prop   = (f.Property ?? {}) as Record<string, unknown>;
      const coords = String((f.Geometry as Record<string, unknown>)?.Coordinates ?? "");
      const [lngStr, latStr] = coords.split(",");
      results.push({
        name,
        address: String(prop.Address ?? ""),
        lat:     parseFloat(latStr ?? "0"),
        lng:     parseFloat(lngStr ?? "0"),
      });
    }
    return results;
  } catch (e) {
    console.warn(`[waiwai] Yahoo gc=${gc} "${keyword}" 例外:`, e);
    return [];
  }
}

// ── HotPepper Gourmet API ─────────────────────────────────────────────────
interface HotpepperShop {
  id:      string;
  name:    string;
  address: string;
  lat:     number;
  lng:     number;
  urls?:   { pc?: string };
}

async function searchHotpepper(
  genre:     string,
  keyword:   string,
  lat:       number,
  lng:       number,
  range:     number,
): Promise<HotpepperShop[]> {
  const apiKey = process.env.HOTPEPPER_API_KEY;
  if (!apiKey) { console.warn("[waiwai] HOTPEPPER_API_KEY 未設定"); return []; }

  const params = new URLSearchParams({
    key:    apiKey,
    lat:    String(lat),
    lng:    String(lng),
    range:  String(range),
    genre,
    keyword,
    count:  "30",
    format: "json",
  });

  try {
    const res = await fetch(
      `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) { console.warn(`[waiwai] HotPepper genre=${genre} HTTP ${res.status}`); return []; }
    const data  = await res.json();
    const shops = (data?.results?.shop ?? []) as HotpepperShop[];
    console.log(`[waiwai] HotPepper genre=${genre} → ${shops.length}件`);
    return shops;
  } catch (e) {
    console.warn(`[waiwai] HotPepper genre=${genre} 例外:`, e);
    return [];
  }
}

// ── Google Photos で写真・評価を補完 ─────────────────────────────────────
async function enrichWithGoogle(
  places:      Array<{ name: string; address: string; lat: number; lng: number; hotpepperUrl?: string }>,
  googleKey:   string,
  label:       string,
  description: string,
  originLat:   number,
  originLng:   number,
  transport?:  string | string[],
): Promise<PlaceResponse[]> {
  const tasks = places.map(async (p): Promise<PlaceResponse> => {
    const query   = `${p.name} ${p.address.slice(0, 20)}`;
    const results = await searchGooglePlaces(query, p.lat, p.lng, 500, googleKey, 1);
    const gp      = results[0];

    const photos    = gp ? ((gp.photos as Array<Record<string, unknown>>) ?? []) : [];
    const photoUrls = photos
      .filter(ph => ph?.name)
      .map(ph => `https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=800&key=${googleKey}`);

    const hours    = gp ? (gp.currentOpeningHours as Record<string, unknown> | undefined) : undefined;
    const weekdays = (hours?.weekdayDescriptions as string[] | undefined) ?? [];
    const openNow  = typeof hours?.openNow === "boolean" ? hours.openNow : null;

    const distKm = Math.round(haversineKm(originLat, originLng, p.lat, p.lng) * 10) / 10;

    return {
      id:           gp ? String(gp.id ?? `waiwai-${p.name}`) : `waiwai-${p.name}`,
      name:         p.name,
      category:     label,
      description,
      imageUrl:     photoUrls[0] ?? "",
      rating:       gp && typeof gp.rating          === "number" ? gp.rating          : null,
      reviewCount:  gp && typeof gp.userRatingCount === "number" ? gp.userRatingCount : null,
      address:      p.address,
      distanceInfo: buildDistanceInfo(distKm, transport),
      photoUrls,
      openNow,
      openingHours: weekdays.length > 0 ? compactWeekdays(weekdays) : null,
      priceLevel:   gp && typeof gp.priceLevel === "string" ? gp.priceLevel : null,
      googleMapsUrl: gp
        ? String(gp.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`)
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`,
      stationInfo:  null,
      source:       p.hotpepperUrl ? "hotpepper" : "google",
      hotpepperUrl: p.hotpepperUrl,
    };
  });

  const settled = await Promise.allSettled(tasks);
  return settled
    .filter((r): r is PromiseFulfilledResult<PlaceResponse> => r.status === "fulfilled")
    .map(r => r.value);
}

// ── Google raw → PlaceResponse 変換 ─────────────────────────────────────
function mapGoogleToPlaceResponse(
  place:     Record<string, unknown>,
  googleKey: string,
  opts: {
    label:        string;
    description:  string;
    transport?:   string | string[];
    originLat:    number;
    originLng:    number;
  },
): PlaceResponse {
  const name  = ((place.displayName as Record<string, unknown>)?.text as string) ?? "";
  const loc   = place.location as Record<string, unknown> | undefined;
  const pLat  = typeof loc?.latitude  === "number" ? loc.latitude  as number : opts.originLat;
  const pLng  = typeof loc?.longitude === "number" ? loc.longitude as number : opts.originLng;

  const photos    = (place.photos as Array<Record<string, unknown>>) ?? [];
  const photoUrls = photos
    .filter(p => p?.name)
    .map(p => `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=800&key=${googleKey}`);

  const hours    = place.currentOpeningHours as Record<string, unknown> | undefined;
  const weekdays = (hours?.weekdayDescriptions as string[] | undefined) ?? [];
  const openNow  = typeof hours?.openNow === "boolean" ? hours.openNow : null;

  const distKm = Math.round(haversineKm(opts.originLat, opts.originLng, pLat, pLng) * 10) / 10;

  return {
    id:           String(place.id ?? `waiwai-${name}`),
    name,
    category:     opts.label,
    description:  opts.description,
    imageUrl:     photoUrls[0] ?? "",
    rating:       typeof place.rating          === "number" ? place.rating          : null,
    reviewCount:  typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    address:      String(place.formattedAddress ?? ""),
    distanceInfo: buildDistanceInfo(distKm, opts.transport),
    photoUrls,
    openNow,
    openingHours: weekdays.length > 0 ? compactWeekdays(weekdays) : null,
    priceLevel:   typeof place.priceLevel === "string" ? place.priceLevel : null,
    googleMapsUrl: String(
      place.googleMapsUri ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`
    ),
    stationInfo: null,
    source:      "google",
  };
}

// ── 重複除去 ────────────────────────────────────────────────────────────
function dedup(places: PlaceResponse[]): PlaceResponse[] {
  const seenIds   = new Set<string>();
  const seenNames = new Set<string>();
  const result: PlaceResponse[] = [];
  for (const p of places) {
    const idKey = p.id.startsWith("waiwai-") ? null : p.id;
    if ((idKey && seenIds.has(idKey)) || seenNames.has(p.name.trim())) continue;
    if (idKey) seenIds.add(idKey);
    seenNames.add(p.name.trim());
    result.push(p);
  }
  return result;
}

// ── 品質フィルタ ─────────────────────────────────────────────────────────
// rating=null（Google補完失敗・評価未取得）の場所は除外せず通過させる
function qualityFilter(places: PlaceResponse[], wantMin: number): PlaceResponse[] {
  const byQ = (minR: number, minRev: number) =>
    places.filter(p =>
      p.rating === null ||  // 評価不明は常に通過（チェーン店等のYahoo結果を守る）
      (p.rating >= minR && (p.reviewCount ?? 0) >= minRev)
    );
  if (byQ(4.0, 50).length >= wantMin) return byQ(4.0, 50);
  if (byQ(3.8, 20).length >= wantMin) return byQ(3.8, 20);
  if (byQ(3.8,  5).length >= wantMin) return byQ(3.8,  5);
  if (byQ(3.5,  1).length >= wantMin) return byQ(3.5,  1);
  return places;
}

// ── 名前フィルタ ─────────────────────────────────────────────────────────
function nameFilter(places: PlaceResponse[], keywords: string[] | null): PlaceResponse[] {
  if (!keywords) return places;
  const filtered = places.filter(p =>
    keywords.some(k => p.name.toLowerCase().includes(k.toLowerCase()))
  );
  return filtered.length >= 3 ? filtered : places;
}

// ── NGワードフィルタ（法人・非施設等を除外）─────────────────────────────
function ngFilter(places: PlaceResponse[], ngKeywords: string[] | null): PlaceResponse[] {
  if (!ngKeywords || ngKeywords.length === 0) return places;
  const filtered = places.filter(p =>
    !ngKeywords.some(ng => p.name.includes(ng))
  );
  // 除外しすぎた場合は元に戻す（最低5件は確保）
  return filtered.length >= 5 ? filtered : places;
}

// ── 年齢制限フィルタ（フォールバックなし・絶対除外）────────────────────
// 件数が減っても絶対に緩めない（未成年へのバー等の表示を防ぐ）
function strictAgeFilter(places: PlaceResponse[], ngWords: string[]): PlaceResponse[] {
  if (ngWords.length === 0) return places;
  return places.filter(p =>
    !ngWords.some(ng => p.name.includes(ng))
  );
}

// ── ジオコーディング ─────────────────────────────────────────────────────
async function geocodeAddress(
  address:   string,
  googleKey: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}&language=ja&region=JP`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as {
      status: string;
      results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
    };
    if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) return null;
    return data.results[0].geometry.location;
  } catch {
    return null;
  }
}

// ── 成人向けNGワード（10代には絶対に表示しない）──────────────────────────
const ADULT_NG_WORDS = [
  "バー", "bar", "Bar", "BAR",
  "居酒屋", "izakaya",
  "飲み放題",
  "ナイトクラブ", "クラブ", "パブ",
  "スナック", "キャバ", "ホスト", "風俗",
];

// ────────────────────────────────────────────────────────────────────────────
// POST ハンドラ
// ────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<WaiWaiRequest> & {
      time?: string;
      companion?: string;
      budget?: number;
      freeWord?: string;
    };
    const { subCategory, areaLabel = "現在地周辺", transport, age, time, companion, budget, freeWord } = body;
    const lat = body.lat;
    const lng = body.lng;

    if (companion) console.log(`[waiwai] companion="${companion}"`);
    if (freeWord)  console.log(`[waiwai] freeWord="${freeWord}"`);

    // 10代ユーザー判定
    const isTeen = age === "10代";

    if (!subCategory || !SUB_CATEGORY_META[subCategory]) {
      return NextResponse.json(
        { error: "subCategory は active / party / experience / food_drink のいずれかを指定してください" },
        { status: 400 },
      );
    }

    const googleKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
    if (!googleKey) {
      return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY が設定されていません" }, { status: 500 });
    }

    // ── 座標確定 ─────────────────────────────────────────────────────────
    let searchLat = typeof lat === "number" ? lat : 0;
    let searchLng = typeof lng === "number" ? lng : 0;

    if (searchLat === 0 && searchLng === 0) {
      if (!areaLabel || areaLabel === "現在地周辺") {
        return NextResponse.json({ error: "位置情報またはエリア名を指定してください" }, { status: 400 });
      }
      const geocoded = await geocodeAddress(areaLabel, googleKey);
      if (!geocoded) {
        return NextResponse.json({ error: `「${areaLabel}」の座標を取得できませんでした` }, { status: 400 });
      }
      searchLat = geocoded.lat;
      searchLng = geocoded.lng;
      console.log(`[waiwai] ジオコード "${areaLabel}" → (${searchLat.toFixed(4)}, ${searchLng.toFixed(4)})`);
    }

    const metaBase     = SUB_CATEGORY_META[subCategory];

    // time + transport が揃っている場合は calcRadiusKm を使用
    const transportArr = Array.isArray(transport) ? transport : (transport ? [transport] : []);
    let { yahooDistKm, googleRadiusM } = getRadii(transport);
    if (time && transportArr.length > 0) {
      const calcKm = calcRadiusKmFromTime(transportArr, time);
      googleRadiusM = Math.round(calcKm * 1000);
      yahooDistKm   = Math.min(calcKm, 20);
    }

    const hpRange     = hotpepperRange(transport);
    // area prefix（クエリの先頭に付けるエリア名）
    const area        = areaLabel && areaLabel !== "現在地周辺" ? `${areaLabel} ` : "";

    // ── 10代向けコンテンツ制限 ─────────────────────────────────────────────
    // 20代以上: 通常通り（バー・居酒屋・飲み放題を含む）
    // 10代   : バー・居酒屋系クエリを除外し、全年齢向けに差し替え
    const meta = isTeen ? {
      ...metaBase,
      // party: ダーツバー → ダーツ施設に差し替え、ゲームセンター中心に
      googleQueries: metaBase.googleQueries.map(q =>
        q.replace("ダーツバー", "ダーツ施設").replace("バー", "施設")
      ),
      // food_drink: 居酒屋・飲み放題 → 食べ放題レストランに差し替え
      hotpepperKeyword: metaBase.hotpepperKeyword
        ? metaBase.hotpepperKeyword.replace("飲み放題", "").trim()
        : null,
      // 10代向けNGワードを追加
      ngKeywords: [...(metaBase.ngKeywords ?? []), ...ADULT_NG_WORDS],
    } : metaBase;

    const opts = {
      label:       meta.label,
      description: meta.description,
      transport,
      originLat:   searchLat,
      originLng:   searchLng,
    };

    console.log(`[waiwai] ▶ ${meta.label} area="${area.trim()}" age=${age ?? "未設定"} teen=${isTeen} yahooR=${yahooDistKm}km googleR=${googleRadiusM/1000}km hpRange=${hpRange}`);

    let places: PlaceResponse[] = [];

    // ── Yahoo!ローカルサーチ ──────────────────────────────────────────────
    // 検索距離は 1.3 倍で広めに取り、距離制限は後処理フィルタで適用
    if (meta.usesYahoo && meta.yahooGcList.length > 0) {
      const yahooSearchDistKm = Math.min(yahooDistKm * 1.3, 20);
      // gc × keyword の直積で全リクエストを並列実行
      const yahooTasks = meta.yahooGcList.flatMap(gc =>
        meta.yahooKeywords.map(kw => searchYahoo(gc, kw, searchLat, searchLng, yahooSearchDistKm))
      );
      const yahooSettled = await Promise.allSettled(yahooTasks);

      const seen = new Set<string>();
      const yahooPlaces: Array<{ name: string; address: string; lat: number; lng: number }> = [];
      for (const r of yahooSettled) {
        if (r.status !== "fulfilled") continue;
        for (const p of r.value) {
          if (seen.has(p.name)) continue;
          seen.add(p.name);
          yahooPlaces.push(p);
        }
      }
      console.log(`[waiwai] Yahoo 合計 ${yahooPlaces.length}件（dedup後）`);

      if (yahooPlaces.length > 0) {
        const enriched = await enrichWithGoogle(
          yahooPlaces, googleKey, meta.label, meta.description,
          searchLat, searchLng, transport,
        );
        places.push(...enriched);
      }
    }

    // ── Google Places Text Search ─────────────────────────────────────────
    // API 半径は 1.5 倍で広めに取り（上位20件の漏れを防ぐ）、
    // 距離制限は後処理フィルタで厳密に適用する
    if (meta.usesGoogle) {
      const googleSearchRadiusM = Math.round(googleRadiusM * 1.5);
      const googleTasks = meta.googleQueries.map(q => {
        const base  = q.replace("{area}", area);
        const query = freeWord ? `${base} ${freeWord}` : base;
        return searchGooglePlaces(query, searchLat, searchLng, googleSearchRadiusM, googleKey);
      });
      const googleSettled = await Promise.allSettled(googleTasks);
      const rawGoogle: Record<string, unknown>[] = [];
      for (const r of googleSettled) {
        if (r.status === "fulfilled") rawGoogle.push(...r.value);
      }
      console.log(`[waiwai] Google raw ${rawGoogle.length}件`);

      const existingIds = new Set(places.map(p => p.id));
      const mapped = rawGoogle
        .filter(p => !existingIds.has(String(p.id ?? "")))
        .map(p => mapGoogleToPlaceResponse(p, googleKey, opts));
      places.push(...mapped);
    }

    // ── HotPepper Gourmet ────────────────────────────────────────────────
    if (meta.usesHotpepper && meta.hotpepperKeyword) {
      // ジャンルを並列リクエスト
      const hpTasks = meta.hotpepperGenres.map(genre =>
        searchHotpepper(genre, meta.hotpepperKeyword!, searchLat, searchLng, hpRange)
      );
      const hpSettled = await Promise.allSettled(hpTasks);
      const hpShops: HotpepperShop[] = [];
      const hpSeen = new Set<string>();
      for (const r of hpSettled) {
        if (r.status !== "fulfilled") continue;
        for (const s of r.value) {
          if (hpSeen.has(s.id)) continue;
          hpSeen.add(s.id);
          hpShops.push(s);
        }
      }
      console.log(`[waiwai] HotPepper 合計 ${hpShops.length}件`);

      if (hpShops.length > 0) {
        const hpForEnrich = hpShops.map(s => ({
          name:         s.name,
          address:      s.address,
          lat:          s.lat,
          lng:          s.lng,
          hotpepperUrl: s.urls?.pc ?? undefined,
        }));
        const existingIds = new Set(places.map(p => p.id));
        const enriched = await enrichWithGoogle(
          hpForEnrich.filter(s => !existingIds.has(`waiwai-${s.name}`)),
          googleKey, meta.label, meta.description,
          searchLat, searchLng, transport,
        );
        places.push(...enriched);
      }
    }

    // ── 重複除去 ─────────────────────────────────────────────────────────
    places = dedup(places);
    console.log(`[waiwai] dedup後 ${places.length}件`);

    // ── NGワードフィルタ（法人・非施設を除外）───────────────────────────
    places = ngFilter(places, meta.ngKeywords);
    console.log(`[waiwai] NGフィルタ後 ${places.length}件`);

    // ── 年齢制限フィルタ（10代のみ・絶対除外・フォールバックなし）────────
    if (isTeen) {
      places = strictAgeFilter(places, ADULT_NG_WORDS);
      console.log(`[waiwai] 年齢制限フィルタ後 ${places.length}件`);
    }

    // ── 名前フィルタ（active / party サブカテゴリ専用）──────────────────
    places = nameFilter(places, meta.nameKeywords);
    console.log(`[waiwai] 名前フィルタ後 ${places.length}件`);

    // ── ソート（評価順・評価なしは後ろへ）──────────────────────────────
    // qualityFilter は使用しない:
    //   チェーン店(バンバン等)は評価が中程度になりがちで弾かれるため。
    //   NGフィルタ + nameFilter + 距離フィルタで十分絞れている。
    places.sort((a, b) => {
      // 評価あり → 高い順、評価なし(null) → 末尾
      if (a.rating === null && b.rating === null) return 0;
      if (a.rating === null) return 1;
      if (b.rating === null) return -1;
      return b.rating - a.rating;
    });

    // ── 距離フィルタ（最後に絶対適用 ─ 他フィルタの再拡張を防ぐ）────────
    // nameFilter / qualityFilter のフォールバックで圏外が再混入するのを防ぐため
    // ソート後に最後に一度だけ適用する
    const parseDistKm = (info: string): number | null => {
      const km = info.match(/([\d.]+)\s*km/);
      if (km) return parseFloat(km[1]);
      const m = info.match(/([\d]+)\s*m\b/);
      if (m) return parseFloat(m[1]) / 1000;
      return null;
    };

    const hardLimitKm = googleRadiusM / 1000;
    const inRange = places.filter(p => {
      const d = parseDistKm(p.distanceInfo ?? "");
      return d === null || d <= hardLimitKm; // パース失敗は通過（除外しない）
    });

    if (inRange.length > 0) {
      places = inRange;
    }
    // inRange が 0 件の場合はフォールバック（スポット0件回避）で元リストを維持
    console.log(`[waiwai] 距離フィルタ後 ${places.length}件（上限 ${hardLimitKm}km）`);

    // ── 予算フィルタ ─────────────────────────────────────────────────────
    if (budget && budget > 0) {
      const budgetFiltered = places.filter(p => isPriceWithinBudget(p.priceLevel, budget));
      if (budgetFiltered.length >= Math.min(3, places.length)) places = budgetFiltered;
      console.log(`[waiwai] 予算フィルタ後 ${places.length}件（上限 ${budget}円）`);
    }

    console.log(`[waiwai] 最終 ${places.length}件`);

    return NextResponse.json({
      data:             places,
      subCategoryLabel: meta.label,
      areaLabel,
    } satisfies WaiWaiApiResponse);

  } catch (e) {
    console.error("[waiwai] エラー:", e);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildDistanceInfo(distKm: number, transport?: string | string[]): string {
  const t       = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
  const distStr = distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm}km`;
  const speedKmh =
    t.includes("徒歩")   ? 4  :
    t.includes("自転車") ? 15 :
    t.includes("バイク") ? 25 :
    t.includes("電車")   ? 40 :
    t.includes("バス")   ? 25 :
    t.includes("車")     ? 40 : 40;
  const modeLabel =
    t.includes("徒歩")   ? "徒歩"   :
    t.includes("自転車") ? "自転車" :
    t.includes("バイク") ? "バイク" :
    t.includes("電車")   ? "電車"   :
    t.includes("バス")   ? "バス"   :
    t.includes("車")     ? "車"     : "";
  const mins    = Math.round((distKm / speedKmh) * 60);
  const timeStr = mins < 60 ? `約${mins}分` : `約${(mins / 60).toFixed(1)}時間`;
  return modeLabel ? `${modeLabel}で${timeStr} / ${distStr}` : distStr;
}

function compactWeekdays(weekdays: string[]): string {
  if (weekdays.length === 0) return "";
  const DAY_SHORT = ["月", "火", "水", "木", "金", "土", "日"];
  const parsed    = weekdays.map((w, i) => {
    const colonIdx = w.indexOf(":");
    if (colonIdx < 0) return { dayIdx: i, hours: w.trim() };
    const dayFull  = w.slice(0, colonIdx).trim();
    const hours    = w.slice(colonIdx + 1).trim();
    const dayIdx   = DAY_SHORT.findIndex(d => dayFull.startsWith(d));
    return { dayIdx: dayIdx >= 0 ? dayIdx : i, hours };
  });
  const groups: { start: number; end: number; hours: string }[] = [];
  for (const p of parsed) {
    const last = groups[groups.length - 1];
    if (last && last.hours === p.hours && p.dayIdx === last.end + 1) {
      last.end = p.dayIdx;
    } else {
      groups.push({ start: p.dayIdx, end: p.dayIdx, hours: p.hours });
    }
  }
  return groups.map(g => {
    const s      = DAY_SHORT[g.start] ?? "";
    const e      = DAY_SHORT[g.end]   ?? "";
    const dayStr =
      g.start === g.end     ? s :
      g.end - g.start === 1 ? `${s}・${e}` :
                              `${s}〜${e}`;
    return `${dayStr}: ${g.hours}`;
  }).join("\n");
}
