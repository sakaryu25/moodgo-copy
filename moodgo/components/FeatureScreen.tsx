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

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  ImageBackground,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image as ExpoImage } from "expo-image";
import { Asset } from "expo-asset";
import Svg, { Defs, RadialGradient, Stop, Circle } from "react-native-svg";
import { useRouter } from "expo-router";
import { apiFetch } from "@/lib/api";
import { HERO_BAND_H } from "@/lib/headerBand";
import { useTabReset } from "@/lib/useTabReset";
import { useSettings } from "@/lib/settingsStore";

// ── 地図画像（assets/images）。アプリ全体で事前読み込みして遅延表示を防ぐ ──────
const JAPAN_MAP = require("../assets/images/japan-map.png");
export const MAP_ASSETS = [
  JAPAN_MAP,
  require("../assets/images/region-hokkaido-tohoku.png"),
  require("../assets/images/region-kanto.png"),
  require("../assets/images/region-chubu.png"),
  require("../assets/images/region-kinki.png"),
  require("../assets/images/region-chugoku.png"),
  require("../assets/images/region-shikoku.png"),
  require("../assets/images/region-kyushu.png"),
];
// 一度だけ事前読み込み（デコード）するためのキャッシュ済みPromise
let _mapPreload: Promise<unknown> | null = null;
export function preloadMaps() {
  if (!_mapPreload) _mapPreload = Asset.loadAsync(MAP_ASSETS).catch(() => {});
  return _mapPreload;
}
import {
  Bookmark,
  Building2,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Droplets,
  Footprints,
  Landmark,
  Leaf,
  MapPin,
  Moon,
  Mountain,
  Palette,
  Search,
  Snowflake,
  Sparkles,
  Sun,
  Ticket,
  Umbrella,
  Utensils,
  Waves,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { SAMPLE_FEATURE, type SampleTab } from "./featureSampleData";
import PuniPressable from "./PuniPressable";

// ─────────────────────────────────────────────────────────────────────────────
// Design Tokens
// ─────────────────────────────────────────────────────────────────────────────
const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];

// 記事感を出すための明朝系フォント（OS標準。Webフォント読み込み不要）
const SERIF = Platform.select({ ios: "Hiragino Mincho ProN", android: "serif", default: "serif" });

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
  spotId?: string;   // システムB スポット詳細への直リンク
};

