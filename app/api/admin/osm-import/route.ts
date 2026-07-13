// ─── /api/admin/osm-import ────────────────────────────────────────────────────
// OpenStreetMap (Overpass API) を使って主要都市単位で無料スポット取り込み
//
// POST body:
//   secret       string    管理者パスワード
//   prefectures  string[]  都道府県名リスト
//   osmTypes     string[]  取り込むOSMタイプ
//   dryRun       boolean   trueの場合はDBに書き込まず件数確認のみ
//
// 設計: 都道府県bbox（広すぎてタイムアウト）→ 都市中心+半径10km（高速）

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { addUrbanTagIfNeeded } from "@/lib/urban-detector";
import { ALL_PREDEFINED_TAGS } from "@/lib/predefined-tags";
import { ADMIN_SECRET } from "@/lib/admin-auth";
import { isLikelySamePlace } from "@/lib/normalize-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5分まで許容

// ── 都道府県ごとの主要都市リスト [名前, lat, lng, 半径km] ──────────────────────
const PREFECTURE_CITIES: Record<string, Array<[string, number, number, number]>> = {
  "北海道": [["札幌", 43.0642, 141.3469, 12], ["函館", 41.7688, 140.7290, 8], ["旭川", 43.7707, 142.3651, 8], ["釧路", 42.9849, 144.3820, 8]],
  "青森":   [["青森市", 40.8244, 140.7401, 8], ["弘前", 40.6029, 140.4638, 6]],
  "岩手":   [["盛岡", 39.7036, 141.1527, 8]],
  "宮城":   [["仙台", 38.2682, 140.8694, 10], ["石巻", 38.4344, 141.3025, 6]],
  "秋田":   [["秋田市", 39.7186, 140.1024, 8]],
  "山形":   [["山形市", 38.2404, 140.3636, 8]],
  "福島":   [["福島市", 37.7608, 140.4748, 8], ["郡山", 37.3941, 140.3878, 8], ["いわき", 37.0505, 140.8878, 6]],
  "茨城":   [["水戸", 36.3418, 140.4468, 8], ["つくば", 36.0835, 140.0765, 6]],
  "栃木":   [["宇都宮", 36.5548, 139.8830, 8], ["日光", 36.7198, 139.6984, 6]],
  "群馬":   [["前橋", 36.3893, 139.0600, 8], ["高崎", 36.3228, 139.0030, 6]],
  "埼玉":   [["さいたま", 35.8617, 139.6455, 10], ["川越", 35.9255, 139.4857, 6], ["所沢", 35.7994, 139.4699, 6]],
  "千葉":   [["千葉市", 35.6074, 140.1065, 10], ["柏", 35.8681, 139.9759, 6], ["船橋", 35.6944, 139.9829, 6]],
  "東京":   [["新宿", 35.6938, 139.7034, 5], ["渋谷", 35.6580, 139.7016, 5], ["池袋", 35.7295, 139.7109, 5], ["秋葉原", 35.7023, 139.7745, 4], ["銀座", 35.6721, 139.7650, 4], ["上野", 35.7141, 139.7774, 4], ["吉祥寺", 35.7034, 139.5796, 5], ["立川", 35.6987, 139.4130, 6], ["八王子", 35.6662, 139.3160, 6]],
  "神奈川": [["横浜", 35.4437, 139.6380, 10], ["川崎", 35.5309, 139.7029, 8], ["鎌倉", 35.3197, 139.5467, 6], ["横須賀", 35.2813, 139.6724, 6], ["小田原", 35.2651, 139.1526, 6]],
  "新潟":   [["新潟市", 37.9162, 139.0364, 10]],
  "富山":   [["富山市", 36.6953, 137.2113, 8]],
  "石川":   [["金沢", 36.5613, 136.6562, 8]],
  "福井":   [["福井市", 36.0652, 136.2219, 8]],
  "山梨":   [["甲府", 35.6635, 138.5684, 8], ["富士吉田", 35.4884, 138.7920, 6]],
  "長野":   [["長野市", 36.6486, 138.1947, 8], ["松本", 36.2381, 137.9719, 6], ["諏訪", 36.0385, 138.1135, 5]],
  "岐阜":   [["岐阜市", 35.4231, 136.7608, 8], ["高山", 36.1408, 137.2520, 6]],
  "静岡":   [["静岡市", 34.9769, 138.3831, 8], ["浜松", 34.7108, 137.7261, 8], ["熱海", 35.0960, 139.0735, 5]],
  "愛知":   [["名古屋", 35.1815, 136.9066, 12], ["豊橋", 34.7695, 137.3922, 6], ["豊田", 35.0836, 137.1560, 6]],
  "三重":   [["津市", 34.7303, 136.5086, 8], ["伊勢", 34.4870, 136.7060, 6]],
  "滋賀":   [["大津", 35.0045, 135.8686, 8]],
  "京都":   [["京都市", 35.0116, 135.7681, 10], ["宇治", 34.8841, 135.7997, 5], ["嵐山", 35.0166, 135.6726, 4]],
  "大阪":   [["梅田", 34.7055, 135.5008, 6], ["難波", 34.6688, 135.4990, 5], ["天王寺", 34.6470, 135.5136, 5], ["堺", 34.5733, 135.4830, 6]],
  "兵庫":   [["神戸", 34.6913, 135.1830, 10], ["姫路", 34.8394, 134.6939, 8], ["西宮", 34.7364, 135.3408, 6]],
  "奈良":   [["奈良市", 34.6851, 135.8048, 8]],
  "和歌山": [["和歌山市", 34.2261, 135.1675, 8]],
  "鳥取":   [["鳥取市", 35.5011, 134.2351, 8]],
  "島根":   [["松江", 35.4681, 133.0485, 8], ["出雲", 35.3670, 132.7550, 6]],
  "岡山":   [["岡山市", 34.6551, 133.9195, 10]],
  "広島":   [["広島市", 34.3853, 132.4553, 10], ["尾道", 34.4085, 133.2130, 5], ["福山", 34.4859, 133.3625, 6]],
  "山口":   [["下関", 33.9542, 130.9300, 6], ["山口市", 34.1861, 131.4706, 6]],
  "徳島":   [["徳島市", 34.0658, 134.5593, 8]],
  "香川":   [["高松", 34.3402, 134.0434, 8]],
  "愛媛":   [["松山", 33.8417, 132.7657, 8]],
  "高知":   [["高知市", 33.5597, 133.5311, 8]],
  "福岡":   [["博多", 33.5902, 130.4017, 8], ["天神", 33.5897, 130.3990, 5], ["北九州", 33.8834, 130.8751, 8]],
  "佐賀":   [["佐賀市", 33.2635, 130.3009, 8]],
  "長崎":   [["長崎市", 32.7503, 129.8779, 8], ["佐世保", 33.1799, 129.7153, 6]],
  "熊本":   [["熊本市", 32.8031, 130.7079, 10]],
  "大分":   [["大分市", 33.2382, 131.6126, 8], ["別府", 33.2846, 131.4923, 6]],
  "宮崎":   [["宮崎市", 31.9111, 131.4239, 8]],
  "鹿児島": [["鹿児島市", 31.5602, 130.5581, 10]],
  "沖縄":   [["那覇", 26.2124, 127.6809, 8], ["沖縄市", 26.3344, 127.8056, 6]],
};

