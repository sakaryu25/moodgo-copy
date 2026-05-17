import { NextRequest, NextResponse } from "next/server";
import type { TravelSubCategory, TravelRequest, TravelApiResponse } from "@/types/travel";
import type { PlaceResponse } from "@/types/onsen";

// ────────────────────────────────────────────────────────────────────────────
// 遠くに行きたい専用 API — 8方向マルチリング検索 + ドーナツフィルタ
//
// ■ Google Places API の上限
//   locationBias.circle.radius ≤ 50,000m（50km）
//   → ユーザー位置から直接検索すると近場しか返らない
//
// ■ 解決策: 8方向マルチリング
//   N/NE/E/SE/S/SW/W/NW の8方向 × 近リング(60km) と 主リング(150/200km)
//   各点で50km半径検索 → Haversine でドーナツフィルタ
//   ※ 富士急ハイランド(東京SW約100km)→ SW60km + SW150km 両方の検索圏内
//
// ■ 距離設定（2〜3県跨ぎ想定）
//   車  : inner=30km / outer=150km / 主リング100km / Yahoo=150km
//   電車: inner=30km / outer=150km / 主リング100km / Yahoo=150km
//
// ■ 4段階フォールバック
//   STEP 1: 近リング8方向 × 厳密クエリ + 高評価 + ドーナツfull
//   STEP 2: 主リング8方向 × 厳密/緩和クエリ + 緩和評価 + ドーナツfull
//   STEP 3: 近+主リング16方向 × 緩和クエリ + 内周半減
//   STEP 4: ドーナツ解除（全件返却）
// ────────────────────────────────────────────────────────────────────────────

const TARGET        = 10;
const BIAS_RADIUS_M = 50_000;  // Google Places locationBias 上限

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

// ── ドーナツ設定 ─────────────────────────────────────────────────────────────
interface DonutConfig {
  innerM:       number;  // これ未満を除外（近すぎ）
  outerM:       number;  // これ超を除外（遠すぎ）
  nearRingKm:   number;  // 近リングの距離
  mainRingKm:   number;  // 主リングの距離
  yahooDistKm:  number;  // Yahoo dist パラメータ
}

function getDonut(transport: string | string[] | undefined): DonutConfig {
  const t = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
  // ※「電車・バス」を先にチェック（"車"が"電車"にも含まれるため順序が重要）
  if (t.includes("電車") || t.includes("バス") || t.includes("train") || t.includes("bus")) {
    return { innerM: 30_000, outerM: 150_000, nearRingKm: 60, mainRingKm: 100, yahooDistKm: 150 };
  }
  if (t.includes("車") || t.includes("バイク") || t.includes("car") || t.includes("bike")) {
    return { innerM: 30_000, outerM: 150_000, nearRingKm: 60, mainRingKm: 100, yahooDistKm: 150 };
  }
  // 徒歩・自転車・なんでも → 電車相当
  return { innerM: 30_000, outerM: 150_000, nearRingKm: 60, mainRingKm: 100, yahooDistKm: 150 };
}

// ── 8方向 × 指定距離の検索センター配列 ─────────────────────────────────────
interface SearchPoint { lat: number; lng: number; dir: string }

function get8Points(lat: number, lng: number, distKm: number): SearchPoint[] {
  const dLat  = distKm / 111.0;
  const dLng  = distKm / (111.0 * Math.cos(lat * Math.PI / 180));
  const dDiag = distKm * 0.707 / 111.0;              // 斜め方向の緯度成分
  const dDiagLng = distKm * 0.707 / (111.0 * Math.cos(lat * Math.PI / 180));  // 斜め経度成分
  return [
    { lat: lat + dLat,        lng,                   dir: "N"  },
    { lat: lat + dDiag,       lng: lng + dDiagLng,   dir: "NE" },
    { lat,                    lng: lng + dLng,        dir: "E"  },
    { lat: lat - dDiag,       lng: lng + dDiagLng,   dir: "SE" },
    { lat: lat - dLat,        lng,                   dir: "S"  },
    { lat: lat - dDiag,       lng: lng - dDiagLng,   dir: "SW" },
    { lat,                    lng: lng - dLng,        dir: "W"  },
    { lat: lat + dDiag,       lng: lng - dDiagLng,   dir: "NW" },
  ];
}

