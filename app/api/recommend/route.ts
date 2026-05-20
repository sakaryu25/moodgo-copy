export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabase } from "@/lib/supabase";
import { MOOD_TAG_MAP } from "@/lib/predefined-tags";

type FeedbackItem = {
  answers: Partial<Answers>;
  topRecommendations: string[];
  rating: number | null;
  visitedPlace: string;
  createdAt: string;
};

type Answers = {
  mood?: string;
  area?: string;
  age?: string;
  gender?: string;
  companion?: string;
  transport?: string | string[];   // 複数選択対応
  budget?: number;
  budgetMin?: number;
  time?: string;
  atmosphere?: string;
  priority?: string;
  freeWord?: string;
  originLat?: number;
  originLng?: number;
  dynamicQ1?: { question: string; answer: string } | string;
  dynamicQ2?: { question: string; answer: string } | string;
  dynamicQ3?: { question: string; answer: string } | string;
  dynamicQ4?: { question: string; answer: string } | string;
  /** 全動的質問回答の配列（dynamicQ1-4の拡張版）。存在する場合はこちらを優先使用 */
  dynamicQs?: { question: string; answer: string }[];
};

/** 全動的質問回答を統一して取得するヘルパー（dynamicQs優先、なければdynamicQ1-4にフォールバック） */
function getDynamicQs(answers: Answers): { question: string; answer: string }[] {
  if (answers.dynamicQs && answers.dynamicQs.length > 0) return answers.dynamicQs;
  return [answers.dynamicQ1, answers.dynamicQ2, answers.dynamicQ3, answers.dynamicQ4].filter(
    (d): d is { question: string; answer: string } =>
      typeof d === "object" && d !== null && "question" in d && "answer" in d
  );
}

type Bucket = "food" | "spot" | "activity" | "scenic" | "relax" | "mixed" | "indoor";

type SearchPlan = {
  query: string;       // キーワード検索クエリ（AIが生成）
  weight: number;
  bucket: Bucket;
  placeName?: string;  // AI が具体的なスポット名を指定した場合（Google Places でピンポイント検索）
  reasonData?: ReasonData; // AI が生成した理由（Google 検索結果の先頭に紐づける）
};

type ReasonData = {
  reason: string;
  features: string[];
  targetUser?: string;
};

type AISearchResult = {
  plans: SearchPlan[];
  aiReasons: Map<string, ReasonData>; // place_name（正規化） → 理由データ
};

type SearchPlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  primaryType?: string;
  types?: string[];
  editorialSummary?: { text?: string };
  goodForChildren?: boolean;
  allowsDogs?: boolean;
  restroom?: boolean;
  outdoorSeating?: boolean;
  servesCoffee?: boolean;
  liveMusic?: boolean;
  parkingOptions?: {
    freeParkingLot?: boolean;
    paidParkingLot?: boolean;
    freeStreetParking?: boolean;
  };
  accessibilityOptions?: { wheelchairAccessibleEntrance?: boolean };
  currentOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  regularOpeningHours?: {
    weekdayDescriptions?: string[];
  };
  photos?: Array<{
    name?: string;
  }>;
};

type RoutingSummary = {
  legs?: Array<{
    distanceMeters?: number;
    duration?: string;
  }>;
};

type TextSearchResponse = {
  places?: SearchPlace[];
  routingSummaries?: RoutingSummary[];
};

type WeatherContext = {
  weatherCode?: number;
  isDay?: boolean;
};

type RouteByMode = {
  icon: string;
  durationText: string;
  distanceText: string;
};

type ScoredItem = {
  title: string;
  vibe: string;
  budget: string;
  time: string;
  address: string;
  mapUrl: string;
  rating: number | null;
  userRatingCount: number | null;
  photoUrl: string;
  photoUrls: string[];
  openingHoursText: string;
  distanceText: string;
  durationText: string;
  openNow?: boolean;
  priceLevel?: string;
  stationText: string;
  location?: { latitude: number; longitude: number };
  bucket: Bucket;
  score: number;
  editorialSummary: string;
  amenityTags: string[];
  hasUserPhotos: boolean;
  userPhotoCount: number;
  targetUser?: string;
  aiReason?: ReasonData; // AI が1回目の呼び出しで生成した理由（プラン紐づけ）
  isPinned?: boolean;    // AI がピンポイント指定した場所の先頭結果（必ず表示）
};

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

type ApprovedSuggestion = {
  spot_name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  google_place_name: string | null;
  google_maps_uri: string | null;
  auto_tags: string[] | null;
  station_info: string | null;
  image_urls: string[] | null;
  source: string | null;
  is_chain: boolean | null;
  chain_search_query: string | null;
  available_from: string | null;
  available_until: string | null;
};

async function fetchApprovedSuggestions(): Promise<ApprovedSuggestion[]> {
  if (!supabase) return [];
  try {
    let { data, error } = await supabase
      .from("suggestions")
      .select("spot_name, description, address, lat, lng, google_place_name, google_maps_uri, auto_tags, station_info, image_urls, source, is_chain, chain_search_query, available_from, available_until")
      .eq("status", "approved");

    // available_from / available_until カラムが未作成の場合は除いて再取得
    if (error?.code === "42703" || error?.code === "PGRST204") {
      const fallback = await supabase
        .from("suggestions")
        .select("spot_name, description, address, lat, lng, google_place_name, google_maps_uri, auto_tags, station_info, image_urls, source, is_chain, chain_search_query")
        .eq("status", "approved");
      data = fallback.data as unknown as typeof data;
      error = fallback.error;
    }

    if (error || !data) return [];

    // 期間限定スポットのフィルタリング：今日の日付が公開期間外のものを除外
    const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    return (data as ApprovedSuggestion[]).filter((s) => {
      if (s.available_from && todayStr < s.available_from) return false;
      if (s.available_until && todayStr > s.available_until) return false;
      return true;
    });
  } catch {
    return [];
  }
}

// ─── 食事遠出: 近隣都市部リスト ─────────────────────────────────────────────
// tier: 3=大都市, 2=主要駅, 1=地方中心駅
const URBAN_FOOD_CENTERS: { name: string; lat: number; lng: number; tier: number }[] = [
  // ── 全国大都市 (tier3) ──
  { name: "東京駅",      lat: 35.6812, lng: 139.7671, tier: 3 },
  { name: "新宿",        lat: 35.6938, lng: 139.7034, tier: 3 },
  { name: "渋谷",        lat: 35.6580, lng: 139.7016, tier: 3 },
  { name: "大阪梅田",    lat: 34.7024, lng: 135.4959, tier: 3 },
  { name: "名古屋",      lat: 35.1706, lng: 136.8814, tier: 3 },
  { name: "福岡天神",    lat: 33.5897, lng: 130.3985, tier: 3 },
  { name: "札幌",        lat: 43.0618, lng: 141.3545, tier: 3 },
  { name: "仙台",        lat: 38.2682, lng: 140.8694, tier: 3 },
  { name: "広島",        lat: 34.3963, lng: 132.4593, tier: 3 },
  // ── 関東主要 (tier2) ──
  { name: "横浜",        lat: 35.4437, lng: 139.6380, tier: 2 },
  { name: "みなとみらい",lat: 35.4579, lng: 139.6330, tier: 2 },
  { name: "池袋",        lat: 35.7295, lng: 139.7109, tier: 3 }, // 主要ターミナル
  { name: "上野",        lat: 35.7141, lng: 139.7774, tier: 2 },
  { name: "品川",        lat: 35.6284, lng: 139.7387, tier: 2 }, // 乗換ターミナル（食の目的地としては渋谷優先）
  { name: "川崎",        lat: 35.5308, lng: 139.7030, tier: 2 },
  { name: "大宮",        lat: 35.9063, lng: 139.6234, tier: 3 }, // 関東北部ターミナル
  { name: "千葉",        lat: 35.6074, lng: 140.1065, tier: 2 },
  { name: "立川",        lat: 35.6978, lng: 139.4130, tier: 2 },
  { name: "町田",        lat: 35.5448, lng: 139.4457, tier: 2 },
  { name: "横須賀",      lat: 35.2810, lng: 139.6704, tier: 1 },
  { name: "鎌倉",        lat: 35.3192, lng: 139.5467, tier: 1 },
  { name: "藤沢",        lat: 35.3395, lng: 139.4924, tier: 1 },
  { name: "武蔵小杉",    lat: 35.5748, lng: 139.6576, tier: 2 },
  { name: "溝の口",      lat: 35.5828, lng: 139.6109, tier: 1 },
  { name: "二俣川",      lat: 35.4736, lng: 139.5462, tier: 1 },
  { name: "戸塚",        lat: 35.3991, lng: 139.5354, tier: 1 },
  { name: "大船",        lat: 35.3446, lng: 139.5326, tier: 1 },
  // ── 関西主要 (tier2) ──
  { name: "神戸三宮",    lat: 34.6937, lng: 135.1956, tier: 2 },
  { name: "京都",        lat: 35.0116, lng: 135.7681, tier: 2 },
  { name: "難波",        lat: 34.6647, lng: 135.5022, tier: 2 },
  { name: "天王寺",      lat: 34.6473, lng: 135.5161, tier: 2 },
  { name: "堺",          lat: 34.5733, lng: 135.4830, tier: 2 },
  // ── 九州・東北・中国 (tier2) ──
  { name: "北九州",      lat: 33.8834, lng: 130.8751, tier: 2 },
  { name: "熊本",        lat: 32.8032, lng: 130.7079, tier: 2 },
  { name: "松山",        lat: 33.8392, lng: 132.7657, tier: 2 },
];

/**
 * ユーザー位置から距離ティアに合った最寄り都市部を返す
 * tier="train" → 電車30分圏（8〜32km）例: 富岡西→横浜(11km)
 * tier="far"   → ガッツリ遠く・県外レベル（32〜200km）例: 富岡西→渋谷(35km)
 */
function findUrbanCenterForFood(
  lat: number, lng: number,
  tier: "train" | "far",
): { name: string; lat: number; lng: number } | null {
  const [minKm, maxKm] = tier === "train" ? [8, 32] : [32, 200];
  const candidates = URBAN_FOOD_CENTERS
    .map(c => ({ ...c, distKm: haversineMeters(lat, lng, c.lat, c.lng) / 1000 }))
    .filter(c => c.distKm >= minKm && c.distKm <= maxKm)
    .sort((a, b) => b.tier - a.tier || a.distKm - b.distKm); // tier高 → 近い順
  return candidates[0] ?? null;
}

// Haversine距離(m)
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 最寄り駅を検索して「〇〇駅から徒歩約N分」を返す
// Nearby SearchはRankPreference:DISTANCEを使い、距離順で取得する
async function findNearestStation(lat: number, lng: number, apiKey: string): Promise<string> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.location",
      },
      body: JSON.stringify({
        includedTypes: ["subway_station", "train_station", "light_rail_station"],
        maxResultCount: 10,
        rankPreference: "DISTANCE",
        languageCode: "ja",
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 1500 },
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) return "";
    const data = await res.json();
    const places: Array<{ displayName?: { text?: string }; location?: { latitude?: number; longitude?: number } }> = data.places ?? [];
    if (places.length === 0) return "";

    // 全駅の距離を計算して最も近いものを選ぶ
    let nearest: { name: string; dist: number } | null = null;
    for (const station of places) {
      const sLat = station.location?.latitude;
      const sLng = station.location?.longitude;
      const name = station.displayName?.text ?? "";
      if (!sLat || !sLng || !name) continue;
      const dist = haversineMeters(lat, lng, sLat, sLng);
      if (!nearest || dist < nearest.dist) {
        nearest = { name, dist };
      }
    }
    if (!nearest) return "";
    const minutes = Math.ceil(nearest.dist / 80);
    return `${nearest.name}から徒歩約${minutes}分`;
  } catch {
    return "";
  }
}

async function fetchGlobalStats(answers: Answers): Promise<{
  context: string;
  engagedPlaces: Set<string>;
  goodVisitedPlaces: Set<string>;
  badVisitedPlaces: Set<string>;
}> {
  const empty = { context: "", engagedPlaces: new Set<string>(), goodVisitedPlaces: new Set<string>(), badVisitedPlaces: new Set<string>() };
  try {
    const params = new URLSearchParams();
    if (answers.mood) params.set("mood", answers.mood);
    if (answers.age) params.set("age", answers.age);
    if (answers.gender) params.set("gender", answers.gender);
    if (answers.companion) params.set("companion", answers.companion);
    if (answers.atmosphere) params.set("atmosphere", answers.atmosphere);

    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/feedback?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return empty;
    const data = await res.json();
    if (!data.ok) return empty;

    const lines: string[] = [];
    const engagedPlaces = new Set<string>();
    const goodVisitedPlaces = new Set<string>();
    const badVisitedPlaces = new Set<string>();

    const attrs = [answers.mood, answers.age, answers.gender, answers.companion, answers.atmosphere]
      .filter(Boolean).join("・");

    // ① 類似ユーザーが高評価で実際に訪れた場所（上位5件のみ）
    if (data.similarGoodVisited?.length > 0) {
      const goodPlaces = (data.similarGoodVisited as { name: string; avgRating: number | null; goodCount: number }[])
        .slice(0, 5)
        .map((p) => { goodVisitedPlaces.add(p.name); return p.name; });
      lines.push(`【高評価スポット】${goodPlaces.join("、")} → 類似スポットを優先`);
    }

    // ② ハート・マップクリックした場所（上位5件のみ）
    if (data.similarEngagedPlaces?.length > 0) {
      const places = (data.similarEngagedPlaces as { name: string; score: number }[])
        .slice(0, 5)
        .map((p) => { engagedPlaces.add(p.name); return p.name; });
      lines.push(`【人気スポット】${places.join("、")}`);
    }

    // ③ この気分では不適切な場所（上位5件のみ）
    if (data.similarBadVisited?.length > 0) {
      const badPlaces = (data.similarBadVisited as string[]).slice(0, 5);
      badPlaces.forEach((p) => badVisitedPlaces.add(p));
      lines.push(`【除外】${badPlaces.join("、")}`);
    }

    const context = lines.length > 0
      ? "\n\n【学習データ】\n" + lines.join("\n")
      : "";

    return { context, engagedPlaces, goodVisitedPlaces, badVisitedPlaces };
  } catch {
    return empty;
  }
}

// ドライブしたい: 道路種別（一般道 / 高速）を dynamicQs から抽出
function getDriveRoadType(answers: Answers): "highway" | "local" | null {
  for (const dq of getDynamicQs(answers)) {
    const ans = dq.answer;
    if (ans.includes("一般道")) return "local";
    if (ans.includes("高速") || ans.includes("Highways")) return "highway";
  }
  return null;
}

/**
 * 「どのくらいの距離感がいい？」の回答を dynamicQ から抽出し、
 * 検索半径・スコアペナルティに使う倍率と最大移動分数を返す。
 *
 * multiplier: estimateRadiusKm の結果に掛ける係数
 * maxTravelMinOverride: scorePlace のペナルティ上限(分)をこの値で上書き（null=上書きなし）
 */
function getDistancePreference(answers: Answers): {
  multiplier: number;
  maxTravelMinOverride: number | null;
  label: string;
} {
  for (const dq of getDynamicQs(answers)) {
    const ans = dq.answer;
    // 旧オプション
    if (ans.includes("近場がいい") || ans.includes("Nearby")) {
      return { multiplier: 0.25, maxTravelMinOverride: 15, label: "近場" };
    }
    if (ans.includes("少し遠くてもOK") || ans.includes("A bit far")) {
      return { multiplier: 0.55, maxTravelMinOverride: 40, label: "少し遠め" };
    }
    if (ans.includes("遠くてOK") || ans.includes("Far is OK")) {
      return { multiplier: 1.0, maxTravelMinOverride: null, label: "遠くてOK" };
    }
    if (ans.includes("美味しければ遠くても") || ans.includes("Worth the trip")) {
      return { multiplier: 1.5, maxTravelMinOverride: null, label: "遠くても可" };
    }
    // 新しい food_distance オプション（お腹すいた専用）
    if (ans.includes("近場") || ans.includes("歩きで") || ans.includes("walking distance")) {
      return { multiplier: 0.2, maxTravelMinOverride: 15, label: "近場（徒歩）" };
    }
    if (ans.includes("多少") || ans.includes("駅１") || ans.includes("駅1") || ans.includes("1-2 stations")) {
      return { multiplier: 0.45, maxTravelMinOverride: 30, label: "多少（近隣駅）" };
    }
    if (ans.includes("ほどほど遠く") || ans.includes("電車使う") || ans.includes("電車30分") || ans.includes("電車で") || ans.includes("~30 min ride") || ans.includes("Moderate")) {
      return { multiplier: 0.85, maxTravelMinOverride: 60, label: "ほどほど遠く（電車30分）" };
    }
    if (ans.includes("ガッツリ遠くてもOK") || ans.includes("Far is fine") || ans.includes("next prefecture")) {
      return { multiplier: 2.0, maxTravelMinOverride: null, label: "遠くてもOK（県外も）" };
    }
  }
  // 距離感の回答なし → デフォルト
  return { multiplier: 1.0, maxTravelMinOverride: null, label: "" };
}