// 地方グループ（UI用）
// route.ts は HTTPメソッド/セグメント設定以外を export 不可（Next.js型チェック）。外部未使用のため module-local。
const REGION_GROUPS: Record<string, string[]> = {
  "北海道・東北": ["北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島"],
  "関東":         ["茨城", "栃木", "群馬", "埼玉", "千葉", "東京", "神奈川"],
  "中部":         ["新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知"],
  "近畿":         ["三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山"],
  "中国・四国":   ["鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知"],
  "九州・沖縄":   ["福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄"],
};

// ── OSMタイプ設定 ─────────────────────────────────────────────────────────────
interface OsmTypeConfig {
  key: string;
  value: string;
  label: string;
  moodgoTags: string[];
  defaultDescription: string;
}

const OSM_TYPES: OsmTypeConfig[] = [
  { key: "amenity", value: "cafe",             label: "☕ カフェ",             moodgoTags: ["#癒しカフェ", "#まったりしたい", "#カフェスイーツ", "#集中したい"], defaultDescription: "のんびりくつろげるカフェ" },
  { key: "amenity", value: "restaurant",       label: "🍽 レストラン",          moodgoTags: ["#お腹すいた", "#まったりしたい"],                                  defaultDescription: "美味しい料理が楽しめるお店" },
  { key: "amenity", value: "bar",              label: "🍺 バー・居酒屋",        moodgoTags: ["#居酒屋", "#わいわい楽しみたい"],                                  defaultDescription: "夜のひとときを楽しめるお店" },
  { key: "leisure", value: "park",             label: "🌳 公園",                moodgoTags: ["#大型公園", "#自然感じたい", "#お散歩", "#まったりしたい"],          defaultDescription: "緑豊かな公園" },
  { key: "leisure", value: "garden",           label: "🌸 庭園",                moodgoTags: ["#自然感じたい", "#お散歩", "#まったりしたい", "#絶景スポット"],      defaultDescription: "美しい庭園" },
  { key: "leisure", value: "nature_reserve",   label: "🌲 自然保護区",          moodgoTags: ["#自然感じたい", "#自然公園", "#お散歩"],                            defaultDescription: "自然豊かなスポット" },
  { key: "tourism", value: "viewpoint",        label: "🗼 展望台・絶景",        moodgoTags: ["#絶景スポット", "#展望台", "#まったりしたい"],                      defaultDescription: "絶景が楽しめるスポット" },
  { key: "tourism", value: "museum",           label: "🏛 博物館・美術館",      moodgoTags: ["#まったりしたい", "#博物館", "#美術館"],                            defaultDescription: "見応えある展示施設" },
  { key: "tourism", value: "attraction",       label: "⭐ 観光スポット",        moodgoTags: ["#わいわい楽しみたい", "#まったりしたい"],                           defaultDescription: "人気の観光スポット" },
  { key: "tourism", value: "theme_park",       label: "🎡 テーマパーク",        moodgoTags: ["#テーマパーク", "#わいわい楽しみたい", "#アミューズメントパーク"],   defaultDescription: "楽しいテーマパーク" },
  { key: "tourism", value: "zoo",              label: "🦁 動物園",              moodgoTags: ["#動物園", "#わいわい楽しみたい", "#家族"],                          defaultDescription: "動物と触れ合える施設" },
  { key: "tourism", value: "aquarium",         label: "🐠 水族館",              moodgoTags: ["#水族館", "#わいわい楽しみたい", "#家族"],                          defaultDescription: "海の生き物たちに会える水族館" },
  { key: "amenity", value: "spa",              label: "♨️ スパ・温泉",         moodgoTags: ["#温泉", "#サウナ", "#まったりしたい"],                              defaultDescription: "温泉・スパ施設" },
  { key: "amenity", value: "place_of_worship", label: "⛩️ 神社・寺",           moodgoTags: ["#パワースポット", "#まったりしたい", "#お散歩"],                     defaultDescription: "歴史ある神社・仏閣" },
  { key: "amenity", value: "library",          label: "📚 図書館",              moodgoTags: ["#book場", "#勉強場", "#集中したい"],                                defaultDescription: "静かに過ごせる図書館" },
  { key: "leisure", value: "fitness_centre",   label: "💪 ジム・フィットネス",  moodgoTags: ["#体動かしたい", "#ガッツリ運動"],                                   defaultDescription: "本格的に体を動かせるジム" },
  { key: "leisure", value: "sports_centre",    label: "🏀 スポーツセンター",    moodgoTags: ["#体動かしたい", "#スポーツ"],                                        defaultDescription: "スポーツ施設" },
  { key: "leisure", value: "swimming_pool",    label: "🏊 プール",              moodgoTags: ["#体動かしたい", "#スポーツ"],                                        defaultDescription: "プール・水泳施設" },
  { key: "leisure", value: "stadium",          label: "🏟 スタジアム",          moodgoTags: ["#スポーツ", "#わいわい楽しみたい"],                                  defaultDescription: "スポーツ観戦スポット" },
  { key: "leisure", value: "bowling_alley",    label: "🎳 ボウリング",          moodgoTags: ["#ボウリング", "#わいわい楽しみたい"],                                defaultDescription: "ボウリングが楽しめる施設" },
  { key: "natural", value: "peak",             label: "⛰️ 山頂",               moodgoTags: ["#絶景スポット", "#山頂", "#自然感じたい", "#体動かしたい"],        defaultDescription: "雄大な山の絶景スポット" },
  { key: "natural", value: "beach",            label: "🏖️ 海岸・砂浜",        moodgoTags: ["#海辺", "#自然感じたい", "#まったりしたい"],                         defaultDescription: "波の音が心地よい海岸スポット" },
  { key: "natural", value: "waterfall",        label: "💧 滝",                 moodgoTags: ["#絶景スポット", "#自然感じたい", "#ドライブしたい"],                  defaultDescription: "迫力ある滝スポット" },
  { key: "natural", value: "cliff",            label: "🪨 断崖・絶壁",         moodgoTags: ["#絶景スポット", "#自然感じたい", "#ドライブしたい"],                  defaultDescription: "圧巻の断崖絶壁スポット" },
  { key: "natural", value: "hot_spring",       label: "♨️ 野湯・源泉",        moodgoTags: ["#温泉", "#自然感じたい", "#まったりしたい"],                          defaultDescription: "自然の中の温泉スポット" },
  { key: "tourism", value: "wilderness_hut",   label: "🏕️ 山小屋",            moodgoTags: ["#絶景スポット", "#自然感じたい", "#体動かしたい"],                    defaultDescription: "山の中の山小屋" },
  { key: "tourism", value: "camp_site",        label: "⛺ キャンプ場",         moodgoTags: ["#自然感じたい", "#まったりしたい", "#ドライブしたい"],                 defaultDescription: "自然の中でキャンプが楽しめるスポット" },
  { key: "historic", value: "castle",          label: "🏯 城・城跡",           moodgoTags: ["#絶景スポット", "#パワースポット", "#まったりしたい"],                  defaultDescription: "歴史ある城・城跡" },
  { key: "historic", value: "ruins",           label: "🏛️ 遺跡・史跡",        moodgoTags: ["#パワースポット", "#まったりしたい", "#お散歩"],                       defaultDescription: "歴史を感じる遺跡・史跡" },
  { key: "shop",    value: "mall",             label: "🛍️ ショッピングモール", moodgoTags: ["#ショッピング", "#わいわい楽しみたい"],                               defaultDescription: "充実したショッピング施設" },
];