// ── サブカテゴリ設定 ─────────────────────────────────────────────────────────
interface GoogleConfig {
  api:              "google";
  label:            string;
  description:      string;
  strictQueries:    string[];
  relaxedQueries:   string[];
  initialMinRating: number;
  relaxedMinRating: number;
}

interface YahooConfig {
  api:                   "yahoo";
  label:                 string;
  description:           string;
  yahooGcCodes:          string[];
  yahooKeyword:          string;
  googleFallbackQueries: string[];
}

type SubCategoryConfig = GoogleConfig | YahooConfig;

const TRAVEL_CONFIG: Record<TravelSubCategory, SubCategoryConfig> = {
  power_spot: {
    api:              "google",
    label:            "⛩️ パワースポット",
    description:      "歴史と霊気に満ちた、心が洗われるパワースポット！",
    strictQueries:    [
      "有名な神社 パワースポット 観光",
      "名刹 寺院 パワースポット 観光",
    ],
    relaxedQueries:   [
      "神社 観光 名所",
      "寺院 観光地",
      "歴史的建造物 観光スポット",
    ],
    initialMinRating: 4.2,
    relaxedMinRating: 3.8,
  },
  theme_park: {
    api:                   "yahoo",
    label:                 "🎡 テーマパーク",
    description:           "日常を忘れて別世界に入り込めるテーマパーク・水族館！",
    yahooGcCodes:          ["0302001", "0302002"],
    yahooKeyword:          "テーマパーク 遊園地 水族館 動物園",
    googleFallbackQueries: [
      "テーマパーク 遊園地",
      "水族館 動物園",
      "アミューズメントパーク",
    ],
  },
  town_walk: {
    api:              "google",
    label:            "🚶 町歩き",
    description:      "まだ知らない街の路地を、のんびりと散策しよう！",
    strictQueries:    [
      "古い町並み 食べ歩き 観光名所",
      "レトロ 商店街 観光地",
    ],
    relaxedQueries:   [
      "観光名所 散策スポット",
      "食べ歩き 商店街",
      "歴史的な街並み 観光",
    ],
    initialMinRating: 4.0,
    relaxedMinRating: 3.5,
  },
  super_view: {
    api:              "google",
    label:            "🌄 絶景スポット",
    description:      "息を呑むような大自然と絶景が待っています！",
    strictQueries:    [
      "絶景スポット 景勝地",
      "国定公園 大自然 絶景",
    ],
    relaxedQueries:   [
      "絶景 自然 観光スポット",
      "展望台 大自然",
      "景勝地 観光名所",
    ],
    initialMinRating: 4.2,
    relaxedMinRating: 3.8,
  },
};

// ── Haversine 距離計算 (km) ──────────────────────────────────────────────────
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

// ── 名前の正規化（重複判定用） ───────────────────────────────────────────────
// 括弧・スペース・記号を除去し、全角英数を半角に統一
function normalizeName(name: string): string {
  return name
    .trim()
    .replace(/[（(][^）)]*[）)]/g, "")   // 括弧内除去
    .replace(/\s+/g, "")                  // スペース除去
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0))  // 全角英数→半角
    .toLowerCase();
}

