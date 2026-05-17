import { NextRequest, NextResponse } from "next/server";
import type { SportsSubCategory, SportsRequest, SportsApiResponse } from "@/types/sports";
import type { PlaceResponse } from "@/types/onsen";
import { calcRadiusKm as calcRadiusKmFromTime, isPriceWithinBudget } from "@/lib/calc-radius";

// ────────────────────────────────────────────────────────────────────────────
// 体を動かしたい専用 API
//
// サブカテゴリ別APIルーティング:
//   training        → Google Places Text Search (ジム・プール・体育館)
//   stress_relief   → Yahoo!ローカルサーチ (バッティング・ゴルフ練習場) + Google写真補完
//   amusement_sport → Google Places Text Search (スポッチャ・トランポリン等)
//   outdoor_sports  → Google Places Text Search (公園・屋外スポーツ施設)
//
// 段階的フォールバック（最大4ステップ）:
//   STEP 1: 厳密クエリ + 評価フィルタ + 移動手段別初期半径
//   STEP 2: 評価フィルタ解除 (同半径)
//   STEP 3: 検索半径を2倍に拡大
//   STEP 4: 緩和キーワードで再検索
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
  if (t.includes("徒歩") || t.includes("walk"))      return  2_000;
  if (t.includes("自転車") || t.includes("bicycle")) return  5_000;
  if (t.includes("電車") || t.includes("バス") || t.includes("train") || t.includes("bus")) return 10_000;
  if (t.includes("車") || t.includes("バイク") || t.includes("car") || t.includes("bike")) return 20_000;
  return 10_000; // デフォルト
}

// ── サブカテゴリ設定 ─────────────────────────────────────────────────────────
interface GoogleConfig {
  api:            "google";
  label:          string;
  description:    string;
  strictQueries:  string[];   // 初期厳密クエリ
  relaxedQueries: string[];   // フォールバック用緩和クエリ
  initialMinRating?: number;
}

interface YahooConfig {
  api:                   "yahoo";
  label:                 string;
  description:           string;
  yahooGcCodes:          string[];
  yahooKeyword:          string;
  yahooInitialDistKm:    number;
  googleFallbackQueries: string[];
}

type SubCategoryConfig = GoogleConfig | YahooConfig;

const SPORTS_CONFIG: Record<SportsSubCategory, SubCategoryConfig> = {
  training: {
    api:            "google",
    label:          "💪 トレーニング",
    description:    "本格的に汗を流せるジム・プール・体育館！",
    strictQueries:  [
      "{area} スポーツジム フィットネス",
      "{area} 市民プール 体育館",
    ],
    relaxedQueries: [
      "{area} フィットネスクラブ",
      "{area} スポーツ施設",
      "{area} ジム 運動",
    ],
    initialMinRating: 3.5,
  },
  stress_relief: {
    api:                   "yahoo",
    label:                 "🏏 ストレス発散",
    description:           "打って投げてスカッと発散できるスポット！",
    yahooGcCodes:          ["0306013", "0306005"],  // バッティングセンター / ゴルフ練習場
    yahooKeyword:          "バッティングセンター ゴルフ練習場",
    yahooInitialDistKm:    10,
    googleFallbackQueries: [
      "{area} バッティングセンター",
      "{area} ゴルフ練習場 打ちっぱなし",
      "{area} ボウリング場",
    ],
  },
  amusement_sport: {
    api:            "google",
    label:          "🎯 アミューズメントスポーツ",
    description:    "遊び感覚でワイワイ体を動かせるスポット！",
    strictQueries:  [
      "{area} スポッチャ VS PARK トンデミ 屋内アスレチック",
      "{area} トランポリンパーク 屋内アスレチック",
    ],
    relaxedQueries: [
      "{area} 屋内アスレチック 体験",
      "{area} アミューズメント施設 スポーツ",
      "{area} ボルダリング スポーツ施設",
    ],
    initialMinRating: 3.5,
  },
  outdoor_sports: {
    api:            "google",
    label:          "🌳 アウトドアスポーツ",
    description:    "外の風を感じながら気持ちよくスポーツしよう！",
    strictQueries:  [
      "{area} バスケットコート 公園",
      "{area} 海浜公園 スポーツ 運動公園 広場",
    ],
    relaxedQueries: [
      "{area} 運動公園 スポーツ広場",
      "{area} 総合公園 スポーツ",
      "{area} 大きな公園 アウトドア",
    ],
    initialMinRating: 3.8,
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
      console.warn(`[sports] Google "${textQuery}" HTTP ${res.status} ${err.slice(0, 120)}`);
      return [];
    }
    const data   = await res.json();
    const places = (data.places ?? []) as Record<string, unknown>[];
    console.log(`[sports] Google "${textQuery}" r=${radiusM / 1000}km${minRating != null ? ` minR=${minRating}` : ""} → ${places.length}件`);
    return places;
  } catch (e) {
    console.warn(`[sports] Google "${textQuery}" 例外:`, e);
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
  if (!apiKey) { console.warn("[sports] YAHOO_LOCAL_SEARCH_API_KEY 未設定"); return []; }

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
      console.warn(`[sports] Yahoo gc=${gc} HTTP ${res.status}`);
      return [];
    }
    const json     = await res.json();
    const features = (json.Feature ?? []) as Record<string, unknown>[];
    console.log(`[sports] Yahoo gc=${gc} dist=${distKm}km → ${features.length}件`);

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
    console.warn(`[sports] Yahoo gc=${gc} 例外:`, e);
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
      if (!seenNames.has(p.name)) { seenNames.add(p.name); results.push(p); }
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
      id:           gp ? String(gp.id ?? `sports-${p.name}`) : `sports-${p.name}`,
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
  place:     Record<string, unknown>,
  googleKey: string,
  opts: { label: string; description: string; transport?: string | string[]; originLat: number; originLng: number },
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
    id:           String(place.id ?? `sports-${name}`),
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
    const idKey = p.id.startsWith("sports-") ? null : p.id;
    if ((idKey && seenIds.has(idKey)) || seenNames.has(p.name.trim())) continue;
    if (idKey) seenIds.add(idKey);
    seenNames.add(p.name.trim());
    result.push(p);
  }
  return result;
}

