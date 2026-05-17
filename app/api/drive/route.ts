import { NextRequest, NextResponse } from "next/server";
import type { DriveSubCategory, DriveRequest, DriveApiResponse } from "@/types/drive";
import type { PlaceResponse } from "@/types/onsen";
import { calcRadiusKm as calcRadiusKmFromTime, isPriceWithinBudget } from "@/lib/calc-radius";

// ────────────────────────────────────────────────────────────────────────────
// ドライブしたい専用 API
//
// サブカテゴリ別APIルーティング:
//   ocean_drive  → Google Places Text Search (絶景海岸線)
//   night_view   → Google Places Text Search (展望台・夜景)
//   road_station → Yahoo!ローカルサーチ (道の駅・SA) + Google写真補完
//                  フォールバック: Google Places Text Search
//   outlet       → Google Places Text Search (アウトレット・大型モール)
//
// 段階的フォールバック（最大4ステップ）:
//   STEP 1: 厳密検索（初期クエリ + 高評価フィルタ + 半径20km）
//   STEP 2: 評価フィルタ解除（同半径）
//   STEP 3: 半径拡大（50km）
//   STEP 4: クエリ緩和（「駐車場あり」等を削除）
// ────────────────────────────────────────────────────────────────────────────

// ── サブカテゴリ設定 ─────────────────────────────────────────────────────────
interface GoogleConfig {
  api:            "google";
  label:          string;
  description:    string;
  strictQueries:  string[];   // 駐車場あり等を含む厳密クエリ
  relaxedQueries: string[];   // 縛りワードを除いた緩和クエリ
  initialMinRating: number;
  initialRadiusM:   number;
}

interface YahooConfig {
  api:                   "yahoo";
  label:                 string;
  description:           string;
  yahooGcCodes:          string[];   // 業種コード
  yahooKeyword:          string;
  yahooInitialDistKm:    number;
  googleFallbackQueries: string[];   // Yahoo で足りない時の Google フォールバック
}

type SubCategoryConfig = GoogleConfig | YahooConfig;

const DRIVE_CONFIG: Record<DriveSubCategory, SubCategoryConfig> = {
  ocean_drive: {
    api:            "google",
    label:          "🌊 海沿いを爽快に走りたい",
    description:    "潮風を感じながらドライブできる絶景スポット！",
    strictQueries:  [
      "{area} 海岸線 絶景 駐車場あり",
      "{area} オーシャンビュー 絶景 駐車場あり",
    ],
    relaxedQueries: [
      "{area} 海岸線 絶景",
      "{area} オーシャンビュー 絶景",
      "{area} 海 景勝地 観光",
    ],
    initialMinRating: 4.0,
    initialRadiusM:   20_000,
  },
  night_view: {
    api:            "google",
    label:          "🌉 綺麗な景色や夜景を見に行きたい",
    description:    "ドライブに最適な絶景・夜景スポット！",
    strictQueries:  [
      "{area} 展望台 ドライブ 駐車場あり",
      "{area} 夜景スポット ドライブ 駐車場あり",
    ],
    relaxedQueries: [
      "{area} 展望台 夜景 絶景",
      "{area} 夜景スポット 観光",
      "{area} 絶景 展望 スポット",
    ],
    initialMinRating: 4.0,
    initialRadiusM:   20_000,
  },
  road_station: {
    api:                   "yahoo",
    label:                 "🏪 道の駅・SAでご当地グルメ",
    description:           "ご当地グルメが楽しめる道の駅・サービスエリア！",
    yahooGcCodes:          ["0304008", "0429013"],  // 道の駅 / SA・PA
    yahooKeyword:          "道の駅 サービスエリア",
    yahooInitialDistKm:    30,
    googleFallbackQueries: [
      "{area} 道の駅 特産品 グルメ",
      "{area} サービスエリア グルメ 名物",
      "{area} パーキングエリア ご当地",
    ],
  },
  outlet: {
    api:            "google",
    label:          "🛍️ 郊外の大型施設に行きたい",
    description:    "たっぷり買い物できる大型アウトレット・モール！",
    strictQueries:  [
      "{area} アウトレットモール 駐車場あり",
      "{area} 大型ショッピングモール 駐車場あり",
    ],
    relaxedQueries: [
      "{area} アウトレット 大型",
      "{area} ショッピングモール 郊外",
      "{area} イオンモール",
    ],
    initialMinRating: 3.8,
    initialRadiusM:   20_000,
  },
};

