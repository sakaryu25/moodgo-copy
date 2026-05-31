// ── PlaceCard ──────────────────────────────────────────────────────────────
// MoodGo UI: compact grid info + side-by-side action buttons + emoji mood
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Clock, Flag, Heart, MapPin, Navigation, Star, Train } from 'lucide-react-native';
import React, { useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Recommendation } from '@/types/app';
import { COLORS } from '@/constants/colors';

const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const BRAND = '#C084FC';

const T = {
  ja: {
    openNow:      '営業中',
    closedNow:    '閉店中',
    hours:        '営業時間',
    address:      '住所',
    station:      '最寄駅',
    mapBtn:       'googlemapで見る',
    igBtn:        'Instagramを見る',
    hide:         '表示しない',
    report:       '報告ボタン',
    share:        '共有',
    reviewCount:  (n: number) => `(${n.toLocaleString('ja-JP')}件)`,
    visited:      '行った！',
    visitedDone:  '✓ 行った',
    moodMatch:    '気分に合う',
    moodNotMatch: '気分に合わない',
    moodMatchDone:    '👍 気分に合う！と評価しました',
    moodNotMatchDone: '👎 気分には合わないと評価しました',
    placeName:    '場所名',
  },
  en: {
    openNow:      'Open',
    closedNow:    'Closed',
    hours:        'Hours',
    address:      'Address',
    station:      'Station',
    mapBtn:       'Google Maps',
    igBtn:        'Instagram',
    hide:         'Hide',
    report:       'Report',
    share:        'Share',
    reviewCount:  (n: number) => `(${n.toLocaleString('en-US')} reviews)`,
    visited:      'Been there!',
    visitedDone:  '✓ Visited',
    moodMatch:    'Matches mood',
    moodNotMatch: "Doesn't match",
    moodMatchDone:    '👍 Marked as mood match!',
    moodNotMatchDone: '👎 Marked as not matching',
    placeName:    'Place',
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
};

export default function PlaceCard({
  item, isFavorited, onToggleFavorite, onBlock, onReport, onMarkVisited, isVisited = false,
  accentColor = COLORS.primary, lang = 'ja',
  moodRating, onMoodMatch, onMoodNotMatch,
}: Props) {
  const t = T[lang];
  const photos = (item.photoUrls ?? []).length > 0
    ? item.photoUrls!
    : item.photoUrl ? [item.photoUrl] : [];
  const [photoIdx, setPhotoIdx] = useState(0);

  const heartScale = useRef(new Animated.Value(1)).current;
  const pulseHeart = () => {
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.35, useNativeDriver: true, mass: 1, damping: 8,  stiffness: 300 }),
      Animated.spring(heartScale, { toValue: 1,    useNativeDriver: true, mass: 1, damping: 12, stiffness: 200 }),
    ]).start();
  };

  const openNowColor =
    item.openNow === true  ? '#10B981' :
    item.openNow === false ? '#EF4444' : '#9CA3AF';
  const openNowLabel =
    item.openNow === true  ? t.openNow :
    item.openNow === false ? t.closedNow : '';

  const handleShare = () => {
    const parts = [item.title];
    if (item.address) parts.push(item.address);
    if (item.mapUrl)  parts.push(item.mapUrl);
    Share.share({ message: parts.join('\n') });
  };

  const handleInstagram = () => {
    const q = encodeURIComponent(item.title);
    Linking.openURL(`https://www.instagram.com/explore/search/keyword/?q=${q}`).catch(() =>
      Linking.openURL(`https://www.instagram.com/explore/tags/${q}`)
    );
  };

  return (
    <View style={s.card}>

      {/* ── 写真エリア ────────────────────────────── */}
      <View style={s.photoWrap}>
        {photos.length > 0 ? (
          <Image source={{ uri: photos[photoIdx] }} style={s.photo} contentFit="cover" transition={300} />
        ) : (
          <LinearGradient colors={['#F5F0FF', '#EDE9FE']} style={[s.photo, s.photoPlaceholder]}>
            <MapPin size={40} color={BRAND} strokeWidth={1.5} />
          </LinearGradient>
        )}

        {/* 下グラデーション */}
        <LinearGradient
          colors={['transparent', 'rgba(10,5,25,0.4)']}
          style={s.photoOverlay}
          pointerEvents="none"
        />

        {/* 写真ページング */}
        {photos.length > 1 && (
          <>
            {photoIdx > 0 && (
              <TouchableOpacity onPress={() => setPhotoIdx((i) => i - 1)} style={[s.arrowBtn, { left: 10 }]}>
                <Text style={s.arrowText}>‹</Text>
              </TouchableOpacity>
            )}
            {photoIdx < photos.length - 1 && (
              <TouchableOpacity onPress={() => setPhotoIdx((i) => i + 1)} style={[s.arrowBtn, { right: 10 }]}>
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

        {/* 🚩 報告バッジ — top-left */}
        {onReport && (
          <TouchableOpacity onPress={onReport} style={s.reportBadge} activeOpacity={0.8}>
            <Flag size={11} color="#374151" strokeWidth={2.5} />
            <Text style={s.reportBadgeText}>{t.report}</Text>
          </TouchableOpacity>
        )}

        {/* ❤️ ハート — top-right */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(isFavorited ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
            pulseHeart();
            onToggleFavorite();
          }}
          style={[s.favBtn, isFavorited && s.favBtnActive]}
          activeOpacity={0.9}
        >
          <Animated.View style={{ transform: [{ scale: heartScale }] }}>
            <Heart
              size={18}
              color={isFavorited ? BRAND : '#374151'}
              fill={isFavorited ? BRAND : 'none'}
              strokeWidth={2}
            />
          </Animated.View>
        </TouchableOpacity>

        {/* 👣 行った！— bottom-right */}
        {onMarkVisited && (
          <TouchableOpacity
            onPress={isVisited ? undefined : onMarkVisited}
            style={[s.visitedPhotoBtn, isVisited && s.visitedPhotoBtnDone]}
            activeOpacity={0.85}
          >
            <Text style={s.visitedPhotoBtnIcon}>{isVisited ? '✓' : '👣'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── ボディ ────────────────────────────────── */}
      <View style={s.body}>

        {/* 場所名ラベル + タイトル */}
        <Text style={s.placeLabel}>{t.placeName}</Text>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>

        {/* ── 3列情報グリッド ── */}
        <View style={s.grid}>
          {/* 行1 */}
          <View style={s.gridRow}>
            {/* 住所 */}
            <View style={s.gridCell}>
              {item.address ? (
                <Text style={s.gridValSmall} numberOfLines={2}>{item.address}</Text>
              ) : <Text style={s.gridValSmall}>—</Text>}
            </View>
            {/* 営業状態 */}
            <View style={[s.gridCell, s.gridCellCenter]}>
              {openNowLabel ? (
                <View style={s.openStatus}>
                  <View style={[s.openDot, { backgroundColor: openNowColor }]} />
                  <Text style={[s.openStatusText, { color: openNowColor }]}>{openNowLabel}</Text>
                </View>
              ) : null}
            </View>
            {/* 営業時間ヘッダ */}
            <View style={[s.gridCell, s.gridCellRight]}>
              {item.openingHoursText ? (
                <>
                  <Text style={s.gridHeader}>{t.hours}</Text>
                  <Text style={s.gridVal} numberOfLines={2}>{item.openingHoursText}</Text>
                </>
              ) : null}
            </View>
          </View>

          {/* 区切り線 */}
          <View style={s.gridDivider} />

          {/* 行2 */}
          <View style={s.gridRow}>
            {/* 評価 */}
            <View style={s.gridCell}>
              {item.rating != null ? (
                <View style={s.ratingRow}>
                  <Star size={13} color="#F59E0B" fill="#F59E0B" strokeWidth={0} />
                  <Text style={s.ratingNum}>{item.rating.toFixed(1)}</Text>
                  {item.userRatingCount ? (
                    <Text style={s.ratingCount}>{t.reviewCount(item.userRatingCount)}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
            {/* 最寄り駅 / 距離 */}
            <View style={[s.gridCell, s.gridCellCenter]}>
              {item.stationText ? (
                <Text style={s.gridValSmall}>{item.stationText}</Text>
              ) : item.distanceText ? (
                <Text style={s.gridValSmall}>{item.distanceText}</Text>
              ) : null}
            </View>
            {/* 3列目は空 */}
            <View style={s.gridCell} />
          </View>
        </View>

        {/* タグ */}
        {item.features && item.features.length > 0 && (
          <View style={s.tagRow}>
            {item.features.slice(0, 4).map((f, i) => (
              <View key={i} style={s.tag}>
                <Text style={s.tagText}>{f}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── アクションボタン: Map + Instagram ── */}
        <View style={s.actionRow}>
          {item.mapUrl ? (
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Linking.openURL(item.mapUrl!); }}
              style={s.pillBtn}
              activeOpacity={0.8}
            >
              <Text style={s.pillBtnIcon}>🗺</Text>
              <Text style={s.pillBtnText}>{t.mapBtn}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={handleInstagram} style={s.pillBtn} activeOpacity={0.8}>
            <Text style={s.pillBtnIcon}>📸</Text>
            <Text style={s.pillBtnText}>{t.igBtn}</Text>
          </TouchableOpacity>
        </View>

        {/* ── 気分ボタン ── */}
        {(onMoodMatch || onMoodNotMatch) && (
          moodRating ? (
            <View style={s.moodDoneRow}>
              <Text style={[s.moodDoneText, { color: moodRating === 'good' ? '#10B981' : '#E11D48' }]}>
                {moodRating === 'good' ? t.moodMatchDone : t.moodNotMatchDone}
              </Text>
            </View>
          ) : (
            <View style={s.moodRow}>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onMoodMatch?.(); }}
                style={s.moodBtn}
                activeOpacity={0.8}
              >
                <View style={[s.moodCircle, s.moodCircleGood]}>
                  <Text style={s.moodEmoji}>😊</Text>
                </View>
                <Text style={[s.moodLabel, { color: '#16A34A' }]}>{t.moodMatch}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onMoodNotMatch?.(); }}
                style={s.moodBtn}
                activeOpacity={0.8}
              >
                <View style={[s.moodCircle, s.moodCircleBad]}>
                  <Text style={s.moodEmoji}>😞</Text>
                </View>
                <Text style={[s.moodLabel, { color: '#E11D48' }]}>{t.moodNotMatch}</Text>
              </TouchableOpacity>
            </View>
          )
        )}

        {/* ホットペッパー */}
        {item.hotpepperUrl ? (
          <TouchableOpacity
            onPress={() => Linking.openURL(item.hotpepperUrl!)}
            style={s.hotpepperBtn}
            activeOpacity={0.8}
          >
            <Text style={s.hotpepperText}>🌶 ホットペッパーで予約</Text>
          </TouchableOpacity>
        ) : null}

        {/* フッター（共有・表示しない） */}
        <View style={s.footer}>
          <TouchableOpacity onPress={handleShare} style={s.footBtn} activeOpacity={0.7}>
            <Text style={s.footBtnText}>共有</Text>
          </TouchableOpacity>
          {onBlock && (
            <TouchableOpacity onPress={onBlock} style={s.footBtn} activeOpacity={0.7}>
              <Text style={s.footBtnText}>表示しない</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // ── カード本体 ──
  card: {
    backgroundColor: '#fff',
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#9B6BFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.09,
    shadowRadius: 18,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(192,132,252,0.12)',
  },

  // ── 写真 ──
  photoWrap:       { position: 'relative' },
  photo:           { width: '100%', height: 200 },
  photoPlaceholder:{ alignItems: 'center', justifyContent: 'center' },
  photoOverlay:    { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },

  arrowBtn: {
    position: 'absolute', top: '50%', marginTop: -18,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(15,10,30,0.36)',
    alignItems: 'center', justifyContent: 'center',
  },
  arrowText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  pageDots: {
    position: 'absolute', bottom: 10, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  pageDot:       { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.4)' },
  pageDotActive: { backgroundColor: '#fff', width: 14, borderRadius: 3 },

  // 報告バッジ（top-left）— 白ピル
  reportBadge: {
    position: 'absolute', top: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4,
  },
  reportBadgeText: { fontSize: 12, fontWeight: '700', color: '#374151' },

  // ハートボタン（top-right）— 白丸
  favBtn: {
    position: 'absolute', top: 12, right: 12,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4,
  },
  favBtnActive: { backgroundColor: 'rgba(255,255,255,0.96)' },

  // 行ったボタン（bottom-right）— 白丸
  visitedPhotoBtn: {
    position: 'absolute', bottom: 12, right: 12,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4,
  },
  visitedPhotoBtnDone: { backgroundColor: 'rgba(236,253,245,0.95)' },
  visitedPhotoBtnIcon: { fontSize: 18 },

  // ── ボディ ──
  body:       { padding: 16, gap: 10 },
  placeLabel: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', letterSpacing: 0.3 },
  title:      { fontSize: 19, fontWeight: '800', color: '#1E0753', letterSpacing: -0.3, lineHeight: 24 },

  // ── 3列グリッド ──
  grid:        { borderWidth: 1, borderColor: 'rgba(192,132,252,0.15)', borderRadius: 14, overflow: 'hidden' },
  gridRow:     { flexDirection: 'row' },
  gridDivider: { height: 1, backgroundColor: 'rgba(192,132,252,0.12)' },
  gridCell:    { flex: 1, padding: 10, gap: 3 },
  gridCellCenter: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(192,132,252,0.12)' },
  gridCellRight:  {},
  gridHeader:  { fontSize: 10, fontWeight: '700', color: '#A78BFA', letterSpacing: 0.3 },
  gridVal:     { fontSize: 12, fontWeight: '600', color: '#374151', lineHeight: 16 },
  gridValSmall:{ fontSize: 12, color: '#6B7280', lineHeight: 16 },

  // 営業状態
  openStatus:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  openDot:        { width: 7, height: 7, borderRadius: 3.5 },
  openStatusText: { fontSize: 13, fontWeight: '800' },

  // 評価
  ratingRow:  { flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap' },
  ratingNum:  { fontSize: 13, fontWeight: '700', color: '#92400E' },
  ratingCount:{ fontSize: 11, color: '#B45309' },

  // タグ
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7,
    backgroundColor: 'rgba(192,132,252,0.08)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.22)',
  },
  tagText: { fontSize: 11, fontWeight: '600', color: '#7C3AED' },

  // ── アクションボタン（横並び・ピル型） ──
  actionRow: { flexDirection: 'row', gap: 8 },
  pillBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F8F7FF', borderRadius: 12,
    paddingVertical: 11, paddingHorizontal: 8,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.22)',
  },
  pillBtnIcon: { fontSize: 15 },
  pillBtnText: { fontSize: 12, fontWeight: '700', color: '#374151' },

  // ── 気分ボタン ──
  moodRow: { flexDirection: 'row', justifyContent: 'center', gap: 32 },
  moodBtn: { alignItems: 'center', gap: 6 },
  moodCircle: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
  },
  moodCircleGood: { backgroundColor: '#F0FDF4', borderColor: '#86EFAC' },
  moodCircleBad:  { backgroundColor: '#FFF1F2', borderColor: '#FECDD3' },
  moodEmoji: { fontSize: 24 },
  moodLabel: { fontSize: 12, fontWeight: '700' },
  moodDoneRow: {
    alignItems: 'center', paddingVertical: 12,
    backgroundColor: '#F9FAFB', borderRadius: 12,
  },
  moodDoneText: { fontSize: 13, fontWeight: '700' },

  // ホットペッパー
  hotpepperBtn: {
    borderRadius: 12, paddingVertical: 12, alignItems: 'center',
    backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: '#FCA5A5',
  },
  hotpepperText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },

  // フッター
  footer:    { flexDirection: 'row', gap: 16, justifyContent: 'flex-end', paddingTop: 2 },
  footBtn:   { paddingVertical: 2 },
  footBtnText: { fontSize: 12, color: '#9CA3AF' },
});
