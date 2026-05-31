// ── PlaceCard ──────────────────────────────────────────────────────────────
// UI UX Pro Max: Purple brand + Glassmorphism badge + Spring press
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Clock, Heart, MapPin, Navigation, Share2, Star, Train, ThumbsUp, ThumbsDown } from 'lucide-react-native';
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

const T = {
  ja: {
    openNow: '営業中',
    closedNow: '閉店中',
    mapBtn: 'マップで見る',
    hide: '表示しない',
    report: '報告する',
    share: '共有',
    reviewCount: (n: number) => `(${n.toLocaleString('ja-JP')}件)`,
    visited: '行った！',
    visitedDone: '✓ 行った',
    moodMatch: 'この気分に合う',
    moodNotMatch: '気分には合わない',
    moodMatchDone: '👍 気分に合う！と評価しました',
    moodNotMatchDone: '👎 気分には合わないと評価しました',
  },
  en: {
    openNow: 'Open',
    closedNow: 'Closed',
    mapBtn: 'View on map',
    hide: 'Hide',
    report: 'Report',
    share: 'Share',
    reviewCount: (n: number) => `(${n.toLocaleString('en-US')} reviews)`,
    visited: 'Been there!',
    visitedDone: '✓ Visited',
    moodMatch: 'Matches my mood',
    moodNotMatch: "Doesn't match",
    moodMatchDone: '👍 Marked as mood match!',
    moodNotMatchDone: '👎 Marked as not matching',
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

  // スプリングプレスアニメーション
  const scale = useRef(new Animated.Value(1)).current;
  const handlePressIn  = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, mass: 1, damping: 20, stiffness: 300 }).start();
  const handlePressOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, mass: 1, damping: 15, stiffness: 200 }).start();

  // Heart pulse
  const heartScale = useRef(new Animated.Value(1)).current;
  const pulseHeart = () => {
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.35, useNativeDriver: true, mass: 1, damping: 8, stiffness: 300 }),
      Animated.spring(heartScale, { toValue: 1,    useNativeDriver: true, mass: 1, damping: 12, stiffness: 200 }),
    ]).start();
  };

  const openNowColor =
    item.openNow === true  ? '#10B981' :
    item.openNow === false ? '#EF4444' : COLORS.textMuted;
  const openNowLabel =
    item.openNow === true  ? t.openNow :
    item.openNow === false ? t.closedNow : '';

  const handleShare = () => {
    const parts = [item.title];
    if (item.address) parts.push(item.address);
    if (item.mapUrl)  parts.push(item.mapUrl);
    Share.share({ message: parts.join('\n') });
  };

  return (
    <Animated.View style={[s.card, { transform: [{ scale }] }]}>
      {/* Photo */}
      <View style={s.photoWrap}>
        {photos.length > 0 ? (
          <Image
            source={{ uri: photos[photoIdx] }}
            style={s.photo}
            contentFit="cover"
            transition={300}
          />
        ) : (
          <LinearGradient
            colors={['#FFF0F3', '#FFE4E6']}
            style={[s.photo, s.photoPlaceholder]}
          >
            <Navigation size={36} color={COLORS.primary} strokeWidth={1.5} />
          </LinearGradient>
        )}

        {/* 下グラデーションオーバーレイ */}
        <LinearGradient
          colors={['transparent', 'rgba(15,10,30,0.55)']}
          style={s.photoOverlay}
          pointerEvents="none"
        />

        {/* Photo nav */}
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
            {/* ページドット */}
            <View style={s.pageDots}>
              {photos.map((_, i) => (
                <View key={i} style={[s.pageDot, i === photoIdx && s.pageDotActive]} />
              ))}
            </View>
          </>
        )}

        {/* Fav button（パルスアニメーション） */}
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
              color={isFavorited ? '#fff' : COLORS.primary}
              fill={isFavorited ? '#fff' : 'none'}
              strokeWidth={2}
            />
          </Animated.View>
        </TouchableOpacity>

        {/* 営業中バッジ（グラスモーフィズム） */}
        {item.openNow !== undefined && openNowLabel ? (
          <View style={[s.openBadge, { borderColor: openNowColor + '40' }]}>
            <View style={[s.openDot, { backgroundColor: openNowColor }]} />
            <Text style={[s.openText, { color: openNowColor }]}>{openNowLabel}</Text>
          </View>
        ) : null}
      </View>

      {/* Body */}
      <View style={s.body}>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>

        {/* 評価行 */}
        {item.rating != null && (
          <View style={s.ratingRow}>
            <Star size={14} color="#F59E0B" fill="#F59E0B" />
            <Text style={s.ratingText}>{item.rating.toFixed(1)}</Text>
            {item.userRatingCount ? (
              <Text style={s.ratingCount}>{t.reviewCount(item.userRatingCount)}</Text>
            ) : null}
          </View>
        )}

        {/* 住所 */}
        {item.address ? (
          <View style={s.infoRow}>
            <MapPin size={13} color={COLORS.textMuted} strokeWidth={2} />
            <Text style={s.infoText} numberOfLines={1}>{item.address}</Text>
          </View>
        ) : null}

        {/* 距離 */}
        {item.distanceText ? (
          <View style={s.infoRow}>
            <Navigation size={13} color={COLORS.textMuted} strokeWidth={2} />
            <Text style={s.infoText}>{item.distanceText}{item.durationText ? `  ·  ${item.durationText}` : ''}</Text>
          </View>
        ) : null}

        {/* 最寄り駅 */}
        {item.stationText ? (
          <View style={s.infoRow}>
            <Train size={13} color={COLORS.textMuted} strokeWidth={2} />
            <Text style={s.infoText}>{item.stationText}</Text>
          </View>
        ) : null}

        {/* 営業時間 */}
        {item.openingHoursText ? (
          <View style={s.infoRow}>
            <Clock size={13} color={COLORS.textMuted} strokeWidth={2} />
            <Text style={s.infoText} numberOfLines={1}>{item.openingHoursText}</Text>
          </View>
        ) : null}

        {/* タグ（パープルtinted） */}
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

        {/* ボタン行 */}
        <View style={s.actions}>
          {item.mapUrl ? (
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Linking.openURL(item.mapUrl!);
              }}
              style={s.mapBtn}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              activeOpacity={0.9}
            >
              <LinearGradient
                colors={['#F43F5E', '#FB923C']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.mapBtnGrad}
              >
                <MapPin size={15} color="#fff" strokeWidth={2.5} />
                <Text style={s.mapBtnText}>{t.mapBtn}</Text>
              </LinearGradient>
            </TouchableOpacity>
          ) : null}
          {item.hotpepperUrl ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(item.hotpepperUrl!)}
              style={[s.mapBtn, { backgroundColor: '#CC0000', borderRadius: 14 }]}
              activeOpacity={0.8}
            >
              <Text style={s.mapBtnText}>ホットペッパー</Text>
            </TouchableOpacity>
          ) : null}
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
          ) : null}
        </View>

        {/* 気分ボタン */}
        {(onMoodMatch || onMoodNotMatch) && (
          moodRating ? (
            <View style={s.moodDoneRow}>
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
          )
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
    // インスタ風・自然なシャドウ
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // Photo
  photoWrap: { position: 'relative' },
  photo: { width: '100%', height: 220 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoOverlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 80,
  },
  arrowBtn: {
    position: 'absolute', top: '50%', marginTop: -20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(15,10,30,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  arrowText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  pageDots: {
    position: 'absolute', bottom: 12, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  pageDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.45)' },
  pageDotActive: { backgroundColor: '#fff', width: 16, borderRadius: 3 },

  favBtn: {
    position: 'absolute', top: 14, right: 14,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6,
  },
  favBtnActive: { backgroundColor: COLORS.primary },

  // グラスモーフィズムバッジ
  openBadge: {
    position: 'absolute', bottom: 14, left: 14,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
  },
  openDot: { width: 7, height: 7, borderRadius: 3.5 },
  openText: { fontSize: 12, fontWeight: '700' },

  // Body
  body: { padding: 18, gap: 7 },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.text, letterSpacing: -0.4, lineHeight: 26 },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ratingText: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  ratingCount: { fontSize: 13, fontWeight: '400', color: COLORS.textSub },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  infoText: { flex: 1, fontSize: 13, color: COLORS.textSub, lineHeight: 18 },

  // パープルtintedタグ
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: COLORS.muted,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tagText: { fontSize: 12, fontWeight: '600', color: COLORS.primary },

  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 4 },

  // ボタン
  actions: { flexDirection: 'row', gap: 8 },
  mapBtn: { flex: 1, borderRadius: 14, overflow: 'hidden' },
  mapBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 48, borderRadius: 14,
  },
  mapBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  visitedBtn: {
    paddingHorizontal: 16, height: 48, borderRadius: 14,
    backgroundColor: COLORS.muted, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  visitedBtnDone: { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
  visitedBtnText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  visitedBtnTextDone: { color: '#10B981' },

  // 気分ボタン
  moodRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  moodMatchBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, borderRadius: 12,
    backgroundColor: '#ECFDF5', borderWidth: 1.5, borderColor: '#6EE7B7',
  },
  moodMatchText: { fontSize: 13, fontWeight: '600', color: '#10B981' },
  moodNotMatchBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, borderRadius: 12,
    backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: '#FCA5A5',
  },
  moodNotMatchText: { fontSize: 13, fontWeight: '600', color: '#EF4444' },
  moodDoneRow: { alignItems: 'center', paddingVertical: 8 },
  moodDoneText: { fontSize: 13, fontWeight: '600' },

  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  footBtnShare: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  footRight: { flexDirection: 'row', gap: 14 },
  footBtn: { paddingVertical: 2 },
  footBtnText: { fontSize: 12, color: COLORS.textMuted },
});