// ── 定数 ────────────────────────────────────────────────────────────────────
const TARGET      = 10;   // 目標件数
const MAX_STEPS   = 4;    // 最大フォールバックステップ数
const FIELD_MASK  = [
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

// ── Google Places Text Search ────────────────────────────────────────────────
async function searchGooglePlaces(
  textQuery:    string,
  lat:          number,
  lng:          number,
  radiusM:      number,
  googleKey:    string,
  minRating?:   number,
  maxResults:   number = 20,
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
      console.warn(`[drive] Google "${textQuery}" HTTP ${res.status} ${err.slice(0, 120)}`);
      return [];
    }
    const data   = await res.json();
    const places = (data.places ?? []) as Record<string, unknown>[];
    console.log(`[drive] Google "${textQuery}" r=${radiusM / 1000}km ${minRating ? `minR=${minRating}` : ""} → ${places.length}件`);
    return places;
  } catch (e) {
    console.warn(`[drive] Google "${textQuery}" 例外:`, e);
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
  if (!apiKey) { console.warn("[drive] YAHOO_LOCAL_SEARCH_API_KEY 未設定"); return []; }

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
      console.warn(`[drive] Yahoo gc=${gc} HTTP ${res.status}`);
      return [];
    }
    const json     = await res.json();
    const features = (json.Feature ?? []) as Record<string, unknown>[];
    console.log(`[drive] Yahoo gc=${gc} dist=${distKm}km → ${features.length}件`);

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
    console.warn(`[drive] Yahoo gc=${gc} 例外:`, e);
    return [];
  }
}

// ── Yahoo 複数 gc を並列実行してマージ ─────────────────────────────────────
async function searchYahooMulti(
  gcCodes: string[],
  keyword: string,
  lat:     number,
  lng:     number,
  distKm:  number,
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
      id:           gp ? String(gp.id ?? `drive-${p.name}`) : `drive-${p.name}`,
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
    };
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
    id:           String(place.id ?? `drive-${name}`),
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

// ── 重複除去 ─────────────────────────────────────────────────────────────────
function dedup(places: PlaceResponse[]): PlaceResponse[] {
  const seenIds   = new Set<string>();
  const seenNames = new Set<string>();
  const result: PlaceResponse[] = [];
  for (const p of places) {
    const idKey = p.id.startsWith("drive-") ? null : p.id;
    if ((idKey && seenIds.has(idKey)) || seenNames.has(p.name.trim())) continue;
    if (idKey) seenIds.add(idKey);
    seenNames.add(p.name.trim());
    result.push(p);
  }
  return result;
}

// ── Google フォールバック付き検索（段階的） ──────────────────────────────────
// STEP 1: 厳密クエリ + 高評価フィルタ + 初期半径
// STEP 2: 評価フィルタ解除 + 初期半径
// STEP 3: 評価フィルタ解除 + 半径拡大（50km）
// STEP 4: 緩和クエリ + 半径拡大（50km）
async function runGoogleFallback(
  config:    GoogleConfig,
  area:      string,
  lat:       number,
  lng:       number,
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

  const FALLBACK_STEPS = [
    // STEP 1: strict queries + minRating + initial radius
    { queries: config.strictQueries,  radiusM: config.initialRadiusM, minRating: config.initialMinRating },
    // STEP 2: strict queries + NO minRating + initial radius
    { queries: config.strictQueries,  radiusM: config.initialRadiusM, minRating: undefined },
    // STEP 3: strict queries + NO minRating + expanded radius (50km)
    { queries: config.strictQueries,  radiusM: 50_000, minRating: undefined },
    // STEP 4: relaxed queries + NO minRating + expanded radius
    { queries: config.relaxedQueries, radiusM: 50_000, minRating: undefined },
  ] as const;

  for (let step = 0; step < Math.min(FALLBACK_STEPS.length, MAX_STEPS); step++) {
    if (results.length >= TARGET) break;

    const { queries, radiusM, minRating } = FALLBACK_STEPS[step];
    console.log(`[drive] STEP ${step + 1} / ${FALLBACK_STEPS.length} — ${config.label} r=${radiusM / 1000}km minR=${minRating ?? "なし"} (現在${results.length}件)`);

    const settled = await Promise.allSettled(
      queries.map(q =>
        searchGooglePlaces(
          q.replace("{area}", area !== "現在地周辺" ? area : ""),
          lat, lng, radiusM,
          googleKey,
          minRating,
          20,
        )
      )
    );
    const batch: Record<string, unknown>[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") batch.push(...r.value);
    }
    addBatch(batch);
  }

  return dedup(results).slice(0, TARGET);
}