// ── Google Places Text Search ────────────────────────────────────────────────
async function searchGooglePlaces(
  textQuery:   string,
  centerLat:   number,
  centerLng:   number,
  googleKey:   string,
  minRating?:  number,
  maxResults:  number = 20,
): Promise<Record<string, unknown>[]> {
  try {
    const body: Record<string, unknown> = {
      textQuery,
      languageCode:   "ja",
      regionCode:     "JP",
      maxResultCount: maxResults,
      locationBias: {
        circle: {
          center: { latitude: centerLat, longitude: centerLng },
          radius: BIAS_RADIUS_M,
        },
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
      console.warn(`[travel] Google "${textQuery}" HTTP ${res.status}`);
      return [];
    }
    const data   = await res.json();
    const places = (data.places ?? []) as Record<string, unknown>[];
    console.log(`[travel] Google "${textQuery.slice(0, 20)}" (${centerLat.toFixed(2)},${centerLng.toFixed(2)})${minRating != null ? ` minR=${minRating}` : ""} → ${places.length}件`);
    return places;
  } catch (e) {
    console.warn(`[travel] Google "${textQuery}" 例外:`, e);
    return [];
  }
}

// ── Yahoo ローカルサーチ ──────────────────────────────────────────────────────
interface YahooPlace { name: string; address: string; lat: number; lng: number }

async function searchYahoo(
  gc:      string,
  keyword: string,
  lat:     number,
  lng:     number,
  distKm:  number,
): Promise<YahooPlace[]> {
  const apiKey = process.env.YAHOO_LOCAL_SEARCH_API_KEY;
  if (!apiKey) { console.warn("[travel] YAHOO_LOCAL_SEARCH_API_KEY 未設定"); return []; }

  const params = new URLSearchParams({
    appid:   apiKey,
    lat:     String(lat),
    lon:     String(lng),
    dist:    String(distKm),
    results: "100",
    sort:    "score",
    output:  "json",
    query:   keyword,
  });
  params.append("gc", gc);

  try {
    const res = await fetch(
      `https://map.yahooapis.jp/search/local/V1/localSearch?${params}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) { console.warn(`[travel] Yahoo gc=${gc} HTTP ${res.status}`); return []; }
    const json     = await res.json();
    const features = (json.Feature ?? []) as Record<string, unknown>[];
    console.log(`[travel] Yahoo gc=${gc} dist=${distKm}km → ${features.length}件`);
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
    console.warn(`[travel] Yahoo gc=${gc} 例外:`, e);
    return [];
  }
}

async function searchYahooMulti(
  gcCodes: string[], keyword: string, lat: number, lng: number, distKm: number,
): Promise<YahooPlace[]> {
  const settled = await Promise.allSettled(
    gcCodes.map(gc => searchYahoo(gc, keyword, lat, lng, distKm))
  );
  const seen = new Set<string>();
  const out: YahooPlace[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const p of r.value) {
      const key = normalizeName(p.name);
      if (!seen.has(key)) { seen.add(key); out.push(p); }
    }
  }
  return out;
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
): Promise<(PlaceResponse & { _placeLat: number; _placeLng: number })[]> {
  const tasks = yahooPlaces.map(async (p) => {
    const query   = `${p.name} ${p.address.slice(0, 20)}`;
    const results = await searchGooglePlaces(query, p.lat, p.lng, googleKey, undefined, 1);
    const gp      = results[0];
    const photos  = gp ? ((gp.photos as Array<Record<string, unknown>>) ?? []) : [];
    const rawPhotoUrls = photos.filter(ph => ph?.name)
      .map(ph => `https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=800&key=${googleKey}`);
    const photoUrls = rawPhotoUrls;
    const hours   = gp ? (gp.currentOpeningHours as Record<string, unknown> | undefined) : undefined;
    const weekdays = (hours?.weekdayDescriptions as string[] | undefined) ?? [];
    const distKm  = Math.round(haversineKm(originLat, originLng, p.lat, p.lng) * 10) / 10;
    return {
      id:            gp ? String(gp.id ?? `travel-${p.name}`) : `travel-${p.name}`,
      name:          p.name,
      category:      label,
      description,
      imageUrl:      photoUrls[0],
      rating:        gp && typeof gp.rating          === "number" ? gp.rating          : null,
      reviewCount:   gp && typeof gp.userRatingCount === "number" ? gp.userRatingCount : null,
      address:       p.address,
      distanceInfo:  `現在地から約${distKm}km / ${buildTimeStr(distKm, transport)}`,
      photoUrls,
      openNow:       typeof hours?.openNow === "boolean" ? hours.openNow : null,
      openingHours:  weekdays.length > 0 ? compactWeekdays(weekdays) : null,
      priceLevel:    gp && typeof gp.priceLevel === "string" ? gp.priceLevel : null,
      googleMapsUrl: gp
        ? String(gp.googleMapsUri ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`)
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}`,
      stationInfo:   null,
      source:        "google" as const,
      _placeLat:     p.lat,
      _placeLng:     p.lng,
    };
  });
  const settled = await Promise.allSettled(tasks);
  return settled
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<PlaceResponse & { _placeLat: number; _placeLng: number }>).value);
}

// ── Google raw → PlaceResponse 変換 ─────────────────────────────────────────
function mapGoogleToPlaceResponse(
  place:     Record<string, unknown>,
  googleKey: string,
  opts: { label: string; description: string; transport?: string | string[]; originLat: number; originLng: number },
): PlaceResponse & { _placeLat: number; _placeLng: number } {
  const name  = ((place.displayName as Record<string, unknown>)?.text as string) ?? "";
  const loc   = place.location as Record<string, unknown> | undefined;
  const pLat  = typeof loc?.latitude  === "number" ? loc.latitude  as number : opts.originLat;
  const pLng  = typeof loc?.longitude === "number" ? loc.longitude as number : opts.originLng;
  const photos = (place.photos as Array<Record<string, unknown>>) ?? [];
  const photoUrls = photos.filter(p => p?.name)
    .map(p => `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=800&key=${googleKey}`);
  const finalPhotoUrls = photoUrls;
  const hours    = place.currentOpeningHours as Record<string, unknown> | undefined;
  const weekdays = (hours?.weekdayDescriptions as string[] | undefined) ?? [];
  const distKm   = Math.round(haversineKm(opts.originLat, opts.originLng, pLat, pLng) * 10) / 10;
  return {
    id:           String(place.id ?? `travel-${name}`),
    name,
    category:     opts.label,
    description:  opts.description,
    imageUrl:     finalPhotoUrls[0],
    rating:       typeof place.rating          === "number" ? place.rating          : null,
    reviewCount:  typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    address:      String(place.formattedAddress ?? ""),
    distanceInfo: `現在地から約${distKm}km / ${buildTimeStr(distKm, opts.transport)}`,
    photoUrls:    finalPhotoUrls,
    openNow:      typeof hours?.openNow === "boolean" ? hours.openNow : null,
    openingHours: weekdays.length > 0 ? compactWeekdays(weekdays) : null,
    priceLevel:   typeof place.priceLevel === "string" ? place.priceLevel : null,
    googleMapsUrl: String(place.googleMapsUri ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`),
    stationInfo:  null,
    source:       "google",
    _placeLat:    pLat,
    _placeLng:    pLng,
  };
}

