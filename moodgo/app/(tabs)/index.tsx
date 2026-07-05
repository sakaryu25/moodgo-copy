import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
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
  BLOCKED_PLACES_KEY, PROFILE_KEY, ONBOARDED_KEY,
  loadJSON, saveJSON,
} from '@/lib/storage';
import { apiFetch, API_BASE, prewarmRecommend } from '@/lib/api';
import { sendEngagement as libSendEngagement } from '@/lib/engagement';
import { reportError } from '@/lib/crashReporting';
import { setSelectedPlace } from '@/lib/selectedPlace';
import { useTabReset } from '@/lib/useTabReset';
import { sameFav } from '@/lib/favKey';
import { getABVariant, getDeviceId } from '@/lib/abtest';
import { showToast } from '@/lib/toast';
// 設定まわりの共有state（言語/プロフィール/非表示）。設定UIをプロフィールタブへ移したためストア化。
import { useSettings, hydrateSettings, saveProfile, addBlockedPlace } from '@/lib/settingsStore';
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
import HistoryView      from '@/components/HistoryView';
import ProfileSetup     from '@/components/ProfileSetup';
import Onboarding       from '@/components/Onboarding';
import QuizFlow         from '@/components/QuizFlow';
import ResultsView      from '@/components/ResultsView';
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
  // NativeTabs移行: 保存/みんな/つぶやき/特集 は独立タブルートに分離。
  //   このホームルートは home と history(ボタンで開くサブ画面) のみを切替える。
  const [homeView,   setHomeView]   = useState<'home' | 'history'>('home');
  const [historyResetKey, setHistoryResetKey] = useState(0);
  // #14: ホームタブを再タップ → 履歴サブ画面を閉じてホーム(START)へ戻す（振り出し）
  useTabReset(() => { setHomeView('home'); setHistoryResetKey(k => k + 1); });

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
  const [onboarded,        setOnboarded]        = useState(false);   // 初回オンボーディングを通過済みか
  const [firstRunStep,     setFirstRunStep]     = useState<'onboarding' | 'profile'>('onboarding');
  // 言語/プロフィール/非表示スポットは settingsStore（共有）から取得。設定UIはプロフィールタブへ移設。
  const settings = useSettings();
  const { lang, profileAge, profileGender, blockedPlaces } = settings;

  // ── Results ──────────────────────────────────────────────────────────────
  const [apiRecommendations,     setApiRecommendations]     = useState<Recommendation[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [loadingMsgIdx,          setLoadingMsgIdx]          = useState(0);
  const [apiWarning,             setApiWarning]             = useState('');
  const [searchFailed,           setSearchFailed]           = useState(false);  // 通信/タイムアウト等の失敗（0件とは区別）
  const [refinementText,         setRefinementText]         = useState('');
  const [isRefining,             setIsRefining]             = useState(false);
  const [selectedPrefecture,     setSelectedPrefecture]     = useState('');
  // G-2: A/Bテスト variant（デバイス単位で安定）
  const [abVariant,              setAbVariant]              = useState<'A' | 'B'>('A');

  // ── Feedback ─────────────────────────────────────────────────────────────
  const [pastFeedback,        setPastFeedback]        = useState<FeedbackItem[]>([]);
  const [placeRatings,        setPlaceRatings]        = useState<Record<string, 'good' | 'bad'>>({});
  // 「おすすめはいかがでしたか？」の星評価（検索結果全体へのフィードバック）
  const [feedbackRating,      setFeedbackRating]      = useState<number | null>(null);
  const [feedbackSubmitted,   setFeedbackSubmitted]   = useState(false);
  const [likedInSession,      setLikedInSession]      = useState<string[]>([]);
  const [mapClickedInSession, setMapClickedInSession] = useState<string[]>([]);

  // ── UI ───────────────────────────────────────────────────────────────────
  const [photoIndices,  setPhotoIndices]  = useState<Record<string, number>>({});

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
  // ファネル計測: 直近検索の searchId を保持し engagement 送信時に同梱する
  const searchIdRef = useRef<string>('');

  // ─── Load from AsyncStorage ──────────────────────────────────────────────

  // ── 地図画像・ホーム写真をアプリ起動時に先読み（特集/ホームのラグ防止）──
  useEffect(() => {
    preloadMaps();
    Asset.loadAsync([require('../../assets/images/home-featured.png')]).catch(() => {});
    // G-2: A/Bテスト variant をロード
    getABVariant().then(setAbVariant).catch(() => {});
    // 設定ストア（言語/プロフィール/非表示）を AsyncStorage から初期化
    hydrateSettings();
  }, []);

  useEffect(() => {
    (async () => {
      const faves   = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
      const hist    = await loadJSON<HistoryItem[]>(HISTORY_KEY, []);
      const feed    = await loadJSON<FeedbackItem[]>(FEEDBACK_KEY, []);
      // プロフィール本体（言語/年代/性別/都道府県）は settingsStore が保持。ここでは
      // 初回オンボーディング要否の判定にだけ PROFILE_KEY を参照する（表示/検索用stateは持たない）。
      const profile = await loadJSON<{ age?: string; gender?: string; prefecture?: string }>(PROFILE_KEY, {});
      setFavorites(faves);
      // 履歴内の旧形式photoURLをphoto-proxy経由に変換（保存時の旧URL対策）
      const fixedHist = hist.map(item => ({
        ...item,
        recommendations: (item.recommendations ?? []).map(fixRec),
      }));
      setHistory(fixedHist);
      setPastFeedback(feed);
      setProfileSetupDone(!!(profile.age || profile.gender));
      // 初回オンボーディング: 明示フラグ、または既存ユーザー（プロフィール/履歴/お気に入りあり）は通過済み扱い
      const ob = await loadJSON<boolean>(ONBOARDED_KEY, false);
      setOnboarded(ob || !!(profile.age || profile.gender) || hist.length > 0 || faves.length > 0);
      setProfileLoaded(true);
    })();
  }, []);

  useEffect(() => { if (profileLoaded) saveJSON(FAVORITES_KEY,     favorites);    }, [favorites,    profileLoaded]);

  // 別ルート(詳細ページ/プロフィールタブ)での変更をホームに再同期する。
  // → 穴場詳細でいいねした投稿が戻った瞬間お気に入りに反映され、
  //   プロフィールタブの設定「履歴をクリア」もホームに戻れば反映される。
  useFocusEffect(
    useCallback(() => {
      if (!profileLoaded) return;
      (async () => {
        const faves = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
        setFavorites(faves);
        const hist = await loadJSON<HistoryItem[]>(HISTORY_KEY, []);
        setHistory(hist.map(item => ({
          ...item,
          recommendations: (item.recommendations ?? []).map(fixRec),
        })));
      })();
    }, [profileLoaded])
  );
  useEffect(() => { if (profileLoaded) saveJSON(HISTORY_KEY,       history);      }, [history,      profileLoaded]);
  useEffect(() => { if (profileLoaded) saveJSON(FEEDBACK_KEY,      pastFeedback); }, [pastFeedback, profileLoaded]);

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
          // 住所が取れた時だけ入力欄へ。失敗時は欄を汚さずバッジ表示のみ「現在地」
          const fullAddr = d?.ok ? (d.fullAddress ?? d.displayArea ?? d.area ?? '') : '';
          if (fullAddr) { setSelectedArea(fullAddr); setLocationDisplayArea(fullAddr); }
          else { setSelectedArea(''); setLocationDisplayArea('現在地'); }
        } catch { setSelectedArea(''); setLocationDisplayArea('現在地'); }
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
        // 住所が取れなかった場合は入力欄を汚さず、バッジ表示のみ「現在地」にする
        const fullAddr = d?.ok ? (d.fullAddress ?? d.displayArea ?? d.area ?? '') : '';
        if (fullAddr) { setSelectedArea(fullAddr); setLocationDisplayArea(fullAddr); }
        else { setSelectedArea(''); setLocationDisplayArea('現在地'); }
      } catch {
        setSelectedArea('');
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
    prewarmRecommend();  // AI相談も検索APIを使うので開始時に暖機
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
          const fullAddr = d?.ok ? (d.fullAddress ?? d.displayArea ?? d.area ?? '') : '';
          if (fullAddr) { setSelectedArea(fullAddr); setLocationDisplayArea(fullAddr); }
          else { setSelectedArea(''); setLocationDisplayArea('現在地'); }
        } catch {
          setSelectedArea('');
          setLocationDisplayArea('現在地');
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
    setSearchFailed(false);  // 新しい試行のたびに失敗フラグをリセット
    // 新規検索時: 前回結果・評価をクリアしてから結果画面へ
    if (!isRefinement) {
      setApiRecommendations([]);
      setPlaceRatings({});
      setFeedbackRating(null);
      setFeedbackSubmitted(false);
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
      const baseBody = {
        answers:            refinedAnswers,
        pastFeedback:       pastFeedback.slice(0, 5),  // 直近5件のフィードバックを渡す
        seenPlaces:         [...seenSet],
        showUnseenOnly:     showUnseenOnly || excludeShown,
        refinementText:     refineText ?? '',
        userPreferenceHints: buildPreferenceHints(),  // ⑤ 端末プロファイル（好みタグ）
      };
      // 検索POST: コールドスタート等でのタイムアウト中断(AbortError)は1回だけ自動リトライ。
      //   2回目はVercel関数が暖機済みで即応答するため、初回の誤タイムアウトを吸収する。
      const postRecommend = async (body: unknown): Promise<Response> => {
        const opts = {
          method: 'POST' as const,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          timeoutMs: 30000,  // 未キャッシュ検索は10s前後かかるため余裕を持たせる（既定12sだと誤タイムアウト）
        };
        try {
          return await apiFetch('/api/recommend', opts);
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            return await apiFetch('/api/recommend', opts);  // 暖機後リトライ
          }
          throw err;
        }
      };
      const res = await postRecommend(baseBody);

      let d = await res.json();
      let recs: Recommendation[] = d.recommendations ?? d.data ?? [];
      let exhaustedNote = '';

      // シャッフル/未見のみで在庫が尽きて0件になったら、除外を解いて再表示
      // （箱根など候補が少ないエリアで「空っぽ画面」になるのを防ぐ）
      if (recs.length === 0 && (excludeShown || showUnseenOnly)) {
        const res2 = await postRecommend({ ...baseBody, seenPlaces: [], showUnseenOnly: false });
        const d2 = await res2.json();
        const recs2: Recommendation[] = d2.recommendations ?? d2.data ?? [];
        if (recs2.length > 0) {
          d = d2;
          recs = recs2;
          exhaustedNote = '新しい場所が見つからなかったので、もう一度おすすめを表示しています。';
        }
      }

      searchIdRef.current = (d as { searchId?: string })?.searchId ?? '';  // ファネル計測用
      setApiRecommendations(recs);
      // B-2: ワーニングはAPIの warning をそのまま表示（API側で既に「範囲を広げました」を含むため
      //   アプリ側で同文を重ねない＝重複表示の修正）
      setApiWarning(exhaustedNote || d.warning || '');

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
      const aborted = e instanceof Error && e.name === 'AbortError';
      if (aborted) {
        // タイムアウト/中断は想定内（コールドスタート・電波弱）。赤いLogBoxを避けwarnに留める
        console.warn('[openResults] timeout/abort', e);
      } else {
        console.error('[openResults]', e);
        reportError(e, 'error', { where: 'openResults' });
      }
      // 静かに空画面で放置せず、原因と再試行を案内（通信失敗/タイムアウト）
      setSearchFailed(true);
      setApiWarning(aborted
        ? '通信が混み合っているようです。もう一度「再検索」を押してください。'
        : '検索に失敗しました。通信環境を確認して、もう一度お試しください。');
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

  // ── ② 暗黙フィードバック送信（学習ループ用・fire-and-forget）─────────────────
  //   地図クリック/詳細閲覧/お気に入り/行った！を記録 → 検索結果の昇格学習に使われる
  const sendEngagement = (placeName: string, action: 'map_click' | 'detail_view' | 'favorite' | 'visited' | 'share') => {
    if (!placeName) return;
    // ファネル計測: 店舗ID(placeId/supabaseId)・掲載順位・検索ID・端末IDを同梱して送る。
    //   呼び出し側は従来通り (title, action) のままで、ここで結果一覧から自動解決する。
    const idx = apiRecommendations.findIndex((r) => r.title === placeName);
    const rec = idx >= 0 ? apiRecommendations[idx] : undefined;
    libSendEngagement(placeName, action, selectedMood, {
      placeId: rec?.placeId ?? rec?.supabaseId,
      searchId: searchIdRef.current || undefined,
      position: idx >= 0 ? idx : undefined,
    });
  };

  // ── ⑤ 端末プロファイル: お気に入り・高評価のタグ頻度から「好みヒント」を生成 ───
  //   サーバーの userPreferenceHints（検索のnice-to-haveタグ＆AIプロンプト）に渡す。
  //   端末ローカル計算なのでプライバシーフレンドリー・テーブル追加不要。
  const buildPreferenceHints = (): string[] => {
    const freq = new Map<string, number>();
    const addTags = (tags?: string[]) => (tags ?? []).forEach(t => {
      if (t && t.startsWith('#')) freq.set(t, (freq.get(t) ?? 0) + 1);
    });
    for (const f of favorites) addTags((f as { features?: string[] }).features);
    // 高評価(good)を付けたスポットのタグも反映（直近の検索結果から逆引き）
    for (const [title, v] of Object.entries(placeRatings)) {
      if (v === 'good') addTags(apiRecommendations.find(r => r.title === title)?.features);
    }
    return [...freq.entries()]
      .filter(([, n]) => n >= 2)              // 2回以上現れたタグ＝安定した好み
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);
  };

  // ── 「おすすめはいかがでしたか？」全体評価（星1〜5）────────────────────────
  //   星を即時に黄色く染めてから、少し見せた後にお礼表示へ切り替える
  const submitOverallFeedback = (rating: number) => {
    if (feedbackSubmitted || feedbackRating !== null) return;  // 二重送信防止
    setFeedbackRating(rating);  // → 星が即時に黄色く染まる

    const newFeedback: FeedbackItem = {
      id:               `overall-${Date.now()}`,
      answers:          { mood: selectedMood, area: selectedArea, companion: selectedCompanion },
      topRecommendations: apiRecommendations.slice(0, 3).map(r => r.title),
      rating,
      visitedPlace:     '',
      createdAt:        new Date().toISOString(),
    };
    setPastFeedback(prev => [newFeedback, ...prev].slice(0, 50));

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
        likedPlaces:      likedInSession,
        mapClickedPlaces: mapClickedInSession,
        variant:          abVariant,
      }),
    }).catch(() => {});

    // 染まった星を0.9秒見せてからお礼表示へ
    setTimeout(() => setFeedbackSubmitted(true), 900);
  };

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
    sendEngagement(title, 'visited');  // ② 学習ループ: 実訪問=最強シグナル
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
    setSearchFailed(false);
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
      const opts = {
        method: 'POST' as const,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers:            sa,
          pastFeedback:       pastFeedback.slice(0, 5),
          seenPlaces:         [],
          showUnseenOnly:     false,
          refinementText:     '',
          userPreferenceHints: buildPreferenceHints(),  // ⑤ 端末プロファイル（好みタグ）
        }),
        timeoutMs: 30000,
      };
      // コールドスタートのタイムアウト中断は1回だけ自動リトライ（2回目は暖機済みで即応答）
      let res: Response;
      try {
        res = await apiFetch('/api/recommend', opts);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') res = await apiFetch('/api/recommend', opts);
        else throw err;
      }
      const d = await res.json();
      const recs: Recommendation[] = d.recommendations ?? d.data ?? [];
      searchIdRef.current = (d as { searchId?: string })?.searchId ?? '';  // ファネル計測用
      setApiRecommendations(recs);
      // 0件でも黙らず案内（従来は無反応だった）
      setApiWarning(recs.length > 0 ? (d.warning ?? '') : (d.warning || '条件に合う場所が見つかりませんでした。条件を変えてお試しください。'));
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      if (aborted) {
        console.warn('[handleResearch] timeout/abort', e);
      } else {
        console.error('[handleResearch]', e);
        reportError(e, 'error', { where: 'handleResearch' });
      }
      setSearchFailed(true);
      setApiWarning(aborted
        ? '通信が混み合っているようです。もう一度お試しください。'
        : '再検索に失敗しました。通信環境を確認して、もう一度お試しください。');
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
    // sameFav: supabaseId/placeId優先の同一判定（title一致だと同名別スポットが道連れになる）
    const exists = favorites.find(f => sameFav(f, rec));
    if (exists) {
      setFavorites(prev => prev.filter(f => !sameFav(f, rec)));
    } else {
      sendEngagement(rec.title, 'favorite');  // ② 学習ループ: お気に入り=強いシグナル
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
        tags:             rec.tags,        // 心霊判定用
        supabaseId:       rec.supabaseId,  // 投稿写真の照合用
      }, ...prev]);
    }
  };

  // ─── 詳細ページへ遷移 ─────────────────────────────────────────────────────

  const handlePressDetail = (rec: Recommendation) => {
    sendEngagement(rec.title, 'detail_view');  // ② 学習ループ
    // 詳細ページの★評価を「気分に合う/合わない」学習に使うため、現在の検索文脈を一緒に渡す。
    setSelectedPlace(rec, {
      mood: selectedMood || undefined,
      companion: selectedCompanion || undefined,
      subCategory: deepDiveL2 || deepDiveL1 || undefined,
    });
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
      tags:             item.tags,
      supabaseId:       item.supabaseId,
    };
    setSelectedPlace(rec);
    router.push('/place');
  };

  // ─── Tab fade ─────────────────────────────────────────────────────────────

  const tabFade = useRef(new Animated.Value(1)).current;
  const tabFadeFirst = useRef(true);
  useEffect(() => {
    // 初回マウントはスキップ（opacity=1のまま）。オンボーディング中にメインViewが
    //   未マウントのまま useNativeDriver アニメを走らせると、マウント後 opacity=0 で固まり
    //   ホームが真っ白になるため。タブ切替(home↔history)時のみフェードする。
    if (tabFadeFirst.current) { tabFadeFirst.current = false; return; }
    tabFade.setValue(0);
    Animated.timing(tabFade, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [homeView]);

  // ─── First launch: オンボーディング → プロフィール設定（任意・スキップ可）──────
  //   onboarded フラグで一度きり。プロフィールはスキップしても onboarded を立てて
  //   再表示しない（＝プロフィール任意化）。既存ユーザーは load 時に通過済み扱い。

  const onboardingNode = (profileLoaded && !onboarded) ? (
    firstRunStep === 'onboarding' ? (
      <View style={styles.root}>
        <AppBackground />
        <Onboarding onDone={() => setFirstRunStep('profile')} />
      </View>
    ) : (
      <View style={styles.root}>
        <AppBackground />
        <ProfileSetup
          onDone={(age, gender, prefecture) => {
            saveProfile(age, gender, prefecture);      // 共有ストアへ保存（PROFILE_KEYも更新）
            setProfileSetupDone(!!(age || gender));   // 入力があればプロフィール完了
            setOnboarded(true);                        // スキップでも初回フローは完了＝再表示しない
            saveJSON(ONBOARDED_KEY, true);
          }}
        />
      </View>
    )
  ) : null;

  // ─── Quiz flow ────────────────────────────────────────────────────────────

  const quizNode = (started && step <= 8) ? (
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
  ) : null;

  // ─── Results screen ───────────────────────────────────────────────────────

  const resultsNode = (started && step === 11) ? (
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
            searchFailed={searchFailed}
            onRetrySearch={() => openResults(refinementText || '')}
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
            onBlockPlace={(title) => addBlockedPlace(title)}
            // ── フィードバック ────────────────────────────────────────────────
            feedbackRating={feedbackRating}
            feedbackSubmitted={feedbackSubmitted}
            onSubmitFeedback={submitOverallFeedback}
            likedInSession={likedInSession}
            onSetLikedInSession={setLikedInSession}
            mapClickedInSession={mapClickedInSession}
            onSetMapClickedInSession={(arr) => {
              for (const t of arr) if (!mapClickedInSession.includes(t)) sendEngagement(t, 'map_click');
              setMapClickedInSession(arr);
            }}
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
                setReportDone(true);
              } catch {
                showToast('通報を送信できませんでした', '通信環境を確認して再度お試しください');
              }
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
  ) : null;

  // ─── Home screens ─────────────────────────────────────────────────────────

  const renderContent = () => {
    if (homeView === 'history') {
      // 履歴はタブから外したのでホーム内のサブ画面として表示（再検索ロジックを保持）
      return (
        <View style={{ flex: 1 }}>
          <View style={{ paddingTop: insets.top + 8, paddingBottom: 2, paddingHorizontal: 10 }}>
            <Pressable
              onPress={() => setHomeView('home')}
              hitSlop={12}
              style={{ alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10 }}
            >
              <Text style={{ fontSize: 16, color: '#7C3AED', fontWeight: '700' }}>‹ ホーム</Text>
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>
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
              resetKey={historyResetKey}
            />
          </View>
        </View>
      );
    }
    return (
      <HomeView
        profileAge={profileAge}
        profileGender={profileGender}
        lang={lang}
        onStart={() => { prewarmRecommend(); setStarted(true); }}
        onStartWithMood={(moodKey: string) => {
          // 気分を選択済み状態にしてstep=2（同行者選択）から開始
          prewarmRecommend();  // クイズ開始＝検索数十秒前にVercel関数を暖機（コールドスタート対策）
          setSelectedMood(moodKey);
          setStep(2);
          setStarted(true);
        }}
        onShowFeatured={() => router.navigate('/featured')}
        onShowHistory={() => setHomeView('history')}
        onOpenAiChat={handleOpenAiChat}
        onOpenTsubuyaki={() => router.push('/groups')}
      />
    );
  };

  return (
    <View style={styles.root}>
      <AppBackground />
      <Animated.View style={{ flex: 1, opacity: tabFade }}>
        {renderContent()}
      </Animated.View>

      {/* AI相談 入力画面（最前面オーバーレイ・TabBarより上に重ねて下部バーを隠す）*/}
      {aiChatOpen && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 300, elevation: 300 }]}>
          <AiChatInput
            onBack={() => setAiChatOpen(false)}
            onSubmit={handleAiSubmit}
          />
        </View>
      )}

      {/* オンボーディング/プロフィール: フルスクリーンModalでネイティブタブバーごと覆う */}
      <Modal visible={profileLoaded && !onboarded} animationType="fade" presentationStyle="fullScreen">
        {onboardingNode}
      </Modal>

      {/* クイズ/結果: フルスクリーンModalで没入表示（ネイティブタブバーを隠す）*/}
      <Modal
        visible={started}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={resetQuiz}
      >
        {quizNode}
        {resultsNode}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F1EF' },
});
