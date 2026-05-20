// ─── 各気分・サブカテゴリ → Supabase タグ変換マップ ─────────────────────────
// Supabase places テーブルの tags TEXT[] を使って場所を絞り込む際に使用する。
// 返す tags は `places.tags @> {tag1, tag2}` (全件含む) の検索に用いる。

import type { OnsenCategory } from "@/types/onsen";
import type { NatureSubGenre } from "@/types/nature";
import type { CafeSubCategory, CafeDetail } from "@/types/cafe";
import type { WaiWaiSubCategory } from "@/types/waiwai";
import type { DriveSubCategory } from "@/types/drive";
import type { FocusSubCategory } from "@/types/focus";
import type { SportsSubCategory } from "@/types/sports";
import type { TravelSubCategory } from "@/types/travel";

export interface SubcategoryTagsResult {
  /** Supabase @> mustTags（全件含む検索） */
  tags: string[];
  /** ヒット0件時の緩い検索タグ（サブ指定なし） */
  fallback: string[];
  /** UI表示ラベル */
  label: string;
  /** 検索半径 km */
  radiusKm: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 温泉・スパ
// ─────────────────────────────────────────────────────────────────────────────
export function getOnsenTags(category: OnsenCategory | null): SubcategoryTagsResult {
  const fallbackBase = ["#温泉"];
  switch (category) {
    case "natural_onsen":
      return { tags: ["#温泉"],   fallback: fallbackBase, label: "天然温泉・日帰り温泉",     radiusKm: 20 };
    case "sento":
      return { tags: ["#温泉"],   fallback: fallbackBase, label: "銭湯",                     radiusKm: 10 };
    case "super_sento":
      return { tags: ["#温泉"],   fallback: fallbackBase, label: "スーパー銭湯・健康ランド", radiusKm: 20 };
    case "sauna_ganban":
      return { tags: ["#サウナ"], fallback: fallbackBase, label: "サウナ・岩盤浴",            radiusKm: 15 };
    default:
      return { tags: fallbackBase, fallback: fallbackBase, label: "温泉施設全般",             radiusKm: 20 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// カフェ（まったりしたい + カフェ選択時）
// ─────────────────────────────────────────────────────────────────────────────
export function getCafeTags(
  subCategory: CafeSubCategory | null,
  detail?: CafeDetail | null,
): SubcategoryTagsResult {
  const fallbackBase = ["#癒しカフェ"];
  switch (subCategory) {
    case "book_relax":
      return { tags: ["#ブックカフェ"],    fallback: fallbackBase, label: "📚 ブックカフェ・隠れ家カフェ",   radiusKm: 15 };
    case "animal":
      if (detail === "cat")  return { tags: ["#猫カフェ"],      fallback: ["#動物カフェ"], label: "🐱 猫カフェ",          radiusKm: 15 };
      if (detail === "dog")  return { tags: ["#犬カフェ"],      fallback: ["#動物カフェ"], label: "🐶 犬カフェ",          radiusKm: 15 };
      if (detail === "rare") return { tags: ["#小動物カフェ"],  fallback: ["#動物カフェ"], label: "🦔 珍しい動物カフェ",  radiusKm: 20 };
      return { tags: ["#動物カフェ"],      fallback: fallbackBase, label: "🐾 アニマルカフェ",              radiusKm: 15 };
    case "view":
      if (detail === "ocean")  return { tags: ["#海辺カフェ"],    fallback: ["#景色良いカフェ"], label: "🌊 海が見えるカフェ",   radiusKm: 20 };
      if (detail === "forest") return { tags: ["#森林カフェ"],    fallback: ["#景色良いカフェ"], label: "🌲 森の中のカフェ",     radiusKm: 20 };
      if (detail === "city")   return { tags: ["#展望台"],        fallback: ["#景色良いカフェ"], label: "🏙️ 夜景・街並みカフェ", radiusKm: 20 };
      return { tags: ["#景色良いカフェ"],  fallback: fallbackBase, label: "🌅 景色が良いカフェ",             radiusKm: 20 };
    case "sweets":
      return { tags: ["#スイーツカフェ"],  fallback: fallbackBase, label: "🍰 絶品スイーツカフェ",           radiusKm: 15 };
    default:
      return { tags: fallbackBase,         fallback: fallbackBase, label: "カフェ",                         radiusKm: 15 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 自然感じたい（+ まったりしたい+自然の中）
// ─────────────────────────────────────────────────────────────────────────────
export function getNatureTags(
  subGenre: NatureSubGenre | null,
  fromRelax = false,
): SubcategoryTagsResult {
  const fallbackBase = ["#自然感じたい"];
  switch (subGenre) {
    case "ocean":
      return { tags: ["#海辺"],         fallback: fallbackBase, label: "🌊 波の音と海風",         radiusKm: 25 };
    case "forest":
      return { tags: ["#自然公園"],     fallback: fallbackBase, label: "🌳 森の中で深呼吸",       radiusKm: 20 };
    case "park":
      return { tags: ["#大型公園"],     fallback: fallbackBase, label: "🧺 広い芝生でゴロゴロ",   radiusKm: 15 };
    case "view":
      return { tags: ["#絶景スポット"], fallback: fallbackBase, label: "🌅 圧倒的な絶景",         radiusKm: 30 };
    default:
      return { tags: fallbackBase,      fallback: fallbackBase, label: "自然スポット",             radiusKm: 20 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// わいわい楽しみたい
// ─────────────────────────────────────────────────────────────────────────────
export function getWaiWaiTags(subCategory: WaiWaiSubCategory | null): SubcategoryTagsResult {
  const fallbackBase = ["#わいわい楽しみたい"];
  switch (subCategory) {
    case "active":
      return { tags: ["#体動かしたい"],   fallback: fallbackBase, label: "💪 体を動かしてはしゃぎたい",     radiusKm: 15 };
    case "party":
      return { tags: ["#カラオケ"],        fallback: fallbackBase, label: "🎤 歌って飲んで騒ぎたい",         radiusKm: 10 };
    case "experience":
      return { tags: ["#体験型ゲーム"],   fallback: fallbackBase, label: "🎲 非日常の体験で盛り上がりたい", radiusKm: 15 };
    case "food_drink":
      return { tags: ["#居酒屋"],         fallback: fallbackBase, label: "🍻 ご飯とお酒でワイワイ",         radiusKm: 10 };
    default:
      return { tags: fallbackBase,        fallback: fallbackBase, label: "わいわいスポット",               radiusKm: 15 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ドライブしたい
// ─────────────────────────────────────────────────────────────────────────────
export function getDriveTags(subCategory: DriveSubCategory | null): SubcategoryTagsResult {
  const fallbackBase = ["#ドライブしたい"];
  switch (subCategory) {
    case "ocean_drive":
      return { tags: ["#海辺"],          fallback: fallbackBase, label: "🌊 海沿いドライブ",           radiusKm: 80 };
    case "night_view":
      return { tags: ["#絶景スポット", "#お散歩"],  fallback: fallbackBase, label: "🌉 夜景・絶景ドライブ",       radiusKm: 80 };
    case "road_station":
      return { tags: ["#ご当地グルメ"],  fallback: fallbackBase, label: "🏪 道の駅・ご当地グルメ",     radiusKm: 100 };
    case "outlet":
      return { tags: ["#ショッピング"],  fallback: fallbackBase, label: "🛍️ 郊外アウトレット",          radiusKm: 80 };
    default:
      return { tags: fallbackBase,       fallback: fallbackBase, label: "ドライブスポット",             radiusKm: 80 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 集中したい
// ─────────────────────────────────────────────────────────────────────────────
export function getFocusTags(subCategory: FocusSubCategory | null): SubcategoryTagsResult {
  const fallbackBase = ["#集中したい"];
  switch (subCategory) {
    case "work_cafe":
      return { tags: ["#カフェ作業"], fallback: fallbackBase, label: "☕ カフェで作業",               radiusKm: 10 };
    case "coworking":
      return { tags: ["#勉強場"],     fallback: fallbackBase, label: "🖥️ コワーキング・専用スペース", radiusKm: 15 };
    case "family_restaurant":
      return { tags: ["#ファミレス"], fallback: fallbackBase, label: "🍳 ファミレスで深夜まで粘る",   radiusKm: 10 };
    case "netcafe_library":
      return { tags: ["#勉強場"],     fallback: fallbackBase, label: "📚 漫画・本に囲まれてこもる",   radiusKm: 10 };
    default:
      return { tags: fallbackBase,    fallback: fallbackBase, label: "集中スポット",                 radiusKm: 10 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 体を動かしたい
// ─────────────────────────────────────────────────────────────────────────────
export function getSportsTags(subCategory: SportsSubCategory | null): SubcategoryTagsResult {
  const fallbackBase = ["#体動かしたい"];
  switch (subCategory) {
    case "training":
      return { tags: ["#ガッツリ運動"],  fallback: fallbackBase, label: "💪 がっつりトレーニング",         radiusKm: 15 };
    case "stress_relief":
      return { tags: ["#スポーツ"],      fallback: fallbackBase, label: "🏏 打って投げてストレス発散",      radiusKm: 15 };
    case "amusement_sport":
      return { tags: ["#体験型ゲーム"],  fallback: fallbackBase, label: "🎯 遊び感覚でワイワイ体を動かす", radiusKm: 15 };
    case "outdoor_sports":
      return { tags: ["#屋外スポーツ"],  fallback: fallbackBase, label: "🌳 外でスポーツ",                 radiusKm: 25 };
    default:
      return { tags: fallbackBase,       fallback: fallbackBase, label: "スポーツスポット",               radiusKm: 15 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 遠くに行きたい
// ─────────────────────────────────────────────────────────────────────────────
export function getTravelTags(subCategory: TravelSubCategory | null): SubcategoryTagsResult {
  const fallbackBase = ["#遠くに行きたい"];
  switch (subCategory) {
    case "power_spot":
      return { tags: ["#パワースポット"],  fallback: fallbackBase, label: "⛩️ パワースポット・歴史ある場所", radiusKm: 150 };
    case "theme_park":
      return { tags: ["#テーマパーク"],    fallback: fallbackBase, label: "🎡 テーマパーク・別世界",         radiusKm: 150 };
    case "town_walk":
      return { tags: ["#お散歩"],          fallback: fallbackBase, label: "🚶 知らない街をぶらぶら",         radiusKm: 150 };
    case "super_view":
      return { tags: ["#絶景スポット"],    fallback: fallbackBase, label: "🌄 息を呑む絶景・大自然",         radiusKm: 150 };
    default:
      return { tags: fallbackBase,         fallback: fallbackBase, label: "遠くのおでかけスポット",         radiusKm: 150 };
  }
}
