import { NextRequest, NextResponse } from "next/server";
import type { FocusSubCategory, FocusRequest, FocusApiResponse } from "@/types/focus";
import type { PlaceResponse } from "@/types/onsen";
import { calcRadiusKm as calcRadiusKmFromTime, isPriceWithinBudget } from "@/lib/calc-radius";

// ────────────────────────────────────────────────────────────────────────────
// 集中したい専用 API
//
// サブカテゴリ別APIルーティング:
//   work_cafe         → Google Places Text Search (Wi-Fi・電源完備カフェ)
//   coworking         → Google Places Text Search (コワーキング・自習室)
//   family_restaurant → Yahoo!ローカルサーチ (ファミリーレストラン) + Google写真補完
//   netcafe_library   → Yahoo!ローカルサーチ (ネットカフェ・図書館) + Google写真補完
//
// 段階的フォールバック（最大3ステップ）:
//   STEP 1: 厳密クエリ + 評価フィルタ + 移動手段別初期半径
//   STEP 2: クエリ・評価を緩和（同半径）
//   STEP 3: 半径を2倍に拡大（緩和クエリ）
// ────────────────────────────────────────────────────────────────────────────

// ── 定数 ────────────────────────────────────────────────────────────────────
const TARGET     = 10;
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

// ── 移動手段→初期検索半径 ────────────────────────────────────────────────────
function getRadiusM(transport: string | string[] | undefined): number {
  const t = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
  if (t.includes("徒歩") || t.includes("walk"))     return 1_000;
  if (t.includes("自転車") || t.includes("bicycle")) return 3_000;
  if (t.includes("電車") || t.includes("バス") || t.includes("train") || t.includes("bus")) return 5_000;
  if (t.includes("車") || t.includes("バイク") || t.includes("car") || t.includes("bike")) return 10_000;
  return 5_000; // デフォルト
}

// ── サブカテゴリ設定 ─────────────────────────────────────────────────────────
interface GoogleConfig {
  api:            "google";
  label:          string;
  description:    string;
  strictQueries:  string[];   // 厳密クエリ（Wi-Fi・電源など）
  relaxedQueries: string[];   // 緩和クエリ
  initialMinRating?: number;  // 省略時はフィルタなし
}

interface YahooConfig {
  api:                   "yahoo";
  label:                 string;
  description:           string;
  yahooGcCodes:          string[];  // 業種コード
  yahooStrictKeyword:    string;    // STEP1用キーワード（24時間など）
  yahooRelaxedKeyword:   string;    // STEP2以降（gc のみ or 単純キーワード）
  yahooInitialDistKm:    number;
  googleFallbackQueries: string[];  // Yahoo で不足時の Google フォールバック
}

type SubCategoryConfig = GoogleConfig | YahooConfig;

const FOCUS_CONFIG: Record<FocusSubCategory, SubCategoryConfig> = {
  work_cafe: {
    api:            "google",
    label:          "☕ カフェ作業",
    description:    "Wi-Fi・電源完備で集中して作業が捗るカフェ！",
    strictQueries:  [
      "{area} カフェ Wi-Fi 電源 作業 落ち着く",
      "{area} ワークカフェ Wi-Fi 電源あり",
    ],
    relaxedQueries: [
      "{area} 落ち着くカフェ 作業",
      "{area} カフェ 長居OK",
      "{area} コーヒーショップ 作業",
    ],
    initialMinRating: 3.8,
  },
  coworking: {
    api:            "google",
    label:          "🖥️ コワーキング・自習室",
    description:    "静かな空間で集中できる専用スペース！",
    strictQueries:  [
      "{area} コワーキングスペース ドロップイン",
      "{area} 自習室 コワーキング",
    ],
    relaxedQueries: [
      "{area} コワーキング",
      "{area} 自習室",
      "{area} シェアオフィス",
    ],
    // 施設数が少ないため initialMinRating は設定しない
  },
  family_restaurant: {
    api:                   "yahoo",
    label:                 "🍳 ファミレス・深夜作業",
    description:           "24時間営業で時間を気にせず粘れるお店！",
    yahooGcCodes:          ["0108", "0106"],   // 洋食レストラン / ファーストフード系
    yahooStrictKeyword:    "ファミリーレストラン 24時間",
    yahooRelaxedKeyword:   "ファミリーレストラン 深夜営業",
    yahooInitialDistKm:    5,
    googleFallbackQueries: [
      "{area} ファミリーレストラン 24時間営業",
      "{area} ドリンクバー 深夜 勉強",
      "{area} ファミレス 長居",
    ],
  },
  netcafe_library: {
    api:                   "yahoo",
    label:                 "📚 ネットカフェ・図書館",
    description:           "漫画や本に囲まれて完全にこもれる場所！",
    yahooGcCodes:          ["0422", "0704"],   // インターネットカフェ / 図書館
    yahooStrictKeyword:    "インターネットカフェ 漫画喫茶",
    yahooRelaxedKeyword:   "ネットカフェ",
    yahooInitialDistKm:    5,
    googleFallbackQueries: [
      "{area} インターネットカフェ 個室",
      "{area} マンガ喫茶 ドリンクバー",
      "{area} 図書館 自習スペース",
    ],
  },
};

