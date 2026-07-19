// ── ジャンル別プレースホルダー ───────────────────────────────────────────────
// OSM飲食データは写真なしが多い。Google写真の常用は避け、タグからジャンルを判定して
// MoodGoらしい絵文字＋グラデーションのプレースホルダーを返す（バイナリ画像不要）。
// 画像優先順位: 店舗提供 > 運営 > 承認済みユーザー投稿 > ★ここ(ジャンル別) > 最後にGoogle。

export type GenrePlaceholder = {
  emoji: string;
  colors: [string, string];
  label: string;
};

// predefined-tags.ts の飲食タグ → プレースホルダー。先に来るものほど優先。
const RULES: { tag: string; ph: GenrePlaceholder }[] = [
  { tag: "#ラーメン",       ph: { emoji: "🍜", colors: ["#FFF1E6", "#FFE0CC"], label: "ラーメン" } },
  { tag: "#焼肉",           ph: { emoji: "🥩", colors: ["#FFECEC", "#FFD6D6"], label: "焼肉" } },
  { tag: "#居酒屋",         ph: { emoji: "🏮", colors: ["#FFF0F2", "#FFDCE2"], label: "居酒屋" } },
  { tag: "#海鮮",           ph: { emoji: "🍣", colors: ["#EAF6FF", "#D5ECFF"], label: "海鮮・寿司" } },
  { tag: "#天ぷら",         ph: { emoji: "🍤", colors: ["#FFF7E6", "#FFEBC2"], label: "天ぷら" } },
  { tag: "#うどんそば",     ph: { emoji: "🍲", colors: ["#FBF6EC", "#F0E4CC"], label: "うどん・そば" } },
  { tag: "#和食",           ph: { emoji: "🍱", colors: ["#F4F8F0", "#E2EFD8"], label: "和食" } },
  { tag: "#イタリアン",     ph: { emoji: "🍝", colors: ["#FFF3E9", "#FFE2C8"], label: "イタリアン" } },
  { tag: "#中華",           ph: { emoji: "🥟", colors: ["#FFF0EE", "#FFDAD4"], label: "中華" } },
  { tag: "#韓国",           ph: { emoji: "🌶️", colors: ["#FFEDEC", "#FFD3D0"], label: "韓国料理" } },
  { tag: "#アジア系統",     ph: { emoji: "🍛", colors: ["#FFF6E3", "#FFE7B8"], label: "アジア料理" } },
  { tag: "#各国料理",       ph: { emoji: "🌍", colors: ["#EEF4FF", "#D8E6FF"], label: "各国料理" } },
  { tag: "#ハンバーグ",     ph: { emoji: "🍳", colors: ["#FFF4E8", "#FFE3C6"], label: "洋食" } },
  { tag: "#オムライス",     ph: { emoji: "🍳", colors: ["#FFF4E8", "#FFE3C6"], label: "洋食" } },
  { tag: "#ステーキ",       ph: { emoji: "🥩", colors: ["#FBEFE8", "#F3D8C8"], label: "ステーキ" } },
  { tag: "#レトロ洋食",     ph: { emoji: "🍽️", colors: ["#FFF4E8", "#FFE3C6"], label: "洋食" } },
  { tag: "#洋食",           ph: { emoji: "🍽️", colors: ["#FFF4E8", "#FFE3C6"], label: "洋食" } },
  { tag: "#ファミレス",     ph: { emoji: "🍴", colors: ["#F1F5FF", "#DCE6FF"], label: "ファミレス" } },
  { tag: "#お好み焼きもんじゃ", ph: { emoji: "🍢", colors: ["#FFF2E8", "#FFDFC6"], label: "お好み焼き" } },
  { tag: "#フルーツ",       ph: { emoji: "🍓", colors: ["#FFF0F4", "#FFD9E4"], label: "フルーツ" } },
  { tag: "#喫茶店",         ph: { emoji: "☕", colors: ["#F6F0EA", "#E8D9CB"], label: "喫茶店" } },
  { tag: "#流行りカフェ",   ph: { emoji: "🧋", colors: ["#FBF1FF", "#EFD9FF"], label: "カフェ" } },
  { tag: "#カフェスイーツ", ph: { emoji: "🍰", colors: ["#FFF2F7", "#FFDCEA"], label: "カフェ・スイーツ" } },
  // ── まったり/自然 ──
  { tag: "#温泉",           ph: { emoji: "♨️", colors: ["#FFF1EC", "#FFD9C9"], label: "温泉" } },
  { tag: "#銭湯",           ph: { emoji: "♨️", colors: ["#FFF3EE", "#FFDECB"], label: "銭湯" } },
  { tag: "#サウナ",         ph: { emoji: "🧖", colors: ["#FBEDE8", "#F0D6C8"], label: "サウナ" } },
  { tag: "#岩盤浴",         ph: { emoji: "🧖", colors: ["#FBEDE8", "#F0D6C8"], label: "岩盤浴" } },
  { tag: "#海辺",           ph: { emoji: "🏖️", colors: ["#E9F6FF", "#CFEBFF"], label: "海辺" } },
  { tag: "#展望台",         ph: { emoji: "🗼", colors: ["#EEF2FF", "#D8E0FF"], label: "展望台" } },
  { tag: "#絶景スポット",   ph: { emoji: "🏞️", colors: ["#EAF7F0", "#D2EEDD"], label: "絶景" } },
  { tag: "#自然公園",       ph: { emoji: "🌲", colors: ["#EEF6E9", "#D8EDC9"], label: "自然公園" } },
  { tag: "#大型公園",       ph: { emoji: "🌳", colors: ["#EFF6E8", "#DAEFC8"], label: "公園" } },
  // ── 楽しみたい ──
  { tag: "#テーマパーク",   ph: { emoji: "🎡", colors: ["#FFF0F6", "#FFD7E8"], label: "テーマパーク" } },
  { tag: "#水族館",         ph: { emoji: "🐬", colors: ["#E8F5FF", "#CDE9FF"], label: "水族館" } },
  { tag: "#動物園",         ph: { emoji: "🦁", colors: ["#FBF4E6", "#F2E1B8"], label: "動物園" } },
  { tag: "#博物館",         ph: { emoji: "🏛️", colors: ["#F3F0EA", "#E2D9C8"], label: "博物館・美術館" } },
  { tag: "#カラオケ",       ph: { emoji: "🎤", colors: ["#F7EEFF", "#E6D2FF"], label: "カラオケ" } },
  { tag: "#ボウリング",     ph: { emoji: "🎳", colors: ["#EFF1FF", "#D8DDFF"], label: "ボウリング" } },
  { tag: "#体験型ゲーム",   ph: { emoji: "🎮", colors: ["#F0EEFF", "#D8D2FF"], label: "アミューズメント" } },
  { tag: "#鑑賞",           ph: { emoji: "🎭", colors: ["#F4EEF7", "#E2D2EC"], label: "鑑賞" } },
  // ── 運動 ──
  { tag: "#ジム",           ph: { emoji: "💪", colors: ["#FFEFEC", "#FFD4CB"], label: "ジム" } },
  { tag: "#プール",         ph: { emoji: "🏊", colors: ["#E8F6FF", "#CDEAFF"], label: "プール" } },
  { tag: "#ゴルフ",         ph: { emoji: "⛳", colors: ["#EEF7E9", "#D6EEC9"], label: "ゴルフ" } },
  { tag: "#ボウリング",     ph: { emoji: "🎳", colors: ["#EFF1FF", "#D8DDFF"], label: "ボウリング" } },
  { tag: "#スポーツ",       ph: { emoji: "🏃", colors: ["#EEF6F0", "#D4EBDB"], label: "スポーツ" } },
  // ── 集中 ──
  { tag: "#カフェ作業",     ph: { emoji: "💻", colors: ["#F0F2F7", "#DCE2EE"], label: "作業カフェ" } },
  { tag: "#勉強場",         ph: { emoji: "📚", colors: ["#F2EFE8", "#E1D8C6"], label: "勉強場" } },
  { tag: "#book場",         ph: { emoji: "📖", colors: ["#F2EFE8", "#E1D8C6"], label: "図書" } },
  // ── ショッピング ──
  { tag: "#古着",           ph: { emoji: "🧥", colors: ["#F3EFEA", "#E0D5C7"], label: "古着" } },
  { tag: "#服アクセサリー", ph: { emoji: "👕", colors: ["#FBF0F6", "#F2D8E7"], label: "ファッション" } },
  { tag: "#コスメ美容",     ph: { emoji: "💄", colors: ["#FFF0F4", "#FFD8E5"], label: "コスメ・美容" } },
  { tag: "#雑貨インテリア", ph: { emoji: "🪴", colors: ["#F0F5EE", "#D9EAD2"], label: "雑貨・インテリア" } },
  { tag: "#お土産ギフト",   ph: { emoji: "🎁", colors: ["#FFF1F0", "#FFD7D3"], label: "お土産・ギフト" } },
  { tag: "#ショッピング",   ph: { emoji: "🛍️", colors: ["#FBF0FA", "#F0D8EF"], label: "ショッピング" } },
  // ── 遠く/ドライブ ──
  { tag: "#パワースポット", ph: { emoji: "⛩️", colors: ["#FBEEEC", "#F4D5CF"], label: "パワースポット" } },
  { tag: "#道の駅",         ph: { emoji: "🛣️", colors: ["#F1F4EE", "#DCE7D2"], label: "道の駅" } },
  { tag: "#お散歩",         ph: { emoji: "🚶", colors: ["#F1F3F6", "#DDE2EB"], label: "お散歩" } },
];