// ── ドーナツフィルタ判定 ─────────────────────────────────────────────────────
function inDonut(
  place:     PlaceResponse & { _placeLat?: number; _placeLng?: number },
  originLat: number,
  originLng: number,
  innerM:    number,
  outerM:    number,
): boolean {
  if (place._placeLat == null || place._placeLng == null) return true;
  const distM = haversineKm(originLat, originLng, place._placeLat, place._placeLng) * 1000;
  if (innerM > 0 && distM < innerM) return false;
  if (outerM > 0 && distM > outerM) return false;
  return true;
}

// ── 重複管理クラス（正規化名 + ID 両方で管理） ────────────────────────────────
class SeenTracker {
  private ids   = new Set<string>();
  private names = new Set<string>();

  has(id: string, name: string): boolean {
    const nid = id && !id.startsWith("travel-") ? id : "";
    return (!!nid && this.ids.has(nid)) || this.names.has(normalizeName(name));
  }
  add(id: string, name: string): void {
    if (id && !id.startsWith("travel-")) this.ids.add(id);
    this.names.add(normalizeName(name));
  }
}

// ── Google 8方向マルチリング検索（4ステップ） ────────────────────────────────
async function runGoogleFallback(
  config:    GoogleConfig,
  originLat: number,
  originLng: number,
  donut:     DonutConfig,
  googleKey: string,
  transport: string | string[] | undefined,
): Promise<PlaceResponse[]> {
  const seen    = new SeenTracker();
  const results: (PlaceResponse & { _placeLat?: number; _placeLng?: number })[] = [];
  const opts    = { label: config.label, description: config.description, transport, originLat, originLng };

  const nearPts = get8Points(originLat, originLng, donut.nearRingKm);
  const mainPts = get8Points(originLat, originLng, donut.mainRingKm);

  const addBatch = (raw: Record<string, unknown>[], innerM: number, outerM: number) => {
    for (const p of raw) {
      const id = String(p.id ?? "");
      const mapped = mapGoogleToPlaceResponse(p, googleKey, opts);
      if (seen.has(id, mapped.name)) continue;
      if (!inDonut(mapped, originLat, originLng, innerM, outerM)) continue;
      seen.add(id, mapped.name);
      results.push(mapped);
    }
  };

  const runMultiPoint = async (
    queries: string[], points: SearchPoint[], minRating?: number,
  ): Promise<Record<string, unknown>[]> => {
    const tasks = points.flatMap(pt =>
      queries.map(q => searchGooglePlaces(q, pt.lat, pt.lng, googleKey, minRating))
    );
    const settled = await Promise.allSettled(tasks);
    const batch: Record<string, unknown>[] = [];
    for (const r of settled) { if (r.status === "fulfilled") batch.push(...r.value); }
    return batch;
  };

  // STEP 1: 近リング8方向 × 厳密クエリ + 高評価
  if (results.length < TARGET) {
    console.log(`[travel] STEP 1 近リング${donut.nearRingKm}km×8方向 minR=${config.initialMinRating} (現在${results.length}件)`);
    const batch = await runMultiPoint(config.strictQueries, nearPts, config.initialMinRating);
    addBatch(batch, donut.innerM, donut.outerM);
  }

  // STEP 2: 主リング8方向 × 厳密+緩和クエリ + 緩和評価
  if (results.length < TARGET) {
    console.log(`[travel] STEP 2 主リング${donut.mainRingKm}km×8方向 minR=${config.relaxedMinRating} (現在${results.length}件)`);
    const batch = await runMultiPoint(
      [...config.strictQueries, config.relaxedQueries[0]].slice(0, 2),
      mainPts,
      config.relaxedMinRating,
    );
    addBatch(batch, donut.innerM, donut.outerM);
  }

  // STEP 3: 近+主リング16方向 × 緩和クエリ + 評価なし + 内周半減
  if (results.length < TARGET) {
    const halfInnerM = Math.round(donut.innerM / 2);
    console.log(`[travel] STEP 3 16方向 innerHalf=${halfInnerM / 1000}km (現在${results.length}件)`);
    const batch = await runMultiPoint(config.relaxedQueries, [...nearPts, ...mainPts]);
    addBatch(batch, halfInnerM, donut.outerM);
  }

  // STEP 4: ドーナツ解除（全距離許容）
  if (results.length < TARGET) {
    console.log(`[travel] STEP 4 ドーナツ解除 (現在${results.length}件)`);
    const batch = await runMultiPoint(
      [...config.strictQueries, ...config.relaxedQueries],
      [...nearPts, ...mainPts],
    );
    addBatch(batch, 0, 0);
  }

  return results.slice(0, TARGET);
}