type HeroData = {
  image: string;
  label: string;
  title: string;
  description: string;
  buttonLabel: string;
  slug?: string;
  spotId?: string;
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

// システムB（featured_pages_v2 / _moods / _spots）— アプリの特集データ源
type MoodV2 = {
  id: string;
  title: string;
  icon_name?: string;
  icon_color?: string;
  bg_color?: string;
};
type SpotV2 = {
  id: string;
  title: string;
  shop_name?: string;
  location?: string;
  catch_copy?: string;
  description?: string;
  image_url?: string;
  gallery_image_urls?: string[];
  tags?: string[];
  features?: string[];
  menu_items?: { name?: string; price?: string }[];
  events?: { title?: string; start_date?: string; end_date?: string }[];
  hours?: Record<string, { open?: string; close?: string; closed?: boolean } | string | undefined>;
};
export type FeaturedPageV2 = {
  id: string;
  prefecture: string;
  issue?: string;
  label?: string;
  banner_title?: string;
  banner_description?: string;
  banner_image_url?: string;
  is_active?: boolean;
  sort_order?: number;
  // scope/掲載位置/公開期間（supabase/featured-scope-placement.sql 適用後に付与。未適用DBでは undefined）
  scope_type?: "prefecture" | "region" | "nationwide";
  scope_key?: string;      // 日本語キー: 神奈川 / 関東 / 全国 など
  slot_type?: "hero" | "sub_1" | "sub_2" | "normal" | "hidden";
  featured_page_moods?: MoodV2[];
  featured_page_spots?: SpotV2[];
};

// 特集TOPの「人気エリア」カード（/api/popular-areas）
type PopularArea = {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  scope_type?: string;
  scope_key?: string;
  destination_type?: "pref" | "feature" | "url";
  destination_value?: string;
  sort_order?: number;
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

// 都道府県 → 所属地方（REGION_PREFS の逆引き。スコープタブ「県/地方/全国」の地方名決定に使う）
const PREF_TO_REGION: Partial<Record<Tab, Tab>> = (() => {
  const m: Partial<Record<Tab, Tab>> = {};
  for (const [region, prefs] of Object.entries(REGION_PREFS) as [Tab, Tab[]][]) {
    for (const p of prefs) m[p] = region;
  }
  return m;
})();

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

// ── タブのベースコンテンツ取得 ───────────────────────────────────────────────
// 優先度: 仮サンプル(SAMPLE_FEATURE) → 手書きTAB_DATA → 県デフォルト
// 全国/地方/各県すべてで「常に中身のある」特集ページを返す。
const DEFAULT_CATS = ["🏔️ 絶景", "☕ カフェ", "🍽️ グルメ", "🚶 おでかけ", "🌿 自然"];

function sampleTitle(tab: Tab): string {
  if (tab === "全国") return `${CURRENT_MONTH}の全国特集`;
  if (REGION_PREFS[tab]) return `${CURRENT_MONTH}の${tab}特集`;
  return `${tab} ${CURRENT_MONTH}の特集`;
}

function getBaseTab(tab: Tab): TabContentData {
  const smp: SampleTab | undefined = SAMPLE_FEATURE[tab];
  const td = TAB_DATA[tab];
  if (smp) {
    return {
      title: td?.title ?? sampleTitle(tab),
      subtitle: smp.subtitle ?? td?.subtitle ?? smp.heroDesc,
      hero: {
        image: smp.heroImage,
        label: smp.heroLabel ?? "今月のおすすめ",
        title: smp.heroTitle,
        description: smp.heroDesc,
        buttonLabel: "特集を読む",
      },
      categories: td?.categories ?? DEFAULT_CATS,
      sections: smp.sections,
      prefectures: td?.prefectures ?? REGION_PREFS[tab],
    };
  }
  return td ?? defaultPrefTabData(tab);
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
          <ExpoImage
            source={JAPAN_MAP}
            style={{ position: "absolute", width: W, height: W * (813 / 632), left: 0, top: 10, opacity: 0.85 }}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
          <LinearGradient
            colors={["rgba(250,247,244,0.35)", "rgba(250,247,244,0.15)", "rgba(250,247,244,0.45)"]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </>
      )}

      {/* 見出し(地方バッジ/都道府県を選ぶ/説明)はグラデヘッダー内へ移設済み */}

      {overlay ? (
        // ── 地図オーバーレイ配置 ──
        <View
          style={{ flex: 1, overflow: "visible" }}
          onLayout={(e) => { setCW(e.nativeEvent.layout.width); setCH(e.nativeEvent.layout.height); }}
        >
          {/* シルエット画像 — 中央配置 */}
          {imgW > 0 && (
            <ExpoImage
              source={bgImage}
              style={{ position: "absolute", left: imgLeft, top: imgTop, width: imgW, height: imgH }}
              contentFit="contain"
              cachePolicy="memory-disk"
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
  // 地図画像の事前読み込み（デコード）完了を待ってから表示 → ボタンと地図を同時に出す
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => { let m = true; preloadMaps().then(() => { if (m) setMapReady(true); }); return () => { m = false; }; }, []);

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
      {/* 読込中スケルトン（地図デコード前の空白を防ぐ）*/}
      {scale > 0 && !mapReady && (
        <View style={{ position: "absolute", left: offsetX, top: offsetY, width: imgW, height: imgH, borderRadius: 16, backgroundColor: "rgba(155,107,255,0.06)", alignItems: "center", justifyContent: "center" }}>
          <ExpoImage source={JAPAN_MAP} style={{ width: imgW * 0.7, height: imgH * 0.7, opacity: 0.15 }} contentFit="contain" />
        </View>
      )}
      {scale > 0 && mapReady && (
        <>
          {/* 日本地図メイン（expo-image: 事前読込済みキャッシュから即表示）*/}
          <ExpoImage
            source={JAPAN_MAP}
            style={{ position: "absolute", left: offsetX, top: offsetY, width: imgW, height: imgH }}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={150}
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
                style={[s.mapRegionBtn, { top: btnTop, left: btnLeft, shadowColor: r.color, shadowOpacity: 0.45, shadowRadius: 11 }]}
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
    <PuniPressable style={s.regionBtn} onPress={onPress}>
      <Icon size={15} color={color} strokeWidth={2} />
      <Text style={s.regionLabel}>{label}</Text>
      <ChevronRight size={16} color={C.subText} />
    </PuniPressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AreaSelectView
// ─────────────────────────────────────────────────────────────────────────────
type AreaSelectViewProps = { onSelectRegion: (tab: Tab) => void };

function AreaSelectView({ onSelectRegion }: AreaSelectViewProps) {
  return (
    <View style={{ flex: 1, backgroundColor: '#F8F6FF' }}>
      {/* 導入(バッジ/どこへ行く？/説明)はグラデヘッダー内へ移設済み。白エリアは地図に全振り */}
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
export function openSpot(router: ReturnType<typeof useRouter>, opts: { spotId?: string; slug?: string; title: string; area?: string; desc?: string; image?: string }) {
  if (opts.spotId) { router.push(`/feature/spot/${opts.spotId}`); return; }
  if (opts.slug) { router.push(`/feature/${opts.slug}`); return; }
  router.push({
    pathname: "/feature-spot",
    params: { name: opts.title, area: opts.area ?? "", desc: opts.desc ?? "", image: opts.image ?? "" },
  });
}

function HeroFeatureCard({ data, area }: { data: HeroData; area?: string }) {
  const router = useRouter();
  const go = () => openSpot(router, { spotId: data.spotId, slug: data.slug, title: data.title, area, desc: data.description, image: data.image });
  return (
    <TouchableOpacity style={s.heroWrap} activeOpacity={0.9} onPress={go}>
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
            <View style={s.heroBtn}>
              <Text style={s.heroBtnText}>{data.buttonLabel}</Text>
              <ChevronRight size={14} color={C.white} />
            </View>
            <TouchableOpacity style={s.heroBookmark} activeOpacity={0.75}>
              <Bookmark size={18} color={C.white} />
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </ImageBackground>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CategoryChips（絵文字は使わず lucide アイコンで描画）
// ─────────────────────────────────────────────────────────────────────────────
// カテゴリ名キーワード → アイコン
const CAT_ICON_MAP: { kw: string; Icon: LucideIcon }[] = [
  { kw: "絶景", Icon: Mountain },
  { kw: "カフェ", Icon: Coffee },
  { kw: "おでかけ", Icon: Footprints },
  { kw: "散歩", Icon: Footprints },
  { kw: "街歩き", Icon: Building2 },
  { kw: "街", Icon: Building2 },
  { kw: "グルメ", Icon: Utensils },
  { kw: "雨", Icon: Umbrella },
  { kw: "温泉", Icon: Droplets },
  { kw: "海", Icon: Waves },
  { kw: "歴史", Icon: Landmark },
  { kw: "夜景", Icon: Moon },
  { kw: "アート", Icon: Palette },
  { kw: "レジャー", Icon: Ticket },
  { kw: "自然", Icon: Leaf },
  { kw: "花火", Icon: Sparkles },
  { kw: "雪", Icon: Snowflake },
  { kw: "写真", Icon: Camera },
];

// 絵文字・変異セレクタを除去してラベルを取り出す
function parseCategory(c: string): { label: string; Icon: LucideIcon } {
  const label = c
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{2600}-\u{26FF}]/gu, "")
    .trim();
  const found = CAT_ICON_MAP.find((m) => label.includes(m.kw));
  return { label, Icon: found?.Icon ?? MapPin };
}

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
        const { label, Icon } = parseCategory(c);
        return (
          <TouchableOpacity
            key={c}
            style={[s.chip, on && s.chipActive]}
            onPress={() => setActive(on ? null : c)}
            activeOpacity={0.72}
          >
            <Icon size={14} color={on ? C.accent : C.subText} strokeWidth={2.2} />
            <Text style={[s.chipText, on && s.chipTextActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HorizontalFeatureCards
// ─────────────────────────────────────────────────────────────────────────────
function HorizontalFeatureCards({ title, cards, area }: { title: string; cards: CardItem[]; area?: string }) {
  const router = useRouter();
  return (
    <View style={s.hSection}>
      <View style={s.hSectionHead}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={s.hSectionAccent} />
          <Text style={s.hSectionTitle}>{title}</Text>
        </View>
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
            onPress={() => openSpot(router, { spotId: item.spotId, slug: item.slug, title: item.title, area, desc: item.desc, image: item.image })}
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
// ── マガジン記事レイアウト ───────────────────────────────────────────────────
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// 代表の営業時間（最初に開いている曜日の "9:00–18:00"）
function representativeHours(hours?: SpotV2["hours"]): string | null {
  if (!hours) return null;
  for (const k of WEEKDAY_KEYS) {
    const d = hours[k];
    if (d && typeof d === "object" && !d.closed && (d.open || d.close)) {
      return `${d.open ?? ""}–${d.close ?? ""}`;
    }
  }
  return null;
}

// 1スポット = 1記事セクション
function SpotArticle({ index, spot, onOpen }: { index: number; spot: SpotV2; onOpen: () => void }) {
  const body = spot.description || spot.catch_copy || spot.location || "";
  const menuN = spot.menu_items?.length ?? 0;
  const hrs = representativeHours(spot.hours);
  const ev = spot.events?.[0]?.title;
  return (
    <View style={s.mzArticle}>
      <View style={s.mzArtHead}>
        <Text style={s.mzNum}>{String(index).padStart(2, "0")}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.mzArtTitle}>{spot.title}</Text>
          {!!spot.shop_name && <Text style={s.mzShopName}>{spot.shop_name}</Text>}
        </View>
      </View>
      <TouchableOpacity activeOpacity={0.9} onPress={onOpen}>
        <ExpoImage
          source={{ uri: spot.image_url || IMG.cafe }}
          style={s.mzArtImg}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      </TouchableOpacity>
      {!!body && <Text style={s.mzArtBody}>{body}</Text>}
      {(menuN > 0 || hrs || ev) && (
        <View style={s.mzInfoRow}>
          {menuN > 0 && (
            <View style={s.mzInfoItem}>
              <Utensils size={14} color={C.accent} strokeWidth={2} />
              <Text style={s.mzInfoText}>メニュー{menuN}品</Text>
            </View>
          )}
          {hrs && (
            <View style={s.mzInfoItem}>
              <Clock size={14} color={C.accent} strokeWidth={2} />
              <Text style={s.mzInfoText}>{hrs}</Text>
            </View>
          )}
          {ev && (
            <View style={s.mzInfoItem}>
              <Ticket size={14} color={C.accent} strokeWidth={2} />
              <Text style={s.mzInfoText} numberOfLines={1}>{ev}</Text>
            </View>
          )}
        </View>
      )}
      <TouchableOpacity style={s.mzReadRow} activeOpacity={0.7} onPress={onOpen}>
        <Text style={s.mzReadText}>詳しく見る</Text>
        <ChevronRight size={15} color={C.accent} />
      </TouchableOpacity>
    </View>
  );
}

function PullQuote({ text }: { text: string }) {
  return (
    <View style={s.mzQuoteWrap}>
      <Text style={s.mzQuote}>「{text}」</Text>
    </View>
  );
}

export function MagazineFeature({ page, onOpenSpot }: { page: FeaturedPageV2; onOpenSpot: (id: string) => void }) {
  const spots = page.featured_page_spots ?? [];
  const cover = page.banner_image_url || spots[0]?.image_url || IMG.cafe;
  const kicker = page.label || "今月の特集";
  const title = page.banner_title || `${page.prefecture}特集`;
  const lead = page.banner_description;
  const quote = spots[0]?.catch_copy;
  return (
    <View>
      {/* ヒーロー（タイトルを画像に重ねたアプリ風カード。表紙＋別タイトル＋長文リードの"記事感"を排除）*/}
      <View style={s.mzHero}>
        <ExpoImage source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
        <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.78)"]} locations={[0.3, 1]} style={StyleSheet.absoluteFill} />
        <View style={s.mzHeroBody}>
          <View style={s.mzHeroKicker}><Text style={s.mzHeroKickerText}>{kicker}</Text></View>
          <Text style={s.mzHeroTitle}>{title}</Text>
          {!!lead && <Text style={s.mzHeroLead} numberOfLines={2}>{lead}</Text>}
        </View>
      </View>

      {/* スポット（アプリ風の縦カードリスト。記事の番号付き流し込みではなく独立カード）*/}
      {spots.map((sp, i) => (
        <SpotArticle key={sp.id} index={i + 1} spot={sp} onOpen={() => onOpenSpot(sp.id)} />
      ))}
      {spots.length === 0 && <Text style={s.mzEmptyNote}>スポットは準備中です。</Text>}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FeatureContentView
// ─────────────────────────────────────────────────────────────────────────────
type FeatureContentViewProps = {
  currentPref: Tab;                 // ユーザー設定 or エリア変更で選んだ都道府県
  pages: FeaturedPageV2[];          // 公開中の全特集ページ（scope情報付き）
  popularAreas: PopularArea[];      // 人気エリアカード
  onChangeArea: () => void;         // 「エリア変更」→ 日本地図ステージへ
  onSelectPref: (t: Tab) => void;   // 人気エリア(pref)タップ → 県切替
};

// ページの実効scope_key（featured-scope-placement.sql 未適用のDBでは prefecture を代用）。
//   DB/adminは正式名(神奈川県/東京都)で保存するがタブは短縮名(神奈川/東京)なので末尾の都府県を剥がして照合。
//   ※「北海道」はそのまま。「京都府」→「京都」はこの正規化で正しく一致する。
const pageScopeKey = (p: FeaturedPageV2): string =>
  (p.scope_key?.trim() || p.prefecture || "").replace(/(都|府|県)$/, "");
const pageSlot = (p: FeaturedPageV2): string => p.slot_type || "hero";

// スコープキー優先順（県→地方→全国）で hero群/sub_1/sub_2 を収集（仕様のフォールバック）。
function collectScopeContent(pages: FeaturedPageV2[], scopeKeys: string[]) {
  const pick = (key: string) => pages.filter((p) => pageScopeKey(p) === key && pageSlot(p) !== "hidden");
  let heroes: FeaturedPageV2[] = [];
  let sub1: FeaturedPageV2 | undefined;
  let sub2: FeaturedPageV2 | undefined;
  for (const key of scopeKeys) {
    const rows = pick(key);
    if (!heroes.length) heroes = rows.filter((p) => pageSlot(p) === "hero");
    if (!sub1) sub1 = rows.find((p) => pageSlot(p) === "sub_1");
    if (!sub2) sub2 = rows.find((p) => pageSlot(p) === "sub_2");
    if (heroes.length && sub1 && sub2) break;
  }
  // サブ枠が未設定なら hero の2枚目以降で補完（TOPに空きを作らない）。重複は除外。
  const used = new Set<string>([...(sub1 ? [sub1.id] : []), ...(sub2 ? [sub2.id] : [])]);
  const spareHeroes = heroes.slice(1).filter((p) => !used.has(p.id));
  if (!sub1 && spareHeroes.length) sub1 = spareHeroes.shift();
  if (!sub2 && spareHeroes.length) sub2 = spareHeroes.shift();
  return { heroes, sub1, sub2 };
}

const SCREEN_W = Dimensions.get("window").width;
const HERO_CARD_W = SCREEN_W - 32;

function FeatureContentView({ currentPref, pages, popularAreas, onChangeArea, onSelectPref }: FeatureContentViewProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const region: Tab = PREF_TO_REGION[currentPref] ?? "関東";
  // スコープ切替: 県 / 地方 / 全国（仕様: 「東京」は入れない固定3段）
  const tabs: Tab[] = Array.from(new Set<Tab>([currentPref, region, "全国"]));
  const [activeScope, setActiveScope] = useState<Tab>(currentPref);
  const [heroIndex, setHeroIndex] = useState(0);
  useEffect(() => { setActiveScope(currentPref); setHeroIndex(0); }, [currentPref]);

  // 着地アニメ: マウント時にセクションが上から順にふわっとせり上がる（ズームダイブの余韻）
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 640, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter]);
  const riseIn = (idx: number) => {
    const from = Math.min(0.45, idx * 0.09);
    const to = Math.min(1, from + 0.5);
    return {
      opacity: enter.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: "clamp" as const }),
      transform: [{ translateY: enter.interpolate({ inputRange: [from, to], outputRange: [22, 0], extrapolate: "clamp" as const }) }],
    };
  };

  // フォールバック連鎖: 県タブ=県→地方→全国 / 地方タブ=地方→全国 / 全国タブ=全国のみ
  const chain: string[] =
    activeScope === "全国" ? ["全国"]
    : activeScope === region ? [region, "全国"]
    : [activeScope, region, "全国"];
  const { heroes, sub1, sub2 } = collectScopeContent(pages, chain);
  const subs = [sub1, sub2].filter(Boolean) as FeaturedPageV2[];

  // 人気エリア: 同じフォールバック連鎖で最初に見つかったスコープ分を表示
  const areas = (() => {
    for (const key of chain) {
      const rows = popularAreas.filter((a) => (a.scope_key ?? "") === key);
      if (rows.length) return rows;
    }
    return [] as PopularArea[];
  })();

  const openPage = (p: FeaturedPageV2) => router.push(`/feature/page/${p.id}` as never);
  const openArea = (a: PopularArea) => {
    if (a.destination_type === "url" && a.destination_value) { Linking.openURL(a.destination_value).catch(() => {}); return; }
    if (a.destination_type === "feature" && a.destination_value) { router.push(`/feature/page/${a.destination_value}` as never); return; }
    const pref = fullPrefToTab(a.destination_value || a.name);
    if (pref) onSelectPref(pref);
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
    >
      {/* ── 現在のエリア表示・変更バー ── */}
      <Animated.View style={riseIn(0)}>
        <TouchableOpacity style={ts.areaBar} activeOpacity={0.85} onPress={onChangeArea}>
          <MapPin size={15} color={C.accent} strokeWidth={2.2} />
          <Text style={ts.areaBarText}>現在のエリア：{currentPref}</Text>
          <View style={{ flex: 1 }} />
          <Text style={ts.areaBarChange}>エリア変更</Text>
          <ChevronRight size={14} color={C.accent} strokeWidth={2.4} />
        </TouchableOpacity>
      </Animated.View>

      {/* ── メイン特集カルーセル ── */}
      {heroes.length > 0 ? (
        <Animated.View style={riseIn(1)}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            snapToInterval={HERO_CARD_W + 12}
            decelerationRate="fast"
            contentContainerStyle={{ paddingHorizontal: 16 }}
            onMomentumScrollEnd={(e) => setHeroIndex(Math.round(e.nativeEvent.contentOffset.x / (HERO_CARD_W + 12)))}
          >
            {heroes.map((p, i) => (
              <TouchableOpacity key={p.id} activeOpacity={0.92} onPress={() => openPage(p)}
                style={[ts.heroCard, { width: HERO_CARD_W, marginRight: i === heroes.length - 1 ? 0 : 12 }]}>
                <ImageBackground source={{ uri: p.banner_image_url || undefined }} style={ts.heroImg} imageStyle={{ borderRadius: 26 }}>
                  <LinearGradient colors={["rgba(10,8,30,0.05)", "rgba(10,8,30,0.72)"]} style={ts.heroShade} />
                  <View style={ts.heroBadge}>
                    <MapPin size={11} color="#fff" strokeWidth={2.4} />
                    <Text style={ts.heroBadgeText}>{pageScopeKey(p)}エリアの特集</Text>
                  </View>
                  <View style={ts.heroBody}>
                    <Text style={ts.heroTitle} numberOfLines={3}>{p.banner_title || p.label || "特集"}</Text>
                    {!!p.banner_description && <Text style={ts.heroDesc} numberOfLines={2}>{p.banner_description}</Text>}
                    <View style={ts.heroCtaRow}>
                      <View style={ts.heroCta}>
                        <Text style={ts.heroCtaText}>特集を読む</Text>
                        <ChevronRight size={14} color={C.accent} strokeWidth={2.6} />
                      </View>
                      <View style={{ flex: 1 }} />
                      {heroes.length > 1 && <Text style={ts.heroCount}>{Math.min(heroIndex + 1, heroes.length)} / {heroes.length}</Text>}
                    </View>
                  </View>
                </ImageBackground>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {heroes.length > 1 && (
            <View style={ts.dotsRow}>
              {heroes.map((_, i) => <View key={i} style={[ts.dot, i === heroIndex && ts.dotActive]} />)}
            </View>
          )}
        </Animated.View>
      ) : (
        <Animated.View style={[s.emptyWrap, riseIn(1)]}>
          <MapPin size={36} color={C.subText} strokeWidth={1.6} />
          <Text style={s.emptyTitle}>{activeScope}の特集は準備中です</Text>
          <Text style={s.emptyText}>近日公開予定。お楽しみに ✨</Text>
        </Animated.View>
      )}

      {/* ── サブ特集カード2枚 ── */}
      {subs.length > 0 && (
        <Animated.View style={[ts.subRow, riseIn(2)]}>
          {subs.map((p) => (
            <TouchableOpacity key={p.id} style={ts.subCard} activeOpacity={0.9} onPress={() => openPage(p)}>
              <ImageBackground source={{ uri: p.banner_image_url || undefined }} style={ts.subImg} imageStyle={{ borderRadius: 20 }}>
                <LinearGradient colors={["rgba(10,8,30,0.06)", "rgba(10,8,30,0.74)"]} style={ts.heroShade} />
                <View style={ts.subBadge}><Text style={ts.subBadgeText}>{p.label || "おすすめ"}</Text></View>
                <View style={ts.subBody}>
                  <Text style={ts.subTitle} numberOfLines={2}>{p.banner_title}</Text>
                  {!!p.banner_description && <Text style={ts.subDesc} numberOfLines={2}>{p.banner_description}</Text>}
                  <View style={ts.subCta}>
                    <Text style={ts.subCtaText}>詳しく見る</Text>
                    <ChevronRight size={11} color="#fff" strokeWidth={2.6} />
                  </View>
                </View>
              </ImageBackground>
            </TouchableOpacity>
          ))}
        </Animated.View>
      )}

      {/* ── エリア範囲切替（県 / 地方 / 全国）── */}
      <Animated.View style={riseIn(3)}>
        <SegmentedTabs tabs={tabs} selected={activeScope} onSelect={(t) => { setActiveScope(t); setHeroIndex(0); }} />
      </Animated.View>

      {/* ── 人気エリア ── */}
      {areas.length > 0 && (
        <Animated.View style={[ts.section, riseIn(4)]}>
          <View style={ts.sectionHead}>
            <MapPin size={15} color={C.accent} strokeWidth={2.4} />
            <Text style={ts.sectionTitle}>{activeScope}の人気エリア</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
            {areas.map((a) => (
              <TouchableOpacity key={a.id} style={ts.areaCard} activeOpacity={0.88} onPress={() => openArea(a)}>
                {a.image_url
                  ? <ExpoImage source={{ uri: a.image_url }} style={ts.areaImg} contentFit="cover" />
                  : <View style={[ts.areaImg, ts.areaImgFallback]}><MapPin size={20} color={C.accent} strokeWidth={2} /></View>}
                <Text style={ts.areaName} numberOfLines={1}>{a.name}</Text>
                {!!a.description && <Text style={ts.areaDesc} numberOfLines={2}>{a.description}</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Animated.View>
      )}

      {/* ── 全国から探す ── */}
      <Animated.View style={[ts.nationCard, riseIn(5)]}>
        <View style={{ flex: 1 }}>
          <Text style={ts.nationTitle}>全国から探す</Text>
          <Text style={ts.nationDesc}>エリアを選んで、あなたの気分にぴったりの特集を見つけよう。</Text>
          <TouchableOpacity style={ts.nationBtn} activeOpacity={0.85} onPress={onChangeArea}>
            <Text style={ts.nationBtnText}>地図から探す</Text>
            <ChevronRight size={13} color="#fff" strokeWidth={2.6} />
          </TouchableOpacity>
        </View>
        <Image source={JAPAN_MAP} style={ts.nationMap} resizeMode="contain" />
      </Animated.View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FeatureScreen  ← デフォルトエクスポート
// 親（index.tsx）の TabBar・SafeAreaView に内包されるため
// 自前のタブバー・SafeAreaView は持たない
// ─────────────────────────────────────────────────────────────────────────────
// B の県名（"東京都"等の正式名）→ FeatureScreen の Tab（"東京"等の短縮名）
function fullPrefToTab(pref: string): Tab | null {
  if (!pref) return null;
  if (pref === "全国" || pref === "北海道") return pref as Tab;
  const short = pref.replace(/(都|府|県)$/, "");
  return short as Tab;
}

// システムB のページ群 → タブ別のページ（マガジン記事レイアウトで描画）
function buildPagesByTab(pages: FeaturedPageV2[]): Partial<Record<Tab, FeaturedPageV2>> {
  const result: Partial<Record<Tab, FeaturedPageV2>> = {};
  for (const page of pages) {
    const tab = fullPrefToTab(page.prefecture);
    if (!tab) continue;
    result[tab] = page;   // 同タブに複数あれば sort_order 昇順の最初を採用（API側で整列済み）
  }
  return result;
}

type NavStage = "map" | "pref-select" | "content";

// ── 雲ダイブ・トランジション用のパフ配置 ───────────────────────────────────────
// 画面中心付近からブワッと膨らみ、外へ飛び去る雲の塊。x/y は画面比率、
// dx/dy は外向きの流れ、maxScale は最終的な膨張倍率。
const CLOUD_PUFFS: { x: number; y: number; r: number; dx: number; dy: number; maxScale: number }[] = [
  { x: 0.50, y: 0.50, r: 210, dx: 0,    dy: 0,    maxScale: 2.4 },
  { x: 0.30, y: 0.40, r: 180, dx: -150, dy: -110, maxScale: 2.2 },
  { x: 0.72, y: 0.42, r: 190, dx: 160,  dy: -100, maxScale: 2.2 },
  { x: 0.28, y: 0.66, r: 185, dx: -140, dy: 140,  maxScale: 2.3 },
  { x: 0.74, y: 0.68, r: 195, dx: 150,  dy: 130,  maxScale: 2.1 },
  { x: 0.50, y: 0.22, r: 170, dx: 0,    dy: -180, maxScale: 2.0 },
  { x: 0.50, y: 0.82, r: 175, dx: 0,    dy: 180,  maxScale: 2.0 },
];

// 縁が透明にフェードするやわらかい雲（radial gradient）。
// アニメ中のブラーより軽く、ふわっとした見た目になる。
function SoftCloud({ size, gradId }: { size: number; gradId: string }) {
  const r = size / 2;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={gradId} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.92} />
          <Stop offset="45%" stopColor="#ffffff" stopOpacity={0.75} />
          <Stop offset="75%" stopColor="#fbfaff" stopOpacity={0.35} />
          <Stop offset="100%" stopColor="#fbfaff" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={r} cy={r} r={r} fill={`url(#${gradId})`} />
    </Svg>
  );
}

export default function FeatureScreen() {
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  // TOP(content)が起点。地図はエリア変更/全国から探すの導線として残す
  const [stage, setStage] = useState<NavStage>("content");
  const [selectedRegion, setSelectedRegion] = useState<Tab>("関東");
  const [selectedTab, setSelectedTab] = useState<Tab>("神奈川");
  const [allPages, setAllPages] = useState<FeaturedPageV2[]>([]);
  const [popularAreas, setPopularAreas] = useState<PopularArea[]>([]);
  const manualPickRef = useRef(false);   // 地図から手動選択したら設定都道府県での上書きを止める

  // ユーザー設定の都道府県（プロフィール）を現在エリアの初期値に（仕様: 神奈川は固定でなく動的）
  useEffect(() => {
    if (manualPickRef.current) return;
    const pref = fullPrefToTab(settings.profilePrefecture || "");
    if (pref && PREF_TO_REGION[pref]) {
      setSelectedTab(pref);
      setSelectedRegion(PREF_TO_REGION[pref] ?? "関東");
    }
  }, [settings.profilePrefecture]);

  // 地図画像を先読み（マウント時点でデコード済みにしてラグを防ぐ）
  useEffect(() => { preloadMaps(); }, []);

  useEffect(() => {
    apiFetch("/api/featured-pages")
      .then((r) => r.json())
      .then(({ ok, data }: { ok: boolean; data: FeaturedPageV2[] }) => {
        if (ok && data?.length) setAllPages(data);
      })
      .catch(() => {});
    apiFetch("/api/popular-areas")
      .then((r) => r.json())
      .then(({ ok, data }: { ok: boolean; data: PopularArea[] }) => {
        if (ok && Array.isArray(data)) setPopularAreas(data);
      })
      .catch(() => {});
  }, []);

  // 下部タブの「特集」を再タップ(=既に特集にいる時に押す)したら振り出し(日本地図)に戻す。
  //   他タブから特集に切り替えた時は前の場所を保持(リセットしない)＝useTabResetが再タップだけ判定。
  useTabReset(() => {
    // 雲ダイブ演出の途中でも即座に特集TOPへ。進行中トランジションの
    // ステージ差替(apply)を世代番号で無効化し、リセットが上書きされる競合を防ぐ
    resetSeqRef.current += 1;
    t.stopAnimation();
    t.setValue(0);
    busyRef.current = false;
    setBusy(false);
    setStage("content");
  });

  // ── ズームダイブ・トランジション ───────────────────────────────────────────
  // タップした場所(anchor)へ向かって現画面が拡大しながらフェードアウトし、
  // 薄い雲ヴェールを挟んで新画面が少し下からせり上がる。t: 0→1(中間0.5で差替)。
  const t = useRef(new Animated.Value(0)).current;
  const busyRef = useRef(false);
  const resetSeqRef = useRef(0);   // タブ再タップリセットの世代番号（進行中applyの無効化に使う）
  const [busy, setBusy] = useState(false);
  // ズームの狙い点(画面比0..1)とズーム率。タップしたピン位置をセットしてから開始。
  //   zoom>1=その場所へ飛び込む(進む) / zoom<1=引きで戻る(戻る)
  const anchorRef = useRef({ x: 0.5, y: 0.5, zoom: 1.9 });

  // オーバーレイ%（地図画像基準のtopPct/leftPct）→ 画面比への概算射影。
  //   地図はヘッダー下に收まるため縦は0.24〜0.84へ圧縮。方向が合っていれば十分効く。
  const setAnchorFromOverlay = (topPct?: number, leftPct?: number, zoom = 1.9) => {
    if (topPct == null || leftPct == null) { anchorRef.current = { x: 0.5, y: 0.5, zoom }; return; }
    anchorRef.current = {
      x: Math.min(0.88, Math.max(0.12, leftPct / 100 + 0.16)),
      y: Math.min(0.86, Math.max(0.14, 0.24 + (topPct / 100) * 0.6)),
      zoom,
    };
  };

  // apply（ステージ差替）を雲が画面を覆う中間点で実行する
  const runTransition = (apply: () => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);   // ここでre-render → anchorRefの新しい狙い点が補間に反映される
    t.setValue(0);
    const seq = resetSeqRef.current;   // 開始時の世代。リセットが入ったら以降のapply/後片付けは行わない
    let swapped = false;
    const id = t.addListener(({ value }) => {
      if (!swapped && value >= 0.5) {
        swapped = true;
        if (resetSeqRef.current === seq) apply();
      }
    });
    Animated.timing(t, {
      toValue: 1,
      duration: 720,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      t.removeListener(id);
      if (resetSeqRef.current !== seq) return;   // リセット済み: 後片付けはリセット側で完了
      if (!swapped) apply();
      t.setValue(0);
      busyRef.current = false;
      setBusy(false);
    });
  };

  const handleSelectRegion = (tab: Tab) => {
    const item = REGION_OVERLAY.find((r) => r.tab === tab);
    setAnchorFromOverlay(item?.topPct, item?.leftPct, 2.1);
    setSelectedRegion(tab);
    setSelectedTab(tab);
    runTransition(() => setStage("pref-select"));
  };

  const handleSelectPref = (tab: Tab) => {
    const pin = REGION_PREF_OVERLAY[selectedRegion]?.find((i) => i.label === tab);
    setAnchorFromOverlay(pin?.topPct, pin?.leftPct, 2.1);
    manualPickRef.current = true;
    setSelectedTab(tab);
    setSelectedRegion(PREF_TO_REGION[tab] ?? selectedRegion);
    runTransition(() => setStage("content"));
  };

  // 人気エリア(pref)タップ: 演出なしで即エリア切替（同一画面内の切替のため）
  const handleQuickSelectPref = (tab: Tab) => {
    manualPickRef.current = true;
    setSelectedTab(tab);
    setSelectedRegion(PREF_TO_REGION[tab] ?? selectedRegion);
  };

  // TOP(content)が起点: 地図←→県選択の戻りは map→content / pref-select→map。
  // 戻りはzoom<1=カメラが引いて戻る演出。
  const handleBack = () => {
    anchorRef.current = { x: 0.5, y: 0.45, zoom: 0.86 };
    const next: NavStage = stage === "pref-select" ? "map" : "content";
    runTransition(() => setStage(next));
  };

  const showBack = stage !== "map";

  // ── 補間 ─────────────────────────────────────────────────────────────────
  // 前半(0→0.5): 現画面がanchorへ向かって拡大しつつフェードアウト（飛び込み）
  // 後半(0.5→1): 新画面が96.5%＋16px下から等倍へふわっと立ち上がる（着地）
  const winW = Dimensions.get("window").width;
  const winH = Dimensions.get("window").height;
  const { x: ax, y: ay, zoom } = anchorRef.current;
  const dxOut = (0.5 - ax) * winW * (zoom - 1);
  const dyOut = (0.5 - ay) * winH * (zoom - 1);
  // ヴェールは前より薄く（画面が白で塗り潰されず、ズームの動きが最後まで見える）
  const veilOpacity = t.interpolate({
    inputRange: [0, 0.4, 0.5, 0.6, 1],
    outputRange: [0, 0.32, 0.4, 0.32, 0],
  });
  const puffOpacity = t.interpolate({
    inputRange: [0, 0.3, 0.5, 0.75, 1],
    outputRange: [0, 0.5, 0.65, 0.45, 0],
  });
  const contentOpacity = t.interpolate({
    inputRange: [0, 0.42, 0.58, 1],
    outputRange: [1, 0, 0, 1],
  });
  const contentScale = t.interpolate({
    inputRange: [0, 0.499, 0.5, 0.75, 1],
    outputRange: [1, zoom, 0.965, 0.99, 1],
  });
  const contentTx = t.interpolate({
    inputRange: [0, 0.499, 0.5, 1],
    outputRange: [0, dxOut, 0, 0],
  });
  const contentTy = t.interpolate({
    inputRange: [0, 0.499, 0.5, 0.75, 1],
    outputRange: [0, dyOut, 16, 3, 0],
  });

  return (
    <View style={s.safe}>
      {/* ── グラデーションヘッダー ── */}
      <LinearGradient
        colors={GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.header, {
          paddingTop: insets.top + 14,
          // 特集TOP(content)はカード群が主役なので帯を薄く。地図/県選択は従来の帯高(HERO_BAND_H)を維持
          minHeight: insets.top + (stage === "content" ? 74 : HERO_BAND_H),
        }]}
      >
        <View style={s.decoCircle1} pointerEvents="none" />
        <View style={s.decoCircle2} pointerEvents="none" />
        {/* 3段スタック: eyebrow(罫線+小ラベル) → ヒーロータイトル → 1行キャプション（審査パネル採用案）*/}
        {stage === "map" && (
          <>
            <TouchableOpacity style={s.backBtn} activeOpacity={0.72} onPress={handleBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 16 }}>
              <ChevronLeft size={16} color="rgba(255,255,255,0.9)" strokeWidth={2.5} />
              <Text style={s.backTextSm}>特集</Text>
            </TouchableOpacity>
            <Text style={[s.bandTitle, { marginTop: 4 }]}>どこへ行く？</Text>
            <Text style={s.headerCaption}>地図のエリアをタップして、その地方の特集をめくる</Text>
          </>
        )}
        {stage === "pref-select" && (
          <>
            <TouchableOpacity style={s.backBtn} activeOpacity={0.72} onPress={handleBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 16 }}>
              <ChevronLeft size={16} color="rgba(255,255,255,0.9)" strokeWidth={2.5} />
              <Text style={s.backTextSm}>特集</Text>
            </TouchableOpacity>
            {/* 選んだ地方名が主役（タップの結果が画面に反映される）*/}
            <Text style={[s.bandTitle, { marginTop: 4 }]}>{selectedRegion}</Text>
            <Text style={s.headerCaption}>気になる都道府県をタップ</Text>
          </>
        )}
        {stage === "content" && (
          <>
            <Text style={s.bandTitle}>特集</Text>
            <Text style={s.headerCaption}>どこへ行く？</Text>
          </>
        )}
      </LinearGradient>

      {/* ── メインコンテンツ（トランジション中はズーム＆フェード） ── */}
      <Animated.View style={{ flex: 1, opacity: contentOpacity, transform: [{ translateX: contentTx }, { translateY: contentTy }, { scale: contentScale }] }}>
        {stage === "map" && (
          <AreaSelectView onSelectRegion={handleSelectRegion} />
        )}
        {stage === "pref-select" && (
          <RegionPrefSelectView region={selectedRegion} onSelectPref={handleSelectPref} />
        )}
        {stage === "content" && (
          <FeatureContentView
            currentPref={selectedTab}
            pages={allPages}
            popularAreas={popularAreas}
            onChangeArea={() => runTransition(() => setStage("map"))}
            onSelectPref={handleQuickSelectPref}
          />
        )}
      </Animated.View>

      {/* ── 雲ダイブ・オーバーレイ ── */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: busy ? 1 : 0 }]}
        pointerEvents={busy ? "auto" : "none"}
      >
        {/* 淡いヴェール（やわらかく覆う。真っ白の閃光を避ける） */}
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#FBFAFF", opacity: veilOpacity }]} />
        {/* やわらか雲のパフ（縁がふわっと透明にフェードしながら膨らみ流れる） */}
        {CLOUD_PUFFS.map((p, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: p.x * W - p.r,
              top: p.y * H - p.r,
              width: p.r * 2,
              height: p.r * 2,
              opacity: puffOpacity,
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
                { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, p.dy] }) },
                { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.55, p.maxScale] }) },
              ],
            }}
          >
            <SoftCloud size={p.r * 2} gradId={`cloudGrad${i}`} />
          </Animated.View>
        ))}
      </Animated.View>
    </View>
  );
}

const cs = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FAF7FF" },
  header: { paddingHorizontal: 22, paddingBottom: 8 },
  badge: {
    width: 104, height: 104, borderRadius: 34,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#9B6BFF", shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 12,
  },
  spark: { position: "absolute", top: -6, right: 18 },

  comingPill: {
    fontSize: 11, fontWeight: "800", color: "#9B6BFF", letterSpacing: 2,
    backgroundColor: "rgba(155,107,255,0.12)", borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 5, overflow: "hidden", marginBottom: 12,
  },
  title: { fontSize: 34, fontWeight: "900", color: "#1A0A2E", letterSpacing: -0.5, marginBottom: 14 },
  lead: { fontSize: 17, fontWeight: "800", color: "#3A2A55", textAlign: "center", lineHeight: 26, marginBottom: 10 },
  sub: { fontSize: 13.5, color: "#7A6E8C", textAlign: "center", lineHeight: 22, marginBottom: 24 },

  teasers: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginBottom: 30 },
  teaser: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8,
    borderWidth: 1, borderColor: "rgba(155,107,255,0.18)",
    shadowColor: "#9B6BFF", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  teaserText: { fontSize: 13, fontWeight: "700", color: "#4A3A66" },

  barTrack: {
    width: 200, height: 7, borderRadius: 999, backgroundColor: "rgba(155,107,255,0.14)",
    overflow: "hidden", marginBottom: 10,
  },
  barFill: { width: "62%", height: "100%", borderRadius: 999 },
  barLabel: { fontSize: 12, color: "#9B6BFF", fontWeight: "700" },
});

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  // ── Header ──
  header: {
    // 帯高はお気に入り基準で統一(HERO_BAND_H)・テキストは下端寄せ
    paddingHorizontal: 20,
    paddingBottom: 20,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    // 下端は横線ではなく角丸（穴場/お気に入りの帯と統一）
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
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
  headerCaption: {
    fontSize: 12.5, fontWeight: '500', color: 'rgba(255,255,255,0.78)',
    letterSpacing: 0.2, lineHeight: 17, marginTop: 6,
  },
  // eyebrow(前置きラベル): 白ミニ罫線＋トラッキングの効いた小文字（雑誌の柱の作法）
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrowRule: { width: 18, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.65)' },
  eyebrowText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.9)', letterSpacing: 3, lineHeight: 14 },
  // ヒーロータイトル: かな主体なので負トラッキング禁止（+0.5でおおらかに）
  bandTitle: { fontSize: 30, fontWeight: '800', color: '#fff', letterSpacing: 0.5, lineHeight: 36, marginTop: 6 },
  backTextSm: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)', letterSpacing: 0.5 },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
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
    width: 10,
    height: 10,
    borderRadius: 5,
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
    backgroundColor: C.accent,
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  segTabText: {
    fontSize: 14,
    fontWeight: "500",
    color: C.subText,
  },
  segTabTextActive: {
    color: C.white,
    fontWeight: "800",
  },

  // ── FeatureContentView ──
  contentScroll: { paddingBottom: 16 },
  emptyWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 90, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: C.text, textAlign: "center" },
  emptyText: { fontSize: 13, color: C.subText, textAlign: "center" },

  // ── マガジン記事レイアウト ──
  mzCover: { height: 230, justifyContent: "flex-end", backgroundColor: C.segBg, overflow: "hidden" },
  mzCoverKicker: {
    position: "absolute", top: 14, left: 16,
    backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  mzCoverKickerText: { fontSize: 11, fontWeight: "800", color: C.accent, letterSpacing: 0.8 },
  mzCoverIssue: {
    position: "absolute", bottom: 12, right: 14,
    color: "rgba(255,255,255,0.95)", fontSize: 11, fontWeight: "700", letterSpacing: 0.3,
    backgroundColor: "rgba(0,0,0,0.30)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden",
  },
  mzHead: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6 },
  mzHero: { height: 270, marginHorizontal: 16, marginTop: 10, marginBottom: 4, borderRadius: 20, overflow: "hidden", justifyContent: "flex-end", backgroundColor: C.segBg },
  mzHeroBody: { padding: 16 },
  mzHeroKicker: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, marginBottom: 9 },
  mzHeroKickerText: { fontSize: 11, fontWeight: "800", color: C.accent, letterSpacing: 0.6 },
  mzHeroTitle: { fontSize: 24, fontWeight: "800", color: "#fff", letterSpacing: -0.4, lineHeight: 31 },
  mzHeroLead: { fontSize: 13, color: "rgba(255,255,255,0.92)", marginTop: 7, lineHeight: 19, fontWeight: "500" },
  mzTitle: { fontSize: 24, lineHeight: 32, color: C.text, fontWeight: "800", letterSpacing: -0.4 },
  mzLead: { fontSize: 14, lineHeight: 23, color: C.subText, marginTop: 10, fontWeight: "500" },
  mzDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 20, marginTop: 16, marginBottom: 4 },

  mzArticle: { marginHorizontal: 16, marginTop: 14, backgroundColor: C.white, borderRadius: 18, padding: 14, ...shadow },
  mzArtHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  mzNum: { fontSize: 13, fontWeight: "800", color: C.white, backgroundColor: C.accent, width: 26, height: 26, borderRadius: 13, textAlign: "center", lineHeight: 26, overflow: "hidden" },
  mzArtTitle: { fontSize: 17, fontWeight: "800", color: C.text, lineHeight: 24, letterSpacing: -0.3 },
  mzShopName: { fontSize: 12.5, color: C.subText, fontWeight: "600", marginTop: 2 },
  mzArtImg: { width: "100%", height: 190, borderRadius: 13, backgroundColor: C.segBg },
  mzArtBody: { fontSize: 14, lineHeight: 23, color: C.text, marginTop: 12 },
  mzInfoRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 14 },
  mzInfoItem: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: 200 },
  mzInfoText: { fontSize: 12.5, color: C.subText, fontWeight: "600" },
  mzReadRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 14, alignSelf: "flex-start", backgroundColor: "rgba(244,114,182,0.12)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  mzReadText: { fontSize: 13, fontWeight: "800", color: C.accent },

  mzQuoteWrap: { paddingHorizontal: 28, paddingVertical: 24 },
  mzQuote: { fontSize: 16, lineHeight: 26, color: C.text, fontWeight: "600", borderLeftWidth: 3, borderLeftColor: C.accent, paddingLeft: 14 },
  mzEmptyNote: { fontSize: 14, color: C.subText, textAlign: "center", paddingVertical: 40 },
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
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
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
  hSectionAccent: {
    width: 4,
    height: 17,
    borderRadius: 2,
    backgroundColor: C.accent,
    marginRight: 8,
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

// ─────────────────────────────────────────────────────────────────────────────
// 特集TOP（スクショ準拠の1画面スクロール）用スタイル
// ─────────────────────────────────────────────────────────────────────────────
const ts = StyleSheet.create({
  // 現在のエリアバー
  areaBar: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: 16, marginTop: 14, marginBottom: 14,
    backgroundColor: "#fff", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: "#7C3AED", shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  areaBarText: { fontSize: 13.5, fontWeight: "700", color: "#2A2440" },
  areaBarChange: { fontSize: 12.5, fontWeight: "700", color: C.accent, marginRight: 2 },
  // メイン特集カルーセル
  heroCard: { borderRadius: 26, overflow: "hidden", backgroundColor: "#E9E4F5" },
  heroImg: { width: "100%", aspectRatio: 16 / 11, justifyContent: "flex-end" },
  heroShade: { ...StyleSheet.absoluteFillObject, borderRadius: 26 },
  heroBadge: {
    position: "absolute", top: 14, left: 14, flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(20,16,40,0.45)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  heroBadgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  heroBody: { padding: 16, paddingBottom: 14 },
  heroTitle: { fontSize: 24, fontWeight: "800", color: "#fff", lineHeight: 31, letterSpacing: 0.2 },
  heroDesc: { fontSize: 12.5, color: "rgba(255,255,255,0.88)", lineHeight: 18, marginTop: 6 },
  heroCtaRow: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  heroCta: {
    flexDirection: "row", alignItems: "center", gap: 2,
    backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
  },
  heroCtaText: { fontSize: 12.5, fontWeight: "800", color: "#2A2440" },
  heroCount: { fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.9)" },
  dotsRow: { flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D8D2EA" },
  dotActive: { backgroundColor: C.accent, width: 14 },
  // サブ特集カード
  subRow: { flexDirection: "row", gap: 12, marginHorizontal: 16, marginTop: 14 },
  subCard: { flex: 1, borderRadius: 20, overflow: "hidden", backgroundColor: "#E9E4F5" },
  subImg: { width: "100%", height: 190, justifyContent: "flex-end" },
  subBadge: {
    position: "absolute", top: 10, left: 10,
    backgroundColor: "rgba(20,16,40,0.45)", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
  },
  subBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  subBody: { padding: 11 },
  subTitle: { fontSize: 14.5, fontWeight: "800", color: "#fff", lineHeight: 19 },
  subDesc: { fontSize: 10.5, color: "rgba(255,255,255,0.85)", lineHeight: 15, marginTop: 4 },
  subCta: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 8 },
  subCtaText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  // セクション（人気エリア）
  section: { marginTop: 20 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 16.5, fontWeight: "800", color: "#2A2440" },
  areaCard: { width: 118 },
  areaImg: { width: 118, height: 88, borderRadius: 14, backgroundColor: "#EFEAF8" },
  areaImgFallback: { alignItems: "center", justifyContent: "center" },
  areaName: { fontSize: 13, fontWeight: "800", color: "#2A2440", marginTop: 6 },
  areaDesc: { fontSize: 10.5, color: C.subText, lineHeight: 14, marginTop: 2 },
  // 全国から探す
  nationCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginTop: 24, backgroundColor: "#fff",
    borderRadius: 22, padding: 16,
    shadowColor: "#7C3AED", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  nationTitle: { fontSize: 17, fontWeight: "800", color: "#2A2440" },
  nationDesc: { fontSize: 12, color: C.subText, lineHeight: 17, marginTop: 5 },
  nationBtn: {
    flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start",
    backgroundColor: "#8B5CF6", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginTop: 10,
  },
  nationBtnText: { fontSize: 12.5, fontWeight: "800", color: "#fff" },
  nationMap: { width: 110, height: 96 },
});
