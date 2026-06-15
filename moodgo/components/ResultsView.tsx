import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef, useEffect } from 'react';
import {
  Alert,
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
import {
  Banknote, ChevronDown, ChevronLeft, ChevronUp,
  Eye, List, MapPin, MessageSquare, Navigation,
  Search, Shuffle, Sparkles, Star, Tag, Users, X,
} from 'lucide-react-native';
import PuniPressable from './PuniPressable';
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
    feedbackThanks: 'ありがとうございました！',
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
    visitedDone: '行った',
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
    feedbackThanks: 'Thank you!',
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
    visitedDone: 'Visited',
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
  budget?: number;
  budgetMin?: number;
  deepDiveL1?: string;
  deepDiveL2?: string;
  freeWord?: string;
  areaMode?: 'current_location' | 'manual';
  distanceFeeling?: string;
  radiusKm?: number;
  onChangeRadius?: (km: number) => void;
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
  searchFailed?: boolean;
  onRetrySearch?: () => void;
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
  /** 「条件を見直す」: 気分は保持して、その次の質問から再選択する */
  onReviewConditions?: () => void;
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
  onPressDetail?: (rec: Recommendation) => void;
  onSubmitPlaceRating?: (title: string, verdict: 'good' | 'bad') => void;
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
    selectedMood, selectedArea, selectedCompanion = '',
    budget, budgetMin = 0,
    deepDiveL1 = '', deepDiveL2 = '', freeWord = '',
    areaMode, distanceFeeling, radiusKm, onChangeRadius,
    recommendations, onsenFacilities, onsenCategoryLabel,
    natureFacilities, natureSubGenreLabel, cafeFacilities, cafeSubCategoryLabel,
    waiWaiFacilities, waiWaiSubCategoryLabel,
    driveFacilities, driveSubCategoryLabel,
    focusFacilities, focusSubCategoryLabel,
    sportsFacilities, sportsSubCategoryLabel,
    travelFacilities, travelSubCategoryLabel,
    isLoading, loadingMessage, apiWarning, searchFailed, onRetrySearch,
    favorites, onToggleFavorite, blockedPlaces, onBlockPlace,
    placeRatings, onSetPlaceRatings,
    feedbackRating, feedbackSubmitted, onSubmitFeedback,
    refinementText, onSetRefinementText, isRefining, onRefine,
    onReset, onReviewConditions, onSetReportingSpot, reportingSpot,
    reportReason, onSetReportReason, reportNote, onSetReportNote,
    reportSubmitting, reportDone, onSubmitReport,
    onSubmitVisitedFeedback, onShuffle,
    prefectureButtons = [], selectedPrefecture = '', onSelectPrefecture,
    seenPlaceTitles = [],
    lang = 'ja',
    onPressDetail,
    onSubmitPlaceRating,
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
    // 統一形式 "車で約15分 / 12.3km" は距離(km)がスラッシュの後ろにある。
    // 先頭の "約15分"(所要時間)を距離と誤認しないよう、まず "Nkm"/"Nm" を優先抽出する。
    // 旧形式 "12.3km" / "500m" / 裸の数値 にも後方互換。
    const km = s.match(/([\d.]+)\s*km/);
    if (km) return parseFloat(km[1]) * 1000;
    const m = s.match(/([\d.]+)\s*m(?![a-z])/i);
    if (m) return parseFloat(m[1]);
    const any = s.match(/[\d.]+/);
    return any ? parseFloat(any[0]) : Infinity;
  };

  let facilityItems = facilityList
    ? facilityList.filter((f) => !blockedPlaces.includes(f.name)).map((f) => placeToRec(f, facilityLabel))
    : recommendations.filter((r) => !blockedPlaces.includes(r.title));

  // フィルタ適用前の件数を保持（0件時に「検索で0件」か「フィルタで0件」かを区別するため）
  const preFilterCount = facilityItems.length;
  const anyFilterActive = !!selectedPrefecture || openNowOnly || unseenOnly;

  if (selectedPrefecture) facilityItems = facilityItems.filter((i) => i.address?.includes(selectedPrefecture));
  // 営業中フィルタは3値ロジック: openNow===false（明確に閉店中）のみ除外し、
  // 営業情報を持たないDBスポット(openNow=undefined/null、OSM/Wikidata等多数)は残す。
  // ※ 厳密一致(===true)だと営業情報なしの数万件が全消えし「営業中の店がほぼ無い」状態になっていた。
  if (openNowOnly) facilityItems = facilityItems.filter((i) => i.openNow !== false);
  if (unseenOnly) facilityItems = facilityItems.filter((i) => !seenPlaceTitles.includes(i.title));
  if (resultSort === 'rating') facilityItems = [...facilityItems].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  else if (resultSort === 'near') facilityItems = [...facilityItems].sort((a, b) => parseDistanceM(a.distanceText) - parseDistanceM(b.distanceText));

  // スキップ値を除外するヘルパー
  const notSkipped = (v: string) => v && v !== 'スキップ' && v !== 'Skip' && v !== 'skip';

  // 今回の条件チップ（スキップは除外・全質問を表示）
  type LIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  const condChips: { label: string; value: string; Icon: LIcon }[] = [];
  if (notSkipped(selectedMood))       condChips.push({ label: t.condMood,      value: selectedMood,                         Icon: Sparkles });
  if (notSkipped(selectedCompanion))  condChips.push({ label: t.condWith,      value: selectedCompanion,                    Icon: Users });
  if (budget === 0)                   condChips.push({ label: t.condBudget,    value: '無料',                               Icon: Banknote });
  else if (budget != null && budget > 0) {
    const bStr = budgetMin > 0 ? `¥${budgetMin.toLocaleString()}〜¥${budget.toLocaleString()}` : `〜¥${budget.toLocaleString()}`;
    condChips.push({ label: t.condBudget, value: bStr, Icon: Banknote });
  }
  if (distanceFeeling || radiusKm)    condChips.push({ label: '距離',           value: distanceFeeling || `${radiusKm}km以内`, Icon: Navigation });
  if (notSkipped(deepDiveL1))         condChips.push({ label: '詳細',           value: deepDiveL1,                           Icon: Tag });
  if (notSkipped(deepDiveL2))         condChips.push({ label: 'スタイル',        value: deepDiveL2,                           Icon: Sparkles });
  if (freeWord && freeWord.trim())    condChips.push({ label: '希望',           value: freeWord,                             Icon: MessageSquare });
  if (notSkipped(selectedArea))       condChips.push({ label: t.condArea,      value: selectedArea,                         Icon: MapPin });
  if (facilityLabel)                  condChips.push({ label: 'コース',         value: facilityLabel,                        Icon: Tag });

  // 心霊スポット時は画面全体を怖い雰囲気に。ただし「検索中は白、結果が出たら暗く」。
  const isShinrei = deepDiveL1 === '心霊';
  const dark = isShinrei && !isLoading;
  const darkText = dark ? '#E7DCFF' : undefined;

  return (
    <View style={[s.root, dark && s.rootSpooky]}>
      {/* 心霊: 結果表示後に画面全体へ暗い霧のグラデーション背景を敷く */}
      {dark && (
        <LinearGradient
          colors={['#1B0F33', '#100722', '#050210']}
          start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      {/* iOS navigation bar */}
      <View style={[s.navBar, dark && s.navBarSpooky, { paddingTop: insets.top }]}>
        <BlurView intensity={dark ? 40 : 80} tint={dark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={s.navBarBorder} />
        <View style={s.navBarInner}>
          <TouchableOpacity onPress={onReset} style={s.backBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <ChevronLeft size={20} color={dark ? '#C9B6FF' : BRAND} strokeWidth={2.5} />
            <Text style={[s.backText, darkText ? { color: darkText } : null]}>{t.back}</Text>
          </TouchableOpacity>
          <View style={s.navCenter}>
            <Text style={[s.navTitle, darkText ? { color: darkText } : null]} numberOfLines={1}>{pageTitle}</Text>
            {!isLoading && facilityItems.length > 0 && (
              <Text style={[s.navCount, dark ? { color: 'rgba(200,185,245,0.7)' } : null]}>{facilityItems.length}{lang === 'ja' ? '件' : ' spots'}</Text>
            )}
          </View>
          <View style={s.navRight}>
            {onShuffle && !isLoading && (
              <PuniPressable onPress={onShuffle} style={s.shuffleBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Shuffle size={20} color={BRAND} strokeWidth={2} />
              </PuniPressable>
            )}
          </View>
        </View>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 今回の条件 ─────────────────────────────── */}
        {condChips.length > 0 && !isLoading && (
          <TouchableOpacity
            onPress={() => setShowConditions((v) => !v)}
            activeOpacity={0.85}
            style={[s.condCard, dark && s.condCardDark]}
          >
            <View style={s.condHeader}>
              <View style={s.condLabelRow}>
                <List size={14} color={dark ? '#B79CFF' : '#A78BFA'} strokeWidth={2} />
                <Text style={[s.condLabel, darkText ? { color: darkText } : null]}>{t.conditionLabel}</Text>
              </View>
              {showConditions
                ? <ChevronUp size={14} color={dark ? '#8C7BB8' : '#9CA3AF'} strokeWidth={2} />
                : <ChevronDown size={14} color={dark ? '#8C7BB8' : '#9CA3AF'} strokeWidth={2} />}
            </View>
            {showConditions && (
              <View style={s.condChips}>
                {condChips.map((c, i) => (
                  <View key={i} style={[s.condChip, dark && s.condChipDark]}>
                    <c.Icon size={11} color={dark ? '#B79CFF' : '#A78BFA'} strokeWidth={2} />
                    <Text style={s.condChipLabel}>{c.label}</Text>
                    <Text style={[s.condChipValue, dark && { color: '#E7DCFF' }]}>{c.value}</Text>
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

              {/* ソートボタン */}
              {([
                { mode: 'default', Icon: Sparkles,  label: t.sortDefault },
                { mode: 'rating',  Icon: Star,       label: t.sortRating },
                { mode: 'near',    Icon: Navigation, label: t.sortNear },
              ] as const).map(({ mode, Icon, label }) => {
                const active = resultSort === mode;
                return (
                  <TouchableOpacity
                    key={mode}
                    onPress={() => setResultSort(mode)}
                    style={[s.controlChip, dark && s.controlChipDark, active && s.controlChipActive]}
                    activeOpacity={0.75}
                  >
                    {active && (
                      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                    )}
                    <Icon size={13} color={active ? '#fff' : (dark ? '#B7A8D9' : '#9CA3AF')} strokeWidth={2} />
                    <Text style={[s.controlChipText, dark && !active && s.controlChipTextDark, active && s.controlChipTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {/* 区切り */}
              <View style={s.controlDivider} />

              {/* 営業中フィルター */}
              <TouchableOpacity
                onPress={() => setOpenNowOnly((v) => !v)}
                style={[s.controlChip, dark && s.controlChipDark, openNowOnly && s.controlChipOpenActive]}
                activeOpacity={0.75}
              >
                {openNowOnly && (
                  <LinearGradient colors={['#34C759', '#30D158']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                )}
                <View style={[s.openDot, openNowOnly && s.openDotActive]} />
                <Text style={[s.controlChipText, dark && !openNowOnly && s.controlChipTextDark, openNowOnly && s.controlChipTextActive]}>{t.filterOpenNow}</Text>
              </TouchableOpacity>

              {/* 未見フィルター */}
              {seenPlaceTitles.length > 0 && (
                <TouchableOpacity
                  onPress={() => setUnseenOnly((v) => !v)}
                  style={[s.controlChip, dark && s.controlChipDark, unseenOnly && s.controlChipActive]}
                  activeOpacity={0.75}
                >
                  {unseenOnly && (
                    <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                  )}
                  <Eye size={13} color={unseenOnly ? '#fff' : (dark ? '#B7A8D9' : '#9CA3AF')} strokeWidth={2} />
                  <Text style={[s.controlChipText, dark && !unseenOnly && s.controlChipTextDark, unseenOnly && s.controlChipTextActive]}>{t.filterUnseen}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        )}

        {/* ── エリアを広げる（手動エリアモード＋スリルは現在地でも表示）─── */}
        {/* スリルは独自データのみで件数が少ないため、現在地検索でも距離拡大ボタンを出す */}
        {!isLoading && (areaMode === 'manual' || deepDiveL1 === '心霊') && onChangeRadius && (() => {
          const RADIUS_STEPS = [2, 5, 10, 20, 40, 80];
          const nextRadius = RADIUS_STEPS.find(r => r > (radiusKm ?? 0));
          if (!nextRadius) return null;
          return (
            <TouchableOpacity
              onPress={() => onChangeRadius(nextRadius)}
              activeOpacity={0.82}
              style={[s.expandAreaBtn, dark && s.expandAreaBtnDark]}
            >
              <LinearGradient colors={dark ? ['#2A1A45', '#1A1030'] : ['#E0F2FE', '#EDE9FE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
              <Navigation size={14} color={dark ? '#C9B6FF' : BRAND} strokeWidth={2.5} />
              <Text style={[s.expandAreaText, dark && { color: '#D9CBFF' }]}>
                エリアを広げる（{nextRadius}km圏内）
              </Text>
            </TouchableOpacity>
          );
        })()}

        {/* ── 心霊・スリルの注意/免責バナー ─── */}
        {!isLoading && deepDiveL1 === '心霊' && (
          <View style={[s.cautionBanner, dark && s.cautionBannerDark]}>
            <Text style={[s.cautionText, dark && { color: '#F0B8A0' }]}>
              ⚠️ 私有地・立入禁止区域には入らないでください。訪問は自己責任で、危険行為・無断侵入は推奨しません。
            </Text>
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
              <TouchableOpacity onPress={() => onSelectPrefecture?.('')} style={[s.prefChip, s.prefChipClear, { flexDirection: 'row', alignItems: 'center', gap: 3 }]} activeOpacity={0.7}>
                <X size={12} color="#9CA3AF" strokeWidth={2.4} />
                <Text style={s.prefChipClearText}>解除</Text>
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

        {/* Warning（失敗時は再試行ボタンも出す） */}
        {apiWarning && !isLoading ? (
          <View style={s.warningBox}>
            <Text style={s.warningText}>{apiWarning}</Text>
            {searchFailed && onRetrySearch && (
              <PuniPressable onPress={onRetrySearch} style={s.retryBtn}>
                <Text style={s.retryBtnText}>{lang === 'ja' ? 'もう一度試す' : 'Try again'}</Text>
              </PuniPressable>
            )}
          </View>
        ) : null}

        {/* Results — 2カラムのマソンリー配置（みんなの穴場フィードと同じ見た目） */}
        {!isLoading && facilityItems.length > 0 && (() => {
          const shown = facilityItems.slice(0, visibleCount);
          const renderCard = (item: typeof shown[number], key: string) => (
            <PlaceCard
              key={key}
              item={item}
              compact
              isFavorited={isFav(item.title)}
              onToggleFavorite={() => onToggleFavorite(item)}
              onBlock={() => Alert.alert(
                lang === 'ja' ? 'このスポットを非表示にしますか？' : 'Hide this spot?',
                lang === 'ja'
                  ? `「${item.title}」を今後の検索結果に表示しなくなります。\n設定 →「非表示にしたスポット」からいつでも解除できます。`
                  : `"${item.title}" will no longer appear in search results.\nYou can undo this anytime from Settings → Hidden spots.`,
                [
                  { text: lang === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
                  { text: lang === 'ja' ? '非表示にする' : 'Hide', style: 'destructive', onPress: () => onBlockPlace(item.title) },
                ],
              )}
              onReport={() => onSetReportingSpot({ title: item.title, address: item.address ?? '', supabaseId: item.supabaseId })}
              onMarkVisited={() => { setVisitingSpot(item); setVisitingRating(0); }}
              isVisited={visitedTitles.includes(item.title)}
              accentColor={accentColor}
              lang={lang}
              moodRating={placeRatings[item.title] ?? null}
              onMoodMatch={() => { onSetPlaceRatings({ ...placeRatings, [item.title]: 'good' }); onSubmitPlaceRating?.(item.title, 'good'); }}
              onMoodNotMatch={() => { onSetPlaceRatings({ ...placeRatings, [item.title]: 'bad' }); onSubmitPlaceRating?.(item.title, 'bad'); }}
              moodLabel={notSkipped(selectedMood) ? selectedMood : undefined}
              onPressDetail={onPressDetail ? () => onPressDetail(item) : undefined}
              spooky={isShinrei}
              darkTheme={isShinrei}
            />
          );
          return (
            <View style={s.resultCols}>
              <View style={s.resultCol}>{shown.filter((_, i) => i % 2 === 0).map((it, i) => renderCard(it, `L${i}-${it.title}`))}</View>
              <View style={s.resultCol}>{shown.filter((_, i) => i % 2 === 1).map((it, i) => renderCard(it, `R${i}-${it.title}`))}</View>
            </View>
          );
        })()}

        {/* Load more */}
        {!isLoading && visibleCount < facilityItems.length && (
          <PuniPressable
            onPress={() => setVisibleCount((c) => c + PAGE_SIZE)}
            style={[s.loadMoreBtn, dark && s.loadMoreBtnDark, { borderColor: dark ? '#A07BD9' : accentColor }]}
            containerStyle={{ alignSelf: 'center' }}
          >
            <Text style={[s.loadMoreText, { color: dark ? '#C9B6FF' : accentColor }]}>
              {t.loadMore(facilityItems.length - visibleCount)}
            </Text>
          </PuniPressable>
        )}

        {/* Empty state（検索失敗時は上の警告＋再試行を出すので、矛盾する「該当なし」は出さない） */}
        {!isLoading && facilityItems.length === 0 && !searchFailed && (
          <View style={s.emptyBox}>
            <Search size={48} color="#C7C7CC" strokeWidth={1.5} />
            {preFilterCount > 0 && anyFilterActive ? (
              // フィルタ起因の0件: 検索自体は結果ありなので、原因明示＋ワンタップ解除を出す
              <>
                <Text style={s.emptyText}>
                  {lang === 'ja'
                    ? `絞り込み条件に合うスポットがありません。\n（${preFilterCount}件中0件）`
                    : `No spots match the current filters.\n(0 of ${preFilterCount})`}
                </Text>
                <TouchableOpacity
                  onPress={() => { setOpenNowOnly(false); setUnseenOnly(false); onSelectPrefecture?.(''); }}
                  style={[s.retryBtn, { backgroundColor: accentColor }]}
                  activeOpacity={0.85}
                >
                  <Text style={s.retryBtnText}>{lang === 'ja' ? 'フィルタを解除' : 'Clear filters'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={s.emptyText}>{t.empty}</Text>
            )}
          </View>
        )}

        {/* Refinement */}
        {!isLoading && facilityItems.length > 0 && (
          <View style={[s.refinementBox, dark && s.cardPanelDark]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Search size={16} color={dark ? '#C9B6FF' : '#111827'} strokeWidth={2.2} />
              <Text style={[s.refinementTitle, dark && s.panelTitleDark]}>{t.refineTitle}</Text>
            </View>
            <TextInput
              value={refinementText}
              onChangeText={onSetRefinementText}
              placeholder={t.refinePlaceholder}
              placeholderTextColor={dark ? '#7C6BA8' : '#C7C7CC'}
              multiline
              style={[s.refinementInput, dark && s.refinementInputDark]}
            />
            <PuniPressable
              onPress={onRefine}
              disabled={isRefining || !refinementText.trim()}
              style={[s.refinementBtn, (isRefining || !refinementText.trim()) && s.refinementBtnDisabled]}
            >
              {!(isRefining || !refinementText.trim()) ? (
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
              ) : null}
              <Text style={s.refinementBtnText}>
                {isRefining ? t.searching : t.searchAgain}
              </Text>
            </PuniPressable>
          </View>
        )}

        {/* ── この結果はどうでしたか ─────────────────── */}
        {!isLoading && (recommendations.length > 0 || (facilityList?.length ?? 0) > 0) && (
          <View style={[s.feedbackBox, dark && s.cardPanelDark]}>
            {feedbackSubmitted ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Sparkles size={16} color="#10B981" strokeWidth={2.2} />
                <Text style={s.feedbackThanks}>{t.feedbackThanks}</Text>
              </View>
            ) : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MessageSquare size={16} color={dark ? '#C9B6FF' : '#111827'} strokeWidth={2.2} />
                  <Text style={[s.feedbackTitle, dark && s.panelTitleDark]}>{t.feedbackTitle}</Text>
                </View>
                <View style={s.stars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <PuniPressable key={n} onPress={() => onSubmitFeedback(n)} style={s.starBtn}>
                      <Star
                        size={32}
                        color="#FF9F0A"
                        fill={feedbackRating !== null && n <= (feedbackRating ?? 0) ? '#FF9F0A' : 'none'}
                        strokeWidth={1.8}
                      />
                    </PuniPressable>
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {/* ── 条件を見直す / ホームに戻る ──────────── */}
        {!isLoading && (
          <View style={s.bottomBtns}>
            <PuniPressable onPress={onReviewConditions ?? onReset} style={[s.reviewBtn, dark && s.reviewBtnDark]} containerStyle={{ flex: 1 }}>
              <Text style={[s.reviewBtnText, dark && { color: '#C9B6FF' }]}>条件を見直す</Text>
            </PuniPressable>
            <PuniPressable onPress={onReset} style={s.homeBtn} containerStyle={{ flex: 1 }}>
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.homeBtnInner}>
                <Text style={s.homeBtnText}>ホームに戻る</Text>
              </LinearGradient>
            </PuniPressable>
          </View>
        )}
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
                <PuniPressable key={n} onPress={() => setVisitingRating(n)} style={s.starBtn}>
                  <Star size={28} color="#FF9F0A" fill={visitingRating >= n ? '#FF9F0A' : 'none'} strokeWidth={1.8} />
                </PuniPressable>
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
  rootSpooky: { backgroundColor: '#050210' },
  // ── 心霊ダークテーマ ──
  condCardDark: { backgroundColor: 'rgba(28,18,48,0.92)', borderColor: 'rgba(140,110,210,0.3)' },
  condChipDark: { backgroundColor: 'rgba(45,30,70,0.9)', borderColor: 'rgba(140,110,210,0.25)' },
  controlChipDark: { backgroundColor: 'rgba(30,20,50,0.85)', borderColor: 'rgba(140,110,210,0.3)' },
  controlChipTextDark: { color: '#B7A8D9' },
  expandAreaBtnDark: { borderColor: 'rgba(150,120,220,0.4)' },
  cautionBannerDark: { backgroundColor: 'rgba(60,25,20,0.7)', borderColor: 'rgba(180,90,70,0.4)' },
  loadMoreBtnDark: { backgroundColor: 'rgba(30,20,50,0.85)' },
  cardPanelDark: { backgroundColor: 'rgba(24,15,42,0.92)', borderColor: 'rgba(140,110,210,0.28)' },
  panelTitleDark: { color: '#EFE6FF' },
  refinementInputDark: { backgroundColor: 'rgba(12,7,24,0.7)', borderColor: 'rgba(140,110,210,0.25)', color: '#E7DCFF' },
  reviewBtnDark: { backgroundColor: 'rgba(30,20,50,0.85)', borderColor: 'rgba(150,120,220,0.4)' },
  navBar: { zIndex: 10, overflow: 'hidden', backgroundColor: 'rgba(243,241,239,0.85)', borderBottomWidth: 1, borderBottomColor: 'rgba(192,132,252,0.18)' },
  navBarSpooky: { backgroundColor: 'rgba(12,7,24,0.7)', borderBottomColor: 'rgba(140,110,210,0.25)' },
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
  condCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 12,
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.15)',
  },
  condHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 },
  condLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  condLabel: { fontSize: 13, fontWeight: '700', color: '#374151' },
  condChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  condChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FAF8FF', borderRadius: 10,
    paddingHorizontal: 9, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.2)',
  },
  condChipLabel: { fontSize: 10, fontWeight: '600', color: '#A78BFA' },
  condChipValue: { fontSize: 12, fontWeight: '700', color: '#1E0753' },

  // ── Sort / Filter chips ──────────────────────────────────────────────────
  controlsWrap: { marginBottom: 10 },
  controlsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 0, alignItems: 'center' },
  controlChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(192,132,252,0.25)',
    overflow: 'hidden',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  controlChipActive: {
    borderColor: 'transparent',
    shadowColor: '#C084FC', shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  controlChipOpenActive: {
    borderColor: 'transparent',
    shadowColor: '#34C759', shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  controlChipText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  controlChipTextActive: { color: '#fff', fontWeight: '700' },
  openDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#34C759' },
  openDotActive: { backgroundColor: '#fff' },
  controlDivider: { width: 1, height: 20, backgroundColor: 'rgba(192,132,252,0.2)', marginHorizontal: 2 },
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
  retryBtn: { marginTop: 10, alignSelf: 'flex-start', backgroundColor: '#7C3AED', borderRadius: 12, paddingVertical: 9, paddingHorizontal: 18 },
  retryBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  resultCols: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  resultCol: { flex: 1, gap: 0 },
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
  // ボトム2ボタン
  bottomBtns:    { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 8 },
  reviewBtn:     { flex: 1, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 2, borderColor: 'rgba(192,132,252,0.4)' },
  reviewBtnText: { fontSize: 15, fontWeight: '700', color: BRAND },
  homeBtn:       { flex: 1, borderRadius: 16, overflow: 'hidden' },
  homeBtnInner:  { height: 54, alignItems: 'center', justifyContent: 'center' },
  homeBtnText:   { fontSize: 15, fontWeight: '800', color: '#fff' },
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
  // ── エリアを広げるボタン ─────────────────────────────────────────────────
  expandAreaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    height: 46, borderRadius: 999, marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1.5, borderColor: 'rgba(192,132,252,0.3)',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3,
  },
  expandAreaText: { fontSize: 14, fontWeight: '700', color: BRAND },

  // 心霊・スリルの注意/免責バナー
  cautionBanner: {
    backgroundColor: '#FFF7ED', borderRadius: 12,
    borderWidth: 1, borderColor: '#FED7AA',
    paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12,
  },
  cautionText: { fontSize: 12, color: '#9A3412', lineHeight: 18, fontWeight: '600' },
});
