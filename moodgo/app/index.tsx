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
import { detectUserPrefecture, getNearbyPrefectures } from '@/lib/prefecture-utils';
import { setSelectedPlace } from '@/lib/selectedPlace';
import { router } from 'expo-router';

import AppBackground from '@/components/AppBackground';
import HomeView from '@/components/HomeView';
import TabBar from '@/components/TabBar';
import HistoryView from '@/components/HistoryView';
import FavoritesView from '@/components/FavoritesView';
import FeaturedView from '@/components/FeaturedView';
import FeatureScreen from '@/components/FeatureScreen';
import ProfileSetup from '@/components/ProfileSetup';
import QuizFlow from '@/components/QuizFlow';
import ResultsView from '@/components/ResultsView';
import SettingsView from '@/components/SettingsView';
import type {
  Recommendation, FavoriteItem, FeedbackItem, HistoryItem,
  Answers, DynamicQuestion, FeaturedPageSummary,
} from '@/types/app';
export type { Recommendation, FavoriteItem, FeedbackItem, HistoryItem, Answers, DynamicQuestion, FeaturedPageSummary };

// ─── Main App ────────────────────────────────────────────────────────────────

export default function Home() {
  const insets = useSafeAreaInsets();

  // Navigation
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(1);
  const [homeView, setHomeView] = useState<'home' | 'history' | 'favorites' | 'featured'>('home');
  const [tabResetKeys, setTabResetKeys] = useState({ home: 0, history: 0, favorites: 0, featured: 0 });

  // Quiz state
  const [selectedMood, setSelectedMood] = useState('');
  const [selectedArea, setSelectedArea] = useState('');
  const [locationDisplayArea, setLocationDisplayArea] = useState('');
  const [selectedCompanion, setSelectedCompanion] = useState('');
  const [budget, setBudget] = useState<number | undefined>(10000);
  const [budgetMin, setBudgetMin] = useState<number>(0);
  const [showUnseenOnly, setShowUnseenOnly] = useState(false);
  const [freeWord, setFreeWord] = useState('');
  const [dynamicQuestions, setDynamicQuestions] = useState<DynamicQuestion[]>([]);
  const [dynamicAnswers, setDynamicAnswers] = useState<Record<string, string>>({});
  const [areaMode, setAreaMode] = useState<'current_location' | 'manual'>('manual');
  const [distanceFeeling, setDistanceFeeling] = useState('今日は出かけたい');
  const [radiusKm, setRadiusKm] = useState(20);

  // QuizFlow mood-specific UI state（クイズ画面の選択状態 — 検索には使わない）
  const [onsenCategory, setOnsenCategory] = useState<OnsenCategory | null>(null);
  const [natureSubGenre, setNatureSubGenre] = useState<NatureSubGenre | null>(null);
  const [natureDistancePref, setNatureDistancePref] = useState<NatureDistancePref | null>(null);
  const [cafeSubCategory, setCafeSubCategory] = useState<CafeSubCategory | null>(null);
  const [cafeDetail, setCafeDetail] = useState<CafeDetail | null>(null);
  const [cafeDetailMode, setCafeDetailMode] = useState(false);
  const [cafeDistancePref, setCafeDistancePref] = useState<CafeDistancePref | null>(null);
  const [waiWaiSubCategory, setWaiWaiSubCategory] = useState<WaiWaiSubCategory | null>(null);
  const [onsenDistancePref, setOnsenDistancePref] = useState<NatureDistancePref | null>(null);
  const [scenerySubCategory, setScenerySubCategory] = useState<string | null>(null);
  const [deepDiveL1, setDeepDiveL1] = useState('');
  const [deepDiveL2, setDeepDiveL2] = useState('');

  // Profile
  const [profileSetupDone, setProfileSetupDone] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profileAge, setProfileAge] = useState('');
  const [profileGender, setProfileGender] = useState('');
  const [profilePrefecture, setProfilePrefecture] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // Results（常に空 — 検索ロジックは未実装）
  const [apiRecommendations] = useState<Recommendation[]>([]);
  const [isLoadingRecommendations] = useState(false);
  const [placeRatings, setPlaceRatings] = useState<Record<string, 'good' | 'bad'>>({});
  const [photoIndices, setPhotoIndices] = useState<Record<string, number>>({});
  const [blockedPlaces, setBlockedPlaces] = useState<string[]>([]);
  const [likedInSession, setLikedInSession] = useState<string[]>([]);
  const [mapClickedInSession, setMapClickedInSession] = useState<string[]>([]);
  const [refinementText, setRefinementText] = useState('');
  const [isRefining] = useState(false);
  const [prefectureButtons] = useState<string[]>([]);
  const [selectedPrefecture, setSelectedPrefecture] = useState('');

  // Favorites & History
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const [favoriteSort, setFavoriteSort] = useState<'newest' | 'title'>('newest');

  // Report modal
  const [reportingSpot, setReportingSpot] = useState<{ title: string; address: string; supabaseId?: string } | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  // Location
  const [originLat, setOriginLat] = useState<number | undefined>();
  const [originLng, setOriginLng] = useState<number | undefined>();
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  // UI
  const [lang, setLang] = useState<'ja' | 'en'>('ja');

  // ─── Load from AsyncStorage ──────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      const faves = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
      const hist  = await loadJSON<HistoryItem[]>(HISTORY_KEY, []);
      const blocked = await loadJSON<string[]>(BLOCKED_PLACES_KEY, []);
      const profile = await loadJSON<{ age?: string; gender?: string; prefecture?: string }>(PROFILE_KEY, {});
      setFavorites(faves);
      setHistory(hist);
      setBlockedPlaces(blocked);
      if (profile.age)        setProfileAge(profile.age);
      if (profile.gender)     setProfileGender(profile.gender);
      if (profile.prefecture) setProfilePrefecture(profile.prefecture);
      setProfileSetupDone(!!(profile.age || profile.gender));
      setProfileLoaded(true);
    })();
  }, []);

  useEffect(() => { if (profileLoaded) saveJSON(FAVORITES_KEY,    favorites);    }, [favorites,    profileLoaded]);
  useEffect(() => { if (profileLoaded) saveJSON(HISTORY_KEY,      history);      }, [history,      profileLoaded]);
  useEffect(() => { if (profileLoaded) saveJSON(BLOCKED_PLACES_KEY, blockedPlaces); }, [blockedPlaces, profileLoaded]);

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
    setAreaMode('current_location');
    setIsLocating(false);
  };

  // ─── Open results（検索ロジック未実装 — 結果画面を表示するだけ）──────────

  const openResults = (_refineText = '', _isRefinement = false) => {
    setStep(11);
  };

  // ─── Reset ────────────────────────────────────────────────────────────

  const resetQuiz = () => {
    setStarted(false); setStep(1);
    setSelectedMood(''); setSelectedArea(''); setLocationDisplayArea('');
    setSelectedCompanion('');
    setBudget(10000); setBudgetMin(0); setFreeWord('');
    setDynamicQuestions([]); setDynamicAnswers({});
    setAreaMode('manual'); setDistanceFeeling('今日は出かけたい'); setRadiusKm(20);
    setPlaceRatings({}); setLikedInSession([]); setMapClickedInSession([]);
    setRefinementText('');
    setOnsenCategory(null); setNatureSubGenre(null); setNatureDistancePref(null);
    setCafeSubCategory(null); setCafeDetail(null); setCafeDetailMode(false);
    setCafeDistancePref(null); setWaiWaiSubCategory(null);
    setOnsenDistancePref(null); setScenerySubCategory(null);
    setDeepDiveL1(''); setDeepDiveL2('');
    setSelectedPrefecture('');
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
        placeId: rec.placeId,
        address: rec.address,
        rating: rec.rating,
        openingHoursText: rec.openingHoursText,
        openNow: rec.openNow,
        photoUrls: rec.photoUrls,
        stationText: rec.stationText,
        distanceText: rec.distanceText,
        priceLevel: rec.priceLevel,
      }, ...prev]);
    }
  };

  // ─── 詳細ページへ遷移 ─────────────────────────────────────────────────────

  const handlePressDetail = (rec: Recommendation) => {
    setSelectedPlace(rec);
    router.push('/place');
  };

  const handlePressFavoriteDetail = (item: FavoriteItem) => {
    const rec: Recommendation = {
      title: item.title,
      address: item.address ?? item.area,
      vibe: item.vibe,
      photoUrl: item.photoUrl,
      photoUrls: item.photoUrls ?? (item.photoUrl ? [item.photoUrl] : []),
      mapUrl: item.mapUrl,
      placeId: item.placeId,
      rating: item.rating ?? undefined,
      openingHoursText: item.openingHoursText,
      openNow: item.openNow,
      stationText: item.stationText,
      distanceText: item.distanceText,
      priceLevel: item.priceLevel,
      phone: item.phone,
      website: item.website,
    };
    setSelectedPlace(rec);
    router.push('/place');
  };

  // ─── Tab fade ─────────────────────────────────────────────────────────

  const tabFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    tabFade.setValue(0);
    Animated.timing(tabFade, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [homeView]);

  // ─── Profile setup (first launch) ────────────────────────────────────

  if (profileLoaded && !profileSetupDone) {
    return (
      <View style={styles.root}>
        <AppBackground />
        <ProfileSetup
          onDone={(age, gender, prefecture) => {
            setProfileAge(age);
            setProfileGender(gender);
            setProfilePrefecture(prefecture);
            setProfileSetupDone(true);
            saveJSON(PROFILE_KEY, { age, gender, prefecture });
          }}
        />
      </View>
    );
  }

  // ─── Quiz flow ────────────────────────────────────────────────────────

  if (started && step <= 8) {
    return (
      <View style={styles.root}>
        <AppBackground />
        <SlideUp>
          <QuizFlow
            lang={lang}
            step={step}
            selectedMood={selectedMood}
            selectedArea={selectedArea}
            locationDisplayArea={locationDisplayArea}
            selectedCompanion={selectedCompanion}
            budget={budget}
            budgetMin={budgetMin}
            showUnseenOnly={showUnseenOnly}
            freeWord={freeWord}
            dynamicQuestions={dynamicQuestions}
            dynamicAnswers={dynamicAnswers}
            isLocating={isLocating}
            locationError={locationError}
            areaMode={areaMode}
            distanceFeeling={distanceFeeling}
            radiusKm={radiusKm}
            onSelectMood={setSelectedMood}
            onSelectArea={setSelectedArea}
            onSelectCompanion={setSelectedCompanion}
            onSetBudget={setBudget}
            onSetBudgetMin={setBudgetMin}
            onSetShowUnseenOnly={setShowUnseenOnly}
            onSetFreeWord={setFreeWord}
            onSetDynamicQuestions={setDynamicQuestions}
            onSetDynamicAnswers={setDynamicAnswers}
            onUseCurrentLocation={handleUseCurrentLocation}
            onSetStep={setStep}
            onBack={resetQuiz}
            onOpenResults={() => openResults()}
            onSetAreaMode={setAreaMode}
            onSetDistanceFeeling={(label, km) => { setDistanceFeeling(label); setRadiusKm(km); }}
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
            onsenDistancePref={onsenDistancePref}
            onSetOnsenDistancePref={setOnsenDistancePref}
            scenerySubCategory={scenerySubCategory}
            onSetScenerySubCategory={setScenerySubCategory}
            deepDiveL1={deepDiveL1}
            deepDiveL2={deepDiveL2}
            onSetDeepDiveL1={setDeepDiveL1}
            onSetDeepDiveL2={setDeepDiveL2}
          />
        </SlideUp>
      </View>
    );
  }

  // ─── Results screen ───────────────────────────────────────────────────

  if (started && step === 11) {
    return (
      <View style={styles.root}>
        <AppBackground />
        <SlideUp>
          <ResultsView
            lang={lang}
            selectedMood={selectedMood}
            selectedArea={selectedArea}
            selectedCompanion={selectedCompanion}
            budget={budget}
            budgetMin={budgetMin}
            deepDiveL1={deepDiveL1}
            deepDiveL2={deepDiveL2}
            freeWord={freeWord}
            areaMode={areaMode}
            distanceFeeling={distanceFeeling}
            radiusKm={radiusKm}
            onChangeRadius={(km) => { setRadiusKm(km); openResults('', true); }}
            recommendations={apiRecommendations}
            onsenFacilities={null}
            onsenCategoryLabel=""
            natureFacilities={null}
            natureSubGenreLabel=""
            cafeFacilities={null}
            cafeSubCategoryLabel=""
            waiWaiFacilities={null}
            waiWaiSubCategoryLabel=""
            driveFacilities={null}
            driveSubCategoryLabel=""
            focusFacilities={null}
            focusSubCategoryLabel=""
            sportsFacilities={null}
            sportsSubCategoryLabel=""
            travelFacilities={null}
            travelSubCategoryLabel=""
            isLoading={isLoadingRecommendations}
            loadingMessage=""
            apiWarning=""
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            placeRatings={placeRatings}
            onSetPlaceRatings={setPlaceRatings}
            photoIndices={photoIndices}
            onSetPhotoIndices={setPhotoIndices}
            blockedPlaces={blockedPlaces}
            onBlockPlace={(title) => setBlockedPlaces((prev) => [...prev, title])}
            feedbackRating={null}
            feedbackSubmitted={false}
            onSubmitFeedback={() => {}}
            likedInSession={likedInSession}
            onSetLikedInSession={setLikedInSession}
            mapClickedInSession={mapClickedInSession}
            onSetMapClickedInSession={setMapClickedInSession}
            refinementText={refinementText}
            onSetRefinementText={setRefinementText}
            isRefining={isRefining}
            onRefine={() => {}}
            prefectureButtons={prefectureButtons}
            selectedPrefecture={selectedPrefecture}
            onSelectPrefecture={setSelectedPrefecture}
            onShuffle={() => {}}
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
            onSubmitVisitedFeedback={async () => {}}
            onPressDetail={handlePressDetail}
          />
        </SlideUp>
      </View>
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
            onResearch={() => {}}
            onPressDetail={handlePressDetail}
            resetKey={tabResetKeys.history}
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
            onPressCard={handlePressFavoriteDetail}
            resetKey={tabResetKeys.favorites}
          />
        );
      case 'featured':
        return <FeatureScreen />;
      default:
        return (
          <HomeView
            profileAge={profileAge}
            profileGender={profileGender}
            lang={lang}
            onStart={() => setStarted(true)}
            onShowSettings={() => setShowSettings(true)}
            onShowFeatured={() => setHomeView('featured')}
          />
        );
    }
  };

  return (
    <View style={styles.root}>
      <AppBackground />
      <Animated.View style={{ flex: 1, opacity: tabFade }}>
        {renderContent()}
      </Animated.View>
      <TabBar
        lang={lang}
        homeView={homeView}
        onChangeView={(v) => setHomeView(v)}
        onReset={(v) => {
          setTabResetKeys(prev => ({ ...prev, [v]: prev[v] + 1 }));
          if (v === 'home') resetQuiz();
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
        profilePrefecture={profilePrefecture}
        onSaveProfile={(age, gender, prefecture) => {
          setProfileAge(age);
          setProfileGender(gender);
          setProfilePrefecture(prefecture);
          saveJSON(PROFILE_KEY, { age, gender, prefecture });
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
  root: { flex: 1, backgroundColor: '#F3F1EF' },
});
