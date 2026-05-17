/**
 * ホットペッパーグルメAPI連携 — ルールベース方式
 *
 * 【役割分担】
 *   ルールベース : ユーザーの選択肢・フリーワード → HotPepper検索パラメータに変換
 *   HotPepper   : 実店舗を検索してリアルデータを返す
 *   Google Maps : HotPepperが返した緯度経度に写真を補完する
 *
 * POST /api/hotpepper
 */

import { NextResponse } from "next/server";

const HOTPEPPER_BASE = "https://webservice.recruit.co.jp/hotpepper/gourmet/v1/";

// ─────────────────────────────────────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────────────────────────────────────

type HotPepperParams = {
  lat: number;
  lng: number;
  range: 1 | 2 | 3 | 4 | 5; // 1=300m 2=500m 3=1km 4=2km 5=3km
  count: number;
  open: 1;
  format: "json";
} & Partial<{
  keyword: string;
  genre: string;
  budget: string;
  private_room: 1;
  wifi: 1;
  lunch: 1;
  midnight: 1;
  non_smoking: 1;
  course: 1;
  free_food: 1;
  free_drink: 1;
  parking: 1;
}>;

type HotPepperShop = {
  id: string;
  name: string;
  address: string;
  lat: string;
  lng: string;
  logo_image: string;
  photo: { pc: { l: string; m: string; s: string } };
  genre: { catch: string; name: string; code: string };
  budget: { average: string; name: string };
  catch: string;
  access: string;
  mobile_access: string;
  urls: { pc: string };
  open: string;
  close: string;
  wifi: string;
  private_room: string;
  non_smoking: string;
  lunch: string;
  midnight: string;
  course: string;
  free_drink: string;
  free_food: string;
  card: string;
  capacity: string;
};

