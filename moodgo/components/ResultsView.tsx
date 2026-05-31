import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useEffect } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Search, Shuffle, Star } from 'lucide-react-native';
import type { Recommendation, FavoriteItem } from '@/types/app';
import type { PlaceResponse } from '@/types/onsen';
import PlaceCard from './PlaceCard';

// MoodGo brand gradient
const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const BRAND = '#C084FC'; // purple-400

function placeToRec(fac: PlaceResponse, featLabel?: string): Recommendation {
  const photos = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
  const supabaseId = fac.id?.startsWith('sb-') ? fac.id.replace(/^sb-/, '') : undefined;
  return {
    title: fac.name,
    address: fac.address,
    mapUrl: fac.googleMapsUrl,
    rating: fac.rating,
    userRatingCount: fac.reviewCount,
    photoUrl: fac.imageUrl || undefined,
    photoUrls: photos,
    openNow: fac.openNow ?? undefined,
    openingHoursText: fac.openingHours ?? undefined,
    priceLevel: fac.priceLevel ?? undefined,
    distanceText: fac.distanceInfo || undefined,
    stationText: fac.stationInfo || undefined,
    features: [fac.description || featLabel || ''].filter(Boolean),
    source: fac.source,
    hotpepperUrl: fac.hotpepperUrl,
    supabaseId,
  };
}

const T = {
  ja: {
    back: '戻る',
    defaultTitle: '検索結果',
    areaTitle: (area: string) => `${area}でのおすすめ`,
    empty: '条件に合う候補が見つかりませんでした。\n条件を変えて再検索してみてください。',
    refineTitle: '絞り込む',
    refinePlaceholder: '例：もっと近い場所、夜遅くまで営業、駐車場あり…',
    searching: '検索中...',
    searchAgain: '再検索する',
    feedbackTitle: 'おすすめはいかがでしたか？',
    feedbackThanks: 'ありがとうございました！🎉',
    reset: '最初からやり直す',
    reportTitle: '不適切な内容を報告',
    reportThanks: '報告ありがとうございました。',
    close: '閉じる',
    reasonLabel: '理由',
    reportReasons: ['閉店・閉業', '不正確な情報', '不適切なコンテンツ', 'その他'],
    notePlaceholder: '詳細（任意）',
    cancel: 'キャンセル',
    submitting: '送信中...',
    submit: '送信',
    sortDefault: 'おすすめ',
    sortRating: '評価順',
    sortNear: '近い順',
    filterOpenNow: '営業中',
    filterUnseen: '未見のみ',
    visited: '行った！',
    visitedDone: '✓ 行った',
    visitModalTitle: 'どうでしたか？',
    visitModalSub: '実際に訪れた感想を教えてください',
    visitModalSubmit: '送る',
    visitModalSkip: 'スキップ',
    loadMore: (n: number) => `もっと見る（残り${n}件）`,
    conditionLabel: '今回の条件',
    condMood: '気分',
    condWith: '誰と',
    condTransport: '交通',
    condBudget: '予算',
    condTime: '時間',
    condArea: 'エリア',
  },
  en: {
    back: 'Back',
    defaultTitle: 'Results',
    areaTitle: (area: string) => `Picks near ${area}`,
    empty: 'No results found.\nTry changing your search conditions.',
    refineTitle: 'Refine',
    refinePlaceholder: 'e.g. closer, open late, has parking…',
    searching: 'Searching...',
    searchAgain: 'Search again',
    feedbackTitle: 'How were the recommendations?',
    feedbackThanks: 'Thank you! 🎉',
    reset: 'Start over',
    reportTitle: 'Report inappropriate content',
    reportThanks: 'Thanks for your report.',
    close: 'Close',
    reasonLabel: 'Reason',
    reportReasons: ['Closed/Shut down', 'Incorrect info', 'Inappropriate content', 'Other'],
    notePlaceholder: 'Details (optional)',
    cancel: 'Cancel',
    submitting: 'Sending...',
    submit: 'Send',
    sortDefault: 'Best',
    sortRating: 'Rating',
    sortNear: 'Nearest',
    filterOpenNow: 'Open now',
    filterUnseen: 'New only',
    visited: 'Been there!',
    visitedDone: '✓ Visited',
    visitModalTitle: 'How was it?',
    visitModalSub: 'Share your experience',
    visitModalSubmit: 'Send',
    visitModalSkip: 'Skip',
    loadMore: (n: number) => `Show more (${n} remaining)`,
    conditionLabel: 'Your search',
    condMood: 'Mood',
    condWith: 'With',
    condTransport: 'Transport',
    condBudget: 'Budget',
    condTime: 'Time',
    condArea: 'Area',
  },
} as const;

