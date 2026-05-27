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
export type Tab = "全国" | "関東" | "神奈川";

type CardItem = {
  title: string;
  desc: string;
  image: string;
};

type HeroData = {
  image: string;
  label: string;
  title: string;
  description: string;
  buttonLabel: string;
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
const TAB_DATA: Record<Tab, TabContentData> = {
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
    categories: [
      "🏔️ 絶景", "☕ カフェ", "🚶 おでかけ", "♨️ 温泉",
      "🍽️ グルメ", "☔ 雨の日", "💑 デート", "🌃 夜景",
    ],
    sections: [
      {
        title: "神奈川のおすすめ",
        cards: [
          { title: "鎌倉で紫陽花さんぽ",           desc: "明月院・長谷寺など",   image: IMG.kamakura },
          { title: "みなとみらいの夜景スポット",    desc: "横浜の夜を楽しむ",    image: IMG.minatomirai },
          { title: "海が見えるカフェ",              desc: "湘南・葉山エリア",    image: IMG.shonan },
          { title: "雨の日の美術館",               desc: "箱根・横浜エリア",    image: IMG.hakone },
        ],
      },
    ],
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
  top: number;
  side: "left" | "right";
  offset: number;
};

const REGION_OVERLAY: RegionOverlayItem[] = [
  // 左列
  { id: "hokkaido", label: "北海道・東北", color: "#5BA8D0", tab: "全国", top:  5, side: "left",  offset: 2 },
  { id: "chubu",    label: "中部",         color: "#6DB86D", tab: "全国", top: 40, side: "left",  offset: 2 },
  { id: "chugoku",  label: "中国",         color: "#C9B840", tab: "全国", top: 51, side: "left",  offset: 2 },
  { id: "shikoku",  label: "四国",         color: "#3BAAA0", tab: "全国", top: 63, side: "left",  offset: 2 },
  { id: "kyushu",   label: "九州・沖縄",   color: "#E07070", tab: "全国", top: 74, side: "left",  offset: 2 },
  // 右列
  { id: "kanto",    label: "関東",         color: "#E8924A", tab: "関東", top: 44, side: "right", offset: 2 },
  { id: "kinki",    label: "近畿",         color: "#9B7CC8", tab: "全国", top: 57, side: "right", offset: 2 },
];

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
            const btnTop  = offsetY + imgH * (r.top / 100);
            const btnSide = r.side === "left"
              ? { left:  offsetX + imgW * (r.offset / 100) }
              : { right: offsetX + imgW * (r.offset / 100) };
            return (
              <TouchableOpacity
                key={r.id}
                activeOpacity={0.75}
                onPress={() => onSelectRegion(r.tab)}
                style={[s.mapRegionBtn, { top: btnTop, ...btnSide }]}
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
            <TouchableOpacity style={s.heroBtn} activeOpacity={0.85}>
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
  onTabChange: (t: Tab) => void;
  apiTabData: Partial<Record<Tab, TabContentData>>;
};

function FeatureContentView({ selectedTab, onTabChange, apiTabData }: FeatureContentViewProps) {
  const data = apiTabData[selectedTab] ?? TAB_DATA[selectedTab];

  const handlePrefSelect = (pref: string) => {
    if (pref === "神奈川") {
      onTabChange("神奈川");
    }
    // 他の都県は将来的に専用タブへ遷移
  };

  return (
    <View style={{ flex: 1 }}>
      <SegmentedTabs
        tabs={["全国", "関東", "神奈川"]}
        selected={selectedTab}
        onSelect={onTabChange}
      />
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

        {/* 都県グリッド（関東タブのみ） */}
        {data.prefectures && (
          <PrefectureGrid
            prefectures={data.prefectures}
            onSelectPref={handlePrefSelect}
          />
        )}

        <View style={{ height: 28 }} />
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FeatureScreen  ← デフォルトエクスポート
// 親（index.tsx）の TabBar・SafeAreaView に内包されるため
// 自前のタブバー・SafeAreaView は持たない
// ─────────────────────────────────────────────────────────────────────────────
function buildTabData(records: FeaturedPageRecord[]): Partial<Record<Tab, TabContentData>> {
  const TABS: Tab[] = ["全国", "関東", "神奈川"];
  const grouped: Record<Tab, FeaturedPageRecord[]> = { 全国: [], 関東: [], 神奈川: [] };

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
      },
      categories: TAB_DATA[tab].categories,
      sections: rest.length
        ? [{ title: "今月のおすすめ店舗", cards: rest.map((r) => ({
            title: r.spot_name,
            desc: r.catch_copy ?? "",
            image: r.cover_image_url ?? IMG.cafe,
          })) }]
        : [],
      prefectures: TAB_DATA[tab].prefectures,
    };
  }
  return result;
}

export default function FeatureScreen() {
  const insets = useSafeAreaInsets();
  const [hasSelectedArea, setHasSelectedArea] = useState(false);
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
    setHasSelectedArea(true);
  };

  return (
    <View style={s.safe}>
      {/* ── ヘッダー ── */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <View>
          <Text style={s.headerTitle}>特集</Text>
          <Text style={s.headerSub}>Pick your destination</Text>
        </View>
        <TouchableOpacity style={s.headerIconBtn} activeOpacity={0.72}>
          {hasSelectedArea
            ? <MapPin size={19} color={C.accent} />
            : <Search size={19} color={C.accent} />
          }
        </TouchableOpacity>
      </View>

      {/* ── メインコンテンツ ── */}
      <View style={{ flex: 1 }}>
        {!hasSelectedArea ? (
          <AreaSelectView onSelectRegion={handleSelectRegion} />
        ) : (
          <FeatureContentView
            selectedTab={selectedTab}
            onTabChange={setSelectedTab}
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
    backgroundColor: "rgba(255,255,255,0.96)",
    borderRadius: 22,
    paddingVertical: 6,
    paddingHorizontal: 9,
    gap: 5,
    borderWidth: 0.5,
    borderColor: "rgba(0,0,0,0.06)",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.13,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
    }),
  },
  mapRegionDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  mapRegionEmoji: { fontSize: 12 },
  mapRegionLabel: {
    fontSize: 11.5,
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