// ── Yahoo フォールバック付き検索（段階的） ────────────────────────────────────
// STEP 1: Yahoo dist=初期距離 → Google写真補完
// STEP 2: Yahoo dist=拡大距離（2倍） → Google写真補完
// STEP 3: Google fallbackクエリで直接検索
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
  const opts = { label: config.label, description: config.description, transport, originLat: lat, originLng: lng };

  const addYahooEnriched = (places: PlaceResponse[]) => {
    for (const p of places) {
      const idKey = p.id.startsWith("drive-") ? null : p.id;
      if ((idKey && seenIds.has(idKey)) || results.some(r => r.name.trim() === p.name.trim())) continue;
      if (idKey) seenIds.add(idKey);
      results.push(p);
    }
  };

  const addGoogleBatch = (raw: Record<string, unknown>[]) => {
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

  // STEP 1: Yahoo 初期距離
  if (results.length < TARGET) {
    console.log(`[drive] STEP 1 Yahoo dist=${config.yahooInitialDistKm}km (現在${results.length}件)`);
    const yPlaces = await searchYahooMulti(
      config.yahooGcCodes, config.yahooKeyword, lat, lng, config.yahooInitialDistKm
    );
    const enriched = await enrichWithGoogle(
      yPlaces, googleKey, config.label, config.description, lat, lng, transport
    );
    addYahooEnriched(enriched);
  }

  // STEP 2: Yahoo 距離拡大（2倍。ただし最大100km）
  if (results.length < TARGET) {
    const expandedDist = Math.min(config.yahooInitialDistKm * 2, 100);
    console.log(`[drive] STEP 2 Yahoo dist=${expandedDist}km (現在${results.length}件)`);
    const yPlaces = await searchYahooMulti(
      config.yahooGcCodes, config.yahooKeyword, lat, lng, expandedDist
    );
    const enriched = await enrichWithGoogle(
      yPlaces, googleKey, config.label, config.description, lat, lng, transport
    );
    addYahooEnriched(enriched);
  }

  // STEP 3-4: Google フォールバック（2クエリセット分）
  const fbRadii = [50_000, 80_000];
  for (let i = 0; i < fbRadii.length && results.length < TARGET; i++) {
    const radiusM = fbRadii[i];
    console.log(`[drive] STEP ${3 + i} Google fallback r=${radiusM / 1000}km (現在${results.length}件)`);
    const settled = await Promise.allSettled(
      config.googleFallbackQueries.map(q =>
        searchGooglePlaces(
          q.replace("{area}", area !== "現在地周辺" ? area : ""),
          lat, lng, radiusM,
          googleKey,
          undefined,
          20,
        )
      )
    );
    const batch: Record<string, unknown>[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") batch.push(...r.value);
    }
    addGoogleBatch(batch);
  }

  return dedup(results).slice(0, TARGET);
}

// ────────────────────────────────────────────────────────────────────────────
// POST ハンドラ
// ────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<DriveRequest> & {
      time?: string;
      companion?: string;
      budget?: number;
      freeWord?: string;
    };
    const { subCategory, areaLabel = "現在地周辺", transport, time, companion, budget, freeWord } = body;
    const lat = body.lat;
    const lng = body.lng;

    if (companion) console.log(`[drive] companion="${companion}"`);
    if (freeWord)  console.log(`[drive] freeWord="${freeWord}"`);

    if (!subCategory || !DRIVE_CONFIG[subCategory]) {
      return NextResponse.json(
        { error: "subCategory は ocean_drive / night_view / road_station / outlet のいずれかを指定してください" },
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
      console.log(`[drive] ジオコード "${areaLabel}" → (${searchLat.toFixed(4)}, ${searchLng.toFixed(4)})`);
    }

    // time + transport が揃っている場合は calcRadiusKm で上書き
    const transportArr = Array.isArray(transport) ? transport : (transport ? [transport] : []);
    const calcedRadiusM = (time && transportArr.length > 0)
      ? calcRadiusKmFromTime(transportArr, time) * 1000
      : null;

    const config = { ...DRIVE_CONFIG[subCategory] } as SubCategoryConfig;
    if (calcedRadiusM !== null && config.api === "google") {
      (config as GoogleConfig).initialRadiusM = Math.max(calcedRadiusM, 5000);
    }
    console.log(`[drive] ▶ ${config.label} area="${areaLabel}" transport="${transportArr.join(",") || "なし"}" time="${time ?? "-"}"`);

    // ── 段階的フォールバック検索 ──────────────────────────────────────────────
    let places: PlaceResponse[];
    if (config.api === "google") {
      places = await runGoogleFallback(config, areaLabel, searchLat, searchLng, googleKey, transport);
    } else {
      places = await runYahooFallback(config, areaLabel, searchLat, searchLng, googleKey, transport);
    }

    // ── 予算フィルタ ──────────────────────────────────────────────────────────
    if (budget && budget > 0) {
      const budgetFiltered = places.filter(p => isPriceWithinBudget(p.priceLevel, budget));
      if (budgetFiltered.length >= Math.min(3, places.length)) places = budgetFiltered;
      console.log(`[drive] 予算フィルタ後 ${places.length}件（上限 ${budget}円）`);
    }

    console.log(`[drive] 最終 ${places.length}件`);

    return NextResponse.json({
      data:             places,
      subCategoryLabel: config.label,
      areaLabel,
    } satisfies DriveApiResponse);

  } catch (e) {
    console.error("[drive] エラー:", e);
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
  const t      = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
  const distStr = distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm}km`;
  // ドライブ = 車
  const speedKmh = 40;
  const modeLabel = "車";
  const mins      = Math.round((distKm / speedKmh) * 60);
  const timeStr   = mins < 60 ? `約${mins}分` : `約${(mins / 60).toFixed(1)}時間`;
  return t ? `${modeLabel}で${timeStr} / ${distStr}` : distStr;
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
