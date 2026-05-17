import { NextRequest, NextResponse } from "next/server";
import type { CafeSubCategory, CafeDetail, CafeDistancePref, CafeRequest, CafeApiResponse } from "@/types/cafe";
import type { PlaceResponse } from "@/types/onsen";
import { calcRadiusKm as calcRadiusKmFromTime, isPriceWithinBudget } from "@/lib/calc-radius";

// ────────────────────────────────────────────────────────────────────────────
// カフェ専用 API
//
// サブカテゴリ別の検索戦略:
//   book_relax → Google Places (Text Search New)
//   animal     → Yahoo!ローカルサーチ + Google 写真補完
//               detail=cat   → "猫カフェ"
//               detail=dog   → "犬カフェ / ドッグカフェ"
//               detail=rare  → "ふくろう / ハリネズミ / 動物カフェ"
//   view       → Google Places (Text Search New)
//               detail=ocean  → 海・水辺カフェ
//               detail=forest → 森・緑カフェ
//               detail=city   → 街並み・高層カフェ
//   sweets     → HotPepper Gourmet API + Google 写真補完
// ────────────────────────────────────────────────────────────────────────────

// ── サブカテゴリ静的メタ ───────────────────────────────────────────────────
// クエリは detail に応じて buildQueries() で動的生成するため、ここには
// ラベル / HotPepper 設定 / 名前フィルタ のみ保持する
interface SubCategoryMeta {
  label:            string;
  hotpepperGenre:   string | null;
  hotpepperKeyword: string | null;
  nameKeywords:     string[] | null;   // スポット名フィルタ（null=フィルタなし）
  usesYahoo:        boolean;           // Yahoo!ローカルサーチを使うか
  usesHotpepper:    boolean;           // HotPepper を使うか
}

const SUB_CATEGORY_META: Record<CafeSubCategory, SubCategoryMeta> = {
  book_relax: {
    label:            "📚 ブックカフェ・隠れ家カフェ",
    hotpepperGenre:   null,
    hotpepperKeyword: null,
    nameKeywords:     null,
    usesYahoo:        false,
    usesHotpepper:    false,
  },
  animal: {
    label:            "🐱 アニマルカフェ",
    hotpepperGenre:   null,
    hotpepperKeyword: null,
    nameKeywords:     ["猫", "ねこ", "ネコ", "犬", "いぬ", "イヌ", "うさぎ", "ウサギ",
                       "フクロウ", "ふくろう", "アニマル", "動物", "owl", "cat",
                       "rabbit", "bird", "鳥", "ハリネズミ", "爬虫類", "カワウソ", "dog"],
    usesYahoo:        true,
    usesHotpepper:    false,
  },
  view: {
    label:            "🌅 景色が良いカフェ",
    hotpepperGenre:   null,
    hotpepperKeyword: null,
    nameKeywords:     null,
    usesYahoo:        false,
    usesHotpepper:    false,
  },
  sweets: {
    label:            "🍰 絶品スイーツカフェ",
    hotpepperGenre:   "G014",
    hotpepperKeyword: "スイーツ ケーキ パンケーキ パフェ",
    nameKeywords:     null,
    usesYahoo:        false,
    usesHotpepper:    true,
  },
};

// ── 動的クエリ生成 ────────────────────────────────────────────────────────
// detail と areaLabel を受け取り、各 API の検索クエリを組み立てる
// useArea=true のとき市区町村名をクエリ先頭に付加する（近場のみ）
interface QuerySet {
  googleQueries:  string[];
  yahooKeywords:  string[];
}

