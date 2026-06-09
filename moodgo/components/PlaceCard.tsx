// ── PlaceCard ──────────────────────────────────────────────────────────────
// Web版と同じレイアウト + MoodGo グラデーション配色
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Clock, Flame, Heart, Map, MapPin, Navigation, Share2, Sparkles, Star, Train, ThumbsUp, ThumbsDown } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import {
  Animated,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Recommendation } from '@/types/app';
import { COLORS } from '@/constants/colors';

// MoodGo brand
const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const BRAND = '#C084FC';

// ── 営業時間フォーマッター ────────────────────────────────────────────────
const DAY_ORDER = ['月', '火', '水', '木', '金', '土', '日'];

function formatOpeningHours(text: string): string {
  if (!text) return text;

  // 改行 or 読点で分割
  const lines = text
    .split(/\n|、(?=[月火水木金土日]曜)/)
    .map(l => l.trim().replace(/。$/, ''))
    .filter(Boolean);

  if (lines.length < 2) return text;

  // 各行を「曜日 → 時間」にパース
  // 対応フォーマット例: "月曜日: 9:00 – 21:00" / "月曜日：24時間営業"
  type DayEntry = { day: string; hours: string };
  const parsed: DayEntry[] = [];

  for (const line of lines) {
    const m = line.match(/^([月火水木金土日])曜日?[：:]\s*(.+)$/);
    if (!m) return text; // 解析できなければそのまま返す
    parsed.push({ day: m[1], hours: m[2].trim() });
  }

  if (parsed.length === 0) return text;

  // 曜日順にソート
  parsed.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));

  // 全日同じ → 「毎日」
  if (parsed.length === 7 && parsed.every(d => d.hours === parsed[0].hours)) {
    return `毎日：${parsed[0].hours}`;
  }

  // 同じ時間のグループをまとめる
  const groups: { days: string[]; hours: string }[] = [];
  for (const { day, hours } of parsed) {
    const last = groups[groups.length - 1];
    if (last && last.hours === hours) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], hours });
    }
  }

  // 各グループを「月〜金」「土・日」などに整形
  return groups.map(({ days, hours }) => {
    let dayStr: string;
    if (days.length === 1) {
      dayStr = `${days[0]}曜`;
    } else {
      // 連続しているか確認
      const startIdx = DAY_ORDER.indexOf(days[0]);
      const isConsecutive = days.every((d, i) => DAY_ORDER.indexOf(d) === startIdx + i);
      if (isConsecutive && days.length >= 3) {
        dayStr = `${days[0]}〜${days[days.length - 1]}曜`;
      } else {
        dayStr = days.map(d => `${d}曜`).join('・');
      }
    }
    return `${dayStr}：${hours}`;
  }).join('\n');
}

const T = {
  ja: {
    openNow:          '営業中',
    closedNow:        '閉店中',
    mapBtn:           'Googleマップで見る',
    hide:             '表示しない',
    report:           '報告',
    share:            '共有',
    reviewCount:      (n: number) => `(${n.toLocaleString('ja-JP')}件)`,
    visited:          '行った！',
    visitedDone:      '行った',
    moodMatch:        'この気分に合う',
    moodNotMatch:     '気分には合わない',
    moodMatchDone:    '気分に合う！と評価しました',
    moodNotMatchDone: '気分には合わないと評価しました',
    moodQuestion:     (mood: string) => `「${mood}」の気分の時にこの場所は？`,
  },
  en: {
    openNow:          'Open',
    closedNow:        'Closed',
    mapBtn:           'Google Maps',
    hide:             'Hide',
    report:           'Report',
    share:            'Share',
    reviewCount:      (n: number) => `(${n.toLocaleString('en-US')} reviews)`,
    visited:          'Been there!',
    visitedDone:      'Visited',
    moodMatch:        'Matches my mood',
    moodNotMatch:     "Doesn't match",
    moodMatchDone:    'Marked as mood match!',
    moodNotMatchDone: 'Marked as not matching',
    moodQuestion:     (mood: string) => `How is this place for "${mood}"?`,
  },
};

type Props = {
  item: Recommendation;
  isFavorited: boolean;
  onToggleFavorite: () => void;
  onBlock?: () => void;
  onReport?: () => void;
  onMarkVisited?: () => void;
  isVisited?: boolean;
  accentColor?: string;
  lang?: 'ja' | 'en';
  moodRating?: 'good' | 'bad' | null;
  onMoodMatch?: () => void;
  onMoodNotMatch?: () => void;
  moodLabel?: string;   // 気分ラベル（任意）
  /** タイトルタップで詳細ページへ */
  onPressDetail?: () => void;
};

