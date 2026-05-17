import { NextRequest, NextResponse } from "next/server";
import type { NatureSubGenre, NatureRequest, NatureApiResponse } from "@/types/nature";
import type { PlaceResponse } from "@/types/onsen";
import { calcRadiusKm as calcRadiusKmFromTime, isPriceWithinBudget } from "@/lib/calc-radius";

// ────────────────────────────────────────────────────────────────────────────
// 自然感じたい専用 API
//
// ・Yahoo API 不使用
// ・OpenAI 不使用
// ・Google Places Text Search (New) のみで施設を発見・整形
// ・交通手段に基づく検索半径（徒歩2km / 自転車5km / 電車10km / 車30km）
// ────────────────────────────────────────────────────────────────────────────

// ── サブジャンル設定 ────────────────────────────────────────────────────────
interface SubGenreConfig {
  label:       string;
  queries:     string[];           // OR 分岐はクエリを分割して並列実行
  description: string;
}

const SUB_GENRE_CONFIG: Record<NatureSubGenre, SubGenreConfig> = {
  ocean: {
    label:       "🌊 波の音と海風",
    queries:     ["海浜公園", "海岸 景色が良い"],
    description: "心地よい海風と波の音に癒やされるスポット！",
  },
  forest: {
    label:       "🌳 森の中で深呼吸",
    queries:     ["森林浴", "自然公園 散策"],
    description: "木漏れ日の中で深呼吸できる、静かな自然空間！",
  },
  park: {
    label:       "🧺 広い芝生でゴロゴロ",
    queries:     ["大型公園 芝生広場 ピクニック"],
    description: "広い芝生でゴロゴロしたり、ピクニックができる公園！",
  },
  view: {
    label:       "⛰️ 圧倒的な絶景",
    queries:     ["展望台", "絶景スポット 高台"],
    description: "スカッとした気分になれる、見晴らし抜群の絶景スポット！",
  },
};

// ── 交通手段 → 検索半径（メートル）────────────────────────────────────────
function getRadiusM(transport: string | string[] | undefined): number {
  const t = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
  if (t.includes("徒歩"))              return  2_000;
  if (t.includes("自転車"))            return  5_000;
  if (t.includes("電車") || t.includes("バス")) return 10_000;
  if (t.includes("車")  || t.includes("バイク")) return 30_000;
  return 10_000; // デフォルト（電車相当）
}

// ── テキストクエリ生成 ─────────────────────────────────────────────────────
function buildTextQuery(query: string, area: string): string {
  if (!area || area === "現在地周辺") return query;
  return `${area} ${query}`;
}

// ── Google Places Text Search FieldMask ─────────────────────────────────
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

