/**
 * FeatureScreen.tsx
 * MoodGo — 特集タブ画面
 *
 * 画面構成
 *   A) エリア選択画面（hasSelectedArea = false）
 *      - 日本地図風の簡易イラスト + 地方ボタン
 *   B) 特集ページ本体（hasSelectedArea = true）
 *      - SegmentedTabs（全国 / 関東 / 神奈川）
 *      - タブごとのコンテンツ
 *
 * データ更新ポイント
 *   - CURRENT_MONTH : 月を変える
 *   - TAB_DATA      : 見出し・説明・画像URLを更新
 *   - IMG           : 画像URLを差し替え（Supabase Storage など）
 *   - REGIONS       : 地方ボタンの追加・変更
 */

import React, { useEffect, useState } from "react";
import {
  Dimensions,
  Image,
  ImageBackground,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { apiFetch } from "@/lib/api";
import {
  Bookmark,
  Building2,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Leaf,
  MapPin,
  Mountain,
  Search,
  Snowflake,
  Sun,
  Waves,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

// ─────────────────────────────────────────────────────────────────────────────
// Design Tokens
// ─────────────────────────────────────────────────────────────────────────────
const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];

const C = {
  accent: "#F26A3D",
  accentLight: "#FFF1EA",
  bg: "#FFFFFF",
  bgSub: "#FAF7F4",
  text: "#222222",
  subText: "#888888",
  border: "#EFE5DF",
  white: "#FFFFFF",
  segBg: "#F0E9E4",
  oceanBlue: "#D5EAF5",
  islandGreen: "#BFDA9F",
};

// ─────────────────────────────────────────────────────────────────────────────
// Config  👇 ここを毎月更新する
// ─────────────────────────────────────────────────────────────────────────────
const CURRENT_MONTH = "6月";

// ─────────────────────────────────────────────────────────────────────────────
// 画像 URL  👇 Supabase Storage や CDN URL に差し替え可能
// ─────────────────────────────────────────────────────────────────────────────
const IMG = {
  fuji:        "https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?w=800&q=80",
  waterfall:   "https://images.unsplash.com/photo-1598935888738-cd2622bcd437?w=800&q=80",
  yokohama:    "https://images.unsplash.com/photo-1524413840807-0c3cb6fa808d?w=800&q=80",
  hydrangea:   "https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=500&q=80",
  cafe:        "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=500&q=80",
  beach:       "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&q=80",
  fireworks:   "https://images.unsplash.com/photo-1498931299472-f7a63a5a1cfa?w=500&q=80",
  tokyo:       "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=500&q=80",
  hiking:      "https://images.unsplash.com/photo-1551632811-561732d1e306?w=500&q=80",
  museum:      "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=500&q=80",
  lunch:       "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=500&q=80",
  kamakura:    "https://images.unsplash.com/photo-1590559899731-a382839e5549?w=500&q=80",
  minatomirai: "https://images.unsplash.com/photo-1476900164809-ff19b8ae5968?w=500&q=80",
  shonan:      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&q=80",
  hakone:      "https://images.unsplash.com/photo-1554602079-b3929e21fc3e?w=500&q=80",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type Tab =
  // 地方
  "全国" | "北海道・東北" | "関東" | "中部" | "近畿" | "中国" | "四国" | "九州・沖縄"
  // 北海道・東北
  | "北海道" | "青森" | "岩手" | "宮城" | "秋田" | "山形" | "福島"
  // 関東
  | "東京" | "神奈川" | "千葉" | "埼玉" | "茨城" | "栃木" | "群馬"
  // 中部
  | "新潟" | "富山" | "石川" | "福井" | "山梨" | "長野" | "岐阜" | "静岡" | "愛知"
  // 近畿
  | "三重" | "滋賀" | "京都" | "大阪" | "兵庫" | "奈良" | "和歌山"
  // 中国
  | "鳥取" | "島根" | "岡山" | "広島" | "山口"
  // 四国
  | "徳島" | "香川" | "愛媛" | "高知"
  // 九州・沖縄
  | "福岡" | "佐賀" | "長崎" | "熊本" | "大分" | "宮崎" | "鹿児島" | "沖縄";

type CardItem = {
  title: string;
  desc: string;
  image: string;
  slug?: string;
};

type HeroData = {
  image: string;
  label: string;
  title: string;
  description: string;
  buttonLabel: string;
  slug?: string;
};

type SectionData = {
  title: string;
  cards: CardItem[];
};

type TabContentData = {
  title: string;
  subtitle: string;
  hero: HeroData;
  categories: string[];
  sections: SectionData[];
  prefectures?: string[];
};

type FeaturedPageRecord = {
  id: string;
  slug: string;
  partner_name: string;
  spot_name: string;
  catch_copy?: string;
  cover_image_url?: string;
  tags: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Tab Content Data  👇 ここを毎月・エリアごとに更新する
// ─────────────────────────────────────────────────────────────────────────────
const TAB_DATA: Record<string, TabContentData> = {
  全国: {
    title: `${CURRENT_MONTH}の全国特集`,
    subtitle: "初夏の風を感じる、おでかけガイド",
    hero: {
      image: IMG.fuji,
      label: "今月のおすすめ",
      title: "梅雨の晴れ間に出かけたい\n絶景スポット",
      description: "自然に囲まれて、気分をリフレッシュできる場所を集めました。",
      buttonLabel: "特集を読む",
    },
    categories: ["🏔️ 絶景", "☕ カフェ", "🚶 おでかけ", "🍽️ グルメ", "☔ 雨の日"],
    sections: [
      {
        title: "今月のおすすめ",
        cards: [
          { title: "初夏を彩る花の名所",    desc: "紫陽花や花畑を楽しむ",   image: IMG.hydrangea },
          { title: "森の中のカフェ時間",    desc: "自然に癒される時間",     image: IMG.cafe },
          { title: "海風を感じるリゾート",  desc: "週末に行きたい海辺",     image: IMG.beach },
          { title: "夜空を彩る花火大会",    desc: "夏の始まりを楽しむ",     image: IMG.fireworks },
        ],
      },
      {
        title: "全国で人気",
        cards: [
          { title: "富士山麓の絶景トレイル", desc: "雄大な景色を楽しむ",    image: IMG.fuji },
          { title: "京都の初夏寺院巡り",    desc: "静かな境内で過ごす",    image: IMG.hydrangea },
          { title: "湘南サンセットカフェ",  desc: "夕暮れを眺める特等席",  image: IMG.shonan },
          { title: "奥日光の自然と湖",      desc: "透き通る水が美しい",    image: IMG.waterfall },
        ],
      },
    ],
  },

  関東: {
    title: `${CURRENT_MONTH}の関東特集`,
    subtitle: "都心も自然も楽しめる、関東エリアへ",
    hero: {
      image: IMG.waterfall,
      label: "今月のおすすめ",
      title: "新緑と水辺に癒される\n初夏の関東さんぽ",
      description: "爽やかな風と緑に包まれて、心が軽くなるおでかけへ。",
      buttonLabel: "特集を読む",
    },
    categories: ["🏔️ 絶景", "☕ カフェ", "🚶 おでかけ", "🍽️ グルメ", "☔ 雨の日"],
    sections: [
      {
        title: "おすすめの特集",
        cards: [
          { title: "都心で楽しむ初夏イベント",    desc: "週末に行きたい街歩き",      image: IMG.tokyo },
          { title: "自然にふれる絶景ハイキング",  desc: "緑に癒される休日",          image: IMG.hiking },
          { title: "雨の日も楽しいミュージアム",  desc: "屋内で過ごす特別な時間",    image: IMG.museum },
          { title: "おしゃれなランチスポット",    desc: "気分が上がるカフェ時間",    image: IMG.lunch },
        ],
      },
    ],
    prefectures: ["東京", "神奈川", "千葉", "埼玉", "茨城", "栃木", "群馬"],
  },

  "北海道・東北": {
    title: `${CURRENT_MONTH}の北海道・東北特集`,
    subtitle: "雄大な自然と食が待つ、北の旅へ",
    hero: {
      image: IMG.waterfall,
      label: "今月のおすすめ",
      title: "北の大地で感じる\n初夏の絶景",
      description: "広大な自然に包まれた、忘れられない旅をしよう。",
      buttonLabel: "特集を読む",
    },
    categories: ["🏔️ 絶景", "🌸 自然", "🍽️ グルメ", "☕ カフェ", "🌊 海"],
    sections: [],
  },

  中部: {
    title: `${CURRENT_MONTH}の中部特集`,
    subtitle: "富士山・アルプス・温泉。中部の魅力を満喫",
    hero: {
      image: IMG.fuji,
      label: "今月のおすすめ",
      title: "富士山麓から\n信州の高原へ",
      description: "日本の真ん中で出会う、絶景と温泉の旅。",
      buttonLabel: "特集を読む",
    },
    categories: ["🏔️ 絶景", "♨️ 温泉", "🍽️ グルメ", "☕ カフェ", "🚶 おでかけ"],
    sections: [],
  },

  近畿: {
    title: `${CURRENT_MONTH}の近畿特集`,
    subtitle: "京都・大阪・奈良。歴史と食の宝庫へ",
    hero: {
      image: IMG.hydrangea,
      label: "今月のおすすめ",
      title: "古都の初夏を歩く\n京都・奈良さんぽ",
      description: "歴史と緑が溶け合う、和の旅へ。",
      buttonLabel: "特集を読む",
    },
    categories: ["🏯 歴史", "☕ カフェ", "🍽️ グルメ", "🌸 自然", "🌃 夜景"],
    sections: [],
  },

  中国: {
    title: `${CURRENT_MONTH}の中国特集`,
    subtitle: "山陰・山陽。穏やかな海と歴史に出会う",
    hero: {
      image: IMG.beach,
      label: "今月のおすすめ",
      title: "瀬戸内の海風と\n広島・島根をめぐる",
      description: "穏やかな海と豊かな歴史が織りなす旅。",
      buttonLabel: "特集を読む",
    },
    categories: ["🌊 海", "🏯 歴史", "🍽️ グルメ", "☕ カフェ", "🌅 絶景"],
    sections: [],
  },

  四国: {
    title: `${CURRENT_MONTH}の四国特集`,
    subtitle: "お遍路・自然・食。四国の魅力を発見",
    hero: {
      image: IMG.hiking,
      label: "今月のおすすめ",
      title: "四国の絶景と\nお遍路さんぽ",
      description: "緑豊かな四国で、心を整える旅へ。",
      buttonLabel: "特集を読む",
    },
    categories: ["🌿 自然", "🏯 歴史", "🍽️ グルメ", "♨️ 温泉", "🌊 海"],
    sections: [],
  },

  "九州・沖縄": {
    title: `${CURRENT_MONTH}の九州・沖縄特集`,
    subtitle: "南国の青い海と温泉。パワフルな旅へ",
    hero: {
      image: IMG.beach,
      label: "今月のおすすめ",
      title: "青い海と空が広がる\n沖縄・九州リゾート",
      description: "南国の風と、豊かな自然に包まれよう。",
      buttonLabel: "特集を読む",
    },
    categories: ["🌊 海", "♨️ 温泉", "🍽️ グルメ", "🌺 自然", "🌅 絶景"],
    sections: [],
  },

  神奈川: {
    title: `神奈川 ${CURRENT_MONTH}の特集`,
    subtitle: "海・山・街並み。魅力あふれる神奈川へ",
    hero: {
      image: IMG.yokohama,
      label: "今月のおすすめ",
      title: "紫陽花が彩る\n鎌倉・横浜をめぐる旅",
      description: "初夏の神奈川で、海と街と自然を楽しもう。",
      buttonLabel: "特集を読む",
    },
    categories: ["🏔️ 絶景", "☕ カフェ", "🚶 おでかけ", "♨️ 温泉", "🍽️ グルメ", "🌃 夜景"],
    sections: [],
  },

  東京: {
    title: `${CURRENT_MONTH}の東京特集`,
    subtitle: "グルメ・カルチャー・夜景。東京の今を楽しむ",
    hero: {
      image: IMG.tokyo,
      label: "今月のおすすめ",
      title: "東京で見つける\n週末の特別な時間",
      description: "街に溶け込みながら、特別な体験を。",
      buttonLabel: "特集を読む",
    },
    categories: ["🏙️ 街歩き", "☕ カフェ", "🍽️ グルメ", "🌃 夜景", "🎨 アート"],
    sections: [],
  },

  千葉: {
    title: `${CURRENT_MONTH}の千葉特集`,
    subtitle: "海・テーマパーク・自然。千葉の魅力へ",
    hero: {
      image: IMG.beach,
      label: "今月のおすすめ",
      title: "千葉の海と空に\n癒されるひとときを",
      description: "東京から近い、非日常のリゾートへ。",
      buttonLabel: "特集を読む",
    },
    categories: ["🌊 海", "🎡 レジャー", "🍽️ グルメ", "☕ カフェ", "🌿 自然"],
    sections: [],
  },

  埼玉: {
    title: `${CURRENT_MONTH}の埼玉特集`,
    subtitle: "川越・秩父・自然。埼玉の魅力を再発見",
    hero: {
      image: IMG.hiking,
      label: "今月のおすすめ",
      title: "小江戸・川越と\n秩父の自然を歩く",
      description: "歴史と自然が共存する、近場の旅へ。",
      buttonLabel: "特集を読む",
    },
    categories: ["🏯 歴史", "🌿 自然", "☕ カフェ", "🍽️ グルメ", "🚶 散歩"],
    sections: [],
  },

  茨城: {
    title: `${CURRENT_MONTH}の茨城特集`,
    subtitle: "海・自然・食。知られざる茨城の魅力",
    hero: {
      image: IMG.waterfall,
      label: "今月のおすすめ",
      title: "袋田の滝と\n大洗の海を旅する",
      description: "広大な自然と新鮮な海の幸を楽しもう。",
      buttonLabel: "特集を読む",
    },
    categories: ["🌊 海", "🌿 自然", "🍽️ グルメ", "🏯 歴史", "☕ カフェ"],
    sections: [],
  },

  栃木: {
    title: `${CURRENT_MONTH}の栃木特集`,
    subtitle: "日光・那須・温泉。栃木の自然と歴史へ",
    hero: {
      image: IMG.fuji,
      label: "今月のおすすめ",
      title: "日光の絶景と\n那須高原の爽やかな風",
      description: "世界遺産と大自然が待つ、栃木の旅へ。",
      buttonLabel: "特集を読む",
    },
    categories: ["🏯 歴史", "♨️ 温泉", "🌿 自然", "🍽️ グルメ", "🌅 絶景"],
    sections: [],
  },

  群馬: {
    title: `${CURRENT_MONTH}の群馬特集`,
    subtitle: "草津・伊香保・自然。温泉王国・群馬へ",
    hero: {
      image: IMG.waterfall,
      label: "今月のおすすめ",
      title: "草津温泉で\n心も体もととのう",
      description: "日本最高峰の温泉地で、ゆったり過ごそう。",
      buttonLabel: "特集を読む",
    },
    categories: ["♨️ 温泉", "🌿 自然", "🍽️ グルメ", "☕ カフェ", "🏔️ 絶景"],
    sections: [],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Region Data  👇 地方ボタンはここで追加・変更
// ─────────────────────────────────────────────────────────────────────────────
// 地方ID → lucide アイコン
const REGION_ICON_MAP: Record<string, LucideIcon> = {
  hokkaido: Snowflake,
  chubu:    Mountain,
  chugoku:  Waves,
  kanto:    Building2,
  kinki:    Landmark,
  shikoku:  Leaf,
  kyushu:   Sun,
};

const REGIONS: { id: string; label: string; tab: Tab }[] = [
  { id: "hokkaido", label: "北海道・東北", tab: "全国" },
  { id: "chubu",    label: "中部",         tab: "全国" },
  { id: "chugoku",  label: "中国",         tab: "全国" },
  { id: "kanto",    label: "関東",         tab: "関東" },
  { id: "kinki",    label: "近畿",         tab: "全国" },
  { id: "shikoku",  label: "四国",         tab: "全国" },
  { id: "kyushu",   label: "九州・沖縄",   tab: "全国" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Dimensions & helpers
// ─────────────────────────────────────────────────────────────────────────────
const { width: W, height: H } = Dimensions.get("window");
const CARD_W   = W * 0.44;
const CARD_H   = CARD_W * 1.22;
const HERO_H   = W * 0.62;
const MAP_W    = W - 48;
const MAP_H    = 230;

const shadow = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 8,
  },
  android: { elevation: 3 },
  default: {},
});

// ─────────────────────────────────────────────────────────────────────────────
// JapanMapWithButtons — 実際の地図画像 + 地方ボタン重ね置き
// ─────────────────────────────────────────────────────────────────────────────

// 画像の元アスペクト比
const IMG_RATIO = 1524 / 1290; // 高さ / 幅（クロップ済み）

type RegionOverlayItem = {
  id: string;
  label: string;
  color: string;
  tab: Tab;
  topPct: number;  // imgH に対する %
  leftPct: number; // imgW に対する %（左端からの位置）
};

const REGION_OVERLAY: RegionOverlayItem[] = [
  { id: "hokkaido", label: "北海道・東北", color: "#5BA8D0", tab: "北海道・東北", topPct:  3, leftPct: 44 },
  { id: "kanto",    label: "関東",         color: "#E8924A", tab: "関東",         topPct: 42, leftPct: 58 },
  { id: "chubu",    label: "中部",         color: "#6DB86D", tab: "中部",         topPct: 48, leftPct: 38 },
  { id: "kinki",    label: "近畿",         color: "#9B7CC8", tab: "近畿",         topPct: 55, leftPct: 16 },
  { id: "chugoku",  label: "中国",         color: "#C9B840", tab: "中国",         topPct: 51, leftPct:  1 },
  { id: "shikoku",  label: "四国",         color: "#3BAAA0", tab: "四国",         topPct: 64, leftPct: 27 },
  { id: "kyushu",   label: "九州・沖縄",   color: "#E07070", tab: "九州・沖縄",   topPct: 71, leftPct:  1 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Region Silhouette Images
// assets/images/region-<id>.png を追加したら require() のコメントを外してください
// ─────────────────────────────────────────────────────────────────────────────
const REGION_BG_IMAGES: Record<string, any> = {
  "hokkaido-tohoku": require("../assets/images/region-hokkaido-tohoku.png"),
  "kanto":    require("../assets/images/region-kanto.png"),
  "chubu":    require("../assets/images/region-chubu.png"),
  "kinki":    require("../assets/images/region-kinki.png"),
  "chugoku":  require("../assets/images/region-chugoku.png"),
  "shikoku":  require("../assets/images/region-shikoku.png"),
  "kyushu":   require("../assets/images/region-kyushu.png"),
};

const TAB_REGION_KEY: Partial<Record<Tab, string>> = {
  "北海道・東北": "hokkaido-tohoku",
  "関東":   "kanto", "東京":   "kanto", "神奈川": "kanto",
  "千葉":   "kanto", "埼玉":   "kanto", "茨城":   "kanto",
  "栃木":   "kanto", "群馬":   "kanto",
  "中部":   "chubu",   "近畿":   "kinki",
  "中国":   "chugoku", "四国":   "shikoku",
  "九州・沖縄": "kyushu",
};

// ─────────────────────────────────────────────────────────────────────────────
// Region → Prefecture mapping
// ─────────────────────────────────────────────────────────────────────────────

const REGION_PREFS: Partial<Record<Tab, Tab[]>> = {
  "北海道・東北": ["北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島"],
  "関東":         ["群馬", "栃木", "茨城", "埼玉", "東京", "千葉", "神奈川"],
  "中部":         ["新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知"],
  "近畿":         ["三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山"],
  "中国":         ["鳥取", "島根", "岡山", "広島", "山口"],
  "四国":         ["徳島", "香川", "愛媛", "高知"],
  "九州・沖縄":   ["福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄"],
};

// 都道府県ごとのデフォルトコンテンツ（API データがない場合に使用）
function defaultPrefTabData(pref: string): TabContentData {
  return {
    title: `${pref} ${CURRENT_MONTH}の特集`,
    subtitle: `${pref}のおすすめスポットをご紹介`,
    hero: {
      image: IMG.fuji,
      label: "今月のおすすめ",
      title: `${pref}で見つける\n素敵なひととき`,
      description: "地元の人も愛する、とっておきのスポットへ。",
      buttonLabel: "特集を読む",
    },
    categories: ["🏔️ 絶景", "☕ カフェ", "🍽️ グルメ", "🚶 おでかけ", "🌿 自然"],
    sections: [],
  };
}

// ── 都道府県の地図上の位置 (画像の W×H に対する %) ──────────────────────────
type PrefOverlayItem = { label: Tab; topPct: number; leftPct: number };

const REGION_PREF_OVERLAY: Partial<Record<Tab, PrefOverlayItem[]>> = {
  "北海道・東北": [
    { label: "北海道", topPct: 20, leftPct: 40 },
    { label: "青森",   topPct: 49, leftPct: 22 },
    { label: "秋田",   topPct: 61, leftPct:  9 },
    { label: "岩手",   topPct: 58, leftPct: 29 },
    { label: "山形",   topPct: 72, leftPct:  9 },
    { label: "宮城",   topPct: 69, leftPct: 29 },
    { label: "福島",   topPct: 82, leftPct: 13 },
  ],
  "関東": [
    { label: "群馬",   topPct: 27, leftPct: 17 },
    { label: "栃木",   topPct: 17, leftPct: 40 },
    { label: "茨城",   topPct: 24, leftPct: 61 },
    { label: "埼玉",   topPct: 43, leftPct: 31 },
    { label: "東京",   topPct: 50, leftPct: 42 },
    { label: "千葉",   topPct: 57, leftPct: 62 },
    { label: "神奈川", topPct: 64, leftPct: 28 },
  ],
  "近畿": [
    { label: "兵庫",   topPct: 27, leftPct: 17 },
    { label: "京都",   topPct: 16, leftPct: 37 },
    { label: "滋賀",   topPct: 23, leftPct: 62 },
    { label: "大阪",   topPct: 46, leftPct: 37 },
    { label: "三重",   topPct: 48, leftPct: 72 },
    { label: "奈良",   topPct: 61, leftPct: 47 },
    { label: "和歌山", topPct: 77, leftPct: 46 },
  ],
  "中部": [
    { label: "新潟",   topPct: 14, leftPct: 63 },
    { label: "富山",   topPct: 31, leftPct: 50 },
    { label: "石川",   topPct: 50, leftPct: 33 },
    { label: "福井",   topPct: 67, leftPct: 33 },
    { label: "長野",   topPct: 47, leftPct: 57 },
    { label: "山梨",   topPct: 56, leftPct: 66 },
    { label: "岐阜",   topPct: 65, leftPct: 46 },
    { label: "静岡",   topPct: 77, leftPct: 60 },
    { label: "愛知",   topPct: 82, leftPct: 45 },
  ],
  "中国": [
    { label: "鳥取",   topPct: 22, leftPct: 73 },
    { label: "島根",   topPct: 30, leftPct: 50 },
    { label: "岡山",   topPct: 42, leftPct: 68 },
    { label: "広島",   topPct: 50, leftPct: 49 },
    { label: "山口",   topPct: 66, leftPct: 16 },
  ],
  "四国": [
    { label: "香川",   topPct: 16, leftPct: 68 },
    { label: "徳島",   topPct: 32, leftPct: 82 },
    { label: "愛媛",   topPct: 38, leftPct: 26 },
    { label: "高知",   topPct: 65, leftPct: 42 },
  ],
  "九州・沖縄": [
    { label: "福岡",   topPct: 13, leftPct: 68 },
    { label: "大分",   topPct: 16, leftPct: 82 },
    { label: "佐賀",   topPct: 21, leftPct: 61 },
    { label: "長崎",   topPct: 26, leftPct: 57 },
    { label: "熊本",   topPct: 31, leftPct: 68 },
    { label: "宮崎",   topPct: 36, leftPct: 79 },
    { label: "鹿児島", topPct: 43, leftPct: 66 },
    { label: "沖縄",   topPct: 62, leftPct: 46 },
  ],
};

// 各地域シルエット画像のネイティブ幅/高比 (width/height)
const REGION_IMG_RATIO: Record<string, number> = {
  "hokkaido-tohoku": 1122 / 1402,
  "kanto":           1254 / 1254,  // square
  "chubu":           1448 / 1086,  // landscape
  "kinki":           1254 / 1254,  // square
  "chugoku":         1448 / 1086,  // landscape
  "shikoku":         1448 / 1086,  // landscape
  "kyushu":          1122 / 1402,  // portrait
};

function RegionPrefSelectView({ region, onSelectPref }: {
  region: Tab;
  onSelectPref: (tab: Tab) => void;
}) {
  const [cW, setCW] = useState(0);
  const [cH, setCH] = useState(0);

  const prefs      = REGION_PREFS[region] ?? [];
  const regionKey  = TAB_REGION_KEY[region];
  const bgImage    = regionKey ? REGION_BG_IMAGES[regionKey] : undefined;
  const overlay    = bgImage ? REGION_PREF_OVERLAY[region] : undefined;
  const nativeRatio = regionKey ? REGION_IMG_RATIO[regionKey] : undefined;

  // 北海道・東北 / 九州・沖縄 (縦長) はそのまま、それ以外は 1.25 倍に拡大
  const imgScale = (regionKey === "hokkaido-tohoku" || regionKey === "kyushu") ? 1.0 : 1.25;

  // contain 配置: 画像の実描画サイズとオフセットを算出
  let imgW = 0, imgH = 0, imgLeft = 0, imgTop = 0;
  if (cW > 0 && cH > 0 && nativeRatio) {
    if (cW / cH < nativeRatio) {
      imgW = cW; imgH = cW / nativeRatio;
    } else {
      imgH = cH; imgW = cH * nativeRatio;
    }
    imgW *= imgScale;
    imgH *= imgScale;
    imgLeft = (cW - imgW) / 2;
    imgTop  = (cH - imgH) / 2;
  }

  const COLS   = 3;
  const GAP    = 10;
  const CELL_W = (W - 40 - GAP * (COLS - 1)) / COLS;

  return (
    <View style={{ flex: 1, backgroundColor: C.bgSub }}>
      {/* グラデーションオーバーレイ (silhouette がある場合のみ) */}
      {bgImage && (
        <LinearGradient
          colors={["rgba(250,247,244,0.28)", "rgba(250,247,244,0.10)", "rgba(250,247,244,0.35)"]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      {/* silhouette なし → japan-map を背景に */}
      {!bgImage && (
        <>
          <Image
            source={require("../assets/images/japan-map.png")}
            style={{ position: "absolute", width: W, height: W * (813 / 632), left: 0, top: 10, opacity: 0.85 }}
            resizeMode="contain"
          />
          <LinearGradient
            colors={["rgba(250,247,244,0.35)", "rgba(250,247,244,0.15)", "rgba(250,247,244,0.45)"]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </>
      )}

      {/* ヘッダー */}
      <View style={s.areaIntro}>
        <View style={s.areaBadge}>
          <Text style={s.areaBadgeText}>{region}</Text>
        </View>
        <Text style={s.areaTitle}>都道府県を選ぶ</Text>
        <Text style={s.areaSubtitle}>気になるエリアをタップ</Text>
      </View>

      {overlay ? (
        // ── 地図オーバーレイ配置 ──
        <View
          style={{ flex: 1, overflow: "visible" }}
          onLayout={(e) => { setCW(e.nativeEvent.layout.width); setCH(e.nativeEvent.layout.height); }}
        >
          {/* シルエット画像 — 中央配置 */}
          {imgW > 0 && (
            <Image
              source={bgImage}
              style={{ position: "absolute", left: imgLeft, top: imgTop, width: imgW, height: imgH }}
              resizeMode="contain"
            />
          )}
          {/* 都道府県ボタン — 地理的位置に配置 */}
          {imgW > 0 && overlay.map((item) => (
            <TouchableOpacity
              key={item.label}
              activeOpacity={0.78}
              onPress={() => onSelectPref(item.label)}
              style={[s.prefOverlayBtn, {
                top:  imgTop  + imgH * (item.topPct  / 100),
                left: imgLeft + imgW * (item.leftPct / 100),
              }]}
            >
              <Text style={s.prefOverlayBtnText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        // ── フォールバック: グリッド ──
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.regionPrefGrid}>
          {prefs.map((pref) => (
            <TouchableOpacity
              key={pref}
              style={[s.regionPrefCard, { width: CELL_W }]}
              onPress={() => onSelectPref(pref)}
              activeOpacity={0.75}
            >
              <MapPin size={20} color={C.accent} strokeWidth={2} />
              <Text style={s.regionPrefLabel}>{pref}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function JapanMapWithButtons({ onSelectRegion }: { onSelectRegion: (tab: Tab) => void }) {
  const [cW, setCW] = useState(0);
  const [cH, setCH] = useState(0);

  // コンテナ内で "contain" したときの実際の画像描画サイズとオフセットを計算
  const scale   = cW > 0 && cH > 0 ? Math.min(cW / 632, cH / 813) : 0;
  const imgW    = 632 * scale;
  const imgH    = 813 * scale;
  const offsetX = (cW - imgW) / 2;
  const offsetY = (cH - imgH) / 2;

  return (
    <View
      style={{ flex: 1 }}
      onLayout={(e) => {
        setCW(e.nativeEvent.layout.width);
        setCH(e.nativeEvent.layout.height);
      }}
    >
      {scale > 0 && (
        <>
          {/* 日本地図メイン */}
          <Image
            source={require("../assets/images/japan-map.png")}
            style={{ position: "absolute", left: offsetX, top: offsetY, width: imgW, height: imgH }}
            resizeMode="contain"
          />

          {/* エリアボタン — 画像座標系で配置 */}
          {REGION_OVERLAY.map((r) => {
            const btnTop  = offsetY + imgH * (r.topPct  / 100);
            const btnLeft = offsetX + imgW * (r.leftPct / 100);
            return (
              <TouchableOpacity
                key={r.id}
                activeOpacity={0.75}
                onPress={() => onSelectRegion(r.tab)}
                style={[s.mapRegionBtn, { top: btnTop, left: btnLeft }]}
              >
                {/* カラードット */}
                <View style={[s.mapRegionDot, { backgroundColor: r.color }]} />
                {(() => { const Icon = REGION_ICON_MAP[r.id]; return Icon ? <Icon size={12} color={r.color} strokeWidth={2} /> : null; })()}
                <Text style={s.mapRegionLabel}>{r.label}</Text>
                <ChevronRight size={11} color={r.color} strokeWidth={2.8} />
              </TouchableOpacity>
            );
          })}
        </>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RegionButton
// ─────────────────────────────────────────────────────────────────────────────
type RegionButtonProps = {
  id: string;
  label: string;
  color: string;
  onPress: () => void;
};

function RegionButton({ id, label, color, onPress }: RegionButtonProps) {
  const Icon = REGION_ICON_MAP[id] ?? MapPin;
  return (
    <TouchableOpacity style={s.regionBtn} onPress={onPress} activeOpacity={0.72}>
      <Icon size={15} color={color} strokeWidth={2} />
      <Text style={s.regionLabel}>{label}</Text>
      <ChevronRight size={16} color={C.subText} />
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AreaSelectView
// ─────────────────────────────────────────────────────────────────────────────
type AreaSelectViewProps = { onSelectRegion: (tab: Tab) => void };

function AreaSelectView({ onSelectRegion }: AreaSelectViewProps) {
  return (
    <View style={{ flex: 1, backgroundColor: '#F8F6FF' }}>
      <View style={s.areaIntro}>
        <Text style={s.areaSubtitle}>エリアをタップして特集を見る</Text>
      </View>

      {/* 地図画像 + 重ね置きボタン（残りスペースをすべて使う） */}
      <JapanMapWithButtons onSelectRegion={onSelectRegion} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SegmentedTabs
// ─────────────────────────────────────────────────────────────────────────────
type SegmentedTabsProps = {
  tabs: Tab[];
  selected: Tab;
  onSelect: (t: Tab) => void;
};

function SegmentedTabs({ tabs, selected, onSelect }: SegmentedTabsProps) {
  return (
    <View style={s.segOuter}>
      <View style={s.segWrap}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t}
            style={[s.segTab, selected === t && s.segTabActive]}
            onPress={() => onSelect(t)}
            activeOpacity={0.8}
          >
            <Text style={[s.segTabText, selected === t && s.segTabTextActive]}>
              {t}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HeroFeatureCard
// ─────────────────────────────────────────────────────────────────────────────
function HeroFeatureCard({ data }: { data: HeroData }) {
  const router = useRouter();
  return (
    <View style={s.heroWrap}>
      <ImageBackground
        source={{ uri: data.image }}
        style={s.heroBg}
        imageStyle={s.heroBgImg}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["rgba(0,0,0,0.0)", "rgba(0,0,0,0.72)"]}
          locations={[0.18, 1.0]}
          style={s.heroGrad}
        >
          <View style={s.heroLabelBadge}>
            <Text style={s.heroLabelText}>{data.label}</Text>
          </View>
          <Text style={s.heroTitle}>{data.title}</Text>
          <Text style={s.heroDesc}>{data.description}</Text>
          <View style={s.heroFooter}>
            <TouchableOpacity
              style={s.heroBtn}
              activeOpacity={0.85}
              onPress={() => data.slug && router.push(`/feature/${data.slug}`)}
            >
              <Text style={s.heroBtnText}>{data.buttonLabel}</Text>
              <ChevronRight size={14} color={C.white} />
            </TouchableOpacity>
            <TouchableOpacity style={s.heroBookmark} activeOpacity={0.75}>
              <Bookmark size={18} color={C.white} />
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </ImageBackground>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CategoryChips
// ─────────────────────────────────────────────────────────────────────────────
function CategoryChips({ categories }: { categories: string[] }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.chipsContent}
      style={s.chipsScroll}
    >
      {categories.map((c) => {
        const on = active === c;
        return (
          <TouchableOpacity
            key={c}
            style={[s.chip, on && s.chipActive]}
            onPress={() => setActive(on ? null : c)}
            activeOpacity={0.72}
          >
            <Text style={[s.chipText, on && s.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HorizontalFeatureCards
// ─────────────────────────────────────────────────────────────────────────────
function HorizontalFeatureCards({ title, cards }: { title: string; cards: CardItem[] }) {
  const router = useRouter();
  return (
    <View style={s.hSection}>
      <View style={s.hSectionHead}>
        <Text style={s.hSectionTitle}>{title}</Text>
        <TouchableOpacity style={s.seeAllRow} activeOpacity={0.72}>
          <Text style={s.seeAllText}>すべて見る</Text>
          <ChevronRight size={13} color={C.accent} />
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.hCardsContent}
      >
        {cards.map((item, i) => (
          <TouchableOpacity
            key={i}
            style={[s.hCard, i < cards.length - 1 && { marginRight: 12 }]}
            activeOpacity={0.84}
            onPress={() => item.slug && router.push(`/feature/${item.slug}`)}
          >
            <ImageBackground
              source={{ uri: item.image }}
              style={s.hCardBg}
              imageStyle={s.hCardBgImg}
              resizeMode="cover"
            >
              <LinearGradient
                colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.64)"]}
                locations={[0.28, 1.0]}
                style={s.hCardGrad}
              >
                <Text style={s.hCardTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={s.hCardDesc} numberOfLines={1}>{item.desc}</Text>
              </LinearGradient>
            </ImageBackground>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PrefectureGrid
// ─────────────────────────────────────────────────────────────────────────────
type PrefectureGridProps = {
  prefectures: string[];
  onSelectPref: (pref: string) => void;
};

function PrefectureGrid({ prefectures, onSelectPref }: PrefectureGridProps) {
  const COL = 3;
  const GUTTER = 10;
  const ITEM_W = (W - 40 - GUTTER * (COL - 1)) / COL;

  return (
    <View style={s.prefSection}>
      <Text style={s.prefTitle}>エリアを選ぶ（都県）</Text>
      <View style={s.prefGrid}>
        {prefectures.map((p, i) => (
          <TouchableOpacity
            key={p}
            style={[
              s.prefCard,
              { width: ITEM_W },
              i % COL !== COL - 1 && { marginRight: GUTTER },
              i < prefectures.length - COL && { marginBottom: GUTTER },
            ]}
            onPress={() => onSelectPref(p)}
            activeOpacity={0.72}
          >
            <MapPin size={16} color={C.accent} strokeWidth={2} />
            <Text style={s.prefName}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FeatureContentView
// ─────────────────────────────────────────────────────────────────────────────
type FeatureContentViewProps = {
  selectedTab: Tab;
  selectedRegion: Tab;
  apiTabData: Partial<Record<Tab, TabContentData>>;
};

function FeatureContentView({ selectedTab, selectedRegion, apiTabData }: FeatureContentViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>(selectedTab);

  useEffect(() => { setActiveTab(selectedTab); }, [selectedTab]);

  // 全国 / 地方 / 都道府県 の3タブ（重複排除）
  const tabs = Array.from(new Set<Tab>(["全国", selectedRegion, selectedTab]));

  const data = apiTabData[activeTab] ?? TAB_DATA[activeTab] ?? defaultPrefTabData(activeTab);
  const regionImg = REGION_BG_IMAGES[TAB_REGION_KEY[activeTab] ?? ""];

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={s.contentScroll}
    >
      {/* ── エリア切替タブ ── */}
      <SegmentedTabs tabs={tabs} selected={activeTab} onSelect={setActiveTab} />

      {/* 見出し */}
      <View style={s.contentHeader}>
        {regionImg && (
          <Image
            source={regionImg}
            style={s.contentHeaderBgImg}
            resizeMode="contain"
          />
        )}
        <Text style={s.contentTitle}>{data.title}</Text>
        <Text style={s.contentSubtitle}>{data.subtitle}</Text>
      </View>

      {/* ヒーローカード */}
      <HeroFeatureCard data={data.hero} />

      {/* カテゴリチップ */}
      <CategoryChips categories={data.categories} />

      {/* セクション（横スクロールカード群） */}
      {data.sections.map((sec, i) => (
        <HorizontalFeatureCards key={i} title={sec.title} cards={sec.cards} />
      ))}

      {/* 都県グリッド */}
      {data.prefectures && (
        <PrefectureGrid
          prefectures={data.prefectures}
          onSelectPref={() => {}}
        />
      )}

      <View style={{ height: 28 }} />
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FeatureScreen  ← デフォルトエクスポート
// 親（index.tsx）の TabBar・SafeAreaView に内包されるため
// 自前のタブバー・SafeAreaView は持たない
// ─────────────────────────────────────────────────────────────────────────────
function buildTabData(records: FeaturedPageRecord[]): Partial<Record<Tab, TabContentData>> {
  const TABS: Tab[] = [
    "全国", "北海道・東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄",
    "北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島",
    "東京", "神奈川", "千葉", "埼玉", "茨城", "栃木", "群馬",
    "新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知",
    "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山",
    "鳥取", "島根", "岡山", "広島", "山口",
    "徳島", "香川", "愛媛", "高知",
    "福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
  ];
  const grouped = Object.fromEntries(TABS.map(t => [t, []])) as unknown as Record<Tab, FeaturedPageRecord[]>;

  for (const rec of records) {
    const matched = TABS.filter((t) => rec.tags.includes(t));
    if (matched.length === 0) {
      grouped["全国"].push(rec);
    } else {
      matched.forEach((t) => grouped[t].push(rec));
    }
  }

  const result: Partial<Record<Tab, TabContentData>> = {};
  for (const tab of TABS) {
    const recs = grouped[tab];
    if (!recs.length) continue;
    const [first, ...rest] = recs;
    result[tab] = {
      title: TAB_DATA[tab].title,
      subtitle: TAB_DATA[tab].subtitle,
      hero: {
        image: first.cover_image_url ?? IMG.fuji,
        label: first.partner_name || "今月のおすすめ",
        title: first.spot_name,
        description: first.catch_copy ?? "",
        buttonLabel: "特集を読む",
        slug: first.slug,
      },
      categories: TAB_DATA[tab].categories,
      sections: rest.length
        ? [{ title: "今月のおすすめ店舗", cards: rest.map((r) => ({
            title: r.spot_name,
            desc: r.catch_copy ?? "",
            image: r.cover_image_url ?? IMG.cafe,
            slug: r.slug,
          })) }]
        : [],
      prefectures: TAB_DATA[tab].prefectures,
    };
  }
  return result;
}

type NavStage = "map" | "pref-select" | "content";

export default function FeatureScreen() {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<NavStage>("map");
  const [selectedRegion, setSelectedRegion] = useState<Tab>("全国");
  const [selectedTab, setSelectedTab] = useState<Tab>("全国");
  const [apiTabData, setApiTabData] = useState<Partial<Record<Tab, TabContentData>>>({});

  useEffect(() => {
    apiFetch("/api/featured")
      .then((r) => r.json())
      .then(({ ok, data }: { ok: boolean; data: FeaturedPageRecord[] }) => {
        if (ok && data?.length) setApiTabData(buildTabData(data));
      })
      .catch(() => {});
  }, []);

  const handleSelectRegion = (tab: Tab) => {
    setSelectedRegion(tab);
    setSelectedTab(tab);
    setStage("pref-select");
  };

  const handleSelectPref = (tab: Tab) => {
    setSelectedTab(tab);
    setStage("content");
  };

  const handleBack = () => {
    if (stage === "content") {
      setStage("pref-select");
    } else {
      setStage("map");
    }
  };

  const showBack = stage !== "map";

  return (
    <View style={s.safe}>
      {/* ── グラデーションヘッダー ── */}
      <LinearGradient
        colors={GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.header, { paddingTop: insets.top + 14 }]}
      >
        <View style={s.decoCircle1} pointerEvents="none" />
        <View style={s.decoCircle2} pointerEvents="none" />
        <View style={s.headerContent}>
          {showBack ? (
            <TouchableOpacity
              style={s.backBtn}
              activeOpacity={0.72}
              onPress={handleBack}
            >
              <ChevronLeft size={20} color="#fff" strokeWidth={2.5} />
              <Text style={s.backText}>特集</Text>
            </TouchableOpacity>
          ) : (
            <View>
              <Text style={s.headerTitle}>特集</Text>
              <Text style={s.headerSub}>どこへ行く？</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* ── メインコンテンツ ── */}
      <View style={{ flex: 1 }}>
        {stage === "map" && (
          <AreaSelectView onSelectRegion={handleSelectRegion} />
        )}
        {stage === "pref-select" && (
          <RegionPrefSelectView region={selectedRegion} onSelectPref={handleSelectPref} />
        )}
        {stage === "content" && (
          <FeatureContentView
            selectedTab={selectedTab}
            selectedRegion={selectedRegion}
            apiTabData={apiTabData}
          />
        )}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  // ── Header ──
  header: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    overflow: 'hidden',
  },
  decoCircle1: {
    position: 'absolute',
    top: -30,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  decoCircle2: {
    position: 'absolute',
    top: 40,
    right: 40,
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  headerSub: {
    fontSize: 14,
    color: "rgba(255,255,255,0.85)",
    fontWeight: '500',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  // ── PrefOverlayBtn (地図上の都道府県ボタン) ──
  prefOverlayBtn: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.93)",
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 0.5,
    borderColor: "rgba(0,0,0,0.08)",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.13, shadowRadius: 6 },
      android: { elevation: 3 },
    }),
  },
  prefOverlayBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1C1C1E",
    letterSpacing: -0.2,
  },

  // ── RegionPrefSelectView ──
  regionPrefGrid: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  regionPrefCard: {
    backgroundColor: C.white,
    borderRadius: 18,
    paddingVertical: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: C.border,
    ...shadow,
  },
  regionPrefLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: C.text,
    letterSpacing: -0.3,
  },

  // ── AreaSelectView ──
  areaScroll: { paddingBottom: 48 },
  areaIntro: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 2,
  },
  areaBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FFF0EA",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "#FFD9C8",
  },
  areaBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: C.accent,
    letterSpacing: 0.2,
  },
  areaTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.7,
    marginBottom: 2,
  },
  areaSubtitle: {
    fontSize: 12,
    color: C.subText,
    lineHeight: 17,
  },

  // ── Japan Map ──
  mapOuter: {
    alignItems: "center",
    marginTop: 20,
    marginBottom: 24,
  },
  mapOcean: {
    width: MAP_W,
    height: MAP_H,
    backgroundColor: C.oceanBlue,
    borderRadius: 22,
    position: "relative",
    overflow: "hidden",
    ...shadow,
  },
  mapLabel: {
    marginTop: 10,
    fontSize: 13,
    color: C.subText,
    fontWeight: "500",
  },
  isle: {
    position: "absolute",
    backgroundColor: C.islandGreen,
    borderRadius: 10,
  },
  // 北海道
  hokkaido: {
    top: 14, right: 34,
    width: 68, height: 48,
    borderRadius: 14,
    backgroundColor: "#B5D48E",
    transform: [{ rotate: "-10deg" }],
  },
  // 東北
  tohoku: {
    top: 54, right: 72,
    width: 20, height: 68,
    borderRadius: 8,
    backgroundColor: "#C2D99A",
    transform: [{ rotate: "6deg" }],
  },
  // 関東〜中部
  kanto: {
    top: 84, right: 26,
    width: 100, height: 42,
    borderRadius: 11,
    backgroundColor: "#BFDA9F",
    transform: [{ rotate: "-5deg" }],
  },
  // 近畿〜中国
  kinki: {
    top: 118, left: 52,
    width: 118, height: 34,
    borderRadius: 10,
    backgroundColor: "#CAE0A6",
    transform: [{ rotate: "-9deg" }],
  },
  // 四国
  shikoku: {
    top: 158, left: 72,
    width: 64, height: 22,
    borderRadius: 7,
    backgroundColor: "#D4E8B2",
    transform: [{ rotate: "-4deg" }],
  },
  // 九州
  kyushu: {
    top: 160, left: 22,
    width: 52, height: 56,
    borderRadius: 14,
    backgroundColor: "#B5D48E",
    transform: [{ rotate: "-3deg" }],
  },
  // 沖縄
  okinawa: {
    bottom: 18, left: 12,
    width: 20, height: 8,
    borderRadius: 4,
    backgroundColor: "#9BD4E8",
  },
  // 波紋
  mapRipple1: {
    position: "absolute",
    bottom: 12, right: 12,
    width: 36, height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.4)",
  },
  mapRipple2: {
    position: "absolute",
    bottom: 6, right: 6,
    width: 52, height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },

  // ── Map Region Overlay Buttons ──
  mapRegionBtn: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.97)",
    borderRadius: 26,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 7,
    borderWidth: 0.5,
    borderColor: "rgba(0,0,0,0.07)",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.14,
        shadowRadius: 10,
      },
      android: { elevation: 5 },
    }),
  },
  mapRegionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  mapRegionEmoji: { fontSize: 13 },
  mapRegionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1C1C1E",
    letterSpacing: -0.3,
  },

  // ── Region Buttons (legacy list — 未使用) ──
  regionList: {
    paddingHorizontal: 20,
  },
  regionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.white,
    borderRadius: 14,
    paddingVertical: 15,
    paddingHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
    ...shadow,
  },
  regionEmoji: { fontSize: 20, marginRight: 12 },
  regionLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: C.text,
  },

  // ── SegmentedTabs ──
  segOuter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: C.bg,
  },
  segWrap: {
    flexDirection: "row",
    backgroundColor: C.segBg,
    borderRadius: 13,
    padding: 3,
  },
  segTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 10,
  },
  segTabActive: {
    backgroundColor: C.white,
    ...shadow,
  },
  segTabText: {
    fontSize: 14,
    fontWeight: "500",
    color: C.subText,
  },
  segTabTextActive: {
    color: C.accent,
    fontWeight: "700",
  },

  // ── FeatureContentView ──
  contentScroll: { paddingBottom: 16 },
  contentHeader: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    overflow: "hidden",
  },
  contentHeaderBgImg: {
    position: "absolute",
    right: -30,
    top: -30,
    width: 220,
    height: 220,
    opacity: 0.14,
  },
  contentTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  contentSubtitle: {
    fontSize: 13,
    color: C.subText,
    lineHeight: 18,
  },

  // ── HeroFeatureCard ──
  heroWrap: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 22,
    overflow: "hidden",
    ...shadow,
  },
  heroBg: { height: HERO_H, justifyContent: "flex-end" },
  heroBgImg: { borderRadius: 22 },
  heroGrad: {
    flex: 1,
    borderRadius: 22,
    padding: 18,
    paddingTop: 48,
    justifyContent: "flex-end",
  },
  heroLabelBadge: {
    alignSelf: "flex-start",
    backgroundColor: C.accent,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  heroLabelText: {
    fontSize: 11,
    fontWeight: "700",
    color: C.white,
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: C.white,
    lineHeight: 30,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  heroDesc: {
    fontSize: 13,
    color: "rgba(255,255,255,0.82)",
    lineHeight: 18,
    marginBottom: 16,
  },
  heroFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 22,
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
  },
  heroBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: C.white,
    marginRight: 4,
  },
  heroBookmark: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.36)",
  },

  // ── CategoryChips ──
  chipsScroll: { marginBottom: 4 },
  chipsContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chip: {
    backgroundColor: C.white,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
    borderWidth: 1,
    borderColor: C.border,
    ...shadow,
  },
  chipActive: {
    backgroundColor: C.accentLight,
    borderColor: C.accent,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    color: C.text,
  },
  chipTextActive: {
    color: C.accent,
    fontWeight: "700",
  },

  // ── HorizontalFeatureCards ──
  hSection: { marginTop: 8, marginBottom: 8 },
  hSectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 12,
    marginTop: 6,
  },
  hSectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: C.text,
  },
  seeAllRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  seeAllText: {
    fontSize: 13,
    color: C.accent,
    fontWeight: "500",
  },
  hCardsContent: { paddingHorizontal: 16 },
  hCard: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 16,
    overflow: "hidden",
    ...shadow,
  },
  hCardBg: { flex: 1, justifyContent: "flex-end" },
  hCardBgImg: { borderRadius: 16 },
  hCardGrad: {
    flex: 1,
    borderRadius: 16,
    justifyContent: "flex-end",
    padding: 12,
  },
  hCardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: C.white,
    lineHeight: 18,
    marginBottom: 3,
  },
  hCardDesc: {
    fontSize: 11,
    color: "rgba(255,255,255,0.78)",
  },

  // ── PrefectureGrid ──
  prefSection: {
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
  },
  prefTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: C.text,
    marginTop: 8,
    marginBottom: 14,
  },
  prefGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  prefCard: {
    backgroundColor: C.white,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    ...shadow,
  },
  prefEmoji: { fontSize: 22, marginBottom: 6 },
  prefName: {
    fontSize: 12,
    fontWeight: "600",
    color: C.text,
  },

});
