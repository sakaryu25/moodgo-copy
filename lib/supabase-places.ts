// ─── Supabase 場所検索ヘルパー ────────────────────────────────────────────────
// places テーブルからタグ検索 → Google Places で補強 → PlaceResponse[] に変換

import { supabase } from "@/lib/supabase";
import type { PlaceResponse } from "@/types/onsen";
import { isPriceWithinBudget } from "@/lib/calc-radius";

// ─────────────────────────────────────────────────────────────────────────────
// Supabase レコード型
// ─────────────────────────────────────────────────────────────────────────────
export interface SupabasePlace {
  id: string;
  name: string;
  address: string;
  nearest_station: string | null;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
  tags: string[];
  area: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupabasePlacePhoto {
  id: string;
  place_id: string;
  photo_url: string;
  storage_path: string | null;
  is_primary: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Haversine 距離計算（メートル単位）
// ─────────────────────────────────────────────────────────────────────────────
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m: number, transport: string): string {
  const km = m / 1000;
  const t = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
  // 優先順位: なんでも・車・バイク > 電車・バス > 自転車 > 徒歩 > デフォルト(電車)
  let speedKmh: number;
  let mode: string;
  if (t.includes("なんでも") || t.includes("車") || t.includes("バイク") || t.includes("car") || t.includes("bike")) {
    speedKmh = 40; mode = "車";
  } else if (t.includes("電車") || t.includes("バス") || t.includes("train") || t.includes("bus")) {
    speedKmh = 30; mode = "電車";
  } else if (t.includes("自転車") || t.includes("bicycle")) {
    speedKmh = 12; mode = "自転車";
  } else if (t.includes("徒歩") || t.includes("walk")) {
    speedKmh = 4;  mode = "徒歩";
  } else {
    speedKmh = 30; mode = "電車";
  }
  const mins = Math.round((km / speedKmh) * 60);
  if (mins < 60) return `${mode}で約${mins}分 / ${km.toFixed(1)}km`;
  const h = Math.floor(mins / 60);
  const m2 = mins % 60;
  return `${mode}で約${h}時間${m2 > 0 ? m2 + "分" : ""} / ${km.toFixed(1)}km`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Places (New) で詳細取得（写真・営業時間・評価など）
// ─────────────────────────────────────────────────────────────────────────────
async function fetchGooglePlaceDetail(
  placeId: string,
  apiKey: string,
): Promise<{
  photoUrls: string[];
  rating: number | null;
  reviewCount: number | null;
  openNow: boolean | null;
  openingHours: string | null;
  priceLevel: string | null;
  googleMapsUrl: string;
} | null> {
  try {
    const fields = [
      "id", "photos", "rating", "userRatingCount",
      "currentOpeningHours", "regularOpeningHours",
      "priceLevel", "googleMapsUri",
    ].join(",");
    const url = `https://places.googleapis.com/v1/places/${placeId}?fields=${fields}&languageCode=ja`;
    const res = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fields,
      },
    });
    if (!res.ok) return null;
    const d = await res.json();

    // 写真URL最大5枚（Places API メディアURLを直接使用）
    const photoUrls: string[] = (d.photos ?? [])
      .slice(0, 5)
      .filter((ph: Record<string, unknown>) => !!ph?.name)
      .map((ph: Record<string, unknown>) =>
        `https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=800&key=${apiKey}`
      );

    // 営業時間テキスト
    const hours = d.currentOpeningHours ?? d.regularOpeningHours;
    const openingHours: string | null =
      hours?.weekdayDescriptions
        ? (hours.weekdayDescriptions as string[]).join("\n")
        : null;

    // 価格帯
    const priceLevelMap: Record<string, string> = {
      PRICE_LEVEL_FREE: "無料",
      PRICE_LEVEL_INEXPENSIVE: "￥",
      PRICE_LEVEL_MODERATE: "￥￥",
      PRICE_LEVEL_EXPENSIVE: "￥￥￥",
      PRICE_LEVEL_VERY_EXPENSIVE: "￥￥￥￥",
    };
    const priceLevel = d.priceLevel ? (priceLevelMap[d.priceLevel] ?? null) : null;