async function buildSearchPlansWithAI(
  answers: Answers,
  pastFeedback: FeedbackItem[] = [],
  globalStatsContext = "",
  weather: WeatherContext = {},
  timeContext?: ReturnType<typeof getTimeContext>,
  userPreferenceHints: string[] = [],
  refinementText = ""
): Promise<AISearchResult | null> {
  // OpenAI無効化（コスト削減のためルールベースのみ使用）
  return null;
  if (!process.env.OPENAI_API_KEY) return null; // eslint-disable-line no-unreachable

  // Format dynamic question answer (supports both object and legacy string forms)
  const formatDynamic = (d: { question: string; answer: string } | string | undefined): string | null => {
    if (!d) return null;
    if (typeof d === "string") return d;
    if (d.answer) return `${d.question} → ${d.answer}`;
    return null;
  };

  const companionMap: Record<string, string> = {
    一人: "一人でゆっくり楽しめる",
    友達: "友達複数人で盛り上がれる",
    恋人: "カップルのデートに最適な",
    家族: "家族連れで安心して行ける",
    大人数グループ: "大人数グループで楽しめる",
    先輩: "目上の人と一緒に行ける落ち着いた",
  };

  const budgetLabel = (() => {
    const b  = answers.budget;
    const bm = answers.budgetMin;
    if (b === undefined) return "予算未定・制限なし（価格帯を気にせず最適な場所を探す）";
    if (b === 0) return "無料・無予算";
    if (bm != null && bm > 0) return `${bm.toLocaleString("ja-JP")}円〜${b.toLocaleString("ja-JP")}円（この範囲の価格帯のみ提案）`;
    if (b <= 1000)  return `${b.toLocaleString("ja-JP")}円以内（低予算）`;
    if (b <= 5000)  return `${b.toLocaleString("ja-JP")}円以内（手頃）`;
    if (b <= 15000) return `${b.toLocaleString("ja-JP")}円以内（中価格帯）`;
    return `${b.toLocaleString("ja-JP")}円以内（高め）`;
  })();


  // ドライブしたい の場合、drive_distance + road_type から走行時間→到達距離を算出してAIに渡す
  // 一般道 ~40km/h、高速 ~90km/h を基準に算出
  const getDriveRadiusContext = (): string | null => {
    if (answers.mood !== "ドライブしたい") return null;
    const allDqs = getDynamicQs(answers);
    const driveAns = allDqs.find(d => d.question.includes("遠出") || d.answer.match(/30分|1時間|2時間|3時間/))?.answer ?? (typeof answers.dynamicQ1 === "object" ? (answers.dynamicQ1?.answer ?? "") : (answers.dynamicQ1 ?? ""));
    const roadType = getDriveRoadType(answers);
    const isLocal   = roadType === "local";
    const isHighway = roadType === "highway";

    type DriveEntry = {
      descLocal: string;
      descHighway: string;
      descDefault: string;
    };
    const map: Record<string, DriveEntry> = {
      "30分（サクッと）": {
        descLocal:   "現在地から一般道で約30分（約20km以内）の近場ドライブ先",
        descHighway: "現在地から高速利用で約30分（約45km圏内）のドライブ先",
        descDefault: "現在地から車で30分圏内（約30km以内）の近場ドライブ先",
      },
      "1時間（ほどよく）": {
        descLocal:   "現在地から一般道で約1時間（約40km）離れた目的地",
        descHighway: "現在地から高速利用で約1時間（約90km）離れた目的地",
        descDefault: "現在地から車で1時間ほど（約60km）離れた目的地",
      },
      "2時間（ガッツリ）": {
        descLocal:   "現在地から一般道で約2時間（約80km）離れた遠出先",
        descHighway: "現在地から高速利用で約2時間（約180km）離れた遠出先",
        descDefault: "現在地から車で2時間ほど（約120km）離れた遠出先",
      },
      "3時間〜（旅）": {
        descLocal:   "現在地から一般道で3時間以上（約120km超）の長距離ドライブ先",
        descHighway: "現在地から高速利用で3時間以上（約270km超）の旅行レベルの目的地",
        descDefault: "現在地から車で3時間以上（200km超）の旅行レベルの目的地",
      },
    };
    // 「都会の夜景」を選択している場合は近場の都市ランドマークもOK
    const isUrbanNight = getDynamicQs(answers).some((dq) => dq.answer.includes("都会の夜景") || dq.answer.includes("City night"));

    if (isUrbanNight) {
      return `【都会の夜景ドライブ・最重要】現在地（${answers.area ?? "出発地"}）の都市部・市街地にある夜景スポット・ランドマーク・展望台・タワーを検索すること。現在地から車で行ける都市ランドマーク（タワー・橋・スカイライン・ビル夜景など）を積極的に提案。近場・市内のスポットも必ず含めること。`;
    }

    const matched = Object.entries(map).find(([key]) => driveAns.includes(key.split("（")[0]));
    if (!matched) return null;
    const entry = matched[1];
    const roadLabel = isLocal ? "【一般道メイン】" : isHighway ? "【高速利用あり】" : "";
    const desc = isLocal ? entry.descLocal : isHighway ? entry.descHighway : entry.descDefault;

    // 「走りたい道は？」の回答から地理タイプを抽出してヒントに追加
    const allDqAnswers = getDynamicQs(answers).map(dq => dq.answer).join(" ");
    let roadGeoHint = "";
    if (allDqAnswers.includes("海沿い") || allDqAnswers.includes("Coastal")) {
      roadGeoHint = "\n【走りたい道】海沿い → 海岸線・湾岸・海が見えるルート沿いの目的地を優先すること（例：湘南・三浦・伊豆・九十九里等）。";
    } else if (allDqAnswers.includes("山・峠") || allDqAnswers.includes("Mountain")) {
      roadGeoHint = "\n【走りたい道】山・峠道 → 峠道・山岳ルート沿いの目的地を優先すること（例：箱根・奥多摩・碓氷峠・美ヶ原等）。";
    } else if (allDqAnswers.includes("広い国道") || allDqAnswers.includes("Open highway")) {
      roadGeoHint = "\n【走りたい道】広い国道 → 国道・バイパス沿いの道の駅・ドライブイン・大型施設を優先すること。";
    }

    // フリーワードに地名・エリア指定がある場合はそちらを優先させる注記を追加
    const fw = answers.freeWord ?? "";
    const hasFreeWordLocation = fw.length > 0 && /都内|都心|東京|大阪|京都|名古屋|横浜|神戸|福岡|仙台|札幌|[都道府県市区町村]/.test(fw);
    const freeWordOverride = hasFreeWordLocation
      ? `\n⚠️【重要】【特にこだわりたい点・キーワード】に地名・エリアが指定されているため、到達圏よりも「${fw}」の地名・エリアを最優先でクエリに反映すること。指定エリア内で${roadGeoHint ? "「走りたい道」の地理タイプを活かして" : ""}ドライブで楽しめるスポットを提案する。`
      : "\n現在地周辺の近場は不可。";

    return `【ドライブ到達圏】${roadLabel}${desc}。現在地（${answers.area ?? "出発地"}）からその距離にある市町村・観光地・スポットを具体的に検索すること。${freeWordOverride}${roadGeoHint}`;
  };
  const driveRadiusContext = getDriveRadiusContext();

  // 遠くに行きたい: travel_time から移動可能時間→距離をAIに渡す
  const getTravelTimeContext = (): string | null => {
    if (answers.mood !== "遠くに行きたい") return null;
    // dynamicQs から travel_time 回答を探す（selectedTime からも参照可）
    const allDqs = getDynamicQs(answers);
    const travelQ = allDqs.find(d => d.question.includes("時間") && (d.answer.includes("午前中") || d.answer.includes("夕方") || d.answer.includes("日跨ぐ") || d.answer.includes("日越して")));
    const ans = travelQ?.answer ?? answers.time ?? "";
    const map: Record<string, string> = {
      "午前中のみ": "午前中だけ（2〜3時間程度）しか時間がないため、現在地から車・電車で1時間以内の近め〜中距離の場所を提案してください",
      "夕方まで": "夕方まで（4〜6時間）使えるため、現在地から1〜2時間圏内の日帰りスポットを提案してください",
      "日跨ぐ前まで": "夜まで（6〜10時間）使えるため、現在地から2〜3時間圏内の遠出先を提案してください",
      "日越してもOK": "日をまたいでもOKなので、現在地から3時間以上の遠方・旅行レベルの目的地を積極的に提案してください",
    };
    const matched = Object.entries(map).find(([key]) => ans.includes(key));
    if (!matched) return null;
    return `【移動時間・到達圏】${matched[1]}`;
  };
  const travelTimeContext = getTravelTimeContext();

  // ドライブ・遠出以外: 交通手段×時間→到達圏コンテキスト
  const nonDriveTravelRadiusContext = getNonDriveTravelRadiusContext(answers.mood, answers.transport, answers.time);

  const seasonCtx = getSeasonContext();

  // ユーザープロファイル文字列を生成（強化版システムプロンプトに使用）
  const userProfile = buildUserProfile(answers);

  // 回答→キーワード変換と意図サマリーを事前生成
  const answerKeywordContext = buildAnswerKeywordContext(answers);
  const intentSummary = buildUserIntentSummary(answers);

  const userContext = [
    answers.mood && `【気分・目的】${answers.mood}`,
    answers.area && `【エリア】${answers.area}`,
    driveRadiusContext,
    travelTimeContext,
    nonDriveTravelRadiusContext,
    answers.age && `【年代】${answers.age}`,
    answers.gender && `【性別】${answers.gender}`,
    answers.companion && `【同行者】${companionMap[answers.companion] ?? answers.companion}`,
    (() => {
      const transports = getTransports(answers.transport);
      if (transports.length === 0) return null;
      const label = transports.join("・");
      const constraints: string[] = [];
      if (transports.includes("電車") && !transports.includes("車")) {
        constraints.push("車でしか行けない場所（駅から徒歩30分超・駐車場必須の山奥・郊外ドライブスポット等）は除外");
        constraints.push("電車・公共交通機関でアクセスできる場所を優先");
      }
      if (transports.includes("徒歩")) {
        constraints.push("徒歩圏内のスポットのみ。電車・車が必要な場所は除外");
      }
      if (transports.includes("車") && !transports.includes("電車")) {
        constraints.push("車でのアクセスを想定。駐車場ありの場所を優先");
      }
      if (transports.includes("自転車・バイク")) {
        constraints.push("自転車・バイクで行ける距離のスポットを優先");
      }
      return `【交通手段】${label}${constraints.length > 0 ? `\n  → ${constraints.join("・")}` : ""}`;
    })(),
    `【予算】${budgetLabel}`,
    (() => {
      if (!answers.time) return null;
      // nonDriveTravelRadiusContextが距離感を詳しく説明するため、ここでは時間のみ記載
      if (nonDriveTravelRadiusContext) return `【使える時間】${answers.time}`;
      const timeCtx = getTimeContext2(answers.time);
      return `【使える時間】${answers.time}${timeCtx.label ? `\n  → ${timeCtx.label}` : ""}`;
    })(),
    answers.atmosphere && `【求める雰囲気】${answers.atmosphere}`,
    answers.priority && `【最優先したいこと】${answers.priority}`,
    ...getDynamicQs(answers).map((dq, i) => `【気分の詳細${["①","②","③","④","⑤","⑥","⑦","⑧"][i] ?? `(${i+1})`}】${dq.question}→${dq.answer}`),
    answers.freeWord && `【特にこだわりたい点・キーワード】${answers.freeWord}`,
    refinementText && `【前回の結果への追加要望】${refinementText}`,
    `【現在の季節】${seasonCtx.season}（${seasonCtx.keywords}）`,
    userPreferenceHints.length > 0 && `【このユーザーの傾向（過去行動から自動分析）】${userPreferenceHints.join("・")}`,
    // ★ 回答→キーワード変換と意図サマリーを末尾に追加（最も目立つ位置）
    intentSummary,
    answerKeywordContext,
  ]
    .filter(Boolean)
    .join("\n");

  // 過去フィードバックのサマリーを作成（動的質問・雰囲気・同行者も含む詳細版）
  const formatDynF = (d: { question: string; answer: string } | string | undefined): string | null => {
    if (!d) return null;
    if (typeof d === "string") return d || null;
    return d.answer ? `${d.question}→${d.answer}` : null;
  };

  const feedbackContext = pastFeedback.length > 0
    ? "\n\n【このユーザー自身の過去の検索履歴と評価（必ず参考にしてください）】\n" +
      pastFeedback.slice(0, 5).map((f) => {
        const dateStr = f.createdAt ? new Date(f.createdAt).toLocaleDateString("ja-JP") : "";
        const parts: string[] = [];
        if (f.answers.mood)       parts.push(`気分:${f.answers.mood}`);
        if (f.answers.area)       parts.push(`エリア:${f.answers.area}`);
        if (f.answers.companion)  parts.push(`同行者:${f.answers.companion}`);
        if (f.answers.atmosphere) parts.push(`雰囲気:${f.answers.atmosphere}`);
        if (f.answers.priority)   parts.push(`優先:${f.answers.priority}`);
        const dynParts = getDynamicQs(f.answers).map(dq => `${dq.question}→${dq.answer}`);
        if (dynParts.length > 0)  parts.push(`詳細:${dynParts.join(" / ")}`);

        const ratingStr = f.rating !== null ? `評価${f.rating}/5` : "評価なし";
        const visitedStr = f.visitedPlace ? ` → 実際に訪れた: 【${f.visitedPlace}】` : "";
        const topRecs = f.topRecommendations.length > 0
          ? ` 提案された場所:[${f.topRecommendations.join("、")}]`
          : "";

        return `- [${dateStr}] ${parts.join(" / ")}${topRecs} [${ratingStr}]${visitedStr}`;
      }).join("\n") +
      "\n→ 高評価の回で提案された場所・実際に行った場所のカテゴリ・雰囲気・エリアを今回の提案にも活かしてください。低評価の回で提案された場所と同カテゴリは避けてください。"
    : "";

  const systemPrompt = `あなたは日本のお出かけスポット提案の専門家（MoodGoレコメンドエンジン）です。
ユーザーの条件を読み取り、**実在する具体的なスポット名**を優先的に提案してください。

## あなたの役割
ユーザーの気分・エリア・同行者・予算などを分析し、ぴったりな場所を直接提案します。
提案した場所は後でGoogle Mapsで詳細情報（写真・評価・距離）を取得します。

【ユーザープロファイル】
${userProfile}

## 出力形式（JSONのみ、他テキスト不要）
{"queries": [
  {
    "query": "Google Maps で検索するクエリ（例：横浜山下公園）",
    "weight": 整数1〜15,
    "bucket": "food"|"spot"|"activity"|"scenic"|"relax"|"indoor"|"mixed",
    "place_name": "実在するスポットの正式名称（わかる場合は必ず記入）",
    "reason": "このユーザーに合っている理由（25〜35文字、具体的に。ユーザー属性に言及する）",
    "features": ["施設の特徴タグ1（12文字以内）", "タグ2", "タグ3"],
    "target_user": "このスポットが特に合う人（20文字以内、例：友達と自然を楽しみたい10代に）"
  }
]}

## 提案件数のルール
**必ず12件提案すること。**
ユーザーの気分・目的に完全に合致する場所のみを提案する。
気分と無関係なジャンル（例：絶景を求めているのに飲食店・ショッピングを混ぜる）は絶対に含めない。
エリアや切り口を変えて12件すべてをユーザーの意図に沿った場所で埋めること。

reasonのルール:
- ユーザーの属性・気分に言及する（例: "友達と自然を感じながら散策できる"、"一人でのんびり過ごせる"）
- 抽象的な表現は避け、具体的な魅力を伝える
- 絵文字は使わない

featuresのルール:
- 場所の特徴を簡潔なタグで（最大3個、各12文字以内）
- 駐車場・絶景・穴場・wifi・子連れOKなど実用的な情報を優先
- 情報が不明な場合は空配列 []

## 提案の必須ルール

### 基本方針
- **place_name には実在するスポット名を積極的に記入する**（横浜山下公園・渋谷スクランブルスクエア・コメダ珈琲 渋谷店 など）
- queryはplace_nameがある場合「スポット名 エリア名」、ない場合「エリア名 種別キーワード」
- 8件の提案は多様性を持たせる（同じジャンルに偏らない）
- 全提案がユーザーのエリア・移動手段・時間に合った場所であること

### エリア・距離の制約
- 指定エリアから現実的に行ける範囲のみ（交通手段と時間を考慮）
- 「電車のみ」→ 駅徒歩圏内のスポットのみ（駐車場必須の場所は除外）
- 「車のみ」→ 駐車場あり優先
- 「徒歩」→ 徒歩15分以内の極近場のみ

### 予算・同行者・気分の反映
- 予算を超えるスポットは除外
- 同行者に合わせる（一人OK・カップル向け・子連れOK・グループ向けなど）
- 気分の詳細回答（dynamicQ1〜4）を最優先で反映する

### 気分別の専門ルール
- **お腹すいた** → 全件bucketを"food"に。飲食店・カフェのみ提案（公園・観光地は除外）
- **ドライブしたい** → ドライブ先の観光地・展望台・道の駅（現在地周辺の日常スポットは除外）
- **自然感じたい** → 公園・自然公園・展望台・花畑（飲食・ショッピングは除外）
- **集中したい** → カフェ・図書館・コワーキング（wifi・電源に言及）
- **体を動かしたい** → スポーツ施設・公園・山・プール（種類を多様に）

### 過去評価の考慮（好き嫌い学習）

## クエリ生成の必須ルール
- **エリア名は全クエリに必ず含める**（不明な場合は「現在地周辺」）
- **気分だけでなく、同行者・雰囲気・優先事項・時間も各クエリに組み込む**
  - 同行者「恋人」→ "デート" "カップル" "ロマンティック" をクエリに含める
  - 同行者「家族」→ "家族連れ" "子連れOK" "キッズ" をクエリに含める
  - 同行者「友達」→ "グループ" "わいわい" をクエリに含める
  - 同行者「一人」→ "一人でも入りやすい" "ソロ" をクエリに含める
- **雰囲気を具体的キーワードに変換する**:
  - 静か → "隠れ家" "静かな" "落ち着いた"
  - 賑やか → "にぎやか" "人気の" "活気ある"
  - アクティブ → "体験" "アクティビティ" "スポーツ"
  - スリル → "スリル" "アドベンチャー" "アトラクション"
  - ロマンティック → "夜景" "ムード" "デート向き"
  - アットホーム → "アットホーム" "温かい" "地元"
- **優先事項をクエリに反映する**:
  - コスパ → "コスパ最強" "安い" "リーズナブル"
  - 映え → "インスタ映え" "フォトジェニック" "写真映え"
  - 距離 → "近くの" "駅近" "アクセス便利"
  - 快適さ → "快適" "ゆったり" "くつろげる"
  - 楽しさ → "楽しい" "エンタメ" "体験"
  - 質の高さ → "高品質" "本格" "こだわりの"
- **【交通手段】を厳守する（複数選択の場合はすべての手段が使える場所を探す）**:
  - 「電車」のみ（車なし）→ 必ず駅徒歩圏内のスポットを提案。山奥・郊外・駐車場必須の場所・電車の駅から徒歩30分超の場所は一切提案しない。クエリに「駅近」「駅徒歩〇分」「電車アクセス」を含める
  - 「バス」含む → バス停近くのスポットを優先
  - 「徒歩」→ 徒歩10〜15分以内の極近場のみ。駅・車・バスが必要な場所は除外
  - 「車」のみ（電車なし）→ 駐車場ありの場所を優先。「駐車場あり」をクエリに含める
  - 「自転車・バイク」→ 自転車で行ける範囲の場所を優先
  - 「なんでも」または複数選択（電車＋車など）→ 交通手段の制約なし
- **【使える時間】から移動距離を計算して厳守する**:
  - 15〜30分 → 徒歩5〜7分以内の超近場のみ（移動時間ほぼゼロ）
  - 30〜60分 → 片道15分以内の近隣スポット
  - 1〜2時間 → 片道20〜30分以内（滞在1時間想定）
  - 2〜4時間 → 片道30〜50分以内（隣駅・隣町レベル、滞在1〜2時間想定）
  - 4〜6時間 → 片道1〜1.5時間圏内（隣県レベル、滞在2〜3時間想定）
  - **6時間以上 → 片道2〜3時間の遠出スポットを積極的に提案（日帰り旅行・観光地レベル）。近所のカフェ・公園などの日常スポットは絶対に提案しない**
- **予算を厳守する**:
  - 予算下限〜上限の範囲が指定されている場合（例：3000円〜8000円）、その価格帯のみ提案する。下限より安すぎる無料・格安スポットも除外する
  - 上限のみ指定の場合、その金額以内のスポットのみ。高級店・高単価な場所は除外する
  - 無料・低予算（〜1000円）なら：無料公園・無料スポット・低価格カフェ・100円ショップ等を優先し、有料テーマパーク・高級レストランは除外
  - クエリに価格帯キーワードを必ず反映する（例：「リーズナブル」「高級」「無料」「食べ放題2000円」）
- **年齢・性別を反映する**:
  - 10〜20代 → トレンド・映え・SNS映え・コスパ
  - 30〜40代以上 → 落ち着いた・質重視・大人向け
  - 女性 → おしゃれ・かわいい・スイーツ
  - 男性 → ボリューム・本格・スポーツ・アウトドア
- **【ドライブしたい】専用ルール（気分が「ドライブしたい」かつ【ドライブ到達圏】が指定されている場合は必須）**:
  - 【ドライブ到達圏】に指定された距離・エリアを必ず守る。「現在地周辺」「近場」のクエリは一切生成しない
  - **ただし「都会の夜景」「City night view」が選択されている場合は例外**：現在地の都市部・市街地にある夜景スポット（タワー・展望台・橋・スカイライン・レインボーブリッジ・東京タワーなど著名ランドマーク）を積極的に検索すること。「近場でも車で行く価値がある都市ランドマーク」を最優先にすること
  - エリア名は現在地ではなく、ドライブ先の市町村名・観光地名にする（例：現在地が横浜なら、1時間先は箱根・伊豆・千葉・茨城など）
  - クエリには「展望台」「道の駅」「海岸」「ドライブスポット」「絶景」など車で行く先として自然なスポット種別を組み合わせる
  - drive_road_type（一般道 or 高速）・drive_road（走りたい道）・drive_vibe（雰囲気）・drive_activity（過ごし方）の回答も必ずクエリに反映する
  - **drive_road の選択でターゲット地形を絞り込むこと**：
    - 「海沿い」→ 海岸・湾岸・海が見えるエリアのスポットのみ（内陸の山・都市スポットは出さない）
    - 「山・峠道」→ 山岳・峠・高原エリアのスポットのみ（海沿い・都市スポットは出さない）
    - 「広い国道」→ 国道・バイパス沿いの道の駅・ドライブイン・大型施設を優先
    - 「都会の夜景」→ 都市部・市街地の夜景ランドマーク・タワー・展望台（すでに上記ルール参照）
- **【自然感じたい】専用ルール（気分が「自然感じたい」の場合は必須）**:
  - 公園・自然公園・展望台・花畑・植物園・山・森・海・川・湖など「自然・緑・景色」に関するスポットを最優先で検索する
  - nature_view（どんな自然）・nature_how（過ごし方）・nature_scale（規模）・nature_scene（景色）の回答を必ずクエリに反映する
  - 飲食店・ショッピング・ゲームセンターなど自然と無関係なスポットは一切提案しない（テラスカフェ・自然の中のカフェは例外）
  - 「海・川・湖」が選択された場合 → 海岸・河川公園・湖畔・水辺のスポットを中心に
  - 「山・森林」が選択された場合 → ハイキングコース・森林公園・展望山・自然林を中心に
  - 「花畑・草原」が選択された場合 → 花公園・植物園・季節の花スポットを中心に
  - 「夕日・星空」が選択された場合 → 展望台・海辺・山頂など夕日・星空が見えるスポットを中心に
- **【遠くに行きたい】専用ルール（気分が「遠くに行きたい」かつ【移動時間・到達圏】が指定されている場合は必須）**:
  - 【移動時間・到達圏】に指定された時間・距離を厳守してクエリを生成する
  - 「午前中のみ」→ 1時間以内のアクセスが良い場所、「夕方まで」→ 1〜2時間圏内、「日跨ぐ前まで」→ 2〜3時間圏内、「日越してもOK」→ 3時間以上・宿泊地も含む
  - destination（場所のイメージ）と travel_goal（旅の目的）を必ず組み合わせてクエリに反映する
- **【お腹すいた】専用ルール（気分が「お腹すいた」の場合は必須）**:
  - 全クエリのbucketは必ず "food" にする。"spot"/"scenic"/"activity"/"relax"/"outdoor" は絶対に使わない
  - 公園・神社・観光スポット・ショッピングモール（食事以外）など食事と無関係な場所は一切提案しない
  - 「飲食店」「レストラン」「カフェ」「ラーメン」「定食」「居酒屋」など食事・飲み物に関連するキーワードのみ使用する
- **自由入力（フリーワード）がある場合は、それが意図する目的・環境・用途を最優先で解釈し、全8件のクエリをその目的に特化させてください**
  - 「仕事ができる環境」「作業できる」「勉強できる」→ コワーキングスペース・wifi完備カフェ・自習室・図書館・ビジネスカフェ（温泉・遊園地等の気分由来クエリは一切生成しない）
  - 「子連れ」「ペット可」「バリアフリー」→ それに特化した施設のみ
  - 「誰でも使える」「一般開放」→ 公共施設・開放的なカフェ・無料開放スポット
  - **フリーワードに地名・エリア（「都内」「東京」「大阪」「横浜」など都市名・地域名）が含まれる場合は、【ドライブ到達圏】の距離計算より地名を絶対優先する。指定エリア内でドライブして楽しめるスポットを検索すること**（例：「都内の美しい場所」→ 東京都内の公園・展望台・橋・ランドマーク等を検索。山梨・静岡など都外を検索しない）
  - フリーワードの意図が「場所の種類・環境・条件」を明示している場合、気分（mood）由来のクエリは生成せず、フリーワードの意図100%でクエリを構成する
  - フリーワードが「今日の気分について」など気分補足の場合は、気分と組み合わせて良い
- 8件のクエリは多様性を持たせ、気分・同行者・雰囲気・優先事項の全要素を組み合わせる
- **過去フィードバック**がある場合、「この気分では合わない」と評価された場所と同カテゴリ・同ジャンルは避ける（ただしその場所自体が悪いわけではなく、今の気分・文脈に合わないという意味）
- **季節を必ず考慮する**: ${seasonCtx.hint}
- **ユーザーの傾向**がある場合は、その傾向に合ったスポットを優先してクエリを生成する
- **前回の結果への追加要望**がある場合は、その要望を最優先でクエリに反映する`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `以下のユーザー情報に基づいて検索クエリを生成してください:\n\n${userContext}${feedbackContext}${globalStatsContext}${timeContext ? `\n\n【現在の状況（必ず考慮）】\n${weatherTimePromptContext(weather, timeContext)}` : ""}`,
        },
      ],
      temperature: 0.95,
      max_tokens: 2800, // 12件 × reason+features+target_user 分を考慮
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw);
    type RawPlan = { query: string; weight: number; bucket: Bucket; place_name?: string; reason?: string; features?: string[]; target_user?: string };
    const rawList: RawPlan[] = (Array.isArray(parsed) ? parsed : parsed.queries ?? parsed.results ?? [])
      .filter(
        (p: unknown): p is RawPlan =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as Record<string, unknown>).query === "string" &&
          typeof (p as Record<string, unknown>).weight === "number"
      )
      .slice(0, 12);

    const plans: SearchPlan[] = rawList.map((p) => {
      const rd: ReasonData | undefined = (p.reason || (p.features && p.features.length > 0))
        ? {
            reason: typeof p.reason === "string" ? p.reason.trim() : "",
            features: Array.isArray(p.features) ? p.features.filter((f): f is string => typeof f === "string") : [],
            targetUser: typeof p.target_user === "string" ? p.target_user.trim() : undefined,
          }
        : undefined;
      return {
        query: p.query,
        weight: p.weight,
        bucket: p.bucket ?? "mixed",
        placeName: typeof p.place_name === "string" && p.place_name.trim() ? p.place_name.trim() : undefined,
        reasonData: rd,
      };
    });

    // 後方互換用マップ（admin スポット注入など他の箇所での参照用）
    const aiReasons = new Map<string, ReasonData>();
    for (const plan of plans) {
      if (plan.reasonData) {
        const key = (plan.placeName ?? plan.query).toLowerCase().replace(/\s+/g, "");
        if (!aiReasons.has(key)) aiReasons.set(key, plan.reasonData);
      }
    }

    if (plans.length > 0) {
      const namedCount = plans.filter((p) => p.placeName).length;
      const reasonCount = plans.filter((p) => p.reasonData?.reason).length;
      console.log(`[AI] plans: ${plans.length}件（具体名指定: ${namedCount}件、理由生成: ${reasonCount}件）`);
    }

    return plans.length > 0 ? { plans, aiReasons } : null;
  } catch (e) {
    console.warn("AI search plan generation failed, falling back to rule-based:", e);
    return null;
  }
}

// ── まったりしたい専用: 単一textQueryをOpenAIで生成（ハルシネーション防止） ─────────
async function buildRelaxTextQueryWithAI(
  answers: Answers,
  weather: WeatherContext = {},
  timeContext?: ReturnType<typeof getTimeContext>
): Promise<{ textQuery: string; reason: string } | null> {
  // OpenAI無効化（コスト削減のためルールベースのみ使用）
  return null;
  if (!process.env.OPENAI_API_KEY) return null; // eslint-disable-line no-unreachable

  const rawArea = answers.area?.trim() || "";
  // エリア名を市区レベルに正規化（都道府県・番地は除去）
  const cityMatch = rawArea.match(/^(.+?市)/);
  const wardMatch = rawArea.match(/^(.+?区)/);
  const area = rawArea
    ? (cityMatch ? cityMatch[1] : wardMatch ? wardMatch[1] : rawArea.split(/[丁目番地０-９0-9]/)[0].trim() || rawArea)
    : "";

  // 動的質問の回答からキーワードを取得（relax_sub_choiceの「検索キーワード: 〜」部分を抽出）
  const dynQs = getDynamicQs(answers);
  const placeAns = dynQs.find(dq => dq.question.includes("どこで癒やされたい"))?.answer ?? "";
  const subChoiceRaw = dynQs.find(dq => dq.question.includes("どんな") || dq.question.includes("カフェで") || dq.question.includes("どんな景色") || dq.question.includes("どんなスタイル") || dq.question.includes("自然の中で"))?.answer ?? "";
  // 「〜（検索キーワード: X Y Z）」から X Y Z だけ抽出
  const keywordsMatch = subChoiceRaw.match(/検索キーワード:\s*(.+?)）/);
  const apiKeywords = keywordsMatch ? keywordsMatch[1].trim() : "";
  const subChoiceText = subChoiceRaw.replace(/（検索キーワード:.*?）/, "").trim();

  // 同行者情報（reason生成用のみ。textQueryには含めない）
  const c = answers.companion ?? "";
  const companionLabel = c.includes("一人") ? "一人"
    : c.includes("恋人") || c.includes("パートナー") ? "恋人"
    : c.includes("家族") ? "家族"
    : c.includes("友達") ? "友達"
    : c || "";

  // 交通手段を分類
  const transports = Array.isArray(answers.transport) ? answers.transport : [answers.transport].filter(Boolean) as string[];
  const hasCar    = transports.some(t => t.includes("車") || t.includes("ドライブ"));
  const hasTrain  = transports.some(t => t.includes("電車"));
  const hasBus    = transports.some(t => t.includes("バス"));
  const hasBike   = transports.some(t => t.includes("自転車") || t.includes("バイク"));
  const isWalk    = transports.length > 0 && transports.every(t => t.includes("徒歩"));
  const isAnything = transports.some(t => t.includes("なんでも")) || transports.length === 0;

  // 移動手段タイプをプロンプト用に文字列化
  const transportType = isWalk ? "徒歩"
    : hasCar ? "車"
    : hasBike ? "自転車・バイク"
    : (hasTrain || hasBus) ? "電車・バス"
    : "なんでも";

  const systemPrompt = `あなたは日本のGoogle Places API検索クエリ生成の専門家です。

## 役割
ユーザーの条件を分析し、Google Places Text Searchで「確実にヒットするシンプルで強力な検索クエリ」を1つだけ生成してください。

## エリアのルール
${area
  ? `エリア「${area}」をtextQueryの先頭に入れること（都道府県レベルは広すぎるので市区レベルまで）。`
  : `エリア情報がないため、カテゴリキーワードのみでOK。`}

## カテゴリ別ビッグワード（1つだけ選ぶこと）
| カテゴリ | ビッグワード候補 |
|---|---|
| 温泉・スパ・サウナ系 | 「スーパー銭湯」「日帰り温泉」「サウナ」 |
| カフェ・休憩系 | 「カフェ」「ブックカフェ」「漫画カフェ」 |
| 自然・公園系 | 「公園」「大型公園」「自然公園」 |
| 絶景・夜景系 | 「展望台」「夜景スポット」 |

## サブワード（1語まで追加可）
- 温泉系: 「岩盤浴」「サウナ」（ビッグワードと重複しない場合のみ）
- カフェ系: 「Wi-Fi」「ゆったり」
- 公園系: 「ピクニック」「散策」
- 絶景系: 「夕日」「パノラマ」
- 電車・バスの場合のみ「駅近」を追加してよい

## 絶対に含めてはいけない語
「駐車場」「友達」「恋人」「家族」「一人」「まったり」「くつろぎ」「癒やし」「おすすめ」「人気」「駐車場」「大型」

## 出力形式（JSONのみ）
{ "textQuery": "${area ? "エリア名 " : ""}ビッグワード1語 [サブワード1語]", "reason_for_user": "ユーザーへの一言（40〜60文字）" }`;

  const userInput = [
    area && `【エリア】${area}`,
    `【移動手段】${transportType}`,
    placeAns && `【癒やされたい場所カテゴリ】${placeAns}`,
    subChoiceText && `【過ごし方の希望（ビッグワード選択の参考に）】${subChoiceText}`,
    apiKeywords && `【参考キーワード（細かすぎる語はビッグワードに置き換えること）】${apiKeywords}`,
    companionLabel && `【同行者（textQueryには含めずreasonに使うこと）】${companionLabel}`,
    answers.time && `【使える時間】${answers.time}`,
    answers.freeWord && `【フリーワード（ビッグワードに変換できれば使う）】${answers.freeWord}`,
  ].filter(Boolean).join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `以下の条件でGoogle Places検索テキストクエリを1つ生成してください:\n\n${userInput}` },
      ],
      temperature: 0.7,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw);
    if (typeof parsed.textQuery !== "string" || !parsed.textQuery.trim()) return null;
    const reason = parsed.reason_for_user ?? parsed.reason ?? "";
    console.log(`[Relax AI] textQuery生成: "${parsed.textQuery}" / reason: "${reason}"`);
    return { textQuery: parsed.textQuery.trim(), reason };
  } catch (e) {
    console.warn("[Relax AI] textQuery生成失敗:", e);
    return null;
  }
}

// まったりしたいのフォールバッククエリ（AI失敗時）
function buildFallbackRelaxQuery(answers: Answers): string {
  const rawArea = answers.area?.trim() || "";
  const cityMatch = rawArea.match(/^(.+?市)/);
  const wardMatch = rawArea.match(/^(.+?区)/);
  const area = rawArea
    ? (cityMatch ? cityMatch[1] : wardMatch ? wardMatch[1] : rawArea.split(/[丁目番地０-９0-9]/)[0].trim() || rawArea)
    : "";

  const transports = Array.isArray(answers.transport) ? answers.transport : [answers.transport].filter(Boolean) as string[];
  const isWalk   = transports.length > 0 && transports.every(t => t.includes("徒歩"));
  const hasTrain = transports.some(t => t.includes("電車") || t.includes("バス"));

  const dynQs = getDynamicQs(answers);
  const placeAns = dynQs.find(dq => dq.question.includes("どこで癒やされたい"))?.answer ?? "";

  const bigWordMap: Record<string, { walk: string; other: string }> = {
    "温泉": { walk: "銭湯",         other: "スーパー銭湯" },
    "スパ": { walk: "銭湯",         other: "スーパー銭湯" },
    "カフェ": { walk: "カフェ",     other: "カフェ" },
    "自然": { walk: "公園",         other: "公園" },
    "絶景": { walk: "展望スポット",  other: "展望台" },
  };
  const matched = Object.entries(bigWordMap).find(([k]) => placeAns.includes(k));
  const bigWord = matched ? (isWalk ? matched[1].walk : matched[1].other) : "スーパー銭湯";
  const extraKw = hasTrain ? "駅近" : null;

  return [area, bigWord, extraKw].filter(Boolean).join(" ");
}