// ── ショッピングモール判定（個別ブランド店舗を除外）─────────────────────────
const MALL_NAME_KEYWORDS = [
  "モール", "mall", "ショッピング", "shopping", "アウトレット", "outlet",
  "センター", "center", "centre", "イオン", "aeon", "ららぽーと",
  "アリオ", "マルイ", "丸井", "高島屋", "takashimaya", "そごう",
  "三越", "伊勢丹", "ルミネ", "パルコ", "parco", "フレスポ", "ゆめタウン",
];
const BRAND_STORE_KEYWORDS = [
  "adidas", "アディダス", "nike", "ナイキ", "puma", "プーマ",
  "reebok", "new balance", "ニューバランス", "under armour", "asics", "アシックス",
  "uniqlo", "ユニクロ", "zara", "h&m", "gap ", "gucci", "グッチ",
  "louis vuitton", "prada", "プラダ", "chanel", "シャネル", "hermès", "hermes",
  "coach", "コーチ", "michael kors", "burberry", "バーバリー",
  "apple store", "samsung", "sony store",
  "mcdonald", "マクドナルド", "starbucks", "スターバックス",
  "abc-mart", "abc mart", "foot locker", "ikea", "イケア", "nitori", "ニトリ",
];

function isValidMall(name: string, osmTags: Record<string, string>): boolean {
  const lower = name.toLowerCase();
  if (BRAND_STORE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))) return false;
  if (osmTags["brand"] || osmTags["brand:wikidata"]) return false;
  return MALL_NAME_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