    return {
      photoUrls,
      rating: d.rating ?? null,
      reviewCount: d.userRatingCount ?? null,
      openNow: hours?.openNow ?? null,
      openingHours,
      priceLevel,
      googleMapsUrl: d.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${placeId}`,
    };
  } catch {
    return null;
  }
}

// Google Places Text Search (New) でプレイスIDを検索
async function findGooglePlaceId(
  name: string,
  address: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const query = `${name} ${address}`;
    const url = "https://places.googleapis.com/v1/places:searchText";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id",
      },
      body: JSON.stringify({ textQuery: query, languageCode: "ja", maxResultCount: 1 }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.places?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase place → PlaceResponse 変換
// ─────────────────────────────────────────────────────────────────────────────
async function convertToPlaceResponse(
  place: SupabasePlace,
  photos: SupabasePlacePhoto[],
  userLat: number,
  userLng: number,
  transport: string,
  googleApiKey: string,
): Promise<PlaceResponse> {
  const distM = place.lat && place.lng
    ? haversineM(userLat, userLng, place.lat, place.lng)
    : null;
  const distanceInfo = distM !== null ? formatDistance(distM, transport) : "距離不明";

  // 地図タイルURLを除外する判定
  const isRealPhotoUrl = (url: string) =>
    !!url &&
    !url.includes("maps.googleapis.com") &&
    !url.includes("maps.gstatic.com") &&
    !url.includes("streetviewpixels") &&
    !url.includes("geo0.ggpht.com") &&
    !url.includes("cbk0.google.com");

  // Supabase 登録写真を先頭に並べる（地図タイルを除外）
  const userPhotoUrls = photos
    .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
    .map(p => p.photo_url)
    .filter(isRealPhotoUrl);

  // Google で補強
  let googleDetail: Awaited<ReturnType<typeof fetchGooglePlaceDetail>> = null;
  let resolvedPlaceId = place.google_place_id;

  if (googleApiKey) {
    if (!resolvedPlaceId) {
      resolvedPlaceId = await findGooglePlaceId(place.name, place.address, googleApiKey);
    }
    if (resolvedPlaceId) {
      googleDetail = await fetchGooglePlaceDetail(resolvedPlaceId, googleApiKey);
    }
  }

  const googlePhotoUrls = googleDetail?.photoUrls ?? [];
  // ユーザー投稿写真 → Google写真 の順で最大8枚
  const allPhotoUrls = [
    ...userPhotoUrls,
    ...googlePhotoUrls.filter(u => !userPhotoUrls.includes(u)),
  ].slice(0, 8);

  const finalPhotoUrls = allPhotoUrls;

  return {
    id: resolvedPlaceId ?? `sb-${place.id}`,
    name: place.name,
    category: place.tags.find(t => t !== "#お腹すいた") ?? "グルメ",
    description: place.description ?? `${place.name}の詳細情報です。`,
    imageUrl: finalPhotoUrls[0] ?? "",
    rating: googleDetail?.rating ?? null,
    reviewCount: googleDetail?.reviewCount ?? null,
    address: place.address,
    distanceInfo,
    photoUrls: finalPhotoUrls,
    openNow: googleDetail?.openNow ?? null,
    openingHours: googleDetail?.openingHours ?? null,
    priceLevel: googleDetail?.priceLevel ?? null,
    googleMapsUrl: googleDetail?.googleMapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + " " + place.address)}`,
    stationInfo: place.nearest_station ?? null,
    source: "admin" as const,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// メイン検索関数
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// 交通手段に基づく最大半径（km）
// ─────────────────────────────────────────────────────────────────────────────
function getTransportMaxRadius(transport: string): number {
  const t = transport.toLowerCase();
  if (t.includes("徒歩"))         return 3;    // 徒歩: 最大3km
  if (t.includes("自転車"))       return 10;   // 自転車: 最大10km
  if (t.includes("電車") || t.includes("バス")) return 60; // 電車・バス: 最大60km
  // 車・バイク / なんでも → 制限なし（mood側のradiusKmをそのまま使う）
  return Infinity;
}

export interface SearchPlacesOptions {
  mustTags: string[];          // すべて含む場所のみ（@>）
  fallbackTags?: string[];     // mustTags がヒット0件時の緩いタグ
  lat?: number;
  lng?: number;
  radiusKm?: number;           // 半径フィルター（省略時: 10km）
  transport?: string | string[];
  limit?: number;              // 最大件数（省略時: 20）
  googleApiKey?: string;
  companion?: string;          // 誰と（例: "恋人", "友達", "家族", "一人"）
  budget?: number;             // 予算上限（円）0または未定は制限なし
  minRadiusKm?: number;        // この距離以上の場所を優先（車+長時間用）
  preferFar?: boolean;         // 遠い場所を優先（遠くに行きたい用）
  prefecture?: string;         // 都道府県フィルター（例: "東京都"）
}

// ── 全体ブロック済みスポット名を取得（キャッシュ60秒）──────────────────────
let _globalBlockCache: string[] = [];
let _globalBlockCachedAt = 0;
async function getGloballyBlockedNames(): Promise<string[]> {
  const now = Date.now();
  if (now - _globalBlockCachedAt < 60_000) return _globalBlockCache;
  try {
    const { data } = await supabase!
      .from("globally_blocked_places")
      .select("spot_name");
    _globalBlockCache = (data ?? []).map((r: { spot_name: string }) => r.spot_name);
    _globalBlockCachedAt = now;
  } catch { /* ignore */ }
  return _globalBlockCache;
}

export async function searchPlacesByTags(
  opts: SearchPlacesOptions,
): Promise<PlaceResponse[]> {
  if (!supabase) return [];

  const {
    mustTags: mustTagsInput,
    fallbackTags = [],
    lat = 0,
    lng = 0,
    radiusKm = 10,
    transport = "",
    limit = 20,
    googleApiKey = "",
    companion,
    budget,
    minRadiusKm = 0,
    preferFar = false,
    prefecture,
  } = opts;

  // 予算=0（無料）の場合、#無料タグを必須タグに追加
  const mustTags = (budget === 0)
    ? [...mustTagsInput, "#無料"]
    : mustTagsInput;

  if (companion) {
    console.log(`[supabase-places] companion="${companion}"`);
  }

  const transportStr = Array.isArray(transport) ? transport.join(",") : (transport ?? "");

  // ── 交通手段で半径を上限調整 ────────────────────────────────────────────
  // 複数交通手段が選ばれている場合は最も広い上限を採用
  const transportList = Array.isArray(transport) ? transport : (transport ? [transport] : []);
  const transportMaxKm = transportList.length > 0
    ? Math.max(...transportList.map(t => getTransportMaxRadius(t)))
    : Infinity;
  const effectiveRadiusKm = Math.min(radiusKm, transportMaxKm);

  // ── 大量プール取得（距離拡張のために多めに取得）──────────────────────
  const fetchLimit = Math.max(limit * 10, 200);
  let places = await queryByTags(mustTags, fetchLimit, prefecture);

  // ── fallbackTags で再検索 ────────────────────────────────────────────
  if (places.length === 0 && fallbackTags.length > 0 && fallbackTags.join() !== mustTags.join()) {
    places = await queryByTags(fallbackTags, fetchLimit, prefecture);
  }

  // ── ジャンルタグのみで再検索 ─────────────────────────────────────────
  if (places.length === 0) {
    const genreOnly = mustTags.filter(t => t !== "#お腹すいた").slice(0, 1);
    if (genreOnly.length > 0) {
      places = await queryByTags(["#お腹すいた", ...genreOnly], fetchLimit, prefecture);
    }
  }

  if (places.length === 0) return [];

  // ── 全体ブロック済みスポットを除外 ─────────────────────────────────────
  const globallyBlocked = await getGloballyBlockedNames();
  if (globallyBlocked.length > 0) {
    places = places.filter(p => !globallyBlocked.includes(p.name));
  }

  // ── 距離付きリストを作成 ───────────────────────────────────────────────
  const userHasLocation = lat !== 0 || lng !== 0;

  const withDist = places.map(p => ({
    place: p,
    distKm: (userHasLocation && p.lat != null && p.lng != null)
      ? haversineM(lat, lng, p.lat, p.lng) / 1000
      : 0,
  }));

  // ── 段階的半径拡張: limit件確保できるまで広げる ─────────────────────
  // 1x → 1.5x → 2x → 3x → 無制限
  const expansions = userHasLocation
    ? [1, 1.5, 2, 3, Infinity]
    : [Infinity];

  let candidates = withDist;
  for (const mult of expansions) {
    const maxKm = mult === Infinity ? Infinity : effectiveRadiusKm * mult;
    const inRange = mult === Infinity
      ? withDist
      : withDist.filter(x =>
          x.place.lat != null && x.place.lng != null && x.distKm <= maxKm,
        );
    candidates = inRange.length > 0 ? inRange : withDist;
    if (candidates.length >= limit) break;
  }

  // ── 順序決定（preferFar / minRadiusKm / シャッフル）────────────────
  let sorted: SupabasePlace[];
  if (preferFar) {
    // 遠い順（20km帯ごとにグループ分けして帯内はシャッフル → 毎回違う順番に）
    candidates.sort((a, b) => {
      const bandA = Math.floor(a.distKm / 20);
      const bandB = Math.floor(b.distKm / 20);
      if (bandB !== bandA) return bandB - bandA; // 遠い帯を優先
      return Math.random() - 0.5;               // 同じ帯内はランダム
    });
    sorted = candidates.map(x => x.place);
  } else if (minRadiusKm > 0) {
    // 車+長時間: minRadiusKm以上を先頭に、その中でシャッフル
    const far  = candidates.filter(x => x.distKm >= minRadiusKm).sort(() => Math.random() - 0.5);
    const near = candidates.filter(x => x.distKm <  minRadiusKm).sort(() => Math.random() - 0.5);
    sorted = [...far, ...near].map(x => x.place);
  } else {
    sorted = [...candidates].sort(() => Math.random() - 0.5).map(x => x.place);
  }

  const sliced = sorted.slice(0, limit);

  // ── 写真取得 ───────────────────────────────────────────────────────────
  const placeIds = sliced.map(p => p.id);
  const { data: photosData } = await supabase
    .from("place_photos")
    .select("*")
    .in("place_id", placeIds);
  const photosMap = new Map<string, SupabasePlacePhoto[]>();
  for (const ph of photosData ?? []) {
    if (!photosMap.has(ph.place_id)) photosMap.set(ph.place_id, []);
    photosMap.get(ph.place_id)!.push(ph as SupabasePlacePhoto);
  }

  // ── Google補強 & 変換（並列実行）──────────────────────────────────────
  const results = await Promise.allSettled(
    sliced.map(place =>
      convertToPlaceResponse(
        place,
        photosMap.get(place.id) ?? [],
        lat,
        lng,
        transportStr,
        googleApiKey,
      ),
    ),
  );

  const enriched = results
    .filter(r => r.status === "fulfilled")
    .map(r => (r as PromiseFulfilledResult<PlaceResponse>).value);

  // 予算フィルタ（budget > 0 の場合のみ適用）
  if (budget && budget > 0) {
    const budgetFiltered = enriched.filter(p => isPriceWithinBudget(p.priceLevel, budget));
    // フィルタ後に件数が減りすぎた場合は元リストを返す（過疎対策）
    return budgetFiltered.length >= Math.min(3, enriched.length) ? budgetFiltered : enriched;
  }

  return enriched;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase クエリ（タグが全て含まれるアクティブな場所）
// ─────────────────────────────────────────────────────────────────────────────
async function queryByTags(tags: string[], limit: number, prefecture?: string): Promise<SupabasePlace[]> {
  if (!supabase || tags.length === 0) return [];
  let query = supabase
    .from("places")
    .select("*")
    .eq("is_active", true)
    .contains("tags", tags)
    .limit(limit);

  if (prefecture) {
    query = query.ilike("address", `%${prefecture}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[supabase-places] queryByTags error:", error.message);
    return [];
  }
  return (data ?? []) as SupabasePlace[];
}