// ── Google Places Text Search ────────────────────────────────────────────────
async function searchGooglePlaces(
  textQuery:  string,
  lat:        number,
  lng:        number,
  radiusM:    number,
  googleKey:  string,
  minRating?: number,
  maxResults: number = 20,
): Promise<Record<string, unknown>[]> {
  try {
    const body: Record<string, unknown> = {
      textQuery,
      languageCode:   "ja",
      regionCode:     "JP",
      maxResultCount: maxResults,
      locationBias: {
        circle: { center: { latitude: lat, longitude: lng }, radius: radiusM },
      },
    };
    if (minRating !== undefined) body.minRating = minRating;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   googleKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.warn(`[focus] Google "${textQuery}" HTTP ${res.status} ${err.slice(0, 120)}`);
      return [];
    }
    const data   = await res.json();
    const places = (data.places ?? []) as Record<string, unknown>[];
    console.log(`[focus] Google "${textQuery}" r=${radiusM / 1000}km${minRating ? ` minR=${minRating}` : ""} → ${places.length}件`);
    return places;
  } catch (e) {
    console.warn(`[focus] Google "${textQuery}" 例外:`, e);
    return [];
  }
}

// ── Yahoo ローカルサーチ ──────────────────────────────────────────────────────
interface YahooPlace {
  name:    string;
  address: string;
  lat:     number;
  lng:     number;
}

async function searchYahoo(
  gc:      string,
  keyword: string,
  lat:     number,
  lng:     number,
  distKm:  number,
): Promise<YahooPlace[]> {
  const apiKey = process.env.YAHOO_LOCAL_SEARCH_API_KEY;
  if (!apiKey) { console.warn("[focus] YAHOO_LOCAL_SEARCH_API_KEY 未設定"); return []; }

  const params = new URLSearchParams({
    appid:   apiKey,
    lat:     String(lat),
    lon:     String(lng),
    dist:    String(distKm),
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
    if (!res.ok) {
      console.warn(`[focus] Yahoo gc=${gc} "${keyword}" HTTP ${res.status}`);
      return [];
    }
    const json     = await res.json();
    const features = (json.Feature ?? []) as Record<string, unknown>[];
    console.log(`[focus] Yahoo gc=${gc} "${keyword}" dist=${distKm}km → ${features.length}件`);

    return features.map(f => {
      const prop   = (f.Property ?? {}) as Record<string, unknown>;
      const coords = String((f.Geometry as Record<string, unknown>)?.Coordinates ?? "");
      const [lngStr, latStr] = coords.split(",");
      return {
        name:    String(f.Name ?? "").trim(),
        address: String(prop.Address ?? ""),
        lat:     parseFloat(latStr ?? "0"),
        lng:     parseFloat(lngStr ?? "0"),
      };
    }).filter(p => p.name);
  } catch (e) {
    console.warn(`[focus] Yahoo gc=${gc} "${keyword}" 例外:`, e);
    return [];
  }
}

// ── Yahoo 複数 gc を並列実行してマージ ─────────────────────────────────────
async function searchYahooMulti(
  gcCodes:  string[],
  keyword:  string,
  lat:      number,
  lng:      number,
  distKm:   number,
): Promise<YahooPlace[]> {
  const settled = await Promise.allSettled(
    gcCodes.map(gc => searchYahoo(gc, keyword, lat, lng, distKm))
  );
  const seenNames = new Set<string>();
  const results: YahooPlace[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const p of r.value) {
      if (!seenNames.has(p.name)) {
        seenNames.add(p.name);
        results.push(p);
      }
    }
  }
  return results;
}

