// ── FeaturedView ──────────────────────────────────────────────────────────────
// スクリーンショット完全再現版
// 構成: 背景デコ円 / バナーカード / 気分選択 / おすすめリスト / ボトムナビ
// データ構造は外部API連携を想定して上部で定義

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import { ChevronLeft, MapPin, Star, Heart } from 'lucide-react-native';
import React, { useState } from 'react';
import AreaSelectView, { type Region, REGION_LABELS } from './AreaSelectView';
import {
  Dimensions,
  ImageBackground,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FeaturedPageSummary } from '@/types/app';
import { useRouter } from 'expo-router';

const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const BRAND = '#C084FC';

const { width: W } = Dimensions.get('window');

// ─── 型定義 ────────────────────────────────────────────────────────────────────
// 将来 API レスポンス型として独立させることを想定

export interface FeaturedBanner {
  issue: string;          // "6月号"
  label: string;          // "今月の特集"
  title: string;
  description: string;
  imageUrl: string;
  iconName: string;       // Feather アイコン名
}

export interface MoodOption {
  id: string;
  title: string;          // 改行を含む短文
  iconName: string;       // Ionicons アイコン名
  iconColor: string;
  backgroundColor: string;
}

export interface SpotItem {
  id: string;
  title: string;
  location: string;
  description: string;
  imageUrl: string;
}

export interface FeaturedPageData {
  banner: FeaturedBanner;
  moods: MoodOption[];
  spots: SpotItem[];
}

// ─── ダミーデータ（将来は /api/featured などから取得）────────────────────────

const DEMO_DATA: FeaturedPageData = {
  banner: {
    issue: '6月号',
    label: '今月の特集',
    title: '雨の日でも\n気分が下がらない横浜',
    description: 'しっとりした空気の中で、\n心がふっと軽くなる場所へ。',
    imageUrl:
      'https://images.unsplash.com/photo-1601841197690-6f0838bdb005?w=900&q=80',
    iconName: 'umbrella',
  },
  moods: [
    {
      id: 'alone',
      title: 'ひとりで\n整いたい',
      iconName: 'body',
      iconColor: '#9B5ED4',
      backgroundColor: '#F3EAFF',
    },
    {
      id: 'friends-night',
      title: '友達と\n話したい夜',
      iconName: 'chatbubble-ellipses',
      iconColor: '#D98C30',
      backgroundColor: '#FFF4E3',
    },
    {
      id: 'rainy-day',
      title: '雨の日でも\n楽しめる',
      iconName: 'cloudy',
      iconColor: '#4D84C4',
      backgroundColor: '#E8F1FF',
    },
  ],
  spots: [
    {
      id: 'cafe',
      title: '雨音に包まれるカフェ時間',
      location: '横浜・元町エリア',
      description: '静かなカフェで、自分だけのリセット時間を。',
      imageUrl:
        'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=300&q=80',
    },
    {
      id: 'aquarium',
      title: '幻想的な水族館デート',
      location: '横浜・みなとみらい',
      description: '光と音に癒される、特別なひととき。',
      imageUrl:
        'https://images.unsplash.com/photo-1519197924294-4ba991a11128?w=300&q=80',
    },
    {
      id: 'red-brick',
      title: '雨に映える、夜の赤レンガ倉庫',
      location: '横浜・赤レンガ倉庫',
      description: 'しっとり夜景とグルメで心も満たす。',
      imageUrl:
        'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=300&q=80',
    },
  ],
};

// ─── サブコンポーネント ────────────────────────────────────────────────────────

// BgDecoration は gradient ヘッダーに統合されたため削除

/** バナーカード：ImageBackground + グラデーションオーバーレイ */
function BannerCard({ data }: { data: FeaturedBanner }) {
  return (
    <View style={s.bannerWrap}>
      <ImageBackground
        source={{ uri: data.imageUrl }}
        style={s.bannerImg}
        imageStyle={s.bannerImgStyle}
        resizeMode="cover"
      >
        {/* 下半分を暗くするグラデーション */}
        <LinearGradient
          colors={['rgba(0,0,0,0.0)', 'rgba(0,0,0,0.50)']}
          locations={[0.25, 1]}
          style={s.bannerGrad}
        >
          {/* 傘アイコン */}
          <View style={s.bannerIconCircle}>
            <Feather name={data.iconName as any} size={18} color="#9B59B6" />
          </View>

          {/* テキスト群 */}
          <Text style={s.bannerLabel}>{data.label}</Text>
          <Text style={s.bannerTitle}>{data.title}</Text>
          <Text style={s.bannerDesc}>{data.description}</Text>
        </LinearGradient>
      </ImageBackground>
    </View>
  );
}