function buildQueries(
  subCategory: CafeSubCategory,
  detail:      CafeDetail | undefined,
  areaLabel:   string,
  useArea:     boolean,
): QuerySet {
  const a = useArea && areaLabel && areaLabel !== "現在地周辺" ? `${areaLabel} ` : "";

  switch (subCategory) {
    case "book_relax":
      return {
        googleQueries: [
          `${a}ブックカフェ 読書 静か`,
          `${a}隠れ家カフェ 落ち着く`,
          `${a}古民家カフェ レトロ`,
          `${a}一人でゆっくり カフェ`,
        ],
        yahooKeywords: [],
      };

    case "animal": {
      if (detail === "cat") {
        return {
          googleQueries: ["猫カフェ", `${a}猫カフェ`],
          yahooKeywords: ["猫カフェ"],
        };
      }
      if (detail === "dog") {
        return {
          // "ドッグカフェ" に絞り、"ドッグラン" が混入しないよう "カフェ" を明示
          googleQueries: ["犬カフェ", "ドッグカフェ", `${a}犬カフェ`, `${a}ドッグカフェ`],
          yahooKeywords: ["犬カフェ", "ドッグカフェ"],
        };
      }
      // detail === "rare" または未選択
      // "動物カフェ" は猫・犬カフェも引っかかるため除外し、種類ごとに明示
      return {
        googleQueries: [
          "ふくろうカフェ", "ハリネズミカフェ", "うさぎカフェ",
          "カワウソカフェ", "カピバラカフェ", "爬虫類カフェ",
        ],
        yahooKeywords: ["ふくろうカフェ", "ハリネズミカフェ", "うさぎカフェ"],
      };
    }

    case "view": {
      if (detail === "ocean") {
        return {
          googleQueries: [
            `${a}海が見えるカフェ`,
            `${a}オーシャンビュー カフェ`,
            `${a}海辺カフェ テラス`,
            `${a}ビーチカフェ 海岸`,
          ],
          yahooKeywords: [],
        };
      }
      if (detail === "forest") {
        return {
          googleQueries: [
            `${a}山の中カフェ 森`,
            `${a}里山カフェ 緑`,
            `${a}森林カフェ`,
            `${a}庭園カフェ 自然`,
          ],
          yahooKeywords: [],
        };
      }
      // detail === "city" または未選択
      // ホテルラウンジ・スカイバー・高層カフェを狙う。観光タワー・公園系は後段フィルタで除去
      return {
        googleQueries: [
          `${a}スカイラウンジ カフェ`,
          `${a}ホテルラウンジ 夜景`,
          `${a}高層階 カフェ 夜景`,
          `${a}ルーフトップバー 夜景`,
        ],
        yahooKeywords: [],
      };
    }

    case "sweets":
      return {
        googleQueries: [
          `${a}パンケーキ スイーツ カフェ 人気`,
          `${a}ケーキ 自家製 カフェ`,
          `${a}アフタヌーンティー カフェ`,
          `${a}パフェ スイーツ カフェ`,
        ],
        yahooKeywords: [],
      };
  }
}

// ── 説明文生成（description フィールドに設定する一言）────────────────────
function buildDescription(subCategory: CafeSubCategory, detail: CafeDetail | undefined): string {
  switch (subCategory) {
    case "book_relax": return "本と静寂に包まれた隠れ家カフェ";
    case "animal":
      if (detail === "cat")  return "猫と過ごすゆったりカフェタイム";
      if (detail === "dog")  return "ワンちゃんと遊べるドッグカフェ";
      return "珍しい動物たちとふれあえるカフェ";
    case "view":
      if (detail === "ocean")  return "海が見える絶景テラスカフェ";
      if (detail === "forest") return "森や緑に囲まれた癒やしカフェ";
      return "高層階から街並みを眺めるカフェ";
    case "sweets": return "こだわりスイーツが絶品のカフェ";
  }
}

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
function calcRadiusM(transport?: string | string[]): number {
  const modes = Array.isArray(transport) ? transport : (transport ? [transport] : []);
  if (modes.length === 0) return 10_000; // デフォルト 10km

  const radii = modes.map(m => {
    if (m.includes("徒歩"))                            return  2_000;  // 徒歩: 2km
    if (m.includes("自転車"))                          return  5_000;  // 自転車: 5km
    if (m.includes("バイク"))                          return 10_000;  // バイク: 10km
    if (m.includes("電車") || m.includes("バス"))      return 10_000;  // 電車・バス: 10km
    if (m.includes("車"))                              return 20_000;  // 車: 20km
    return 10_000;
  });
  return Math.max(...radii);
}

// ── 距離プリセット ────────────────────────────────────────────────────────
interface DistConfig {
  minDistKm:  number;
  maxDistKm:  number;
  sortByDist: boolean;
}
const DIST_CONFIG: Record<CafeDistancePref, DistConfig> = {
  近場:    { minDistKm:  0, maxDistKm:  5, sortByDist: false },
  ほどほど: { minDistKm:  5, maxDistKm: 20, sortByDist: false }, // 3km→5km: 近場と被らないよう調整
  遠く:    { minDistKm: 10, maxDistKm: 40, sortByDist: true  },
};

