import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

function SlideUp({ children }: { children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const slideY  = useRef(new Animated.Value(32)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(slideY,  { toValue: 0, tension: 180, friction: 22, useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={{ flex: 1, opacity, transform: [{ translateY: slideY }] }}>
      {children}
    </Animated.View>
  );
}
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OnsenCategory, PlaceResponse } from '@/types/onsen';
import type { NatureSubGenre, NatureDistancePref } from '@/types/nature';
import type { CafeSubCategory, CafeDetail, CafeDistancePref } from '@/types/cafe';
import type { WaiWaiSubCategory } from '@/types/waiwai';
import {
  FAVORITES_KEY, HISTORY_KEY, FEEDBACK_KEY,
  PENDING_VISITED_KEY, BLOCKED_PLACES_KEY, PROFILE_KEY,
  loadJSON, saveJSON,
} from '@/lib/storage';
import { apiFetch } from '@/lib/api';

import HomeView from '@/components/HomeView';
import TabBar from '@/components/TabBar';
import HistoryView from '@/components/HistoryView';
import FavoritesView from '@/components/FavoritesView';
import FeaturedView from '@/components/FeaturedView';
import ProfileSetup from '@/components/ProfileSetup';
import QuizFlow from '@/components/QuizFlow';
import ResultsView from '@/components/ResultsView';
import SettingsView from '@/components/SettingsView';
import type {
  Recommendation, FavoriteItem, FeedbackItem, HistoryItem,
  Answers, DynamicQuestion, FeaturedPageSummary,
} from '@/types/app';
export type { Recommendation, FavoriteItem, FeedbackItem, HistoryItem, Answers, DynamicQuestion, FeaturedPageSummary };

// ─── Constants ───────────────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  'あなたにぴったりの場所を探しています…',
  'AIが気分をもとに分析中…',
  '近くのスポットを調べています…',
  'もう少しお待ちください…',
  'おすすめを厳選中…',
];

// ─── Main App ────────────────────────────────────────────────────────────────

export default function Home() {
  const insets = useSafeAreaInsets();

  // Navigation
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(1);
  const [homeView, setHomeView] = useState<'home' | 'history' | 'favorites' | 'featured'>('home');

  // Quiz state
  const [selectedMood, setSelectedMood] = useState('');
  const [selectedArea, setSelectedArea] = useState('');
  const [locationDisplayArea, setLocationDisplayArea] = useState('');
  const [selectedCompanion, setSelectedCompanion] = useState('');
  const [selectedTransports, setSelectedTransports] = useState<string[]>([]);
  const [budget, setBudget] = useState<number | undefined>(10000);
  const [budgetMin, setBudgetMin] = useState<number>(0);
  const [showUnseenOnly, setShowUnseenOnly] = useState(false);
  const [selectedTime, setSelectedTime] = useState('');
  const [selectedAtmosphere, setSelectedAtmosphere] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('');
  const [freeWord, setFreeWord] = useState('');
  const [dynamicQuestions, setDynamicQuestions] = useState<DynamicQuestion[]>([]);
  const [dynamicAnswers, setDynamicAnswers] = useState<Record<string, string>>({});

  // Profile
  const [profileSetupDone, setProfileSetupDone] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileAge, setProfileAge] = useState('');
  const [profileGender, setProfileGender] = useState('');
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Results
  const [apiRecommendations, setApiRecommendations] = useState<Recommendation[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [apiWarning, setApiWarning] = useState('');
  const [blockedPlaces, setBlockedPlaces] = useState<string[]>([]);
  const [refinementText, setRefinementText] = useState('');
  const [isRefining, setIsRefining] = useState(false);

  // Feedback
  const [pastFeedback, setPastFeedback] = useState<FeedbackItem[]>([]);
  const [pendingVisited, setPendingVisited] = useState<FeedbackItem | null>(null);
  const [pendingVisitedInput, setPendingVisitedInput] = useState('');
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [feedbackVisitedPlace, setFeedbackVisitedPlace] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [likedInSession, setLikedInSession] = useState<string[]>([]);
  const [mapClickedInSession, setMapClickedInSession] = useState<string[]>([]);
  const [placeRatings, setPlaceRatings] = useState<Record<string, 'good' | 'bad'>>({});

  // Photos & UI
  const [photoIndices, setPhotoIndices] = useState<Record<string, number>>({});
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lang, setLang] = useState<'ja' | 'en'>('ja');

  // Location
  const [originLat, setOriginLat] = useState<number | undefined>();
  const [originLng, setOriginLng] = useState<number | undefined>();
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  // Favorites & History
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const [favoriteSort, setFavoriteSort] = useState<'newest' | 'title'>('newest');

  // Featured
  const [featuredList, setFeaturedList] = useState<FeaturedPageSummary[]>([]);
  const [featuredListLoading, setFeaturedListLoading] = useState(false);

  // Mood-specific: Onsen
  const [onsenCategory, setOnsenCategory] = useState<OnsenCategory | null>(null);
  const [onsenFacilities, setOnsenFacilities] = useState<PlaceResponse[] | null>(null);
  const [onsenCategoryLabel, setOnsenCategoryLabel] = useState('');
  const [isLoadingOnsen, setIsLoadingOnsen] = useState(false);

  // Mood-specific: Nature
  const [natureSubGenre, setNatureSubGenre] = useState<NatureSubGenre | null>(null);
  const [natureDistancePref, setNatureDistancePref] = useState<NatureDistancePref | null>(null);
  const [natureFacilities, setNatureFacilities] = useState<PlaceResponse[] | null>(null);
  const [natureSubGenreLabel, setNatureSubGenreLabel] = useState('');
  const [isLoadingNature, setIsLoadingNature] = useState(false);

  // Mood-specific: Cafe
  const [cafeSubCategory, setCafeSubCategory] = useState<CafeSubCategory | null>(null);
  const [cafeDetail, setCafeDetail] = useState<CafeDetail | null>(null);
  const [cafeDetailMode, setCafeDetailMode] = useState(false);
  const [cafeDistancePref, setCafeDistancePref] = useState<CafeDistancePref | null>(null);
  const [cafeFacilities, setCafeFacilities] = useState<PlaceResponse[] | null>(null);
  const [cafeSubCategoryLabel, setCafeSubCategoryLabel] = useState('');
  const [isLoadingCafe, setIsLoadingCafe] = useState(false);

  // Mood-specific: WaiWai
  const [waiWaiSubCategory, setWaiWaiSubCategory] = useState<WaiWaiSubCategory | null>(null);
  const [waiWaiFacilities, setWaiWaiFacilities] = useState<PlaceResponse[] | null>(null);
  const [waiWaiSubCategoryLabel, setWaiWaiSubCategoryLabel] = useState('');
  const [isLoadingWaiWai, setIsLoadingWaiWai] = useState(false);

  // Report
  const [reportingSpot, setReportingSpot] = useState<{ title: string; address: string } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  const loadingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Load from AsyncStorage ──────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const faves = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
      const hist = await loadJSON<HistoryItem[]>(HISTORY_KEY, []);
      const feed = await loadJSON<FeedbackItem[]>(FEEDBACK_KEY, []);
      const pending = await loadJSON<FeedbackItem | null>(PENDING_VISITED_KEY, null);
      const blocked = await loadJSON<string[]>(BLOCKED_PLACES_KEY, []);
      const profile = await loadJSON<{ age?: string; gender?: string }>(PROFILE_KEY, {});
      setFavorites(faves);
      setHistory(hist);
      setPastFeedback(feed);
      if (pending) setPendingVisited(pending);
      setBlockedPlaces(blocked);
      if (profile.age) setProfileAge(profile.age);
      if (profile.gender) setProfileGender(profile.gender);
      setProfileSetupDone(!!(profile.age || profile.gender));
      setProfileLoaded(true);
    })();
  }, []);

  useEffect(() => { saveJSON(FAVORITES_KEY, favorites); }, [favorites]);
  useEffect(() => { saveJSON(HISTORY_KEY, history); }, [history]);
  useEffect(() => { saveJSON(FEEDBACK_KEY, pastFeedback); }, [pastFeedback]);
  useEffect(() => { saveJSON(BLOCKED_PLACES_KEY, blockedPlaces); }, [blockedPlaces]);

  // ─── Featured ───────────────────────────────────────────────────────────

  const loadFeaturedList = async () => {
    if (featuredList.length > 0) return;
    setFeaturedListLoading(true);
    try {
      const res = await apiFetch('/api/featured');
      const d = await res.json();
      if (d.ok) setFeaturedList(d.data);
    } catch {}
    setFeaturedListLoading(false);
  };

  // ─── Location ──────────────────────────────────────────────────────────

  const handleUseCurrentLocation = async () => {
    const Location = await import('expo-location');
    setIsLocating(true);
    setLocationError('');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setLocationError('位置情報の権限が必要です');
      setIsLocating(false);
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude, longitude } = pos.coords;
    setOriginLat(latitude);
    setOriginLng(longitude);
    try {
      const res = await apiFetch('/api/location-to-area', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude, longitude }),
      });
      const d = await res.json();
      setSelectedArea(d.area ?? '現在地');
      setLocationDisplayArea(d.displayArea ?? d.area ?? '現在地');
    } catch {
      setSelectedArea('現在地');
      setLocationDisplayArea('現在地');
    }
    setIsLocating(false);
  };

  // ─── Open results ──────────────────────────────────────────────────────

  const openResults = async (refineText = '', isRefinement = false) => {
    if (loadingTimer.current) clearInterval(loadingTimer.current);
    setLoadingMsgIdx(0);
    loadingTimer.current = setInterval(() => {
      setLoadingMsgIdx((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 1800);

    const relaxPlace = dynamicAnswers['relax_place'] ?? '';
    const isNatureMode =
      selectedMood === '自然感じたい' ||
      (selectedMood === 'まったりしたい' && relaxPlace.includes('自然の中'));
    const isOnsenMode =
      selectedMood === 'まったりしたい' && relaxPlace.includes('温泉');
    const isCafeMode =
      selectedMood === 'まったりしたい' && relaxPlace.includes('カフェ');
    const isWaiWaiMode =
      selectedMood === 'わいわい楽しみたい' && !!waiWaiSubCategory;

    if (!isRefinement) setStep(11);

    if (selectedMood === '時間潰したい') {
      setIsLoadingRecommendations(true);
      try {
        const res = await apiFetch('/api/random-spots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: originLat, lng: originLng,
            radiusKm: 5, limit: 10,
            companion: selectedCompanion, budget, freeWord,
          }),
        });
        const d = await res.json();
        const spots = d.data ?? d.spots ?? [];
        const recs: Recommendation[] = spots.map((p: PlaceResponse) => ({
          title: p.name, address: p.address, mapUrl: p.googleMapsUrl,
          rating: p.rating, userRatingCount: p.reviewCount,
          photoUrl: p.imageUrl || undefined, photoUrls: p.photoUrls ?? [],
          openNow: p.openNow ?? undefined, features: [p.description].filter(Boolean) as string[],
          source: p.source, hotpepperUrl: p.hotpepperUrl,
        }));
        if (recs.length > 0) {
          setApiRecommendations(recs);
          const newItem: HistoryItem = {
            id: Date.now().toString(), mood: selectedMood, area: selectedArea,
            companion: selectedCompanion, transport: selectedTransports,
            budget: budget ?? 0, time: selectedTime,
            atmosphere: selectedAtmosphere, priority: selectedPriority, freeWord,
            topRecommendation: recs[0]?.title ?? '',
            createdAt: new Date().toISOString(), recommendations: recs, savedAnswers: {},
          };
          setHistory((prev) => [newItem, ...prev].slice(0, 30));
        }
      } catch {}
      setIsLoadingRecommendations(false);
      if (loadingTimer.current) clearInterval(loadingTimer.current);
      return;
    }

    if (isNatureMode && natureSubGenre) {
      setIsLoadingNature(true);
      try {
        const res = await apiFetch('/api/nature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subGenre: natureSubGenre, lat: originLat, lng: originLng,
            areaLabel: selectedArea, transport: selectedTransports, distancePref: natureDistancePref,
          }),
        });
        const d = await res.json();
        if (d.data) { setNatureFacilities(d.data); setNatureSubGenreLabel(d.subGenreLabel ?? ''); }
      } catch {}
      setIsLoadingNature(false);
    } else if (isOnsenMode && onsenCategory) {
      setIsLoadingOnsen(true);
      try {
        const res = await apiFetch('/api/onsen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: onsenCategory, lat: originLat, lng: originLng,
            areaLabel: selectedArea, transport: selectedTransports,
            time: selectedTime, companion: selectedCompanion, budget, freeWord,
          }),
        });
        const d = await res.json();
        if (d.data) { setOnsenFacilities(d.data); setOnsenCategoryLabel(d.categoryLabel ?? ''); }
      } catch {}
      setIsLoadingOnsen(false);
    } else if (isCafeMode && cafeSubCategory) {
      setIsLoadingCafe(true);
      try {
        const res = await apiFetch('/api/cafe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subCategory: cafeSubCategory, detail: cafeDetail,
            lat: originLat, lng: originLng, areaLabel: selectedArea,
            transport: selectedTransports, distancePref: cafeDistancePref,
          }),
        });
        const d = await res.json();
        if (d.data) { setCafeFacilities(d.data); setCafeSubCategoryLabel(d.subCategoryLabel ?? ''); }
      } catch {}
      setIsLoadingCafe(false);
    } else if (isWaiWaiMode) {
      setIsLoadingWaiWai(true);
      try {
        const res = await apiFetch('/api/waiwai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subCategory: waiWaiSubCategory, lat: originLat, lng: originLng,
            areaLabel: selectedArea, transport: selectedTransports, age: profileAge,
          }),
        });
        const d = await res.json();
        if (d.data) { setWaiWaiFacilities(d.data); setWaiWaiSubCategoryLabel(d.subCategoryLabel ?? ''); }
      } catch {}
      setIsLoadingWaiWai(false);
    } else {
      setIsLoadingRecommendations(true);
      try {
        const seenPlaces = history.flatMap((h) =>
          h.recommendations?.map((r) => r.title) ?? [h.topRecommendation]
        );
        const answers: Partial<Answers> = {
          mood: selectedMood, area: selectedArea,
          age: profileAge, gender: profileGender,
          companion: selectedCompanion, transport: selectedTransports,
          budget, budgetMin, time: selectedTime,
          atmosphere: selectedAtmosphere, priority: selectedPriority, freeWord,
          dynamicQs: Object.entries(dynamicAnswers).map(([key, answer]) => ({
            question: dynamicQuestions.find((q) => q.key === key)?.question ?? key,
            answer,
          })),
        };
        const res = await apiFetch('/api/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers, pastFeedback, seenPlaces, showUnseenOnly,
            refinementText: refineText, userPreferenceHints: [],
          }),
        });
        const d = await res.json();
        const recs = d.recommendations ?? d.data ?? [];
        if (recs.length > 0) {
          setApiRecommendations(recs);
          setApiWarning(d.warning ?? '');
          const newItem: HistoryItem = {
            id: Date.now().toString(),
            mood: selectedMood, area: selectedArea,
            companion: selectedCompanion, transport: selectedTransports,
            budget: budget ?? 10000, time: selectedTime,
            atmosphere: selectedAtmosphere, priority: selectedPriority, freeWord,
            topRecommendation: recs[0]?.title ?? '',
            createdAt: new Date().toISOString(),
            recommendations: recs, savedAnswers: answers,
          };
          setHistory((prev) => [newItem, ...prev].slice(0, 30));
        }
      } catch {}
      setIsLoadingRecommendations(false);
    }

    if (loadingTimer.current) clearInterval(loadingTimer.current);
  };

  // ─── Feedback ─────────────────────────────────────────────────────────

  const submitFeedback = async (rating: number) => {
    setFeedbackRating(rating);
    const item: FeedbackItem = {
      id: Date.now().toString(),
      answers: { mood: selectedMood, area: selectedArea, companion: selectedCompanion, atmosphere: selectedAtmosphere },
      topRecommendations: apiRecommendations.slice(0, 3).map((r) => r.title),
      rating, visitedPlace: feedbackVisitedPlace,
      createdAt: new Date().toISOString(),
    };
    setPastFeedback((prev) => [item, ...prev].slice(0, 50));
    try {
      await apiFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mood: selectedMood, area: selectedArea, age: profileAge, gender: profileGender,
          companion: selectedCompanion, atmosphere: selectedAtmosphere, priority: selectedPriority,
          topRecommendations: apiRecommendations.slice(0, 3).map((r) => r.title),
          rating, visitedPlace: feedbackVisitedPlace,
          likedPlaces: likedInSession, mapClickedPlaces: mapClickedInSession,
        }),
      });
    } catch {}
    setFeedbackSubmitted(true);
  };

  // ─── Reset ────────────────────────────────────────────────────────────

  const resetQuiz = () => {
    setStarted(false); setStep(1); setSelectedMood(''); setSelectedArea('');
    setLocationDisplayArea(''); setSelectedCompanion(''); setSelectedTransports([]);
    setBudget(10000); setBudgetMin(0); setSelectedTime(''); setSelectedAtmosphere('');
    setSelectedPriority(''); setFreeWord(''); setDynamicQuestions([]); setDynamicAnswers({});
    setApiRecommendations([]); setApiWarning(''); setRefinementText('');
    setFeedbackRating(null); setFeedbackVisitedPlace(''); setFeedbackSubmitted(false);
    setLikedInSession([]); setMapClickedInSession([]); setPlaceRatings({});
    setOnsenCategory(null); setOnsenFacilities(null);
    setNatureSubGenre(null); setNatureDistancePref(null); setNatureFacilities(null);
    setCafeSubCategory(null); setCafeDetail(null); setCafeDetailMode(false);
    setCafeDistancePref(null); setCafeFacilities(null);
    setWaiWaiSubCategory(null); setWaiWaiFacilities(null);
    setHomeView('home');
  };

  // ─── Toggle favorite ──────────────────────────────────────────────────

  const toggleFavorite = (rec: Recommendation) => {
    const exists = favorites.find((f) => f.title === rec.title);
    if (exists) {
      setFavorites((prev) => prev.filter((f) => f.title !== rec.title));
    } else {
      setFavorites((prev) => [{
        title: rec.title, area: selectedArea,
        vibe: rec.vibe ?? '', photoUrl: rec.photoUrl, mapUrl: rec.mapUrl,
        createdAt: new Date().toISOString(),
      }, ...prev]);
    }
  };

  const isLoading =
    isLoadingRecommendations || isLoadingOnsen || isLoadingNature ||
    isLoadingCafe || isLoadingWaiWai;

  // ─── Tab fade ─────────────────────────────────────────────────────────

  const tabFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    tabFade.setValue(0);
    Animated.timing(tabFade, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [homeView]);

  // ─── Step skip logic ──────────────────────────────────────────────────

  const FOOD_GENRES_WITH_SUB = ['居酒屋🍺', '和食🍣', '洋食🍳', 'イタリアン🍝', '焼肉🥩', 'アジア系統🍛', '各国料理🌍', 'ラーメン🍜', 'カフェ・スイーツ☕'];

  useEffect(() => {
    if (step !== 8 || selectedMood !== 'お腹すいた') return;
    const genreAns = dynamicAnswers['food_genre_new'] ?? '';
    const hasSubQ = FOOD_GENRES_WITH_SUB.some(k => genreAns.includes(k));
    if (!hasSubQ) setStep(9);
  }, [step, selectedMood, dynamicAnswers]);

  // ─── Profile setup (first launch) ────────────────────────────────────

  if (profileLoaded && !profileSetupDone) {
    return (
      <ProfileSetup
        onDone={(age, gender) => {
          setProfileAge(age);
          setProfileGender(gender);
          setProfileSetupDone(true);
          saveJSON(PROFILE_KEY, { age, gender });
        }}
      />
    );
  }

  // ─── Quiz flow ────────────────────────────────────────────────────────

  if (started && step <= 10) {
    return (
      <SlideUp>
      <QuizFlow
        lang={lang}
        step={step}
        selectedMood={selectedMood}
        selectedArea={selectedArea}
        locationDisplayArea={locationDisplayArea}
        selectedCompanion={selectedCompanion}
        selectedTransports={selectedTransports}
        budget={budget}
        budgetMin={budgetMin}
        showUnseenOnly={showUnseenOnly}
        selectedTime={selectedTime}
        selectedAtmosphere={selectedAtmosphere}
        selectedPriority={selectedPriority}
        freeWord={freeWord}
        dynamicQuestions={dynamicQuestions}
        dynamicAnswers={dynamicAnswers}
        isLocating={isLocating}
        locationError={locationError}
        onSelectMood={setSelectedMood}
        onSelectArea={setSelectedArea}
        onSelectCompanion={setSelectedCompanion}
        onSelectTransports={setSelectedTransports}
        onSetBudget={setBudget}
        onSetBudgetMin={setBudgetMin}
        onSetShowUnseenOnly={setShowUnseenOnly}
        onSelectTime={setSelectedTime}
        onSelectAtmosphere={setSelectedAtmosphere}
        onSelectPriority={setSelectedPriority}
        onSetFreeWord={setFreeWord}
        onSetDynamicQuestions={setDynamicQuestions}
        onSetDynamicAnswers={setDynamicAnswers}
        onUseCurrentLocation={handleUseCurrentLocation}
        onSetStep={setStep}
        onBack={() => { if (step === 1) resetQuiz(); else setStep((s) => s - 1); }}
        onOpenResults={() => openResults()}
        onsenCategory={onsenCategory}
        onSetOnsenCategory={setOnsenCategory}
        natureSubGenre={natureSubGenre}
        onSetNatureSubGenre={setNatureSubGenre}
        natureDistancePref={natureDistancePref}
        onSetNatureDistancePref={setNatureDistancePref}
        cafeSubCategory={cafeSubCategory}
        onSetCafeSubCategory={setCafeSubCategory}
        cafeDetail={cafeDetail}
        onSetCafeDetail={setCafeDetail}
        cafeDetailMode={cafeDetailMode}
        onSetCafeDetailMode={setCafeDetailMode}
        cafeDistancePref={cafeDistancePref}
        onSetCafeDistancePref={setCafeDistancePref}
        waiWaiSubCategory={waiWaiSubCategory}
        onSetWaiWaiSubCategory={setWaiWaiSubCategory}
      />
      </SlideUp>
    );
  }

  // ─── Results screen ───────────────────────────────────────────────────

  if (started && step === 11) {
    return (
      <SlideUp>
      <ResultsView
        lang={lang}
        selectedMood={selectedMood}
        selectedArea={selectedArea}
        recommendations={apiRecommendations}
        onsenFacilities={onsenFacilities}
        onsenCategoryLabel={onsenCategoryLabel}
        natureFacilities={natureFacilities}
        natureSubGenreLabel={natureSubGenreLabel}
        cafeFacilities={cafeFacilities}
        cafeSubCategoryLabel={cafeSubCategoryLabel}
        waiWaiFacilities={waiWaiFacilities}
        waiWaiSubCategoryLabel={waiWaiSubCategoryLabel}
        isLoading={isLoading}
        loadingMessage={LOADING_MESSAGES[loadingMsgIdx]}
        apiWarning={apiWarning}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
        placeRatings={placeRatings}
        onSetPlaceRatings={setPlaceRatings}
        photoIndices={photoIndices}
        onSetPhotoIndices={setPhotoIndices}
        blockedPlaces={blockedPlaces}
        onBlockPlace={(title) => setBlockedPlaces((prev) => [...prev, title])}
        feedbackRating={feedbackRating}
        feedbackSubmitted={feedbackSubmitted}
        onSubmitFeedback={submitFeedback}
        likedInSession={likedInSession}
        onSetLikedInSession={setLikedInSession}
        mapClickedInSession={mapClickedInSession}
        onSetMapClickedInSession={setMapClickedInSession}
        refinementText={refinementText}
        onSetRefinementText={setRefinementText}
        isRefining={isRefining}
        onRefine={async () => {
          setIsRefining(true);
          await openResults(refinementText, true);
          setIsRefining(false);
        }}
        onReset={resetQuiz}
        reportingSpot={reportingSpot}
        onSetReportingSpot={setReportingSpot}
        reportReason={reportReason}
        onSetReportReason={setReportReason}
        reportNote={reportNote}
        onSetReportNote={setReportNote}
        reportSubmitting={reportSubmitting}
        reportDone={reportDone}
        onSubmitReport={async () => {
          if (!reportingSpot) return;
          setReportSubmitting(true);
          try {
            await apiFetch('/api/reports', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                spot_name: reportingSpot.title,
                spot_address: reportingSpot.address,
                reason: reportReason, note: reportNote,
              }),
            });
          } catch {}
          setReportDone(true);
          setReportSubmitting(false);
        }}
        seenPlaceTitles={history.flatMap((h) =>
          h.recommendations?.map((r) => r.title) ?? [h.topRecommendation]
        )}
        onSubmitVisitedFeedback={async (title, rating) => {
          const item: FeedbackItem = {
            id: Date.now().toString(),
            answers: { mood: selectedMood, area: selectedArea, companion: selectedCompanion, atmosphere: selectedAtmosphere },
            topRecommendations: [title],
            rating, visitedPlace: title,
            createdAt: new Date().toISOString(),
          };
          setPastFeedback((prev) => [item, ...prev].slice(0, 50));
          try {
            await apiFetch('/api/feedback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mood: selectedMood, area: selectedArea,
                age: profileAge, gender: profileGender,
                companion: selectedCompanion, atmosphere: selectedAtmosphere,
                topRecommendations: [title],
                rating, visitedPlace: title,
              }),
            });
          } catch {}
        }}
      />
      </SlideUp>
    );
  }

  // ─── Home screens ─────────────────────────────────────────────────────

  const renderContent = () => {
    switch (homeView) {
      case 'history':
        return (
          <HistoryView
            lang={lang}
            history={history}
            selectedHistoryItem={selectedHistoryItem}
            onSelectHistoryItem={setSelectedHistoryItem}
            onClearHistory={() => setHistory([])}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
          />
        );
      case 'favorites':
        return (
          <FavoritesView
            lang={lang}
            favorites={favorites}
            favoriteSort={favoriteSort}
            onSetFavoriteSort={setFavoriteSort}
            onRemoveFavorite={(title) =>
              setFavorites((prev) => prev.filter((f) => f.title !== title))
            }
          />
        );
      case 'featured':
        return (
          <FeaturedView
            lang={lang}
            featuredList={featuredList}
            featuredListLoading={featuredListLoading}
          />
        );
      default:
        return (
          <HomeView
            profileAge={profileAge}
            profileGender={profileGender}
            lang={lang}
            onStart={() => setStarted(true)}
            onShowSettings={() => setShowSettings(true)}
          />
        );
    }
  };

  return (
    <View style={styles.root}>
      <Animated.View style={{ flex: 1, opacity: tabFade }}>
        {renderContent()}
      </Animated.View>
      <TabBar
        lang={lang}
        homeView={homeView}
        onChangeView={(v) => {
          setHomeView(v);
          if (v === 'featured') loadFeaturedList();
        }}
        insets={insets}
      />
      <SettingsView
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        lang={lang}
        onChangeLang={(l) => setLang(l)}
        profileAge={profileAge}
        profileGender={profileGender}
        onSaveProfile={(age, gender) => {
          setProfileAge(age);
          setProfileGender(gender);
          saveJSON(PROFILE_KEY, { age, gender });
        }}
        onClearHistory={() => {
          setHistory([]);
          setShowSettings(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
});