// ── Google Places Text Search 呼び出し ──────────────────────────────────
async function searchGooglePlaces(
  textQuery:      string,
  lat:            number,
  lng:            number,
  radiusM:        number,
  googleKey:      string,
  maxResultCount: number = 20,
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
        maxResultCount,
        minRating:      3.5,
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: radiusM,
          },
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[nature] "${textQuery}" HTTP ${res.status} ${errBody.slice(0, 160)}`);
      return [];
    }
    const data = await res.json();
    const places = (data.places ?? []) as Record<string, unknown>[];
    console.log(`[nature] "${textQuery}" (bias r=${radiusM / 1000}km) → ${places.length}件`);
    return places;
  } catch (e) {
    console.warn(`[nature] "${textQuery}" 例外:`, e);
    return [];
  }
}

// ── PlaceResponse へのマッピング ─────────────────────────────────────────
function mapToPlaceResponse(
  place:     Record<string, unknown>,
  googleKey: string,
  opts: {
    subGenreLabel: string;
    description:   string;
    transport?:    string | string[];
    originLat:     number;
    originLng:     number;
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
    id:           String(place.id ?? `nature-${name}`),
    name,
    category:     opts.subGenreLabel,
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
  };
}

// ── 重複除去 ───────────────────────────────────────────────────────────────
function dedup(places: PlaceResponse[]): PlaceResponse[] {
  const seenIds   = new Set<string>();
  const seenNames = new Set<string>();
  const result: PlaceResponse[] = [];
  for (const p of places) {
    const idKey = p.id.startsWith("nature-") ? null : p.id;
    if ((idKey && seenIds.has(idKey)) || seenNames.has(p.name.trim())) continue;
    if (idKey) seenIds.add(idKey);
    seenNames.add(p.name.trim());
    result.push(p);
  }
  return result;
}

function dedupByNamePrefix(places: PlaceResponse[]): PlaceResponse[] {
  const result: PlaceResponse[] = [];
  for (const candidate of places) {
    const cName = candidate.name.trim();
    const conflictIdx = result.findIndex(r => {
      const rName   = r.name.trim();
      const shorter = rName.length <= cName.length ? rName : cName;
      const longer  = rName.length <= cName.length ? cName : rName;
      return shorter.length >= 4 && longer.startsWith(shorter);
    });
    if (conflictIdx === -1) {
      result.push(candidate);
    } else {
      if (cName.length < result[conflictIdx].name.trim().length) {
        result[conflictIdx] = candidate;
      }
    }
  }
  return result;
}

function dedupByAddress(places: PlaceResponse[]): PlaceResponse[] {
  const seenAddresses = new Map<string, number>();
  const result: PlaceResponse[] = [];
  for (const p of places) {
    const addr = p.address.trim();
    if (!addr) { result.push(p); continue; }
    const existingIdx = seenAddresses.get(addr);
    if (existingIdx === undefined) {
      seenAddresses.set(addr, result.length);
      result.push(p);
    } else {
      if ((p.reviewCount ?? 0) > (result[existingIdx].reviewCount ?? 0)) {
        result[existingIdx] = p;
      }
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// POST ハンドラ
// ────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<NatureRequest> & {
      time?: string;
      companion?: string;
      budget?: number;
      freeWord?: string;
    };
    const { subGenre, areaLabel = "現在地周辺", transport, time, companion, budget, freeWord } = body;
    const lat = body.lat;
    const lng = body.lng;

    if (companion) console.log(`[nature] companion="${companion}"`);
    if (freeWord)  console.log(`[nature] freeWord="${freeWord}"`);

    if (!subGenre || !SUB_GENRE_CONFIG[subGenre]) {
      return NextResponse.json(
        { error: "subGenre は ocean / forest / park / view のいずれかを指定してください" },
        { status: 400 },
      );
    }
    const googleKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
    if (!googleKey) {
      return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY が設定されていません" }, { status: 500 });
    }

    // ── 座標の確定（GPS未取得 = 0,0 のときはエリア名をジオコード）──────────
    let searchLat = (typeof lat === "number" ? lat : 0);
    let searchLng = (typeof lng === "number" ? lng : 0);

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
      console.log(`[nature] ジオコード "${areaLabel}" → (${searchLat.toFixed(4)}, ${searchLng.toFixed(4)})`);
    }

    const config = SUB_GENRE_CONFIG[subGenre];

    // time + transport が揃っている場合は calcRadiusKm で計算、そうでなければ従来ロジック
    const transportArr = Array.isArray(transport) ? transport : (transport ? [transport] : []);
    const radiusM = (time && transportArr.length > 0)
      ? calcRadiusKmFromTime(transportArr, time) * 1000
      : getRadiusM(transport);
    console.log(`[nature] ▶ ${config.label} radius=${radiusM / 1000}km transport="${transportArr.join(",") || "未指定"}" time="${time ?? "-"}"`);

    // freeWord があれば各クエリに付加
    const buildQuery = (q: string) => {
      const base = buildTextQuery(q, areaLabel);
      return freeWord ? `${base} ${freeWord}` : base;
    };

    // ── 全クエリを並列実行 ────────────────────────────────────────────────
    const results = await Promise.allSettled(
      config.queries.map(q =>
        searchGooglePlaces(
          buildQuery(q),
          searchLat, searchLng, radiusM,
          googleKey,
          20,
        )
      )
    );

    let allPlaces: Record<string, unknown>[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") allPlaces.push(...r.value);
    }
    console.log(`[nature] プライマリ ${allPlaces.length}件 raw`);

    // ── フォールバック: 結果が少ない場合は半径を拡大して再検索 ──────────
    if (allPlaces.length < 5) {
      const fbRadius = Math.min(radiusM * 3, 50_000);
      console.log(`[nature] フォールバック r=${fbRadius / 1000}km`);
      const fbResults = await Promise.allSettled(
        config.queries.map(q =>
          searchGooglePlaces(
            buildTextQuery(q, areaLabel),
            searchLat, searchLng, fbRadius,
            googleKey,
            20,
          )
        )
      );
      const existingIds = new Set(allPlaces.map(p => String(p.id ?? "")));
      for (const r of fbResults) {
        if (r.status === "fulfilled") {
          for (const p of r.value) {
            if (!existingIds.has(String(p.id ?? ""))) allPlaces.push(p);
          }
        }
      }
      console.log(`[nature] フォールバック後 ${allPlaces.length}件`);
    }

    // ── 評価順ソート ──────────────────────────────────────────────────────
    allPlaces.sort((a, b) =>
      ((b.rating as number) ?? 0) - ((a.rating as number) ?? 0)
    );

    // ── PlaceResponse へ変換 ─────────────────────────────────────────────
    const opts = {
      subGenreLabel: config.label,
      description:   config.description,
      transport,
      originLat:     searchLat,
      originLng:     searchLng,
    };
    const mapped = allPlaces.map(p => mapToPlaceResponse(p, googleKey, opts));

    // ── 重複除去 → 最大20件 ──────────────────────────────────────────────
    let places = dedupByAddress(dedupByNamePrefix(dedup(mapped))).slice(0, 20);

    // ── 予算フィルタ ──────────────────────────────────────────────────────
    if (budget && budget > 0) {
      const budgetFiltered = places.filter(p => isPriceWithinBudget(p.priceLevel, budget));
      if (budgetFiltered.length >= Math.min(3, places.length)) places = budgetFiltered;
    }

    console.log(`[nature] 最終 ${places.length}件`);

    return NextResponse.json({
      data:          places,
      subGenreLabel: config.label,
      areaLabel,
    } satisfies NatureApiResponse);

  } catch (e) {
    console.error("[nature] エラー:", e);
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
  const t = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
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
  const mins = Math.round((distKm / speedKmh) * 60);
  const timeStr = mins < 60 ? `約${mins}分` : `約${(mins / 60).toFixed(1)}時間`;
  return modeLabel ? `${modeLabel}で${timeStr} / ${distStr}` : distStr;
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
