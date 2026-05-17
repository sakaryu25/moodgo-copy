import { NextRequest, NextResponse } from "next/server";
import type {
  OnsenCategory,
  OnsenRequest,
  PlaceResponse,
  OnsenApiResponse,
} from "@/types/onsen";

// ────────────────────────────────────────────────────────────────────────────
// 【重要】Yahoo Local Search API の gc パラメータはこの API キーでは機能しない。
//        gc を指定すると必ず 0 件になる。
//        → キーワード検索のみ（gc なし）で全カテゴリを実現する。
//
// 【サウナ・岩盤浴カテゴリの特別対応】
//   Yahoo の「サウナ」単体検索はアダルト系施設が多数混入する。
//   対策 1: 複合キーワード（「サウナ 銭湯」「サウナ スパ」）を使用
//   対策 2: Google Places テキスト検索を「発見」にも使用（Yahoo だけでは弱い）
//   → Yahoo + Google の両方から施設を取得し、マージ・重複除去する
// ────────────────────────────────────────────────────────────────────────────

interface KeywordSearch {
  keyword: string;
  nameRe:  RegExp;  // この keyword 専用の施設名フィルタ
}

interface CategoryConfig {
  label:           string;
  keywordSearches: KeywordSearch[];
  googleQueries?:  string[];   // Google Places 直接検索クエリ（オプション）
  googleNameRe?:   RegExp;     // Google 直接検索専用フィルタ（省略時は mergedNameRe を使用）
}

const CATEGORY_CONFIG: Record<OnsenCategory, CategoryConfig> = {
  // ① 天然温泉・日帰り温泉
  natural_onsen: {
    label: "天然温泉・日帰り温泉",
    keywordSearches: [
      { keyword: "天然温泉", nameRe: /天然温泉|鉱泉|源泉|の湯|湯処|湯屋|温浴|温泉/i },
      { keyword: "日帰り温泉", nameRe: /日帰り温泉|天然温泉|温泉|の湯|湯/i },
      { keyword: "温泉",      nameRe: /天然温泉|日帰り温泉|温泉|鉱泉|源泉|の湯|湯処|湯屋|温浴/i },
    ],
  },

  // ② 銭湯
  //   「○○湯」「COCOFUROますの湯」など名前に「銭湯」が入らない施設が多い
  //   → Yahoo + Google 両方で検索し、nameRe を広めに設定
  sento: {
    label: "銭湯",
    keywordSearches: [
      // 「銭湯」「公衆浴場」→ 名前に銭湯/浴場を含む施設
      { keyword: "銭湯",    nameRe: /銭湯|浴場/i },
      { keyword: "公衆浴場", nameRe: /銭湯|浴場/i },
      // 「銭湯 温浴」→ 「○○湯」「○○の湯」「恵びす温泉」系も拾う
      { keyword: "銭湯 温浴", nameRe: /銭湯|浴場|の湯|湯$|温泉|COCOFURO/i },
    ],
    googleQueries: ["銭湯", "公衆浴場"],   // Google で補完
    // Google 検索では「小松湯」「富士見湯」など名前が "湯" で終わる銭湯を広く拾う
    googleNameRe: /銭湯|浴場|の湯|湯$|温泉|COCOFURO|スーパー銭湯/i,
  },

  // ③ スーパー銭湯・健康ランド
  super_sento: {
    label: "スーパー銭湯・健康ランド",
    keywordSearches: [
      { keyword: "スーパー銭湯", nameRe: /スーパー銭湯|健康ランド|SPA|RAKU|おふろ|ユーランド|テルマ|万葉|極楽湯|湯楽|湯快|竜泉|温泉|サウナ|銭湯|湯/i },
      { keyword: "健康ランド",   nameRe: /健康ランド|スーパー銭湯|SPA|温泉|サウナ|湯|スパ/i },
      { keyword: "RAKU SPA",     nameRe: /RAKU|SPA|スパ|温泉|銭湯|サウナ|健康|湯/i },
      { keyword: "ラクスパ",     nameRe: /RAKU|SPA|ラクスパ|スパ|温泉|銭湯|サウナ|湯/i },
    ],
  },

  // ④ サウナ・岩盤浴
  //   Yahoo 単体では弱いため Google Places 直接検索も併用
  //   「サウナ 銭湯」→ 銭湯系サウナ19件（ノイズなし）
  //   「サウナ スパ」→ スカイスパYOKOHAMAなどスパ系
  //   「岩盤浴」     → 岩盤浴専門施設
  sauna_ganban: {
    label: "サウナ・岩盤浴",
    keywordSearches: [
      { keyword: "サウナ 銭湯", nameRe: /銭湯|浴場|温泉|の湯|湯|サウナ|スパ|SPA|おふろ/i },
      { keyword: "サウナ スパ", nameRe: /サウナ|スパ|SPA|sauna|温泉|湯/i },
      { keyword: "岩盤浴",      nameRe: /岩盤浴|サウナ|温泉|スパ|SPA|健康|湯/i },
      { keyword: "サウナ",      nameRe: /サウナ|sauna/i },
    ],
    googleQueries: ["サウナ", "岩盤浴"],  // Google も直接検索
  },

  // ⑤ 温泉施設全般
  all_onsen: {
    label: "温泉施設全般",
    keywordSearches: [
      { keyword: "温泉",       nameRe: /温泉|銭湯|サウナ|岩盤浴|浴場|SPA|RAKU|湯|ゆ|健康ランド/i },
      { keyword: "銭湯",       nameRe: /銭湯|浴場|温泉|湯/i },
      { keyword: "スーパー銭湯", nameRe: /スーパー銭湯|健康ランド|SPA|RAKU|おふろ|温泉|湯/i },
      { keyword: "サウナ 銭湯", nameRe: /サウナ|銭湯|浴場|温泉|湯|スパ|SPA/i },
      { keyword: "岩盤浴",      nameRe: /岩盤浴|サウナ|温泉|スパ|SPA|湯/i },
      { keyword: "健康ランド",   nameRe: /健康ランド|スーパー銭湯|SPA|温泉|サウナ|湯/i },
    ],
  },
};