// ── Google フォールバック付き検索（4ステップ） ──────────────────────────────
// STEP 1: 厳密クエリ + minRating + 初期半径
// STEP 2: 厳密クエリ + minRating解除 + 初期半径
// STEP 3: 厳密クエリ + minRating解除 + 半径2倍
// STEP 4: 緩和クエリ + minRating解除 + 半径2倍
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
  const areaStr = area !== "現在地周辺" ? area : "";

  const addBatch = (raw: Record<string, unknown>[]) => {
    for (const p of raw) {
      const id = String(p.id ?? "");
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      const mapped = mapGoogleToPlaceResponse(p, googleKey, opts);
      if (!results.some(r => r.name.trim() === mapped.name.trim())) results.push(mapped);
    }
  };

  const steps = [
    // STEP 1: 厳密 + minRating + 初期半径
    { queries: config.strictQueries,  radiusM,         minRating: config.initialMinRating },
    // STEP 2: 厳密 + minRating解除 + 初期半径
    { queries: config.strictQueries,  radiusM,         minRating: undefined },
    // STEP 3: 厳密 + minRating解除 + 半径2倍
    { queries: config.strictQueries,  radiusM: radiusM * 2, minRating: undefined },
    // STEP 4: 緩和 + minRating解除 + 半径2倍
    { queries: config.relaxedQueries, radiusM: radiusM * 2, minRating: undefined },
  ] as const;

  for (let i = 0; i < steps.length; i++) {
    if (results.length >= TARGET) break;
    const { queries, radiusM: r, minRating } = steps[i];
    console.log(`[sports] STEP ${i + 1} Google r=${r / 1000}km minR=${minRating ?? "なし"} (現在${results.length}件)`);
    const settled = await Promise.allSettled(
      queries.map(q =>
        searchGooglePlaces(q.replace("{area}", areaStr), lat, lng, r, googleKey, minRating, 20)
      )
    );
    const batch: Record<string, unknown>[] = [];
    for (const r2 of settled) { if (r2.status === "fulfilled") batch.push(...r2.value); }
    addBatch(batch);
  }

  return dedup(results).slice(0, TARGET);
}

// ── Yahoo フォールバック付き検索（4ステップ） ─────────────────────────────────
// STEP 1: Yahoo gc + keyword + 初期距離
// STEP 2: Yahoo gc + keyword + 距離2倍
// STEP 3-4: Google フォールバック
async function runYahooFallback(
  config:    YahooConfig,
  area:      string,
  lat:       number,
  lng:       number,
  radiusM:   number,
  googleKey: string,
  transport: string | string[] | undefined,
): Promise<PlaceResponse[]> {
  const seenIds = new Set<string>();
  const results: PlaceResponse[] = [];
  const areaStr = area !== "現在地周辺" ? area : "";
  const opts    = { label: config.label, description: config.description, transport, originLat: lat, originLng: lng };

  const addYahooEnriched = (places: PlaceResponse[]) => {
    for (const p of places) {
      const idKey = p.id.startsWith("sports-") ? null : p.id;
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
      if (!results.some(r => r.name.trim() === mapped.name.trim())) results.push(mapped);
    }
  };

  // STEP 1: Yahoo 初期距離
  if (results.length < TARGET) {
    const distKm = Math.max(config.yahooInitialDistKm, Math.round(radiusM / 1000));
    console.log(`[sports] STEP 1 Yahoo dist=${distKm}km (現在${results.length}件)`);
    const yPlaces = await searchYahooMulti(config.yahooGcCodes, config.yahooKeyword, lat, lng, distKm);
    const enriched = await enrichWithGoogle(yPlaces, googleKey, config.label, config.description, lat, lng, transport);
    addYahooEnriched(enriched);
  }

  // STEP 2: Yahoo 距離2倍
  if (results.length < TARGET) {
    const distKm = Math.min(config.yahooInitialDistKm * 2, 100);
    console.log(`[sports] STEP 2 Yahoo dist=${distKm}km (現在${results.length}件)`);
    const yPlaces = await searchYahooMulti(config.yahooGcCodes, config.yahooKeyword, lat, lng, distKm);
    const enriched = await enrichWithGoogle(yPlaces, googleKey, config.label, config.description, lat, lng, transport);
    addYahooEnriched(enriched);
  }

  // STEP 3-4: Google フォールバック（2半径）
  const fbRadii = [radiusM * 2, radiusM * 4];
  for (let i = 0; i < fbRadii.length && results.length < TARGET; i++) {
    const r = fbRadii[i];
    console.log(`[sports] STEP ${3 + i} Google fallback r=${r / 1000}km (現在${results.length}件)`);
    const settled = await Promise.allSettled(
      config.googleFallbackQueries.map(q =>
        searchGooglePlaces(q.replace("{area}", areaStr), lat, lng, r, googleKey, undefined, 20)
      )
    );
    const batch: Record<string, unknown>[] = [];
    for (const r2 of settled) { if (r2.status === "fulfilled") batch.push(...r2.value); }
    addGoogleBatch(batch);
  }

  return dedup(results).slice(0, TARGET);
}