// ── 検索センター生成（自然ルートと同じオフセット戦略）───────────────────
interface SearchCenter {
  lat:            number;
  lng:            number;
  radiusM:        number;
  useRestriction: boolean;
}

function getSearchCenters(
  lat:          number,
  lng:          number,
  distancePref: CafeDistancePref | undefined,
  _baseRadiusM: number, // 近場・未選択では使わない（transport に引きずられないよう固定値を使用）
): SearchCenter[] {
  // 近場・未選択 → ユーザー位置を中心に固定 6km（交通手段による拡大を禁止）
  if (!distancePref || distancePref === "近場") {
    return [{ lat, lng, radiusM: 6_000, useRestriction: true }];
  }

  // ほどほど(3-15km): オフセット9km / 検索半径12km
  // 遠く(10-40km)  : オフセット25km / 検索半径18km
  const offsetKm = distancePref === "ほどほど" ? 9 : 25;
  const searchR  = distancePref === "ほどほど" ? 12_000 : 18_000;

  const dLat = offsetKm / 111.0;
  const dLng = offsetKm / (111.0 * Math.cos(lat * Math.PI / 180));

  // 8方向でリングをカバー。全て locationRestriction（ハード制約）
  return [
    { lat: lat + dLat,             lng,              radiusM: searchR, useRestriction: true }, // N
    { lat: lat - dLat,             lng,              radiusM: searchR, useRestriction: true }, // S
    { lat,              lng: lng + dLng,             radiusM: searchR, useRestriction: true }, // E
    { lat,              lng: lng - dLng,             radiusM: searchR, useRestriction: true }, // W
    { lat: lat + dLat * 0.7, lng: lng + dLng * 0.7, radiusM: searchR, useRestriction: true }, // NE
    { lat: lat - dLat * 0.7, lng: lng + dLng * 0.7, radiusM: searchR, useRestriction: true }, // SE
    { lat: lat - dLat * 0.7, lng: lng - dLng * 0.7, radiusM: searchR, useRestriction: true }, // SW
    { lat: lat + dLat * 0.7, lng: lng - dLng * 0.7, radiusM: searchR, useRestriction: true }, // NW
  ];
}

// ── 円 → 矩形変換（locationRestriction は rectangle のみ対応）────────────
// locationBias は circle / rectangle 両対応。
// locationRestriction は rectangle のみ。circle を渡すと 400 エラーになる。
function circleToRect(lat: number, lng: number, radiusM: number) {
  const dLat = radiusM / 111_000;
  const dLng = radiusM / (111_000 * Math.cos(lat * Math.PI / 180));
  return {
    low:  { latitude: lat - dLat, longitude: lng - dLng },
    high: { latitude: lat + dLat, longitude: lng + dLng },
  };
}

// ── Google Places Text Search ─────────────────────────────────────────────
// useRestriction=true  → locationRestriction（ハード制約・矩形）
//                         指定範囲外は絶対に返さない → 福岡など遠方の排除に必須
// useRestriction=false → locationBias（ソフト制約・円）
//                         フォールバック時のみ使用（結果 0 件対策）
async function searchGooglePlaces(
  textQuery:      string,
  lat:            number,
  lng:            number,
  radiusM:        number,
  googleKey:      string,
  useRestriction: boolean = true,
  maxResults:     number  = 20,
): Promise<Record<string, unknown>[]> {
  const locationField = useRestriction
    ? { locationRestriction: { rectangle: circleToRect(lat, lng, radiusM) } }
    : { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } } };

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
        minRating:      3.0,
        ...locationField,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[cafe] Google "${textQuery}" HTTP ${res.status} ${errBody.slice(0, 160)}`);
      return [];
    }
    const data   = await res.json();
    const places = (data.places ?? []) as Record<string, unknown>[];
    console.log(`[cafe] Google "${textQuery}" (${useRestriction ? "restrict□" : "bias○"} r=${radiusM/1000}km) → ${places.length}件`);
    return places;
  } catch (e) {
    console.warn(`[cafe] Google "${textQuery}" 例外:`, e);
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
  keywords: string[],
  lat:      number,
  lng:      number,
  radiusM:  number,
): Promise<YahooPlace[]> {
  const apiKey = process.env.YAHOO_LOCAL_SEARCH_API_KEY;
  if (!apiKey) { console.warn("[cafe] YAHOO_LOCAL_SEARCH_API_KEY 未設定"); return []; }

  const distKm = String(Math.min(Math.round(radiusM / 1000), 20));
  const tasks  = keywords.map(kw => fetchYahooFeatures(apiKey, lat, lng, distKm, kw));
  const settled = await Promise.allSettled(tasks);

  const seen:    Set<string>   = new Set();
  const results: YahooPlace[]  = [];

  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const f of r.value) {
      const name = String(f.Name ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);

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
  }
  return results;
}

async function fetchYahooFeatures(
  apiKey: string, lat: number, lng: number, dist: string, keyword: string,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    appid: apiKey, lat: String(lat), lon: String(lng),
    dist, results: "30", sort: "score", output: "json", query: keyword,
  });
  try {
    const res = await fetch(
      `https://map.yahooapis.jp/search/local/V1/localSearch?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) { console.warn(`[cafe] Yahoo "${keyword}" HTTP ${res.status}`); return []; }
    const json     = await res.json();
    const features = (json.Feature ?? []) as Record<string, unknown>[];
    console.log(`[cafe] Yahoo "${keyword}" → ${features.length}件`);
    return features;
  } catch (e) {
    console.warn(`[cafe] Yahoo "${keyword}" 例外:`, e);
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
  photo?:  { mobile?: { l?: string } };
}

