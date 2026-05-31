// ── PlaceCard ──────────────────────────────────────────────────────────────
// MoodGo UI: Gradient brand + App-native layout + Instagram integration
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Clock, Flag, Heart, MapPin, Navigation,
  Share2, Star, Train, ThumbsUp, ThumbsDown,
} from 'lucide-react-native';
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

// MoodGo brand
const GRAD: [string, string, string]    = ['#F472B6', '#C084FC', '#60A5FA'];
const IG_GRAD: [string, string, string] = ['#833AB4', '#C13584', '#F77737'];
const BRAND = '#C084FC';

const T = {
  ja: {
    openNow: '営業中',
    closedNow: '閉店中',
    mapBtn: 'Googleマップで見る',
    igBtn: 'Instagramで検索する',
    hide: '表示しない',
    report: '報告',
    share: '共有',
    reviewCount: (n: number) => `(${n.toLocaleString('ja-JP')}件)`,
    visited: '行った！',
    visitedDone: '✓ 行った',
    moodMatch: 'この気分に合う',
    moodNotMatch: '気分には合わない',
    moodMatchDone: '気分に合う！と評価しました',
    moodNotMatchDone: '気分には合わないと評価しました',
  },
  en: {
    openNow: 'Open',
    closedNow: 'Closed',
    mapBtn: 'Google Maps',
    igBtn: 'Search Instagram',
    hide: 'Hide',
    report: 'Report',
    share: 'Share',
    reviewCount: (n: number) => `(${n.toLocaleString('en-US')} reviews)`,
    visited: 'Been there!',
    visitedDone: '✓ Visited',
    moodMatch: 'Matches my mood',
    moodNotMatch: "Doesn't match",
    moodMatchDone: 'Marked as mood match!',
    moodNotMatchDone: 'Marked as not matching',
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

  const scale = useRef(new Animated.Value(1)).current;
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
    <Animated.View style={[s.card, { transform: [{ scale }] }]}>

      {/* ── Photo ─────────────────────────────────────── */}
      <View style={s.photoWrap}>
        {photos.length > 0 ? (
          <Image
            source={{ uri: photos[photoIdx] }}
            style={s.photo}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <LinearGradient colors={['#F5F0FF', '#EDE9FE']} style={[s.photo, s.photoPlaceholder]}>
            <MapPin size={40} color={BRAND} strokeWidth={1.5} />
          </LinearGradient>
        )}

        {/* Bottom overlay */}
        <LinearGradient
          colors={['transparent', 'rgba(10,5,25,0.5)']}
          style={s.photoOverlay}
          pointerEvents="none"
        />

        {/* Arrow nav */}
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

        {/* 報告バッジ — top left */}
        {onReport && (
          <TouchableOpacity onPress={onReport} style={s.reportBadge} activeOpacity={0.8}>
            <Flag size={10} color="#fff" strokeWidth={2.5} />
            <Text style={s.reportBadgeText}>{t.report}</Text>
          </TouchableOpacity>
        )}

        {/* ハートボタン — top right */}
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
              color={isFavorited ? '#fff' : BRAND}
              fill={isFavorited ? '#fff' : 'none'}
              strokeWidth={2}
            />
          </Animated.View>
        </TouchableOpacity>

        {/* 営業バッジ — bottom left */}
        {openNowLabel ? (
          <View style={[s.openBadge, { borderColor: openNowColor + '50' }]}>
            <View style={[s.openDot, { backgroundColor: openNowColor }]} />
            <Text style={[s.openText, { color: openNowColor }]}>{openNowLabel}</Text>
          </View>
        ) : null}
      </View>

      {/* ── Body ──────────────────────────────────────── */}
      <View style={s.body}>

        {/* タイトル */}
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>

        {/* 評価 + 営業状況 */}
        <View style={s.metaRow}>
          {item.rating != null && (
            <View style={s.ratingPill}>
              <Star size={12} color="#F59E0B" fill="#F59E0B" strokeWidth={0} />
              <Text style={s.ratingNum}>{item.rating.toFixed(1)}</Text>
              {item.userRatingCount ? (
                <Text style={s.ratingCount}>{t.reviewCount(item.userRatingCount)}</Text>
              ) : null}
            </View>
          )}
          {openNowLabel ? (
            <View style={[s.statusPill, { backgroundColor: openNowColor + '18', borderColor: openNowColor + '50' }]}>
              <View style={[s.statusDot, { backgroundColor: openNowColor }]} />
              <Text style={[s.statusText, { color: openNowColor }]}>{openNowLabel}</Text>
            </View>
          ) : null}
        </View>

        {/* 住所 */}
        {item.address ? (
          <View style={s.infoRow}>
            <MapPin size={13} color="#9CA3AF" strokeWidth={2} />
            <Text style={s.infoText} numberOfLines={2}>{item.address}</Text>
          </View>
        ) : null}

        {/* 最寄り駅 */}
        {item.stationText ? (
          <View style={s.infoRow}>
            <Train size={13} color="#9CA3AF" strokeWidth={2} />
            <Text style={s.infoText}>{item.stationText}</Text>
          </View>
        ) : null}

        {/* 距離 */}
        {item.distanceText && !item.stationText ? (
          <View style={s.infoRow}>
            <Navigation size={13} color="#9CA3AF" strokeWidth={2} />
            <Text style={s.infoText}>
              {item.distanceText}{item.durationText ? `  ·  ${item.durationText}` : ''}
            </Text>
          </View>
        ) : null}

        {/* 営業時間 */}
        {item.openingHoursText ? (
          <View style={s.infoRow}>
            <Clock size={13} color="#9CA3AF" strokeWidth={2} />
            <Text style={s.infoText} numberOfLines={1}>{item.openingHoursText}</Text>
          </View>
        ) : null}

        {/* タグ */}
        {item.features && item.features.length > 0 && (
          <View style={s.tagRow}>
            {item.features.map((f, i) => (
              <View key={i} style={s.tag}>
                <Text style={s.tagText}>{f}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.divider} />

        {/* ── ボタン: Googleマップ + Instagram ── */}
        <View style={s.actionCol}>
          {item.mapUrl ? (
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Linking.openURL(item.mapUrl!); }}
              style={s.actionBtn}
              activeOpacity={0.88}
            >
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionBtnInner}>
                <MapPin size={15} color="#fff" strokeWidth={2.5} />
                <Text style={s.actionBtnText}>{t.mapBtn}</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity onPress={handleInstagram} style={s.actionBtn} activeOpacity={0.88}>
            <LinearGradient colors={IG_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionBtnInner}>
              <Text style={s.actionBtnIcon}>📸</Text>
              <Text style={s.actionBtnText}>{t.igBtn}</Text>
            </LinearGradient>
          </TouchableOpacity>

          {item.hotpepperUrl ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(item.hotpepperUrl!)}
              style={s.hotpepperBtn}
              activeOpacity={0.8}
            >
              <Text style={s.hotpepperText}>🌶 ホットペッパーで予約</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* 行った！ + 共有/非表示 */}
        <View style={s.secondRow}>
          {onMarkVisited ? (
            <TouchableOpacity
              onPress={isVisited ? undefined : onMarkVisited}
              style={[s.visitedBtn, isVisited && s.visitedBtnDone]}
              activeOpacity={0.8}
            >
              <Text style={[s.visitedBtnText, isVisited && s.visitedBtnTextDone]}>
                {isVisited ? t.visitedDone : t.visited}
              </Text>
            </TouchableOpacity>
          ) : <View />}
          <View style={s.subActions}>
            <TouchableOpacity onPress={handleShare} style={s.subBtn} activeOpacity={0.7}>
              <Share2 size={13} color="#9CA3AF" strokeWidth={2} />
              <Text style={s.subBtnText}>{t.share}</Text>
            </TouchableOpacity>
            {onBlock && (
              <TouchableOpacity onPress={onBlock} style={s.subBtn} activeOpacity={0.7}>
                <Text style={s.subBtnText}>{t.hide}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 気分ボタン */}
        {(onMoodMatch || onMoodNotMatch) && (
          moodRating ? (
            <View style={s.moodDoneRow}>
              <Text style={[s.moodDoneText, { color: moodRating === 'good' ? '#10B981' : '#E11D48' }]}>
                {moodRating === 'good' ? `👍 ${t.moodMatchDone}` : `👎 ${t.moodNotMatchDone}`}
              </Text>
            </View>
          ) : (
            <View style={s.moodRow}>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onMoodMatch?.(); }}
                style={s.moodMatchBtn}
                activeOpacity={0.8}
              >
                <ThumbsUp size={14} color="#16A34A" strokeWidth={2} />
                <Text style={s.moodMatchText}>{t.moodMatch}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onMoodNotMatch?.(); }}
                style={s.moodNotMatchBtn}
                activeOpacity={0.8}
              >
                <ThumbsDown size={14} color="#E11D48" strokeWidth={2} />
                <Text style={s.moodNotMatchText}>{t.moodNotMatch}</Text>
              </TouchableOpacity>
            </View>
          )
        )}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // ── Card ──
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#9B6BFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(192,132,252,0.12)',
  },

  // ── Photo ──
  photoWrap: { position: 'relative' },
  photo: { width: '100%', height: 220 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 90 },
  arrowBtn: {
    position: 'absolute', top: '50%', marginTop: -19,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(15,10,30,0.38)',
    alignItems: 'center', justifyContent: 'center',
  },
  arrowText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  pageDots: {
    position: 'absolute', bottom: 12, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  pageDot:       { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.38)' },
  pageDotActive: { backgroundColor: '#fff', width: 16, borderRadius: 3 },

  // 報告バッジ (top-left)
  reportBadge: {
    position: 'absolute', top: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(239,68,68,0.88)',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
  },
  reportBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },

  // ハートボタン (top-right)
  favBtn: {
    position: 'absolute', top: 12, right: 12,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6,
  },
  favBtnActive: { backgroundColor: BRAND },

  // 営業バッジ (bottom-left)
  openBadge: {
    position: 'absolute', bottom: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.88)', borderWidth: 1,
  },
  openDot:  { width: 7, height: 7, borderRadius: 3.5 },
  openText: { fontSize: 12, fontWeight: '700' },

  // ── Body ──
  body:  { padding: 18, gap: 9 },
  title: { fontSize: 20, fontWeight: '800', color: '#1E0753', letterSpacing: -0.4, lineHeight: 26 },

  // 評価 + 営業 row
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  ratingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFFBEB', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  ratingNum:   { fontSize: 13, fontWeight: '700', color: '#92400E' },
  ratingCount: { fontSize: 12, color: '#B45309', fontWeight: '400' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1,
  },
  statusDot:  { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },

  // Info rows
  infoRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  infoText: { flex: 1, fontSize: 13, color: '#6B7280', lineHeight: 18 },

  // Tags
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    backgroundColor: 'rgba(192,132,252,0.08)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.25)',
  },
  tagText: { fontSize: 12, fontWeight: '600', color: '#7C3AED' },

  divider: { height: 1, backgroundColor: 'rgba(192,132,252,0.15)', marginVertical: 2 },

  // ── Action buttons ──
  actionCol:     { flexDirection: 'column', gap: 9 },
  actionBtn:     { borderRadius: 14, overflow: 'hidden' },
  actionBtnInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 50, borderRadius: 14,
  },
  actionBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  actionBtnIcon: { fontSize: 16 },

  hotpepperBtn: {
    borderRadius: 12, paddingVertical: 12, alignItems: 'center',
    backgroundColor: '#FFF5F5', borderWidth: 1, borderColor: '#FCA5A5',
  },
  hotpepperText: { fontSize: 14, fontWeight: '700', color: '#DC2626' },

  // Visited + sub actions
  secondRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  visitedBtn: {
    paddingHorizontal: 16, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(192,132,252,0.08)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(192,132,252,0.3)',
  },
  visitedBtnDone:     { backgroundColor: '#ECFDF5', borderColor: '#6EE7B7' },
  visitedBtnText:     { fontSize: 13, fontWeight: '600', color: '#7C3AED' },
  visitedBtnTextDone: { color: '#10B981' },
  subActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  subBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 },
  subBtnText: { fontSize: 12, color: '#9CA3AF' },

  // 気分ボタン
  moodRow: { flexDirection: 'row', gap: 8 },
  moodMatchBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 46, borderRadius: 14,
    backgroundColor: '#F0FDF4', borderWidth: 1.5, borderColor: '#86EFAC',
  },
  moodMatchText: { fontSize: 13, fontWeight: '700', color: '#16A34A' },
  moodNotMatchBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 46, borderRadius: 14,
    backgroundColor: '#FFF1F2', borderWidth: 1.5, borderColor: '#FECDD3',
  },
  moodNotMatchText: { fontSize: 13, fontWeight: '700', color: '#E11D48' },
  moodDoneRow: {
    alignItems: 'center', paddingVertical: 10,
    backgroundColor: '#F9FAFB', borderRadius: 12,
  },
  moodDoneText: { fontSize: 13, fontWeight: '700' },
});
