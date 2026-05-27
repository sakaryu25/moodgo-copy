// ── FeaturedView ──────────────────────────────────────────────────────────────
// スクリーンショット完全再現版
// 構成: 背景デコ円 / バナーカード / 気分選択 / おすすめリスト / ボトムナビ
// データ構造は外部API連携を想定して上部で定義

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
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

/** 右上の背景デコレーション円（ポインターイベント無効） */
function BgDecoration() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={s.decoCircle1} />
      <View style={s.decoCircle2} />
    </View>
  );
}

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
      {/* ── 背景デコレーション ── */}
      <BgDecoration />

      {/* ── スクロールコンテンツ ── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          s.scrollContent,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 88 },
        ]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={featuredListLoading}
              onRefresh={onRefresh}
              tintColor={PINK}
            />
          ) : undefined
        }
      >
        {/* 号数バッジ + ページタイトル */}
        <View style={s.issueBadge}>
          <Text style={s.issueText}>{pageData.banner.issue}</Text>
        </View>
        <Text style={s.pageTitle}>特集</Text>

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

const PINK = '#E56B9B';

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
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 20,
  },

  // ── 背景デコ円 ─────────────────────────────────────────────────────────────
  decoCircle1: {
    position: 'absolute',
    top: -50,
    right: -70,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(229, 107, 155, 0.13)',
  },
  decoCircle2: {
    position: 'absolute',
    top: 55,
    right: -90,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(168, 120, 230, 0.09)',
  },

  // ── ページヘッダー ──────────────────────────────────────────────────────────
  issueBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FCE8F0',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 6,
  },
  issueText: {
    fontSize: 12,
    fontWeight: '700',
    color: PINK,
    letterSpacing: 0.3,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 20,
    letterSpacing: -0.5,
  },

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
    color: PINK,
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
