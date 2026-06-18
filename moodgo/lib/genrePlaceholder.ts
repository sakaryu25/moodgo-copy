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
];

// 飲食の汎用フォールバック（#お腹すいた のみ等、ジャンル不明）
const FOOD_DEFAULT: GenrePlaceholder = { emoji: "🍽️", colors: ["#FFF3EE", "#FFE3D6"], label: "ごはん" };

/**
 * タグからジャンル別プレースホルダーを返す。
 * 飲食タグが1つも無ければ null（呼び出し側で従来の汎用プレースホルダーを使う）。
 */
export function genrePlaceholder(tags?: string[]): GenrePlaceholder | null {
  const t = tags ?? [];
  for (const { tag, ph } of RULES) {
    if (t.includes(tag)) return ph;
  }
  if (t.includes("#お腹すいた")) return FOOD_DEFAULT;
  return null;
}
