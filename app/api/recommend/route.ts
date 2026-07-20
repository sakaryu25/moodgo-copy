export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 実トラフィックの中核。キャッシュミス時はAIプラン生成＋Google searchText(実測9s)＋
// Yahoo補完＋駅/写真エンリッチを行うため、既定タイムアウトでの断続切断を防ぐべく明示。
export const maxDuration = 60;
import { NextResponse, after } from "next/server";
import { AsyncLocalStorage } from "async_hooks";
import OpenAI from "openai";
import { supabase } from "@/lib/supabase";
import { MOOD_TAG_MAP, MOOD_SHORT_KEY_TO_TAG } from "@/lib/predefined-tags";
import { distanceKmFor, formatDistText, farLeanSpread } from "@/lib/distance";
import { logServerError, scheduleServerError } from "@/lib/server-log";
import { applyAiRanking } from "@/lib/ai-ranking";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { fetchSimilarStats } from "@/lib/feedback-stats";
import { pickGsiResult } from "@/lib/gsi-geocode";
import { mergedPlacePhotos, filterLivePhotos } from "@/lib/place-photos";

// ── Google API 呼び出し計測（コスト可視化）─────────────────────────────────────
// リクエスト単位で Google API の呼び出し回数を種別ごとにカウントし、最後にログ出力する。
// AsyncLocalStorage で並行リクエスト間の混在を防ぐ。gfetch で実 fetch をラップして計上。
type ApiCounts = {
  searchText: number; searchNearby: number; geocode: number;
  routes: number; photo: number; detail: number; other: number;
};
const apiCounterStore = new AsyncLocalStorage<{ counts: ApiCounts }>();
function newApiCounts(): ApiCounts {
  return { searchText: 0, searchNearby: 0, geocode: 0, routes: 0, photo: 0, detail: 0, other: 0 };
}
// ── Google-offモード（env・既定OFF＝従来通り）─────────────────────────────────
//   RECOMMEND_DISABLE_GOOGLE=true にすると recommend からの Google Places 検索
//   (searchText/searchNearby) を止め、DB(Supabase/OSM)だけで結果を返す。
//   → ①coverage穴埋め ②写真/営業時間のGoogleエンリッチ ③補足が空になり auto-save
//     (Google→DB保存)も自動停止＝規約リスクも消える。
//   geocode(位置解決)/routes(経路・移動時間)は対象外＝GSI優先で元々最小・維持。
//   代償: 極端に薄いエリアで結果が少なめ・一部写真がプレースホルダー・最寄駅が出ない場合あり。
//   Vercelのenvで即オン/オフ・全気分に即反映（コード改変なしで戻せる）。
const RECOMMEND_DISABLE_GOOGLE = process.env.RECOMMEND_DISABLE_GOOGLE === "true";

/** Google API を叩く fetch のラッパー。URLから種別を判定してカウントする。 */
function gfetch(url: string, init?: RequestInit): Promise<Response> {
  if (RECOMMEND_DISABLE_GOOGLE && (url.includes("places:searchText") || url.includes("places:searchNearby"))) {
    // 実際には叩かず空の結果を返す＝呼び出し側は「候補0件」として安全に処理（＝課金ゼロ・カウントもしない）。
    return Promise.resolve(new Response('{"places":[]}', { status: 200, headers: { "Content-Type": "application/json" } }));
  }
  const store = apiCounterStore.getStore();
  if (store) {
    const c = store.counts;
    if (url.includes("places:searchText")) c.searchText++;
    else if (url.includes("places:searchNearby")) c.searchNearby++;
    else if (url.includes("maps/api/geocode")) c.geocode++;
    else if (url.includes("routes.googleapis") || url.includes("computeRouteMatrix") || url.includes(":computeRoutes")) c.routes++;
    else if (url.includes("/photos/") || url.includes("/photo") || url.includes("/media")) c.photo++;
    // Place Details (GET /v1/places/{id})。media/photosを先に判定済みなのでここは純粋なDetails。
    //   従来otherに落ちて¥集計から漏れていた（監査2026-07-05・コスト過小計上）。
    else if (/places\.googleapis\.com\/v1\/places\/[^:]/.test(url)) c.detail++;
    else c.other++;
  }
  return fetch(url, init);
}

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
  /** クイズ Step4 で選んだ距離感のkm数 */
  radiusKm?: number;
  /** 'current_location' = GPS使用, 'manual' = エリア名入力 */
  areaMode?: "current_location" | "manual";
  /** 距離感ラベル（例: 'ちょっと遠くてもOK'） */
  distanceFeeling?: string;
  dynamicQ1?: { question: string; answer: string } | string;
  dynamicQ2?: { question: string; answer: string } | string;
  dynamicQ3?: { question: string; answer: string } | string;
  dynamicQ4?: { question: string; answer: string } | string;
  /** 全動的質問回答の配列（dynamicQ1-4の拡張版）。存在する場合はこちらを優先使用 */
  dynamicQs?: { question: string; answer: string }[];
  /** AI相談（自由入力→OpenAI提案）フローの場合 true */
  aiChat?: boolean;
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

// ── DB充足フロア（環境変数で調整可・デフォルト=現状値）──────────────────────────
//   sbQualified(DBのジャンル適合候補) がフロア以上なら Google/Yahoo 補完を呼ばずDB完結。
//   フロアを下げるほど Google補完(coverage=候補不足の穴埋め)の発火が減り課金が下がる。
//   品質低下は AI最終審査(並べ替え＋reject) がガードする。段階ロールアウト・即巻き戻し用に
//   Vercelの環境変数で各値を上書き可能（未設定なら従来どおりの挙動）。
const envFloor = (key: string, fallback: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
};
const FOOD_DB_FLOOR_RICH = envFloor("FOOD_DB_FLOOR_RICH", 10);   // 在庫多: ラーメン/居酒屋/カフェ/和食/焼肉
const FOOD_DB_FLOOR_NICHE = envFloor("FOOD_DB_FLOOR_NICHE", 5);  // ニッチ: 各国料理/エスニック等
const FOOD_DB_FLOOR_OTHER = envFloor("FOOD_DB_FLOOR_OTHER", 8);  // その他飲食
// 非飲食フロアを8→12に引き上げ(2026-07-18): 遊び/わいわい/ゆっくり等の都市活動系は、DBに“ジャンル一致”
//   候補が8件あっても中身が薄い/雑(緩タグのフーカ/ピラティス/雑貨等)で、reject+finalize後に3-9件へ痩せ→
//   8件未満はキャッシュされず毎回シャッフルで変わる。フロアを12にすると、その手前で無料のYahoo(必要ならGoogle)
//   補完が発火し、実在の遊び場(カラオケ/ゲーセン/ボウリング等)がプールに入る＝厚く・安定・rerankerがノイズを弾ける。
//   飲食/自然など元々在庫が厚い気分は12超で従来どおりDB完結(補完発火せず)＝コスト影響は薄い気分に限定。env上書き可。
const NONFOOD_DB_FLOOR = envFloor("NONFOOD_DB_FLOOR", 12);       // 非飲食: 公園/温泉/ジム/水族館/神社/遊び場等
// 最終手段の「ジャンル外(混在)」補填を何件まで許すか（同ジャンル補填は常に15件まで）。
//   デフォルト15=従来挙動。下げると「正直に少なく出す」＝rejectで消した枠を場違いで埋め戻さない。
//   floorを下げて結果が薄くなる時の品質ガード。env で段階調整・即巻き戻し可。
const MIXED_BACKFILL_FLOOR = envFloor("MIXED_BACKFILL_FLOOR", 15);

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

// 期間限定バッジ用: 各recの supabaseId から places.available_from/until を一括取得して載せる。
//   ⚠recommend には返却経路が複数ある（穴場/時間潰し/フリーワード/relax/AI/最終）。どの経路でも
//     「検索結果で期間限定と分かる」ようにするため、全returnの直前でこのヘルパーを通す（DRY）。
//     列が無い/未適用/supabaseIdなしでもバッジ無しで安全に素通り。
// ④ 季節ボーナス: 今の季節に合う季節スポット(桜/花火/紅葉/イルミ等)を距離ボーナスで上位化し、
//   季節外れ(冬の花火大会・夏の紅葉ライトアップ等)は下げる。期間限定イベントの多くは名前に季節語を
//   含むため名前一致で「季節の今だけ」を自動で拾う。旬=+2.2km分有利 / 季節外れ=-1.2km。
const SEASON_KW: { re: RegExp; months: number[] }[] = [
  { re: /桜|花見|さくら|サクラ/, months: [3, 4] },
  { re: /梅まつり|梅林|観梅|梅の花|梅園/, months: [2, 3] },
  { re: /藤棚|藤まつり|ネモフィラ|チューリップ|芝桜|牡丹|ぼたん/, months: [4, 5] },
  { re: /紫陽花|あじさい|アジサイ|花菖蒲|ホタル|蛍|バラ園|ラベンダー/, months: [6] },
  { re: /花火|納涼|七夕|ひまわり|向日葵|海水浴|夏祭り|盆踊り/, months: [7, 8] },
  { re: /紅葉|もみじ|モミジ|こうよう|コスモス|秋祭り|ハロウィン/, months: [10, 11] },
  { re: /イルミ|イルミネーション|クリスマス|ウィンター|光の(?:祭|世界|イベント|фестиваль)/, months: [11, 12] },
  { re: /初詣|初日の出|樹氷|雪まつり|かまくら|スキー|スケート|ウィンタースポーツ/, months: [12, 1, 2] },
];
function seasonalBonusKm(name?: string | null): number {
  const hay = name ?? "";
  if (!hay) return 0;
  const m = new Date(Date.now() + 9 * 3600_000).getUTCMonth() + 1;  // JST基準の月
  for (const s of SEASON_KW) {
    if (s.re.test(hay)) return s.months.includes(m) ? 2.2 : -1.2;
  }
  return 0;
}

// ② mood blurb を recs の reason に当てる共通ヘルパー。
//   本経路(attachAvailability)＋スナップショット応答(パイプラインskip)の両方から呼び、
//   キャッシュ済みおすすめ一言を reason/aiReason に反映＋不足分の生成を after() で予約する。
async function applyMoodBlurbs<T extends object>(recs: T[], moodGroupStr?: string): Promise<T[]> {
  if (!Array.isArray(recs) || recs.length === 0 || !moodGroupStr || !MOOD_BLURB_PHRASE[moodGroupStr]) return recs;
  const titles = [...new Set(recs.map((r) => String((r as { title?: string }).title ?? "")).filter(Boolean))];
  if (titles.length === 0) return recs;
  const hit = await ltCacheGetMany(titles.map((t) => moodBlurbKey(moodGroupStr, t)));
  // 🥇 その人向け1行理由(_personaReason=コンシェルジュ再ランクが返した「この人・この気分に効く一言」)を
  //   最優先で reason に採用。無ければ②の汎用おすすめ一言(mblurbキャッシュ)。どちらも無ければ従来のまま。
  const out = recs.map((r) => {
    const persona = (r as { _personaReason?: string })._personaReason;
    if (persona && persona.trim()) return ({ ...r, reason: persona, aiReason: persona } as T);
    const t = String((r as { title?: string }).title ?? "");
    const c = t ? (hit.get(moodBlurbKey(moodGroupStr, t)) as { blurb?: string } | undefined) : undefined;
    return c?.blurb ? ({ ...r, reason: c.blurb, aiReason: c.blurb } as T) : r;
  });
  scheduleMoodBlurbGeneration(out as { title?: string; features?: string[]; tags?: string[] }[], moodGroupStr);
  return out;
}

// ⑥ 穴場を毎回1枠保証: バッジ結果に hidden_gem が無ければ、知られすぎていない候補を1つ穴場に昇格＋一言。
//   驚き＝満足。上位の主役(0番)は崩さず、写真ありでバッジ未付与の候補を後方から選ぶ。薄い結果(<5件)では無理に作らない。
function ensureHiddenGem<T extends object>(recs: T[]): T[] {
  if (!Array.isArray(recs) || recs.length < 5) return recs;
  if (recs.some((r) => (r as { mgBadge?: string }).mgBadge === "hidden_gem")) return recs;
  let pick = -1;
  for (let i = recs.length - 1; i >= 1; i--) {   // i=0(主役)は避け、後方の“発見”を穴場に
    const rr = recs[i] as { mgBadge?: string; isSponsored?: boolean; photoUrls?: string[] };
    if (!rr.mgBadge && !rr.isSponsored && (rr.photoUrls?.length ?? 0) > 0) { pick = i; break; }
  }
  if (pick < 0) return recs;
  const gemReason = "地元でひそかに愛される、まだ知られていない穴場。";
  return recs.map((r, i) => {
    if (i !== pick) return r;
    const rr = r as { reason?: string; aiReason?: string };
    // 既存の個人化理由(persona/②)は壊さず、無い時だけ「なぜ穴場か」を入れる。バッジ(穴場ピル)は必ず付く。
    return { ...r, mgBadge: "hidden_gem", reason: rr.reason || gemReason, aiReason: rr.aiReason || gemReason } as T;
  });
}

async function attachAvailability<T extends object>(recs: T[], moodGroupStr?: string): Promise<T[]> {
  if (!Array.isArray(recs) || recs.length === 0) return recs;
  // ── 写真の最終正規化（DRY・全return共通）─────────────────────────────────
  //   どの経路(穴場/時間潰し/フリーワード/relax/AI/最終/admin補足/Google補足)を通っても、空URLを除いて重複排除する。
  //   ⚠2026-07-19 Google写真ライブ表示復活: ここでは googleapis を除去しない（実行時に取ったばかりの生きたGoogle写真を
  //     2枚目以降に出すため）。DB由来の古い失効Google除去は mergedPlacePhotos 側（rec組み立て時）で担保済み。
  recs = recs.map((r) => {
    const rr = r as { photoUrls?: unknown; photoUrl?: unknown };
    const hasArr = Array.isArray(rr.photoUrls);
    if (!hasArr && typeof rr.photoUrl !== "string") return r;   // 写真フィールドなし＝素通り
    const live = [...new Set([
      ...(hasArr ? (rr.photoUrls as string[]) : []),
      typeof rr.photoUrl === "string" ? rr.photoUrl : "",
    ].filter((u): u is string => typeof u === "string" && !!u.trim()))];
    if (hasArr && (rr.photoUrls as string[]).length === live.length && (rr.photoUrl ?? "") === (live[0] ?? "")) return r;  // 変化なし
    return { ...r, photoUrls: live, photoUrl: live[0] ?? "" } as T;
  });
  // ── ② 気分に合わせた「おすすめ一言」をキャッシュから reason に当てる（全経路共通）─────
  //   まったり×自然→「大自然の中でゆっくりできる〜がおすすめ！」等。無ければ pickReason のまま。
  recs = await applyMoodBlurbs(recs, moodGroupStr);
  const sidOf = (r: T) => (r as { supabaseId?: string }).supabaseId ?? "";
  // ── MoodGoバッジ（②・2026-07-17）: 定番/穴場/話題 ────────────────────────────
  //   ★評価がGoogle撤廃で全域空になったため、今あるデータだけで信頼シグナルを出す。
  //   優先度: 話題(trending=Moodログ2件+) > 定番(classic=有名ソース/評価件数) > 穴場(hidden_gem=#穴場スポット+写真あり)。
  //   穴場はjapan47go由来で大量にあるためレスポンス毎に最大5枚に制限（バッジの希少性=意味を守る）。
  let hiddenGemLeft = 5;
  const CLASSIC_SRC = /wikidata|hyakusen|michi-no-eki|curated|env-wetland|tanada/;
  const withBadge = (r: T, srcType?: string | null): T => {
    const rr = r as {
      mgBadge?: string; isSponsored?: boolean; tags?: string[]; rating?: number | null;
      userRatingCount?: number | null; moodLog?: { count?: number }; photoUrls?: string[];
    };
    if (rr.mgBadge || rr.isSponsored) return r;   // 既存バッジ/PR枠には重ねない
    const tags = Array.isArray(rr.tags) ? rr.tags : [];
    const cnt = typeof rr.userRatingCount === "number" ? rr.userRatingCount : 0;
    const rating = typeof rr.rating === "number" ? rr.rating : 0;
    if ((rr.moodLog?.count ?? 0) >= 2) return { ...r, mgBadge: "trending" } as T;
    if (CLASSIC_SRC.test(srcType ?? "") || cnt >= 100 || (rating >= 4.2 && cnt >= 30)) return { ...r, mgBadge: "classic" } as T;
    if (hiddenGemLeft > 0 && tags.includes("#穴場スポット") && (rr.photoUrls?.length ?? 0) > 0) {
      hiddenGemLeft--;
      return { ...r, mgBadge: "hidden_gem" } as T;
    }
    return r;
  };
  if (!supabase) return ensureHiddenGem(recs.map((r) => withBadge(r)));
  try {
    const sids = [...new Set(recs.map(sidOf).filter(Boolean))];
    if (sids.length === 0) return ensureHiddenGem(recs.map((r) => withBadge(r)));
    // 期間限定(available_from/until)とバッジ用のsource_typeを同じ1クエリで取得（追加コストゼロ）
    const pmap = new Map<string, { from: string | null; until: string | null; src: string | null }>();
    for (const chunk of (function* () { for (let i = 0; i < sids.length; i += 300) yield sids.slice(i, i + 300); })()) {
      const { data } = await supabase.from("places").select("id, available_from, available_until, source_type").in("id", chunk);
      for (const p of (data ?? []) as Array<{ id: string; available_from: string | null; available_until: string | null; source_type: string | null }>) {
        pmap.set(String(p.id), { from: p.available_from, until: p.available_until, src: p.source_type });
      }
    }
    // ④ 「今だけ」判定: 公開期間中(from<=今日<=until, nullは開放端)なら limitedNow=true → カードで今だけバッジ
    const todayJst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    return ensureHiddenGem(recs.map((r) => {
      const pv = pmap.get(sidOf(r));
      const inWindow = !!pv && (!!pv.from || !!pv.until) && (!pv.from || pv.from <= todayJst) && (!pv.until || pv.until >= todayJst);
      const withAvail = pv && (pv.from || pv.until)
        ? ({ ...r, availableFrom: pv.from, availableUntil: pv.until, limitedNow: inWindow } as T)
        : r;
      return withBadge(withAvail, pv?.src);
    }));
  } catch { return ensureHiddenGem(recs.map((r) => withBadge(r))); }
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

// タグ別キュレーションスポット（curated_spots テーブル）を取得し、
// admin転載と同じ ApprovedSuggestion 形に正規化して返す。テーブル未作成時は空配列。
async function fetchCuratedSpots(): Promise<ApprovedSuggestion[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("curated_spots")
      .select("name, address, lat, lng, google_place_id, tags, description, image_url, photo_urls, station_info, is_active")
      .eq("is_active", true)
      .limit(2000);
    if (error || !data) return [];   // 未作成(42P01)等は空で素通り
    return (data as Array<Record<string, unknown>>).map(r => ({
      spot_name: String(r.name ?? ""),
      description: (r.description as string | null) ?? null,
      address: (r.address as string | null) ?? null,
      lat: typeof r.lat === "number" ? r.lat : null,
      lng: typeof r.lng === "number" ? r.lng : null,
      google_place_name: String(r.name ?? ""),
      google_maps_uri: null,
      auto_tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      station_info: (r.station_info as string | null) ?? null,
      image_urls: Array.isArray(r.photo_urls) ? (r.photo_urls as string[])
        : (r.image_url ? [String(r.image_url)] : []),
      source: "admin",     // 注入ロジックで admin転載と同じ扱い（優先表示）
      is_chain: false,
      chain_search_query: null,
      available_from: null,   // 期間制限なし（常時表示）
      available_until: null,
    }));
  } catch {
    return [];
  }
}


// ── フィードバック自己改善ループ ────────────────────────────────────────────
// mood_place_ratings（合う👍/合わない👎）を集計し、検索結果へ反映する。
//   ・除外: 👎3件以上 かつ 過半数 → その気分グループの検索から出さない
//   ・降格: 👎が👍より多い → リストの末尾へ
// 気分は moodGroup で正規化（"まったり"/"まったりしたい" 等の表記ゆれを吸収）。
// 集計はモジュールキャッシュ(10分)でAPIコストゼロ運用。
type MoodRatingAgg = Map<string, { good: number; bad: number }>;  // key: moodGroup||nameLower
let _ratingCache: { at: number; agg: MoodRatingAgg } | null = null;
async function fetchMoodRatingAgg(): Promise<MoodRatingAgg> {
  if (_ratingCache && Date.now() - _ratingCache.at < 10 * 60 * 1000) return _ratingCache.agg;
  const agg: MoodRatingAgg = new Map();
  try {
    if (supabase) {
      const { data } = await supabase
        .from("mood_place_ratings")
        .select("place_name, mood, verdict")
        .limit(5000);
      for (const row of data ?? []) {
        const mg = moodGroup(row.mood ?? "") || (row.mood ?? "");
        const key = `${mg}||${String(row.place_name ?? "").toLowerCase().trim()}`;
        const cur = agg.get(key) ?? { good: 0, bad: 0 };
        if (row.verdict === "good") cur.good++;
        else if (row.verdict === "bad") cur.bad++;
        agg.set(key, cur);
      }
    }
  } catch { /* テーブル未作成等は無視 */ }
  _ratingCache = { at: Date.now(), agg };
  return agg;
}
// 二項Wilson下限（95%）: 少件数の高評価が過大評価されないようにする
function wilsonLowerBinomial(good: number, total: number): number {
  if (total === 0) return 0;
  const z = 1.96, p = good / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denom);
}

// ── ② 暗黙フィードバック(spot_engagement)の集計（10分キャッシュ・テーブル未作成でも動作）──
//   地図クリック/詳細閲覧/お気に入り/行った！を行動の強さで重み付けして学習する。
const ENGAGEMENT_WEIGHTS: Record<string, number> = {
  favorite: 3, visited: 4, map_click: 2, share: 2, detail_view: 1,
};
type EngagementAgg = Map<string, number>;  // key: moodGroup||nameLower → 重み付き合計
let _engCache: { at: number; agg: EngagementAgg } | null = null;
async function fetchEngagementAgg(): Promise<EngagementAgg> {
  if (_engCache && Date.now() - _engCache.at < 10 * 60 * 1000) return _engCache.agg;
  const agg: EngagementAgg = new Map();
  try {
    if (supabase) {
      // item8(学習加速): まず事前集計済みの place_mood_affinity を読む。
      //   bump_affinity が行動のたびに原子的に加算した「場所×気分の好まれ度」を
      //   そのまま使うため、raw spot_engagement の8000行スキャン＋都度再集計が不要。
      //   さらに raw は直近8000件で頭打ちだが、affinityは全履歴を保持＝学習が劣化しない。
      let usedAffinity = false;
      try {
        const { data: aff } = await supabase
          .from("place_mood_affinity")
          .select("place_name, mood, score")
          .gt("score", 0)
          .order("score", { ascending: false })
          .limit(20000);
        if (aff && aff.length) {
          for (const row of aff) {
            const mg = moodGroup(row.mood ?? "") || (row.mood ?? "");
            const key = `${mg}||${String(row.place_name ?? "").toLowerCase().trim()}`;
            // 気分グループ内の全気分スコアを合算（learnScoreの対数減衰で過大評価は飽和）
            agg.set(key, (agg.get(key) ?? 0) + (Number(row.score) || 0));
          }
          usedAffinity = true;
        }
      } catch { /* place_mood_affinity 未作成 → raw spot_engagement にフォールバック */ }

      // フォールバック: affinity表が空/未作成なら従来どおり raw を集計（移行期も学習が途切れない）
      if (!usedAffinity) {
        const { data } = await supabase
          .from("spot_engagement")
          .select("place_name, mood, action")
          .order("created_at", { ascending: false })
          .limit(8000);
        for (const row of data ?? []) {
          const mg = moodGroup(row.mood ?? "") || (row.mood ?? "");
          const key = `${mg}||${String(row.place_name ?? "").toLowerCase().trim()}`;
          agg.set(key, (agg.get(key) ?? 0) + (ENGAGEMENT_WEIGHTS[row.action ?? ""] ?? 0));
        }
      }

      // Moodログ(気分ベース口コミ)を学習スコアへ反映: 投稿の気分タグ→気分グループ別に加点。
      //   自然投稿多→自然検索で加点／恋人投稿多→デート系で加点／また行きたい・参考になった を重み付け。
      //   同じ agg(key=`気分グループ||店名`) に足すため learnScore がそのまま拾う。データ0でも無害。
      try {
        const { data: posts } = await supabase
          .from("spot_posts")
          .select("place_name, mood_tags, want_revisit, helpful_count")
          .eq("status", "approved").in("visibility", ["spot_public_anonymous", "public"])
          .limit(5000);
        for (const row of posts ?? []) {
          const nm = String(row.place_name ?? "").toLowerCase().trim();
          if (!nm) continue;
          const w = 2 + (row.want_revisit ? 2 : 0) + Math.min(2, Number(row.helpful_count) || 0);
          for (const tag of (row.mood_tags as string[] | null) ?? []) {
            const mg = moodGroup(String(tag).replace(/^#/, ""));
            if (!mg) continue;
            const key = `${mg}||${nm}`;
            agg.set(key, (agg.get(key) ?? 0) + w);
          }
        }
      } catch { /* spot_posts 未作成は無視 */ }
    }
  } catch { /* テーブル未作成等は無視（SQL: supabase/learning-tables.sql / db-accumulation.sql）*/ }
  _engCache = { at: Date.now(), agg };
  return agg;
}

// ── ⑧ 協調フィルタ（この気分で好きな人はこれも）──────────────────────────────
// アイテム間の共起シグナル: 「同じ気分グループで、あるスポットXに反応した人は、他の
//   どのスポットYにも反応しがちか」を spot_engagement（device_id 付き行）から近似する。
//   ・per-user の生ログ(device_id=funnel-tracking.sql)がある行だけを共起の素地に使う。
//     device_id 列が無い/薄い環境では何も加点しない＝現状と完全同一（degrade gracefully）。
//   ・共起の素地は「device × 気分グループ」単位の basket（place小文字→行動重み）。10分キャッシュ。
//   ・buildCollabBoost が、このユーザーの「過去に高評価した場所(anchors)」を含む basket を走査し、
//     一緒に反応された近縁スポットへ 0〜CAP の小さなブーストを返す。これを learnScore に薄く
//     合成し、距離/学習/persona を覆さない範囲（上限つき）でのみ効かせる。データ薄/無なら常に0。
//   ・SQL: supabase/collaborative-cooccurrence.sql（索引のみ・未適用でも動作／RPCは任意・未使用）
type CoocBasket = { mg: string; places: Map<string, number> };
let _coocCache: { at: number; baskets: CoocBasket[]; devices: number } | null = null;
async function fetchCoocBaskets(): Promise<{ baskets: CoocBasket[]; devices: number }> {
  if (_coocCache && Date.now() - _coocCache.at < 10 * 60 * 1000) return _coocCache;
  let baskets: CoocBasket[] = [];
  let devices = 0;
  try {
    if (supabase) {
      // device_id 付きの行動ログを直近から取得（funnel-tracking.sql 未適用=列なしならエラー→空）。
      const q = supabase
        .from("spot_engagement")
        .select("place_name, mood, action, device_id")
        .not("device_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(6000);
      // 検索のホット経路をブロックしないよう2.5sで打ち切り（超過時は協調ブーストなし＝現状維持）。
      const timeout = new Promise<{ data: null }>((resolve) =>
        setTimeout(() => resolve({ data: null }), 2500));
      const { data } = (await Promise.race([q, timeout])) as { data: Array<Record<string, unknown>> | null };
      // (device_id, moodGroup) ごとに basket 化。行動は ENGAGEMENT_WEIGHTS で重み付け。
      const byKey = new Map<string, CoocBasket>();
      const devSet = new Set<string>();
      for (const row of data ?? []) {
        const dev = String(row.device_id ?? "").trim();
        if (!dev) continue;
        const mg = moodGroup(String(row.mood ?? "")) || String(row.mood ?? "");
        if (!mg) continue;
        const nm = String(row.place_name ?? "").toLowerCase().trim();
        if (!nm) continue;
        const w = ENGAGEMENT_WEIGHTS[String(row.action ?? "")] ?? 0;
        if (w <= 0) continue;
        devSet.add(dev);
        const key = `${dev}||${mg}`;
        let b = byKey.get(key);
        if (!b) { b = { mg, places: new Map() }; byKey.set(key, b); }
        b.places.set(nm, (b.places.get(nm) ?? 0) + w);
      }
      // 単一スポットしか無い basket は共起に寄与しない → 落として走査/メモリを削減。
      baskets = [...byKey.values()].filter((b) => b.places.size >= 2);
      devices = devSet.size;
    }
  } catch { /* テーブル/device_id列 未作成は無視（degrade: 協調ブーストなし）*/ }
  _coocCache = { at: Date.now(), baskets, devices };
  return _coocCache;
}

// 協調ブースト器: 現在の気分グループ＋ユーザーのアンカー(過去に高評価した場所)を起点に、
//   共起の強い近縁スポットへ 0〜COLLAB_CAP のブーストを返す。データ薄/アンカー無しなら常に0。
type CollabIndex = { boost: (name: string) => number; active: boolean };
const COLLAB_MIN_DEVICES = 4;   // これ未満の母数では共起が偶然に支配されるので無効化
const COLLAB_MIN_HIT_BASKETS = 2; // アンカーを含む basket が2人分未満なら単独ユーザー由来 → 無効
const COLLAB_CAP = 0.28;        // learnScore(explicit最大1.0)より小さく。learnScore*3換算で最大~+0.84km
function buildCollabBoost(
  baskets: CoocBasket[], devices: number, mood: string | undefined, anchors: string[],
): CollabIndex {
  const inactive: CollabIndex = { boost: () => 0, active: false };
  if (devices < COLLAB_MIN_DEVICES || baskets.length === 0) return inactive;
  const mg = moodGroup(mood ?? "") || (mood ?? "");
  if (!mg) return inactive;
  const anchorSet = new Set(anchors.map((a) => a.toLowerCase().trim()).filter(Boolean));
  if (anchorSet.size === 0) return inactive;
  // 同気分グループでアンカーを含む basket を走査し、共起スポットYへ min(anchor重み, Y重み) を加点。
  const co = new Map<string, number>();
  let hitBaskets = 0;
  for (const b of baskets) {
    if (b.mg !== mg) continue;
    let anchorW = 0;
    for (const a of anchorSet) { const w = b.places.get(a); if (w && w > anchorW) anchorW = w; }
    if (anchorW <= 0) continue;
    hitBaskets++;
    for (const [nm, w] of b.places) {
      if (anchorSet.has(nm)) continue;   // アンカー自身(=既に行った場所)は再提案しない
      co.set(nm, (co.get(nm) ?? 0) + Math.min(anchorW, w));
    }
  }
  if (co.size === 0 || hitBaskets < COLLAB_MIN_HIT_BASKETS) return inactive;
  let maxCo = 0;
  for (const v of co.values()) if (v > maxCo) maxCo = v;
  if (maxCo <= 0) return inactive;
  return {
    active: true,
    // 最大共起を1.0に正規化し 0〜COLLAB_CAP へ。共起が弱い候補ほど自然に小さくなる。
    boost: (name: string): number => {
      const v = co.get(name.toLowerCase().trim());
      if (!v || v <= 0) return 0;
      return Math.min(COLLAB_CAP, (v / maxCo) * COLLAB_CAP);
    },
  };
}

// 現在の気分に対する 除外/降格/昇格(学習スコア) 判定ヘルパーを生成
function buildRatingJudge(agg: MoodRatingAgg, mood: string | undefined, engAgg?: EngagementAgg, collab?: CollabIndex) {
  const mg = moodGroup(mood ?? "") || (mood ?? "");
  const get = (name: string) => agg.get(`${mg}||${name.toLowerCase().trim()}`);
  const getEng = (name: string) => engAgg?.get(`${mg}||${name.toLowerCase().trim()}`) ?? 0;
  return {
    isExcluded: (name: string): boolean => {
      const r = get(name);
      return !!r && r.bad >= 3 && r.bad > (r.good + r.bad) / 2;   // 👎3件以上かつ過半数
    },
    isDemoted: (name: string): boolean => {
      const r = get(name);
      return !!r && r.bad >= 1 && r.bad > r.good;                  // 👎優勢は末尾へ
    },
    // ① 👍ブースト + ② エンゲージメント: 0〜1の学習スコア（高いほど上位へ）
    //   明示評価(Wilson下限)を主、暗黙評価(対数減衰)を従として合成
    learnScore: (name: string): number => {
      const r = get(name);
      const explicit = (r && r.good >= 2) ? wilsonLowerBinomial(r.good, r.good + r.bad) : 0;
      const eng = getEng(name);
      const implicit = eng > 0 ? Math.min(1, Math.log10(1 + eng) / 1.5) : 0;
      // ⑧ 協調フィルタ: 「この気分で好きな人はこれも」共起ブースト（0〜CAP・データ薄/無なら0）。
      //   既に上限（COLLAB_CAP）済みなので加点は明示/暗黙より小さく、距離/persona を覆さない。
      const collabB = collab ? collab.boost(name) : 0;
      return explicit * 1.0 + implicit * 0.6 + collabB;
    },
    // 生の👍/👎件数（コンシェルジュ再ランクに「この気分での利用者評価」を見せる用）。無ければnull。
    summary: (name: string): { good: number; bad: number } | null => {
      const r = get(name);
      return r ? { good: r.good, bad: r.bad } : null;
    },
  };
}

// ── ③ freeWord蒸留: 解釈ログ＋昇格ルール ─────────────────────────────────────
// LLMがfreeWordから抽出した構造(人数/ジャンル/雰囲気)を freeword_interpretations に
// 蓄積し、頻出パターンは freeword_rules(管理者が昇格 or 自動昇格)として
// LLMを呼ばずに構造化検索へ直接ヒントを与える（高速・無料・ブレない）。
type FwRule = { pattern: string; text_hint: string | null; skip_llm: boolean | null };
let _fwRulesCache: { at: number; rules: FwRule[] } | null = null;
async function fetchFreewordRules(): Promise<FwRule[]> {
  if (_fwRulesCache && Date.now() - _fwRulesCache.at < 10 * 60 * 1000) return _fwRulesCache.rules;
  let rules: FwRule[] = [];
  try {
    if (supabase) {
      const { data } = await supabase
        .from("freeword_rules")
        .select("pattern, text_hint, skip_llm")
        .eq("enabled", true)
        .limit(200);
      rules = (data ?? []) as FwRule[];
    }
  } catch { /* テーブル未作成は無視（SQL: supabase/learning-tables.sql）*/ }
  _fwRulesCache = { at: Date.now(), rules };
  return rules;
}
function scheduleInterpretationLog(freeword: string, interpretation: unknown): void {
  if (!supabase || !freeword) return;
  const sb = supabase;
  const norm = freeword.trim().toLowerCase().replace(/[\s。、！!？?]+/g, "");
  // ⚠ Vercelは応答後のfire-and-forgetを凍結するため after() で確実に走らせる
  //   （これまで void .then() で学習ログ(freeword蒸留の素)が保存されていなかった）
  const run = async () => {
    await sb.from("freeword_interpretations")
      .insert({ freeword_norm: norm.slice(0, 120), freeword_raw: freeword.slice(0, 300), interpretation })
      .then(() => {}, (e) => logServerError("interpretation_log", e));
  };
  try { after(async () => { await run(); }); } catch { void run(); }
}

// ── 写真のplaces書き戻し（APIコスト削減）─────────────────────────────────────
// 実行時にGoogleで補完した写真URLを places.photo_url に保存し、次回以降の
// searchText 呼び出しを削減する。photo_url が NULL の行のみ名前一致で埋める
// （fire-and-forget・失敗無視・上書きしないので安全）。
// 検索/詳細で取得したエンリッチ情報（写真・複数写真・最寄り駅・営業時間）を
// places に恒久保存する。Vercelの「応答後fire-and-forgetは凍結」罠を after() で回避。
// 各列は「NULLの行のみ」更新＝上書きしない・失敗無視で安全。営業時間のみTTLで上書き許容。
// （image_urls 等の列が未作成でもエラーは握りつぶす＝SQL未実行でも安全）。
// 書き戻し先を「最も具体的な一意キー」で1行に絞る指定。
//   id(places.uuid) > google_place_id > name+address > name の優先順。
//   ⚠ name だけだと同名チェーン（スタバ等）全店に書き込んで写真/駅/営業時間が
//     混線するため、可能な限り id か name+address で絞る。
type PlaceMatch = { name: string; id?: string; googlePlaceId?: string; address?: string };
function selectPlace<Q extends { eq(col: string, val: string): Q }>(q: Q, m: PlaceMatch): Q {
  if (m.id) return q.eq("id", m.id);
  if (m.googlePlaceId) return q.eq("google_place_id", m.googlePlaceId);
  if (m.address) return q.eq("name", m.name).eq("address", m.address);
  return q.eq("name", m.name);
}
// scored/recの id フィールド（"sb-<uuid>" or google_place_id）から PlaceMatch を作る
function toPlaceMatch(name: string, id?: string, address?: string): PlaceMatch {
  if (typeof id === "string" && id.startsWith("sb-")) return { name, id: id.slice(3), address };
  if (typeof id === "string" && id) return { name, googlePlaceId: id, address };
  return { name, address };
}
function schedulePlaceWriteBack(
  match: PlaceMatch,
  fields: { photoUrl?: string; imageUrls?: string[]; station?: string; openHours?: string; description?: string; rating?: number | null; ratingCount?: number | null },
): void {
  if (!supabase || !match?.name) return;
  const sb = supabase;
  const run = async () => {
    if (typeof fields.rating === "number" && fields.rating >= 0) {
      // 評価は変動するので rating_updated_at 付きで上書き許容（NULL条件なし）。
      //   列(place-ratings.sql)未適用なら 42703 で握りつぶし＝安全。
      const ratingPatch: Record<string, unknown> = { rating: fields.rating, rating_updated_at: new Date().toISOString() };
      if (typeof fields.ratingCount === "number") ratingPatch.rating_count = fields.ratingCount;
      await selectPlace(sb.from("places").update(ratingPatch), match).then(() => {}, (e) => logServerError("writeback.rating", e, { name: match.name }));
    }
    // 【ライセンス対応2026-06-22】Google/Yahooの写真URLは places.photo_url / image_urls に
    //   恒久保存しない（Google Maps Platform規約: コンテンツの恒久キャッシュ禁止＝最大30日・要削除）。
    //   写真は検索時にライブ取得して表示するのみ。自前DBの写真は OSM/著名スポットのWikimedia Commons
    //   (CC・帰属表示つき)＋利用者投稿＋ジャンル別プレースホルダーで賄う。
    //   ※ photoUrl/imageUrls の writeback は意図的に無効化。fields は型互換のため残置。
    void fields.photoUrl; void fields.imageUrls;
    if (fields.station) {
      await selectPlace(sb.from("places").update({ nearest_station: fields.station }).is("nearest_station", null), match).then(() => {}, (e) => logServerError("writeback.station", e, { name: match.name }));
    }
    if (fields.description) {
      // 説明文はNULLの場所だけ補完（既存の手書き説明は壊さない）→次回以降は生成不要
      await selectPlace(sb.from("places").update({ description: fields.description }).is("description", null), match).then(() => {}, (e) => logServerError("writeback.description", e, { name: match.name }));
    }
    if (fields.openHours) {
      // 営業時間は変わるので last_checked_at 付きで上書き許容（NULL条件なし）
      await selectPlace(sb.from("places").update({ open_hours: fields.openHours, last_checked_at: new Date().toISOString() }), match).then(() => {}, (e) => logServerError("writeback.open_hours", e, { name: match.name }));
    }
  };
  try { after(async () => { await run(); }); } catch { void run(); }
}
// ── A-6: Bayesian/Wilson lower-bound score ──────────────────────────────────
// 5段階評価(1-5)を比率に変換し、Wilson下限(95%)を計算。
// 少件数の高評価(★5/2件)が多件数の平均(★4.3/800件)に勝てないようにする。
function wilsonLower(rating: number | null | undefined, count: number | null | undefined): number {
  const r = typeof rating === "number" ? rating : 0;
  const n = typeof count === "number" ? count : 0;
  if (n === 0) return 0;
  const p = Math.max(0, Math.min(1, (r - 1) / 4)); // 5段階→0-1比率
  const z = 1.96; // 95%信頼区間
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return centre - margin;
}

// ── A-7: チェーンブランド名正規化（同チェーン重複抑制用）──────────────────────
// 支店名・地名サフィックスを除去してブランド幹を取得（例: 豚山 渋谷店→豚山）
function brandOf(name: string): string {
  // 全角スペース(　)も含めた空白除去、支店サフィックス除去
  return name
    .replace(/[\s　]*(本店|支店|直営店|本号|[0-9０-９]+(号店|店目)|[A-Za-z0-9]+号)$/, "")
    .replace(/[\s　]*(新宿|渋谷|銀座|上野|池袋|秋葉原|浅草|品川|新橋|恵比寿|表参道|原宿|代々木|吉祥寺|三軒茶屋|下北沢|横浜|川崎|大宮|梅田|難波|天王寺|博多)[^\s店]*$/, "")
    .replace(/[\s　]*(東京|大阪|京都|名古屋|福岡|仙台|札幌|広島|神戸)[^\s店]*$/, "")
    .trim()
    .slice(0, 6); // 先頭6文字をブランドキーに
}

// ── ジャンル精度フィルタ（#1 全段階適用 / #3 ネガティブ除外 / #13 各国料理細分化）────
// 飲食の深掘りジャンルごとに「肯定語(含めば適合)」と「否定語(含めば除外)」を定義。
// type検索のすり抜け（ラーメン検索にアイス/イタリアン混入、タイ検索にベトナム混入等）を
// 名前ベースで防ぐ。全ソース(Supabase/Google/Yahoo/backfill/widen)の最終マージで適用する。
import {
  GENRE_POSITIVE_RE, GENRE_NEGATIVE_RE, GENRE_POSITIVE_REQUIRED,
  canonDeepDive, nameMatchesGenre, DEEPDIVE_SEARCH_KEYWORDS, DEEPDIVE_SUBCATEGORY_KEYWORDS,
  SPECIFIC_FOOD_PRIMARY_TYPES, ALLOWED_PRIMARY_TYPES_BY_DEEPDIVE,
  AMUSEMENT_NO_FOOD_DEEPDIVES, FOOD_FAMILY_PRIMARY_TYPES, primaryTypeAllowedForGenre,
  moodGroup, isFoodAllowedContext, isRestaurantName, tagsAreFood,
} from "@/lib/search-filters";
// ── #6: 「こだわらない」時のジャンル代表性（粗ジャンル分類）──────────────────────
// 食事で深掘り未指定のとき、結果が同一ジャンル（例: 全部ラーメン）に偏らないよう
// 粗いジャンルに分類し、各ジャンルの件数に上限を設けて多様性を確保する。
const COARSE_FOOD_GENRES: { key: string; re: RegExp }[] = [
  { key: "ラーメン",   re: /ラーメン|らーめん|中華そば|つけ麺|まぜそば|麺屋|家系/i },
  { key: "焼肉",       re: /焼肉|焼き肉|ホルモン|カルビ|牛角/i },
  { key: "寿司海鮮",   re: /寿司|鮨|海鮮|魚介|刺身|浜焼/i },
  { key: "居酒屋",     re: /居酒屋|酒場|ダイニングバー|バル|立ち飲み/i },
  { key: "カフェ",     re: /カフェ|cafe|珈琲|coffee|喫茶|スイーツ|パフェ/i },
  { key: "中華",       re: /中華|餃子|麻婆|町中華|台湾/i },
  { key: "イタリアン", re: /イタリア|パスタ|ピザ|ピッツェ|トラットリア/i },
  { key: "韓国",       re: /韓国|サムギョプサル|タッカルビ|スンドゥブ/i },
  { key: "カレー",     re: /カレー|インド|ネパール|スパイス/i },
  { key: "定食和食",   re: /定食|食堂|和食|うどん|そば|天ぷら|丼/i },
];
function coarseFoodGenreOf(name: string): string {
  for (const g of COARSE_FOOD_GENRES) if (g.re.test(name)) return g.key;
  return "その他";
}
// 同一粗ジャンルが cap 件を超えたら末尾に回す（順序は保ちつつ偏りを後ろへ）。
function diversifyByCoarseGenre<T extends { title?: string }>(arr: T[], cap = 4): T[] {
  const counts = new Map<string, number>();
  const kept: T[] = [];
  const overflow: T[] = [];
  for (const r of arr) {
    const g = coarseFoodGenreOf(r.title ?? "");
    const c = counts.get(g) ?? 0;
    if (c < cap) { counts.set(g, c + 1); kept.push(r); }
    else overflow.push(r);
  }
  return [...kept, ...overflow];
}

// ── #7/#8: 営業状態バッジ計算 ───────────────────────────────────────────────
// Google currentOpeningHours(openNow + periods) と現在時刻(JST)から
// 「営業中 / もうすぐ閉店 / もうすぐ開店 / 営業時間外」を判定する。
type GooglePeriod = {
  open?: { day?: number; hour?: number; minute?: number };
  close?: { day?: number; hour?: number; minute?: number };
};
type OpenStatus = {
  openNow?: boolean;
  badge?: string;              // 表示用バッジ（営業中 / もうすぐ閉店(あとN分) 等）
  closingSoonMin?: number;     // 閉店まで分（openNow時のみ）
  openingSoonMin?: number;     // 開店まで分（閉店時のみ）
};
function computeOpenStatus(
  current: { openNow?: boolean; periods?: GooglePeriod[] } | undefined,
): OpenStatus {
  if (!current) return {};
  const openNow = typeof current.openNow === "boolean" ? current.openNow : undefined;
  // 現在のJST曜日(0=日)・時分
  const fmt = new Intl.DateTimeFormat("ja-JP", {
    weekday: "short", hour: "numeric", minute: "numeric", hour12: false, timeZone: "Asia/Tokyo",
  });
  const parts = fmt.formatToParts(new Date());
  const hourNow = Number(parts.find(p => p.type === "hour")?.value ?? "0");
  const minNow = Number(parts.find(p => p.type === "minute")?.value ?? "0");
  const dayMap: Record<string, number> = { "日": 0, "月": 1, "火": 2, "水": 3, "木": 4, "金": 5, "土": 6 };
  const dayNow = dayMap[parts.find(p => p.type === "weekday")?.value ?? "日"] ?? 0;
  const nowMin = dayNow * 1440 + hourNow * 60 + minNow;
  const periods = current.periods ?? [];

  if (openNow === true) {
    // 現在開いている period の close 時刻までの分を求める（最短のもの）
    let minToClose = Infinity;
    for (const pd of periods) {
      if (!pd.close) continue;
      let closeMin = (pd.close.day ?? 0) * 1440 + (pd.close.hour ?? 0) * 60 + (pd.close.minute ?? 0);
      // 週跨ぎ（close が現在より前なら翌週扱い）
      if (closeMin < nowMin) closeMin += 7 * 1440;
      const diff = closeMin - nowMin;
      if (diff >= 0 && diff < minToClose) minToClose = diff;
    }
    if (minToClose <= 60) {
      return { openNow: true, badge: `もうすぐ閉店（あと${minToClose}分）`, closingSoonMin: minToClose };
    }
    return { openNow: true, badge: "営業中" };
  }

  if (openNow === false) {
    // 次に開く open 時刻までの分（最短）
    let minToOpen = Infinity;
    for (const pd of periods) {
      if (!pd.open) continue;
      let openMin = (pd.open.day ?? 0) * 1440 + (pd.open.hour ?? 0) * 60 + (pd.open.minute ?? 0);
      if (openMin < nowMin) openMin += 7 * 1440;
      const diff = openMin - nowMin;
      if (diff >= 0 && diff < minToOpen) minToOpen = diff;
    }
    if (minToOpen <= 60) {
      return { openNow: false, badge: `もうすぐ開店（あと${minToOpen}分）`, openingSoonMin: minToOpen };
    }
    return { openNow: false, badge: "営業時間外" };
  }
  return { openNow };
}

// Haversine距離(m)
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 起点(lat,lng)から方位 bearingDeg・距離 distKm の地点の緯度経度を返す（球面三角法）
// 遠距離設定時に「リング状の検索中心点」を生成して、Nearby Search の 50km 上限を超えた
// 遠方スポットを取得するために使用する。
function destinationPoint(lat: number, lng: number, bearingDeg: number, distKm: number): { lat: number; lng: number } {
  const R = 6371; // km
  const δ = distKm / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
  );
  return { lat: (φ2 * 180) / Math.PI, lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180 };
}

// ── コスト削減A: 駅検索のインメモリキャッシュ ───────────────────────────────────
// findNearestStation は結果ごとに searchNearby を叩くため1検索で5〜15回発生する。
// 駅は移動しないので、座標を約100m grid(小数3桁)に丸めてキャッシュし重複呼び出しを排除する。
// TTLは長め(2時間)。Vercelウォームインスタンス内で共有される。
const _stationCache = new Map<string, { ts: number; val: string }>();
const STATION_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2時間
const stationCacheKey = (lat: number, lng: number) =>
  `${lat.toFixed(3)},${lng.toFixed(3)}`; // 小数3桁 ≈ 111m grid

// 最寄り駅を検索して「〇〇駅から徒歩約N分」を返す
// Nearby SearchはRankPreference:DISTANCEを使い、距離順で取得する
async function findNearestStation(lat: number, lng: number, apiKey: string): Promise<string> {
  // A: キャッシュヒットなら Google を叩かない
  const ckey = stationCacheKey(lat, lng);
  const cached = _stationCache.get(ckey);
  if (cached && Date.now() - cached.ts < STATION_CACHE_TTL_MS) return cached.val;
  // 永続キャッシュ（駅は変化しないため30日。コールドスタート跨ぎ・全ユーザー共有）
  const ltHit = await ltCacheGetMany([`st2:${ckey}`]);
  const ltVal = ltHit.get(`st2:${ckey}`);
  if (typeof ltVal === "string") {
    _stationCache.set(ckey, { ts: Date.now(), val: ltVal });
    return ltVal;
  }
  // キャッシュサイズ上限（500エントリ）超過時は最古を削除
  if (_stationCache.size >= 500) {
    const oldest = [..._stationCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _stationCache.delete(oldest[0]);
  }
  // ── コスト削減: HeartRails Express(無料・キー不要・日本の駅特化)を一次に ──────
  //   Google Nearby($32/1000=最高単価)は HeartRails 失敗時の救済のみ
  try {
    const hr = await fetch(
      `https://express.heartrails.com/api/json?method=getStations&x=${lng}&y=${lat}`,
      { cache: "no-store", signal: AbortSignal.timeout(4000) },
    );
    if (hr.ok) {
      const hd = await hr.json().catch(() => null);
      const st = hd?.response?.station?.[0];
      if (st?.name && st?.distance) {
        const distM = parseInt(String(st.distance).replace(/[^0-9]/g, ""), 10);
        if (Number.isFinite(distM)) {
          // 最寄り駅は必ず返す: 2km以内は「徒歩約N分」、超過は「約X.Xkm」(駅から遠い=車必須の目安)。
          //   従来は2km超で空にしていたため山間部スポット等で駅情報が出なかった→必ず表示に変更。
          const val = distM <= 2000
            ? `${st.name}駅から徒歩約${Math.max(1, Math.ceil(distM / 80))}分`
            : `${st.name}駅から約${(distM / 1000).toFixed(1)}km`;
          _stationCache.set(ckey, { ts: Date.now(), val });
          await ltCachePut(`st2:${ckey}`, val);
          return val;
        }
      }
    }
  } catch { /* HeartRails失敗 → Googleへフォールバック */ }

  try {
    const res = await gfetch("https://places.googleapis.com/v1/places:searchNearby", {
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
          // HeartRails失敗時の救済。最寄り駅を必ず返すため50kmまで広げる(rank=DISTANCEで最近傍)。
          circle: { center: { latitude: lat, longitude: lng }, radius: 50000 },
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) return "";
    const data = await res.json();
    const places: Array<{ displayName?: { text?: string }; location?: { latitude?: number; longitude?: number } }> = data.places ?? [];
    if (places.length === 0) return "";  // 空はキャッシュしない＝次回検索で再取得(必ず駅表示に近づける)

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
    if (!nearest) return "";  // 空はキャッシュしない＝次回再取得
    // 2km以内は徒歩分、超過は「約X.Xkm」で必ず最寄り駅を表示（HeartRailsと同形式）
    const val = nearest.dist <= 2000
      ? `${nearest.name}から徒歩約${Math.max(1, Math.ceil(nearest.dist / 80))}分`
      : `${nearest.name}から約${(nearest.dist / 1000).toFixed(1)}km`;
    _stationCache.set(ckey, { ts: Date.now(), val });  // A: 結果をキャッシュ
    await ltCachePut(`st2:${ckey}`, val);               // 永続(30日・全インスタンス共有)
    return val;
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
    // 内製化(2026-07-06): 旧実装は自分自身へ HTTP fetch(/api/feedback) → feedback全行フルスキャン
    // ＋使わない統計まで毎回計算していた。lib/feedback-stats が必要分だけ直接読み・10分キャッシュ。
    if (!supabase) return empty;
    const data = await fetchSimilarStats(supabase, {
      mood: answers.mood || undefined,
      age: answers.age || undefined,
      gender: answers.gender || undefined,
      companion: answers.companion || undefined,
      atmosphere: answers.atmosphere || undefined,
    });

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
    if (bm != null && bm! > 0) return `${bm!.toLocaleString("ja-JP")}円〜${b!.toLocaleString("ja-JP")}円（この範囲の価格帯のみ提案）`;
    if (b! <= 1000)  return `${b!.toLocaleString("ja-JP")}円以内（低予算）`;
    if (b! <= 5000)  return `${b!.toLocaleString("ja-JP")}円以内（手頃）`;
    if (b! <= 15000) return `${b!.toLocaleString("ja-JP")}円以内（中価格帯）`;
    return `${b!.toLocaleString("ja-JP")}円以内（高め）`;
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
    answers.companion && `【同行者】${companionMap[answers.companion!] ?? answers.companion}`,
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
    const ai = openai!; // OPENAI_API_KEY 未設定時は上の早期 return で到達しない
    const response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `以下のユーザー情報に基づいて検索クエリを生成してください:\n\n${userContext}${feedbackContext}${globalStatsContext}${timeContext ? `\n\n【現在の状況（必ず考慮）】\n${weatherTimePromptContext(weather, timeContext!)}` : ""}`,
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
        if (!aiReasons.has(key)) aiReasons.set(key, plan.reasonData!);
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
    ? (cityMatch ? cityMatch![1] : wardMatch ? wardMatch![1] : rawArea.split(/[丁目番地０-９0-9]/)[0].trim() || rawArea)
    : "";

  // 動的質問の回答からキーワードを取得（relax_sub_choiceの「検索キーワード: 〜」部分を抽出）
  const dynQs = getDynamicQs(answers);
  const placeAns = dynQs.find(dq => dq.question.includes("どこで癒やされたい"))?.answer ?? "";
  const subChoiceRaw = dynQs.find(dq => dq.question.includes("どんな") || dq.question.includes("カフェで") || dq.question.includes("どんな景色") || dq.question.includes("どんなスタイル") || dq.question.includes("自然の中で"))?.answer ?? "";
  // 「〜（検索キーワード: X Y Z）」から X Y Z だけ抽出
  const keywordsMatch = subChoiceRaw.match(/検索キーワード:\s*(.+?)）/);
  const apiKeywords = keywordsMatch ? keywordsMatch![1].trim() : "";
  const subChoiceText = subChoiceRaw.replace(/（検索キーワード:.*?）/, "").trim();

  // 同行者情報（reason生成用のみ。textQueryには含めない）
  const c = answers.companion ?? "";
  const companionLabel = c.includes("一人") ? "一人"
    : c.includes("恋人") || c.includes("パートナー") ? "恋人"
    : c.includes("家族") ? "家族"
    : c.includes("友達") ? "友達"
    : c || "";

  // 交通手段を分類（string でも string[] でも安全に string[] へ正規化）
  const transports: string[] = ([] as string[])
    .concat((answers.transport ?? []) as string | string[])
    .filter((t) => typeof t === "string" && t.length > 0);
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
    const ai = openai!; // OPENAI_API_KEY 未設定時は上の早期 return で到達しない
    const response = await ai.chat.completions.create({
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

// 複数選択対応ヘルパー
function getTransports(transport?: string | string[]): string[] {
  if (!transport) return [];
  if (Array.isArray(transport)) return transport;
  return transport ? [transport] : [];
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
  if (moodGroup(mood) === "drive" || moodGroup(mood) === "travel") return null;

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
  if (moodGroup(mood) === "drive") return "DRIVE";
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

// 自由ワード/絞り込みから Supabaseテキスト検索用のキーワードを粗く抽出する。
//   助詞・記号で分割→2文字以上の内容語を最大5語（形態素解析は使わずヒューリスティック）。
//   例「夜景が綺麗な公園」→["夜景","綺麗","公園"]／「静かに作業できるカフェ」→["静か","作業","カフェ"]
function extractKeywords(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .replace(/[、。,.!！?？\s（）()「」『』\[\]【】〜~・/：:；;]+/g, " ")
    .replace(/(したい|できる|な場所|ところ|スポット|気分|系|など)/g, " ");
  const tokens = cleaned
    .split(/(?:が|を|に|へ|と|で|や|の|は|も|から|まで|でも|して|った|れる|られる)\s*/)
    .flatMap(s => s.split(" "))
    .map(s => s.trim())
    .filter(s => s.length >= 2 && !/^[0-9０-９]+$/.test(s));
  return [...new Set(tokens)].slice(0, 5);
}

// 自由ワード/絞り込みを OpenAI(gpt-4o-mini) で「検索用の語」に解釈する。
//   形態素解析の無い extractKeywords は形容詞に弱いので、抽象語を施設種別の名詞＋気分タグに翻訳させる。
//   例「静かに過ごせる所」→ keywords:[図書館,カフェ] moodTags:[#集中したい]／「映えるデート」→[展望台,夜景] [#自然感じたい]
const MOOD_TAG_SET = new Set([
  "#まったりしたい", "#自然感じたい", "#わいわい楽しみたい", "#お腹すいた", "#ドライブしたい",
  "#集中したい", "#体動かしたい", "#遠くに行きたい", "#ショッピング", "#スリル味わいたい",
]);
async function interpretFreeword(text: string): Promise<{ keywords: string[]; moodTags: string[] }> {
  const fallback = { keywords: extractKeywords(text), moodTags: [] as string[] };
  if (!openai || !text.trim()) return fallback;
  try {
    const ai = openai;
    const res = await ai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0.2, max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `ユーザーの自由記述(お出かけの希望)を、場所検索用に解釈します。
- moodTags: 次から合うものだけ0〜3個: #まったりしたい #自然感じたい #わいわい楽しみたい #お腹すいた #ドライブしたい #集中したい #体動かしたい #遠くに行きたい #ショッピング #スリル味わいたい
- keywords: DBの名前・説明から探すための具体的な検索語を2〜5個(日本語の名詞中心。例:夜景,公園,海,カフェ,温泉,美術館,展望台)。抽象的な形容詞は施設種別の名詞に翻訳する(静か→図書館/カフェ、映え→展望台/夜景、落ち着く→カフェ/庭園)。
出力JSONのみ: {"moodTags":["#..."],"keywords":["..."]}` },
        { role: "user", content: text.slice(0, 300) },
      ],
    }, { signal: AbortSignal.timeout(7000) });
    const p = JSON.parse(res.choices?.[0]?.message?.content ?? "{}");
    const moodTags = Array.isArray(p.moodTags) ? p.moodTags.filter((t: unknown): t is string => typeof t === "string" && MOOD_TAG_SET.has(t)).slice(0, 3) : [];
    const keywords = Array.isArray(p.keywords) ? p.keywords.filter((k: unknown): k is string => typeof k === "string" && k.trim().length >= 2).slice(0, 5) : [];
    return { keywords: keywords.length ? keywords : fallback.keywords, moodTags };
  } catch { return fallback; }
}

// P1(2026-07-19): 意味検索の常時融合フラグ。match_places_semantic を索引フレンドリーに直した
//   supabase/fix-semantic-search-perf.sql を適用した後に RECOMMEND_SEMANTIC_ALWAYS=1 で有効化する。
//   ONで「気分だけ検索でも」毎回セマンティック近傍を融合（タグ語彙に無い気分＝『エモい夕暮れ』等を拾う）。
//   未設定(既定)＝従来どおり在庫が薄い時(＜15件・深掘り無し)だけ発火＝SQL未適用でも回帰しない。
const SEMANTIC_ALWAYS = process.env.RECOMMEND_SEMANTIC_ALWAYS === "1";

// #1 セマンティック検索: クエリ文を埋め込み → match_places_semantic RPC で半径内の意味的近傍を取得。
//   返却は spatialSearch と同型(PlaceResponse)。RPC/embedding未整備(PGRST202等)は graceful に [] を返す。
async function semanticSearchPlaces(
  queryText: string, lat: number, lng: number, radiusKm: number,
  transport?: string | string[], limit = 30,
): Promise<import("@/types/onsen").PlaceResponse[]> {
  if (!openai || !supabase || !queryText.trim()) return [];
  try {
    const ai = openai, sb = supabase;
    const emb = await ai.embeddings.create({ model: "text-embedding-3-small", input: queryText.slice(0, 500) });
    const vec = emb.data?.[0]?.embedding;
    if (!vec || vec.length === 0) return [];
    // 【性能】places が20万件規模だとベクトル近傍RPCが数十秒かかる場合がある。
    //   7秒で打ち切り、タグ/名前候補のみで応答する（アプリの30sタイムアウト回避）。
    const rpc = sb.rpc("match_places_semantic", {
      query_embedding: vec, user_lat: lat, user_lng: lng, radius_m: radiusKm * 1000, match_limit: limit,
    });
    const timeout = new Promise<{ data: null; error: { message: string } }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: { message: "semantic_timeout" } }), 7000),
    );
    const { data, error } = await Promise.race([rpc, timeout]) as { data: unknown; error: unknown };
    if (error || !Array.isArray(data)) return [];
    const { nearbyRowToPlaceResponse } = await import("@/lib/spatial-search");
    return (data as Array<{ place: Record<string, unknown>; distance_m: number; similarity?: number }>).map(row => {
      const pr = nearbyRowToPlaceResponse(
        { ...(row.place as object), distance_m: row.distance_m } as unknown as import("@/lib/spatial-search").NearbyPlaceRow,
        transport,
      );
      pr.semanticSim = typeof row.similarity === "number" ? row.similarity : null;  // ③ 類似度を保持→ゲート/ランキングに使う
      return pr;
    });
  } catch { return []; }
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
    if (t.includes("車") || moodGroup(answers.mood) === "drive") return "ドライブ 車でアクセス";
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

  const res = await gfetch(mediaUrl.toString(), {
    headers: { "X-Goog-Api-Key": apiKey },
    cache: "no-store",
  });

  if (!res.ok) return "";

  const data = await res.json().catch(() => null);
  return data?.photoUri || "";
}

// ─── 写真プロキシURL生成（遅延解決・高速化用）─────────────────────────────────
// getPhotoUrl は写真1枚ごとに Google へ追加リクエストして CDN URL を解決するため遅い。
// 代わりに /api/photo-proxy を経由する URL を組み立てると、解決は画像表示時まで遅延され、
// 推薦APIのレスポンスが大幅に高速化する（ユーザーが実際に見た写真だけ解決される）。
const PHOTO_PROXY_BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "https://moodgo-main.vercel.app";
function buildPhotoProxyUrl(photoName: string): string {
  const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media`;
  return `${PHOTO_PROXY_BASE}/api/photo-proxy?url=${encodeURIComponent(mediaUrl)}`;
}

// 任意の画像URLをphoto-proxy経由のURLに変換する。
// Supabase DBに保存されている旧形式（maps.googleapis.com/maps/api/place/photo?photo_reference=...）や
// 直接CDN URL（lh3.googleusercontent.com等）は、Expoアプリが直接リクエストするとAPIキー不足/
// CORS/Referer制限で表示できない場合があるため、すべてphoto-proxy経由に統一する。
function wrapWithPhotoProxy(url: string): string {
  if (!url) return "";
  // すでにphoto-proxy経由なら変換不要
  if (url.includes("/api/photo-proxy")) return url;
  // 外部URLはプロキシ経由に変換
  return `${PHOTO_PROXY_BASE}/api/photo-proxy?url=${encodeURIComponent(url)}`;
}

// ─── 宿泊施設（日帰り不可）の除外 ─────────────────────────────────────────────
// ホテル・旅館など宿泊メインの施設は「日帰りで遊びに行く」用途に合わないため推薦から除外。
// Google Places の primaryType で判定（hotel-restaurant のように primaryType が
// restaurant の施設は除外されないので、ホテル内レストランは食事用途として残る）。
const LODGING_PRIMARY_TYPES = [
  "hotel", "lodging", "resort_hotel", "motel", "bed_and_breakfast",
  "hostel", "inn", "guest_house", "extended_stay_hotel",
  "budget_japanese_inn", "japanese_inn", "campground", "camping_cabin",
  "rv_park", "cottage", "farmstay", "private_guest_room",
];
const LODGING_PRIMARY_SET = new Set(LODGING_PRIMARY_TYPES);
// 施設名から宿泊施設を判定（Yahoo 等タイプ情報がないソース用の補助）
function isLodgingName(name: string): boolean {
  return /(ホテル|旅館|HOTEL|Hotel|ゲストハウス|民宿|ペンション|オーベルジュ|リゾートイン)/.test(name);
}

/** deepDiveL1 が大型ショッピングモール系の検索か判定 */
function isLargeMallSearch(deepDiveL1: string): boolean {
  return deepDiveL1 === "大型ショッピングモール" || deepDiveL1 === "郊外の大型施設に行きたい";
}

/**
 * 大型ショッピングモール／百貨店として認められる施設名のキーワード。
 * 実在する大型モール・百貨店・ファッションビルのチェーン名/業態名を網羅。
 */
const LARGE_MALL_NAME_KEYWORDS =
  /モール|アウトレット|ショッピングセンター|ショッピングパーク|ショッピングプラザ|ショッピングタウン|ショッピングモール|ビナウォーク|ららぽーと|ラゾーナ|マークイズ|マルイ|丸井|MARUI|0101|パルコ|PARCO|ルミネ|LUMINE|ルクア|アトレ|エキュート|セレオ|グランデュオ|テラスモール|グランベリー|コレットマーレ|アリオ|ゆめタウン|イオン|ヴィーナスフォート|アクアシティ|ダイバーシティ|ソラマチ|ヒカリエ|高島屋|タカシマヤ|そごう|西武|東急百貨店|小田急百貨店|京王百貨店|三越|伊勢丹|大丸|松坂屋|百貨店|デパート|アウトレットパーク|プレミアム・アウトレット|プレミアムアウトレット|トレッサ|ノースポート|モザイク|MOSAIC|クイーンズスクエア|ランドマークプラザ|ワールドポーターズ|キュービックプラザ|ジョイナス|ポルタ|モアーズ|MORE|ビブレ|VIVRE|オーロラモール|セレオ|グランツリー|ラスカ|ペリエ|シャル|セルバ|フォレオ|イーアス|プレナ|ピオレ|なんばパークス|ヒルズ|ガーデン|スクエア|プラザ|タウン|アネックス|EXPOCITY|エキスポシティ|キャナルシティ|マリノア|リバーウォーク|チャチャタウン|阪急|阪神|京阪|名鉄|近鉄|東武|京急|フォーラス|エムザ|アピタ|ピアゴ|ラパーク|グランフロント|百番街|フォーリス|アル・?プラザ|平和堂|フレスポ|モレラ|スマーク|サンエー|エミフル|フジグラン|岩田屋|井筒屋|天満屋|藤崎|うすい百貨店|スズラン百貨店|まるひろ|丸広|香林坊大和|富山大和|高岡大和/i;

/** 施設名が大型モール／百貨店として妥当か */
function isLargeMallName(name: string): boolean {
  return LARGE_MALL_NAME_KEYWORDS.test(name);
}

/**
 * deepDiveL1 が大型ショッピングモール系のとき、モール／百貨店として妥当でない施設を除外する。
 * Google Places の shopping_mall タイプや Yahoo のジャンル検索は、
 * 商店街・市場・公園・レジャー施設・観光地まで拾ってしまうため、
 * 名前にモール系キーワードを含まないものは全て不一致として除外する。
 */
function isShoppingMallMismatch(name: string, deepDiveL1: string): boolean {
  if (!isLargeMallSearch(deepDiveL1)) return false;
  // モール／百貨店として妥当な名前でなければ除外
  return !isLargeMallName(name);
}

// 天気は広域で同じ＆ゆっくり変わる → 座標を約1km(2桁)に丸めて20分メモリキャッシュ。
//   これで検索ごとにopen-meteoを叩かない（コスト/遅延削減）。インスタンス跨ぎ不要（コールドで消えてよい）。
const _wxCache = new Map<string, { at: number; wx: WeatherContext }>();
async function getWeatherContext(lat?: number, lng?: number): Promise<WeatherContext> {
  if (typeof lat !== "number" || typeof lng !== "number") return {};
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = _wxCache.get(key);
  if (cached && Date.now() - cached.at < 20 * 60 * 1000) return cached.wx;

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("current", "weather_code,is_day");
    url.searchParams.set("timezone", "Asia/Tokyo");

    // ⚠ タイムアウト必須: recommendのホット経路(コンシェルジュ再ランク)からも呼ぶため、
    //   open-meteoが遅い/ハングすると検索全体(Promise.all)が詰まる。2.5秒で打ち切り→天気なしで続行。
    const res = await fetch(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!res.ok) return {};

    const data = await res.json().catch(() => null);
    const wx: WeatherContext = {
      weatherCode: data?.current?.weather_code,
      isDay: typeof data?.current?.is_day === "number" ? data.current.is_day === 1 : undefined,
    };
    _wxCache.set(key, { at: Date.now(), wx });
    return wx;
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

  // mood ボーナス（短キー/長形どちらでも moodGroup で判定）
  const mgBonus = moodGroup(answers.mood);
  if (mgBonus === "drive" && (text.includes("絶景") || text.includes("展望"))) score += 8;
  if (mgBonus === "sport" && (text.includes("スポーツ") || text.includes("アクティビティ") || text.includes("運動"))) score += 8;
  if (mgBonus === "nature" && (text.includes("自然") || text.includes("公園") || text.includes("緑") || text.includes("景色"))) score += 10;
  if (mgBonus === "nature" && (text.includes("カフェ") || text.includes("飲食"))) score -= 5;

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
    // 遠出したい気分は「遠い場所ほど良い」＝主経路の遠出バイアスと向きを揃える。
    //   従来は全moodで >10km を一律 -6 し、小旅行/県またぎで遠方を逆に減点していた。
    const FAR_FEELINGS = new Set(["ちょっと遠くてもOK", "県またぎもあり", "小旅行気分", "どこでも行きたい"]);
    if (FAR_FEELINGS.has(answers.distanceFeeling ?? "")) {
      if (distKm > 50) score += 7;
      else if (distKm > 20) score += 4;
      else if (distKm > 8) score += 2;   // 近距離も減点しない（遠出時は近場を罰しない）
    } else {
      if (distKm < 1.0) score += 8;
      else if (distKm < 3.0) score += 4;
      else if (distKm > 10.0) score -= 6;
    }
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
  if (RECOMMEND_DISABLE_GOOGLE) return [];   // 規約対応: 外部検索オフ時はYahoo検索も停止
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
        // moodベースのフォールバック（短キー/長形どちらでも moodGroup で判定）
        const mg = moodGroup(answers.mood);
        if (mg === "food") bucket = "food";
        else if (mg === "drive" || mg === "nature" || mg === "travel") bucket = "scenic";
        else if (mg === "sport" || mg === "play") bucket = "activity";
        else if (mg === "relax") bucket = "relax";
        else if (mg === "focus") bucket = "indoor";
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
  if (RECOMMEND_DISABLE_GOOGLE) return [];   // 規約対応: 外部検索オフ時はYahoo検索も停止
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

  const mgOsm = moodGroup(mood);
  if (mgOsm === "drive") {
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
  } else if (mgOsm === "sport") {
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

// km と移動手段から「車で約N分 / X.Xkm」形式の距離テキストを生成
// （Google/Yahoo 補足結果に距離表示を付与し、遠端優先ソートにも使う）
// 距離テキストは lib/distance.ts の formatDistText に一本化（後方互換ラッパー）
function formatDistTextFromKm(km: number, transport?: string | string[]): string {
  return formatDistText(km, transport);
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
  if (moodGroup(mood) === "drive") return [{ travelMode: "DRIVE", icon: "🚗" }];
  if (moodGroup(mood) === "travel") return [{ travelMode: "TRANSIT", icon: "🚄" }];

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

  // ⑤ 無料化: Google Routes(routeMatrix)を廃止し、直線距離(haversine)＋移動手段別の実効速度で移動時間を概算する。
  //   毎検索でRoutes課金ゼロ・座標があれば常に成功＝Googleフォールバック不要。表示は「約X分／約Ykm」で従来と同形式。
  void apiKey; void formatDuration;
  const SPEED_KMH: Record<string, number> = { WALK: 4.5, BICYCLE: 14, TRANSIT: 18, DRIVE: 27 };  // 信号/待ち込みの実効速度
  const speed = SPEED_KMH[travelMode] ?? 20;
  const roadFactor = 1.3;   // 直線→道なり距離の補正
  for (const { i, loc } of indexedDests) {
    const roadM = Math.round(haversineMeters(origin.latitude, origin.longitude, loc.latitude, loc.longitude) * roadFactor);
    const minutes = Math.max(1, Math.round((roadM / 1000) / speed * 60));
    result[i] = { durationText: `約${minutes}分`, distanceText: formatDistance(roadM) };
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

  // 気分グループ別の関連性加点（短キー/長形どちらでも moodGroup で判定）
  const mg = moodGroup(params.mood);
  if (mg === "relax"   && (params.bucket === "spot" || params.bucket === "relax"))   score += 10;
  if (mg === "travel"  && (params.bucket === "spot" || params.bucket === "scenic"))  score += 10;
  if (mg === "play"    && (params.bucket === "activity" || params.bucket === "spot")) score += 9;
  if (mg === "drive"   && (params.bucket === "scenic" || params.bucket === "spot"))  score += 10;
  if (mg === "sport"   && (params.bucket === "activity" || params.bucket === "spot")) score += 10;
  if (mg === "nature"  && (params.bucket === "scenic" || params.bucket === "spot"))  score += 10;
  if (mg === "focus"   && (params.bucket === "indoor" || params.bucket === "relax")) score += 8;
  if (mg === "shopping" && (params.bucket === "spot" || params.bucket === "indoor")) score += 8;

  if (mg === "food") {
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
    if (tags.includes("無料駐車場") && (transports.includes("車") || mg === "drive")) score += 10;
    if (tags.includes("駐車場あり") && (transports.includes("車") || mg === "drive")) score += 6;
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
    if (final.length >= 15) break;   // 15件を目標（旧: 12件上限）
    if (isDuplicate(item.title)) continue;
    used.add(item.title);

    if (item.openNow === false && item.bucket === "food") continue;
    if (item.openNow === false && final.length >= 14) continue;

    if (mood === "お腹すいた") {
      if (item.bucket !== "food" && item.bucket !== "indoor") continue;
      // 館内にお食事処を持つ温泉/銭湯等は bucket=food でも飲食目的に不適切 → 名前で除外（要件③）
      // Step 4: 共通モジュール定数 FINALIZE_NON_FOOD_NAME_RE に統一（インライン重複を削除）
      if (FINALIZE_NON_FOOD_NAME_RE.test(item.title)) continue;
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

// ── E-2: 短時間インメモリキャッシュ（Google/Yahoo 並列呼び出しの重複削減）──────
// Vercelのサーバーレス関数はウォームインスタンス間でキャッシュが共有されないが、
// 同一リクエスト内や近似条件の再検索では有効。TTL=5分。
const _supplementCache = new Map<string, { ts: number; data: Record<string, unknown>[] }>();
const SUPPLEMENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5分（インメモリ）
function getSupplementCache(key: string): Record<string, unknown>[] | null {
  const entry = _supplementCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SUPPLEMENT_CACHE_TTL_MS) {
    _supplementCache.delete(key);
    return null;
  }
  return entry.data;
}
function setSupplementCache(key: string, data: Record<string, unknown>[]): void {
  // キャッシュサイズ上限（最大50エントリ）を超えたら古いものを削除
  if (_supplementCache.size >= 50) {
    const oldest = [..._supplementCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _supplementCache.delete(oldest[0]);
  }
  _supplementCache.set(key, { ts: Date.now(), data });
}

// ── コスト削減D: Supabase永続キャッシュ（コールドスタート跨ぎで共有・TTL長め）──────
// インメモリ(5分)はVercelコールドスタートで消えるため、api_cache テーブルに保存して
// 全インスタンス・再検索(シャッフル含む=E)で共有する。TTL=60分。
// ※ api_cache テーブル未作成でもエラーにせず素通り（graceful degradation）。
const SUPPLEMENT_DB_CACHE_TTL_SEC = 60 * 60; // 60分
async function getSupplementDbCache(key: string): Promise<Record<string, unknown>[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("api_cache")
      .select("data, expires_at")
      .eq("cache_key", key)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null; // 期限切れ
    return Array.isArray(data.data) ? (data.data as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}
function setSupplementDbCache(key: string, data: Record<string, unknown>[]): void {
  if (!supabase || data.length === 0) return;
  const sb = supabase;
  // ⚠ Vercelは応答後のfire-and-forgetを凍結するため after() で確実に走らせる
  //   （これまで void で呼ばれ、60分キャッシュがほぼ保存されていなかった）
  const run = async () => {
    try {
      const expiresAt = new Date(Date.now() + SUPPLEMENT_DB_CACHE_TTL_SEC * 1000).toISOString();
      await sb.from("api_cache").upsert(
        { cache_key: key, data, expires_at: expiresAt, updated_at: new Date().toISOString() },
        { onConflict: "cache_key" },
      );
    } catch (e) { await logServerError("supplement_cache", e); }
  };
  try { after(async () => { await run(); }); } catch { void run(); }
}

// ─── 汎用長期キャッシュ（Google APIコスト削減・結果は完全同一）────────────────
// 写真URL・営業時間・最寄り駅・ジオコーディングは時間で変化しない/緩やかなため、
// api_cache テーブルに長期TTLで恒久化する。2回目以降の検索は同じデータを
// Supabaseから返すだけ＝品質を一切落とさずGoogle呼び出しを削減する。
//   キー: enr:<スポット名>=写真+営業時間 / st:<座標grid>=最寄り駅 / geo:<エリア>=座標
const LT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30日
const _ltMem = new Map<string, { exp: number; data: unknown }>();
async function ltCacheGetMany(keys: string[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  const missing: string[] = [];
  const now = Date.now();
  for (const k of keys) {
    const m = _ltMem.get(k);
    if (m && m.exp > now) out.set(k, m.data);
    else missing.push(k);
  }
  if (missing.length > 0 && supabase) {
    try {
      const { data } = await supabase
        .from("api_cache")
        .select("cache_key, data")
        .in("cache_key", missing)
        .gt("expires_at", new Date().toISOString());
      for (const row of data ?? []) {
        out.set(row.cache_key, row.data);
        _ltMem.set(row.cache_key, { exp: now + 5 * 60 * 1000, data: row.data });
      }
    } catch { /* api_cache未作成は無視 */ }
  }
  return out;
}
async function ltCachePut(key: string, data: unknown, ttlMs: number = LT_CACHE_TTL_MS): Promise<void> {
  _ltMem.set(key, { exp: Date.now() + Math.min(ttlMs, 5 * 60 * 1000), data });
  if (!supabase) return;
  try {
    await supabase.from("api_cache").upsert(
      { cache_key: key, data, expires_at: new Date(Date.now() + ttlMs).toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "cache_key" },
    );
  } catch { /* 無視 */ }
}
// enr: キャッシュの形（部分的でよい。あるフィールドだけ利用）
type EnrichCacheVal = { photoUrls?: string[]; weekday?: string[]; periods?: GooglePeriod[]; checked?: boolean };

// ─── Google Places 補足検索 ─────────────────────────────────────────────────
// Supabase 結果を補うために Google Places Nearby Search で 10 件追加取得
async function fetchGooglePlacesSupplement(
  lat: number,
  lng: number,
  radiusKm: number,
  mood: string,
  existingNames: string[],
  apiKey: string,
  limit: number = 10,
  budget?: number,
  deepDiveL1: string = "",
  minRadiusKm: number = 0,   // 遠端バイアス: この距離以上のスポットを優先
  deepDiveL2: string = "",   // L2詳細カテゴリ（Text Search精度向上に使用）
  companion: string = "",    // D-3: 同行者属性（子連れ → goodForChildren フィルタ）
): Promise<Array<Record<string, unknown>>> {
  // E-2/D: キャッシュキー（座標を0.01°≈1km単位に丸めて近似リクエストを合算）
  //   existingNames(seen)はキーに含めない → シャッフル再検索も同じキャッシュにヒット(E)。
  const cacheKey = `g:${(lat * 100 | 0) / 100},${(lng * 100 | 0) / 100}:r${Math.round(radiusKm)}:${mood}:${deepDiveL1}:${deepDiveL2}`;
  // ① インメモリ(5分) → ② Supabase永続(60分) の順にキャッシュを確認
  const cached = getSupplementCache(cacheKey);
  if (cached) return cached;
  const dbCached = await getSupplementDbCache(cacheKey);
  if (dbCached) {
    setSupplementCache(cacheKey, dbCached); // インメモリにも載せ次回を高速化
    return dbCached;
  }

  try {
    // 深掘りカテゴリ別の Google Places types（気分タグより具体的）
    const DEEP_DIVE_TYPES: Record<string, string[]> = {
      // ── お腹すいた L1 ────────────────────────────────────────────────────────
      "居酒屋":                          ["bar", "japanese_restaurant"],
      "和食":                            ["japanese_restaurant"],
      "洋食":                            ["restaurant"],
      "イタリアン":                      ["italian_restaurant"],
      "中華料理":                        ["chinese_restaurant"],
      "中華":                            ["chinese_restaurant"],   // L1短縮形（broad検索化を防ぐ）
      "焼肉":                            ["barbecue_restaurant"],
      "韓国料理":                        ["korean_restaurant"],
      "韓国":                            ["korean_restaurant"],    // L1短縮形（broad検索化を防ぐ）
      "アジア系統":                      ["thai_restaurant", "indian_restaurant"],
      "各国料理":                        ["restaurant"],
      "ラーメン":                        ["ramen_restaurant"],
      "お好み焼き":                      ["japanese_restaurant"],
      "お好み焼きもんじゃ":              ["japanese_restaurant"],   // L1短縮形
      "カフェスイーツ":                  ["cafe", "dessert_shop"],
      "高層ビル料理":                    ["restaurant"],
      // ── お腹すいた L2 ────────────────────────────────────────────────────────
      "個室居酒屋":                      ["bar", "japanese_restaurant"],
      "大衆酒場":                        ["bar", "japanese_restaurant"],
      "海鮮・お寿司":                    ["sushi_restaurant", "seafood_restaurant"],
      "天ぷら":                          ["japanese_restaurant"],
      "うどん・そば":                    ["japanese_restaurant"],
      "懐石料理":                        ["japanese_restaurant"],
      "ハンバーグ":                      ["hamburger_restaurant"],
      "オムライス":                      ["restaurant"],
      "ステーキ":                        ["steak_house"],
      "レトロ洋食":                      ["restaurant"],
      "焼肉食べ放題":                    ["barbecue_restaurant"],
      "高級焼肉":                        ["barbecue_restaurant"],
      "焼肉単品":                        ["barbecue_restaurant"],
      "インド・ネパール":                ["indian_restaurant"],
      "タイ料理":                        ["thai_restaurant"],
      "ベトナム料理":                    ["vietnamese_restaurant"],
      "アジアンエスニック料理":          ["restaurant"],
      "メキシコ料理":                    ["mexican_restaurant"],
      "ブラジル料理":                    ["restaurant"],
      "ロシア料理":                      ["restaurant"],
      "その他各国":                      ["restaurant"],
      "こってりラーメン":                ["ramen_restaurant"],
      "あっさりラーメン":                ["ramen_restaurant"],
      "味噌ラーメン":                    ["ramen_restaurant"],
      "つけ麺・まぜそば":               ["ramen_restaurant"],
      "フルーツ":                        ["cafe", "dessert_shop", "fruit_store"],
      "喫茶店":                          ["cafe"],
      "流行りカフェ":                    ["cafe", "coffee_shop"],
      // ── まったり L1 ──────────────────────────────────────────────────────────
      "自然の中":                        ["park", "nature_park", "hiking_area"],
      "カフェ":                          ["cafe", "coffee_shop"],
      "温泉スパ":                        ["spa", "sauna"],
      "温泉サウナ":                      ["spa", "sauna"],
      "絶景スポット":                    ["tourist_attraction", "park"],   // 修正: viewpoint/scenic_point は無効
      // ── まったり L2 ──────────────────────────────────────────────────────────
      "ブックカフェ・隠れカフェ":        ["cafe", "book_store"],
      "動物カフェ":                      ["cafe", "pet_store"],
      "猫カフェ":                        ["cafe", "pet_store"],
      "犬カフェ":                        ["cafe", "pet_store"],
      "小動物カフェ":                    ["cafe", "pet_store"],
      "アニマルカフェ":                  ["cafe", "pet_store"],           // 旧キー（後方互換）
      "景色良いカフェ":                  ["cafe", "coffee_shop"],
      "景色が良いカフェ":                ["cafe", "coffee_shop"],        // 旧キー（後方互換）
      "海辺カフェ":                      ["cafe", "coffee_shop"],
      "森林カフェ":                      ["cafe", "coffee_shop"],
      "高層ビルカフェ":                  ["cafe", "coffee_shop"],
      "流行りのカフェ":                  ["cafe", "coffee_shop"],         // 旧キー（後方互換）
      "絶品スイーツカフェ":              ["cafe", "dessert_shop"],
      "サウナ・岩盤浴":                  ["spa", "sauna"],
      "温泉施設全般":                    ["spa", "sauna"],          // 修正: onsen/bath は無効な型のため除去
      // ── わいわい L1 ──────────────────────────────────────────────────────────
      "体を動かして遊びたい":            ["bowling_alley", "amusement_park", "sports_complex"],
      "歌って飲んで騒ぎたい":            ["karaoke", "bar", "night_club"],
      "非日常の体験で盛り上がりたい":    ["amusement_park", "tourist_attraction"],
      // ── 楽しみたい L1（現行 QuizFlow キー。気分選択.docx 準拠）──────────────────
      // 定番遊び: テーマパーク・カラオケ遊園地・体験型アートラボ・期間限定ポップアップ
      "王道で遊ぶ":                      ["amusement_park", "karaoke", "tourist_attraction"],
      // アクティブ: ゲーセン/アミューズメント・ボウリング/ダーツ/ビリヤード・脱出/謎解き
      "アクティブに遊ぶ":                ["bowling_alley", "amusement_park", "karaoke"],
      // 観て楽しむ: 水族館/動物園・映画/劇場/ライブ・ミュージアム
      "観て楽しむ":                      ["aquarium", "zoo", "movie_theater", "museum"],
      // つくる・体験: ものづくり体験・工場見学（適した Google 型が薄いので keyword 主体）
      "つくる・体験":                    ["tourist_attraction", "art_gallery"],
      // ── スリル L1（絶叫/心霊/高所/体験型）────────────────────────────────────
      "絶叫":                            ["amusement_park", "tourist_attraction"],
      "心霊":                            ["tourist_attraction"],
      "高所":                            ["tourist_attraction"],
      "体験型":                          ["tourist_attraction", "amusement_park"],
      // ── 自然 L1 ──────────────────────────────────────────────────────────────
      "波の音と海風":                    ["marina", "tourist_attraction"],  // beachは無効型→park/海浜公園で代替
      "森の中で深呼吸":                  ["park", "national_park", "hiking_area"],
      "広い芝生でゴロゴロ":              ["park", "national_park"],
      "圧倒的な絶景":                    ["tourist_attraction"],     // viewpoint/scenic_pointは無効→tourist_attraction(展望台/タワー)
      // ── ドライブ L1 ──────────────────────────────────────────────────────────
      "海沿いを爽快に走りたい":          ["marina", "tourist_attraction"],
      "綺麗な景色や夜景を見に行きたい":  ["tourist_attraction"],
      "道の駅でご当地グルメ":            ["restaurant", "market"],           // 修正: food は無効な型
      "郊外の大型施設に行きたい":        ["shopping_mall", "department_store"],
      // ── 集中 L1 ──────────────────────────────────────────────────────────────
      "カフェで作業・勉強したい":        ["cafe", "coffee_shop", "library"],
      "静かな専用スペースで集中したい":  ["library", "university"],
      // ── 運動 L1 ──────────────────────────────────────────────────────────────
      "がっつり汗を流してトレーニング":  ["gym", "fitness_center", "sports_complex"],
      "打って投げてストレス発散":        ["driving_range", "sports_complex"],
      "遊び感覚でわいわい":              ["bowling_alley", "amusement_park"],
      "外で風を感じながらスポーツ":      ["park", "sports_complex", "hiking_area"],
      // ── 運動 L1 (v2 quiz keys) ──────────────────────────────────────────────
      "がっつり運動":                    ["gym", "fitness_center", "sports_complex"],
      "外でひろびろ":                    ["park", "national_park", "hiking_area"],
      "室内でのんびり":                  ["bowling_alley"],
      "ゲーム感覚で":                    ["bowling_alley", "amusement_park", "karaoke"],
      // ── ショッピング L1 ─────────────────────────────────────────────────────────
      "服・アクセサリー":                ["clothing_store", "shopping_mall"],
      "雑貨・インテリア":                ["home_goods_store", "furniture_store"],
      "コスメ・美容":                    ["beauty_salon", "drugstore"],      // 修正: cosmetics_store は無効
      "大型ショッピングモール":          ["shopping_mall", "department_store"],
      "お土産・ギフト":                  ["gift_shop", "store"],
      // ── ショッピング L2 ─────────────────────────────────────────────────────────
      "新品・現行":                      ["clothing_store", "shopping_mall"],
      "古着・ヴィンテージ":              ["clothing_store", "store"],         // 修正: thrift_store は無効
      // ── 旅行 L1 ──────────────────────────────────────────────────────────────
      // 修正: 日本の神社は hindu_temple/mosque ではなく place_of_worship。tourist_attraction併用。
      "パワースポット":                  ["place_of_worship", "tourist_attraction"],
      "パワースポットへ":                ["place_of_worship", "tourist_attraction"],
      "別世界のテーマパーク":            ["amusement_park", "tourist_attraction"],
      "知らない街をぶらぶら":            ["tourist_attraction"],    // 修正: shopping は無効
      "息を呑む絶景":                    ["tourist_attraction"],      // 修正: viewpoint/scenic_point は無効
    };

    const MOOD_TYPES: Record<string, string[]> = {
      // 完全名
      "お腹すいた":         ["restaurant"],
      "まったりしたい":     ["spa", "cafe", "park"],
      "わいわい楽しみたい": ["amusement_park", "bowling_alley", "karaoke"],
      "自然感じたい":       ["park", "national_park", "nature_park"],
      "ドライブしたい":     ["tourist_attraction", "park"],
      "集中したい":         ["library", "cafe"],
      "体を動かしたい":     ["gym", "sports_complex", "park"],
      "体動かしたい":       ["gym", "sports_complex", "park"],     // 短縮形
      "遠くに行きたい":     ["tourist_attraction", "amusement_park"],
      "ショッピング":       ["shopping_mall", "clothing_store", "store"],  // 追加（従来 tourist_attraction に誤フォールバックしていた）
      // クイズ短縮キー（同じマッピング）
      "まったり":   ["spa", "cafe", "park"],
      "疲れた・眠い": ["spa", "cafe", "park"],   // 遊び心枠: 癒やし寄りの検索にマップ
      "わいわい":   ["amusement_park", "bowling_alley", "karaoke"],
      "自然":       ["park", "national_park", "nature_park"],
      "ドライブ":   ["tourist_attraction"],
      "集中":       ["library", "cafe"],
      "運動":       ["gym", "sports_complex", "park"],
      "旅行":       ["tourist_attraction", "amusement_park"],
      "ショッピングしたい": ["shopping_mall", "clothing_store", "store"],
      "楽しみたい": ["amusement_park", "bowling_alley", "karaoke"],   // アプリ送信の短キー
      "時間潰し":   ["shopping_mall", "book_store", "movie_theater", "tourist_attraction"], // 暇つぶし=非飲食レジャー
    };

    // 深掘りタグが一致すればそちらを優先（より具体的な結果）
    const types = DEEP_DIVE_TYPES[deepDiveL1] ?? MOOD_TYPES[mood] ?? ["tourist_attraction"];

    // ── 1回分の Nearby Search を実行して places を返すヘルパー ──────────────────
    // D-3: goodForChildren/goodForGroups/liveMusic を追加してコンパニオンフィルタに活用
    // #7/#8: currentOpeningHours(openNow + periods) を追加し営業中優先・バッジ計算に使う。
    // #12: businessStatus を追加し、閉店(CLOSED_PERMANENTLY)・長期休業店を除外する。
    // コスト削減C: goodForChildren/goodForGroups/liveMusic(Atmosphere課金=最高SKU)を除外。
    //   これらは D-3 同行者ソートにのみ使う軽微な加点だったため、コスト優先で取得を停止。
    //   （必要なら詳細ページで該当スポットのみ遅延取得する設計に移行可能）
    // rating/userRatingCount は撤廃: MoodGoはGoogle評価・口コミを一切読み込まない（Moodログ＋行った!集計に一本化・SKUも安価に）
    const FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.photos,places.googleMapsUri,places.regularOpeningHours,places.currentOpeningHours.openNow,places.currentOpeningHours.periods,places.businessStatus,places.priceLevel,places.location,places.primaryType";
    const searchNearbyAt = async (
      cLat: number, cLng: number, rM: number,
      rank: "POPULARITY" | "DISTANCE" = "POPULARITY",
    ): Promise<Array<Record<string, unknown>>> => {
      try {
        const res = await gfetch("https://places.googleapis.com/v1/places:searchNearby", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify({
            includedTypes: types,
            // 宿泊メインの施設（ホテル・旅館など日帰り不可）は除外。
            // primaryType が restaurant 等の施設（ホテル内レストラン）は残る。
            excludedPrimaryTypes: LODGING_PRIMARY_TYPES,
            maxResultCount: 20,  // 多めに取得してシャッフルで多様化
            rankPreference: rank,
            languageCode: "ja",
            locationRestriction: {
              circle: { center: { latitude: cLat, longitude: cLng }, radius: Math.min(rM, 50000) },
            },
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [];
        const data = await res.json().catch(() => null);
        return (data?.places ?? []) as Array<Record<string, unknown>>;
      } catch { return []; }
    };

    // お腹すいた: 「最寄りの飲食店」を確実に拾うため、現在地中心の DISTANCE 順検索を追加する。
    // POPULARITY 順だと一番近い店（例: 用心棒 本号）が人気上位20件から漏れることがあるため。
    const isFoodNearest = mood === "お腹すいた";

    // ── Text Search ヘルパー（キーワード名前検索。shopping_mall系で使用）────────
    const searchTextQuery = async (textQuery: string): Promise<Array<Record<string, unknown>>> => {
      try {
        const res = await gfetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery,
            languageCode: "ja",
            pageSize: 20,
            locationBias: {
              circle: {
                center: { latitude: lat, longitude: lng },
                radius: Math.min(radiusKm * 1000, 50000),
              },
            },
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [];
        const data = await res.json().catch(() => null);
        return (data?.places ?? []) as Array<Record<string, unknown>>;
      } catch { return []; }
    };

    // ── 検索中心点リストを構築 ────────────────────────────────────────────────
    // ① 現在地中心（最大50km）。毎回異なる結果のため小さなジッターを加える。
    const jitterLat = lat + (Math.random() - 0.5) * 0.006;
    const jitterLng = lng + (Math.random() - 0.5) * 0.006;
    const centralRadiusM = Math.min(radiusKm * 1000, 50000);
    type SearchCenter = { lat: number; lng: number; radiusM: number };
    const centers: SearchCenter[] = [{ lat: jitterLat, lng: jitterLng, radiusM: centralRadiusM }];

    // ② 遠距離設定（要求半径が Nearby の50km上限を超える）場合、リング状に中心点を配置。
    //    各点で 50km の Nearby Search を行い、union することで 50km〜200km の遠方帯を取得する。
    //    遠方を優先するため、リング中心は外縁寄り（radiusKm-50 と minRadiusKm の大きい方）に置く。
    if (radiusKm > 50) {
      const ringDistKm = Math.max(minRadiusKm, radiusKm - 50, 50);
      // 遠いほどリング点を増やして角度方向のカバレッジを上げる（最大8点）
      const ringN = ringDistKm >= 140 ? 8 : ringDistKm >= 90 ? 6 : 5;
      const baseBearing = Math.random() * 360; // 毎回少し回転させて多様化
      for (let i = 0; i < ringN; i++) {
        const bearing = baseBearing + (360 / ringN) * i;
        const pt = destinationPoint(lat, lng, bearing, ringDistKm);
        centers.push({ lat: pt.lat, lng: pt.lng, radiusM: 50000 });
      }
    }

    // ── 大型ショッピングモール系は Text Search を優先追加 ────────────────────
    // Nearby Search の shopping_mall タイプは商店街・市場も拾うため、
    // 「イオンモール」「アウトレット」「ショッピングモール」のキーワード検索で
    // 実際のモール施設を直接取得する。
    // Nearby Search の shopping_mall タイプは公園・レジャー施設も拾うため、
    // モール検索では Nearby Search を使わず Text Search 専用にする。
    const isMallSearch = isLargeMallSearch(deepDiveL1);
    const MALL_TEXT_QUERIES = [
      "イオンモール",
      "アウトレットモール",
      "ショッピングモール",
      "ららぽーと",
      "三井アウトレットパーク",
    ];

    // ── 大型ショッピングモールの結果名前フィルター ───────────────────────────
    // Text Search 結果でもレジャー施設・公園が混入する場合があるため、
    // 名前にモール系キーワードを含むものだけを通す（共通関数を使用）。
    const isMallName = (name: string) => isLargeMallName(name);

    // ── 全中心点 Nearby Search ＋ モール系 Text Search を並列実行して union ────
    // モール検索は Text Search 専用（Nearby Search はスキップ）
    // 非モール検索でも深掘りキーワードで Text Search を行う（要件: Google もフリーワード検索）。
    //   深掘り名(例「個室居酒屋」「高級焼肉」「天ぷら」)は Google のテキストクエリとして精度が高い。
    //   タイプ検索(restaurant)だけだと人気のラーメン店等に偏り、カテゴリがずれる問題を補正する。
    // Google Text Search 用クエリ: L2 が具体的なカテゴリ名なら L2 を優先（例「うどん・そば」「ハンバーグ」）。
    // L2 が未指定 or こだわらない の場合は L1（例「居酒屋」「和食」）を使用。
    // DIVE_KW の先頭キーワードを優先して使う（例「うどん・そば」→「うどんそば屋」で高精度検索）。
    // A-2: ジャンルごとに複数キーワードを定義して並列テキスト検索（先頭2語使用）
    const DIVE_MULTI_KW: Record<string, string[]> = {
      "うどん・そば":            ["うどんそば屋", "うどん専門店"],
      "懐石料理":                ["懐石料理", "日本料理 懐石"],
      "ハンバーグ":              ["ハンバーグ専門店", "洋食 ハンバーグ"],
      "オムライス":              ["オムライス専門店", "洋食 オムライス"],
      "ステーキ":                ["ステーキハウス", "熟成ステーキ"],
      "レトロ洋食":              ["昔ながら洋食屋", "老舗洋食"],
      "個室居酒屋":              ["個室居酒屋", "完全個室 居酒屋"],
      "大衆酒場":                ["大衆居酒屋", "せんべろ 立ち飲み"],
      "こってりラーメン":        ["家系ラーメン", "豚骨ラーメン"],
      "あっさりラーメン":        ["塩ラーメン", "あっさり系ラーメン"],
      "味噌ラーメン":            ["味噌ラーメン専門店", "北海道味噌ラーメン"],
      "つけ麺・まぜそば":        ["つけ麺", "まぜそば 油そば"],
      "フルーツ":                ["フルーツパーラー", "フルーツカフェ"],
      "喫茶店":                  ["昭和喫茶店", "レトロ喫茶"],
      "流行りカフェ":            ["韓国カフェ", "インスタ映えカフェ"],
      "焼肉食べ放題":            ["焼肉食べ放題", "焼肉 食べ放題 コース"],
      "高級焼肉":                ["高級焼肉 コース", "黒毛和牛 焼肉"],
      "焼肉単品":                ["大衆焼肉", "焼肉 リーズナブル"],
      "インド・ネパール":        ["インドカレー", "ネパールカレー"],
      "韓国料理":                ["韓国料理", "サムギョプサル チーズダッカルビ"],
      "イタリアン":              ["イタリアン", "ピッツェリア パスタ専門"],
      "中華料理":                ["町中華", "中国料理 本格"],
      "タイ料理":                ["タイ料理 ガパオ", "本格タイ料理"],
      "ベトナム料理":            ["ベトナム料理 フォー", "バインミー"],
      "アジアンエスニック":      ["アジアンエスニック料理", "エスニック料理"],
      "海鮮・お寿司":            ["海鮮料理", "海鮮丼 お寿司"],
      "居酒屋":                  ["和風居酒屋", "居酒屋 ダイニング"],
      "和食":                    ["和食レストラン", "日本料理 定食"],
      "ラーメン":                ["ラーメン", "中華そば 麺"],
      "カフェスイーツ":          ["スイーツカフェ", "パフェカフェ"],
      "お好み焼きもんじゃ":      ["お好み焼き", "もんじゃ焼き"],
      "温泉":                    ["日帰り温泉", "天然温泉 スパ"],
      // ── 楽しみたい L1（現行 QuizFlow キー。気分選択.docx 準拠）──────────────────
      "王道で遊ぶ":              ["テーマパーク 遊園地", "カラオケ 体験型アート"],
      "アクティブに遊ぶ":        ["ゲームセンター アミューズメント", "ボウリング 脱出ゲーム 謎解き"],
      "観て楽しむ":              ["水族館 動物園", "映画館 劇場 ミュージアム"],
      "つくる・体験":            ["ものづくり体験 工房", "工場見学 陶芸体験"],
      // ── スリル L2（Google Text）────────────────────────────────────────────
      "絶叫":                    ["ジェットコースター 絶叫マシン", "遊園地 アトラクション"],
      "心霊":                    ["お化け屋敷", "心霊スポット 肝試し"],
      "高所":                    ["展望台 タワー", "吊り橋 スカイウォーク 絶景"],
      "体験型":                  ["VR 脱出ゲーム アスレチック", "ジップライン アドベンチャー 体験"],
      "サウナ":                  ["サウナ施設", "フィンランドサウナ"],
      "道の駅":                  ["道の駅 グルメ", "道の駅 ランチ"],
      // ── 自然 L2（Google Text。海辺/公園/植物園/展望台で精度向上）──────────────
      "波の音と海風":            ["海浜公園 海岸", "ビーチ 海水浴場 岬"],
      "森の中で深呼吸":          ["森林公園 自然公園", "植物園 渓谷 森林浴"],
      "広い芝生でゴロゴロ":      ["芝生の広い公園", "大型公園 植物園 ピクニック"],
      "圧倒的な絶景":            ["展望台 絶景スポット", "夜景スポット 景勝地 パノラマ"],
      "自然の中":                ["自然公園 海辺", "森林公園 大きな公園"],
      "絶景スポット":            ["展望台 絶景スポット", "夜景スポット 景勝地"],
      // ── まったり カフェ系（Google Text）─────────────────────────────────────
      "ブックカフェ・隠れカフェ": ["ブックカフェ", "隠れ家カフェ"],
      "絶品スイーツカフェ":      ["スイーツカフェ", "パンケーキ パフェ カフェ"],
      "動物カフェ":              ["猫カフェ", "アニマルカフェ 動物ふれあい"],
      "猫カフェ":                ["猫カフェ", "保護猫カフェ"],
      "犬カフェ":                ["犬カフェ", "ドッグカフェ"],
      "小動物カフェ":            ["うさぎカフェ ハリネズミカフェ", "小動物 ふれあいカフェ"],
      "景色良いカフェ":          ["絶景カフェ 海が見えるカフェ", "夜景カフェ テラス席カフェ"],
      "海辺カフェ":              ["海が見えるカフェ オーシャンビュー", "海辺カフェ"],
      "森林カフェ":              ["森カフェ 山奥カフェ", "自然の中のカフェ"],
      "高層ビルカフェ":          ["高層階カフェ 展望カフェ", "スカイラウンジ"],
      "高層ビル料理":            ["展望レストラン 夜景", "スカイレストラン ホテルダイニング 高層階"],
      // ── 温泉スパ（Google Text）──────────────────────────────────────────────
      "温泉スパ":                ["日帰り温泉 スーパー銭湯", "天然温泉 スパ"],
      "温泉施設全般":            ["日帰り温泉 スーパー銭湯", "健康ランド スパ"],
      "サウナ・岩盤浴":          ["サウナ ロウリュ", "岩盤浴 スーパー銭湯"],
      // ── ドライブ（Google Text）──────────────────────────────────────────────
      "海沿いを爽快に走りたい":   ["海浜公園 海岸", "ビーチ 岬 絶景"],
      "綺麗な景色や夜景を見に行きたい": ["展望台 夜景スポット", "景勝地 パノラマ"],
      "道の駅でご当地グルメ":     ["道の駅", "ご当地グルメ 直売所"],
      "郊外の大型施設に行きたい": ["イオンモール ららぽーと", "アウトレットモール"],
      // ── 集中（Google Text）──────────────────────────────────────────────────
      "カフェで作業・勉強したい": ["電源カフェ wifi 作業", "勉強できるカフェ"],
      "静かな専用スペースで集中したい": ["図書館", "自習室 コワーキングスペース"],
      // ── 運動（Google Text）──────────────────────────────────────────────────
      "がっつり運動":            ["スポーツジム フィットネス", "ボルダリング トランポリンパーク"],
      "外でひろびろ":            ["大きな公園 アスレチック", "スポーツ公園 ランニングコース"],
      "室内でのんびり":          ["ボウリング バッティングセンター", "卓球 ビリヤード"],
      "ゲーム感覚で":            ["ラウンドワン スポッチャ", "ボウリング カラオケ"],
      // ── 旅行（Google Text）──────────────────────────────────────────────────
      "パワースポット":          ["有名な神社 パワースポット", "神社 寺"],
      "パワースポットへ":        ["有名な神社 パワースポット", "神社 寺"],
      "別世界のテーマパーク":    ["テーマパーク 遊園地", "レジャーランド"],
      "息を呑む絶景":            ["絶景スポット 展望台", "景勝地 夜景"],
      // ── ショッピング（Google Text。モールはisMallSearch専用処理のため除外）────
      "服・アクセサリー":        ["セレクトショップ アパレル", "ファッションビル"],
      "新品・現行":              ["セレクトショップ アパレル", "ファッションビル"],
      "古着・ヴィンテージ":      ["古着屋", "ヴィンテージショップ"],
      "雑貨・インテリア":        ["雑貨屋", "インテリアショップ"],
      "コスメ・美容":            ["コスメショップ", "コスメ 香水"],
      "お土産・ギフト":          ["お土産屋", "ギフトショップ"],
      // 旅行・観光: 知らない街をぶらぶら → 中華街・商店街・小町通り・道の駅など「そこにしかない」エリア
      "知らない街をぶらぶら":    ["有名観光スポット 街歩き", "商店街 中華街 食べ歩き 横丁"],
      "知らない町へ":            ["商店街 食べ歩き 中華街", "道の駅 横丁 観光名所 通り"],
      "お散歩":                  ["商店街 食べ歩き 中華街", "道の駅 横丁 観光名所 通り"],
    };
    const dvTextBase = (deepDiveL2 && deepDiveL2 !== "こだわらない") ? deepDiveL2 : deepDiveL1;
    const dvMultiRaw = DIVE_MULTI_KW[dvTextBase];
    const dvTextKey = dvMultiRaw?.[0] ?? dvTextBase; // 後方互換
    // A-2: 最大2キーワードを並列テキスト検索（精度向上）
    const dvTextQueries: string[] =
      (!isMallSearch && dvTextBase && dvTextBase !== "こだわらない")
        ? (dvMultiRaw ? dvMultiRaw.slice(0, 2) : [dvTextKey])
        : [];
    // お腹すいた時は現在地中心の DISTANCE 順検索も中心点に加える（最寄り店の取りこぼし防止）
    const nearbyCenterCalls = isMallSearch
      ? Promise.resolve([] as Array<Array<Record<string, unknown>>>)
      : Promise.all([
          ...centers.map(c => searchNearbyAt(c.lat, c.lng, c.radiusM)),
          ...(isFoodNearest
            ? [searchNearbyAt(lat, lng, Math.min(radiusKm * 1000, 50000), "DISTANCE")]
            : []),
        ]);
    const [nearbyResults, ...textResults] = await Promise.all([
      nearbyCenterCalls,
      ...(isMallSearch
        ? MALL_TEXT_QUERIES.map(q => searchTextQuery(q))
        : dvTextQueries.map(q => searchTextQuery(q))),
    ]);

    const seenIds = new Set<string>();
    const places: Array<Record<string, unknown>> = [];
    const textKeys = new Set<string>();  // Text Search(深掘りキーワード)由来のキー＝カテゴリ精度が高く優先する

    // Text Search 結果を先に追加（キーワード名前マッチなので精度高い）
    for (const arr of textResults) {
      for (const p of arr) {
        const pid = (p.id as string | undefined) ?? "";
        const key = pid || ((p.displayName as { text?: string } | undefined)?.text ?? "");
        const name = (p.displayName as { text?: string } | undefined)?.text ?? "";
        // モール検索時は名前にモール系キーワードを含むものだけ通す
        if (isMallSearch && !isMallName(name)) continue;
        if (key && !seenIds.has(key)) { seenIds.add(key); places.push(p); textKeys.add(key); }
      }
    }
    // Nearby Search 結果を後から追加（非モール検索時の補完）
    for (const arr of nearbyResults) {
      for (const p of arr) {
        const pid = (p.id as string | undefined) ?? "";
        const key = pid || ((p.displayName as { text?: string } | undefined)?.text ?? "");
        if (key && !seenIds.has(key)) { seenIds.add(key); places.push(p); }
      }
    }
    if (places.length === 0) return [];

    // Supabase 結果と名前が被るものを除外
    const existingLower = new Set(existingNames.map(n => n.toLowerCase()));

    // Google PriceLevel → 概算費用（円）のマッピング
    const PRICE_LEVEL_COST: Record<string, number> = {
      PRICE_LEVEL_FREE:          0,
      PRICE_LEVEL_INEXPENSIVE:   1000,
      PRICE_LEVEL_MODERATE:      3500,
      PRICE_LEVEL_EXPENSIVE:     8000,
      PRICE_LEVEL_VERY_EXPENSIVE: 15000,
    };
    // A-8: priceLevel欠損時にジャンルから概算費用を推定
    const GENRE_PRICE_ESTIMATE: Record<string, string> = {
      "懐石料理":    "PRICE_LEVEL_EXPENSIVE",
      "高級焼肉":    "PRICE_LEVEL_EXPENSIVE",
      "ステーキ":    "PRICE_LEVEL_EXPENSIVE",
      "展望レストラン": "PRICE_LEVEL_EXPENSIVE",
      "居酒屋":      "PRICE_LEVEL_INEXPENSIVE",
      "大衆酒場":    "PRICE_LEVEL_INEXPENSIVE",
      "焼肉単品":    "PRICE_LEVEL_INEXPENSIVE",
      "大衆焼肉":    "PRICE_LEVEL_INEXPENSIVE",
      "こってりラーメン": "PRICE_LEVEL_INEXPENSIVE",
      "あっさりラーメン": "PRICE_LEVEL_INEXPENSIVE",
      "ラーメン":    "PRICE_LEVEL_INEXPENSIVE",
      "うどん・そば": "PRICE_LEVEL_INEXPENSIVE",
      "カフェスイーツ": "PRICE_LEVEL_INEXPENSIVE",
    };
    const estimatedPriceLevel = GENRE_PRICE_ESTIMATE[deepDiveL2 || deepDiveL1] ?? null;

    // 予算オーバーか判定（priceLevel がない/不明な場合はジャンル推定を使用）
    const isOverBudget = (priceLevel: string | undefined): boolean => {
      if (!budget || budget >= 10000) return false; // 予算未設定 or 高め → フィルタなし
      const pl = (priceLevel && priceLevel !== "PRICE_LEVEL_UNSPECIFIED")
        ? priceLevel
        : estimatedPriceLevel; // A-8: ジャンル推定を使用
      if (!pl) return false; // 不明 → 通過
      return (PRICE_LEVEL_COST[pl] ?? 0) > budget;
    };

    // 食事系の気分（お腹すいた）はホテル内レストランを許容するため名前フィルタを緩める
    const isFoodMoodGoogle = mood === "お腹すいた";
    // 飲食OKでないコンテキスト（サウナ/温泉/自然/楽しみたい等）では飲食店を除外する
    const blockFoodGoogle = !isFoodAllowedContext(mood, deepDiveL1);

    // フィルタ後に Fisher-Yates シャッフル → 毎回異なる順序で limit 件を取得
    const filteredAll = places
      .filter((p: Record<string, unknown>) => {
        const name = (p.displayName as { text?: string } | undefined)?.text ?? "";
        if (existingLower.has(name.toLowerCase()) || name.length === 0) return false;
        // 飲食NGコンテキスト: 飲食店型（restaurant/cafe/bar等）は名前に関わらず除外
        if (blockFoodGoogle && FOOD_FAMILY_PRIMARY_TYPES.has((p.primaryType as string) ?? "")) return false;
        // 型が無い/汎用でも、明確な飲食店名（マクドナルド/〇〇カフェ等）は除外
        if (blockFoodGoogle && isRestaurantName(name)) return false;
        // #12: 完全閉店(CLOSED_PERMANENTLY)のみ除外する。
        //   CLOSED_TEMPORARILY は「売り切れ次第閉店/定休日/本日休業」等の一時閉店を含み、
        //   営業中の人気店(用心棒・二郎系等)が本日閉店中なだけで消えてしまうため除外しない。
        //   （本日閉店中の店は openNow=false の「営業時間外」バッジで表示する）
        const bizStatus = p.businessStatus as string | undefined;
        if (bizStatus === "CLOSED_PERMANENTLY") return false;
        if (isOverBudget(p.priceLevel as string | undefined)) return false;
        // 宿泊施設の除外（primaryType ベース。API除外をすり抜けた場合の保険）
        if (LODGING_PRIMARY_SET.has((p.primaryType as string) ?? "")) return false;
        // 名前ベースの宿泊施設除外（食事系以外）。ホテル内レストランは食事用途で残す
        if (!isFoodMoodGoogle && isLodgingName(name)) return false;
        // 大型ショッピングモール検索時に商店街・市場系を除外（Google が shopping_mall タイプに含めてしまうため）
        if (isShoppingMallMismatch(name, deepDiveL1)) return false;
        // ジャンル精度: primaryType が深掘りジャンルと異なる具体フード型なら除外
        //   （例: うどん・そば検索の sushi_restaurant=魚屋路 を除外）。汎用型は通す。
        if (!primaryTypeAllowedForGenre(p.primaryType as string | undefined, dvTextBase)) return false;
        return true;
      });

    // 各スポットの現在地からの距離(km)を計算
    // リング検索は各点で最大50km拾うため、要求半径(radiusKm)を大きく超えるスポットが
    // 含まれうる。要求半径の約1.15倍を上限に、行き過ぎたスポットを除外する。
    // (座標不明 distKm<0 は判定不能なので残す)
    const maxDistKm = radiusKm > 0 ? radiusKm * 1.15 : Infinity;
    const keyOf = (p: Record<string, unknown>) =>
      ((p.id as string | undefined) ?? "") || ((p.displayName as { text?: string } | undefined)?.text ?? "");
    const withDist = filteredAll
      .map((p) => {
        const loc = p.location as { latitude?: number; longitude?: number } | undefined;
        const distKm = (typeof loc?.latitude === "number" && typeof loc?.longitude === "number")
          ? haversineMeters(lat, lng, loc.latitude, loc.longitude) / 1000
          : -1;  // 座標不明
        // D-3: 同行者属性に基づくコンパニオンスコア（ソート時に優遇）
        let companionScore = 0;
        if (companion.includes("家族") || companion.includes("子ども")) {
          if (p.goodForChildren === true) companionScore += 1;
        }
        if (companion.includes("大人数") || companion.includes("グループ")) {
          if (p.goodForGroups === true) companionScore += 1;
        }
        if (companion.includes("恋人") || companion.includes("デート")) {
          if (p.liveMusic === true || p.outdoorSeating === true) companionScore += 0.5;
        }
        return { p, distKm, isText: textKeys.has(keyOf(p)), companionScore };
      })
      .filter((d) => d.distKm < 0 || d.distKm <= maxDistKm);

    // Fisher-Yates shuffle ヘルパー
    const shuffleArr = <T,>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };

    // グループ内の並び順（遠端バイアス時は遠い順、通常はシャッフル）
    // D-3: companionScoreが高い場合はシャッフルでも少し上位に来やすくする
    const orderGroup = (group: typeof withDist): typeof withDist => {
      if (minRadiusKm > 0) {
        const far  = group.filter(d => d.distKm >= minRadiusKm);
        const near = group.filter(d => d.distKm < minRadiusKm);
        far.sort((a, b) => (b.distKm - a.distKm) + (Math.random() - 0.5) * 2);
        return [...far, ...shuffleArr(near)];
      }
      // D-3: companionScore > 0 のスポットをシャッフル前に少し優遇
      if (companion) {
        return [...group]
          .map(d => ({ d, s: Math.random() + d.companionScore * 2 }))
          .sort((a, b) => b.s - a.s)
          .map(x => x.d);
      }
      return shuffleArr(group);
    };

    // A-3: ジャンル不一致フィルター（Text Search結果のみ）
    // ジャンル不一致フィルタは「否定語による除外のみ」（肯定語の必須化はしない）。
    //   名前に「ラーメン」を含まない正規店（用心棒・一蘭・蒙古タンメン中本 等）を誤除外しない。
    //   明確な異ジャンル語（アイス/パスタ/たこ焼き 等）を含む店だけ弾く＝module の nameMatchesGenre に統一。
    const applyGenreFidelity = (group: typeof withDist): typeof withDist => {
      return group.filter(d => {
        const name = (d.p.displayName as { text?: string } | undefined)?.text ?? "";
        return nameMatchesGenre(name, dvTextBase);
      });
    };

    // キーワード(深掘り)一致の Text Search 結果を最優先。タイプ検索(Nearby)結果は補填。
    //   これにより「個室居酒屋」検索で人気ラーメン店ではなく個室居酒屋が上位に来る。
    // A-3: Text Search 結果にのみジャンル(否定語)フィルターを適用
    const ordered = [
      ...orderGroup(applyGenreFidelity(withDist.filter(d => d.isText))),
      ...orderGroup(withDist.filter(d => !d.isText)),
    ];

    const filtered = ordered.slice(0, limit);

    const PRICE_MAP: Record<string, string> = {
      PRICE_LEVEL_FREE: "無料", PRICE_LEVEL_INEXPENSIVE: "￥",
      PRICE_LEVEL_MODERATE: "￥￥", PRICE_LEVEL_EXPENSIVE: "￥￥￥",
      PRICE_LEVEL_VERY_EXPENSIVE: "￥￥￥￥",
    };

    // 写真は photo-proxy URL を直接組み立て（解決は表示時に遅延 → 高速化、最大10枚）
    const result = filtered.map(({ p, distKm }: { p: Record<string, unknown>; distKm: number }) => {
      const name = (p.displayName as { text?: string } | undefined)?.text ?? "";
      const photoObjs = (p.photos as Array<{ name: string }> | undefined) ?? [];
      const photoNames = photoObjs.slice(0, 10).map(ph => ph.name).filter(Boolean);
      const photoUrls = photoNames.map(n => buildPhotoProxyUrl(n));
      const photoUrl = photoUrls[0] ?? undefined;
      const hours = p.regularOpeningHours as { weekdayDescriptions?: string[] } | undefined;
      const gloc = p.location as { latitude?: number; longitude?: number } | undefined;
      // #7/#8: 営業状態とバッジを計算
      const openStatus = computeOpenStatus(
        p.currentOpeningHours as { openNow?: boolean; periods?: GooglePeriod[] } | undefined,
      );
      return {
        title: name,
        address: (p.formattedAddress as string | undefined) ?? "",
        photoUrl,
        photoUrls,
        rating: typeof p.rating === "number" ? p.rating : null,
        userRatingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        openNow: openStatus.openNow,
        openStatusBadge: openStatus.badge,           // #7/#8: 「営業中」「もうすぐ閉店」等
        closingSoonMin: openStatus.closingSoonMin,
        openingSoonMin: openStatus.openingSoonMin,
        openingHoursText: hours?.weekdayDescriptions?.join("\n") ?? undefined,
        mapUrl: (p.googleMapsUri as string | undefined) ?? "",
        googleMapsUrl: (p.googleMapsUri as string | undefined) ?? "",
        reason: "",
        features: [],
        distanceText: distKm >= 0 ? formatDistTextFromKm(distKm) : "",
        distanceKm: distKm >= 0 ? distKm : undefined,
        lat: typeof gloc?.latitude === "number" ? gloc.latitude : undefined,
        lng: typeof gloc?.longitude === "number" ? gloc.longitude : undefined,
        durationText: "",
        stationText: "",
        vibe: "",
        budget: "",
        time: "",
        priceLevel: PRICE_MAP[(p.priceLevel as string) ?? ""] ?? undefined,
        placeId: (p.id as string | undefined) ?? undefined,
        supabaseId: undefined,
        source: "google" as const,
        isUserSpot: false,
        hasUserPhotos: false,
        userPhotoCount: 0,
        routesByMode: undefined,
      };
    });
    // E-2/D: 結果をインメモリ(5分)とSupabase永続(60分)の両方にキャッシュ
    //   （existingNames はキーに含めないため、シャッフル再検索も同キャッシュにヒット=E）
    setSupplementCache(cacheKey, result);
    setSupplementDbCache(cacheKey, result); // after()で応答後に確実に保存
    return result;
  } catch (e) {
    console.error("[recommend] Google supplement search failed:", e);
    return [];
  }
}

// ─── Yahoo!ローカルサーチ 補足検索 ───────────────────────────────────────────
// Supabase + Google 結果を補うために Yahoo!ローカルサーチで最大 limit 件追加取得
async function fetchYahooSupplement(
  lat: number,
  lng: number,
  radiusKm: number,
  mood: string,
  deepDiveL1: string,
  existingNames: string[],
  limit: number = 10,
  minRadiusKm: number = 0,   // 遠端バイアス: この距離以上のスポットを優先
  googleApiKey: string = "", // Yahoo結果の写真をGoogle Placesで補完するためのキー
): Promise<Array<Record<string, unknown>>> {
  if (RECOMMEND_DISABLE_GOOGLE) return [];   // 規約対応: 外部検索オフ時はYahoo検索も停止
  const apiKey = process.env.YAHOO_LOCAL_SEARCH_API_KEY;
  if (!apiKey) return [];

  // ── キャッシュ（Google補足 fetchGooglePlacesSupplement と同型・インメモリ5分→Supabase永続60分）──
  //   existingNames(seen)はキーに含めない＝シャッフル/近接再検索も同一ヒット。
  //   Yahoo API呼び出し＋Yahoo結果のGoogle写真補完(1件=1 searchText・最大10)の再課金を防ぐ。
  const yCacheKey = `y:${(lat * 100 | 0) / 100},${(lng * 100 | 0) / 100}:r${Math.round(radiusKm)}:${mood}:${deepDiveL1}`;
  const yCached = getSupplementCache(yCacheKey);
  if (yCached) return yCached;
  const yDbCached = await getSupplementDbCache(yCacheKey);
  if (yDbCached) { setSupplementCache(yCacheKey, yDbCached); return yDbCached; }

  // 気分ごとの基本キーワード
  const MOOD_KW: Record<string, string> = {
    "お腹すいた":         "レストラン グルメ",
    "まったり":           "カフェ 温泉 公園 映画館",
    "疲れた・眠い":       "温泉 スパ カフェ",
    "わいわい":           "カラオケ ボウリング アミューズメント",
    // ※「自然」単独はYahoo全文一致で事業所(自然堂/自然環境保全課等)を拾うため「自然公園」に
    "自然":               "公園 自然公園 景勝地",
    "ドライブ":           "道の駅 展望台 景勝地",
    "集中":               "カフェ 図書館 自習室",
    "運動":               "スポーツ ジム 体育館",
    "旅行":               "観光 テーマパーク 神社",
    "時間潰し":           "ショッピングモール 映画館 書店",
    "ショッピング":        "ショッピングモール 商業施設 雑貨",
  };
  // 深掘り選択による上書きキーワード
  const DIVE_KW: Record<string, string> = {
    // ── お腹すいた L1 ──────────────────────────────────────────────────────
    "居酒屋":                       "居酒屋 大衆居酒屋 個室居酒屋 居酒屋完全個室",
    "和食":                         "和食屋 和食 懐石料理 料亭 うどんそば屋 うどん そば 手打ちそば 天ぷら屋 天丼 天ぷら定食 天ぷら 海鮮料理屋 海鮮丼 魚介定食 浜焼き お刺身",
    "洋食":                         "洋食",
    "イタリアン":                   "イタリアン パスタ ピザ バル",
    "中華料理":                     "中華 ガチ中華 中華街",
    "焼肉":                         "焼肉 焼肉食べ放題 高級焼肉 黒毛和牛 大衆焼肉 焼肉定食 安安焼肉 牛角",
    "韓国料理":                     "韓国料理 サムギョプサル チーズタッカルビ スンドゥブ",
    "アジア系統":                   "アジア料理 アジア系統 インドネパール料理 インドカレー タイ料理 ベトナム料理 アジアンエスタニック料理",
    "各国料理":                     "各国料理 レストラン",
    "ラーメン":                     "ラーメン こってりラーメン 家系ラーメン 豚骨ラーメン あっさりラーメン 塩ラーメン つけ麺 まぜそば 味噌ラーメン",
    "お好み焼き":                   "お好み焼き もんじゃ もんじゃ焼き",
    "カフェスイーツ":                "カフェスイーツ フルーツカフェ 果物カフェ アサイーボウル 喫茶店 レトロ喫茶 流行りカフェ 無機質カフェ 韓国カフェ 淡色カフェ レコードカフェ 推し活カフェ 映えスイーツ",
    "高層ビル料理":                  "展望レストラン スカイレストラン 夜景ディナー",
    // ── お腹すいた L2 ──────────────────────────────────────────────────────
    "個室居酒屋":                   "個室居酒屋 居酒屋完全個室",
    "大衆酒場":                     "大衆居酒屋",
    "海鮮・お寿司":                 "海鮮料理屋 海鮮丼 魚介定食 浜焼き お刺身",
    "天ぷら":                       "天ぷら屋 天丼 天ぷら定食 天ぷら",
    "うどん・そば":                 "うどんそば屋 うどん そば 手打ちそば",
    "懐石料理":                     "懐石料理 料亭",
    "ハンバーグ":                   "ハンバーグ ハンバーグ専門店 炭焼きハンバーグ",
    "オムライス":                   "オムライス",
    "ステーキ":                     "ステーキ",
    "レトロ洋食":                   "昔ながら洋食屋 洋食屋 レトロ洋食屋 レトロ洋食",
    "焼肉食べ放題":                 "焼肉食べ放題",
    "高級焼肉":                     "高級焼肉 黒毛和牛",
    "焼肉単品":                     "大衆焼肉 焼肉定食 安安焼肉 牛角",
    "インド・ネパール":              "インドネパール料理 インドカレー インド料理 ネパール料理",
    "タイ料理":                     "タイ料理",
    "ベトナム料理":                 "ベトナム料理",
    "アジアンエスニック料理":       "アジアンエスタニック料理",
    "メキシコ料理":                 "メキシコ料理",
    "ブラジル料理":                 "ブラジル料理 シュラスコ",
    "ロシア料理":                   "ロシア料理",
    "その他各国":                   "各国料理 レストラン",
    "こってりラーメン":             "こってりラーメン 家系ラーメン 豚骨ラーメン",
    "あっさりラーメン":             "あっさりラーメン 塩ラーメン",
    "味噌ラーメン":                 "味噌ラーメン",
    "つけ麺・まぜそば":             "つけ麺 まぜそば",
    "フルーツ":                     "フルーツカフェ 果物カフェ アサイーボウル",
    "喫茶店":                       "喫茶店 レトロ喫茶",
    "流行りカフェ":                 "流行りカフェ 無機質カフェ 韓国カフェ 淡色カフェ レコードカフェ 推し活カフェ 映えスイーツ",
    // ── まったり L1 ────────────────────────────────────────────────────────
    "自然の中":                     "公園 自然 景勝地 海辺",
    "カフェ":                       "カフェ",
    "温泉スパ":                     "スーパー銭湯 日帰り温泉 健康ランド スパ",
    "絶景スポット":                 "展望台 景勝地 岬 パノラマ 夜景展望台 夜景スポット",
    // ── 自然 L2（Yahooは先頭3語のみ使用。実APIで公園が返る語を先頭に）──────────
    "波の音と海風":                 "海浜公園 海水浴場 ビーチ 海辺 岬",
    "森の中で深呼吸":               "森林公園 総合公園 植物園 渓谷 市民の森",
    "広い芝生でゴロゴロ":           "芝生公園 大型公園 植物園 ピクニック",
    "圧倒的な絶景":                 "展望台 景勝地 夜景スポット パノラマ 岬",
    "ブックカフェ・隠れカフェ":     "ブックカフェ 隠れ家カフェ",
    "動物カフェ":                   "猫カフェ 犬カフェ アニマルカフェ 動物ふれあいカフェ",
    "猫カフェ":                     "猫カフェ ネコカフェ",
    "犬カフェ":                     "犬カフェ ドッグカフェ",
    "小動物カフェ":                 "小動物カフェ うさぎカフェ ハリネズミカフェ フクロウカフェ",
    "アニマルカフェ":               "猫カフェ 犬カフェ アニマルカフェ 動物ふれあいカフェ",  // 旧キー（後方互換）
    "景色良いカフェ":               "オーシャンビューカフェ 海が見えるカフェ 高層階カフェ 夜景カフェ 絶景カフェ",
    "景色が良いカフェ":             "オーシャンビューカフェ 海が見えるカフェ 高層階カフェ 夜景カフェ",  // 旧キー（後方互換）
    "海辺カフェ":                   "海辺カフェ 海沿いカフェ シーサイドカフェ テラスカフェ 海",
    "森林カフェ":                   "森林カフェ 森のカフェ 自然カフェ 木々 緑",
    "高層ビルカフェ":               "高層カフェ タワーカフェ 展望カフェ 絶景カフェ スカイカフェ",
    "流行りのカフェ":               "流行りカフェ 無機質カフェ 韓国カフェ 淡色カフェ 推し活カフェ",  // 旧キー（後方互換）
    "絶品スイーツカフェ":           "スイーツカフェ パンケーキカフェ",
    "サウナ・岩盤浴":               "スーパー銭湯 日帰り温泉 サウナ ロウリュ 岩盤浴",
    "温泉施設全般":                 "スーパー銭湯 日帰り温泉 健康ランド スパ",
    // ── わいわい L1 ────────────────────────────────────────────────────────
    "体を動かして遊びたい":         "ボウリング アスレチック アミューズメントパーク",
    "歌って飲んで騒ぎたい":         "カラオケ ダーツバー",
    "非日常の体験で盛り上がりたい": "テーマパーク 謎解き VR",
    // ── 楽しみたい L1（現行 QuizFlow キー。気分選択.docx 準拠。1語ずつ個別検索）──
    "王道で遊ぶ":                   "テーマパーク カラオケ 遊園地",
    "アクティブに遊ぶ":             "ゲームセンター ボウリング 脱出ゲーム",
    "観て楽しむ":                   "水族館 動物園 映画館",
    "つくる・体験":                 "ものづくり体験 工場見学 陶芸",
    // ── スリル L1（1語ずつ個別検索）────────────────────────────────────────
    "絶叫":                         "遊園地 ジェットコースター 絶叫",
    "心霊":                         "お化け屋敷 心霊スポット",
    "高所":                         "展望台 タワー 吊り橋",
    "体験型":                       "VR 脱出ゲーム アスレチック",
    // ── ドライブ L1 ────────────────────────────────────────────────────────
    "海沿いを爽快に走りたい":       "海辺 海浜公園 海浜緑地 ビーチ 絶景ロード 岬",
    "綺麗な景色や夜景を見に行きたい": "展望台 景勝地 岬 パノラマ 夜景展望台 夜景スポット",
    "道の駅でご当地グルメ":         "道の駅 食べ歩き 食べ歩きスポット 市場",
    "郊外の大型施設に行きたい":     "大型ショッピングモール アウトレットモール 複合商業施設",
    // ── 集中 L1 ────────────────────────────────────────────────────────────
    "カフェで作業・勉強したい":     "カフェ スターバックス マクドナルド ワークカフェ 作業用カフェ",
    "静かな専用スペースで集中したい": "コワーキングスペース 図書館 自習室 大学",
    // ── 運動 L1 (v2 quiz keys) ────────────────────────────────────────────
    "がっつり運動":                 "ボルダリング 公営スポーツセンター トランポリンパーク ジム",
    "外でひろびろ":                 "大きな公園 フィールドアスレチック バスケットコート公園 アスレチック",
    "室内でのんびり":               "バッティングセンター 卓球アミューズメント ボウリング ビリヤード ダーツ",
    "ゲーム感覚で":                 "ボルダリング トランポリンパーク ラウンドワン ボウリング カラオケ ビリヤード",
    // ── 運動 L1 (旧キー・後方互換) ───────────────────────────────────────
    "がっつり汗を流してトレーニング": "フィットネス ジム プール スポーツセンター",
    "打って投げてストレス発散":     "バッティングセンター ゴルフ練習場",
    "遊び感覚でわいわい":           "ボウリング スポッチャ",
    "外で風を感じながらスポーツ":   "公園 屋外スポーツ施設",
    // ── ショッピング L1 ───────────────────────────────────────────────────
    "服・アクセサリー":             "セレクトショップ ファッションビル アパレル",
    "雑貨・インテリア":             "雑貨屋 インテリアショップ",
    "コスメ・美容":                 "コスメ 美容 香水",
    "大型ショッピングモール":       "大型ショッピングモール アウトレットモール 複合商業施設",
    "お土産・ギフト":               "お土産屋 ギフトショップ プレゼント",
    // ── ショッピング L2 ───────────────────────────────────────────────────
    "新品・現行":                   "セレクトショップ ファッションビル アパレル",
    "古着・ヴィンテージ":           "古着屋 ブランド古着 ヴィンテージ",
    // ── 旅行 L1 ────────────────────────────────────────────────────────────
    "パワースポット":               "神社 パワースポット 寺",
    "パワースポットへ":             "神社 パワースポット 寺",
    "別世界のテーマパーク":         "テーマパーク 遊園地",
    "知らない街をぶらぶら":         "商店街 中華街 観光名所",
    "息を呑む絶景":                 "展望台 景勝地 岬 パノラマ 夜景展望台 夜景スポット",
  };

  // Yahoo Local Search 業種コード（gc パラメータ）
  // ※ 全コード実Yahoo APIで検証済み(2026-06)。docの番号は大半が別ジャンルだったため
  //   キーワード逆引き((Property.Genre.Code))で正しいコードに全面置換した。
  //   検証で判明した正: 0110=居酒屋 0101=和食 0101012=寿司 0101034=海鮮 0101014=天ぷら
  //   0101001=懐石 0101004=料亭 0102=洋食 0102001=ステーキ・ハンバーグ 0102006=イタリアン
  //   0104001=中華 0108001=焼肉 0105001=韓国 0105003=タイ 0105004=ベトナム 0105006=インド
  //   0106001=ラーメン 0101029=お好み焼き 0101030=もんじゃ 0115001=カフェ 0115002=喫茶店
  const DIVE_YAHOO_GC: Record<string, string> = {
    // 居酒屋（旧0105001は実は韓国料理だった）
    "居酒屋":                       "0110",
    "個室居酒屋":                   "0110",
    "大衆酒場":                     "0110",
    // 和食（旧0102は実は洋食だった）
    "和食":                         "0101",
    "海鮮・お寿司":                 "0101034,0101012",
    "天ぷら":                       "0101014",
    // "うどん・そば": keyword検索のみに統一（0101017=そば,0101018=うどん は補助に使える）
    "うどん・そば":                 "0101017,0101018",
    "懐石料理":                     "0101001,0101004",
    // 洋食（旧0103は実はバイキングだった）
    "洋食":                         "0102",
    "ハンバーグ":                   "0102001",
    "オムライス":                   "0102",
    "ステーキ":                     "0102001",
    "レトロ洋食":                   "0102",
    // イタリアン・中華（旧: イタリアン=0104001は実は中華、中華=0108は実は焼肉）
    "イタリアン":                   "0102006",
    "中華料理":                     "0104001",
    // 焼肉・韓国（旧: 焼肉=0106001は実はラーメン、韓国=0107は実はカレー）
    "焼肉":                         "0108001",
    "焼肉食べ放題":                 "0108001",
    "高級焼肉":                     "0108001",
    "焼肉単品":                     "0108001",
    "韓国料理":                     "0105001",
    // アジア系（旧0109は実は鍋料理）
    "アジア系統":                   "0105003,0105004,0105006",
    "インド・ネパール":             "0105006",
    "タイ料理":                     "0105003",
    "ベトナム料理":                 "0105004",
    // ラーメン（旧0101003は実は割烹）
    "ラーメン":                     "0106001",
    "こってりラーメン":             "0106001",
    "あっさりラーメン":             "0106001",
    "味噌ラーメン":                 "0106001",
    "つけ麺・まぜそば":             "0106001",
    // お好み焼き（旧0102002は実はパスタピザ）
    "お好み焼き":                   "0101029,0101030",
    // カフェ・スイーツ（0115001=カフェ,0115002=喫茶店 は検証済みで正しい）
    "カフェスイーツ":               "0115001",
    "フルーツ":                     "0115001,0115002",
    "喫茶店":                       "0115001,0115002",
    "流行りカフェ":                 "0115001",
    "ブックカフェ・隠れカフェ":     "0115001",
    "動物カフェ":                   "0115001",
    "猫カフェ":                     "0115001",
    "犬カフェ":                     "0115001",
    "小動物カフェ":                 "0115001",
    "景色良いカフェ":               "0115001",
    "景色が良いカフェ":             "0115001",
    "海辺カフェ":                   "0115001",
    "森林カフェ":                   "0115001",
    "高層ビルカフェ":               "0115001",
    "絶品スイーツカフェ":           "0115001",
    // 自然・公園（※実API検証で確定。旧コード 0413=自動車販売 / 0413003=レッカー /
    //   0304=ホテル・旅館 は全く別ジャンルだったため正しい公園系コードに置換）
    //   0305007=公園, 0303004=植物園, 0303005=海水浴場・遊泳場
    "波の音と海風":                 "0303005",   // 海水浴場のみ(公園gcは一般公園を拾うため除外)
    "森の中で深呼吸":               "0305007,0303004",   // 公園・森林公園＋植物園
    "広い芝生でゴロゴロ":           "0305007,0303004",   // 大型公園＋植物園
    // 絶景・展望（展望台/景勝地/岬/タワーはYahooに業種コードが無い → keyword検索のみ）
    "圧倒的な絶景":                 "",
    "絶景スポット":                 "",
    "息を呑む絶景":                 "",
    // 自然 L1（こだわらない→L1経由。公園+海水浴場+植物園）
    "自然の中":                     "0305007,0303005,0303004",
    // 温泉・サウナ（旧0415003は実は墓石屋！ 正: 0418002=スーパー銭湯 0418004=温泉浴場 0418006=サウナ）
    "サウナ・岩盤浴":               "0418006,0418002,0418004",
    "温泉施設全般":                 "0418002,0418004",
    "温泉スパ":                     "0418002,0418004,0418006",
    "温泉":                         "0418002,0418004",
    // ドライブ（旧: 0413=自動車販売! 0304=ホテル! 302506=無効）
    "海沿いを爽快に走りたい":       "0303005",   // 海水浴場のみ
    "綺麗な景色や夜景を見に行きたい": "",                  // 展望台/夜景はgc無し→keywordのみ
    "道の駅でご当地グルメ":         "",                  // 道の駅はgc無し→keywordのみ
    "郊外の大型施設に行きたい":     "0204002,0204003,0204001",  // SC+アウトレット+百貨店
    // ショッピング（旧0203003,0203004は携帯ショップ/パソコン屋!）
    "大型ショッピングモール":       "0204002,0204003,0204001",
    "服・アクセサリー":             "0209001",           // 衣料品店
    "新品・現行":                   "0209001",
    "古着・ヴィンテージ":           "0209001",
    "雑貨・インテリア":             "0207002",           // 日用雑貨
    "コスメ・美容":                 "0202001",           // ドラッグストア（コスメ系補助）
    // 集中（旧0414002は結婚相談所! 図書館は専用gc無し→keywordのみ）
    "静かな専用スペースで集中したい": "",
    // 運動（旧0304=ホテル混入! 正: 0405003=スポーツクラブ 0301=スポーツ施設 0302=ゲーセン系）
    "がっつり運動":                 "0405003,0301",
    "外でひろびろ":                 "0301,0305007",
    "室内でのんびり":               "0302,0301007,0303012",
    "ゲーム感覚で":                 "0302003,0301007,0303012,0124002",
    // 旅行（旧: パワスポ=0301スポーツ施設! テーマパーク=0302001麻雀!）
    "パワースポット":               "0424002",           // 神社
    "パワースポットへ":             "0424002",
    "別世界のテーマパーク":         "0303001",           // 遊園地・テーマパーク
    "知らない街をぶらぶら":         "",                  // 商店街/食べ歩きはgc無し→keywordのみ
    "テーマパーク":                 "0303001",
    // わいわい L1
    "体を動かして遊びたい":         "0302003,0301007",
    "非日常の体験で盛り上がりたい": "0303001",
    // ── 楽しみたい L1（現行 QuizFlow キー）──────────────────────────────────────
    // ※ Yahoo業種コードは実APIで実地検証して確定（気分選択.docx の番号は別ジャンル
    //    ＝麻雀/ゴルフ練習場に当たっていたため、正しいコードへ置換）。
    // 定番遊び: 0303001(遊園地・テーマパーク) + 0124002(カラオケボックス)
    "王道で遊ぶ":                   "0303001,0124002",
    // ── スリル L1（絶叫=遊園地0303001。心霊/高所/体験型はgc無し＝keyword専用）──
    "絶叫":                         "0303001",
    "心霊":                         "",
    "高所":                         "",
    "体験型":                       "",
    // アクティブ: 0302003(ゲームセンター) + 0301007(ボウリング場) + 0303012(ビリヤード) + 0124002(カラオケ)
    "アクティブに遊ぶ":             "0302003,0301007,0303012,0124002",
    // 観て楽しむ: 0303003(水族館) + 0303002(動物園) + 0305001(映画館) + 0305002(美術館) + 0305003(博物館・科学館)
    "観て楽しむ":                   "0303003,0303002,0305001,0305002,0305003",
    // つくる・体験 は適切な業種コードが無い（脱出/陶芸体験はYahoo分類が薄い）→ キーワード検索のみ
  };

  // Yahooはスペース連結の複数語を AND 検索として扱い 0件になる（例「個室居酒屋 居酒屋完全個室」→0件）。
  // そのため単語ごとに分割し、1語ずつ個別検索して結果をマージする（要件②: 複数キーワードの順次検索）。
  const keywordRaw = DIVE_KW[deepDiveL1] ?? MOOD_KW[mood] ?? "観光スポット";
  const keywordList = keywordRaw.split(/[\s　]+/).map(s => s.trim().slice(0, 30)).filter(Boolean).slice(0, 3);
  if (keywordList.length === 0) keywordList.push("観光スポット");
  const yahooGc  = DIVE_YAHOO_GC[deepDiveL1] ?? "";

  try {
    // Yahoo の dist 上限は 20km。
    const yahooDistKm = Math.min(radiusKm, 20);
    // 遠端バイアス時は候補を多く取り、距離でソートしてから絞る
    const wantFarBias = minRadiusKm > 0;
    const fetchCount = wantFarBias ? 50 : Math.min(limit * 2, 30);
    // start は常に先頭(1)から取得する。
    //   以前は Math.floor(random*5)*limit でランダムページングしていたが、limit が大きいと
    //   start が Total件数(例:51)を超えてYahooが0件を返す不具合があった（Yahoo結果が出ない主因）。
    //   多様性は最終マージ側のシャッフル/スコアジッターで担保する。
    const randomStart = 0;

    // 1地点で Yahoo ローカルサーチを実行するヘルパー（dist は最大20km）
    const searchYahooAt = async (
      cLat: number, cLng: number, distKm: number, start1: number,
      gcCode: string | undefined, query: string,
    ): Promise<Record<string, unknown>[]> => {
      const params = new URLSearchParams({
        appid: apiKey,
        lat: String(cLat),
        lon: String(cLng),
        dist: String(Math.min(Math.max(distKm, 1), 20)),
        results: String(fetchCount),
        start: String(start1),  // Yahoo は 1-based
        // far bias 時は距離ソート（遠い順）。通常は score 順
        sort: wantFarBias ? "dist" : "score",
        output: "json",
        ...(query ? { query } : {}),
        ...(gcCode ? { gc: gcCode } : {}),
      });
      try {
        const r = await fetch(
          `https://map.yahooapis.jp/search/local/V1/localSearch?${params}`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!r.ok) return [];
        const d = await r.json().catch(() => null);
        return (d?.Feature ?? []) as Record<string, unknown>[];
      } catch { return []; }
    };

    // ── 検索中心点の構築 ─────────────────────────────────────────────────────
    // ① 中心点（現在地）。dist は最大20km。
    type YCenter = { lat: number; lng: number; distKm: number; start1: number };
    const centers: YCenter[] = [{ lat, lng, distKm: yahooDistKm, start1: randomStart + 1 }];

    // ② 遠距離設定（要求半径が Yahoo の20km上限を超える）場合、リング状に中心点を配置。
    //    各点で 20km 検索 → union することで 20km〜200km の遠方帯を取得する。
    //    Google のリングサンプリングと同じ思想（外縁寄りに配置し遠方を優先）。
    if (radiusKm > 20) {
      const ringDistKm = Math.max(minRadiusKm, radiusKm - 20, 20);
      // 遠いほどリング点を増やして角度方向のカバレッジを上げる（最大8点）
      const ringN = ringDistKm >= 140 ? 8 : ringDistKm >= 90 ? 6 : 5;
      const baseBearing = Math.random() * 360; // 毎回少し回転させて多様化
      for (let i = 0; i < ringN; i++) {
        const bearing = baseBearing + (360 / ringN) * i;
        const pt = destinationPoint(lat, lng, bearing, ringDistKm);
        centers.push({ lat: pt.lat, lng: pt.lng, distKm: 20, start1: 1 });
      }
    }

    // ── 全中心点を並列検索して union（施設名で重複排除）────────────────────────
    // yahooGc が "0203003,0203004" のように複数コードの場合は各gcコードで検索してマージ
    const yahooGcList = yahooGc
      ? yahooGc.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    // 検索タスクを構築。
    //   ・キーワード検索は gc を付けない。Yahoo は keyword と gc を併用すると AND 絞り込みで
    //     結果が激減する（例「個室居酒屋」単独=20件 / +gc0105001=1件）ため。
    //   ・業種コード(gc)は「キーワード無し」の別検索として実施（正確なカテゴリ指定・要件①）。
    //   ・複数キーワードは1語ずつ個別検索しマージ（要件②）。リング中心点は先頭1語のみ。
    const tasks: Promise<Record<string, unknown>[]>[] = [];
    centers.forEach((c, ci) => {
      const kws = ci === 0 ? keywordList : keywordList.slice(0, 1);
      // ① キーワード検索（gc無し）
      for (const kw of kws) {
        tasks.push(searchYahooAt(c.lat, c.lng, c.distKm, c.start1, undefined, kw));
      }
      // ② 業種コード検索（キーワード無し）— primary中心点のみ
      if (ci === 0) {
        for (const gcCode of yahooGcList) {
          tasks.push(searchYahooAt(c.lat, c.lng, c.distKm, c.start1, gcCode, ""));
        }
      }
    });
    const rawFeatures = await Promise.all(tasks);
    const seenNames = new Set<string>();
    const features: Record<string, unknown>[] = [];
    for (const arr of rawFeatures) {
      for (const f of arr) {
        const nm = String(f.Name ?? "");
        if (nm && !seenNames.has(nm)) { seenNames.add(nm); features.push(f); }
      }
    }
    if (features.length === 0) return [];

    // Yahoo Geometry.Coordinates ("経度,緯度") から距離(km)を計算
    const distOf = (f: Record<string, unknown>): number => {
      const geo = (f.Geometry ?? {}) as Record<string, unknown>;
      const coords = String(geo.Coordinates ?? "");
      const [lonStr, latStr] = coords.split(",");
      const flon = parseFloat(lonStr), flat = parseFloat(latStr);
      if (!isFinite(flon) || !isFinite(flat)) return -1;
      return haversineMeters(lat, lng, flat, flon) / 1000;
    };

    // 名前重複・除外を済ませた候補リスト（距離付き）
    // 食事系（お腹すいた）はホテル内レストランを許容するため宿泊施設の名前フィルタを緩める
    const isFoodMoodYahoo = mood === "お腹すいた";
    // リング検索は各点20kmを拾うため、要求半径を大きく超えるスポットが混ざりうる。
    // 要求半径の約1.15倍を上限に行き過ぎを除外（座標不明 distKm<0 は残す）。
    const maxDistKm = radiusKm > 0 ? radiusKm * 1.15 : Infinity;
    const candidates = features
      .filter(f => {
        const name = String(f.Name ?? "");
        if (!name || existingNames.includes(name)) return false;
        // 宿泊施設の除外（Yahooはtype情報がないため名前ベースのみ。食事系以外で適用）
        if (!isFoodMoodYahoo && isLodgingName(name)) return false;
        // 大型ショッピングモール検索時に商店街・市場系を除外
        if (isShoppingMallMismatch(name, deepDiveL1)) return false;
        // カテゴリ精度フィルタ: keyword検索のみだとカテゴリ外の店が混入する。
        // 特定カテゴリでは店名に関連語が含まれるものに絞る（Yahoo typeがないため名前で代替）
        // ※ 除外しすぎを避けるため、ポジティブワード1つでも含まれれば通過とする
        if (deepDiveL1 === "うどん・そば" || deepDiveL1 === "うどんそば") {
          const hasNoodle = /(うどん|そば|蕎麦|ラーメン|麺|noodle)/i.test(name);
          if (!hasNoodle) return false;
        }
        if (deepDiveL1 === "ラーメン" || deepDiveL1 === "こってりラーメン" || deepDiveL1 === "あっさりラーメン"
            || deepDiveL1 === "味噌ラーメン" || deepDiveL1 === "つけ麺・まぜそば") {
          const hasRamen = /(ラーメン|らーめん|拉麺|つけ麺|まぜそば|麺)/i.test(name);
          if (!hasRamen) return false;
        }
        return true;
      })
      .map(f => ({ f, distKm: distOf(f) }))
      .filter(c => c.distKm < 0 || c.distKm <= maxDistKm);

    // 遠端バイアス: minRadiusKm 以上を優先（Yahoo の 20km 上限内で最も遠い側）
    // far 群が空なら全候補を距離降順にして外側を優先
    let orderedFeatures: { f: Record<string, unknown>; distKm: number }[];
    if (wantFarBias) {
      // リングサンプリングにより遠方(minRadiusKm以上)も取得できるため、
      // far 判定にはクイズの遠端しきい値(minRadiusKm)をそのまま使う。
      const effMin = minRadiusKm;
      const far  = candidates.filter(c => c.distKm >= effMin);
      const near = candidates.filter(c => c.distKm < effMin && c.distKm >= 0);
      // far: 距離降順 + ランダムノイズ（遠いほど上位、毎回少し変わる）
      far.sort((a, b) => (b.distKm - a.distKm) + (Math.random() - 0.5) * 1);
      // near: 距離降順（外側優先）で補完
      near.sort((a, b) => b.distKm - a.distKm);
      orderedFeatures = far.length > 0 ? [...far, ...near] : near;
    } else {
      orderedFeatures = candidates;
    }

    const results: Array<Record<string, unknown>> = [];
    for (const { f, distKm } of orderedFeatures) {
      const name = String(f.Name ?? "");

      // Yahoo Geometry.Coordinates ("経度,緯度") から数値座標を取り出す（近接dedup・距離ソート用）
      const ygeo = (f.Geometry ?? {}) as Record<string, unknown>;
      const [yLonStr, yLatStr] = String(ygeo.Coordinates ?? "").split(",");
      const yLon = parseFloat(yLonStr), yLat = parseFloat(yLatStr);

      const prop = (f.Property ?? {}) as Record<string, unknown>;
      const address = String(prop.Address ?? "");
      const ratingObj = (prop.Rating ?? {}) as Record<string, unknown>;
      const rating = typeof ratingObj.Star === "number" ? ratingObj.Star : null;
      const ratingCount = typeof ratingObj.Count === "number" ? ratingObj.Count : null;
      const openTime = String(prop.OpenTime ?? "");
      const detail = (prop.Detail ?? {}) as Record<string, unknown>;
      const url = String(detail.Url ?? "");
      const mapUrl = url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + " " + address)}`;

      results.push({
        title: name,
        address,
        mapUrl,
        googleMapsUrl: mapUrl,
        rating,
        userRatingCount: ratingCount,
        photoUrl: undefined,
        photoUrls: [],
        openNow: undefined,
        openingHoursText: openTime || undefined,
        priceLevel: undefined,
        placeId: undefined,
        supabaseId: undefined,
        reason: "",
        features: [],
        distanceText: distKm >= 0 ? formatDistTextFromKm(distKm) : "",
        distanceKm: distKm >= 0 ? distKm : undefined,
        lat: isFinite(yLat) ? yLat : undefined,
        lng: isFinite(yLon) ? yLon : undefined,
        durationText: "",
        stationText: "",
        vibe: "",
        budget: "",
        time: "",
        isUserSpot: false,
        hasUserPhotos: false,
        userPhotoCount: 0,
        routesByMode: undefined,
        source: "yahoo",
      });

      if (results.length >= limit) break;
    }

    // ── Yahoo結果の写真をGoogle Placesで補完 ───────────────────────────────────
    // Yahooローカルサーチは写真を返さないため、施設名でGoogle Places Text Searchして
    // 写真を取得（photo-proxy URLで遅延解決 → 高速）。各施設1リクエストのみ・並列実行。
    if (googleApiKey && results.length > 0) {
      await Promise.all(results.map(async (r) => {
        try {
          const sres = await gfetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": googleApiKey,
              // 写真に加えて評価(rating/userRatingCount)もここで補完する
            // YahooはratingAPIを持たないため、GooglePlaces検索で評価を取得してYahoo結果に付与
            "X-Goog-FieldMask": "places.id,places.photos,places.currentOpeningHours,places.priceLevel",
            },
            body: JSON.stringify({
              textQuery: `${r.title} ${r.address ?? ""}`.trim(),
              locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 50000 } },
              maxResultCount: 1,
              languageCode: "ja",
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(6000),
          });
          if (!sres.ok) return;
          const sdata = await sres.json().catch(() => null);
          const place = sdata?.places?.[0];
          if (!place) return;
          // Yahoo結果にGoogle Place IDを紐付け（自動保存で重複排除＆詳細精度UP＝item4）
          if (typeof place.id === "string" && place.id) r.placeId = place.id;
          // 評価・営業状態・価格を補完（YahooはこれらのAPIを持たないため）
          if (typeof place.rating === "number") r.rating = place.rating;
          if (typeof place.userRatingCount === "number") r.userRatingCount = place.userRatingCount;
          if (typeof place.currentOpeningHours?.openNow === "boolean") r.openNow = place.currentOpeningHours.openNow;
          if (place.priceLevel) {
            const PMAP: Record<string, string> = { PRICE_LEVEL_FREE: "無料", PRICE_LEVEL_INEXPENSIVE: "￥", PRICE_LEVEL_MODERATE: "￥￥", PRICE_LEVEL_EXPENSIVE: "￥￥￥", PRICE_LEVEL_VERY_EXPENSIVE: "￥￥￥￥" };
            r.priceLevel = PMAP[place.priceLevel] ?? r.priceLevel;
          }
          const photoObjs = (place.photos ?? []) as Array<{ name: string }>;
          const photoNamesArr = photoObjs.slice(0, 10).map((ph: { name: string }) => ph.name).filter(Boolean);
          if (photoNamesArr.length === 0) return;
          const urls = photoNamesArr.map((n: string) => buildPhotoProxyUrl(n));
          r.photoUrls = urls;
          r.photoUrl = urls[0];
        } catch { /* 写真取得失敗は無視（プレースホルダー表示） */ }
      }));
    }

    console.log(`[recommend] Yahoo supplement "${keywordList.join("/")}" → ${results.length}件 (farBias=${wantFarBias}, minR=${minRadiusKm}km, centers=${centers.length}, pool=${features.length})`);
    setSupplementCache(yCacheKey, results);
    setSupplementDbCache(yCacheKey, results);  // after()で応答後に確実に保存（次回はYahoo/Google写真補完ともに0回）
    return results;
  } catch (e) {
    console.warn("[recommend] Yahoo supplement search failed:", e);
    return [];
  }
}

// ─── freeWord → OpenAI → Google Maps フロー ────────────────────────────────
// 自由ワードが設定されている場合、全クイズ回答を OpenAI に渡して
// 最適なスポット名を提案してもらい、Google Places で実在確認して返す
async function buildFreeWordRecommendations(
  answers: {
    mood?: string; companion?: string; budget?: number; freeWord?: string;
    distanceFeeling?: string; radiusKm?: number; originLat?: number; originLng?: number;
    area?: string; areaMode?: string;
    age?: string; gender?: string; aiChat?: boolean;
    dynamicQs?: { question: string; answer: string }[];
  },
  apiKey: string,
  openaiClient: import("openai").default,
  seenPlaces: string[],
  showUnseenOnly: boolean,
  pastFeedback: FeedbackItem[] = [],
): Promise<Array<Record<string, unknown>>> {
  try {
    const lat  = answers.originLat;
    const lng  = answers.originLng;
    const area = answers.area ?? "東京";
    const isManual = answers.areaMode === "manual";

    // エリア・半径の表現（プロンプトに使う）
    const radiusKm   = answers.radiusKm ?? (isManual ? 2 : 20);
    const areaDesc   = isManual
      ? `${area}（半径2km圏内のみ）`
      : lat
        ? `現在地から${answers.distanceFeeling ?? ""}（${radiusKm}km圏内）`
        : `${area}（${radiusKm}km圏内）`;

    // deepDive カテゴリを抽出
    const deepDiveL1 = (answers.dynamicQs ?? []).find(q => q.question === "深掘りカテゴリ")?.answer ?? "";
    const deepDiveL2 = (answers.dynamicQs ?? []).find(q => q.question === "深掘り詳細")?.answer ?? "";
    const deepDiveDesc = ([deepDiveL2, deepDiveL1].filter(v => v && v !== "こだわらない").join(" / ")) || (answers.mood ?? "");

    // 深掘り以外の dynamicQs（絶景タイプ等）
    const extraQs = (answers.dynamicQs ?? [])
      .filter(q => q.question !== "深掘りカテゴリ" && q.question !== "深掘り詳細")
      .map(q => `${q.question}: ${q.answer}`)
      .join("\n");

    const isAiChat = !!answers.aiChat;

    // ── 人数・気分の制約をプロンプトに反映 ─────────────────────────────────────
    // 「7人で話せて食べれる場所」等の人数指定を抽出し、カウンター主体の
    // ファストフード/牛丼チェーンが提案されるのを防ぐ（大人数=個室/宴会/座敷必須）。
    const partyMatch = (answers.freeWord ?? "").match(/([0-9０-９]{1,2})\s*(?:人|名)/);
    const partySize = partyMatch ? parseInt(partyMatch[1].replace(/[０-９]/g, c => String("０１２３４５６７８９".indexOf(c))), 10) : 0;
    const wantCount = isAiChat ? 15 : (partySize >= 4 ? 14 : 10);  // 人数指定時はフィルタ前提で多めに要求
    const partyBlock = partySize >= 4
      ? `\n【人数条件（最重要・厳守）】${partySize}人で利用する。${partySize}人が同じテーブル/個室で座って会話できる店のみ提案すること。\n- 適: 個室居酒屋・宴会対応の居酒屋/レストラン・座敷のある店・大テーブルのダイニング・食べ放題/コース対応店\n- 禁止: カウンター主体の店、牛丼/ファストフードチェーン（すき家・松屋・吉野家・マクドナルド・ケンタッキー等）、ラーメン店、立ち食い\n`
      : "";
    // 気分=お腹すいた（または食事系深掘り）は飲食店のみ
    const isFoodMoodFw = (answers.mood ?? "") === "お腹すいた";
    const foodOnlyBlock = isFoodMoodFw
      ? `\n【カテゴリ条件（厳守）】食事が目的。レストラン・居酒屋・食堂など「食事ができる飲食店」のみ。公園・観光地・商業施設・娯楽施設は1件も含めないこと。\n`
      : "";
    // 年齢・性別（AI相談時はプロンプトに反映して提案精度を上げる）
    const profileLine = (answers.age || answers.gender)
      ? `- ユーザー属性: ${[answers.age, answers.gender].filter(Boolean).join("・")}`
      : "";

    // 検索の地理的中心（クエリに必ず付けて Google 解決精度を上げる）
    const geoAnchor = (answers.area && answers.area !== "現在地" && answers.area !== "現在地周辺")
      ? answers.area
      : (area || "現在地周辺");

    let systemContent: string;
    let prompt: string;

    // ── ② RAG: Supabaseの近隣・承認済みスポット（みんなの穴場）を参考資料として取得 ──
    //   AI相談・通常freeWordの両方で使用（穴場投稿が自由ワード検索でも候補に入るように）。
    //   タグを併記してLLMが「要望に合う穴場」を選別できるようにする。
    let ragBlock = "";
    try {
      if (supabase && typeof answers.originLat === "number" && typeof answers.originLng === "number") {
        const { data: sgs } = await supabase
          .from("suggestions")
          .select("spot_name, google_place_name, address, auto_tags, lat, lng, description")
          .eq("status", "approved")
          .not("lat", "is", null)
          .limit(200);
        const oLat = answers.originLat, oLng = answers.originLng;
        const near = (sgs ?? [])
          .map((g) => {
            const dkm = (typeof g.lat === "number" && typeof g.lng === "number")
              ? haversineMeters(oLat, oLng, g.lat, g.lng) / 1000 : 9999;
            return { g, dkm };
          })
          .filter((x) => x.dkm <= Math.max(radiusKm, 15))
          .sort((a, b) => a.dkm - b.dkm)
          .slice(0, 14);
        if (near.length > 0) {
          ragBlock = `\n# 参考：近隣の実在スポット（MoodGoユーザー投稿の穴場データ。タグ付き）\n`
            + `※ 要望にタグや説明が合うものは優先的に含めること（穴場として価値が高い）。合わないものは無理に入れない。これ「だけ」に限定せず他の実在店も自由に加えること。\n`
            + near.map((x) => {
                const tg = (x.g.auto_tags ?? []).slice(0, 4).join(" ");
                const desc = (x.g.description ?? "").replace(/\s+/g, " ").slice(0, 30);
                return `- ${x.g.google_place_name ?? x.g.spot_name}（${(x.g.address ?? "").replace(/^日本[、,]\s*/, "").slice(0, 24)} / 約${x.dkm.toFixed(1)}km${tg ? " / " + tg : ""}${desc ? " / " + desc : ""}）`;
              }).join("\n")
            + "\n";
        }
      }
    } catch { /* RAG失敗は無視（通常提案にフォールバック）*/ }

    if (isAiChat) {

      // ── ③ フィードバック: 過去に高評価/低評価だった場所を反映 ──
      const liked = pastFeedback.filter((f) => (f.rating ?? 0) >= 4 && f.visitedPlace).map((f) => f.visitedPlace).slice(0, 5);
      const disliked = pastFeedback.filter((f) => (f.rating ?? 0) > 0 && (f.rating ?? 0) <= 2 && f.visitedPlace).map((f) => f.visitedPlace).slice(0, 5);
      const fbBlock = (liked.length || disliked.length)
        ? `\n# このユーザーの好み（過去の評価から）\n`
          + (liked.length ? `- 気に入った傾向: ${liked.join("、")}（似た雰囲気を歓迎）\n` : "")
          + (disliked.length ? `- 避けたい傾向: ${disliked.join("、")}（似たものは避ける）\n` : "")
        : "";

      // ── AI相談専用プロンプト（自由入力から的確に提案）──────────────────────────
      systemContent =
        "あなたは日本中のスポットに精通したプロのお出かけコンシェルジュです。" +
        "ユーザーが自由に書いた要望文を深く読み取り、その意図に的確に合致する『実在し、現在も営業している』具体的なスポットだけを提案します。" +
        "架空の店・閉店した店・チェーン名だけ・駅名や地名だけの回答は絶対に禁止です。" +
        "必ず指定エリアの範囲内のスポットのみを選びます。" +
        "提供される『参考スポット』は優先的に活用しますが、それだけに限定せず条件に合う他の実在店も加えます。";

      prompt = `# ユーザーの要望（自由入力）
「${answers.freeWord}」

# 検索エリア（厳守）
${areaDesc}
- この範囲（${geoAnchor} 周辺）に実在するスポットのみ。範囲外は絶対に含めない。
${typeof lat === "number" && typeof lng === "number" ? `- 現在地座標: ${lat.toFixed(3)},${lng.toFixed(3)}（この座標から${radiusKm}km圏内のみ）` : ""}

${partyBlock}${foodOnlyBlock}# ユーザー情報
${profileLine ? profileLine + "\n" : ""}- 予算: ${answers.budget ? `〜¥${answers.budget.toLocaleString()}` : "指定なし"}
${answers.companion ? `- 同行者: ${answers.companion}\n` : ""}${ragBlock}${fbBlock}
# 良い回答例（Few-shot）
- 要望「雨でも一日中遊べる屋内」→ 良い: 水族館・屋内型ミュージアム・大型ショッピングモール / 悪い: 屋外公園・展望台
- 要望「一人で静かに作業できるカフェ」→ 良い: 電源/Wi-Fiのある落ち着いたカフェ / 悪い: 騒がしい居酒屋・チェーンの満席店
- 要望「映えるスイーツ」→ 良い: 写真映えするパフェ/チョコ専門店 / 悪い: ファミレス

# 手順（必ず守る）
1. まず要望文「${answers.freeWord}」を分解し、(a)ジャンル・カテゴリ (b)雰囲気/シーン (c)条件(価格帯・人数・時間帯など) を読み取る。
2. その全てを満たす ${geoAnchor} 周辺の実在スポットを${wantCount}件、具体的な正式店名で挙げる（参考スポットを優先しつつ不足分は補う）。
3. なるべく多様に（同じチェーンの連発を避け、特徴の異なる店をバランス良く）。
4. 要望と無関係なスポット・株式会社/有限会社/工場などは1件も入れない。

# 各スポットの出力ルール
- name: 検索でヒットする正式な店舗・施設名（支店名まで。例「スターバックス 横浜マリンタワー店」）
- query: Google Mapsで一意に特定できる検索語（必ず「${geoAnchor} 」＋正式店名 の形）
- reason: 「要望のどこに、なぜ合うのか」を具体的に40〜70字で。ユーザー属性や要望のキーワードに触れる。アプリ名や「AI相談」等のメタ表現は書かない。実際の特徴（料理・雰囲気・立地・価格など）を述べる。

# 出力（このJSONのみ。前後に文章を付けない）
{"places": [{"name": "正式店名", "query": "${geoAnchor} 正式店名", "reason": "要望に合う具体的な理由(40〜70字)"}], "interpretation": {"partySize": 人数(不明なら0), "genres": ["読み取ったジャンル"], "vibes": ["雰囲気・条件"]}}`;
    } else {
      // ── 通常 freeWord プロンプト（クイズ経由）────────────────────────────────
      systemContent = "あなたはお出かけプランナーAIです。ユーザーの条件に厳密に合致したリアルな施設のみを提案してください。条件に合わないスポットは絶対に含めないこと。";
      prompt = `あなたはお出かけプランナーAIです。
ユーザーの希望に厳密に合致する実在スポットを${wantCount}件提案してください。

【最重要条件（必ず全て満たすこと）】
1. エリア: ${areaDesc}
2. カテゴリ: ${deepDiveDesc}
3. 希望キーワード（最優先）: ${answers.freeWord}
${partyBlock}${foodOnlyBlock}
【良い回答例】
- 「7人で話せて食べれる場所」→ 良い: 個室居酒屋・宴会コースのある和食店・大テーブルのダイニング / 悪い: すき家・カウンターのラーメン店・公園
- 「子連れでゆっくりランチ」→ 良い: 座敷/キッズスペースのあるレストラン / 悪い: バー・立ち食い

【参考条件】
${profileLine ? profileLine + "\n" : ""}- 気分: ${answers.mood ?? "未設定"}
- 同行者: ${answers.companion ?? "未設定"}
- 予算: ${answers.budget ? `〜¥${answers.budget.toLocaleString()}` : "未設定"}
${extraQs ? extraQs : ""}
${ragBlock}

【ルール】
- 「${answers.freeWord}」の条件に合う施設のみ（関係ないスポットは除外）
- ${area} エリアに今も実在する具体的な店舗・施設名（チェーン店名だけでなく支店名まで）
- 駅名・地名・エリア名だけのNG。実際の店名を出すこと
- 予算内に収まるスポット優先

出力は必ず以下のJSON形式のみ（説明文は不要）:
{"places": [{"name": "店舗名・施設名", "query": "${area} 店舗名・施設名"}], "interpretation": {"partySize": 人数(不明なら0), "genres": ["読み取ったジャンル"], "vibes": ["雰囲気・条件"]}}`;
    }

    const resp = await openaiClient.chat.completions.create({
      model: isAiChat ? "gpt-4o" : "gpt-4o-mini",
      temperature: isAiChat ? 0.5 : 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: prompt },
      ],
      max_tokens: isAiChat ? 2200 : 800,
    });

    const text = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as { places?: Array<{ name: string; query: string; reason?: string }>; interpretation?: unknown };
    const suggestions = parsed.places ?? [];
    // ③ 蒸留: LLMの解釈を蓄積（頻出パターンは freeword_rules へ昇格して以後LLM不要に）
    if (parsed.interpretation) scheduleInterpretationLog(answers.freeWord ?? "", parsed.interpretation);
    if (suggestions.length === 0) return [];
    // スポット名→AI理由のマップ
    const aiReasonMap = new Map<string, string>();
    for (const sg of suggestions) {
      if (sg.reason) aiReasonMap.set(sg.name, String(sg.reason).trim());
    }

    const PRICE_MAP: Record<string, string> = {
      PRICE_LEVEL_FREE: "無料", PRICE_LEVEL_INEXPENSIVE: "￥",
      PRICE_LEVEL_MODERATE: "￥￥", PRICE_LEVEL_EXPENSIVE: "￥￥￥",
      PRICE_LEVEL_VERY_EXPENSIVE: "￥￥￥￥",
    };
    const proxyBase = process.env.NEXT_PUBLIC_BASE_URL ?? "https://moodgo-main.vercel.app";

    const results = await Promise.all(
      suggestions.slice(0, 15).map(async (p) => {
        try {
          const res = await gfetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              // photos を最大10枚・location を追加取得
              "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.photos,places.googleMapsUri,places.regularOpeningHours,places.priceLevel,places.location,places.businessStatus,places.primaryType,places.types",
            },
            body: JSON.stringify({
              textQuery: p.query || `${area} ${p.name}`,
              languageCode: "ja",
              regionCode: "JP",
              maxResultCount: 1,
              ...(lat && lng ? {
                locationBias: {
                  circle: {
                    center: { latitude: lat, longitude: lng },
                    radius: Math.min(radiusKm * 1000, 50000),
                  },
                },
              } : {}),
            }),
            cache: "no-store",
          });
          if (!res.ok) return null;
          const data = await res.json();
          const place = data.places?.[0];
          if (!place) return null;
          // 閉店済みは除外（LLMが古い記憶で閉店店を出すケースの防止）
          if (place.businessStatus === "CLOSED_PERMANENTLY") return null;

          const name = (place.displayName?.text as string | undefined) ?? p.name;
          if (showUnseenOnly && seenPlaces.includes(name)) return null;

          // ── 複数写真を取得（最大5枚）────────────────────────────────────────
          const photos = (place.photos ?? []) as Array<{ name: string }>;
          const photoUrls = photos.slice(0, 5)
            .map((ph: { name: string }) =>
              ph.name
                ? `${proxyBase}/api/photo-proxy?url=${encodeURIComponent(`https://places.googleapis.com/v1/${ph.name}/media`)}`
                : null
            )
            .filter((u): u is string => u !== null);

          // ── 最寄り駅（座標がある場合のみ）────────────────────────────────────
          const placeLat = (place.location as { latitude?: number } | undefined)?.latitude;
          const placeLng = (place.location as { longitude?: number } | undefined)?.longitude;
          let stationText = "";
          if (typeof placeLat === "number" && typeof placeLng === "number") {
            stationText = await findNearestStation(placeLat, placeLng, apiKey).catch(() => "");
          }

          // ── 現在地からの距離テキスト ─────────────────────────────────────────
          let distanceText = "";
          if (lat && lng && typeof placeLat === "number" && typeof placeLng === "number") {
            const distM = haversineMeters(lat, lng, placeLat, placeLng);
            const distKm = distM / 1000;
            const mins = Math.round((distKm / 40) * 60);
            distanceText = mins < 60
              ? `車で約${mins}分 / ${distKm.toFixed(1)}km`
              : `車で約${Math.floor(mins / 60)}時間${mins % 60 > 0 ? (mins % 60) + "分" : ""} / ${distKm.toFixed(1)}km`;
          }

          const hours = place.regularOpeningHours as { weekdayDescriptions?: string[] } | undefined;
          return {
            title: name,
            address: (place.formattedAddress as string | undefined) ?? "",
            photoUrl: photoUrls[0] ?? "",
            photoUrls,
            rating: typeof place.rating === "number" ? place.rating : null,
            userRatingCount: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
            openNow: undefined,
            openingHoursText: hours?.weekdayDescriptions?.join("\n") ?? undefined,
            mapUrl: (place.googleMapsUri as string | undefined) ?? "",
            googleMapsUrl: (place.googleMapsUri as string | undefined) ?? "",
            reason: `「${answers.freeWord}」のイメージにぴったりなスポットです`,
            // AI相談時: スポットごとの「なぜおすすめか」を付与（結果画面で表示）
            aiReason: isAiChat ? (aiReasonMap.get(p.name) ?? aiReasonMap.get(name) ?? "") : undefined,
            features: [],
            distanceText,
            distanceKm: (lat && lng && typeof placeLat === "number" && typeof placeLng === "number")
              ? haversineMeters(lat, lng, placeLat, placeLng) / 1000
              : undefined,
            lat: typeof placeLat === "number" ? placeLat : undefined,
            lng: typeof placeLng === "number" ? placeLng : undefined,
            durationText: "",
            stationText,
            vibe: "",
            budget: "",
            time: "",
            priceLevel: PRICE_MAP[(place.priceLevel as string) ?? ""] ?? undefined,
            placeId: (place.id as string | undefined) ?? undefined,
            supabaseId: undefined,
            isUserSpot: false,
            hasUserPhotos: false,
            userPhotoCount: 0,
            routesByMode: undefined,
            // 解決後の飲食検証用（レスポンス前に削除はしない＝無害な追加フィールド）
            primaryType: (place.primaryType as string | undefined) ?? "",
            gTypes: (place.types as string[] | undefined) ?? [],
          };
        } catch {
          return null;
        }
      })
    );
    // ── 解決後の検証: 距離（半径厳守）＋重複排除 ───────────────────────────
    //   LLMがエリア外の店を出す/同一店が複数名で重複するケースを排除する。
    //   locationBiasは「優先」であって「制限」ではないため、ここで厳密に検証する。
    const maxKm = radiusKm * 1.25;
    const seenKeys = new Set<string>();
    // 大人数時に不適切なカウンター主体チェーン（LLMが指示を無視した場合の保険）
    const FASTFOOD_RE = /すき家|松屋|吉野家|なか卯|マクドナルド|ケンタッキー|モスバーガー|ロッテリア|バーガーキング|富士そば|ゆで太郎|小諸そば|立ち食い|日高屋|幸楽苑|ラーメン|らーめん|つけ麺|まぜそば/;
    // 飲食店として誤通過しやすい非飲食施設（コワーキング等）
    const NONFOOD_NAME_RE_FW = /コワーキング|貸会議|レンタルスペース|スタジオ|サロン|事務所|オフィス/;
    const validated = (results.filter((r) => r !== null) as Record<string, unknown>[])
      .filter((r) => {
        const dkm = r.distanceKm as number | undefined;
        if (typeof dkm === "number" && dkm > maxKm) return false;   // エリア外（幻覚）を除外
        const key = (r.placeId as string | undefined) || String(r.title ?? "").toLowerCase();
        if (!key || seenKeys.has(key)) return false;                 // 重複除外
        seenKeys.add(key);
        const name = String(r.title ?? "");
        // お腹すいた: 飲食店のみ（Google型 or 飲食店名で判定。非飲食=公園/観光地等を除外）
        if (isFoodMoodFw) {
          const pt = String(r.primaryType ?? "");
          const types = (r.gTypes as string[] | undefined) ?? [];
          const isFoodPlace = FOOD_FAMILY_PRIMARY_TYPES.has(pt)
            || types.some(t => FOOD_FAMILY_PRIMARY_TYPES.has(t))
            || isRestaurantName(name);
          if (!isFoodPlace) return false;
          if (NONFOOD_NAME_RE_FW.test(name)) return false;  // コワーキング等の誤通過防止
        }
        // 大人数(4人以上): カウンター主体のチェーンを除外
        if (partySize >= 4 && FASTFOOD_RE.test(name)) return false;
        return true;
      });
    return validated;
  } catch (e) {
    console.error("[recommend] freeWord OpenAI flow failed:", e);
    return [];
  }
}

async function generateSupabaseReasons(
  spots: import("@/types/onsen").PlaceResponse[],
  answers: { mood?: string; companion?: string; transport?: string | string[]; time?: string; budget?: number; freeWord?: string; dynamicQs?: { question: string; answer: string }[] },
  mustTags: string[],
  niceTags: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!process.env.OPENAI_API_KEY || !openai || spots.length === 0) return result;
  const ai = openai;
  try {
    const moodDesc      = answers.mood ?? "";
    const companionDesc = answers.companion ?? "";
    const transportDesc = Array.isArray(answers.transport) ? answers.transport.join("・") : (answers.transport ?? "");
    const timeDesc      = answers.time ? `滞在時間「${answers.time}」` : "";
    const budgetDesc    = answers.budget !== undefined ? `予算「〜¥${answers.budget.toLocaleString()}」` : "";
    const freeWordDesc  = answers.freeWord ? `希望「${answers.freeWord}」` : "";
    const extraContext  = (answers.dynamicQs ?? []).map((q: { question: string; answer: string }) => `${q.question}→${q.answer}`).join("、");
    const contextParts  = [timeDesc, budgetDesc, freeWordDesc, extraContext].filter(Boolean).join("、");
    // 領域6: 店ごとに理由を差別化するため、LLMへ店固有情報を渡す（料理ジャンル/分類/全タグ/中立説明）。
    //   これが無いと寿司もそばも同じ抽象文（「恋人と特別なひととき」等）になる。
    const spotList = spots.map((s, i) => {
      const genre = coarseFoodGenreOf(s.name ?? "");           // 寿司海鮮/ラーメン等。非該当は「その他」
      const allTags = (s.tags ?? []).filter(t => typeof t === "string" && t.trim()).slice(0, 8);
      const desc = String(s.description ?? "").trim();
      const isStubDesc = !desc || desc === `${s.name}のスポット情報`;  // spatial-searchの定型フォールバックは無視
      const facts = [
        genre !== "その他" ? `ジャンル:${genre}` : null,
        (s.category && s.category.trim()) ? `分類:${s.category.trim()}` : null,
        allTags.length ? `タグ:${allTags.join(" ")}` : null,
        !isStubDesc ? `特徴:${desc.slice(0, 50)}` : null,
      ].filter(Boolean).join(" / ");
      return `${i + 1}. ${s.name}（${facts || "情報なし"}）`;
    }).join("\n");

    const res = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `あなたは旅行プランナーです。ユーザーの気分・状況に合わせて各スポットの推薦理由を1文（30〜50字）で書いてください。
ユーザー: 気分「${moodDesc}」、同伴「${companionDesc}」、交通「${transportDesc}」${contextParts ? "、" + contextParts : ""}
【最重要】各店の括弧内の固有情報（ジャンル・分類・タグ・特徴）を必ず理由文に反映し、店ごとに内容を変えること。
・料理ジャンルがあれば必ず触れる（例: 寿司なら「新鮮なネタ」、そばなら「手打ちそば」、ラーメンなら「こだわりの一杯」のように具体的に）。
・「特別なひととき」「特別な時間」のような全店共通の抽象表現は禁止。同じ言い回しを2店以上で使い回さないこと。
・同伴者の観点（恋人=雰囲気、友達=賑わい、一人=リフレッシュ）は味付け程度に留め、主役は店の固有情報にすること。
JSON: {"reasons": {"スポット名": "推薦理由文", ...}}`,
        },
        { role: "user", content: spotList },
      ],
      max_tokens: 700,   // 【性能】表示15件分の短い理由に絞り生成時間を約半減（旧1500=候補30件分で遅かった）
    }, { signal: AbortSignal.timeout(6000) });  // 6秒で打ち切り（応答ブロック防止）。理由なしでもカードは表示可
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


// ─── OpenAIで説明文を蓄積（item3+OpenAI賢く: 説明文生成）──────────────────────────
// description が空のスポットに「場所そのものを表す中立的な一言」を生成して
// places.description へ永続化する。生成は応答後(after)に1回のバッチ呼び出しで行うので
// 検索レスポンスの遅延はゼロ。気分非依存＝全検索で再利用でき、次回以降は生成不要。
// 推薦理由(generateSupabaseReasons=気分依存・非永続)とは別物。コストはGoogleの約1/100。
function scheduleDescriptionGeneration(
  spots: { name?: string; title?: string; tags?: string[]; description?: string | null; id?: string; address?: string }[],
): void {
  if (!supabase || !openai) return;
  const sb = supabase;
  const ai = openai;
  // 「説明が無い」判定: 空 or 読み取り時フォールバック「{店名}のスポット情報」
  //   （spatial-search.ts が NULL の description にこの定型文を当てるため、
  //    DB上は NULL でも r.description は定型文になっている＝生成対象として拾う）。
  const needsDesc = (name: string, desc: string | null | undefined): boolean => {
    const d = String(desc ?? "").trim();
    return d.length === 0 || d === `${name}のスポット情報`;
  };
  // 説明が無い場所だけ対象。重複名を除き最大10件（トークン/コスト上限）。
  const targets = spots
    .map(s => ({ name: String(s.name ?? s.title ?? "").trim(), tags: s.tags ?? [], desc: s.description, id: s.id, address: s.address }))
    .filter(s => s.name && needsDesc(s.name, s.desc));
  const dedup = Array.from(new Map(targets.map(t => [t.name, t])).values()).slice(0, 20);  // 1検索あたり上限(after実行=遅延ゼロ)。バックログは /api/admin/describe-all で一括消化
  // 生成された名前→書き戻し先（同名チェーン混線を防ぐため id/住所で絞る）
  const matchByName = new Map(dedup.map(t => [t.name, toPlaceMatch(t.name, t.id, t.address)]));
  if (dedup.length === 0) return;

  const run = async () => {
    try {
      const list = dedup.map((s, i) => `${i + 1}. ${s.name}（${(s.tags ?? []).slice(0, 6).join("・")}）`).join("\n");
      const res = await ai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `各スポットについて、その場所そのものを説明する中立的な一文（25〜45字）を書いてください。
気分・同伴者・あなたの推薦には言及せず、その場所の特徴・雰囲気・名物だけを淡々と。
事実が不明な点はタグから自然に推測してよいが、誇張や断定的な営業文句は避けること。
JSON: {"descriptions": {"スポット名": "説明文", ...}}`,
          },
          { role: "user", content: list },
        ],
        max_tokens: 600,
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
      for (const [name, desc] of Object.entries(parsed.descriptions ?? {})) {
        // LLMが文字列以外（ネストしたオブジェクト等）を返した場合はスキップ。
        //   String()強制だと "[object Object]" を description にNULLのみ補完で
        //   恒久書き込みしてしまい（以後needsDesc=falseで再生成もされず）永続ゴミになる。
        if (typeof desc !== "string") continue;
        const text = desc.trim().slice(0, 120);
        // NULLの場所だけ補完（既存の手書き説明は壊さない）。id/住所で1行に絞る
        const m = matchByName.get(name) ?? { name };
        if (text) await selectPlace(sb.from("places").update({ description: text }).is("description", null), m).then(() => {}, () => {});
      }
    } catch (e) { await logServerError("describe_gen", e); }
  };
  try { after(async () => { await run(); }); } catch { void run(); }
}

// ── ② 気分に合わせた「おすすめ一言」(mood blurb) ──────────────────────────────
//   その人の気分(moodGroup)に刺さる推薦一文を gpt-4o-mini で生成し、spot×気分でキャッシュ(api_cache・30日)。
//   例: まったり(relax)×マザー牧場 → 「大自然の中でゆっくりできる、マザー牧場がおすすめ！」。
//   表示は attachAvailability がキャッシュから reason に当てる（無ければ pickReason のまま）。
//   応答後に after() で非同期生成＝検索レスポンスは遅延ゼロ、次回同気分の検索から無料で反映。
const MOOD_BLURB_PHRASE: Record<string, string> = {
  food: "美味しいものを食べたい", relax: "ゆっくりまったり癒やされたい", nature: "自然を感じたい",
  play: "わいわい楽しみたい", drive: "ドライブしたい", focus: "集中して作業・勉強したい",
  sport: "体を動かしたい", travel: "旅行・観光したい", shopping: "買い物を楽しみたい",
};
function moodBlurbKey(moodGroupStr: string, title: string): string {
  return `mblurb:${moodGroupStr}:${title.slice(0, 80)}`;
}
function scheduleMoodBlurbGeneration(
  recs: { title?: string; tags?: string[]; features?: string[] }[],
  moodGroupStr: string,
): void {
  if (!supabase || !openai || !moodGroupStr) return;
  const ai = openai;
  const phrase = MOOD_BLURB_PHRASE[moodGroupStr];
  if (!phrase) return;   // 未知の気分（AI相談等）は生成しない
  const seen = new Set<string>();
  const targets: { name: string; tags: string[] }[] = [];
  for (const r of recs) {
    const name = String(r.title ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const tags = (Array.isArray(r.features) && r.features.length ? r.features : (Array.isArray(r.tags) ? r.tags : []))
      .map((x) => String(x).replace(/^#/, "")).filter(Boolean);
    targets.push({ name, tags });
  }
  const dedup = targets.slice(0, 12);   // 1検索あたり上限（after実行＝遅延ゼロ）
  if (dedup.length === 0) return;
  const run = async () => {
    try {
      // 既にキャッシュ済みは生成しない（コスト削減）
      const have = await ltCacheGetMany(dedup.map((t) => moodBlurbKey(moodGroupStr, t.name)));
      const todo = dedup.filter((t) => !((have.get(moodBlurbKey(moodGroupStr, t.name)) as { blurb?: string } | undefined)?.blurb));
      if (todo.length === 0) return;
      const list = todo.map((s, i) => `${i + 1}. ${s.name}（${s.tags.slice(0, 6).join("・")}）`).join("\n");
      const res = await ai.chat.completions.create({
        model: "gpt-4o-mini", temperature: 0.6, response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `ユーザーは今「${phrase}」という気分で行き先を探しています。
各スポットについて、その気分にぴったり合う「おすすめの一言」(20〜45字)を書いてください。
・必ずスポット名を入れ、「〜がおすすめ！」のように前向きに誘う。
・その気分（${phrase}）にどう応えてくれるかを具体的に。例:「大自然の中でゆっくりできる、マザー牧場がおすすめ！」
・タグから雰囲気を自然に推測してよいが、誇張や嘘は避ける。断定的な営業文句にしない。
JSON: {"blurbs": {"スポット名": "一言", ...}}`,
          },
          { role: "user", content: list },
        ],
        max_tokens: 700,
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
      for (const [name, blurb] of Object.entries(parsed.blurbs ?? {})) {
        if (typeof blurb !== "string") continue;
        const text = blurb.trim().slice(0, 60);
        if (text) await ltCachePut(moodBlurbKey(moodGroupStr, name), { blurb: text });
      }
    } catch (e) { await logServerError("mood_blurb_gen", e); }
  };
  try { after(async () => { await run(); }); } catch { void run(); }
}

// ── 全経路共通: 承認済み&再利用OKの利用者投稿写真をカードのメイン画像にする ──────────
//   place_id(UUID) と place_name の両方で照合（Moodログ投稿で place_id がNULLでも名前で拾う）。
//   利用者写真が3枚以上なら Google等は一切使わず利用者写真のみ（ユーザー要望）。3枚未満は先頭に+既存で補完。
//   ⚠ supabaseRecs だけでなく Google/Yahoo 補完で混ざったカードにも効かせるため、最終結果に対して呼ぶ。
type UserPhotoRec = { title?: string; supabaseId?: string; photoUrls?: string[]; photoUrl?: string; hasUserPhotos?: boolean; userPhotoCount?: number };
async function applyUserPhotos(recs: UserPhotoRec[]): Promise<void> {
  if (!supabase || !recs?.length) return;
  try {
    const sb = supabase;
    const ids = [...new Set(recs.map(r => r.supabaseId).filter((x): x is string => !!x))];
    const names = [...new Set(recs.map(r => r.title).filter((x): x is string => !!x))];
    const SEL = "place_id, place_name, image_url, is_primary, score, created_at";
    const rows: Array<Record<string, unknown>> = [];
    if (ids.length > 0) {
      const { data } = await sb.from("spot_photos").select(SEL)
        .eq("moderation_status", "approved").eq("can_use_as_spot_photo", true).in("place_id", ids)
        .order("is_primary", { ascending: false }).order("score", { ascending: false }).order("created_at", { ascending: false });
      if (data) rows.push(...(data as Array<Record<string, unknown>>));
    }
    if (names.length > 0) {
      const { data } = await sb.from("spot_photos").select(SEL)
        .eq("moderation_status", "approved").eq("can_use_as_spot_photo", true).in("place_name", names)
        .order("is_primary", { ascending: false }).order("score", { ascending: false }).order("created_at", { ascending: false });
      if (data) rows.push(...(data as Array<Record<string, unknown>>));
    }
    if (rows.length === 0) return;
    const byId = new Map<string, string[]>();
    const byName = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, k: string, u: string) => { const a = m.get(k) ?? []; if (!a.includes(u)) a.push(u); m.set(k, a); };
    for (const row of rows) {
      const u = String(row.image_url ?? ""); if (!u) continue;
      if (row.place_id) push(byId, String(row.place_id), u);
      if (row.place_name) push(byName, String(row.place_name), u);
    }
    for (const rec of recs) {
      const up = (rec.supabaseId ? byId.get(rec.supabaseId) : undefined) ?? (rec.title ? byName.get(rec.title) : undefined) ?? [];
      if (up.length === 0) continue;
      rec.photoUrls = up.length >= 3 ? [...up] : [...up, ...(rec.photoUrls ?? []).filter(u => !up.includes(u))];
      rec.photoUrl = rec.photoUrls[0];
      rec.hasUserPhotos = true;
      rec.userPhotoCount = up.length;
    }
  } catch { /* spot_photos未作成等は従来表示で安全 */ }
}

// #6 多様性: 最終結果をカテゴリでラウンドロビン並べ替え（同種が上位に固まるのを防ぐ）。
//   先頭(最良)は維持しつつ、2番目以降を別カテゴリと交互に。要素の増減はなし(並べ替えのみ・in-place)。
//   1カテゴリのみ(例:ラーメン検索)は並べ替え不要でそのまま。
type DivRec = { category?: string; tags?: string[] };
// ── 地味な小さい公園を最終出力の最後尾へ（安定移動）──────────────────────────────
//   diversifyByCategory/finalizeAssembled の“後”に適用＝並べ替えが最終出力に確実に残る
//   （sortOrShuffleで下げてもdiversifyのラウンドロビンで中位へ戻る問題への最終ガード）。
//   除外でなく後方化（データ非削除・0件回避＝地味公園も末尾に必ず残る）。タグ付き絶景/
//   有名・大型・花・記念公園、及び「散歩/芝生/森」等 公園目的の深掘りは対象外。
const FILLER_SCENIC_TAGS = new Set(["#絶景スポット", "#展望台", "#夜景", "#岬", "#灯台", "#滝", "#湖", "#庭園", "#花畑", "#絶景"]);
const FILLER_APPEALING_PARK_RE = /国営|国立|海浜|臨海|花|バラ|ローズ|チューリップ|ラベンダー|コスモス|芝桜|紅葉|桜|展望|絶景|パノラマ|夜景|記念|歴史|城|庭園|森林|渓谷|湖畔|湖|大通|中央公園|総合公園|運動公園|自然公園|県立|府立|フラワー|ガーデン|高原|牧場|オアシス|ふれあい/i;
const FILLER_GENERIC_PARK_RE = /公園|緑地|広場|遊具|ちびっこ/;
const FILLER_PARKSEEK_RE = /散歩|芝生|ゴロゴロ|ひろびろ|広々|森|ピクニック|深呼吸|自然の中|公園/;
function demoteFillerParks<T extends { title?: string; tags?: string[] }>(recs: T[], deepDive?: string): T[] {
  if (FILLER_PARKSEEK_RE.test(deepDive || "")) return recs;   // 公園目的の深掘りは沈めない
  const isFiller = (r: T): boolean => {
    const n = r.title ?? "";
    if ((r.tags ?? []).some(t => FILLER_SCENIC_TAGS.has(t))) return false;   // タグ付き絶景/映えは残す
    if (FILLER_APPEALING_PARK_RE.test(n)) return false;                      // 有名/大型/花/記念公園は残す
    return FILLER_GENERIC_PARK_RE.test(n);                                   // 地味な○○公園/緑地/広場/遊具
  };
  const keep: T[] = [], parks: T[] = [];
  for (const r of recs) (isFiller(r) ? parks : keep).push(r);
  return parks.length ? [...keep, ...parks] : recs;   // 地味な公園を安定的に末尾へ
}

function diversifyByCategory(recs: DivRec[]): void {
  if (!recs || recs.length <= 4) return;
  const catOf = (r: DivRec) =>
    (r.category && r.category.trim()) || (r.tags ?? []).find(t => typeof t === "string" && t.startsWith("#")) || "?";
  const buckets = new Map<string, DivRec[]>();
  const order: string[] = [];
  for (const r of recs) {
    const c = catOf(r);
    if (!buckets.has(c)) { buckets.set(c, []); order.push(c); }
    buckets.get(c)!.push(r);
  }
  if (order.length <= 1) return;            // 単一カテゴリ＝並べ替え不要
  const out: DivRec[] = [];
  let added = true;
  while (out.length < recs.length && added) {
    added = false;
    for (const c of order) {
      const b = buckets.get(c)!;
      if (b.length) { out.push(b.shift()!); added = true; }
    }
  }
  recs.splice(0, recs.length, ...out);      // in-place で並べ替え（const配列でも可・参照維持）
}

// 期間限定イベントの会場上書き: 同一座標(≈11m)に公開期間中の期間限定スポットがあれば、
//   会場カード(例:マクセル アクアパーク品川)を イベント名・説明・#期間限定 に差し替える。
//   approvedSuggestions は取得時に公開期間でフィルタ済み＝期間終了で自動的に会場表示へ戻る。
type LimitedEventRec = { title?: string; lat?: number; lng?: number; aiReason?: string; reason?: string; features?: string[] };
function applyLimitedTimeOverride(
  recs: LimitedEventRec[],
  events: Array<{ spot_name?: string; description?: string | null; lat?: number | null; lng?: number | null }>,
): void {
  if (!recs?.length || !events?.length) return;
  type Ev = { spot_name?: string; description?: string | null; lat?: number | null; lng?: number | null };
  const byCoord = new Map<string, Ev>();
  const byName = new Map<string, Ev>();
  for (const e of events) {
    if (!e.spot_name) continue;
    byName.set(e.spot_name, e);
    if (typeof e.lat === "number" && typeof e.lng === "number") byCoord.set(`${e.lat.toFixed(4)},${e.lng.toFixed(4)}`, e);
  }
  if (byCoord.size === 0 && byName.size === 0) return;
  const usedName = new Set<string>();
  const remove: number[] = [];
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    // 同一座標(会場) or 同名(注入されたイベント本体・座標なしの場合も) でイベントを特定
    let ev: Ev | undefined;
    if (typeof rec.lat === "number" && typeof rec.lng === "number") ev = byCoord.get(`${rec.lat.toFixed(4)},${rec.lng.toFixed(4)}`);
    if (!ev && rec.title) ev = byName.get(rec.title);
    if (!ev || !ev.spot_name) continue;
    if (usedName.has(ev.spot_name)) { remove.push(i); continue; }   // 同一イベントの重複カードは除去
    usedName.add(ev.spot_name);
    rec.title = ev.spot_name;                                   // 会場名 → イベント名
    if (ev.description) { rec.aiReason = ev.description; rec.reason = ev.description; }
    rec.features = ["#期間限定", ...((rec.features ?? []).filter(f => f !== "#期間限定"))];
  }
  for (let j = remove.length - 1; j >= 0; j--) recs.splice(remove[j], 1);  // 後ろから削除
}

// ─── Step 1: 検索結果 後処理パイプライン（全経路で共通利用するため関数化）──────────
// 経路ごとにバラバラだった「フィルタ / ソート / 重複排除 / 15件化」のロジックを
// 1か所(createFinalizeHelpers)に集約する。挙動は従来(経路2: Supabase-first)と完全同一。
// 将来 経路5(レガシー)等もこのヘルパーを呼ぶことで、改善(A-7/D-1/D-4/E-3 等)が全経路に効く。

// パイプラインが参照するスポットの最小フィールド定義（各経路の具体型はこれを満たす）
type FinalizeRec = {
  title?: string;
  address?: string;
  lat?: number;
  lng?: number;
  distanceKm?: number;
  distanceText?: string;
  distanceM?: number | null;  // PostGIS精密距離[m]（あれば距離の最優先ソース）
  openNow?: boolean;
  rating?: number | null;
  photoUrl?: string;
  photoUrls?: string[];
  userRatingCount?: number | null;
  hasUserPhotos?: boolean;
  features?: string[];
  tags?: string[];   // 気分/ジャンルタグ（絶景boost・地味な公園判定に使用）
  source?: string;   // 手動追加(manual/admin/user)優先のために参照
  placeId?: string;  // #2: 重複排除の安全網（同一placeId=同一スポット）
  _aiRank?: number;  // OpenAI判別順位(0=最良)。Supabase候補のみ付与。sortOrShuffleで昇格boostに使う
};

type FinalizeContext = {
  isFoodMood: boolean;
  minRadiusKm: number;
  // 領域1: 近距離キャップ(km)。通常(非food/min0)分岐で「このkm以内を上位厳守」かつ
  //   cap超過 curated の+8加点を無効化する。未指定(undefined)なら従来挙動(relax/legacy)。
  nearCapKm?: number;
  // 領域4: 家族×飲食の酒場系抑制トリガ（companion=家族 かつ 居酒屋系を明示選択していない時）。
  familyCompanion?: boolean;
  alcoholDeepDive?: boolean;
  isBadWeather: boolean;
  goodVisitedPlaces: Set<string>;
  seenPlaces: string[];
  showUnseenOnly: boolean;
  effectiveDeepDive: string;
  mood?: string;   // 飲食店除外の判定（お腹すいた/カフェ系以外は飲食店を出さない）
  originLat?: number;   // 距離の単一化に使う現在地
  originLng?: number;
  transport?: string | string[];  // 距離テキストの交通手段
};

type FinalizeDedupeKey = { key: string; lat?: number; lng?: number; pid?: string };

// 飲食系で除外する施設名（温浴・観光施設）。foodSanitize で使用。
const FINALIZE_NON_FOOD_NAME_RE = /(温泉|スーパー銭湯|銭湯|岩盤浴|健康ランド|日帰り温泉|スパリゾート|展望台|植物園|動物園|遊園地|水族館)/;
// 目的地でないPOI（OSM由来のトイレ/給水所/バス停/自販機/喫煙所等）。どの気分でも検索結果に出さない。
//   パチンコ/パチスロは18禁業態でZ世代お出かけ推薦に不適＝全気分で除外（2026-07-17監査: 川崎わいわいに
//   「スロットタイガー７」が#わいわい楽しみたいタグで混入していた事例）。「スロットカー」等ホビーは除外しない。
const NON_DESTINATION_RE = /(?:公衆)?トイレ|お手洗い|給水所|給水塔|配水場|公衆便所|バス停|バス停留所|自動販売機|自販機コーナー|公衆電話|喫煙所|変電所|ポンプ場|防災倉庫|ゴミ集積|ゴミ処理|パチンコ|パチスロ|スロット(?!カー)|本殿$|拝殿$|社殿$|神楽殿$|鳥居$|狛犬|手水舎|御神木|舁き山|飾り山|絵馬殿$/;
// 断片・カテゴリ語だけの名前（OSM/オープンデータETLで name=カテゴリ語のまま流入した junk）。
//   例: 名前が「和食」「カフェ」「神社」「お店」だけ＝場所として成立しない → 全気分で除外。
const BARE_CATEGORY_NAME_RE = /^(?:和食|洋食|中華|韓国料理|アジア料理|各国料理|カフェ|喫茶店|居酒屋|ラーメン|うどん|そば|焼肉|寿司|寿し|バー|スナック|パブ|お店|飲食店|レストラン|食堂|神社|寺院?|お寺|公園|広場|店舗|施設|名称未設定|無名)$/;
// レジャー目的地でないサービス業（美容/医療/整体等）＝どの気分の目的地でもない。非食事の全結果から除外。
//   （品質監査2026-07-19: 自然に美容室が混入。時間潰しUNFITと同方針を非食事全体へ一般化）。
const SERVICE_UNFIT_RE = /美容室|美容院|ヘアサロン|hair\s?salon|理容室|理容院|床屋|バーバー|ネイルサロン|まつげエクステ|まつエク|エステ(?:ティック)?|脱毛|痩身|クリニック|歯科|皮膚科|眼科|内科|外科|整形外科|接骨院|整骨院|整体|カイロプラクティック|鍼灸|マッサージ店/i;
// 城郭の下位パーツ（堀/門/井戸/石垣等が #自然 等に誤タグされ独立POI化）。目的地は「城」そのもので下位は除外。
const CASTLE_PART_RE = /(?:内|外|中|水|空)堀$|^.{0,6}(?:大手|太鼓|黒|赤|櫓|埋|北不明)門$|石垣$|土塁$|馬出$|櫓台$/;
// センシティブ施設(慰霊/葬祭/墓地/居住/災害跡)＝どの気分でも推薦しない。心霊深掘りでも同様
//   (実在の墓地/葬儀場/災害惨事跡/居住団地/慰霊碑を「肝試し」枠に出すのは法務/プライバシー/風評の重大リスク)。
//   全気分の最終結果に適用する安全網(心霊はfinalizeAssembledを早期returnで迂回するため別途ここで機械除外)。
//   ※記念館/資料館(博物館系)は除外語に含めない(記念碑/慰霊碑のみ)。
const SENSITIVE_UNFIT_RE = /霊園|墓地|墓所|納骨|お墓|之墓|の墓|(?:^|[^おこ])墓$|火葬|斎場|葬儀|葬祭|セレモニー(?:ホール|会館|プラザ)|メモリアルホール|慰霊(?:碑|塔|堂|之|の|$)|供養(?:塔|碑|堂)|遭難.{0,3}碑|水害.{0,3}碑|震災.{0,3}碑|災害.{0,3}(?:碑|塔)|団地|県営住宅|市営住宅|公営住宅|事故物件|火災跡|殉難/;
// Z世代UNFIT(2026-07-20 ユーザー要望「Z世代に受ける場所だけ・どうでも良い場所が多すぎ」・強め既定)。
//   インフラ/生活施設/B2B/断片＝Z世代が絶対に行かない“のっぺり”スポットを全気分で機械除外。
//   誤爆回避のためテスト済(良いスポット名で非該当・ノイズ名で該当)。タイムズはスクエア(新宿ランドマーク)を除外。
const GENZ_NOISE_RE = /銀行|信用金庫|信用組合|信金|労働金庫|ゆうちょ|郵便局|農協|JAバンク|(?:市|区|町|村|県)役所|役場|市役所|区役所|町役場|公民館|保健所|税務署|出張所|支所|地方合同庁舎|交番|派出所|駐在所|警察署|消防署|消防団|コインパーキング|タイムズ(?!スクエア)|月極|駐車場|バスターミナル|バスセンター|バス停|停留所|ガソリンスタンド|給油所|ENEOS|出光|コスモ石油|卸売|問屋|資材|建材|鋼材|製作所|加工場|工場|倉庫|物流|運送|運輸|事業所|営業所|協同組合|商工会|変電所|浄水場|下水|清掃工場|小学校|中学校|中学$|高等学校|高校|幼稚園|保育園|保育所|こども園|学童|児童公園|児童遊園|ちびっ子(?:広場|公園)|防災(?:公園|広場|拠点)|街区公園|近隣公園|歩道橋|陸橋(?!.*(?:カフェ|バル))|自動販売機|コインランドリー|質屋/;

// 説明文の完全重複を潰す言い換えプール(2026-07-20 監査: 単一タグ由来の定型vibe文が全カード一字一句同じになる)。
//   同一reasonが2件目以降で出たら、その定型文の言い換えに差し替える。先頭1件は原文のまま。
const REASON_ALT: Record<string, string[]> = {
  "地元で愛される味が楽しめます。": ["地元で人気の一軒です。", "ふらっと入りたくなる味です。", "通いたくなる定番の味。", "地元民に愛される隠れた名店。"],
  "パワースポットとして人気です。": ["静かな空気に包まれます。", "厳かな雰囲気が漂います。", "ご利益を求めて人が集まります。", "心が整うパワースポット。"],
  "静かに落ち着いて過ごせます。": ["集中したい時にぴったり。", "落ち着いた時間が流れます。", "一人でこもるのに向いています。", "静けさが心地よい空間。"],
  "のんびりゆったり過ごせます。": ["肩の力を抜いてくつろげます。", "ゆるやかな時間を過ごせます。", "のどかな雰囲気にほっとします。", "ゆっくり羽を伸ばせます。"],
  "自然を感じてリフレッシュできます。": ["緑に囲まれて深呼吸できます。", "自然の中でリセットできます。", "四季の景色が楽しめます。", "外の空気で気分転換に。"],
  "絶景が楽しめます。": ["息をのむ景色が広がります。", "写真に撮りたくなる眺め。", "一度は見たい絶景。", "眺めがとにかく最高です。"],
  "きれいな夜景が見られます。": ["夜景がロマンチックです。", "きらめく夜景に癒やされます。", "夜が似合うスポット。", "デートにぴったりの夜景。"],
  "日頃の疲れを癒やせます。": ["湯にゆっくり浸かれます。", "疲れがほぐれる場所。", "ととのう時間を過ごせます。", "心も体もリセットできます。"],
  "みんなでわいわい楽しめます。": ["友達と盛り上がれます。", "グループで賑やかに過ごせます。", "みんなでテンション上がる場所。", "ワイワイ楽しい時間に。"],
  "体を動かしてリフレッシュできます。": ["いい汗をかけます。", "体を動かしてスッキリ。", "運動でリフレッシュできます。", "アクティブに過ごせます。"],
  "見ごたえのある展示が楽しめます。": ["じっくり見て回れます。", "見応えのある内容です。", "アートに浸れる時間。", "好奇心が刺激されます。"],
  "お気に入りをゆっくり探せます。": ["掘り出し物が見つかるかも。", "ぶらぶら見て回れます。", "宝探し気分で楽しめます。", "お気に入りに出会える店。"],
  "ご当地の味やお土産が揃います。": ["ご当地グルメが充実。", "お土産選びが楽しい。", "地元の味に出会えます。", "旅の途中に立ち寄りたい。"],
  "のんびり散策できます。": ["ぶらり散歩にぴったり。", "のんびり歩くのに気持ちいい。", "散策が心地よい場所。", "ゆっくり歩きたくなります。"],
  "気軽に立ち寄れます。": ["ふらっと立ち寄れます。", "気軽に楽しめる場所。", "肩肘張らずに過ごせます。", "近くに来たら寄りたい。"],
  "ひと息つけます。": ["ほっと一息つけます。", "休憩にちょうどいい。", "コーヒー片手にくつろげます。", "ひと休みに最適。"],
  "食事が楽しめます。": ["美味しい food にありつけます。", "しっかり食べられます。", "満足感のある一皿。", "お腹を満たせます。"],
};
// freeWord(こだわり)由来のハードジャンル判定(2026-07-20 監査#1/Z世代最大の萎え「打った言葉が無視される」)。
//   ドロップダウン深掘り未選択でも、freeWordが明確にジャンルを指す時に非該当スポットを最終段で除去する。
//   re=freeWord発火語 / pos=スポット名の肯定語 / tags=そのジャンルのシグナルタグ。名前pos or タグ一致で「該当」。
const FREEWORD_GENRE: Array<{ re: RegExp; key: string; pos: RegExp; tags: string[] }> = [
  { re: /古着|ヴィンテージ|ヴィンテ|vintage|アメカジ|セカンドハンド|used\s?clothing|古物商/i, key: "古着",
    pos: /古着|ヴィンテージ|vintage|used|セカンドハンド|アメカジ|thrift|古物|リメイク|ラグ|RAGTAG|WEGO|フリマ/i, tags: ["#古着・ヴィンテージ", "#服・アクセサリー"] },
  { re: /サウナ|sauna|サ活|ととの|整い(?:たい)?|整う|ロウリュ|岩盤浴/i, key: "サウナ",
    pos: /サウナ|sauna|スパ|spa|健康ランド|スーパー銭湯|温浴|ロウリュ|岩盤浴|銭湯|の湯|温泉|湯処|ゆ$/i, tags: ["#サウナ", "#岩盤浴", "#銭湯", "#温泉"] },
  { re: /夜景|イルミ|ライトアップ|nightview|ナイトビュー/i, key: "夜景",
    pos: /夜景|展望|タワー|ビュー|view|イルミ|丘|山頂|屋上|ルーフ|テラス|港|ベイ|スカイ|sky|展望台|ヒルズ|大橋/i, tags: ["#夜景", "#展望台", "#絶景スポット"] },
  { re: /韓国|コリアン?|サムギョプ|タッカルビ|スンドゥブ|チヂミ|トッポギ|ホットク|プルコギ|ビビンバ|チーズ.{0,3}(?:ダッカルビ|ハットグ|ドッグ)/i, key: "韓国",
    pos: /韓国|コリア|サムギョプ|タッカルビ|スンドゥブ|純豆腐|チゲ|プルコギ|ビビンバ|チヂミ|マッコリ|トッポギ|ホットク|カンジャン|ポチャ|韓|オッパ|チキン/i, tags: ["#韓国", "#韓国料理"] },
  { re: /雑貨|インテリア雑貨|zakka|生活雑貨|ステーショナリー/i, key: "雑貨",
    pos: /雑貨|インテリア|zakka|生活|ヴィレッジヴァンガード|ヴィレヴァン|ロフト|LOFT|ハンズ|家具|フランフラン|Francfranc|文具|ステーショナリー|セレクト/i, tags: ["#雑貨・インテリア"] },
  { re: /海沿い|海辺|海岸|ビーチ|オーシャン|シーサイド|beach|海が見え/i, key: "海辺",
    pos: /海|ビーチ|beach|海岸|海辺|浜|マリン|オーシャン|岬|漁港|シーサイド|ベイ|渚|なぎさ|サンビーチ|海浜/i, tags: ["#海辺", "#海辺カフェ"] },
  { re: /絶景|フォトスポット|フォトジェニック|映えスポット|パノラマ/i, key: "絶景",
    pos: /絶景|展望|パノラマ|ビュー|view|タワー|丘|山頂|岬|渓谷|滝|ダム|大橋|フォト|スカイ|テラス|ヒルズ/i, tags: ["#絶景スポット", "#展望台", "#夜景"] },
  { re: /カフェ|喫茶|珈琲|coffee|cafe|café|パンケーキ|純喫茶/i, key: "カフェ",
    pos: /カフェ|cafe|café|coffee|珈琲|コーヒー|喫茶|ロースター|スタンド|ティー|tea|bakery|ベーカリー|パンケーキ|焙煎|ブリュー|エスプレッソ/i, tags: ["#癒しカフェ", "#カフェスイーツ", "#景色良いカフェ", "#海辺カフェ", "#森林カフェ", "#カフェ作業"] },
];
function freewordGenreRule(freeWord: string): typeof FREEWORD_GENRE[number] | null {
  const t = (freeWord || "").trim();
  if (!t) return null;
  for (const g of FREEWORD_GENRE) if (g.re.test(t)) return g;
  return null;
}

function dedupeReasons<T extends { reason?: string; aiReason?: string }>(recs: T[]): T[] {
  const seen = new Map<string, number>();
  for (const r of recs) {
    const key = (r.reason ?? "").trim();
    if (!key) continue;
    const c = seen.get(key) ?? 0;
    if (c > 0) {
      const alts = REASON_ALT[key];
      if (alts && alts.length) {
        const alt = alts[(c - 1) % alts.length];
        r.reason = alt;
        if (r.aiReason !== undefined) r.aiReason = alt;
      }
    }
    seen.set(key, c + 1);
  }
  return recs;
}
// お腹すいた時に除外する老舗系（観光客向けでない古すぎる地元店の抑制）。
// ※「食堂」「大衆食堂」は正規の定食屋・大衆食堂(〇〇食堂)が多く、docx仕様も除外を求めて
//   いないため除外対象から外した（定食食堂の取りこぼし防止）。
// ※「老舗」等は喫茶/レトロ系ジャンルでは docx が明示的に求めるため foodSanitize 側で除外を免除する。
const FINALIZE_OLD_STORE_NAME_RE = /(老舗|創業[0-9０-９]+年|明治|大正|昭和[0-9０-９]+年創)/;
// B2B・施設系の除外（株式会社/工場 等）。法人格マーカーは全形を網羅（㈱㈲（同）等の
// 単字マーカーが検索結果に漏れていたため cleanup-places の CORP_MARKERS と揃える）。
const FINALIZE_NG_BIZ_RE = /(株式会社|有限会社|合同会社|合資会社|合名会社|（株）|\(株\)|㈱|（有）|\(有\)|㈲|（同）|\(同\)|工場|製作所|倉庫|営業所|事業所|事務所|出張所|本社|支社)/;

// 領域3a: 投稿生テキスト（穴場/スポンサー等の description）を表示用reasonに整形する。
//   suggest.tsx が `本文\n【目安価格】〜¥500\n【おすすめ度】★3` の形で保存するため、
//   ① 【…】見出しで始まる定型行を丸ごと除去 ② 改行を句点に畳んで1文化
//   ③ 連続句点/空白・末尾記号を整理 ④ 80字に圧縮。本文が空になれば "" を返す（カード側で非表示）。
function sanitizeReasonText(raw?: string | null): string {
  if (!raw) return "";
  return String(raw)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^【[^】]*】/.test(l))
    .join("。")
    .replace(/。{2,}/g, "。")
    .replace(/[ \t　]{2,}/g, " ")
    .replace(/^[。、・\s]+|[。、・\s]+$/g, "")
    .slice(0, 80);
}

// スポットの実属性（エリア・種別・気分タグ）から具体的な一言説明を0msで生成する。
//   「○○のスポット情報」という無味な定型フォールバックを置換し、全カードに情報価値を出す（2026-07-17）。
//   実説明(DB/OpenAI生成/店舗提供)があればそちらを優先し（pickReason）、無い時だけこれを使う。
function buildSpecificReason(name: string, tags: string[], address?: string | null): string {
  const t = new Set((tags || []).map(x => x.replace(/^#/, "")));
  // エリア: 住所から「市区町村」優先、無ければ都道府県
  const area = (() => {
    const a = (address || "").replace(/^日本、?\s*/, "").trim();
    if (!a) return "";
    // 先頭の都道府県を除去して市区町村だけを簡潔に採る（「神奈川県鎌倉市」→「鎌倉市」）
    const noPref = a.replace(/^(東京都|北海道|京都府|大阪府|.{2,3}県)\s*/, "");
    const city = noPref.match(/^([^\s、,0-9]{1,6}?[市区町村])/);
    if (city) return city[1];
    const pref = a.match(/^(東京都|北海道|京都府|大阪府|.{2,3}県)/);
    return pref ? pref[1] : "";
  })();
  // 種別: 名前の接尾辞 → タグ の順
  const type =
    /(神社|大社|神宮|八幡宮?|稲荷|天満宮)/.test(name) ? "神社" :
    /(寺|院|大師|不動尊)$/.test(name) ? "お寺" :
    /(城$|城跡|城址)/.test(name) ? "城" :
    /(公園|緑地)$/.test(name) ? "公園" :
    /(滝|渓谷|峡)$/.test(name) ? "自然スポット" :
    /(湖|沼|池|湿原)$/.test(name) ? "水辺スポット" :
    /(海岸|海水浴場|浜|ビーチ|岬)$/.test(name) ? "海辺スポット" :
    /(山|岳|峰|嶽)$/.test(name) ? "山" :
    /温泉/.test(name) ? "温泉" :
    /美術館$/.test(name) ? "美術館" :
    /(博物館|資料館|記念館|科学館|歴史館)$/.test(name) ? "博物館" :
    /図書館$/.test(name) ? "図書館" :
    /水族館$/.test(name) ? "水族館" :
    /(動物園|牧場)$/.test(name) ? "動物園・牧場" :
    /(展望台|タワー|ヒルズ)/.test(name) ? "展望スポット" :
    /(カフェ|珈琲|coffee|cafe)/i.test(name) ? "カフェ" :
    /(ラーメン|らーめん|中華そば)/.test(name) ? "ラーメン店" :
    t.has("お腹すいた") || t.has("ご当地グルメ") ? "グルメスポット" :
    t.has("カフェスイーツ") ? "カフェ" :
    t.has("ショッピング") ? "お店" :
    t.has("温泉") ? "温泉" :
    (t.has("自然公園") || t.has("自然感じたい")) ? "自然スポット" :
    "スポット";
  // 気分フレーズ: 優先度順に1つ
  const vibe =
    t.has("パワースポット") ? "パワースポットとして人気です。" :
    (t.has("絶景スポット") || t.has("絶景")) ? "絶景が楽しめます。" :
    t.has("夜景") ? "きれいな夜景が見られます。" :
    (t.has("自然感じたい") || t.has("自然公園")) ? "自然を感じてリフレッシュできます。" :
    t.has("温泉") ? "日頃の疲れを癒やせます。" :
    t.has("集中したい") ? "静かに落ち着いて過ごせます。" :
    t.has("まったりしたい") ? "のんびりゆったり過ごせます。" :
    t.has("わいわい楽しみたい") ? "みんなでわいわい楽しめます。" :
    t.has("体動かしたい") ? "体を動かしてリフレッシュできます。" :
    (t.has("ご当地グルメ") || t.has("お腹すいた")) ? "地元で愛される味が楽しめます。" :
    t.has("鑑賞") ? "見ごたえのある展示が楽しめます。" :
    (t.has("ショッピング") || t.has("お土産ギフト") || t.has("古着") || t.has("服アクセサリー") || t.has("雑貨インテリア") || t.has("コスメ美容")) ? "お気に入りをゆっくり探せます。" :
    t.has("道の駅") ? "ご当地の味やお土産が揃います。" :
    (t.has("お散歩") || t.has("大型公園") || t.has("名所公園")) ? "のんびり散策できます。" :
    t.has("穴場スポット") ? "知る人ぞ知る穴場です。" :
    "";
  // vibe が空でも「お店。」のような裸の type だけの出力にしない（気分監査2026-07-19で発覚）。
  //   type から自然な1文を必ず補い、意味のある説明にする。
  const vibeFinal = vibe || (
    type === "お店"                         ? "気軽に立ち寄れます。" :
    type === "カフェ"                       ? "ひと息つけます。" :
    (type === "グルメスポット" || type === "ラーメン店") ? "食事が楽しめます。" :
    "気軽に立ち寄れます。"
  );
  const head = area ? `${area}の${type}。` : (type !== "スポット" ? `${type}。` : "");
  return (head + vibeFinal).replace(/^[。\s]+/, "").slice(0, 60);
}

// 実説明があれば優先、無い/定型フォールバックなら具体的な一言を生成する。
function pickReason(name: string, tags: string[], address: string | null | undefined, rawDesc?: string | null): string {
  const clean = sanitizeReasonText(rawDesc);
  const isStub = !clean || clean === `${name}のスポット情報` || clean.length < 6;
  return isStub ? buildSpecificReason(name, tags, address) : clean;
}

function createFinalizeHelpers(ctx: FinalizeContext) {
  const {
    isFoodMood, minRadiusKm, nearCapKm, familyCompanion, alcoholDeepDive, isBadWeather,
    goodVisitedPlaces, seenPlaces, showUnseenOnly, effectiveDeepDive, mood,
  } = ctx;

  // 飲食NGコンテキスト（お腹すいた/カフェ・グルメ系以外）では飲食店を除外。
  //   全ソースに効く保険フィルタ。Supabase保管スポットは tags で、Google/Yahoo は名前で判定。
  const foodAllowed = isFoodAllowedContext(mood, effectiveDeepDive);
  const nonFoodSanitize = <T extends { title?: string; tags?: string[] }>(arr: T[]): T[] =>
    foodAllowed ? arr : arr.filter(r => !isRestaurantName(r.title ?? "") && !tagsAreFood(r.tags));

  // distanceText 例: "車で約2分 / 1.0km" から km をパース
  const parseKmFromDistText = (distText?: string): number | null => {
    if (!distText) return null;   // 距離不明は null（kmOf の ?? 9999 を生かし「最至近0km」誤判定を防ぎ末尾へ）
    const m = distText.match(/\/\s*([\d.]+)\s*km/);
    return m ? parseFloat(m[1]) : null;
  };

  const shuffleArr = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const applyMallFilter = <T extends { title?: string }>(arr: T[]): T[] =>
    isLargeMallSearch(effectiveDeepDive)
      ? arr.filter(r => isLargeMallName(r.title ?? ""))
      : arr;

  const normalizeName = (str: string): string =>
    (str ?? "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^0-9a-z぀-ヿ一-鿿ｦ-ﾟ]+/g, "");

  const namesOverlap = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return true;
    return a.slice(0, 4) === b.slice(0, 4);
  };
  // P17: 同一複合施設の「棟/イースト・ウエスト等」接尾辞を剥がした"核の名前"。
  //   ヒルトンプラザ イースト／ウエスト／WEST が全て「ヒルトンプラザ」に畳まれる（座標近接と併用して誤結合を防ぐ）。
  //   保守的に方向/館/棟の接尾辞のみ剥がす（交差点/スクエア等は残す＝スクランブル交差点↔スクエアは別物のまま）。
  const CORE_SUFFIX_RE = /(イースト|ウエスト|ウェスト|ノース|サウス|セントラル|east|west|north|south|central|別館|本館|新館|東館|西館|南館|北館|[東西南北]棟|[a-z]棟)+$/i;
  const coreKey = (k: string): string => { const c = k.replace(CORE_SUFFIX_RE, ""); return c.length >= 4 ? c : k; };

  // クロスソース重複排除しながら pool から最大 max 件取得。A-7: 同チェーン最大2件抑制。
  //   sharedBrandCounts を渡すと呼び出し越しにブランドcapを共有する（SB/G/Y/backfillの
  //   4回で各2件=最大6件同チェーンが通り、後段finalizeAssembledの削除で件数が減る問題への対応）。
  const pickUnique = <T extends FinalizeRec>(
    pool: T[], max: number, seen: FinalizeDedupeKey[], sharedBrandCounts?: Map<string, number>,
  ): { taken: T[]; skipped: T[] } => {
    const taken: T[] = [];
    const skipped: T[] = [];
    const chainCounts = sharedBrandCounts ?? new Map<string, number>();
    for (const r of pool) {
      const key = normalizeName(r.title ?? "");
      if (!key) continue;
      const rl = typeof r.lat === "number" ? r.lat : undefined;
      const rg = typeof r.lng === "number" ? r.lng : undefined;
      // #2: 同一placeId(=同一スポット)は確実な重複。名前が違って80m判定を抜けるケースも塞ぐ安全網。
      const pid = typeof r.placeId === "string" && r.placeId ? r.placeId : undefined;
      let isDup = false;
      for (const e of seen) {
        if (e.key === key) { isDup = true; break; }
        if (pid && e.pid === pid) { isDup = true; break; }
        if (rl !== undefined && rg !== undefined && e.lat !== undefined && e.lng !== undefined) {
          const d = haversineMeters(rl, rg, e.lat, e.lng);
          if (d <= 80 && namesOverlap(key, e.key)) { isDup = true; break; }
          // P17: 同一複合施設(棟/イースト・ウエスト等の接尾辞違い)を core 名一致＋近接(≤400m)で1件に畳む。
          //   ck!==key or ce!==e.key で「少なくとも一方が接尾辞を持っていた」ことを要求＝別スポットの偶然一致を除外。
          const ck = coreKey(key), ce = coreKey(e.key);
          if (ck.length >= 4 && d <= 400 && ck === ce && (ck !== key || ce !== e.key)) { isDup = true; break; }
        }
      }
      if (isDup) continue;
      const brand = brandOf(r.title ?? "");
      const chainCnt = brand.length >= 3 ? (chainCounts.get(brand) ?? 0) : 0;
      if (chainCnt >= 2) { skipped.push(r); continue; }
      if (taken.length < max) {
        seen.push({ key, lat: rl, lng: rg, pid });
        taken.push(r);
        if (brand.length >= 3) chainCounts.set(brand, chainCnt + 1);
      } else {
        skipped.push(r);
      }
    }
    return { taken, skipped };
  };

  // ── 領域5: 組み立て後の最終整形（非食事・非心霊のみ）──────────────────────────
  //   pickUnique のブランドcapは「呼び出しごと」にリセットされ、SB/G/Y/backfill の4回越しでは
  //   効かない（同一チェーンが最大8件並ぶ＝カラオケ8/15の原因）。diversifyByCategory は
  //   並べ替えるだけで件数をcapしない。ここで組み立て済み配列に1回だけ:
  //     (a) 同ブランド上限2件  (b) 同サブカテゴリ上限4件  (c) 有名定番を最低1枠上位確保。
  //   food/心霊は対象外（早期return）。超過分は除去せず末尾へ回し15件は維持。
  const NONFOOD_SUBCATS: { key: string; re: RegExp }[] = [
    { key: "カラオケ", re: /カラオケ|まねきねこ|ビッグエコー|カラオケ館|ジャンカラ|banban|ビッグ\s?エコー|joysound|ジョイサウンド|ワンカラ|歌広場|シダックス|カラ館|カラオケの鉄人/i },
    // 「こだわらない/わいわい」等でジャンル指定が無いと同種のアミューズメントが氾濫する（ボウリング5件等）。
    //   別ブランドでも同サブカテなので SUBCAT_CAP(=3) で間引く。
    { key: "ボウリング", re: /ボウリング|ボーリング|bowling|ラウンドワン|round\s?1|スポッチャ|spo-?cha/i },
    { key: "ゲーセン",   re: /ゲームセンター|ゲーセン|アミューズメント(?!パーク)|amusement\s?(?:arcade|center)|タイトーステーション|adores|アドアーズ/i },
    { key: "図書館",   re: /図書館|library|自習|ライブラリー/i },
    { key: "水族館",   re: /水族館|aquarium|アクアリウム/i },
    { key: "展望",     re: /展望|スカイ\s?ツリー|スカイツリー|タワー|展望台|sky\s?tree/i },
    { key: "温泉",     re: /温泉|スーパー銭湯|岩盤浴|サウナ/i },
    { key: "美術博物", re: /美術館|博物館|資料館|ミュージアム|museum/i },
    { key: "動物園",   re: /動物園|zoo|サファリ/i },
    { key: "映画",     re: /映画|シネマ|cinema|109シネ|TOHOシネ/i },
    // 集中×都心でチェーンカフェが6連発した対策(2026-07-17監査)。異ブランド(スタバ/ドトール/タリーズ…)でも
    //   同サブカテとして3件で間引く。「カフェで作業」等を明示選択した検索は requestedSub 免除で従来どおり。
    { key: "カフェ",   re: /カフェ|cafe|珈琲|coffee|喫茶|スターバックス|スタバ|ドトール|タリーズ|コメダ|ベローチェ|サンマルク|プロント|エクセルシオール|ルノアール|星乃/i },
    // 品質監査2026-07-19: 神社仏閣(11件)・ジム(11件)・滝(5件)が各moodのフィラーとして氾濫していた
    //   （別placeなのでブランドcapが効かず、サブカテ未登録でSUBCAT_capもバイパス）。名前ベースで束ねて間引く。
    //   神社/寺を明示深掘り(パワースポット等)した検索は requestedSub 免除で従来どおり出す。
    { key: "神社仏閣", re: /神社|神宮|大社|八幡宮|稲荷|天満宮|東照宮|明神|権現|パワースポット|(?:寺|寺院|大師|不動尊|観音)$/ },
    { key: "ジム",     re: /ジム|フィットネス|gym|fitness|エニタイム|anytime|チョコザップ|chocozap|カーブス|curves|ゴールドジム/i },
    { key: "滝",       re: /滝(?:$|の|つ|不動|見)|大滝|雄滝|雌滝/ },
    { key: "道の駅",   re: /道の駅/ },
  ];
  // タグ→サブカテ（名前にジャンル語が無い店の取りこぼし対策。例:「ミッキー黒川店」「CLUB DAM」は
  //   名前でカラオケと判定できないが #カラオケ タグで捕捉＝名古屋わいわいでカラオケ5連発した穴を塞ぐ）
  const TAG_SUBCAT: [string, string][] = [
    ["#カラオケ", "カラオケ"], ["#ボウリング", "ボウリング"], ["#体験型ゲーム", "ゲーセン"],
    ["#図書館", "図書館"], ["#book場", "図書館"], ["#水族館", "水族館"],
    ["#温泉", "温泉"], ["#サウナ", "温泉"], ["#博物館", "美術博物"], ["#動物園", "動物園"],
    ["#喫茶店", "カフェ"], ["#カフェスイーツ", "カフェ"], ["#カフェ作業", "カフェ"],
  ];
  const nonFoodSubcatOf = (name: string, tags?: string[]): string => {
    for (const c of NONFOOD_SUBCATS) if (c.re.test(name)) return c.key;
    if (Array.isArray(tags)) {
      for (const [tag, key] of TAG_SUBCAT) if (tags.includes(tag)) return key;
    }
    return "";  // 分類外はcap対象にしない
  };
  // 領域5(c): 有名定番スコア（レビュー数主体・0..1）。約1万件で≈1.0。
  const fameScore = (r: FinalizeRec): number => {
    const n = typeof r.userRatingCount === "number" ? r.userRatingCount : 0;
    return n <= 0 ? 0 : Math.min(1, Math.log10(n + 1) / 4);
  };
  const finalizeAssembled = <T extends FinalizeRec>(arr: T[]): T[] => {
    // 目的地でないPOI(トイレ/給水所/バス停/神社の下位パーツ等)＋カテゴリ語だけの断片名は全気分で除外
    //   ＝mood単体検索のOSM/オープンデータETLノイズを断つ（品質監査2026-07-19で断片POIの混入を確認）。
    arr = (arr ?? []).filter(r => {
      const t = (r.title ?? "").trim();
      return !NON_DESTINATION_RE.test(t) && !BARE_CATEGORY_NAME_RE.test(t)
        && !SERVICE_UNFIT_RE.test(t) && !CASTLE_PART_RE.test(t);
    });
    if (isFoodMood || effectiveDeepDive === "心霊") return arr;  // food/心霊は既存ロジック厳守
    if (!arr || arr.length <= 4) return arr;
    const BRAND_CAP = 2, SUBCAT_CAP = 3;
    // ユーザーが明示的に選んだ深掘りに一致するサブカテゴリはcapしない
    //   （温泉/図書館/水族館 等を直接選んだ検索でそのジャンルが4件に削られるのを防ぐ）。
    let requestedSub = "";
    for (const c of NONFOOD_SUBCATS) if (c.re.test(effectiveDeepDive || "")) { requestedSub = c.key; break; }
    const brandCnt = new Map<string, number>();
    const subCnt = new Map<string, number>();
    const kept: T[] = [];
    const overflow: T[] = [];
    for (const r of arr) {
      const brand = brandOf(r.title ?? "");
      const sub = nonFoodSubcatOf(r.title ?? "", r.tags);
      const bc = brand.length >= 3 ? (brandCnt.get(brand) ?? 0) : 0;
      const sc = sub ? (subCnt.get(sub) ?? 0) : 0;
      // ブランドcapは常時（同チェーン3件目以降は後方）。サブカテゴリcapは「選んだジャンル以外」のみ。
      //   ※source=admin等（source_type NULLの旧SB行含む）も対象＝カラオケ等の偏りを実際に間引く。
      const overBrand = brand.length >= 3 && bc >= BRAND_CAP;
      const overSub   = sub !== "" && sub !== requestedSub && sc >= SUBCAT_CAP;
      if (overBrand || overSub) { overflow.push(r); continue; }
      if (brand.length >= 3) brandCnt.set(brand, bc + 1);
      if (sub) subCnt.set(sub, sc + 1);
      kept.push(r);
    }
    // #16(多様性優先・ユーザー選択2026-07-05): 同ブランド/同サブカテの超過は"末尾送り"ではなく"削除"して
    //   多様化する（「こだわらない」で薄いエリアだと末尾に同種が残り"類似施設が大量"に見える問題への対応）。
    //   ただし全体が薄くなり過ぎないよう最低 DIVERSE_FLOOR 件までは overflow から補填。薄いエリアは15件未満を許容。
    //   food/心霊は上で早期returnのため影響なし。ユーザーが明示選択した深掘りジャンル(requestedSub)はcap対象外。
    const DIVERSE_FLOOR = 8;
    let merged: T[];
    if (kept.length >= DIVERSE_FLOOR) {
      merged = kept;
    } else {
      // 薄いエリアの補填でも同サブカテを積み増しし過ぎない（品質監査2026-07-19: まったり@渋谷で
      //   非神社の在庫が薄く、補填で神社が7件まで戻っていた）。緩めcap(=5)内を優先して補填し、
      //   それでも足りない時だけ超過分(leftover)で埋める＝変化に富んだ15件に寄せる。
      const SUBCAT_CAP_RELAX = 5;
      const fill: T[] = [];
      const leftover: T[] = [];
      for (const r of overflow) {
        const sub = nonFoodSubcatOf(r.title ?? "", r.tags);
        const sc = sub ? (subCnt.get(sub) ?? 0) : 0;
        if (sub && sub !== requestedSub && sc >= SUBCAT_CAP_RELAX) { leftover.push(r); continue; }
        if (sub) subCnt.set(sub, sc + 1);
        fill.push(r);
      }
      merged = [...kept, ...[...fill, ...leftover].slice(0, DIVERSE_FLOOR - kept.length)];
    }
    // (c): 著名スポット(レビュー多)が上位5枠に1件も無ければ、最良の1件を3位付近へ昇格。
    const FAME_MIN = 0.6;  // ~250件以上で著名とみなす
    const topHasFame = merged.slice(0, 5).some(r => fameScore(r) >= FAME_MIN);
    if (!topHasFame) {
      let bestIdx = -1, best = FAME_MIN;
      for (let i = 0; i < merged.length; i++) {
        const f = fameScore(merged[i]);
        if (f > best) { best = f; bestIdx = i; }
      }
      if (bestIdx > 2) {
        const [famous] = merged.splice(bestIdx, 1);
        merged.splice(2, 0, famous);  // 先頭2枠(curated注入)は温存
      }
    }
    return merged;
  };

  // ── 距離の単一化（全経路共通）──────────────────────────────────────────────
  //   各recの distanceKm と distanceText を「同じ1つのkm」から作り直す。
  //   優先: distanceM(PostGIS) → 座標haversine → 既存distanceKm。
  //   これでソート用と表示用のズレ・null座標バグ・交通手段未反映・3形式混在を解消。
  const normalizeDistance = <T extends FinalizeRec>(arr: T[]): T[] => {
    for (const r of arr) {
      const km = distanceKmFor({
        distanceM: r.distanceM, lat: r.lat, lng: r.lng,
        originLat: ctx.originLat, originLng: ctx.originLng,
        fallbackKm: typeof r.distanceKm === "number" ? r.distanceKm : undefined,
      });
      if (km != null) {
        r.distanceKm = km;
        r.distanceText = formatDistText(km, ctx.transport);
      }
    }
    return arr;
  };
  const kmOf = (r: FinalizeRec): number => (
    typeof r.distanceKm === "number"
      ? r.distanceKm
      : (parseKmFromDistText(r.distanceText) ?? 9999)
  );

  // 領域3b: 距離と最寄駅の一貫表記。現在地→スポットが「車距離(>2.5km or 交通手段=車/未指定)」の
  //   ときに stationText の『〇〇駅から徒歩約N分』を『最寄り: 〇〇駅』へ落とし、徒歩分と車距離の
  //   矛盾表示(「車24分/16km」＋「逗子駅から徒歩22分」)を防ぐ。徒歩/自転車・近場(<=2.5km)は現状維持。
  //   距離数値(distanceKm/distanceM)とソートには触れず、表示テキストのみ整える。
  const stationConsistency = <T extends FinalizeRec>(arr: T[]): T[] => {
    const tStr = Array.isArray(ctx.transport) ? ctx.transport.join(",") : (ctx.transport ?? "");
    const carContext = /車|バイク|なんでも/.test(tStr) || tStr === "";
    for (const r of arr) {
      const st = (r as unknown as { stationText?: string }).stationText;
      if (!st) continue;
      const km = typeof r.distanceKm === "number" ? r.distanceKm : kmOf(r);
      if (km > 2.5 && carContext && /徒歩約[0-9０-９]+分/.test(st)) {
        const m = st.match(/^(.+?駅?)から徒歩約[0-9０-９]+分$/);
        (r as unknown as { stationText?: string }).stationText = m ? `最寄り: ${m[1].replace(/駅$/, "")}駅` : st;
      }
    }
    return arr;
  };

  // D-1: フィードバック学習 — 過去に良かった場所を優先
  const goodPlaceNames = new Set([...goodVisitedPlaces].map(n => n.toLowerCase()));

  // D-4: 天気に基づく屋内/屋外タグ
  const OUTDOOR_TAGS = new Set(["#自然感じたい", "#ドライブしたい", "#体動かしたい"]);
  const INDOOR_TAGS  = new Set(["#集中したい", "#わいわい楽しみたい"]);
  const weatherBoost = (r: FinalizeRec): number => {
    if (!isBadWeather) return 0;
    const tags = (r as unknown as { auto_tags?: string[]; features?: string[] }).auto_tags
      ?? r.features ?? [];
    if (tags.some(t => INDOOR_TAGS.has(t)))  return 0.5;
    if (tags.some(t => OUTDOOR_TAGS.has(t))) return -0.5;
    return 0;
  };

  // E-3: 写真の質的優先スコア
  //   ⚠2026-07-16 重み引き上げ: 旧値(0.3〜1.2)は random(0-10)/評価(0-5)/絶景(+6)に埋もれ、
  //   「近いが写真の無い小スポット(○○跡/児童遊園/緑地)」が写真付きスポットより上位に来て、
  //   検索カードの多くが“画像なし”になっていた。候補は既に同気分・近傍で関連性が担保されている
  //   ので、その中で写真ありを実効的に優先する（写真なしも除外せず後方に残す＝0件回避・多様性維持）。
  const photoQualityScore = (r: FinalizeRec): number => {
    const hasUserPhoto = r.hasUserPhotos === true;
    const photoUrls = r.photoUrls ?? [];
    const hasPhoto = !!r.photoUrl || photoUrls.length > 0;
    if (hasUserPhoto) return 10;          // 利用者投稿写真=最優先
    if (photoUrls.length >= 3) return 9;  // 複数写真あり
    if (hasPhoto) return 8;               // 写真1枚でも“写真なし”より確実に上位へ（curated+8と同格）
    return 0;
  };

  const sortOrShuffle = <T extends FinalizeRec>(arr: T[]): T[] => {
    // お腹すいた: 近場優先を保ちつつ、#5 距離×評価バランスで「近くて☆も高い店」を上位化。
    //   距離を0.4km帯にバンド分けし、同帯内は openNow → 評価(Wilson下限) → 写真品質 で優先。
    //   これで至近の低評価店より、ほぼ同距離の高評価店が上に来る（ハズレ減少）。
    if (isFoodMood) {
      const ratingScore = (r: FinalizeRec) => wilsonLower(r.rating ?? null, r.userRatingCount ?? null); // 0..1
      return [...arr].sort((a, b) => {
        const ka = kmOf(a), kb = kmOf(b);
        const bandA = Math.floor(ka / 0.4), bandB = Math.floor(kb / 0.4);
        if (bandA !== bandB) return ka - kb;          // 異なる距離帯 → 近い順を厳守
        // 同距離帯内: 営業中 → 評価 → 写真 → 距離
        if (a.openNow && !b.openNow) return -1;
        if (!a.openNow && b.openNow) return 1;
        const rs = ratingScore(b) - ratingScore(a);
        if (Math.abs(rs) > 0.02) return rs;
        const pq = photoQualityScore(b) - photoQualityScore(a);
        if (Math.abs(pq) > 0.01) return pq;
        return ka - kb;
      });
    }
    if (minRadiusKm > 0) {
      return [...arr]
        .map(r => ({ r, km: kmOf(r) }))
        .sort((a, b) => (b.km - a.km) + (Math.random() - 0.5) * 4)
        .map(x => x.r);
    }
    // 通常: D-1学習 + D-4天気 + E-3写真品質 + #7営業中 + 手動追加優先 をシャッフルに加味
    const isCurated = (src?: string) => src === "manual" || src === "admin" || src === "user";
    // OpenAI判別順の昇格: 上位ほど大きなboost（rank0=+16…）。random[0,10]より大きいので
    //   「OpenAIが選んだ大局的な順」が支配しつつ、近い順位どうしはrandomで適度に入れ替わる
    //   （＝毎回同一にならず多様性も維持）。_aiRank未付与(Google/Yahoo)は0で従来挙動。
    const aiRankBoost = (r: FinalizeRec) => (typeof r._aiRank === "number" ? Math.max(0, 16 - r._aiRank) : 0);
    // 領域1: 近距離キャップ。nearCapKm 指定時、cap超過は band1(後方)＋curated+8を無効化する。
    //   nearCapKm 未指定(relax/legacy)は overCap 常に false ＝従来挙動と完全一致(回帰なし)。
    const overCap = (r: FinalizeRec): boolean =>
      typeof nearCapKm === "number" && nearCapKm > 0 && kmOf(r) > nearCapKm;
    // 領域2b: ★評価(Wilson下限0..1)を加点(最大+5)。★あり高評価を上位・★無は0で後方へ(除外しない)。
    // 領域3c: ★4.5以上×口コミ1〜2 の極端に薄い高評価(閉店疑い含む)は -2 で軽く後方化(除外しない)。
    //   ※ 評価加点は wilson*5 に一本化（*5と*2の二重加点はcurated+8を凌駕しadmin趣旨が壊れるため）。
    const sortRatingBoost = (r: FinalizeRec) => {
      const cnt = typeof r.userRatingCount === "number" ? r.userRatingCount : 0;
      let s = wilsonLower(r.rating ?? null, cnt) * 5;
      if (typeof r.rating === "number" && r.rating >= 4.5 && cnt > 0 && cnt <= 2) s -= 2;
      return s;
    };
    // ── 地味な小さい公園を最後尾バンドへ＋絶景/映えタグを上位へ ──────────────────────
    //   「自然」等で ことぶき公園/○丁目公園/児童公園 のような生活公園に絶景が埋もれる問題の是正。
    //   ⚠削除でなく“並べ替え”（データは消さない・地味公園も最後尾に必ず残る＝0件回避）。
    //   タグ付き絶景/有名・大型・花・記念公園、及び「散歩/芝生/森」等の公園目的の深掘りは対象外。
    const SCENIC_TAG_SET = new Set(["#絶景スポット", "#展望台", "#夜景", "#岬", "#灯台", "#滝", "#湖", "#庭園", "#花畑", "#絶景"]);
    const hasScenicTag = (r: FinalizeRec) => (r.tags ?? []).some(t => SCENIC_TAG_SET.has(t as string));
    const APPEALING_PARK_RE = /国営|国立|海浜|臨海|花|バラ|ローズ|チューリップ|ラベンダー|コスモス|芝桜|紅葉|桜|展望|絶景|パノラマ|夜景|記念|歴史|城|庭園|森林|渓谷|湖畔|湖|大通|中央公園|総合公園|運動公園|自然公園|県立|府立|フラワー|ガーデン|高原|牧場|オアシス|ふれあい/i;
    const GENERIC_PARK_RE = /公園|緑地|広場|遊具|ちびっこ/;
    // 公園そのものを求める深掘り(散歩/芝生/森/ひろびろ/公園)では沈めない
    const parkSeekingCtx = /散歩|芝生|ゴロゴロ|ひろびろ|広々|森|ピクニック|深呼吸|自然の中|公園/.test(effectiveDeepDive || "");
    const isFillerPark = (r: FinalizeRec): boolean => {
      if (parkSeekingCtx) return false;
      const n = r.title ?? "";
      if (hasScenicTag(r) || APPEALING_PARK_RE.test(n)) return false;   // タグ付き絶景・有名/大型/花/記念公園は残す
      return GENERIC_PARK_RE.test(n);                                    // 地味な○○公園/緑地/広場/遊具=最後尾バンドへ
    };
    return [...arr]
      .map(r => ({
        r,
        over: overCap(r),
        filler: isFillerPark(r),
        km: kmOf(r),
        score: (Math.random() * 10)
          + aiRankBoost(r)                       // OpenAI判別順を主signalに（埋もれ防止）
          + weatherBoost(r)
          + photoQualityScore(r)
          + sortRatingBoost(r)                   // 領域2b/3c: ★あり上位・★無後方・薄い★5減点
          + (r.openNow === true ? 2 : 0)         // #7: 営業中の店を優先
          + (r.openNow === false ? -1.5 : 0)     //     営業時間外は控えめに後ろへ
          + ((isCurated(r.source) && !overCap(r)) ? 8 : 0)  // 領域1: 手動追加は近距離キャップ以内のみ満額昇格
          + (goodPlaceNames.has((r.title ?? "").toLowerCase()) ? 1.5 : 0)
          + (hasScenicTag(r) ? 6 : 0),                       // 絶景/映えタグを非フィラー帯の上位へ
      }))
      // 領域1: cap以内(band0)を上位/cap外(band1)は後方。さらに地味公園(filler)を同バンド内で最後尾へ。
      .sort((a, b) => {
        if (a.over !== b.over) return a.over ? 1 : -1;
        if (a.filler !== b.filler) return a.filler ? 1 : -1;   // 地味な公園は同バンド内で最後尾へ（除外でなく後方）
        const ds = b.score - a.score;
        if (Math.abs(ds) > 0.0001) return ds;
        return a.km - b.km;
      })
      .map(x => x.r);
  };

  // お腹すいた 飲食店のみ強制フィルター（温泉/水族館を除外。老舗は喫茶/レトロ系では免除）
  const isFoodMoodReq = isFoodMood;
  // docx仕様「喫茶店・レトロ＝レトロ喫茶店、老舗」のように、ジャンル自体が老舗・レトロを
  // 求めている場合は OLD_STORE 除外を免除する（喫茶/カフェ/レトロ/老舗 を含む深掘り）。
  const wantsRetro = /喫茶|レトロ|老舗|カフェ/.test(effectiveDeepDive);
  const foodSanitize = <T extends { title?: string; address?: string }>(arr: T[]): T[] => {
    if (!isFoodMoodReq) return arr;
    return arr.filter(r =>
      !FINALIZE_NON_FOOD_NAME_RE.test(r.title ?? "") &&
      !FINALIZE_NON_FOOD_NAME_RE.test(r.address ?? "") &&
      (wantsRetro || !FINALIZE_OLD_STORE_NAME_RE.test(r.title ?? ""))
    );
  };

  // 既出スポット除外（再検索時の重複防止）
  const seenLower = new Set(seenPlaces.map(s => s.toLowerCase()));
  const seenFilter = <T extends { title?: string }>(arr: T[]): T[] =>
    showUnseenOnly ? arr.filter(r => !seenLower.has((r.title ?? "").toLowerCase())) : arr;

  // 品質フィルタ（B2B除外 + 写真なし&評価少を除外）
  const qualitySanitize = <T extends { title?: string; photoUrl?: string; photoUrls?: string[]; rating?: number | null; userRatingCount?: number | null; source?: string }>(arr: T[]): T[] =>
    arr.filter(r => {
      const name = r.title ?? "";
      if (FINALIZE_NG_BIZ_RE.test(name)) return false;
      // 心霊は著作権で写真なし・独自スポットでレビュー0件が正常。スプーキー
      // プレースホルダーをUIで表示するため、写真/評価ゲートはスキップ（NG_BIZ除去は維持）。
      if (effectiveDeepDive === "心霊") return true;
      // 領域2a: ★が明確に低く(<3.0)かつ口コミ十分(≥20件)の確実なハズレ店は最終結果から除外。
      //   rating null/0 や口コミ<20件は判定不能として残す（無料方針＝★無/データ薄は下げるだけ）。
      //   心霊/proprietary は上の早期returnで対象外。food分岐の評価ソートには影響しない。
      const ratingVal = typeof r.rating === "number" ? r.rating : null;
      const ratingCnt = typeof r.userRatingCount === "number" ? r.userRatingCount : 0;
      if (ratingVal !== null && ratingVal > 0 && ratingVal < 3.0 && ratingCnt >= 20) return false;
      const hasPhoto = !!r.photoUrl || (Array.isArray(r.photoUrls) && r.photoUrls.length > 0);
      const reviews = typeof r.userRatingCount === "number" ? r.userRatingCount : 0;
      // 写真なし&低評価ゲートは Google/Yahoo の低品質補足のみに適用する。
      //   Supabase(キュレーション:温泉/図書館/観光/滝/道の駅/オープンデータ等)は写真が無く
      //   reviewCountもnullが正常なので、ここで除外すると投入済みの数万件が出なくなる。
      const isSupplement = r.source === "google" || r.source === "yahoo";
      if (!hasPhoto && reviews < 5 && isSupplement) return false;
      return true;
    });

  // 領域4: 家族×飲食 で酒主体の業態（ビアバー/タコス酒場/居酒屋/小料理/スナック等）を抑制。
  //   client が時間帯を送らない(answers.time常に空)ため『昼のみ』判定は不可 → companion=家族 の
  //   食事検索で常時ソフト抑制する。ジャンル深掘りで居酒屋系を明示選択した時(alcoholDeepDive)は
  //   意図尊重で抑制を解除する。
  const isFamilyFood = isFoodMoodReq && (familyCompanion ?? false) && !alcoholDeepDive;
  const FAMILY_ALCOHOL_RE = /ビアバー|ビア・?バー|ビヤホール|ビアホール|タコス(?!ライス)|タケリア|居酒屋|小料理|大衆酒場|酒場|立ち飲み|もつ焼き|ホッピー|ガールズバー|スナック|ダイニングバー|バル$|BAR$|焼き?鳥居酒屋/i;
  const familyFoodSanitize = <T extends { title?: string }>(arr: T[]): T[] =>
    isFamilyFood ? arr.filter(r => !FAMILY_ALCOHOL_RE.test(r.title ?? "")) : arr;

  // #1/#3/#13: ジャンル不一致フィルタ（明確な異ジャンル語を含む店のみ除外＝否定語ベース）。
  // 否定語定義があるジャンルのみ作動。肯定語は要求しないため、名前にジャンル名を含まない
  // 正規店（用心棒・一蘭 等）は除外されない。
  const genreFidelityFilter = <T extends { title?: string }>(arr: T[]): T[] => {
    if (!effectiveDeepDive) return arr;
    // 心霊は地名スポット（八木山橋・恐山等）が大半で名前にジャンル語を含まない。
    // #心霊スポットタグで識別済みなので、名前ベースのジャンルフィルタは掛けない（誤除外防止）。
    if (effectiveDeepDive === "心霊") return arr;
    {
      const cdd = canonDeepDive(effectiveDeepDive);
      if (!GENRE_NEGATIVE_RE[cdd] && !GENRE_POSITIVE_REQUIRED[cdd]) return arr;
    }
    return arr.filter(r => nameMatchesGenre(r.title ?? "", effectiveDeepDive));
  };

  return {
    shuffleArr, applyMallFilter, normalizeName, namesOverlap, pickUnique, finalizeAssembled,
    kmOf, normalizeDistance, stationConsistency, weatherBoost, photoQualityScore, sortOrShuffle,
    foodSanitize, familyFoodSanitize, seenFilter, qualitySanitize, genreFidelityFilter, nonFoodSanitize,
    seenLower, isFoodMoodReq,
    NON_FOOD_NAME_RE: FINALIZE_NON_FOOD_NAME_RE,
  };
}

// 検索メトリクスを search_metrics に記録（Google依存度の可視化）。after()で応答後・失敗無視。
function logSearchMetric(row: Record<string, unknown>): void {
  if (!supabase) return;
  const sb = supabase;
  // google_detail 列が未作成(supabase/search-metrics-detail.sql未適用)でも従来メトリクスを失わないよう、
  // insert失敗時は新列を落として1回だけリトライする。
  const run = async () => {
    const { error } = await sb.from("search_metrics").insert(row);
    if (error && "google_detail" in row) {
      const { google_detail: _drop, ...rest } = row;
      await sb.from("search_metrics").insert(rest).then(() => {}, () => {});
    }
  };
  try { after(async () => { await run().catch(() => {}); }); } catch { void run().catch(() => {}); }
}

// item10: 検索スナップショット。同条件の再検索をパイプライン丸ごとスキップ（最速・最安）。
//   パーソナライズ要素（freeWord/絞り込み/未見のみ）が無い標準検索のみ・短TTLで鮮度を担保。
const SNAPSHOT_TTL_MS = 10 * 60 * 1000;  // 10分
async function readSnapshot(key: string): Promise<Record<string, unknown> | null> {
  if (!supabase || !key) return null;
  try {
    const { data } = await supabase.from("search_snapshots").select("result, created_at").eq("cache_key", key).maybeSingle();
    if (!data?.created_at) return null;
    if (Date.now() - new Date(data.created_at as string).getTime() > SNAPSHOT_TTL_MS) return null;
    return (data.result as Record<string, unknown>) ?? null;
  } catch { return null; }
}
function writeSnapshot(key: string, result: Record<string, unknown>): void {
  if (!supabase || !key) return;
  const sb = supabase;
  const run = () => sb.from("search_snapshots").upsert({ cache_key: key, result, created_at: new Date().toISOString() }).then(() => {}, () => {});
  try { after(async () => { await run(); }); } catch { void run(); }
}
// 標準検索のみキャッシュ対象にし、結果に影響する入力でキーを作る（無ければ "" = キャッシュしない）
// パーソナライズ再ランク(コンシェルジュ)を安全にキャッシュするための「この人固有の好み符号」。
//   プロフィール傾向(userPreferenceHints)＋過去の高評価/苦手(pastFeedback)を短いハッシュに畳む。
//   これをsnapshotキーに混ぜないと「先に検索した人向けの並び」を別人が共有＝誤ったパーソナライズになる。
//   履歴の無い利用者(大多数)は実体ゼロ→ "" を返し、従来どおり mood+座標の共有キャッシュを使う。
function personaSignature(body: Record<string, unknown>): string {
  const hints = Array.isArray(body?.userPreferenceHints) ? (body.userPreferenceHints as unknown[]).map(String) : [];
  const fb = Array.isArray(body?.pastFeedback) ? (body.pastFeedback as Array<{ rating?: number; visitedPlace?: string }>) : [];
  const likes = fb.filter((f) => (f?.rating ?? 0) >= 4 && f?.visitedPlace).map((f) => String(f.visitedPlace));
  const dislikes = fb.filter((f) => (f?.rating ?? 0) > 0 && (f?.rating ?? 0) <= 2 && f?.visitedPlace).map((f) => String(f.visitedPlace));
  const sig = [hints.join("・"), likes.join("・"), dislikes.join("・")].join("|");
  if (sig.replace(/[|]/g, "").trim().length === 0) return "";  // 実体なし＝共有キャッシュ維持
  let h = 5381; for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) | 0;  // djb2
  return "p" + (h >>> 0).toString(36);
}

function buildSnapshotKey(body: Record<string, unknown>, deepDive: string): string {
  const a = (body?.answers ?? {}) as Record<string, unknown>;
  const lat = a.originLat, lng = a.originLng;
  if (typeof lat !== "number" || typeof lng !== "number") return "";
  if (a.freeWord || body?.refinementText || body?.showUnseenOnly || body?.excludeShown) return "";
  if (deepDive === "心霊") return "";  // 心霊は投稿写真が変わるのでキャッシュしない
  return [
    // v3: 座標丸めを2桁(≈1.1km)→3桁(≈110m)に精密化（1km先の別地点と同一キャッシュに
    //     衝突して「すぐそこ」の距離感が狂う誤ヒットを解消・監査2026-07-05）。旧v2を無効化。
    "v3",
    a.mood ?? "", lat.toFixed(3), lng.toFixed(3), a.radiusKm ?? "",
    a.distanceFeeling ?? "", deepDive, a.companion ?? "", a.transport ?? "",
    personaSignature(body),  // 好み履歴のある人だけ専用キャッシュに分岐（無い人は""で共有維持）
  ].join("|");
}

// 暖機(prewarm)用の軽量GET。クイズ開始時にアプリから叩いてコールドスタートを先に済ませる。
//   重い処理はせず即返す。これでサーバーレス関数＋重いトップレベルimportが事前ロードされ、
//   ユーザーが検索する頃には関数が暖まっている＝初回検索のタイムアウトを防ぐ。
export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true, warm: true });
}

// 計測ラッパー: API呼び出しカウンタを用意してハンドラを実行し、最後に1行ログ出力する。
export async function POST(request: Request): Promise<Response> {
  // 濫用/連打によるGoogle課金の爆発を抑止（暫定・ベストエフォート。ハード上限はGoogle Cloudクォータ＋Vercel WAF併用が前提）。
  // 1検索でGoogle課金が十数回発火しうるため、同一IPは60秒20回まで。超過は429で即返し課金を一切走らせない。
  if (!rateLimit(`recommend:${clientIp(request)}`, 20, 60_000)) {
    return new Response(
      JSON.stringify({ error: "rate_limited", message: "リクエストが多すぎます。少し時間をおいてからお試しください。", recommendations: [] }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": "30" } },
    );
  }
  const counts = newApiCounts();
  const t0 = Date.now();
  // メトリクス用に気分/エリアを先読み＋スナップショットキー算出（cloneなので本処理に影響なし）
  let meta: { mood: string; area: string; deepDive: string } = { mood: "", area: "", deepDive: "" };
  let snapKey = "";
  try {
    const b = await request.clone().json();
    const a = b?.answers ?? {};
    // 【修正2026-06-21】キャッシュキーは“最も具体的な深掘り”を使う。
    //   以前は includes("深掘り") の最初の一致＝L1(深掘りカテゴリ)を拾っていたため、同じL1配下の
    //   別L2(和食→海鮮/天ぷら、服→新品/古着、自然の中→森/芝生 等)が同一キーで衝突し、10分以内の
    //   2回目検索が1回目のキャッシュを返していた（深掘りが効かない）。検索本体の effectiveDeepDive
    //   (cleanL2 || cleanL1) と同じ優先順にして衝突を解消する。
    const _ddL2 = (a.dynamicQs ?? []).find((q: { question?: string }) => (q.question ?? "") === "深掘り詳細")?.answer;
    const _ddL1 = (a.dynamicQs ?? []).find((q: { question?: string }) => (q.question ?? "") === "深掘りカテゴリ")?.answer;
    const _ddAny = (a.dynamicQs ?? []).find((q: { question?: string }) => (q.question ?? "").includes("深掘り"))?.answer;
    const ddSpecific =
      (_ddL2 && _ddL2 !== "こだわらない") ? _ddL2
      : (_ddL1 && _ddL1 !== "こだわらない") ? _ddL1
      : (_ddAny ?? "");
    meta = { mood: a.mood ?? "", area: a.selectedArea ?? a.areaLabel ?? "", deepDive: ddSpecific };
    snapKey = buildSnapshotKey(b, meta.deepDive);
  } catch { /* noop */ }

  // スナップショットヒット → パイプライン丸ごとスキップ（API 0・即返却）
  if (snapKey) {
    const hit = await readSnapshot(snapKey);
    if (hit) {
      // キャッシュ応答にも毎回新しい searchId を振る（ファネルで1検索を識別するため）
      const searchId = `s_${t0.toString(36)}_${Math.round((t0 * 9301 + 49297) % 233280).toString(36)}`;
      // ② スナップショット応答にも気分別おすすめ一言を反映（パイプラインをskipするため個別に適用）。
      //   初回生成→再検索(=スナップショット)で確実に blurb が出るようにする。
      const hitRecs = (hit as { recommendations?: unknown }).recommendations;
      const cachedRecs = Array.isArray(hitRecs)
        ? await applyMoodBlurbs(hitRecs as Record<string, unknown>[], moodGroup(meta.mood))
        : hitRecs;
      return NextResponse.json({ ...hit, recommendations: cachedRecs, searchId, _apiCount: { total: 0, cached: true, elapsedMs: Date.now() - t0 } });
    }
  }

  return apiCounterStore.run({ counts }, async () => {
    const res = await handleRecommend(request);
    const total = counts.searchText + counts.searchNearby + counts.geocode + counts.routes + counts.photo + counts.other;
    const elapsed = Date.now() - t0;
    console.log(`[api-count] total=${total} searchText=${counts.searchText} searchNearby=${counts.searchNearby} geocode=${counts.geocode} routes=${counts.routes} photo=${counts.photo} other=${counts.other} elapsed=${elapsed}ms`);
    // 計測値をレスポンスにも埋め込む（_apiCount）。アプリは未知フィールドを無視するため無害。
    let recCount = 0, source = "";
    try {
      const body = await res.clone().json();
      recCount = Array.isArray(body?.recommendations) ? body.recommendations.length : 0;
      source = body?.source ?? "";
      logSearchMetric({
        mood: meta.mood, area: meta.area, deep_dive: meta.deepDive,
        google_calls: counts.searchText + counts.searchNearby + counts.photo + counts.detail,
        google_searchtext: counts.searchText,   // 内訳（¥集計用）: Text Search
        google_nearby: counts.searchNearby,     // 内訳: Nearby Search
        google_photo: counts.photo,             // 内訳: 写真取得
        google_detail: counts.detail,           // 内訳: Place Details(★評価等)。列未作成時はinsert失敗→黙殺(既存挙動)
        // P27: この検索の searchId を記録＝spot_engagement.search_id と突合して実満足度(CTR/ゼロクリック/クリック順位)を集計。
        //   列未作成でも logSearchMetric が列落ちを検知して従来列のみでリトライ＝安全。
        search_id: (body as { searchId?: string })?.searchId ?? null,
        total_calls: total, rec_count: recCount, source, elapsed_ms: elapsed,
      });
      // 8件以上(プロダクト下限)の標準検索をスナップショット保存＝再検索で同じ結果が返り安定＋Google/Yahoo再呼び出しを削減
      //   （旧: >=12 だと多様性フィルタ後に達しないことが多く一度も保存されず、再検索のたびに件数が揺れていた）
      if (snapKey && res.status === 200 && recCount >= 8) writeSnapshot(snapKey, body);
      return NextResponse.json(
        { ...body, _apiCount: { total, ...counts, elapsedMs: elapsed } },
        { status: res.status },
      );
    } catch {
      return res; // JSON以外（エラー等）はそのまま返す
    }
  });
}

async function handleRecommend(request: Request) {
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
    // 「時間潰し」は下の専用パス（#時間潰し優先5件＋全タグからランダム補充）で処理する。
    const wasJikanMood = answers.mood === "時間潰し" || answers.mood === "時間潰したい";
    const pastFeedback = (body?.pastFeedback || []) as FeedbackItem[];
    const seenPlaces = (body?.seenPlaces || []) as string[];
    const showUnseenOnly = body?.showUnseenOnly === true;
    // ファネル計測用: この1検索を識別するID。応答に載せ、フロントが engagement 送信時に同梱する
    //   → 検索→詳細→ナビ→来店 の経路を再構成できる（[[improvement-backlog]] 🟢）。
    const searchId = `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    const refinementText = (body?.refinementText || "") as string;
    const userPreferenceHints = (body?.userPreferenceHints || []) as string[];

    // ── 手動エリア入力の座標解決 ──────────────────────────────────────────────
    // ユーザーが「現在地を使う」ではなくエリア名を手入力した場合（areaMode==='manual'）、
    // 入力されたエリア名をジオコーディングして originLat/originLng を上書きする。
    // これにより以降の全フロー（Supabase空間検索・Google・Yahoo）が
    // 入力エリアの座標を起点に検索されるようになる。
    // （以前は現在地取得済みの座標が残っていると手入力エリアが無視されていた）
    if (answers.areaMode === "manual" && answers.area && answers.area.trim()) {
      try {
        // コスト削減: 住所→座標は不変なので永続キャッシュ（同じ住所の再検索でgeocode不要）
        const geoKey = `geo:${answers.area.trim().slice(0, 100)}`;
        const geoCached = (await ltCacheGetMany([geoKey])).get(geoKey) as { lat: number; lng: number } | undefined;
        if (geoCached && typeof geoCached.lat === "number") {
          answers.originLat = geoCached.lat;
          answers.originLng = geoCached.lng;
        } else {
        // コスト削減: 国土地理院(無料・キー不要)を一次に。住所はGoogleと同等精度。
        // ランドマーク名等で解決できない場合のみGoogle(課金)へフォールバック
        let loc: { lat: number; lng: number } | null = null;
        try {
          const gsiRes = await fetch(
            `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(answers.area.trim())}`,
            { cache: "no-store", signal: AbortSignal.timeout(4000) },
          );
          const gsi = await gsiRes.json().catch(() => null);
          // GSIは有名度順でない（「渋谷」の先頭=福島県猪苗代町渋谷・本番実測）。行政区画優先で選ぶ（lib/gsi-geocode.ts）
          const best = pickGsiResult(gsi, answers.area.trim());
          const coord = best?.geometry?.coordinates;  // [lng, lat]
          if (Array.isArray(coord) && typeof coord[1] === "number") {
            loc = { lat: coord[1], lng: coord[0] };
          }
        } catch { /* GSI失敗 → Google */ }
        if (!loc) {
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          answers.area.trim()
        )}&language=ja&region=JP&key=${apiKey}`;
        const geoRes = await gfetch(geoUrl, { cache: "no-store", signal: AbortSignal.timeout(5000) });
        const geoData = await geoRes.json().catch(() => null);
        loc = geoData?.status === "OK" ? geoData?.results?.[0]?.geometry?.location : null;
        }
        if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
          answers.originLat = loc.lat;
          answers.originLng = loc.lng;
          await ltCachePut(geoKey, { lat: loc.lat, lng: loc.lng });  // 永続(30日)
          console.log(`[recommend] 手動エリア「${answers.area}」→ ${loc.lat}, ${loc.lng}`);
        } else {
          console.warn(`[recommend] 手動エリア「${answers.area}」のジオコーディング失敗（GSI/Google両方）`);
        }
        }
      } catch (e) {
        console.warn("[recommend] 手動エリアのジオコーディングエラー:", e);
      }
    }

    // ── ④ 無料IPジオロケーション: GPS・エリア入力ともに無い場合の最終フォールバック ──
    //   Vercelが無料で付与する x-vercel-ip-latitude/longitude を「だいたいの現在地」に使う
    //   （市区レベル精度。位置なしでレガシー経路に落ちるよりはるかに良い結果になる）
    if (!answers.originLat && !answers.originLng) {
      const ipLat = parseFloat(request.headers.get("x-vercel-ip-latitude") ?? "");
      const ipLng = parseFloat(request.headers.get("x-vercel-ip-longitude") ?? "");
      if (Number.isFinite(ipLat) && Number.isFinite(ipLng) && ipLat > 20 && ipLat < 46) {  // 日本域チェック
        answers.originLat = ipLat;
        answers.originLng = ipLng;
        console.log(`[recommend] IPジオロケーションを現在地フォールバックに使用: ${ipLat}, ${ipLng}`);
      }
    }

    // Supabaseの学習データを取得（全属性で類似ユーザーを特定）
    const { context: globalStatsContext, engagedPlaces, goodVisitedPlaces, badVisitedPlaces } = await fetchGlobalStats(answers);

    // 承認済みユーザー投稿スポット＋タグ別キュレーションスポット＋フィードバック集計を取得
    const [approvedSuggestionsRaw, curatedSpots, moodRatingAgg, engagementAgg, coocData] = await Promise.all([
      fetchApprovedSuggestions(),
      fetchCuratedSpots(),
      fetchMoodRatingAgg(),
      fetchEngagementAgg(),
      fetchCoocBaskets(),   // ⑧ 協調フィルタの素地（device×気分の共起 basket・10分キャッシュ・薄/無なら空）
    ]);
    // 管理者の動作確認用テスト投稿(消し忘れ)を検索結果から常に除外。source=adminで優先注入されるため入口で弾く。
    //   例:「【テスト投稿】動作確認用・すぐ消します」。データは消さず表示だけ抑止(admin画面には残る)。
    const TEST_POST_RE = /テスト投稿|すぐ消します|動作確認用|【テスト】|テスト用/;
    const approvedSuggestions = approvedSuggestionsRaw.filter((s) => !TEST_POST_RE.test(s.spot_name ?? ""));
    // ⑧ 協調フィルタ: このユーザーが過去に高評価した場所(anchors)を起点に、同気分で共起の
    //   強い近縁スポットへ薄く加点する器を作る（learnScore に合成）。anchors無/データ薄なら無効=0。
    const collabAnchors = pastFeedback
      .filter((f) => (f.rating ?? 0) >= 4 && f.visitedPlace)
      .map((f) => String(f.visitedPlace));
    const collabBoost = buildCollabBoost(coocData.baskets, coocData.devices, answers.mood, collabAnchors);
    // 自己改善ループ: 👎除外/降格 ＋ 👍&エンゲージメント昇格(learnScore) ＋ ⑧協調フィルタ の判定器
    const ratingJudge = buildRatingJudge(moodRatingAgg, answers.mood, engagementAgg, collabBoost);

    // 管理者が直接追加したスポット（通常スポット vs チェーン店で分離）。
    // curated_spots（タグ別保管）も admin転載と同じ優先注入対象に含める。
    const adminSpots = [
      ...approvedSuggestions.filter((s) => s.source === "admin" && !s.is_chain),
      ...curatedSpots,
      // 承認済みユーザー投稿（穴場投稿）もタグ一致の優先注入対象に含める。
      //   従来はadminのみ注入され、ユーザーの穴場はメイン検索に出る経路が無かった。
      //   座標必須・#タグ一致・距離設定尊重は既存ロジックがそのまま効く。
      ...approvedSuggestions.filter((s) => s.source !== "admin" && !s.is_chain),
    ];
    const chainSpots = approvedSuggestions.filter((s) => s.source === "admin" && s.is_chain && s.chain_search_query);
    // 公開期間中の期間限定スポット（available_from/until 設定あり・座標あり）。会場カードの上書きに使う。
    const limitedEvents = approvedSuggestions.filter(
      (s) => (s.available_from || s.available_until) && typeof s.lat === "number" && typeof s.lng === "number",
    );

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
    // ⑤ 端末プロファイル: クライアントが算出した「好みタグ」を加点タグへ合流
    //   （お気に入り・高評価の頻度Top5。#始まりのみ受理＝サーバー側でも検証）
    const profileHintTags = userPreferenceHints.filter(h => typeof h === "string" && h.startsWith("#")).slice(0, 5);
    for (const t of profileHintTags) {
      if (!userTags.mustTags.includes(t) && !userTags.niceToHaveTags.includes(t)) {
        userTags.niceToHaveTags.push(t);
      }
    }
    const allUserTags = new Set([...userTags.mustTags, ...userTags.niceToHaveTags]);

    // ── 距離設定（全経路共通）────────────────────────────────────────────────
    //   レガシー/relaxフォールバック経路でも距離バイアスを尊重できるよう関数スコープに配置。
    const DISTANCE_RADIUS_KM: Record<string, number> = {
      "すぐそこ": 1, "近場でいい": 3, "少し歩ける": 5, "近めにお出かけ": 10,
      "今日は出かけたい": 20, "ちょっと遠くてもOK": 40, "県またぎもあり": 70,
      "小旅行気分": 120, "どこでも行きたい": 200,
    };
    // 領域R2: 近め系の距離ハードキャップ(intent基準・km)。これを超える店は最終並びで必ず末尾へ。
    //   クライアントが radiusKm=15 等を送っても intent で締めるため distanceFeeling 優先。
    const DIST_HARDCAP_KM: Record<string, number> = {
      "すぐそこ": 2, "近場でいい": 3, "少し歩ける": 4, "近めにお出かけ": 6, "今日は出かけたい": 10,
    };
    const DISTANCE_MIN_KM: Record<string, number> = {
      // 領域1: 近め系（すぐそこ〜今日は出かけたい）は遠出バイアスを掛けず「近い順」で出す。
      //   以前は 少し歩ける=4 / 近めにお出かけ=8 / 今日は出かけたい=8 と min>0 にしていたため、
      //   sortOrShuffle の far-bias 分岐(遠い順)＋近場再ソート(minRadiusKm===0)の無効化が発火し、
      //   「近めを選んだのに半径外縁の遠い店が上位」になっていた（利用者最頻不満）。
      //   min=0 にすると近場再ソートに乗り近い順が厳守される（候補半径 radiusKm 自体は不変）。
      "すぐそこ": 0, "近場でいい": 0, "少し歩ける": 0, "近めにお出かけ": 0,
      "今日は出かけたい": 0,
      // ちょっと遠くてもOK 以上は意図的な遠出バイアス（far-bias）を維持する。
      "ちょっと遠くてもOK": 32, "県またぎもあり": 56, "小旅行気分": 96, "どこでも行きたい": 160,
    };
    // radiusKm: クイズで選んだ値を最優先。未設定時は交通手段/時間から推定
    const radiusKm = answers.radiusKm
      ? answers.radiusKm
      : answers.distanceFeeling
        ? (DISTANCE_RADIUS_KM[answers.distanceFeeling] ?? getRadiusKmFromTransportAndTime(answers.transport, answers.time))
        : getRadiusKmFromTransportAndTime(answers.transport, answers.time);
    const useQuizRadius = !!(answers.radiusKm || answers.distanceFeeling);
    // 遠端バイアス(minRadiusKm)は距離設定を必ず尊重。「お腹すいた」のみ最寄り優先(0)。
    const minRadiusKm = ((answers.mood === "お腹すいた") || !useQuizRadius)
      ? 0
      : (DISTANCE_MIN_KM[answers.distanceFeeling ?? ""] ?? (radiusKm <= 3 ? 0 : radiusKm * 0.8));

    // ─── 時間潰し 専用パス（2026-07-07仕様確定）──────────────────────────────
    //   仕様: ①#時間潰し付きスポット(利用者投稿・審査合格)を最優先で近い順に5件
    //         ②残り枠は「全ての#」から距離ロジック内(radiusKm)の最寄りプールをランダムに補充し計15件
    //   巨大パイプラインの気分純度フィルタ(AI場違い判定等)は②のランダム混成と相性が悪いため、
    //   自由ワード検索と同様の早期リターンで独立実装する（GPS/エリア座標がある時のみ）。
    if (wasJikanMood && typeof answers.originLat === "number" && typeof answers.originLng === "number") {
      try {
        const { spatialSearch } = await import("@/lib/spatial-search");
        const jLat = answers.originLat, jLng = answers.originLng;
        const [jikanHits, poolHits] = await Promise.all([
          spatialSearch({ mustTags: ["#時間潰し"], fallbackTags: [], lat: jLat, lng: jLng, radiusKm, minRadiusKm: 0, transport: answers.transport, limit: 20, googleApiKey: apiKey }),
          spatialSearch({ mustTags: [], fallbackTags: [], lat: jLat, lng: jLng, radiusKm, minRadiusKm: 0, transport: answers.transport, limit: 60, googleApiKey: apiKey }),
        ]);
        // グローバルブロック済みは除外（管理者が検索から外した場所）
        const jBlocked = new Set<string>();
        if (supabase) {
          try {
            const { data } = await supabase.from("globally_blocked_places").select("spot_name");
            for (const b of (data ?? []) as Array<{ spot_name: string }>) jBlocked.add(b.spot_name);
          } catch { /* ブロック表未作成でも続行 */ }
        }
        const jSeen = new Set(showUnseenOnly ? seenPlaces : []);
        const jOk = (pl: { name: string }) => !jBlocked.has(pl.name) && !jSeen.has(pl.name);
        type JRow = (typeof jikanHits)[number];
        const jUsed = new Set<string>();
        // 時間潰しの質を上げる分類器（2026-07-19）:
        //   ・UNFIT="潰せない/無関係"（地味な史跡マーカー/墓/記念碑・石標/美容・医療）→ ①上位5件・②補充の両方から除外。
        //     （例: 北町奉行所跡・一石橋迷子しらせ石標・アシヤビューティ が #時間潰し に混入していた）
        //   ・FRIENDLY=時間潰し向き（モール/映画/書店/カフェ/娯楽/文化/展望/銭湯 等。カフェは滞在できるので含む）。
        //     ②の補充を FRIENDLY 優先で並べ替え、繁華街で最寄りが飲食店に埋まり"お腹すいた"化するのを防ぐ（各層内はランダム）。
        const JIKAN_UNFIT = /(美容|ビューティ|理容|ヘアサロン|ネイル|エステ|クリニック|医院|歯科|皮膚科|眼科|病院|薬局|記念碑|石碑|石標|奉行所跡|遺跡|古墳|の墓|墓地|霊園)/;
        const JIKAN_FRIENDLY = /(モール|百貨店|デパート|ショッピング|アウトレット|商店街|マルイ|ルミネ|パルコ|ヒカリエ|映画|シネマ|シアター|書店|本屋|ブックオフ|TSUTAYA|蔦屋|図書館|カフェ|喫茶|スタバ|スターバックス|ドトール|コメダ|水族館|美術館|博物館|科学館|プラネタリウム|展望|タワー|ゲームセンター|ゲーセン|カラオケ|ボウリング|漫画喫茶|ネットカフェ|マンガ|アミューズメント|遊園地|温泉|銭湯|サウナ|動物園|植物園|ラウンドワン|ダーツ|ビリヤード)/;
        const JIKAN_FRIENDLY_TAG = /(時間潰し|ショッピング|鑑賞|アミューズメント|カフェ|まったり|博物館|映画|温泉|銭湯|展望|書店)/;
        const jTagStr = (r: JRow) => (r.tags ?? []).join(" ");
        const jikanUnfit = (r: JRow) => JIKAN_UNFIT.test(`${r.name} ${jTagStr(r)}`);
        const jikanFriendly = (r: JRow) => JIKAN_FRIENDLY.test(`${r.name} ${r.category ?? ""} ${r.description ?? ""} ${jTagStr(r)}`) || JIKAN_FRIENDLY_TAG.test(jTagStr(r));
        const jShuffle = (arr: JRow[]) => { for (let i = arr.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [arr[i], arr[k]] = [arr[k], arr[i]]; } return arr; };
        // ① #時間潰し 最優先: "潰せない/無関係"を除いて近い順に最大5件
        const jikanTop = jikanHits.filter(jOk).filter(pl => !jikanUnfit(pl))
          .sort((a, b) => (a.distanceM ?? 9e9) - (b.distanceM ?? 9e9)).slice(0, 5);
        jikanTop.forEach(pl => jUsed.add(pl.name));
        // ② 残り: 距離内プールから補充。時間潰し向き(FRIENDLY)を先頭に寄せ、不足分だけ他カテゴリで埋める（各層ランダム）。UNFITは除外。
        const jRestPool = poolHits.filter(pl => jOk(pl) && !jUsed.has(pl.name) && !jikanUnfit(pl));
        const jRest = [...jShuffle(jRestPool.filter(jikanFriendly)), ...jShuffle(jRestPool.filter(pl => !jikanFriendly(pl)))];
        const jTake = jRest.slice(0, Math.max(0, 15 - jikanTop.length));
        const toJikanRec = (r: JRow, isJikan: boolean) => {
          const googlePlaceId = r.id && !r.id.startsWith("sb-") ? r.id : undefined;
          const supabaseUUID = r.id?.startsWith("sb-") ? r.id.replace(/^sb-/, "") : undefined;
          return {
            title: r.name,
            address: r.address,
            photoUrl: wrapWithPhotoProxy(r.imageUrl || ""),
            photoUrls: (r.photoUrls ?? []).map(wrapWithPhotoProxy),
            rating: r.rating ?? null,
            userRatingCount: r.reviewCount ?? null,
            openNow: r.openNow ?? undefined,
            openStatusBadge: r.openNow === true ? "営業中" : (r.openNow === false ? "営業時間外" : undefined),
            openingHoursText: r.openingHours ?? undefined,
            mapUrl: r.googleMapsUrl,
            googleMapsUrl: r.googleMapsUrl,
            reason: pickReason(r.name, ((r as { tags?: string[] }).tags ?? []), r.address, r.description),
            aiReason: undefined,
            features: isJikan ? ["#時間潰し"] : [],
            distanceText: r.distanceInfo,
            distanceKm: typeof r.distanceM === "number" ? r.distanceM / 1000 : undefined,
            distanceM: r.distanceM,
            lat: typeof r.lat === "number" ? r.lat : undefined,
            lng: typeof r.lng === "number" ? r.lng : undefined,
            durationText: "",
            stationText: r.stationInfo || "",
            vibe: "", budget: "", time: "",
            priceLevel: r.priceLevel ?? undefined,
            placeId: googlePlaceId,
            supabaseId: supabaseUUID,
            source: "admin",
            isUserSpot: false, hasUserPhotos: false, userPhotoCount: 0,
            routesByMode: undefined,
            tags: [] as string[],
          };
        };
        const jikanRecsRaw = [...jikanTop.map(r => toJikanRec(r, true)), ...jTake.map(r => toJikanRec(r, false))];
        // P17: 同一複合施設の重複を畳む（梅田ヒルトンプラザ×3・LUCUA×2等）。時間潰しパスはpickUniqueを通らないため個別に。
        //   核名(棟/イースト・ウエスト等を剥がす)一致＋近接(≤400m)、または同名近接を1件に。保守的=別スポットは残す。
        const jNorm = (s: string) => (s ?? "").normalize("NFKC").toLowerCase().replace(/[^0-9a-z぀-ヿ一-鿿ｦ-ﾟ]+/g, "");
        const jCore = (s: string) => { const k = jNorm(s); const c = k.replace(/(イースト|ウエスト|ウェスト|ノース|サウス|セントラル|east|west|north|south|central|別館|本館|新館|東館|西館|南館|北館|[東西南北]棟|[a-z]棟)+$/i, ""); return c.length >= 4 ? c : k; };
        const jSeenCore: { core: string; lat?: number; lng?: number }[] = [];
        const jikanRecs = jikanRecsRaw.filter(r => {
          const core = jCore(r.title); const lat = r.lat, lng = r.lng;
          for (const e of jSeenCore) {
            if (e.core !== core || core.length < 4) continue;
            if (lat == null || lng == null || e.lat == null || e.lng == null) return false;   // 座標欠損は核一致で畳む
            if (haversineMeters(lat, lng, e.lat, e.lng) <= 400) return false;                  // 核一致＋近接=同一施設
          }
          jSeenCore.push({ core, lat: lat ?? undefined, lng: lng ?? undefined });
          return true;
        });
        await applyUserPhotos(jikanRecs as unknown as UserPhotoRec[]);
        return json({
          recommendations: await attachAvailability(jikanRecs, moodGroup(answers.mood)),
          source: "supabase-jikan",
          searchId,
          usedAI: false,
          widenedSearch: false,
          warning: jikanRecs.length === 0
            ? "近くにスポットが見つかりませんでした。距離を広げてお試しください。" : "",
        });
      } catch (err) {
        console.error("[recommend] 時間潰し専用パス失敗 → 通常フローへ:", err);
      }
    }

    // ─── Supabase-first メインフロー ───────────────────────────────────────────
    // placesテーブルを主軸に検索し、Google Placesで補足検索
    // GPS使用時はクイズの距離感（radiusKm）を優先使用 + 遠端バイアスで近すぎる場所を後回し
    try {
      // ─── freeWord → OpenAI → Google Maps フロー ──────────────────────────
      // 自由ワードがある場合は OpenAI にスポット提案を依頼し Google で実在確認して返す
      // ③ 蒸留ルール: 昇格済みパターンに一致したら構造化ヒントを適用（skip_llm時はLLM省略）
      let fwRuleSkipLlm = false;
      let fwRuleTextHint = "";
      if (answers.freeWord) {
        const rules = await fetchFreewordRules();
        const fwLower = answers.freeWord.toLowerCase();
        const hit = rules.find(r => r.pattern && fwLower.includes(r.pattern.toLowerCase()));
        if (hit) {
          fwRuleTextHint = hit.text_hint ?? "";
          fwRuleSkipLlm = !!hit.skip_llm;
        }
      }
      // 通常の自由ワード/絞り込みは Supabase から提案する（下のSB-firstでテキスト一致を合流）。
      //   OpenAIに架空生成を頼るのは「AI相談」と「人数指定（個室/宴会＝構造化検索が苦手）」のみ。
      const fwHasParty = /([0-9０-９]{1,2})\s*(?:人|名)/.test(answers.freeWord ?? "");
      if (answers.freeWord && openai && !fwRuleSkipLlm && (answers.aiChat || fwHasParty)) {
        const fwRecs = await buildFreeWordRecommendations(
          answers, apiKey, openai, seenPlaces, showUnseenOnly, pastFeedback
        );
        // AI相談は構造化検索へのフォールバックが効かない（mood="AI相談"）ため1件でも返す。
        // 通常freeWordは検証後5件未満なら、freeWordを織り込んだ構造化検索に任せた方が高品質。
        const fwPartySize = ((answers.freeWord ?? "").match(/([0-9０-９]{1,2})\s*(?:人|名)/) ?? [])[1];
        const fwMinCount = answers.aiChat ? 1 : (fwPartySize ? 3 : 5);  // 人数指定は構造化が解釈できないためAI結果を優先採用
        if (fwRecs.length >= fwMinCount) {
          await applyUserPhotos(fwRecs as unknown as UserPhotoRec[]);
          diversifyByCategory(fwRecs as unknown as DivRec[]);
          return json({
            recommendations: await attachAvailability(fwRecs, moodGroup(answers.mood)),
            source: answers.aiChat ? "ai_chat" : "ai_freeword",
            usedAI: true,
            warning: "",
          });
        }
      }

      const { spatialSearch } = await import("@/lib/spatial-search");
      const allMustTags = [...userTags.mustTags];
      const sbNiceTags  = [...userTags.niceToHaveTags];

      // ── Supabase 検索タグ戦略 ──────────────────────────────────────────────
      // mustTags の先頭は気分タグ（#まったりしたい 等）、2番目以降が深掘りカテゴリタグ
      // 【問題】気分タグをmustTagsに含めると「全気分対応」タグを持つスポットが
      //         どの気分でも同じように返ってきてしまう（毎回同じ結果の原因）
      // 【解決】深掘りタグがある場合 → 深掘りタグのみで検索（より具体的に絞り込み）
      //         深掘りタグがない場合  → 気分タグで検索（従来通り）
      // 気分タグ（#まったりしたい 等）。extractUserTagsFromAnswers は深掘りタグがある時これを
      //   niceToHave へ降格するため、通常 allMustTags には含まれない。万一含まれても確実に除く。
      const realMoodTag = MOOD_SHORT_KEY_TO_TAG[answers.mood ?? ""]
        ?? Object.entries(MOOD_TAG_MAP).find(([, v]) => v === answers.mood)?.[0];
      // 深掘りで追加された実タグ（気分タグを除いた残り）。
      // 【修正2026-06-20】以前は deepDiveTags = allMustTags.slice(1)（先頭=気分タグ前提）だったが、
      //   extractUserTagsFromAnswers は気分タグを既に降格するため allMustTags の先頭は「最初の深掘りタグ」。
      //   slice(1) はそれを誤って捨て、複数タグ深掘りの“主タグ”を落としていた（監査で発覚）:
      //     サウナ・岩盤浴 [#サウナ,#岩盤浴]→[#岩盤浴] で #サウナ(1309件)喪失／外でひろびろ [#外で運動,
      //     #スポーツ,#ゴルフ]→#外で運動喪失／観て楽しむ [#鑑賞,#博物館,#水族館,#動物園]→#鑑賞喪失。
      //   気分タグを filter で除いた集合をそのまま使う（単一・複数いずれも正しい）。
      const realDrillTags = realMoodTag ? allMustTags.filter(t => t !== realMoodTag) : allMustTags;
      const deepDiveTags = realDrillTags;
      const sbMustTags   = deepDiveTags.length > 0
        ? deepDiveTags                                          // 深掘りタグのみで絞り込み
        : (moodGroup(answers.mood) === "focus")
          // 集中×こだわらない/深掘りなし: 気分タグ(#集中したい)だけだと都心の最寄り20件が
          //   チェーンカフェ偏重→ブランド/サブカテcapで8件に痩せる。作業カフェ(#カフェ作業=
          //   admin厳選)と自習(#勉強場)をOR合流し、カフェで作業経路と同等の多様な15件を確保する。
          //   ※カフェで作業/静か専用は各自のdeepDiveTagsを使うのでこの分岐に来ず不変。
          ? [...new Set([...allMustTags, "#カフェ作業", "#勉強場"])]
          : allMustTags;                                        // 気分タグのみ（深掘りなし）
      // 在庫の薄いL2/L1タグ（#オムライス18 / #あっさりラーメン14 / #フルーツ51 等）で枯れた時だけ、
      //   同ジャンルの“親タグ”で補う＝Google補完ではなく自前DB（同ジャンル）で15件を埋める。
      //   spatialSearch は mustTags が limit 未満のときのみ fallback を使う＝在庫豊富な親では発火せず既存動作不変。
      //   純度は後段 dbGenreOk(nameMatchesGenre) が担保＝異ジャンルは混入しない。
      const ddL1ForFb = (answers.dynamicQs ?? []).find(q => q.question === "深掘りカテゴリ")?.answer || "";
      const ddForFb = ((answers.dynamicQs ?? []).find(q => q.question === "深掘り詳細")?.answer || ddL1ForFb);
      // L1カテゴリ → 親ジャンルタグ（希少サブジャンルのDB完結用フォールバック）
      const PARENT_GENRE_FALLBACK: Record<string, string[]> = {
        "ラーメン": ["#ラーメン"], "洋食": ["#洋食"], "居酒屋": ["#居酒屋"], "焼肉": ["#焼肉"],
        "和食": ["#和食"], "アジア系統": ["#アジア系統"], "各国料理": ["#各国料理"],
        "カフェスイーツ": ["#カフェスイーツ"], "カフェ": ["#カフェスイーツ"],
        "動物カフェ": ["#動物カフェ"], "温泉スパ": ["#温泉", "#サウナ"],
      };
      const sbFallbackTags: string[] =
        ddForFb === "静かな専用スペースで集中したい" ? ["#図書館", "#勉強場", "#集中したい"]
        : ddForFb === "コスメ・美容"                 ? ["#ショッピング"]
        : (PARENT_GENRE_FALLBACK[ddL1ForFb] ?? []);

      // 公園系深掘り（#大型公園を要求）は、最寄り順fetchだと近所の小公園で枠が埋まり、少し離れた
      //   有名公園(代々木公園/砧公園等)が候補から漏れる。wikidata著名公園に付与した #名所公園 を
      //   別枠で取得して合流し、有名公園の取りこぼし→Google補完誘発を防ぐ。
      const needsProminenceFetch = realDrillTags.includes("#大型公園");

      const hasLocation = !!(answers.originLat && answers.originLng);
      const isFoodMood = answers.mood === "お腹すいた";

      // A-4: お腹すいた時はSupabaseも近場キャップ（最大10km）。
      // クイズで「今日は出かけたい(20km)」を選んでいても、食事は近場が優先。
      // 高層ビル料理は「目的地型グルメ」: 最寄り優先の10kmキャップを適用しない
      //   （展望レストランは都心部に集中し、近所のラーメン店で埋まる事故の元だった）
      const isDestinationFood = (answers.dynamicQs ?? []).some(q => q.answer?.includes("高層ビル料理"));
      const sbRadiusKm = (isFoodMood && !isDestinationFood) ? Math.min(radiusKm, 10) : radiusKm;

      // D-4: 天気情報をSupabase-firstパスでも取得（屋内/屋外ソート補正に使用）
      const sbWeather = hasLocation
        ? await getWeatherContext(answers.originLat, answers.originLng).catch(() => ({} as WeatherContext))
        : {} as WeatherContext;
      const isRainyNow = isRainLikeWeather(sbWeather.weatherCode);
      const isSnowyNow = isSnowLikeWeather(sbWeather.weatherCode);
      const isBadWeather = isRainyNow || isSnowyNow;

      // 心霊は登録数が少なく地名ジオコーディングで県庁等に丸まりがち。遠出バイアス(minRadiusKm)で
      // 近すぎるスポットを除外すると0件になりやすいので、心霊は遠出バイアスを無効化し近い順で出す。
      const isShinreiDeepDive = (answers.dynamicQs ?? []).some(q => (q.question ?? "").includes("深掘り") && q.answer === "心霊");
      const sbMinRadiusKm = isShinreiDeepDive ? 0 : minRadiusKm;

      // Supabase 検索: radiusKm を上限、minRadiusKm を遠端バイアスとして渡す。
      // → "近場でいい(min0)" なら近い順、"県またぎもあり(min56)/小旅行(min96)" なら
      //    その距離以上を優先（遠出したい意図を尊重）。お腹すいた・近距離設定は min0=近い順。
      //   ※ 以前は minRadiusKm:0 をハードコードしていたため、距離設定に関わらず
      //     Supabase結果が常に近場優先になり「距離ロジックが効かない」不具合だった。
      let sbResults = await spatialSearch({
        mustTags: sbMustTags,
        fallbackTags: sbFallbackTags,  // 気分タグにフォールバック（深掘りタグが0件の場合）
        lat: answers.originLat ?? 0,
        lng: answers.originLng ?? 0,
        radiusKm: sbRadiusKm,  // A-4: 食事は近場キャップ適用
        minRadiusKm: sbMinRadiusKm,  // 心霊は遠出バイアス無効（近い順で確実に出す）
        transport: answers.transport,
        // コスト削減B: Supabaseが充足したらGoogle/Yahooをスキップするため多めに取得。
        // 再検索(showUnseenOnly)時は既出分(seenPlaces)が後段で除外され在庫が痩せるため、
        //   既出件数だけ取得上限を引き上げ「他のスポットを見る」の枯渇・同一反復を防ぐ(上限60)。
        limit: showUnseenOnly ? Math.min(20 + seenPlaces.length, 60) : 20,
        googleApiKey: apiKey,
      });

      // ── 公園系: 著名(#名所公園)公園を別枠で必ず候補に入れる ──────────────────────────
      //   #大型公園 は小公園含む過剰タグ。最寄り順fetchだと近所の小公園で枠が埋まり、少し離れた
      //   有名公園(代々木公園/砧公園等)が候補から漏れて sbQualified<8→Google補完を誘発していた。
      //   wikidata著名公園に付与した #名所公園 で別枠取得し合流＝有名公園を確実に拾う。
      if (hasLocation && needsProminenceFetch) {
        try {
          const promHits = await spatialSearch({
            mustTags: ["#名所公園"], fallbackTags: [],
            lat: answers.originLat ?? 0, lng: answers.originLng ?? 0,
            radiusKm: sbRadiusKm, minRadiusKm: sbMinRadiusKm,
            transport: answers.transport, limit: 20, googleApiKey: apiKey,
          });
          const have = new Set(sbResults.map(r => r.name));
          for (const t of promHits) {
            if (have.has(t.name)) continue;
            if (((t.distanceM ?? 0) / 1000) < sbMinRadiusKm) continue;  // 遠出バイアス尊重
            sbResults.push(t); have.add(t.name);
          }
        } catch { /* 著名公園取得失敗は通常候補で続行 */ }
      }


      // ── 自由ワード/絞り込み: Supabaseのテキスト一致スポットを候補に合流 ──────────────
      //   気分タグ検索とは別軸で、freeWord/refinement の語に合う実在DBスポットを拾い、
      //   後段の OpenAI 並べ替え(sbAiOrder)が「希望」を見て上位化する。OpenAIに架空生成させない。
      // （心霊などの独自データ専用モードは後段 scoredPool で #タグ一致に絞られるため、ここで混ぜても安全）
      if ((answers.freeWord || refinementText) && hasLocation) {
        try {
          // ②自由ワードをOpenAIで解釈 → (a)検索語でテキスト一致 (b)気分タグでタグ一致 を候補に合流。
          const interp = await interpretFreeword([answers.freeWord, refinementText].filter(Boolean).join(" "));
          const { searchPlacesByText } = await import("@/lib/spatial-search");
          // 意味検索クエリ（気分＋自由文＋同行者＋解釈キーワード）。embedding未整備なら semanticSearchPlaces が[]を返す。
          const semQuery = [answers.mood, answers.freeWord, refinementText, answers.companion, interp.keywords.join(" ")].filter(Boolean).join(" ");
          const [semHits, textHits, tagHits] = await Promise.all([
            semanticSearchPlaces(semQuery, answers.originLat!, answers.originLng!, sbRadiusKm, answers.transport, 30),
            interp.keywords.length
              ? searchPlacesByText({ keywords: interp.keywords, lat: answers.originLat!, lng: answers.originLng!, radiusKm: sbRadiusKm, transport: answers.transport, limit: 30 })
              : Promise.resolve([]),
            interp.moodTags.length
              ? spatialSearch({ mustTags: [], fallbackTags: interp.moodTags, lat: answers.originLat!, lng: answers.originLng!, radiusKm: sbRadiusKm, minRadiusKm: sbMinRadiusKm, transport: answers.transport, limit: 20, googleApiKey: apiKey })
              : Promise.resolve([]),
          ]);
          const have = new Set(sbResults.map(r => r.name));
          for (const t of [...semHits, ...textHits, ...tagHits]) {
            if (have.has(t.name)) continue;
            // ③ 意味検索由来の弱マッチは除外(text/tag由来はsim無し=1で通過)。
            //   0.25はtext-embedding-3-smallでほぼ全通しだった→0.35へ引き上げ(2026-07-17監査・自由文は意図があるため控えめ)。
            if ((t.semanticSim ?? 1) < 0.35) continue;
            if (((t.distanceM ?? 0) / 1000) < sbMinRadiusKm) continue;  // 遠出バイアス尊重
            sbResults.push(t); have.add(t.name);
          }
        } catch { /* 解釈/テキスト検索失敗は気分タグ候補のみで続行 */ }
      }

      // ── ③ セマンティック検索を「気分のみ検索」でも併走（看板機能を最頻ケースで発火）──
      //   自由文がある時は上の②ブロックで意味検索済み→ここは自由文なしの時だけ実行(二重embed回避)。
      //   気分・深掘り・同行者・niceタグの自然文をembed→match_places_semanticで半径内の意味的近傍を取得し、
      //   similarity>=0.25 のみ合流（弱マッチのノイズとAI判別/理由コストを抑制）。純度は後段 nameMatchesGenre が担保。
      // 【P1 2026-07-19】RECOMMEND_SEMANTIC_ALWAYS=1(＋fix-semantic-search-perf.sql適用) なら常時融合＝
      //   気分だけ検索でも毎回セマンティック近傍を合流し「タグ語彙に無い気分(エモい夕暮れ等)」を拾う。
      //   RPCは索引フレンドリー化で高速(半径先行の厳密kNN)＝タイムアウト解消。深掘り時も融合する。
      //   未設定(既定)＝従来どおり在庫が薄い時(＜15件・深掘り無し)だけ発火＝SQL未適用でも回帰なし。
      if (!answers.freeWord && !refinementText && hasLocation && openai
          && (SEMANTIC_ALWAYS || (sbResults.length < 15 && deepDiveTags.length === 0))) {
        try {
          const _ddL2 = (answers.dynamicQs ?? []).find(q => q.question === "深掘り詳細")?.answer ?? "";
          const _ddL1 = (answers.dynamicQs ?? []).find(q => q.question === "深掘りカテゴリ")?.answer ?? "";
          const _dd = (_ddL2 && _ddL2 !== "こだわらない") ? _ddL2 : (_ddL1 !== "こだわらない" ? _ddL1 : "");
          const semQuery = [answers.mood, _dd, answers.companion, ...sbNiceTags.map(t => t.replace(/^#/, ""))].filter(Boolean).join(" ");
          const semHits = await semanticSearchPlaces(semQuery, answers.originLat!, answers.originLng!, sbRadiusKm, answers.transport, 30);
          const have = new Set(sbResults.map(r => r.name));
          for (const t of semHits) {
            if (have.has(t.name)) continue;
            // 弱い意味マッチは除外。気分のみ検索は自由文の意図が無いぶん厳しめ:
            //   0.25→0.45(2026-07-17監査: 在庫薄エリアでサウナ/100均級の無関係が0.25を通過していた)。
            //   気分タグを実際に持つスポットは類似度に関係なく合流させる(正当ヒットを守る)。
            const hasMoodTag = !!realMoodTag && Array.isArray(t.tags) && t.tags.includes(realMoodTag);
            if (!hasMoodTag && (t.semanticSim ?? 0) < 0.45) continue;
            if (((t.distanceM ?? 0) / 1000) < sbMinRadiusKm) continue;  // 遠出バイアス尊重
            sbResults.push(t); have.add(t.name);
          }
        } catch { /* 意味検索失敗はタグ/名前候補のみで続行 */ }
      }

      // ── C: 名前ベース取得でタグ語彙ミスマッチを救済 ─────────────────────────────
      //   深掘りに名前定義(DEEPDIVE_SEARCH_KEYWORDS)がある場合、タグに依存せず
      //   name/description 一致で実在SBスポットを拾い候補へ合流（重複排除）。
      //   例: 観て楽しむ→#鑑賞タグが薄くても「○○博物館/美術館/水族館/動物園」を名前で拾う。
      //   最終純度は後段の nameMatchesGenre(sbQualified/scoredPool) が担保＝異ジャンルは混入しない。
      //   AIに渡す候補数は後段で正規化されるためトークン増はほぼ無し（追加はDB照会1回）。
      if (hasLocation) {
        const ddL1n = (answers.dynamicQs ?? []).find(q => q.question === "深掘りカテゴリ")?.answer ?? "";
        const ddL2n = (answers.dynamicQs ?? []).find(q => q.question === "深掘り詳細")?.answer ?? "";
        const ddKeyN = (ddL2n && ddL2n !== "こだわらない") ? ddL2n : (ddL1n !== "こだわらない" ? ddL1n : "");
        // ── 領域7: 多様化供給。在庫の厚い1サブカテ(カラオケ/図書館/博物館)が距離順上位を占有し
        //   結果が単調化する。サブカテゴリ別に各数件取得→ラウンドロビン合流して、薄いサブカテ
        //   (ボウリング/水族館/自習室等)も候補プールに必ず乗せる。全てSB名前検索=無料。
        //   純度は後段 nameMatchesGenre / finalizeAssembled が担保。subcat未定義の深掘りは従来の nameKws のみ。
        const subcatMap = ddKeyN
          ? (DEEPDIVE_SUBCATEGORY_KEYWORDS[ddKeyN] ?? DEEPDIVE_SUBCATEGORY_KEYWORDS[canonDeepDive(ddKeyN)])
          : undefined;
        if (subcatMap && answers.originLat != null && answers.originLng != null) {
          try {
            const { searchPlacesByText } = await import("@/lib/spatial-search");
            const PER_SUBCAT = 6;
            const perSubHits = await Promise.all(
              Object.values(subcatMap).map(kws => searchPlacesByText({
                keywords: kws, lat: answers.originLat!, lng: answers.originLng!,
                radiusKm: sbRadiusKm, transport: answers.transport, limit: PER_SUBCAT,
              }).catch(() => []))
            );
            const have = new Set(sbResults.map(r => r.name));
            let added = true;
            for (let idx = 0; added; idx++) {
              added = false;
              for (const hits of perSubHits) {
                const t = hits[idx];
                if (!t || have.has(t.name)) continue;
                sbResults.push(t); have.add(t.name); added = true;
              }
            }
          } catch { /* サブカテ取得失敗は従来の nameKws 合流で続行 */ }
        }
        const nameKws = ddKeyN
          ? (DEEPDIVE_SEARCH_KEYWORDS[ddKeyN] ?? DEEPDIVE_SEARCH_KEYWORDS[canonDeepDive(ddKeyN)] ?? [])
          : [];
        // 領域7: subcatMap を使った深掘りでは旧 nameKws 合流をスキップ。
        //   nameKws(例 王道で遊ぶ=テーマパーク/遊園地/カラオケ)は1プールOR→距離順で在庫最厚の
        //   カラオケを30件再投入し、ラウンドロビンで作った多様性を打ち消すため(本番でカラオケ再増殖を確認)。
        if (!subcatMap && nameKws.length > 0) {
          try {
            const { searchPlacesByText } = await import("@/lib/spatial-search");
            const nameHits = await searchPlacesByText({
              keywords: nameKws,
              lat: answers.originLat!, lng: answers.originLng!,
              radiusKm: sbRadiusKm, transport: answers.transport, limit: 30,
            });
            const have = new Set(sbResults.map(r => r.name));
            for (const t of nameHits) {
              if (have.has(t.name)) continue;
              // 距離は後段の sbDistCapKm(上限) と sortOrShuffle(近/遠の好み) が扱う
              //   （searchPlacesByText は既に半径内に限定済み。ここで遠出バイアスの
              //    ハード除外をすると近くの博物館/陶芸等を全部落としてしまうため行わない）。
              sbResults.push(t); have.add(t.name);
            }
          } catch { /* 名前検索失敗はタグ候補のみで続行 */ }
        }
      }

      // Supabase が 0 件でも GPS がある場合は Google 補足で賄う（レガシーフローへの落下を防ぐ）
      if (sbResults.length >= 1 || hasLocation) {
        // 予算による価格フィルター（priceLevel が取得できている場合のみ適用）
        const priceLevelCost: Record<string, number> = {
          "無料": 0, "￥": 1000, "￥￥": 3500, "￥￥￥": 8000, "￥￥￥￥": 15000,
        };
        const budgetMax = answers.budget ?? Infinity;
        const budgetFiltered = sbResults.filter(r => {
          if (budgetMax >= 10000) return true;          // 予算10,000円以上 → フィルタなし
          if (!r.priceLevel) return true;              // 価格不明 → 通過
          return (priceLevelCost[r.priceLevel] ?? 0) <= budgetMax;
        });
        // フィルタ後に0件になった場合は元のリストにフォールバック（価格不明スポットが多い場合を想定）
        const sbPool = (budgetFiltered.length >= 1 ? budgetFiltered : sbResults)
          .filter(r => !seenPlaces.includes(r.name) || !showUnseenOnly);

        // deepDiveL1 / L2 を dynamicQs から取得（Google/Yahoo 検索精度向上に使用）
        const deepDiveL1 = (answers.dynamicQs ?? []).find(q => q.question === "深掘りカテゴリ")?.answer ?? "";
        let deepDiveL2 = (answers.dynamicQs ?? []).find(q => q.question === "深掘り詳細")?.answer ?? "";
        // ユーザーが明示的にドロップダウン深掘りを選んだか(freeWord由来の昇格を含めない生の値で判定)。
        //   freeWordハードジャンルフィルタは「明示深掘り無し」時のみ作動させる(明示選択を尊重)。
        const hasDropdownDeepDive = (!!deepDiveL1 && deepDiveL1 !== "こだわらない") || (!!deepDiveL2 && deepDiveL2 !== "こだわらない");
        // freeWordに人数指定があり食事系の場合、構造化検索のテキストクエリを宴会系に誘導
        //   （AI経路が不調で構造化に落ちた際も「7人で話せる」を解釈できるように）
        if (isFoodMood && !deepDiveL2 && /[4-9０-９]\s*(?:人|名)|[1-9][0-9]\s*(?:人|名)/.test(answers.freeWord ?? "")) {
          deepDiveL2 = "個室 宴会できる居酒屋";
        }
        // ③ 蒸留ルールのテキストヒント（昇格パターン）を最優先で適用
        if (fwRuleTextHint && !deepDiveL2) deepDiveL2 = fwRuleTextHint;
        // L2 がより具体的なカテゴリを指す場合（動物カフェ・波の音と海風 etc.）は L2 を優先
        // "こだわらない" は検索キーとして使えないので除外し、上位カテゴリにフォールバック
        const cleanL2 = (deepDiveL2 && deepDiveL2 !== "こだわらない") ? deepDiveL2 : "";
        const cleanL1 = (deepDiveL1 && deepDiveL1 !== "こだわらない") ? deepDiveL1 : "";
        const effectiveDeepDive = cleanL2 || cleanL1;

        // API-only deepDive（動物カフェ・ブックカフェ等）の判定
        // deepDiveTags が空 かつ deepDive が指定されている場合、Supabase は気分タグで
        // カテゴリ無関係なスポットを返してしまう。Google/Yahoo 専用検索に委ねるため
        // Supabase 結果は最終マージでフォールバック扱いにする。
        //   ただし DEEPDIVE_SEARCH_KEYWORDS で名前ベース取得できる深掘り（高所/絶叫/体験型 等＝
        //   DRILLタグは無いが「展望台/遊園地/VR」等の名前定義がある）は、名前合流でSBが
        //   ジャンル適合の在庫を持つため API専用扱いにしない（SBもG/Yと対等に競わせる）。
        const hasNameKw = !!(effectiveDeepDive &&
          (DEEPDIVE_SEARCH_KEYWORDS[effectiveDeepDive] || DEEPDIVE_SEARCH_KEYWORDS[canonDeepDive(effectiveDeepDive)]));
        // realDrillTags（気分タグを除いた真の深掘りタグ）で判定。deepDiveTags(slice1)だと単一深掘りで
        //   誤って空になりSB在庫を捨てていた。気分タグだけ(カフェ等=意図的API-only)は realDrillTags=[] を維持。
        const isApiOnlyDeepDive = !!(effectiveDeepDive && realDrillTags.length === 0 && !hasNameKw);

        // 距離キャップ厳守（修正2）: spatialSearch の 1.5倍backfill 等で選択半径を超えた
        // 遠方の places スポット（source="admin"ラベルを含む）を除外する。
        // 許容は sbRadiusKm × 1.15（Google補足検索の maxDistKm と同じ係数で整合）。
        //
        // 【重要】spatialSearch の返却は lat/lng が null のケースがある（distance_m は別途PostGISが算出）。
        //   そのため距離判定はまず distanceInfo("...で約X分 / 15.8km") のkm値を最優先で使い、
        //   無い場合のみ lat/lng の haversine にフォールバックする。
        //   （従来は lat/lng のみ見ていたため null 時に遠方店が素通りしていた）
        const sbDistCapKm = sbRadiusKm * 1.15;
        const parseKmFromDistanceInfo = (info?: string | null): number | null => {
          if (!info) return null;
          const m = info.match(/\/\s*([\d.]+)\s*km/);
          return m ? parseFloat(m[1]) : null;
        };
        const sbPoolCapped = sbPool.filter(r => {
          let dkm = parseKmFromDistanceInfo(r.distanceInfo);
          if (dkm === null
              && typeof r.lat === "number" && typeof r.lng === "number"
              && typeof answers.originLat === "number" && typeof answers.originLng === "number") {
            dkm = haversineMeters(answers.originLat, answers.originLng, r.lat, r.lng) / 1000;
          }
          if (dkm === null) return true;  // 距離不明は通す（回帰防止）
          return dkm <= sbDistCapKm;
        });

        // ── コスト削減B: Supabaseが充足したらGoogle/Yahoo補足をスキップ ──────────────
        //   Supabase(places)の検索は安価。ジャンル・飲食適合する在庫が十分あるなら、
        //   高額な Google/Yahoo 補足検索を呼ばずに Supabase だけで15件を組む。
        //   sbQualified = 距離キャップ後のSupabaseのうち、ジャンル＆飲食フィルタを通る件数。
        const isFoodForSkip = answers.mood === "お腹すいた";
        // ── 心霊の深掘りのみ独自データで戦う（Google/Yahoo不使用・15件埋めもしない）──
        //   ユーザー指示: 心霊だけ places保存庫(#心霊スポット)＋穴場投稿＋admin転載で検索。
        //   絶叫/高所/体験型は従来どおりGoogle/Yahooも使う。ヒットが少なくても1件でも表示。
        const isProprietaryOnly = effectiveDeepDive === "心霊";
        // ── OSM高信頼タグの尊重（公園/温泉/水族館等が「肯定語不足」で弾かれる問題の修正）──
        //   GENRE_POSITIVE_REQUIRED は Google結果(無タグ)の純度確保用に「総合公園|芝生…」等の
        //   肯定語を“名前”に要求する。だが自前DBの「代々木公園」「砧公園」は OSM が leisure=park＋面積で
        //   #大型公園 と高信頼タグ付け済み＝肯定語が名前に無くても正しいジャンル。これらを名前だけで
        //   弾くと sbQualified が8件未満になり不要なGoogle補完(searchText)を誘発していた（実測: 自然/
        //   広い芝生でゴロゴロ で searchText=26）。
        //   対策: DB結果が深掘りジャンルタグ(#大型公園/#自然公園/#温泉…)を持てば肯定語必須を免除する。
        //   否定語(児童/防災/駐車場…)は引き続き適用＝小公園の誤混入は防ぐ。Google結果は自前タグを
        //   持たないため従来どおり名前フィルタのみ＝精度は不変。
        //   trustタグは realDrillTags（深掘り由来の実タグ。気分タグは除外＝広すぎる一致を防ぐ）。
        //   【公園の特例】#大型公園 は OSM の leisure=park 全件（小さな児童公園含む）に付く“過剰付与”タグ。
        //   単独では信用せず、wikidata著名公園に付与した #名所公園 マーカー併設時のみ信用する
        //   （fix_park_prominence.py）。これで「代々木公園/砧公園」等の有名大型公園は拾いつつ、
        //   「○○児童公園」級の小公園の洪水を防ぐ。#温泉/#水族館/#ジム/#自然公園(森林由来)等は粒度が
        //   正確なので直接信用＝それらの気分はDB完結（Google不要）。
        const BROAD_PARK_TAGS = new Set(["#大型公園"]);
        // 親ジャンルタグ: サブ料理(タイ/海鮮/海辺カフェ等)を選んだ時、共有する親タグ(#アジア系統/#和食等)で
        //   兄弟ジャンルが混入する（例: タイ料理にインド料理が出る/ベトナム結果の半分がインド）。
        //   → サブの具体タグがある時は親を信用せず具体タグを要求。親単独選択時のみ親を信用しリコールを保つ。
        const BROAD_PARENT_GENRE_TAGS = new Set(["#アジア系統", "#各国料理", "#和食", "#洋食", "#カフェスイーツ", "#景色良いカフェ", "#動物カフェ", "#ラーメン"]);
        const genreTrustTags = realDrillTags.filter(t => !!t && t !== realMoodTag);
        const specificTrust = genreTrustTags.filter(t => !BROAD_PARK_TAGS.has(t) && !BROAD_PARENT_GENRE_TAGS.has(t));
        const reliableTrust = specificTrust.length > 0
          ? specificTrust                                                    // サブ料理選択時: 具体タグのみ信用（兄弟混入を防ぐ）
          : genreTrustTags.filter(t => !BROAD_PARK_TAGS.has(t));            // 親単独選択時: 親を信用（リコール維持）
        const needsProminence = genreTrustTags.some(t => BROAD_PARK_TAGS.has(t));    // 公園系=著名度を要求
        const cddForGate = effectiveDeepDive ? canonDeepDive(effectiveDeepDive) : "";
        const genreNegForGate = cddForGate ? GENRE_NEGATIVE_RE[cddForGate] : undefined;
        const dbGenreOk = (r: { name?: string | null; tags?: string[] | null }): boolean => {
          const nm = r.name ?? "";
          const tags = r.tags ?? [];
          if (genreNegForGate && genreNegForGate.test(nm)) return false;     // 否定語は常に除外（児童/防災/駐車場等）
          if (nameMatchesGenre(nm, effectiveDeepDive)) return true;          // 名前一致（緑地/総合公園/森/広場…）
          if (reliableTrust.length > 0 && tags.some(t => reliableTrust.includes(t))) return true;  // 正確タグは直接信用
          // #大型公園 は #名所公園(wikidata著名)併設時のみ信用
          if (needsProminence && tags.includes("#名所公園") && tags.some(t => BROAD_PARK_TAGS.has(t))) return true;
          return false;
        };
        const sbQualified = sbPoolCapped.filter(r => {
          const nm = r.name ?? "";
          if (!dbGenreOk(r)) return false;                                     // ジャンル不一致を除外（OSMタグは尊重）
          if (isFoodForSkip && (FINALIZE_NON_FOOD_NAME_RE.test(nm))) return false; // 食事で温泉等を除外
          return true;
        });
        // ── 充足判定 ───────────────────────────────────────────────────────────
        //   飲食(お腹すいた): OSM自前DBを優先。ジャンル別の在庫フロア以上ならGoogle/Yahoo不使用でDB完結。
        //     Yahooは飲食では常時オフ。Googleはフロア未満のときだけ「保険」として呼ぶ。
        //     在庫が多いジャンル(ラーメン/居酒屋/カフェ/和食/焼肉)=10、ニッチ(各国/タイ/インド等)=5、その他=8。
        //   他気分: 従来どおり 15件以上で両スキップ / 10件以上でYahooのみスキップ。
        //   スリル(心霊): 常に両方スキップ（独自データのみ）。
        let skipAllSupplements: boolean;
        let skipYahooOnly: boolean;
        if (isProprietaryOnly) {
          skipAllSupplements = true;
          skipYahooOnly = true;
        } else if (isFoodForSkip) {
          const ddText = `${deepDiveL1} ${deepDiveL2}`;
          const foodDbFloor =
            /ラーメン|居酒屋|カフェ|喫茶|和食|焼肉/.test(ddText) ? FOOD_DB_FLOOR_RICH :
            /各国|メキシコ|ブラジル|ロシア|ベトナム|タイ|インド|ネパール|エスニック|アジアン/.test(ddText) ? FOOD_DB_FLOOR_NICHE :
            FOOD_DB_FLOOR_OTHER;
          skipAllSupplements = sbQualified.length >= foodDbFloor;  // フロア以上 → Google/Yahooも呼ばない（DB完結）
          skipYahooOnly = false;                                   // Yahoo再有効化(2026-07-16)＝薄いエリアは無料Yahooで補填しGoogle課金を温存
        } else {
          // 他気分もOSM自前DB（公園/温泉/ジム/水族館/神社/服屋…）が全国分揃ったのでDB優先。
          //   在庫フロア以上ならGoogle/Yahoo不使用でDB完結。フロア未満は無料Yahooを優先しGoogleを温存。
          skipAllSupplements = sbQualified.length >= NONFOOD_DB_FLOOR;
          skipYahooOnly = false;   // Yahoo再有効化(2026-07-16)＝薄いエリアは無料Yahooで補填しGoogle課金を温存
        }
        // Supabaseで賄う件数（候補プール＝OpenAI判別の入力＋表示8件＋補填）。
        //   ユーザー要件「Supabaseから出てきた情報(全件)を必ずOpenAIに渡す」を満たすため
        //   16/15の狭いキャップを撤廃し、取得した候補をほぼ全件(上限30)OpenAIに渡す。
        //   ※表示は後段 pickUnique(SB8件)＋G2＋Y5＝15件で変わらず。候補が増える＝AI選定の質が上がる。
        const sbTakeCount = 30;

        // 手動追加スポット優先（埋もれ防止）: 人が手入力した source="manual"/"admin"/"user" は
        // Google自動取り込み("google")より上位に出す。最近の流行りカフェ等を埋もれさせない。
        const isCuratedSource = (src?: string) => src === "manual" || src === "admin" || src === "user";

        // scored を先に計算（同期処理 → OpenAI 並列実行に使う）
        // A-6: Wilson score で評価の信頼度を考慮（少件数の高評価が多件数の平均に勝てないようにする）
        //   スリル(独自のみ)はジャンル一致 or 深掘りタグ一致のスポットだけに絞る。
        //   心霊は地名(常紋トンネル等)が多く名前で判定できないため #心霊スポット タグで一致させる。
        const THRILL_DEEPDIVE_TAG: Record<string, string> = {
          "絶叫": "#絶叫", "心霊": "#心霊スポット", "高所": "#高所", "体験型": "#体験型",
        };
        const ddTag = THRILL_DEEPDIVE_TAG[effectiveDeepDive] ?? "";
        // ジャンル不一致を「16件キャップの前」に除去する（精度）。従来は genreFidelityFilter が
        //   キャップ＆OpenAI判別の後に効いていたため、rank17以降の良いジャンル一致が落ち、
        //   逆に異ジャンルが候補枠と判別予算を消費していた。心霊以外の深掘りにも前段適用。
        const cddForPool = effectiveDeepDive ? canonDeepDive(effectiveDeepDive) : "";
        const hasGenreRule = !!cddForPool && (!!GENRE_NEGATIVE_RE[cddForPool] || !!GENRE_POSITIVE_REQUIRED[cddForPool]);
        //   純度フィルタも dbGenreOk（否定語＋名前一致＋OSM深掘りタグ信用）に統一。
        //   これにより skipAllSupplements で Google を呼ばずに済んだ #大型公園 等のDB公園が
        //   最終純度フィルタで再び弾かれて0件化する事故を防ぐ。ddTag(絶叫/心霊等)も従来どおり許可。
        const poolGenreOk = (r: { name?: string | null; tags?: string[] | null }): boolean =>
          dbGenreOk(r) || (!!ddTag && (r.tags ?? []).includes(ddTag));
        const scoredPool = isProprietaryOnly
          ? sbPoolCapped.filter(poolGenreOk)
          : (hasGenreRule ? sbPoolCapped.filter(poolGenreOk) : sbPoolCapped);
        const scored = scoredPool
          .map(r => ({
            ...r,
            _niceScore: (r.tags ?? []).filter(t => sbNiceTags.includes(t)).length
              + wilsonLower(r.rating, r.reviewCount) * 2  // Wilson: 最大約2点加算
              // 手動追加スポットを大きく優先。ただしタグ空(null/[])は「埋もれ防止すべきジャンル信号」を
              //   持たないデータ外れ値(実測: PACHA CRAFT BEER TACOS等がtags=nullで全ジャンルrank2固定)なので加点しない。
              + (isCuratedSource(r.source) && (r.tags?.length ?? 0) > 0 ? 5 : 0)
              + ((r as { semanticSim?: number | null }).semanticSim ?? 0) * 3  // ③ 意味一致が強い候補を上位化(AI失敗時の表示8件/写真補完先に確実に乗せる)
              + Math.random() * 0.3,  // 乱数を小さくして品質差が埋もれないようにする
          }))
          .sort((a, b) => b._niceScore - a._niceScore)
          .slice(0, sbTakeCount);  // B: スキップ時は最大15件、通常は5件

        const sbNames = scored.map(r => r.name);
        // 写真がないSupabase結果の名前リスト（Google写真補完対象）
        // 写真なし or 旧形式URL（AU_ZVEF...等）を持つスポットは補完対象とする
        // 旧形式URL: maps.googleapis.com/maps/api/place/photo → v1 API非対応で表示できないため
        const isLegacyPhotoUrl = (url: string | undefined) =>
          !!url && url.includes("maps.googleapis.com/maps/api/place/photo");
        // コスト削減(I): 写真補完(searchText)は上位8件のみに制限。
        //   B で scored が最大15件になっても写真補完で searchText が増えすぎないようにする。
        const noPhotoNames = scored
          .filter(r => !r.imageUrl || isLegacyPhotoUrl(r.imageUrl))
          // OSM由来の店はGoogle写真補完しない（ジャンル別プレースホルダー＋利用者投稿写真で賄う＝searchText削減）
          .filter(r => !(r.source ?? "").startsWith("osm"))
          .slice(0, 8)
          .map(r => r.name);
        // 書き戻し先を一意キーで絞るための name→行 ルックアップ（同名チェーン混線防止）
        const sbRowByName = new Map(scored.map(r => [r.name, r]));
        // 写真補完と同じGoogle searchText呼び出しで取得する評価(★)。Supabase(osm等)は rating=null が
        //   多くGoogle対比で★が出ず見劣りするため、ここで拾って rec＋DB(writeback)に反映（追加課金ゼロ）。
        const sbRatingMap = new Map<string, { rating: number; count: number | null }>();

        // ── Google / Yahoo / OpenAI 理由生成 / 写真補完 / OpenAI判別 を全て並列実行 ──
        const [googleSupplements, yahooSupplements, reasons, sbPhotoMap, sbStationMap, sbAiResult] = await Promise.all([
          // Google Places 補足検索（最終15件を確実に埋めるため多めに15件取得＝補填プール用）
          //   B: Supabaseが充足(フロア以上)している場合は呼ばない（コスト削減）
          //   C: Yahoo再有効化(2026-07-16)に伴い、薄いエリアの補填はまず無料のYahooに任せGoogleを温存。
          //      Google補足は skipYahooOnly（=Yahooを使わない設定に戻した時）のみ発火する保険に降格。
          (hasLocation && !skipAllSupplements && !RECOMMEND_DISABLE_GOOGLE && skipYahooOnly)
            ? fetchGooglePlacesSupplement(
                answers.originLat!, answers.originLng!, radiusKm,
                answers.mood ?? "", sbNames, apiKey, 15,
                answers.budget, effectiveDeepDive, minRadiusKm, deepDiveL2,
                answers.companion ?? ""  // D-3: 同行者属性を渡す
              )
            : Promise.resolve([]),
          // Yahoo!ローカルサーチ 補足検索（最終15件確保のため多めに15件取得＝補填プール用）
          //   B: Supabaseが10件以上 or 15件以上なら Yahoo を呼ばない（コスト削減）
          (hasLocation && !skipAllSupplements && !skipYahooOnly && !RECOMMEND_DISABLE_GOOGLE)
            // Yahoo結果はGoogleで写真補完する（=コスト）。表示は5件なので取得数を10に抑える
            // RECOMMEND_DISABLE_GOOGLE 時は Yahoo検索も停止（外部検索オフ＝DBのみ）。
            ? fetchYahooSupplement(
                answers.originLat!, answers.originLng!, radiusKm,
                answers.mood ?? "", effectiveDeepDive,
                sbNames, 10, minRadiusKm, apiKey
              )
            : Promise.resolve([]),
          // 【性能】理由文は buildQuickReason（タグから即席・0ms）に切替。
          //   OpenAI理由生成は1回約8秒かかり未キャッシュ検索を遅くするため、構造化検索ではブロックしない。
          //   （自由文/AI相談フローでは別途AI理由を出す）。
          Promise.resolve(new Map<string, string>()),
          // Supabase 写真補完: photo_urlが空の場所をGoogle Places Text Searchで最大10枚並列補完
          (async (): Promise<Map<string, string[]>> => {
            const photoMap = new Map<string, string[]>();
            // スリルは独自データのみ＝Google写真補完もしない（保存済み写真のみ使用）
            if (!apiKey || !hasLocation || noPhotoNames.length === 0 || isProprietaryOnly) return photoMap;
            // コスト削減: 長期キャッシュ(enr:)から先に充当（2回目以降はGoogle不要）
            const phHit = await ltCacheGetMany(noPhotoNames.map(n => `enr:${n.slice(0, 80)}`));
            const phMiss: string[] = [];
            for (const name of noPhotoNames) {
              const c = phHit.get(`enr:${name.slice(0, 80)}`) as EnrichCacheVal | undefined;
              if (c?.photoUrls?.length) photoMap.set(name, c.photoUrls);
              // Google に問い合わせ済みで写真が無かったスポットは再問い合わせしない（コスト削減）。
              //   写真そのものはキャッシュせず"確認済み"フラグだけで判定＝ライセンス方針を維持。
              else if (c?.checked) { /* Google確認済み・写真なし → searchText を投げない */ }
              else phMiss.push(name);
            }
            await Promise.all(phMiss.map(async (name) => {
              try {
                const res = await gfetch("https://places.googleapis.com/v1/places:searchText", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": apiKey,
                    // FieldMask最小化(2026-07-16): rating/件数を外し Enterprise→Pro SKU へ単価ダウン。
                    //   ★評価は place_ratings＋Moodログ、無料写真被覆で代替（0枚スポットの写真だけ取得）。
                    "X-Goog-FieldMask": "places.photos",
                  },
                  body: JSON.stringify({
                    textQuery: name,
                    locationBias: {
                      circle: {
                        center: { latitude: answers.originLat, longitude: answers.originLng },
                        radius: 50000,
                      },
                    },
                    maxResultCount: 1,
                    languageCode: "ja",
                  }),
                  cache: "no-store",
                });
                if (!res.ok) return;
                const data = await res.json().catch(() => null);
                const gp = data?.places?.[0];
                // 評価(★)も同時取得（同一呼び出し＝追加課金ゼロ）。recへ即時反映＋DBへ恒久保存。
                const gRating = typeof gp?.rating === "number" ? gp.rating : null;
                const gCount  = typeof gp?.userRatingCount === "number" ? gp.userRatingCount : null;
                if (gRating != null) sbRatingMap.set(name, { rating: gRating, count: gCount });
                const photoObjs = (gp?.photos ?? []) as Array<{ name: string }>;
                const photoNamesArr = photoObjs.slice(0, 10).map(ph => ph.name).filter(Boolean);
                if (photoNamesArr.length === 0) {
                  // 写真は無くても評価だけ取れたら恒久保存（次回以降 r.rating で★表示）
                  if (gRating != null) {
                    const row0 = sbRowByName.get(name);
                    schedulePlaceWriteBack(toPlaceMatch(name, row0?.id, row0?.address), { rating: gRating, ratingCount: gCount });
                  }
                  // 「Googleにも写真が無い」ことを記憶＝次回以降このスポットへ searchText を投げない（コスト削減）。
                  //   写真は保存せず"確認済み"フラグと（あれば）評価だけ＝ライセンス方針を維持。
                  const prev = (phHit.get(`enr:${name.slice(0, 80)}`) as EnrichCacheVal | undefined) ?? {};
                  await ltCachePut(`enr:${name.slice(0, 80)}`, { ...prev, checked: true });
                  return;
                }
                // photo-proxy URL を組み立て（解決は表示時に遅延 → 高速化）
                const urls = photoNamesArr.map(n => buildPhotoProxyUrl(n));
                if (urls.length > 0) {
                  photoMap.set(name, urls);
                  const row = sbRowByName.get(name);
                  // コスト削減(ユーザー選択2026-07-16): Google写真の"参照"(photo-proxy URL)を enr: に
                  //   30日短期キャッシュ＝同じ0枚スポットへの毎検索 searchText を月1回に激減。写真本体では
                  //   なく参照を一時キャッシュし、表示時に photo-proxy 経由でライブ解決＋帰属表示する。
                  //   ⚠DBの image_urls への恒久保存はしない（そちらはより永続なので回避＝ライセンス配慮）。
                  const prev = (phHit.get(`enr:${name.slice(0, 80)}`) as EnrichCacheVal | undefined) ?? {};
                  await ltCachePut(`enr:${name.slice(0, 80)}`, { ...prev, photoUrls: urls, checked: true });
                  schedulePlaceWriteBack(toPlaceMatch(name, row?.id, row?.address), { rating: gRating, ratingCount: gCount });
                }
              } catch { /* 写真取得失敗は無視 */ }
            }));
            return photoMap;
          })(),
          // 最寄り駅を並列検索（Supabase スポット用）
          (async (): Promise<Map<string, string>> => {
            const stationMap = new Map<string, string>();
            // スリルは独自データのみ＝駅補完のGoogle検索もしない（保存済みstationInfoのみ使用）
            if (!apiKey || isProprietaryOnly) {
              for (const r of scored) if (r.stationInfo) stationMap.set(r.name, r.stationInfo);
              return stationMap;
            }
            await Promise.all(scored.map(async (r) => {
              if (r.stationInfo) {
                stationMap.set(r.name, r.stationInfo);
                return;
              }
              if (typeof r.lat === "number" && typeof r.lng === "number") {
                const st = await findNearestStation(r.lat, r.lng, apiKey);
                if (st) {
                  stationMap.set(r.name, st);
                  schedulePlaceWriteBack(toPlaceMatch(r.name, r.id, r.address), { station: st });  // 最寄り駅を恒久保存→次回以降ゼロ
                }
              }
            }));
            return stationMap;
          })(),
          // OpenAI: Supabase候補を「利用者にとって良い順」に判別（番号順を返す）。
          //   体験系の気分のみ（飲食=近い順優先 / 心霊=独自少数 は対象外）。失敗時は空＝元の順序維持。
          (async (): Promise<{ order: number[]; reject: number[]; reasons: Record<number, string> }> => {
            if (!openai || isProprietaryOnly || scored.length <= 2) return { order: [], reject: [], reasons: {} };
            // 候補に「住所・距離・タグ・説明・利用者評価(👍/👎)」を載せて判別材料を増やす。
            //   評価は MoodGo独自の一次情報（この気分での👍/👎）＝Googleに無い定番/不人気の根拠。
            const cand = scored.map((r, i) => {
              // 住所は「都道府県＋市区＋町名」だけに整形（郵便番号・番地は判別ノイズなので除去）。
              //   ※郵便番号は先頭にあるので、番地カット(数字以降)より先に必ず除去する。
              const addr = String(r.address ?? "")
                .replace(/^日本[,、]?\s*/, "")
                .replace(/〒?\s*\d{3}-?\d{4}\s*/, "")
                .replace(/[0-9０-９].*$/, "")
                .slice(0, 20);
              const d = String(r.description ?? "").trim();
              const realDesc = (d && d !== `${r.name}のスポット情報`) ? d.slice(0, 64) : "";
              // 場所の「種類」が分かるよう自前タグを最大5個（#始まり）渡す＝判別精度の主材料。
              const tg = (r.tags ?? []).filter(t => typeof t === "string" && t.startsWith("#")).slice(0, 5).join("/");
              const dist = r.distanceInfo ? String(r.distanceInfo) : "";
              // MoodGo独自の利用者評価(この気分での👍/👎)。件数が有る時だけ載せる。
              const rj = ratingJudge.summary(r.name ?? "");
              const rev = rj && (rj.good + rj.bad) > 0 ? `｜評価👍${rj.good}👎${rj.bad}` : "";
              return `${i}: ${r.name ?? ""}｜${addr}｜${dist}${tg ? "｜" + tg : ""}${realDesc ? "｜" + realDesc : ""}${rev}`;
            }).join("\n");
            // ユーザー文脈（気分/深掘りL1+L2/同行者/予算/属性/自由ワード/絞り込み）を最大限渡す。
            const attr = [answers.age, answers.gender].filter(Boolean).join(" ");
            const ctxLine = [
              `気分:${answers.mood ?? ""}`,
              `深掘り:${effectiveDeepDive || "なし"}${deepDiveL2 ? "・" + deepDiveL2 : ""}`,
              `同行:${answers.companion ?? "指定なし"}`,
              `予算:${answers.budget ? "〜¥" + answers.budget.toLocaleString() : "指定なし"}`,
              attr ? `属性:${attr}` : "",
              `希望:${answers.freeWord || refinementText || "なし"}`,
            ].filter(Boolean).join("／");
            // 【コンシェルジュ化】この利用者を"知る"パーソナル文脈＝過去の高評価/苦手・プロフィール傾向・
            //   今の時間帯・今の天気。渡すと並べ替えが「万人向けキュレーター」→「あなたを知る地元の友達」になる(⑧⑨)。
            //   ※履歴依存で並びが変わるため、snapshotキーは personaSignature でこの人専用に分岐済み(誤共有防止)。
            const tcNow = getTimeContext();
            const timeLabel = tcNow.isMorning ? "朝" : tcNow.isDaytime ? "日中" : tcNow.isEvening ? "夕方〜夜" : "深夜";
            const likedP = pastFeedback.filter((f) => (f.rating ?? 0) >= 4 && f.visitedPlace).map((f) => f.visitedPlace).slice(0, 5);
            const dislikedP = pastFeedback.filter((f) => (f.rating ?? 0) > 0 && (f.rating ?? 0) <= 2 && f.visitedPlace).map((f) => f.visitedPlace).slice(0, 5);
            const hintP = userPreferenceHints.filter((h) => typeof h === "string" && h.trim()).slice(0, 6);
            // 天気: 屋外/屋内の適否を判断させる材料(⑨)。取得失敗(座標なし/APIエラー)は無視して従来通り。
            const wx = await getWeatherContext(answers.originLat, answers.originLng).catch(() => ({} as WeatherContext));
            const wc = wx.weatherCode;
            // 小雨(drizzle 51-57)は「雨」と別扱い＝軽い天気。強い雨/雪だけ屋内をやや優先させる。
            const wxLabel = wc === undefined ? ""
              : isSnowLikeWeather(wc) ? "雪"
              : [51, 53, 55, 56, 57].includes(wc) ? "小雨"
              : isRainLikeWeather(wc) ? "雨"
              : wc === 0 ? "快晴"
              : wc <= 3 ? "晴れ〜薄曇り"
              : wc <= 48 ? "曇り" : "";
            const personaLine = [
              hintP.length ? `傾向:${hintP.join("・")}` : "",
              likedP.length ? `過去に好評:${likedP.join("・")}` : "",
              dislikedP.length ? `過去に苦手:${dislikedP.join("・")}` : "",
              `今の時間帯:${timeLabel}`,
              wxLabel ? `今の天気:${wxLabel}` : "",
            ].filter(Boolean).join("／");
            try {
              const rr = await openai.chat.completions.create({
                model: "gpt-4o-mini", temperature: 0.3, max_tokens: 1400,  // 並べ替え＋reject＋上位15件の「その人向け1行理由」。理由の分だけ出力を確保
                response_format: { type: "json_object" },
                messages: [
                  { role: "system", content: `あなたは日本中のお出かけ先に精通した、その人を知る地元の友達のような案内役です。ユーザーの「気分・深掘りテーマ・同行者・予算・属性・自由記述の希望」に加え、【この人について】の過去の好み・今の時間帯・今の天気まで踏まえ、各候補が"その人の・その体験"をどれだけ本当に叶えるかで「最も良い順」に並べ替えます。

判断のしかた（重要）:
1. 自由記述の希望/絞り込みがあれば最優先で汲み取る。表面的な単語一致でなく意図（例「静かに過ごしたい」=落ち着いた静かな場所、「映える」=写真映え）で評価する。
2. 深掘りテーマへの本質的合致。例「圧倒的な絶景」なら名前・タグ・住所・説明から実際に雄大な景観・眺望がある場所を上位へ。市役所/オフィスビル/商業施設最上階などタグが一致してもテーマと噛み合わない場所は下位へ。
3. タグ（#始まり）は場所の種類を表す主材料。説明文があればその内容（景観・雰囲気・名物）も根拠にする。「評価👍N👎M」が付く候補は、この気分での実際の評判＝👍優勢は上位寄り・👎優勢は下げる（件数が僅少なら弱い材料として扱う）。
4. 住所/エリアから立地を推測（海辺・山・高台＝絶景や自然、繁華街・ビル街＝都会的、住宅街＝静か 等）。
5. 同行者・属性・予算に合うか（友達＝映え/盛り上がる、恋人＝雰囲気、一人＝静けさ、家族＝安心）。
6. 【この人を知る】ユーザー文脈に「傾向／過去に好評／過去に苦手」があれば強く尊重する——過去に好評だった場所と似た"系統"を上位へ、苦手だった系統は下位へ。プロフィール傾向にも寄せる。ただし今回の気分・深掘り・希望との合致(1〜4)を覆さない範囲で（＝合う場所の中で、この人好みを優先する）。【再訪回避】候補そのものが「過去に好評/苦手」に挙がった場所（＝もう行った所）なら、原則下位へ回して"新しい発見"を優先する（似た系統は上げるが、同じ場所の再提案は避ける。ただし過去に好評で今回も抜群にぴったりなら1つだけ残してよい）。
7. 【今の時間帯・天気】は"弱い補助材料"（テーマ合致を絶対に覆さない・これを理由に定番/名所を大きく下げたり reject しない）。時間帯: 夕方〜夜は夜景/ディナー、深夜は深夜営業に軽く寄せる程度。天気: 強い「雨」「雪」のときだけ、他が同程度なら屋内をわずかに優先。「小雨」「曇り」「晴れ」は無視してよい（屋外の名所・展望台・公園も通常どおり上位に出す）。
8. 上位が似た場所に偏らないよう適度な多様性も保つ。ただし合致が低い場所を多様性のために上げない。
9. テーマ・希望と「明らかに噛み合わない／場違い」な候補があれば reject に番号を入れる（例: 絶景を求める検索での市役所・オフィスビル、静かに過ごしたいでの繁華街の喧騒店、自然を求める検索でのパチンコ店）。ただし保守的に——少しでも合う可能性があるものは入れない。判断に迷うものも入れない。該当が無ければ空配列にする。
10. さらに order 上位15件の各候補に、その人の文脈（気分・深掘り・希望・過去の好み・同行者）に「なぜ合うか」を1行で書く（25〜45字・具体的に・自然な口調で「〜がおすすめ！」等の体言止め可・その人の選択に寄せる。例「大自然の中で静かにゆっくりできる、マザー牧場がおすすめ！」「一人でも落ち着いて作業できる、窓際席が良い」）。汎用の紹介文でなく"この人・この気分に効く一言"にする。reject した番号には書かない。
   ⚠一行理由の注意: (a)全候補に同じ言い回し（「深夜も」「静かに」等）を機械的に付けない＝場所ごとに違う具体を書く。(b)時間帯（深夜/夜/朝）に触れるのは、その場所が実際にその時間帯に楽しめる場合のみ。滝・展望台・公園・自然・寺社・城など日中前提の屋外スポットに夜間の言及をしない（「夜の滝」等の事実矛盾を避ける）。(c)タグや説明に無い属性（海沿い等）を推測で足さない。

出力は {"order":[全番号を1回ずつ], "reject":[場違いな番号のみ・無ければ空], "reasons":{"番号":"その人向けの1行理由"}} のみをJSONで。order には全番号を必ず1回ずつ含める（rejectした番号も order には残す）。reasons は order 上位15件のみでよい。` },
                  { role: "user", content: `${ctxLine}${personaLine ? "\n【この人について】" + personaLine : ""}\n各候補【番号: 名前｜住所｜距離｜タグ｜説明｜評価】:\n${cand}` },
                ],
              }, { signal: AbortSignal.timeout(8000) });  // 【性能】8秒（理由生成の分）。超過時はタグ/評価順＋②一言にフォールバック
              const parsed = JSON.parse(rr.choices?.[0]?.message?.content ?? "{}");
              const toIdx = (a: unknown): number[] => Array.isArray(a) ? a.map(Number).filter((n: number) => Number.isInteger(n)) : [];
              // reasons: {"番号":"理由"} を {idx:理由} に正規化（番号は文字列で来る）。60字上限・空は捨てる。
              const reasons: Record<number, string> = {};
              if (parsed.reasons && typeof parsed.reasons === "object") {
                for (const [k, v] of Object.entries(parsed.reasons as Record<string, unknown>)) {
                  const idx = Number(k);
                  if (Number.isInteger(idx) && typeof v === "string" && v.trim()) reasons[idx] = v.trim().slice(0, 60);
                }
              }
              return { order: toIdx(parsed.order), reject: toIdx(parsed.reject), reasons };
            } catch { return { order: [], reject: [], reasons: {} }; }
          })(),
        ]);

        // 合計 0 件ならレガシーフローへ
        if (sbPool.length === 0 && googleSupplements.length === 0 && yahooSupplements.length === 0) {
          throw new Error("No results from Supabase, Google, or Yahoo supplement");
        }

        // OpenAIが判別した順に Supabase候補を並べ替え（残りは元の順序で後ろに）
        // OpenAI判別順(order)＋reject(場違い排除)を候補に適用。詳細・安全装置は lib/ai-ranking.ts。
        //   aiRanked=false のときは元順そのまま（_aiRank を付けず後段の昇格boostに使わない）。
        // #3 飲食: 近い順を維持しつつ場違い/閉店疑いだけ落とす。恒等orderでreject限定
        //   （食のsortOrShuffleは_aiRank不使用＝並びは距離バンド順のまま。applyAiRankingはminKeep=8で痩せ防止）。
        const { ranked: scoredRanked, aiRanked } = applyAiRanking(
          scored,
          isFoodMood ? scored.map((_, i) => i) : (sbAiResult?.order ?? []),
          sbAiResult?.reject ?? [],
        );

        // 🥇 コンシェルジュの「その人向け1行理由」を各候補に添付。reasons は元 scored の添字キー。
        //   scored と scoredRanked は同一オブジェクト参照のため添字で付ければ両方(＝最終recs)に効く。
        //   後段 applyMoodBlurbs が、この persona 理由を②の汎用一言より優先して reason に採用する。
        if (sbAiResult?.reasons) {
          for (const [k, v] of Object.entries(sbAiResult.reasons)) {
            const i = Number(k);
            if (scored[i] && typeof v === "string" && v.trim()) (scored[i] as { _aiReason?: string })._aiReason = v.trim();
          }
        }

        // OpenAIで説明文を蓄積: 説明が空の場所に中立的な一言を生成→places.descriptionへ永続化。
        //   応答後(after)にバッチ生成するので検索レスポンスは遅延ゼロ。次回以降は再利用される。
        scheduleDescriptionGeneration(scoredRanked);

        const supabaseRecs = scoredRanked.map((r, _aiIdx) => {
          const matchedTags = (r.tags ?? []).filter(t => [...sbMustTags, ...sbNiceTags].includes(t));
          // SupabaseのgooglePlaceId（r.idフィールド）をplaceIdとして渡す
          // → ExpoのdetailページでGoogle Places APIから正確な口コミ・営業時間を取得できる
          const googlePlaceId = r.id && !r.id.startsWith("sb-") ? r.id : undefined;
          // supabase UUID（sb-プレフィックスあり or google place idのどちらでもない場合）
          const supabaseUUID = r.id?.startsWith("sb-") ? r.id.replace(/^sb-/, "") : undefined;
          // 現在地からの数値距離（km）。座標が揃っている場合のみ算出（最終ソート・dedup用）
          const sbDistKm = (typeof r.lat === "number" && typeof r.lng === "number"
            && typeof answers.originLat === "number" && typeof answers.originLng === "number")
            ? haversineMeters(answers.originLat, answers.originLng, r.lat, r.lng) / 1000
            : undefined;
          return {
            title: r.name,
            address: r.address,
            // 🥇 コンシェルジュが返した「その人向け1行理由」。applyMoodBlurbs が②の汎用一言より優先して reason に使う。
            _personaReason: (r as { _aiReason?: string })._aiReason,
            // OpenAI判別順位（0=最良）。後段sortOrShuffleでこの順位を昇格boostに使い、
            //   ランダムシャッフルに埋もれず「OpenAIが選んだ順」を最終結果に反映させる。
            _aiRank: aiRanked ? _aiIdx : undefined,
            // #2 サブジャンル選択時、具体サブタグ(#味噌ラーメン等)一致行を最終ソートで最上位固定するための印。
            _subTagMatch: specificTrust.length > 0 && (r.tags ?? []).some((t: string) => specificTrust.includes(t)),
            // 心霊(独自モード)は Google由来/places保存の写真を一切使わない（利用者投稿のみ）。
            //   → ここでは空にし、後段の spot_photos ブロックでユーザー投稿だけを添付する。
            // 旧形式の photo_reference (AU_ZVEF...) はv1 API非対応 → sbPhotoMap で上書きを優先。
            photoUrl: isProprietaryOnly ? "" : ((sbPhotoMap.get(r.name) ?? [])[0]
              || wrapWithPhotoProxy(r.imageUrl || "")),
            photoUrls: isProprietaryOnly ? [] : ((sbPhotoMap.get(r.name) ?? []).length > 0
              ? sbPhotoMap.get(r.name)!
              : (r.imageUrl
                  ? (r.photoUrls ?? [])
                  : []
                ).map(wrapWithPhotoProxy)),
            rating: r.rating ?? sbRatingMap.get(r.name)?.rating ?? null,             // SB行がnull(osm等)なら写真補完で取れたGoogle評価で補完
            userRatingCount: r.reviewCount ?? sbRatingMap.get(r.name)?.count ?? null,
            openNow: r.openNow ?? undefined,
            // #7: Supabaseスポットは periods が無いため openNow から簡易バッジを付与
            openStatusBadge: r.openNow === true ? "営業中" : (r.openNow === false ? "営業時間外" : undefined),
            openingHoursText: r.openingHours ?? undefined,  // 全曜日分をそのまま渡す
            mapUrl: r.googleMapsUrl,
            googleMapsUrl: r.googleMapsUrl,
            // 推薦理由はユーザー要望で非表示化（汎用文は情報価値が低いため）。
            //   AI理由（自由文/AI相談フロー）か、店の実説明があればそれだけ出す。OSMは空＝カード側で非表示。
            // 実説明が無い/定型フォールバックのスポットは、エリア×種別×気分から具体的な一言を0ms生成（2026-07-17）。
            reason: reasons.get(r.name) ?? pickReason(r.name, (r.tags ?? matchedTags) as string[], r.address, r.description),
            aiReason: reasons.get(r.name) || pickReason(r.name, (r.tags ?? matchedTags) as string[], r.address, r.description) || undefined,
            features: matchedTags.slice(0, 5),
            distanceText: r.distanceInfo,
            distanceKm: sbDistKm,
            distanceM: r.distanceM,   // PostGIS精密距離→normalizeDistanceで表示/ソートを単一化
            lat: typeof r.lat === "number" ? r.lat : undefined,
            lng: typeof r.lng === "number" ? r.lng : undefined,
            durationText: "",
            stationText: sbStationMap.get(r.name) || r.stationInfo || "",
            vibe: "",
            budget: "",
            time: "",
            priceLevel: r.priceLevel ?? undefined,
            placeId: googlePlaceId,      // Google Places ID（detail ページで使用）
            supabaseId: supabaseUUID,    // Supabase UUID（閉店報告で使用）
            // 保存済みDBスポットは「DB登録済み」に統一。source_type=google/hotpepper を "Google検索" と
            // 出すと、実際は叩いてないキャッシュなのに『Googleをライブ検索した(=課金)』と誤解される。
            // ライブGoogle結果のみ別途 source="google"（supabaseId無し）で本物のGoogle検索を表す。
            source: r.source === "user" ? "user" : "admin",
            isUserSpot: false,
            hasUserPhotos: false,
            userPhotoCount: 0,
            availableFrom: null as string | null,    // 期間限定バッジ用（下の一括取得で埋める）
            availableUntil: null as string | null,
            routesByMode: undefined,
            tags: r.tags ?? [],          // 飲食NGコンテキストの飲食店除外(tagsAreFood)で使用
          };
        });

        // ── 心霊(独自データのみ): 利用者投稿写真(spot_photos)を添付 ───────────────
        //   Googleからは一切補強しない。Supabaseのspot_photosのみを写真ソースにする。
        if (isProprietaryOnly && supabase) {
          try {
            const uuids = scored
              .map(r => (r.id && r.id.startsWith("sb-")) ? r.id.slice(3) : null)
              .filter((x): x is string => !!x);
            const names = scored.map(r => r.name).filter((n): n is string => !!n);
            const rows: Array<{ place_id: string | null; place_name: string | null; image_url: string }> = [];
            if (uuids.length > 0) {
              const { data } = await supabase.from("spot_photos")
                .select("place_id, place_name, image_url").in("place_id", uuids)
                .order("created_at", { ascending: false });
              if (data) rows.push(...data);
            }
            if (names.length > 0) {
              const { data } = await supabase.from("spot_photos")
                .select("place_id, place_name, image_url").in("place_name", names)
                .order("created_at", { ascending: false });
              if (data) rows.push(...data);
            }
            if (rows.length > 0) {
              const seenUrl = new Set<string>();
              const byId = new Map<string, string[]>();
              const byName = new Map<string, string[]>();
              for (const row of rows) {
                if (seenUrl.has(row.image_url)) continue;
                seenUrl.add(row.image_url);
                if (row.place_id) { const a = byId.get(row.place_id) ?? []; a.push(row.image_url); byId.set(row.place_id, a); }
                if (row.place_name) { const a = byName.get(row.place_name) ?? []; a.push(row.image_url); byName.set(row.place_name, a); }
              }
              for (const rec of supabaseRecs) {
                const urls = (rec.supabaseId ? byId.get(rec.supabaseId) : undefined) ?? byName.get(rec.title) ?? [];
                if (urls.length > 0) {
                  rec.photoUrls = urls;
                  rec.photoUrl = urls[0];
                  rec.hasUserPhotos = true;
                  rec.userPhotoCount = urls.length;
                }
              }
            }
          } catch { /* spot_photos未作成・取得失敗はプレースホルダー表示で安全 */ }
        }

        // ── 全スポット: 承認済み&再利用OKのユーザー投稿写真(Moodログ)を最優先で採用 ──────
        //   写真が無い既存スポット(自然/穴場/公園/夜景等)の見た目を強化し、Google依存を下げる。
        //   spot_photos拡張列(moderation_status='approved' AND can_use_as_spot_photo)で絞り、
        //   各recの先頭にprepend(=カード/詳細のメイン画像がユーザー投稿写真になる)。
        //   心霊(独自)は上で処理済みのため除外。列未作成(mood-logs.sql未適用)時は安全にスキップ。
        if (!isProprietaryOnly && supabase) {
          try {
            const sbUP = supabase;
            const uuids = supabaseRecs.map(r => r.supabaseId).filter((x): x is string => !!x);
            const names = supabaseRecs.map(r => r.title).filter((n): n is string => !!n);
            const SEL = "place_id, place_name, image_url, is_primary, score, created_at";
            const byIdRows: Array<Record<string, unknown>> = [];
            const byNameRows: Array<Record<string, unknown>> = [];
            if (uuids.length > 0) {
              const { data } = await sbUP.from("spot_photos").select(SEL)
                .eq("moderation_status", "approved").eq("can_use_as_spot_photo", true).in("place_id", uuids)
                .order("is_primary", { ascending: false }).order("score", { ascending: false }).order("created_at", { ascending: false });
              if (data) byIdRows.push(...(data as Array<Record<string, unknown>>));
            }
            if (names.length > 0) {
              const { data } = await sbUP.from("spot_photos").select(SEL)
                .eq("moderation_status", "approved").eq("can_use_as_spot_photo", true).in("place_name", names)
                .order("is_primary", { ascending: false }).order("score", { ascending: false }).order("created_at", { ascending: false });
              if (data) byNameRows.push(...(data as Array<Record<string, unknown>>));
            }
            const byId = new Map<string, string[]>();
            const byName = new Map<string, string[]>();
            const push = (m: Map<string, string[]>, k: string, u: string) => { const a = m.get(k) ?? []; if (!a.includes(u)) a.push(u); m.set(k, a); };
            for (const row of byIdRows) { if (row.place_id) push(byId, String(row.place_id), String(row.image_url)); }
            for (const row of byNameRows) { if (row.place_name) push(byName, String(row.place_name), String(row.image_url)); }
            if (byId.size > 0 || byName.size > 0) {
              for (const rec of supabaseRecs) {
                const up = (rec.supabaseId ? byId.get(rec.supabaseId) : undefined) ?? byName.get(rec.title) ?? [];
                if (up.length === 0) continue;
                // 利用者投稿が3枚以上集まったら Google等は一切使わず利用者写真のみ（ユーザー要望）。
                //   3枚未満は 利用者写真を先頭に＋既存(Google/SB)で補完。
                const merged = up.length >= 3 ? [...up] : [...up, ...(rec.photoUrls ?? []).filter(u => !up.includes(u))];
                rec.photoUrls = merged;
                rec.photoUrl = merged[0];
                rec.hasUserPhotos = true;
                rec.userPhotoCount = up.length;
              }
            }
          } catch { /* spot_photos未作成・取得失敗は従来表示で安全 */ }
        }

        // ── Moodログ集計（カードのMoodGo独自バッジ用: 件数・支配的気分・また行きたい数）──────
        //   spot_posts(approved・公開)を place_id で一括集計してrecに付与。データ0でも無害。
        if (!isProprietaryOnly && supabase) {
          try {
            const uuids2 = supabaseRecs.map(r => r.supabaseId).filter((x): x is string => !!x);
            if (uuids2.length > 0) {
              const { data } = await supabase.from("spot_posts")
                .select("place_id, mood_tags, companion, want_revisit, helpful_count")
                .in("place_id", uuids2).eq("status", "approved").in("visibility", ["spot_public_anonymous", "public"]).limit(2000);
              type Agg = { count: number; moods: Record<string, number>; comps: Record<string, number>; revisit: number; helpful: number };
              const agg = new Map<string, Agg>();
              for (const row of (data ?? []) as Array<Record<string, unknown>>) {
                const k = String(row.place_id);
                const a = agg.get(k) ?? { count: 0, moods: {}, comps: {}, revisit: 0, helpful: 0 };
                a.count++;
                for (const t of (row.mood_tags as string[] | null) ?? []) a.moods[t] = (a.moods[t] ?? 0) + 1;
                if (row.companion) { const c = String(row.companion); a.comps[c] = (a.comps[c] ?? 0) + 1; }
                if (row.want_revisit) a.revisit++;
                a.helpful += typeof row.helpful_count === "number" ? row.helpful_count : 0;
                agg.set(k, a);
              }
              const top = (o: Record<string, number>) => Object.entries(o).sort((x, y) => y[1] - x[1])[0]?.[0];
              for (const rec of supabaseRecs) {
                const a = rec.supabaseId ? agg.get(rec.supabaseId) : undefined;
                if (a && a.count > 0) {
                  (rec as Record<string, unknown>).moodLog = { count: a.count, topMood: top(a.moods), topCompanion: top(a.comps), revisit: a.revisit, helpful: a.helpful };
                }
              }
            }
          } catch { /* spot_posts未作成・取得失敗はバッジ無しで安全 */ }
        }

        // ── MoodGo独自の星評価で表示評価を上書き（Google→自前へ移行）────────────────
        //   spot_ratings の平均が一定件数(3)以上貯まったスポットは、表示評価をGoogle保存値から
        //   MoodGo平均に切り替える。データ0でも無害（従来のrating表示のまま）。
        if (!isProprietaryOnly && supabase) {
          try {
            const uuids3 = supabaseRecs.map(r => r.supabaseId).filter((x): x is string => !!x);
            if (uuids3.length > 0) {
              const { data } = await supabase.from("spot_ratings").select("place_id, stars").in("place_id", uuids3).limit(5000);
              const agg = new Map<string, { sum: number; n: number }>();
              for (const row of (data ?? []) as Array<{ place_id: string; stars: number }>) {
                const a = agg.get(row.place_id) ?? { sum: 0, n: 0 };
                a.sum += Number(row.stars) || 0; a.n++; agg.set(row.place_id, a);
              }
              const MOODGO_RATING_MIN = 3;
              for (const rec of supabaseRecs) {
                const a = rec.supabaseId ? agg.get(rec.supabaseId) : undefined;
                if (!a || a.n === 0) continue;
                // 件数は常にMoodGo評価分を加算＝『○○件の評価』が利用者の評価で増える
                rec.userRatingCount = (rec.userRatingCount ?? 0) + a.n;
                // 値は3件以上たまったらMoodGo平均へ移行（未満はGoogle保存値のまま）
                if (a.n >= MOODGO_RATING_MIN) rec.rating = Math.round((a.sum / a.n) * 10) / 10;
              }
            }
          } catch { /* spot_ratings未作成・取得失敗はGoogle評価のまま安全 */ }
        }

        // ── 結果の結合 ─────────────────────────────────────────────────────────
        // API-only deepDive（動物カフェ等）: Google/Yahoo が結果を返したら Supabase 結果は除外
        // Google/Yahoo が0件の場合のみ Supabase 結果をフォールバックとして使う
        // ただし「大型ショッピングモール」系は deepDiveTag が mood タグと同一で空になるため
        // isApiOnlyDeepDive が誤って true になる。このケースは Supabase も使う。
        const hasApiResults = googleSupplements.length > 0 || yahooSupplements.length > 0;
        const skipSupabase = isApiOnlyDeepDive && hasApiResults && !isLargeMallSearch(effectiveDeepDive);
        const mergedSb = skipSupabase ? [] : supabaseRecs;

        type DedupeKey = { key: string; lat?: number; lng?: number };
        type Rec = (typeof supabaseRecs)[number];

        // ── Step 1: 後処理パイプラインを createFinalizeHelpers に集約 ──────────────
        //   フィルタ / ソート / 重複排除 / 15件化 の全ロジックを一元管理。
        //   経路2(Supabase-first)で従来と完全に同一の絞り込みを行う。
        //   （将来 経路5(レガシー)等もこのヘルパーを呼ぶことで改善が全経路に波及する）
        const {
          applyMallFilter, normalizeName, pickUnique, sortOrShuffle, normalizeDistance,
          foodSanitize, familyFoodSanitize, seenFilter, qualitySanitize, genreFidelityFilter, nonFoodSanitize,
          finalizeAssembled, stationConsistency,
          seenLower, isFoodMoodReq, NON_FOOD_NAME_RE,
        } = createFinalizeHelpers({
          isFoodMood, minRadiusKm,
          // 領域1: 近距離キャップ。「少し歩ける(5km)→1.5km」「近め(10km)→3km」「今日は(20km)→6km」を
          //   上位厳守（選択半径の30%・最小1.5km）。min>0(遠出)時は undefined で far-bias温存。
          nearCapKm: minRadiusKm > 0 ? undefined : Math.max(1.5, sbRadiusKm * 0.3),
          // 領域4: 家族×飲食の酒場系抑制トリガ。
          familyCompanion: (answers.companion ?? "").includes("家族"),
          alcoholDeepDive: /居酒屋|酒場|大衆酒場|個室居酒屋|バー/.test(effectiveDeepDive),
          isBadWeather,
          goodVisitedPlaces, seenPlaces, showUnseenOnly, effectiveDeepDive,
          mood: answers.mood,
          originLat: answers.originLat, originLng: answers.originLng, transport: answers.transport,
        });

        // 各ソースにモール/飲食/既出/品質/ジャンル(#1)/飲食NGフィルターを適用 → ソート
        // #6: 食事で深掘り未指定(こだわらない)のときは、各ソース内で同一粗ジャンルを
        //   最大2件に抑えて多様性を確保する（全部ラーメンにならないように）。
        const diversifyFood = isFoodMood && !effectiveDeepDive;
        // フィードバック自己改善: 👎過半数(3件以上)=除外 / 👎優勢=末尾降格 /
        //   👍Wilson＋エンゲージメント=先頭昇格（安定ソートなので同点は元の並びを維持）
        const ratingSanitize = (arr: Rec[]): Rec[] => {
          const kept = arr.filter(r => !ratingJudge.isExcluded(r.title ?? ""));
          const ok   = kept.filter(r => !ratingJudge.isDemoted(r.title ?? ""));
          const demoted = kept.filter(r => ratingJudge.isDemoted(r.title ?? ""));
          const boosted = ok.map(r => ({ r, ls: ratingJudge.learnScore(r.title ?? "") }))
            .sort((a, b) => b.ls - a.ls)
            .map(x => x.r);
          return [...boosted, ...demoted];
        };
        const finalizeSource = (arr: Rec[]): Rec[] => {
          // 距離を最初に単一化（distanceKm=distanceText が同じkm・交通手段反映）→ 以降のソート/表示が一致
          const sorted = ratingSanitize(sortOrShuffle(nonFoodSanitize(genreFidelityFilter(familyFoodSanitize(qualitySanitize(seenFilter(foodSanitize(applyMallFilter(normalizeDistance(arr))))))))));
          return diversifyFood ? diversifyByCoarseGenre(sorted, 2) : sorted;
        };
        // #2 サブジャンル時: サブタグ一致行を（既存の並び順を保ったまま安定的に）最上位へ固定。
        //   在庫が薄い時にfallbackの汎用親ジャンル行が距離順で上に来るのを防ぐ。V8のsortは安定。
        const sbSorted = specificTrust.length > 0
          ? [...finalizeSource(mergedSb)].sort((a, b) =>
              Number((b as { _subTagMatch?: boolean })._subTagMatch ?? false)
              - Number((a as { _subTagMatch?: boolean })._subTagMatch ?? false))
          : finalizeSource(mergedSb);
        const gSorted  = finalizeSource(googleSupplements as Rec[]);
        const ySorted  = finalizeSource(yahooSupplements as Rec[]);

        // ソース配分: Supabase 8 / Google 2 / Yahoo 5（独自DB優先・Google最小化）。
        // 足りない分は Supabase余り → Yahoo余り → Google余り の順で補填して15件にする。
        const seen: DedupeKey[] = [];
        // ブランドcapを全ソース越しに共有（呼び出し毎リセットだと同チェーンが2×4=8件通り得た）
        const brandSeen = new Map<string, number>();
        const { taken: sbTaken, skipped: sbExtra } = pickUnique(sbSorted, 8, seen, brandSeen);
        const { taken: gTaken,  skipped: gExtra  } = pickUnique(gSorted,  2, seen, brandSeen);
        const { taken: yTaken,  skipped: yExtra  } = pickUnique(ySorted,  5, seen, brandSeen);

        // ショートフォール補填:
        // 合計15件に足りない分を、他ソースの余り（skipped）から順次補充する。
        // 優先順: Supabase余り → Yahoo余り → Google余り（Googleは最後＝最小化）
        const totalTaken = sbTaken.length + gTaken.length + yTaken.length;
        const backfillNeed = Math.max(0, 15 - totalTaken);
        const backfillPool = [...sortOrShuffle(sbExtra), ...sortOrShuffle(yExtra), ...sortOrShuffle(gExtra)];
        const { taken: backfill } = pickUnique(backfillPool, backfillNeed, seen, brandSeen);

        let recommendations: typeof supabaseRecs = [
          ...sbTaken, ...gTaken, ...yTaken, ...backfill,
        ];

        // ── B-2: 最終セーフティ補填: それでも15件未満なら広域・広カテゴリで追加取得 ──────
        // 「居酒屋」等の狭いカテゴリは指定半径内に該当スポットが15件存在しない場合がある。
        // その時のみ、深掘りを外して気分ベースの広いカテゴリ＋拡大半径で追加検索し15件まで補う。
        //   ・お腹すいた: MOOD_TYPES=["restaurant"] / MOOD_KW="レストラン グルメ" のため飲食店のまま維持
        //   ・拡大半径は Google 50km / Yahoo 20km の各API上限内にクランプされる
        let widenedSearch = false;
        // スリルは独自データのみ＝Google/Yahooでの15件補填をしない（1件でもそのまま表示）
        if (recommendations.length < 15 && hasLocation && !isProprietaryOnly) {
          widenedSearch = recommendations.length < 8; // 8件未満なら「条件広げました」を表示
          // 補填半径: 通常は1.5倍拡大(上限50km)。ただし遠出意図(far-bias)時に50kmへ
          //   縮小すると「小旅行(120km)なのに近場ゴミで補填」される逆転が起きるため、
          //   minRadiusKm>0 のときは元の選択半径を維持する（far-biasは補填側でも有効）。
          const wideRadiusKm = minRadiusKm > 0
            ? radiusKm
            : Math.min(Math.max(radiusKm * 1.5, radiusKm + 15), 50);
          const isFoodMoodTopUp = (answers.mood ?? "") === "お腹すいた";
          const hasGenreDef = !!(GENRE_POSITIVE_RE[effectiveDeepDive] || GENRE_NEGATIVE_RE[effectiveDeepDive]);

          // ── #2 第1段: ジャンルを保ったまま半径拡大して「同じジャンル」で補填する ──
          //   これにより「近くにラーメンが少ない」時でもアイス屋ではなく少し遠いラーメン屋が入る。
          //   regex定義が無い深掘り(波の音と海風等)でも、深掘りキーワード/型で同カテゴリ補填する
          //   （これが無いと第2段のジャンル無し検索に直行し、無関係な事業所等が混入していた）。
          if (hasGenreDef || effectiveDeepDive) {
            const excludeG = [...sbNames, ...recommendations.map(r => r.title ?? "")];
            const [gGenre, yGenre] = await Promise.all([
              fetchGooglePlacesSupplement(
                answers.originLat!, answers.originLng!, wideRadiusKm,
                answers.mood ?? "", excludeG, apiKey, 20,
                answers.budget, effectiveDeepDive, minRadiusKm, deepDiveL2,
              ),
              isFoodMoodTopUp
                ? fetchYahooSupplement(
                    answers.originLat!, answers.originLng!, wideRadiusKm,
                    answers.mood ?? "", effectiveDeepDive,
                    excludeG, 20, minRadiusKm, apiKey,
                  )
                : Promise.resolve([] as Record<string, unknown>[]),
            ]);
            const genrePool = ratingSanitize(sortOrShuffle(nonFoodSanitize(genreFidelityFilter(qualitySanitize(seenFilter(foodSanitize(applyMallFilter([...gGenre, ...yGenre] as Rec[]))))))));
            const { taken } = pickUnique(genrePool, 15 - recommendations.length, seen, brandSeen);
            recommendations = [...recommendations, ...taken];
          }

          // ── 最終手段: それでも15件未満なら、ジャンルを外した広域検索で埋める（混在許容）──
          //   都市部ではほぼ第1段で埋まるため、この経路は稀（過疎地・極狭ジャンル時のみ）。
          if (recommendations.length < 15) {
            const excludeNames = [...sbNames, ...recommendations.map(r => r.title ?? "")];
            const [gWide, gCafe, yWide] = await Promise.all([
              fetchGooglePlacesSupplement(
                answers.originLat!, answers.originLng!, wideRadiusKm,
                answers.mood ?? "", excludeNames, apiKey, 20,
                answers.budget, "", minRadiusKm,
              ),
              isFoodMoodTopUp
                ? fetchGooglePlacesSupplement(
                    answers.originLat!, answers.originLng!, wideRadiusKm,
                    answers.mood ?? "", excludeNames, apiKey, 20,
                    answers.budget, "カフェスイーツ", minRadiusKm,
                  )
                : Promise.resolve([] as Record<string, unknown>[]),
              isFoodMoodTopUp
                ? Promise.resolve([] as Record<string, unknown>[])
                : fetchYahooSupplement(
                    answers.originLat!, answers.originLng!, wideRadiusKm,
                    answers.mood ?? "", "",
                    excludeNames, 20, minRadiusKm, apiKey,
                  ),
            ]);
            // qualitySanitize を必ず通す（B2B=株式会社/合同会社/事業所などのゴミ除去）。
            //   従来この段だけ品質フィルタ無しで、Yahoo広域検索の無関係な会社が混入していた。
            const wideBase = nonFoodSanitize(qualitySanitize(seenFilter(foodSanitize(applyMallFilter([...gWide, ...gCafe, ...yWide] as Rec[])))));
            // 広域補填: ①同ジャンルは15件まで純度優先で補填。②ジャンル外(混在)は
            //   MIXED_BACKFILL_FLOOR 件までに抑える＝rejectで消した枠を場違いで埋め戻さず
            //   「正直に少なく出す」。デフォルト15で従来挙動、env で絞れる。
            const wideGenre = genreFidelityFilter(wideBase);
            const wideRest  = wideBase.filter(r => !wideGenre.includes(r));
            // ① 同ジャンル広域で15件まで（純度OK）
            const { taken: takenGenre } = pickUnique(ratingSanitize(sortOrShuffle(wideGenre)), 15 - recommendations.length, seen, brandSeen);
            recommendations = [...recommendations, ...takenGenre];
            // ② それでも足りなければ「ジャンル外」で混在補填。ただし MIXED_BACKFILL_FLOOR 件まで。
            if (recommendations.length < MIXED_BACKFILL_FLOOR) {
              const { taken: takenRest } = pickUnique(ratingSanitize(sortOrShuffle(wideRest)), MIXED_BACKFILL_FLOOR - recommendations.length, seen, brandSeen);
              recommendations = [...recommendations, ...takenRest];
            }
          }
        }

        // ── 期間限定転載（管理者追加スポット）の優先注入 ───────────────────────────
        // 高層ビル料理は専用ロジック(isHighriseFood経路)で精度高く処理するため、
        // Supabase-first経路でのadmin注入は行わない（高層と無関係なspotが混入するため）
        // suggestions テーブルの source="admin" スポット（公開期間内のみ。日付フィルタは取得時に適用済）を
        // # タグ（気分タグ＋サブタグ）一致で抽出し、検索結果の先頭に積極的に表示する。
        // これらだけは通常の距離ロジック（半径・遠端バイアス）を無効化し、現在地から40km以内なら
        // 近場でも必ず掲載する（要件: 期間限定転載は距離ロジック無し・40km以内表示・# は遵守）。
        // 高層ビル料理は専用経路(isHighriseFood)で高精度に処理するためadmin注入不要
        const isHighrisePath = effectiveDeepDive === "高層ビル料理";
        if (adminSpots.length > 0 && !isHighrisePath) {
          // 気分タグ = mustTags の先頭（extractUserTagsFromAnswers が短縮キー"まったり"→"#まったりしたい"
          // を MOOD_SHORT_KEY_TO_TAG で解決済み。MOOD_TAG_MAP.find だと短縮キーで未解決になるため使わない）
          const moodTag = userTags.mustTags[0];
          const subTags = userTags.mustTags.slice(1);  // 深掘り/サブタグ

          // 深掘りが指定されている場合の追加フィルター:
          // DRILL_ANSWER_TO_MUST でキー不一致（例:「食べ放題」→「焼肉食べ放題」）により
          // subTags が空でも、sbMustTags（Supabase検索用の実タグ）でフィルタする。
          // これにより「焼肉食べ放題」選択時に横浜中華街が混入しなくなる。
          const adminSubFilter = sbMustTags.filter(t => t !== moodTag);
          // 距離無視バグ修正: 転載スポットもユーザー選択の距離感(radiusKm)でクランプする。
          // 従来は固定40kmで「すぐそこ(1km)」でも31km先の転載店が先頭に出ていた。
          // 上限40km・下限はradiusKmの1.2倍（最低でも選択半径より少し広く取り、近場転載は残す）。
          const ADMIN_MAX_KM = Math.min(40, radiusKm * 1.2);
          const matchingAdminSorted = adminSpots
            .map(s => {
              // フィードバック自己改善: 👎過半数のスポットは注入もしない
              if (ratingJudge.isExcluded(s.google_place_name ?? s.spot_name)) return null;
              const tags = new Set(s.auto_tags ?? []);
              if (!moodTag || !tags.has(moodTag)) return null;                          // ① 気分タグ一致(必須)
              if (subTags.length > 0 && !subTags.some(t => tags.has(t))) return null;   // ② mustTagsサブタグ一致
              // ③ sbMustTags（Supabase検索用タグ）での補完フィルタ:
              //   「食べ放題」→mustTagsキー不一致でsubTagsが空の場合も、
              //   sbMustTags（例:#焼肉食べ放題）との一致を確認する
              if (adminSubFilter.length > 0 && subTags.length === 0
                && !adminSubFilter.some(t => tags.has(t))) return null;
              // ④ お腹すいた時: 住所に水族館/動物園等が含まれるテナントも除外
              if (isFoodMoodReq) {
                const addr = s.address ?? "";
                if (NON_FOOD_NAME_RE.test(addr)) return null;
              }
              // ④' ジャンル不一致フィルタを admin転載にも適用（例: 知らない街をぶらぶらで
              //     generic公園・動物園を除外）。admin注入は merge後に prepend されフィルタを
              //     通らないため、ここで個別に nameMatchesGenre で判定する。
              if (!nameMatchesGenre(s.google_place_name ?? s.spot_name, effectiveDeepDive)) return null;
              // ④'' 楽しみたい系: 食タグを持つadmin転載(飲食店)を除外（primaryTypeが無いので
              //     タグで判定）。HAL YAMASHITA等の飲食店が #わいわい楽しみたい で注入されるのを防ぐ。
              if (AMUSEMENT_NO_FOOD_DEEPDIVES.has(canonDeepDive(effectiveDeepDive))) {
                const FOOD_GENRE_TAGS = ["#お腹すいた", "#居酒屋", "#和食", "#洋食", "#イタリアン", "#中華", "#焼肉", "#韓国", "#ラーメン", "#カフェスイーツ", "#アジア系統"];
                if ((s.auto_tags ?? []).some(t => FOOD_GENRE_TAGS.includes(t))) return null;
              }
              // 既出スポット除外（再検索時の重複防止）
              if (showUnseenOnly && seenLower.has((s.google_place_name ?? s.spot_name).toLowerCase())) return null;
              const hasCoord = typeof s.lat === "number" && typeof s.lng === "number";
              let dkm = Infinity;
              if (hasLocation) {
                // 距離ロジック(半径/遠端バイアス)は無効化するが、40km以内は厳守する。
                // 座標不明スポットは40km判定ができないため除外（遠方の誤掲載を防ぐ）。
                if (!hasCoord) return null;
                dkm = haversineMeters(answers.originLat!, answers.originLng!, s.lat as number, s.lng as number) / 1000;
                if (dkm > ADMIN_MAX_KM) return null;
                // 遠出意図(far-bias)を尊重: 「小旅行(96km〜)/県またぎ(56km〜)」等を選んだのに
                // 8km先の転載スポットが先頭に出るのを防ぐ。minRadiusKm未満の近場転載はスキップ
                // （転載上限40km以内なので、遠出設定では実質注入なし＝検索結果の意図を優先）。
                if (minRadiusKm > 0 && dkm < minRadiusKm) return null;
              }
              return { s, dkm };
            })
            .filter((x): x is { s: (typeof adminSpots)[number]; dkm: number } => x !== null)
            .sort((a, b) => a.dkm - b.dkm);  // 近い順

          // A-7: admin転載にも同チェーン抑制を適用（ラーメン豚山×3 等を防ぐ。最大2件/チェーン）。
          // admin注入は pickUnique を通らず先頭注入されるため、ここで個別にブランド重複を抑える。
          const adminChainCounts = new Map<string, number>();
          // 同一スポットの二重注入防止: 同名の承認投稿/転載が複数あっても先頭注入は1件だけにする
          //   （福浦岸壁×2 等＝旧inactive行のフリーズ座標を持つ投稿が2件あると重複表示されていた）。
          //   ブランドcap(≤2)は別ブランドの同種抑制用で、完全同名の二重は別途この名前dedupで塞ぐ。
          const adminNameSeen = new Set<string>();
          const matchingAdmin = matchingAdminSorted
            // 領域4b: 深掘りジャンルに明確に合わない転載は先頭注入しない。
            //   admin注入は finalizeSource(genreFidelityFilter)を通らず素通りするため、
            //   「海沿い」検索に中華街/川崎大師、「自然の中」に神社が先頭固定される主因だった。
            .filter(({ s }) => (effectiveDeepDive && effectiveDeepDive !== "心霊")
              ? nameMatchesGenre(s.google_place_name ?? s.spot_name, effectiveDeepDive) : true)
            .filter(({ s }) => {
              const nk = normalizeName(s.google_place_name ?? s.spot_name);
              if (!nk || adminNameSeen.has(nk)) return false;   // 完全同名は1件のみ
              adminNameSeen.add(nk);
              return true;
            })
            .filter(({ s }) => {
              const brand = brandOf(s.google_place_name ?? s.spot_name);
              if (brand.length < 3) return true;            // ブランド名が短すぎる場合は抑制しない
              const cnt = adminChainCounts.get(brand) ?? 0;
              if (cnt >= 2) return false;                   // 同チェーン3件目以降は除外
              adminChainCounts.set(brand, cnt + 1);
              return true;
            })
            .slice(0, 3)                      // 積極的に表示しつつ他ソースの多様性も残す（最大3件）
            .map(x => x.s);

          if (matchingAdmin.length > 0) {
            const adminRecs = await Promise.all(matchingAdmin.map(async (s) => {
              const name = s.google_place_name ?? s.spot_name;
              const adkm = (hasLocation && typeof s.lat === "number" && typeof s.lng === "number")
                ? haversineMeters(answers.originLat!, answers.originLng!, s.lat, s.lng) / 1000 : undefined;
              const rawImgs = (s.image_urls ?? []).filter(Boolean);
              // 旧形式URL(AU_ZVEF...等)はv1 API非対応で表示不可 → Google Text Searchで再取得する
              const isLegacyUrl = (u: string) => u.includes("maps.googleapis.com/maps/api/place/photo");
              const hasLegacyOnly = rawImgs.length > 0 && rawImgs.every(isLegacyUrl);
              let imgs = hasLegacyOnly ? [] : rawImgs.map(wrapWithPhotoProxy);
              // 心霊は独自データのみ＝admin転載の写真補完もGoogleを叩かない（スプーキーPH表示）
              if (imgs.length === 0 && apiKey && !isProprietaryOnly) {
                try {
                  const pr = await gfetch("https://places.googleapis.com/v1/places:searchText", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.photos" },
                    body: JSON.stringify({ textQuery: s.address ? `${name} ${s.address}` : name, languageCode: "ja", pageSize: 1 }),
                    cache: "no-store", signal: AbortSignal.timeout(6000),
                  });
                  if (pr.ok) {
                    const pd = await pr.json().catch(() => null);
                    const photos = (pd?.places?.[0]?.photos ?? []) as Array<{ name: string }>;
                    imgs = photos.slice(0, 10).map(p => buildPhotoProxyUrl(p.name)).filter(Boolean);
                  }
                } catch { /* 写真補完失敗は無視 */ }
              }
              return {
                title: name,
                address: s.address ?? "",
                photoUrl: imgs[0] ?? "",
                photoUrls: imgs,
                rating: null,
                userRatingCount: null,
                openNow: undefined,
                openingHoursText: undefined,
                mapUrl: s.google_maps_uri ?? "",
                googleMapsUrl: s.google_maps_uri ?? "",
                reason: pickReason(name, (s.auto_tags ?? []), s.address ?? null, s.description),   // 領域3a: 実説明優先・無ければ具体一言
                features: (s.auto_tags ?? []).filter(t => allUserTags.has(t)).slice(0, 5),
                distanceText: adkm != null ? formatDistTextFromKm(adkm) : "",
                distanceKm: adkm,
                lat: typeof s.lat === "number" ? s.lat : undefined,
                lng: typeof s.lng === "number" ? s.lng : undefined,
                durationText: "",
                stationText: s.station_info ?? "",
                vibe: "", budget: "", time: "",
                priceLevel: undefined,
                placeId: undefined,
                supabaseId: undefined,
                source: s.source ?? "admin",
                isUserSpot: (s.source ?? "admin") !== "admin",   // ユーザー投稿穴場はバッジ表示
                hasUserPhotos: imgs.length > 0,
                userPhotoCount: imgs.length,
                availableFrom: s.available_from ?? null,     // 期間限定バッジ用（穴場経路）
                availableUntil: s.available_until ?? null,
                routesByMode: undefined,
              } as Rec;
            }));
            // 先頭に注入。既存結果との名前重複を除き、admin優先で15件にトリム。
            const adminNameKeys = new Set(adminRecs.map(a => normalizeName(a.title ?? "")));
            const rest = recommendations.filter(r => !adminNameKeys.has(normalizeName(r.title ?? "")));
            recommendations = [...adminRecs, ...rest].slice(0, Math.max(15, adminRecs.length));
            console.log(`[recommend] 期間限定転載(admin)注入: ${adminRecs.length}件 (mood=${answers.mood})`);
          }
        }

        // ── 承認済みユーザーブログ投稿の注入（source=blog_post / 「ユーザー投稿」バッジ）──────
        //   approval_status=approved かつ is_searchable かつ 気分タグ一致かつ40km以内のブログを
        //   検索候補として混ぜる（最大2件）。勝手にplacesへ入れず、結果カードに表示するのみ。
        //   テーブル未作成でも try-catch で安全（従来動作）。
        try {
          const blogMoodTag = userTags.mustTags[0];
          if (supabase && blogMoodTag && !isHighrisePath) {
            const { data: blogs } = await supabase.from("blog_posts")
              .select("id, title, caption, body, place_name, address, lat, lng, google_maps_url, mood_tags, scene_tags, report_count")
              .eq("approval_status", "approved").eq("is_searchable", true)
              .contains("mood_tags", [blogMoodTag]).lt("report_count", 5).limit(20);
            const BLOG_MAX_KM = Math.min(40, radiusKm * 1.2);
            const blogSub = sbMustTags.filter(t => t !== blogMoodTag);
            const matched = (blogs ?? []).filter((b) => {
              if (blogSub.length > 0) {
                const tset = new Set([...(b.mood_tags ?? []), ...(b.scene_tags ?? [])]);
                if (!blogSub.some(t => tset.has(t))) return false;     // 深掘り一致
              }
              if (hasLocation) {
                if (typeof b.lat !== "number" || typeof b.lng !== "number") return false;
                const dkm = haversineMeters(answers.originLat!, answers.originLng!, b.lat, b.lng) / 1000;
                if (dkm > BLOG_MAX_KM) return false;
                if (minRadiusKm > 0 && dkm < minRadiusKm) return false;
              }
              return true;
            }).slice(0, 2);
            if (matched.length > 0) {
              const photoMap = new Map<string, string[]>();
              const { data: bp } = await supabase.from("blog_post_photos")
                .select("blog_post_id, photo_url, photo_order").in("blog_post_id", matched.map(b => b.id))
                .eq("moderation_status", "approved").order("photo_order", { ascending: true });
              for (const r of bp ?? []) {
                const k = (r as { blog_post_id: string }).blog_post_id;
                if (!photoMap.has(k)) photoMap.set(k, []);
                photoMap.get(k)!.push((r as { photo_url: string }).photo_url);
              }
              const blogRecs: Rec[] = matched.map((b) => {
                const imgs = (photoMap.get(b.id) ?? []).map(wrapWithPhotoProxy);
                const bdkm = (hasLocation && typeof b.lat === "number" && typeof b.lng === "number")
                  ? haversineMeters(answers.originLat!, answers.originLng!, b.lat, b.lng) / 1000 : undefined;
                return {
                  title: b.place_name || b.title,
                  address: b.address ?? "",
                  photoUrl: imgs[0] ?? "", photoUrls: imgs,
                  rating: null, userRatingCount: null, openNow: undefined, openingHoursText: undefined,
                  mapUrl: b.google_maps_url ?? "", googleMapsUrl: b.google_maps_url ?? "",
                  reason: (b.caption || b.body || "").slice(0, 80),
                  features: (b.mood_tags ?? []).filter((t: string) => allUserTags.has(t)).slice(0, 5),
                  distanceText: bdkm != null ? formatDistTextFromKm(bdkm) : "", distanceKm: bdkm,
                  lat: typeof b.lat === "number" ? b.lat : undefined, lng: typeof b.lng === "number" ? b.lng : undefined,
                  durationText: "", stationText: "", vibe: "", budget: "", time: "",
                  priceLevel: undefined, placeId: undefined, supabaseId: undefined,
                  source: "blog_post", isUserSpot: true,
                  hasUserPhotos: imgs.length > 0, userPhotoCount: imgs.length, routesByMode: undefined,
                } as unknown as Rec;
              }).filter(r => r.photoUrl);
              if (blogRecs.length > 0) {
                const keys = new Set(blogRecs.map(b => normalizeName(b.title ?? "")));
                const rest = recommendations.filter(r => !keys.has(normalizeName(r.title ?? "")));
                recommendations = [...blogRecs, ...rest].slice(0, Math.max(15, blogRecs.length));
                console.log(`[recommend] 承認済みブログ注入: ${blogRecs.length}件`);
              }
            }
          }
        } catch { /* ブログ注入失敗は無視（テーブル未作成/一時エラー） */ }

        // ── コスト削減F: Google補足結果を Supabase(places) に自動保存（fire-and-forget）──
        //   Supabaseカバレッジが育つほど将来の検索でB(充足スキップ)が効き、Google呼び出しが
        //   逓減する複利効果。座標とplaceIdが揃うGoogle由来スポットのみ保存する。
        try {
          const googleEntries = (googleSupplements as Array<Record<string, unknown>>)
            .filter(g => g.placeId && typeof g.lat === "number" && typeof g.lng === "number")
            .map(g => ({
              googlePlaceId: String(g.placeId),
              name: String(g.title ?? ""),
              address: String(g.address ?? ""),
              lat: g.lat as number,
              lng: g.lng as number,
              photoUrl: (g.photoUrl as string | undefined) ?? null,
              rating: (g.rating as number | null | undefined) ?? null,
              openNow: (g.openNow as boolean | null | undefined) ?? null,
            }))
            .filter(e => e.googlePlaceId && e.name)
            // 飲食NGコンテキストでは飲食店をSupabaseに保存しない（mood汚染を防ぐ＝根本対策）
            .filter(e => isFoodAllowedContext(answers.mood, effectiveDeepDive) || !isRestaurantName(e.name));
          // 【Yahoo保存は廃止（規約対応 2026-07-01）】Yahoo(YOLP)結果もキャッシュ制限があり、
          //   Google同様に名前/住所の恒久保存は規約グレー → Yahoo補足の auto-save を撤去。
          //   Yahoo検索自体も RECOMMEND_DISABLE_GOOGLE で停止（上の補足取得を参照）。
          if (googleEntries.length > 0) {
            const { scheduleAutoSave, scheduleGenericAutoSave, detectFoodGenreTag } =
              await import("@/lib/google-places-auto-save");
            const foodGenreTag = isFoodMood ? detectFoodGenreTag(effectiveDeepDive || (answers.mood ?? "")) : null;
            const genericTags = userTags.mustTags.filter(t => t.startsWith("#"));
            // Google: 食ジャンル別ルール優先、それ以外は mustタグで保存
            if (googleEntries.length > 0) {
              if (foodGenreTag) scheduleAutoSave(googleEntries, foodGenreTag);
              else if (genericTags.length > 0) scheduleGenericAutoSave(googleEntries, genericTags);
            }
          }
        } catch { /* 自動保存失敗は検索結果に影響させない */ }

        // ── お腹すいた: 最終結果を全体で「近い順」に並べ替え ───────────────────────
        //   各ソース内は近い順だが、ソース連結(sb+g+y+backfill)＋widen＋admin注入で
        //   遠い店が上位に来ることがある。食事は最寄り最優先なので最後に全体ソートする。
        //   （admin転載も食事では近い順に従わせる。営業中は同距離帯で優先）
        if (isFoodMood && !isDestinationFood) {
          // ※ 高層ビル料理(目的地型)は近い順ソートを行わない。
          //   3km設定等で「ジャンル一致(9km先のタワー)→混在補填(近所の定食屋)」の順に
          //   組んだ結果を距離で再ソートすると、近所の一般店がタワーより上に来てしまうため。
          const kmOfRec = (r: { distanceKm?: number; distanceText?: string }): number => {
            if (typeof r.distanceKm === "number") return r.distanceKm;
            const m = (r.distanceText ?? "").match(/\/\s*([\d.]+)\s*km/);
            return m ? parseFloat(m[1]) : 9999;
          };
          recommendations = [...recommendations].sort((a, b) => {
            // ジャンル一致を最優先（混在補填の一般店がジャンル一致より上に来ないように）
            const ga = nameMatchesGenre(a.title ?? "", effectiveDeepDive) ? 0 : 1;
            const gb = nameMatchesGenre(b.title ?? "", effectiveDeepDive) ? 0 : 1;
            if (ga !== gb) return ga - gb;
            const ka = kmOfRec(a), kb = kmOfRec(b);
            if (Math.abs(ka - kb) < 0.4) {            // 同距離帯は営業中→★評価を優先
              if (a.openNow === true && b.openNow !== true) return -1;
              if (b.openNow === true && a.openNow !== true) return 1;
              // 領域R3: 同距離帯では★(Wilson下限)の高い店を上に＝1位を★無の店にしない
              //   (例: ★無の至近店より、ほぼ同距離の★4.5多レビュー店を1位へ)。
              const ra = wilsonLower(a.rating ?? null, a.userRatingCount ?? null);
              const rb = wilsonLower(b.rating ?? null, b.userRatingCount ?? null);
              if (Math.abs(ra - rb) > 0.05) return rb - ra;
            }
            // 学習スコアを距離ボーナス換算（👍/エンゲージメントが高い店は最大3km分有利）＋④季節ボーナス
            const la = ratingJudge.learnScore(a.title ?? "") * 3 + seasonalBonusKm(a.title);
            const lb = ratingJudge.learnScore(b.title ?? "") * 3 + seasonalBonusKm(b.title);
            return (ka - la) - (kb - lb);
          }).slice(0, 15);
        } else if (minRadiusKm === 0) {
          // ── 非飲食・近距離設定/手動エリア（far-biasなし）: 最終表示順を近場優先に ──
          //   ソース連結(sb+g+y)＋widenで遠方が先頭に来ると「距離ロジックが効いていない」
          //   ように見える。近い順ベース＋ノイズで並べ、近場優先しつつ毎回少し変える。
          //   再検索(seenPlaces除外)でも残りの中で最も近いスポットから提案される。
          //   ※ far-bias時(minRadiusKm>0=遠出したい)はこのソートを行わず遠方優先のまま。
          const kmOfRec = (r: { distanceKm?: number; distanceText?: string }): number => {
            if (typeof r.distanceKm === "number") return r.distanceKm;
            const m = (r.distanceText ?? "").match(/\/\s*([\d.]+)\s*km/);
            return m ? parseFloat(m[1]) : 9999;
          };
          const jitterKm = Math.min(radiusKm * 0.12, 12);
          // OpenAI判別順(_aiRank: 0=最良)を距離ボーナスに換算。近場でもAIが「体験に合う」と
          //   判断した上位スポットを前に出す（従来は近距離設定で_aiRankが完全に無視され、
          //   絶景/自然/楽しみ系で『近いだけの平凡スポット』が上位化していた）。
          //   rank0で約+3.2km分有利・rank8以降は0。距離を覆すほど強くはしない（バランス維持）。
          const aiBonusKm = (r: { _aiRank?: number }): number =>
            typeof r._aiRank === "number" ? Math.max(0, 8 - r._aiRank) * 0.4 : 0;
          // 領域R2: 距離ハードキャップ。「近め/少し歩ける」を選んだのに7〜9kmの外れ値が
          //   学習/AI加点で上位に紛れる事象(全ペルソナ最頻不満)を断つ。cap超過はジャンル一致でも末尾band送り。
          //   ※ 距離感(intent)ベースで決める。radiusKm はクライアントが15等を送ると緩くなるため、
          //     distanceFeeling があればそれを優先(無ければ radiusKm*0.6・最小4kmにフォールバック)。
          //   far-bias(minRadiusKm>0=ちょっと遠くてもOK以上)はこの分岐に来ないので遠出体験は不変。
          const hardCapKm = (answers.distanceFeeling && DIST_HARDCAP_KM[answers.distanceFeeling] != null)
            ? DIST_HARDCAP_KM[answers.distanceFeeling]
            : Math.max(radiusKm * 0.6, 4);
          const overCapHard = (r: { distanceKm?: number; distanceText?: string }) =>
            kmOfRec(r) > hardCapKm ? 1 : 0;
          recommendations = [...recommendations]
            .sort((a, b) => {
              // ① 距離ハードキャップ超過は最後へ（近め指定の外れ値排除を最優先）
              const oa = overCapHard(a), ob = overCapHard(b);
              if (oa !== ob) return oa - ob;
              // ② ジャンル一致を優先（混在補填の異ジャンルがジャンル一致より上に来ないように）
              const ga = nameMatchesGenre(a.title ?? "", effectiveDeepDive) ? 0 : 1;
              const gb = nameMatchesGenre(b.title ?? "", effectiveDeepDive) ? 0 : 1;
              if (ga !== gb) return ga - gb;
              // ③ 学習スコア + AI判別順 + ★評価 を距離ボーナス換算（小さいほど上位）
              //   領域R3: ★(Wilson)を最大+1.2km分だけ加点＝同程度の近さなら★付き定番が上に来て
              //   1位が★無になりにくい。★無(公園/図書館等の正規キュレーション)は0で沈めない。
              const la = ratingJudge.learnScore(a.title ?? "") * 3 + aiBonusKm(a) + wilsonLower(a.rating ?? null, a.userRatingCount ?? null) * 1.2 + seasonalBonusKm(a.title);
              const lb = ratingJudge.learnScore(b.title ?? "") * 3 + aiBonusKm(b) + wilsonLower(b.rating ?? null, b.userRatingCount ?? null) * 1.2 + seasonalBonusKm(b.title);
              return ((kmOfRec(a) - la) - (kmOfRec(b) - lb)) + (Math.random() - 0.5) * jitterKm * 2;
            })
            .slice(0, 15);
        }

        // ── 最終結果の補完エンリッチ（営業時間＋写真10枚）─────────────────────────
        //   Yahoo/Supabase 由来の店は営業時間・写真が欠けがち。結果画面では充実を優先し、
        //   営業時間が無い or 写真が10枚未満の結果だけ Google Text Search で補完する。
        //   （表示する15件のみ対象。各店1回の searchText で hours+photos を一括取得）
        //   心霊は独自データのみ＝最終エンリッチでもGoogleを叩かない（写真なしはスプーキーPH表示）
        if (apiKey && recommendations.length > 0 && !isProprietaryOnly) {
          // ── コスト削減: 長期キャッシュ(enr:)から写真・営業時間をprefill ──────────
          //   2回目以降の検索ではGoogleを呼ばず同一データを返す（品質は完全同一）
          const enrKeys = recommendations.map(r => `enr:${(r.title ?? "").slice(0, 80)}`);
          const enrHit = await ltCacheGetMany(enrKeys);
          recommendations = recommendations.map((rec) => {
            const c = enrHit.get(`enr:${(rec.title ?? "").slice(0, 80)}`) as EnrichCacheVal | undefined;
            if (!c) return rec;
            const photoUrls = filterLivePhotos(Array.isArray(rec.photoUrls) ? rec.photoUrls : []);
            const upd: typeof rec = { ...rec };
            // キャッシュ側の死んだGoogle写真を除外してから“生きている枚数”で比較する。
            //   除外しないと、失効Google10枚が生きたWikimedia1枚を上書きしてカードがグレーになる（大手町温泉の事例）。
            const cachedLive = filterLivePhotos(c.photoUrls ?? []);
            if (cachedLive.length > photoUrls.length) {
              upd.photoUrls = cachedLive;
              upd.photoUrl = cachedLive[0] ?? rec.photoUrl;
            } else if (photoUrls.length < (Array.isArray(rec.photoUrls) ? rec.photoUrls.length : 0)) {
              // rec 側に死んだGoogleが混ざっていた場合も、生きた写真だけに正規化する。
              upd.photoUrls = photoUrls;
              upd.photoUrl = photoUrls[0] ?? rec.photoUrl;
            }
            if ((rec.openNow === undefined || !rec.openingHoursText) && c.periods) {
              const st = computeOpenStatus({ openNow: undefined, periods: c.periods });
              upd.openNow = st.openNow ?? upd.openNow;
              upd.openStatusBadge = st.badge ?? upd.openStatusBadge;
              if (c.weekday?.length) upd.openingHoursText = c.weekday.join("\n");
            }
            return upd;
          });
          // Google写真の「ライブ表示」復活(2026-07-19 ユーザー選択): 写真ゼロのスポットだけ Google searchText(places.photos/Pro SKU)で
          //   写真referenceを取得し、CTAの次(2枚目以降)にスクロール到達時だけ表示する（photo-proxyで解決＝そこで初めて課金）。
          //   ⚠ライセンス: DB(places.image_urls/photo_url)には保存しない＝「その場表示だけ」（Googleの30日キャッシュ規約内の
          //     enrキャッシュ(api_cache)には置くが恒久列には書かない）。帰属表示はカードのGoogle由来UIで担保。
          //   ⚠要件: Google Cloudで Places API(New) 有効化＋課金オン（未有効=403で写真取得できず→CTAのまま=無害）。
          //   停止するなら RECOMMEND_DISABLE_PHOTO_SEARCHTEXT=1。
          const ENABLE_PHOTO_SEARCHTEXT = process.env.RECOMMEND_DISABLE_PHOTO_SEARCHTEXT !== "1";
          await Promise.all(recommendations.map(async (rec, idx) => {
            if (!ENABLE_PHOTO_SEARCHTEXT) return;
            // OSM由来の店はGoogleエンリッチしない（写真=ジャンル別PH＋利用者投稿／営業時間=OSM情報。searchText削減）
            if ((rec.source ?? "").startsWith("osm")) return;
            const photoUrls = Array.isArray(rec.photoUrls) ? rec.photoUrls : [];
            // 写真が1枚でもあれば（生きた無料写真）Google補完はしない（ユーザー要望2026-07-16）。
            //   写真ゼロのスポットだけGoogleに1枚目を問い合わせる（API費用最小化）。残り枚数はフロントの
            //   遅延読み込み（maxLoaded＝1枚目のみ即読込み・スクロールで到達分だけ解決）でコストを抑える。
            const needPhotos = filterLivePhotos(photoUrls).length === 0;
            // FieldMask最小化に伴い営業時間はGoogleから取らない＝needHoursだけでは発火させない
            //   （写真ゼロのスポットのみ Google searchText を叩く＝Pro SKU で最小コスト）。
            if (!needPhotos) return;       // 既に写真あり → スキップ（営業時間はOSM/利用者入力）
            // 確認済み（過去30日にGoogleへ問い合わせ済み）の店は再取得しない。
            //   写真が十分(3枚+) or そもそもGoogleに写真/営業時間が無い店＝聞き直しても同じ
            const cVal = enrHit.get(`enr:${(rec.title ?? "").slice(0, 80)}`) as EnrichCacheVal | undefined;
            if (cVal?.checked) {
              const photosOk = photoUrls.length >= 3 || !cVal.photoUrls;  // 充足 or 元から無し
              const hoursOk  = !!(cVal.periods || cVal.weekday) || rec.openingHoursText || true;  // 確認済み=これ以上増えない
              if (photosOk && hoursOk) return;
            }
            try {
              const q = rec.address ? `${rec.title} ${rec.address}` : rec.title ?? "";
              if (!q.trim()) return;
              const er = await gfetch("https://places.googleapis.com/v1/places:searchText", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Goog-Api-Key": apiKey,
                  // FieldMask最小化(2026-07-16): 営業時間を外し Enterprise→Pro SKU へ単価ダウン。
                  //   営業時間は OSM＋利用者入力(userHoursOpenNow)で代替（Googleからは写真だけ取得）。
                  "X-Goog-FieldMask": "places.photos",
                },
                body: JSON.stringify({ textQuery: q, languageCode: "ja", regionCode: "JP", pageSize: 1 }),
                cache: "no-store", signal: AbortSignal.timeout(6000),
              });
              if (!er.ok) return;
              const ed = await er.json().catch(() => null);
              const place = ed?.places?.[0];
              if (!place) {
                await ltCachePut(`enr:${(rec.title ?? "").slice(0, 80)}`, { checked: true });  // 解決不能も記憶
                return;
              }
              // 写真を最大10枚「ライブ表示用」に補完（Google再有効化・2026-07-19）。
              //   ⚠ライセンス: DB(places.image_urls/photo_url)には恒久保存しない＝schedulePlaceWriteBackは呼ばない。
              //     rec.photoUrls に載せるのは「今回の応答で表示する」ためだけ（enrキャッシュは30日規約内・恒久列ではない）。
              //   ⚠filterLivePhotos は使わない: DB由来の古い(失効)Google除去用のため。ここは今取ったばかりの生きたreference。
              const enrSave: EnrichCacheVal = {};
              if (needPhotos) {
                const photos = (place.photos ?? []) as Array<{ name?: string }>;
                const freeCount = filterLivePhotos(photoUrls).length;   // 既存の無料写真枚数（Google除く）
                const urls = photos.slice(0, 10).map(p => (p.name ? buildPhotoProxyUrl(p.name) : "")).filter(Boolean);  // 生きたGoogle写真reference（除去しない）
                if (urls.length > freeCount) {
                  // 無料写真ゼロのスポットのみここに来る（needPhotos）＝CTAの次にこのGoogle写真を出す。DBには保存しない。
                  recommendations[idx] = { ...recommendations[idx], photoUrls: urls, photoUrl: urls[0] ?? rec.photoUrl };
                }
                if (urls.length > 0) enrSave.photoUrls = urls;
              }
              // 営業時間のGoogle補完は廃止(2026-07-16 FieldMask最小化)＝営業時間はOSM＋利用者入力で表示。
              //   Googleへは places.photos だけを要求し Pro SKU 単価に抑える。
              // 長期キャッシュへ保存。データが無い店も checked:true を記憶し
              //   「聞いても無い店」への再問い合わせを止める（次回以降call0）
              const prev = enrHit.get(`enr:${(rec.title ?? "").slice(0, 80)}`) as EnrichCacheVal | undefined;
              await ltCachePut(`enr:${(rec.title ?? "").slice(0, 80)}`, { ...prev, ...enrSave, checked: true });
            } catch { /* 補完失敗は無視 */ }
          }));
        }

        // ── 駅情報の全件付与（HeartRails無料化により可能になった品質向上）──────────
        //   従来はSupabase出自のスポットのみ駅付きだった。無料なので全15件に付与する。
        //   （lt永続キャッシュ st: が効くため2回目以降は外部呼び出しもゼロ）
        await Promise.all(recommendations.map(async (rec, idx) => {
          if (rec.stationText) return;
          if (typeof rec.lat !== "number" || typeof rec.lng !== "number") return;
          try {
            const st = await findNearestStation(rec.lat, rec.lng, apiKey);
            if (st) {
              recommendations[idx] = { ...recommendations[idx], stationText: st };
              // 駅情報を places に自動保存（NULL行のみ）→次回以降は外部呼び出しゼロで即表示
              schedulePlaceWriteBack({ name: rec.title ?? "", id: rec.supabaseId, googlePlaceId: rec.placeId, address: rec.address }, { station: st });
            }
          } catch { /* 駅なしは無視 */ }
        }));

        // ── LLMリランカー: 気分・希望に「ぴったり来る順」へ並べ替え ──────────────
        //   体験系の気分のみ（飲食=近い順優先/スリル=独自少数 は対象外）。
        //   ジャンルフィルタでは拾えない「それっぽさ」をLLMに汲み取らせる。
        //   候補は全て実在データなので幻覚ゼロ。失敗・タイムアウト時は元の順序を維持。
        if (openai && !isFoodMood && !isProprietaryOnly && recommendations.length >= 5) {
          try {
            const cand = recommendations.slice(0, 15).map((r, i) =>
              `${i}: ${r.title ?? ""}｜${(r.features ?? []).slice(0, 3).join("/")}｜${r.distanceText ?? ""}｜★${r.rating ?? "-"}`
            ).join("\n");
            const rr = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              temperature: 0.2,
              max_tokens: 160,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: 'あなたは出かけ先の並べ替えAIです。ユーザーの気分・希望に「最もぴったり来る順」に候補番号を並べ替え、{"order":[数値,...]} のみをJSONで返してください。全ての番号を1回ずつ含めること。' },
                { role: "user", content: `気分:${answers.mood ?? ""}／深掘り:${effectiveDeepDive || "なし"}／同行:${answers.companion ?? ""}／希望:${answers.freeWord || refinementText || "なし"}\n候補:\n${cand}` },
              ],
            }, { signal: AbortSignal.timeout(7000) });
            const parsed = JSON.parse(rr.choices?.[0]?.message?.content ?? "{}");
            const order: unknown[] = Array.isArray(parsed.order) ? parsed.order : [];
            if (order.length > 0) {
              const seen = new Set<number>();
              const out: typeof recommendations = [];
              for (const x of order) {
                const i = Number(x);
                if (Number.isInteger(i) && i >= 0 && i < recommendations.length && !seen.has(i)) {
                  seen.add(i); out.push(recommendations[i]);
                }
              }
              for (let i = 0; i < recommendations.length; i++) if (!seen.has(i)) out.push(recommendations[i]);
              if (out.length === recommendations.length) recommendations = out;
            }
          } catch { /* 失敗時は元の順序を維持（品質劣化させない） */ }
        }

        // ── 有料掲載（スポンサー枠）を最上位に確保（PR表示）──────────────────────
        //   SPONSORED_LISTINGS_ENABLED=1 のときのみ作動（SQL未適用時の無駄なクエリを回避）。
        //   心霊(独自)・現在地なしは対象外。気分タグ一致＋半径内のみ＝無関係な広告は出さない。
        //   全ソート/エンリッチ後にprependするため確実に先頭。isSponsored で PR バッジを出す。
        if (process.env.SPONSORED_LISTINGS_ENABLED === "1" && hasLocation && !isProprietaryOnly) {
          try {
            const { fetchSponsoredPlaces } = await import("@/lib/sponsored");
            const sponsored = await fetchSponsoredPlaces({
              lat: answers.originLat!, lng: answers.originLng!,
              radiusKm, moodTags: userTags.mustTags, max: 2,
            });
            if (sponsored.length > 0) {
              const normSp = (s: string) => (s ?? "").normalize("NFKC").toLowerCase().replace(/[^0-9a-z぀-ヿ一-鿿ｦ-ﾟ]+/g, "");
              const spRecs = sponsored.map((s) => {
                const km = (typeof s.lat === "number" && typeof s.lng === "number")
                  ? haversineMeters(answers.originLat!, answers.originLng!, s.lat, s.lng) / 1000 : undefined;
                const imgs = mergedPlacePhotos(s).map(wrapWithPhotoProxy);
                return {
                  title: s.name, address: s.address ?? "",
                  photoUrl: imgs[0] ?? "", photoUrls: imgs,
                  rating: null, userRatingCount: null, openNow: undefined,
                  openStatusBadge: undefined, openingHoursText: undefined,
                  mapUrl: "", googleMapsUrl: "",
                  reason: pickReason(s.name, (s.tags ?? []), s.address ?? null, s.description), features: (s.tags ?? []).slice(0, 5),
                  distanceText: km != null ? formatDistText(km, answers.transport) : "",
                  distanceKm: km, distanceM: null, lat: s.lat ?? undefined, lng: s.lng ?? undefined,
                  durationText: "", stationText: s.nearest_station ?? "",
                  vibe: "", budget: "", time: "", priceLevel: undefined,
                  placeId: s.google_place_id ?? undefined, supabaseId: s.id,
                  source: "admin", isUserSpot: false, hasUserPhotos: false, userPhotoCount: 0,
                  routesByMode: undefined, tags: s.tags ?? [], isSponsored: true,
                };
              }) as unknown as typeof recommendations;
              const spKeys = new Set(spRecs.map((r) => normSp(r.title ?? "")));
              const rest = recommendations.filter((r) => !spKeys.has(normSp(r.title ?? "")));
              recommendations = [...spRecs, ...rest].slice(0, Math.max(15, spRecs.length));
            }
          } catch { /* スポンサー取得失敗は通常結果で続行 */ }
        }

        // ── ★評価の自動充填・永続化（事業化①）──────────────────────────────────
        //   ① 表示recのうち評価済み(live Google/Yahoo)＋placeIdあり → 既知の★をそのまま
        //      places へ永続化（次回SBキャッシュ表示でも★が残る）。API呼び出しゼロ。
        //   ② 評価なし＋placeIdあり(SBキャッシュのgoogle由来＝都市の食事/娯楽で★が欠落) →
        //      Place Detailsで★取得→永続化。最大10件・after()・失敗無視。次回からキャッシュ表示で
        //      Place Details呼び出しが逓減。心霊(独自)は対象外。列未作成(place-ratings.sql未適用)も安全。
        if (!isProprietaryOnly && supabase) {
          const sbW = supabase;
          const withRating = recommendations.filter(r => r.placeId && typeof r.rating === "number");
          // Google評価の取得は全面撤廃: 不足分をGoogle Place Detailsで補完しない（needRating常に空＝Google rating取得ゼロ）。
          const needRating: typeof recommendations = [];
          if (withRating.length > 0 || needRating.length > 0) {
            after(async () => {
              await Promise.all(withRating.map(r =>
                sbW.from("places")
                  .update({ rating: r.rating, rating_count: r.userRatingCount ?? null, rating_updated_at: new Date().toISOString() })
                  .eq("google_place_id", r.placeId!).then(() => {}, () => {})
              ));
              await Promise.all(needRating.map(async (r) => {
                try {
                  const pr = await gfetch(`https://places.googleapis.com/v1/places/${r.placeId}`, {
                    method: "GET",
                    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "rating,userRatingCount" },
                    cache: "no-store", signal: AbortSignal.timeout(5000),
                  });
                  if (!pr.ok) return;
                  const pd = await pr.json().catch(() => null);
                  if (pd && typeof pd.rating === "number") {
                    await sbW.from("places")
                      .update({ rating: pd.rating, rating_count: typeof pd.userRatingCount === "number" ? pd.userRatingCount : null, rating_updated_at: new Date().toISOString() })
                      .eq("google_place_id", r.placeId!).then(() => {}, () => {});
                  }
                } catch { /* Place Details失敗は無視 */ }
              }));
            });
          }
        }

        // 近め0件対策(spatialSearchの半径エスカレーション)で要求半径を大きく超えるスポットで埋めた場合も
        //   「範囲を広げました」を表示する（例:すぐそこ×自然で近隣に該当が無く数km先の自然で代替提示）。
        if (!widenedSearch && minRadiusKm === 0 && recommendations.length > 0) {
          const maxKm = Math.max(
            0,
            ...recommendations.map(r => typeof r.distanceKm === "number" ? r.distanceKm : 0),
          );
          if (maxKm > radiusKm * 1.3) widenedSearch = true;
        }
        // B-2: 検索幅を広げた場合のワーニングメッセージ
        const widenedWarning = widenedSearch
          ? "条件に合うスポットが少なかったため、範囲を少し広げました。"
          : "";

        applyLimitedTimeOverride(recommendations as unknown as LimitedEventRec[], limitedEvents);
        await applyUserPhotos(recommendations as unknown as UserPhotoRec[]);
        // 領域8: Google/Yahoo補足カードの理由空欄を埋める(ペルソナ「補足だけ素っ気ない」対応)。
        //   SBと同じ gpt-4o-mini 1バッチを再利用。理由が空のカードが在る時だけ・心霊は対象外＝低コスト。
        //   generateSupabaseReasons は name/category/tags/description を見るので title→name に正規化して渡す。
        if (!isProprietaryOnly && openai) {
          const needReason = recommendations.filter(r => !((r.reason ?? "").trim()) && !((r.aiReason ?? "").trim()));
          if (needReason.length > 0) {
            const suppInput = needReason.map(r => ({
              name: r.title ?? "", category: "", tags: (r.features ?? []), description: "",
            })) as unknown as import("@/types/onsen").PlaceResponse[];
            try {
              const suppReasons = await generateSupabaseReasons(suppInput, answers, sbMustTags, sbNiceTags);
              for (const r of recommendations) {
                const txt = suppReasons.get(r.title ?? "");
                if (txt && !((r.reason ?? "").trim())) { r.reason = txt; r.aiReason = txt; }
              }
            } catch { /* 補足理由生成失敗は空のまま続行 */ }
          }
        }
        // 領域3b: 車距離スポットの「駅から徒歩◯分」を「最寄り:◯◯駅」へ整え距離表記の矛盾を解消（in-place）。
        stationConsistency(recommendations);
        diversifyByCategory(recommendations as unknown as DivRec[]);
        // 領域5: 同ブランド2件・同サブカテゴリ4件にcapし著名定番を上位確保（非食事・非心霊のみ）。
        //   ※ diversifyByCategory の「後」に最後の整形として適用する。先に適用すると
        //     diversifyByCategory のラウンドロビンで cap 超過要素が中位へ繰り上がり cap が無効化されるため
        //     （カラオケ同チェーンが再び上位に並ぶ）。最後に置くことで cap 並びが最終出力に確実に残る。
        recommendations = finalizeAssembled(recommendations);
        // 安全網(2026-07-20 監査): センシティブ施設(墓地/霊園/葬祭/慰霊碑/災害跡/居住団地)は全気分で除外。
        //   finalizeAssembledは心霊を早期returnで迂回するため、ここで全結果(心霊含む)に機械適用する。
        //   実在の墓地/葬儀場/災害惨事跡/居住を「肝試し」やポジティブ気分に出す法務/風評/プライバシー害を断つ。
        recommendations = recommendations.filter(r => !SENSITIVE_UNFIT_RE.test((r.title ?? "").trim()));
        // Z世代UNFIT(2026-07-20 ユーザー要望・強め既定): 銀行/郵便局/役所/駐車場/卸/工場/学校/児童公園/断片等の
        //   “のっぺり”インフラを全気分で除去。ただし全滅する疎エリアは0件回避で原状維持。
        {
          const genzKept = recommendations.filter(r => !GENZ_NOISE_RE.test((r.title ?? "").trim()));
          if (genzKept.length > 0) recommendations = genzKept;
        }
        // 定番(神社/寺)の条件付き降格(2026-07-20 ユーザー選択①有名なら残す②気分次第): まったり/自然/旅行/
        //   ドライブ以外(楽しみたい/集中/運動/ショッピング/スリル等)では無名の神社/寺を除去=「神社4連発」を断つ。
        //   #名所/#名所公園/#世界遺産の有名スポットは気分を問わず残す。0件回避の安全弁つき。
        if (!isFoodMood && !["まったり", "自然", "旅行", "ドライブ", "疲れた・眠い"].includes(answers.mood ?? "")) {
          const SHRINE_TEMPLE_RE = /神社|神宮|大社|稲荷$|稲荷神社|八幡宮|天満宮|東照宮|大師|不動尊|観音堂|薬師堂|仏閣|寺院|(?:^|[^ぉ-ん])寺$|山門|鳥居|霊場/;
          const isFamous = (r: { tags?: string[] }) => (r.tags ?? []).some(t => ["#名所", "#名所公園", "#世界遺産"].includes(t));
          const kept = recommendations.filter(r => !SHRINE_TEMPLE_RE.test((r.title ?? "").trim()) || isFamous(r));
          if (kept.length > 0) recommendations = kept;
        }
        // 地味な小さい公園を最終出力の最後尾へ（diversify/assembleの後＝並べ替えが確実に残る）。
        recommendations = demoteFillerParks(recommendations, effectiveDeepDive);
        // 期間限定の最終保証: places本体の期間外スポットを除外（RPC/意味検索/名前救済など
        //   全SB経路をここで一括ガード。2026-07-06検証: RPCが期間外を返すことを実証→修正）。
        try {
          const { outOfPeriodPlaceIds } = await import("@/lib/spatial-search");
          const outIds = await outOfPeriodPlaceIds(
            recommendations.map(r => (r as { supabaseId?: string }).supabaseId ?? "").filter(Boolean),
          );
          if (outIds.size > 0) {
            recommendations = recommendations.filter(r => {
              const sid = (r as { supabaseId?: string }).supabaseId;
              return !sid || !outIds.has(sid);
            });
          }
        } catch { /* 期間ガード失敗は素通り（検索自体は成立させる） */ }
        // 期間限定バッジ用: 各recの supabaseId から places.available_from/until を載せる（全経路共通ヘルパー）
        recommendations = await attachAvailability(recommendations, moodGroup(answers.mood));
        // 領域R2(最終確定): LLMリランカー(7819)・多様化の後でも「近め指定の距離外れ値」を末尾へ。
        //   rerankerが遠方を上位に戻すため、ここで cap 超過を安定パーティションで末尾固定する(順序保持)。
        //   far-bias(minRadiusKm>0)・高層ビル目的地・心霊は対象外＝遠方意図/独自データを壊さない。
        if (minRadiusKm === 0 && !(isFoodMood && isDestinationFood) && !isProprietaryOnly) {
          const capKm = (answers.distanceFeeling && DIST_HARDCAP_KM[answers.distanceFeeling] != null)
            ? DIST_HARDCAP_KM[answers.distanceFeeling] : Math.max(radiusKm * 0.6, 4);
          const kmF = (r: { distanceKm?: number; distanceText?: string }): number =>
            typeof r.distanceKm === "number" ? r.distanceKm
              : (parseFloat((r.distanceText ?? "").match(/\/\s*([\d.]+)\s*km/)?.[1] ?? "") || 9999);
          // 距離不明(=9999)はフィルタ対象外として常に残す（距離が取れないだけで除外しない）
          const kmKnown = (r: { distanceKm?: number; distanceText?: string }) => kmF(r) < 9000;
          // ── 距離外れ値を末尾へ（安定パーティション・15件維持）──────────────────
          //   仕様準拠(2026-07-19 ユーザー選択「末尾+15件維持」): cap 超過スポットは除外せず
          //   末尾に回して件数を落とさない。near側の相対順序を保ちつつ、遠すぎる外れ値
          //   (例: 近め指定で7〜9km)だけ後方へ安定移動する。距離不明は within 扱いで温存。
          const within = recommendations.filter(r => !kmKnown(r) || kmF(r) <= capKm);
          const over   = recommendations.filter(r => kmKnown(r) && kmF(r) > capKm);
          // within が空(=全件 cap 超過の超過疎エリア)なら並べ替えても意味が無いので現状維持。
          if (within.length > 0 && over.length > 0) {
            recommendations = [...within, ...over];
          }
        } else if (minRadiusKm > 0 && !isFoodMood && !isProprietaryOnly) {
          // far-bias(遠出)の最終表示順(2026-07-19): finalizeの多様化/rerankerが近場を上位へ戻すため
          //   「遠出を選んだのに近所ばかり」になっていた→遠寄りを最終保証。ただし単純な遠い順だと全て外縁に
          //   密集する(小旅行=全120km・監査で最低スコア)ため farLeanSpread で[min,radius]全域に遠寄りで散らす。
          //   バンド内はジャンル一致を優先(tieBreak)。距離不明(0扱い)は最近バンドへ。
          const kmF2 = (r: { distanceKm?: number; distanceText?: string }): number =>
            typeof r.distanceKm === "number" ? r.distanceKm
              : (parseFloat((r.distanceText ?? "").match(/\/\s*([\d.]+)\s*km/)?.[1] ?? "") || 0);
          const maxKm = Math.max(minRadiusKm + 1, ...recommendations.map(kmF2));
          recommendations = farLeanSpread(
            recommendations, kmF2, minRadiusKm, maxKm,
            { tieBreak: (r) => (nameMatchesGenre(r.title ?? "", effectiveDeepDive) ? 0 : 1) },
          );
        }
        // freeWordハードジャンルフィルタ(2026-07-20 監査#1/Z世代最大の萎え): ドロップダウン深掘り未選択でも
        //   freeWordが明確にジャンル(古着/サウナ/夜景/韓国/雑貨/海辺/絶景/カフェ)を指す時、非該当を除去。
        //   名前肯定語 or ジャンルタグ一致で「該当」。下限8件は維持(除去しすぎない=薄いより関連ズレの方が萎えるが0件は困る)。
        if (!hasDropdownDeepDive) {
          const fg = freewordGenreRule(answers.freeWord ?? "");
          // 明示ドロップダウン深掘り無し時のみ作動(freeWord由来でeffectiveDeepDiveが昇格しても本フィルタで再絞り)。
          //   食事気分でもfreeWordが食ジャンル(韓国/カフェ等)を明示したら絞る。
          if (fg) {
            const isMatch = (r: { title?: string; tags?: string[] }) =>
              fg.pos.test(r.title ?? "") || (r.tags ?? []).some(t => fg.tags.includes(t));
            const keep = recommendations.filter(isMatch);
            const floor = Math.min(8, recommendations.length);
            if (keep.length >= floor) {
              recommendations = keep;                                          // 十分該当あり→非該当を完全除去
            } else if (keep.length > 0) {
              recommendations = [...keep, ...recommendations.filter(r => !isMatch(r))];  // 薄い→該当を上位・非該当は末尾
            }
          }
        }
        // 説明文の完全重複を最終段で潰す(2026-07-20 監査#1): 同一vibe定型文が2件目以降で出たら言い換えに差し替え。
        recommendations = dedupeReasons(recommendations);
        return json({
          recommendations,
          source: "supabase",
          searchId,
          usedAI: !!process.env.OPENAI_API_KEY,
          widenedSearch,
          warning: hasLocation
            ? widenedWarning
            : "現在地未使用のため、距離順ではない場合があります。",
        });
      }
    } catch (err) {
      console.error("[recommend] Supabase-first flow error, falling back:", err);
      scheduleServerError("recommend.sbfirst", err);
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
      { const cleaned = sanitizeReasonText(s.description); if (cleaned) parts.push(cleaned); }  // 領域3a
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

    // ── お腹すいた 専用処理 ───────────────────────────────────────────────────
    const isFoodMood = answers.mood === "お腹すいた";

    // 高層ビル料理が選択されているかチェック（Google Places専用）
    const isHighriseFood = isFoodMood &&
      getDynamicQs(answers).some(dq => dq.answer.includes("高層ビル料理"));

    const resolvedLat = answers.originLat;
    const resolvedLng = answers.originLng;

    // ── 高層ビル料理: Google Placesで専用クエリ実行 ────────────────────────────
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
            const res = await gfetch("https://places.googleapis.com/v1/places:searchText", {
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
                // 飲食店カテゴリのみに絞る（公園・展望台などを除外）
                includedType: "restaurant",
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
        // ── ネガティブフィルタ: 公園・展望台・非飲食施設を除外 ─────────────────
        const HIGHRISE_NG = [
          // 公園・屋外スポット
          "公園", "緑地", "広場", "河川敷", "遊歩道", "児童遊園",
          "自然公園", "都立公園", "国立公園", "運動公園",
          // 展望台（レストランなし）※ "展望レストラン" は通過させるため名前末尾チェック
          "展望台", "展望所", "展望スポット", "見晴台", "見晴らし台",
          // 観光施設・文化施設
          "美術館", "博物館", "水族館", "動物園", "神社", "寺院", "神宮",
          "資料館", "記念館", "科学館",
          // 公共インフラ
          "駅", "空港", "港", "埠頭",
        ];

        // ── ポジティブフィルタ: 名前 or 住所に「高層レストラン」系キーワードが必須 ──
        // 「展望」単体は展望台に引っかかるため、「展望レストラン」「展望ダイニング」等
        // の複合語か、他の飲食系キーワードとの組み合わせのみ通過させる
        const HIGHRISE_POSITIVE_NAME = [
          "スカイレストラン", "スカイダイニング", "スカイラウンジ", "スカイバー",
          "展望レストラン", "展望ダイニング", "展望ラウンジ",
          "ルーフトップレストラン", "ルーフトップバー", "ルーフトップダイニング",
          "高層レストラン", "高層ダイニング",
          "sky restaurant", "sky dining", "sky lounge", "Sky Restaurant", "Sky Dining",
          "ホテルダイニング", "ホテルレストラン", "ホテルラウンジ",
          // 高層ビル名に使われるキーワード（単独でも飲食店と判断しやすい）
          "タワーレストラン", "タワーダイニング", "タワーラウンジ",
        ];
        // 「スカイ」「タワー」「ホテル」単体は名前に含まれ、かつ料理・食事系ワードが住所にある場合のみ
        const HIGHRISE_POSITIVE_NAME_PARTIAL = [
          "スカイ", "Sky", "sky", "SKY",
          "タワー", "Tower", "tower",
          "ホテル", "Hotel", "hotel",
          "ルーフ", "Roof", "roof",
          "ラウンジ", "Lounge",
        ];
        const HIGHRISE_POSITIVE_ADDR = [
          // 住所に「○階」「タワー」「ビル」が入っている ＝ 高層ビル内テナントの可能性大
          "階", "タワー", "ビル", "Tower", "TOWER",
        ];

        // dedup & フィルタ & build result format
        const seen = new Set<string>();
        const hiShops = await Promise.all(
          hiResults
          .filter(p => {
            const id = String(p.id ?? "");
            if (!id || seen.has(id)) return false;
            seen.add(id);
            const name    = ((p.displayName as Record<string, unknown>)?.text as string) ?? "";
            const address = String(p.formattedAddress ?? "");
            // ① NGワードで即除外（公園・展望台など）
            if (HIGHRISE_NG.some(ng => name.includes(ng))) return false;
            // ② 複合語（「展望レストラン」等）が名前に含まれる → 確実に通過
            if (HIGHRISE_POSITIVE_NAME.some(kw => name.includes(kw))) return true;
            // ③ 部分一致キーワード（「スカイ」「タワー」等）+ 住所に階・ビルあり → 通過
            const hasPartialName = HIGHRISE_POSITIVE_NAME_PARTIAL.some(kw => name.includes(kw));
            const hasAddrClue   = HIGHRISE_POSITIVE_ADDR.some(kw => address.includes(kw));
            return hasPartialName && hasAddrClue;
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
          // 高層ビル料理を Supabase に自動保存（fire-and-forget）
          const { scheduleAutoSave } = await import("@/lib/google-places-auto-save");
          scheduleAutoSave(
            hiShops.map(s => ({
              googlePlaceId: s.id,
              name: s.name,
              address: s.address,
              lat: s.lat,
              lng: s.lng,
              photoUrl: s.photoUrl ?? null,
              rating: s.rating ?? null,
              openNow: s.openNow ?? null,
            })),
            "#高層ビル料理"
          );
          // ── 出力形状を全経路共通(title/distanceText)に統一 ───────────────────────
          //   旧来この経路だけ gourmet形状(name/url/genre)を返しており、アプリの
          //   Recommendation型(title必須)と不一致でタイトル/距離が表示されなかった。
          //   距離は単一ソース(formatDistText)で付与。目的地型グルメのため近い順ソートはしない。
          const hiHasOrigin = typeof answers.originLat === "number" && typeof answers.originLng === "number";
          const hiFinal = hiShops.map(s => {
            const km = hiHasOrigin
              ? haversineMeters(answers.originLat!, answers.originLng!, s.lat, s.lng) / 1000
              : undefined;
            return {
              title: s.name,
              address: s.address,
              lat: s.lat,
              lng: s.lng,
              placeId: s.id || undefined,   // Google Place ID（詳細ページで口コミ/営業時間を取得）
              mapUrl: s.url,
              googleMapsUrl: s.url,
              photoUrl: s.photoUrl,
              photoUrls: s.photoUrls,
              rating: s.rating,
              userRatingCount: s.reviewCount,
              openNow: s.openNow ?? undefined,
              distanceText: km != null ? formatDistText(km, answers.transport) : "",
              distanceKm: km,
              reason: s.genreCatch || "",
              features: [] as string[],
              vibe: "",
              budget: "",
              time: "",
              stationText: "",
              durationText: "",
              source: "google" as const,
            };
          });
          await applyUserPhotos(hiFinal as unknown as UserPhotoRec[]);
          diversifyByCategory(hiFinal as unknown as DivRec[]);
          return json({ recommendations: await attachAvailability(hiFinal, moodGroup(answers.mood)), usedAI: true, warning: "" });
        }
      }
    }

    // ── ここより下はお腹すいた以外のGoogle Places検索 ──────────────────────────

    // ── まったり/時間潰し(relax系): 単一textQuery → Places 1回 → シャッフル3件 ──────
    if (moodGroup(answers.mood) === "relax" && apiKey) {
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
          const res = await gfetch("https://places.googleapis.com/v1/places:searchText", {
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
            // 距離の単一ソース化用に座標をトップレベルへ（normalizeDistance が参照）
            lat: typeof place.location?.latitude === "number" ? place.location.latitude : undefined,
            lng: typeof place.location?.longitude === "number" ? place.location.longitude : undefined,
            distanceKm: undefined as number | undefined,
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
          return {
            ...y,
            // 距離の単一ソース化用に座標をトップレベルへ（normalizeDistance が参照）
            lat: typeof y.location?.latitude === "number" ? y.location.latitude : undefined,
            lng: typeof y.location?.longitude === "number" ? y.location.longitude : undefined,
            distanceKm: undefined as number | undefined,
            stationText,
            reason: relaxAiResult?.reason || y.vibe || "",
          };
        })
      );
      // ── Step 3: まったり経路にも共通の品質フィルタを適用（createFinalizeHelpers）──
      //   経路2/5と同じ qualitySanitize で B2B(株式会社/工場)・写真なし低評価スポットを除外。
      //   ※ まったりは食事moodではないため foodSanitize は実質no-op（温泉カフェ等を誤除外しない）。
      //   ※ ユーザー登録スポット(isUserSpot)は写真/評価が無くても保護して残す。
      //   ※ 10件スライス前に適用し、ジャンクが表示枠を埋めないようにする。
      const relaxHelpers = createFinalizeHelpers({
        isFoodMood: false,          // まったり経路は食事moodでない（foodSanitizeは実質無効）
        minRadiusKm,                // 距離設定の遠端バイアスを尊重
        isBadWeather: false,        // 並びは従来通りシャッフルに委ねる
        goodVisitedPlaces,
        seenPlaces,
        showUnseenOnly: false,      // まったりは別途seen除外していないため二重適用にはならない
        effectiveDeepDive: "",
        originLat: answers.originLat, originLng: answers.originLng, transport: answers.transport,
      });
      const relaxPool = [...relaxResults, ...yahooWithStation];
      const isProtectedRelax = (r: { isUserSpot?: boolean }) => r.isUserSpot === true;
      const relaxCleaned = relaxHelpers.qualitySanitize(
        relaxHelpers.foodSanitize(relaxPool.filter(r => !isProtectedRelax(r)))
      );
      const relaxKeepSet = new Set([...relaxPool.filter(isProtectedRelax), ...relaxCleaned]);
      // ── 距離ロジックを全経路と統一 ──────────────────────────────────────────────
      //   ① normalizeDistance: 座標(location→lat/lng)から距離テキスト/kmを単一ソースで付与
      //      （まったり経路はこれまで距離を一切表示していなかった。交通手段も反映）。
      //   ② sortOrShuffle: 主経路と同じ並び。遠出mood(minRadiusKm>0)は遠方優先、
      //      通常moodは品質boost付きシャッフル（純ランダムをやめ、写真/営業中/学習を加味）。
      const relaxKept = relaxPool.filter(r => relaxKeepSet.has(r));
      relaxHelpers.normalizeDistance(relaxKept);
      const merged = relaxHelpers.sortOrShuffle(relaxKept).slice(0, 10);
      console.log(`[Relax] マージ後: Google=${relaxResults.length}件 + Yahoo=${yahooWithStation.length}件 → フィルタ後表示${merged.length}件`);

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

      await applyUserPhotos(relaxFinalResults as unknown as UserPhotoRec[]);
      diversifyByCategory(relaxFinalResults as unknown as DivRec[]);
      return json({
        recommendations: await attachAvailability(relaxFinalResults, moodGroup(answers.mood)),
        usedAI: !!relaxAiResult,
        warning: relaxFinalResults.length === 0 ? "条件に合うスポットが見つかりませんでした。エリアや条件を変えてお試しください。" : "",
      });
    }

    const weather = await getWeatherContext(answers.originLat, answers.originLng);
    const timeContext = getTimeContext();
    const distancePref = getDistancePreference(answers);

    // OpenAI は 自由ワード・絞り込み時のみ使用（通常のボタン選択ではSupabaseを優先）
    const useAI = !!(answers.freeWord || refinementText) && !isFoodMood;
    const aiResult = useAI
      ? await buildSearchPlansWithAI(answers, pastFeedback, globalStatsContext + approvedContext, weather, timeContext, userPreferenceHints, refinementText)
      : null;
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

        const res = await gfetch("https://places.googleapis.com/v1/places:searchText", {
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
          const fbRes = await gfetch("https://places.googleapis.com/v1/places:searchText", {
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
          const chainRes = await gfetch("https://places.googleapis.com/v1/places:searchText", {
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
          const placeRes = await gfetch("https://places.googleapis.com/v1/places:searchText", {
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

    // ── Step 2: 経路5(レガシー)にも経路2と共通の品質/飲食フィルタを適用 ────────────
    //   createFinalizeHelpers を経路5でも呼び、品質フィルタ(B2B・写真なし低評価の除外)と
    //   飲食フィルタ(温泉/水族館/老舗食堂の除外)を chooseFinalResults の前段に挟む。
    //   これで「お腹すいた」以外も含め全moodで品質フィルタが効くようになる。
    //   ※ admin注入スポット(score>=100)・AIピン留め(isPinned)は写真/評価が無くても
    //     必ず残すよう保護する（誤除外防止）。
    //   ※ 既出除外(seenPlaces)・閉店除外は既に mergedMap 段階で実施済みのため二重適用しない。
    // 喫茶/レトロ系ジャンルの老舗除外免除を経路5でも効かせるため深掘りを導出して渡す。
    // （経路5は applyMallFilter を呼ばないため effectiveDeepDive を渡してもモールフィルタは作動しない）
    const legacyDeepDive = (answers.dynamicQs ?? []).find(q => q.question === "深掘り詳細")?.answer
      ?? (answers.dynamicQs ?? []).find(q => q.question === "深掘りカテゴリ")?.answer
      ?? "";
    const legacyHelpers = createFinalizeHelpers({
      isFoodMood: answers.mood === "お腹すいた",
      minRadiusKm,             // 距離設定の遠端バイアスを尊重（県またぎ等で遠方優先）
      isBadWeather: false,     // 並び替えは chooseFinalResults に委ねる（天気再ソートしない）
      goodVisitedPlaces,
      seenPlaces,
      showUnseenOnly: false,   // seen除外は mergedMap で実施済み → 二重適用回避
      effectiveDeepDive: legacyDeepDive,  // 喫茶/レトロ系の老舗除外免除に使用（モールフィルタは未呼出）
      originLat: answers.originLat, originLng: answers.originLng, transport: answers.transport,
    });
    const isProtectedLegacy = (i: ScoredItem) => i.isPinned === true || i.score >= 100;
    const protectedItems = sorted.filter(isProtectedLegacy);
    const cleanedItems = legacyHelpers.qualitySanitize(
      legacyHelpers.foodSanitize(sorted.filter(i => !isProtectedLegacy(i)))
    );
    // 元のスコア順を保ったまま再構成（保護対象 + フィルタ通過分）
    const keepSet = new Set<ScoredItem>([...protectedItems, ...cleanedItems]);
    const preFiltered = sorted.filter(i => keepSet.has(i));

    let finalItems = chooseFinalResults(preFiltered, answers.mood);

    // ── ①距離感ハード半径フィルタ（レガシー route-5 経路）──────────────────────────
    //   getDistancePreference の maxTravelMinOverride(分) を交通手段の速度で km 換算し、
    //   選んだ距離を超えるスポットを最終結果から除外する（従来は scorePlace の減点のみ＝
    //   遠い店が末尾に残って結果に出ていた）。label/override が null（遠くてOK・指定なし）
    //   の場合はフィルタしない。距離は distanceText の km か location からの haversine で算出。
    //   安全弁: 範囲内が極端に少ない時は段階的に半径を緩め、最終的にフィルタ無効化。
    {
      const maxMin = distancePref.maxTravelMinOverride;
      const lo2 = answers.originLat, ln2 = answers.originLng;
      const hasOrigin2 = typeof lo2 === "number" && typeof ln2 === "number";
      if (maxMin !== null && hasOrigin2) {
        // 交通手段→速度(km/h)。lib/distance.ts formatDistText と整合（車40/電車・バス30/自転車12/徒歩4）
        const tj = getTransports(answers.transport).join(",");
        const speed = tj.includes("徒歩") ? 4
          : tj.includes("自転車") ? 12
          : (tj.includes("電車") || tj.includes("バス")) ? 30
          : 40; // 車/バイク/なんでも/未指定
        const baseCapKm = (maxMin / 60) * speed;
        // 表示テキスト("... / 12.3km")か location からスポット距離[km]を取得。不明は -1。
        const kmOfItem = (it: ScoredItem): number => {
          const km1 = it.distanceText.match(/([\d.]+)\s*km/);
          const m1 = it.distanceText.match(/([\d.]+)\s*m(?![a-z])/i);
          if (km1) return parseFloat(km1[1]);
          if (m1) return parseFloat(m1[1]) / 1000;
          if (it.location && typeof it.location.latitude === "number" && typeof it.location.longitude === "number") {
            return haversineMeters(lo2!, ln2!, it.location.latitude, it.location.longitude) / 1000;
          }
          return -1; // 距離不明 → 除外しない
        };
        const MIN_KEEP = 5;
        const tiers = [baseCapKm, baseCapKm * 1.5, baseCapKm * 2.5];
        let picked: ScoredItem[] | null = null;
        for (const t of tiers) {
          const within = finalItems.filter(it => { const k = kmOfItem(it); return k < 0 || k <= t; });
          if (within.length >= MIN_KEEP || within.length === finalItems.length) { picked = within; break; }
        }
        if (picked && picked.length > 0) {
          console.log(`[recommend] 距離ハードフィルタ(legacy): cap≈${baseCapKm.toFixed(1)}km(${distancePref.label}) ${finalItems.length}→${picked.length}件`);
          finalItems = picked;
        }
        // picked が空 or 全件不足 → フィルタ無効化（finalItems をそのまま使う＝0件事故防止）
      }
    }

    // ── 距離表示を全経路と統一（レガシー経路の最終仕上げ）──────────────────────────
    //   ① Google Places結果は実距離(Route Matrix由来の "12.3km")＋実所要時間(durationText
    //      "15分")を持つ → 値はそのまま、形式だけ統一形 "車で約15分 / 12.3km" に寄せる。
    //   ② 管理者/チェーン注入スポットは distanceText が空だった → 座標(location)から
    //      haversineで距離を補完し統一形式で表示（従来は距離が出ていなかった）。
    //   ※ ドライブ時間フィルタ(上流 mergedMap で durationText="N分" をパース)は本処理より
    //      前に実行済みのため、ここで durationText を統一形式へ畳んでクリアしても影響しない。
    //   ※ routesByMode(複数交通手段チップ)は後段で別途構築され表示を上書きするため不変。
    {
      const lo = answers.originLat, ln = answers.originLng;
      const hasLegacyOrigin = typeof lo === "number" && typeof ln === "number";
      for (const it of finalItems) {
        let km: number | undefined;
        const kmM = it.distanceText.match(/([\d.]+)\s*km/);
        const mM = it.distanceText.match(/([\d.]+)\s*m(?![a-z])/i);
        if (kmM) km = parseFloat(kmM[1]);
        else if (mM) km = parseFloat(mM[1]) / 1000;
        else if (hasLegacyOrigin && it.location
          && typeof it.location.latitude === "number" && typeof it.location.longitude === "number") {
          km = haversineMeters(lo!, ln!, it.location.latitude, it.location.longitude) / 1000;
        }
        if (km != null && Number.isFinite(km)) {
          // 実所要時間(durationText)があれば温存し、無ければ推定（formatDistText内）
          it.distanceText = formatDistText(km, answers.transport, it.durationText || undefined);
          it.durationText = "";
        }
      }
    }

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
            const nightRes = await gfetch("https://places.googleapis.com/v1/places:searchText", {
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

    // ユーザー向けの内部仕様カゲ（OPENAI_API_KEY/天気連動 等）の警告バナーは非表示にする。
    //   （実装上の注意書きはエンドユーザーには不要なため）
    await applyUserPhotos(finalResults as unknown as UserPhotoRec[]);
    diversifyByCategory(finalResults as unknown as DivRec[]);
    return json({
      recommendations: await attachAvailability(finalResults, moodGroup(answers.mood)),
      usedAI: !!aiPlans,
      searchId,
      warning: "",
    });
  } catch (error) {
    console.error(error);
    scheduleServerError("recommend.fatal", error);
    return json(
      {
        error: "おすすめの取得に失敗しました。",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
