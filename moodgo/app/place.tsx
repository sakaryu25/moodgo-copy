// ── app/place.tsx ─────────────────────────────────────────────────────────────
// 場所詳細ページ（フルスクリーン）
// selectedPlace ストアから Recommendation を読み出して表示し、
// placeId があれば /api/place-detail から追加情報（電話・サイト等）を取得。

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import {
  ArrowLeft, Clock, ExternalLink, Globe, Heart, MapPin,
  Navigation, Phone, Share2, Star, Train,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSelectedPlace } from '@/lib/selectedPlace';
import { API_BASE } from '@/lib/api';
import type { Recommendation } from '@/types/app';

const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const GRAD_DARK: [string, string] = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.65)'];

const DAY_ORDER = ['月', '火', '水', '木', '金', '土', '日'];

function formatOpeningHours(text: string): { label: string; time: string }[] {
  const lines = text
    .split(/\n|、(?=[月火水木金土日]曜)/)
    .map(l => l.trim().replace(/。$/, ''))
    .filter(Boolean);

  if (lines.length < 2) return [{ label: '', time: text }];

  type Entry = { day: string; hours: string };
  const parsed: Entry[] = [];
  for (const line of lines) {
    const m = line.match(/^([月火水木金土日])曜日?[：:]\s*(.+)$/);
    if (!m) return [{ label: '', time: text }];
    parsed.push({ day: m[1], hours: m[2].trim() });
  }
  parsed.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));

  const groups: { days: string[]; hours: string }[] = [];
  for (const { day, hours } of parsed) {
    const last = groups[groups.length - 1];
    if (last && last.hours === hours) last.days.push(day);
    else groups.push({ days: [day], hours });
  }

  return groups.map(({ days, hours }) => {
    let label: string;
    if (days.length === 1) {
      label = `${days[0]}曜`;
    } else {
      const startIdx = DAY_ORDER.indexOf(days[0]);
      const isConsecutive = days.every((d, i) => DAY_ORDER.indexOf(d) === startIdx + i);
      label = (isConsecutive && days.length >= 3)
        ? `${days[0]}〜${days[days.length - 1]}曜`
        : days.map(d => `${d}曜`).join('・');
    }
    return { label, time: hours };
  });
}