async function generateRecommendationReason(
  answers: Answers,
  topPlaces: Array<{ title: string; address: string; editorialSummary?: string; amenityTags?: string[] }>,
  suggestionDescriptions: Map<string, string> = new Map()
): Promise<Record<string, { reason: string; features: string[]; targetUser?: string; whyMatch?: string }>> {
  // OpenAI無効化（コスト削減のためルールベースのみ使用）
  return {};
  if (!process.env.OPENAI_API_KEY || topPlaces.length === 0) return {}; // eslint-disable-line no-unreachable

  const fmtDyn = (d: { question: string; answer: string } | string | undefined): string | null => {
    if (!d) return null;
    if (typeof d === "string") return d;
    return d.answer ? `${d.question} → ${d.answer}` : null;
  };

  const companionMap: Record<string, string> = {
    一人: "一人",
    友達: "友達と",
    恋人: "恋人と",
    家族: "家族と",
    大人数グループ: "グループで",
    先輩: "先輩と",
  };

  const context = [
    answers.mood && `気分: ${answers.mood}`,
    answers.age && `${answers.age}`,
    answers.gender && `${answers.gender}`,
    answers.companion && `${companionMap[answers.companion] ?? answers.companion}`,
    answers.atmosphere && `雰囲気: ${answers.atmosphere}`,
    answers.priority && `優先: ${answers.priority}`,
    ...getDynamicQs(answers).map((dq, i) => `詳細${["①","②","③","④","⑤","⑥","⑦","⑧"][i] ?? `(${i+1})`}: ${dq.question}→${dq.answer}`),
    answers.freeWord && `こだわり: ${answers.freeWord}`,
  ]
    .filter(Boolean)
    .join("、");

  const placesList = topPlaces
    .map((p, i) => {
      const parts = [`${i + 1}. ${p.title}（${p.address}）`];
      if (p.editorialSummary) parts.push(`公式説明: ${p.editorialSummary}`);
      if (p.amenityTags && p.amenityTags.length > 0) parts.push(`設備: ${p.amenityTags.join("・")}`);
      const suggestionInfo = suggestionDescriptions.get(p.title);
      if (suggestionInfo) parts.push(`ユーザー投稿情報: ${suggestionInfo}`);
      return parts.join(" / ");
    })
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `あなたはお出かけスポット提案の専門家です。
ユーザーの属性に合わせて、各スポットについて以下のJSON形式で返してください。

出力形式:
{
  "場所名": {
    "reason": "なぜこのユーザーに合っているか（25〜35文字、具体的に）",
    "features": ["施設の特徴タグ1", "施設の特徴タグ2"],
    "targetUser": "このスポットが特に合う人（例：カップルの夜デートに最適）",
    "whyMatch": "ユーザープロファイルとの一致理由（1〜2文）"
  },
  ...
}

reasonのルール:
- ユーザーの属性に言及する（例: "20代カップルに人気の"、"一人でのんびり過ごせる"）
- フリーワードで目的が明示されている場合（「仕事ができる」「作業したい」等）は、その目的を軸に理由を書く（例: "wifi完備で長時間作業しやすい"）
- 抽象的な表現は避け、具体的な魅力を伝える
- 絵文字は使わない

targetUserのルール:
- 同行者・気分・雰囲気を組み合わせて具体的に記載（例: "カップルの夜デートに最適"、"一人でゆっくりしたい時に"）
- 20文字以内

whyMatchのルール:
- ユーザーの回答（気分・同行者・雰囲気・優先事項）とスポットの特徴を結びつける
- 1〜2文で具体的に記載

featuresのルール:
- ユーザー投稿情報がある場合は必ずその内容をタグ化する（例: "🅿 パーキング2時間無料"、"🪑 ベンチで休憩可能"）
- 場所の特徴を簡潔なタグで表現（最大3個、各12文字以内）
- 駐車場・休憩・絶景・穴場など実用的な情報を優先
- 情報が不明な場合は空配列 []`,
        },
        {
          role: "user",
          content: `ユーザー: ${context}\n\n以下のスポットにこのユーザー向けのおすすめ理由と特徴タグを書いてください:\n${placesList}`,
        },
      ],
      temperature: 0.9,
      max_tokens: 900,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Normalize: support both { reason, features } and legacy string values
    const result: Record<string, { reason: string; features: string[]; targetUser?: string; whyMatch?: string }> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") {
        result[k] = { reason: v, features: [] };
      } else if (typeof v === "object" && v !== null) {
        const obj = v as Record<string, unknown>;
        result[k] = {
          reason: typeof obj.reason === "string" ? obj.reason : "",
          features: Array.isArray(obj.features) ? (obj.features as string[]) : [],
          targetUser: typeof obj.targetUser === "string" ? obj.targetUser : undefined,
          whyMatch: typeof obj.whyMatch === "string" ? obj.whyMatch : undefined,
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function toPriceLabel(budget?: number) {
  if (budget === undefined || budget === null) return "";
  if (budget <= 1000) return "低予算";
  if (budget <= 3000) return "手頃";
  if (budget <= 10000) return "中価格帯";
  return "高価格帯";
}

// 複数選択対応ヘルパー
function getTransports(transport?: string | string[]): string[] {
  if (!transport) return [];
  if (Array.isArray(transport)) return transport;
  return transport ? [transport] : [];
}

function hasTransport(transport: string | string[] | undefined, mode: string): boolean {
  return getTransports(transport).includes(mode);
}

// 時間から最大移動時間（片道分）を算出
function getTimeContext2(time?: string): { maxTravelMin: number | null; minTravelMin: number | null; label: string } {
  switch (time) {
    case "15〜30分":  return { maxTravelMin: 7,   minTravelMin: null, label: "徒歩5〜7分以内の超近場のみ（移動にほぼ時間を使えない）" };
    case "30〜60分":  return { maxTravelMin: 18,  minTravelMin: null, label: "片道15〜18分以内・駅近・近隣エリアのみ" };
    case "1〜2時間":  return { maxTravelMin: 30,  minTravelMin: null, label: "片道20〜30分以内の中近距離スポット" };
    case "2〜4時間":  return { maxTravelMin: 55,  minTravelMin: null, label: "片道30〜55分以内・隣駅〜隣町レベル（滞在1〜2時間想定）" };
    case "4〜6時間":  return { maxTravelMin: 100, minTravelMin: null, label: "片道1〜1.5時間圏内・充実した観光地も可（滞在2〜3時間想定）" };
    case "6時間以上": return { maxTravelMin: null, minTravelMin: 35,  label: "終日使える（6時間以上）ため、片道2〜3時間圏内の遠出スポットを積極提案。近所のカフェ・公園など近場日常スポットは避けること" };
    default:          return { maxTravelMin: null, minTravelMin: null, label: "" };
  }
}

// 交通手段 × 使える時間 → 到達圏の説明をAIに渡す（ドライブ・遠くに行きたい以外）
function getNonDriveTravelRadiusContext(
  mood?: string,
  transport?: string | string[],
  time?: string
): string | null {
  if (!time) return null;
  if (mood === "ドライブしたい" || mood === "遠くに行きたい") return null;

  const transports = getTransports(transport);
  const hasCar   = transports.includes("車");
  const hasTrain = transports.includes("電車");
  const hasBus   = transports.includes("バス");
  const hasBike  = transports.includes("自転車・バイク");
  const walkOnly = transports.includes("徒歩") && !hasCar && !hasTrain && !hasBus && !hasBike;
  const anyMode  = transports.includes("なんでも") || transports.length === 0;

  // 片道移動時間の目安（総時間の約1/3〜1/2を移動に充てる）
  // 残り時間は目的地での滞在に使う
  type ReachInfo = { onewayMin: number; km: number; desc: string };
  const getReach = (mode: "walk" | "bike" | "train" | "bus" | "car" | "any"): ReachInfo => {
    const speedKmh: Record<typeof mode, number> = {
      walk: 4, bike: 14, train: 35, bus: 22, car: 40, any: 30,
    };
    const spd = speedKmh[mode];
    // 総時間→片道時間（1/3を移動に割り当て）
    const totalMin = (() => {
      switch (time) {
        case "15〜30分":  return 22;
        case "30〜60分":  return 45;
        case "1〜2時間":  return 90;
        case "2〜4時間":  return 180;
        case "4〜6時間":  return 300;
        case "6時間以上": return 480;
        default: return 90;
      }
    })();
    const onewayMin = Math.round(totalMin / 3);
    const km = Math.round((spd * onewayMin) / 60);

    const modeLabel: Record<typeof mode, string> = {
      walk: "徒歩", bike: "自転車・バイク", train: "電車", bus: "バス", car: "車", any: "",
    };
    const label = modeLabel[mode];

    let desc = "";
    if (mode === "walk") {
      desc = km <= 1
        ? `徒歩${onewayMin}分以内（約${km}km圏内）のごく近場のみを提案してください。遠距離スポットは不可`
        : `徒歩${onewayMin}分以内（約${km}km圏内）の徒歩圏スポットを提案してください`;
    } else if (mode === "bike") {
      desc = `自転車・バイクで${onewayMin}分以内（約${km}km圏内）のスポットを提案してください`;
    } else if (mode === "train") {
      const stops = km <= 5 ? "1〜2駅" : km <= 15 ? "数駅" : km <= 30 ? "10〜20駅程度・乗り換え1回" : "乗り換え含む遠方";
      desc = `電車で${onewayMin}分以内（約${km}km・${stops}程度）のスポットを提案してください。駅徒歩圏内のアクセス良好な場所を優先`;
    } else if (mode === "bus") {
      desc = `バスで${onewayMin}分以内（約${km}km圏内）のスポットを提案してください`;
    } else if (mode === "car") {
      desc = `車で${onewayMin}分以内（約${km}km圏内）のスポットを提案してください。駐車場ありの施設を優先`;
    } else {
      desc = `移動時間${onewayMin}分以内（約${km}km圏内）のスポットを提案してください`;
    }

    return { onewayMin, km, desc };
  };

  // 交通手段ごとに最も遠い到達圏を使う（車 > 電車 > バス > バイク > 徒歩）
  let reach: ReachInfo;
  let label: string;
  if (hasCar) {
    reach = getReach("car");
    label = "車";
  } else if (hasTrain) {
    reach = getReach("train");
    label = "電車";
  } else if (hasBus) {
    reach = getReach("bus");
    label = "バス";
  } else if (hasBike) {
    reach = getReach("bike");
    label = "自転車・バイク";
  } else if (walkOnly) {
    reach = getReach("walk");
    label = "徒歩";
  } else if (anyMode) {
    reach = getReach("any");
    label = "";
  } else {
    return null;
  }

  return `【到達圏・距離感（最重要）】使える時間は${time}。${reach.desc}。${label ? `${label}での移動を前提に` : ""}現在地から片道約${reach.onewayMin}分・${reach.km}km以内のエリアに絞って検索クエリを設計してください。これを超える遠距離スポットは提案しないでください。`;
}

function mapTransportToTravelMode(transport?: string | string[], mood?: string): string | undefined {
  if (mood === "ドライブしたい") return "DRIVE";
  const transports = getTransports(transport);
  if (transports.length === 0 || transports.includes("なんでも")) return undefined;
  // 車が含まれていればDRIVE（最も到達範囲が広い）
  if (transports.includes("車")) return "DRIVE";
  // 電車・バスは Places API v1 の routingParameters 非対応 → undefined（locationBiasのみで検索）
  if (transports.includes("電車") || transports.includes("バス")) return undefined;
  // 自転車・バイクのみ
  if (transports.includes("自転車・バイク")) return "BICYCLE";
  // 徒歩
  if (transports.includes("徒歩")) return "WALK";
  return undefined;
}

function companionHint(companion?: string) {
  switch (companion) {
    case "一人":
      return "一人でも行きやすい";
    case "友達":
      return "友達と楽しめる";
    case "恋人":
      return "デート向き";
    case "家族":
      return "家族で行きやすい";
    case "大人数グループ":
      return "大人数でも楽しめる";
    case "先輩":
      return "会話しやすい";
    default:
      return "";
  }
}

function moodPlans(mood?: string): Array<[string, number, Bucket]> {
  switch (mood) {
    case "お腹すいた":
      return [
        ["レストラン", 16, "food"],
        ["ランチ", 13, "food"],
        ["ディナー", 13, "food"],
        ["カフェ", 11, "food"],
        ["ベーカリー", 10, "food"],
        ["フードホール", 9, "food"],
        ["景色のいいカフェ", 6, "scenic"],
      ];
    case "ゆっくりしたい":
      return [
        ["公園", 14, "spot"],
        ["散歩スポット", 13, "relax"],
        ["庭園", 12, "relax"],
        ["図書館", 10, "indoor"],
        ["落ち着くカフェ", 10, "food"],
        ["展望スポット", 7, "scenic"],
      ];
    case "楽しみたい":
      return [
        ["アミューズメント", 14, "activity"],
        ["観光スポット", 13, "spot"],
        ["体験スポット", 12, "activity"],
        ["ボウリング", 10, "activity"],
        ["ゲームセンター", 10, "indoor"],
        ["人気スポット", 8, "spot"],
      ];
    case "ドライブしたい":
      return [
        ["展望台", 14, "scenic"],
        ["道の駅", 13, "spot"],
        ["海沿いスポット", 12, "scenic"],
        ["山・峠スポット", 11, "spot"],
        ["24時間営業 ドライブイン SA", 9, "food"],  // 夜間でも開いている食事スポット
      ];
    case "自然感じたい":
      return [
        ["自然公園", 15, "scenic"],
        ["公園", 14, "spot"],
        ["展望台", 13, "scenic"],
        ["ハイキング・登山", 12, "activity"],
        ["花畑・植物園", 12, "scenic"],
        ["海・川・湖", 11, "scenic"],
        ["自然カフェ", 8, "food"],
      ];
    case "体を動かしたい":
      return [
        ["スポーツ施設", 14, "activity"],
        ["ランニングスポット", 13, "activity"],
        ["公園", 12, "spot"],
        ["ジム", 11, "indoor"],
        ["ハイキング", 10, "spot"],
      ];
    case "遠くに行きたい":
      return [
        ["観光スポット", 15, "spot"],
        ["日帰りスポット", 14, "spot"],
        ["展望台", 12, "scenic"],
        ["海", 11, "scenic"],
        ["水族館", 9, "indoor"],
      ];
    default:
      return [
        ["観光スポット", 9, "spot"],
        ["公園", 8, "spot"],
        ["カフェ", 8, "food"],
      ];
  }
}

function atmospherePlans(atmosphere?: string): Array<[string, number, Bucket]> {
  switch (atmosphere) {
    case "静か":
      return [
        ["静かな公園", 9, "relax"],
        ["落ち着くカフェ", 8, "food"],
        ["図書館", 8, "indoor"],
      ];
    case "賑やか":
      return [
        ["にぎやかなスポット", 9, "spot"],
        ["人気スポット", 8, "spot"],
        ["商業施設", 7, "indoor"],
      ];
    case "アクティブ":
      return [
        ["アクティビティ", 9, "activity"],
        ["体験スポット", 8, "activity"],
        ["屋外スポット", 7, "spot"],
      ];
    case "スリル":
      return [
        ["アミューズメント", 9, "activity"],
        ["体験スポット", 8, "activity"],
      ];
    case "ロマンティック":
      return [
        ["夜景スポット", 10, "scenic"],
        ["展望台", 9, "scenic"],
        ["デートスポット", 8, "scenic"],
      ];
    case "アットホーム":
      return [
        ["居心地のいいカフェ", 9, "food"],
        ["ローカルスポット", 7, "spot"],
        ["小さな公園", 7, "relax"],
      ];
    default:
      return [];
  }
}

function priorityPlans(priority?: string): Array<[string, number, Bucket]> {
  switch (priority) {
    case "コスパ":
      return [
        ["安いカフェ", 8, "food"],
        ["無料スポット", 8, "spot"],
        ["低予算スポット", 7, "spot"],
      ];
    case "映え":
      return [
        ["写真映えスポット", 10, "scenic"],
        ["おしゃれカフェ", 9, "food"],
        ["景色がいい場所", 9, "scenic"],
      ];
    case "距離":
      return [
        ["近くのカフェ", 8, "food"],
        ["近くのスポット", 8, "spot"],
      ];
    case "快適さ":
      return [
        ["居心地のいいカフェ", 9, "food"],
        ["過ごしやすいスポット", 8, "relax"],
      ];
    case "楽しさ":
      return [
        ["楽しいスポット", 9, "activity"],
        ["体験スポット", 9, "activity"],
      ];
    case "質の高さ":
      return [
        ["評価が高いカフェ", 9, "food"],
        ["評価が高いスポット", 8, "spot"],
      ];
    default:
      return [];
  }
}

function allowedBucketsForMood(mood?: string) {
  switch (mood) {
    case "お腹すいた":
      return {
        primary: new Set<Bucket>(["food"]),
        fallback: new Set<Bucket>(["scenic", "indoor"]),
      };
    case "ゆっくりしたい":
      return {
        primary: new Set<Bucket>(["relax", "spot", "indoor", "food"]),
        fallback: new Set<Bucket>(["scenic"]),
      };
    case "楽しみたい":
      return {
        primary: new Set<Bucket>(["activity", "spot", "scenic"]),
        fallback: new Set<Bucket>(["food", "indoor"]),
      };
    case "ドライブしたい":
      return {
        primary: new Set<Bucket>(["scenic", "spot"]),
        fallback: new Set<Bucket>(["food", "activity"]),
      };
    case "映えたい":
      return {
        primary: new Set<Bucket>(["scenic", "spot", "indoor"]),
        fallback: new Set<Bucket>(["food", "relax"]),
      };
    case "集中したい":
      return {
        primary: new Set<Bucket>(["indoor", "relax"]),
        fallback: new Set<Bucket>(["food", "spot"]),
      };
    case "まったりしたい":
      return {
        primary: new Set<Bucket>(["relax", "spot", "indoor", "scenic"]),
        fallback: new Set<Bucket>(["food"]),
      };
    case "わいわい楽しみたい":
      return {
        primary: new Set<Bucket>(["activity", "spot", "indoor"]),
        fallback: new Set<Bucket>(["food", "scenic"]),
      };
    case "自然感じたい":
      return {
        primary: new Set<Bucket>(["scenic", "spot", "activity"]),
        fallback: new Set<Bucket>(["relax", "food"]),
      };
    case "体を動かしたい":
      return {
        primary: new Set<Bucket>(["activity", "spot"]),
        fallback: new Set<Bucket>(["indoor"]),
      };
    case "遠くに行きたい":
      return {
        primary: new Set<Bucket>(["spot", "scenic"]),
        fallback: new Set<Bucket>(["indoor"]),
      };
    default:
      return {
        primary: new Set<Bucket>(["spot", "food", "scenic"]),
        fallback: new Set<Bucket>(["activity", "indoor", "relax"]),
      };
  }
}

function buildSearchPlans(answers: Answers): SearchPlan[] {
  const area = answers.area?.trim() || "現在地周辺";
  const mood = answers.mood?.trim() || "";
  const freeWord = answers.freeWord?.trim() || "";

  // 予算キーワード変換（budgetMin対応）
  const budgetKw = (() => {
    if (answers.budget === undefined || answers.budget === null) return "";
    if (answers.budget === 0) return "無料";
    if (answers.budgetMin && answers.budgetMin > 0) {
      const min = answers.budgetMin.toLocaleString("ja-JP");
      const max = answers.budget.toLocaleString("ja-JP");
      return `${min}円から${max}円`;
    }
    if (answers.budget <= 500) return "無料・格安";
    if (answers.budget <= 1500) return "安い・リーズナブル";
    if (answers.budget <= 5000) return "手頃な価格";
    if (answers.budget <= 15000) return "中価格帯";
    return "高級";
  })();

  // 同行者キーワード変換（強化版）
  const companionKw = (() => {
    const c = answers.companion ?? "";
    if (c.includes("一人")) return "一人で楽しめる ソロ";
    if (c.includes("カップル") || c.includes("恋人")) return "カップル デート";
    if (c.includes("家族") || c.includes("子ども") || c === "家族") return "家族連れ 子供";
    if (c.includes("友人") || c.includes("グループ") || c === "友達" || c === "大人数グループ") return "グループ 友達";
    if (c === "先輩") return "落ち着いた 大人向け";
    return "";
  })();

  // 雰囲気キーワード変換
  const atmosphereKeyword: Record<string, string> = {
    静か: "静かな隠れ家",
    賑やか: "にぎやか人気",
    アクティブ: "アクティビティ体験",
    スリル: "スリルアドベンチャー",
    ロマンティック: "夜景ムードロマンティック",
    アットホーム: "アットホーム居心地",
  };
  const atmosphereKw = atmosphereKeyword[answers.atmosphere ?? ""] ?? "";

  // 優先事項キーワード変換
  const priorityKeyword: Record<string, string> = {
    コスパ: "コスパ最強リーズナブル",
    映え: "インスタ映えフォトジェニック",
    距離: "駅近アクセス良好",
    快適さ: "快適ゆったり",
    楽しさ: "楽しいエンタメ",
    質の高さ: "高品質本格",
  };
  const priorityKw = priorityKeyword[answers.priority ?? ""] ?? "";

  // 年齢・性別キーワード
  const ageGenderKw = (() => {
    const parts: string[] = [];
    if (answers.age === "10代" || answers.age === "20代") parts.push("トレンドSNS映え");
    if (answers.age === "30代" || answers.age === "40代") parts.push("大人向け落ち着いた");
    if (answers.age === "50代以上") parts.push("歴史文化自然");
    if (answers.gender === "女性") parts.push("おしゃれかわいい");
    if (answers.gender === "男性") parts.push("本格アウトドア");
    return parts.join(" ");
  })();

  // 交通手段 → 距離感キーワード（強化版・複数選択対応）
  const transportKw = (() => {
    const t = Array.isArray(answers.transport) ? answers.transport.join(",") : (answers.transport ?? "");
    if (t.includes("徒歩")) return "近所 徒歩圏内";
    if (t.includes("自転車")) return "自転車で行ける";
    if (t.includes("電車") || t.includes("バス")) return "駅近 アクセス良好";
    if (t.includes("車") || answers.mood === "ドライブしたい") return "ドライブ 車でアクセス";
    return "";
  })();
  const selectedTransports = getTransports(answers.transport);
  const transportKw2 = transportKw || selectedTransports
    .map((t) => {
      if (t === "徒歩") return "近所 徒歩圏内";
      if (t === "自転車・バイク") return "自転車で行ける";
      if (t === "電車") return "駅近 アクセス良好";
      if (t === "車") return "ドライブ 車でアクセス";
      if (t === "バス") return "バスアクセス";
      return "";
    })
    .filter(Boolean)
    .join(" ");

  // 気分から基本プランを取得
  const { primary } = allowedBucketsForMood(mood);
  const rawPlans: SearchPlan[] = [];

  const push = (keyword: string, weight: number, bucket: Bucket, extras: string[] = []) => {
    const parts = [area, ...extras.filter(Boolean), keyword].filter(Boolean);
    rawPlans.push({ query: parts.join(" "), weight, bucket });
  };

  // ─── フリーワードがある場合：全クエリをフリーワード中心に構成 ───
  if (freeWord) {
    // 専用クエリ（同行者・雰囲気・予算を組み合わせて多様なバリエーション）
    push(freeWord, 15, "mixed", [companionKw, atmosphereKw, budgetKw].filter(Boolean));
    push(freeWord, 14, "mixed", [priorityKw, ageGenderKw].filter(Boolean));
    push(freeWord, 13, "mixed", [transportKw2, companionKw].filter(Boolean));
    push(freeWord, 12, "mixed", [atmosphereKw, budgetKw].filter(Boolean));
    push(freeWord, 11, "mixed", [ageGenderKw, priorityKw].filter(Boolean));
    // 気分との組み合わせ（フリーワードが気分補足の場合に有効）
    for (const [keyword, weight, bucket] of moodPlans(mood).slice(0, 3)) {
      if (!primary.has(bucket) && mood) continue;
      push(freeWord + " " + keyword, weight + 2, bucket, [companionKw, budgetKw].filter(Boolean));
    }
  } else {
    // ─── フリーワードなし：通常の気分ベースクエリ ───

    // ── お腹すいた専用：動的Q回答をメインクエリに直接反映 ──
    if (mood === "お腹すいた") {
      const foodKwsFb = getDynamicQs(answers).flatMap((dq) => {
        const kw = DYNAMIC_ANSWER_KEYWORDS[dq.question]?.[dq.answer] ?? "";
        return kw.split(" ").filter(Boolean).slice(0, 2);
      });

      // 動的Q由来クエリを最優先で生成（AI失敗時の保険）
      if (foodKwsFb.length > 0) {
        const top = foodKwsFb.slice(0, 3).join(" ");
        push(top, 15, "food", [companionKw, budgetKw].filter(Boolean));
        push(top, 13, "food", [atmosphereKw, priorityKw].filter(Boolean));
        for (const kw of foodKwsFb.slice(0, 3)) {
          push(kw, 12, "food", [companionKw, budgetKw].filter(Boolean));
        }
      }
    }

    // 気分 × 同行者 × 雰囲気の複合クエリ（メイン）
    for (const [keyword, weight, bucket] of moodPlans(mood)) {
      if (!primary.has(bucket) && mood) continue;
      push(keyword, weight + 2, bucket, [companionKw, atmosphereKw, priorityKw, budgetKw].filter(Boolean));
    }

    // 気分 × 同行者のみ
    for (const [keyword, weight, bucket] of moodPlans(mood)) {
      if (!primary.has(bucket) && mood) continue;
      push(keyword, weight, bucket, [companionKw, ageGenderKw, budgetKw].filter(Boolean));
    }

    // 雰囲気 × 同行者 × 交通手段
    for (const [keyword, weight, bucket] of atmospherePlans(answers.atmosphere)) {
      push(keyword, weight, bucket, [companionKw, transportKw2].filter(Boolean));
    }

    // 優先事項 × 同行者
    for (const [keyword, weight, bucket] of priorityPlans(answers.priority)) {
      push(keyword, weight, bucket, [companionKw, atmosphereKw].filter(Boolean));
    }
  }

  // 年齢・性別特化クエリ
  if (ageGenderKw) {
    for (const [keyword, , bucket] of moodPlans(mood).slice(0, 2)) {
      push(keyword, 8, bucket, [ageGenderKw, companionKw].filter(Boolean));
    }
  }

  // 重複排除・上位8件
  const deduped = new Map<string, SearchPlan>();
  for (const plan of rawPlans) {
    const existing = deduped.get(plan.query);
    if (!existing || existing.weight < plan.weight) {
      deduped.set(plan.query, plan);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);
}

async function getPhotoUrl(photoName: string, apiKey: string) {
  const mediaUrl = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
  mediaUrl.searchParams.set("maxHeightPx", "800");
  mediaUrl.searchParams.set("skipHttpRedirect", "true");

  const res = await fetch(mediaUrl.toString(), {
    headers: { "X-Goog-Api-Key": apiKey },
    cache: "no-store",
  });

  if (!res.ok) return "";

  const data = await res.json().catch(() => null);
  return data?.photoUri || "";
}

async function getWeatherContext(lat?: number, lng?: number): Promise<WeatherContext> {
  if (typeof lat !== "number" || typeof lng !== "number") return {};

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("current", "weather_code,is_day");
    url.searchParams.set("timezone", "Asia/Tokyo");

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return {};

    const data = await res.json().catch(() => null);
    return {
      weatherCode: data?.current?.weather_code,
      isDay: typeof data?.current?.is_day === "number" ? data.current.is_day === 1 : undefined,
    };
  } catch {
    return {};
  }
}

function isRainLikeWeather(code?: number) {
  if (code === undefined) return false;
  return [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
}

function isSnowLikeWeather(code?: number) {
  if (code === undefined) return false;
  return [71, 73, 75, 77, 85, 86].includes(code);
}

function getTimeContext() {
  const hour = Number(
    new Intl.DateTimeFormat("ja-JP", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Tokyo",
    }).format(new Date())
  );

  return {
    hour,
    isMorning: hour >= 5 && hour < 11,
    isDaytime: hour >= 11 && hour < 17,
    isEvening: hour >= 17 && hour < 22,
    isLateNight: hour >= 22 || hour < 5,
  };
}

// ─── 動的質問の回答 → 具体的検索キーワード変換マップ ────────────────────────
const DYNAMIC_ANSWER_KEYWORDS: Record<string, Record<string, string>> = {
  // ── お腹すいた ──────────────────────────────────────
  "今の空腹度は？": {
    "軽く食べたい🌱":     "軽食 スナック カフェ テイクアウト 手軽",
    "ほどほど😊":         "ランチ 定食 軽食 普通盛り",
    "ぺこぺこ😋":         "大盛り ガッツリ系 ボリューム 定食",
    "ドカ食いしたい🤤":   "食べ放題 バイキング 大盛り 焼肉 ビュッフェ",
    // 旧オプション（後方互換）
    "ペコペコ🫡":         "大盛り 食べ放題 ガッツリ系 ボリューム満点",
    "ほどほど":           "ランチ 定食 軽食",
    "軽く食べたい":       "軽食 スナック カフェ テイクアウト",
    "ドカ食いしたい":     "食べ放題 バイキング 大盛り 焼肉 ビュッフェ",
  },
  "どのくらいの距離感がいい？": {
    "近場がいい🚶":             "近場 徒歩圏内 すぐ近く",
    "少し遠くてもOK🚃":         "電車 近隣エリア 少し遠め",
    "遠くてOK🚗":               "車 隣町 遠め",
    "美味しければ遠くても！✈️": "遠距離 有名店 名店 評判",
    // 新しい food_distance オプション
    "近場（歩きでも行ける距離）":        "近場 徒歩圏内 すぐ近く 徒歩",
    "多少（駅１、２隣）":               "電車 隣駅 近隣 ひと駅",
    "ほどほど遠く（電車で３０分ほど）":  "電車 30分 少し遠め 乗り換え",
    "ガッツリ遠くてもOK（１つ県外でも）": "遠距離 ドライブ 隣県 名店 評判 人気",
    // 旧オプション（後方互換）
    "近場🚶（歩きで行ける距離）":       "近場 徒歩圏内 すぐ近く 徒歩",
    "多少歩く🚃（駅1、2隣）":          "電車 隣駅 近隣 ひと駅",
    "電車使う🚇（電車30分ほど）":       "電車 30分 少し遠め 乗り換え",
    "ガッツリ遠くてもOK🚗（1つ県外でも）": "遠距離 ドライブ 隣県 名店 評判 人気",
  },
  "どんな場所で食べたい？": {
    "自然の中で食事🌿": "自然 森 公園 テラス席 アウトドア 緑 木立",
    "海辺で食事🌊":     "海 海辺 ビーチ テラス 海岸 マリン 海鮮",
  },
  "食べたい味は？": {
    "ジャンク🍟":         "ハンバーガー ラーメン 揚げ物 焼肉 ジャンクフード",
    "あっさり🍵":         "和食 そば うどん 鍋 ヘルシー さっぱり",
    "辛いもの🌶️":         "カレー 韓国料理 四川 激辛 スパイシー",
    "甘いもの🍰":         "スイーツ パフェ ケーキ カフェ デザート",
    // 旧オプション（後方互換）
    "ジャンク・がっつり": "ハンバーガー ラーメン 揚げ物 焼肉 ジャンクフード",
    "あっさり系":         "和食 そば うどん 鍋 ヘルシー さっぱり",
    "辛いもの🌶":         "カレー 韓国料理 四川 激辛 スパイシー",
  },
  "食べたいジャンルは？": {
    // ── 新ジャンル選択肢（お腹すいた新フロー）────────────────────────────
    "居酒屋🍺":           "居酒屋 飲み屋 酒場 大衆酒場",
    "和食🍣":             "和食 日本料理 寿司 天ぷら",
    "洋食🍳":             "洋食 ハンバーグ オムライス ステーキ",
    "イタリアン🍝":       "イタリアン パスタ ピザ",
    "中華🥟":             "中華料理 餃子 チャーハン 麻婆豆腐",
    "焼肉🥩":             "焼肉 ホルモン 肉料理 BBQ",
    "韓国🌶️":             "韓国料理 チゲ サムギョプサル チーズタッカルビ",
    "アジア系統🍛":       "アジア料理 エスニック カレー タイ ベトナム インド",
    "各国料理🌍":         "各国料理 エスニック シュラスコ タコス",
    "ラーメン🍜":         "ラーメン 麺料理 つけ麺 豚骨",
    "お好み焼き・もんじゃ🥞": "お好み焼き もんじゃ 鉄板焼き",
    "カフェ・スイーツ☕":  "カフェ スイーツ ケーキ パフェ パンケーキ",
    "高層ビル料理🏙️":    "展望レストラン 高層階 スカイダイニング 夜景",
    // ── 旧オプション（後方互換）────────────────────────────────────────
    "ご飯もの🍚": "定食 丼 おにぎり 和食 ご飯",
    "麺類🍜":     "ラーメン うどん そば パスタ 麺",
    "洋食🍝":     "ハンバーグ パスタ ステーキ 洋食 ピザ",
    "スイーツ🍰": "スイーツ パフェ ケーキ カフェ パティスリー デザート",
    "和食":       "寿司 天ぷら 居酒屋 和定食 日本料理",
    "洋食":       "パスタ ステーキ イタリアン フレンチ ピザ",
    "中華":       "中華料理 餃子 点心 飲茶 担々麺",
    "エスニック": "タイ料理 ベトナム 韓国 インド エスニック",
  },
  "お店の雰囲気は？": {
    "賑やか🎉":   "賑やか 大衆的 居酒屋 活気 にぎわい",
    "静か✨":     "落ち着いた 静かな 隠れ家 個室 大人向け",
    "おしゃれ💅": "おしゃれ スタイリッシュ インスタ映え フォトジェニック",
    "密室🔒":     "個室 プライベート 半個室 仕切り",
    // 旧オプション（後方互換）
    "賑やか":         "賑やか 大衆的 居酒屋 活気 にぎわい",
    "静か・落ち着き": "落ち着いた 静かな 隠れ家 個室 大人向け",
    "おしゃれ":       "おしゃれ スタイリッシュ インスタ映え フォトジェニック",
    "レトロ":         "レトロ 昭和 老舗 喫茶店 懐かしい",
  },
  "どんなペースで食べたい？": {
    "サクッと食べる⚡": "ラーメン 丼 ファストフード テイクアウト 回転早い",
    "座ってゆっくり🪑": "ファミレス カフェ レストラン ゆっくり 座席",
    "食べ放題🍽️":       "食べ放題 バイキング ビュッフェ 食べ尽くし",
  },
  // ── まったりしたい ─────────────────────────────────
  "どこで癒やされたい？": {
    "自然の中🌿":     "公園 自然 森 緑 アウトドア 癒やし",
    "カフェ☕":       "カフェ コーヒー 室内 ゆったり 落ち着き",
    "温泉・スパ♨️":  "温泉 スパ 銭湯 サウナ リラクゼーション",
    "絶景スポット🌅": "絶景 展望台 景色がいい 眺め 夜景",
    // 旧オプション（後方互換）
    "室内カフェ☕":   "カフェ コーヒー 室内 ゆったり 落ち着き",
    "景色のいい場所": "絶景 展望台 景色がいい 眺め 夜景",
  },
  "くつろぐ姿勢は？": {
    "ソファでのんびり🛋️":     "カフェ ソファ席 ゆったり リクライニング ラウンジ",
    "足を伸ばしたい🦵":       "公園 芝生 広場 グリーン 自然",
    "寝っ転がりたい💤":       "芝生 草地 広い公園 リラクゼーション くつろぎ",
    "景色見ながら歩きたい🚶": "遊歩道 散策路 公園 ウォーキング 景色",
  },
  "景観の希望は？": {
    "山や森🌲":     "山 森林 緑 木々 自然林 ハイキング",
    "海辺🌊":       "海 砂浜 ビーチ 海岸 波 マリン",
    "こだわらない！": "",
  },
  // ── わいわい楽しみたい ─────────────────────────────
  "体を動かす量は？": {
    "たくさん動きたい💪":   "スポーツ アクティビティ 体験 アクティブ 運動",
    "あまり動きたくない😴": "アミューズメント カラオケ ゲームセンター 室内 観覧",
    "どちらでもOK🤷":      "レジャー 娯楽 エンターテイメント",
    // 旧オプション（後方互換）
    "ほどよく動く":         "スポーツ アクティビティ 中程度",
    "あまり動きたくない":   "アミューズメント カラオケ ゲーム",
    "どちらでもOK":         "レジャー 娯楽",
  },
  "遊びのジャンルは？": {
    "ゲーム・勝負系🎮":   "ゲームセンター ボウリング ビリヤード eスポーツ 卓球",
    "見る・体験系👀":     "水族館 動物園 博物館 美術館 映画館",
    "ものづくり・創作🎨": "陶芸 ガラス細工 料理教室 クラフト体験 工房",
    "街を散歩🗺️":         "商店街 観光地 ショッピング 街歩き マーケット",
    // 旧オプション（後方互換）
    "見る・体験系":       "水族館 動物園 博物館 美術館 映画館",
    "ものづくり・創作":   "陶芸 ガラス細工 料理教室 クラフト体験",
    "街を散策🗺":         "商店街 観光地 ショッピング 街歩き マーケット",
  },
  "どのくらいの規模の場所で遊びたい？": {
    "大きな施設で🏰": "遊園地 テーマパーク 大型施設 ラウンドワン",
    "手軽にサクッと⚡": "カラオケ ボウリング ゲームセンター 気軽",
  },
  // ── 自然感じたい ───────────────────────────────────
  "どの自然の景色を見たい？": {
    "海・川・湖🌊": "海 川 湖 水辺 海岸 砂浜 マリン 水景",
    "山・森🌲":     "山 森 林 緑 登山口 ハイキング 自然林",
    // 旧オプション（後方互換）
    "海・川・湖":   "海 川 湖 水辺 海岸 砂浜 マリン 水景",
    "山・森林🌲":   "山 森 林 緑 登山口 ハイキング 自然林",
    "花畑・草原🌸": "花畑 草原 コスモス ひまわり ラベンダー フラワーパーク",
    "夕日・星空🌅": "展望台 夕日スポット 星空 天文台 景色",
  },
  "自然の中でどのように過ごしたい？": {
    "景色を眺める👀":     "展望台 絶景 ビュースポット ベンチ のんびり",
    "カフェでまったり☕": "自然カフェ 森のカフェ テラスカフェ 緑",
    "自然の中を散歩🚶":   "散策路 遊歩道 ハイキングコース 公園",
    // 旧オプション（後方互換）
    "ぼーっと眺める":     "休憩 ベンチ 展望台 のんびり 芝生",
    "散歩・ハイキング🚶": "散策路 遊歩道 ハイキングコース トレイル",
    "写真を撮る📸":       "フォトスポット 映えスポット 絶景撮影",
    "カフェでまったり":   "自然カフェ 森のカフェ テラスカフェ 緑",
    "自然の中でどう過ごしたい？": "",
  },
  "どのくらいの規模の自然？": {
    "近場の公園🌳":           "公園 緑地 街の公園 身近な自然",
    "整備された綺麗な公園🌸": "植物園 日本庭園 整備された公園 庭園",
    "広大な自然や絶景🏔":     "国立公園 自然公園 絶景スポット 大自然",
    // 旧オプション（後方互換）
    "整備された公園・庭園": "植物園 日本庭園 整備された公園 庭園",
    "広大な自然・絶景🏔":   "国立公園 自然公園 絶景スポット 大自然",
    "どこでもいい":         "",
  },
  "目に映る景色はどのようなものが理想？": {
    "季節の花々🌸": "花 季節の花 梅 桜 ひまわり コスモス 紅葉 花見",
    "街一望🏙️":     "展望台 パノラマ 街一望 スカイライン",
    "360°木々🌲":   "森林 木々 緑のトンネル 新緑 自然林",
    "海辺🏖️":       "海辺 砂浜 ビーチ 海岸 波 磯",
    // 旧オプション（後方互換）
    "街の眺め・パノラマ": "展望台 パノラマ 街一望 スカイライン",
    "木々に囲まれた森":   "森林 木々 緑のトンネル 新緑 自然林",
    "海辺・砂浜🏖":       "海辺 砂浜 ビーチ 海岸 波 磯",
  },
  // ── ドライブしたい ─────────────────────────────────
  "道路は？": {
    "一般道メイン🛣️": "一般道 下道 近場 地元 景色 道の駅 ドライブコース",
    "高速も使う🏎️":   "高速 遠出 県外 観光地 旅行 サービスエリア 遠距離",
    "どちらでも":     "",
    // 旧オプション（後方互換）
    "一般道メイン 🛣️": "一般道 下道 近場 地元 景色 道の駅 ドライブコース",
    "高速も使う 🏎️":   "高速 遠出 県外 観光地 旅行 サービスエリア 遠距離",
  },
  "雰囲気は？": {
    "絶景🌅":   "展望台 絶景 ビュースポット 景色がいい 夕日",
    "休憩☕":   "道の駅 サービスエリア 休憩スポット カフェ",
    "遊べる🎡": "アクティビティ テーマパーク 体験施設 レジャー",
    "穴場🗺️":  "穴場 秘境 隠れスポット マニアック",
    // 旧オプション（後方互換）
    "絶景（景色）":   "展望台 絶景 ビュースポット 景色がいい",
    "休憩（チル）":   "道の駅 サービスエリア 24時間営業 休憩スポット",
    "遊べる（体験）": "アクティビティ テーマパーク 体験施設",
    "穴場（冒険）":   "穴場 秘境 隠れスポット マニアック",
  },
  "走りたい道は？": {
    "海沿い🌊": "海沿いドライブ 海岸線 マリンドライブ 海",
    "山⛰️":     "峠道 ワインディング 山岳道路 ドライブウェイ 山",
    "都会🌃":   "夜景スポット 展望台 タワー ランドマーク 都市 橋 夜景",
    // 旧オプション（後方互換）
    "海沿い 🌊":     "海沿いドライブ 海岸線 マリンドライブ 海",
    "山・峠道 ⛰️":   "峠道 ワインディング 山岳道路 ドライブウェイ 山",
    "都会の夜景 🌃": "夜景スポット 展望台 タワー ランドマーク スカイライン 都市 橋 夜景",
    "広い国道 🛣️":   "道の駅 国道 ドライブイン サービスエリア",
    "海沿い":        "海沿いドライブ 海岸線 マリンドライブ",
    "山・峠道":      "峠道 ワインディング 山岳道路 ドライブウェイ",
    "都会の夜景":    "夜景スポット 展望台 タワー スカイライン 都市",
    "広い国道":      "道の駅 国道 ドライブイン",
  },
  "目的地での過ごし方は？": {
    "食事🍽️":                "道の駅 地元グルメ 名物 食事処 レストラン",
    "景色🌅":                 "展望台 絶景スポット ビュースポット 夕日 海",
    "体験・アクティビティ🎡": "テーマパーク アクティビティ 観光地 体験施設",
    "ショッピング🛍️":         "アウトレット ショッピングモール お土産 道の駅",
    "散歩🚶":                 "公園 道の駅 散策 商店街 観光地",
    "休息💤":                 "道の駅 休憩 サービスエリア コーヒー パーキング",
    // 旧オプション（後方互換）
    "景色を楽しむ🌅":       "展望台 絶景スポット ビュースポット 夕日 海",
    "体験・アクティビティ": "テーマパーク アクティビティ 観光地 体験施設",
    "散歩・ぶらぶら":       "公園 道の駅 散策 商店街 観光地",
    "車から出ない":         "ドライブイン 夜景スポット 車窓",
    "軽く散策":             "公園 道の駅 散策 少し歩く",
    "ガッツリ遊ぶ":         "テーマパーク アクティビティ 観光地",
    "旨いもん食う":         "道の駅 地元グルメ 名物 食事処",
  },
  // ── 映えたい ────────────────────────────────────────
  "どこで映えたい？": {
    "カフェ・スイーツ☕": "フォトジェニックカフェ おしゃれカフェ インスタ映え スイーツ パフェ",
    "自然・絶景🌅":       "絶景 展望台 フォトスポット 夕日 自然景色 映えスポット",
    "街並み・建築🏛️":    "おしゃれな街並み 歴史的建築 フォトスポット 映える建物 レトロ",
    "アート・体験🎨":     "アート 美術館 体験型 インスタレーション イベント",
  },
  "どんな雰囲気の写真が撮りたい？": {
    "おしゃれな内装💅":   "インテリアおしゃれ カフェ デザイナーズ フォトジェニック内装",
    "絶景・パノラマ🌄":   "絶景 パノラマ 展望台 広大 景色",
    "路地裏・レトロ🏚️":   "路地裏 レトロ 昭和 下町 ノスタルジック",
    "モダン・アート🖼️":   "現代アート ギャラリー モダン ミュージアム インスタレーション",
  },
  "撮り方のスタイルは？": {
    "友達と撮り合い📸":  "フォトスポット 映えカフェ 記念撮影 グループ",
    "自撮りメイン🤳":    "自撮り 鏡 インテリア映え カフェ おしゃれ",
    "景色だけ楽しみたい🌿": "絶景 景色 自然 展望 風景",
    "こだわらない！":    "フォトジェニック インスタ映え 写真",
  },
  // ── 集中したい ─────────────────────────────────────
  "何をする？": {
    "勉強・受験📖":             "自習室 図書館 勉強カフェ 静かな席 受験生OK",
    "PC作業・リモートワーク💻": "コワーキング WiFi完備 電源あり ビジネスカフェ",
    "読書📚":                   "図書館 静かなカフェ 読書コーナー 本屋カフェ",
    "創作・趣味✏️":             "カフェ 作業スペース 個室 集中できる",
  },
  "必須の設備は？": {
    "wifi・電源🔌": "WiFi完備 電源コンセント フリーWiFi 作業カフェ コワーキング",
    "静かな机🪑":   "静かな 落ち着いた テーブル席 図書館 自習室",
    "飲み物☕":     "カフェ ドリンク充実 コーヒー 飲み物あり",
    // 旧オプション（後方互換）
    "Wi-Fi・電源が必須🔌": "WiFi完備 電源コンセント フリーWiFi 作業カフェ",
    "静かな机があれば十分": "静かな 落ち着いた テーブル席 図書館",
    "飲み物が欲しい☕":     "カフェ ドリンク充実 コーヒー",
    "特になし":             "",
  },
  "雑音の許容度は？": {
    "無音に近い方が良い🔇":     "図書館 無音 防音 完全に静か 自習室",
    "適度なざわつき🔉":         "カフェ 適度な音 BGM 賑やかすぎない",
    "多少賑やかでも大丈夫🔊":   "コワーキング ファミレス 賑やか目",
    "BGM程なら🎵":              "カフェ 音楽あり BGM",
    // 旧オプション（後方互換）
    "無音に近い方がいい":   "図書館 無音 防音 完全に静か",
    "適度なざわつきがいい": "カフェ 適度な音 BGM 賑やかすぎない",
    "多少賑やかでも大丈夫": "コワーキング ファミレス 賑やか目",
    "BGM程度なら":          "カフェ 音楽あり BGM",
  },
  // ── 体を動かしたい ─────────────────────────────────
  "運動の強度は？": {
    "ガッツリ汗をかきたい💪": "ジム フィットネス スポーツ 本格的 激しい運動",
    "ほどよく動きたい🏃":     "スポーツ アクティビティ 中程度の運動",
    "軽く散歩程度🚶":         "散歩 ウォーキング 公園 遊歩道 軽い運動",
    "外に出るだけでOK🌞":     "公園 広場 散策 外出 気分転換",
    // 旧オプション（後方互換）
    "がっつり汗をかきたい💪": "ジム フィットネス スポーツ 本格的 激しい運動",
    "ほどよく動きたい":       "スポーツ アクティビティ 中程度の運動",
    "外に出るだけでOK":       "公園 広場 散策 外出 気分転換",
  },
  "どんな運動？": {
    "スポーツ・競技🏀":           "バスケ テニス 卓球 バドミントン スポーツ施設",
    "ランニング・ウォーキング🏃": "公園 ランニングコース サイクリング 遊歩道",
    "アウトドア・ハイキング🏔":   "登山 ハイキング トレイル 自然",
    "水泳・プール🏊":             "プール 海水浴 水泳 マリンスポーツ",
    // 旧オプション（後方互換）
    "ランニング・ウォーキング": "公園 ランニングコース サイクリング 遊歩道",
    "アウトドア・ハイキング":   "登山 ハイキング トレイル 自然",
  },
  "場所は？": {
    "室内施設・ジム🏋️":       "ジム フィットネス スポーツセンター 屋内",
    "広い公園・グラウンド⚽":  "大きな公園 グラウンド 運動場 広場",
    "山・自然の中🌲":          "山 登山 ハイキング 自然公園",
    "海・川・湖🌊":            "海 川 湖 マリンスポーツ 水辺",
    // 旧オプション（後方互換）
    "屋内施設・ジム":       "ジム フィットネス スポーツセンター 屋内",
    "広い公園・グラウンド": "大きな公園 グラウンド 運動場 広場",
    "山・自然の中":         "山 登山 ハイキング 自然公園",
  },
  // ── 遠くに行きたい ─────────────────────────────────
  "どのくらい時間がある？": {
    "午前中のみ⏰":   "近場 日帰り 半日 気軽",
    "夕方まで🌆":     "日帰り 観光 1日",
    "日跨ぐ前まで🌙": "日帰り 遠方 ドライブ 長距離",
    "日越してもOK🌟": "宿泊 旅行 遠方 旅館 ホテル",
    // 旧オプション（後方互換）
    "午前中のみ":   "近場 日帰り 半日 気軽",
    "夕方まで":     "日帰り 観光 1日",
    "日跨ぐ前まで": "日帰り 遠方 ドライブ",
    "日越してもOK": "宿泊 旅行 遠方 旅館",
  },
  "行きたい場所のイメージは？": {
    "自然・山・海🌊":   "自然 山 海 湖 国立公園 絶景",
    "観光地・名所⛩️":  "神社 仏閣 名所 史跡 観光スポット",
    "温泉・リゾート♨️": "温泉 旅館 リゾート スパ 宿泊",
    "都市・異文化🌆":   "都市 ショッピング グルメ 異文化 観光",
    // 旧オプション（後方互換）
    "観光地・名所⛩": "神社 仏閣 名所 史跡 観光スポット",
    "都市・異文化":   "都市 ショッピング グルメ 異文化 観光",
  },
  "旅の目的は？": {
    "非日常を味わいたい✨": "非日常 特別体験 ユニーク 珍しい テーマパーク",
    "絶景を見たい🌅":       "絶景 展望台 景色 自然美 夕日",
    "楽しみたい🎉":         "遊び場 エンタメ アミューズメント 観光",
    "ゆっくり過ごしたい😴": "温泉 のんびり リゾート ゆったり 旅館",
    // 旧オプション（後方互換）
    "非日常を味わいたい":   "非日常 特別体験 ユニーク 珍しい",
    "絶景を見たい":         "絶景 展望台 景色 自然美",
    "美食を楽しみたい🍽️":   "グルメ 名物料理 地元料理 食べ歩き",
    "ゆっくり過ごしたい":   "温泉 のんびり リゾート ゆったり",
  },
  // ── 旧問（後方互換） ────────────────────────────────
  "重視するのは？": {
    "コスパ🤑":     "コスパ最強 安い リーズナブル 千円以内 学生向け",
    "質・こだわり": "本格 こだわり 高品質 名店 職人",
    "ボリューム":   "大盛り ボリューム 食べ放題 がっつり",
    "映え✨":       "インスタ映え フォトジェニック おしゃれ 写真映え",
  },
  "どんなお店に行きたい？": {
    "人気の有名店": "人気店 名店 行列 ミシュラン 食べログ高評価",
    "隠れ家的お店": "隠れ家 穴場 路地裏 知る人ぞ知る",
    "定番・安心感": "定番 安心 老舗 チェーン",
    "話題の新店":   "新店 話題 オープン SNS最新",
  },
  "今の疲れ具合は？": {
    "体がヘトヘト💤": "ゆっくり座れる リクライニング 静かな ソファ",
    "目が疲れた😵":   "自然 緑 デジタルデトックス 森 川",
    "心がモヤモヤ🌀": "癒やし リラックス アロマ 自然 温泉",
    "ちょっと疲れた": "カフェ 公園 気軽 ほっと一息",
  },
  "どうやって休む？": {
    "ぼーっとする":     "公園 広場 何もしない 自然 のんびり",
    "読書・映画":       "カフェ 図書館 映画館 静かな 集中できる",
    "誰かとおしゃべり": "カフェ おしゃべり 落ち着いた 会話 テーブル席",
    "ひたすら食べる🍰": "スイーツ カフェ デザート食べ放題 パフェ",
  },
  "欲しい感覚は？": {
    "良い香り・アロマ🌸":   "アロマ フラワーショップ ガーデン 花 香り",
    "絶景・美しい景色":     "絶景 展望台 夕日 夜景 自然景色",
    "ふかふかの席":         "ソファ席 ゆったり リクライニング くつろぎ カフェ",
    "美味しいものを食べる": "スイーツ カフェ グルメ 名店 こだわり",
  },
  "盛り上がり度は？": {
    "全力で盛り上がりたい🎊": "テーマパーク アミューズメント 盛り上がる パーティー",
    "じっくり楽しみたい":     "博物館 美術館 体験施設 ゆったり観覧",
    "ゆるく楽しみたい":       "カフェ 散策 軽いアクティビティ のんびり",
    "その場のノリで":         "人気スポット 観光地 何でも楽しめる",
  },
  "スタイルは？": {
    "ガチでやり込みたい":   "スポーツ施設 体験 本格的 競技",
    "みんなで協力したい":   "グループ向け 協力型 チーム",
    "各自のペースで":       "個人プレー 自由参加 観覧",
    "初心者でも楽しみたい": "初心者OK 体験 入門 気軽",
  },
  "どこで遊ぶ？": {
    "涼しい屋内":     "屋内施設 空調完備 エアコン 室内",
    "開放的な屋外🌞": "屋外 公園 広場 オープンエア 自然",
    "どちらでもOK":   "",
    "移動しながら":   "街歩き 観光 散策コース めぐる",
  },
  "目的は？": {
    "健康・ダイエット":   "フィットネス ヘルスケア ウォーキング 健康",
    "ストレス解消":       "ランニング ストレス発散 スポーツ 運動",
    "純粋に楽しみたい":   "スポーツ体験 遊び 楽しい 競技",
    "新しいことに挑戦":   "初心者OK 体験 新しいスポーツ 未経験",
  },
  "移動ルートは？": {
    "高速使って遠出🏎️":      "高速 遠出 県外 長距離 サービスエリア",
    "下道メインでのんびり🛣️": "下道 一般道 道の駅 のんびりドライブ",
    "電車・新幹線🚄":          "駅 電車 新幹線 鉄道旅",
    "どちらでもOK":            "",
  },
  "どんなスポットに行きたい？": {
    "有名・定番観光地":     "有名 定番 名所 観光スポット 人気",
    "穴場・隠れた名所":     "穴場 マニアック 秘境 知られていない",
    "グルメ・名産品目当て": "地元グルメ 名産 食べ歩き ご当地",
    "体験・アクティビティ": "体験施設 アクティビティ 工場見学 農業体験",
  },
  "席の環境は？": {
    "個室・仕切りがいい":   "個室 仕切り席 半個室 プライベート感",
    "誰かいた方がはかどる": "コワーキング カフェ オープン",
    "窓際や隅っこ":         "窓際席 カウンター 端の席 落ち着いた場所",
    "開放的な空間":         "開放的 広い 天井高い 開放感",
  },
  "目に映る景色は？": {
    "季節の花々🌸":      "花 季節の花 梅 桜 ひまわり コスモス 紅葉 花見",
    "街の眺め・パノラマ": "展望台 パノラマ 街一望 スカイライン",
    "木々に囲まれた森":   "森林 木々 緑のトンネル 新緑 自然林",
    "海辺・砂浜🏖":       "海辺 砂浜 ビーチ 海岸 波 磯",
  },
};

// 回答から検索キーワードを導出してAIプロンプトに注入するコンテキストを構築
function buildAnswerKeywordContext(answers: Answers): string {
  const lines: string[] = [];
  for (const dq of getDynamicQs(answers)) {
    const kw = DYNAMIC_ANSWER_KEYWORDS[dq.question]?.[dq.answer];
    if (kw) lines.push(`・「${dq.answer}」→ 【${kw}】`);
  }

  if (lines.length === 0) return "";
  return `【回答から導出した必須検索ワード（全クエリに必ず組み込む）】\n${lines.join("\n")}`;
}

// ユーザーの全回答を1文の「本音サマリー」に変換
function buildUserIntentSummary(answers: Answers): string {
  const parts: string[] = [];

  const compMap: Record<string, string> = {
    一人: "一人で", 友達: "友達と", 恋人: "恋人と",
    家族: "家族と", 大人数グループ: "グループで", 先輩: "先輩と",
  };
  if (answers.companion) parts.push(compMap[answers.companion] ?? answers.companion);
  if (answers.mood) parts.push(answers.mood);

  for (const dq of getDynamicQs(answers)) {
    // 絵文字を除いた回答テキストを追加
    const clean = dq.answer.replace(
      /[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ""
    ).trim();
    if (clean) parts.push(clean);
  }

  if (answers.atmosphere) parts.push(`${answers.atmosphere}な雰囲気`);
  if (answers.priority) parts.push(`${answers.priority}重視`);
  if (answers.freeWord) parts.push(answers.freeWord);

  if (parts.length === 0) return "";
  return `【ユーザーの本音サマリー（全クエリの最優先指針）】「${parts.join("・")}」\n→ このサマリーに沿ったスポットを探すことを最優先とし、8件のクエリ全体がこの意図を満たすように設計してください`;
}

// ユーザープロファイル文字列を構築する関数
function buildUserProfile(answers: Answers): string {
  const parts: string[] = [];

  if (answers.mood) parts.push(`気分：${answers.mood}`);

  if (answers.companion) parts.push(`同行者：${answers.companion}`);

  if (answers.time) {
    const hoursLabel = (() => {
      switch (answers.time) {
        case "15〜30分": return "〜30分";
        case "30〜60分": return "〜1時間";
        case "1〜2時間": return "1〜2時間";
        case "2〜4時間": return "半日（2〜4時間）";
        case "4〜6時間": return "半日（4〜6時間）";
        case "6時間以上": return "終日（6時間以上）";
        default: return answers.time;
      }
    })();
    parts.push(`所要時間：${hoursLabel}`);
  }

  const transports = getTransports(answers.transport);
  if (transports.length > 0) parts.push(`移動手段：${transports.join("・")}`);

  const budgetLabel = (() => {
    if (answers.budget === undefined || answers.budget === null) return null;
    if (answers.budget === 0) return "無料";
    if (answers.budgetMin && answers.budgetMin > 0) {
      return `${answers.budgetMin.toLocaleString("ja-JP")}円〜${answers.budget.toLocaleString("ja-JP")}円`;
    }
    if (answers.budget <= 500) return `〜${answers.budget.toLocaleString("ja-JP")}円`;
    return `〜${answers.budget.toLocaleString("ja-JP")}円`;
  })();
  if (budgetLabel) parts.push(`予算：${budgetLabel}`);

  // 全動的質問回答を組み込む
  const allDynQs = getDynamicQs(answers);
  if (allDynQs.length > 0) {
    parts.push(`気分詳細：${allDynQs.map(dq => `${dq.question}：${dq.answer}`).join(" / ")}`);
  }

  if (answers.atmosphere) parts.push(`雰囲気：${answers.atmosphere}`);
  if (answers.priority) parts.push(`優先：${answers.priority}`);
  if (answers.freeWord) parts.push(`フリーワード：${answers.freeWord}`);

  const areaStr = answers.area;
  if (areaStr) parts.push(`エリア：${areaStr}`);

  return parts.join(" / ");
}

// ─── Yahoo!ローカルサーチ / OpenStreetMap Overpass API 統合 ─────────────────

/**
 * 汎用外部APIスコアリング（食事以外にも使える）
 * editorialSummary・amenityTags・rating・userRatingCount・距離を総合評価
 */
function scoreExternalItem(
  item: {
    editorialSummary: string;
    amenityTags: string[];
    location?: { latitude: number; longitude: number };
    rating?: number | null;
    userRatingCount?: number | null;
  },
  answers: Answers,
  timeCtx: ReturnType<typeof getTimeContext>
): number {
  let score = 50;

  // rating ボーナス
  if (typeof item.rating === "number") score += item.rating * 5;

  // userRatingCount ボーナス（最大8）
  if (typeof item.userRatingCount === "number") {
    score += Math.min(item.userRatingCount / 50, 8);
  }

  const text = item.editorialSummary.toLowerCase();

  // 同行者ボーナス
  if (answers.companion === "一人" && (text.includes("一人") || text.includes("ソロ"))) score += 6;
  if ((answers.companion === "恋人" || answers.companion === "恋人・パートナー") && (text.includes("デート") || text.includes("カップル") || text.includes("ロマン"))) score += 6;
  if (answers.companion === "家族" && (text.includes("家族") || text.includes("子連れ") || text.includes("キッズ"))) score += 6;
  if (answers.companion === "友達" && (text.includes("グループ") || text.includes("みんな") || text.includes("わいわい"))) score += 5;

  // mood ボーナス
  if (answers.mood === "ドライブしたい" && (text.includes("絶景") || text.includes("展望"))) score += 8;
  if (answers.mood === "体を動かしたい" && (text.includes("スポーツ") || text.includes("アクティビティ") || text.includes("運動"))) score += 8;
  if (answers.mood === "自然感じたい" && (text.includes("自然") || text.includes("公園") || text.includes("緑") || text.includes("景色"))) score += 10;
  if (answers.mood === "自然感じたい" && (text.includes("カフェ") || text.includes("飲食"))) score -= 5;

  // 時間帯ボーナス（timeCtxを使う・未使用警告回避）
  if (timeCtx.isEvening && (text.includes("夜景") || text.includes("ディナー"))) score += 3;
  if (timeCtx.isMorning && text.includes("モーニング")) score += 3;

  // 距離ボーナス/ペナルティ（Haversine）
  if (answers.originLat && answers.originLng && item.location) {
    const dLat = (item.location.latitude - answers.originLat) * Math.PI / 180;
    const dLng = (item.location.longitude - answers.originLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(answers.originLat * Math.PI / 180)
      * Math.cos(item.location.latitude * Math.PI / 180)
      * Math.sin(dLng / 2) ** 2;
    const distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (distKm < 1.0) score += 8;
    else if (distKm < 3.0) score += 4;
    else if (distKm > 10.0) score -= 6;
  }

  return score;
}

/**
 * answersとtimeCtxからYahoo!ローカルサーチ用キーワードを構築（最大60文字）
 */
function buildYahooKeyword(answers: Answers, timeCtx: ReturnType<typeof getTimeContext>): string {
  const parts: string[] = [];

  // 動的Q回答からキーワードを変換
  for (const dq of getDynamicQs(answers)) {
    const kw = DYNAMIC_ANSWER_KEYWORDS[dq.question]?.[dq.answer];
    if (kw) parts.push(kw.split(" ")[0]); // 先頭キーワード1語
  }

  // フリーワード
  if (answers.freeWord) parts.push(answers.freeWord);

  // 雰囲気をキーワードに変換
  const atmosphereMap: Record<string, string> = {
    静か: "静か 落ち着き",
    賑やか: "にぎやか 活気",
    アクティブ: "アクティビティ 体験",
    スリル: "スリル アドベンチャー",
    ロマンティック: "夜景 ロマンティック",
    アットホーム: "アットホーム",
  };
  if (answers.atmosphere) {
    const ak = atmosphereMap[answers.atmosphere];
    if (ak) parts.push(ak.split(" ")[0]);
  }

  // 時間帯キーワード（timeCtxを使う・未使用警告回避）
  if (timeCtx.isLateNight) parts.push("深夜営業");

  return parts.filter(Boolean).join(" ").slice(0, 60);
}

/** Yahoo!ローカルサーチAPIからスポットを取得して ScoredItem[] に正規化 */
async function fetchYahooLocalSearch(
  lat: number,
  lng: number,
  radiusKm: number,
  keyword: string,
  answers: Answers,
  timeCtx: ReturnType<typeof getTimeContext>
): Promise<ScoredItem[]> {
  const apiKey = process.env.YAHOO_LOCAL_SEARCH_API_KEY;
  if (!apiKey) return [];
  try {
    const params = new URLSearchParams({
      appid: apiKey,
      lat: String(lat),
      lon: String(lng),
      dist: String(Math.min(radiusKm, 10)),
      results: "20",
      sort: "score",
      output: "json",
      open: "now",
      ...(keyword ? { query: keyword } : {}),
    });
    const res = await fetch(
      `https://map.yahooapis.jp/search/local/V1/localSearch?${params}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const features: Record<string, unknown>[] = json.Feature ?? [];

    return features.map((f) => {
      const name = String(f.Name ?? "");
      const prop = (f.Property ?? {}) as Record<string, unknown>;
      const address = String(prop.Address ?? "");
      const openTime = String(prop.OpenTime ?? "");
      const genres = (prop.Genre as Array<Record<string, unknown>>) ?? [];
      const genreName = String(genres[0]?.Name ?? "");
      const ratingObj = (prop.Rating ?? {}) as Record<string, unknown>;
      const rating = typeof ratingObj.Star === "number" ? ratingObj.Star : null;
      const ratingCount = typeof ratingObj.Count === "number" ? ratingObj.Count : null;
      const detail = (prop.Detail ?? {}) as Record<string, unknown>;
      const url = String(detail.Url ?? "");
      const mapUrl = url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + " " + address)}`;

      // 座標を "lng,lat" 形式からパース
      const coordsStr = String((f.Geometry as Record<string, unknown>)?.Coordinates ?? "");
      const coordParts = coordsStr.split(",");
      const fLng = parseFloat(coordParts[0] ?? "0");
      const fLat = parseFloat(coordParts[1] ?? "0");
      const location = (fLat && fLng) ? { latitude: fLat, longitude: fLng } : undefined;

      // bucketをジャンル名から決定
      const gn = genreName.toLowerCase();
      let bucket: Bucket = "spot";
      if (/飲食|レストラン|カフェ|グルメ/.test(gn)) bucket = "food";
      else if (/観光|スポット|名所/.test(gn)) bucket = "spot";
      else if (/スポーツ|アウトドア/.test(gn)) bucket = "activity";
      else if (/自然|公園|景色/.test(gn)) bucket = "scenic";
      else {
        // moodベースのフォールバック
        if (answers.mood === "お腹すいた") bucket = "food";
        else if (answers.mood === "ドライブしたい") bucket = "scenic";
        else if (answers.mood === "体を動かしたい") bucket = "activity";
        else if (answers.mood === "ゆっくりしたい") bucket = "relax";
        else if (answers.mood === "楽しみたい") bucket = "activity";
      }

      const editorialSummary = genreName;
      const score = scoreExternalItem(
        { editorialSummary, amenityTags: [], location, rating, userRatingCount: ratingCount },
        answers,
        timeCtx
      );

      return {
        title: name,
        vibe: answers.mood || "",
        budget: answers.budget ? `〜¥${answers.budget.toLocaleString("ja-JP")}` : "",
        time: answers.time || "",
        address,
        mapUrl,
        rating,
        userRatingCount: ratingCount,
        photoUrl: "",
        photoUrls: [],
        openingHoursText: openTime,
        distanceText: "",
        durationText: "",
        openNow: undefined,
        priceLevel: undefined,
        stationText: "",
        location,
        bucket,
        score,
        editorialSummary,
        amenityTags: [],
        hasUserPhotos: false,
        userPhotoCount: 0,
        targetUser: undefined,
      } satisfies ScoredItem;
    }).filter((item) => item.title.length > 0);
  } catch (e) {
    console.warn("[recommend] Yahoo!ローカルサーチ fetch error:", e);
    return [];
  }
}

// ── まったりしたい専用 Yahoo!ローカルサーチ ──────────────────────────────────
// relax_place の回答に応じたキーワードで温泉・カフェ・公園・絶景を検索し
// relaxResults 形式（title/address/rating/location 等）の配列で返す
async function fetchYahooRelax(
  answers: Answers,
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<Array<{
  title: string; vibe: string; budget: string; time: string;
  address: string; mapUrl: string; rating: number | null;
  userRatingCount: number | null; photoUrl: string; photoUrls: string[];
  openingHoursText: string; distanceText: string; durationText: string;
  openNow: boolean | undefined; priceLevel: undefined; stationText: string;
  reason: string; features: string[]; isUserSpot: boolean;
  hasUserPhotos: boolean; userPhotoCount: number;
  location: { latitude: number; longitude: number } | undefined;
}>> {
  const apiKey = process.env.YAHOO_LOCAL_SEARCH_API_KEY;
  if (!apiKey) return [];

  // relax_place の回答からカテゴリを判定
  const dynQs = getDynamicQs(answers);
  const placeAns = dynQs.find(dq => dq.question.includes("どこで癒やされたい"))?.answer ?? "";
  const subChoiceRaw = dynQs.find(dq =>
    dq.question.includes("自然の中で") || dq.question.includes("カフェで") || dq.question.includes("どんな景色")
  )?.answer ?? "";
  const keywordsMatch = subChoiceRaw.match(/検索キーワード:\s*(.+?)）/);
  const subKeywords = keywordsMatch ? keywordsMatch[1].split(/\s+/).slice(0, 2) : [];

  // カテゴリ別キーワードリスト（複数クエリで幅広く取得）
  const queryList: string[] = [];
  if (placeAns.includes("温泉") || placeAns.includes("スパ")) {
    queryList.push("スーパー銭湯", "日帰り温泉", "サウナ");
  } else if (placeAns.includes("カフェ")) {
    queryList.push("カフェ", ...subKeywords);
  } else if (placeAns.includes("自然")) {
    queryList.push("公園", ...subKeywords);
  } else if (placeAns.includes("絶景")) {
    queryList.push("展望台", "夜景スポット");
  } else {
    queryList.push("スーパー銭湯");
  }

  const distKm = Math.min(radiusKm, 20); // Yahoo! ローカルサーチの上限は20km
  const seen = new Set<string>();
  const results: ReturnType<typeof fetchYahooRelax> extends Promise<infer T> ? T : never = [];

  for (const query of queryList) {
    if (results.length >= 20) break;
    try {
      const params = new URLSearchParams({
        appid: apiKey,
        lat: String(lat),
        lon: String(lng),
        dist: String(distKm),
        results: "20",
        sort: "score",
        output: "json",
        query,
      });
      const res = await fetch(
        `https://map.yahooapis.jp/search/local/V1/localSearch?${params}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (!res.ok) continue;
      const json = await res.json();
      const features: Record<string, unknown>[] = json.Feature ?? [];
      console.log(`[Yahoo Relax] query="${query}" → ${features.length}件`);

      for (const f of features) {
        const name = String(f.Name ?? "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);

        const prop = (f.Property ?? {}) as Record<string, unknown>;
        const address = String(prop.Address ?? "");
        const openTime = String(prop.OpenTime ?? "");
        const genres = (prop.Genre as Array<Record<string, unknown>>) ?? [];
        const genreName = String(genres[0]?.Name ?? "");
        const ratingObj = (prop.Rating ?? {}) as Record<string, unknown>;
        const rating = typeof ratingObj.Star === "number" ? ratingObj.Star : null;
        const ratingCount = typeof ratingObj.Count === "number" ? ratingObj.Count : null;
        const detail = (prop.Detail ?? {}) as Record<string, unknown>;
        const url = String(detail.Url ?? "");
        const mapUrl = url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + " " + address)}`;

        const coordsStr = String((f.Geometry as Record<string, unknown>)?.Coordinates ?? "");
        const coordParts = coordsStr.split(",");
        const fLng = parseFloat(coordParts[0] ?? "0");
        const fLat = parseFloat(coordParts[1] ?? "0");
        const location = (fLat && fLng) ? { latitude: fLat, longitude: fLng } : undefined;

        results.push({
          title: name,
          vibe: genreName,
          budget: "",
          time: answers.time || "",
          address,
          mapUrl,
          rating,
          userRatingCount: ratingCount,
          photoUrl: "",
          photoUrls: [],
          openingHoursText: openTime,
          distanceText: "",
          durationText: "",
          openNow: undefined,
          priceLevel: undefined,
          stationText: "",
          reason: genreName,
          features: [],
          isUserSpot: false,
          hasUserPhotos: false,
          userPhotoCount: 0,
          location,
        });
      }
    } catch (e) {
      console.warn(`[Yahoo Relax] query="${query}" エラー:`, e);
    }
  }

  return results;
}

/**
 * moodに応じたOverpass QLクエリを生成
 */
function buildOverpassQuery(lat: number, lng: number, radiusM: number, mood: string): string {
  const r = Math.round(radiusM);
  const center = `${lat},${lng}`;
  let nodes = "";

  if (mood === "ドライブしたい") {
    nodes = [
      `node["tourism"="viewpoint"](around:${r},${center});`,
      `way["tourism"="viewpoint"](around:${r},${center});`,
      `node["tourism"="attraction"](around:${r},${center});`,
      `way["tourism"="attraction"](around:${r},${center});`,
      `node["natural"="peak"](around:${r},${center});`,
      `way["natural"="peak"](around:${r},${center});`,
      `node["natural"="beach"](around:${r},${center});`,
      `way["natural"="beach"](around:${r},${center});`,
      `node["amenity"="parking"]["fee"="no"](around:${r},${center});`,
    ].join("");
  } else if (mood === "体を動かしたい") {
    nodes = [
      `node["leisure"="sports_centre"](around:${r},${center});`,
      `way["leisure"="sports_centre"](around:${r},${center});`,
      `node["leisure"="pitch"](around:${r},${center});`,
      `way["leisure"="pitch"](around:${r},${center});`,
      `node["leisure"="swimming_pool"](around:${r},${center});`,
      `way["leisure"="swimming_pool"](around:${r},${center});`,
      `node["leisure"="fitness_centre"](around:${r},${center});`,
      `way["leisure"="fitness_centre"](around:${r},${center});`,
      `node["natural"="peak"](around:${r},${center});`,
      `way["natural"="peak"](around:${r},${center});`,
    ].join("");
  } else {
    // 遠くに行きたい
    nodes = [
      `node["tourism"="attraction"](around:${r},${center});`,
      `way["tourism"="attraction"](around:${r},${center});`,
      `node["tourism"="museum"](around:${r},${center});`,
      `way["tourism"="museum"](around:${r},${center});`,
      `node["historic"="castle"](around:${r},${center});`,
      `way["historic"="castle"](around:${r},${center});`,
      `node["historic"="ruins"](around:${r},${center});`,
      `way["historic"="ruins"](around:${r},${center});`,
      `node["natural"="peak"](around:${r},${center});`,
      `way["natural"="peak"](around:${r},${center});`,
    ].join("");
  }

  return `[out:json][timeout:15];(${nodes});out center 20;`;
}

/** OSMタグ値を日本語に変換 */
function osmTagToJapanese(tags: Record<string, string>): string {
  const map: Record<string, string> = {
    viewpoint: "展望スポット",
    attraction: "観光スポット",
    peak: "山頂",
    beach: "ビーチ",
    sports_centre: "スポーツ施設",
    pitch: "グラウンド",
    swimming_pool: "プール",
    fitness_centre: "フィットネス施設",
    park: "公園",
    castle: "城",
    museum: "博物館",
    ruins: "遺跡",
    nature_reserve: "自然保護区",
  };

  const v =
    tags.tourism || tags.leisure || tags.natural || tags.historic || tags.amenity || "";
  return map[v] ?? v;
}

/** OSMタグからBucketを決定 */
function osmBucket(tags: Record<string, string>): Bucket {
  if (tags.tourism === "museum" || tags.historic) return "spot";
  if (tags.tourism === "viewpoint" || tags.natural === "peak" || tags.natural === "beach") return "scenic";
  if (tags.leisure === "sports_centre" || tags.leisure === "pitch" || tags.leisure === "swimming_pool" || tags.leisure === "fitness_centre") return "activity";
  if (tags.leisure === "park" || tags.natural) return "scenic";
  if (tags.tourism === "attraction") return "spot";
  return "spot";
}

/** OpenStreetMap Overpass APIからスポットを取得して ScoredItem[] に正規化 */
async function fetchOSMPlaces(
  lat: number,
  lng: number,
  radiusKm: number,
  mood: string,
  answers: Answers,
  timeCtx: ReturnType<typeof getTimeContext>
): Promise<ScoredItem[]> {
  try {
    const radiusM = radiusKm * 1000;
    const query = buildOverpassQuery(lat, lng, radiusM, mood);

    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const elements: Record<string, unknown>[] = json.elements ?? [];

    const items: ScoredItem[] = [];
    for (const el of elements) {
      const tags = (el.tags ?? {}) as Record<string, string>;
      const name = tags["name:ja"] || tags.name || "";
      if (!name) continue;

      // 座標（nodeは直接、wayはcenter）
      let elLat: number;
      let elLng: number;
      if (el.type === "node") {
        elLat = el.lat as number;
        elLng = el.lon as number;
      } else {
        const center = el.center as Record<string, number> | undefined;
        if (!center) continue;
        elLat = center.lat;
        elLng = center.lon;
      }
      if (!elLat || !elLng) continue;

      const location = { latitude: elLat, longitude: elLng };
      const openingHoursText = tags.opening_hours ?? "";
      const mapUrl = tags.website
        || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
      const address = tags["addr:full"] || [tags["addr:prefecture"], tags["addr:city"], tags["addr:street"]].filter(Boolean).join("");
      const editorialSummary = osmTagToJapanese(tags);
      const bucket = osmBucket(tags);

      const score = scoreExternalItem(
        { editorialSummary, amenityTags: [], location, rating: null, userRatingCount: null },
        answers,
        timeCtx
      );

      items.push({
        title: name,
        vibe: answers.mood || "",
        budget: answers.budget ? `〜¥${answers.budget.toLocaleString("ja-JP")}` : "",
        time: answers.time || "",
        address,
        mapUrl,
        rating: null,
        userRatingCount: null,
        photoUrl: "",
        photoUrls: [],
        openingHoursText,
        distanceText: "",
        durationText: "",
        openNow: undefined,
        priceLevel: undefined,
        stationText: "",
        location,
        bucket,
        score,
        editorialSummary,
        amenityTags: [],
        hasUserPhotos: false,
        userPhotoCount: 0,
        targetUser: undefined,
      } satisfies ScoredItem);
    }

    return items.slice(0, 20);
  } catch (e) {
    console.warn("[recommend] OSM Overpass fetch error:", e);
    return [];
  }
}

// ─── ぐるなび / ホットペッパー 外部フードAPI統合 ────────────────────────────

/** km → ぐるなび/ホットペッパー range パラメータ (1〜5, 最大3km) に変換 */
function kmToRange(km: number): number {
  if (km <= 0.3) return 1;
  if (km <= 0.5) return 2;
  if (km <= 1.0) return 3;
  if (km <= 2.0) return 4;
  return 5; // 3km (max)
}

/**
 * 外部フードAPI結果に対して質問回答を反映したスコアを計算する。
 * Google Placesほど情報が揃わないため、editorialSummaryとマッチ度で補正。
 */
function scoreExternalFoodItem(
  item: { editorialSummary: string; amenityTags: string[]; location?: { latitude: number; longitude: number } },
  answers: Answers,
  timeCtx: ReturnType<typeof getTimeContext>
): number {
  let score = 55;

  // editorialSummaryに質問回答関連キーワードが含まれていれば加点
  const text = item.editorialSummary.toLowerCase();

  // 誰と
  if (answers.companion === "一人" && (text.includes("一人") || text.includes("カウンター"))) score += 6;
  if ((answers.companion === "恋人・パートナー") && (text.includes("デート") || text.includes("カップル") || text.includes("個室"))) score += 6;
  if (answers.companion === "家族" && (text.includes("家族") || text.includes("子連れ") || text.includes("キッズ"))) score += 6;
  if (answers.companion === "友達" && (text.includes("グループ") || text.includes("宴会") || text.includes("わいわい"))) score += 5;

  // 雰囲気
  if (answers.atmosphere === "静か" && (text.includes("静か") || text.includes("落ち着") || text.includes("隠れ家"))) score += 5;
  if (answers.atmosphere === "賑やか" && (text.includes("にぎ") || text.includes("活気") || text.includes("大衆"))) score += 5;
  if (answers.atmosphere === "おしゃれ" && (text.includes("おしゃれ") || text.includes("スタイリッシュ") || text.includes("インスタ"))) score += 5;

  // 優先
  if (answers.priority === "コスパ" && (text.includes("コスパ") || text.includes("お得") || text.includes("安い"))) score += 5;
  if (answers.priority === "質の高さ" && (text.includes("本格") || text.includes("こだわり") || text.includes("名店"))) score += 6;
  if (answers.priority === "映え" && (text.includes("映え") || text.includes("フォトジェニック"))) score += 5;

  // 時間帯
  if (timeCtx.isLateNight && (text.includes("深夜") || text.includes("24時"))) score += 8;
  if (timeCtx.isEvening && (text.includes("ディナー") || text.includes("夜"))) score += 4;
  if (timeCtx.isDaytime && (text.includes("ランチ") || text.includes("昼"))) score += 4;

  // 写真・説明充実度ボーナス
  if (item.amenityTags.length > 0) score += 3;

  // 距離ペナルティ（originがある場合）
  if (answers.originLat && answers.originLng && item.location) {
    const dLat = (item.location.latitude - answers.originLat) * Math.PI / 180;
    const dLng = (item.location.longitude - answers.originLng) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(answers.originLat * Math.PI/180) * Math.cos(item.location.latitude * Math.PI/180) * Math.sin(dLng/2)**2;
    const distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    if (distKm < 0.5) score += 8;
    else if (distKm < 1.0) score += 4;
    else if (distKm > 2.5) score -= 5;
  }

  return score;
}

/** ぐるなびAPIからレストランを取得して ScoredItem[] に正規化 */
async function fetchGurunaviRestaurants(
  lat: number,
  lng: number,
  radiusKm: number,
  keyword: string,
  answers: Answers,
  timeCtx: ReturnType<typeof getTimeContext>
): Promise<ScoredItem[]> {
  const apiKey = process.env.GURUNAVI_API_KEY;
  if (!apiKey) return [];
  try {
    const range = kmToRange(radiusKm);
    const params = new URLSearchParams({
      keyid: apiKey,
      latitude: String(lat),
      longitude: String(lng),
      range: String(range),
      hit_per_page: "20",
      ...(keyword ? { freeword: keyword } : {}),
    });
    const res = await fetch(`https://api.gnavi.co.jp/RestSearchAPI/v3/?${params}`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const restaurants: Record<string, unknown>[] = json.rest ?? [];

    return restaurants.map((r) => {
      const name = String(r.name ?? "");
      const address = String(r.address ?? "");
      const rlat = parseFloat(String(r.latitude ?? "0"));
      const rlng = parseFloat(String(r.longitude ?? "0"));
      const photo = String((r.image_url as Record<string, unknown>)?.shop_image1 ?? "");
      const opentime = String(r.opentime ?? "");
      const budget = String((r.budget as Record<string, unknown>)?.lunch ?? (r.budget as Record<string, unknown>)?.dinner ?? "");
      const prShort = String((r.pr as Record<string, unknown>)?.pr_short ?? "");
      const prLong = String((r.pr as Record<string, unknown>)?.pr_long ?? "");
      const category = String(r.category ?? "");
      const accessWalk = String((r.access as Record<string, unknown>)?.walk ?? "");
      const accessStation = String((r.access as Record<string, unknown>)?.station ?? "");
      const stationText = accessStation ? `${accessStation}${accessWalk ? ` 徒歩${accessWalk}分` : ""}` : "";
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + " " + address)}`;
      const budgetText = budget ? `¥${budget}` : (answers.budget ? `〜¥${answers.budget.toLocaleString("ja-JP")}` : "");

      const editorialSummary = prShort || prLong.slice(0, 80) || category;
      const location = (rlat && rlng) ? { latitude: rlat, longitude: rlng } : undefined;
      const baseScore = scoreExternalFoodItem({ editorialSummary, amenityTags: [], location }, answers, timeCtx)
        + (prLong.length > 30 ? 4 : 0)  // 説明充実
        + (photo ? 4 : 0)               // 写真あり
        + (opentime ? 2 : 0);           // 営業時間あり

      return {
        title: name,
        vibe: answers.mood || "",
        budget: budgetText,
        time: answers.time || "",
        address,
        mapUrl,
        rating: null,
        userRatingCount: null,
        photoUrl: photo,
        photoUrls: photo ? [photo] : [],
        openingHoursText: opentime,
        distanceText: "",
        durationText: "",
        openNow: undefined,
        priceLevel: undefined,
        stationText,
        location,
        bucket: "food" as const,
        score: baseScore,
        editorialSummary,
        amenityTags: [],
        hasUserPhotos: false,
        userPhotoCount: 0,
        targetUser: undefined,
      } satisfies ScoredItem;
    }).filter((item) => item.title.length > 0);
  } catch (e) {
    console.warn("[recommend] Gurunavi fetch error:", e);
    return [];
  }
}

/** ホットペッパーグルメAPIからレストランを取得して ScoredItem[] に正規化 */
async function fetchHotpepperRestaurants(
  lat: number,
  lng: number,
  radiusKm: number,
  keyword: string,
  answers: Answers,
  timeCtx: ReturnType<typeof getTimeContext>
): Promise<ScoredItem[]> {
  const apiKey = process.env.HOTPEPPER_API_KEY;
  if (!apiKey) return [];
  try {
    const range = kmToRange(radiusKm);
    const params = new URLSearchParams({
      key: apiKey,
      lat: String(lat),
      lng: String(lng),
      range: String(range),
      count: "20",
      order: "4",       // 4 = おすすめ順
      format: "json",
      ...(keyword ? { keyword } : {}),
    });
    const res = await fetch(`https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const shops: Record<string, unknown>[] = json.results?.shop ?? [];

    return shops.map((s) => {
      const name = String(s.name ?? "");
      const address = String(s.address ?? "");
      const rlat = parseFloat(String(s.lat ?? "0"));
      const rlng = parseFloat(String(s.lng ?? "0"));
      const photo = String((s.photo as Record<string, unknown>)?.pc
        ? ((s.photo as Record<string, unknown>).pc as Record<string, unknown>).l ?? ""
        : "");
      const genreName = String((s.genre as Record<string, unknown>)?.name ?? "");
      const catchCopy = String(s.catch ?? "");
      const access = String(s.access ?? "");
      const budgetAvg = String((s.budget as Record<string, unknown>)?.average ?? "");
      const openStr = String(s.open ?? "");
      const nonSmoking = String(s.non_smoking ?? "");
      const wifi = String(s.wifi ?? "");
      const pageUrl = String((s.urls as Record<string, unknown>)?.pc ?? "");
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + " " + address)}`;

      const amenityTags: string[] = [];
      if (wifi && wifi !== "なし") amenityTags.push("Wi-Fiあり");
      if (nonSmoking && nonSmoking !== "なし") amenityTags.push("禁煙席あり");

      const editorialSummaryHp = catchCopy || genreName;
      const locationHp = (rlat && rlng) ? { latitude: rlat, longitude: rlng } : undefined;
      const baseScore = scoreExternalFoodItem({ editorialSummary: editorialSummaryHp, amenityTags, location: locationHp }, answers, timeCtx)
        + (catchCopy.length > 10 ? 4 : 0)
        + (photo ? 4 : 0)
        + (openStr ? 2 : 0)
        + (pageUrl ? 1 : 0);

      return {
        title: name,
        vibe: answers.mood || "",
        budget: budgetAvg || (answers.budget ? `〜¥${answers.budget.toLocaleString("ja-JP")}` : ""),
        time: answers.time || "",
        address,
        mapUrl,
        rating: null,
        userRatingCount: null,
        photoUrl: photo,
        photoUrls: photo ? [photo] : [],
        openingHoursText: openStr,
        distanceText: "",
        durationText: "",
        openNow: undefined,
        priceLevel: undefined,
        stationText: access,
        location: locationHp,
        bucket: "food" as const,
        score: baseScore,
        editorialSummary: editorialSummaryHp,
        amenityTags,
        hasUserPhotos: false,
        userPhotoCount: 0,
        targetUser: undefined,
      } satisfies ScoredItem;
    }).filter((item) => item.title.length > 0);
  } catch (e) {
    console.warn("[recommend] HotPepper fetch error:", e);
    return [];
  }
}

// 移動手段と時間から推定半径（km）を計算する関数
function estimateRadiusKm(
  transport: string | string[] | undefined,
  time?: string,
  distanceMultiplier = 1.0
): number {
  const modes = Array.isArray(transport) ? transport : (transport ? [transport] : []);

  // 時間から時間数を数値に変換
  const hours = (() => {
    switch (time) {
      case "15〜30分": return 0.5;
      case "30〜60分": return 1;
      case "1〜2時間": return 1.5;
      case "2〜4時間": return 3;
      case "4〜6時間": return 5;
      case "6時間以上": return 8;
      default: return 3;
    }
  })();

  // 交通手段ごとの半径を計算し、複数選択時は最大値を採用
  const modeRadius = (m: string): number => {
    if (m.includes("徒歩"))                           return Math.min(hours * 3,  5);
    if (m.includes("自転車") || m.includes("バイク")) return Math.min(hours * 10, 20);
    if (m.includes("電車")   || m.includes("バス"))   return Math.min(hours * 30, 80);
    if (m.includes("車")     || m.includes("ドライブ")) return Math.min(hours * 60, 200);
    return 30; // なんでも・未指定
  };

  const baseKm = modes.length > 0 ? Math.max(...modes.map(modeRadius)) : 30;
  return Math.max(1, Math.round(baseKm * distanceMultiplier));
}

function getSeasonContext(): { season: string; keywords: string; hint: string } {
  const jstMonth = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", month: "numeric" }).format(new Date())
  );
  if (jstMonth === 3 || jstMonth === 4) {
    return { season: "春（桜シーズン）", keywords: "桜・花見・春の公園・ピクニック", hint: "桜の名所・花見スポット・春の景色を積極的に含めてください" };
  } else if (jstMonth === 5 || jstMonth === 6) {
    return { season: "初夏・梅雨", keywords: "新緑・あじさい・紫陽花・新緑ハイキング", hint: "新緑スポット・あじさい名所・梅雨時は屋内施設も提案してください" };
  } else if (jstMonth === 7 || jstMonth === 8) {
    return { season: "夏", keywords: "海・プール・花火・夏祭り・避暑地・高原・川遊び", hint: "海水浴・プール・花火大会・夏祭り・涼しい高原など夏らしいスポットを積極的に提案してください" };
  } else if (jstMonth === 9 || jstMonth === 10) {
    return { season: "秋", keywords: "紅葉・コスモス・秋の公園・ハイキング・秋祭り", hint: "紅葉の名所・秋のハイキング・秋祭りを積極的に提案してください" };
  } else if (jstMonth === 11) {
    return { season: "晩秋・紅葉ピーク", keywords: "紅葉・落ち葉・温泉・鍋・イルミネーション", hint: "紅葉ピーク・温泉・イルミネーション開始時期のスポットを優先してください" };
  } else {
    return { season: "冬", keywords: "イルミネーション・雪・温泉・スキー・クリスマス・年末年始", hint: "イルミネーション・温泉・雪景色・スキー場・冬のアクティビティを積極的に提案してください" };
  }
}

function weatherTimePromptContext(weather: WeatherContext, timeContext: ReturnType<typeof getTimeContext>): string {
  const lines: string[] = [];

  const timeLabel = timeContext.isMorning ? `朝（${timeContext.hour}時台）`
    : timeContext.isDaytime ? `昼間（${timeContext.hour}時台）`
    : timeContext.isEvening ? `夕方〜夜（${timeContext.hour}時台）`
    : `深夜〜早朝（${timeContext.hour}時台）`;
  lines.push(`現在の時間帯: ${timeLabel}`);

  if (weather.weatherCode !== undefined) {
    let w = "不明";
    if (isRainLikeWeather(weather.weatherCode)) w = "雨・小雨（傘が必要）";
    else if (isSnowLikeWeather(weather.weatherCode)) w = "雪（屋外は危険な可能性）";
    else if (weather.weatherCode === 0) w = "快晴";
    else if (weather.weatherCode <= 3) w = "晴れ〜薄曇り";
    else if (weather.weatherCode <= 48) w = "曇り";
    else w = `天気コード ${weather.weatherCode}`;
    lines.push(`現在の天気: ${w}`);
  }

  const constraints: string[] = [];
  if (isRainLikeWeather(weather.weatherCode) || isSnowLikeWeather(weather.weatherCode)) {
    constraints.push("雨・雪のため屋外スポット（公園・展望台・ビーチ等）は避け、屋内施設を優先してください");
  }
  if (timeContext.isLateNight) {
    constraints.push("深夜〜早朝のため、24時間営業・深夜営業の施設を優先してください。通常営業の店舗・施設はこの時間帯に閉店しているため検索クエリに含めないでください");
  } else if (timeContext.isEvening) {
    constraints.push("夕方〜夜の時間帯です。飲食店・カフェを提案する場合は夜間も営業中の店舗（ディナー営業・夜カフェ等）を優先し、ランチ専門店・昼間限定の場所は避けてください");
  } else if (timeContext.isMorning) {
    constraints.push("朝の時間帯のため、モーニング提供カフェ・朝から開いている施設を優先してください");
  }
  if (constraints.length > 0) {
    lines.push("【重要な制約】" + constraints.join("。"));
  }

  return lines.join("\n");
}

function formatDistance(distanceMeters?: number) {
  if (distanceMeters === undefined || distanceMeters === null) return "";
  if (distanceMeters < 1000) return `${distanceMeters}m`;
  return `${(distanceMeters / 1000).toFixed(1)}km`;
}

function formatDuration(duration?: string) {
  if (!duration) return "";
  const seconds = Number(duration.replace("s", ""));
  if (!Number.isFinite(seconds)) return "";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes}分`;
}

// ── 表示する交通モード一覧を決定 ──────────────────────────────────────────────
function getModesToShow(
  transport: string | string[] | undefined,
  mood?: string
): Array<{ travelMode: string; icon: string }> {
  if (mood === "ドライブしたい") return [{ travelMode: "DRIVE", icon: "🚗" }];
  if (mood === "遠くに行きたい") return [{ travelMode: "TRANSIT", icon: "🚄" }];

  const transports = getTransports(transport);
  const isNandemo = transports.length === 0 || transports.includes("なんでも");

  if (isNandemo) {
    return [
      { travelMode: "DRIVE", icon: "🚗" },
      { travelMode: "TRANSIT", icon: "🚃" },
      { travelMode: "WALK", icon: "🚶" },
    ];
  }

  const result: Array<{ travelMode: string; icon: string }> = [];
  const seenModes = new Set<string>();

  if (transports.includes("車") && !seenModes.has("DRIVE")) {
    result.push({ travelMode: "DRIVE", icon: "🚗" });
    seenModes.add("DRIVE");
  }
  if ((transports.includes("電車") || transports.includes("バス")) && !seenModes.has("TRANSIT")) {
    result.push({ travelMode: "TRANSIT", icon: transports.includes("電車") ? "🚃" : "🚌" });
    seenModes.add("TRANSIT");
  }
  if (transports.includes("自転車・バイク") && !seenModes.has("BICYCLE")) {
    result.push({ travelMode: "BICYCLE", icon: "🚲" });
    seenModes.add("BICYCLE");
  }
  if (transports.includes("徒歩") && !seenModes.has("WALK")) {
    result.push({ travelMode: "WALK", icon: "🚶" });
    seenModes.add("WALK");
  }

  return result;
}

// ── Google Routes Matrix API で複数スポットへの経路を一括取得 ─────────────────
async function fetchRouteMatrix(
  origin: { latitude: number; longitude: number },
  items: Array<{ location?: { latitude: number; longitude: number } }>,
  travelMode: string,
  apiKey: string
): Promise<Array<{ durationText: string; distanceText: string }>> {
  const result = items.map(() => ({ durationText: "", distanceText: "" }));

  const indexedDests = items
    .map((item, i) => ({ i, loc: item.location }))
    .filter((x): x is { i: number; loc: { latitude: number; longitude: number } } => x.loc != null);

  if (indexedDests.length === 0) return result;

  const body: Record<string, unknown> = {
    origins: [{
      waypoint: {
        location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } },
      },
    }],
    destinations: indexedDests.map(({ loc }) => ({
      waypoint: {
        location: { latLng: { latitude: loc.latitude, longitude: loc.longitude } },
      },
    })),
    travelMode,
  };
  if (travelMode === "TRANSIT") {
    body.departureTime = new Date().toISOString();
  }

  try {
    const res = await fetch("https://routes.googleapis.com/v1/routeMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(`[routeMatrix] ${travelMode} error: ${res.status}`);
      return result;
    }

    const data = await res.json() as Array<{
      destinationIndex?: number;
      duration?: string;
      distanceMeters?: number;
      condition?: string;
    }>;

    for (const element of data) {
      if (element.destinationIndex == null) continue;
      if (element.condition && element.condition !== "ROUTE_EXISTS") continue;
      const originalIdx = indexedDests[element.destinationIndex]?.i;
      if (originalIdx == null) continue;
      result[originalIdx] = {
        durationText: formatDuration(element.duration),
        distanceText: formatDistance(element.distanceMeters),
      };
    }
  } catch (err) {
    console.warn(`[routeMatrix] ${travelMode} fetch failed:`, err);
  }

  return result;
}

function scorePlace(params: {
  weight: number;
  rating?: number | null;
  userRatingCount?: number | null;
  openNow?: boolean;
  distanceMeters?: number;
  durationSeconds?: number;
  priority?: string;
  bucket: Bucket;
  mood?: string;
  time?: string;
  weather: WeatherContext;
  timeContext: ReturnType<typeof getTimeContext>;
  companion?: string;
  transport?: string | string[];
  amenityTags?: string[];
  distancePref?: { multiplier: number; maxTravelMinOverride: number | null };
}) {
  let score = params.weight * 10;

  if (typeof params.rating === "number") score += params.rating * 8;
  if (typeof params.userRatingCount === "number") {
    score += Math.min(params.userRatingCount / 40, 12);
  }
  if (params.openNow === true) score += 6;
  if (params.openNow === false) score -= 30; // 閉店中は大幅ペナルティ

  if (params.priority === "距離" && typeof params.distanceMeters === "number") {
    score += Math.max(0, 18 - params.distanceMeters / 150);
  }

  if (params.mood === "ゆっくりしたい" && (params.bucket === "spot" || params.bucket === "relax")) score += 10;
  if (params.mood === "遠くに行きたい" && (params.bucket === "spot" || params.bucket === "scenic")) score += 10;
  if (params.mood === "楽しみたい" && (params.bucket === "activity" || params.bucket === "spot")) score += 9;
  if (params.mood === "ドライブしたい" && (params.bucket === "scenic" || params.bucket === "spot")) score += 10;
  if (params.mood === "体を動かしたい" && (params.bucket === "activity" || params.bucket === "spot")) score += 10;

  if (params.mood === "お腹すいた") {
    if (params.bucket === "food") score += 18;
    if (params.bucket === "scenic") score += 2;
    if (params.bucket === "indoor") score -= 2;
    if (params.bucket === "spot" || params.bucket === "relax" || params.bucket === "activity") score -= 25;
  }

  if (isRainLikeWeather(params.weather.weatherCode) || isSnowLikeWeather(params.weather.weatherCode)) {
    if (params.bucket === "indoor" || params.bucket === "food" || params.bucket === "relax") score += 8;
    if (params.bucket === "spot" || params.bucket === "scenic" || params.bucket === "activity") score -= 4;
  } else if (params.timeContext.isDaytime && (params.bucket === "spot" || params.bucket === "scenic")) {
    score += 4;
  }

  if (params.timeContext.isEvening) {
    if (params.bucket === "scenic" || params.bucket === "food") score += 5;
  }

  if (params.timeContext.isLateNight) {
    if (params.bucket === "food" || params.bucket === "indoor") score += 4;
    if (params.bucket === "spot") score -= 3;
  }

  // アメニティボーナス（同行者・交通手段・状況に応じて加点）
  if (params.amenityTags && params.amenityTags.length > 0) {
    const tags = params.amenityTags;
    const transports = getTransports(params.transport);
    if (tags.includes("子連れOK") && params.companion === "家族") score += 12;
    if (tags.includes("ペット可") && params.companion === "友達") score += 5;
    if (tags.includes("無料駐車場") && (transports.includes("車") || params.mood === "ドライブしたい")) score += 10;
    if (tags.includes("駐車場あり") && (transports.includes("車") || params.mood === "ドライブしたい")) score += 6;
    if (tags.includes("テラス席") && !isRainLikeWeather(params.weather.weatherCode)) score += 5;
    if (tags.includes("コーヒーあり") && (params.bucket === "food" || params.bucket === "relax")) score += 4;
  }

  // 時間ベースの移動距離スコア補正（routing summaryがある場合のみ）
  if (params.durationSeconds !== undefined && params.time) {
    const travelMin = params.durationSeconds / 60;
    const { maxTravelMin, minTravelMin } = getTimeContext2(params.time);

    // 距離感の回答がある場合は maxTravelMin を上書き
    const effectiveMax = params.distancePref?.maxTravelMinOverride ?? maxTravelMin;

    if (effectiveMax !== null && travelMin > effectiveMax) {
      // 遠すぎる → ペナルティ（「近場がいい」ほど強いペナルティ）
      const overBy = travelMin - effectiveMax;
      const penaltyMult = params.distancePref?.multiplier !== undefined
        ? Math.max(1.0, 2.5 - params.distancePref.multiplier * 1.5) // 近場(0.25)→2.1x / 少し遠め(0.55)→1.7x / 遠くてOK(1.0)→1.0x
        : 1.2;
      score -= Math.min(60, overBy * penaltyMult);
    }
    if (minTravelMin !== null && travelMin < minTravelMin) {
      // 6時間以上あるのに近すぎる → ペナルティ
      score -= 22;
    }

    // 「近場がいい」のに実際に遠い場合は追加ペナルティ
    if (params.distancePref?.multiplier !== undefined && params.distancePref.multiplier <= 0.3) {
      if (travelMin > 20) score -= Math.min(30, (travelMin - 20) * 0.8);
    }
  }

  return score;
}

function chooseFinalResults(items: ScoredItem[], mood?: string) {
  const { primary, fallback } = allowedBucketsForMood(mood);

  // タイトル正規化: スペース以降のゾーン名などを除去して基本名を取得
  const baseTitle = (title: string) =>
    title
      .replace(/[\s　]+[A-Za-z\u30A0-\u30FF\u4E00-\u9FFF]+[・ゾーンエリアフロアビルウィングモール館棟].*$/u, "")
      .trim() || title;

  // 既に追加済みのアイテムと前方一致・部分一致するか確認
  const used = new Set<string>();
  const isDuplicate = (title: string) => {
    const base = baseTitle(title);
    for (const u of used) {
      const uBase = baseTitle(u);
      if (
        u === title ||
        uBase === base ||
        title.startsWith(uBase) ||
        u.startsWith(base) ||
        (base.length >= 4 && u.includes(base)) ||
        (uBase.length >= 4 && title.includes(uBase))
      ) return true;
    }
    return false;
  };

  const final: ScoredItem[] = [];

  // ── Phase 1: isPinned=true (AI ピンポイント指定の先頭結果) を必ず先に確保 ──
  // スコア・bucket・openNow に関わらず、AI が「この場所」と明示した結果は全件保護する
  // ピン留め同士の重複は完全一致のみチェック（部分一致で誤排除しない）
  // （お腹すいた の food フィルタだけは維持）
  const pinnedItems = items.filter((i) => i.isPinned);
  for (const item of pinnedItems) {
    if (used.has(item.title)) continue; // ピン留め同士の完全一致重複のみ除外
    if (mood === "お腹すいた" && item.bucket !== "food" && item.bucket !== "indoor") continue;
    used.add(item.title);
    final.push(item);
  }

  // ── Phase 2: 残り枠を通常ロジックで補完 ──
  const scenicAllowedMoods = new Set(["ドライブしたい", "遠くに行きたい", "自然感じたい", "体を動かしたい"]);

  const primaryItems = items.filter((item) => !item.isPinned && primary.has(item.bucket));
  const fallbackItems = items.filter((item) => !item.isPinned && !primary.has(item.bucket) && fallback.has(item.bucket));
  const restItems    = items.filter((item) => !item.isPinned && !primary.has(item.bucket) && !fallback.has(item.bucket));

  const openItems   = [...primaryItems, ...fallbackItems, ...restItems].filter((i) => i.openNow !== false);
  const closedItems = [...primaryItems, ...fallbackItems, ...restItems].filter((i) => i.openNow === false);
  const prioritized = [...openItems, ...closedItems];

  for (const item of prioritized) {
    if (final.length >= 12) break;
    if (isDuplicate(item.title)) continue;
    used.add(item.title);

    if (item.openNow === false && item.bucket === "food") continue;
    if (item.openNow === false && final.length >= 14) continue;

    if (mood === "お腹すいた") {
      if (item.bucket !== "food" && item.bucket !== "indoor") continue;
    }

    if (item.bucket === "scenic" && !scenicAllowedMoods.has(mood ?? "")) {
      if (final.length < 10) continue;
    }

    final.push(item);
    if (final.length >= 20) break;
  }

  return final;
}

// ─── Supabase-first ヘルパー関数 ──────────────────────────────────────────────

function getRadiusKmFromTransport(transport?: string | string[]): number {
  const ts = Array.isArray(transport) ? transport : [transport ?? ""];
  if (ts.some(t => t?.includes("徒歩") || t?.includes("歩き"))) return 3;
  if (ts.some(t => t?.includes("自転車"))) return 10;
  if (ts.some(t => t?.includes("車") || t?.includes("バイク"))) return 80;
  return 40;
}

// 交通手段＋所要時間から検索半径を決定
function getRadiusKmFromTransportAndTime(transport?: string | string[], time?: string): number {
  const ts = Array.isArray(transport) ? transport : [transport ?? ""];
  const hasCar   = ts.some(t => t?.includes("車") || t?.includes("バイク") || t?.includes("ドライブ"));
  const hasTrain = ts.some(t => t?.includes("電車") || t?.includes("バス"));
  const hasBike  = ts.some(t => t?.includes("自転車"));
  const hasWalk  = ts.some(t => t?.includes("徒歩") || t?.includes("歩き"));

  // 交通手段ごとの基本半径(km)
  const base = hasCar ? 80 : hasTrain ? 40 : hasBike ? 10 : hasWalk ? 3 : 40;

  // 時間による倍率
  const mult = !time                   ? 0.7
    : time.includes("30分")            ? 0.3
    : time.includes("1〜2")            ? 0.6
    : time.includes("2〜4")            ? 0.85
    : time.includes("4〜6")            ? 1.0
    : time.includes("6時間以上")       ? 1.3
    : 0.7;

  return Math.max(2, Math.round(base * mult));
}

async function generateSupabaseReasons(
  spots: import("@/types/onsen").PlaceResponse[],
  answers: { mood?: string; companion?: string; transport?: string | string[]; time?: string; budget?: number; freeWord?: string; dynamicQs?: { question: string; answer: string }[] },
  mustTags: string[],
  niceTags: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!process.env.OPENAI_API_KEY || spots.length === 0) return result;
  try {
    const moodDesc      = answers.mood ?? "";
    const companionDesc = answers.companion ?? "";
    const transportDesc = Array.isArray(answers.transport) ? answers.transport.join("・") : (answers.transport ?? "");
    const timeDesc      = answers.time ? `滞在時間「${answers.time}」` : "";
    const budgetDesc    = answers.budget !== undefined ? `予算「〜¥${answers.budget.toLocaleString()}」` : "";
    const freeWordDesc  = answers.freeWord ? `希望「${answers.freeWord}」` : "";
    const extraContext  = (answers.dynamicQs ?? []).map((q: { question: string; answer: string }) => `${q.question}→${q.answer}`).join("、");
    const contextParts  = [timeDesc, budgetDesc, freeWordDesc, extraContext].filter(Boolean).join("、");
    const spotList = spots.map((s, i) =>
      `${i + 1}. ${s.name}（タグ: ${(s.tags ?? []).filter(t => [...mustTags, ...niceTags].includes(t)).join(" ")}）`
    ).join("\n");

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `あなたは旅行プランナーです。ユーザーの気分・状況に合わせて各スポットの推薦理由を1文（30〜50字）で書いてください。
ユーザー: 気分「${moodDesc}」、同伴「${companionDesc}」、交通「${transportDesc}」${contextParts ? "、" + contextParts : ""}
※同伴者が恋人ならロマンチックな観点、友達ならワイワイできる観点、一人なら集中・リフレッシュ観点で書くこと。
JSON: {"reasons": {"スポット名": "推薦理由文", ...}}`,
        },
        { role: "user", content: spotList },
      ],
      max_tokens: 800,
    });
    const text = res.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);
    for (const [name, reason] of Object.entries(parsed.reasons ?? {})) {
      result.set(name, String(reason));
    }
  } catch (e) {
    console.error("[recommend] reason generation failed:", e);
  }
  return result;
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return json(
        { error: "GOOGLE_PLACES_API_KEY が設定されていません。" },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => null);
    const answers = (body?.answers || {}) as Answers;
    const pastFeedback = (body?.pastFeedback || []) as FeedbackItem[];
    const seenPlaces = (body?.seenPlaces || []) as string[];
    const showUnseenOnly = body?.showUnseenOnly === true;
    const refinementText = (body?.refinementText || "") as string;
    const userPreferenceHints = (body?.userPreferenceHints || []) as string[];

    // Supabaseの学習データを取得（全属性で類似ユーザーを特定）
    const { context: globalStatsContext, engagedPlaces, goodVisitedPlaces, badVisitedPlaces } = await fetchGlobalStats(answers);

    // 承認済みユーザー投稿スポットを取得
    const approvedSuggestions = await fetchApprovedSuggestions();

    // 管理者が直接追加したスポット（通常スポット vs チェーン店で分離）
    const adminSpots = approvedSuggestions.filter((s) => s.source === "admin" && !s.is_chain);
    const chainSpots = approvedSuggestions.filter((s) => s.source === "admin" && s.is_chain && s.chain_search_query);

    // スポット名 + Googleマップ名の両方でマッチできるようにする
    // ※ source === "admin" のスポットは「ユーザー投稿」バッジを付けない
    const approvedNames = new Set<string>();
    for (const s of approvedSuggestions) {
      if (s.source === "admin") continue;
      approvedNames.add(s.spot_name);
      if (s.google_place_name) approvedNames.add(s.google_place_name);
    }

    // ── タグベースマッチング ─────────────────────────────────────────────────
    // ユーザーの回答から定義済みタグを抽出してスコア計算
    const { extractUserTagsFromAnswers } = await import("@/lib/predefined-tags");
    const userTags = extractUserTagsFromAnswers(answers);
    const allUserTags = new Set([...userTags.mustTags, ...userTags.niceToHaveTags]);

    // ─── Supabase-first メインフロー ───────────────────────────────────────────
    // placesテーブルを主軸に検索し、Google Placesで写真・営業時間・開店状況を補強
    // ※「お腹すいた」「カフェ系」はHotPepper/既存フローを使うためスキップ
    const isSkipSupabaseMood = answers.mood === "お腹すいた" ||
      getDynamicQs(answers).some(q => q.answer.includes("カフェ") || q.answer.includes("スイーツ") || q.answer.includes("グルメ"));
    try {
      if (isSkipSupabaseMood) throw new Error("food mood — skip supabase flow");
      const { searchPlacesByTags } = await import("@/lib/supabase-places");
      const sbMustTags = [...userTags.mustTags];
      const sbNiceTags = [...userTags.niceToHaveTags];
      const radiusKm = getRadiusKmFromTransportAndTime(answers.transport, answers.time);

      const sbResults = await searchPlacesByTags({
        mustTags: sbMustTags,
        fallbackTags: sbMustTags.slice(0, 1),
        lat: answers.originLat ?? 0,
        lng: answers.originLng ?? 0,
        radiusKm,
        transport: answers.transport,
        limit: 15,
        googleApiKey: apiKey,
      });

      if (sbResults.length >= 3) {
        // 予算による価格フィルター（priceLevel が取得できている場合）
        const priceLevelCost: Record<string, number> = {
          "無料": 0, "￥": 1000, "￥￥": 3500, "￥￥￥": 8000, "￥￥￥￥": 15000,
        };
        const budgetMax = answers.budget ?? Infinity;
        const budgetFiltered = sbResults.filter(r => {
          if (budgetMax >= 10000) return true;       // 予算十分なら全件OK
          if (!r.priceLevel) return true;            // 価格情報なしはスルー
          return (priceLevelCost[r.priceLevel] ?? 0) <= budgetMax;
        });
        const poolForScore = (budgetFiltered.length >= 3 ? budgetFiltered : sbResults)
          .filter(r => !seenPlaces.includes(r.name) || !showUnseenOnly);

        // 追加タグ一致スコアでソート（より気分に合ったスポットを上位に）
        const scored = poolForScore
          .map(r => ({
            ...r,
            _niceScore: (r.tags ?? []).filter(t => sbNiceTags.includes(t)).length,
          }))
          .sort((a, b) => b._niceScore - a._niceScore);

        // OpenAIで推薦理由を生成（ユーザーの気分に合った一言コメント）
        const reasons = await generateSupabaseReasons(scored, answers, sbMustTags, sbNiceTags);

        const today = new Date().getDay(); // 0=日...6=土
        const dayNames = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];

        const recommendations = scored.map(r => {
          const matchedTags = (r.tags ?? []).filter(t => [...sbMustTags, ...sbNiceTags].includes(t));
          // 今日の営業時間テキストを抽出
          const todayHours = r.openingHours
            ? r.openingHours.split("\n").find(l => l.startsWith(dayNames[today])) ?? r.openingHours.split("\n")[0] ?? ""
            : "";
          const openingHoursText = todayHours.replace(/^[^:：]+[:：]\s*/, "");
          return {
            title: r.name,
            address: r.address,
            photoUrl: r.imageUrl,
            photoUrls: r.photoUrls,
            rating: r.rating,
            userRatingCount: r.reviewCount,
            openNow: r.openNow ?? undefined,
            openingHoursText,
            mapUrl: r.googleMapsUrl,
            googleMapsUrl: r.googleMapsUrl,
            reason: reasons.get(r.name) ?? r.description ?? "",
            features: matchedTags.slice(0, 5),
            distanceText: r.distanceInfo,
            durationText: "",
            stationText: r.stationInfo ?? "",
            vibe: "",
            budget: "",
            time: "",
            priceLevel: r.priceLevel ?? undefined,
            isUserSpot: false,
            hasUserPhotos: false,
            userPhotoCount: 0,
            routesByMode: undefined,
          };
        });

        return json({
          recommendations,
          usedAI: !!process.env.OPENAI_API_KEY,
          warning: answers.originLat ? "" : "現在地未使用のため、距離順ではない場合があります。",
        });
      }
    } catch (err) {
      console.error("[recommend] Supabase-first flow error, falling back:", err);
    }
    // ─── Supabaseで結果不足の場合は既存 Google Places フローへ ────────────────

    /**
     * スポットの auto_tags とユーザータグの一致スコアを計算
     * mustTags一致: +3点、niceToHaveTags一致: +1点
     */
    function calcTagScore(spotTags: string[]): number {
      let score = 0;
      for (const t of spotTags) {
        if (userTags.mustTags.includes(t))       score += 3;
        else if (userTags.niceToHaveTags.includes(t)) score += 1;
      }
      return score;
    }

    // タグ付きの説明文をAIに渡す（auto_tagsを主軸に）
    const suggestionDescriptions = new Map<string, string>();
    for (const s of approvedSuggestions) {
      const parts: string[] = [];
      if (s.description) parts.push(s.description.slice(0, 80));
      if (s.auto_tags && s.auto_tags.length > 0) parts.push(`タグ: ${s.auto_tags.join(" ")}`);
      if (parts.length > 0) {
        if (s.google_place_name) suggestionDescriptions.set(s.google_place_name, parts.join(" "));
        suggestionDescriptions.set(s.spot_name, parts.join(" "));
      }
    }

    // ── 距離フィルタリング ────────────────────────────────────────────────────
    // ユーザー位置が取得できている場合、遠すぎるスポットをAIへ渡さない
    function getMaxSuggestionDistanceKm(): number {
      if (!answers.originLat || !answers.originLng) return 9999;
      for (const dq of getDynamicQs(answers)) {
        const ans = dq.answer;
        if (ans.includes("近場") || ans.includes("歩きで"))            return 3;
        if (ans.includes("多少") || ans.includes("駅１") || ans.includes("駅1")) return 10;
        if (ans.includes("ほどほど遠く") || ans.includes("電車使う") || ans.includes("電車30分") || ans.includes("電車で")) return 50;
        if (ans.includes("ガッツリ遠くてもOK"))                       return 300;
        if (ans.includes("近場がいい"))                               return 5;
        if (ans.includes("少し遠くてもOK"))                           return 25;
        if (ans.includes("遠くてOK") || ans.includes("美味しければ")) return 300;
      }
      // 距離指定なし: お腹すいた→20km、その他→150km
      return answers.mood === "お腹すいた" ? 20 : 150;
    }
    const maxDistKm = getMaxSuggestionDistanceKm();
    const locationFilteredSuggestions = approvedSuggestions.filter(s => {
      if (!s.lat || !s.lng) return true; // 位置情報未登録のスポットは除外しない
      if (!answers.originLat || !answers.originLng) return true;
      const distKm = haversineMeters(answers.originLat, answers.originLng, s.lat, s.lng) / 1000;
      return distKm <= maxDistKm;
    });

    // タグスコアで降順ソート → 上位8件をAIへ渡す（タグ一致が高いほど優先）
    const scoredSuggestions = locationFilteredSuggestions
      .map(s => ({ s, score: calcTagScore(s.auto_tags ?? []) }))
      .sort((a, b) => b.score - a.score);

    const relevantSuggestions = scoredSuggestions.slice(0, 8).map(x => x.s);

    const approvedContext = relevantSuggestions.length > 0
      ? "\n\n【ユーザー投稿スポット（タグ一致度順）】:\n" +
        relevantSuggestions.map((s) => {
          const name = s.google_place_name ?? s.spot_name;
          const matchedTags = (s.auto_tags ?? []).filter(t => allUserTags.has(t));
          const tagStr = matchedTags.length > 0
            ? `マッチタグ: ${matchedTags.join("、")}`
            : s.auto_tags?.length ? `タグ: ${s.auto_tags.slice(0, 4).join("、")}` : "";
          return `- ${name}${tagStr ? `（${tagStr}）` : ""}`;
        }).join("\n")
      : "";

    // 承認済みスポットの投稿写真マップ（spot_name / google_place_name → image_urls）
    const userPhotosMap = new Map<string, string[]>();
    for (const s of approvedSuggestions) {
      const imgs = (s.image_urls ?? []).filter(Boolean);
      if (imgs.length === 0) continue;
      userPhotosMap.set(s.spot_name, imgs);
      if (s.google_place_name) userPhotosMap.set(s.google_place_name, imgs);
    }

    // ── お腹すいた: HotPepperのみで完結（Google Places検索をスキップ） ────────
    const isFoodMood = answers.mood === "お腹すいた";
    const hasHotPepperKey = !!process.env.HOTPEPPER_API_KEY;

    // 高層ビル料理が選択されているかチェック（HotPepperにはジャンルなし → Google Places専用）
    const isHighriseFood = isFoodMood &&
      getDynamicQs(answers).some(dq => dq.answer.includes("高層ビル料理"));

    // GPS未使用の場合、エリア名をジオコードして座標を補完
    let resolvedLat = answers.originLat;
    let resolvedLng = answers.originLng;
    if (isFoodMood && hasHotPepperKey && (!resolvedLat || !resolvedLng) && answers.area) {
      try {
        const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
        const geoRes = await fetch(`${base}/api/geocode?area=${encodeURIComponent(answers.area)}`, { cache: "no-store" });
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.ok) {
            resolvedLat = geoData.lat;
            resolvedLng = geoData.lng;
            console.log(`[recommend] エリア「${answers.area}」→ geocode: ${resolvedLat}, ${resolvedLng}`);
          }
        }
      } catch (e) {
        console.warn("[recommend] geocode エラー:", e);
      }
    }

    const hasLocation = !!(resolvedLat && resolvedLng);

    // 距離感の分類（お腹すいた専用）
    const foodDistanceTier = (() => {
      const dqs = getDynamicQs(answers);
      for (const dq of dqs) {
        const a = dq.answer;
        if (a.includes("ガッツリ遠く") || a.includes("県外") || a.includes("Far is fine")) return "far" as const;
        if (a.includes("ほどほど遠く") || a.includes("電車使う") || a.includes("電車30分") || a.includes("電車で") || a.includes("Take a train") || a.includes("Moderate")) return "train" as const;
      }
      if (answers.time) {
        if (answers.time.includes("4〜6時間") || answers.time.includes("2〜4時間")) return "far" as const;
        if (answers.time.includes("1〜2時間")) return "train" as const;
      }
      return "near" as const; // 近場 or デフォルト
    })();

    // ── 高層ビル料理: HotPepperをスキップしてGoogle Placesで専用クエリ実行 ─────
    if (isHighriseFood && apiKey) {
      let searchLat = resolvedLat ?? 0;
      let searchLng = resolvedLng ?? 0;
      if ((!searchLat || !searchLng) && answers.area) {
        try {
          const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
          const geoRes = await fetch(`${base}/api/geocode?area=${encodeURIComponent(answers.area)}`, { cache: "no-store" });
          if (geoRes.ok) {
            const geoData = await geoRes.json();
            if (geoData.ok) { searchLat = geoData.lat; searchLng = geoData.lng; }
          }
        } catch { /* ignore */ }
      }
      if (searchLat && searchLng) {
        const a = answers.area && answers.area !== "現在地周辺" ? `${answers.area} ` : "";
        const hiQueries = [
          `${a}展望レストラン 高層ビル 夜景`,
          `${a}スカイレストラン ディナー`,
          `${a}高層階 レストラン 夜景`,
          `${a}ルーフトップダイニング`,
          `${a}ホテルダイニング 夜景 高層`,
          `${a}スカイラウンジ ランチ ディナー`,
        ];
        const placesFieldMask = [
          "places.id", "places.displayName", "places.formattedAddress",
          "places.location", "places.rating", "places.userRatingCount",
          "places.photos", "places.googleMapsUri", "places.currentOpeningHours",
          "places.priceLevel",
        ].join(",");
        const searchRadiusM = 25000; // 25km（高層ビルは大都市圏が対象）
        const hiResults: Record<string, unknown>[] = [];
        for (const q of hiQueries) {
          try {
            const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": apiKey,
                "X-Goog-FieldMask": placesFieldMask,
              },
              body: JSON.stringify({
                textQuery: q,
                languageCode: "ja",
                regionCode: "JP",
                maxResultCount: 20,
                locationBias: {
                  circle: { center: { latitude: searchLat, longitude: searchLng }, radius: searchRadiusM },
                },
              }),
              signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
              const d = await res.json();
              hiResults.push(...((d.places ?? []) as Record<string, unknown>[]));
            }
          } catch { /* ignore */ }
        }
        // 高層ビル料理に不適切な施設を除外するNGワード
        // 公園・野外施設が Google の「展望」クエリに混入しやすいため
        // ※ タワー・展望台は高層レストランとして有効なので除外しない
        // ── ネガティブフィルタ: 公園・非飲食施設を除外 ────────────────────────
        const HIGHRISE_NG = [
          "公園", "緑地", "広場", "河川敷", "遊歩道", "児童遊園",
          "自然公園", "都立公園", "国立公園", "運動公園",
          "美術館", "博物館", "水族館", "動物園", "神社", "寺院", "神宮",
        ];

        // ── ポジティブフィルタ: 名前 or 住所に高層ビル系キーワードが必須 ──────────
        // Google の検索がレビュー文等でマッチして一般飲食店を引いてしまうのを防ぐ
        // 「名前」にスカイ・展望・タワー・ホテル等 OR「住所」に階・ビル・タワー等 → 通過
        const HIGHRISE_POSITIVE_NAME = [
          "スカイ", "sky", "Sky", "SKY",
          "展望", "高層", "ルーフ", "Roof", "roof",
          "タワー", "Tower", "tower",
          "ホテル", "Hotel", "hotel",
          "ラウンジ", "Lounge",
          "フロア", "階",
        ];
        const HIGHRISE_POSITIVE_ADDR = [
          // 住所に階数・ビル名が入っている ＝ 高層ビル内テナントの可能性が高い
          "階", "タワー", "ビル", "Tower",
        ];

        // dedup & フィルタ & build hotpepperShops format
        const seen = new Set<string>();
        const hiShops = await Promise.all(
          hiResults
          .filter(p => {
            const id = String(p.id ?? "");
            if (!id || seen.has(id)) return false;
            seen.add(id);
            const name    = ((p.displayName as Record<string, unknown>)?.text as string) ?? "";
            const address = String(p.formattedAddress ?? "");
            if (HIGHRISE_NG.some(ng => name.includes(ng))) return false;
            const nameOk = HIGHRISE_POSITIVE_NAME.some(kw => name.includes(kw));
            const addrOk = HIGHRISE_POSITIVE_ADDR.some(kw => address.includes(kw));
            return nameOk || addrOk;
          })
          .map(async p => {
            const name = ((p.displayName as Record<string, unknown>)?.text as string) ?? "";
            const photos = (p.photos as Array<Record<string, unknown>>) ?? [];
            const resolvedUrls = await Promise.all(
              photos.slice(0, 5).filter(ph => ph?.name).map(ph => getPhotoUrl(String(ph.name), apiKey))
            );
            const photoUrls = resolvedUrls.filter(u => u.startsWith("https://lh3.googleusercontent.com"));
            const hours = p.currentOpeningHours as Record<string, unknown> | undefined;
            const loc = p.location as Record<string, unknown> | undefined;
            return {
              id: String(p.id ?? ""),
              name,
              address: String(p.formattedAddress ?? ""),
              lat: typeof loc?.latitude === "number" ? loc.latitude : searchLat,
              lng: typeof loc?.longitude === "number" ? loc.longitude : searchLng,
              genre: "展望・高層レストラン",
              genreCatch: "高層階から街並みを眺めるダイニング",
              shopCatch: "",
              budget: "",
              wifi: false,
              privateRoom: false,
              lunch: false,
              nonSmoking: false,
              midnight: false,
              freeDrink: false,
              freeFood: false,
              url: String(p.googleMapsUri ?? ""),
              openText: "",
              photoUrls,
              photoUrl: photoUrls[0] ?? "",
              rating: typeof p.rating === "number" ? p.rating : null,
              reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
              openNow: typeof hours?.openNow === "boolean" ? hours.openNow : null,
            };
          })
        );
        if (hiShops.length > 0) {
          console.log(`[recommend] 高層ビル料理: Google Places ${hiShops.length}件`);
          return json({ recommendations: [], hotpepperShops: hiShops, usedAI: true, warning: "" });
        }
      }
    }

    if (isFoodMood && hasHotPepperKey && hasLocation && !isHighriseFood) {
      // 電車・遠距離の場合は都市部の座標に差し替える
      let searchLat = resolvedLat!;
      let searchLng = resolvedLng!;
      let searchAreaLabel = answers.area ?? "";
      let urbanWarning = "";

      if (foodDistanceTier === "train" || foodDistanceTier === "far") {
        const urban = findUrbanCenterForFood(resolvedLat!, resolvedLng!, foodDistanceTier);
        if (urban) {
          searchLat = urban.lat;
          searchLng = urban.lng;
          searchAreaLabel = urban.name;
          urbanWarning = `${foodDistanceTier === "far" ? "遠出モード" : "電車圏内モード"}：${urban.name}周辺で検索しています。`;
          console.log(`[recommend] お腹すいた 遠距離: ${urban.name} (${Math.round(haversineMeters(resolvedLat!, resolvedLng!, urban.lat, urban.lng) / 1000)}km) で検索`);
        }
      }

      try {
        const hpRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/hotpepper`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mood: answers.mood,
              companion: answers.companion ?? "一人",
              transport: answers.transport,
              budget: answers.budget,
              budgetMin: answers.budgetMin,
              time: answers.time,
              freeWord: answers.freeWord,
              originLat: searchLat,
              originLng: searchLng,
              area: searchAreaLabel,
              dynamicQs: getDynamicQs(answers),
            }),
            cache: "no-store",
          }
        );
        if (hpRes.ok) {
          const hpData = await hpRes.json();
          if (hpData.ok && hpData.shops && hpData.shops.length > 0) {
            console.log(`[recommend] お腹すいた: HotPepper ${hpData.shops.length}件`);
            const warning = urbanWarning || (hpData.isFallback
              ? "ご指定のジャンルが近くに見つからなかったため、条件を緩めて周辺の飲食店を表示しています。"
              : "");
            return json({
              recommendations: [],
              hotpepperShops: hpData.shops,
              usedAI: true,
              warning,
            });
          }
          // HotPepper 0件 → Google Placesには流さず専用メッセージで終了
          console.log("[recommend] お腹すいた: HotPepper 0件 → 終了（Google Placesフォールバックなし）");
          return json({
            recommendations: [],
            hotpepperShops: [],
            usedAI: true,
            warning: "noResultsFood",
          });
        }
        // HotPepper API自体がエラーの場合も同様に終了
        console.warn("[recommend] お腹すいた: HotPepper APIエラー → 終了");
        return json({
          recommendations: [],
          hotpepperShops: [],
          usedAI: true,
          warning: "noResultsFood",
        });
      } catch (e) {
        console.warn("[recommend] お腹すいた HotPepper エラー:", e);
        return json({
          recommendations: [],
          hotpepperShops: [],
          usedAI: true,
          warning: "noResultsFood",
        });
      }
    }
    // ── ここより下はお腹すいた以外、またはHotPepper失敗時のGoogle Places検索 ──

    // ── まったりしたい: 単一textQuery → Places 1回 → シャッフル3件 ───────────────
    if (answers.mood === "まったりしたい" && apiKey) {
      const relaxWeather = await getWeatherContext(answers.originLat, answers.originLng);
      const relaxTimeCtx = getTimeContext();

      // GPS座標の有無を先に判定（クエリ生成に影響する）
      const relaxHasOrigin = typeof answers.originLat === "number" && typeof answers.originLng === "number";

      // 1. OpenAI で単一 textQuery を生成（エリア名 + カテゴリキーワード）
      const relaxAiResult = await buildRelaxTextQueryWithAI(answers, relaxWeather, relaxTimeCtx);
      const textQuery = relaxAiResult?.textQuery ?? buildFallbackRelaxQuery(answers);
      console.log(`[Relax] 使用クエリ: "${textQuery}" (AI=${!!relaxAiResult}, GPS=${relaxHasOrigin})`);

      // 2. 移動手段ごとの検索半径（メートル）を動的に決定
      const transportsForRelax = Array.isArray(answers.transport)
        ? answers.transport
        : [answers.transport].filter(Boolean) as string[];
      const relaxRadiusM = (() => {
        if (transportsForRelax.length > 0 && transportsForRelax.every(t => t.includes("徒歩")))
          return 5000;   // 徒歩: 5km圏内（2kmは狭すぎてヒット0になるケースあり）
        if (transportsForRelax.some(t => t.includes("自転車") || t.includes("バイク")))
          return 10000;  // 自転車・バイク: 10km圏内
        if (transportsForRelax.some(t => t.includes("電車") || t.includes("バス")))
          return 30000;  // 電車・バス: 30km圏内
        if (transportsForRelax.some(t => t.includes("車") || t.includes("ドライブ")))
          return 50000;  // 車: 50km圏内（Google Places上限）
        return 50000;    // なんでも / 未選択: 50km
      })();
      console.log(`[Relax] 移動手段=${transportsForRelax.join("・") || "未指定"} → radius=${relaxRadiusM}m`);

      // ── Places API (New) Text Search 共通設定 ──────────────────────────────
      // ・pageSize: Text Search (New) の件数指定。最大20。
      //   ※ maxResultCount は Nearby Search (New) 専用フィールドで Text Search では無効
      // ・routingParameters は含めない: 経路制約で件数が激減するため除外
      // ・locationBias のみで検索範囲を制御する（エリア名はクエリに含めない）
      const relaxFieldMask = [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.googleMapsUri",
        "places.rating",
        "places.userRatingCount",
        "places.primaryType",
        "places.types",
        "places.photos",
        "places.editorialSummary",
        "places.currentOpeningHours",
        "places.regularOpeningHours",
        "places.priceLevel",
        "places.location",
      ].join(",");

      // Places API 呼び出しのヘルパー
      const callPlacesApi = async (query: string, radiusM: number): Promise<SearchPlace[]> => {
        const payload: Record<string, unknown> = {
          textQuery: query,
          pageSize: 20,
          languageCode: "ja",
          regionCode: "JP",
        };
        if (relaxHasOrigin) {
          payload.locationBias = {
            circle: {
              center: { latitude: answers.originLat, longitude: answers.originLng },
              radius: radiusM,
            },
          };
        }
        console.log(`[Relax] Places API 送信: query="${query}" radius=${radiusM}m`);
        try {
          const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": relaxFieldMask,
            },
            body: JSON.stringify(payload),
            cache: "no-store",
          });
          const resText = await res.text();
          if (res.ok) {
            const data = JSON.parse(resText) as TextSearchResponse;
            let places = data.places ?? [];
            // locationBias はソフト制約なので圏外が混入することがある
            // GPS座標がある場合: 半径内に収まる件数が3件以上あれば距離フィルタを適用
            if (relaxHasOrigin && places.length > 0) {
              const oLat = answers.originLat!;
              const oLng = answers.originLng!;
              const inRange = places.filter((p) => {
                const lat = p.location?.latitude;
                const lng = p.location?.longitude;
                if (typeof lat !== "number" || typeof lng !== "number") return true;
                return haversineMeters(oLat, oLng, lat, lng) <= radiusM;
              });
              if (inRange.length >= 3) places = inRange; // 3件以上残る場合のみ適用
              console.log(`[Relax] → ${data.places?.length ?? 0}件取得 → 距離フィルタ後 ${places.length}件 (radius=${radiusM}m)`);
            } else {
              console.log(`[Relax] → ${places.length}件取得`);
            }
            if (places.length === 0) console.warn(`[Relax] 0件レスポンス:`, resText.slice(0, 300));
            return places;
          } else {
            console.error(`[Relax] Places API エラー ${res.status}: ${resText.slice(0, 300)}`);
            return [];
          }
        } catch (e) {
          console.error("[Relax] Places API 例外:", e);
          return [];
        }
      };

      // 3. Google Places + Yahoo! ローカルサーチを並列実行してマージ
      const [relaxPlacesRaw, yahooRelaxItems] = await Promise.all([
        // Google Places: 0件ならリトライ
        callPlacesApi(textQuery, relaxRadiusM).then(async (places) => {
          if (places.length === 0) {
            const retryQuery = buildFallbackRelaxQuery(answers);
            const retryRadius = Math.min(relaxRadiusM * 2, 50000);
            console.log(`[Relax] Google リトライ: "${retryQuery}" radius=${retryRadius}m`);
            places = await callPlacesApi(retryQuery, retryRadius);
          }
          if (places.length === 0 && relaxHasOrigin) {
            const dynQsTmp = getDynamicQs(answers);
            const placeAnsTmp = dynQsTmp.find(dq => dq.question.includes("どこで癒やされたい"))?.answer ?? "";
            const ultra = placeAnsTmp.includes("カフェ") ? "カフェ"
              : placeAnsTmp.includes("自然") ? "公園"
              : placeAnsTmp.includes("絶景") ? "展望台"
              : "スーパー銭湯";
            console.log(`[Relax] Google リトライ2: "${ultra}" radius=50000m`);
            places = await callPlacesApi(ultra, 50000);
          }
          return places;
        }),
        // Yahoo! ローカルサーチ: GPS座標がある場合のみ
        relaxHasOrigin
          ? fetchYahooRelax(answers, answers.originLat!, answers.originLng!, relaxRadiusM / 1000)
          : Promise.resolve([]),
      ]);

      console.log(`[Relax] Google=${relaxPlacesRaw.length}件 / Yahoo=${yahooRelaxItems.length}件`);

      // シャッフルして最大10件選択（他のモードに合わせた件数）
      const shuffledPlaces = [...relaxPlacesRaw].sort(() => Math.random() - 0.5).slice(0, 10);

      // 4. Google Places 結果: 写真URLと最寄り駅を取得
      const relaxResults = await Promise.all(
        shuffledPlaces.map(async (place) => {
          const photoNames = (place.photos ?? []).map((p: { name?: string }) => p.name || "").filter(Boolean);
          const photoUrls: string[] = photoNames.length > 0
            ? (await Promise.all(photoNames.map((n: string) => getPhotoUrl(n, apiKey)))).filter(Boolean)
            : [];
          const photoUrl = photoUrls[0] ?? "";

          const openNow = place.currentOpeningHours?.openNow;
          const weekdayText = place.currentOpeningHours?.weekdayDescriptions?.[0]
            ?? place.regularOpeningHours?.weekdayDescriptions?.[0] ?? "";
          const editorialSummary = place.editorialSummary?.text ?? "";
          const title = place.displayName?.text ?? "";

          // ユーザー登録スポット確認
          const isUserSpot = approvedNames.has(title);

          // 最寄り駅
          let stationText = "";
          if (place.location?.latitude && place.location?.longitude) {
            stationText = await findNearestStation(place.location.latitude, place.location.longitude, apiKey).catch(() => "");
          }

          return {
            title,
            vibe: editorialSummary,
            budget: "",
            time: answers.time || "",
            address: place.formattedAddress ?? "",
            mapUrl: place.googleMapsUri ?? "",
            rating: typeof place.rating === "number" ? place.rating : null,
            userRatingCount: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
            photoUrl,
            photoUrls,
            openingHoursText: weekdayText,
            distanceText: "",
            durationText: "",
            openNow,
            priceLevel: place.priceLevel,
            stationText,
            reason: relaxAiResult?.reason || editorialSummary.slice(0, 60) || "",
            features: [] as string[],
            isUserSpot,
            hasUserPhotos: false,
            userPhotoCount: 0,
            location: (typeof place.location?.latitude === "number" && typeof place.location?.longitude === "number")
              ? { latitude: place.location.latitude, longitude: place.location.longitude }
              : undefined,
          };
        })
      );

      // 4b. Yahoo! 結果をマージ（Google と重複しないものだけ追加）
      const googleTitles = new Set(relaxResults.map(r => r.title.replace(/\s/g, "").toLowerCase()));
      const yahooUnique = yahooRelaxItems.filter(y => {
        const key = y.title.replace(/\s/g, "").toLowerCase();
        return key.length > 0 && !googleTitles.has(key);
      });
      // Yahoo 結果に最寄り駅を付与（GPS あり時のみ）
      const yahooWithStation = await Promise.all(
        yahooUnique.slice(0, 20).map(async (y) => {
          let stationText = "";
          if (y.location?.latitude && y.location?.longitude) {
            stationText = await findNearestStation(y.location.latitude, y.location.longitude, apiKey).catch(() => "");
          }
          return { ...y, stationText, reason: relaxAiResult?.reason || y.vibe || "" };
        })
      );
      // Google + Yahoo をランダムシャッフルして最大10件
      const merged = [...relaxResults, ...yahooWithStation]
        .sort(() => Math.random() - 0.5)
        .slice(0, 10);
      console.log(`[Relax] マージ後: Google=${relaxResults.length}件 + Yahoo=${yahooWithStation.length}件 → 表示${merged.length}件`);

      // 5. 複数交通手段ごとの所要時間（必要な場合）
      const relaxModesToShow = getModesToShow(answers.transport, answers.mood);
      const relaxRoutesByMode: Array<RouteByMode[]> = merged.map(() => []);
      if (relaxHasOrigin && relaxModesToShow.length > 1) {
        const modeRoutes = await Promise.all(
          relaxModesToShow.map(async ({ travelMode: tm, icon }) => ({
            icon,
            routes: await fetchRouteMatrix(
              { latitude: answers.originLat!, longitude: answers.originLng! },
              merged as unknown as ScoredItem[],
              tm,
              apiKey
            ),
          }))
        );
        for (let i = 0; i < merged.length; i++) {
          relaxRoutesByMode[i] = modeRoutes
            .map(({ icon, routes }) => ({ icon, durationText: routes[i].durationText, distanceText: routes[i].distanceText }))
            .filter(m => m.durationText || m.distanceText);
        }
      }

      const relaxFinalResults = merged.map((r, idx) => {
        const { location, ...rest } = r;
        return {
          ...rest,
          routesByMode: relaxRoutesByMode[idx].length > 0 ? relaxRoutesByMode[idx] : undefined,
        };
      });

      return json({
        recommendations: relaxFinalResults,
        usedAI: !!relaxAiResult,
        warning: relaxFinalResults.length === 0 ? "条件に合うスポットが見つかりませんでした。エリアや条件を変えてお試しください。" : "",
      });
    }

    const weather = await getWeatherContext(answers.originLat, answers.originLng);
    const timeContext = getTimeContext();
    const distancePref = getDistancePreference(answers);

    // お腹すいた のときは hotpepper側でOpenAIを使用済みなので、ここでは呼ばない（二重課金防止）
    const aiResult = isFoodMood
      ? null
      : await buildSearchPlansWithAI(answers, pastFeedback, globalStatsContext + approvedContext, weather, timeContext, userPreferenceHints, refinementText);
    const aiPlans = aiResult?.plans ?? null;
    const aiReasons: Map<string, ReasonData> = aiResult?.aiReasons ?? new Map();
    console.log(`[recommend] OpenAI plans: ${aiPlans ? aiPlans.length + '件 (AI使用)' : 'null (フォールバック)'}`);
    let plans = aiPlans ?? buildSearchPlans(answers);

    // お腹すいた: 動的質問の回答を反映したフードクエリを必ず追加
    if (answers.mood === "お腹すいた" && answers.area) {
      const area = answers.area;
      const isLate = timeContext.isEvening || timeContext.isLateNight;

      // ── 動的Q回答 → DYNAMIC_ANSWER_KEYWORDS でフードキーワードに変換 ──
      // 各質問の代表キーワード（スペース区切りの先頭2語）を取得
      const kwGroups = getDynamicQs(answers).map((dq) => {
        const kw = DYNAMIC_ANSWER_KEYWORDS[dq.question]?.[dq.answer] ?? "";
        return kw.split(" ").filter(Boolean).slice(0, 2);
      });
      const flatKws = kwGroups.flat();         // 全キーワード
      const kw1 = flatKws[0] ?? "";            // 最も重要なキーワード
      const kw2 = flatKws[1] ?? "";
      const kw3 = flatKws[2] ?? "";
      const combinedKw = flatKws.slice(0, 3).join(" "); // 上位3語を結合

      // 同行者キーワード
      const c = answers.companion ?? "";
      const compFood = c.includes("一人") ? "一人でも入りやすい"
        : c.includes("恋人") || c.includes("パートナー") ? "カップル デート"
        : c.includes("家族") ? "家族連れ 子連れ"
        : c.includes("友達") ? "グループ"
        : "";

      const extraFoodPlans: SearchPlan[] = [];

      // ① 動的Q由来のメインクエリ（最優先・高weight）
      if (combinedKw) {
        extraFoodPlans.push({ query: `${area} ${combinedKw}`, weight: 14, bucket: "food" });
        if (compFood) extraFoodPlans.push({ query: `${area} ${combinedKw} ${compFood.split(" ")[0]}`, weight: 13, bucket: "food" });
      }
      if (kw1 && kw2) extraFoodPlans.push({ query: `${area} ${kw1} ${kw2}`, weight: 12, bucket: "food" });
      if (kw1)        extraFoodPlans.push({ query: `${area} ${kw1}`, weight: 11, bucket: "food" });
      if (kw2)        extraFoodPlans.push({ query: `${area} ${kw2}`, weight: 10, bucket: "food" });
      if (kw3)        extraFoodPlans.push({ query: `${area} ${kw3}`, weight: 9, bucket: "food" });

      // ② 時間帯 + 動的Qキーワード
      const timeKw = isLate ? "深夜営業" : (timeContext.isDaytime ? "ランチ" : "ディナー");
      extraFoodPlans.push({
        query: `${area} ${timeKw}${kw1 ? " " + kw1 : " 飲食"}`,
        weight: 9, bucket: "food",
      });

      // ③ フリーワードがあれば食と組み合わせ
      if (answers.freeWord) {
        extraFoodPlans.push({ query: `${area} ${answers.freeWord} 飲食店`, weight: 12, bucket: "food" });
        if (kw1) extraFoodPlans.push({ query: `${area} ${answers.freeWord} ${kw1}`, weight: 11, bucket: "food" });
      }

      // ④ 動的Q回答が少ない場合のみ汎用フォールバック
      if (flatKws.length < 2) {
        extraFoodPlans.push({ query: `${area} レストラン 飲食`, weight: 8, bucket: "food" });
        extraFoodPlans.push({ query: `${area} ${isLate ? "深夜営業" : "ランチ"} 定食`, weight: 7, bucket: "food" });
      }

      console.log(`[recommend] フードクエリ補強: キーワード=[${flatKws.join(", ")}] +${extraFoodPlans.length}件`);
      plans = [...plans, ...extraFoodPlans];
    }
    const travelMode = mapTransportToTravelMode(answers.transport, answers.mood);
    const hasOrigin =
      typeof answers.originLat === "number" && typeof answers.originLng === "number";

    const baseFields = [
      "places.displayName",
      "places.formattedAddress",
      "places.googleMapsUri",
      "places.rating",
      "places.userRatingCount",
      "places.primaryType",
      "places.types",
      "places.photos",
      "places.editorialSummary",
      "places.currentOpeningHours",
      "places.regularOpeningHours",
      "places.priceLevel",
      "places.location",
      "places.goodForChildren",
      "places.allowsDogs",
      "places.restroom",
      "places.outdoorSeating",
      "places.servesCoffee",
      "places.liveMusic",
      "places.parkingOptions",
    ];

    // routingSummaries は routingParameters を送る場合のみ有効（ピンポイントでは不要）
    const fieldMaskWithRouting = [...baseFields, "routingSummaries"].join(",");
    const fieldMaskBase = baseFields.join(",");

    const searchResults = await Promise.all(
      plans.map(async (plan) => {
        // AI が具体的スポット名を指定した場合: スポット名のみでピンポイント検索（pageSize=3）
        //   → エリアを付けない（"木曽駒ケ岳 横浜" のような誤検索を防ぐ）
        //   → locationBias を適用しない（遠距離スポットでも正しく取得するため）
        // 指定がない場合: 従来のキーワードクエリ検索（pageSize=10）
        const isPinpoint = !!plan.placeName;
        const searchTextQuery = isPinpoint ? plan.placeName! : plan.query;
        if (isPinpoint) {
          console.log(`[Places] ピンポイント検索: "${searchTextQuery}" (AI指定スポット名)`);
        }

        const payload: Record<string, unknown> = {
          textQuery: searchTextQuery,
          languageCode: "ja",
          regionCode: "JP",
          pageSize: isPinpoint ? 5 : 15,
        };

        // ピンポイント検索では routingParameters を送らない
        // （DRIVE ルートが存在しない場所=島・山頂等が Google から返されなくなるため）
        // 距離計算は後段の Routes Matrix API が担当する
        if (!isPinpoint && hasOrigin && travelMode) {
          payload.routingParameters = {
            origin: {
              latitude: answers.originLat,
              longitude: answers.originLng,
            },
            travelMode,
          };
        }

        // Google Places API の locationBias radius 上限は 50,000m
        const MAX_BIAS_RADIUS = 50000;

        // ピンポイント検索は locationBias 不要（スポット名が明確なため距離バイアスをかけない）
        if (!isPinpoint) {
          // ドライブしたい: 走行距離 + 道路種別に応じてlocationBiasを設定
          // 一般道 ~40km/h: 30分=20km / 1時間=40km / 2時間=80km
          // 高速   ~90km/h: 30分=45km / 1時間=90km / 2時間=180km（最大50km上限）
          if (hasOrigin && answers.mood === "ドライブしたい") {
            const allDqs3 = getDynamicQs(answers);
            const driveAns = allDqs3.find(d => d.answer.match(/30分|1時間|2時間|3時間/))?.answer ?? "";
            const driveRoadType = getDriveRoadType(answers);
            const isLocalRoad   = driveRoadType === "local";
            const isHighwayRoad = driveRoadType === "highway";
            let biasRadius = 40000; // デフォルト40km
            if (driveAns.includes("30分")) {
              biasRadius = isLocalRoad ? 20000 : isHighwayRoad ? 45000 : 30000;
            } else if (driveAns.includes("1時間")) {
              biasRadius = isLocalRoad ? 35000 : isHighwayRoad ? 50000 : 40000;
            } else if (driveAns.includes("2時間")) {
              biasRadius = 50000;
            } else if (driveAns.includes("3時間")) {
              biasRadius = 50000;
            }
            payload.locationBias = {
              circle: {
                center: { latitude: answers.originLat, longitude: answers.originLng },
                radius: Math.min(biasRadius, MAX_BIAS_RADIUS),
              },
            };
          } else if (hasOrigin) {
            // 移動手段と所要時間から推定した半径でlocationBiasを設定（ドライブ以外）
            // 距離感の回答（近場がいい / 少し遠めでもOK 等）を乗算して反映
            const estimatedRadiusKm = estimateRadiusKm(answers.transport, answers.time, distancePref.multiplier);
            const estimatedRadiusM = Math.min(Math.round(estimatedRadiusKm * 1000), MAX_BIAS_RADIUS);
            payload.locationBias = {
              circle: {
                center: { latitude: answers.originLat, longitude: answers.originLng },
                radius: estimatedRadiusM,
              },
            };
          }
        }

        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            // ピンポイント検索は routingParameters なし → routingSummaries も不要
            "X-Goog-FieldMask": isPinpoint ? fieldMaskBase : (hasOrigin && travelMode ? fieldMaskWithRouting : fieldMaskBase),
          },
          body: JSON.stringify(payload),
          cache: "no-store",
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => "");
          console.warn(`[Places] error ${res.status} for "${searchTextQuery}": ${errorText}`);
          return { data: { places: [] } as TextSearchResponse, plan };
        }

        let data = (await res.json()) as TextSearchResponse;
        const hitCount = data.places?.length ?? 0;
        console.log(`[Places] "${searchTextQuery}" → ${hitCount}件${isPinpoint ? " (pinpoint)" : ""}`);

        // ピンポイント検索で0件 → queryフィールドでフォールバック検索（locationBiasあり）
        if (isPinpoint && hitCount === 0 && plan.query) {
          console.log(`[Places] フォールバック: "${plan.query}"`);
          const fbPayload: Record<string, unknown> = {
            textQuery: plan.query,
            languageCode: "ja",
            regionCode: "JP",
            pageSize: 5,
          };
          if (hasOrigin && travelMode) {
            fbPayload.routingParameters = {
              origin: { latitude: answers.originLat, longitude: answers.originLng },
              travelMode,
            };
          }
          if (hasOrigin) {
            const fbRadius = Math.min(Math.round(estimateRadiusKm(answers.transport, answers.time, distancePref.multiplier) * 1000), 50000);
            fbPayload.locationBias = {
              circle: { center: { latitude: answers.originLat, longitude: answers.originLng }, radius: fbRadius },
            };
          }
          const fbRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": hasOrigin && travelMode ? fieldMaskWithRouting : fieldMaskBase },
            body: JSON.stringify(fbPayload),
            cache: "no-store",
          });
          if (fbRes.ok) {
            const fbData = (await fbRes.json()) as TextSearchResponse;
            console.log(`[Places] フォールバック結果: ${fbData.places?.length ?? 0}件`);
            if ((fbData.places?.length ?? 0) > 0) data = fbData;
          }
        }

        return { data, plan };
      })
    );

    const mergedMap = new Map<string, ScoredItem>();

    for (const { data, plan } of searchResults) {
      const places = data.places ?? [];
      const summaries = data.routingSummaries ?? [];

      for (let i = 0; i < places.length; i += 1) {
        const place = places[i];
        const summary = summaries[i];
        const leg = summary?.legs?.[0];

        const title = place.displayName?.text || "おすすめ候補";
        const address = place.formattedAddress || "";
        // 同名スポットを統一するため、タイトルのみでキー管理（住所違いの重複を排除）
        const dedupeKey = title;

        // 気分に合わない場所を primaryType で除外
        const primaryType = place.primaryType ?? "";

        // ── 小さい公園フィルタ ──────────────────────────────────────
        // park / playground 系で、レビュー数が極端に少ない or 有名でない近所の公園を除外
        const PARK_TYPES = new Set([
          "park", "playground", "sports_activity_location",
        ]);
        if (PARK_TYPES.has(primaryType)) {
          const ratingCount = typeof place.userRatingCount === "number" ? place.userRatingCount : 0;
          const hasRating = typeof place.rating === "number" && place.rating >= 3.8;
          const nameHasPark = title.includes("公園") || title.includes("広場") || title.includes("グラウンド");
          // レビュー数が50件未満の公園は除外（有名公園・大規模公園のみ残す）
          if (nameHasPark && ratingCount < 50) continue;
          // playground（児童遊園）はレビュー数が200件未満かつ評価が高くなければ除外
          if (primaryType === "playground" && (ratingCount < 200 || !hasRating)) continue;
        }
        const ALWAYS_EXCLUDE_TYPES = new Set([
          "parking", "parking_lot", "gas_station", "car_wash", "car_dealer",
          "atm", "bank", "post_office", "real_estate_agency", "insurance_agency",
          "storage", "moving_company", "laundry", "dry_cleaning_laundry",
        ]);
        if (ALWAYS_EXCLUDE_TYPES.has(primaryType)) continue;

        // お腹すいた: 食事と完全に無関係な場所だけ除外（チェーン店・ファストフードは通過させる）
        if (answers.mood === "お腹すいた" && primaryType) {
          const STRICT_NON_FOOD_TYPES = new Set([
            "parking", "parking_lot", "tourist_attraction", "amusement_park",
            "national_park", "campground", "ski_resort", "stadium",
            "night_club", "casino", "movie_theater", "museum", "art_gallery",
            "clothing_store", "shoe_store", "book_store", "electronics_store",
            "gym", "sports_complex", "beauty_salon", "hair_care", "nail_salon",
            // 公園・自然系（食事と無関係な場所）
            "park", "hiking_area", "botanical_garden", "zoo", "aquarium",
            "playground", "sports_activity_location", "athletic_field",
            "golf_course", "ski_area", "beach", "natural_feature",
          ]);
          if (STRICT_NON_FOOD_TYPES.has(primaryType)) continue;
        }

        // 写真をすべて並行取得
        const photoNames = (place.photos ?? []).map((p) => p.name || "").filter(Boolean);
        const googlePhotoUrls = photoNames.length > 0
          ? await Promise.all(photoNames.map((name) => getPhotoUrl(name, apiKey)))
          : [];
        // ユーザー投稿写真があれば先頭に追加
        const userSubmittedPhotos = userPhotosMap.get(title) ?? [];
        const photoUrls = [...userSubmittedPhotos, ...googlePhotoUrls.filter(Boolean)];
        const photoUrl = photoUrls[0] ?? "";

        const openNow = place.currentOpeningHours?.openNow;
        const weekdayText =
          place.currentOpeningHours?.weekdayDescriptions?.[0] ||
          place.regularOpeningHours?.weekdayDescriptions?.[0] ||
          "";
        const editorialSummary = place.editorialSummary?.text ?? "";

        const amenityTags: string[] = [];
        if (place.goodForChildren) amenityTags.push("子連れOK");
        if (place.allowsDogs) amenityTags.push("ペット可");
        if (place.restroom) amenityTags.push("トイレあり");
        if (place.parkingOptions?.freeParkingLot) amenityTags.push("無料駐車場");
        else if (place.parkingOptions?.paidParkingLot) amenityTags.push("駐車場あり");
        if (place.outdoorSeating) amenityTags.push("テラス席");
        if (place.servesCoffee) amenityTags.push("コーヒーあり");
        if (place.liveMusic) amenityTags.push("ライブ音楽");

        const nextItem: ScoredItem = {
          title,
          vibe: answers.mood || "",
          budget: answers.budget ? `予算 ¥${answers.budget.toLocaleString("ja-JP")}目安` : "",
          time: answers.time || "",
          address,
          mapUrl: place.googleMapsUri || "",
          rating: typeof place.rating === "number" ? place.rating : null,
          userRatingCount:
            typeof place.userRatingCount === "number" ? place.userRatingCount : null,
          photoUrl,
          photoUrls: photoUrls.filter(Boolean),
          openingHoursText: weekdayText,
          distanceText: formatDistance(leg?.distanceMeters),
          durationText: formatDuration(leg?.duration),
          openNow,
          priceLevel: place.priceLevel,
          stationText: "",
          location: (typeof place.location?.latitude === "number" && typeof place.location?.longitude === "number")
            ? { latitude: place.location.latitude, longitude: place.location.longitude }
            : undefined,
          bucket: plan.bucket,
          editorialSummary,
          amenityTags,
          hasUserPhotos: userSubmittedPhotos.length > 0,
          userPhotoCount: userSubmittedPhotos.length,
          // ピンポイント検索(place_name指定)の先頭結果か、理由ありプランの先頭結果に理由を紐づける
          aiReason: plan.reasonData && i === 0 ? plan.reasonData : undefined,
          // ピンポイント検索の先頭結果は必ず表示（chooseFinalResults でスコアに関わらず保護）
          isPinned: !!plan.placeName && i === 0,
          score: scorePlace({
            weight: plan.weight,
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            openNow,
            distanceMeters: leg?.distanceMeters,
            durationSeconds: leg?.duration ? Number(leg.duration.replace("s", "")) : undefined,
            priority: answers.priority,
            bucket: plan.bucket,
            mood: answers.mood,
            time: answers.time,
            weather,
            timeContext,
            companion: answers.companion,
            transport: answers.transport,
            amenityTags,
            distancePref,
          }),
        };

        const existing = mergedMap.get(dedupeKey);
        if (!existing) {
          mergedMap.set(dedupeKey, nextItem);
        } else if (existing.isPinned) {
          // isPinned=true のアイテムは絶対に上書きしない
        } else if (nextItem.isPinned || nextItem.score > existing.score) {
          // isPinned=true で上書き、またはスコアが高ければ上書き
          mergedMap.set(dedupeKey, nextItem);
        }
      }
    }

    // ── お腹すいた: ぐるなび・ホットペッパーから追加取得してmergedMapに注入 ──
    if (answers.mood === "お腹すいた" && hasOrigin) {
      const radiusKm = Math.min(estimateRadiusKm(answers.transport, answers.time, distancePref.multiplier), 3);

      // ── 質問回答をすべて反映したキーワードを構築 ──────────────────────────
      const extKeywordParts: string[] = [];

      // 1. 動的質問の回答 → DYNAMIC_ANSWER_KEYWORDS で具体的な食キーワードに変換
      for (const dq of getDynamicQs(answers)) {
        const kw = DYNAMIC_ANSWER_KEYWORDS[dq.question]?.[dq.answer];
        if (kw) extKeywordParts.push(kw.split(" ")[0]); // 代表キーワード1語
      }

      // 2. 誰と → 店の雰囲気キーワードに変換
      const companionKw: Record<string, string> = {
        "一人":           "一人でも入りやすい",
        "恋人・パートナー": "デート カップル",
        "家族":           "家族連れ 子連れOK",
        "友達":           "グループ にぎわい",
      };
      if (answers.companion) {
        const ck = companionKw[answers.companion];
        if (ck) extKeywordParts.push(ck.split(" ")[0]);
      }

      // 3. 雰囲気 → キーワード変換
      const atmosphereKw: Record<string, string> = {
        "静か":         "落ち着いた 静かな",
        "賑やか":       "にぎやか 活気",
        "おしゃれ":     "おしゃれ インスタ映え",
        "アットホーム": "アットホーム 地元",
        "ロマンティック": "ムード デート向き",
        "スリル":       "話題 変わり種",
        "アクティブ":   "立ち飲み 活気",
      };
      if (answers.atmosphere) {
        const ak = atmosphereKw[answers.atmosphere];
        if (ak) extKeywordParts.push(ak.split(" ")[0]);
      }

      // 4. 優先 → キーワード変換
      const priorityKw: Record<string, string> = {
        "コスパ":   "コスパ最強 安い",
        "映え":     "インスタ映え フォトジェニック",
        "距離":     "駅近 アクセス良好",
        "快適さ":   "ゆったり 快適",
        "楽しさ":   "楽しい 体験",
        "質の高さ": "本格 こだわり 名店",
      };
      if (answers.priority) {
        const pk = priorityKw[answers.priority];
        if (pk) extKeywordParts.push(pk.split(" ")[0]);
      }

      // 5. 時間帯 → 営業時間キーワード
      if (timeContext.isLateNight) extKeywordParts.push("深夜営業");
      else if (timeContext.isEvening) extKeywordParts.push("夜 ディナー");
      else if (timeContext.isDaytime) extKeywordParts.push("ランチ");

      // 6. フリーワード
      if (answers.freeWord) extKeywordParts.push(answers.freeWord);

      const keyword = extKeywordParts.filter(Boolean).join(" ").slice(0, 60);
      console.log(`[recommend] 外部API検索キーワード: "${keyword}" 半径${radiusKm}km`);

      // ぐるなびとホットペッパーを並行フェッチ
      const [guruItems, hotpepItems] = await Promise.all([
        fetchGurunaviRestaurants(answers.originLat!, answers.originLng!, radiusKm, keyword, answers, timeContext),
        fetchHotpepperRestaurants(answers.originLat!, answers.originLng!, radiusKm, keyword, answers, timeContext),
      ]);
      const externalItems = [...guruItems, ...hotpepItems];
      console.log(`[recommend] 外部API: ぐるなび${guruItems.length}件 / ホットペッパー${hotpepItems.length}件`);

      for (const item of externalItems) {
        // タイトルのみをキーにして同名統一（住所・ソース違いでも同じ店は1件に）
        const dedupeKey = item.title;
        const alreadyExists = [...mergedMap.keys()].some((k) => {
          const kt = k.split("__")[0]; // 旧形式キーへの後方互換
          return kt === item.title ||
            (item.title.length >= 4 && kt.includes(item.title)) ||
            (kt.length >= 4 && item.title.includes(kt));
        });
        if (!alreadyExists && !mergedMap.has(dedupeKey)) {
          mergedMap.set(dedupeKey, item);
        }
      }
    }

    // ── Yahoo!ローカルサーチ（全気分・日本語精度補完） ──
    if (hasOrigin) {
      const yahooRkm = Math.min(estimateRadiusKm(answers.transport, answers.time, distancePref.multiplier), 10);
      const yahooKw = buildYahooKeyword(answers, timeContext);
      const yahooItems = await fetchYahooLocalSearch(answers.originLat!, answers.originLng!, yahooRkm, yahooKw, answers, timeContext);
      console.log(`[recommend] Yahoo!ローカルサーチ: ${yahooItems.length}件`);
      for (const item of yahooItems) {
        const dedupeKey = item.title; // タイトルのみで同名統一
        const alreadyExists = [...mergedMap.keys()].some((k) => {
          const t = k.split("__")[0];
          return t === item.title || (item.title.length >= 4 && t.includes(item.title)) || (t.length >= 4 && item.title.includes(t));
        });
        if (!alreadyExists && !mergedMap.has(dedupeKey)) mergedMap.set(dedupeKey, item);
      }
    }

    // ── OpenStreetMap（ドライブ・体を動かしたい・遠くに行きたい向け自然・施設データ） ──
    if (hasOrigin && ["ドライブしたい", "体を動かしたい", "遠くに行きたい"].includes(answers.mood ?? "")) {
      const osmRkm = Math.min(estimateRadiusKm(answers.transport, answers.time, distancePref.multiplier), 50);
      const osmItems = await fetchOSMPlaces(answers.originLat!, answers.originLng!, osmRkm, answers.mood!, answers, timeContext);
      console.log(`[recommend] OSM: ${osmItems.length}件`);
      for (const item of osmItems) {
        const dedupeKey = item.title; // タイトルのみで同名統一
        const alreadyExists = [...mergedMap.keys()].some((k) => {
          const t = k.split("__")[0];
          return t === item.title || (item.title.length >= 4 && t.includes(item.title)) || (t.length >= 4 && item.title.includes(t));
        });
        if (!alreadyExists && !mergedMap.has(dedupeKey)) mergedMap.set(dedupeKey, item);
      }
    }

    // 管理者追加スポットの無条件注入は廃止。
    // 気分タグ一致によるフィルタリング注入のみ行う（後述の matchingAdminSpots ブロック）。

    // チェーン店スポット：ユーザーのエリア（または現在地）で最寄り店舗をGoogle Placesで検索して投入
    if (chainSpots.length > 0 && apiKey) {
      await Promise.all(chainSpots.map(async (chain) => {
        const query = chain.chain_search_query!;
        const areaHint = answers.area ?? "";
        const searchQuery = areaHint ? `${query} ${areaHint}` : query;
        try {
          const payload: Record<string, unknown> = {
            textQuery: searchQuery,
            languageCode: "ja",
            regionCode: "JP",
            pageSize: 1,
          };
          if (hasOrigin) {
            payload.locationBias = {
              circle: {
                center: { latitude: answers.originLat, longitude: answers.originLng },
                radius: 30000,
              },
            };
          }
          const chainRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.googleMapsUri,places.rating,places.userRatingCount,places.currentOpeningHours,places.priceLevel,places.photos,places.location",
            },
            body: JSON.stringify(payload),
            cache: "no-store",
          });
          if (!chainRes.ok) return;
          const chainData = await chainRes.json();
          const place = chainData.places?.[0];
          if (!place) return;

          const title = place.displayName?.text || chain.spot_name;
          const dedupeKey = `${title}__chain`;
          if (mergedMap.has(dedupeKey)) return;

          const openNow = place.currentOpeningHours?.openNow;
          const weekdayText = place.currentOpeningHours?.weekdayDescriptions?.[0] || "";

          // 管理者が登録した画像があれば使用、なければGoogle写真
          const adminImgs = chain.image_urls ?? [];
          const photoNames = adminImgs.length === 0
            ? (place.photos ?? []).map((p: { name?: string }) => p.name || "").filter(Boolean)
            : [];
          const googlePhotoUrls = photoNames.length > 0
            ? await Promise.all(photoNames.map((name: string) => getPhotoUrl(name, apiKey)))
            : [];
          const photoUrls = adminImgs.length > 0 ? adminImgs : googlePhotoUrls.filter(Boolean);

          const loc = (typeof place.location?.latitude === "number" && typeof place.location?.longitude === "number")
            ? { latitude: place.location.latitude, longitude: place.location.longitude }
            : undefined;

          mergedMap.set(dedupeKey, {
            title,
            vibe: chain.description ?? "",
            budget: "",
            time: answers.time || "",
            address: place.formattedAddress || "",
            mapUrl: place.googleMapsUri || "",
            rating: typeof place.rating === "number" ? place.rating : null,
            userRatingCount: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
            photoUrl: photoUrls[0] ?? "",
            photoUrls,
            openingHoursText: weekdayText,
            distanceText: "",
            durationText: "",
            openNow,
            priceLevel: place.priceLevel,
            stationText: chain.station_info ?? "",
            location: loc,
            bucket: "spot",
            editorialSummary: "",
            amenityTags: [],
            hasUserPhotos: adminImgs.length > 0,
            userPhotoCount: adminImgs.length,
            score: scorePlace({
              weight: 10,
              rating: place.rating,
              userRatingCount: place.userRatingCount,
              openNow,
              priority: answers.priority,
              bucket: "spot",
              mood: answers.mood,
              weather,
              time: answers.time,
              timeContext,
              companion: answers.companion,
              transport: answers.transport,
              amenityTags: [],
              distancePref,
            }) + 80, // チェーン店は高スコアベース
          });
        } catch {
          // チェーン店検索失敗は無視
        }
      }));
    }

    // 現在の気分に対応するタグ（スコアリング & 管理者スポット注入で共用）
    const moodTagForCurrentMood = answers.mood
      ? Object.entries(MOOD_TAG_MAP).find(([, v]) => v === answers.mood)?.[0]
      : null;

    // 類似ユーザーの実績データ＋承認済み投稿スポットに基づくスコア調整
    for (const [key, item] of mergedMap) {
      let boost = 0;
      // 高評価で実際に訪れた場所 → 最大ブースト（+70）
      if (goodVisitedPlaces.has(item.title)) boost += 70;
      // ハート・マップクリックされた場所 → 中ブースト（+50）
      else if (engagedPlaces.has(item.title)) boost += 50;
      // 低評価で訪れた場所 → ペナルティ（-80）
      if (badVisitedPlaces.has(item.title)) boost -= 80;
      // 承認済みユーザー投稿スポット → 穴場ブースト（+60）
      if (approvedNames.has(item.title)) boost += 60;
      // タグが現在の気分にマッチするスポット（auto_tagsにmoodTagが含まれる場合）→ ブースト
      if (moodTagForCurrentMood && Array.isArray(item.amenityTags)) {
        if (item.amenityTags.includes(moodTagForCurrentMood)) boost += 25;
      }
      if (boost !== 0) mergedMap.set(key, { ...item, score: item.score + boost });
    }

    // [DEBUG] mergedMap 状態をログ出力
    const debugEntries = [...mergedMap.values()];
    console.log(`[recommend] mergedMap total=${debugEntries.length}, mood=${answers.mood}`);
    const openCount = debugEntries.filter(e => e.openNow === true).length;
    const closedCount = debugEntries.filter(e => e.openNow === false).length;
    const unknownCount = debugEntries.filter(e => e.openNow === undefined).length;
    console.log(`[recommend] openNow: true=${openCount}, false=${closedCount}, undefined=${unknownCount}`);
    console.log(`[recommend] buckets: ${[...new Set(debugEntries.map(e => e.bucket))].join(', ')}`);
    console.log(`[recommend] titles: ${debugEntries.slice(0, 20).map(e => `${e.title}(${e.openNow ?? '?'})`).join(', ')}`);

    // 閉店中スポットを常に除外（openNow === false のみ。undefined = 不明は残す）
    // ドライブしたいは除外しない（展望台・道の駅など時間外でも訪問可能なスポットが多い）
    if (answers.mood !== "ドライブしたい") {
      for (const [key, item] of mergedMap.entries()) {
        if (item.openNow === false) mergedMap.delete(key);
      }
    }
    console.log(`[recommend] after closed filter: ${mergedMap.size}`);

    // 訪問済み・閲覧済みスポットを除外（showUnseenOnly モード）
    if (showUnseenOnly && seenPlaces.length > 0) {
      const seenSet = new Set(seenPlaces.map((s) => s.toLowerCase()));
      for (const [key, item] of mergedMap.entries()) {
        if (seenSet.has(item.title.toLowerCase())) mergedMap.delete(key);
      }
    }

    // ドライブしたい: 走行時間に基づいて結果をフィルタリング
    // 一般道メインの場合は同じ「時間」でも目的地が近いため、フィルタ幅を狭める
    if (answers.mood === "ドライブしたい") {
      const allDqs4 = getDynamicQs(answers);
      const driveAns = allDqs4.find(d => d.answer.match(/30分|1時間|2時間|3時間/))?.answer ?? "";
      const filterRoadType = getDriveRoadType(answers);
      const isLocalFilter  = filterRoadType === "local";

      // 「都会の夜景」選択時は近場ランドマークを弾かないよう min フィルタを無効化
      const isUrbanNightFilter = allDqs4.some((dq) => dq.answer.includes("都会の夜景") || dq.answer.includes("City night"));

      let maxDriveSeconds: number | null = null;
      let minDriveSeconds: number | null = null;
      if (isUrbanNightFilter) {
        // 都会の夜景モード: 近場ランドマークも許可（max のみ設定・min は 0）
        if (driveAns.includes("30分")) { maxDriveSeconds = 45 * 60; minDriveSeconds = 0; }
        else if (driveAns.includes("1時間")) { maxDriveSeconds = 90 * 60; minDriveSeconds = 0; }
        else if (driveAns.includes("2時間")) { maxDriveSeconds = 180 * 60; minDriveSeconds = 0; }
        // 3時間: フィルタなし
      } else if (driveAns.includes("30分")) {
        // 一般道: 0〜45分、高速/デフォルト: 0〜45分（Googleルートは高速優先なので上限同じ）
        maxDriveSeconds = 45 * 60; minDriveSeconds = 0;
      } else if (driveAns.includes("1時間")) {
        // 一般道: 15〜75分（40km先はGoogle高速ルートで30〜40分程度）
        // 高速/デフォルト: 20〜90分
        maxDriveSeconds = isLocalFilter ? 75 * 60 : 90 * 60;
        minDriveSeconds = isLocalFilter ? 15 * 60 : 20 * 60;
      } else if (driveAns.includes("2時間")) {
        // 一般道: 40〜150分（80km先はGoogle高速ルートで60〜90分程度）
        // 高速/デフォルト: 60〜180分
        maxDriveSeconds = isLocalFilter ? 150 * 60 : 180 * 60;
        minDriveSeconds = isLocalFilter ? 40 * 60  : 60 * 60;
      } else if (driveAns.includes("3時間")) {
        // 一般道: 90分以上、高速/デフォルト: 120分以上
        maxDriveSeconds = null;
        minDriveSeconds = isLocalFilter ? 90 * 60 : 120 * 60;
      }

      if (maxDriveSeconds !== null || minDriveSeconds !== null) {
        for (const [key, item] of mergedMap.entries()) {
          if (!item.durationText) continue; // duration不明な場合はフィルタしない
          const minutes = parseInt(item.durationText.replace("分", ""), 10);
          if (isNaN(minutes)) continue;
          const seconds = minutes * 60;
          if (maxDriveSeconds !== null && seconds > maxDriveSeconds) {
            mergedMap.delete(key);
          } else if (minDriveSeconds !== null && seconds < minDriveSeconds && item.durationText) {
            mergedMap.delete(key);
          }
        }
      }
    }

    // ── 管理者追加スポットを直接注入（気分タグ＋サブカテゴリタグが合致するもの、最大3件） ──────────
    // ① 大カテゴリ（#ドライブしたい 等）が一致すること
    // ② ユーザーのサブカテゴリに対応するタグ（#夜景 #絶景スポット 等）が
    //    スポットの auto_tags に1つ以上含まれること
    //    ※ サブカテゴリタグが1件もない場合は大カテゴリ一致のみで表示（後方互換）
    const matchingAdminSpots = adminSpots.filter((s) => {
      const spotTags = new Set(s.auto_tags ?? []);

      // ① 大カテゴリチェック
      if (!moodTagForCurrentMood) return false;
      if (!spotTags.has(moodTagForCurrentMood)) return false;

      // ② サブカテゴリタグチェック
      // userTags.mustTags から大カテゴリタグを除いた残り = サブ絞り込みタグ
      const subTags = userTags.mustTags.filter(t => t !== moodTagForCurrentMood);
      if (subTags.length === 0) {
        // サブタグ未指定（大カテゴリのみ選択）→ 大カテゴリ一致だけで表示
        return true;
      }
      // サブタグが1つでも一致していれば表示
      return subTags.some(t => spotTags.has(t));
    }).slice(0, 3);

    for (const s of matchingAdminSpots) {
      const name = s.google_place_name ?? s.spot_name;
      const key = name.toLowerCase().replace(/\s+/g, "");
      if (mergedMap.has(key)) continue; // 既に存在する場合はスキップ

      // 画像がない場合はGoogle Placesから自動補完
      let imgs = (s.image_urls ?? []).filter(Boolean);
      if (imgs.length === 0 && apiKey) {
        try {
          const searchQ = s.address ? `${name} ${s.address}` : name;
          const placeRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.photos" },
            body: JSON.stringify({ textQuery: searchQ, languageCode: "ja", pageSize: 1 }),
          });
          if (placeRes.ok) {
            const placeData = await placeRes.json();
            const photos: Array<{ name: string }> = placeData.places?.[0]?.photos ?? [];
            const resolved = await Promise.all(
              photos.slice(0, 5).map(p => getPhotoUrl(p.name, apiKey))
            );
            imgs = resolved.filter(u => u.startsWith("https://lh3.googleusercontent.com"));
          }
        } catch { /* 補完失敗は無視 */ }
      }

      const adminItem: ScoredItem = {
        title: name,
        vibe: s.description ?? "",
        budget: "",
        time: "",
        address: s.address ?? "",
        mapUrl: s.google_maps_uri ?? "",
        rating: null,
        userRatingCount: null,
        photoUrl: imgs[0] ?? "",
        photoUrls: imgs,
        openingHoursText: "",
        distanceText: "",
        durationText: "",
        openNow: undefined,
        priceLevel: undefined,
        stationText: s.station_info ?? "",
        location: s.lat && s.lng ? { latitude: s.lat, longitude: s.lng } : undefined,
        bucket: "spot",
        score: 120, // Google結果より確実に上位に入る高スコア
        editorialSummary: s.description ?? "",
        amenityTags: s.auto_tags ?? [],
        hasUserPhotos: imgs.length > 0,
        userPhotoCount: imgs.length,
      };
      mergedMap.set(key, adminItem);
      console.log(`[recommend] 管理者スポット注入: ${name} (mood=${answers.mood})`);
    }

    // スコアにランダムジッター（±10%）を加えて毎回異なる結果にする
    const jittered = [...mergedMap.values()].map((item) => ({
      ...item,
      score: item.score * (0.90 + Math.random() * 0.20),
    }));
    const sorted = jittered.sort((a, b) => b.score - a.score);
    const finalItems = chooseFinalResults(sorted, answers.mood);

    // ── 夜モード：夕方〜深夜の場合、各スポットの夜景写真を取得して置き換え ──
    const isNightTime = timeContext.isEvening || timeContext.isLateNight;
    // freeWord / atmosphere に「夜」が含まれる場合も夜モード
    const hasNightWord = [answers.freeWord, answers.atmosphere]
      .some((v) => typeof v === "string" && v.includes("夜"));
    if (apiKey && (isNightTime || hasNightWord)) {
      await Promise.all(
        finalItems.map(async (item, idx) => {
          // ユーザー投稿写真があるスポットはスキップ（既に適切な写真がある）
          if (item.hasUserPhotos) return;
          try {
            const nightQuery = `${item.title} 夜景`;
            const nightPayload: Record<string, unknown> = {
              textQuery: nightQuery,
              languageCode: "ja",
              regionCode: "JP",
              pageSize: 1,
            };
            if (hasOrigin) {
              nightPayload.locationBias = {
                circle: {
                  center: { latitude: answers.originLat, longitude: answers.originLng },
                  radius: 50000,
                },
              };
            }
            const nightRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": apiKey,
                "X-Goog-FieldMask": "places.displayName,places.photos",
              },
              body: JSON.stringify(nightPayload),
              cache: "no-store",
            });
            if (!nightRes.ok) return;
            const nightData = await nightRes.json();
            const nightPlace = nightData.places?.[0];
            if (!nightPlace) return;
            // 同一スポットかどうか名前で大まかに確認
            const nightTitle: string = nightPlace.displayName?.text ?? "";
            const baseTitle = item.title;
            const isMatch =
              nightTitle.includes(baseTitle.slice(0, 4)) ||
              baseTitle.includes(nightTitle.slice(0, 4));
            if (!isMatch) return;
            const nightPhotoNames: string[] = (nightPlace.photos ?? [])
              .slice(0, 3)
              .map((p: { name?: string }) => p.name || "")
              .filter(Boolean);
            if (nightPhotoNames.length === 0) return;
            const nightUrls = (
              await Promise.all(nightPhotoNames.map((name) => getPhotoUrl(name, apiKey)))
            ).filter(Boolean);
            if (nightUrls.length === 0) return;
            // 夜景写真を先頭に差し込み、元の写真は後半に残す
            finalItems[idx] = {
              ...finalItems[idx],
              photoUrl: nightUrls[0],
              photoUrls: [...nightUrls, ...finalItems[idx].photoUrls],
            };
          } catch {
            // 夜景写真取得失敗は無視
          }
        })
      );
    }

    // 最終結果の最寄り駅を並行検索（stationTextが空でlocationがある場合のみ）
    const stationResults = await Promise.all(
      finalItems.map(async (item) => {
        if (item.stationText) return item.stationText; // 管理者スポットはstation_infoを使用
        if (item.location?.latitude && item.location?.longitude) {
          return await findNearestStation(item.location.latitude, item.location.longitude, apiKey);
        }
        return "";
      })
    );

    // ── 複数交通手段ごとの所要時間・距離を並行取得 ────────────────────────────
    const routesByModePerItem: Array<RouteByMode[]> = finalItems.map(() => []);

    if (hasOrigin && apiKey) {
      const modesToShow = getModesToShow(answers.transport, answers.mood);

      if (modesToShow.length === 1) {
        // 単一モード：Places APIの取得済みデータをそのまま使用
        const { icon } = modesToShow[0];
        for (let i = 0; i < finalItems.length; i++) {
          const item = finalItems[i];
          if (item.distanceText || item.durationText) {
            routesByModePerItem[i] = [{ icon, durationText: item.durationText, distanceText: item.distanceText }];
          }
        }
      } else if (modesToShow.length > 1) {
        // 複数モード：Routes Matrix APIで各モードの経路を並行取得
        const modeRoutes = await Promise.all(
          modesToShow.map(async ({ travelMode: tm, icon }) => ({
            icon,
            routes: await fetchRouteMatrix(
              { latitude: answers.originLat!, longitude: answers.originLng! },
              finalItems,
              tm,
              apiKey
            ),
          }))
        );

        for (let i = 0; i < finalItems.length; i++) {
          const modes: RouteByMode[] = modeRoutes
            .map(({ icon, routes }) => ({
              icon,
              durationText: routes[i].durationText,
              distanceText: routes[i].distanceText,
            }))
            .filter((m) => m.durationText || m.distanceText);
          routesByModePerItem[i] = modes;
        }
      }
    }

    const finalResults = finalItems.map(({ score, bucket, location, editorialSummary, amenityTags, hasUserPhotos, userPhotoCount, aiReason, ...rest }, idx) => {
      const reasonData = aiReason;
      const adminSpot = adminSpots.find((s) => s.spot_name === rest.title);
      const chainSpot = chainSpots.find((s) => rest.title.includes(s.spot_name) || rest.title.startsWith(s.chain_search_query ?? "~~"));
      const adminOrChainTags = adminSpot?.auto_tags?.length ? adminSpot.auto_tags : chainSpot?.auto_tags?.length ? chainSpot.auto_tags : null;
      // AI生成タグ + アメニティタグを合わせる（重複排除）
      const aiFeatures = adminOrChainTags ?? (reasonData?.features ?? []);
      const mergedFeatures = [...new Set([...aiFeatures, ...amenityTags])].slice(0, 5);
      return {
        ...rest,
        stationText: stationResults[idx] || rest.stationText,
        reason: reasonData?.reason || editorialSummary.slice(0, 60) || "",
        features: mergedFeatures,
        targetUser: reasonData?.targetUser,
        isUserSpot: approvedNames.has(rest.title),
        hasUserPhotos,
        userPhotoCount,
        routesByMode: routesByModePerItem[idx].length > 0 ? routesByModePerItem[idx] : undefined,
      };
    });

    const warningNotes: string[] = [];
    if (!aiPlans) {
      warningNotes.push("AIによる検索最適化にはOPENAI_API_KEYが必要です。");
    }
    if (!hasOrigin || !travelMode) {
      warningNotes.push("現在地や交通手段によっては距離・所要時間が出ないことがあります。");
    }
    if (!weather.weatherCode && typeof answers.originLat !== "number") {
      warningNotes.push("現在地未使用の場合、天気連動は弱めになります。");
    }

    return json({
      recommendations: finalResults,
      usedAI: !!aiPlans,
      warning: warningNotes.join(" "),
    });
  } catch (error) {
    console.error(error);
    return json(
      {
        error: "おすすめの取得に失敗しました。",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