type Props = {
  selectedMood: string;
  selectedArea: string;
  selectedCompanion?: string;
  selectedTransports?: string[];
  budget?: number;
  selectedTime?: string;
  recommendations: Recommendation[];
  onsenFacilities: PlaceResponse[] | null;
  onsenCategoryLabel: string;
  natureFacilities: PlaceResponse[] | null;
  natureSubGenreLabel: string;
  cafeFacilities: PlaceResponse[] | null;
  cafeSubCategoryLabel: string;
  waiWaiFacilities: PlaceResponse[] | null;
  waiWaiSubCategoryLabel: string;
  driveFacilities: PlaceResponse[] | null;
  driveSubCategoryLabel: string;
  focusFacilities: PlaceResponse[] | null;
  focusSubCategoryLabel: string;
  sportsFacilities: PlaceResponse[] | null;
  sportsSubCategoryLabel: string;
  travelFacilities: PlaceResponse[] | null;
  travelSubCategoryLabel: string;
  isLoading: boolean;
  loadingMessage: string;
  apiWarning: string;
  favorites: FavoriteItem[];
  onToggleFavorite: (rec: Recommendation) => void;
  placeRatings: Record<string, 'good' | 'bad'>;
  onSetPlaceRatings: (r: Record<string, 'good' | 'bad'>) => void;
  photoIndices: Record<string, number>;
  onSetPhotoIndices: (r: Record<string, number>) => void;
  blockedPlaces: string[];
  onBlockPlace: (title: string) => void;
  feedbackRating: number | null;
  feedbackSubmitted: boolean;
  onSubmitFeedback: (rating: number) => void;
  likedInSession: string[];
  onSetLikedInSession: (v: string[]) => void;
  mapClickedInSession: string[];
  onSetMapClickedInSession: (v: string[]) => void;
  refinementText: string;
  onSetRefinementText: (v: string) => void;
  isRefining: boolean;
  onRefine: () => void;
  onReset: () => void;
  reportingSpot: { title: string; address: string; supabaseId?: string } | null;
  onSetReportingSpot: (v: { title: string; address: string; supabaseId?: string } | null) => void;
  reportReason: string;
  onSetReportReason: (v: string) => void;
  reportNote: string;
  onSetReportNote: (v: string) => void;
  reportSubmitting: boolean;
  reportDone: boolean;
  onSubmitReport: () => void;
  onSubmitVisitedFeedback?: (title: string, rating: number) => void;
  onShuffle?: () => void;
  prefectureButtons?: string[];
  selectedPrefecture?: string;
  onSelectPrefecture?: (v: string) => void;
  seenPlaceTitles?: string[];
  lang?: 'ja' | 'en';
};

// ── Animated loading card ──────────────────────────────────────────────────────
function LoadingCard({ message }: { message: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true })
    ).start();
  }, []);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={ls.loadingWrap}>
      <View style={ls.card}>
        {/* Arc spinner */}
        <Animated.View style={[ls.arc, { transform: [{ rotate }] }]} />
        <Text style={ls.loadingMsg}>{message}</Text>
      </View>
    </View>
  );
}

const ls = StyleSheet.create({
  loadingWrap: { alignItems: 'center', paddingVertical: 60 },
  card: {
    backgroundColor: '#fff', borderRadius: 28, padding: 40, alignItems: 'center', gap: 20,
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.13, shadowRadius: 24, elevation: 10,
    width: '88%', borderWidth: 1, borderColor: 'rgba(192,132,252,0.15)',
  },
  arc: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 4,
    borderTopColor: '#F472B6',
    borderRightColor: '#C084FC',
    borderBottomColor: '#60A5FA',
    borderLeftColor: 'transparent',
  },
  loadingMsg: { fontSize: 15, fontWeight: '600', color: '#374151', textAlign: 'center', lineHeight: 22 },
});