// ── Yahoo 8方向マルチリング検索（4ステップ） ─────────────────────────────────
async function runYahooFallback(
  config:    YahooConfig,
  originLat: number,
  originLng: number,
  donut:     DonutConfig,
  googleKey: string,
  transport: string | string[] | undefined,
): Promise<PlaceResponse[]> {
  const seen    = new SeenTracker();
  const results: (PlaceResponse & { _placeLat?: number; _placeLng?: number })[] = [];
  const opts    = { label: config.label, description: config.description, transport, originLat, originLng };

  const nearPts = get8Points(originLat, originLng, donut.nearRingKm);
  const mainPts = get8Points(originLat, originLng, donut.mainRingKm);

  const addEnriched = (places: (PlaceResponse & { _placeLat?: number; _placeLng?: number })[], innerM: number, outerM: number) => {
    for (const p of places) {
      if (seen.has(p.id, p.name)) continue;
      if (!inDonut(p, originLat, originLng, innerM, outerM)) continue;
      seen.add(p.id, p.name);
      results.push(p);
    }
  };

  const addGoogleBatch = (raw: Record<string, unknown>[], innerM: number, outerM: number) => {
    for (const p of raw) {
      const id = String(p.id ?? "");
      const mapped = mapGoogleToPlaceResponse(p, googleKey, opts);
      if (seen.has(id, mapped.name)) continue;
      if (!inDonut(mapped, originLat, originLng, innerM, outerM)) continue;
      seen.add(id, mapped.name);
      results.push(mapped);
    }
  };

  // STEP 1: Yahoo 広域検索 → ドーナツフィルタ
  if (results.length < TARGET) {
    console.log(`[travel] STEP 1 Yahoo dist=${donut.yahooDistKm}km inner=${donut.innerM / 1000}km (現在${results.length}件)`);
    const yPlaces  = await searchYahooMulti(config.yahooGcCodes, config.yahooKeyword, originLat, originLng, donut.yahooDistKm);
    const enriched = await enrichWithGoogle(yPlaces, googleKey, config.label, config.description, originLat, originLng, transport);
    addEnriched(enriched, donut.innerM, donut.outerM);
  }

  // STEP 2: Google 近リング8方向 フォールバック
  if (results.length < TARGET) {
    console.log(`[travel] STEP 2 Google近リング${donut.nearRingKm}km×8方向 (現在${results.length}件)`);
    const tasks = nearPts.flatMap(pt =>
      config.googleFallbackQueries.map(q => searchGooglePlaces(q, pt.lat, pt.lng, googleKey))
    );
    const settled = await Promise.allSettled(tasks);
    const batch: Record<string, unknown>[] = [];
    for (const r of settled) { if (r.status === "fulfilled") batch.push(...r.value); }
    addGoogleBatch(batch, donut.innerM, donut.outerM);
  }

  // STEP 3: Google 主リング8方向 + 内周半減
  if (results.length < TARGET) {
    const halfInnerM = Math.round(donut.innerM / 2);
    console.log(`[travel] STEP 3 Google主リング${donut.mainRingKm}km×8方向 innerHalf=${halfInnerM / 1000}km (現在${results.length}件)`);
    const tasks = mainPts.flatMap(pt =>
      config.googleFallbackQueries.map(q => searchGooglePlaces(q, pt.lat, pt.lng, googleKey))
    );
    const settled = await Promise.allSettled(tasks);
    const batch: Record<string, unknown>[] = [];
    for (const r of settled) { if (r.status === "fulfilled") batch.push(...r.value); }
    addGoogleBatch(batch, halfInnerM, donut.outerM);
  }

  // STEP 4: ドーナツ解除
  if (results.length < TARGET) {
    console.log(`[travel] STEP 4 ドーナツ解除 (現在${results.length}件)`);
    const allPts = [...nearPts, ...mainPts];
    const tasks  = allPts.flatMap(pt =>
      config.googleFallbackQueries.map(q => searchGooglePlaces(q, pt.lat, pt.lng, googleKey))
    );
    const settled = await Promise.allSettled(tasks);
    const batch: Record<string, unknown>[] = [];
    for (const r of settled) { if (r.status === "fulfilled") batch.push(...r.value); }
    addGoogleBatch(batch, 0, 0);
  }

  return results.slice(0, TARGET);
}

