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
export type Tab = "全国" | "北海道・東北" | "関東" | "中部" | "近畿" | "中国" | "四国" | "九州・沖縄"
  | "東京" | "神奈川" | "千葉" | "埼玉" | "茨城" | "栃木" | "群馬";

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
// KantoPrefSelectView — 関東都県グリッド選択
// ─────────────────────────────────────────────────────────────────────────────

type KantoPrefCell = { label: string; tab: Tab; color: string; Icon: LucideIcon };

const KANTO_GRID: (KantoPrefCell | null)[][] = [
  [
    { label: "群馬", tab: "群馬",  color: "#C97A28", Icon: Mountain  },
    { label: "栃木", tab: "栃木",  color: "#5A9850", Icon: Leaf      },
    { label: "茨城", tab: "茨城",  color: "#3A80B0", Icon: Waves     },
  ],
  [
    { label: "埼玉", tab: "埼玉",  color: "#D87828", Icon: Building2 },
    { label: "東京", tab: "東京",  color: "#B03018", Icon: Landmark  },
    { label: "千葉", tab: "千葉",  color: "#C89830", Icon: Sun       },
  ],
  [
    null,
    { label: "神奈川", tab: "神奈川", color: "#2A6AA8", Icon: Waves  },
    null,
  ],
];

function KantoPrefSelectView({ onSelectPref }: { onSelectPref: (tab: Tab) => void }) {
  return (
    <LinearGradient colors={["#FFF5EE", "#FFF8F2", "#FFFAF5"]} style={{ flex: 1 }}>
      <View style={s.areaIntro}>
        <View style={s.areaBadge}>
          <Text style={s.areaBadgeText}>関東エリア</Text>
        </View>
        <Text style={s.areaTitle}>都道府県を選ぶ</Text>
        <Text style={s.areaSubtitle}>気になるエリアをタップ</Text>
      </View>

      <View style={s.kantoGrid}>
        {KANTO_GRID.map((row, rIdx) => (
          <View key={rIdx} style={s.kantoRow}>
            {row.map((cell, cIdx) =>
              cell ? (
                <TouchableOpacity
                  key={cIdx}
                  style={[s.kantoPref, { borderColor: cell.color + "66" }]}
                  onPress={() => onSelectPref(cell.tab)}
                  activeOpacity={0.75}
                >
                  <cell.Icon size={22} color={cell.color} strokeWidth={2} />
                  <Text style={[s.kantoPrefLabel, { color: cell.color }]}>{cell.label}</Text>
                </TouchableOpacity>
              ) : (
                <View key={cIdx} style={s.kantoPrefEmpty} />
              )
            )}
          </View>
        ))}
      </View>
    </LinearGradient>
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
    <LinearGradient colors={["#EDF5FF", "#FFF8F2", "#FFFAF5"]} style={{ flex: 1 }}>
      <View style={s.areaIntro}>
        {/* バッジ */}
        <View style={s.areaBadge}>
          <Text style={s.areaBadgeText}>{CURRENT_MONTH}の特集</Text>
        </View>
        <Text style={s.areaTitle}>どこへ行く？</Text>
        <Text style={s.areaSubtitle}>エリアをタップして特集を見る</Text>
      </View>

      {/* 地図画像 + 重ね置きボタン（残りスペースをすべて使う） */}
      <JapanMapWithButtons onSelectRegion={onSelectRegion} />
    </LinearGradient>
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
  apiTabData: Partial<Record<Tab, TabContentData>>;
};

function FeatureContentView({ selectedTab, apiTabData }: FeatureContentViewProps) {
  const data = apiTabData[selectedTab] ?? TAB_DATA[selectedTab];

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={s.contentScroll}
    >
      {/* 見出し */}
      <View style={s.contentHeader}>
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
  const TABS: Tab[] = ["全国", "北海道・東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄",
    "東京", "神奈川", "千葉", "埼玉", "茨城", "栃木", "群馬"];
  const grouped = Object.fromEntries(TABS.map(t => [t, []])) as Record<Tab, FeaturedPageRecord[]>;

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

type NavStage = "map" | "kanto-pref" | "content";

const KANTO_PREF_TABS: Tab[] = ["東京", "神奈川", "千葉", "埼玉", "茨城", "栃木", "群馬"];

export default function FeatureScreen() {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<NavStage>("map");
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
    setSelectedTab(tab);
    setStage(tab === "関東" ? "kanto-pref" : "content");
  };

  const handleSelectPref = (tab: Tab) => {
    setSelectedTab(tab);
    setStage("content");
  };

  const handleBack = () => {
    if (stage === "content" && KANTO_PREF_TABS.includes(selectedTab)) {
      setStage("kanto-pref");
    } else {
      setStage("map");
    }
  };

  const showBack = stage !== "map";

  return (
    <View style={s.safe}>
      {/* ── ヘッダー ── */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <View>
          <Text style={s.headerTitle}>特集</Text>
          <Text style={s.headerSub}>Pick your destination</Text>
        </View>
        <TouchableOpacity
          style={s.headerIconBtn}
          activeOpacity={0.72}
          onPress={showBack ? handleBack : undefined}
        >
          {showBack
            ? <MapPin size={19} color={C.accent} />
            : <Search size={19} color={C.accent} />
          }
        </TouchableOpacity>
      </View>

      {/* ── メインコンテンツ ── */}
      <View style={{ flex: 1 }}>
        {stage === "map" && (
          <AreaSelectView onSelectRegion={handleSelectRegion} />
        )}
        {stage === "kanto-pref" && (
          <KantoPrefSelectView onSelectPref={handleSelectPref} />
        )}
        {stage === "content" && (
          <FeatureContentView
            selectedTab={selectedTab}
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
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingBottom: 12,
    backgroundColor: C.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 11,
    color: C.subText,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFF0EA",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#FFD9C8",
  },

  // ── KantoPrefSelectView ──
  kantoGrid: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    justifyContent: "center",
    gap: 10,
  },
  kantoRow: {
    flexDirection: "row",
    gap: 10,
  },
  kantoPref: {
    flex: 1,
    backgroundColor: C.white,
    borderRadius: 18,
    paddingVertical: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    ...shadow,
  },
  kantoPrefEmpty: {
    flex: 1,
  },
  kantoPrefLabel: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: -0.3,
  },

  // ── AreaSelectView ──
  areaScroll: { paddingBottom: 48 },
  areaIntro: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  areaBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FFF0EA",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
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
    fontSize: 26,
    fontWeight: "800",
    color: C.text,
    letterSpacing: -0.7,
    marginBottom: 3,
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