export default function ResultsView(props: Props) {
  const {
    selectedMood, selectedArea, selectedCompanion = '', selectedTransports = [],
    budget, selectedTime = '',
    recommendations, onsenFacilities, onsenCategoryLabel,
    natureFacilities, natureSubGenreLabel, cafeFacilities, cafeSubCategoryLabel,
    waiWaiFacilities, waiWaiSubCategoryLabel,
    driveFacilities, driveSubCategoryLabel,
    focusFacilities, focusSubCategoryLabel,
    sportsFacilities, sportsSubCategoryLabel,
    travelFacilities, travelSubCategoryLabel,
    isLoading, loadingMessage, apiWarning,
    favorites, onToggleFavorite, blockedPlaces, onBlockPlace,
    placeRatings, onSetPlaceRatings,
    feedbackRating, feedbackSubmitted, onSubmitFeedback,
    refinementText, onSetRefinementText, isRefining, onRefine,
    onReset, onSetReportingSpot, reportingSpot,
    reportReason, onSetReportReason, reportNote, onSetReportNote,
    reportSubmitting, reportDone, onSubmitReport,
    onSubmitVisitedFeedback, onShuffle,
    prefectureButtons = [], selectedPrefecture = '', onSelectPrefecture,
    seenPlaceTitles = [],
    lang = 'ja',
  } = props;
  const t = T[lang];

  const PAGE_SIZE = 8;
  const [resultSort, setResultSort] = React.useState<'default' | 'rating' | 'near'>('default');
  const [openNowOnly, setOpenNowOnly] = React.useState(false);
  const [unseenOnly, setUnseenOnly] = React.useState(false);
  const [visitedTitles, setVisitedTitles] = React.useState<string[]>([]);
  const [visitingSpot, setVisitingSpot] = React.useState<Recommendation | null>(null);
  const [visitingRating, setVisitingRating] = React.useState(0);
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const [showConditions, setShowConditions] = React.useState(true);

  React.useEffect(() => { setVisibleCount(PAGE_SIZE); }, [resultSort, openNowOnly, unseenOnly]);

  const insets = useSafeAreaInsets();
  const isFav = (title: string) => favorites.some((f) => f.title === title);

  const facilityList: PlaceResponse[] | null =
    driveFacilities ?? focusFacilities ?? sportsFacilities ?? travelFacilities ??
    waiWaiFacilities ?? cafeFacilities ?? onsenFacilities ?? natureFacilities ?? null;
  const facilityLabel =
    driveFacilities ? driveSubCategoryLabel :
    focusFacilities ? focusSubCategoryLabel :
    sportsFacilities ? sportsSubCategoryLabel :
    travelFacilities ? travelSubCategoryLabel :
    waiWaiFacilities ? waiWaiSubCategoryLabel :
    cafeFacilities ? cafeSubCategoryLabel :
    onsenFacilities ? onsenCategoryLabel :
    natureFacilities ? natureSubGenreLabel : '';
  const accentColor =
    driveFacilities ? '#FF9500' :
    focusFacilities ? '#5856D6' :
    sportsFacilities ? '#32ADE6' :
    travelFacilities ? '#007AFF' :
    waiWaiFacilities ? '#ff4da6' :
    cafeFacilities ? '#a96032' :
    onsenFacilities ? '#1565c0' :
    natureFacilities ? '#4caf50' :
    '#FF6B35';

  const pageTitle =
    facilityList
      ? (facilityLabel || t.defaultTitle)
      : t.areaTitle(selectedArea);

  const parseDistanceM = (s?: string) => {
    if (!s) return Infinity;
    const m = s.match(/[\d.]+/);
    const n = m ? parseFloat(m[0]) : Infinity;
    return s.includes('km') ? n * 1000 : n;
  };

  let facilityItems = facilityList
    ? facilityList.filter((f) => !blockedPlaces.includes(f.name)).map((f) => placeToRec(f, facilityLabel))
    : recommendations.filter((r) => !blockedPlaces.includes(r.title));

  if (selectedPrefecture) facilityItems = facilityItems.filter((i) => i.address?.includes(selectedPrefecture));
  if (openNowOnly) facilityItems = facilityItems.filter((i) => i.openNow === true);
  if (unseenOnly) facilityItems = facilityItems.filter((i) => !seenPlaceTitles.includes(i.title));
  if (resultSort === 'rating') facilityItems = [...facilityItems].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  else if (resultSort === 'near') facilityItems = [...facilityItems].sort((a, b) => parseDistanceM(a.distanceText) - parseDistanceM(b.distanceText));

  // 今回の条件チップ
  const condChips: { label: string; value: string }[] = [];
  if (selectedMood)  condChips.push({ label: t.condMood,      value: selectedMood });
  if (selectedArea)  condChips.push({ label: t.condArea,      value: selectedArea });
  if (selectedCompanion) condChips.push({ label: t.condWith,  value: selectedCompanion });
  if (selectedTransports.length > 0) condChips.push({ label: t.condTransport, value: selectedTransports.join('・') });
  if (budget != null && budget > 0) condChips.push({ label: t.condBudget, value: `〜${budget.toLocaleString()}円` });
  if (selectedTime)  condChips.push({ label: t.condTime,      value: selectedTime });
  if (facilityLabel) condChips.push({ label: 'コース',         value: facilityLabel });

  return (
    <View style={s.root}>
      {/* iOS navigation bar */}
      <View style={[s.navBar, { paddingTop: insets.top }]}>
        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
        <View style={s.navBarBorder} />
        <View style={s.navBarInner}>
          <TouchableOpacity onPress={onReset} style={s.backBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ChevronLeft size={20} color={BRAND} strokeWidth={2.5} />
            <Text style={s.backText}>{t.back}</Text>
          </TouchableOpacity>
          <View style={s.navCenter}>
            <Text style={s.navTitle} numberOfLines={1}>{pageTitle}</Text>
            {!isLoading && facilityItems.length > 0 && (
              <Text style={s.navCount}>{facilityItems.length}{lang === 'ja' ? '件' : ' spots'}</Text>
            )}
          </View>
          <View style={s.navRight}>
            {onShuffle && !isLoading && (
              <TouchableOpacity onPress={onShuffle} style={s.shuffleBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Shuffle size={20} color={BRAND} strokeWidth={2} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 今回の条件 ─────────────────────────────── */}
        {condChips.length > 0 && !isLoading && (
          <TouchableOpacity
            onPress={() => setShowConditions((v) => !v)}
            activeOpacity={0.85}
            style={s.condCard}
          >
            <View style={s.condHeader}>
              <Text style={s.condLabel}>📋 {t.conditionLabel}</Text>
              <Text style={s.condToggle}>{showConditions ? '▲' : '▼'}</Text>
            </View>
            {showConditions && (
              <View style={s.condChips}>
                {condChips.map((c, i) => (
                  <View key={i} style={s.condChip}>
                    <Text style={s.condChipLabel}>{c.label}</Text>
                    <Text style={s.condChipValue}>{c.value}</Text>
                  </View>
                ))}
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* ── Sort & Filter ──────────────────────────── */}
        {!isLoading && (
          <View style={s.controlsWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.controlsRow}>
              {(['default', 'rating', 'near'] as const).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  onPress={() => setResultSort(mode)}
                  style={[s.controlChip, resultSort === mode && { backgroundColor: accentColor, borderColor: accentColor }]}
                  activeOpacity={0.7}
                >
                  <Text style={[s.controlChipText, resultSort === mode && s.controlChipTextActive]}>
                    {mode === 'default' ? t.sortDefault : mode === 'rating' ? t.sortRating : t.sortNear}
                  </Text>
                </TouchableOpacity>
              ))}
              <View style={s.controlDivider} />
              <TouchableOpacity
                onPress={() => setOpenNowOnly((v) => !v)}
                style={[s.controlChip, openNowOnly && { backgroundColor: '#34C759', borderColor: '#34C759' }]}
                activeOpacity={0.7}
              >
                <Text style={[s.controlChipText, openNowOnly && s.controlChipTextActive]}>🟢 {t.filterOpenNow}</Text>
              </TouchableOpacity>
              {seenPlaceTitles.length > 0 && (
                <TouchableOpacity
                  onPress={() => setUnseenOnly((v) => !v)}
                  style={[s.controlChip, unseenOnly && { backgroundColor: '#5856D6', borderColor: '#5856D6' }]}
                  activeOpacity={0.7}
                >
                  <Text style={[s.controlChipText, unseenOnly && s.controlChipTextActive]}>{t.filterUnseen}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        )}

        {/* ── 都道府県フィルター ─────────────────────── */}
        {!isLoading && prefectureButtons.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.prefRow}
            contentContainerStyle={s.prefRowContent}
          >
            {selectedPrefecture ? (
              <TouchableOpacity onPress={() => onSelectPrefecture?.('')} style={[s.prefChip, s.prefChipClear]} activeOpacity={0.7}>
                <Text style={s.prefChipClearText}>✕ 解除</Text>
              </TouchableOpacity>
            ) : null}
            {prefectureButtons.map((pref) => (
              <TouchableOpacity
                key={pref}
                onPress={() => onSelectPrefecture?.(selectedPrefecture === pref ? '' : pref)}
                style={[s.prefChip, selectedPrefecture === pref && { backgroundColor: accentColor + '18', borderColor: accentColor }]}
                activeOpacity={0.7}
              >
                <Text style={[s.prefChipText, selectedPrefecture === pref && { color: accentColor, fontWeight: '700' }]}>
                  {pref}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Loading */}
        {isLoading && <LoadingCard message={loadingMessage} />}

        {/* Warning */}
        {apiWarning && !isLoading ? (
          <View style={s.warningBox}>
            <Text style={s.warningText}>{apiWarning}</Text>
          </View>
        ) : null}

        {/* Results */}
        {!isLoading && facilityItems.length > 0 && facilityItems.slice(0, visibleCount).map((item, i) => (
          <PlaceCard
            key={`${item.title}-${i}`}
            item={item}
            isFavorited={isFav(item.title)}
            onToggleFavorite={() => onToggleFavorite(item)}
            onBlock={() => onBlockPlace(item.title)}
            onReport={() => onSetReportingSpot({ title: item.title, address: item.address ?? '', supabaseId: item.supabaseId })}
            onMarkVisited={() => { setVisitingSpot(item); setVisitingRating(0); }}
            isVisited={visitedTitles.includes(item.title)}
            accentColor={accentColor}
            lang={lang}
            moodRating={placeRatings[item.title] ?? null}
            onMoodMatch={() => onSetPlaceRatings({ ...placeRatings, [item.title]: 'good' })}
            onMoodNotMatch={() => onSetPlaceRatings({ ...placeRatings, [item.title]: 'bad' })}
          />
        ))}

        {/* Load more */}
        {!isLoading && visibleCount < facilityItems.length && (
          <TouchableOpacity
            onPress={() => setVisibleCount((c) => c + PAGE_SIZE)}
            style={[s.loadMoreBtn, { borderColor: accentColor }]}
            activeOpacity={0.75}
          >
            <Text style={[s.loadMoreText, { color: accentColor }]}>
              {t.loadMore(facilityItems.length - visibleCount)}
            </Text>
          </TouchableOpacity>
        )}

        {/* Empty state */}
        {!isLoading && facilityItems.length === 0 && (
          <View style={s.emptyBox}>
            <Search size={48} color="#C7C7CC" strokeWidth={1.5} />
            <Text style={s.emptyText}>{t.empty}</Text>
          </View>
        )}

        {/* Refinement */}
        {!isLoading && facilityItems.length > 0 && (
          <View style={s.refinementBox}>
            <Text style={s.refinementTitle}>🔍 {t.refineTitle}</Text>
            <TextInput
              value={refinementText}
              onChangeText={onSetRefinementText}
              placeholder={t.refinePlaceholder}
              placeholderTextColor="#C7C7CC"
              multiline
              style={s.refinementInput}
            />
            <TouchableOpacity
              onPress={onRefine}
              disabled={isRefining || !refinementText.trim()}
              activeOpacity={0.75}
              style={[s.refinementBtn, (isRefining || !refinementText.trim()) && s.refinementBtnDisabled]}
            >
              {!(isRefining || !refinementText.trim()) ? (
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
              ) : null}
              <Text style={s.refinementBtnText}>
                {isRefining ? t.searching : t.searchAgain}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 今回の結果どうでしたか ─────────────────── */}
        {!isLoading && !feedbackSubmitted && (recommendations.length > 0 || (facilityList?.length ?? 0) > 0) && (
          <View style={s.feedbackBox}>
            <Text style={s.feedbackTitle}>{t.feedbackTitle}</Text>
            <View style={s.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => onSubmitFeedback(n)} style={s.starBtn} activeOpacity={0.7}>
                  <Star
                    size={32}
                    color="#FF9F0A"
                    fill={feedbackRating !== null && n <= (feedbackRating ?? 0) ? '#FF9F0A' : 'none'}
                    strokeWidth={1.8}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        {feedbackSubmitted && (
          <View style={s.feedbackBox}>
            <Text style={s.feedbackThanks}>{t.feedbackThanks}</Text>
          </View>
        )}

        {/* Reset button */}
        <TouchableOpacity onPress={onReset} style={s.resetBtn} activeOpacity={0.85}>
          <LinearGradient
            colors={GRAD}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={s.resetBtnInner}
          >
            <Text style={s.resetBtnText}>{t.reset}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>

      {/* Visit feedback modal */}
      {visitingSpot && (
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>{t.visitModalTitle}</Text>
            <Text style={s.modalSpotName}>{visitingSpot.title}</Text>
            <Text style={s.visitModalSub}>{t.visitModalSub}</Text>
            <View style={s.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => setVisitingRating(n)} style={s.starBtn} activeOpacity={0.7}>
                  <Star size={28} color="#FF9F0A" fill={visitingRating >= n ? '#FF9F0A' : 'none'} strokeWidth={1.8} />
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.modalBtns}>
              <TouchableOpacity onPress={() => { setVisitingSpot(null); setVisitingRating(0); }} style={s.modalCancelBtn}>
                <Text style={s.modalCancelText}>{t.visitModalSkip}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setVisitedTitles((prev) => [...prev, visitingSpot.title]);
                  if (visitingRating > 0) onSubmitVisitedFeedback?.(visitingSpot.title, visitingRating);
                  setVisitingSpot(null); setVisitingRating(0);
                }}
                style={[s.modalSubmitBtn, { backgroundColor: '#34C759' }]}
              >
                <Text style={s.modalSubmitText}>{t.visitModalSubmit}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Report modal */}
      {reportingSpot && (
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>{t.reportTitle}</Text>
            <Text style={s.modalSpotName}>{reportingSpot.title}</Text>
            {reportDone ? (
              <>
                <Text style={s.modalThanks}>{t.reportThanks}</Text>
                <TouchableOpacity onPress={() => onSetReportingSpot(null)} style={s.modalCloseBtn}>
                  <Text style={s.modalCloseBtnText}>{t.close}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.modalLabel}>{t.reasonLabel}</Text>
                <View style={s.modalOptions}>
                  {t.reportReasons.map((r) => (
                    <TouchableOpacity
                      key={r}
                      onPress={() => onSetReportReason(r)}
                      style={[s.modalOption, reportReason === r && s.modalOptionActive]}
                    >
                      <Text style={[s.modalOptionText, reportReason === r && s.modalOptionTextActive]}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  value={reportNote}
                  onChangeText={onSetReportNote}
                  placeholder={t.notePlaceholder}
                  placeholderTextColor="#b07080"
                  style={s.modalInput}
                />
                <View style={s.modalBtns}>
                  <TouchableOpacity onPress={() => onSetReportingSpot(null)} style={s.modalCancelBtn}>
                    <Text style={s.modalCancelText}>{t.cancel}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={onSubmitReport}
                    disabled={reportSubmitting || !reportReason}
                    style={s.modalSubmitBtn}
                  >
                    <Text style={s.modalSubmitText}>{reportSubmitting ? t.submitting : t.submit}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  navBar: { zIndex: 10, overflow: 'hidden', backgroundColor: 'rgba(243,241,239,0.85)', borderBottomWidth: 1, borderBottomColor: 'rgba(192,132,252,0.18)' },
  navBarBorder: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, backgroundColor: 'rgba(192,132,252,0.18)' },
  navBarInner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, minHeight: 50 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 4, minWidth: 72 },
  backText: { fontSize: 17, fontWeight: '600', color: BRAND },
  navCenter: { flex: 1, alignItems: 'center' },
  navTitle: { fontSize: 17, fontWeight: '700', color: '#111827', textAlign: 'center' },
  navCount: { fontSize: 11, color: '#9CA3AF', fontWeight: '500', marginTop: 1 },
  navRight: { minWidth: 72, alignItems: 'flex-end' },
  shuffleBtn: { padding: 6 },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 0 },
  condCard: { backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  condHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 },
  condLabel: { fontSize: 13, fontWeight: '700', color: '#374151' },
  condToggle: { fontSize: 11, color: '#9CA3AF' },
  condChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  condChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F9FAFB', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#F3F4F6' },
  condChipLabel: { fontSize: 10, fontWeight: '600', color: '#9CA3AF' },
  condChipValue: { fontSize: 12, fontWeight: '700', color: '#111827' },
  controlsWrap: { marginBottom: 10 },
  controlsRow: { flexDirection: 'row', gap: 7, paddingHorizontal: 0 },
  controlChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#F3F4F6' },
  controlChipText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  controlChipTextActive: { color: '#fff' },
  controlDivider: { width: 1, backgroundColor: '#F3F4F6', alignSelf: 'stretch', marginHorizontal: 2 },
  prefRow: { marginBottom: 12 },
  prefRowContent: { paddingHorizontal: 0, gap: 7, flexDirection: 'row' },
  prefChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#F3F4F6' },
  prefChipText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  prefChipClear: { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' },
  prefChipClearText: { fontSize: 12, fontWeight: '500', color: '#9CA3AF' },
  loadingBox: { alignItems: 'center', paddingVertical: 60, gap: 16 },
  loadingText: { fontSize: 15, color: '#7C3AED', textAlign: 'center', lineHeight: 22, fontWeight: '600' },
  warningBox: { backgroundColor: '#FFFBEB', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#FDE68A' },
  warningText: { fontSize: 13, color: '#92600A', lineHeight: 20 },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 14 },
  emptyText: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 22 },
  refinementBox: { backgroundColor: '#fff', borderRadius: 18, padding: 16, marginTop: 4, marginBottom: 12, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  refinementTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  refinementInput: { borderRadius: 14, backgroundColor: '#F9FAFB', padding: 14, fontSize: 14, color: '#111827', minHeight: 72, textAlignVertical: 'top', borderWidth: 1, borderColor: '#F3F4F6' },
  refinementBtn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#E5E7EB' },
  refinementBtnDisabled: { backgroundColor: '#E5E7EB' },
  refinementBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  feedbackBox: { backgroundColor: '#fff', borderRadius: 18, padding: 20, marginBottom: 12, alignItems: 'center', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  feedbackTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  stars: { flexDirection: 'row', gap: 8 },
  starBtn: { padding: 4 },
  feedbackThanks: { fontSize: 16, fontWeight: '700', color: '#10B981' },
  loadMoreBtn: { alignSelf: 'center', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 999, marginBottom: 12, backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(192,132,252,0.4)', shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6 },
  loadMoreText: { fontSize: 14, fontWeight: '700', color: BRAND },
  resetBtn: { marginTop: 8, marginBottom: 4, borderRadius: 16, overflow: 'hidden' },
  resetBtnInner: { height: 54, alignItems: 'center', justifyContent: 'center' },
  resetBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  visitModalSub: { fontSize: 13, color: '#6B7280', marginBottom: 16, textAlign: 'center' },
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, width: '100%' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 4 },
  modalSpotName: { fontSize: 13, color: '#9CA3AF', marginBottom: 16 },
  modalThanks: { fontSize: 15, fontWeight: '700', color: '#10B981', textAlign: 'center', marginVertical: 16 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: '#9CA3AF', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  modalOption: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#F3F4F6' },
  modalOptionActive: { backgroundColor: '#FFF5F6', borderWidth: 1.5, borderColor: '#F43F5E' },
  modalOptionText: { fontSize: 14, fontWeight: '500', color: '#374151' },
  modalOptionTextActive: { color: '#F43F5E', fontWeight: '700' },
  modalInput: { borderRadius: 14, backgroundColor: '#F9FAFB', padding: 12, fontSize: 14, color: '#111827', marginBottom: 16, minHeight: 60, textAlignVertical: 'top', borderWidth: 1, borderColor: '#F3F4F6' },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, height: 52, borderRadius: 14, backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F3F4F6' },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: '#6B7280' },
  modalSubmitBtn: { flex: 1, height: 52, borderRadius: 14, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  modalSubmitText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  modalCloseBtn: { alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 999, backgroundColor: '#F9FAFB', marginTop: 8, borderWidth: 1, borderColor: '#F3F4F6' },
  modalCloseBtnText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
});