// ────────────────────────────────────────────────────────────────────────────
// POST ハンドラ
// ────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<TravelRequest>;
    const { subCategory, areaLabel = "現在地周辺", transport } = body;
    const lat = body.lat;
    const lng = body.lng;

    if (!subCategory || !TRAVEL_CONFIG[subCategory]) {
      return NextResponse.json(
        { error: "subCategory は power_spot / theme_park / town_walk / super_view のいずれかを指定してください" },
        { status: 400 },
      );
    }

    const googleKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
    if (!googleKey) {
      return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY が設定されていません" }, { status: 500 });
    }

    let originLat = typeof lat === "number" ? lat : 0;
    let originLng = typeof lng === "number" ? lng : 0;

    if (originLat === 0 && originLng === 0) {
      if (!areaLabel || areaLabel === "現在地周辺") {
        return NextResponse.json({ error: "位置情報またはエリア名を指定してください" }, { status: 400 });
      }
      const geocoded = await geocodeAddress(areaLabel, googleKey);
      if (!geocoded) {
        return NextResponse.json({ error: `「${areaLabel}」の座標を取得できませんでした` }, { status: 400 });
      }
      originLat = geocoded.lat;
      originLng = geocoded.lng;
    }

    const config = TRAVEL_CONFIG[subCategory];
    const donut  = getDonut(transport);
    console.log(
      `[travel] ▶ ${config.label} | near=${donut.nearRingKm}km main=${donut.mainRingKm}km` +
      ` inner=${donut.innerM / 1000}km outer=${donut.outerM / 1000}km` +
      ` transport="${Array.isArray(transport) ? transport.join(",") : (transport ?? "なし")}"`
    );

    let places: PlaceResponse[];
    if (config.api === "google") {
      places = await runGoogleFallback(config, originLat, originLng, donut, googleKey, transport);
    } else {
      places = await runYahooFallback(config, originLat, originLng, donut, googleKey, transport);
    }

    // 内部フィールドを除去
    const cleaned = places.map(p => {
      const { ...rest } = p as PlaceResponse & Record<string, unknown>;
      delete rest._placeLat;
      delete rest._placeLng;
      return rest as PlaceResponse;
    });

    console.log(`[travel] 最終 ${cleaned.length}件`);

    return NextResponse.json({
      data:             cleaned,
      subCategoryLabel: config.label,
      areaLabel,
    } satisfies TravelApiResponse);

  } catch (e) {
    console.error("[travel] エラー:", e);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}