// ── 除外パターン（カプセル・ホテル・法人・風俗系）──────────────────────────
const CORP_RE =
  /株式会社|有限会社|合同会社|一般社団法人|公益財団法人|\(株\)|（株）|㈱|\(有\)|（有）|本社|事務所|本部|研修施設|保養施設|保健センター|公民館|コミュニティ|高齢者|老人|福祉|介護|デイサービス|病院|クリニック|医院|診療所|歯科|薬局|ドラッグ|ホテル|スーパーホテル|カプセルホテル|カプセルイン|カプセル&|カプセル＆|ビジネスホテル|アパホテル|東横イン|ルートイン|コンフォートホテル|チェックイン|&HOTEL|＆HOTEL|HOTEL|アンドホテル|ファッションヘルス|デリバリーヘルス|ソープランド|風俗/;

// ────────────────────────────────────────────────────────────────────────────
// POST ハンドラ
// ────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<OnsenRequest>;
    const {
      category,
      areaLabel = "現在地周辺",
      transport,
      time,
      companion,
      budget,
      freeWord,
    } = body;
    let { lat, lng } = body;

    if (!category || !CATEGORY_CONFIG[category]) {
      return NextResponse.json(
        { error: "category は natural_onsen / sento / super_sento / sauna_ganban / all_onsen のいずれかを指定してください" },
        { status: 400 }
      );
    }

    let coordSource = "GPS";
    if (!isValidCoord(lat, lng)) {
      coordSource = "geocode";
      if (areaLabel && areaLabel !== "現在地周辺") {
        const geo = await geocodeArea(areaLabel);
        if (geo) { lat = geo.lat; lng = geo.lng; }
      }
      if (!isValidCoord(lat, lng)) {
        return NextResponse.json(
          { error: "位置情報またはエリア名を指定してください" },
          { status: 400 }
        );
      }
    }

    const originLat = lat as number;
    const originLng = lng as number;
    const radiusKm  = calcRadiusKm(transport);
    const config    = CATEGORY_CONFIG[category];
    const googleKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;

    console.log(`[onsen] ▶ ${config.label} (${originLat.toFixed(4)},${originLng.toFixed(4)}) r=${radiusKm}km [${coordSource}]`);

    const aiDesc = buildDescription({ config, transport, time, companion, budget, freeWord });

    // ── STEP 2: Yahoo Local Search ──────────────────────────────────────────
    let yahooResults = await searchYahoo({ lat: originLat, lng: originLng, radiusKm, config });

    if (yahooResults.length === 0 && radiusKm < 20) {
      for (const expandKm of [10, 20]) {
        if (expandKm <= radiusKm) continue;
        console.log(`[onsen] 0件 → 半径 ${radiusKm}km→${expandKm}km で再試行`);
        yahooResults = await searchYahoo({ lat: originLat, lng: originLng, radiusKm: expandKm, config });
        if (yahooResults.length > 0) break;
      }
    }
    console.log(`[onsen] Yahoo ${yahooResults.length}件`);

    // ── STEP 3: Google Places で写真・評価を補完 + 直接検索（サウナ系）──────
    const enrichOpts = {
      originLat, originLng, transport,
      categoryLabel: config.label, aiDescription: aiDesc,
    };

    // Yahoo 結果を Google で補完
    const yahooEnriched = await enrichWithGoogle(yahooResults, enrichOpts);

    // サウナ・岩盤浴 / 銭湯 は Google 直接検索も実施（Yahoo は弱いため）
    let googleDirect: PlaceResponse[] = [];
    if (config.googleQueries && config.googleQueries.length > 0 && googleKey) {
      // googleNameRe が定義されていればそちら優先、なければ keywordSearches を全マージ
      const discoveryRe = config.googleNameRe ?? mergedNameRe(config.keywordSearches);
      googleDirect = await discoverWithGoogle(
        config.googleQueries, originLat, originLng, radiusKm * 1000,
        googleKey, discoveryRe, enrichOpts,
      );
      console.log(`[onsen] Google直接検索 ${googleDirect.length}件`);
    }

    // マージ・重複除去（Google直接 → Yahoo補完の順で優先）
    const places = mergePlaces(yahooEnriched, googleDirect);
    console.log(`[onsen] 最終 ${places.length}件`);

    return NextResponse.json({
      data:          places,
      categoryLabel: config.label,
      areaLabel,
      aiDescription: aiDesc,
    } satisfies OnsenApiResponse);

  } catch (e) {
    console.error("[onsen] エラー:", e);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ルールベース description（OpenAI 不使用）
// ────────────────────────────────────────────────────────────────────────────
function buildDescription(opts: {
  config:     CategoryConfig;
  transport?: string | string[];
  time?:      string;
  companion?: string;
  budget?:    number;
  freeWord?:  string;
}): string {
  const c  = opts.companion ?? "";
  const fw = opts.freeWord  ?? "";

  if (fw.includes("サウナ"))   return "サウナでととのいながら、最高のリフレッシュを。";
  if (fw.includes("岩盤浴"))   return "岩盤浴で体の芯からじっくり温まろう。";
  if (fw.includes("露天"))     return "露天風呂でのんびり空を眺めてリラックス。";
  if (fw.includes("炭酸"))     return "炭酸泉でシュワシュワ、お肌もつるつる。";

  if (c.includes("ひとり"))                         return "ひとりでゆっくり、自分だけの癒し時間を。";
  if (c.includes("カップル") || c.includes("恋人")) return "ふたりで温泉、特別な時間になるはず。";
  if (c.includes("家族"))                           return "家族みんなで楽しめる温浴施設です。";
  if (c.includes("友達") || c.includes("友人"))     return "友達と一緒にリフレッシュしよう。";

  const msgs: Record<OnsenCategory, string> = {
    natural_onsen: "天然温泉でしっかり疲れを癒せますよ。",
    sento:         "地元の銭湯でさっぱりリフレッシュしよう。",
    super_sento:   "スーパー銭湯でのんびり過ごすのが最高です。",
    sauna_ganban:  "サウナ・岩盤浴でデトックス、気分すっきり。",
    all_onsen:     "近くの温浴施設でゆったりリラックスしよう。",
  };

  const key = (Object.keys(CATEGORY_CONFIG) as OnsenCategory[])
    .find(k => CATEGORY_CONFIG[k].label === opts.config.label) ?? "all_onsen";
  return msgs[key];
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 2 — Yahoo Local Search
// ────────────────────────────────────────────────────────────────────────────
interface YahooPlace {
  name:       string;
  address:    string;
  lat:        number;
  lng:        number;
  distanceKm: number;
}

function calcRadiusKm(transport?: string | string[]): number {
  const modes = Array.isArray(transport) ? transport : (transport ? [transport] : []);
  if (modes.length === 0) return 20;
  const radii = modes.map(m => {
    if (m.includes("徒歩"))                            return  5; // 徒歩: 5km
    if (m.includes("自転車") || m.includes("バイク")) return 12; // 自転車・バイク: 12km
    if (m.includes("電車")   || m.includes("バス"))   return 15; // 電車・バス: 15km（Yahoo上限20km内）
    return 20; // 車・なんでも: 20km（Yahoo API上限）
  });
  return Math.max(...radii);
}

async function searchYahoo(opts: {
  lat: number; lng: number; radiusKm: number; config: CategoryConfig;
}): Promise<YahooPlace[]> {
  const apiKey = process.env.YAHOO_LOCAL_SEARCH_API_KEY;
  if (!apiKey) { console.warn("[onsen] YAHOO_LOCAL_SEARCH_API_KEY 未設定"); return []; }

  const dist = String(Math.min(opts.radiusKm, 20));

  // 各 keywordSearch を並列実行
  const tasks = opts.config.keywordSearches.map(ks =>
    fetchYahooFeatures(apiKey, opts.lat, opts.lng, dist, ks.keyword)
      .then(features => ({ features, nameRe: ks.nameRe }))
  );

  console.log(`[onsen] Yahoo ${tasks.length}並列 r=${dist}km`);
  const settled = await Promise.allSettled(tasks);

  const seen    = new Set<string>();
  const results: YahooPlace[] = [];

  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const { features, nameRe } = r.value;
    for (const f of features) {
      const name = String(f.Name ?? "").trim();
      if (!name || seen.has(name)) continue;
      if (CORP_RE.test(name))  { console.log(`[onsen] 除外(CORP) "${name}"`); continue; }
      if (!nameRe.test(name))  { console.log(`[onsen] 除外(name) "${name}"`); continue; }

      seen.add(name);

      const prop   = (f.Property ?? {}) as Record<string, unknown>;
      const coords = String((f.Geometry as Record<string, unknown>)?.Coordinates ?? "");
      const [lngStr, latStr] = coords.split(",");
      const fLat = parseFloat(latStr ?? "0");
      const fLng = parseFloat(lngStr ?? "0");

      results.push({
        name,
        address:    String(prop.Address ?? ""),
        lat: fLat, lng: fLng,
        distanceKm: Math.round(haversineKm(opts.lat, opts.lng, fLat, fLng) * 10) / 10,
      });
    }
  }

  results.sort((a, b) => a.distanceKm - b.distanceKm);
  return results;
}

async function fetchYahooFeatures(
  apiKey: string, lat: number, lng: number, dist: string, keyword: string,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    appid: apiKey, lat: String(lat), lon: String(lng),
    dist, results: "50", sort: "score", output: "json", query: keyword,
  });
  try {
    const res = await fetch(
      `https://map.yahooapis.jp/search/local/V1/localSearch?${params}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) { console.warn(`[onsen] Yahoo "${keyword}" HTTP ${res.status}`); return []; }
    const json = await res.json();
    const features = (json.Feature ?? []) as Record<string, unknown>[];
    console.log(`[onsen] Yahoo "${keyword}" → ${features.length}件`);
    return features;
  } catch (e) {
    console.warn(`[onsen] Yahoo "${keyword}" 例外:`, e);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 3a — Google Places 直接発見（サウナ・岩盤浴専用）
//
// Yahoo データが弱いカテゴリ向けに Google Places テキスト検索で施設を発見する。
// 発見した施設はそのまま PlaceResponse として返す（写真・評価・営業時間つき）。
// ────────────────────────────────────────────────────────────────────────────
const DISCOVERY_FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress",
  "places.location", "places.rating", "places.userRatingCount",
  "places.photos", "places.googleMapsUri",
  "places.currentOpeningHours", "places.priceLevel",
].join(",");

async function discoverWithGoogle(
  queries:     string[],
  lat:         number,
  lng:         number,
  radiusM:     number,
  googleKey:   string,
  nameRe:      RegExp,
  opts: { originLat: number; originLng: number; transport?: string | string[]; categoryLabel: string; aiDescription: string },
): Promise<PlaceResponse[]> {
  const tasks = queries.map(q => fetchGoogleTextSearch(q, lat, lng, Math.min(radiusM, 20000), googleKey));
  const settled = await Promise.allSettled(tasks);

  const seen    = new Set<string>();
  const results: PlaceResponse[] = [];

  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const place of r.value) {
      const name = String((place.displayName as Record<string, unknown>)?.text ?? "").trim();
      if (!name || seen.has(name)) continue;
      if (CORP_RE.test(name))  continue;
      if (!nameRe.test(name))  continue;
      seen.add(name);

      const loc    = (place.location as Record<string, unknown> | undefined);
      const pLat   = typeof loc?.latitude  === "number" ? loc.latitude  as number : lat;
      const pLng   = typeof loc?.longitude === "number" ? loc.longitude as number : lng;

      const distKm      = Math.round(haversineKm(opts.originLat, opts.originLng, pLat, pLng) * 10) / 10;
      const photos      = (place.photos as Array<Record<string, unknown>>) ?? [];
      const photoUrls   = photos.filter(p => p?.name)
        .map(p => `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=800&key=${googleKey}`);

      const hours       = place.currentOpeningHours as Record<string, unknown> | undefined;
      const weekdays    = (hours?.weekdayDescriptions as string[] | undefined) ?? [];
      const openNow     = typeof hours?.openNow === "boolean" ? hours.openNow : null;
      const stationInfo = await fetchNearestStation(pLat, pLng, googleKey);

      results.push({
        id:            String(place.id ?? `google-${name}`),
        name,
        category:      opts.categoryLabel,
        description:   opts.aiDescription,
        imageUrl:      photoUrls[0] ?? "",
        rating:        typeof place.rating === "number" ? place.rating : null,
        reviewCount:   typeof place.userRatingCount === "number" ? place.userRatingCount : null,
        address:       String(place.formattedAddress ?? ""),
        distanceInfo:  buildDistanceInfo(distKm, opts.transport),
        photoUrls,
        openNow,
        openingHours:  weekdays.length > 0 ? compactWeekdays(weekdays) : null,
        priceLevel:    typeof place.priceLevel === "string" ? place.priceLevel : null,
        googleMapsUrl: String(place.googleMapsUri ?? fallbackMapsUrl(name, "")),
        stationInfo,
      });
    }
  }

  return results;
}

async function fetchGoogleTextSearch(
  textQuery: string, lat: number, lng: number, radiusM: number, googleKey: string,
): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   googleKey,
        "X-Goog-FieldMask": DISCOVERY_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery, languageCode: "ja", regionCode: "JP", pageSize: 20,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const places = (data.places ?? []) as Record<string, unknown>[];
    console.log(`[onsen] Google直接 "${textQuery}" → ${places.length}件`);
    return places;
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 3b — Google Places で Yahoo 結果に写真・評価を補完
// ────────────────────────────────────────────────────────────────────────────
const ENRICH_FIELD_MASK = [
  "places.id", "places.location", "places.rating", "places.userRatingCount",
  "places.photos", "places.googleMapsUri", "places.currentOpeningHours", "places.priceLevel",
].join(",");

async function enrichWithGoogle(
  yahooPlaces: YahooPlace[],
  opts: { originLat: number; originLng: number; transport?: string | string[]; categoryLabel: string; aiDescription: string },
): Promise<PlaceResponse[]> {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!googleKey) return yahooPlaces.map(y => yahooFallback(y, opts));

  const raw = await Promise.all(yahooPlaces.map(y => enrichOne(y, googleKey, opts)));

  const seenIds   = new Set<string>();
  const seenNames = new Set<string>();
  const withPhotos: PlaceResponse[]    = [];
  const withoutPhotos: PlaceResponse[] = [];

  for (const p of raw) {
    const idKey = p.id.startsWith("yahoo-") ? null : p.id;
    if ((idKey && seenIds.has(idKey)) || seenNames.has(p.name.trim())) continue;
    if (idKey) seenIds.add(idKey);
    seenNames.add(p.name.trim());
    (p.photoUrls.length > 0 || p.imageUrl ? withPhotos : withoutPhotos).push(p);
  }

  if (withPhotos.length > 0) {
    withPhotos.sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
    return withPhotos;
  }
  console.log(`[onsen] ⚠️ Google 全件未マッチ → Yahoo ${withoutPhotos.length}件をそのまま表示`);
  return withoutPhotos;
}

// Yahoo+Google のマージ・重複除去（Google直接 優先）
function mergePlaces(yahooEnriched: PlaceResponse[], googleDirect: PlaceResponse[]): PlaceResponse[] {
  if (googleDirect.length === 0) return yahooEnriched;

  const seenIds   = new Set<string>();
  const seenNames = new Set<string>();
  const merged: PlaceResponse[] = [];

  const addPlaces = (list: PlaceResponse[]) => {
    for (const p of list) {
      const idKey = p.id.startsWith("yahoo-") ? null : p.id;
      if ((idKey && seenIds.has(idKey)) || seenNames.has(p.name.trim())) continue;
      if (idKey) seenIds.add(idKey);
      seenNames.add(p.name.trim());
      merged.push(p);
    }
  };

  // Google 直接検索（写真あり優先）を先に追加
  const googleWithPhotos = googleDirect.filter(p => p.photoUrls.length > 0 || p.imageUrl);
  addPlaces(googleWithPhotos.sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0)));
  // Yahoo 補完済みを追加
  addPlaces(yahooEnriched);
  // Google 写真なしを最後に追加
  addPlaces(googleDirect.filter(p => p.photoUrls.length === 0 && !p.imageUrl));

  return merged;
}

// ────────────────────────────────────────────────────────────────────────────
// Google Places 補完処理（施設名の表記ゆれ対応）
// ────────────────────────────────────────────────────────────────────────────
function coreNameQueries(fullName: string): string[] {
  const queries: string[] = [];
  const addUniq = (q: string) => { if (q && q !== fullName && !queries.includes(q)) queries.push(q); };
  addUniq(fullName.replace(/^(スーパー銭湯|天然温泉|日帰り温泉|サウナ[＆&]スパ|サウナ|岩盤浴|健康ランド)[・＆& 　]*/g, "").trim());
  const tokens = fullName.split(/[\s　・・]/).filter(Boolean);
  if (tokens.length > 1) addUniq(tokens[tokens.length - 1]);
  addUniq(fullName.replace(/[・・\-－ 　]/g, ""));
  addUniq(fullName.replace(/([A-Za-z0-9])([^\x00-\x7F])/g, "$1 $2").replace(/([^\x00-\x7F])([A-Za-z0-9])/g, "$1 $2").trim());
  if (fullName.length > 6) addUniq(fullName.slice(0, Math.ceil(fullName.length * 0.6)));
  return queries;
}

async function searchGoogleEnrich(
  textQuery: string, lat: number, lng: number, radiusM: number, googleKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   googleKey,
        "X-Goog-FieldMask": ENRICH_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery, languageCode: "ja", regionCode: "JP", pageSize: 1,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.places?.[0] as Record<string, unknown>) ?? null;
  } catch { return null; }
}

async function enrichOne(
  y: YahooPlace, googleKey: string,
  opts: { originLat: number; originLng: number; transport?: string | string[]; categoryLabel: string; aiDescription: string },
): Promise<PlaceResponse> {
  try {
    const cores = coreNameQueries(y.name);
    const queriesToTry = [
      { q: `${y.name} ${y.address || opts.categoryLabel}`, r: 5000 },
      { q: y.name,                                         r: 5000 },
      ...cores.map(q => ({ q: `${q} ${y.address}`, r: 5000 })),
      ...cores.map(q => ({ q, r: 3000 })),
    ];

    let place: Record<string, unknown> | null = null;
    let usedQuery = "";
    for (const { q, r } of queriesToTry) {
      const result = await searchGoogleEnrich(q, y.lat, y.lng, r, googleKey);
      if (!result) continue;
      const loc = result.location as Record<string, unknown> | undefined;
      const pLat = typeof loc?.latitude  === "number" ? loc.latitude  as number : y.lat;
      const pLng = typeof loc?.longitude === "number" ? loc.longitude as number : y.lng;
      if (haversineKm(y.lat, y.lng, pLat, pLng) > 3) continue;
      place = result; usedQuery = q; break;
    }

    // 最寄り駅（Google 座標があればその地点、なければ Yahoo 座標で検索）
    const coordsForStation = place
      ? (() => {
          const loc = place.location as Record<string, unknown> | undefined;
          return {
            lat: typeof loc?.latitude  === "number" ? loc.latitude  as number : y.lat,
            lng: typeof loc?.longitude === "number" ? loc.longitude as number : y.lng,
          };
        })()
      : { lat: y.lat, lng: y.lng };

    const stationInfo = await fetchNearestStation(coordsForStation.lat, coordsForStation.lng, googleKey);

    if (!place) return yahooFallback(y, opts, stationInfo);
    console.log(`[onsen] Places ✅ "${y.name}" (q="${usedQuery}")`);

    const pLoc   = place.location as Record<string, unknown> | undefined;
    const pLat   = typeof pLoc?.latitude  === "number" ? pLoc.latitude  as number : y.lat;
    const pLng   = typeof pLoc?.longitude === "number" ? pLoc.longitude as number : y.lng;
    const photos = (place.photos as Array<Record<string, unknown>>) ?? [];
    const photoUrls = photos.filter(p => p?.name)
      .map(p => `https://places.googleapis.com/v1/${p.name}/media?maxWidthPx=800&key=${googleKey}`);
    const hours    = place.currentOpeningHours as Record<string, unknown> | undefined;
    const weekdays = (hours?.weekdayDescriptions as string[] | undefined) ?? [];
    const distKm   = Math.round(haversineKm(opts.originLat, opts.originLng, pLat, pLng) * 10) / 10;

    return {
      id:            String(place.id ?? `yahoo-${y.name}`),
      name:          y.name,
      category:      opts.categoryLabel,
      description:   opts.aiDescription,
      imageUrl:      photoUrls[0] ?? "",
      rating:        typeof place.rating === "number" ? place.rating : null,
      reviewCount:   typeof place.userRatingCount === "number" ? place.userRatingCount : null,
      address:       y.address,
      distanceInfo:  buildDistanceInfo(distKm, opts.transport),
      photoUrls,
      openNow:       typeof hours?.openNow === "boolean" ? hours.openNow : null,
      openingHours:  weekdays.length > 0 ? compactWeekdays(weekdays) : null,
      priceLevel:    typeof place.priceLevel === "string" ? place.priceLevel : null,
      googleMapsUrl: String(place.googleMapsUri ?? fallbackMapsUrl(y.name, y.address)),
      stationInfo,
    };
  } catch (e) {
    console.warn(`[onsen] Places "${y.name}" 例外:`, e);
    return yahooFallback(y, opts);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────────────────────

/** 複数 KeywordSearch の nameRe を OR でマージ（Google 直接検索用） */
function mergedNameRe(keywordSearches: KeywordSearch[]): RegExp {
  const sources = keywordSearches.map(ks => ks.nameRe.source);
  return new RegExp(sources.join("|"), "i");
}

function yahooFallback(
  y: YahooPlace,
  opts: { originLat: number; originLng: number; transport?: string | string[]; categoryLabel: string; aiDescription: string },
  stationInfo: string | null = null,
): PlaceResponse {
  const distKm = Math.round(haversineKm(opts.originLat, opts.originLng, y.lat, y.lng) * 10) / 10;
  return {
    id: `yahoo-${y.name}`, name: y.name, category: opts.categoryLabel,
    description: opts.aiDescription, imageUrl: "", rating: null, reviewCount: null,
    address: y.address, distanceInfo: buildDistanceInfo(distKm, opts.transport),
    photoUrls: [], openNow: null, openingHours: null, priceLevel: null,
    googleMapsUrl: fallbackMapsUrl(y.name, y.address),
    stationInfo,
  };
}

function buildDistanceInfo(distKm: number, transport?: string | string[]): string {
  const t = Array.isArray(transport) ? transport.join(",") : (transport ?? "");
  const distStr = distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm}km`;
  // ※ 「電車・バス」は "車" を含むため、電車・バスを必ず先にチェック
  const speedKmh = t.includes("徒歩") ? 4 : t.includes("自転車") ? 15
    : t.includes("電車") ? 40 : t.includes("バス") ? 25
    : t.includes("バイク") ? 25 : t.includes("車") ? 40 : 40;
  const modeLabel = t.includes("徒歩") ? "徒歩" : t.includes("自転車") ? "自転車"
    : t.includes("電車") ? "電車" : t.includes("バス") ? "バス"
    : t.includes("バイク") ? "バイク" : t.includes("車") ? "車" : "";
  const mins = Math.round((distKm / speedKmh) * 60);
  const timeStr = mins < 60 ? `約${mins}分` : `約${(mins / 60).toFixed(1)}時間`;
  return modeLabel ? `${modeLabel}で${timeStr} / ${distStr}` : distStr;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidCoord(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && !(lat === 0 && lng === 0);
}

async function geocodeArea(area: string): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  for (const resultType of [
    "street_address|premise|sublocality_level_2|sublocality_level_3|sublocality_level_4",
    "sublocality_level_1|ward|sublocality", "locality",
  ]) {
    try {
      const p = new URLSearchParams({ address: area, result_type: resultType, language: "ja", region: "JP", key });
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${p}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const loc = (await r.json()).results?.[0]?.geometry?.location;
      if (typeof loc?.lat === "number") { console.log(`[onsen] geocode "${area}" → (${loc.lat},${loc.lng})`); return loc; }
    } catch { /* 次を試す */ }
  }
  try {
    const p = new URLSearchParams({ address: area, language: "ja", region: "JP", key });
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${p}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const loc = (await r.json()).results?.[0]?.geometry?.location;
    if (typeof loc?.lat === "number") return loc;
  } catch { /* 無視 */ }
  return null;
}

function fallbackMapsUrl(name: string, address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`;
}

/**
 * 曜日ごとの営業時間を圧縮表示する
 * 例: ["月曜日: 9:00〜22:00", ... ×7] → "月〜日: 9:00〜22:00"
 *     ["月曜日: 9:00〜22:00"×5, "土曜日: 10:00〜23:00", "日曜日: 10:00〜23:00"]
 *      → "月〜金: 9:00〜22:00\n土・日: 10:00〜23:00"
 */
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

  // 連続かつ同じ営業時間でグループ化
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
    const dayStr = g.start === g.end
      ? s
      : g.end - g.start === 1
        ? `${s}・${e}`
        : `${s}〜${e}`;
    return `${dayStr}: ${g.hours}`;
  }).join("\n");
}