// HotPepper の range パラメータ: 1=300m,2=500m,3=1km,4=2km,5=3km
function hotpepperRange(radiusM: number): number {
  if (radiusM <=   500) return 2;
  if (radiusM <= 1_000) return 3;
  if (radiusM <= 2_000) return 4;
  return 5; // 3km まで（HotPepper の上限）
}

async function searchHotpepper(
  genre:   string,
  keyword: string,
  lat:     number,
  lng:     number,
  radiusM: number,
): Promise<HotpepperShop[]> {
  const apiKey = process.env.HOTPEPPER_API_KEY;
  if (!apiKey) { console.warn("[cafe] HOTPEPPER_API_KEY 未設定"); return []; }

  const params = new URLSearchParams({
    key:     apiKey,
    lat:     String(lat),
    lng:     String(lng),
    range:   String(hotpepperRange(radiusM)),
    genre,
    keyword,
    count:   "30",
    format:  "json",
  });

  try {
    const res = await fetch(
      `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) { console.warn(`[cafe] HotPepper HTTP ${res.status}`); return []; }
    const data  = await res.json();
    const shops = (data?.results?.shop ?? []) as HotpepperShop[];
    console.log(`[cafe] HotPepper genre=${genre} → ${shops.length}件`);
    return shops;
  } catch (e) {
    console.warn("[cafe] HotPepper 例外:", e);
    return [];
  }
}

// ── Google Places で写真・評価を補完（Yahoo / HotPepper 結果向け）────────
async function enrichWithGoogle(
  places:      Array<{ name: string; address: string; lat: number; lng: number; hotpepperUrl?: string }>,
  googleKey:   string,
  label:       string,
  originLat:   number,
  originLng:   number,
  transport?:  string | string[],
  description: string = "",
): Promise<PlaceResponse[]> {
  const tasks = places.map(async (p): Promise<PlaceResponse> => {
    const query   = `${p.name} ${p.address.slice(0, 20)}`;
    const results = await searchGooglePlaces(query, p.lat, p.lng, 500, googleKey, false, 1);
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
      id:           gp ? String(gp.id ?? `cafe-${p.name}`) : `cafe-${p.name}`,
      name:         p.name,
      category:     label,
      description,
      imageUrl:     photoUrls[0] ?? "",
      rating:       gp && typeof gp.rating         === "number" ? gp.rating          : null,
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
    description?: string;
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
    id:           String(place.id ?? `cafe-${name}`),
    name,
    category:     opts.label,
    description:  opts.description ?? "",
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
    const idKey = p.id.startsWith("cafe-") ? null : p.id;
    if ((idKey && seenIds.has(idKey)) || seenNames.has(p.name.trim())) continue;
    if (idKey) seenIds.add(idKey);
    seenNames.add(p.name.trim());
    result.push(p);
  }
  return result;
}

// ── 品質フィルタ ─────────────────────────────────────────────────────────
function qualityFilter(places: PlaceResponse[], wantMin: number): PlaceResponse[] {
  const byQ = (minR: number, minRev: number) =>
    places.filter(p => (p.rating ?? 0) >= minR && (p.reviewCount ?? 0) >= minRev);

  if (byQ(4.0, 50).length >= wantMin) return byQ(4.0, 50);
  if (byQ(3.8, 20).length >= wantMin) return byQ(3.8, 20);
  if (byQ(3.8,  5).length >= wantMin) return byQ(3.8,  5);
  if (byQ(3.5,  1).length >= wantMin) return byQ(3.5,  1);
  return places; // 品質基準なし（全件）
}

// ── 名前フィルタ ─────────────────────────────────────────────────────────
function nameFilter(places: PlaceResponse[], keywords: string[] | null): PlaceResponse[] {
  if (!keywords) return places;
  const filtered = places.filter(p =>
    keywords.some(k => p.name.includes(k) || (p.address ?? "").includes(k))
  );
  return filtered.length >= 3 ? filtered : places;
}

// ── アニマル詳細フィルタ（detail 別 include / exclude）────────────────────
// detail=cat  : 猫関連を優先し犬専門店を除外
// detail=dog  : 犬関連を優先しドッグランを除外
// detail=rare : 珍しい動物を優先し猫・犬専門店を除外
function animalDetailFilter(places: PlaceResponse[], detail: CafeDetail | undefined): PlaceResponse[] {
  if (!detail) return places;

  const has = (text: string, kws: string[]) =>
    kws.some(k => text.toLowerCase().includes(k.toLowerCase()));

  const CAT_KW   = ["猫", "ねこ", "ネコ", "cat", "にゃん", "ニャン"];
  const DOG_KW   = ["犬", "いぬ", "イヌ", "dog", "わん", "ドッグ"];
  const DOGRUN   = ["ドッグラン", "ドックラン", "dog run", "dogrun"];
  const RARE_KW  = [
    "フクロウ", "ふくろう", "owl",
    "ハリネズミ", "はりねずみ",
    "うさぎ", "ウサギ", "rabbit",
    "カワウソ", "かわうそ",
    "カピバラ", "かぴばら",
    "爬虫類", "はちゅう",
    "インコ", "いんこ",
    "鳥カフェ", "とりカフェ",
    "アニマルカフェ", "動物カフェ",
  ];

  if (detail === "cat") {
    const strict   = places.filter(p => has(p.name, CAT_KW) && !has(p.name, DOG_KW));
    const withDog  = places.filter(p => has(p.name, CAT_KW));
    const noDog    = places.filter(p => !has(p.name, DOG_KW));
    if (strict.length  >= 3) return strict;
    if (withDog.length >= 3) return withDog;
    if (noDog.length   >= 3) return noDog;
    return places;
  }

  if (detail === "dog") {
    const strict    = places.filter(p => has(p.name, DOG_KW) && !has(p.name, DOGRUN));
    const withRun   = places.filter(p => has(p.name, DOG_KW));
    if (strict.length  >= 3) return strict;
    if (withRun.length >= 3) return withRun;
    return places;
  }

  if (detail === "rare") {
    const strict   = places.filter(p => has(p.name, RARE_KW) && !has(p.name, CAT_KW) && !has(p.name, DOG_KW));
    const noPets   = places.filter(p => has(p.name, RARE_KW));
    const noCommon = places.filter(p => !has(p.name, CAT_KW) && !has(p.name, DOG_KW));
    if (strict.length  >= 3) return strict;
    if (noPets.length  >= 3) return noPets;
    if (noCommon.length >= 3) return noCommon;
    return places;
  }

  return places;
}

// ── 景色詳細フィルタ（detail 別キーワード関連性チェック）──────────────────
// 名前・住所に景色タイプのキーワードが含まれる場所を優先する
// ※ 完全一致は要求しない（景色カフェは店名に景色名が入らないことも多い）
function viewDetailFilter(places: PlaceResponse[], detail: CafeDetail | undefined): PlaceResponse[] {
  if (!detail) return places;

  const has = (text: string, kws: string[]) =>
    kws.some(k => text.toLowerCase().includes(k.toLowerCase()));

  if (detail === "ocean") {
    const OCEAN_KW = ["海", "ビーチ", "ocean", "beach", "マリン", "海岸", "海辺", "港", "湘南", "coast"];
    const filtered = places.filter(p =>
      has(p.name, OCEAN_KW) || has(p.address ?? "", OCEAN_KW)
    );
    return filtered.length >= 3 ? filtered : places;
  }

  if (detail === "forest") {
    const FOREST_KW = ["森", "山", "里山", "庭園", "緑", "自然", "林", "garden", "green", "谷"];
    const filtered = places.filter(p =>
      has(p.name, FOREST_KW) || has(p.address ?? "", FOREST_KW)
    );
    return filtered.length >= 3 ? filtered : places;
  }

  if (detail === "city") {
    // ── 高層・ホテル環境の指標 ────────────────────────────────────────
    // 「タワー」は観光タワーも引くためここには含めない
    // 「階」は住所に "23階" "ウェスティンホテル横浜 23階" のように含まれる
    const HIGH_KW = [
      "スカイ", "sky", "高層", "屋上", "ルーフ", "roof",
      "ホテル", "hotel",
      "階",   // 住所の階表記: "ウェスティンホテル横浜 23階" など
    ];
    // ── 飲食業態キーワード（フォールバック用）──────────────────────────
    const CAFE_KW = [
      "カフェ", "cafe", "coffee", "コーヒー",
      "bar", "バー", "ラウンジ", "lounge",
      "ビストロ", "bistro", "喫茶", "茶",
      "ダイニング", "dining", "レストラン", "restaurant",
    ];

    // ① 名前 or 住所に高層・ホテル系キーワードがある
    //   例: Lobby Lounge → 住所に "ウェスティンホテル横浜" "23階" → 通過
    //   例: スカイラウンジ〇〇 → 名前に "スカイ" → 通過
    //   例: CAFE&ZAKKA HUT, リバーストーン, 海の家 → 該当なし → 除外
    const withHighRise = places.filter(p =>
      has(p.name, HIGH_KW) || has(p.address ?? "", HIGH_KW)
    );
    if (withHighRise.length >= 3) return withHighRise;

    // ② 過疎エリア対策: 飲食業態キーワードが名前にある
    const withCafe = places.filter(p => has(p.name, CAFE_KW));
    if (withCafe.length >= 3) return withCafe;

    return places;
  }

  return places;
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

// ────────────────────────────────────────────────────────────────────────────
// POST ハンドラ
// ────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CafeRequest> & {
      time?: string;
      companion?: string;
      budget?: number;
      freeWord?: string;
    };
    const { subCategory, detail, areaLabel = "現在地周辺", transport, time, companion, budget, freeWord } = body;
    const lat = body.lat;
    const lng = body.lng;

    if (companion) console.log(`[cafe] companion="${companion}"`);
    if (freeWord)  console.log(`[cafe] freeWord="${freeWord}"`);

    if (!subCategory || !SUB_CATEGORY_META[subCategory]) {
      return NextResponse.json(
        { error: "subCategory は book_relax / animal / view / sweets のいずれかを指定してください" },
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
      console.log(`[cafe] ジオコード "${areaLabel}" → (${searchLat.toFixed(4)}, ${searchLng.toFixed(4)})`);
    }

    const meta         = SUB_CATEGORY_META[subCategory];
    const distancePref = body.distancePref;
    const transportArr = Array.isArray(transport) ? transport : (transport ? [transport] : []);
    const baseRadiusM  = (time && transportArr.length > 0)
      ? calcRadiusKmFromTime(transportArr, time) * 1000
      : calcRadiusM(transport);

    // ── 動的クエリ生成 ─────────────────────────────────────────────────
    // 近場のみエリア名をクエリに付加（ほどほど・遠くはオフセットセンター戦略で補う）
    const useArea     = !distancePref || distancePref === "近場";
    const queriesBase = buildQueries(subCategory, detail, areaLabel, useArea);
    // freeWord があれば Google クエリに付加
    const queries: typeof queriesBase = {
      ...queriesBase,
      googleQueries: freeWord
        ? queriesBase.googleQueries.map(q => `${q} ${freeWord}`)
        : queriesBase.googleQueries,
    };
    const description = buildDescription(subCategory, detail);

    // ── 距離設定を決定 ─────────────────────────────────────────────────
    const dc: DistConfig = distancePref && DIST_CONFIG[distancePref]
      ? DIST_CONFIG[distancePref]
      : { minDistKm: 0, maxDistKm: baseRadiusM / 1000, sortByDist: false };

    // ── 検索センター計算 ─────────────────────────────────────────────
    const centers = getSearchCenters(searchLat, searchLng, distancePref, baseRadiusM);

    console.log(`[cafe] ▶ ${meta.label} detail=${detail ?? "-"} pref=${distancePref ?? "デフォルト"} min=${dc.minDistKm}km max=${dc.maxDistKm}km centers=${centers.length}`);

    const opts = { label: meta.label, description, transport, originLat: searchLat, originLng: searchLng };

    // ── 検索実行ヘルパー（Google Places）──────────────────────────────
    const runGoogleSearch = async (searchCenters: SearchCenter[], googleQueries: string[]) => {
      if (!googleQueries.length) return [] as Record<string, unknown>[];
      const tasks = searchCenters.flatMap(c =>
        googleQueries.map(q =>
          searchGooglePlaces(q, c.lat, c.lng, c.radiusM, googleKey, c.useRestriction)
        )
      );
      const settled = await Promise.allSettled(tasks);
      const raw: Record<string, unknown>[] = [];
      for (const r of settled) {
        if (r.status === "fulfilled") raw.push(...r.value);
      }
      return raw;
    };

    let places: PlaceResponse[] = [];

    // ── Google Places 検索（オフセットセンター + locationRestriction）──
    if (queries.googleQueries.length > 0) {
      const raw    = await runGoogleSearch(centers, queries.googleQueries);
      console.log(`[cafe] Google raw ${raw.length}件`);
      const mapped = raw.map(p => mapGoogleToPlaceResponse(p, googleKey, opts));
      places.push(...mapped);
    }

    // ── Yahoo Local Search（animal サブカテゴリ）─────────────────────
    if (meta.usesYahoo && queries.yahooKeywords.length > 0) {
      const yahooRadiusM = distancePref === "遠く" ? 40_000 : distancePref === "ほどほど" ? 15_000 : baseRadiusM;
      const yahooPlaces  = await searchYahoo(queries.yahooKeywords, searchLat, searchLng, yahooRadiusM);
      if (yahooPlaces.length > 0) {
        const enriched = await enrichWithGoogle(
          yahooPlaces, googleKey, meta.label, searchLat, searchLng, transport, description,
        );
        places.push(...enriched);
      }
      console.log(`[cafe] Yahoo → ${yahooPlaces.length}件`);
    }

    // ── HotPepper Gourmet（sweets サブカテゴリ）──────────────────────
    if (meta.usesHotpepper && meta.hotpepperGenre && meta.hotpepperKeyword) {
      const hpShops = await searchHotpepper(
        meta.hotpepperGenre, meta.hotpepperKeyword,
        searchLat, searchLng, baseRadiusM,
      );
      if (hpShops.length > 0) {
        const hpForEnrich = hpShops.map(s => ({
          name:          s.name,
          address:       s.address,
          lat:           s.lat,
          lng:           s.lng,
          hotpepperUrl:  s.urls?.pc ?? undefined,
        }));
        const enriched = await enrichWithGoogle(
          hpForEnrich, googleKey, meta.label, searchLat, searchLng, transport, description,
        );
        places.push(...enriched);
      }
    }

    // ── フォールバック: 結果が少ない場合は広域 locationBias で補完 ────
    if (places.length < 5 && queries.googleQueries.length > 0) {
      const fbRadius = Math.max(dc.maxDistKm * 1_200, 30_000);
      const raw      = await runGoogleSearch(
        [{ lat: searchLat, lng: searchLng, radiusM: fbRadius, useRestriction: false }],
        queries.googleQueries,
      );
      console.log(`[cafe] フォールバック bias r=${fbRadius/1000}km → ${raw.length}件`);
      const existing = new Set(places.map(p => p.id));
      const mapped   = raw
        .filter(p => !existing.has(String(p.id ?? "")))
        .map(p => mapGoogleToPlaceResponse(p, googleKey, opts));
      places.push(...mapped);
    }

    // ── 重複除去 ─────────────────────────────────────────────────────
    places = dedup(places);
    console.log(`[cafe] dedup後 ${places.length}件`);

    // ── 距離フィルタ（distancePref の min〜max 範囲に絞る）───────────
    // buildDistanceInfo の出力形式:
    //   交通手段あり: "電車で約3分 / 2.1km"  "徒歩で約7分 / 500m"
    //   交通手段なし: "2.1km"               "500m"
    const parseDistKm = (info: string): number | null => {
      // km 表記を優先（"2.1km" にも "/ 2.1km" にもマッチ）
      const km = info.match(/([\d.]+)\s*km/);
      if (km) return parseFloat(km[1]);
      // m 表記: "500m" 単体 / "/ 500m" 末尾 の両方に対応
      const m = info.match(/(?:^|\/ )([\d]+)\s*m\b/);
      if (m) return parseFloat(m[1]) / 1000;
      return null;
    };

    if (distancePref) {
      const minKm = dc.minDistKm;
      const maxKm = dc.maxDistKm;

      const dist = (p: PlaceResponse) => parseDistKm(p.distanceInfo ?? "");

      // フォールバック戦略:
      //   ① [min,   max]       厳密
      //   ② [min,   max×1.5]   max を緩める
      //   ③ [min/2, max×2]     min も半減しつつ max を伸ばす
      //   ④ [0,     max×3]     min を完全解除・max だけ維持（近場が混じることを許容）
      //   ⑤ places             絶対最終手段（過疎エリア対策）
      const f = (minK: number, maxMult: number) =>
        places.filter(p => { const d = dist(p); return d === null || (d >= minK && d <= maxKm * maxMult); });

      let filtered = f(minKm, 1.0);
      if (filtered.length < 3) filtered = f(minKm,       1.5);
      if (filtered.length < 3) filtered = f(minKm / 2,   2.0);
      if (filtered.length < 3) filtered = f(0,            3.0);
      if (filtered.length < 3) filtered = places;

      console.log(`[cafe] 距離フィルタ ${places.length} → ${filtered.length}件 (${minKm}〜${maxKm}km)`);
      places = filtered;
    } else {
      // distancePref 未選択: 交通手段ベースの半径 × 1.5 で上限のみ絞る
      const hardLimitKm = baseRadiusM / 1000 * 1.5;
      const inRange = places.filter(p => {
        const d = parseDistKm(p.distanceInfo ?? "");
        return d === null || d <= hardLimitKm;
      });
      if (inRange.length >= 3) places = inRange;
    }

    // ── 名前フィルタ（animal カテゴリ専用: アニマル関連語で1次絞り込み）──
    places = nameFilter(places, meta.nameKeywords);

    // ── アニマル詳細フィルタ（cat/dog/rare で include/exclude）──────
    if (subCategory === "animal") {
      const before = places.length;
      places = animalDetailFilter(places, detail);
      console.log(`[cafe] animalDetailFilter ${before} → ${places.length}件 (detail=${detail})`);
    }

    // ── 景色詳細フィルタ（ocean/forest/city のキーワード関連性チェック）─
    if (subCategory === "view") {
      const before = places.length;
      places = viewDetailFilter(places, detail);
      console.log(`[cafe] viewDetailFilter ${before} → ${places.length}件 (detail=${detail})`);
    }

    // ── 品質フィルタ ─────────────────────────────────────────────────
    places = qualityFilter(places, 10);

    // ── ソート（遠く=距離順 / それ以外=評価順）───────────────────────
    places.sort((a, b) => {
      if (dc.sortByDist) {
        const da = parseDistKm(a.distanceInfo ?? "") ?? 0;
        const db = parseDistKm(b.distanceInfo ?? "") ?? 0;
        return db - da; // 遠い順
      }
      return (b.rating ?? 0) - (a.rating ?? 0); // 評価高い順
    });

    // ── 予算フィルタ ──────────────────────────────────────────────────────
    if (budget && budget > 0) {
      const budgetFiltered = places.filter(p => isPriceWithinBudget(p.priceLevel, budget));
      if (budgetFiltered.length >= Math.min(3, places.length)) places = budgetFiltered;
      console.log(`[cafe] 予算フィルタ後 ${places.length}件（上限 ${budget}円）`);
    }

    console.log(`[cafe] 最終 ${places.length}件`);

    return NextResponse.json({
      data:               places,
      subCategoryLabel:   meta.label,
      areaLabel,
    } satisfies CafeApiResponse);

  } catch (e) {
    console.error("[cafe] エラー:", e);
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
    const dayFull = w.slice(0, colonIdx).trim();
    const hours   = w.slice(colonIdx + 1).trim();
    const dayIdx  = DAY_SHORT.findIndex(d => dayFull.startsWith(d));
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
