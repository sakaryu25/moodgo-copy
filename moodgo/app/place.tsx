// ── app/place.tsx ─────────────────────────────────────────────────────────────
// 場所詳細ページ（フルスクリーン）
// selectedPlace ストアから Recommendation を読み出して表示し、
// placeId があれば /api/place-detail から電話・公式サイト・口コミを取得。

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import {
  ArrowLeft, ChevronDown, ChevronUp, Clock, Globe,
  MapPin, Navigation, Phone, RefreshCw, Share2, Star, ThumbsUp, Train,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
const GRAD_DARK: [string, string] = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)'];

// ── 営業時間パーサー ──────────────────────────────────────────────────────────
const DAY_ORDER = ['月', '火', '水', '木', '金', '土', '日'];

function formatOpeningHours(text: string): { label: string; time: string; isToday?: boolean }[] {
  const today = ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()];
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // 各行を構造化パース（Google Places API 形式: "月曜日: 9:00〜23:00"）
  type Entry = { day: string; hours: string };
  const parsed: Entry[] = [];
  let parseOk = true;

  for (const line of lines) {
    const m = line.match(/^([月火水木金土日])曜日?[：:]\s*(.+)$/);
    if (!m) { parseOk = false; break; }
    parsed.push({ day: m[1], hours: m[2].trim() });
  }

  // 構造化パースに成功した場合：同じ時間の曜日をグループ化
  if (parseOk && parsed.length > 0) {
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
      return { label, time: hours, isToday: days.includes(today) };
    });
  }

  // フォールバック: 行ごとにそのまま表示（ラベルと時間を ": " で分割）
  return lines.map(line => {
    const sep = line.indexOf(':');
    if (sep > 0 && sep < 10) {
      const label = line.slice(0, sep).trim();
      const time = line.slice(sep + 1).trim();
      const dayChar = label.charAt(0);
      const isToday = ['月','火','水','木','金','土','日'].includes(dayChar)
        && dayChar === today;
      return { label, time, isToday };
    }
    return { label: '', time: line };
  });
}

// ── 型 ────────────────────────────────────────────────────────────────────────
type Review = {
  rating: number | null;
  text: string;
  authorName: string;
  authorPhoto: string | null;
  relativeTime: string;
};

type ExtraDetail = {
  phone?: string | null;
  website?: string | null;
  reviews?: Review[];
  // APIから取得した確実なデータ（recのAI生成データより優先）
  openingHoursText?: string | null;
  openNow?: boolean | null;
  rating?: number | null;
  userRatingCount?: number | null;
  priceLevel?: string | null;
  address?: string | null;
  loaded?: boolean;
};

// ── Instagram アイコン（expo-linear-gradient + lucide Camera） ────────────────
const IG_GRAD: [string, string, string] = ['#FCAF45', '#E1306C', '#833AB4'];
function IconInstagram() {
  return (
    <LinearGradient
      colors={IG_GRAD}
      start={{ x: 0, y: 1 }}
      end={{ x: 1, y: 0 }}
      style={igStyle.wrap}
    >
      {/* カメラ外枠 */}
      <View style={igStyle.outer}>
        {/* レンズ */}
        <View style={igStyle.lens} />
        {/* 右上ドット */}
        <View style={igStyle.dot} />
      </View>
    </LinearGradient>
  );
}
const igStyle = StyleSheet.create({
  wrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  outer: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center' },
  lens: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: '#fff' },
  dot: { position: 'absolute', top: 1, right: 1, width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#fff' },
});

// ── 星表示 ────────────────────────────────────────────────────────────────────
function StarRow({ rating, size = 13 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          size={size}
          strokeWidth={0}
          color={n <= Math.round(rating) ? '#F59E0B' : '#E5E7EB'}
          fill={n <= Math.round(rating) ? '#F59E0B' : '#E5E7EB'}
        />
      ))}
    </View>
  );
}