// ────────────────────────────────────────────────────────────────────────────
// POST ハンドラ
// ────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<SportsRequest> & {
      time?: string;
      companion?: string;
      budget?: number;
      freeWord?: string;
    };
    const { subCategory, areaLabel = "現在地周辺", transport, time, companion, budget, freeWord } = body;
    const lat = body.lat;
    const lng = body.lng;

    if (companion) console.log(`[sports] companion="${companion}"`);
    if (freeWord)  console.log(`[sports] freeWord="${freeWord}"`);

    if (!subCategory || !SPORTS_CONFIG[subCategory]) {
      return NextResponse.json(
        { error: "subCategory は training / stress_relief / amusement_sport / outdoor_sports のいずれかを指定してください" },
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
      console.log(`[sports] ジオコード "${areaLabel}" → (${searchLat.toFixed(4)}, ${searchLng.toFixed(4)})`);
    }

    const config = SPORTS_CONFIG[subCategory];

    // time + transport が揃っている場合は calcRadiusKm を使用
    const transportArr = Array.isArray(transport) ? transport : (transport ? [transport] : []);
    const radiusM = (time && transportArr.length > 0)
      ? calcRadiusKmFromTime(transportArr, time) * 1000
      : getRadiusM(transport);
    console.log(`[sports] ▶ ${config.label} area="${areaLabel}" r=${radiusM / 1000}km transport="${transportArr.join(",") || "なし"}" time="${time ?? "-"}"`);

    let places: PlaceResponse[];
    if (config.api === "google") {
      places = await runGoogleFallback(config, areaLabel, searchLat, searchLng, radiusM, googleKey, transport);
    } else {
      places = await runYahooFallback(config, areaLabel, searchLat, searchLng, radiusM, googleKey, transport);
    }

    // ── 予算フィルタ ──────────────────────────────────────────────────────────
    if (budget && budget > 0) {
      const budgetFiltered = places.filter(p => isPriceWithinBudget(p.priceLevel, budget));
      if (budgetFiltered.length >= Math.min(3, places.length)) places = budgetFiltered;
      console.log(`[sports] 予算フィルタ後 ${places.length}件（上限 ${budget}円）`);
    }

    console.log(`[sports] 最終 ${places.length}件`);

    return NextResponse.json({
      data:             places,
      subCategoryLabel: config.label,
      areaLabel,
    } satisfies SportsApiResponse);

  } catch (e) {
    console.error("[sports] エラー:", e);
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
  let speedKmh: number;
  let modeLabel: string;
  if      (t.includes("徒歩")   || t.includes("walk"))                                              { speedKmh =  4; modeLabel = "徒歩"; }
  else if (t.includes("自転車")  || t.includes("bicycle"))                                           { speedKmh = 12; modeLabel = "自転車"; }
  else if (t.includes("電車")   || t.includes("バス") || t.includes("train") || t.includes("bus"))  { speedKmh = 30; modeLabel = "電車"; }
  else if (t.includes("車")     || t.includes("バイク") || t.includes("car") || t.includes("bike")) { speedKmh = 30; modeLabel = "車"; }
  else                                                                                                { speedKmh = 30; modeLabel = "電車"; }
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
    if (last && last.hours === p.hours && p.dayIdx === last.end + 1) last.end = p.dayIdx;
    else groups.push({ start: p.dayIdx, end: p.dayIdx, hours: p.hours });
  }
  return groups.map(g => {
    const s = DAY_SHORT[g.start] ?? "";
    const e = DAY_SHORT[g.end]   ?? "";
    const dayStr = g.start === g.end ? s : g.end - g.start === 1 ? `${s}・${e}` : `${s}〜${e}`;
    return `${dayStr}: ${g.hours}`;
  }).join("\n");
}