// ── Yahoo → Google 写真補完 ─────────────────────────────────────────────────
async function enrichWithGoogle(
  yahooPlaces: YahooPlace[],
  googleKey:   string,
  label:       string,
  description: string,
  originLat:   number,
  originLng:   number,
  transport?:  string | string[],
): Promise<PlaceResponse[]> {
  const tasks = yahooPlaces.map(async (p): Promise<PlaceResponse> => {
    const query   = `${p.name} ${p.address.slice(0, 20)}`;
    const results = await searchGooglePlaces(query, p.lat, p.lng, 500, googleKey, undefined, 1);
    const gp      = results[0];

    const photos    = gp ? ((gp.photos as Array<Record<string, unknown>>) ?? []) : [];
    const photoUrls = photos
      .filter(ph => ph?.name)
      .map(ph => `https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=800&key=${googleKey}`);

    const hours    = gp ? (gp.currentOpeningHours as Record<string, unknown> | undefined) : undefined;
    const weekdays = (hours?.weekdayDescriptions as string[] | undefined) ?? [];
    const openNow  = typeof hours?.openNow === "boolean" ? hours.openNow : null;
    const distKm   = Math.round(haversineKm(originLat, originLng, p.lat, p.lng) * 10) / 10;

    return {
      id:           gp ? String(gp.id ?? `focus-${p.name}`) : `focus-${p.name}`,
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
      source:       "google",
    } as PlaceResponse;
  });

  const settled = await Promise.allSettled(tasks);
  return settled
    .filter((r): r is PromiseFulfilledResult<PlaceResponse> => r.status === "fulfilled")
    .map(r => r.value);
}