export default function PlaceCard({
  item, isFavorited, onToggleFavorite, onBlock, onReport, onMarkVisited, isVisited = false,
  accentColor = COLORS.primary, lang = 'ja',
  moodRating, onMoodMatch, onMoodNotMatch, moodLabel, onPressDetail,
}: Props) {
  const t = T[lang];
  const photos = (item.photoUrls ?? []).length > 0
    ? item.photoUrls!
    : item.photoUrl ? [item.photoUrl] : [];
  const [photoIdx, setPhotoIdx] = useState(0);
  const photoScrollRef = useRef<ScrollView>(null);
  const [photoWidth, setPhotoWidth] = useState(0);

  // ページングScrollView: スクロール終了時にインデックス更新
  const onPhotoScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (photoWidth <= 0) return;
    const newIdx = Math.round(e.nativeEvent.contentOffset.x / photoWidth);
    if (newIdx !== photoIdx) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPhotoIdx(newIdx);
    }
  };

  // 矢印ボタン用: 指定ページへスムーズスクロール
  const scrollToPhoto = (idx: number) => {
    if (photoWidth <= 0) return;
    photoScrollRef.current?.scrollTo({ x: idx * photoWidth, animated: true });
    setPhotoIdx(idx);
  };

  // スプリングプレスアニメーション
  const scale = useRef(new Animated.Value(1)).current;

  // Heart pulse
  const heartScale = useRef(new Animated.Value(1)).current;
  const pulseHeart = () => {
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.35, useNativeDriver: true, mass: 1, damping: 8,  stiffness: 300 }),
      Animated.spring(heartScale, { toValue: 1,    useNativeDriver: true, mass: 1, damping: 12, stiffness: 200 }),
    ]).start();
  };

  // #8: openStatusBadge（営業中/もうすぐ閉店/もうすぐ開店/営業時間外）を優先表示（日本語時のみ）。
  //   無い場合は従来の openNow ベースの 営業中/閉店 ラベルにフォールバック。
  const badge = lang === 'ja' ? item.openStatusBadge : undefined;
  const openNowColor =
    badge?.includes('もうすぐ閉店') ? '#F59E0B' :          // オレンジ（まもなく閉店）
    badge?.includes('もうすぐ開店') ? '#3B82F6' :          // 青（まもなく開店）
    badge === '営業時間外'          ? '#EF4444' :
    item.openNow === true  ? '#10B981' :
    item.openNow === false ? '#EF4444' : COLORS.textMuted;
  const openNowLabel =
    badge ? badge :
    item.openNow === true  ? t.openNow :
    item.openNow === false ? t.closedNow : '';

  const handleShare = () => {
    const parts = [item.title];
    if (item.address) parts.push(item.address);
    if (item.mapUrl)  parts.push(item.mapUrl);
    Share.share({ message: parts.join('\n') });
  };

  // 説明文：featuresの中で長い文はdescription扱い
  const description = item.features?.find(f => f.length > 15) ?? '';
  const tags = item.features?.filter(f => f !== description && f.length > 0) ?? [];

  return (
    <Animated.View style={[s.card, { transform: [{ scale }] }]}>

      {/* ── 写真エリア ────────────────────────────── */}
      <View
        style={s.photoWrap}
        onLayout={e => setPhotoWidth(e.nativeEvent.layout.width)}
      >
        {/* 写真カルーセル（水平ページングScrollView） */}
        {photos.length > 0 && photoWidth > 0 ? (
          <ScrollView
            ref={photoScrollRef}
            horizontal
            pagingEnabled
            scrollEnabled={photos.length > 1}
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            scrollEventThrottle={16}
            bounces={false}
            onMomentumScrollEnd={onPhotoScrollEnd}
            style={{ width: photoWidth, height: 220 }}
          >
            {photos.map((uri, i) => (
              <Image
                key={i}
                source={{ uri }}
                style={{ width: photoWidth, height: 220 }}
                contentFit="cover"
                transition={200}
              />
            ))}
          </ScrollView>
        ) : photos.length > 0 ? (
          // photoWidth 計測前の一瞬だけ先頭写真を表示
          <Image source={{ uri: photos[0] }} style={s.photo} contentFit="cover" transition={300} />
        ) : (
          <LinearGradient colors={['#F5F0FF', '#EDE9FE']} style={[s.photo, s.photoPlaceholder]}>
            <Navigation size={36} color={BRAND} strokeWidth={1.5} />
          </LinearGradient>
        )}

        <LinearGradient
          colors={['transparent', 'rgba(15,10,30,0.45)']}
          style={s.photoOverlay}
          pointerEvents="none"
        />

        {/* ページングドット + 矢印ボタン */}
        {photos.length > 1 && (
          <>
            {photoIdx > 0 && (
              <TouchableOpacity onPress={() => scrollToPhoto(photoIdx - 1)} style={[s.arrowBtn, { left: 10 }]}>
                <Text style={s.arrowText}>‹</Text>
              </TouchableOpacity>
            )}
            {photoIdx < photos.length - 1 && (
              <TouchableOpacity onPress={() => scrollToPhoto(photoIdx + 1)} style={[s.arrowBtn, { right: 10 }]}>
                <Text style={s.arrowText}>›</Text>
              </TouchableOpacity>
            )}
            <View style={s.pageDots}>
              {photos.map((_, i) => (
                <View key={i} style={[s.pageDot, i === photoIdx && s.pageDotActive]} />
              ))}
            </View>
          </>
        )}


        {/* ハートボタン — top-right */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(isFavorited ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
            pulseHeart();
            onToggleFavorite();
          }}
          style={s.favBtn}
          activeOpacity={0.9}
        >
          <Animated.View style={{ transform: [{ scale: heartScale }] }}>
            <Heart
              size={20}
              color={isFavorited ? BRAND : '#C084FC'}
              fill={isFavorited ? BRAND : 'none'}
              strokeWidth={2}
            />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {/* ── ボディ ────────────────────────────────── */}
      <View style={s.body}>

        {/* タイトル */}
        {onPressDetail ? (
          <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPressDetail(); }} activeOpacity={0.75}>
            <Text style={[s.title, s.titleTappable]} numberOfLines={2}>{item.title}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={s.title} numberOfLines={2}>{item.title}</Text>
        )}

        {/* 説明文（Web版と同じ small gray text） */}
        {description ? (
          <Text style={s.description} numberOfLines={2}>{description}</Text>
        ) : null}

        {/* 評価 + 営業状態 (ピル) */}
        <View style={s.pillRow}>
          {item.rating != null && (
            <View style={s.ratingPill}>
              <Star size={13} color="#F59E0B" fill="#F59E0B" strokeWidth={0} />
              <Text style={s.ratingNum}>{item.rating.toFixed(1)}</Text>
              {item.userRatingCount ? (
                <Text style={s.ratingCount}>{t.reviewCount(item.userRatingCount)}</Text>
              ) : null}
            </View>
          )}
          {openNowLabel ? (
            <View style={[s.openPill, { backgroundColor: openNowColor + '18', borderColor: openNowColor + '55' }]}>
              <View style={[s.openDot, { backgroundColor: openNowColor }]} />
              <Text style={[s.openText, { color: openNowColor }]}>{openNowLabel}</Text>
            </View>
          ) : null}
          {item.priceLevel ? (
            <View style={s.pricePill}>
              <Text style={s.priceText}>{item.priceLevel}</Text>
            </View>
          ) : null}
        </View>

        {/* 住所 */}
        {item.address ? (
          <Text style={s.address} numberOfLines={2}>{item.address}</Text>
        ) : null}

        {/* 最寄り駅 / 距離 */}
        {item.stationText ? (
          <View style={s.hoursRow}>
            <Train size={13} color="#9CA3AF" strokeWidth={2} />
            <Text style={s.hoursText}>{item.stationText}</Text>
          </View>
        ) : item.distanceText ? (
          <View style={s.hoursRow}>
            <Navigation size={13} color="#9CA3AF" strokeWidth={2} />
            <Text style={s.hoursText}>
              {item.distanceText}{item.durationText ? `  /  ${item.durationText}` : ''}
            </Text>
          </View>
        ) : null}

        {/* 営業時間（週全体・まとめ表示） */}
        {item.openingHoursText ? (
          <View style={s.hoursRow}>
            <Clock size={14} color="#9CA3AF" strokeWidth={2} style={{ marginTop: 2 }} />
            <Text style={s.hoursText}>{formatOpeningHours(item.openingHoursText)}</Text>
          </View>
        ) : null}

        {/* ── AI相談時のみ: なぜおすすめか ── */}
        {item.aiReason ? (
          <View style={s.aiReasonBox}>
            <View style={s.aiReasonHead}>
              <Sparkles size={13} color="#9B6BFF" fill="#9B6BFF" strokeWidth={0} />
              <Text style={s.aiReasonLabel}>AIのおすすめ理由</Text>
            </View>
            <Text style={s.aiReasonText}>{item.aiReason}</Text>
          </View>
        ) : null}

        {/* ── アクションボタン: Googleマップ + 行った！ ── */}
        <View style={s.actions}>
          {item.mapUrl ? (
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (Platform.OS === 'ios') {
                  const query = encodeURIComponent(item.title || '');
                  Linking.openURL(`comgooglemaps://?q=${query}`).catch(() => Linking.openURL(item.mapUrl!));
                } else {
                  Linking.openURL(item.mapUrl!);
                }
              }}
              style={s.mapBtn}
              activeOpacity={0.88}
            >
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mapBtnGrad}>
                <MapPin size={15} color="#fff" strokeWidth={2.5} />
                <Text style={s.mapBtnText}>{t.mapBtn}</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}
          {onMarkVisited ? (
            <TouchableOpacity
              onPress={isVisited ? undefined : onMarkVisited}
              style={[s.visitedBtn, isVisited && s.visitedBtnDone]}
              activeOpacity={0.8}
            >
              {isVisited
                ? <><Check size={13} color="#10B981" strokeWidth={2.5} /><Text style={[s.visitedBtnText, s.visitedBtnTextDone]}>{t.visitedDone}</Text></>
                : <><Map size={13} color="#6B7280" strokeWidth={2} /><Text style={s.visitedBtnText}>{t.visited}</Text></>}
            </TouchableOpacity>
          ) : null}

          {/* ホットペッパー */}
          {item.hotpepperUrl ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(item.hotpepperUrl!)}
              style={s.hotpepperBtn}
              activeOpacity={0.8}
            >
              <Flame size={13} color="#EF4444" strokeWidth={2} />
              <Text style={s.hotpepperText}>ホットペッパー</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={s.divider} />

        {/* ── 気分ボタン ── */}
        {(onMoodMatch || onMoodNotMatch) && (
          <>
            {moodLabel && !moodRating && (
              <Text style={s.moodQuestion}>{t.moodQuestion(moodLabel)}</Text>
            )}
            {moodRating ? (
              <View style={s.moodDoneRow}>
                {moodRating === 'good'
                  ? <ThumbsUp size={14} color="#10B981" strokeWidth={2} />
                  : <ThumbsDown size={14} color="#EF4444" strokeWidth={2} />}
                <Text style={[s.moodDoneText, { color: moodRating === 'good' ? '#10B981' : '#EF4444' }]}>
                  {moodRating === 'good' ? t.moodMatchDone : t.moodNotMatchDone}
                </Text>
              </View>
            ) : (
              <View style={s.moodRow}>
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onMoodMatch?.(); }}
                  style={s.moodMatchBtn}
                  activeOpacity={0.8}
                >
                  <ThumbsUp size={14} color="#10B981" strokeWidth={2} />
                  <Text style={s.moodMatchText}>{t.moodMatch}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onMoodNotMatch?.(); }}
                  style={s.moodNotMatchBtn}
                  activeOpacity={0.8}
                >
                  <ThumbsDown size={14} color="#EF4444" strokeWidth={2} />
                  <Text style={s.moodNotMatchText}>{t.moodNotMatch}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {/* ソース表示 */}
        {item.source && (
          <View style={s.sourceRow}>
            <Text style={s.sourceText}>
              {item.source === 'admin'     ? '🗄 DB登録済み' :
               item.source === 'user'      ? '👤 ユーザー投稿' :
               item.source === 'google'    ? '🔍 Google検索' :
               item.source === 'hotpepper' ? '🍽 ホットペッパー' :
               `📍 ${item.source}`}
            </Text>
          </View>
        )}

        {/* フッター */}
        <View style={s.footRow}>
          <TouchableOpacity onPress={handleShare} style={s.footBtnShare}>
            <Share2 size={12} color={COLORS.textMuted} strokeWidth={2} />
            <Text style={s.footBtnText}>{t.share}</Text>
          </TouchableOpacity>
          <View style={s.footRight}>
            {onBlock && (
              <TouchableOpacity onPress={onBlock} style={s.footBtn}>
                <Text style={s.footBtnText}>{t.hide}</Text>
              </TouchableOpacity>
            )}
            {onReport && (
              <TouchableOpacity onPress={onReport} style={s.footBtn}>
                <Text style={s.footBtnText}>{t.report}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#9B6BFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(192,132,252,0.12)',
  },

  // 写真
  photoWrap:        { position: 'relative' },
  photo:            { width: '100%', height: 220 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoOverlay:     { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  arrowBtn: {
    position: 'absolute', top: '50%', marginTop: -20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(15,10,30,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  arrowText:     { color: '#fff', fontSize: 22, fontWeight: '600' },
  pageDots: {
    position: 'absolute', bottom: 12, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  pageDot:       { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.45)' },
  pageDotActive: { backgroundColor: '#fff', width: 16, borderRadius: 3 },


  // ハートボタン
  favBtn: {
    position: 'absolute', top: 12, right: 12,
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6,
  },

  // ボディ
  body:        { padding: 16, gap: 8 },
  title:         { fontSize: 20, fontWeight: '800', color: '#1E0753', letterSpacing: -0.4, lineHeight: 26 },
  titleTappable: { textDecorationLine: 'underline', textDecorationColor: 'rgba(192,132,252,0.5)' },
  description: { fontSize: 13, color: '#9CA3AF', lineHeight: 18 },

  // AI相談のおすすめ理由ブロック
  aiReasonBox: {
    marginTop: 12,
    backgroundColor: '#F5F0FF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(155,107,255,0.18)',
    padding: 12,
  },
  aiReasonHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  aiReasonLabel: { fontSize: 11, fontWeight: '800', color: '#9B6BFF', letterSpacing: 0.3 },
  aiReasonText: { fontSize: 13, color: '#4B3B6B', lineHeight: 20, fontWeight: '500' },
  address:     { fontSize: 13, color: '#6B7280', lineHeight: 18 },

  // 評価 + 営業ピル row
  pillRow:    { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  ratingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFFBEB', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  ratingNum:  { fontSize: 13, fontWeight: '700', color: '#92400E' },
  pricePill:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#EDE9FE', borderWidth: 1, borderColor: '#DDD6FE' },
  priceText:  { fontSize: 12, fontWeight: '800', color: '#7C3AED' },
  ratingCount:{ fontSize: 12, color: '#B45309' },
  openPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1,
  },
  openDot:  { width: 7, height: 7, borderRadius: 3.5 },
  openText: { fontSize: 12, fontWeight: '700' },

  // 距離ピル（全幅）
  distPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#F9FAFB', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  distText: { flex: 1, fontSize: 13, color: '#374151', fontWeight: '500' },

  // 営業時間
  hoursRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  hoursText:{ flex: 1, fontSize: 13, color: '#6B7280', lineHeight: 20 },

  // タグ
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    backgroundColor: 'rgba(192,132,252,0.08)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.22)',
  },
  tagText: { fontSize: 12, fontWeight: '600', color: '#7C3AED' },

  divider: { height: 1, backgroundColor: 'rgba(192,132,252,0.12)', marginVertical: 2 },

  // アクションボタン
  actions:    { flexDirection: 'row', gap: 8 },
  mapBtn:     { flex: 1, borderRadius: 14, overflow: 'hidden' },
  mapBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 48, borderRadius: 14,
  },
  mapBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  visitedBtn: {
    paddingHorizontal: 14, height: 48, borderRadius: 14,
    backgroundColor: '#F9FAFB',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: 'rgba(192,132,252,0.35)',
  },
  visitedBtnDone:     { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
  visitedBtnText:     { fontSize: 13, fontWeight: '600', color: '#374151' },
  visitedBtnTextDone: { color: '#10B981' },
  hotpepperBtn: {
    paddingHorizontal: 12, height: 48, borderRadius: 14,
    backgroundColor: '#FFF5F5',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: '#FCA5A5',
  },
  hotpepperText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },

  // 気分
  moodQuestion:   { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 2 },
  moodRow:        { flexDirection: 'row', gap: 8, marginTop: 2 },
  moodMatchBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, borderRadius: 12,
    backgroundColor: '#ECFDF5', borderWidth: 1.5, borderColor: '#6EE7B7',
  },
  moodMatchText:    { fontSize: 13, fontWeight: '600', color: '#10B981' },
  moodNotMatchBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, borderRadius: 12,
    backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: '#FCA5A5',
  },
  moodNotMatchText: { fontSize: 13, fontWeight: '600', color: '#EF4444' },
  moodDoneRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  moodDoneText:     { fontSize: 13, fontWeight: '600' },

  // ソース
  sourceRow:  { marginBottom: 2 },
  sourceText: { fontSize: 11, color: '#A78BFA', fontWeight: '500' },

  // フッター
  footRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  footBtnShare: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  footRight:    { flexDirection: 'row', gap: 14, marginRight: 16 },
  footBtn:      { paddingVertical: 2 },
  footBtnText:  { fontSize: 12, color: COLORS.textMuted },
});