type ExtraDetail = {
  phone?: string | null;
  website?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export default function PlaceDetailPage() {
  const insets = useSafeAreaInsets();
  const place = getSelectedPlace();
  const [rec, setRec] = useState<Recommendation | null>(place);
  const [extra, setExtra] = useState<ExtraDetail>({
    phone: place?.phone ?? null,
    website: place?.website ?? null,
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
  });
  const [photoIdx, setPhotoIdx] = useState(0);
  const [photoWidth, setPhotoWidth] = useState(0);
  const photoScrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;

  const photos = rec
    ? ((rec.photoUrls ?? []).length > 0 ? rec.photoUrls! : rec.photoUrl ? [rec.photoUrl] : [])
    : [];

  // Google Place Detail APIから追加情報取得
  useEffect(() => {
    if (!rec?.placeId) return;
    // すでに phone・website がある場合はスキップ
    if (rec.phone != null && rec.website != null) return;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/place-detail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ placeId: rec.placeId }),
        });
        const d = await res.json();
        if (d.ok && d.place) {
          setExtra({
            phone: d.place.phone ?? null,
            website: d.place.website ?? null,
            lat: d.place.lat ?? null,
            lng: d.place.lng ?? null,
          });
          // photoUrls が空なら上書き
          if (!rec.photoUrls?.length && d.place.photoUrls?.length) {
            setRec(prev => prev ? { ...prev, photoUrls: d.place.photoUrls } : prev);
          }
        }
      } catch {
        // 失敗しても既存データを表示継続
      }
    })();
  }, [rec?.placeId]);

  const onPhotoScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (photoWidth <= 0) return;
    const idx = Math.round(e.nativeEvent.contentOffset.x / photoWidth);
    if (idx !== photoIdx) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPhotoIdx(idx);
    }
  }, [photoWidth, photoIdx]);

  const scrollToPhoto = (idx: number) => {
    photoScrollRef.current?.scrollTo({ x: idx * photoWidth, animated: true });
    setPhotoIdx(idx);
  };

  const handleShare = () => {
    if (!rec) return;
    const parts: string[] = [rec.title];
    if (rec.address) parts.push(rec.address);
    if (rec.mapUrl) parts.push(rec.mapUrl);
    Share.share({ message: parts.join('\n') });
  };

  const headerOpacity = scrollY.interpolate({
    inputRange: [180, 240],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  if (!rec) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtnSolid}>
          <ArrowLeft size={20} color="#374151" strokeWidth={2.5} />
        </TouchableOpacity>
        <View style={s.errorBox}>
          <Text style={s.errorText}>データが見つかりませんでした</Text>
        </View>
      </View>
    );
  }

  const openNowColor = rec.openNow === true ? '#10B981' : rec.openNow === false ? '#EF4444' : '#9CA3AF';
  const openNowLabel = rec.openNow === true ? '営業中' : rec.openNow === false ? '閉店中' : null;
  const hoursRows = rec.openingHoursText ? formatOpeningHours(rec.openingHoursText) : [];

  return (
    <View style={s.root}>
      {/* ── スティッキーヘッダー（スクロール後に表示） ── */}
      <Animated.View
        style={[s.stickyHeader, { paddingTop: insets.top, opacity: headerOpacity }]}
        pointerEvents="none"
      >
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        <Text style={s.stickyTitle} numberOfLines={1}>{rec.title}</Text>
      </Animated.View>

      {/* ── 戻るボタン（常時表示） ── */}
      <View style={[s.topBtns, { top: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={s.overlayBtn}
          activeOpacity={0.85}
        >
          <ArrowLeft size={18} color="#fff" strokeWidth={2.5} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleShare} style={s.overlayBtn} activeOpacity={0.85}>
          <Share2 size={18} color="#fff" strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <Animated.ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        {/* ── フォトヒーロー ── */}
        <View
          style={s.heroWrap}
          onLayout={e => setPhotoWidth(e.nativeEvent.layout.width)}
        >
          {photos.length > 0 && photoWidth > 0 ? (
            <ScrollView
              ref={photoScrollRef}
              horizontal
              pagingEnabled
              scrollEnabled={photos.length > 1}
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              bounces={false}
              onMomentumScrollEnd={onPhotoScrollEnd}
              style={{ width: photoWidth, height: 300 }}
            >
              {photos.map((uri, i) => (
                <Image
                  key={i}
                  source={{ uri }}
                  style={{ width: photoWidth, height: 300 }}
                  contentFit="cover"
                  transition={200}
                />
              ))}
            </ScrollView>
          ) : (
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroPlaceholder}>
              <Navigation size={52} color="rgba(255,255,255,0.6)" strokeWidth={1.2} />
            </LinearGradient>
          )}

          {/* 下グラデーションオーバーレイ */}
          <LinearGradient
            colors={GRAD_DARK}
            style={s.heroOverlay}
            pointerEvents="none"
          />

          {/* 写真ページドット */}
          {photos.length > 1 && (
            <>
              {photoIdx > 0 && (
                <TouchableOpacity onPress={() => scrollToPhoto(photoIdx - 1)} style={[s.arrowBtn, { left: 12 }]}>
                  <Text style={s.arrowText}>‹</Text>
                </TouchableOpacity>
              )}
              {photoIdx < photos.length - 1 && (
                <TouchableOpacity onPress={() => scrollToPhoto(photoIdx + 1)} style={[s.arrowBtn, { right: 12 }]}>
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

          {/* 写真カウント */}
          {photos.length > 0 && (
            <View style={s.photoCount}>
              <Text style={s.photoCountText}>{photoIdx + 1} / {photos.length}</Text>
            </View>
          )}
        </View>

        {/* ── 本体 ── */}
        <View style={s.body}>

          {/* タイトル */}
          <Text style={s.title}>{rec.title}</Text>

          {/* 評価 + 価格帯 + 営業状態 */}
          <View style={s.pillRow}>
            {rec.rating != null && (
              <View style={s.ratingPill}>
                <Star size={14} color="#F59E0B" fill="#F59E0B" strokeWidth={0} />
                <Text style={s.ratingNum}>{rec.rating.toFixed(1)}</Text>
                {rec.userRatingCount ? (
                  <Text style={s.ratingCount}>({rec.userRatingCount.toLocaleString('ja-JP')}件)</Text>
                ) : null}
              </View>
            )}
            {rec.priceLevel && (
              <View style={s.pricePill}>
                <Text style={s.priceText}>{rec.priceLevel}</Text>
              </View>
            )}
            {openNowLabel && (
              <View style={[s.openPill, { backgroundColor: openNowColor + '18', borderColor: openNowColor + '55' }]}>
                <View style={[s.openDot, { backgroundColor: openNowColor }]} />
                <Text style={[s.openText, { color: openNowColor }]}>{openNowLabel}</Text>
              </View>
            )}
          </View>

          {/* vibe バッジ */}
          {rec.vibe ? (
            <View style={s.vibeBadge}>
              <Text style={s.vibeText}>{rec.vibe}</Text>
            </View>
          ) : null}

          {/* 住所 */}
          {rec.address ? (
            <View style={s.infoRow}>
              <View style={s.infoIconWrap}>
                <MapPin size={16} color="#C084FC" strokeWidth={2} />
              </View>
              <Text style={s.infoText} selectable>{rec.address}</Text>
            </View>
          ) : null}

          {/* 最寄り駅 / 距離 */}
          {rec.stationText ? (
            <View style={s.infoRow}>
              <View style={s.infoIconWrap}>
                <Train size={16} color="#C084FC" strokeWidth={2} />
              </View>
              <Text style={s.infoText}>{rec.stationText}</Text>
            </View>
          ) : rec.distanceText ? (
            <View style={s.infoRow}>
              <View style={s.infoIconWrap}>
                <Navigation size={16} color="#C084FC" strokeWidth={2} />
              </View>
              <Text style={s.infoText}>
                {rec.distanceText}{rec.durationText ? `  /  ${rec.durationText}` : ''}
              </Text>
            </View>
          ) : null}

          {/* 電話番号 */}
          {extra.phone ? (
            <TouchableOpacity
              style={s.infoRow}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Linking.openURL(`tel:${extra.phone}`); }}
              activeOpacity={0.7}
            >
              <View style={s.infoIconWrap}>
                <Phone size={16} color="#C084FC" strokeWidth={2} />
              </View>
              <Text style={[s.infoText, s.infoLink]}>{extra.phone}</Text>
            </TouchableOpacity>
          ) : null}

          {/* 公式サイト */}
          {extra.website ? (
            <TouchableOpacity
              style={s.infoRow}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Linking.openURL(extra.website!); }}
              activeOpacity={0.7}
            >
              <View style={s.infoIconWrap}>
                <Globe size={16} color="#C084FC" strokeWidth={2} />
              </View>
              <Text style={[s.infoText, s.infoLink]} numberOfLines={1}>{extra.website!.replace(/^https?:\/\//, '').replace(/\/$/, '')}</Text>
            </TouchableOpacity>
          ) : null}

          {/* ─── 営業時間セクション ─── */}
          {hoursRows.length > 0 && (
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Clock size={15} color="#C084FC" strokeWidth={2} />
                <Text style={s.sectionTitle}>営業時間</Text>
              </View>
              <View style={s.hoursTable}>
                {hoursRows.map((row, i) => (
                  <View key={i} style={[s.hoursRow, i % 2 === 0 && s.hoursRowEven]}>
                    <Text style={s.hoursDay}>{row.label}</Text>
                    <Text style={s.hoursTime}>{row.time}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ─── 説明・特徴セクション ─── */}
          {(rec.features?.length ?? 0) > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>このスポットについて</Text>
              {rec.features!.map((f, i) => (
                <Text key={i} style={f.length > 15 ? s.descText : s.featureText}>{f}</Text>
              ))}
            </View>
          )}

          {/* ─── アクションボタン ─── */}
          <View style={s.actionArea}>
            {rec.mapUrl ? (
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); Linking.openURL(rec.mapUrl!); }}
                style={s.mapBtn}
                activeOpacity={0.88}
              >
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mapBtnGrad}>
                  <MapPin size={17} color="#fff" strokeWidth={2.5} />
                  <Text style={s.mapBtnText}>Googleマップで見る</Text>
                  <ExternalLink size={14} color="rgba(255,255,255,0.7)" strokeWidth={2} />
                </LinearGradient>
              </TouchableOpacity>
            ) : null}
          </View>

        </View>
      </Animated.ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },

  // スティッキーヘッダー
  stickyHeader: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    paddingBottom: 12, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'flex-end',
    height: 56 + 44,
  },
  stickyTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },

  // トップボタン行（戻る・共有）
  topBtns: {
    position: 'absolute', left: 0, right: 0, zIndex: 30,
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  overlayBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.38)',
    alignItems: 'center', justifyContent: 'center',
  },

  // フォールバック（データなし）
  backBtnSolid: {
    margin: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 15, color: '#9CA3AF' },

  scroll: { flex: 1 },

  // ヒーロー写真
  heroWrap: { position: 'relative', height: 300 },
  heroPlaceholder: { width: '100%', height: 300, alignItems: 'center', justifyContent: 'center' },
  heroOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120 },
  arrowBtn: {
    position: 'absolute', top: '50%', marginTop: -20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  arrowText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  pageDots: {
    position: 'absolute', bottom: 14, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  pageDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.4)' },
  pageDotActive: { backgroundColor: '#fff', width: 16, borderRadius: 3 },
  photoCount: {
    position: 'absolute', bottom: 14, right: 14,
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  photoCountText: { fontSize: 11, fontWeight: '600', color: '#fff' },

  // ボディ
  body: { padding: 20, gap: 10 },
  title: { fontSize: 24, fontWeight: '800', color: '#111827', letterSpacing: -0.5, lineHeight: 32 },

  // ピル群
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  ratingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFFBEB', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  ratingNum: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  ratingCount: { fontSize: 12, color: '#B45309' },
  pricePill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0',
  },
  priceText: { fontSize: 12, fontWeight: '700', color: '#15803D' },
  openPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1,
  },
  openDot: { width: 7, height: 7, borderRadius: 3.5 },
  openText: { fontSize: 12, fontWeight: '700' },

  // vibeバッジ
  vibeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: 'rgba(192,132,252,0.1)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.25)',
  },
  vibeText: { fontSize: 12, fontWeight: '600', color: '#7C3AED' },

  // 情報行
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoIconWrap: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: 'rgba(192,132,252,0.1)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  infoText: { flex: 1, fontSize: 14, color: '#374151', lineHeight: 22, paddingTop: 5 },
  infoLink: { color: '#7C3AED', textDecorationLine: 'underline' },

  // セクション
  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    shadowColor: '#C084FC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: 'rgba(192,132,252,0.1)',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#374151' },

  // 営業時間テーブル
  hoursTable: { gap: 2 },
  hoursRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8,
  },
  hoursRowEven: { backgroundColor: 'rgba(192,132,252,0.05)' },
  hoursDay: { fontSize: 13, fontWeight: '600', color: '#6B7280', width: 80 },
  hoursTime: { flex: 1, fontSize: 13, color: '#374151', textAlign: 'right' },

  // 説明
  descText: { fontSize: 14, color: '#6B7280', lineHeight: 22 },
  featureText: {
    fontSize: 12, fontWeight: '600', color: '#7C3AED',
    backgroundColor: 'rgba(192,132,252,0.08)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    alignSelf: 'flex-start',
  },

  // アクションボタン
  actionArea: { marginTop: 6 },
  mapBtn: { borderRadius: 16, overflow: 'hidden' },
  mapBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 52, paddingHorizontal: 20,
  },
  mapBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