/** 最寄り駅（電車・地下鉄）を Google Places Nearby Search で検索し「○○駅から徒歩X分」を返す */
async function fetchNearestStation(lat: number, lng: number, googleKey: string): Promise<string | null> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   googleKey,
        "X-Goog-FieldMask": "places.displayName,places.location",
      },
      body: JSON.stringify({
        // transit_station で広く検索し、名前に「駅」が含まれるもの（電車・地下鉄）だけ使う
        includedTypes:    ["transit_station"],
        maxResultCount:   5,
        rankPreference:   "DISTANCE",
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 2000 },
        },
        languageCode: "ja",
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const places = (data.places ?? []) as Record<string, unknown>[];

    // バス停（名前に「駅」が含まれない）を除外し、最も近い電車駅を使う
    for (const station of places) {
      const name = ((station.displayName as Record<string, unknown>)?.text as string) ?? "";
      if (!name.includes("駅")) continue; // バス停スキップ

      const loc   = station.location as Record<string, unknown> | undefined;
      const sLat  = typeof loc?.latitude  === "number" ? loc.latitude  as number : lat;
      const sLng  = typeof loc?.longitude === "number" ? loc.longitude as number : lng;
      const distKm   = haversineKm(lat, lng, sLat, sLng);
      const walkMins = Math.max(1, Math.round((distKm / 4) * 60));

      if (walkMins > 30) return null; // 30分超は非表示
      return `${name}から徒歩${walkMins}分`;
    }
    return null;
  } catch {
    return null;
  }
}