// ── ユーティリティ ───────────────────────────────────────────────────────────

async function geocodeAddress(
  address: string, googleKey: string,
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
  } catch { return null; }
}

function buildTimeStr(distKm: number, transport?: string | string[]): string {
  const t = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
  let speedKmh: number;
  let modeLabel: string;
  if      (t.includes("電車") || t.includes("バス") || t.includes("train") || t.includes("bus")) { speedKmh = 100; modeLabel = "電車"; }
  else if (t.includes("車")  || t.includes("バイク") || t.includes("car")  || t.includes("bike")) { speedKmh = 80;  modeLabel = "車"; }
  else if (t.includes("自転車") || t.includes("bicycle"))                                          { speedKmh = 12;  modeLabel = "自転車"; }
  else if (t.includes("徒歩")   || t.includes("walk"))                                             { speedKmh =  4;  modeLabel = "徒歩"; }
  else                                                                                              { speedKmh = 100; modeLabel = "電車"; }
  const mins    = Math.round((distKm / speedKmh) * 60);
  const timeStr = mins < 60
    ? `約${mins}分`
    : `約${Math.floor(mins / 60)}時間${mins % 60 > 0 ? `${mins % 60}分` : ""}`;
  return `${modeLabel}で${timeStr}`;
}

function compactWeekdays(weekdays: string[]): string {
  if (weekdays.length === 0) return "";
  const DAY_SHORT = ["月", "火", "水", "木", "金", "土", "日"];
  const parsed = weekdays.map((w, i) => {
    const ci = w.indexOf(":");
    if (ci < 0) return { dayIdx: i, hours: w.trim() };
    const dayFull = w.slice(0, ci).trim();
    const hours   = w.slice(ci + 1).trim();
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