// ── OSM element 型 ─────────────────────────────────────────────────────────
interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

// ── Overpassクエリ生成（around で半径指定、nodeのみ） ─────────────────────────
function buildOverpassQuery(lat: number, lng: number, radiusM: number, typeConfigs: OsmTypeConfig[]): string {
  const around = `around:${radiusM},${lat},${lng}`;
  const parts = typeConfigs.map(
    t => `  node["${t.key}"="${t.value}"]["name"](${around});`
  );
  return `[out:json][timeout:25][maxsize:33554432];\n(\n${parts.join("\n")}\n);\nout;`;
}

// ── OSMタグ → MoodGoタグ変換 ─────────────────────────────────────────────────
function osmToMoodgoTags(osmTags: Record<string, string>, typeConfigs: OsmTypeConfig[]): string[] {
  const tags = new Set<string>();
  for (const config of typeConfigs) {
    if (osmTags[config.key] === config.value) {
      for (const t of config.moodgoTags) tags.add(t);
    }
  }
  const name = (osmTags["name"] ?? "").toLowerCase();
  if (/神社|shrine/.test(name))         { tags.add("#パワースポット"); }
  if (/寺|temple|仏/.test(name))        { tags.add("#パワースポット"); }
  if (/温泉|onsen/.test(name))          { tags.add("#温泉"); tags.add("#まったりしたい"); }
  if (/サウナ|sauna/.test(name))        { tags.add("#サウナ"); }
  if (/銭湯/.test(name))                { tags.add("#温泉"); tags.add("#まったりしたい"); }
  if (/公園|park/.test(name))           { tags.add("#大型公園"); tags.add("#自然感じたい"); }
  if (/展望|パノラマ|panorama/.test(name)) { tags.add("#絶景スポット"); tags.add("#展望台"); }
  if (/海|beach|浜/.test(name))         { tags.add("#海辺"); tags.add("#自然感じたい"); }
  if (/山|岳|peak/.test(name))          { tags.add("#絶景スポット"); tags.add("#自然感じたい"); }
  if (/居酒屋/.test(name))              { tags.add("#居酒屋"); tags.add("#お腹すいた"); }
  if (/カフェ|cafe|coffee/i.test(name)) { tags.add("#癒しカフェ"); tags.add("#まったりしたい"); }
  if (osmTags["fee"] === "no")          { tags.add("#無料"); }
  return Array.from(tags).filter(t => ALL_PREDEFINED_TAGS.includes(t));
}

