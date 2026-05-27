// ─── HotPepper 全国同期 設定ファイル ─────────────────────────────────────────
// ジャンルコード → タグルール のマッピングと、日本全国グリッドポイントを定義

// ─────────────────────────────────────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────────────────────────────────────
export interface SubTagRule {
  keywords: string[]; // 店名・キャッチコピーにこれらが含まれていればタグ付与
  tag: string;
}

export interface SyncGenreConfig {
  id: string;          // 識別子（URLパラメータ等で使用）
  label: string;       // 表示名
  genreCode?: string;  // HotPepper ジャンルコード（例: "G001"）
  keyword?: string;    // ジャンルコードの代わりに or 追加で使うキーワード
  baseTags: string[];  // 必ずつけるタグ（#お腹すいた + ジャンルタグ）
  subTagRules: SubTagRule[]; // サブタグ判定ルール
  defaultSubTag?: string;   // どのサブタグにも当たらなかった場合のデフォルト
}

// ─────────────────────────────────────────────────────────────────────────────
// ジャンル設定（ユーザー指定タグ体系に完全対応）
// ─────────────────────────────────────────────────────────────────────────────
export const SYNC_GENRE_CONFIGS: SyncGenreConfig[] = [
  // ── 居酒屋 ──────────────────────────────────────────────────────────────────
  {
    id: "izakaya",
    label: "居酒屋",
    genreCode: "G001",
    baseTags: ["#お腹すいた", "#居酒屋"],
    subTagRules: [
      { keywords: ["個室", "完全個室", "半個室"], tag: "#居酒屋個室" },
      { keywords: ["大衆", "大衆酒場", "せんべろ", "コスパ", "立ち飲み"], tag: "#大衆酒場" },
    ],
  },
  // ── 和食 ────────────────────────────────────────────────────────────────────
  {
    id: "washoku",
    label: "和食",
    genreCode: "G004",
    baseTags: ["#お腹すいた", "#和食"],
    subTagRules: [
      { keywords: ["海鮮", "魚介", "寿司", "刺身", "鮮魚", "お造り"], tag: "#海鮮" },
      { keywords: ["天ぷら", "揚げ物", "フライ"], tag: "#天ぷら" },
      { keywords: ["うどん", "そば", "蕎麦", "noodle"], tag: "#うどんそば" },
      { keywords: ["懐石", "会席", "割烹", "料亭", "おまかせ"], tag: "#懐石料理" },
    ],
  },
  // ── 洋食 ────────────────────────────────────────────────────────────────────
  {
    id: "yoshoku",
    label: "洋食",
    genreCode: "G005",
    baseTags: ["#お腹すいた", "#洋食"],
    subTagRules: [
      { keywords: ["ハンバーグ", "hamburg"], tag: "#ハンバーグ" },
      { keywords: ["オムライス", "omelet"], tag: "#オムライス" },
      { keywords: ["ステーキ", "steak"], tag: "#ステーキ" },
      { keywords: ["レトロ", "昭和", "老舗", "純洋食", "洋食屋"], tag: "#レトロ洋食" },
    ],
  },
  // ── イタリアン ──────────────────────────────────────────────────────────────
  {
    id: "italian",
    label: "イタリアン",
    genreCode: "G006",
    baseTags: ["#お腹すいた", "#イタリアン"],
    subTagRules: [],
  },
  // ── 中華 ────────────────────────────────────────────────────────────────────
  {
    id: "chinese",
    label: "中華",
    genreCode: "G007",
    baseTags: ["#お腹すいた", "#中華"],
    subTagRules: [],
  },
  // ── 焼肉 ────────────────────────────────────────────────────────────────────
  {
    id: "yakiniku",
    label: "焼肉",
    genreCode: "G008",
    baseTags: ["#お腹すいた", "#焼肉"],
    subTagRules: [
      { keywords: ["食べ放題", "放題", "all you can eat"], tag: "#焼肉食べ放題" },
      { keywords: ["高級", "プレミアム", "黒毛和牛", "和牛", "特選", "銘柄牛"], tag: "#高級焼肉" },
    ],
    defaultSubTag: "#焼肉単品あり",
  },
  // ── 韓国料理 ────────────────────────────────────────────────────────────────
  {
    id: "korean",
    label: "韓国料理",
    genreCode: "G009", // アジア・エスニック
    keyword: "韓国",
    baseTags: ["#お腹すいた", "#韓国"],
    subTagRules: [],
  },
  // ── アジア系統（韓国以外）───────────────────────────────────────────────────
  {
    id: "asian",
    label: "アジア系統",
    genreCode: "G009",
    baseTags: ["#お腹すいた", "#アジア系統"],
    subTagRules: [
      { keywords: ["インド", "ネパール", "カレー", "ナン", "タンドール"], tag: "#インドネパール料理" },
      { keywords: ["タイ", "Thai", "パッタイ", "トムヤム"], tag: "#タイ料理" },
      { keywords: ["ベトナム", "フォー", "バインミー", "Vietnam"], tag: "#ベトナム料理" },
    ],
    defaultSubTag: "#アジアンエスタニック料理",
  },
  // ── 各国料理 ────────────────────────────────────────────────────────────────
  {
    id: "world",
    label: "各国料理",
    genreCode: "G010",
    baseTags: ["#お腹すいた", "#各国料理"],
    subTagRules: [
      { keywords: ["メキシコ", "タコス", "ブリトー", "Mexico"], tag: "#メキシコ料理" },
      { keywords: ["ブラジル", "シュラスコ", "Brazil"], tag: "#ブラジル料理" },
      { keywords: ["ロシア", "ボルシチ", "Russia"], tag: "#ロシア料理" },
    ],
    defaultSubTag: "#他国料理",
  },
  // ── ラーメン ────────────────────────────────────────────────────────────────
  {
    id: "ramen",
    label: "ラーメン",
    genreCode: "G013",
    baseTags: ["#お腹すいた", "#ラーメン"],
    subTagRules: [
      { keywords: ["こってり", "豚骨", "家系", "濃厚", "二郎", "背脂", "燕三条", "ドロドロ"], tag: "#こってりラーメン" },
      { keywords: ["あっさり", "塩", "鶏", "鴨", "淡麗", "清湯", "ライト"], tag: "#あっさりラーメン" },
      { keywords: ["味噌", "みそ", "miso", "信州", "札幌味噌"], tag: "#味噌ラーメン" },
      { keywords: ["つけ麺", "まぜそば", "油そば", "汁なし"], tag: "#つけ麺まぜそば" },
    ],
  },
  // ── お好み焼き・もんじゃ ────────────────────────────────────────────────────
  {
    id: "okonomiyaki",
    label: "お好み焼きもんじゃ",
    genreCode: "G014",
    baseTags: ["#お腹すいた", "#お好み焼きもんじゃ"],
    subTagRules: [],
  },
  // ── カフェ・スイーツ ────────────────────────────────────────────────────────
  {
    id: "cafe",
    label: "カフェスイーツ",
    genreCode: "G018",
    baseTags: ["#お腹すいた", "#カフェスイーツ"],
    subTagRules: [
      { keywords: ["スイーツ", "パンケーキ", "ケーキ", "パフェ", "タルト", "チョコ", "クレープ"], tag: "#カフェスイーツ" },
      { keywords: ["喫茶", "純喫茶", "昭和", "レトロ", "老舗", "珈琲館"], tag: "#喫茶店" },
    ],
    defaultSubTag: "#流行りカフェ",
  },
  // ── ダイニングバー・バル ─────────────────────────────────────────────────────
  {
    id: "dining_bar",
    label: "ダイニングバー・バル",
    genreCode: "G002",
    baseTags: ["#お腹すいた", "#居酒屋"],
    subTagRules: [
      { keywords: ["個室", "完全個室", "半個室"], tag: "#居酒屋個室" },
      { keywords: ["バル", "ビストロ", "ガストロ", "スペイン"], tag: "#洋食" },
    ],
    defaultSubTag: "#居酒屋個室",
  },
  // ── 創作料理 ─────────────────────────────────────────────────────────────────
  {
    id: "creative",
    label: "創作料理",
    genreCode: "G003",
    baseTags: ["#お腹すいた", "#和食"],
    subTagRules: [
      { keywords: ["フレンチ", "フュージョン", "モダン"], tag: "#洋食" },
      { keywords: ["海鮮", "魚介", "鮮魚"], tag: "#海鮮" },
      { keywords: ["個室", "完全個室"], tag: "#懐石料理" },
    ],
  },
  // ── 鍋 ──────────────────────────────────────────────────────────────────────
  {
    id: "nabe",
    label: "鍋料理",
    genreCode: "G015",
    baseTags: ["#お腹すいた", "#居酒屋"],
    subTagRules: [
      { keywords: ["しゃぶしゃぶ", "すき焼き"], tag: "#焼肉単品あり" },
      { keywords: ["もつ鍋", "博多", "水炊き"], tag: "#居酒屋" },
      { keywords: ["個室", "完全個室"], tag: "#居酒屋個室" },
    ],
  },
  // ── その他グルメ ─────────────────────────────────────────────────────────────
  {
    id: "other_gourmet",
    label: "その他グルメ",
    genreCode: "G017",
    baseTags: ["#お腹すいた"],
    subTagRules: [
      { keywords: ["ハンバーガー", "バーガー", "burger"], tag: "#洋食" },
      { keywords: ["カレー", "curry", "スパイス"], tag: "#アジア系統" },
      { keywords: ["ピザ", "pizza"], tag: "#イタリアン" },
      { keywords: ["うどん", "そば", "蕎麦"], tag: "#うどんそば" },
      { keywords: ["焼き鳥", "やきとり", "串焼き", "串"], tag: "#居酒屋" },
      { keywords: ["ステーキ", "肉", "牛"], tag: "#ステーキ" },
    ],
    defaultSubTag: "#和食",
  },
  // ── 高層ビル料理（キーワード検索）─────────────────────────────────────────
  {
    id: "skyscraper",
    label: "高層ビル料理",
    keyword: "展望 レストラン",
    baseTags: ["#お腹すいた", "#高層ビル料理"],
    subTagRules: [],
  },
  {
    id: "skyscraper2",
    label: "高層ビル料理(スカイ)",
    keyword: "スカイレストラン タワー",
    baseTags: ["#お腹すいた", "#高層ビル料理"],
    subTagRules: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// タグ自動付与関数（OpenAI不使用・純粋なルールベース）
// ─────────────────────────────────────────────────────────────────────────────
export function assignTagsFromConfig(
  config: SyncGenreConfig,
  shopName: string,
  catchCopy: string,
  genreCatch: string,
  isKorean?: boolean // 韓国キーワード判定フラグ（asianジャンルの除外に使用）
): string[] {
  const tags = [...config.baseTags];

  // アジア系統ジャンルで韓国キーワードを持つ店は韓国タグのみ（asian configには付与しない）
  if (config.id === "asian" && isKorean) return [];

  const searchText = `${shopName} ${catchCopy} ${genreCatch}`.toLowerCase();

  let subTagAssigned = false;
  for (const rule of config.subTagRules) {
    if (rule.keywords.some(kw => searchText.includes(kw.toLowerCase()))) {
      if (!tags.includes(rule.tag)) tags.push(rule.tag);
      subTagAssigned = true;
    }
  }

  // どのサブタグにも当たらなかった場合のデフォルト
  if (!subTagAssigned && config.defaultSubTag) {
    tags.push(config.defaultSubTag);
  }

  return tags;
}

// 韓国キーワード判定
export function isKoreanShop(shopName: string, catchCopy: string, genreCatch: string): boolean {
  const text = `${shopName} ${catchCopy} ${genreCatch}`;
  return /韓国|チヂミ|チゲ|サムギョプサル|コムタン|スンドゥブ|ビビンバ|プルコギ|冷麺|korean/i.test(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// 日本全国グリッドポイント（プログラム生成）
// 各エリアを密度別に分けて格子点を自動生成
// ─────────────────────────────────────────────────────────────────────────────
export interface GridPoint {
  lat: number;
  lng: number;
  area: string;
}

/** 格子点自動生成（エリア別に密度を変えて全国をカバー） */
function generateJapanGrid(): GridPoint[] {
  // ── エリア定義 ────────────────────────────────────────────────────────────
  // step: 緯度・経度方向の刻み幅（度）
  //   0.04° ≈ 4.4km  → 主要都市中心（超高密度・完全カバー）
  //   0.05° ≈ 5.5km  → 全国統一（完全カバー: 検索半径3km × 2 = 6km > 5.5km）
  const REGIONS: Array<{
    name: string;
    latMin: number; latMax: number;
    lngMin: number; lngMax: number;
    step: number;
  }> = [
    // ━━━━━━ 主要都市中心部（超高密度: 約4km間隔）━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    { name: "東京23区",       latMin: 35.59, latMax: 35.81, lngMin: 139.57, lngMax: 139.93, step: 0.04 },
    { name: "横浜川崎",       latMin: 35.38, latMax: 35.55, lngMin: 139.58, lngMax: 139.74, step: 0.04 },
    { name: "さいたま市",     latMin: 35.81, latMax: 35.95, lngMin: 139.58, lngMax: 139.75, step: 0.04 },
    { name: "千葉市",         latMin: 35.57, latMax: 35.66, lngMin: 140.07, lngMax: 140.19, step: 0.04 },
    { name: "大阪市",         latMin: 34.62, latMax: 34.79, lngMin: 135.43, lngMax: 135.59, step: 0.04 },
    { name: "名古屋市",       latMin: 35.08, latMax: 35.26, lngMin: 136.82, lngMax: 137.00, step: 0.04 },
    { name: "福岡市",         latMin: 33.53, latMax: 33.66, lngMin: 130.34, lngMax: 130.49, step: 0.04 },
    { name: "札幌市",         latMin: 42.96, latMax: 43.13, lngMin: 141.25, lngMax: 141.44, step: 0.04 },
    { name: "仙台市",         latMin: 38.22, latMax: 38.36, lngMin: 140.80, lngMax: 140.98, step: 0.04 },
    { name: "京都市",         latMin: 34.93, latMax: 35.09, lngMin: 135.69, lngMax: 135.85, step: 0.04 },
    { name: "神戸市",         latMin: 34.65, latMax: 34.78, lngMin: 135.13, lngMax: 135.47, step: 0.04 },
    { name: "広島市",         latMin: 34.35, latMax: 34.45, lngMin: 132.40, lngMax: 132.53, step: 0.04 },
    { name: "北九州市",       latMin: 33.85, latMax: 33.95, lngMin: 130.81, lngMax: 130.95, step: 0.04 },
    { name: "那覇市",         latMin: 26.18, latMax: 26.26, lngMin: 127.66, lngMax: 127.74, step: 0.04 },
    { name: "熊本市",         latMin: 32.79, latMax: 32.83, lngMin: 130.69, lngMax: 130.77, step: 0.04 },
    { name: "新潟市",         latMin: 37.89, latMax: 37.95, lngMin: 139.00, lngMax: 139.12, step: 0.04 },
    { name: "静岡市",         latMin: 34.95, latMax: 35.01, lngMin: 138.35, lngMax: 138.43, step: 0.04 },
    { name: "浜松市",         latMin: 34.69, latMax: 34.74, lngMin: 137.71, lngMax: 137.78, step: 0.04 },
    { name: "岡山市",         latMin: 34.64, latMax: 34.69, lngMin: 133.90, lngMax: 133.96, step: 0.04 },
    { name: "金沢市",         latMin: 36.55, latMax: 36.61, lngMin: 136.61, lngMax: 136.68, step: 0.04 },
    { name: "松山市",         latMin: 33.82, latMax: 33.87, lngMin: 132.73, lngMax: 132.79, step: 0.04 },

    // ━━━━━━ 都市近郊（高密度: 約5km間隔 → ほぼ完全カバー）━━━━━━━━━━━━━━━━━━━━
    // 首都圏
    { name: "東京多摩",       latMin: 35.55, latMax: 35.82, lngMin: 138.98, lngMax: 139.58, step: 0.05 },
    { name: "神奈川内陸",     latMin: 35.18, latMax: 35.60, lngMin: 139.12, lngMax: 139.58, step: 0.05 },
    { name: "埼玉",           latMin: 35.68, latMax: 36.22, lngMin: 139.00, lngMax: 139.85, step: 0.05 },
    { name: "千葉北",         latMin: 35.66, latMax: 35.95, lngMin: 139.90, lngMax: 140.55, step: 0.05 },
    { name: "千葉南",         latMin: 35.14, latMax: 35.57, lngMin: 139.88, lngMax: 140.36, step: 0.05 },
    // 関西
    { name: "大阪近郊",       latMin: 34.45, latMax: 34.95, lngMin: 135.30, lngMax: 135.75, step: 0.05 },
    { name: "兵庫東部",       latMin: 34.60, latMax: 35.00, lngMin: 134.90, lngMax: 135.30, step: 0.05 },
    { name: "京都府南部",     latMin: 34.85, latMax: 35.15, lngMin: 135.57, lngMax: 135.88, step: 0.05 },
    { name: "奈良",           latMin: 34.38, latMax: 34.73, lngMin: 135.75, lngMax: 136.00, step: 0.05 },
    // 中京
    { name: "名古屋近郊",     latMin: 34.95, latMax: 35.35, lngMin: 136.58, lngMax: 137.20, step: 0.05 },
    { name: "愛知東部",       latMin: 34.65, latMax: 35.10, lngMin: 136.80, lngMax: 137.55, step: 0.05 },
    // 福岡・北九州周辺
    { name: "福岡近郊",       latMin: 33.40, latMax: 33.90, lngMin: 130.20, lngMax: 130.90, step: 0.05 },
    { name: "北九州近郊",     latMin: 33.60, latMax: 34.00, lngMin: 130.70, lngMax: 131.30, step: 0.05 },
    // 仙台近郊
    { name: "宮城南部",       latMin: 37.90, latMax: 38.55, lngMin: 140.55, lngMax: 141.15, step: 0.05 },
    // 札幌近郊
    { name: "石狩平野",       latMin: 42.85, latMax: 43.35, lngMin: 141.00, lngMax: 141.65, step: 0.05 },
    // 広島・山口
    { name: "広島近郊",       latMin: 34.10, latMax: 34.52, lngMin: 132.20, lngMax: 132.80, step: 0.05 },

    // ━━━━━━ 各道府県（中密度: 約6km間隔 → ほぼ完全カバー）━━━━━━━━━━━━━━━━━━━━
    // 東北
    { name: "青森県",         latMin: 40.40, latMax: 41.50, lngMin: 140.00, lngMax: 141.70, step: 0.05 },
    { name: "岩手県",         latMin: 38.60, latMax: 40.40, lngMin: 140.60, lngMax: 141.80, step: 0.05 },
    { name: "宮城県",         latMin: 37.65, latMax: 38.90, lngMin: 140.20, lngMax: 141.50, step: 0.05 },
    { name: "秋田県",         latMin: 38.80, latMax: 40.30, lngMin: 139.55, lngMax: 140.80, step: 0.05 },
    { name: "山形県",         latMin: 37.75, latMax: 39.00, lngMin: 139.50, lngMax: 140.75, step: 0.05 },
    { name: "福島県",         latMin: 36.75, latMax: 37.85, lngMin: 139.50, lngMax: 141.00, step: 0.05 },
    // 関東（外周部）
    { name: "茨城県",         latMin: 35.72, latMax: 36.58, lngMin: 139.88, lngMax: 140.88, step: 0.05 },
    { name: "栃木県",         latMin: 36.20, latMax: 36.97, lngMin: 139.38, lngMax: 140.25, step: 0.05 },
    { name: "群馬県",         latMin: 36.15, latMax: 36.88, lngMin: 138.42, lngMax: 139.60, step: 0.05 },
    { name: "山梨県",         latMin: 35.40, latMax: 35.78, lngMin: 138.30, lngMax: 139.00, step: 0.05 },
    { name: "長野県北部",     latMin: 36.40, latMax: 37.05, lngMin: 137.65, lngMax: 138.60, step: 0.05 },
    { name: "長野県南部",     latMin: 35.42, latMax: 36.40, lngMin: 137.55, lngMax: 138.30, step: 0.05 },
    // 中部
    { name: "新潟県",         latMin: 36.85, latMax: 38.55, lngMin: 137.70, lngMax: 139.60, step: 0.05 },
    { name: "富山県",         latMin: 36.42, latMax: 36.80, lngMin: 136.70, lngMax: 137.62, step: 0.05 },
    { name: "石川県",         latMin: 36.22, latMax: 37.00, lngMin: 136.45, lngMax: 137.10, step: 0.05 },
    { name: "福井県",         latMin: 35.52, latMax: 36.20, lngMin: 135.80, lngMax: 136.55, step: 0.05 },
    { name: "静岡県東部",     latMin: 34.88, latMax: 35.32, lngMin: 138.42, lngMax: 139.18, step: 0.05 },
    { name: "静岡県西部",     latMin: 34.62, latMax: 35.10, lngMin: 137.45, lngMax: 138.45, step: 0.05 },
    { name: "岐阜県",         latMin: 35.20, latMax: 36.30, lngMin: 136.60, lngMax: 137.65, step: 0.05 },
    { name: "三重県",         latMin: 33.75, latMax: 35.00, lngMin: 135.95, lngMax: 136.75, step: 0.05 },
    // 関西外周
    { name: "滋賀県",         latMin: 34.80, latMax: 35.58, lngMin: 135.80, lngMax: 136.30, step: 0.05 },
    { name: "兵庫西部",       latMin: 34.60, latMax: 35.18, lngMin: 134.28, lngMax: 135.00, step: 0.05 },
    { name: "和歌山県",       latMin: 33.45, latMax: 34.35, lngMin: 135.00, lngMax: 136.00, step: 0.05 },
    // 中国
    { name: "鳥取県",         latMin: 35.15, latMax: 35.58, lngMin: 133.18, lngMax: 134.50, step: 0.05 },
    { name: "島根県",         latMin: 34.68, latMax: 35.60, lngMin: 131.85, lngMax: 133.25, step: 0.05 },
    { name: "岡山県",         latMin: 34.32, latMax: 35.10, lngMin: 133.35, lngMax: 134.32, step: 0.05 },
    { name: "広島県東部",     latMin: 34.20, latMax: 34.70, lngMin: 132.80, lngMax: 133.62, step: 0.05 },
    { name: "山口県",         latMin: 33.75, latMax: 34.42, lngMin: 130.62, lngMax: 132.45, step: 0.05 },
    // 四国
    { name: "徳島県",         latMin: 33.62, latMax: 34.18, lngMin: 133.80, lngMax: 134.78, step: 0.05 },
    { name: "香川県",         latMin: 34.02, latMax: 34.35, lngMin: 133.62, lngMax: 134.45, step: 0.05 },
    { name: "愛媛県",         latMin: 33.22, latMax: 34.00, lngMin: 132.38, lngMax: 133.40, step: 0.05 },
    { name: "高知県",         latMin: 32.95, latMax: 33.78, lngMin: 132.65, lngMax: 134.20, step: 0.05 },
    // 九州
    { name: "佐賀県",         latMin: 33.05, latMax: 33.55, lngMin: 129.85, lngMax: 130.42, step: 0.05 },
    { name: "長崎県",         latMin: 32.48, latMax: 33.45, lngMin: 129.35, lngMax: 130.08, step: 0.05 },
    { name: "大分県",         latMin: 32.90, latMax: 33.62, lngMin: 130.95, lngMax: 131.78, step: 0.05 },
    { name: "宮崎県",         latMin: 31.35, latMax: 32.82, lngMin: 130.72, lngMax: 131.68, step: 0.05 },
    { name: "鹿児島県",       latMin: 30.88, latMax: 31.98, lngMin: 130.05, lngMax: 131.05, step: 0.05 },
    { name: "熊本県",         latMin: 32.00, latMax: 33.05, lngMin: 130.20, lngMax: 131.22, step: 0.05 },

    // ━━━━━━ 北海道（完全カバー: 約5km間隔）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    { name: "北海道道央",     latMin: 42.60, latMax: 43.80, lngMin: 140.85, lngMax: 143.00, step: 0.05 },
    { name: "北海道道南",     latMin: 41.35, latMax: 42.60, lngMin: 139.80, lngMax: 141.60, step: 0.05 },
    { name: "北海道道北",     latMin: 43.80, latMax: 45.55, lngMin: 141.40, lngMax: 143.50, step: 0.05 },
    { name: "北海道道東",     latMin: 42.60, latMax: 44.35, lngMin: 142.85, lngMax: 145.85, step: 0.05 },
    { name: "北海道内陸",     latMin: 43.05, latMax: 44.80, lngMin: 141.50, lngMax: 143.20, step: 0.05 },

    // ━━━━━━ 沖縄諸島（中密度: 主要島のみ）━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    { name: "沖縄本島北部",   latMin: 26.22, latMax: 26.90, lngMin: 127.65, lngMax: 128.28, step: 0.05 },
    { name: "沖縄本島南部",   latMin: 26.00, latMax: 26.22, lngMin: 127.60, lngMax: 127.80, step: 0.05 },
    { name: "石垣島",         latMin: 24.28, latMax: 24.55, lngMin: 124.10, lngMax: 124.35, step: 0.05 },
    { name: "宮古島",         latMin: 24.70, latMax: 24.90, lngMin: 125.20, lngMax: 125.40, step: 0.05 },

    // ━━━━━━ 未カバー都道府県庁所在地（高密度: 約6km間隔）━━━━━━━━━━━━━━━━━━━
    // 東北（まだ0.14地域にしか入っていない県庁所在地）
    { name: "青森市",         latMin: 40.77, latMax: 40.87, lngMin: 140.70, lngMax: 140.82, step: 0.05 },
    { name: "盛岡市",         latMin: 39.64, latMax: 39.76, lngMin: 141.09, lngMax: 141.21, step: 0.05 },
    { name: "秋田市",         latMin: 39.67, latMax: 39.77, lngMin: 140.05, lngMax: 140.17, step: 0.05 },
    { name: "山形市",         latMin: 38.19, latMax: 38.29, lngMin: 140.31, lngMax: 140.43, step: 0.05 },
    { name: "福島市",         latMin: 37.70, latMax: 37.80, lngMin: 140.42, lngMax: 140.54, step: 0.05 },
    // 関東（県庁所在地）
    { name: "水戸市",         latMin: 36.32, latMax: 36.42, lngMin: 140.43, lngMax: 140.55, step: 0.05 },
    { name: "宇都宮市",       latMin: 36.52, latMax: 36.62, lngMin: 139.83, lngMax: 139.95, step: 0.05 },
    { name: "前橋市",         latMin: 36.34, latMax: 36.44, lngMin: 139.01, lngMax: 139.13, step: 0.05 },
    { name: "高崎市",         latMin: 36.30, latMax: 36.40, lngMin: 138.98, lngMax: 139.10, step: 0.05 },
    { name: "甲府市",         latMin: 35.61, latMax: 35.71, lngMin: 138.52, lngMax: 138.64, step: 0.05 },
    // 中部（県庁所在地）
    { name: "長野市",         latMin: 36.60, latMax: 36.70, lngMin: 138.13, lngMax: 138.25, step: 0.05 },
    { name: "松本市",         latMin: 36.22, latMax: 36.32, lngMin: 137.96, lngMax: 138.08, step: 0.05 },
    { name: "岐阜市",         latMin: 35.37, latMax: 35.47, lngMin: 136.71, lngMax: 136.83, step: 0.05 },
    { name: "津市",           latMin: 34.68, latMax: 34.78, lngMin: 136.46, lngMax: 136.58, step: 0.05 },
    { name: "四日市市",       latMin: 34.92, latMax: 35.02, lngMin: 136.57, lngMax: 136.69, step: 0.05 },
    { name: "長岡市",         latMin: 37.40, latMax: 37.50, lngMin: 138.80, lngMax: 138.92, step: 0.05 },
    // 関西（県庁所在地）
    { name: "大津市",         latMin: 34.95, latMax: 35.05, lngMin: 135.82, lngMax: 135.94, step: 0.05 },
    { name: "奈良市",         latMin: 34.64, latMax: 34.74, lngMin: 135.78, lngMax: 135.90, step: 0.05 },
    { name: "和歌山市",       latMin: 34.18, latMax: 34.28, lngMin: 135.12, lngMax: 135.24, step: 0.05 },
    { name: "姫路市",         latMin: 34.77, latMax: 34.87, lngMin: 134.64, lngMax: 134.76, step: 0.05 },
    // 中国（県庁所在地）
    { name: "鳥取市",         latMin: 35.45, latMax: 35.55, lngMin: 134.18, lngMax: 134.30, step: 0.05 },
    { name: "松江市",         latMin: 35.42, latMax: 35.52, lngMin: 133.00, lngMax: 133.12, step: 0.05 },
    { name: "山口市",         latMin: 34.14, latMax: 34.24, lngMin: 131.42, lngMax: 131.54, step: 0.05 },
    { name: "下関市",         latMin: 33.90, latMax: 34.00, lngMin: 130.91, lngMax: 131.03, step: 0.05 },
    // 四国（県庁所在地）
    { name: "徳島市",         latMin: 34.02, latMax: 34.12, lngMin: 134.50, lngMax: 134.62, step: 0.05 },
    { name: "高松市",         latMin: 34.29, latMax: 34.39, lngMin: 134.00, lngMax: 134.12, step: 0.05 },
    { name: "高知市",         latMin: 33.51, latMax: 33.61, lngMin: 133.48, lngMax: 133.60, step: 0.05 },
    // 九州（県庁所在地）
    { name: "佐賀市",         latMin: 33.21, latMax: 33.31, lngMin: 130.25, lngMax: 130.37, step: 0.05 },
    { name: "長崎市",         latMin: 32.70, latMax: 32.80, lngMin: 129.82, lngMax: 129.94, step: 0.05 },
    { name: "大分市",         latMin: 33.19, latMax: 33.29, lngMin: 131.56, lngMax: 131.68, step: 0.05 },
    { name: "宮崎市",         latMin: 31.86, latMax: 31.96, lngMin: 131.37, lngMax: 131.49, step: 0.05 },
    { name: "鹿児島市",       latMin: 31.55, latMax: 31.65, lngMin: 130.50, lngMax: 130.62, step: 0.05 },
    // 北海道（主要都市）
    { name: "旭川市",         latMin: 43.72, latMax: 43.82, lngMin: 142.31, lngMax: 142.43, step: 0.05 },
    { name: "函館市",         latMin: 41.72, latMax: 41.82, lngMin: 140.68, lngMax: 140.80, step: 0.05 },
    { name: "釧路市",         latMin: 42.96, latMax: 43.06, lngMin: 144.36, lngMax: 144.48, step: 0.05 },
    { name: "帯広市",         latMin: 42.87, latMax: 42.97, lngMin: 143.16, lngMax: 143.28, step: 0.05 },

    // ━━━━━━ 主要地方都市（人口20万人以上・未カバー）━━━━━━━━━━━━━━━━━━━━━━━
    { name: "郡山市",         latMin: 37.37, latMax: 37.43, lngMin: 140.34, lngMax: 140.42, step: 0.05 },
    { name: "いわき市",       latMin: 37.03, latMax: 37.09, lngMin: 140.86, lngMax: 140.94, step: 0.05 },
    { name: "つくば市",       latMin: 36.06, latMax: 36.12, lngMin: 140.06, lngMax: 140.14, step: 0.05 },
    { name: "川越市",         latMin: 35.90, latMax: 35.96, lngMin: 139.46, lngMax: 139.54, step: 0.05 },
    { name: "船橋市",         latMin: 35.68, latMax: 35.74, lngMin: 139.96, lngMax: 140.04, step: 0.05 },
    { name: "八王子市",       latMin: 35.65, latMax: 35.71, lngMin: 139.30, lngMax: 139.38, step: 0.05 },
    { name: "相模原市",       latMin: 35.55, latMax: 35.61, lngMin: 139.35, lngMax: 139.43, step: 0.05 },
    { name: "藤沢市",         latMin: 35.32, latMax: 35.38, lngMin: 139.47, lngMax: 139.55, step: 0.05 },
    { name: "豊橋市",         latMin: 34.72, latMax: 34.80, lngMin: 137.34, lngMax: 137.44, step: 0.05 },
    { name: "豊田市",         latMin: 35.04, latMax: 35.14, lngMin: 137.11, lngMax: 137.23, step: 0.05 },
    { name: "岡崎市",         latMin: 34.94, latMax: 35.02, lngMin: 137.14, lngMax: 137.24, step: 0.05 },
    { name: "東大阪市",       latMin: 34.66, latMax: 34.72, lngMin: 135.58, lngMax: 135.66, step: 0.05 },
    { name: "堺市",           latMin: 34.55, latMax: 34.61, lngMin: 135.45, lngMax: 135.53, step: 0.05 },
    { name: "西宮市",         latMin: 34.72, latMax: 34.78, lngMin: 135.32, lngMax: 135.40, step: 0.05 },
    { name: "尼崎市",         latMin: 34.71, latMax: 34.77, lngMin: 135.39, lngMax: 135.47, step: 0.05 },
    { name: "倉敷市",         latMin: 34.58, latMax: 34.66, lngMin: 133.76, lngMax: 133.88, step: 0.05 },
    { name: "福山市",         latMin: 34.47, latMax: 34.53, lngMin: 133.34, lngMax: 133.42, step: 0.05 },
    { name: "呉市",           latMin: 34.22, latMax: 34.28, lngMin: 132.54, lngMax: 132.62, step: 0.05 },
  ];

  const seen = new Set<string>();
  const points: GridPoint[] = [];

  for (const r of REGIONS) {
    // 浮動小数点誤差を避けるため整数演算で制御
    const latSteps = Math.ceil((r.latMax - r.latMin) / r.step) + 1;
    const lngSteps = Math.ceil((r.lngMax - r.lngMin) / r.step) + 1;

    for (let i = 0; i < latSteps; i++) {
      const lat = Math.round((r.latMin + i * r.step) * 100000) / 100000;
      if (lat > r.latMax + 0.001) break;

      for (let j = 0; j < lngSteps; j++) {
        const lng = Math.round((r.lngMin + j * r.step) * 100000) / 100000;
        if (lng > r.lngMax + 0.001) break;

        // 0.04°単位（約4.4km）で丸めて重複排除
        const keyLat = Math.round(lat / 0.04) * 0.04;
        const keyLng = Math.round(lng / 0.04) * 0.04;
        const key = `${keyLat.toFixed(2)},${keyLng.toFixed(2)}`;

        if (!seen.has(key)) {
          seen.add(key);
          points.push({ lat, lng, area: r.name });
        }
      }
    }
  }

  return points;
}

export const JAPAN_GRID_POINTS: GridPoint[] = generateJapanGrid();

// 生成されたポイント数を確認したい場合: console.log(JAPAN_GRID_POINTS.length)


// グリッドポイントをバッチに分割
export function getGridBatch(batchIndex: number, batchSize: number = 20): GridPoint[] {
  const start = batchIndex * batchSize;
  return JAPAN_GRID_POINTS.slice(start, start + batchSize);
}

export function getTotalBatches(batchSize: number = 20): number {
  return Math.ceil(JAPAN_GRID_POINTS.length / batchSize);
}