/** 気分選択チップ（横3列） */
function MoodChip({
  item,
  onPress,
}: {
  item: MoodOption;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[s.moodCard, { backgroundColor: item.backgroundColor }]}
    >
      <Ionicons name={item.iconName as any} size={28} color={item.iconColor} />
      <Text style={[s.moodLabel, { color: item.iconColor }]}>
        {item.title}
      </Text>
    </TouchableOpacity>
  );
}

/** セクションヘッダー（アイコン + テキスト） */
function SectionHeader({
  iconName,
  title,
}: {
  iconName: string;
  title: string;
}) {
  return (
    <View style={s.secHeader}>
      <Ionicons name={iconName as any} size={17} color={PINK} />
      <Text style={s.secTitle}>{title}</Text>
    </View>
  );
}

/** おすすめスポットカード */
function SpotCard({
  item,
  onPress,
}: {
  item: SpotItem;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={s.spotCard}>
      <Image source={{ uri: item.imageUrl }} style={s.spotThumb} contentFit="cover" />
      <View style={s.spotInfo}>
        <Text style={s.spotTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={s.spotLocation}>{item.location}</Text>
        <Text style={s.spotDesc} numberOfLines={2}>
          {item.description}
        </Text>
      </View>
      <Feather name="chevron-right" size={17} color={PINK} />
    </TouchableOpacity>
  );
}

// ─── Props（index.tsx との完全互換）─────────────────────────────────────────

type Props = {
  /** 既存 API の特集一覧（spot カードとして表示） */
  featuredList?: FeaturedPageSummary[];
  featuredListLoading?: boolean;
  onRefresh?: () => void;
  /** 気分タップ時コールバック */
  onMoodPress?: (id: string) => void;
  lang?: 'ja' | 'en';
};

// ─── メインコンポーネント ──────────────────────────────────────────────────────

export default function FeaturedView({
  featuredList = [],
  featuredListLoading = false,
  onRefresh,
  onMoodPress,
  lang = 'ja',
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);

  // エリア未選択 → エリア選択画面を表示
  if (!selectedRegion) {
    return <AreaSelectView onSelectRegion={setSelectedRegion} lang={lang} />;
  }

  // APIデータを SpotItem 形式に変換（空の場合はデモデータを使用）
  const spots: SpotItem[] =
    featuredList.length > 0
      ? featuredList.map((f) => ({
          id: f.slug,
          title: f.spot_name,
          location: f.partner_name,
          description: f.catch_copy ?? '',
          imageUrl: f.cover_image_url ?? DEMO_DATA.spots[0].imageUrl,
        }))
      : DEMO_DATA.spots;

  const pageData: FeaturedPageData = {
    banner: DEMO_DATA.banner,
    moods: DEMO_DATA.moods,
    spots,
  };

  const handleMoodPress = (id: string) => {
    onMoodPress?.(id);
  };

  const handleSpotPress = (id: string) => {
    // 既存ルーターで detail ページへ遷移（featuredList がある場合）
    if (featuredList.length > 0) {
      router.push(`/feature/${id}` as any);
    }
  };

  return (
    <View style={s.root}>
      {/* ── グラデーションヘッダー（履歴・お気に入りと共通デザイン）── */}
      <LinearGradient
        colors={GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.heroHeader, { paddingTop: insets.top + 10 }]}
      >
        <View style={s.decoCircleH1} pointerEvents="none" />
        <View style={s.decoCircleH2} pointerEvents="none" />

        {/* 戻るボタン */}
        <TouchableOpacity
          onPress={() => setSelectedRegion(null)}
          style={s.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <ChevronLeft size={20} color="#fff" strokeWidth={2.5} />
          <Text style={s.backText}>{lang === 'ja' ? 'エリア' : 'Regions'}</Text>
        </TouchableOpacity>

        <View style={s.heroContent}>
          <View>
            <Text style={s.heroTitle}>{REGION_LABELS[selectedRegion]}</Text>
            <Text style={s.heroSub}>{pageData.banner.issue}の特集</Text>
          </View>
        </View>
      </LinearGradient>

      {/* ── スクロールコンテンツ ── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 88 }]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={featuredListLoading}
              onRefresh={onRefresh}
              tintColor={BRAND}
            />
          ) : undefined
        }
      >
        {/* バナーカード */}
        <BannerCard data={pageData.banner} />

        {/* 気分で選ぶ */}
        <SectionHeader
          iconName="heart"
          title={lang === 'ja' ? '今の気分で選ぶ' : 'Choose your mood'}
        />
        <View style={s.moodRow}>
          {pageData.moods.map((item) => (
            <MoodChip
              key={item.id}
              item={item}
              onPress={() => handleMoodPress(item.id)}
            />
          ))}
        </View>

        {/* 今月のおすすめ */}
        <SectionHeader
          iconName="star"
          title={lang === 'ja' ? '今月のおすすめ' : "This month's picks"}
        />
        <View style={s.spotList}>
          {pageData.spots.map((item) => (
            <SpotCard
              key={item.id}
              item={item}
              onPress={() => handleSpotPress(item.id)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── 定数 ─────────────────────────────────────────────────────────────────────

const PINK = BRAND; // 旧 #E56B9B → MoodGo ブランドカラーに統一

const CARD_SHADOW = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
  },
  android: { elevation: 3 },
});

// ─── StyleSheet ───────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  // ── ルート ────────────────────────────────────────────────────────────────
  root: {
    flex: 1,
    backgroundColor: '#F8F6FF',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },

  // ── グラデーションヘッダー ─────────────────────────────────────────────────
  heroHeader: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    overflow: 'hidden',
  },
  decoCircleH1: {
    position: 'absolute',
    top: -30,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  decoCircleH2: {
    position: 'absolute',
    top: 40,
    right: 40,
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  heroContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '500',
  },

  // ── 旧ヘッダーエイリアス（BannerCard等で参照しているかもしれないため残す）──
  issueBadge: { display: 'none' },
  issueText:  { display: 'none' },
  pageTitle:  { display: 'none' },

  // ── バナーカード ────────────────────────────────────────────────────────────
  bannerWrap: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 28,
    ...CARD_SHADOW,
  },
  bannerImg: {
    width: '100%',
    height: 260,
  },
  bannerImgStyle: {
    borderRadius: 20,
  },
  bannerGrad: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 18,
    paddingBottom: 22,
  },
  bannerIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 4,
      },
    }),
  },
  bannerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 7,
    letterSpacing: 0.5,
  },
  bannerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 30,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  bannerDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
  },

  // ── セクションヘッダー ─────────────────────────────────────────────────────
  secHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 14,
  },
  secTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1A1A1A',
    letterSpacing: -0.2,
  },

  // ── 気分カード ─────────────────────────────────────────────────────────────
  moodRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
  },
  moodCard: {
    flex: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 6,
    gap: 9,
    ...CARD_SHADOW,
    ...(Platform.OS === 'ios' ? { shadowOpacity: 0.05 } : {}),
  },
  moodLabel: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 17,
  },

  // ── おすすめスポット ────────────────────────────────────────────────────────
  spotList: {
    gap: 12,
    marginBottom: 12,
  },
  spotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    gap: 12,
    ...CARD_SHADOW,
  },
  spotThumb: {
    width: 84,
    height: 84,
    borderRadius: 12,
    backgroundColor: '#F0F0F0',
  },
  spotInfo: {
    flex: 1,
    gap: 3,
  },
  spotTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A1A',
    lineHeight: 20,
  },
  spotLocation: {
    fontSize: 12,
    color: '#8A8A8A',
    marginBottom: 1,
  },
  spotDesc: {
    fontSize: 12,
    color: '#555555',
    lineHeight: 18,
  },
});