// ── レビューカード ─────────────────────────────────────────────────────────────
function ReviewCard({ review, index }: { review: Review; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const MAX = 120;
  const needsExpand = review.text.length > MAX;
  const displayText = expanded || !needsExpand ? review.text : review.text.slice(0, MAX) + '…';

  // アバター頭文字の背景色をインデックスで分散
  const avatarColors = ['#F472B6', '#C084FC', '#60A5FA', '#34D399', '#FB923C'];
  const avatarBg = avatarColors[index % avatarColors.length];
  const initial = review.authorName.charAt(0).toUpperCase();

  return (
    <View style={rs.card}>
      {/* ヘッダー：アバター + 名前 + 時間 */}
      <View style={rs.cardHeader}>
        {review.authorPhoto ? (
          <Image source={{ uri: review.authorPhoto }} style={rs.avatar} contentFit="cover" />
        ) : (
          <View style={[rs.avatarFallback, { backgroundColor: avatarBg }]}>
            <Text style={rs.avatarInitial}>{initial}</Text>
          </View>
        )}
        <View style={rs.authorInfo}>
          <Text style={rs.authorName}>{review.authorName}</Text>
          {review.relativeTime ? (
            <Text style={rs.relativeTime}>{review.relativeTime}</Text>
          ) : null}
        </View>
        {review.rating != null && <StarRow rating={review.rating} size={12} />}
      </View>

      {/* 本文 */}
      <Text style={rs.reviewText}>{displayText}</Text>

      {/* もっと見る */}
      {needsExpand && (
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setExpanded(v => !v); }}
          style={rs.expandBtn}
          activeOpacity={0.7}
        >
          {expanded
            ? <><ChevronUp size={13} color="#C084FC" strokeWidth={2} /><Text style={rs.expandText}>閉じる</Text></>
            : <><ChevronDown size={13} color="#C084FC" strokeWidth={2} /><Text style={rs.expandText}>続きを読む</Text></>
          }
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── スケルトンローダー ─────────────────────────────────────────────────────────
function SkeletonBox({ widthPct, widthPx, height, radius = 8 }: { widthPct?: string; widthPx?: number; height: number; radius?: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{
      width: widthPx ?? (widthPct as any), height, borderRadius: radius,
      backgroundColor: '#E5E7EB', opacity,
    }} />
  );
}

function InfoSkeleton() {
  return (
    <View style={{ gap: 14 }}>
      {/* 評価バースケルトン */}
      <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 10,
        borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <SkeletonBox widthPx={52} height={38} radius={8} />
          <View style={{ gap: 8 }}>
            <SkeletonBox widthPx={100} height={14} />
            <SkeletonBox widthPx={80} height={12} />
          </View>
        </View>
      </View>
      {/* 情報カードスケルトン */}
      <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)' }}>
        {[0,1,2].map(i => (
          <View key={i} style={{ flexDirection: 'row', gap: 12, padding: 14,
            borderTopWidth: i > 0 ? 1 : 0, borderTopColor: 'rgba(192,132,252,0.08)' }}>
            <SkeletonBox widthPx={30} height={30} radius={9} />
            <View style={{ flex: 1, gap: 6, paddingTop: 4 }}>
              <SkeletonBox widthPct="80%" height={14} />
              {i === 0 && <SkeletonBox widthPct="60%" height={12} />}
            </View>
          </View>
        ))}
      </View>
      {/* 営業時間スケルトン */}
      <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 10,
        borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)' }}>
        <SkeletonBox widthPx={80} height={15} />
        {[0,1,2,3].map(i => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <SkeletonBox widthPx={70} height={13} />
            <SkeletonBox widthPx={120} height={13} />
          </View>
        ))}
      </View>
    </View>
  );
}