type HotPepperResponse = {
  results: {
    results_available: number;
    results_returned: string;
    results_start: number;
    shop?: HotPepperShop[];
    error?: Array<{ message: string; code: string }>;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// ジャンル・予算コードマップ
// ─────────────────────────────────────────────────────────────────────────────

// HotPepper マスターAPI準拠のジャンルコード（2024年確認済み）
const GENRE_CODES: Record<string, string> = {
  G001: "居酒屋",           G002: "ダイニングバー・バル", G003: "創作料理",
  G004: "和食",             G005: "洋食",                G006: "イタリアン・フレンチ",
  G007: "中華",             G008: "焼肉・ホルモン",       G009: "アジア・エスニック料理",
  G010: "各国料理",         G011: "カラオケ・パーティ",   G012: "バー・カクテル",
  G013: "ラーメン",         G014: "カフェ・スイーツ",     G015: "その他グルメ",
  G016: "お好み焼き・もんじゃ", G017: "韓国料理",
};

const BUDGET_CODES: Record<string, string> = {
  B001: "〜500円",        B002: "501〜1000円",    B003: "1001〜1500円",
  B004: "1501〜2000円",   B005: "2001〜3000円",   B006: "3001〜4000円",
  B007: "4001〜5000円",   B008: "5001〜7000円",   B009: "7001〜10000円",
  B010: "10001〜15000円", B011: "15001〜20000円", B013: "20001円〜",
};

// ─────────────────────────────────────────────────────────────────────────────
// ルールベース パラメータ変換
// ─────────────────────────────────────────────────────────────────────────────

// ホットペッパー range: 1=300m 2=500m 3=1km 4=2km 5=3km
// 優先順位: ① dynamicQs の距離回答 → ② 交通手段 → ③ 所要時間 → ④ デフォルト
function distanceToRange(
  dynamicQs: { question: string; answer: string }[],
  time?: string,
  transport?: string | string[]
): 1 | 2 | 3 | 4 | 5 {
  // ① ユーザーが距離感を明示的に回答した場合はそれを優先
  for (const dq of dynamicQs) {
    const ans = dq.answer;
    if (ans.includes("近場") || ans.includes("歩きで") || ans.includes("walking distance")) return 3;
    if (ans.includes("多少") || ans.includes("駅１") || ans.includes("駅1") || ans.includes("A bit further") || ans.includes("1-2 stations")) return 4;
    if (ans.includes("ほどほど遠く") || ans.includes("電車使う") || ans.includes("電車30分") || ans.includes("電車で") || ans.includes("Take a train") || ans.includes("Moderate")) return 5;
    if (ans.includes("ガッツリ遠く") || ans.includes("県外") || ans.includes("Far is fine")) return 5;
  }

  // ② 交通手段から距離範囲を決定（複数選択時は最大値を採用）
  // Hotpepper range: 1=300m / 2=500m / 3=1km / 4=2km / 5=3km（上限）
  if (transport) {
    const modes = Array.isArray(transport) ? transport : [transport];
    const rangePerMode = (m: string): 1 | 2 | 3 | 4 | 5 => {
      if (m.includes("徒歩"))                           return 3; // 1km
      if (m.includes("自転車") || m.includes("バイク")) return 4; // 2km
      if (m.includes("電車")   || m.includes("バス"))   return 4; // 2km（電車は降りてから徒歩圏を想定）
      if (m.includes("車")     || m.includes("ドライブ")) return 5; // 3km（車は広め）
      return 3; // なんでも・未指定
    };
    const maxRange = Math.max(...modes.map(rangePerMode)) as 1 | 2 | 3 | 4 | 5;
    if (maxRange > 3) return maxRange; // 徒歩以外が選ばれていれば反映
    // 徒歩のみの場合は時間も考慮して返す
    if (modes.every(m => m.includes("徒歩"))) return 3;
  }

  // ③ 所要時間ベース
  if (time) {
    if (time.includes("15〜30分")) return 3;
    if (time.includes("30〜60分")) return 4;
    if (time.includes("1〜2時間") || time.includes("2〜4時間") || time.includes("4〜6時間")) return 5;
  }

  return 3; // デフォルト
}

// ─────────────────────────────────────────────────────────────────────────────
// ジャンル × 深掘りタグ マッピングテーブル
// ─────────────────────────────────────────────────────────────────────────────

type DetailRule = {
  keyword?: string;       // HotPepper keyword（未定義 = キーワードなし）
  private_room?: true;    // 個室フラグ
  course?: true;          // コースフラグ
};

type GenreRule = {
  code: string;                          // HotPepper genre コード
  isCafe?: true;                         // カフェ専用パス（genre指定なし・keyword主体）
  details: Record<string, DetailRule>;   // 深掘りキーワード → パラメータ
};

/**
 * ジャンル（food_genre_new の回答テキスト）→ HotPepper パラメータのマッピング定義
 * matchKey: dynamicQs の answer に部分一致させるキー（長いものを先に書く）
 */
const HOTPEPPER_GENRE_MAP: Array<{ matchKey: string; rule: GenreRule }> = [
  // ① 居酒屋 (G001)
  {
    matchKey: "居酒屋",
    rule: {
      code: "G001",
      details: {
        "魚介":     { keyword: "海鮮" },
        "海鮮メイン": { keyword: "海鮮" },
        "焼き鳥":   { keyword: "焼鳥" },
        "個室あり": { private_room: true },
        "大衆酒場": { keyword: "大衆酒場" },
      },
    },
  },
  // ② 和食 (G004)
  {
    matchKey: "和食",
    rule: {
      code: "G004",
      details: {
        "海鮮":   { keyword: "海鮮 刺身" },
        "お寿司": { keyword: "寿司" },
        "天ぷら": { keyword: "天ぷら" },
        "うどん": { keyword: "うどん" },
        "割烹":   { keyword: "懐石 割烹", course: true },
        "懐石":   { keyword: "懐石 割烹", course: true },
      },
    },
  },
  // ③ 洋食 (G005)
  {
    matchKey: "洋食",
    rule: {
      code: "G005",
      details: {
        "ハンバーグ": { keyword: "ハンバーグ" },
        "オムライス": { keyword: "オムライス" },
        "ステーキ":   { keyword: "ステーキ" },
        "レトロ":     { keyword: "レトロ" },
      },
    },
  },
  // ④ イタリアン (G006)
  {
    matchKey: "イタリアン",
    rule: {
      code: "G006",
      details: {
        "ピザ":           { keyword: "ピザ" },
        "パスタ":         { keyword: "パスタ" },
        "バル":           { keyword: "バル" },
        "イタリアン全般": {},           // キーワードなし・ジャンルのみ
      },
    },
  },
  // ⑤ 中華 (G007)
  {
    matchKey: "中華",
    rule: {
      code: "G007",
      details: {
        "町中華":       { keyword: "町中華" },
        "火鍋":         { keyword: "火鍋" },
        "本格四川料理": { keyword: "四川" },
        "食べ放題":     { keyword: "食べ放題" },
      },
    },
  },
  // ⑥ 焼肉 (G008)
  {
    matchKey: "焼肉",
    rule: {
      code: "G008",
      details: {
        "焼肉食べ放題": { keyword: "食べ放題" },
        "高級焼肉":     { keyword: "高級", private_room: true },
        "ホルモン焼き": { keyword: "ホルモン" },
        "ジンギスカン": { keyword: "ジンギスカン" },
      },
    },
  },
  // ⑦ 韓国 (G017) — 深掘りなし
  {
    matchKey: "韓国",
    rule: {
      code: "G017",
      details: {},
    },
  },
  // ⑧ アジア系統 (G009)
  {
    matchKey: "アジア系統",
    rule: {
      code: "G009",
      details: {
        "インドネパール":       { keyword: "インドカレー ネパール" },
        "タイ料理":             { keyword: "タイ料理" },
        "ベトナム料理":         { keyword: "ベトナム フォー" },
        "アジアンエスニック全般": {},   // キーワードなし
      },
    },
  },
  // ⑨ 各国料理 (G010)
  {
    matchKey: "各国料理",
    rule: {
      code: "G010",
      details: {
        "メキシコ料理": { keyword: "タコス メキシコ" },
        "ブラジル料理": { keyword: "シュラスコ" },
        "ロシア料理":   { keyword: "ロシア料理" },
        "他国料理":     {},
      },
    },
  },
  // ⑩ ラーメン (G013)
  {
    matchKey: "ラーメン",
    rule: {
      code: "G013",
      details: {
        "こってりラーメン": { keyword: "豚骨 家系" },
        "あっさりラーメン": { keyword: "醤油 塩" },
        "味噌ラーメン":     { keyword: "味噌ラーメン" },
        "つけ麺":           { keyword: "つけ麺 まぜそば" },
      },
    },
  },
  // ⑪ お好み焼き・もんじゃ (G016) — 深掘りなし
  {
    matchKey: "お好み焼き",
    rule: {
      code: "G016",
      details: {},
    },
  },
  // ⑫ カフェ・スイーツ (G014) — keyword主体でgenre指定なし（isCafe=true）
  {
    matchKey: "カフェ・スイーツ",
    rule: {
      code: "G014",
      isCafe: true,
      details: {
        "スイーツカフェ": { keyword: "スイーツ ケーキ パフェ" },
        "喫茶店":         { keyword: "喫茶店 コーヒー" },
        "流行りカフェ":   { keyword: "おしゃれ 映え" },
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// ジャンル × 深掘りタグ → HotPepper パラメータ解決（単一エントリポイント）
// ─────────────────────────────────────────────────────────────────────────────

type ResolvedParams = {
  genre?: string;
  keyword?: string;
  private_room?: boolean;
  course?: boolean;
  wifi?: boolean;
  isCafe?: boolean;       // カフェ専用パス
};

function resolveHotPepperParams(
  dynamicQs: { question: string; answer: string }[]
): ResolvedParams {
  const allAnswers = dynamicQs.map(dq => dq.answer).join(" ");

  // ── ジャンル特定（matchKey の部分一致）────────────────────────────────────
  const matched = HOTPEPPER_GENRE_MAP.find(({ matchKey }) =>
    allAnswers.includes(matchKey)
  );
  if (!matched) return {};

  const { rule } = matched;

  // ── 深掘りタグ特定（details のキーに部分一致）────────────────────────────
  let detailRule: DetailRule = {};
  for (const [detailKey, params] of Object.entries(rule.details)) {
    if (allAnswers.includes(detailKey)) {
      detailRule = params;
      break;
    }
  }

  // ── フリーワード・選択肢からのフラグ補完 ─────────────────────────────────
  const hasPrivateRoom = !!(detailRule.private_room || allAnswers.includes("個室"));
  const hasCourse      = !!(detailRule.course || allAnswers.includes("割烹") || allAnswers.includes("懐石") || allAnswers.includes("コース料理"));
  const hasWifi        = allAnswers.includes("Wi-Fi") || allAnswers.includes("wifi") || allAnswers.includes("電源");

  // ── カフェ専用パス（genre指定なし・keyword主体） ──────────────────────────
  if (rule.isCafe) {
    const cafeKeyword = detailRule.keyword ?? "カフェ スイーツ";
    return { keyword: cafeKeyword, isCafe: true };
  }

  return {
    genre:        rule.code,
    keyword:      detailRule.keyword,
    private_room: hasPrivateRoom || undefined,
    course:       hasCourse || undefined,
    wifi:         hasWifi || undefined,
  };
}

function budgetFromAnswers(budget?: number, budgetMin?: number): string | undefined {
  if (budget === undefined || budget === null) return undefined;
  if (budget === 0) return undefined;
  const target = (budgetMin && budgetMin > 0)
    ? Math.round((budgetMin + budget) / 2)
    : budget;
  if (target <= 500)   return "B001";
  if (target <= 1000)  return "B002";
  if (target <= 1500)  return "B003";
  if (target <= 2000)  return "B004";
  if (target <= 3000)  return "B005";
  if (target <= 4000)  return "B006";
  if (target <= 5000)  return "B007";
  if (target <= 7000)  return "B008";
  if (target <= 10000) return "B009";
  if (target <= 15000) return "B010";
  if (target <= 20000) return "B011";
  return "B013";
}

// ─────────────────────────────────────────────────────────────────────────────
// HotPepper API 呼び出し
// ─────────────────────────────────────────────────────────────────────────────

async function searchHotPepper(params: HotPepperParams): Promise<HotPepperShop[]> {
  const apiKey = process.env.HOTPEPPER_API_KEY;
  if (!apiKey) { console.warn("[hotpepper] HOTPEPPER_API_KEY が未設定"); return []; }

  const qs = new URLSearchParams({
    key:    apiKey,
    lat:    String(params.lat),
    lng:    String(params.lng),
    range:  String(params.range),
    count:  String(Math.min(params.count, 100)),
    open:   "1",
    format: "json",
  });
  if (params.keyword)      qs.set("keyword",      params.keyword);
  if (params.genre)        qs.set("genre",        params.genre);
  if (params.budget)       qs.set("budget",       params.budget);
  if (params.private_room) qs.set("private_room", "1");
  if (params.wifi)         qs.set("wifi",         "1");
  if (params.lunch)        qs.set("lunch",        "1");
  if (params.midnight)     qs.set("midnight",     "1");
  if (params.non_smoking)  qs.set("non_smoking",  "1");
  if (params.course)       qs.set("course",       "1");
  if (params.free_food)    qs.set("free_food",    "1");
  if (params.free_drink)   qs.set("free_drink",   "1");
  if (params.parking)      qs.set("parking",      "1");

  const safeUrl = `${HOTPEPPER_BASE}?${qs.toString().replace(apiKey, "***")}`;
  console.log(`[hotpepper] 検索URL: ${safeUrl}`);

  try {
    const res = await fetch(`${HOTPEPPER_BASE}?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) { console.error(`[hotpepper] HTTP ${res.status}`); return []; }
    const data: HotPepperResponse = await res.json();
    if (data.results?.error) { console.error("[hotpepper] API エラー:", data.results.error); return []; }
    const shops = data.results?.shop ?? [];
    console.log(`[hotpepper] 取得: ${shops.length} / ${data.results?.results_available ?? 0}件`);
    return shops;
  } catch (e) {
    console.error("[hotpepper] fetch エラー:", e);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Places 写真補完
// ─────────────────────────────────────────────────────────────────────────────

async function resolveGooglePhotoUrl(photoRef: string, apiKey: string): Promise<string | null> {
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${apiKey}`;
  try {
    const res = await fetch(url, { redirect: "manual", cache: "no-store" });
    const location = res.headers.get("location");
    if (location) return location;
    if (res.ok) return res.url;
    return null;
  } catch { return null; }
}

async function fetchGooglePlacesPhotos(shops: HotPepperShop[], maxShops = 8): Promise<Record<string, string[]>> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return {};

  const entries = await Promise.all(
    shops.slice(0, maxShops).map(async (shop): Promise<[string, string[]]> => {
      try {
        const searchUrl = [
          "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
          `?input=${encodeURIComponent(shop.name)}`,
          `&inputtype=textquery`,
          `&fields=place_id,photos`,
          `&locationbias=circle:300@${shop.lat},${shop.lng}`,
          `&key=${apiKey}`,
        ].join("");
        const res = await fetch(searchUrl, { cache: "no-store" });
        if (!res.ok) return [shop.id, []];
        const data = await res.json();
        if (data.status !== "OK") return [shop.id, []];
        const candidate = data.candidates?.[0];
        if (!candidate) return [shop.id, []];

        let photoRefs: { photo_reference: string }[] = candidate.photos ?? [];
        if (candidate.place_id && photoRefs.length < 3) {
          const detailRes = await fetch(
            `https://maps.googleapis.com/maps/api/place/details/json?place_id=${candidate.place_id}&fields=photos&key=${apiKey}`,
            { cache: "no-store" }
          );
          if (detailRes.ok) {
            const d = await detailRes.json();
            if (d.status === "OK") photoRefs = d.result?.photos ?? photoRefs;
          }
        }
        const resolved = await Promise.all(photoRefs.map(p => resolveGooglePhotoUrl(p.photo_reference, apiKey)));
        return [shop.id, resolved.filter((u): u is string => !!u)];
      } catch { return [shop.id, []]; }
    })
  );

  const map: Record<string, string[]> = {};
  for (const [id, urls] of entries) { if (urls.length > 0) map[id] = urls; }
  console.log(`[hotpepper] Google Photos 補完: ${Object.keys(map).length}/${Math.min(shops.length, maxShops)}店舗`);
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// 結果整形
// ─────────────────────────────────────────────────────────────────────────────

function upgradeHotPepperPhotoUrl(url: string): string {
  if (!url || !url.includes("imgfp.hotp.jp")) return url;
  return url.replace(/_\d+(_s)?\.jpg$/i, "_480.jpg");
}

function formatShop(shop: HotPepperShop, googlePhotos?: string[]) {
  const rawPhoto  = shop.photo?.pc?.l ?? shop.logo_image ?? "";
  const mainPhoto = upgradeHotPepperPhotoUrl(rawPhoto);
  let photoUrls: string[];
  if (googlePhotos && googlePhotos.length > 0) {
    const all = mainPhoto ? [...googlePhotos, mainPhoto] : googlePhotos;
    photoUrls = [...new Set(all)];
  } else {
    photoUrls = mainPhoto ? [mainPhoto] : [];
  }
  return {
    id: shop.id, name: shop.name, address: shop.address,
    lat: parseFloat(shop.lat), lng: parseFloat(shop.lng),
    photoUrl: photoUrls[0] ?? mainPhoto, photoUrls,
    genre: shop.genre?.name ?? "", genreCatch: shop.genre?.catch ?? "",
    shopCatch: shop.catch ?? "",
    budget: shop.budget?.average ?? "", budgetName: shop.budget?.name ?? "",
    access: shop.mobile_access || shop.access || "",
    url: shop.urls?.pc ?? "",
    openText: shop.open ?? "", closeText: shop.close ?? "",
    wifi:        shop.wifi         === "あり",
    privateRoom: shop.private_room === "あり",
    nonSmoking:  shop.non_smoking  !== "禁煙席なし",
    lunch:       shop.lunch        === "あり",
    midnight:    shop.midnight     === "あり",
    course:      shop.course       === "あり",
    freeDrink:   shop.free_drink   === "あり",
    freeFood:    shop.free_food    === "あり",
    card:        shop.card         === "利用可",
    capacity:    shop.capacity     ? `最大${shop.capacity}名` : "",
    source:      "hotpepper" as const,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ハンドラ
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      companion  = "一人",
      transport,
      budget,
      budgetMin,
      freeWord,
      originLat,
      originLng,
      area       = "",
      time,
      dynamicQs  = [] as { question: string; answer: string }[],
    } = body;

    if (!originLat || !originLng) {
      return NextResponse.json({ ok: false, error: "位置情報（lat/lng）が必要です" }, { status: 400 });
    }
    if (!process.env.HOTPEPPER_API_KEY) {
      return NextResponse.json({ ok: false, error: "HOTPEPPER_API_KEY 未設定" }, { status: 503 });
    }

    const currentHour  = new Date().getHours();
    const transportStr = Array.isArray(transport) ? transport.join(" ") : String(transport ?? "");
    const fw           = String(freeWord ?? "");
    const companionStr = String(companion ?? "");

    // ── ルールベース パラメータ決定 ───────────────────────────────────────────
    const range      = distanceToRange(dynamicQs, time, transport);
    const resolved   = resolveHotPepperParams(dynamicQs);
    const budgetCode = budgetFromAnswers(budget, budgetMin);

    // 時間帯
    const isLunch    = currentHour >= 11 && currentHour < 14;
    const isMidnight = currentHour >= 23  || currentHour < 5;

    // 同行者
    const isCouple = companionStr.includes("恋人") || companionStr.includes("パートナー") || companionStr.includes("カップル") || companionStr.includes("Partner");
    const isFamily = companionStr.includes("家族") || companionStr.includes("Family") || companionStr.includes("子");
    const isGroup  = companionStr.includes("大人数") || companionStr.includes("グループ") || companionStr.includes("Large Group");

    // 交通手段
    const hasCar = transportStr.includes("車") || transportStr.includes("ドライブ") || transportStr.includes("Car");

    // フリーワード → フラグ
    const ruleFreeFood   = fw.includes("食べ放題") || fw.includes("バイキング") || fw.includes("ビュッフェ");
    const ruleFreeDrink  = fw.includes("飲み放題");
    const rulePrivate    = fw.includes("個室") || fw.includes("プライベート");
    const ruleWifi       = fw.includes("WiFi") || fw.includes("Wi-Fi") || fw.includes("ワイファイ") || fw.includes("電源");
    const ruleParking    = fw.includes("駐車場") || hasCar;
    const ruleCourse     = fw.includes("コース") || fw.includes("フルコース");
    const ruleNonSmoking = fw.includes("禁煙") || fw.includes("煙草なし");

    // フラグ確定（resolved + freeWordルール のOR）
    const usePrivateRoom = !!(resolved.private_room || rulePrivate);
    const useCourse      = !!(resolved.course       || ruleCourse);
    const useWifi        = !!(resolved.wifi         || ruleWifi);
    const useFreeFood    = !!ruleFreeFood;
    const useFreeDrink   = !!ruleFreeDrink;
    const useParking     = !!ruleParking;
    const useNonSmoking  = !!ruleNonSmoking;

    // キーワード: resolved → 同行者補完 → カフェ接頭辞
    const isSweetsSearch   = resolved.isCafe ?? false;
    const companionKw      = isCouple ? "デート 雰囲気" : isFamily ? "家族向け" : isGroup ? "大人数 宴会" : "";
    const baseKeyword      = [resolved.keyword, companionKw].filter(Boolean).join(" ").trim().slice(0, 50) || undefined;
    const effectiveKeyword = isSweetsSearch
      ? ("カフェ スイーツ " + (baseKeyword ?? "")).trim().slice(0, 50)
      : baseKeyword;
    const effectiveGenre   = isSweetsSearch ? undefined : resolved.genre;

    const finalParams = {
      range, genre: effectiveGenre, budgetCode,
      keyword: effectiveKeyword, isLunch, isMidnight,
      usePrivateRoom, useWifi, useCourse, useFreeFood, useFreeDrink, useParking, useNonSmoking,
    };
    console.log("[hotpepper] ルールベース パラメータ:", finalParams);

    const searchParams: HotPepperParams = {
      lat: originLat, lng: originLng, range, count: 20, open: 1, format: "json",
      ...(effectiveKeyword?.trim() ? { keyword: effectiveKeyword.trim() } : {}),
      ...(effectiveGenre           ? { genre:   effectiveGenre }          : {}),
      ...(budgetCode               ? { budget:  budgetCode }              : {}),
      ...(usePrivateRoom           ? { private_room: 1 }                  : {}),
      ...(useWifi                  ? { wifi:         1 }                  : {}),
      ...(isLunch                  ? { lunch:         1 }                 : {}),
      ...(isMidnight               ? { midnight:      1 }                 : {}),
      ...(useNonSmoking            ? { non_smoking:   1 }                 : {}),
      ...(useCourse                ? { course:        1 }                 : {}),
      ...(useFreeFood              ? { free_food:     1 }                 : {}),
      ...(useFreeDrink             ? { free_drink:    1 }                 : {}),
      ...(useParking               ? { parking:       1 }                 : {}),
    };

    let shops = await searchHotPepper(searchParams);
    let isFallback = false;

    // ── 段階的フォールバック ──────────────────────────────────────────────────
    // キーワードとジャンルが両方指定されている場合、件数が少なければジャンルのみで追加取得してマージ
    if (searchParams.keyword && searchParams.genre && shops.length < 10) {
      console.log(`[hotpepper] ${shops.length}件（キーワード有） → ジャンルのみで追加取得してマージ`);
      const genreOnly = await searchHotPepper({ ...searchParams, keyword: undefined, count: 20 });
      // キーワード一致を先頭に、ジャンルのみを後ろに追加（重複除去）
      const existingIds = new Set(shops.map(s => s.id));
      const merged = [...shops, ...genreOnly.filter(s => !existingIds.has(s.id))];
      shops = merged.slice(0, 20);
      console.log(`[hotpepper] マージ後: ${shops.length}件`);
    }
    if (shops.length === 0 && searchParams.genre) {
      console.log("[hotpepper] 0件 → キーワード除去・ジャンルのみで再検索");
      shops = await searchHotPepper({ ...searchParams, keyword: undefined });
    }
    if (shops.length === 0 && searchParams.genre) {
      console.log("[hotpepper] 0件 → 範囲3kmに拡大");
      shops = await searchHotPepper({ ...searchParams, keyword: undefined, range: 5 });
    }
    if (shops.length === 0) {
      const kw = isSweetsSearch ? "カフェ スイーツ" : (searchParams.keyword ?? undefined);
      if (kw) {
        console.log(`[hotpepper] 0件 → budget・ジャンル除去・キーワード「${kw}」で再検索`);
        shops = await searchHotPepper({ ...searchParams, genre: undefined, budget: undefined, keyword: kw, range: 5 });
      }
    }
    if (shops.length === 0 && resolved.genre) {
      const genreKw = GENRE_CODES[resolved.genre];
      console.log(`[hotpepper] 0件 → ジャンル名「${genreKw}」をキーワードに変換`);
      shops = await searchHotPepper({ ...searchParams, genre: undefined, budget: undefined, keyword: genreKw, wifi: undefined, private_room: undefined, range: 5 });
      if (shops.length > 0) isFallback = true;
    }
    if (shops.length === 0) {
      console.log("[hotpepper] 0件 → 全条件除去（最終手段）");
      shops = await searchHotPepper({ ...searchParams, genre: undefined, keyword: undefined, budget: undefined, wifi: undefined, private_room: undefined, non_smoking: undefined, course: undefined, range: 5 });
      if (shops.length > 0) isFallback = true;
    }

    // ── Google Places で写真補完 → 整形 ─────────────────────────────────────
    const googlePhotoMap = await fetchGooglePlacesPhotos(shops);

    return NextResponse.json({
      ok:         true,
      shops:      shops.map(s => formatShop(s, googlePhotoMap[s.id])),
      total:      shops.length,
      isFallback,
      debug:      { finalParams },
    });
  } catch (e) {
    console.error("[hotpepper] POST エラー:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

/** GET /api/hotpepper — APIキー設定確認 */
export async function GET() {
  return NextResponse.json({
    ok: !!process.env.HOTPEPPER_API_KEY,
    message: process.env.HOTPEPPER_API_KEY
      ? "HotPepper APIキーが設定されています"
      : "HOTPEPPER_API_KEY が未設定。https://webservice.recruit.co.jp/ で取得してください",
  });
}