// 気分大タグごとの汎用フォールバック（深掘り不明でも雰囲気に合うものを出す）
const MOOD_DEFAULTS: { tag: string; ph: GenrePlaceholder }[] = [
  { tag: "#お腹すいた",       ph: { emoji: "🍽️", colors: ["#FFF3EE", "#FFE3D6"], label: "ごはん" } },
  { tag: "#まったりしたい",   ph: { emoji: "🌿", colors: ["#EEF6EC", "#D6EBD0"], label: "まったり" } },
  { tag: "#自然感じたい",     ph: { emoji: "🌳", colors: ["#EFF6E8", "#DAEFC8"], label: "自然" } },
  { tag: "#わいわい楽しみたい", ph: { emoji: "🎉", colors: ["#FFF0F6", "#FFD7E8"], label: "あそび" } },
  { tag: "#体動かしたい",     ph: { emoji: "🏃", colors: ["#EEF6F0", "#D4EBDB"], label: "運動" } },
  { tag: "#集中したい",       ph: { emoji: "📖", colors: ["#F2EFE8", "#E1D8C6"], label: "集中" } },
  { tag: "#ショッピング",     ph: { emoji: "🛍️", colors: ["#FBF0FA", "#F0D8EF"], label: "ショッピング" } },
  { tag: "#遠くに行きたい",   ph: { emoji: "⛩️", colors: ["#FBEEEC", "#F4D5CF"], label: "おでかけ" } },
  { tag: "#ドライブしたい",   ph: { emoji: "🚗", colors: ["#EEF2F7", "#D8E0EC"], label: "ドライブ" } },
];

/**
 * タグからジャンル別プレースホルダーを返す。
 * 深掘りタグ → 気分大タグの順で照合。該当が無ければ null（呼び出し側で汎用プレースホルダー）。
 */
export function genrePlaceholder(tags?: string[]): GenrePlaceholder | null {
  const t = tags ?? [];
  for (const { tag, ph } of RULES) {
    if (t.includes(tag)) return ph;
  }
  for (const { tag, ph } of MOOD_DEFAULTS) {
    if (t.includes(tag)) return ph;
  }
  return null;
}