// ── メインコンポーネント ────────────────────────────────────────────────────────
export default function PlaceDetailPage() {
  const insets = useSafeAreaInsets();
  const place = getSelectedPlace();
  const [rec, setRec] = useState<Recommendation | null>(place);
  const [extra, setExtra] = useState<ExtraDetail>({
    phone: place?.phone ?? null,
    website: place?.website ?? null,
    reviews: [],
    loaded: false,
  });
  const [fetchError, setFetchError] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [photoWidth, setPhotoWidth] = useState(0);
  const photoScrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;

  const photos = rec
    ? ((rec.photoUrls ?? []).length > 0 ? rec.photoUrls! : rec.photoUrl ? [rec.photoUrl] : [])
    : [];

  // Google Place Detail APIから完全な情報を取得
  const fetchDetail = useCallback(async () => {
    if (!rec) return;
    setFetchError(false);
    setExtra(prev => ({ ...prev, loaded: false }));

    const id = rec.placeId;
    // placeId がなければ名前+エリアでテキスト検索
    const body = id
      ? { placeId: id }
      : { name: rec.title, address: rec.address ?? '' };

    try {
      const res = await fetch(`${API_BASE}/api/place-detail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.ok && d.place) {
        const p = d.place;
        // APIデータをすべて extra に格納（rec のAI生成データより確実に優先される）
        setExtra({
          phone: p.phone ?? null,
          website: p.website ?? null,
          reviews: p.reviews ?? [],
          openingHoursText: p.openingHoursText ?? null,
          openNow: p.openNow ?? null,
          rating: typeof p.rating === 'number' ? p.rating : null,
          userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
          priceLevel: p.priceLevel ?? null,
          address: p.address || null,
          loaded: true,
        });
        // rec は写真URL・mapUrl・位置情報のみ更新（これらは extra に持たない）
        setRec(prev => prev ? {
          ...prev,
          mapUrl:    p.mapUrl    || prev.mapUrl,
          photoUrls: p.photoUrls?.length ? p.photoUrls : prev.photoUrls,
          lat:       p.lat       ?? prev.lat,
          lng:       p.lng       ?? prev.lng,
        } : prev);
      } else {
        setExtra(prev => ({ ...prev, loaded: true }));
        setFetchError(true);
      }
    } catch {
      setExtra(prev => ({ ...prev, loaded: true }));
      setFetchError(true);
    }
  }, [rec?.title, rec?.placeId]);

  useEffect(() => { fetchDetail(); }, []);

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
    inputRange: [200, 260],
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

  // APIデータを優先、なければ rec のデータにフォールバック
  const displayRating = extra.loaded ? (extra.rating ?? rec.rating) : rec.rating;
  const displayUserRatingCount = extra.loaded ? (extra.userRatingCount ?? rec.userRatingCount) : rec.userRatingCount;
  const displayOpenNow = extra.loaded ? (extra.openNow ?? rec.openNow) : rec.openNow;
  const displayPriceLevel = extra.loaded ? (extra.priceLevel ?? rec.priceLevel) : rec.priceLevel;
  const displayAddress = extra.loaded ? (extra.address || rec.address) : rec.address;
  // 営業時間: APIデータ優先（必ず全曜日分が返る）
  const hoursSource = extra.loaded
    ? (extra.openingHoursText ?? rec.openingHoursText)
    : rec.openingHoursText;
  if (__DEV__ && hoursSource) {
    console.log('[place.tsx] hoursSource lines:', hoursSource.split('\n').length, hoursSource.slice(0, 80));
  }
  const openNowColor = displayOpenNow === true ? '#10B981' : displayOpenNow === false ? '#EF4444' : '#9CA3AF';
  const openNowLabel = displayOpenNow === true ? '営業中' : displayOpenNow === false ? '閉店中' : null;
  const hoursRows = hoursSource ? formatOpeningHours(hoursSource) : [];

  return (
    <View style={s.root}>

      {/* ── スティッキーヘッダー ── */}
      <Animated.View
        style={[s.stickyHeader, { paddingTop: insets.top, opacity: headerOpacity }]}
        pointerEvents="none"
      >
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        <Text style={s.stickyTitle} numberOfLines={1}>{rec.title}</Text>
      </Animated.View>

      {/* ── フローティングボタン ── */}
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        {/* ── ヒーロー写真 ── */}
        <View style={s.heroWrap} onLayout={e => setPhotoWidth(e.nativeEvent.layout.width)}>
          {photos.length > 0 && photoWidth > 0 ? (
            <ScrollView
              ref={photoScrollRef}
              horizontal pagingEnabled
              scrollEnabled={photos.length > 1}
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast" bounces={false}
              onMomentumScrollEnd={onPhotoScrollEnd}
              style={{ width: photoWidth, height: 300 }}
            >
              {photos.map((uri, i) => (
                <Image key={i} source={{ uri }}
                  style={{ width: photoWidth, height: 300 }} contentFit="cover" transition={200} />
              ))}
            </ScrollView>
          ) : (
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroPlaceholder}>
              <Navigation size={56} color="rgba(255,255,255,0.55)" strokeWidth={1.2} />
            </LinearGradient>
          )}

          <LinearGradient colors={GRAD_DARK} style={s.heroOverlay} pointerEvents="none" />

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
          {photos.length > 0 && (
            <View style={s.photoCount}>
              <Text style={s.photoCountText}>{photoIdx + 1} / {photos.length}</Text>
            </View>
          )}
        </View>

        {/* ── ボディ ── */}
        <View style={s.body}>

          {/* タイトル + マップボタン（同一行）+ vibeバッジ */}
          <View style={s.titleBlock}>
            <View style={s.titleRow}>
              <Text style={s.title}>{rec.title}</Text>
              {rec.mapUrl ? (
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); Linking.openURL(rec.mapUrl!); }}
                  activeOpacity={0.82}
                  style={s.mapPillBtn}
                >
                  <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.mapPillGrad}>
                    <MapPin size={12} color="#fff" strokeWidth={2.5} />
                    <Text style={s.mapPillText}>マップ</Text>
                  </LinearGradient>
                </TouchableOpacity>
              ) : null}
            </View>
            {rec.vibe ? (
              <View style={s.vibeBadge}>
                <Text style={s.vibeText}>{rec.vibe}</Text>
              </View>
            ) : null}
          </View>

          {/* ── データ読み込み中：スケルトン ── */}
          {!extra.loaded ? (
            <>
              <View style={s.loadingBanner}>
                <ActivityIndicator size="small" color="#C084FC" />
                <Text style={s.loadingText}>詳細情報を読み込み中...</Text>
              </View>
              <InfoSkeleton />
            </>
          ) : fetchError ? (
            /* ── APIエラー（リトライボタン）── 評価や住所があっても常に表示 */
            <TouchableOpacity style={s.retryBtn} onPress={fetchDetail} activeOpacity={0.8}>
              <RefreshCw size={14} color="#C084FC" strokeWidth={2} />
              <Text style={s.retryText}>口コミ・営業時間の読み込みに失敗。タップして再試行</Text>
            </TouchableOpacity>
          ) : null}

          {/* 評価バー（データあり時のみ） */}
          {extra.loaded && displayRating != null && (
            <View style={s.ratingBar}>
              <Text style={s.ratingBig}>{displayRating.toFixed(1)}</Text>
              <View style={s.ratingMid}>
                <StarRow rating={displayRating} size={16} />
                {displayUserRatingCount ? (
                  <Text style={s.ratingCount}>{displayUserRatingCount.toLocaleString('ja-JP')}件の口コミ</Text>
                ) : null}
              </View>
            </View>
          )}

          {/* 価格帯 */}
          {extra.loaded && displayPriceLevel && (
            <View style={s.pricePill}>
              <Text style={s.priceText}>{displayPriceLevel}</Text>
            </View>
          )}

          {/* ─── 情報カード（読み込み完了後のみ） ─── */}
          {extra.loaded && (
          <View style={s.infoCard}>
            {/* 住所 */}
            {displayAddress ? (
              <View style={s.infoRow}>
                <View style={s.infoIconWrap}>
                  <MapPin size={15} color="#C084FC" strokeWidth={2} />
                </View>
                <Text style={s.infoText} selectable>{displayAddress}</Text>
              </View>
            ) : null}

            {/* 最寄り駅 / 距離 */}
            {rec.stationText ? (
              <View style={[s.infoRow, s.infoRowBorder]}>
                <View style={s.infoIconWrap}>
                  <Train size={15} color="#C084FC" strokeWidth={2} />
                </View>
                <Text style={s.infoText}>{rec.stationText}</Text>
              </View>
            ) : rec.distanceText ? (
              <View style={[s.infoRow, s.infoRowBorder]}>
                <View style={s.infoIconWrap}>
                  <Navigation size={15} color="#C084FC" strokeWidth={2} />
                </View>
                <Text style={s.infoText}>
                  {rec.distanceText}{rec.durationText ? `  /  ${rec.durationText}` : ''}
                </Text>
              </View>
            ) : null}

            {/* 電話番号 */}
            {extra.phone ? (
              <TouchableOpacity
                style={[s.infoRow, s.infoRowBorder]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Linking.openURL(`tel:${extra.phone}`); }}
                activeOpacity={0.7}
              >
                <View style={s.infoIconWrap}>
                  <Phone size={15} color="#C084FC" strokeWidth={2} />
                </View>
                <Text style={[s.infoText, s.infoLink]}>{extra.phone}</Text>
              </TouchableOpacity>
            ) : null}

            {/* 公式サイト */}
            {extra.website ? (
              <TouchableOpacity
                style={[s.infoRow, s.infoRowBorder]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Linking.openURL(extra.website!); }}
                activeOpacity={0.7}
              >
                <View style={s.infoIconWrap}>
                  <Globe size={15} color="#C084FC" strokeWidth={2} />
                </View>
                <Text style={[s.infoText, s.infoLink]} numberOfLines={1}>
                  {extra.website!.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* Instagram 検索 */}
            <TouchableOpacity
              style={[s.infoRow, s.infoRowBorder]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const tag = encodeURIComponent(rec.title.replace(/\s+/g, ''));
                Linking.openURL(`https://www.instagram.com/explore/tags/${tag}/`);
              }}
              activeOpacity={0.7}
            >
              <View style={s.infoIconWrap}>
                <IconInstagram />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.infoText, { color: '#C13584', paddingTop: 0 }]}>
                  Instagramで検索
                </Text>
                <Text style={s.infoSubText}>#{rec.title.replace(/\s+/g, '')}</Text>
              </View>
            </TouchableOpacity>
          </View>
          )}

          {/* ─── 営業時間セクション ─── */}
          {extra.loaded && hoursRows.length > 0 && (
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Clock size={15} color="#C084FC" strokeWidth={2} />
                <Text style={s.sectionTitle}>営業時間</Text>
                {openNowLabel && (
                  <View style={[s.openPillSm, { backgroundColor: openNowColor + '20', borderColor: openNowColor + '60' }]}>
                    <View style={[s.openDot, { backgroundColor: openNowColor, width: 6, height: 6 }]} />
                    <Text style={[s.openTextSm, { color: openNowColor }]}>{openNowLabel}</Text>
                  </View>
                )}
              </View>
              <View style={s.hoursTable}>
                {hoursRows.map((row, i) => (
                  <View key={i} style={[
                    s.hoursRow,
                    i % 2 === 0 && s.hoursRowEven,
                    row.isToday && s.hoursRowToday,
                  ]}>
                    <View style={s.hoursDayWrap}>
                      {row.isToday && <View style={s.todayDot} />}
                      <Text style={[s.hoursDay, row.isToday && s.hoursDayToday]}>{row.label}</Text>
                    </View>
                    <Text style={[s.hoursTime, row.isToday && s.hoursTimeToday]}>{row.time}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}


          {/* ─── 口コミセクション ─── */}
          {(extra.reviews?.length ?? 0) > 0 && (
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <ThumbsUp size={15} color="#C084FC" strokeWidth={2} />
                <Text style={s.sectionTitle}>口コミ</Text>
                <Text style={s.reviewSubLabel}>いいね順 Top {extra.reviews!.length}</Text>
              </View>
              {extra.reviews!.map((review, i) => (
                <ReviewCard key={i} review={review} index={i} />
              ))}
            </View>
          )}


        </View>
      </Animated.ScrollView>
    </View>
  );
}

// ── ReviewCardスタイル ────────────────────────────────────────────────────────
const rs = StyleSheet.create({
  card: {
    backgroundColor: '#FAFAFA',
    borderRadius: 14,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(192,132,252,0.1)',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 14, fontWeight: '700', color: '#fff' },
  authorInfo: { flex: 1 },
  authorName: { fontSize: 13, fontWeight: '700', color: '#111827' },
  relativeTime: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  reviewText: { fontSize: 13, color: '#374151', lineHeight: 21 },
  expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  expandText: { fontSize: 12, fontWeight: '600', color: '#C084FC' },
});

// ── メインスタイル ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FB' },

  // ローディング
  loadingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(192,132,252,0.08)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.15)',
  },
  loadingText: { fontSize: 13, color: '#7C3AED', fontWeight: '500' },

  // リトライ
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(192,132,252,0.06)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.2)',
  },
  retryText: { flex: 1, fontSize: 13, color: '#7C3AED' },

  stickyHeader: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    paddingBottom: 14, paddingHorizontal: 60,
    alignItems: 'center', justifyContent: 'flex-end',
    height: 100,
  },
  stickyTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },

  topBtns: {
    position: 'absolute', left: 0, right: 0, zIndex: 30,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16,
  },
  overlayBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },

  backBtnSolid: {
    margin: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 15, color: '#9CA3AF' },

  scroll: { flex: 1 },

  // ヒーロー
  heroWrap: { position: 'relative', height: 300 },
  heroPlaceholder: { width: '100%', height: 300, alignItems: 'center', justifyContent: 'center' },
  heroOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 130 },
  arrowBtn: {
    position: 'absolute', top: '50%', marginTop: -20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center',
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
    backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  photoCountText: { fontSize: 11, fontWeight: '600', color: '#fff' },

  // ボディ全体
  body: { paddingHorizontal: 18, paddingTop: 20, gap: 14 },

  // タイトルブロック
  titleBlock: { gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 26, fontWeight: '800', color: '#111827', letterSpacing: -0.5, lineHeight: 34 },
  vibeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
    backgroundColor: 'rgba(192,132,252,0.12)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.3)',
  },
  vibeText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  // マップピルボタン（タイトル横インライン）
  mapPillBtn: {
    borderRadius: 999, overflow: 'hidden',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 4,
  },
  mapPillGrad: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 11, paddingVertical: 7,
  },
  mapPillText: { fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },

  // 評価バー
  ratingBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)',
  },
  ratingBig: { fontSize: 32, fontWeight: '800', color: '#111827', letterSpacing: -1 },
  ratingMid: { flex: 1, gap: 4 },
  ratingCount: { fontSize: 12, color: '#9CA3AF' },
  openPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1,
  },
  openPillSm: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1,
    marginLeft: 'auto' as any,
  },
  openDot: { width: 7, height: 7, borderRadius: 3.5 },
  openText: { fontSize: 12, fontWeight: '700' },
  openTextSm: { fontSize: 11, fontWeight: '700' },
  pricePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
    backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0',
  },
  priceText: { fontSize: 12, fontWeight: '700', color: '#15803D' },

  // 情報カード
  infoCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)',
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  infoRowBorder: { borderTopWidth: 1, borderTopColor: 'rgba(192,132,252,0.08)' },
  infoIconWrap: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: 'rgba(192,132,252,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  infoText: { flex: 1, fontSize: 14, color: '#374151', lineHeight: 22, paddingTop: 4 },
  infoLink: { color: '#7C3AED' },
  infoSubText: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },

  // セクション共通
  section: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12,
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  reviewSubLabel: { fontSize: 11, color: '#9CA3AF', marginLeft: 'auto' as any },

  // 営業時間
  hoursTable: { gap: 2 },
  hoursRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9,
  },
  hoursRowEven: { backgroundColor: 'rgba(192,132,252,0.04)' },
  hoursRowToday: { backgroundColor: 'rgba(192,132,252,0.1)', borderWidth: 1, borderColor: 'rgba(192,132,252,0.2)' },
  hoursDayWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 90 },
  todayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C084FC' },
  hoursDay: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  hoursDayToday: { fontWeight: '700', color: '#7C3AED' },
  hoursTime: { flex: 1, fontSize: 13, color: '#374151', textAlign: 'right' },
  hoursTimeToday: { fontWeight: '700', color: '#7C3AED' },

  // このスポットについて
  descText: { fontSize: 14, color: '#4B5563', lineHeight: 22 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tag: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
    backgroundColor: 'rgba(192,132,252,0.08)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.2)',
  },
  tagText: { fontSize: 12, fontWeight: '600', color: '#7C3AED' },

});
