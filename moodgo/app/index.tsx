import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
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
  BLOCKED_PLACES_KEY, PROFILE_KEY,
  loadJSON, saveJSON,
} from '@/lib/storage';
import { apiFetch, API_BASE } from '@/lib/api';
import { setSelectedPlace } from '@/lib/selectedPlace';
import { getABVariant, getDeviceId } from '@/lib/abtest';
import * as Location from 'expo-location';
import { Asset } from 'expo-asset';
import { preloadMaps } from '@/components/FeatureScreen';

// 旧形式の Google Maps Photos URL (maps.googleapis.com/maps/api/place/photo) を
// photo-proxy 経由に変換。すでにproxy経由 or 空の場合はそのまま返す。
function fixPhotoUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.includes('/api/photo-proxy')) return url;  // すでにproxy経由
  if (url.includes('maps.googleapis.com') || url.startsWith('http')) {
    return `${API_BASE}/api/photo-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}
function fixRec(rec: Recommendation): Recommendation {
  return {
    ...rec,
    photoUrl:  fixPhotoUrl(rec.photoUrl),
    photoUrls: (rec.photoUrls ?? (rec.photoUrl ? [rec.photoUrl] : [])).map(fixPhotoUrl),
  };
}
import { router, useFocusEffect } from 'expo-router';

import AppBackground    from '@/components/AppBackground';
import AiChatInput      from '@/components/AiChatInput';
import HomeView         from '@/components/HomeView';
import TabBar           from '@/components/TabBar';
import HistoryView      from '@/components/HistoryView';
import FavoritesView    from '@/components/FavoritesView';
import FeatureScreen    from '@/components/FeatureScreen';
import GroupsView       from '@/components/GroupsView';
import ProfileSetup     from '@/components/ProfileSetup';
import QuizFlow         from '@/components/QuizFlow';
import ResultsView      from '@/components/ResultsView';
import SettingsView     from '@/components/SettingsView';
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

  // ── Navigation ───────────────────────────────────────────────────────────
  const [started,    setStarted]    = useState(false);
  const [step,       setStep]       = useState(1);
  const [homeView,   setHomeView]   = useState<'home' | 'history' | 'favorites' | 'featured' | 'groups'>('home');
  const [tabResetKeys, setTabResetKeys] = useState({ home: 0, history: 0, favorites: 0, featured: 0, groups: 0 });
  // グループチャット表示中はタブバーを隠す（没入モード）
  const [groupChatOpen, setGroupChatOpen] = useState(false);

  // ── Quiz state ───────────────────────────────────────────────────────────
  const [selectedMood,       setSelectedMood]       = useState('');
  const [selectedArea,       setSelectedArea]       = useState('');
  const [locationDisplayArea, setLocationDisplayArea] = useState('');
  const [selectedCompanion,  setSelectedCompanion]  = useState('');
  const [budget,             setBudget]             = useState<number | undefined>(undefined);
  const [budgetMin,          setBudgetMin]          = useState<number>(0);
  const [showUnseenOnly,     setShowUnseenOnly]     = useState(false);
  const [freeWord,           setFreeWord]           = useState('');
  const [dynamicQuestions,   setDynamicQuestions]   = useState<DynamicQuestion[]>([]);
  const [dynamicAnswers,     setDynamicAnswers]     = useState<Record<string, string>>({});
  const [areaMode,           setAreaMode]           = useState<'current_location' | 'manual'>('manual');
  const [distanceFeeling,    setDistanceFeeling]    = useState('今日は出かけたい');
  const [radiusKm,           setRadiusKm]           = useState(20);
  const [deepDiveL1,         setDeepDiveL1]         = useState('');
  const [deepDiveL2,         setDeepDiveL2]         = useState('');

  // QuizFlow 内の気分別 UI 状態（クイズ画面の選択肢表示に必要）
  const [onsenCategory,      setOnsenCategory]      = useState<OnsenCategory | null>(null);
  const [natureSubGenre,     setNatureSubGenre]     = useState<NatureSubGenre | null>(null);
  const [natureDistancePref, setNatureDistancePref] = useState<NatureDistancePref | null>(null);
  const [cafeSubCategory,    setCafeSubCategory]    = useState<CafeSubCategory | null>(null);
  const [cafeDetail,         setCafeDetail]         = useState<CafeDetail | null>(null);
  const [cafeDetailMode,     setCafeDetailMode]     = useState(false);
  const [cafeDistancePref,   setCafeDistancePref]   = useState<CafeDistancePref | null>(null);
  const [waiWaiSubCategory,  setWaiWaiSubCategory]  = useState<WaiWaiSubCategory | null>(null);
  const [onsenDistancePref,  setOnsenDistancePref]  = useState<NatureDistancePref | null>(null);
  const [scenerySubCategory, setScenerySubCategory] = useState<string | null>(null);

  // ── Profile ──────────────────────────────────────────────────────────────
  const [profileSetupDone, setProfileSetupDone] = useState(false);
  const [profileLoaded,    setProfileLoaded]    = useState(false);
  const [profileAge,       setProfileAge]       = useState('');
  const [profileGender,    setProfileGender]    = useState('');
  const [profilePrefecture, setProfilePrefecture] = useState('');
  const [showSettings,     setShowSettings]     = useState(false);

  // ── Results ──────────────────────────────────────────────────────────────
  const [apiRecommendations,     setApiRecommendations]     = useState<Recommendation[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [loadingMsgIdx,          setLoadingMsgIdx]          = useState(0);
  const [apiWarning,             setApiWarning]             = useState('');
  const [refinementText,         setRefinementText]         = useState('');
  const [isRefining,             setIsRefining]             = useState(false);
  const [selectedPrefecture,     setSelectedPrefecture]     = useState('');
  // G-2: A/Bテスト variant（デバイス単位で安定）
  const [abVariant,              setAbVariant]              = useState<'A' | 'B'>('A');

  // ── Feedback ─────────────────────────────────────────────────────────────
  const [pastFeedback,        setPastFeedback]        = useState<FeedbackItem[]>([]);
  const [placeRatings,        setPlaceRatings]        = useState<Record<string, 'good' | 'bad'>>({});
  const [likedInSession,      setLikedInSession]      = useState<string[]>([]);
  const [mapClickedInSession, setMapClickedInSession] = useState<string[]>([]);

  // ── UI ───────────────────────────────────────────────────────────────────
  const [photoIndices,  setPhotoIndices]  = useState<Record<string, number>>({});
  const [blockedPlaces, setBlockedPlaces] = useState<string[]>([]);
  const [lang,          setLang]          = useState<'ja' | 'en'>('ja');

  // ── Favorites & History ──────────────────────────────────────────────────
  const [favorites,           setFavorites]           = useState<FavoriteItem[]>([]);
  const [history,             setHistory]             = useState<HistoryItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const [favoriteSort,        setFavoriteSort]        = useState<'newest' | 'title'>('newest');

  // ── Location ─────────────────────────────────────────────────────────────
  const [originLat,     setOriginLat]     = useState<number | undefined>();
  const [originLng,     setOriginLng]     = useState<number | undefined>();
  const [isLocating,    setIsLocating]    = useState(false);
  const [locationError, setLocationError] = useState('');

  // ── AI相談 ───────────────────────────────────────────────────────────────
  const [aiChatOpen,    setAiChatOpen]    = useState(false);
  const [aiHasLocation, setAiHasLocation] = useState(false);

  // ── Report modal ─────────────────────────────────────────────────────────
  const [reportingSpot,    setReportingSpot]    = useState<{ title: string; address: string; supabaseId?: string } | null>(null);
  const [reportReason,     setReportReason]     = useState('');
  const [reportNote,       setReportNote]       = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone,       setReportDone]       = useState(false);

  const loadingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Load from AsyncStorage ──────────────────────────────────────────────

  // ── 地図画像・ホーム写真をアプリ起動時に先読み（特集/ホームのラグ防止）──
  useEffect(() => {
    preloadMaps();
    Asset.loadAsync([require('../assets/images/home-featured.png')]).catch(() => {});
    // G-2: A/Bテスト variant をロード
    getABVariant().then(setAbVariant).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const faves   = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
      const hist    = await loadJSON<HistoryItem[]>(HISTORY_KEY, []);
      const feed    = await loadJSON<FeedbackItem[]>(FEEDBACK_KEY, []);
      const blocked = await loadJSON<string[]>(BLOCKED_PLACES_KEY, []);
      const profile = await loadJSON<{ age?: string; gender?: string; prefecture?: string }>(PROFILE_KEY, {});
      setFavorites(faves);
      // 履歴内の旧形式photoURLをphoto-proxy経由に変換（保存時の旧URL対策）
      const fixedHist = hist.map(item => ({
        ...item,
        recommendations: (item.recommendations ?? []).map(fixRec),
      }));
      setHistory(fixedHist);
      setPastFeedback(feed);
      setBlockedPlaces(blocked);
      if (profile.age)        setProfileAge(profile.age);
      if (profile.gender)     setProfileGender(profile.gender);
      if (profile.prefecture) setProfilePrefecture(profile.prefecture);
      setProfileSetupDone(!!(profile.age || profile.gender));
      setProfileLoaded(true);
    })();
  }, []);

  useEffect(() => { if (profileLoaded) saveJSON(FAVORITES_KEY,     favorites);    }, [favorites,    profileLoaded]);

  // 詳細ページ等(別ルート)で♡された内容をストレージから再読込して同期
  // → 穴場詳細でいいねした投稿が、戻った瞬間にお気に入りへリアルタイム反映される
  useFocusEffect(
    useCallback(() => {
      if (!profileLoaded) return;
      (async () => {
        const faves = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
        setFavorites(faves);
      })();
    }, [profileLoaded])
  );
  useEffect(() => { if (profileLoaded) saveJSON(HISTORY_KEY,       history);      }, [history,      profileLoaded]);
  useEffect(() => { if (profileLoaded) saveJSON(FEEDBACK_KEY,      pastFeedback); }, [pastFeedback, profileLoaded]);
  useEffect(() => { if (profileLoaded) saveJSON(BLOCKED_PLACES_KEY, blockedPlaces); }, [blockedPlaces, profileLoaded]);

  // ─── Location ──────────────────────────────────────────────────────────

  const handleUseCurrentLocation = async () => {
    setIsLocating(true);
    setLocationError('');
    try {      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('位置情報の権限が必要です');
        return;
      }
      // 位置サービスが無効ならクラッシュ前に既知位置でフォールバック
      const servicesOn = await Location.hasServicesEnabledAsync().catch(() => true);
      // 高速化: まず既知位置(キャッシュ)を即座に採用 → 裏でBalanced精度のGPSで上書き。
      //   従来はHigh精度のGPS確定(5〜12秒)を待ってから表示しており「取得が長い」原因だった。
      //   検索はkm単位の半径なのでBalanced(〜100m)で十分。
      // ★レース内のPromiseには必ず .catch を付ける（遅延rejectでのクラッシュ防止）
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) {
        // 既知位置で即時に画面を進める（後段のGPS確定で座標は上書きされる）
        setOriginLat(last.coords.latitude); setOriginLng(last.coords.longitude);
        setAreaMode('current_location');
      }
      const pos = servicesOn ? await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
      ]) : null;
      if (!pos) {
        if (!last) { setLocationError('位置情報を取得できませんでした'); return; }
        // 既知位置のみで続行（住所表示も既知位置で解決）
        try {
          const res = await apiFetch('/api/location-to-area', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: last.coords.latitude, longitude: last.coords.longitude }),
          });
          const d = await res.json();
          const fullAddr = d.fullAddress ?? d.displayArea ?? d.area ?? '現在地';
          setSelectedArea(fullAddr); setLocationDisplayArea(fullAddr);
        } catch { setSelectedArea('現在地'); setLocationDisplayArea('現在地'); }
        return;
      }
      const { latitude, longitude } = pos.coords;
      setOriginLat(latitude);
      setOriginLng(longitude);
      setAreaMode('current_location');
      try {
        const res = await apiFetch('/api/location-to-area', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude, longitude }),
        });
        const d = await res.json();
        // 現在地はフル住所（丁目-番地まで）を入力欄・表示に使う。検索はGPS座標(originLat/Lng)を使うため
        // 表示を精密にしても検索精度は変わらない（むしろ利用者が現在地を確認しやすくなる）。
        const fullAddr = d.fullAddress ?? d.displayArea ?? d.area ?? '現在地';
        setSelectedArea(fullAddr);
        setLocationDisplayArea(fullAddr);
      } catch {
        setSelectedArea('現在地');
        setLocationDisplayArea('現在地');
      }
    } catch (e) {
      console.warn('[location]', e);
      setLocationError('位置情報の取得に失敗しました');
    } finally {
      setIsLocating(false);
    }
  };

  // ── AI相談を開く（押した瞬間に位置情報を自動取得）──────────────────────────
  const handleOpenAiChat = async () => {
    setAiChatOpen(true);
    setAiHasLocation(false);
    setIsLocating(true);
    try {      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        // ハング防止のタイムアウト付き（レース内に必ず.catch→遅延rejectでのクラッシュ防止）
        // 高速化: 既知位置を先に使い、Balanced精度(6s)で上書き
        const lastAi = await Location.getLastKnownPositionAsync().catch(() => null);
        if (lastAi) {
          setOriginLat(lastAi.coords.latitude);
          setOriginLng(lastAi.coords.longitude);
          setAreaMode('current_location');
          setAiHasLocation(true);
        }
        const pos = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
        ]) ?? lastAi;
        if (pos) {
          const { latitude, longitude } = pos.coords;
          setOriginLat(latitude);
          setOriginLng(longitude);
          setAreaMode('current_location');
          setAiHasLocation(true);
        try {
          const res = await apiFetch('/api/location-to-area', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude, longitude }),
          });
          const d = await res.json();
          const fullAddr = d.fullAddress ?? d.displayArea ?? d.area ?? '現在地';
          setSelectedArea(fullAddr);
          setLocationDisplayArea(fullAddr);
        } catch {
          setSelectedArea('現在地');
        }
        }
      }
    } catch { /* 位置取得失敗は無視（入力は継続可能）*/ }
    finally { setIsLocating(false); }
  };

  // ── AI相談の送信（自由ワード → OpenAI提案 → 結果画面）──────────────────────
  const handleAiSubmit = (text: string) => {
    setAiChatOpen(false);
    setStarted(true);   // 結果画面（started && step===11）を表示するため
    openResults('', false, undefined, false, text);
  };

  // エリア名を手入力したら手動モードに切り替え、前回取得した現在地座標をクリアする。
  // （クリアしないと現在地の座標が検索の起点に残り、入力したエリアが無視されてしまう）
  const handleSelectArea = (v: string) => {
    setSelectedArea(v);
    if (v.trim().length > 0) {
      setAreaMode('manual');
      setOriginLat(undefined);
      setOriginLng(undefined);
      setLocationDisplayArea('');
      setRadiusKm(2); // 手動入力時は2km固定半径
    }
  };

  // ─── Open results ─────────────────────────────────────────────────────────
  // Web版 openResults() と同じ構造：
  //   1. 前回結果をクリア
  //   2. 既見スポットセットを構築（showUnseenOnly が true のとき）
  //   3. answers オブジェクトを構築（transport×time は省略）
  //   4. POST /api/recommend
  //   5. setApiRecommendations → 履歴保存 → setStep(11)
  // ─────────────────────────────────────────────────────────────────────────

  const openResults = async (refineText = '', isRefinement = false, radiusOverride?: number, excludeShown = false, aiChatText?: string) => {
    // 新規検索時: 前回結果・評価をクリアしてから結果画面へ
    if (!isRefinement) {
      setApiRecommendations([]);
      setPlaceRatings({});
      setSelectedPrefecture('');
      setApiWarning('');
      setStep(11);
    }

    // ローディング開始
    setIsLoadingRecommendations(true);
    if (refineText) setIsRefining(true);
    if (loadingTimer.current) clearInterval(loadingTimer.current);
    setLoadingMsgIdx(0);
    loadingTimer.current = setInterval(() => {
      setLoadingMsgIdx(i => (i + 1) % LOADING_MESSAGES.length);
    }, 1800);

    try {
      // ── 既見スポットセットを構築（showUnseenOnly フィルター用）──────────────
      const seenSet = new Set<string>();
      if (showUnseenOnly) {
        for (const h of history) {
          if (h.topRecommendation) seenSet.add(h.topRecommendation);
          for (const r of h.recommendations ?? []) seenSet.add(r.title);
        }
        for (const title of Object.keys(placeRatings)) seenSet.add(title);
        for (const f of pastFeedback) {
          if (f.visitedPlace) seenSet.add(f.visitedPlace);
        }
      }
      // シャッフル時は現在表示中のスポットも除外し、毎回異なる場所を出す（同じ場所の再提案防止）
      if (excludeShown) {
        for (const r of apiRecommendations) seenSet.add(r.title);
      }

      // ── answers オブジェクト（Web版と同じキー構成）──────────────────────────
      // ※ transport / time は省略（クイズに存在しないため）
      const isAiChat = !!aiChatText;
      const answers: Partial<Answers> = {
        mood:            isAiChat ? 'AI相談' : selectedMood,
        area:            selectedArea,
        age:             profileAge,
        gender:          profileGender,
        companion:       isAiChat ? '' : selectedCompanion,
        budget,
        budgetMin,
        freeWord:        isAiChat ? aiChatText! : freeWord,
        aiChat:          isAiChat || undefined,
        // AI相談は指示が無いため8km圏内で探す
        radiusKm: radiusOverride ?? (isAiChat ? 8 : radiusKm),
        areaMode,
        distanceFeeling,
        originLat,
        originLng,
        // 深掘り質問を dynamicQs 配列に統合（AI相談時は無し）
        dynamicQs: isAiChat ? [] : [
          ...Object.entries(dynamicAnswers).map(([key, answer]) => ({
            question: dynamicQuestions.find(q => q.key === key)?.question ?? key,
            answer,
          })),
          ...(scenerySubCategory ? [{ question: '絶景タイプ', answer: scenerySubCategory }] : []),
          ...(deepDiveL1 ? [{ question: '深掘りカテゴリ', answer: deepDiveL1 }] : []),
          ...(deepDiveL2 ? [{ question: '深掘り詳細',     answer: deepDiveL2 }] : []),
        ],
      };

      // refinement 時は freeWord に追記（Web版と同じ）
      const refinedAnswers = refineText
        ? { ...answers, freeWord: [answers.freeWord, refineText].filter(Boolean).join(' / ') }
        : answers;

      // ── POST /api/recommend ──────────────────────────────────────────────
      const res = await apiFetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers:            refinedAnswers,
          pastFeedback:       pastFeedback.slice(0, 5),  // 直近5件のフィードバックを渡す
          seenPlaces:         [...seenSet],
          showUnseenOnly:     showUnseenOnly || excludeShown,
          refinementText:     refineText ?? '',
          userPreferenceHints: [],
        }),
      });

      const d = await res.json();
      const recs: Recommendation[] = d.recommendations ?? d.data ?? [];

      setApiRecommendations(recs);
      // B-2: ワーニングはAPIの warning をそのまま表示（API側で既に「範囲を広げました」を含むため
      //   アプリ側で同文を重ねない＝重複表示の修正）
      setApiWarning(d.warning ?? '');

      // ── 履歴保存（新規検索のみ）────────────────────────────────────────────
      if (recs.length > 0 && !isRefinement) {
        const newItem: HistoryItem = {
          id:               Date.now().toString(),
          mood:             isAiChat ? 'AI相談' : selectedMood,
          area:             selectedArea,
          companion:        isAiChat ? '' : selectedCompanion,
          transport:        [],
          budget:           budget ?? 10000,
          time:             '',
          freeWord:         isAiChat ? aiChatText! : freeWord,
          topRecommendation: recs[0]?.title ?? '',
          createdAt:        new Date().toISOString(),
          recommendations:  recs,
          savedAnswers:     answers,
        };
        setHistory(prev => [newItem, ...prev].slice(0, 30));
      }
    } catch (e) {
      console.error('[openResults]', e);
    }

    // ローディング終了
    if (loadingTimer.current) clearInterval(loadingTimer.current);
    setIsLoadingRecommendations(false);
    setIsRefining(false);
  };

  // ─── Shuffle: API を再呼び出し（Web版 reshuffleFacilities 相当）──────────

  const handleShuffle = () => {
    // シャッフル: 現在表示中のスポットを除外して再検索 → 毎回異なる場所を出す
    openResults(refinementText || '', true, undefined, true);
  };

  // ─── Place rating (👍/👎) ─────────────────────────────────────────────────
  // Web版 submitPlaceRating() と同じ構造：
  //   ローカル state 更新 → pastFeedback に追加 → /api/feedback → /api/mood-rating

  const submitPlaceRating = async (placeTitle: string, verdict: 'good' | 'bad') => {
    setPlaceRatings(prev => ({ ...prev, [placeTitle]: verdict }));
    if (verdict === 'good') {
      setLikedInSession(prev => prev.includes(placeTitle) ? prev : [...prev, placeTitle]);
    }

    const rating = verdict === 'good' ? 5 : 1;
    const subCategoryLabel = deepDiveL2 || deepDiveL1 || '';

    // pastFeedback に追加（Web版と同じ）
    const newFeedback: FeedbackItem = {
      id:               `place-${Date.now()}`,
      answers:          { mood: selectedMood, area: selectedArea, companion: selectedCompanion },
      topRecommendations: apiRecommendations.slice(0, 3).map(r => r.title),
      rating,
      visitedPlace:     placeTitle,
      createdAt:        new Date().toISOString(),
    };
    setPastFeedback(prev => [newFeedback, ...prev].slice(0, 50));

    // /api/feedback（AIの学習データとして蓄積）
    apiFetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mood:             selectedMood,
        area:             selectedArea,
        age:              profileAge,
        gender:           profileGender,
        companion:        selectedCompanion,
        topRecommendations: apiRecommendations.slice(0, 3).map(r => r.title),
        rating,
        visitedPlace:     placeTitle,
        likedPlaces:      verdict === 'good' ? [placeTitle] : [],
        mapClickedPlaces: [],
        variant:          abVariant,  // G-2: A/Bテスト
      }),
    }).catch(() => {});

    // /api/mood-rating（気分別評価 — 管理者集計用）
    apiFetch('/api/mood-rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        place_name:   placeTitle,
        mood:         selectedMood,
        sub_category: subCategoryLabel || undefined,
        verdict,
      }),
    }).catch(() => {});
  };

  // ─── Visited feedback (行った！) ─────────────────────────────────────────

  const submitVisitedFeedback = async (title: string, rating: number) => {
    const item: FeedbackItem = {
      id:               Date.now().toString(),
      answers:          { mood: selectedMood, area: selectedArea, companion: selectedCompanion },
      topRecommendations: [title],
      rating,
      visitedPlace:     title,
      createdAt:        new Date().toISOString(),
    };
    setPastFeedback(prev => [item, ...prev].slice(0, 50));

    apiFetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mood:             selectedMood,
        area:             selectedArea,
        age:              profileAge,
        gender:           profileGender,
        companion:        selectedCompanion,
        topRecommendations: [title],
        rating,
        visitedPlace:     title,
        likedPlaces:      [],
        mapClickedPlaces: [],
        variant:          abVariant,  // G-2: A/Bテスト
      }),
    }).catch(() => {});
  };

  // ─── Re-search from history ───────────────────────────────────────────────

  const handleResearch = async (item: HistoryItem) => {
    if (!item.savedAnswers?.mood) return;
    const sa = item.savedAnswers;

    // クイズ状態を復元
    setSelectedMood(sa.mood ?? '');
    setSelectedArea(sa.area ?? '');
    setSelectedCompanion(sa.companion ?? '');
    setBudget(sa.budget ?? 10000);
    setBudgetMin(sa.budgetMin ?? 0);
    setFreeWord(sa.freeWord ?? '');
    if (sa.radiusKm)        setRadiusKm(sa.radiusKm);
    if (sa.areaMode)        setAreaMode(sa.areaMode);
    if (sa.distanceFeeling) setDistanceFeeling(sa.distanceFeeling);

    // 深掘り回答を復元
    const getQ = (key: string) => (sa.dynamicQs ?? []).find(q => q.question === key)?.answer ?? '';
    setDeepDiveL1(getQ('深掘りカテゴリ'));
    setDeepDiveL2(getQ('深掘り詳細'));

    setApiRecommendations([]);
    setApiWarning('');
    setPlaceRatings({});
    setSelectedHistoryItem(null);
    setHomeView('home');
    setStarted(true);
    setStep(11);

    // 保存済み answers で再検索
    setIsLoadingRecommendations(true);
    if (loadingTimer.current) clearInterval(loadingTimer.current);
    setLoadingMsgIdx(0);
    loadingTimer.current = setInterval(() => {
      setLoadingMsgIdx(i => (i + 1) % LOADING_MESSAGES.length);
    }, 1800);

    try {
      const res = await apiFetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers:            sa,
          pastFeedback:       pastFeedback.slice(0, 5),
          seenPlaces:         [],
          showUnseenOnly:     false,
          refinementText:     '',
          userPreferenceHints: [],
        }),
      });
      const d = await res.json();
      const recs: Recommendation[] = d.recommendations ?? d.data ?? [];
      if (recs.length > 0) {
        setApiRecommendations(recs);
        setApiWarning(d.warning ?? '');  // 重複表示の修正（API warning をそのまま使用）
      }
    } catch (e) {
      console.error('[handleResearch]', e);
    }

    if (loadingTimer.current) clearInterval(loadingTimer.current);
    setIsLoadingRecommendations(false);
  };

  // ─── Reset ────────────────────────────────────────────────────────────────

  const resetQuiz = () => {
    setStarted(false); setStep(1);
    setSelectedMood(''); setSelectedArea(''); setLocationDisplayArea('');
    setSelectedCompanion('');
    setBudget(undefined); setBudgetMin(0); setFreeWord('');
    setDynamicQuestions([]); setDynamicAnswers({});
    setAreaMode('manual'); setDistanceFeeling('今日は出かけたい'); setRadiusKm(20);
    setDeepDiveL1(''); setDeepDiveL2('');
    setOnsenCategory(null); setNatureSubGenre(null); setNatureDistancePref(null);
    setCafeSubCategory(null); setCafeDetail(null); setCafeDetailMode(false);
    setCafeDistancePref(null); setWaiWaiSubCategory(null);
    setOnsenDistancePref(null); setScenerySubCategory(null);
    setApiRecommendations([]); setApiWarning('');
    setPlaceRatings({}); setLikedInSession([]); setMapClickedInSession([]);
    setRefinementText(''); setSelectedPrefecture('');
    setHomeView('home');
  };

  // 「条件を見直す」: 気分(とエリア)は保持し、その次の質問(step2=同行者)から再選択する。
  // 気分より後の回答はクリアして選び直せるようにする。
  const handleReviewConditions = () => {
    setSelectedCompanion('');
    setBudget(undefined); setBudgetMin(0); setFreeWord('');
    setDynamicQuestions([]); setDynamicAnswers({});
    setDistanceFeeling('今日は出かけたい'); setRadiusKm(20);
    setDeepDiveL1(''); setDeepDiveL2('');
    setOnsenCategory(null); setNatureSubGenre(null); setNatureDistancePref(null);
    setCafeSubCategory(null); setCafeDetail(null); setCafeDetailMode(false);
    setCafeDistancePref(null); setWaiWaiSubCategory(null);
    setOnsenDistancePref(null); setScenerySubCategory(null);
    setApiRecommendations([]); setApiWarning('');
    setPlaceRatings({}); setLikedInSession([]); setMapClickedInSession([]);
    setRefinementText(''); setSelectedPrefecture('');
    // selectedMood / selectedArea は保持
    setHomeView('home');
    setStarted(true);
    setStep(2);
  };

  // ─── Toggle favorite ──────────────────────────────────────────────────────

  const toggleFavorite = (rec: Recommendation) => {
    const exists = favorites.find(f => f.title === rec.title);
    if (exists) {
      setFavorites(prev => prev.filter(f => f.title !== rec.title));
    } else {
      setFavorites(prev => [{
        title:            rec.title,
        area:             selectedArea,
        vibe:             rec.vibe ?? '',
        photoUrl:         rec.photoUrl,
        mapUrl:           rec.mapUrl,
        createdAt:        new Date().toISOString(),
        placeId:          rec.placeId,
        address:          rec.address,
        rating:           rec.rating,
        openingHoursText: rec.openingHoursText,
        openNow:          rec.openNow,
        photoUrls:        rec.photoUrls,
        stationText:      rec.stationText,
        distanceText:     rec.distanceText,
        priceLevel:       rec.priceLevel,
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
      title:            item.title,
      address:          item.address ?? item.area,
      vibe:             item.vibe,
      photoUrl:         item.photoUrl,
      photoUrls:        item.photoUrls ?? (item.photoUrl ? [item.photoUrl] : []),
      mapUrl:           item.mapUrl,
      placeId:          item.placeId,
      rating:           item.rating ?? undefined,
      openingHoursText: item.openingHoursText,
      openNow:          item.openNow,
      stationText:      item.stationText,
      distanceText:     item.distanceText,
      priceLevel:       item.priceLevel,
      phone:            item.phone,
      website:          item.website,
    };
    setSelectedPlace(rec);
    router.push('/place');
  };

  // ─── Tab fade ─────────────────────────────────────────────────────────────

  const tabFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    tabFade.setValue(0);
    Animated.timing(tabFade, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [homeView]);

  // ─── Profile setup (first launch) ────────────────────────────────────────

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

  // ─── Quiz flow ────────────────────────────────────────────────────────────

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
            onSelectArea={handleSelectArea}
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

  // ─── Results screen ───────────────────────────────────────────────────────

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
            onChangeRadius={(km) => { setRadiusKm(km); openResults('', true, km); }}
            // ── 検索結果（全気分とも recommendations に統一）──────────────────
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
            loadingMessage={LOADING_MESSAGES[loadingMsgIdx]}
            apiWarning={apiWarning}
            // ── お気に入り ────────────────────────────────────────────────────
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
            // ── 気分評価 (👍/👎) ──────────────────────────────────────────────
            placeRatings={placeRatings}
            onSetPlaceRatings={setPlaceRatings}
            onSubmitPlaceRating={submitPlaceRating}
            // ── UI state ─────────────────────────────────────────────────────
            photoIndices={photoIndices}
            onSetPhotoIndices={setPhotoIndices}
            blockedPlaces={blockedPlaces}
            onBlockPlace={(title) => setBlockedPlaces(prev => [...prev, title])}
            // ── フィードバック ────────────────────────────────────────────────
            feedbackRating={null}
            feedbackSubmitted={false}
            onSubmitFeedback={() => {}}
            likedInSession={likedInSession}
            onSetLikedInSession={setLikedInSession}
            mapClickedInSession={mapClickedInSession}
            onSetMapClickedInSession={setMapClickedInSession}
            // ── 絞り込み ──────────────────────────────────────────────────────
            refinementText={refinementText}
            onSetRefinementText={setRefinementText}
            isRefining={isRefining}
            onRefine={async () => {
              setIsRefining(true);
              await openResults(refinementText, true);
              setIsRefining(false);
            }}
            prefectureButtons={[]}
            selectedPrefecture={selectedPrefecture}
            onSelectPrefecture={setSelectedPrefecture}
            // ── シャッフル ────────────────────────────────────────────────────
            onShuffle={handleShuffle}
            // ── その他 ───────────────────────────────────────────────────────
            onReset={resetQuiz}
            onReviewConditions={handleReviewConditions}
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
                if (reportReason === '閉店・閉業' || reportReason === 'Closed/Shut down') {
                  if (reportingSpot.supabaseId) {
                    // #9 迷惑報告対策: デバイスIDを sessionId として送り、同一端末の連投を無効化
                    const sessionId = await getDeviceId().catch(() => '');
                    await apiFetch('/api/report-closed', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ placeId: reportingSpot.supabaseId, sessionId }),
                    }).catch(() => {});
                  }
                }
                await apiFetch('/api/reports', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    spot_name:    reportingSpot.title,
                    spot_address: reportingSpot.address,
                    reason:       reportReason,
                    note:         reportNote,
                  }),
                });
              } catch {}
              setReportDone(true);
              setReportSubmitting(false);
            }}
            seenPlaceTitles={history.flatMap(h =>
              h.recommendations?.map(r => r.title) ?? [h.topRecommendation]
            )}
            onSubmitVisitedFeedback={submitVisitedFeedback}
            onPressDetail={handlePressDetail}
          />
        </SlideUp>
      </View>
    );
  }

  // ─── Home screens ─────────────────────────────────────────────────────────

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
            onResearch={handleResearch}
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
              setFavorites(prev => prev.filter(f => f.title !== title))
            }
            onPressCard={handlePressFavoriteDetail}
            resetKey={tabResetKeys.favorites}
          />
        );
      case 'featured':
        return <FeatureScreen />;
      case 'groups':
        return (
          <GroupsView
            resetKey={tabResetKeys.groups}
            onChatOpenChange={setGroupChatOpen}
          />
        );
      default:
        return (
          <HomeView
            profileAge={profileAge}
            profileGender={profileGender}
            lang={lang}
            onStart={() => setStarted(true)}
            onStartWithMood={(moodKey: string) => {
              // 気分を選択済み状態にしてstep=2（同行者選択）から開始
              setSelectedMood(moodKey);
              setStep(2);
              setStarted(true);
            }}
            onShowSettings={() => setShowSettings(true)}
            onShowFeatured={() => setHomeView('featured')}
            onOpenAiChat={handleOpenAiChat}
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
      {!groupChatOpen && (
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
      )}
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
        blockedPlaces={blockedPlaces}
        onUnblockPlace={(title) => setBlockedPlaces(prev => prev.filter(t => t !== title))}
        onClearBlocked={() => setBlockedPlaces([])}
      />

      {/* AI相談 入力画面（最前面オーバーレイ・TabBarより上に重ねて下部バーを隠す）*/}
      {aiChatOpen && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 300, elevation: 300 }]}>
          <AiChatInput
            onBack={() => setAiChatOpen(false)}
            onSubmit={handleAiSubmit}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F1EF' },
});