// ── Google raw → PlaceResponse 変換 ─────────────────────────────────────────
function mapGoogleToPlaceResponse(
  place:    Record<string, unknown>,
  googleKey: string,
  opts: {
    label:       string;
    description: string;
    transport?:  string | string[];
    originLat:   number;
    originLng:   number;
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
  const distKm   = Math.round(haversineKm(opts.originLat, opts.originLng, pLat, pLng) * 10) / 10;

  return {
    id:           String(place.id ?? `focus-${name}`),
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
  } as PlaceResponse;
}

// ── 重複除去 ─────────────────────────────────────────────────────────────────
function dedup(places: PlaceResponse[]): PlaceResponse[] {
  const seenIds   = new Set<string>();
  const seenNames = new Set<string>();
  const result: PlaceResponse[] = [];
  for (const p of places) {
    const idKey = p.id.startsWith("focus-") ? null : p.id;
    if ((idKey && seenIds.has(idKey)) || seenNames.has(p.name.trim())) continue;
    if (idKey) seenIds.add(idKey);
    seenNames.add(p.name.trim());
    result.push(p);
  }
  return result;
}

// ── Google フォールバック付き検索（3ステップ） ──────────────────────────────
// STEP 1: 厳密クエリ + minRating + 初期半径
// STEP 2: 厳密クエリ + minRating解除 + 初期半径
// STEP 3: 緩和クエリ + minRating解除 + 半径2倍
async function runGoogleFallback(
  config:    GoogleConfig,
  area:      string,
  lat:       number,
  lng:       number,
  radiusM:   number,
  googleKey: string,
  transport: string | string[] | undefined,
): Promise<PlaceResponse[]> {
  const seenIds = new Set<string>();
  const results: PlaceResponse[] = [];
  const opts = { label: config.label, description: config.description, transport, originLat: lat, originLng: lng };

  const addBatch = (raw: Record<string, unknown>[]) => {
    for (const p of raw) {
      const id = String(p.id ?? "");
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      const mapped = mapGoogleToPlaceResponse(p, googleKey, opts);
      if (!results.some(r => r.name.trim() === mapped.name.trim())) {
        results.push(mapped);
      }
    }
  };

  const areaStr = area !== "現在地周辺" ? area : "";

  // STEP 1: 厳密クエリ + minRating + 初期半径
  if (results.length < TARGET) {
    console.log(`[focus] STEP 1 Google strict r=${radiusM / 1000}km minR=${config.initialMinRating ?? "なし"} (現在${results.length}件)`);
    const settled = await Promise.allSettled(
      config.strictQueries.map(q =>
        searchGooglePlaces(q.replace("{area}", areaStr), lat, lng, radiusM, googleKey, config.initialMinRating, 20)
      )
    );
    const batch: Record<string, unknown>[] = [];
    for (const r of settled) { if (r.status === "fulfilled") batch.push(...r.value); }
    addBatch(batch);
  }

  // STEP 2: 厳密クエリ + minRating解除 + 同半径
  if (results.length < TARGET) {
    console.log(`[focus] STEP 2 Google strict (no minR) r=${radiusM / 1000}km (現在${results.length}件)`);
    const settled = await Promise.allSettled(
      config.strictQueries.map(q =>
        searchGooglePlaces(q.replace("{area}", areaStr), lat, lng, radiusM, googleKey, undefined, 20)
      )
    );
    const batch: Record<string, unknown>[] = [];
    for (const r of settled) { if (r.status === "fulfilled") batch.push(...r.value); }
    addBatch(batch);
  }

  // STEP 3: 緩和クエリ + minRating解除 + 半径2倍
  if (results.length < TARGET) {
    const expandedRadius = radiusM * 2;
    console.log(`[focus] STEP 3 Google relaxed r=${expandedRadius / 1000}km (現在${results.length}件)`);
    const settled = await Promise.allSettled(
      config.relaxedQueries.map(q =>
        searchGooglePlaces(q.replace("{area}", areaStr), lat, lng, expandedRadius, googleKey, undefined, 20)
      )
    );
    const batch: Record<string, unknown>[] = [];
    for (const r of settled) { if (r.status === "fulfilled") batch.push(...r.value); }
    addBatch(batch);
  }

  return dedup(results).slice(0, TARGET);
}

// ── Yahoo フォールバック付き検索（3ステップ） ─────────────────────────────────
// STEP 1: Yahoo gc + 厳密キーワード + 初期距離
// STEP 2: Yahoo gc + 緩和キーワード + 初期距離
// STEP 3: Yahoo gc + 緩和キーワード + 距離2倍 → 不足時 Google フォールバック
async function runYahooFallback(
  config:    YahooConfig,
  area:      string,
  lat:       number,
  lng:       number,
  googleKey: string,
  transport: string | string[] | undefined,
): Promise<PlaceResponse[]> {
  const seenIds = new Set<string>();
  const results: PlaceResponse[] = [];

  const addYahooEnriched = (places: PlaceResponse[]) => {
    for (const p of places) {
      const idKey = p.id.startsWith("focus-") ? null : p.id;
      if ((idKey && seenIds.has(idKey)) || results.some(r => r.name.trim() === p.name.trim())) continue;
      if (idKey) seenIds.add(idKey);
      results.push(p);
    }
  };

  const addGoogleBatch = (raw: Record<string, unknown>[]) => {
    const opts = { label: config.label, description: config.description, transport, originLat: lat, originLng: lng };
    for (const p of raw) {
      const id = String(p.id ?? "");
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      const mapped = mapGoogleToPlaceResponse(p, googleKey, opts);
      if (!results.some(r => r.name.trim() === mapped.name.trim())) {
        results.push(mapped);
      }
    }
  };

  // STEP 1: Yahoo gc + 厳密キーワード + 初期距離
  if (results.length < TARGET) {
    console.log(`[focus] STEP 1 Yahoo "${config.yahooStrictKeyword}" dist=${config.yahooInitialDistKm}km (現在${results.length}件)`);
    const yPlaces = await searchYahooMulti(
      config.yahooGcCodes, config.yahooStrictKeyword, lat, lng, config.yahooInitialDistKm
    );
    const enriched = await enrichWithGoogle(
      yPlaces, googleKey, config.label, config.description, lat, lng, transport
    );
    addYahooEnriched(enriched);
  }

  // STEP 2: Yahoo gc + 緩和キーワード + 初期距離
  if (results.length < TARGET) {
    console.log(`[focus] STEP 2 Yahoo "${config.yahooRelaxedKeyword}" dist=${config.yahooInitialDistKm}km (現在${results.length}件)`);
    const yPlaces = await searchYahooMulti(
      config.yahooGcCodes, config.yahooRelaxedKeyword, lat, lng, config.yahooInitialDistKm
    );
    const enriched = await enrichWithGoogle(
      yPlaces, googleKey, config.label, config.description, lat, lng, transport
    );
    addYahooEnriched(enriched);
  }

  // STEP 3: Yahoo gc + 緩和キーワード + 距離2倍
  if (results.length < TARGET) {
    const expandedDist = Math.min(config.yahooInitialDistKm * 2, 50);
    console.log(`[focus] STEP 3 Yahoo dist=${expandedDist}km (現在${results.length}件)`);
    const yPlaces = await searchYahooMulti(
      config.yahooGcCodes, config.yahooRelaxedKeyword, lat, lng, expandedDist
    );
    const enriched = await enrichWithGoogle(
      yPlaces, googleKey, config.label, config.description, lat, lng, transport
    );
    addYahooEnriched(enriched);
  }

  // Google フォールバック（Yahoo で件数不足の場合）
  if (results.length < TARGET) {
    const areaStr = area !== "現在地周辺" ? area : "";
    console.log(`[focus] Google fallback (現在${results.length}件)`);
    const settled = await Promise.allSettled(
      config.googleFallbackQueries.map(q =>
        searchGooglePlaces(q.replace("{area}", areaStr), lat, lng, 10_000, googleKey, undefined, 20)
      )
    );
    const batch: Record<string, unknown>[] = [];
    for (const r of settled) { if (r.status === "fulfilled") batch.push(...r.value); }
    addGoogleBatch(batch);
  }

  return dedup(results).slice(0, TARGET);
}

// ────────────────────────────────────────────────────────────────────────────
// POST ハンドラ
// ────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<FocusRequest> & {
      time?: string;
      companion?: string;
      budget?: number;
      freeWord?: string;
    };
    const { subCategory, areaLabel = "現在地周辺", transport, time, companion, budget, freeWord } = body;
    const lat = body.lat;
    const lng = body.lng;

    if (companion) console.log(`[focus] companion="${companion}"`);
    if (freeWord)  console.log(`[focus] freeWord="${freeWord}"`);

    if (!subCategory || !FOCUS_CONFIG[subCategory]) {
      return NextResponse.json(
        { error: "subCategory は work_cafe / coworking / family_restaurant / netcafe_library のいずれかを指定してください" },
        { status: 400 },
      );
    }

    const googleKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
    if (!googleKey) {
      return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY が設定されていません" }, { status: 500 });
    }

    // ── 座標確定 ──────────────────────────────────────────────────────────────
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
      console.log(`[focus] ジオコード "${areaLabel}" → (${searchLat.toFixed(4)}, ${searchLng.toFixed(4)})`);
    }

    const config = FOCUS_CONFIG[subCategory];

    // time + transport が揃っている場合は calcRadiusKm を使用
    const transportArr = Array.isArray(transport) ? transport : (transport ? [transport] : []);
    const radiusM = (time && transportArr.length > 0)
      ? calcRadiusKmFromTime(transportArr, time) * 1000
      : getRadiusM(transport);
    console.log(`[focus] ▶ ${config.label} area="${areaLabel}" r=${radiusM / 1000}km transport="${transportArr.join(",") || "なし"}" time="${time ?? "-"}"`);

    // ── 段階的フォールバック検索 ──────────────────────────────────────────────
    let places: PlaceResponse[];
    if (config.api === "google") {
      places = await runGoogleFallback(config, areaLabel, searchLat, searchLng, radiusM, googleKey, transport);
    } else {
      places = await runYahooFallback(config, areaLabel, searchLat, searchLng, googleKey, transport);
    }

    // ── 予算フィルタ ──────────────────────────────────────────────────────────
    if (budget && budget > 0) {
      const budgetFiltered = places.filter(p => isPriceWithinBudget(p.priceLevel, budget));
      if (budgetFiltered.length >= Math.min(3, places.length)) places = budgetFiltered;
      console.log(`[focus] 予算フィルタ後 ${places.length}件（上限 ${budget}円）`);
    }

    console.log(`[focus] 最終 ${places.length}件`);

    return NextResponse.json({
      data:             places,
      subCategoryLabel: config.label,
      areaLabel,
    } satisfies FocusApiResponse);

  } catch (e) {
    console.error("[focus] エラー:", e);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────────────────────

async function geocodeAddress(
  address:   string,
  googleKey: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}&language=ja&region=JP`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildDistanceInfo(distKm: number, transport?: string | string[]): string {
  const t       = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
  const distStr = distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm}km`;
  let speedKmh: number;
  let modeLabel: string;
  if (t.includes("徒歩") || t.includes("walk"))     { speedKmh = 4;   modeLabel = "徒歩"; }
  else if (t.includes("自転車") || t.includes("bicycle")) { speedKmh = 12;  modeLabel = "自転車"; }
  else if (t.includes("電車") || t.includes("バス")) { speedKmh = 30;  modeLabel = "電車"; }
  else if (t.includes("車") || t.includes("バイク")) { speedKmh = 30;  modeLabel = "車"; }
  else                                                { speedKmh = 30;  modeLabel = "電車"; }
  const mins    = Math.round((distKm / speedKmh) * 60);
  const timeStr = mins < 60 ? `約${mins}分` : `約${(mins / 60).toFixed(1)}時間`;
  return `${modeLabel}で${timeStr} / ${distStr}`;
}

function compactWeekdays(weekdays: string[]): string {
  if (weekdays.length === 0) return "";
  const DAY_SHORT = ["月", "火", "水", "木", "金", "土", "日"];
  const parsed = weekdays.map((w, i) => {
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
    const s = DAY_SHORT[g.start] ?? "";
    const e = DAY_SHORT[g.end]   ?? "";
    const dayStr =
      g.start === g.end     ? s :
      g.end - g.start === 1 ? `${s}・${e}` :
                              `${s}〜${e}`;
    return `${dayStr}: ${g.hours}`;
  }).join("\n");
}
