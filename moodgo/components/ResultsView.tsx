import { BlurView } from 'expo-blur';
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Search, Shuffle } from 'lucide-react-native';
import type { Recommendation, FavoriteItem } from '@/types/app';
import type { PlaceResponse } from '@/types/onsen';
import PlaceCard from './PlaceCard';

// Convert PlaceResponse to Recommendation for unified rendering
function placeToRec(fac: PlaceResponse, featLabel?: string): Recommendation {
  const photos = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
  // sb-{uuid} 形式から Supabase UUID を抽出（report-closed API 用）
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
    sortDefault: 'おすすめ順',
    sortRating: '評価順',
    sortNear: '近い順',
    filterOpenNow: '営業中のみ',
    filterUnseen: '未見のみ',
    visited: '行った！',
    visitedDone: '✓ 行った',
    visitModalTitle: 'どうでしたか？',
    visitModalSub: '実際に訪れた感想を教えてください',
    visitModalSubmit: '送る',
    visitModalSkip: 'スキップ',
    loadMore: (n: number) => `もっと見る（残り${n}件）`,
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
  },
} as const;

type Props = {
  selectedMood: string;
  selectedArea: string;
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

export default function ResultsView(props: Props) {
  const {
    selectedMood, selectedArea,
    recommendations, onsenFacilities, onsenCategoryLabel,
    natureFacilities, natureSubGenreLabel, cafeFacilities, cafeSubCategoryLabel,
    waiWaiFacilities, waiWaiSubCategoryLabel,
    driveFacilities, driveSubCategoryLabel,
    focusFacilities, focusSubCategoryLabel,
    sportsFacilities, sportsSubCategoryLabel,
    travelFacilities, travelSubCategoryLabel,
    isLoading, loadingMessage, apiWarning,
    favorites, onToggleFavorite, blockedPlaces, onBlockPlace,
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

  React.useEffect(() => { setVisibleCount(PAGE_SIZE); }, [resultSort, openNowOnly, unseenOnly]);

  const insets = useSafeAreaInsets();
  const isFav = (title: string) => favorites.some((f) => f.title === title);

  // Determine what to show
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
    '#ff8fa5';

  const pageTitle =
    facilityList
      ? (facilityLabel || t.defaultTitle)
      : t.areaTitle(selectedArea);

  // Items to render (with sort & filter)
  const parseDistanceM = (s?: string) => {
    if (!s) return Infinity;
    const m = s.match(/[\d.]+/);
    const n = m ? parseFloat(m[0]) : Infinity;
    return s.includes('km') ? n * 1000 : n;
  };

  let facilityItems = facilityList
    ? facilityList
        .filter((f) => !blockedPlaces.includes(f.name))
        .map((f) => placeToRec(f, facilityLabel))
    : recommendations.filter((r) => !blockedPlaces.includes(r.title));

  if (selectedPrefecture) facilityItems = facilityItems.filter((i) => i.address?.includes(selectedPrefecture));
  if (openNowOnly) facilityItems = facilityItems.filter((i) => i.openNow === true);
  if (unseenOnly) facilityItems = facilityItems.filter((i) => !seenPlaceTitles.includes(i.title));
  if (resultSort === 'rating') facilityItems = [...facilityItems].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  else if (resultSort === 'near') facilityItems = [...facilityItems].sort((a, b) => parseDistanceM(a.distanceText) - parseDistanceM(b.distanceText));

  return (
    <View style={s.root}>
      {/* iOS navigation bar */}
      <View style={[s.navBar, { paddingTop: insets.top }]}>
        <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
        <View style={s.navBarBorder} />
        <View style={s.navBarInner}>
          <TouchableOpacity onPress={onReset} style={s.backBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ChevronLeft size={20} color="#FF6B35" strokeWidth={2.5} />
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
                <Shuffle size={20} color="#FF6B35" strokeWidth={2} />
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
        {facilityLabel ? (
          <View style={s.labelBadge}>
            <Text style={[s.labelBadgeText, { color: accentColor }]}>{facilityLabel}</Text>
          </View>
        ) : null}

        {/* Sort & Filter controls */}
        {!isLoading && (
          <View style={s.controlsRow}>
            <View style={s.sortGroup}>
              {(['default', 'rating', 'near'] as const).map((mode) => (
                <TouchableOpacity
                  key={mode}
                  onPress={() => setResultSort(mode)}
                  style={[s.sortBtn, resultSort === mode && s.sortBtnActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[s.sortBtnText, resultSort === mode && s.sortBtnTextActive]}>
                    {mode === 'default' ? t.sortDefault : mode === 'rating' ? t.sortRating : t.sortNear}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.filterGroup}>
              <TouchableOpacity
                onPress={() => setOpenNowOnly((v) => !v)}
                style={[s.filterBtn, openNowOnly && s.filterBtnActive]}
                activeOpacity={0.7}
              >
                <Text style={[s.filterBtnText, openNowOnly && s.filterBtnTextActive]}>{t.filterOpenNow}</Text>
              </TouchableOpacity>
              {seenPlaceTitles.length > 0 && (
                <TouchableOpacity
                  onPress={() => setUnseenOnly((v) => !v)}
                  style={[s.filterBtn, unseenOnly && s.filterBtnActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[s.filterBtnText, unseenOnly && s.filterBtnTextActive]}>{t.filterUnseen}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Prefecture filter */}
        {!isLoading && prefectureButtons.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.prefRow}
            contentContainerStyle={s.prefRowContent}
          >
            {selectedPrefecture ? (
              <TouchableOpacity
                onPress={() => onSelectPrefecture?.('')}
                style={[s.prefChip, s.prefChipClear]}
                activeOpacity={0.7}
              >
                <Text style={s.prefChipClearText}>✕ 解除</Text>
              </TouchableOpacity>
            ) : null}
            {prefectureButtons.map((pref) => (
              <TouchableOpacity
                key={pref}
                onPress={() => onSelectPrefecture?.(selectedPrefecture === pref ? '' : pref)}
                style={[s.prefChip, selectedPrefecture === pref && s.prefChipActive]}
                activeOpacity={0.7}
              >
                <Text style={[s.prefChipText, selectedPrefecture === pref && s.prefChipTextActive]}>
                  {pref}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Loading */}
        {isLoading && (
          <View style={s.loadingBox}>
            <ActivityIndicator size="large" color={accentColor} />
            <Text style={s.loadingText}>{loadingMessage}</Text>
          </View>
        )}

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
          />
        ))}

        {/* Load more */}
        {!isLoading && visibleCount < facilityItems.length && (
          <TouchableOpacity
            onPress={() => setVisibleCount((c) => c + PAGE_SIZE)}
            style={s.loadMoreBtn}
            activeOpacity={0.75}
          >
            <Text style={s.loadMoreText}>
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
            <Text style={s.refinementTitle}>{t.refineTitle}</Text>
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
              <Text style={s.refinementBtnText}>
                {isRefining ? t.searching : t.searchAgain}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Feedback */}
        {!isLoading && !feedbackSubmitted && recommendations.length > 0 && !facilityList && (
          <View style={s.feedbackBox}>
            <Text style={s.feedbackTitle}>{t.feedbackTitle}</Text>
            <View style={s.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => onSubmitFeedback(n)} style={s.starBtn}>
                  <Text style={[s.starText, feedbackRating !== null && n <= (feedbackRating ?? 0) && s.starActive]}>
                    {feedbackRating !== null && n <= feedbackRating ? '★' : '☆'}
                  </Text>
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
        <TouchableOpacity onPress={onReset} style={s.resetBtn} activeOpacity={0.7}>
          <Text style={s.resetBtnText}>{t.reset}</Text>
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
                <TouchableOpacity key={n} onPress={() => setVisitingRating(n)} style={s.starBtn}>
                  <Text style={[s.starText, visitingRating >= n && s.starActive]}>
                    {visitingRating >= n ? '★' : '☆'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.modalBtns}>
              <TouchableOpacity
                onPress={() => { setVisitingSpot(null); setVisitingRating(0); }}
                style={s.modalCancelBtn}
              >
                <Text style={s.modalCancelText}>{t.visitModalSkip}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setVisitedTitles((prev) => [...prev, visitingSpot.title]);
                  if (visitingRating > 0) onSubmitVisitedFeedback?.(visitingSpot.title, visitingRating);
                  setVisitingSpot(null);
                  setVisitingRating(0);
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
                    <Text style={s.modalSubmitText}>
                      {reportSubmitting ? t.submitting : t.submit}
                    </Text>
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
  root: { flex: 1, backgroundColor: '#F2F2F7' },

  // iOS nav bar
  navBar: {
    zIndex: 10, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 0,
  },
  navBarBorder: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.15)',
  },
  navBarInner: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10, minHeight: 44,
  },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 6, paddingVertical: 4, minWidth: 72,
  },
  backText: { fontSize: 17, color: '#FF6B35', fontWeight: '400' },
  navCenter: { flex: 1, alignItems: 'center' },
  navTitle: { fontSize: 17, fontWeight: '600', color: '#000', textAlign: 'center' },
  navCount: { fontSize: 11, color: '#8E8E93', fontWeight: '500', marginTop: 1 },
  navRight: { minWidth: 72, alignItems: 'flex-end' },
  shuffleBtn: { padding: 6 },

  scroll: { flex: 1 },
  content: { padding: 16 },

  labelBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8, marginBottom: 12,
    backgroundColor: '#F2F2F7',
  },
  labelBadgeText: { fontSize: 13, fontWeight: '600' },

  // Sort & filter bar
  controlsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12, gap: 8,
  },
  sortGroup: { flexDirection: 'row', gap: 6 },
  sortBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: '#F2F2F7', borderWidth: 1, borderColor: '#E5E5EA',
  },
  sortBtnActive: { backgroundColor: '#FF6B3515', borderColor: '#FF6B35' },
  sortBtnText: { fontSize: 12, fontWeight: '500', color: '#6D6D72' },
  sortBtnTextActive: { color: '#FF6B35', fontWeight: '600' },
  filterGroup: { flexDirection: 'row', gap: 6 },
  filterBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: '#F2F2F7', borderWidth: 1, borderColor: '#E5E5EA',
  },
  filterBtnActive: { backgroundColor: '#34C75915', borderColor: '#34C759' },
  filterBtnText: { fontSize: 12, fontWeight: '500', color: '#6D6D72' },
  filterBtnTextActive: { color: '#34C759', fontWeight: '600' },
  visitModalSub: { fontSize: 13, color: '#8E8E93', marginBottom: 16, textAlign: 'center' },

  prefRow: { marginBottom: 10 },
  prefRowContent: { paddingHorizontal: 0, gap: 8, flexDirection: 'row' },
  prefChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: '#F2F2F7', borderWidth: 1, borderColor: '#E5E5EA',
  },
  prefChipActive: { backgroundColor: '#FF6B3515', borderColor: '#FF6B35' },
  prefChipText: { fontSize: 12, fontWeight: '500', color: '#6D6D72' },
  prefChipTextActive: { color: '#FF6B35', fontWeight: '700' },
  prefChipClear: { backgroundColor: '#F2F2F7', borderColor: '#C7C7CC' },
  prefChipClearText: { fontSize: 12, fontWeight: '500', color: '#8E8E93' },

  loadingBox: { alignItems: 'center', paddingVertical: 60, gap: 16 },
  loadingText: { fontSize: 15, color: '#6D6D72', textAlign: 'center', lineHeight: 22 },

  warningBox: {
    backgroundColor: '#FFFBEB', borderRadius: 12, padding: 14, marginBottom: 12,
  },
  warningText: { fontSize: 13, color: '#92600A', lineHeight: 20 },

  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 14 },
  emptyText: { fontSize: 15, color: '#8E8E93', textAlign: 'center', lineHeight: 22 },

  // Refinement
  refinementBox: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    marginTop: 4, marginBottom: 12, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4,
  },
  refinementTitle: { fontSize: 15, fontWeight: '600', color: '#000' },
  refinementInput: {
    borderRadius: 10, backgroundColor: '#F2F2F7', padding: 12,
    fontSize: 14, color: '#000', minHeight: 72, textAlignVertical: 'top',
  },
  refinementBtn: {
    height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FF6B35',
  },
  refinementBtnDisabled: { backgroundColor: '#C7C7CC' },
  refinementBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },

  // Feedback
  feedbackBox: {
    backgroundColor: '#fff', borderRadius: 14, padding: 20, marginBottom: 12,
    alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4,
  },
  feedbackTitle: { fontSize: 15, fontWeight: '600', color: '#000' },
  stars: { flexDirection: 'row', gap: 6 },
  starBtn: { padding: 6 },
  starText: { fontSize: 30, color: '#E5E5EA' },
  starActive: { color: '#FF9F0A' },
  feedbackThanks: { fontSize: 15, fontWeight: '600', color: '#34C759' },

  loadMoreBtn: {
    alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 12,
    borderRadius: 999, marginBottom: 12,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#FF6B35',
    shadowColor: '#FF6B35', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6,
  },
  loadMoreText: { fontSize: 14, fontWeight: '600', color: '#FF6B35' },

  resetBtn: {
    alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 999, marginBottom: 12,
  },
  resetBtnText: { fontSize: 15, color: '#FF6B35', fontWeight: '500' },

  // Report modal
  modalOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'flex-end', padding: 0,
  },
  modal: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, width: '100%',
  },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#000', marginBottom: 4 },
  modalSpotName: { fontSize: 13, color: '#8E8E93', marginBottom: 16 },
  modalThanks: { fontSize: 15, fontWeight: '600', color: '#34C759', textAlign: 'center', marginVertical: 16 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: '#6D6D72', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  modalOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  modalOption: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#F2F2F7',
  },
  modalOptionActive: { backgroundColor: '#FF6B3520' },
  modalOptionText: { fontSize: 14, fontWeight: '500', color: '#000' },
  modalOptionTextActive: { color: '#FF6B35' },
  modalInput: {
    borderRadius: 10, backgroundColor: '#F2F2F7', padding: 12,
    fontSize: 14, color: '#000', marginBottom: 16, minHeight: 60, textAlignVertical: 'top',
  },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: {
    flex: 1, height: 48, borderRadius: 10, backgroundColor: '#F2F2F7',
    alignItems: 'center', justifyContent: 'center',
  },
  modalCancelText: { fontSize: 15, fontWeight: '500', color: '#6D6D72' },
  modalSubmitBtn: {
    flex: 1, height: 48, borderRadius: 10, backgroundColor: '#FF3B30',
    alignItems: 'center', justifyContent: 'center',
  },
  modalSubmitText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  modalCloseBtn: {
    alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 10, backgroundColor: '#F2F2F7', marginTop: 8,
  },
  modalCloseBtnText: { fontSize: 14, fontWeight: '500', color: '#6D6D72' },
});