// ── Overpass フォールバックサーバー ──────────────────────────────────────────
// 日本から近い順に並べたサーバーリスト
const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",          // ドイツ（メイン・接続確認済み）
  "https://overpass.kumi.systems/api/interpreter",    // グローバル
  "https://overpass.osm.ch/api/interpreter",          // スイス
];

async function fetchOverpass(query: string): Promise<OsmElement[]> {
  const encoded = encodeURIComponent(query);
  const lastError: string[] = [];
  for (const server of OVERPASS_SERVERS) {
    try {
      const res = await fetch(`${server}?data=${encoded}`, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "MoodGoApp/1.0",
        },
        signal: AbortSignal.timeout(45_000), // 45秒
      });
      if (!res.ok) { lastError.push(`${server}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      return (data.elements ?? []) as OsmElement[];
    } catch (e) {
      lastError.push(`${server}: ${String(e)}`);
      // 次のサーバーを試す
    }
  }
  throw new Error(`全サーバー失敗: ${lastError.join(" / ")}`);
}

// ── POST: 1都市分だけ処理（フロントエンドがループして呼ぶ） ──────────────────
// body: { secret, prefecture, cityName, lat, lng, radiusKm, osmTypes, dryRun }
export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const prefecture: string  = body.prefecture ?? "";
  const cityName: string    = body.cityName ?? "";
  const lat: number         = body.lat ?? 0;
  const lng: number         = body.lng ?? 0;
  const radiusKm: number    = body.radiusKm ?? 8;
  const dryRun: boolean     = body.dryRun === true;
  const selectedTypeIds: string[] = Array.isArray(body.osmTypes)
    ? body.osmTypes : OSM_TYPES.map(t => `${t.key}:${t.value}`);

  const typeConfigs = OSM_TYPES.filter(t => selectedTypeIds.includes(`${t.key}:${t.value}`));
  if (typeConfigs.length === 0) {
    return NextResponse.json({ ok: false, error: "スポット種別を選択してください" }, { status: 400 });
  }

  // 既存スポット名・google_place_id（全ソース重複チェック）
  const { data: existingPlaces } = await supabase.from("places").select("name, google_place_id").not("name", "is", null);
  const existingSet = new Set<string>(
    (existingPlaces ?? []).map((p: { name: string }) => p.name.trim().toLowerCase()),
  );
  const existingGoogleIds = new Set<string>(
    (existingPlaces ?? []).filter((p: { google_place_id: string | null }) => p.google_place_id).map((p: { google_place_id: string }) => p.google_place_id),
  );

  // 表記ゆれ（カナ/全角半角/記号）＋近接の重複を弾くための、取り込み範囲内の既存places（座標付き）
  const bboxPad = radiusKm / 111 + 0.002;   // km→度の概算＋余白
  const { data: nearbyPlaces } = await supabase.from("places").select("name, lat, lng")
    .gte("lat", lat - bboxPad).lte("lat", lat + bboxPad)
    .gte("lng", lng - bboxPad).lte("lng", lng + bboxPad)
    .limit(5000);
  const nearby = (nearbyPlaces ?? []) as Array<{ name: string; lat: number | null; lng: number | null }>;

  let fetched = 0, inserted = 0, skipped = 0;
  const errors: string[] = [];
  const spots: Array<{ name: string; address: string; tags: string[] }> = [];

  try {
    const elements = await fetchOverpass(buildOverpassQuery(lat, lng, radiusKm * 1000, typeConfigs));
    fetched = elements.length;

    const toInsert: Array<{
      name: string; address: string; lat: number; lng: number;
      tags: string[]; description: string | null; is_active: boolean; google_place_id: null;
    }> = [];

    for (const el of elements) {
      if (el.type !== "node" || el.lat == null || el.lon == null) continue;
      const osmTags = el.tags ?? {};
      const name = osmTags["name"]?.trim() ?? "";
      if (!name) continue;

      if (existingSet.has(name.toLowerCase())) { skipped++; continue; }
      // 別表記（カナ/全角半角/記号ゆれ）＋近接の既存があれば重複としてスキップ
      if (nearby.some(e => isLikelySamePlace(name, el.lat, el.lon, e.name, e.lat, e.lng))) { skipped++; continue; }
      if (osmTags["shop"] === "mall" && !isValidMall(name, osmTags)) { skipped++; continue; }

      const moodgoTags = osmToMoodgoTags(osmTags, typeConfigs);
      const tagsWithUrban = addUrbanTagIfNeeded(moodgoTags, el.lat, el.lon);
      if (tagsWithUrban.length === 0) { skipped++; continue; }

      const address = [
        osmTags["addr:prefecture"] || prefecture,
        osmTags["addr:city"] || cityName,
        osmTags["addr:suburb"] || osmTags["addr:quarter"] || "",
        osmTags["addr:street"] || "",
        osmTags["addr:housenumber"] || "",
      ].filter(Boolean).join("");

      const matchedConfig = typeConfigs.find(c => osmTags[c.key] === c.value);
      toInsert.push({
        name, address, lat: el.lat, lng: el.lon,
        tags: tagsWithUrban,
        description: matchedConfig?.defaultDescription ?? null,
        is_active: true, google_place_id: null,
      });
      spots.push({ name, address, tags: tagsWithUrban });
      existingSet.add(name.toLowerCase());
      inserted++;
    }

    if (!dryRun && toInsert.length > 0) {
      for (let j = 0; j < toInsert.length; j += 100) {
        const { error } = await supabase.from("places").insert(toInsert.slice(j, j + 100));
        if (error) errors.push(error.message);
      }
    }
  } catch (e) {
    errors.push(String(e));
  }

  return NextResponse.json({ ok: true, dryRun, prefecture, cityName, fetched, inserted, skipped, errors, spots });
}

// ── GET: 都市リストと設定情報を返す ─────────────────────────────────────────
export async function GET() {
  const cities: Array<{ prefecture: string; cityName: string; lat: number; lng: number; radiusKm: number }> = [];
  for (const [pref, list] of Object.entries(PREFECTURE_CITIES)) {
    for (const [cityName, lat, lng, radiusKm] of list) {
      cities.push({ prefecture: pref, cityName, lat, lng, radiusKm });
    }
  }
  return NextResponse.json({
    ok: true,
    regionGroups: REGION_GROUPS,
    prefectures: Object.keys(PREFECTURE_CITIES),
    cities,
    osmTypes: OSM_TYPES.map(t => ({ id: `${t.key}:${t.value}`, label: t.label, defaultTags: t.moodgoTags })),
  });
}

