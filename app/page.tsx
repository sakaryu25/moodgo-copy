"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OnsenCategory, PlaceResponse } from "@/types/onsen";
import type { NatureSubGenre } from "@/types/nature";
import type { CafeSubCategory, CafeDetail, CafeDistancePref } from "@/types/cafe";
import type { WaiWaiSubCategory } from "@/types/waiwai";
import type { DriveSubCategory } from "@/types/drive";
import type { FocusSubCategory } from "@/types/focus";
import type { SportsSubCategory } from "@/types/sports";
import type { TravelSubCategory } from "@/types/travel";
import {
  getOnsenTags, getCafeTags, getNatureTags,
  getWaiWaiTags, getDriveTags, getFocusTags,
  getSportsTags, getTravelTags,
} from "@/lib/mood-tag-map";
import { detectUserPrefecture, getNearbyPrefectures } from "@/lib/prefecture-utils";

type RouteByMode = {
  icon: string;
  durationText: string;
  distanceText: string;
};

type Recommendation = {
  title: string;
  vibe?: string;
  budget?: string;
  time?: string;
  address?: string;
  mapUrl?: string;
  rating?: number | null;
  userRatingCount?: number | null;
  photoUrl?: string;
  photoUrls?: string[];
  openingHoursText?: string;
  distanceText?: string;
  durationText?: string;
  openNow?: boolean;
  reason?: string;
  features?: string[];
  isUserSpot?: boolean;
  hasUserPhotos?: boolean;
  userPhotoCount?: number;
  priceLevel?: string;
  stationText?: string;
  routesByMode?: RouteByMode[];
  /** ホットペッパー由来のスポット */
  source?: "hotpepper" | "google" | "admin" | "user";
  hotpepperUrl?: string;
};

type FavoriteItem = {
  title: string;
  area: string;
  vibe: string;
  photoUrl?: string;
  mapUrl?: string;
  createdAt?: string;
};

type FeedbackItem = {
  id: string;
  answers: Partial<Answers>;
  topRecommendations: string[];
  rating: number | null;
  visitedPlace: string;
  createdAt: string;
};

type HistoryItem = {
  id: string;
  mood: string;
  area: string;
  companion: string;
  transport: string | string[];
  budget: number;
  time: string;
  atmosphere: string;
  priority: string;
  freeWord: string;
  topRecommendation: string;
  createdAt?: string;
  recommendations?: Recommendation[];
  savedAnswers?: Partial<Answers>;
};

type Answers = {
  mood: string;
  area: string;
  age?: string;
  gender?: string;
  companion: string;
  transport: string[];  // 複数選択
  budget?: number;
  budgetMin?: number;
  time: string;
  atmosphere: string;
  priority: string;
  freeWord: string;
  originLat?: number;
  originLng?: number;
  dynamicQ1?: { question: string; answer: string };
  dynamicQ2?: { question: string; answer: string };
  dynamicQ3?: { question: string; answer: string };
  dynamicQ4?: { question: string; answer: string };
  dynamicQs?: { question: string; answer: string }[];
};

type DynamicQuestion = { key: string; question: string; options: string[] };
type MoodOption = { key: string; label: string; emoji: string; icon: string; sub: string };

const FAVORITES_KEY = "moodgo-favorites";
const HISTORY_KEY = "moodgo-history";
const FEEDBACK_KEY = "moodgo-feedback";
const PENDING_VISITED_KEY = "moodgo-pending-visited";
const BLOCKED_PLACES_KEY = "moodgo-blocked-places";
const PROFILE_KEY = "moodgo-profile";
const VISITED_PLACES_KEY = "moodgo-visited-places";

const LOADING_MESSAGES = [
  "AIがあなたにぴったりの場所を探しています...",
  "エリアや気分を分析中...",
  "素敵なスポットを選別しています...",
  "営業中のお店を確認しています...",
  "もう少しでおすすめが揃います...",
  "あなただけのプランを組み立て中...",
];

export default function Home() {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(1);

  const [selectedMood, setSelectedMood] = useState("");
  const [selectedArea, setSelectedArea] = useState("");
  const [locationDisplayArea, setLocationDisplayArea] = useState("");
  const [selectedCompanion, setSelectedCompanion] = useState("");
  const [selectedTransports, setSelectedTransports] = useState<string[]>([]);
  const [budget, setBudget] = useState<number | undefined>(undefined);
  const [budgetMin, setBudgetMin] = useState<number>(0);
  const [showUnseenOnly, setShowUnseenOnly] = useState(false);
  const [selectedTime, setSelectedTime] = useState("");
  const [selectedAtmosphere, setSelectedAtmosphere] = useState("");
  const [selectedPriority, setSelectedPriority] = useState("");
  const [freeWord, setFreeWord] = useState("");
  const [dynamicQuestions, setDynamicQuestions] = useState<DynamicQuestion[]>([]);
  const [dynamicAnswers, setDynamicAnswers] = useState<Record<string, string>>({});

  const [selectedAge, setSelectedAge] = useState("");
  const [selectedGender, setSelectedGender] = useState("");
  const [pastFeedback, setPastFeedback] = useState<FeedbackItem[]>([]);
  const [pendingVisited, setPendingVisited] = useState<FeedbackItem | null>(null);
  const [pendingVisitedInput, setPendingVisitedInput] = useState("");
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [feedbackVisitedPlace, setFeedbackVisitedPlace] = useState("");
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [likedInSession, setLikedInSession] = useState<string[]>([]);
  const [mapClickedInSession, setMapClickedInSession] = useState<string[]>([]);
  const [placeRatings, setPlaceRatings] = useState<Record<string, "good" | "bad">>({});
  const [photoIndices, setPhotoIndices] = useState<Record<string, number>>({});
  const [translatedCards, setTranslatedCards] = useState<Record<string, Record<string, unknown>>>({});
  const [translatingCards, setTranslatingCards] = useState<Record<string, boolean>>({});
  const [showEnglish, setShowEnglish] = useState<Record<string, boolean>>({});

  const [originLat, setOriginLat] = useState<number | undefined>(undefined);
  const [originLng, setOriginLng] = useState<number | undefined>(undefined);

  const [lang, setLang] = useState<"ja" | "en">("ja");

  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);

  const [homeView, setHomeView] = useState<"home" | "history" | "favorites" | "featured">("home");
  const [favoriteSort, setFavoriteSort] = useState<"newest" | "title">("newest");
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // 特集ページ一覧
  type FeaturedPageSummary = { id: string; slug: string; spot_name: string; catch_copy?: string; cover_image_url?: string; tags: string[]; partner_name: string };
  const [featuredList, setFeaturedList] = useState<FeaturedPageSummary[]>([]);
  const [featuredListLoading, setFeaturedListLoading] = useState(false);
  const loadFeaturedList = async () => {
    if (featuredList.length > 0) return;
    setFeaturedListLoading(true);
    try {
      const res = await fetch("/api/featured");
      const d = await res.json();
      if (d.ok) setFeaturedList(d.data);
    } catch { /* ignore */ }
    setFeaturedListLoading(false);
  };

  const [apiRecommendations, setApiRecommendations] = useState<Recommendation[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [apiWarning, setApiWarning] = useState("");
  const [blockedPlaces, setBlockedPlaces] = useState<string[]>([]);
  const [globallyBlockedNames, setGloballyBlockedNames] = useState<string[]>([]);
  // admin判定（管理画面ログイン済みの場合のみtrue）
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [refinementText, setRefinementText] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const resultsBottomRef = useRef<HTMLDivElement>(null);

  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [heroSrc, setHeroSrc] = useState("/moodgo-home-hero.png");

  // プロフィール設定（初回オンボーディング）
  const [profileSetupDone, setProfileSetupDone] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false); // SSR対策
  const [profileAge, setProfileAge] = useState("");
  const [profileGender, setProfileGender] = useState("");
  const [showProfileEdit, setShowProfileEdit] = useState(false);

  // 温泉・スパ カテゴリ選択 & 結果
  const [onsenCategory, setOnsenCategory] = useState<OnsenCategory | null>(null);
  const [onsenFacilities, setOnsenFacilities] = useState<PlaceResponse[] | null>(null);
  const [onsenCategoryLabel, setOnsenCategoryLabel] = useState("");
  const [isLoadingOnsen, setIsLoadingOnsen] = useState(false);

  // 自然感じたい サブジャンル & 結果
  const [natureSubGenre, setNatureSubGenre] = useState<NatureSubGenre | null>(null);
  const [natureFacilities, setNatureFacilities] = useState<PlaceResponse[] | null>(null);
  const [natureSubGenreLabel, setNatureSubGenreLabel] = useState("");
  const [isLoadingNature, setIsLoadingNature] = useState(false);

  // カフェ サブカテゴリ & 結果
  const [cafeSubCategory, setCafeSubCategory] = useState<CafeSubCategory | null>(null);
  const [cafeDetail, setCafeDetail] = useState<CafeDetail | null>(null);
  const [cafeDetailMode, setCafeDetailMode] = useState(false); // step9で深掘り質問を表示中かどうか
  const [cafeDistancePref, setCafeDistancePref] = useState<CafeDistancePref | null>(null);
  const [cafeFacilities, setCafeFacilities] = useState<PlaceResponse[] | null>(null);
  const [cafeSubCategoryLabel, setCafeSubCategoryLabel] = useState("");
  const [isLoadingCafe, setIsLoadingCafe] = useState(false);

  // わいわい楽しみたい サブカテゴリ & 結果
  const [waiWaiSubCategory, setWaiWaiSubCategory] = useState<WaiWaiSubCategory | null>(null);
  const [waiWaiFacilities, setWaiWaiFacilities] = useState<PlaceResponse[] | null>(null);
  const [waiWaiSubCategoryLabel, setWaiWaiSubCategoryLabel] = useState("");
  // ドライブしたい
  const [driveSubCategory, setDriveSubCategory] = useState<DriveSubCategory | null>(null);
  const [driveFacilities, setDriveFacilities] = useState<PlaceResponse[] | null>(null);
  const [driveSubCategoryLabel, setDriveSubCategoryLabel] = useState("");
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [isLoadingWaiWai, setIsLoadingWaiWai] = useState(false);

  // 集中したい
  const [focusSubCategory, setFocusSubCategory] = useState<FocusSubCategory | null>(null);
  const [focusFacilities, setFocusFacilities] = useState<PlaceResponse[] | null>(null);
  const [focusSubCategoryLabel, setFocusSubCategoryLabel] = useState("");
  const [isLoadingFocus, setIsLoadingFocus] = useState(false);

  // 体を動かしたい
  const [sportsSubCategory, setSportsSubCategory] = useState<SportsSubCategory | null>(null);
  const [sportsFacilities, setSportsFacilities] = useState<PlaceResponse[] | null>(null);
  const [sportsSubCategoryLabel, setSportsSubCategoryLabel] = useState("");
  const [isLoadingSports, setIsLoadingSports] = useState(false);

  // 遠くに行きたい
  const [travelSubCategory, setTravelSubCategory] = useState<TravelSubCategory | null>(null);
  const [travelFacilities, setTravelFacilities] = useState<PlaceResponse[] | null>(null);
  const [travelSubCategoryLabel, setTravelSubCategoryLabel] = useState("");
  const [isLoadingTravel, setIsLoadingTravel] = useState(false);

  // 時間潰したい（ランダム近隣スポット）
  const [randomFacilities, setRandomFacilities] = useState<PlaceResponse[] | null>(null);
  const [isLoadingRandom, setIsLoadingRandom] = useState(false);
  const [randomRadiusKm, setRandomRadiusKm] = useState<number>(15);

  // 都道府県フィルター
  const [selectedPrefecture, setSelectedPrefecture] = useState<string>("");
  const [prefectureButtons, setPrefectureButtons] = useState<string[]>([]);
  const [userPrefecture, setUserPrefecture] = useState<string>("");
  const [lastSearchParams, setLastSearchParams] = useState<{
    mustTags: string[];
    lat: number;
    lng: number;
    radiusKm: number;
    transport: string[];
    time?: string;
    companion?: string;
    budget?: number;
    freeWord?: string;
    minRadiusKm?: number;
    preferFar?: boolean;
    path: "sports" | "focus" | "drive" | "nature" | "cafe" | "waiwai" | "onsen" | "travel" | "other";
  } | null>(null);
  const [prefFilteredFacilities, setPrefFilteredFacilities] = useState<PlaceResponse[] | null>(null);
  const [isLoadingPrefFilter, setIsLoadingPrefFilter] = useState(false);

  // Feature 1: 営業中フィルター
  const [filterOpenNow, setFilterOpenNow] = useState(false);
  // Feature 2: ソート切り替え
  const [sortMode, setSortMode] = useState<"default" | "rating" | "near" | "far">("default");
  // Feature 8: 行った！ボタン
  const [visitedPlaces, setVisitedPlaces] = useState<string[]>([]);

  // 不適切報告モーダル
  const [reportingSpot, setReportingSpot] = useState<{ title: string; address: string } | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  // admin判定: 管理画面でログインしていればlocalStorageにフラグがある
  useEffect(() => {
    try {
      if (localStorage.getItem("moodgo_admin") === "1") setIsAdminMode(true);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const storedFavorites = window.localStorage.getItem(FAVORITES_KEY);
      const storedHistory = window.localStorage.getItem(HISTORY_KEY);
      const storedBlocked = window.localStorage.getItem(BLOCKED_PLACES_KEY);
      const storedVisited = window.localStorage.getItem(VISITED_PLACES_KEY);

      if (storedFavorites) setFavorites(JSON.parse(storedFavorites));
      if (storedHistory) setHistory(JSON.parse(storedHistory));
      if (storedBlocked) setBlockedPlaces(JSON.parse(storedBlocked));
      if (storedVisited) setVisitedPlaces(JSON.parse(storedVisited));

      // プロフィール復元
      const storedProfile = window.localStorage.getItem(PROFILE_KEY);
      if (storedProfile) {
        const p = JSON.parse(storedProfile) as { age?: string; gender?: string };
        if (p.age) { setProfileAge(p.age); setSelectedAge(p.age); }
        if (p.gender) { setProfileGender(p.gender); setSelectedGender(p.gender); }
        setProfileSetupDone(true);
      }
    } catch (error) {
      console.error("Failed to load local data", error);
    }
    setProfileLoaded(true);

    // グローバルブロックリストを取得
    fetch("/api/admin/block-place")
      .then(r => r.json())
      .then(d => { if (d.ok && Array.isArray(d.blocked)) setGloballyBlockedNames(d.blocked.map((b: { spot_name: string }) => b.spot_name)); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(BLOCKED_PLACES_KEY, JSON.stringify(blockedPlaces));
  }, [blockedPlaces]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VISITED_PLACES_KEY, JSON.stringify(visitedPlaces));
  }, [visitedPlaces]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(FEEDBACK_KEY);
      if (stored) setPastFeedback(JSON.parse(stored));
      const pending = window.localStorage.getItem(PENDING_VISITED_KEY);
      if (pending) setPendingVisited(JSON.parse(pending));
    } catch {}
  }, []);

  // ローディング中にメッセージをサイクル
  useEffect(() => {
    if (!isLoadingRecommendations) { setLoadingMsgIdx(0); return; }
    const timer = setInterval(() => {
      setLoadingMsgIdx((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 2200);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingRecommendations]);

  // お腹すいた: step8 に来てもサブ質問がないジャンル（中華・韓国・お好み焼き・高層ビル料理等）は
  // step7（自由ワード）へ自動スキップして空白ページを表示しない
  useEffect(() => {
    if (step !== 8 || selectedMood !== "お腹すいた") return;
    const genreAns = dynamicAnswers["food_genre_new"] ?? "";
    const hasSub = Object.keys(FOOD_SUB_QUESTIONS_MAP).some(k => genreAns.includes(k));
    if (!hasSub) setStep(7);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedMood, dynamicAnswers["food_genre_new"]]);

  // ドライブしたい・自然感じたい・集中したい: step6 に来ても表示する質問がない場合は自動スキップ
  useEffect(() => {
    if (step !== 6) return;
    if (dynamicQuestions.length > 0) return;
    const relax = dynamicAnswers["relax_place"] ?? "";
    const isNatureMood = selectedMood === "自然感じたい" ||
      (selectedMood === "まったりしたい" && relax.includes("自然の中"));
    const isDriveMood  = selectedMood === "ドライブしたい";
    const isWaiWaiMood = selectedMood === "わいわい楽しみたい";
    const isFocusMood  = selectedMood === "集中したい";
    const isSportsMood = selectedMood === "体を動かしたい";
    const isTravelMood = selectedMood === "遠くに行きたい";
    if (isNatureMood) setStep(9);
    else if (isDriveMood || isWaiWaiMood || isFocusMood || isSportsMood || isTravelMood) setStep(8);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedMood, dynamicQuestions.length]);

  const moods: MoodOption[] = [
    { key: "お腹すいた",         label: "お腹すいた",         emoji: "🍜", icon: "/icons/mood-food.svg",   sub: "絶品グルメ" },
    { key: "まったりしたい",     label: "まったりしたい",     emoji: "😌", icon: "/icons/mood-relax.svg",  sub: "癒やし・リラックス" },
    { key: "わいわい楽しみたい", label: "わいわい楽しみたい", emoji: "🎉", icon: "/icons/mood-party.svg",  sub: "エンタメ・遊び" },
    { key: "自然感じたい",       label: "自然感じたい",       emoji: "🍀", icon: "/icons/mood-nature.svg", sub: "自然・絶景・アウトドア" },
    { key: "ドライブしたい",     label: "ドライブしたい",     emoji: "🚗", icon: "/icons/mood-drive.svg",  sub: "ドライブ・ツーリング" },
    { key: "集中したい",         label: "集中したい",         emoji: "📚", icon: "/icons/mood-study.svg",  sub: "作業・勉強" },
    { key: "体を動かしたい",     label: "体を動かしたい",     emoji: "🏃", icon: "/icons/mood-sports.svg", sub: "スポーツ・アウトドア" },
    { key: "遠くに行きたい",     label: "遠くに行きたい",     emoji: "✈️", icon: "/icons/mood-travel.svg", sub: "小旅行・お出かけ" },
    { key: "時間潰したい",       label: "時間潰したい",       emoji: "🎲", icon: "",                       sub: "近くをランダムで発見" },
  ];

  const MOOD_QUESTIONS: Record<string, DynamicQuestion[]> = {
    "お腹すいた": [
      // food_distance は step5 専用（dynamicQuestions には含めない）
      // food_sub_choice は food_genre_new 選択時のみ動的注入（step6）
      { key: "food_genre_new", question: "食べたいジャンルは？", options: [
        "居酒屋🍺", "和食🍣", "洋食🍳", "イタリアン🍝",
        "中華🥟", "焼肉🥩", "韓国🌶️", "アジア系統🍛",
        "各国料理🌍", "ラーメン🍜", "お好み焼き・もんじゃ🥞", "カフェ・スイーツ☕",
        "高層ビル料理🏙️",
      ]},
    ],
    "まったりしたい": [
      { key: "relax_place", question: "どこで癒やされたい？", options: ["自然の中🌿", "カフェ☕", "温泉・スパ♨️", "絶景スポット🌅"] },
    ],
    "わいわい楽しみたい": [],
    "ドライブしたい": [
      // index 0 は step5 固定表示 (drive_distance)。index 1-4 が step6-8 のランダム3問
      { key: "drive_distance",  question: "どのくらい遠出したい？",           options: ["30分（サクッと）", "1時間（ほどよく）", "2時間（ガッツリ）", "3時間〜（旅）"] },
    ],
    "映えたい": [
      { key: "instgram_place",  question: "どこで映えたい？",             options: ["カフェ・スイーツ☕", "自然・絶景🌅", "街並み・建築🏛️", "アート・体験🎨"] },
      { key: "instgram_vibe",   question: "どんな雰囲気の写真が撮りたい？", options: ["おしゃれな内装💅", "絶景・パノラマ🌄", "路地裏・レトロ🏚️", "モダン・アート🖼️"] },
      { key: "instgram_style",  question: "撮り方のスタイルは？",           options: ["友達と撮り合い📸", "自撮りメイン🤳", "景色だけ楽しみたい🌿", "こだわらない！"] },
    ],
    "自然感じたい": [], // サブジャンル選択(step9)に移行したため動的質問なし
    "集中したい": [], // サブカテゴリ選択(step8)に移行したため動的質問なし
    "体を動かしたい": [], // サブカテゴリ選択(step8)に移行したため動的質問なし
    "遠くに行きたい": [], // サブカテゴリ選択(step8)に移行したため動的質問なし
    "時間潰したい": [], // 質問なし - 近隣をランダム表示
  };

  const ageOptions = ["10代", "20代", "30代", "40代以上"];
  const genderOptions = ["男性", "女性", "ノンバイナリー", "その他", "答えない"];

  // プロフィール保存
  const saveProfile = (age: string, gender: string) => {
    setProfileAge(age);
    setProfileGender(gender);
    setSelectedAge(age);
    setSelectedGender(gender);
    setProfileSetupDone(true);
    try {
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ age, gender }));
    } catch { /* ignore */ }
  };

  const companions = ["一人", "友達", "恋人", "家族", "大人数グループ", "先輩"];

  const transportOptions = [
    "徒歩",
    "自転車",
    "電車・バス",
    "車・バイク",
    "なんでも",
  ];

  const timeOptions = [
    "15〜30分",
    "30〜60分",
    "1〜2時間",
    "2〜4時間",
    "4〜6時間",
    "6時間以上",
  ];

  const atmosphereOptions = [
    "静か",
    "賑やか",
    "アクティブ",
    "スリル",
    "ロマンティック",
    "アットホーム",
  ];

  const priorityOptions = [
    "コスパ",
    "映え",
    "距離",
    "快適さ",
    "楽しさ",
    "質の高さ",
  ];

  // ===== English translations (display only; JP values go to API) =====
  const MOOD_EN: Record<string, { label: string; sub: string }> = {
    "お腹すいた":         { label: "I'm Hungry 🍜",        sub: "Food & Gourmet" },
    "まったりしたい":     { label: "Chill Out 😌",          sub: "Relaxation & Healing" },
    "わいわい楽しみたい": { label: "Have Fun! 🎉",           sub: "Entertainment & Play" },
    "ドライブしたい":     { label: "Go for a Drive 🚗",     sub: "Road Trip & Touring" },
    "自然感じたい":       { label: "Feel Nature 🍀",         sub: "Nature & Scenery" },
    "集中したい":         { label: "Focus Up 📚",            sub: "Work & Study" },
    "体を動かしたい":     { label: "Get Active 🏃",          sub: "Sports & Outdoors" },
    "遠くに行きたい":     { label: "Travel Far ✈️",           sub: "Day Trips & Excursions" },
    "時間潰したい":       { label: "Kill Time 🎲",           sub: "Random Nearby Spots" },
  };

  const OPTIONS_EN = {
    ages:        ["Teens", "20s", "30s", "40s+"],
    genders:     ["Male", "Female", "Other"],
    companions:  ["Solo", "Friends", "Partner", "Family", "Large Group", "With Seniors"],
    transport:   ["Walking", "Bicycle", "Train / Bus", "Car / Bike", "Any"],
    time:        ["15-30 min", "30-60 min", "1-2 hrs", "2-4 hrs", "4-6 hrs", "6+ hrs"],
    atmosphere:  ["Quiet", "Lively", "Active", "Thrilling", "Romantic", "Homey"],
    priority:    ["Value", "Instagrammable", "Proximity", "Comfort", "Fun", "Quality"],
  };

  const MOOD_QUESTIONS_EN: Record<string, DynamicQuestion[]> = {
    "お腹すいた": [
      { key: "food_genre_new", question: "What cuisine are you in the mood for?", options: [
        "Izakaya 🍺", "Japanese 🍣", "Western 🍳", "Italian 🍝",
        "Chinese 🥟", "Yakiniku 🥩", "Korean 🌶️", "Asian 🍛",
        "World cuisine 🌍", "Ramen 🍜", "Okonomiyaki 🥞", "Café & Sweets ☕",
      ]},
    ],
    "まったりしたい": [
      { key: "relax_place", question: "Where do you want to unwind?", options: ["In nature 🌿", "Café ☕", "Hot spring / Spa ♨️", "Scenic spot 🌅"] },
    ],
    "わいわい楽しみたい": [],
    "ドライブしたい": [
      { key: "drive_distance",  question: "How far do you want to go?",      options: ["30 min (Quick)", "1 hr (Moderate)", "2 hrs (Full)", "3+ hrs (Road trip)"] },
    ],
    "映えたい": [
      { key: "instgram_place",  question: "Where do you want the shot?",        options: ["Café & sweets ☕", "Nature & scenery 🌅", "Streets & architecture 🏛️", "Art & experience 🎨"] },
      { key: "instgram_vibe",   question: "What photo vibe?",                   options: ["Stylish interior 💅", "Panoramic view 🌄", "Retro alleyway 🏚️", "Modern art 🖼️"] },
      { key: "instgram_style",  question: "Your shooting style?",               options: ["Group shots 📸", "Selfie-focused 🤳", "Scenery only 🌿", "No preference!"] },
    ],
    "自然感じたい": [], // subGenre selection (step9) replaces dynamic questions
    "集中したい": [], // subCategory selection (step8) replaces dynamic questions
    "体を動かしたい": [], // subCategory selection (step8) replaces dynamic questions
    "遠くに行きたい": [], // subCategory selection (step8) replaces dynamic questions
  };

  // ── お腹すいた：ジャンル別サブ質問マップ ─────────────────────────────────────
  // food_genre_new の回答（キーに部分一致）→ food_sub_choice として動的注入される
  const FOOD_SUB_QUESTIONS_MAP: Record<string, DynamicQuestion> = {
    "居酒屋": { key: "food_sub_choice", question: "お店の雰囲気やメインとなる条件を教えてください", options: [
      "魚介・海鮮メイン🐟", "焼き鳥・串焼き🍡", "個室あり🔒", "大衆酒場・コスパ重視🍻",
    ]},
    "和食": { key: "food_sub_choice", question: "本日の和食、どのようなお食事がご希望ですか？", options: [
      "海鮮・お寿司🍣", "天ぷら・揚げ物🍤", "うどん・そば🍜", "割烹・懐石料理🎋",
    ]},
    "洋食": { key: "food_sub_choice", question: "メインで食べたい洋食のメニューはどれですか？", options: [
      "ハンバーグ🍔", "オムライス🍳", "ステーキ・肉料理🥩", "レトロな洋食屋さん🍽️",
    ]},
    "イタリアン": { key: "food_sub_choice", question: "今日のイタリアン、重視するポイントを教えてください", options: [
      "本格ピザ🍕", "こだわりパスタ🍝", "バル（お酒と一緒に）🍷", "イタリアン全般🇮🇹",
    ]},
    "中華": { key: "food_sub_choice", question: "食べたい中華料理のスタイルを教えてください", options: [
      "町中華（チャーハン・餃子）🥟", "火鍋・鍋料理🫕", "本格四川料理（麻辣）🌶️", "食べ放題🍽️",
    ]},
    "焼肉": { key: "food_sub_choice", question: "今日のお肉、予算や食べ方の希望を教えてください", options: [
      "焼肉食べ放題🍽️", "高級焼肉（黒毛和牛）🥩", "ホルモン焼き🍺", "ジンギスカン🐑",
    ]},
    // 韓国・お好み焼き・もんじゃ はサブ質問なし（スキップして次へ）
    "アジア系統": { key: "food_sub_choice", question: "どこの地域の料理やスパイスを楽しみたいですか？", options: [
      "インドネパール料理（本格スパイス）🍛", "タイ料理（トムヤムクンなど）🌿", "ベトナム料理・フォー🍜", "アジアンエスニック全般🌏",
    ]},
    "各国料理": { key: "food_sub_choice", question: "体験してみたい世界の食文化はどれですか？", options: [
      "メキシコ料理・タコス🌮", "ブラジル料理・シュラスコ🥩", "ロシア料理🥣", "他国料理🌍",
    ]},
    "ラーメン": { key: "food_sub_choice", question: "今日はどんな味のスープの気分ですか？", options: [
      "こってりラーメン（豚骨・家系）🍜", "あっさりラーメン（醤油・塩）🍜", "味噌ラーメン🍜", "つけ麺・まぜそば🍝",
    ]},
    "カフェ・スイーツ": { key: "food_sub_choice", question: "どんなカフェを探していますか？", options: [
      "スイーツカフェ（パンケーキ・ケーキ）🍰", "喫茶店・レトロカフェ☕", "流行りカフェ（インスタ映え）📸",
    ]},
  };

  // relax_place の回答（キーに部分一致）→ relax_sub_choice として動的注入される
  const RELAX_SUB_QUESTIONS_MAP: Record<string, DynamicQuestion | null> = {
    // 「自然の中」は自然サブジャンル選択(step9) + /api/nature に移行したため削除
    "カフェ": { key: "relax_sub_choice", question: "カフェでのんびり。何に癒やされたい？", options: [
      "ふかふかのソファ席でダラダラしたい🛋️", "隠れ家やレトロな非日常空間に浸りたい🏚️",
      "本を読んだり一人の世界に入り込みたい📚", "とにかく美味しい甘いもの・スイーツ🍰",
    ]},
    "絶景": null,
  };

  // relax_sub_choice の回答 → Google Places 検索キーワード
  const RELAX_SUB_KEYWORDS_MAP: Record<string, string> = {
    "海や川を眺めてボーッとしたい🌊": "海が見える 水辺 ベンチ",
    "芝生で寝転がったりピクニック気分🌿": "芝生広場 ピクニック 広い公園",
    "木漏れ日や緑の中で深呼吸したい🌲": "森林浴 自然豊か 散歩道",
    "車やベンチから景色だけ楽しみたい🚗": "景色が良い 駐車場あり 展望公園",
    "ふかふかのソファ席でダラダラしたい🛋️": "ソファ席 くつろげる ゆったり",
    "隠れ家やレトロな非日常空間に浸りたい🏚️": "隠れ家カフェ 古民家 純喫茶",
    "本を読んだり一人の世界に入り込みたい📚": "ブックカフェ 静か おひとりさま",
    "とにかく美味しい甘いもの・スイーツ🍰": "絶品スイーツ ケーキ 自家製",
  };

  const UI_EN = {
    // Step 1
    step1Title: "Age & Gender?",
    step1Subtitle: "Helps us suggest better spots. Feel free to skip.",
    step1Age: "Age group",
    step1Gender: "Gender",
    // Step 2
    step2Title: "What's your mood?",
    step2Subtitle: "Pick the one that feels closest.",
    // Step 3
    step3Title: "Who are you going with?",
    step3Subtitle: "This shapes our recommendations. You can skip.",
    // Step 4
    step4Title: "How are you getting there?",
    step4Subtitle: "Choose what works for you. You can skip.",
    // Step 5
    step5Title: "What's your budget?",
    step5Subtitle: "Drag the sliders to set a range.",
    step5Undecided: "No budget in mind (show me anything)",
    step5NoMin: "No minimum",
    step5QuickLabel: "Quick picks:",
    step5Undecided2: "Undecided",
    // Step 6
    step6Title: "How much time do you have?",
    step6Subtitle: "We'll match suggestions to your schedule. You can skip.",
    // Step 7 / 8 (dynamic fallback)
    step7Title: "What kind of vibe?",
    step7Subtitle: "Pick the atmosphere that suits you. You can skip.",
    step8Title: "What's most important?",
    step8Subtitle: "Choose your top priority. You can skip.",
    moodDetailTag: "Tell us more about your mood",
    moodDetailSub: "You can skip.",
    // Step 9
    step9Title: "Any other requests?",
    step9Subtitle: "Describe what you're looking for freely.",
    step9Placeholder: "e.g. night view, something sweet, a quiet park, ocean view...",
    // Step 10
    step10Title: "Where are you?",
    step10Subtitle: "Use your current location or type an area name.",
    step10UseLocation: "Use current location",
    step10Getting: "Getting location...",
    step10Or: "or",
    step10Placeholder: "e.g. Yokohama / Shibuya / Minato Mirai",
    step10Helper: "If location fails, just type the area name.",
    step10Search: "Skip & search →",
    step10Go: "Find my spots →",
    step10Thinking: "Thinking...",
    // Buttons
    skip: "Skip →",
    back: "Back",
    next: "Next →",
    // Results labels
    conditionTitle: "Your selections",
    conditionMood: "Mood",
    conditionArea: "Area",
    conditionWith: "With",
    conditionTransport: "Transport",
    conditionBudget: "Budget",
    conditionTime: "Time",
    conditionAtmo: "Vibe",
    conditionPriority: "Priority",
    conditionFreeWord: "Notes",
    conditionUndecided: "Undecided",
    // Home screen
    homeStart: "Start",
    homeHistory: "History",
    homeFavorites: "Favorites",
    homeSuggest: "Tell us a spot!",
    // History page
    historyTitle: "History",
    historySub: "Review your past recommendations",
    historyEmpty: "No history yet",
    historyBack: "Back",
    historyItems: " spots",
    // History detail
    historyDetailBack: "Back",
    historyDetailConditions: "Your selections",
    historyDetailRecommendations: "Recommendations",
    historyDetailNoRecs: "No recommendations recorded",
    // Favorites page
    favoritesTitle: "Favorites",
    favoritesSub: "Spots you've liked ♥",
    favoritesEmpty: "No favorites yet",
    favoritesBack: "Back",
  };

  const pageStyle = {
    minHeight: "100vh",
    background: "#ffffff",
    padding: "28px 18px",
    color: "#4a3034",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    position: "relative" as const,
    overflow: "hidden" as const,
    fontFamily:
      '"Hiragino Maru Gothic ProN", "Yu Gothic", "Hiragino Sans", sans-serif',
  };

  const shellStyle = {
    width: "100%",
    maxWidth: "720px",
    position: "relative" as const,
    zIndex: 1,
  };

  const cardStyle = {
    width: "100%",
    background: "#ffffff",
    border: "3px solid #f0d7dc",
    borderRadius: "34px",
    padding: "28px",
    boxShadow: "0 14px 34px rgba(74,48,52,0.08)",
  } as const;

  const homePanelStyle = {
    background: "#ffffff",
    borderRadius: "28px",
    border: "1px solid #f2dfe3",
    boxShadow: "0 12px 28px rgba(74,48,52,0.08)",
    padding: "22px",
  } as const;

  const primaryButtonStyle = {
    height: "52px",
    border: "none",
    borderRadius: "999px",
    background: "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)",
    color: "#ffffff",
    fontSize: "15px",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 10px 20px rgba(255, 153, 122, 0.25)",
  } as const;

  const secondaryButtonStyle = {
    height: "52px",
    borderRadius: "999px",
    border: "1px solid #ead7db",
    background: "#ffffff",
    color: "#4a3034",
    fontSize: "15px",
    fontWeight: 900,
    cursor: "pointer",
  } as const;

  const sectionPanelStyle = {
    background: "#ffffff",
    borderRadius: "28px",
    border: "1px solid #ead7db",
    padding: "20px",
    boxShadow: "0 10px 24px rgba(74,48,52,0.08)",
  } as const;

  const sectionHeaderBadgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 14px",
    borderRadius: "999px",
    border: "1px solid #ead7db",
    background: "#fff6f8",
    fontSize: "13px",
    fontWeight: 900,
    marginBottom: "14px",
  } as const;

  const listCardStyle = {
    background: "#fff",
    borderRadius: "22px",
    padding: "16px",
    border: "1px solid #ead7db",
    boxShadow: "0 8px 18px rgba(74,48,52,0.06)",
  } as const;

  const metaChipStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: "999px",
    border: "1px solid #ead7db",
    background: "#fffaf3",
    fontSize: "12px",
    fontWeight: 800,
  } as const;


  const bubbleFieldStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "16px",
    marginBottom: "24px",
    padding: "20px 0",
    alignItems: "start",
  } as const;

  const uniformBubbleStyle = {
    width: "100%",
    aspectRatio: "1 / 1",
    minHeight: "90px",
    borderRadius: "999px",
    border: "2px solid #ead7db",
    background: "#ffffff",
    color: "#4a3034",
    fontSize: "15px",
    fontWeight: 900,
    cursor: "pointer",
    padding: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    lineHeight: 1.35,
    transition: "transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease",
    boxShadow: "0 6px 18px rgba(74,48,52,0.10)",
  };

  const selectedBubbleStyle = {
    background: "linear-gradient(180deg, #fff8f2 0%, #ffe5ea 100%)",
    boxShadow: "0 0 0 5px rgba(255, 214, 223, 0.7)",
    transform: "scale(1.02)",
  };

  function normalizeRecommendations(data: any): Recommendation[] {
    const recommendationList = Array.isArray(data?.recommendations)
      ? data.recommendations
      : [];

    // HotPepperの近場グルメを先頭に挿入（お腹すいた + 近場距離のみ）
    const hotpepperRecs: Recommendation[] = Array.isArray(data?.hotpepperShops)
      ? data.hotpepperShops.map((shop: any) => ({
          title: shop.name ?? "店舗",
          vibe: shop.shopCatch || shop.genreCatch || "",
          budget: shop.budget ? `平均${shop.budget}` : "",
          time: "",
          address: shop.address ?? "",
          // Google Maps URLで正確な位置を指す（HotPepperの緯度経度を使用）
          mapUrl: shop.lat && shop.lng
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.name)}&query_place=lat+lng&center=${shop.lat},${shop.lng}`
            : (shop.url ?? ""),
          photoUrl: Array.isArray(shop.photoUrls) && shop.photoUrls.length > 0
            ? shop.photoUrls[0]
            : (shop.photoUrl ?? ""),
          photoUrls: Array.isArray(shop.photoUrls) && shop.photoUrls.length > 0
            ? shop.photoUrls
            : (shop.photoUrl ? [shop.photoUrl] : []),
          openingHoursText: shop.openText ? `営業時間: ${shop.openText}` : "",
          distanceText: "",
          durationText: "",
          openNow: true, // open=1で取得済みなので営業中
          rating: null,
          userRatingCount: null,
          reason: shop.genreCatch || shop.shopCatch || shop.genre || "",
          features: [
            shop.genre,
            shop.wifi ? "WiFiあり" : null,
            shop.privateRoom ? "個室あり" : null,
            shop.lunch ? "ランチあり" : null,
            shop.nonSmoking ? "禁煙" : null,
            shop.midnight ? "深夜営業" : null,
            shop.freeDrink ? "飲み放題" : null,
            shop.freeFood ? "食べ放題" : null,
          ].filter((f): f is string => !!f),
          isUserSpot: false,
          hasUserPhotos: false,
          userPhotoCount: 0,
          priceLevel: "",
          stationText: shop.access ?? "",
          source: "hotpepper" as const,
          hotpepperUrl: shop.url ?? "",
        }))
      : [];

    // HotPepperデータがあれば最優先で返す（お腹すいた専用: recommendationsが空でも動く）
    if (hotpepperRecs.length > 0) return hotpepperRecs;

    if (recommendationList.length > 0) {
      return recommendationList.map((item: any) => ({
        title:
          item?.title ||
          item?.name ||
          item?.displayName?.text ||
          item?.displayName ||
          "おすすめ候補",
        vibe: item?.vibe || item?.editorialSummary?.text || "",
        budget: item?.budget || "",
        time: item?.time || "",
        address:
          item?.address ||
          item?.formattedAddress ||
          item?.formatted_address ||
          item?.shortFormattedAddress ||
          item?.vicinity ||
          "",
        mapUrl: item?.mapUrl || item?.googleMapsUri || item?.url || "",
        photoUrl: item?.photoUrl || item?.photoUri || "",
        openingHoursText:
          item?.openingHoursText ||
          item?.currentOpeningHours?.weekdayDescriptions?.[0] ||
          item?.regularOpeningHours?.weekdayDescriptions?.[0] ||
          "",
        distanceText: item?.distanceText || item?.distance || "",
        durationText: item?.durationText || item?.duration || "",
        openNow:
          typeof item?.openNow === "boolean"
            ? item.openNow
            : typeof item?.currentOpeningHours?.openNow === "boolean"
            ? item.currentOpeningHours.openNow
            : undefined,
        rating:
          typeof item?.rating === "number"
            ? item.rating
            : item?.rating
            ? Number(item.rating)
            : null,
        userRatingCount:
          typeof item?.userRatingCount === "number"
            ? item.userRatingCount
            : item?.userRatingCount
            ? Number(item.userRatingCount)
            : null,
        reason: item?.reason || "",
        features: Array.isArray(item?.features) ? item.features : [],
        isUserSpot: !!item?.isUserSpot,
        hasUserPhotos: !!item?.hasUserPhotos,
        userPhotoCount: typeof item?.userPhotoCount === "number" ? item.userPhotoCount : 0,
        photoUrls: Array.isArray(item?.photoUrls) ? item.photoUrls : (item?.photoUrl ? [item.photoUrl] : []),
        priceLevel: item?.priceLevel || "",
        stationText: item?.stationText || "",
        routesByMode: Array.isArray(item?.routesByMode) ? item.routesByMode : undefined,
      }));
    }

    const resultsList = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.places)
      ? data.places
      : [];

    return resultsList.map((item: any) => ({
      title:
        item?.title ||
        item?.name ||
        item?.displayName?.text ||
        item?.displayName ||
        "おすすめ候補",
      vibe: item?.vibe || item?.editorialSummary?.text || "",
      budget: item?.budget || item?.priceLevel || "",
      time: item?.time || "",
      address:
        item?.address ||
        item?.formattedAddress ||
        item?.formatted_address ||
        item?.shortFormattedAddress ||
        item?.vicinity ||
        "",
      mapUrl: item?.mapUrl || item?.googleMapsUri || item?.url || "",
      photoUrl: item?.photoUrl || item?.photoUri || "",
      openingHoursText:
        item?.openingHoursText ||
        item?.currentOpeningHours?.weekdayDescriptions?.[0] ||
        item?.regularOpeningHours?.weekdayDescriptions?.[0] ||
        "",
      distanceText: item?.distanceText || item?.distance || "",
      durationText: item?.durationText || item?.duration || "",
      openNow:
        typeof item?.openNow === "boolean"
          ? item.openNow
          : typeof item?.currentOpeningHours?.openNow === "boolean"
          ? item.currentOpeningHours.openNow
          : undefined,
      rating:
        typeof item?.rating === "number"
          ? item.rating
          : item?.rating
          ? Number(item.rating)
          : null,
      userRatingCount:
        typeof item?.userRatingCount === "number"
          ? item.userRatingCount
          : item?.userRatingCount
          ? Number(item.userRatingCount)
          : null,
      photoUrls: Array.isArray(item?.photoUrls) ? item.photoUrls : (item?.photoUrl ? [item.photoUrl] : []),
      isUserSpot: !!item?.isUserSpot,
      hasUserPhotos: !!item?.hasUserPhotos,
      userPhotoCount: typeof item?.userPhotoCount === "number" ? item.userPhotoCount : 0,
      priceLevel: item?.priceLevel || "",
      stationText: item?.stationText || "",
      routesByMode: Array.isArray(item?.routesByMode) ? item.routesByMode : undefined,
    }));
  }

  function priceLevelLabel(priceLevel?: string): string {
    switch (priceLevel) {
      case "PRICE_LEVEL_FREE": return "無料";
      case "PRICE_LEVEL_INEXPENSIVE": return "¥ 〜1,000円程度";
      case "PRICE_LEVEL_MODERATE": return "¥¥ 1,000〜3,000円程度";
      case "PRICE_LEVEL_EXPENSIVE": return "¥¥¥ 3,000〜8,000円程度";
      case "PRICE_LEVEL_VERY_EXPENSIVE": return "¥¥¥¥ 8,000円以上";
      default: return "";
    }
  }

  function renderOptionGrid(
    options: string[],
    selectedValue: string,
    onSelect: (value: string) => void,
    displayLabels?: string[],
    hints?: string[]
  ) {
    const columns = options.length === 6 ? 3 : options.length === 3 ? 3 : 2;

    return (
      <div
        className="bubble-grid"
        style={{
          ...bubbleFieldStyle,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: "12px",
          padding: "8px 0 20px",
        }}
      >
        <style>{`
          @keyframes bubble-float {
            0%   { transform: translateY(0px) scale(1); }
            50%  { transform: translateY(-7px) scale(1.01); }
            100% { transform: translateY(0px) scale(1); }
          }
          .bubble-btn:not(.bubble-selected) {
            animation: bubble-float 3.2s ease-in-out infinite;
          }
          .bubble-btn.bubble-selected {
            animation: none;
          }
        `}</style>
        {options.map((option, i) => {
          const selected = selectedValue === option;
          const hint = hints?.[i];
          return (
            <button
              key={option}
              className={`bubble-btn${selected ? " bubble-selected" : ""}`}
              onClick={() => onSelect(option)}
              style={{
                ...uniformBubbleStyle,
                ...(selected ? selectedBubbleStyle : {}),
                border: selected ? "2.5px solid #ff8f7f" : "2px solid #ead7db",
                animationDelay: selected ? "0s" : `${(i * 0.4) % 2}s`,
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <span style={{ fontWeight: 900 }}>{displayLabels?.[i] ?? option}</span>
              {hint && (
                <span style={{ fontSize: "11px", fontWeight: 600, opacity: selected ? 0.9 : 0.55, lineHeight: 1.3 }}>
                  {hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  async function parseJsonResponse(res: Response) {
    const text = await res.text();
    const contentType = res.headers.get("content-type") || "unknown";

    try {
      return JSON.parse(text);
    } catch {
      console.error("Non-JSON response:", text);
      throw new Error(
        `API のレスポンスを JSON として読めませんでした。status=${res.status} content-type=${contentType}`
      );
    }
  }

  // 全動的質問回答をAPI送信用に構築（step固有の仮想エントリも含む）
  const buildDynamicQsForAPI = (): { question: string; answer: string }[] => {
    const qs: DynamicQuestion[] = [...dynamicQuestions];
    // お腹すいた: food_distance (step5) を先頭に仮想追加
    if (selectedMood === "お腹すいた" && dynamicAnswers["food_distance"]) {
      qs.unshift({ key: "food_distance", question: "どのくらいの距離感がいい？", options: [] });
    }
    // お腹すいた: food_sub_choice (step8) を追加（dynamicQuestionsには含まれないため別途追加）
    if (selectedMood === "お腹すいた" && dynamicAnswers["food_sub_choice"]) {
      const genreAns = dynamicAnswers["food_genre_new"] ?? "";
      const matchedGenre = Object.keys(FOOD_SUB_QUESTIONS_MAP).find(k => genreAns.includes(k));
      const subQ = matchedGenre ? FOOD_SUB_QUESTIONS_MAP[matchedGenre] : null;
      if (subQ) qs.push({ key: "food_sub_choice", question: subQ.question, options: [] });
    }
    // まったりしたい: relax_sub_choice (step8) を追加（APIキーワード付きで enriched）
    if (selectedMood === "まったりしたい" && dynamicAnswers["relax_sub_choice"]) {
      const placeAns = dynamicAnswers["relax_place"] ?? "";
      const matchedPlace = Object.keys(RELAX_SUB_QUESTIONS_MAP).find(k => placeAns.includes(k));
      const subQ = matchedPlace ? RELAX_SUB_QUESTIONS_MAP[matchedPlace] : null;
      if (subQ) qs.push({ key: "relax_sub_choice", question: subQ.question, options: [] });
    }
    return qs
      .filter(q => dynamicAnswers[q.key])
      .map(q => {
        let answer = dynamicAnswers[q.key];
        // まったりしたい: relax_sub_choice の回答にAPIキーワードを付加してOpenAIへ渡す
        if (q.key === "relax_sub_choice" && selectedMood === "まったりしたい") {
          const keywords = RELAX_SUB_KEYWORDS_MAP[answer];
          if (keywords) answer = `${answer}（検索キーワード: ${keywords}）`;
        }
        return { question: q.question, answer };
      });
  };
  const allDynamicQsForAPI = buildDynamicQsForAPI();

  const answers: Answers = {
    mood: selectedMood,
    area: selectedArea,
    age: selectedAge,
    gender: selectedGender,
    companion: selectedCompanion,
    transport: selectedTransports,
    budget,
    budgetMin: budget !== undefined ? budgetMin : undefined,
    time: selectedTime,
    atmosphere: selectedAtmosphere,
    priority: selectedPriority,
    freeWord,
    originLat,
    originLng,
    // 全回答を dynamicQs 配列として送信（route.ts の getDynamicQs が優先使用）
    dynamicQs: allDynamicQsForAPI.length > 0 ? allDynamicQsForAPI : undefined,
    // 後方互換のため先頭4件を dynamicQ1-4 にも設定
    dynamicQ1: allDynamicQsForAPI[0],
    dynamicQ2: allDynamicQsForAPI[1],
    dynamicQ3: allDynamicQsForAPI[2],
    dynamicQ4: allDynamicQsForAPI[3],
  };

  // 個人ブロック + グローバルブロック の統合セット（recommendationsより前に定義必須）
  const allBlockedSet = useMemo(
    () => new Set([...blockedPlaces, ...globallyBlockedNames]),
    [blockedPlaces, globallyBlockedNames]
  );

  // ブロックされた場所を除外
  const recommendations = apiRecommendations.filter((r) => !allBlockedSet.has(r.title) && (!filterOpenNow || r.openNow === true));

  // 交通手段アイコン（distanceText / durationText の横に表示）
  const travelIcon = (() => {
    if (selectedMood === "ドライブしたい") return "🚗";
    if (selectedMood === "遠くに行きたい") return "🚄";
    const t = selectedTransports.join(",");
    if (t.includes("電車") || t.includes("バス")) return "🚃";
    if (t.includes("車") || t.includes("バイク")) return "🚗";
    if (t.includes("自転車")) return "🚲";
    return "🚶";
  })();

  const isFavorited = (title: string) =>
    favorites.some((item) => item.title === title);

  const blockPlace = (title: string) => {
    setBlockedPlaces((prev) => prev.includes(title) ? prev : [...prev, title]);
  };

  const unblockPlace = (title: string) => {
    setBlockedPlaces((prev) => prev.filter((t) => t !== title));
  };

  // Feature 2: ソート用ヘルパー
  // 営業時間テキストを見やすく整形するヘルパー
  const formatOpeningHours = (text?: string | null): string => {
    if (!text) return "";
    // 曜日別に分割（改行 or 「月曜日:」形式）
    const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return text;

    // 全日24時間営業の判定
    const all24 = lines.length >= 7 && lines.every(l => /24\s*時間営業/.test(l));
    if (all24) return "🌙 24時間営業（年中無休）";

    // 全日同じ時間かチェック（例: 9:00〜20:00が7日共通）
    const timePattern = /[:：]\s*(.+)/;
    const times = lines.map(l => { const m = l.match(timePattern); return m ? m[1].trim() : null; });
    const allSame = times.length >= 7 && times[0] && times.every(t => t === times[0]);
    if (allSame) {
      const t = times[0]!;
      if (/24\s*時間/.test(t)) return "🌙 24時間営業（年中無休）";
      return `毎日 ${t}`;
    }

    // 平日・週末でグループ化できるか
    const weekdayKeys = ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日"];
    const weekendKeys = ["土曜日", "日曜日"];
    const getTime = (day: string) => {
      const l = lines.find(ln => ln.startsWith(day));
      const m = l?.match(timePattern);
      return m ? m[1].trim() : null;
    };
    const weekdayTimes = weekdayKeys.map(getTime);
    const weekendTimes = weekendKeys.map(getTime);
    const weekdayAllSame = weekdayTimes[0] && weekdayTimes.every(t => t === weekdayTimes[0]);
    const weekendAllSame = weekendTimes[0] && weekendTimes.every(t => t === weekendTimes[0]);
    if (weekdayAllSame && weekendAllSame && weekdayTimes[0] !== weekendTimes[0]) {
      return `平日 ${weekdayTimes[0]}\n土日 ${weekendTimes[0]}`;
    }
    if (weekdayAllSame && weekendAllSame && weekdayTimes[0] === weekendTimes[0]) {
      return `毎日 ${weekdayTimes[0]}`;
    }

    // それ以外: 曜日名を短縮して表示
    const shortMap: Record<string, string> = { "月曜日": "月", "火曜日": "火", "水曜日": "水", "木曜日": "木", "金曜日": "金", "土曜日": "土", "日曜日": "日" };
    return lines.map(l => {
      let s = l;
      Object.entries(shortMap).forEach(([full, short]) => { s = s.replace(full, short); });
      return s;
    }).join("\n");
  };

  const parseKm = (distanceInfo?: string): number => {
    if (!distanceInfo) return 9999;
    const m = distanceInfo.match(/(\d+\.?\d*)km/);
    return m ? parseFloat(m[1]) : 9999;
  };

  const sortFacilities = (facs: PlaceResponse[]): PlaceResponse[] => {
    if (sortMode === "rating") return [...facs].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sortMode === "near") return [...facs].sort((a, b) => parseKm(a.distanceInfo) - parseKm(b.distanceInfo));
    if (sortMode === "far") return [...facs].sort((a, b) => parseKm(b.distanceInfo) - parseKm(a.distanceInfo));
    return facs;
  };

  // Feature 4: シャッフル再検索（APIを再呼び出しして新しいスポットを取得）
  const [isShuffling, setIsShuffling] = useState(false);
  const reshuffleFacilities = async () => {
    setSortMode("default");

    // travel モード: Supabase → /api/travel の順で再検索
    if (travelFacilities && travelSubCategory) {
      setIsShuffling(true);
      try {
        const _sbTravel = getTravelTags(travelSubCategory);
        const sbRes = await fetch("/api/places", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mustTags: _sbTravel.tags, lat: originLat ?? 0, lng: originLng ?? 0, radiusKm: _sbTravel.radiusKm, transport: selectedTransports.length > 0 ? selectedTransports : undefined, limit: 20, preferFar: true }),
        });
        if (sbRes.ok) {
          const sbData = await sbRes.json();
          if ((sbData.data ?? []).length >= 1) {
            setTravelFacilities(sbData.data as PlaceResponse[]);
            return;
          }
        }
        // fallback: /api/travel
        const areaLabel = locationDisplayArea || selectedArea || "現在地周辺";
        const res = await fetch("/api/travel", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subCategory: travelSubCategory, lat: originLat ?? 0, lng: originLng ?? 0, areaLabel, transport: selectedTransports.length > 0 ? selectedTransports : undefined }),
        });
        if (res.ok) {
          const data = await res.json();
          setTravelFacilities([...(data.data ?? [])].sort(() => Math.random() - 0.5));
        }
      } catch (e) { console.error(e); }
      finally { setIsShuffling(false); }
      return;
    }

    // 通常モード: lastSearchParams を使って /api/places を再呼び出し
    if (!lastSearchParams) return;
    setIsShuffling(true);
    try {
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mustTags:    lastSearchParams.mustTags,
          lat:         lastSearchParams.lat,
          lng:         lastSearchParams.lng,
          radiusKm:    lastSearchParams.radiusKm,
          transport:   lastSearchParams.transport.length > 0 ? lastSearchParams.transport : undefined,
          limit:       20,
          time:        lastSearchParams.time,
          companion:   lastSearchParams.companion,
          budget:      lastSearchParams.budget,
          freeWord:    lastSearchParams.freeWord,
          minRadiusKm: lastSearchParams.minRadiusKm,
          preferFar:   lastSearchParams.preferFar,
          prefecture:  selectedPrefecture || undefined,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const freshResults = (data.data ?? []) as PlaceResponse[];
      const path = lastSearchParams.path;
      if (path === "sports")      setSportsFacilities(freshResults);
      else if (path === "focus")  setFocusFacilities(freshResults);
      else if (path === "drive")  setDriveFacilities(freshResults);
      else if (path === "nature") setNatureFacilities(freshResults);
      else if (path === "cafe")   setCafeFacilities(freshResults);
      else if (path === "waiwai") setWaiWaiFacilities(freshResults);
      else if (path === "onsen")  setOnsenFacilities(freshResults);
      if (selectedPrefecture) setPrefFilteredFacilities(freshResults);
    } catch (e) { console.error(e); }
    finally { setIsShuffling(false); }
  };

  // Feature 8: 行った！ボタン
  const toggleVisited = (title: string) => {
    setVisitedPlaces(prev => prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]);
  };

  // Feature 9: シェアボタン
  const handleShare = async () => {
    const currentResultLabel =
      randomFacilities !== null ? "今日の運命スポット" :
      travelFacilities ? (travelSubCategoryLabel || "おでかけスポット") + "の検索結果" :
      sportsFacilities ? (sportsSubCategoryLabel || "スポーツスポット") + "の検索結果" :
      focusFacilities ? (focusSubCategoryLabel || "集中スポット") + "の検索結果" :
      driveFacilities ? (driveSubCategoryLabel || "ドライブスポット") + "の検索結果" :
      waiWaiFacilities ? (waiWaiSubCategoryLabel || "わいわいスポット") + "の検索結果" :
      cafeFacilities ? (cafeSubCategoryLabel || "カフェ") + "の検索結果" :
      onsenFacilities ? (onsenCategoryLabel || "温泉・スパ") + "の検索結果" :
      natureFacilities ? (natureSubGenreLabel || "自然スポット") + "の検索結果" :
      answers.area + "でのおすすめ";
    const title = "MoodGoで見つけたスポット";
    const text = `気分で選ぶおでかけスポット - ${currentResultLabel}`;
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title, text, url }); } catch { /* ignore */ }
    } else {
      await navigator.clipboard.writeText(url);
      alert("URLをコピーしました！");
    }
  };

  const toggleFavorite = (item: Recommendation) => {
    if (isFavorited(item.title)) {
      setFavorites((prev) => prev.filter((fav) => fav.title !== item.title));
      return;
    }
    // ハートを押した場所をセッション内で追跡（admin高評価ランキング用）
    setLikedInSession((prev) => prev.includes(item.title) ? prev : [...prev, item.title]);

    setFavorites((prev) => [
      {
        title: item.title,
        area: answers.area,
        vibe: item.vibe || item.address || "おすすめスポット",
        photoUrl: item.photoUrl,
        mapUrl: item.mapUrl,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const resetAndStart = () => {
    // 全回答をリセット（前セッションの値が混入しないよう）
    setSelectedMood("");
    setSelectedCompanion("");
    setSelectedTransports([]);
    setBudget(undefined);
    setBudgetMin(0);
    setSelectedTime("");
    setSelectedAtmosphere("");
    setSelectedPriority("");
    setFreeWord("");
    setSelectedArea("");
    setLocationDisplayArea("");
    setOriginLat(undefined);
    setOriginLng(undefined);
    setDynamicQuestions([]);
    setDynamicAnswers({});
    setApiRecommendations([]);
    setApiWarning("");
    setLocationError("");
    setNatureSubGenre(null);

    setNatureFacilities(null);
    setNatureSubGenreLabel("");
    setCafeSubCategory(null);
    setCafeDetail(null);
    setCafeDetailMode(false);
    setCafeDistancePref(null);
    setCafeFacilities(null);
    setCafeSubCategoryLabel("");
    setWaiWaiSubCategory(null);
    setWaiWaiFacilities(null);
    setWaiWaiSubCategoryLabel("");
    setDriveSubCategory(null);
    setDriveFacilities(null);
    setDriveSubCategoryLabel("");
    setFocusSubCategory(null);
    setFocusFacilities(null);
    setFocusSubCategoryLabel("");
    setSportsSubCategory(null);
    setSportsFacilities(null);
    setSportsSubCategoryLabel("");
    setTravelSubCategory(null);
    setTravelFacilities(null);
    setTravelSubCategoryLabel("");
    setRandomFacilities(null);
    setHomeView("home");
    setStarted(true);
    setStep(1);
  };

  const handleUseCurrentLocation = async () => {
    if (!navigator.geolocation) {
      alert("このブラウザでは位置情報が使えません。");
      return;
    }

    setIsLocating(true);
    setLocationError("");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;

          setOriginLat(latitude);
          setOriginLng(longitude);

          // 都道府県を自動検出してフィルターボタンを設定
          const detectedPref = detectUserPrefecture(latitude, longitude);
          if (detectedPref) {
            setUserPrefecture(detectedPref);
            const neighbors = getNearbyPrefectures(detectedPref, 5);
            setPrefectureButtons([detectedPref, ...neighbors]);
          }

          const res = await fetch("/api/location-to-area", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ latitude, longitude }),
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = await parseJsonResponse(res) as any;

          if (!res.ok) {
            console.warn("エリア特定失敗:", data?.error, "Google status:", data?.googleStatus, data?.googleMessage);
            setSelectedArea("現在地周辺");
            setLocationDisplayArea("現在地周辺");
          } else {
            const raw: string = data?.formattedAddress || data?.displayArea || data?.area || "現在地周辺";
            const areaName = raw
              .replace(/^日本[、,]\s*/, "")
              .replace(/^〒\d{3}-\d{4}\s*/, "")
              .replace(/[、,]?\s*日本$/, "")
              .trim();
            setSelectedArea(areaName);
            setLocationDisplayArea(areaName);
          }
        } catch (error) {
          console.error(error);
          setSelectedArea("現在地周辺");
          setLocationDisplayArea("現在地周辺");
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        console.error(error);
        setIsLocating(false);

        if (error.code === 1) {
          setLocationError("位置情報の許可がオフです。手入力で進めてください。");
          alert("位置情報の許可がオフです。手入力で進めてください。");
        } else if (error.code === 3) {
          setLocationError("位置情報の取得がタイムアウトしました。");
          alert("位置情報の取得がタイムアウトしました。");
        } else {
          setLocationError("現在地を取得できませんでした。");
          alert("現在地を取得できませんでした。");
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      }
    );
  };

  const submitReport = async () => {
    if (!reportingSpot || !reportReason) return;
    setReportSubmitting(true);
    try {
      await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spot_name: reportingSpot.title,
          spot_address: reportingSpot.address,
          reason: reportReason,
          note: reportNote,
        }),
      });
      setReportDone(true);
    } catch {
      // エラーでも一応完了扱い
      setReportDone(true);
    } finally {
      setReportSubmitting(false);
    }
  };

  // ── transport × time → radius 計算 ─────────────────────────────────────
  function calcRadiusKm(transports: string[], time: string): number {
    const timeToMins: Record<string, number> = {
      "15〜30分": 22, "30〜60分": 45, "1〜2時間": 90,
      "2〜4時間": 180, "4〜6時間": 300, "6時間以上": 420,
    };
    const speedMap: [string, number][] = [
      ["徒歩", 4], ["自転車", 12], ["電車", 35], ["バス", 25], ["車", 60], ["バイク", 60],
    ];
    const mins = timeToMins[time] ?? 90;
    const oneWayMins = mins * 0.35; // 片道に使える時間は全体の35%
    const maxSpeed = transports.length > 0
      ? Math.max(...transports.map(t => {
          for (const [key, spd] of speedMap) { if (t.includes(key)) return spd; }
          return 40;
        }))
      : 40;
    return Math.max(3, Math.min(120, Math.round((oneWayMins / 60) * maxSpeed)));
  }

  // 車・バイク・なんでも＋長時間の場合、近場を後ろに回す最小半径
  function calcMinRadiusKm(transports: string[], time: string): number {
    const isFar = transports.some(t => ["車", "バイク", "なんでも"].includes(t));
    if (!isFar) return 0;
    if (time === "6時間以上") return 25;
    if (time === "4~6時間")   return 15;
    return 0;
  }

  // ── 時間潰したい: 近隣スポットをランダム取得 ──────────────────────────────
  const fetchRandomSpots = async () => {
    setRandomFacilities(null);
    setIsLoadingRandom(true);
    setStep(11);
    // transport × time で半径を決定
    const radiusKm = selectedTime
      ? calcRadiusKm(selectedTransports, selectedTime)
      : 15;
    setRandomRadiusKm(radiusKm);
    try {
      const res = await fetch("/api/random-spots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: originLat ?? 0,
          lng: originLng ?? 0,
          radiusKm,
          limit: 10,
          companion: selectedCompanion || null,
          budget: budget ?? null,
          freeWord: freeWord || null,
        }),
      });
      const data = await res.json();
      setRandomFacilities(data.data ?? []);
    } catch {
      setRandomFacilities([]);
    } finally {
      setIsLoadingRandom(false);
    }
  };

  const openResults = async (refineText?: string, geocodedLat?: number, geocodedLng?: number) => {
    // ジオコードで取得した座標を優先使用（setStateは非同期のためstateに反映前でも使えるよう引数で受け取る）
    const effectiveLat = geocodedLat ?? originLat;
    const effectiveLng = geocodedLng ?? originLng;
    // ── 新規検索開始時に前回の施設ステートを全クリア ──────────────────────────
    // 複数の検索結果が Step11 に混在しないようにする
    setNatureFacilities(null);
    setCafeFacilities(null);
    setOnsenFacilities(null);
    setWaiWaiFacilities(null);
    setDriveFacilities(null);
    setFocusFacilities(null);
    setSportsFacilities(null);
    setTravelFacilities(null);
    setRandomFacilities(null);
    setSelectedPrefecture("");
    setPrefFilteredFacilities(null);
    setLastSearchParams(null);
    setFilterOpenNow(false);
    setSortMode("default");

    // ── 遠くに行きたい パス: /api/travel を使う ─────────────────────────────
    const isTravelPath =
      !refineText &&
      selectedMood === "遠くに行きたい" &&
      travelSubCategory;

    if (isTravelPath) {
      try {
        setIsLoadingTravel(true);
        setTravelFacilities(null);
        const areaLabel = locationDisplayArea || selectedArea || "現在地周辺";

        // ── Supabase 優先検索 ─────────────────────────────────────────────
        const _sbTravel = getTravelTags(travelSubCategory);
        try {
          const _sbRes = await fetch("/api/places", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mustTags: _sbTravel.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbTravel.radiusKm, transport: selectedTransports.length > 0 ? selectedTransports : undefined, limit: 20, preferFar: true }),
          });
          if (_sbRes.ok) {
            const _sbData = await _sbRes.json();
            if ((_sbData.data ?? []).length >= 1) {
              setTravelFacilities(_sbData.data as PlaceResponse[]);
              setTravelSubCategoryLabel(_sbTravel.label);
              setStep(11); return;
            }
          }
        } catch { /* fallback to /api/travel */ }
        // ─────────────────────────────────────────────────────────────────

        const res = await fetch("/api/travel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subCategory: travelSubCategory,
            lat:         effectiveLat ?? 0,
            lng:         effectiveLng ?? 0,
            areaLabel,
            transport:   selectedTransports.length > 0 ? selectedTransports : undefined,
          }),
        });
        const data = await res.json();
        // 毎回違う順番になるようシャッフル（距離20km帯内でランダム）
        const rawTravel: PlaceResponse[] = data.data ?? [];
        const shuffledTravel = [...rawTravel].sort(() => Math.random() - 0.5);
        setTravelFacilities(shuffledTravel);
        setTravelSubCategoryLabel(data.subCategoryLabel ?? "");
        setStep(11);
      } catch (e) {
        console.error(e);
        alert("おでかけスポットの取得に失敗しました。");
      } finally {
        setIsLoadingTravel(false);
      }
      return;
    }

    // ── 体を動かしたい パス: /api/sports を使う ─────────────────────────────
    const isSportsPath =
      !refineText &&
      selectedMood === "体を動かしたい" &&
      sportsSubCategory;

    if (isSportsPath) {
      try {
        setIsLoadingSports(true);
        setSportsFacilities(null);
        const areaLabel = locationDisplayArea || selectedArea || "現在地周辺";

        // ── Supabase 優先検索 ─────────────────────────────────────────────
        const _sbSports = getSportsTags(sportsSubCategory);
        try {
          const _sbRes = await fetch("/api/places", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mustTags: _sbSports.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbSports.radiusKm, transport: selectedTransports.length > 0 ? selectedTransports : undefined, limit: 20, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, budgetMin, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || "") }),
          });
          if (_sbRes.ok) {
            const _sbData = await _sbRes.json();
            if ((_sbData.data ?? []).length >= 1) {
              setSportsFacilities(_sbData.data as PlaceResponse[]);
              setSportsSubCategoryLabel(_sbSports.label);
              setLastSearchParams({ mustTags: _sbSports.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbSports.radiusKm, transport: selectedTransports, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || ""), path: "sports" });
              setStep(11); return;
            }
          }
        } catch { /* fallback to /api/sports */ }
        // ─────────────────────────────────────────────────────────────────

        const res = await fetch("/api/sports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subCategory: sportsSubCategory,
            lat:         effectiveLat ?? 0,
            lng:         effectiveLng ?? 0,
            areaLabel,
            transport:   selectedTransports.length > 0 ? selectedTransports : undefined,
            time:        selectedTime || undefined,
            companion:   selectedCompanion || undefined,
            budget,
            budgetMin,
            freeWord:    freeWord || undefined,
          }),
        });
        const data = await res.json();
        setSportsFacilities(data.data ?? []);
        setSportsSubCategoryLabel(data.subCategoryLabel ?? "");
        setStep(11);
      } catch (e) {
        console.error(e);
        alert("スポーツスポットの取得に失敗しました。");
      } finally {
        setIsLoadingSports(false);
      }
      return;
    }

    // ── 集中したい パス: /api/focus を使う ──────────────────────────────────
    const isFocusPath =
      !refineText &&
      selectedMood === "集中したい" &&
      focusSubCategory;

    if (isFocusPath) {
      try {
        setIsLoadingFocus(true);
        setFocusFacilities(null);
        const areaLabel = locationDisplayArea || selectedArea || "現在地周辺";

        // ── Supabase 優先検索 ─────────────────────────────────────────────
        const _sbFocus = getFocusTags(focusSubCategory);
        try {
          const _sbRes = await fetch("/api/places", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mustTags: _sbFocus.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbFocus.radiusKm, transport: selectedTransports.length > 0 ? selectedTransports : undefined, limit: 20, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, budgetMin, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || "") }),
          });
          if (_sbRes.ok) {
            const _sbData = await _sbRes.json();
            if ((_sbData.data ?? []).length >= 1) {
              setFocusFacilities(_sbData.data as PlaceResponse[]);
              setFocusSubCategoryLabel(_sbFocus.label);
              setLastSearchParams({ mustTags: _sbFocus.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbFocus.radiusKm, transport: selectedTransports, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || ""), path: "focus" });
              setStep(11); return;
            }
          }
        } catch { /* fallback to /api/focus */ }
        // ─────────────────────────────────────────────────────────────────

        const res = await fetch("/api/focus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subCategory: focusSubCategory,
            lat:         effectiveLat ?? 0,
            lng:         effectiveLng ?? 0,
            areaLabel,
            transport:   selectedTransports.length > 0 ? selectedTransports : undefined,
            time:        selectedTime || undefined,
            companion:   selectedCompanion || undefined,
            budget,
            budgetMin,
            freeWord:    freeWord || undefined,
          }),
        });
        const data = await res.json();
        setFocusFacilities(data.data ?? []);
        setFocusSubCategoryLabel(data.subCategoryLabel ?? "");
        setStep(11);
      } catch (e) {
        console.error(e);
        alert("集中スポットの取得に失敗しました。");
      } finally {
        setIsLoadingFocus(false);
      }
      return;
    }

    // ── ドライブしたい パス: /api/drive を使う ────────────────────────────────
    const isDrivePath =
      !refineText &&
      selectedMood === "ドライブしたい" &&
      driveSubCategory;

    if (isDrivePath) {
      try {
        setIsLoadingDrive(true);
        setDriveFacilities(null);
        const areaLabel = locationDisplayArea || selectedArea || "現在地周辺";

        // ── Supabase 優先検索 ─────────────────────────────────────────────
        const _sbDrive = getDriveTags(driveSubCategory);
        try {
          const _sbRes = await fetch("/api/places", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mustTags: _sbDrive.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbDrive.radiusKm, transport: ["車"], limit: 20, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, budgetMin, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || "") }),
          });
          if (_sbRes.ok) {
            const _sbData = await _sbRes.json();
            if ((_sbData.data ?? []).length >= 1) {
              setDriveFacilities(_sbData.data as PlaceResponse[]);
              setDriveSubCategoryLabel(_sbDrive.label);
              setLastSearchParams({ mustTags: _sbDrive.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbDrive.radiusKm, transport: ["車"], time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || ""), path: "drive" });
              setStep(11); return;
            }
          }
        } catch { /* fallback to /api/drive */ }
        // ─────────────────────────────────────────────────────────────────

        const res = await fetch("/api/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subCategory: driveSubCategory,
            lat:         effectiveLat ?? 0,
            lng:         effectiveLng ?? 0,
            areaLabel,
            transport:   ["車"],
            time:        selectedTime || undefined,
            companion:   selectedCompanion || undefined,
            budget,
            budgetMin,
            freeWord:    freeWord || undefined,
          }),
        });
        const data = await res.json();
        setDriveFacilities(data.data ?? []);
        setDriveSubCategoryLabel(data.subCategoryLabel ?? "");
        setStep(11);
      } catch (e) {
        console.error(e);
        alert("ドライブスポットの取得に失敗しました。");
      } finally {
        setIsLoadingDrive(false);
      }
      return;
    }

    // ── 自然感じたい / まったりしたい+自然の中 パス: /api/nature を使う ──────
    const isNaturePath =
      !refineText &&
      (selectedMood === "自然感じたい" ||
       (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("自然の中"))) &&
      natureSubGenre;

    if (isNaturePath) {
      try {
        setIsLoadingNature(true);
        setNatureFacilities(null);
        const areaLabel = locationDisplayArea || selectedArea || "現在地周辺";

        // ── Supabase 優先検索 ─────────────────────────────────────────────
        const _fromRelax = selectedMood === "まったりしたい";
        const _sbNature = getNatureTags(natureSubGenre, _fromRelax);
        try {
          const _sbRes = await fetch("/api/places", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mustTags: _sbNature.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbNature.radiusKm, transport: selectedTransports.length > 0 ? selectedTransports : undefined, limit: 20, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, budgetMin, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || "") }),
          });
          if (_sbRes.ok) {
            const _sbData = await _sbRes.json();
            if ((_sbData.data ?? []).length >= 1) {
              setNatureFacilities(_sbData.data as PlaceResponse[]);
              setNatureSubGenreLabel(_sbNature.label);
              setLastSearchParams({ mustTags: _sbNature.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbNature.radiusKm, transport: selectedTransports, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || ""), path: "nature" });
              setStep(11); return;
            }
          }
        } catch { /* fallback to /api/nature */ }
        // ─────────────────────────────────────────────────────────────────

        const res = await fetch("/api/nature", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subGenre:      natureSubGenre,
            lat:           effectiveLat ?? 0,
            lng:           effectiveLng ?? 0,
            areaLabel,
            transport:     selectedTransports.length > 0 ? selectedTransports : undefined,
            time:          selectedTime || undefined,
            companion:     selectedCompanion || undefined,
            budget,
            budgetMin,
            freeWord:      freeWord || undefined,
          }),
        });
        const data = await res.json();
        setNatureFacilities(data.data ?? []);
        setNatureSubGenreLabel(data.subGenreLabel ?? "");
        setStep(11);
      } catch (e) {
        console.error(e);
        alert("自然スポットの取得に失敗しました。");
      } finally {
        setIsLoadingNature(false);
      }
      return;
    }

    // ── カフェ パス: /api/cafe を使う ─────────────────────────────────────
    const isCafePath =
      !refineText &&
      selectedMood === "まったりしたい" &&
      (dynamicAnswers["relax_place"] ?? "").includes("カフェ") &&
      cafeSubCategory;

    if (isCafePath) {
      try {
        setIsLoadingCafe(true);
        setCafeFacilities(null);
        const areaLabel = locationDisplayArea || selectedArea || "現在地周辺";

        // ── Supabase 優先検索 ─────────────────────────────────────────────
        const _sbCafe = getCafeTags(cafeSubCategory, cafeDetail);
        try {
          const _sbRes = await fetch("/api/places", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mustTags: _sbCafe.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbCafe.radiusKm, transport: selectedTransports.length > 0 ? selectedTransports : undefined, limit: 20, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, budgetMin, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || "") }),
          });
          if (_sbRes.ok) {
            const _sbData = await _sbRes.json();
            if ((_sbData.data ?? []).length >= 1) {
              setCafeFacilities(_sbData.data as PlaceResponse[]);
              setCafeSubCategoryLabel(_sbCafe.label);
              setLastSearchParams({ mustTags: _sbCafe.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbCafe.radiusKm, transport: selectedTransports, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || ""), path: "cafe" });
              setStep(11); return;
            }
          }
        } catch { /* fallback to /api/cafe */ }
        // ─────────────────────────────────────────────────────────────────

        const res = await fetch("/api/cafe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subCategory:  cafeSubCategory,
            detail:       cafeDetail ?? undefined,
            lat:          effectiveLat ?? 0,
            lng:          effectiveLng ?? 0,
            areaLabel,
            transport:    selectedTransports.length > 0 ? selectedTransports : undefined,
            distancePref: cafeDistancePref ?? undefined,
            time:         selectedTime || undefined,
            companion:    selectedCompanion || undefined,
            budget,
            budgetMin,
            freeWord:     freeWord || undefined,
          }),
        });
        const data = await res.json();
        setCafeFacilities(data.data ?? []);
        setCafeSubCategoryLabel(data.subCategoryLabel ?? "");
        setStep(11);
      } catch (e) {
        console.error(e);
        alert("カフェ情報の取得に失敗しました。");
      } finally {
        setIsLoadingCafe(false);
      }
      return;
    }

    // ── わいわい楽しみたい パス: /api/waiwai を使う ──────────────────────────
    const isWaiWaiPath =
      !refineText &&
      selectedMood === "わいわい楽しみたい" &&
      waiWaiSubCategory;

    if (isWaiWaiPath) {
      try {
        setIsLoadingWaiWai(true);
        setWaiWaiFacilities(null);
        const areaLabel = locationDisplayArea || selectedArea || "現在地周辺";

        // ── Supabase 優先検索 ─────────────────────────────────────────────
        const _sbWaiWai = getWaiWaiTags(waiWaiSubCategory);
        try {
          const _sbRes = await fetch("/api/places", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mustTags: _sbWaiWai.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbWaiWai.radiusKm, transport: selectedTransports.length > 0 ? selectedTransports : undefined, limit: 20, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, budgetMin, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || "") }),
          });
          if (_sbRes.ok) {
            const _sbData = await _sbRes.json();
            if ((_sbData.data ?? []).length >= 1) {
              setWaiWaiFacilities(_sbData.data as PlaceResponse[]);
              setWaiWaiSubCategoryLabel(_sbWaiWai.label);
              setLastSearchParams({ mustTags: _sbWaiWai.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbWaiWai.radiusKm, transport: selectedTransports, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || ""), path: "waiwai" });
              setStep(11); return;
            }
          }
        } catch { /* fallback to /api/waiwai */ }
        // ─────────────────────────────────────────────────────────────────

        const res = await fetch("/api/waiwai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subCategory: waiWaiSubCategory,
            lat:         effectiveLat ?? 0,
            lng:         effectiveLng ?? 0,
            areaLabel,
            transport:   selectedTransports.length > 0 ? selectedTransports : undefined,
            age:         selectedAge || undefined,
            time:        selectedTime || undefined,
            companion:   selectedCompanion || undefined,
            budget,
            budgetMin,
            freeWord:    freeWord || undefined,
          }),
        });
        const data = await res.json();
        setWaiWaiFacilities(data.data ?? []);
        setWaiWaiSubCategoryLabel(data.subCategoryLabel ?? "");
        setStep(11);
      } catch (e) {
        console.error(e);
        alert("わいわいスポットの取得に失敗しました。");
      } finally {
        setIsLoadingWaiWai(false);
      }
      return;
    }

    // ── 温泉・スパ パス: /api/onsen を使う ──────────────────────────────────
    const isOnsenPath =
      !refineText &&
      selectedMood === "まったりしたい" &&
      (dynamicAnswers["relax_place"] ?? "").includes("温泉") &&
      onsenCategory;

    if (isOnsenPath) {
      try {
        setIsLoadingOnsen(true);
        setOnsenFacilities(null);
        const areaLabel = locationDisplayArea || selectedArea || "現在地周辺";

        // ── Supabase 優先検索 ─────────────────────────────────────────────
        const _sbOnsen = getOnsenTags(onsenCategory);
        try {
          const _sbRes = await fetch("/api/places", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mustTags: _sbOnsen.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbOnsen.radiusKm, transport: selectedTransports.length > 0 ? selectedTransports : undefined, limit: 20, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, budgetMin, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || "") }),
          });
          if (_sbRes.ok) {
            const _sbData = await _sbRes.json();
            if ((_sbData.data ?? []).length >= 1) {
              setOnsenFacilities(_sbData.data as PlaceResponse[]);
              setOnsenCategoryLabel(_sbOnsen.label);
              setLastSearchParams({ mustTags: _sbOnsen.tags, lat: effectiveLat ?? 0, lng: effectiveLng ?? 0, radiusKm: _sbOnsen.radiusKm, transport: selectedTransports, time: selectedTime || undefined, companion: selectedCompanion || undefined, budget, freeWord: freeWord || undefined, minRadiusKm: calcMinRadiusKm(selectedTransports, selectedTime || ""), path: "onsen" });
              setStep(11); return;
            }
          }
        } catch { /* fallback to /api/onsen */ }
        // ─────────────────────────────────────────────────────────────────

        const res = await fetch("/api/onsen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: onsenCategory,
            lat: effectiveLat ?? 0,
            lng: effectiveLng ?? 0,
            areaLabel,
            transport: selectedTransports.length > 0 ? selectedTransports : undefined,
            time: selectedTime || undefined,
            companion: answers.companion || undefined,
            budget: answers.budget,
            freeWord: freeWord || undefined,
          }),
        });
        const data = await res.json();
        // 新APIレスポンス: { data: PlaceResponse[] }
        setOnsenFacilities(data.data ?? []);
        setOnsenCategoryLabel(data.categoryLabel ?? "");
        setStep(11);
      } catch (e) {
        console.error(e);
        alert("温泉情報の取得に失敗しました。");
      } finally {
        setIsLoadingOnsen(false);
      }
      return;
    }
    // ── 通常パス ─────────────────────────────────────────────────────────────
    try {
      setIsLoadingRecommendations(true);
      if (refineText) setIsRefining(true);
      setApiWarning("");
      // step10のまま全画面ローディングオーバーレイを表示（setStep(11)はAPI完了後）
      if (!refineText) setApiRecommendations([]);

      // 訪問済み・閲覧済みスポットを収集
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

      const refinedAnswers = {
        ...(refineText
          ? { ...answers, freeWord: [answers.freeWord, refineText].filter(Boolean).join(" / ") }
          : answers),
        // ジオコードで取得した座標を優先使用（setStateは非同期のためstateより引数を優先）
        originLat: effectiveLat,
        originLng: effectiveLng,
      };

      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: refinedAnswers,
          pastFeedback: pastFeedback.slice(0, 5),
          seenPlaces: [...seenSet],
          showUnseenOnly,
          refinementText: refineText ?? "",
          userPreferenceHints: userPreferences,
        }),
      });

      const data = await parseJsonResponse(res);

      if (!res.ok) {
        throw new Error(data?.detail || data?.error || "おすすめ取得に失敗しました。");
      }

      const normalizedRecommendations = normalizeRecommendations(data);
      setApiRecommendations(normalizedRecommendations);
      setApiWarning(data?.warning || "");

      const topRecommendation =
        normalizedRecommendations?.[0]?.title ?? "おすすめ候補";

      const newHistoryItem: HistoryItem = {
        id: `${Date.now()}`,
        mood: answers.mood,
        area: answers.area,
        companion: answers.companion,
        transport: answers.transport,
        budget: answers.budget ?? 0,
        time: answers.time,
        atmosphere: answers.atmosphere,
        priority: answers.priority,
        freeWord: answers.freeWord,
        topRecommendation,
        createdAt: new Date().toISOString(),
        recommendations: normalizedRecommendations,
        savedAnswers: { ...answers },
      };

      setHistory((prev) => [newHistoryItem, ...prev].slice(0, 30));
      setFeedbackRating(null);
      setFeedbackVisitedPlace("");
      setFeedbackSubmitted(false);
      setPlaceRatings({});
      setStep(11);
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : "おすすめの取得に失敗しました。"
      );
    } finally {
      setIsLoadingRecommendations(false);
      setIsRefining(false);
    }
  };

  // 都道府県フィルターを適用して再検索する
  const handlePrefectureFilter = async (pref: string) => {
    setSelectedPrefecture(pref);
    setPrefFilteredFacilities(null);
    setIsLoadingPrefFilter(true);

    try {
      // ── travel モード: Supabase で再検索（県指定） ──────────────────────
      if (travelFacilities && travelSubCategory) {
        const _sbTravel = getTravelTags(travelSubCategory);
        const res = await fetch("/api/places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mustTags:  _sbTravel.tags,
            lat:       originLat ?? 0,
            lng:       originLng ?? 0,
            radiusKm:  300,       // 広めに取って県フィルターで絞る
            limit:     20,
            preferFar: true,
            prefecture: pref,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setPrefFilteredFacilities((data.data ?? []) as PlaceResponse[]);
        } else {
          setPrefFilteredFacilities([]);
        }
        return;
      }

      // ── 通常モード ───────────────────────────────────────────────────
      if (!lastSearchParams) { setPrefFilteredFacilities([]); return; }
      const body: Record<string, unknown> = {
        mustTags:    lastSearchParams.mustTags,
        lat:         lastSearchParams.lat,
        lng:         lastSearchParams.lng,
        radiusKm:    lastSearchParams.radiusKm,
        transport:   lastSearchParams.transport.length > 0 ? lastSearchParams.transport : undefined,
        limit:       20,
        time:        lastSearchParams.time,
        companion:   lastSearchParams.companion,
        budget:      lastSearchParams.budget,
        freeWord:    lastSearchParams.freeWord,
        minRadiusKm: lastSearchParams.minRadiusKm,
        preferFar:   lastSearchParams.preferFar,
        prefecture:  pref,
      };
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setPrefFilteredFacilities((data.data ?? []) as PlaceResponse[]);
      }
    } catch (e) {
      console.error("[prefecture filter]", e);
      setPrefFilteredFacilities([]);
    } finally {
      setIsLoadingPrefFilter(false);
    }
  };

  // カードを英語に翻訳する
  const translateCard = async (item: Recommendation) => {
    const key = item.title;
    if (showEnglish[key]) {
      // 既に翻訳済みなら表示トグルだけ
      setShowEnglish((prev) => ({ ...prev, [key]: false }));
      return;
    }
    if (translatedCards[key]) {
      // キャッシュあり
      setShowEnglish((prev) => ({ ...prev, [key]: true }));
      return;
    }
    setTranslatingCards((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title,
          reason: item.reason ?? "",
          vibe: item.vibe ?? "",
          features: item.features ?? [],
          stationText: item.stationText ?? "",
          openingHoursText: item.openingHoursText ?? "",
        }),
      });
      const data = await res.json();
      if (data.ok && data.translated) {
        setTranslatedCards((prev) => ({ ...prev, [key]: data.translated }));
        setShowEnglish((prev) => ({ ...prev, [key]: true }));
      }
    } catch {}
    setTranslatingCards((prev) => ({ ...prev, [key]: false }));
  };

  // 各スポットへの個別評価（👍/👎）を送信してAIに学習させる
  const submitPlaceRating = (placeTitle: string, verdict: "good" | "bad") => {
    setPlaceRatings((prev) => ({ ...prev, [placeTitle]: verdict }));

    const rating = verdict === "good" ? 5 : 1;
    const newFeedback: FeedbackItem = {
      id: `place-${Date.now()}`,
      answers: {
        mood: answers.mood,
        area: answers.area,
        age: answers.age,
        gender: answers.gender,
        companion: answers.companion,
        transport: answers.transport,
        atmosphere: answers.atmosphere,
        priority: answers.priority,
        freeWord: answers.freeWord,
        dynamicQ1: answers.dynamicQ1,
        dynamicQ2: answers.dynamicQ2,
        dynamicQ3: answers.dynamicQ3,
        dynamicQ4: answers.dynamicQ4,
      },
      topRecommendations: recommendations.slice(0, 3).map((r) => r.title),
      rating,
      visitedPlace: placeTitle,
      createdAt: new Date().toISOString(),
    };

    // localStorageに保存（同一端末での即時反映）
    const updated = [newFeedback, ...pastFeedback].slice(0, 50);
    setPastFeedback(updated);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FEEDBACK_KEY, JSON.stringify(updated));
    }

    // Supabaseに送信（AIの学習データとして蓄積）
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mood: answers.mood,
        area: answers.area,
        age: answers.age,
        gender: answers.gender,
        companion: answers.companion,
        atmosphere: answers.atmosphere,
        priority: answers.priority,
        topRecommendations: recommendations.slice(0, 3).map((r) => r.title),
        rating,
        visitedPlace: placeTitle,
        likedPlaces: verdict === "good" ? [placeTitle] : [],
        mapClickedPlaces: [],
      }),
    }).catch(() => {});
  };

  const userPreferences = useMemo(() => {
    if (pastFeedback.length < 2) return [];
    const tags: Record<string, number> = {};
    for (const f of pastFeedback) {
      const mood = f.answers.mood ?? "";
      const companion = f.answers.companion ?? "";
      const weight = (f.rating ?? 3) >= 4 ? 2 : (f.rating ?? 3) <= 2 ? -1 : 1;
      if (mood === "まったりしたい") tags["まったり派😌"] = (tags["まったり派😌"] ?? 0) + weight;
      if (mood === "お腹すいた") tags["グルメ好き🍜"] = (tags["グルメ好き🍜"] ?? 0) + weight;
      if (mood === "体を動かしたい") tags["アクティブ派🏃"] = (tags["アクティブ派🏃"] ?? 0) + weight;
      if (mood === "ドライブしたい") tags["ドライブ好き🚗"] = (tags["ドライブ好き🚗"] ?? 0) + weight;
      if (mood === "集中したい") tags["作業派📚"] = (tags["作業派📚"] ?? 0) + weight;
      if (mood === "遠くに行きたい") tags["お出かけ好き✈️"] = (tags["お出かけ好き✈️"] ?? 0) + weight;
      if (mood === "わいわい楽しみたい") tags["わいわい派🎉"] = (tags["わいわい派🎉"] ?? 0) + weight;
      if (mood === "自然感じたい") tags["自然好き🍀"] = (tags["自然好き🍀"] ?? 0) + weight;
      if (companion === "一人") tags["ソロ派🧍"] = (tags["ソロ派🧍"] ?? 0) + weight;
      if (companion === "恋人") tags["デート好き💑"] = (tags["デート好き💑"] ?? 0) + weight;
      if (companion === "家族") tags["家族重視👨‍👩‍👧"] = (tags["家族重視👨‍👩‍👧"] ?? 0) + weight;
    }
    return Object.entries(tags)
      .filter(([, score]) => score > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([tag]) => tag);
  }, [pastFeedback]);

  const latestHistory = useMemo(() => history, [history]);
  const sortedFavorites = useMemo(() => {
    return [...favorites].sort((a, b) => {
      if (favoriteSort === "title") {
        return a.title.localeCompare(b.title, "ja");
      }
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
  }, [favorites, favoriteSort]);

  const resultCardStyle = {
    background: "#ffffff",
    borderRadius: "30px",
    overflow: "hidden",
    border: "1px solid #f0dfe3",
    boxShadow: "0 14px 30px rgba(74,48,52,0.08)",
    position: "relative" as const,
  };

  const chipStyle = {
    padding: "8px 12px",
    borderRadius: "999px",
    background: "#fff7f8",
    border: "1px solid #f0d7dc",
    fontSize: "12px",
    fontWeight: 800,
  } as const;

  // OPEN NOW COLOR PATCH
  const getOpeningChipStyle = (openNow?: boolean) => {
    if (openNow === true) {
      return {
        ...chipStyle,
        background: "#e9f8ef",
        border: "1px solid #bfe7cc",
        color: "#18794e",
      } as const;
    }

    if (openNow === false) {
      return {
        ...chipStyle,
        background: "#f3f4f6",
        border: "1px solid #d9dde3",
        color: "#6b7280",
      } as const;
    }

    return chipStyle;
  };

  const infoLineStyle = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "14px",
    color: "#6c565a",
    lineHeight: 1.6,
  } as const;

  // ── プロフィール設定オンボーディング ──────────────────────────────────────────
  const renderProfileSetup = (isEdit = false) => {
    const GENDER_OPTIONS = [
      { key: "男性",        label: "男性",         en: "Male",             icon: "👨" },
      { key: "女性",        label: "女性",         en: "Female",           icon: "👩" },
      { key: "ノンバイナリー", label: "ノンバイナリー", en: "Non-binary",      icon: "🧑" },
      { key: "その他",      label: "その他",        en: "Other",            icon: "✨" },
      { key: "答えない",    label: "答えない",       en: "Prefer not to say", icon: "🔒" },
    ];
    const AGE_OPTIONS = [
      { key: "10代", label: "10代", en: "Teens" },
      { key: "20代", label: "20代", en: "20s" },
      { key: "30代", label: "30代", en: "30s" },
      { key: "40代以上", label: "40代〜", en: "40s+" },
    ];
    const canSave = profileAge !== "" && profileGender !== "";
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 8000,
        background: "linear-gradient(160deg, #fff5f7 0%, #ffeaf0 50%, #f5eeff 100%)",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "24px",
        overflowY: "auto",
      }}>
        <div style={{ maxWidth: "420px", width: "100%" }}>
          {/* ロゴ */}
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div style={{ fontSize: "42px", fontWeight: 900, letterSpacing: "-0.04em", color: "#4a3034" }}>
              MoodGo
            </div>
            <div style={{ fontSize: "14px", color: "#b07080", fontWeight: 700, marginTop: "4px" }}>
              {isEdit ? "プロフィールを編集" : "はじめる前に少し教えてください 👋"}
            </div>
          </div>

          {/* 年齢 */}
          <div style={{ marginBottom: "28px" }}>
            <div style={{ fontSize: "15px", fontWeight: 900, color: "#4a3034", marginBottom: "12px" }}>
              📅 年齢
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
              {AGE_OPTIONS.map((a) => (
                <button
                  key={a.key}
                  onClick={() => { setProfileAge(a.key); setSelectedAge(a.key); }}
                  style={{
                    height: "52px",
                    borderRadius: "16px",
                    border: profileAge === a.key ? "2.5px solid #ff6b8a" : "2px solid #f0dfe3",
                    background: profileAge === a.key
                      ? "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)"
                      : "#fff",
                    color: profileAge === a.key ? "#fff" : "#4a3034",
                    fontSize: "14px",
                    fontWeight: 900,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s",
                    boxShadow: profileAge === a.key ? "0 4px 12px rgba(255,107,138,0.3)" : "0 2px 6px rgba(74,48,52,0.06)",
                  }}
                >
                  {lang === "en" ? a.en : a.label}
                </button>
              ))}
            </div>
          </div>

          {/* 性別 */}
          <div style={{ marginBottom: "36px" }}>
            <div style={{ fontSize: "15px", fontWeight: 900, color: "#4a3034", marginBottom: "12px" }}>
              🪪 性別
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {GENDER_OPTIONS.map((g) => (
                <button
                  key={g.key}
                  onClick={() => { setProfileGender(g.key); setSelectedGender(g.key); }}
                  style={{
                    height: "58px",
                    borderRadius: "16px",
                    border: profileGender === g.key ? "2.5px solid #a78bfa" : "2px solid #f0dfe3",
                    background: profileGender === g.key
                      ? "linear-gradient(135deg, #c084fc 0%, #818cf8 100%)"
                      : "#fff",
                    color: profileGender === g.key ? "#fff" : "#4a3034",
                    fontSize: "13px",
                    fontWeight: 900,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s",
                    boxShadow: profileGender === g.key ? "0 4px 12px rgba(167,139,250,0.35)" : "0 2px 6px rgba(74,48,52,0.06)",
                    gridColumn: g.key === "答えない" ? "1 / -1" : undefined,
                  }}
                >
                  <span style={{ fontSize: "18px" }}>{g.icon}</span>
                  {lang === "en" ? g.en : g.label}
                </button>
              ))}
            </div>
          </div>

          {/* ボタン */}
          <button
            onClick={() => {
              if (canSave) {
                saveProfile(profileAge, profileGender);
                setShowProfileEdit(false);
              }
            }}
            disabled={!canSave}
            style={{
              width: "100%", height: "56px", borderRadius: "999px", border: "none",
              background: canSave
                ? "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)"
                : "#e8dfe0",
              color: canSave ? "#fff" : "#bba8aa",
              fontSize: "17px", fontWeight: 900, cursor: canSave ? "pointer" : "default",
              boxShadow: canSave ? "0 8px 24px rgba(255,143,127,0.35)" : "none",
              marginBottom: "14px",
              transition: "all 0.2s",
            }}
          >
            {isEdit ? "保存する ✓" : "MoodGo をはじめる 🚀"}
          </button>

          {!isEdit && (
            <button
              onClick={() => { setProfileSetupDone(true); }}
              style={{
                width: "100%", height: "44px", borderRadius: "999px",
                border: "1.5px solid #d0bfc2", background: "transparent",
                color: "#9b7b82", fontSize: "14px", fontWeight: 700, cursor: "pointer",
              }}
            >
              スキップ（後で設定する）
            </button>
          )}
          {isEdit && (
            <button
              onClick={() => setShowProfileEdit(false)}
              style={{
                width: "100%", height: "44px", borderRadius: "999px",
                border: "1.5px solid #d0bfc2", background: "transparent",
                color: "#9b7b82", fontSize: "14px", fontWeight: 700, cursor: "pointer",
              }}
            >
              キャンセル
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderHome = () => {
    return (
      <div
        style={{
          display: "grid",
          gap: "18px",
        }}
      >
        <div
          style={{
            ...homePanelStyle,
            padding: "20px 20px 24px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: "520px",
              margin: "0 auto 18px",
            }}
          >
            <img
              src={heroSrc}
              alt="MoodGo home visual"
              onError={() => setHeroSrc("/brain-home.png")}
              style={{
                width: "100%",
                display: "block",
                borderRadius: "26px",
                objectFit: "cover",
              }}
            />

            <button
              type="button"
              onClick={resetAndStart}
              style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                bottom: "19%",
                width: "62%",
                height: "11.5%",
                borderRadius: "999px",
                border: "none",
                background: "linear-gradient(135deg, #f7c7d3 0%, #f2a8bb 100%)",
                color: "#ffffff",
                fontSize: "20px",
                fontWeight: 900,
                boxShadow: "0 12px 22px rgba(242, 168, 187, 0.34)",
                cursor: "pointer",
                zIndex: 10,
              }}
            >
              {lang === "en" ? UI_EN.homeStart : "はじめる"}
            </button>

            {/* ─── 下部 3ボタン ─── */}
            <div style={{
              position: "absolute",
              bottom: "5%",
              left: "3%",
              right: "3%",
              display: "flex",
              gap: "3%",
              zIndex: 10,
            }}>
              {/* 履歴 */}
              <button
                type="button"
                onClick={() => setHomeView("history")}
                style={{
                  flex: 1,
                  padding: "0",
                  height: "64px",
                  borderRadius: "20px",
                  border: "none",
                  background: "linear-gradient(135deg, #ffca7d 0%, #ff9f57 100%)",
                  color: "#ffffff",
                  fontWeight: 900,
                  boxShadow: "0 8px 16px rgba(255, 161, 87, 0.28)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "2px",
                }}
              >
                <img src="/icons/clock.svg" alt="履歴" style={{ width: "28px", height: "28px", objectFit: "contain" }} />
                <span style={{ fontSize: "11px" }}>{lang === "en" ? "History" : "履歴"}</span>
              </button>

              {/* 特集 */}
              <button
                type="button"
                onClick={() => { setHomeView("featured"); loadFeaturedList(); }}
                style={{
                  flex: 1,
                  padding: "0",
                  height: "64px",
                  borderRadius: "20px",
                  border: "none",
                  background: "linear-gradient(135deg, #ffe066 0%, #ffb347 100%)",
                  color: "#ffffff",
                  fontWeight: 900,
                  boxShadow: "0 8px 16px rgba(255, 179, 71, 0.28)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "2px",
                }}
              >
                <img src="/icons/star.svg" alt="特集" style={{ width: "28px", height: "28px", objectFit: "contain" }} />
                <span style={{ fontSize: "11px" }}>{lang === "en" ? "Featured" : "特集"}</span>
              </button>

              {/* お気に入り */}
              <button
                type="button"
                onClick={() => setHomeView("favorites")}
                style={{
                  flex: 1,
                  padding: "0",
                  height: "64px",
                  borderRadius: "20px",
                  border: "none",
                  background: "linear-gradient(135deg, #ffb8c6 0%, #ff879f 100%)",
                  color: "#ffffff",
                  fontWeight: 900,
                  boxShadow: "0 8px 16px rgba(255, 135, 159, 0.25)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "2px",
                }}
              >
                <img src="/icons/heart.svg" alt="お気に入り" style={{ width: "28px", height: "28px", objectFit: "contain" }} />
                <span style={{ fontSize: "11px" }}>{lang === "en" ? "Favorites" : "お気に入り"}</span>
              </button>
            </div>

            {/* プロフィールバッジ（右上・言語ボタンの上） */}
            {profileSetupDone && profileAge && (
              <button
                type="button"
                onClick={() => setShowProfileEdit(true)}
                style={{
                  position: "absolute",
                  top: "calc(8% + 42px)",
                  right: "4%",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  background: "rgba(255,255,255,0.88)",
                  color: "#4a3034",
                  fontSize: "11px",
                  fontWeight: 900,
                  border: "1.5px solid rgba(255,255,255,0.7)",
                  boxShadow: "0 3px 10px rgba(74,48,52,0.12)",
                  cursor: "pointer",
                  zIndex: 20,
                }}
              >
                👤 {profileAge}
              </button>
            )}

            {/* 言語切替ボタン（右上） */}
            <button
              type="button"
              onClick={() => setLang(lang === "ja" ? "en" : "ja")}
              style={{
                position: "absolute",
                top: "8%",
                right: "4%",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "6px 12px",
                borderRadius: "999px",
                background: lang === "en" ? "#4184ff" : "rgba(255,255,255,0.92)",
                color: lang === "en" ? "#fff" : "#4a3034",
                fontSize: "12px",
                fontWeight: 900,
                border: "1.5px solid rgba(255,255,255,0.7)",
                boxShadow: "0 4px 14px rgba(74,48,52,0.18)",
                cursor: "pointer",
                zIndex: 20,
              }}
            >
              🌐 {lang === "en" ? "EN" : "JP"}
            </button>

            {/* 穴場投稿ボタン（左上・アニメーション付き） */}
            <a
              href="/suggest"
              style={{
                position: "absolute",
                top: "8%",
                left: "4%",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "999px",
                background: "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)",
                color: "#4a3034",
                fontSize: "12px",
                fontWeight: 900,
                textDecoration: "none",
                boxShadow: "0 4px 14px rgba(74,48,52,0.18)",
                zIndex: 20,
                animation: "pulse-suggest 2s ease-in-out infinite",
                border: "1.5px solid rgba(255,255,255,0.7)",
              }}
            >
              <span style={{ fontSize: "16px" }}>📍</span>
              <span>{lang === "en" ? UI_EN.homeSuggest : "穴場を教えて！"}</span>
            </a>
            <style>{`
              @keyframes pulse-suggest {
                0%, 100% { transform: scale(1); box-shadow: 0 4px 14px rgba(74,48,52,0.18); }
                50% { transform: scale(1.06); box-shadow: 0 6px 20px rgba(74,48,52,0.28); }
              }
            `}</style>
          </div>
        </div>
      </div>
    );
  };

  const renderHistoryPage = () => {
    return (
      <div style={{ display: "grid", gap: "18px" }}>
        <div className="home-panel" style={{ ...homePanelStyle, padding: "22px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              marginBottom: "16px",
            }}
          >
            <div>
              <div style={{ fontWeight: 900, fontSize: "24px", marginBottom: "4px" }}>
                {lang === "en" ? UI_EN.historyTitle : "履歴"}
              </div>
              <div style={{ fontSize: "14px", opacity: 0.72 }}>
                {lang === "en" ? UI_EN.historySub : "これまで見たおすすめをチェック"}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setHomeView("home")}
              style={{
                ...secondaryButtonStyle,
                minWidth: "110px",
                height: "44px",
                fontSize: "14px",
              }}
            >
              {lang === "en" ? UI_EN.historyBack : "戻る"}
            </button>
          </div>

          {latestHistory.length === 0 ? (
            <div
              style={{
                background: "#fffaf8",
                borderRadius: "18px",
                padding: "18px",
                border: "1px solid #f2dfe3",
                fontSize: "14px",
                opacity: 0.82,
              }}
            >
              {lang === "en" ? UI_EN.historyEmpty : "まだ履歴はありません"}
            </div>
          ) : (
            <div style={{ display: "grid", gap: "12px" }}>
              {latestHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedHistoryItem(item)}
                  style={{
                    background: "#fffaf8",
                    borderRadius: "20px",
                    padding: "16px",
                    border: "1px solid #f2dfe3",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                    transition: "box-shadow 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "6px", color: "#4a3034" }}>
                        {item.topRecommendation}
                      </div>
                      <div style={{ fontSize: "13px", opacity: 0.78, lineHeight: 1.8 }}>
                        {item.mood}　{item.area}　{item.companion}
                      </div>
                      {item.createdAt && (
                        <div style={{ fontSize: "11px", opacity: 0.5, marginTop: "4px" }}>
                          {new Date(item.createdAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                      {item.recommendations && item.recommendations.length > 0 && (
                        <span style={{ fontSize: "11px", background: "#fff0f4", color: "#c0385a", borderRadius: "999px", padding: "3px 8px", fontWeight: 700, border: "1px solid #f2c0cb" }}>
                          {item.recommendations.length}{lang === "en" ? " spots" : "件"}
                        </span>
                      )}
                      <span style={{ fontSize: "18px", opacity: 0.4 }}>›</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderHistoryDetail = (item: HistoryItem) => {
    const recs = item.recommendations ?? [];
    const sa = item.savedAnswers ?? {};
    const dateStr = item.createdAt
      ? new Date(item.createdAt).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "";
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0,0,0,0.55)",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
        } as React.CSSProperties}
        onClick={(e) => { if (e.target === e.currentTarget) setSelectedHistoryItem(null); }}
      >
        <div
          style={{
            background: "#fff9f7",
            borderRadius: "28px 28px 0 0",
            minHeight: "100dvh",
            padding: "0 0 40px",
            maxWidth: "480px",
            margin: "0 auto",
            marginTop: "40px",
          }}
        >
          {/* ヘッダー */}
          <div style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "#fff9f7",
            padding: "16px 18px 12px",
            borderBottom: "1px solid #f0dfe3",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}>
            <button
              type="button"
              onClick={() => setSelectedHistoryItem(null)}
              style={{
                width: "40px", height: "40px", borderRadius: "999px",
                border: "1.5px solid #ead7db", background: "#fff",
                fontSize: "20px", cursor: "pointer", display: "flex",
                alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}
            >
              ←
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: "17px", color: "#4a3034", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {lang === "en" ? `${item.mood} · ${item.area}` : `${item.area}での${item.mood}`}
              </div>
              {dateStr && (
                <div style={{ fontSize: "12px", opacity: 0.55, marginTop: "2px" }}>{dateStr}</div>
              )}
            </div>
            <span style={{ fontSize: "12px", background: "#fff0f4", color: "#c0385a", borderRadius: "999px", padding: "4px 10px", fontWeight: 700, border: "1px solid #f2c0cb", flexShrink: 0 }}>
              {recs.length}{lang === "en" ? " spots" : "件"}
            </span>
          </div>

          <div style={{ padding: "16px 14px 0" }}>
            {/* 条件サマリー */}
            <div style={{
              background: "#fffaf8",
              borderRadius: "20px",
              padding: "14px 16px",
              border: "1px solid #f0dfe3",
              marginBottom: "18px",
              fontSize: "13px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "6px 12px",
              color: "#4a3034",
            }}>
              {sa.mood && <div>{lang === "en" ? "Mood" : "気分"}：{sa.mood}</div>}
              {sa.area && <div>{lang === "en" ? "Area" : "エリア"}：{sa.area}</div>}
              {sa.companion && <div>{lang === "en" ? "With" : "誰と"}：{sa.companion}</div>}
              {sa.transport && (Array.isArray(sa.transport) ? sa.transport.length > 0 : !!sa.transport) && (
                <div>{lang === "en" ? "Transport" : "交通"}：{Array.isArray(sa.transport) ? sa.transport.join("・") : sa.transport}</div>
              )}
              {sa.budget !== undefined && <div>{lang === "en" ? "Budget" : "予算"}：{sa.budgetMin && sa.budgetMin > 0 ? `¥${sa.budgetMin.toLocaleString("ja-JP")}〜¥${sa.budget.toLocaleString("ja-JP")}` : `〜¥${sa.budget.toLocaleString("ja-JP")}`}</div>}
              {sa.time && <div>{lang === "en" ? "Time" : "時間"}：{sa.time}</div>}
              {sa.atmosphere && <div>{lang === "en" ? "Vibe" : "雰囲気"}：{sa.atmosphere}</div>}
              {sa.priority && <div>{lang === "en" ? "Priority" : "優先"}：{sa.priority}</div>}
            </div>

            {/* 結果カード一覧 */}
            {recs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", opacity: 0.55, fontSize: "14px" }}>
                {lang === "en" ? UI_EN.historyDetailNoRecs : "この履歴には結果データがありません"}
              </div>
            ) : (
              <div style={{ display: "grid", gap: "18px" }}>
                {recs.map((rec, idx) => {
                  const favorited = isFavorited(rec.title);
                  const pi = photoIndices[rec.title] ?? 0;
                  const photos = rec.photoUrls ?? (rec.photoUrl ? [rec.photoUrl] : []);
                  return (
                    <div key={`${rec.title}-${idx}`} style={resultCardStyle} className="result-card">
                      {/* 写真 */}
                      <div style={{ position: "relative" }}>
                        {photos.length > 0 ? (
                          <div style={{ position: "relative", height: "200px", overflow: "hidden" }}>
                            <img
                              src={photos[pi] ?? photos[0]}
                              alt={rec.title}
                              onClick={() => setLightboxSrc(photos[pi] ?? photos[0])}
                              style={{ width: "100%", height: "200px", objectFit: "cover", display: "block", cursor: "zoom-in" }}
                            />
                            {rec.hasUserPhotos && pi < (rec.userPhotoCount ?? 0) && (
                              <div style={{
                                position: "absolute", top: "10px", left: "10px",
                                background: "rgba(0,0,0,0.52)", borderRadius: "999px",
                                padding: "3px 9px", fontSize: "11px", color: "#fff", fontWeight: 800,
                              }}>
                                📸 投稿写真
                              </div>
                            )}
                            {photos.length > 1 && pi > 0 && (
                              <button onClick={(e) => { e.stopPropagation(); setPhotoIndices((prev) => ({ ...prev, [rec.title]: pi - 1 })); }}
                                style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "32px", height: "32px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "16px", cursor: "pointer" }}>‹</button>
                            )}
                            {photos.length > 1 && pi < photos.length - 1 && (
                              <button onClick={(e) => { e.stopPropagation(); setPhotoIndices((prev) => ({ ...prev, [rec.title]: pi + 1 })); }}
                                style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "32px", height: "32px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "16px", cursor: "pointer" }}>›</button>
                            )}
                            {photos.length > 1 && (
                              <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "4px" }}>
                                {photos.map((_, di) => (
                                  <div key={di} style={{ width: "5px", height: "5px", borderRadius: "999px", background: di === pi ? "#fff" : "rgba(255,255,255,0.4)" }} />
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ height: "200px", background: "linear-gradient(135deg, #fff2ef 0%, #ffe3e8 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 900, color: "#8b6d72" }}>
                            MoodGo recommendation
                          </div>
                        )}
                        <button
                          onClick={() => toggleFavorite(rec)}
                          style={{
                            position: "absolute", top: "12px", right: "12px",
                            width: "44px", height: "44px", borderRadius: "999px",
                            border: "none",
                            background: favorited ? "#ff8fa5" : "rgba(255,255,255,0.92)",
                            color: favorited ? "#fff" : "#ff8fa5",
                            fontSize: "22px", fontWeight: 900, cursor: "pointer",
                            boxShadow: "0 6px 16px rgba(74,48,52,0.16)",
                          }}
                        >{favorited ? "♥" : "♡"}</button>
                        {/* 非表示ボタン（左上） */}
                        <button
                          onClick={() => {
                            if (window.confirm(`「${rec.title}」を今後の結果から除外しますか？`)) {
                              blockPlace(rec.title);
                            }
                          }}
                          style={{
                            position: "absolute", top: "12px", left: "12px",
                            height: "28px", padding: "0 9px", borderRadius: "999px",
                            border: "none", background: "rgba(0,0,0,0.5)", color: "#fff",
                            fontSize: "11px", fontWeight: 700, cursor: "pointer",
                            display: "flex", alignItems: "center", gap: "3px",
                            backdropFilter: "blur(4px)",
                          }}
                          aria-label="結果から除外"
                        >🚫 {lang === "en" ? "Hide" : "非表示"}</button>
                      </div>

                      {/* カード本文 */}
                      <div style={{ padding: "18px 16px 16px" }}>
                        <div style={{ fontWeight: 900, fontSize: "28px", lineHeight: 1.2, marginBottom: "8px", letterSpacing: "-0.02em" }}>
                          {rec.title}
                        </div>

                        {rec.source === "hotpepper" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "8px" }}>
                            {/* ユーザー向け: シンプルなオレンジバッジ */}
                            <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)", borderRadius: "999px", padding: "4px 10px", fontSize: "11px", fontWeight: 900, color: "#fff", alignSelf: "flex-start" }}>
                              🍽️ {lang === "en" ? "HotPepper Gourmet" : "ホットペッパーグルメ"}
                            </div>
                            {/* admin専用: データソース詳細バッジ */}
                            {isAdminMode && (
                              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#1a1a2e", borderRadius: "8px", padding: "4px 10px", fontSize: "10px", fontWeight: 700, color: "#00ff88", alignSelf: "flex-start", fontFamily: "monospace", border: "1px solid #00ff8844" }}>
                                <span style={{ color: "#ff6b35" }}>⚡ ADMIN</span>
                                <span>source: HotPepper API</span>
                                <span style={{ color: "#888" }}>|</span>
                                <span>OpenAI→JSON→HP</span>
                              </div>
                            )}
                          </div>
                        )}
                        {!rec.source || rec.source !== "hotpepper" ? rec.isUserSpot && (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)", borderRadius: "999px", padding: "4px 10px", fontSize: "11px", fontWeight: 900, color: "#4a3034", marginBottom: "8px", border: "1px solid rgba(74,48,52,0.12)" }}>
                            📍 {lang === "en" ? "User-submitted Hidden Gem" : "ユーザー投稿の穴場スポット"}
                          </div>
                        ) : null}

                        {rec.reason && (
                          <div style={{ fontSize: "13px", color: "#c0385a", fontWeight: 700, marginBottom: "8px", lineHeight: 1.5 }}>
                            ✨ {rec.reason}
                          </div>
                        )}

                        {(rec.features ?? []).length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                            {(rec.features ?? []).map((tag, ti) => (
                              <span key={ti} style={{ padding: "4px 10px", borderRadius: "999px", background: "#fff3e6", border: "1px solid #ffd8a8", fontSize: "12px", fontWeight: 700, color: "#8a4500" }}>{tag}</span>
                            ))}
                          </div>
                        )}

                        {rec.address && (
                          <div style={{ fontSize: "13px", opacity: 0.72, marginBottom: "10px" }}>{rec.address}</div>
                        )}

                        {rec.vibe && (
                          <div style={{ fontSize: "14px", lineHeight: 1.7, marginBottom: "12px" }}>{rec.vibe}</div>
                        )}

                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px" }}>
                          {rec.budget && !rec.budget.startsWith("PRICE_LEVEL") && <div style={chipStyle}>{rec.budget}</div>}
                          {rec.time && <div style={chipStyle}>{rec.time}</div>}
                          {rec.rating != null && <div style={chipStyle}>⭐ {rec.rating}{rec.userRatingCount ? ` (${rec.userRatingCount})` : ""}</div>}
                          {rec.routesByMode && rec.routesByMode.length > 0
                            ? rec.routesByMode.map((m, i) => m.distanceText
                                ? <div key={i} style={chipStyle}>{m.icon} {m.distanceText}</div>
                                : null
                              )
                            : rec.distanceText
                              ? <div style={chipStyle}>{travelIcon} {rec.distanceText}</div>
                              : null
                          }
                          {rec.stationText && <div style={chipStyle}>🚉 {rec.stationText}</div>}
                          {rec.openNow !== undefined && (
                            <div style={getOpeningChipStyle(rec.openNow)}>
                              🕒 {rec.openNow ? (lang === "en" ? "Open" : "営業中") : (lang === "en" ? "Closed" : "閉店中")}
                            </div>
                          )}
                        </div>

                        {/* ── HotPepper専用: ミニマップ + ホットペッパーリンク ── */}
                        {rec.source === "hotpepper" && (() => {
                          // HotPepperの緯度経度からURLを解析
                          const urlParams = rec.mapUrl ? new URL(rec.mapUrl).searchParams : null;
                          const lat = urlParams?.get("center")?.split(",")?.[0];
                          const lng = urlParams?.get("center")?.split(",")?.[1];
                          return (
                            <>
                              {lat && lng && (
                                <div style={{ borderRadius: "16px", overflow: "hidden", marginBottom: "12px", border: "1px solid #ead7db" }}>
                                  <iframe
                                    title={`map-${rec.title}`}
                                    src={`https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed&hl=ja`}
                                    width="100%"
                                    height="160"
                                    style={{ display: "block", border: "none" }}
                                    loading="lazy"
                                    referrerPolicy="no-referrer-when-downgrade"
                                  />
                                </div>
                              )}
                              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                                <a
                                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rec.title + " " + (rec.address ?? ""))}`}
                                  target="_blank" rel="noreferrer"
                                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: "44px", borderRadius: "999px", background: "linear-gradient(135deg, #4184ff 0%, #2a6fe6 100%)", color: "#fff", fontSize: "13px", fontWeight: 900, textDecoration: "none", boxShadow: "0 4px 14px rgba(65,132,255,0.3)" }}
                                >
                                  🗺 Googleマップ
                                </a>
                                {rec.hotpepperUrl && (
                                  <a
                                    href={rec.hotpepperUrl}
                                    target="_blank" rel="noreferrer"
                                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: "44px", borderRadius: "999px", background: "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)", color: "#fff", fontSize: "13px", fontWeight: 900, textDecoration: "none", boxShadow: "0 4px 14px rgba(255,107,53,0.3)" }}
                                  >
                                    🍽️ 予約・詳細
                                  </a>
                                )}
                              </div>
                            </>
                          );
                        })()}

                        {/* ── 通常スポット: Googleマップボタン ── */}
                        {rec.source !== "hotpepper" && rec.mapUrl && (
                          <a
                            href={rec.mapUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "center",
                              width: "100%", height: "48px", borderRadius: "999px",
                              background: "linear-gradient(135deg, #4184ff 0%, #2a6fe6 100%)",
                              color: "#fff", fontSize: "14px", fontWeight: 900,
                              textDecoration: "none", boxShadow: "0 4px 14px rgba(65,132,255,0.35)",
                            }}
                          >
                            🗺 {lang === "en" ? "Open in Google Maps" : "Googleマップで見る"}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderFavoritesPage = () => {
    return (
      <div style={{ display: "grid", gap: "18px" }}>
        <div className="home-panel" style={{ ...homePanelStyle, padding: "22px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              marginBottom: "16px",
            }}
          >
            <div>
              <div style={{ fontWeight: 900, fontSize: "24px", marginBottom: "4px" }}>
                {lang === "en" ? UI_EN.favoritesTitle : "お気に入り"}
              </div>
              <div style={{ fontSize: "14px", opacity: 0.72 }}>
                {lang === "en" ? UI_EN.favoritesSub : "保存した場所をまとめて見られるよ"}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setHomeView("home")}
              style={{
                ...secondaryButtonStyle,
                minWidth: "110px",
                height: "44px",
                fontSize: "14px",
              }}
            >
              {lang === "en" ? UI_EN.favoritesBack : "戻る"}
            </button>
          </div>

          <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setFavoriteSort("newest")}
              style={{
                ...secondaryButtonStyle,
                height: "40px",
                padding: "0 14px",
                background: favoriteSort === "newest" ? "#fff1f5" : "#fff",
              }}
            >
              {lang === "en" ? "Newest" : "新しい順"}
            </button>

            <button
              type="button"
              onClick={() => setFavoriteSort("title")}
              style={{
                ...secondaryButtonStyle,
                height: "40px",
                padding: "0 14px",
                background: favoriteSort === "title" ? "#fff1f5" : "#fff",
              }}
            >
              {lang === "en" ? "A–Z" : "名前順"}
            </button>
          </div>

          {sortedFavorites.length === 0 ? (
            <div
              style={{
                background: "#fffaf8",
                borderRadius: "18px",
                padding: "18px",
                border: "1px solid #f2dfe3",
                fontSize: "14px",
                opacity: 0.82,
              }}
            >
              {lang === "en" ? UI_EN.favoritesEmpty : "保存した場所はまだありません"}
            </div>
          ) : (
            <div style={{ display: "grid", gap: "12px" }}>
              {sortedFavorites.slice(0, 12).map((item) => (
                <div
                  key={item.title}
                  style={{
                    display: "grid",
                    gridTemplateColumns: item.photoUrl ? "90px 1fr" : "1fr",
                    gap: "14px",
                    background: "#fffaf8",
                    borderRadius: "20px",
                    padding: "14px",
                    border: "1px solid #f2dfe3",
                  }}
                >
                  {item.photoUrl ? (
                    <img
                      src={item.photoUrl}
                      alt={item.title}
                      style={{
                        width: "90px",
                        height: "90px",
                        borderRadius: "16px",
                        objectFit: "cover",
                      }}
                    />
                  ) : null}

                  <div>
                    <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "6px" }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: "13px", opacity: 0.78, lineHeight: 1.8 }}>
                      {item.area}
                      <br />
                      {item.vibe}
                    </div>

                    {item.mapUrl ? (
                      <a
                        href={item.mapUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          marginTop: "10px",
                          padding: "8px 12px",
                          borderRadius: "999px",
                          background: "#ffffff",
                          border: "1px solid #f0d7dc",
                          color: "#4a3034",
                          fontSize: "12px",
                          fontWeight: 800,
                          textDecoration: "none",
                        }}
                      >
                        {lang === "en" ? "Open in Google Maps" : "Googleマップで見る"}
                      </a>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => {
                        setFavorites((prev) =>
                          prev.filter((f) => f.title !== item.title)
                        );
                      }}
                      style={{
                        marginTop: "10px",
                        border: "none",
                        background: "transparent",
                        color: "#b26073",
                        fontSize: "12px",
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {lang === "en" ? "Remove" : "削除"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── 特集ページ一覧画面 ───────────────────────────────────────────────────
  const renderFeaturedPage = () => {
    // 気分カテゴリ（固定）
    const moodCategories = [
      { label: "ゆっくり", tags: ["デート", "夜"],   bg: "linear-gradient(145deg,#F5E6C8,#EDD09A)" },
      { label: "デート",   tags: ["夜"],              bg: "linear-gradient(145deg,#F5C8D8,#F0A0BC)" },
      { label: "お腹すいた", tags: ["一人飯","カフェ"], bg: "linear-gradient(145deg,#C8DCF5,#A0C0F0)" },
      { label: "遠くへ",  tags: ["夜","遠距離"],      bg: "linear-gradient(145deg,#C8F0E0,#90D8B8)" },
    ];
    // MoodGo Picks用デモデータ（DBデータがない時）
    const demoPickCards: FeaturedPageSummary[] = [
      { id: "p1", slug: "#", spot_name: "初デートで外しにくい場所", partner_name: "", catch_copy: "", tags: ["デート","夜"], cover_image_url: "" },
      { id: "p2", slug: "#", spot_name: "ひとりでゆっくりしたい日に", partner_name: "", catch_copy: "", tags: ["一人飯","カフェ"], cover_image_url: "" },
      { id: "p3", slug: "#", spot_name: "今日はお金をかけたくない", partner_name: "", catch_copy: "", tags: ["横断","がっつり"], cover_image_url: "" },
      { id: "p4", slug: "#", spot_name: "夜に行くとちょうどいい場所", partner_name: "", catch_copy: "", tags: ["夜","遠距離"], cover_image_url: "" },
    ];
    const demoHero: FeaturedPageSummary = { id: "h1", slug: "#", spot_name: "雨の日でも楽しめる横浜", partner_name: "", catch_copy: "外に出る気がしない日でも、ちゃんと気分が上がる場所だけを集めました。", tags: ["雨の日"], cover_image_url: "" };
    const isEmpty = featuredList.length === 0;
    const hero     = isEmpty ? demoHero        : featuredList[0];
    const pickHero = isEmpty ? demoHero        : featuredList[0];
    const gridCards = isEmpty ? demoPickCards  : featuredList.slice(1);
    const gridGrads = [
      "linear-gradient(145deg,#F5E6C8,#EDD09A)",
      "linear-gradient(145deg,#EAD8F5,#C8A8E8)",
      "linear-gradient(145deg,#C8DCF5,#9ABCE0)",
      "linear-gradient(145deg,#C8F0E0,#90D8B8)",
    ];

    return (
      <div style={{ minHeight: "100%", background: "#F7F9FF", overflowY: "auto" }}>

        {/* ── ナビバー ── */}
        <div style={{ background: "white", padding: "14px 18px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #f0f0f0" }}>
          <span style={{ fontSize: "20px", fontWeight: 900, color: "#1a2a4a", letterSpacing: "-0.5px" }}>moodGo</span>
          <div style={{ display: "flex", gap: "18px", alignItems: "center" }}>
            <button onClick={() => setHomeView("home")} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#555" }}>🔍</button>
            <button onClick={() => setHomeView("home")} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#555" }}>☰</button>
          </div>
        </div>

        {/* ── ヒーローバナー ── */}
        <div style={{ margin: "14px 14px 0", borderRadius: "22px", overflow: "hidden", position: "relative", minHeight: "230px", background: "linear-gradient(135deg,#B8D4F0 0%,#D8EAF8 50%,#EEF4FF 100%)" }}>
          {hero.cover_image_url && (
            <img src={hero.cover_image_url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.45 }} />
          )}
          {/* 左側グラデーションオーバーレイ */}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(180,210,240,0.85) 0%, rgba(180,210,240,0.55) 55%, rgba(180,210,240,0) 100%)" }} />
          {/* テキストコンテンツ */}
          <div style={{ position: "relative", padding: "26px 20px 24px", maxWidth: "62%" }}>
            <div style={{ fontSize: "12px", fontWeight: 800, color: "#1E88AA", letterSpacing: "0.05em", marginBottom: "10px" }}>今日の気分特集</div>
            <div style={{ fontSize: "24px", fontWeight: 900, color: "#0C1A30", lineHeight: 1.3, marginBottom: "10px" }}>
              {hero.spot_name || "雨の日でも\n楽しめる横浜"}
            </div>
            <div style={{ fontSize: "12px", color: "#2a3a50", lineHeight: 1.75, marginBottom: "18px", opacity: 0.85 }}>
              {hero.catch_copy || "外に出る気がしない日でも、ちゃんと\n気分が上がる場所だけを集めました。"}
            </div>
            <a
              href={hero.slug !== "#" ? `/feature/${hero.slug}` : undefined}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "white", border: "1.5px solid #ddd", borderRadius: "999px", padding: "9px 20px", fontSize: "13px", fontWeight: 700, color: "#1a2a4a", textDecoration: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
            >特集を眺む <span>›</span></a>
          </div>
        </div>

        {/* ── 気分で遊ぶ特集（固定カテゴリ横スクロール）── */}
        <div style={{ padding: "22px 0 0 14px" }}>
          <div style={{ fontSize: "16px", fontWeight: 900, color: "#111", marginBottom: "14px", paddingRight: "14px" }}>気分で遊ぶ特集</div>
          <div style={{ display: "flex", gap: "11px", overflowX: "auto", paddingRight: "14px", paddingBottom: "6px" }}>
            {moodCategories.map((mc, i) => (
              <div
                key={i}
                style={{ flexShrink: 0, width: "148px", height: "170px", borderRadius: "20px", overflow: "hidden", background: mc.bg, position: "relative", boxShadow: "0 3px 12px rgba(0,0,0,0.10)", cursor: "pointer" }}
              >
                {/* カード下部のコンテンツ */}
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "14px 14px 14px" }}>
                  <div style={{ fontSize: "18px", fontWeight: 900, color: "#1a2a4a", marginBottom: "8px" }}>{mc.label}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                    {mc.tags.map((tag, j) => (
                      <span key={j} style={{ background: "rgba(255,255,255,0.65)", color: "#2a3a50", fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "999px" }}>{tag}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── MoodGo Picks ── */}
        <div style={{ padding: "24px 14px 36px" }}>
          <div style={{ fontSize: "16px", fontWeight: 900, color: "#111", marginBottom: "14px" }}>MoodGo Picks</div>

          {featuredListLoading ? (
            <div style={{ textAlign: "center", padding: "40px 0", opacity: 0.4, fontSize: "14px" }}>読み込み中...</div>
          ) : (
            <>
              {/* ラージヒーローカード */}
              <a
                href={pickHero.slug !== "#" ? `/feature/${pickHero.slug}` : undefined}
                style={{ display: "block", borderRadius: "20px", overflow: "hidden", marginBottom: "12px", textDecoration: "none", position: "relative", height: "240px", background: pickHero.cover_image_url ? "transparent" : gridGrads[0], boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}
              >
                {pickHero.cover_image_url && (
                  <img src={pickHero.cover_image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                )}
                {/* 下グラデーション */}
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.45) 0%, transparent 55%)" }} />
                {/* Featureバッジ */}
                <div style={{ position: "absolute", top: "14px", left: "14px", background: "rgba(255,255,255,0.88)", borderRadius: "8px", padding: "4px 12px", fontSize: "12px", fontWeight: 800, color: "#333" }}>Feature</div>
                {/* 下部ラベル */}
                {pickHero.tags?.[0] && (
                  <div style={{ position: "absolute", bottom: "16px", left: "16px", background: "#1976D2", color: "white", borderRadius: "999px", padding: "7px 18px", fontSize: "13px", fontWeight: 800, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    {pickHero.tags[0]} <span style={{ fontSize: "15px" }}>›</span>
                  </div>
                )}
              </a>

              {/* 2カラムグリッド */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "11px" }}>
                {gridCards.map((card, i) => (
                  <a
                    key={card.id}
                    href={card.slug !== "#" ? `/feature/${card.slug}` : undefined}
                    style={{ display: "block", borderRadius: "18px", overflow: "hidden", background: "white", boxShadow: "0 2px 10px rgba(0,0,0,0.09)", textDecoration: "none" }}
                  >
                    {/* 画像エリア */}
                    <div style={{ height: "108px", background: card.cover_image_url ? "transparent" : gridGrads[i % 4], position: "relative", overflow: "hidden" }}>
                      {card.cover_image_url && (
                        <img src={card.cover_image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      )}
                    </div>
                    {/* テキストエリア */}
                    <div style={{ padding: "10px 11px 12px", background: "white" }}>
                      <div style={{ fontSize: "13px", fontWeight: 900, color: "#111", marginBottom: "7px", lineHeight: 1.35 }}>{card.spot_name}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {card.tags?.slice(0, 2).map((tag: string, j: number) => (
                          <span key={j} style={{ background: "#F0F4FF", color: "#3060A0", fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "999px" }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <main style={pageStyle} className="page-main">
      {/* プロフィール設定オンボーディング（初回のみ） */}
      {profileLoaded && !profileSetupDone && renderProfileSetup(false)}

      {/* プロフィール編集モーダル */}
      {showProfileEdit && renderProfileSetup(true)}

      {/* 画像拡大 lightbox */}
      {lightboxSrc && (
        <div
          onClick={() => setLightboxSrc(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.88)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "16px",
          }}
        >
          <img
            src={lightboxSrc}
            alt="拡大画像"
            style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: "12px", boxShadow: "0 8px 40px rgba(0,0,0,0.6)", objectFit: "contain" }}
          />
          <button
            onClick={() => setLightboxSrc(null)}
            style={{
              position: "absolute", top: "16px", right: "16px",
              background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "999px",
              width: "36px", height: "36px", color: "#fff", fontSize: "20px",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >✕</button>
        </div>
      )}

      {/* 履歴詳細モーダル */}
      {selectedHistoryItem && renderHistoryDetail(selectedHistoryItem)}

      {/* おかえりなさいモーダル */}
      {!started && pendingVisited && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(74,48,52,0.55)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "32px",
              padding: "36px 28px 28px",
              width: "100%",
              maxWidth: "420px",
              boxShadow: "0 24px 60px rgba(74,48,52,0.25)",
              textAlign: "center",
              fontFamily: '"Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif',
            }}
          >
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>👋</div>
            <div style={{ fontWeight: 900, fontSize: "24px", color: "#4a3034", marginBottom: "8px" }}>
              {lang === "en" ? "Welcome back!" : "おかえりなさい！"}
            </div>
            <div style={{ fontSize: "14px", lineHeight: 1.75, color: "#7a5860", marginBottom: "6px" }}>
              {lang === "en" ? <>You used MoodGo last time.<br />Where did you end up going?</> : <>前回MoodGoを利用してくれましたね。<br />結局どこへ行きましたか？</>}
            </div>
            <div style={{ fontSize: "12px", color: "#b08090", marginBottom: "20px" }}>
              {lang === "en" ? "Last suggestions: " : "前回のおすすめ："}{pendingVisited.topRecommendations.slice(0, 2).join(lang === "en" ? ", " : "、")}
            </div>
            <input
              type="text"
              value={pendingVisitedInput}
              onChange={(e) => setPendingVisitedInput(e.target.value)}
              placeholder={lang === "en" ? "e.g. an izakaya in Shibuya, local park..." : "例：渋谷の居酒屋、近所の公園 など"}
              style={{
                width: "100%",
                height: "52px",
                borderRadius: "16px",
                border: "2px solid #f0dfe3",
                padding: "0 16px",
                fontSize: "15px",
                outline: "none",
                background: "#fffaf8",
                marginBottom: "16px",
                boxSizing: "border-box",
                color: "#4a3034",
              }}
              autoFocus
            />
            <button
              onClick={() => {
                if (pendingVisitedInput.trim()) {
                  const updated = pastFeedback.map((f) =>
                    f.id === pendingVisited.id ? { ...f, visitedPlace: pendingVisitedInput.trim() } : f
                  );
                  setPastFeedback(updated);
                  window.localStorage.setItem(FEEDBACK_KEY, JSON.stringify(updated));
                  fetch("/api/feedback", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      ...pendingVisited.answers,
                      topRecommendations: pendingVisited.topRecommendations,
                      rating: pendingVisited.rating,
                      visitedPlace: pendingVisitedInput.trim(),
                    }),
                  }).catch(() => {});
                }
                window.localStorage.removeItem(PENDING_VISITED_KEY);
                setPendingVisited(null);
                setPendingVisitedInput("");
              }}
              style={{
                width: "100%",
                height: "52px",
                borderRadius: "999px",
                border: "none",
                background: "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)",
                color: "#fff",
                fontSize: "16px",
                fontWeight: 900,
                cursor: "pointer",
                marginBottom: "10px",
              }}
            >
              {pendingVisitedInput.trim() ? (lang === "en" ? "Share →" : "教える →") : (lang === "en" ? "Skip →" : "スキップ →")}
            </button>
          </div>
        </div>
      )}
      <div style={shellStyle}>
        {!started ? (
          homeView === "home" ? renderHome() : homeView === "history" ? renderHistoryPage() : homeView === "featured" ? renderFeaturedPage() : renderFavoritesPage()
        ) : (
          <div style={cardStyle} className="main-card">
            <div
              style={{
                marginBottom: "20px",
                fontSize: "14px",
                opacity: 0.75,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>{step <= 10 ? (() => {
                // まったりしたい + 温泉・スパ: step9→7, step7→8, step10→9
                if (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("温泉")) {
                  if (step === 9)  return "7 / 10";
                  if (step === 7)  return "8 / 10";
                  if (step === 10) return "9 / 10";
                }
                // まったりしたい + カフェ: step8(距離)→7, step9(サブカテゴリ)→8, step7(自由ワード)→9
                if (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("カフェ")) {
                  if (step === 8)  return "7 / 10";
                  if (step === 9)  return "8 / 10";
                  if (step === 7)  return "9 / 10";
                  if (step === 10) return "10 / 10";
                }
                // わいわい楽しみたい: step8(サブカテゴリ)→7, step7(自由ワード)→8
                if (selectedMood === "わいわい楽しみたい") {
                  if (step === 8)  return "7 / 10";
                  if (step === 7)  return "8 / 10";
                  if (step === 10) return "9 / 10";
                }
                // お腹すいた / まったりしたい: step8(サブ質問)→7、step7(自由ワード)→8 と表示
                if (selectedMood === "お腹すいた" || selectedMood === "まったりしたい") {
                  if (step === 8) return "7 / 10";
                  if (step === 7) return "8 / 10";
                }
                return `${step} / 10`;
              })() : (lang === "en" ? "Results" : "結果")}</span>
              <button
                onClick={() => setLang(lang === "ja" ? "en" : "ja")}
                style={{
                  padding: "4px 12px",
                  borderRadius: "999px",
                  border: "1.5px solid #ead7db",
                  background: lang === "en" ? "#4184ff" : "#fff",
                  color: lang === "en" ? "#fff" : "#7a5860",
                  fontSize: "12px",
                  fontWeight: 900,
                  cursor: "pointer",
                  letterSpacing: "0.06em",
                }}
              >
                {lang === "en" ? "🌐 EN" : "🌐 JP"}
              </button>
            </div>

            {step === 1 && (
              <>
                {userPreferences.length > 0 && (
                  <div style={{ marginBottom: "14px", padding: "12px 16px", background: "#fff5f7", borderRadius: "16px", border: "1px solid #f0dfe3" }}>
                    <div style={{ fontSize: "11px", color: "#b07080", fontWeight: 800, marginBottom: "8px" }}>
                      {lang === "en" ? "Your tendencies (from past history)" : "あなたの傾向（過去の履歴から）"}
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {userPreferences.map((pref) => (
                        <span
                          key={pref}
                          style={{ padding: "4px 12px", borderRadius: "999px", background: "linear-gradient(135deg, #ffe0e8, #ffd0c8)", fontSize: "12px", fontWeight: 800, color: "#7a3040" }}
                        >
                          {pref}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <h2 style={{ fontSize: "38px", marginTop: 0, marginBottom: "4px", fontWeight: 900 }}>
                  {lang === "en" ? UI_EN.step2Title : "今の気分は？"}
                </h2>
                <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "0px", opacity: 0.7 }}>
                  {lang === "en" ? UI_EN.step2Subtitle : "一番近いものを選んでください。"}
                </p>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
                  {moods.map((m) => {
                    const selected = selectedMood === m.key;
                    const enMood = MOOD_EN[m.key];
                    return (
                      <button
                        key={m.key}
                        onClick={() => {
                          setSelectedMood(m.key);
                          const pool = MOOD_QUESTIONS[m.key] ?? [];
                          let picked: DynamicQuestion[];
                          if (m.key === "ドライブしたい") {
                            // drive_distance のみ（step3で表示。step6の動的質問は廃止）
                            picked = pool;
                          } else if (m.key === "まったりしたい") {
                            // relax_place のみ表示
                            picked = [pool[0]];
                          } else if (m.key === "お腹すいた") {
                            // food_scenic_type は step5「ガッツリ遠くてもOK」時のみ注入
                            // それ以外の5問を全部表示
                            picked = pool.filter(q => q.key !== "food_scenic_type");
                          } else {
                            // 全問表示
                            picked = pool;
                          }
                          setDynamicQuestions(picked);
                          setDynamicAnswers({});
                        }}
                        style={{
                          padding: "14px 10px",
                          borderRadius: "16px",
                          border: selected ? "2px solid #ff8fa5" : "1.5px solid #ead7db",
                          background: selected ? "linear-gradient(135deg, #fff0f3 0%, #ffe8ec 100%)" : "#fffaf8",
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "all 0.15s",
                          boxShadow: selected ? "0 4px 16px rgba(255,143,165,0.25)" : "none",
                        }}
                      >
                        {m.icon
                          ? <img src={m.icon} alt={m.label} style={{ width: "36px", height: "36px", objectFit: "contain", marginBottom: "4px" }} />
                          : <div style={{ width: "36px", height: "36px", fontSize: "28px", lineHeight: "36px", textAlign: "center", marginBottom: "4px" }}>{m.emoji}</div>
                        }
                        <div style={{ fontSize: "14px", fontWeight: 900, color: selected ? "#c0385a" : "#4a3034", lineHeight: 1.3 }}>
                          {lang === "en" && enMood ? enMood.label : m.label}
                        </div>
                        <div style={{ fontSize: "11px", color: "#9b7b82", marginTop: "3px", fontWeight: 600 }}>
                          {lang === "en" && enMood ? enMood.sub : m.sub}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => {
                    setSelectedMood("");
                    setDynamicQuestions([]);
                    setDynamicAnswers({});
                    setStep(2); // skip: no mood selected → no dynamic questions
                  }}
                  style={{ background: "none", border: "none", color: "#b07080", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "block", margin: "0 auto 10px", textDecoration: "underline" }}
                >
                  {lang === "en" ? UI_EN.skip : "スキップ →"}
                </button>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button onClick={() => setStarted(false)} style={{ ...secondaryButtonStyle, flex: 1 }}>
                    {lang === "en" ? UI_EN.back : "戻る"}
                  </button>
                  <button
                    onClick={() => {
                      // 未選択の場合はランダム質問なしで進む
                      if (!selectedMood) {
                        setDynamicQuestions([]);
                        setDynamicAnswers({});
                      }
                      setStep(2);
                    }}
                    style={{ ...primaryButtonStyle, flex: 1 }}
                  >
                    {lang === "en" ? UI_EN.next : "次へ"}
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 style={{ fontSize: "38px", marginTop: 0, marginBottom: "4px", fontWeight: 900 }}>
                  {lang === "en" ? UI_EN.step3Title : "誰と？"}
                </h2>
                <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "0px", opacity: 0.7 }}>
                  {lang === "en" ? UI_EN.step3Subtitle : "誰と行くかでおすすめが変わります。"}
                </p>
                
                {renderOptionGrid(companions, selectedCompanion, setSelectedCompanion, lang === "en" ? OPTIONS_EN.companions : undefined)}
                <button
                  onClick={() => { setSelectedCompanion(""); setStep(3); }}
                  style={{ background: "none", border: "none", color: "#b07080", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "block", margin: "0 auto 10px", textDecoration: "underline" }}
                >
                  {lang === "en" ? UI_EN.skip : "スキップ →"}
                </button>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button onClick={() => setStep(1)} style={{ ...secondaryButtonStyle, flex: 1 }}>
                    {lang === "en" ? UI_EN.back : "戻る"}
                  </button>
                  <button onClick={() => setStep(3)} style={{ ...primaryButtonStyle, flex: 1 }}>
                    {lang === "en" ? UI_EN.next : "次へ"}
                  </button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                {(() => {
                  // 全気分共通: 交通手段を選択（ドライブしたいも同様）
                  return (
                  <>
                    <h2 style={{ fontSize: "38px", marginTop: 0, marginBottom: "4px", fontWeight: 900 }}>
                      {lang === "en" ? UI_EN.step4Title : "交通手段は？"}
                    </h2>
                    <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "0px", opacity: 0.7 }}>
                      {lang === "en" ? UI_EN.step4Subtitle : "複数選んでもOKです。"}
                    </p>
                    <p style={{ fontSize: "12px", color: "#b07080", marginBottom: "10px", fontWeight: 700, textAlign: "center" }}>
                      {lang === "en" ? "Select all that apply" : "複数選択できます ✓"}
                    </p>
                    <div
                      className="bubble-grid"
                      style={{ ...bubbleFieldStyle, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
                    >
                      {transportOptions.map((option, i) => {
                        const isSelected = selectedTransports.includes(option);
                        const displayLabel = lang === "en" ? OPTIONS_EN.transport?.[i] ?? option : option;
                        return (
                          <button
                            key={option}
                            className="bubble-btn"
                            onClick={() => {
                              if (option === "なんでも") {
                                setSelectedTransports(isSelected ? [] : ["なんでも"]);
                              } else {
                                setSelectedTransports((prev) => {
                                  const without = prev.filter((t) => t !== "なんでも");
                                  return isSelected ? without.filter((t) => t !== option) : [...without, option];
                                });
                              }
                            }}
                            style={{ ...uniformBubbleStyle, ...(isSelected ? selectedBubbleStyle : {}), position: "relative" }}
                          >
                            {isSelected && (
                              <span style={{ position: "absolute", top: "6px", right: "8px", fontSize: "11px", fontWeight: 900, color: "inherit", opacity: 0.8 }}>✓</span>
                            )}
                            {displayLabel}
                          </button>
                        );
                      })}
                    </div>
                    {selectedTransports.length > 0 && (
                      <div style={{ textAlign: "center", fontSize: "13px", color: "#c0385a", fontWeight: 800, marginBottom: "8px" }}>
                        {lang === "en" ? "Selected: " : "選択中："}
                        {selectedTransports.join(lang === "en" ? " + " : "・")}
                      </div>
                    )}
                  </>
                  );
                })()}
                <button
                  onClick={() => { setSelectedTransports([]); setStep(4); }}
                  style={{ background: "none", border: "none", color: "#b07080", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "block", margin: "0 auto 10px", textDecoration: "underline" }}
                >
                  {lang === "en" ? UI_EN.skip : "スキップ →"}
                </button>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button onClick={() => setStep(2)} style={{ ...secondaryButtonStyle, flex: 1 }}>
                    {lang === "en" ? UI_EN.back : "戻る"}
                  </button>
                  <button onClick={() => setStep(4)} style={{ ...primaryButtonStyle, flex: 1 }}>
                    {lang === "en" ? UI_EN.next : "次へ"}
                  </button>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <style>{`
                  .budget-range-wrap { position: relative; height: 36px; }
                  .budget-range-wrap input[type=range] {
                    position: absolute;
                    width: 100%;
                    height: 4px;
                    top: 50%;
                    transform: translateY(-50%);
                    -webkit-appearance: none;
                    appearance: none;
                    background: transparent;
                    pointer-events: none;
                    outline: none;
                  }
                  .budget-range-wrap input[type=range]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 26px;
                    height: 26px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%);
                    border: 3px solid #fff;
                    box-shadow: 0 2px 8px rgba(255,143,127,0.45);
                    pointer-events: all;
                    cursor: grab;
                  }
                  .budget-range-wrap input[type=range]::-webkit-slider-thumb:active { cursor: grabbing; }
                  .budget-range-track {
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    height: 4px;
                    width: 100%;
                    border-radius: 4px;
                    background: #f0dfe3;
                    pointer-events: none;
                  }
                  .budget-range-fill {
                    position: absolute;
                    top: 50%;
                    transform: translateY(-50%);
                    height: 4px;
                    border-radius: 4px;
                    background: linear-gradient(90deg, #ffbf67 0%, #ff8f7f 100%);
                    pointer-events: none;
                  }
                `}</style>
                <h2 style={{ fontSize: "38px", marginTop: 0, marginBottom: "4px", fontWeight: 900 }}>
                  {lang === "en" ? UI_EN.step5Title : "予算はどのくらい？"}
                </h2>
                <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "0px", opacity: 0.7 }}>
                  {lang === "en" ? UI_EN.step5Subtitle : "範囲を設定できます。"}
                </p>
                
                <div
                  style={{
                    background: "#fffaf8",
                    borderRadius: "28px",
                    padding: "24px",
                    border: "1px solid #f1dfe3",
                    marginBottom: "24px",
                  }}
                >
                  {budget === undefined ? (
                    <div style={{ textAlign: "center", fontSize: "34px", fontWeight: 900, marginBottom: "8px", color: "#b07080" }}>
                      {lang === "en" ? UI_EN.step5Undecided : "未定（予算を気にせず探す）"}
                    </div>
                  ) : (
                    <>
                      <div style={{ textAlign: "center", fontSize: "36px", fontWeight: 900, marginBottom: "4px" }}>
                        {budgetMin === 0 ? "¥0" : `¥${budgetMin.toLocaleString("ja-JP")}`}
                        <span style={{ fontSize: "22px", opacity: 0.5, margin: "0 10px" }}>〜</span>
                        {`¥${budget.toLocaleString("ja-JP")}`}
                      </div>
                      <div style={{ textAlign: "center", fontSize: "13px", opacity: 0.6, marginBottom: "24px" }}>
                        {lang === "en"
                          ? `${budgetMin === 0 ? UI_EN.step5NoMin : `¥${budgetMin.toLocaleString("ja-JP")} and above`} up to ¥${budget.toLocaleString("ja-JP")}`
                          : `${budgetMin === 0 ? "下限なし" : `¥${budgetMin.toLocaleString("ja-JP")}以上`}から¥${budget.toLocaleString("ja-JP")}以内`}
                      </div>

                      {/* 1本トラック・2つのつまみ */}
                      <div className="budget-range-wrap">
                        <div className="budget-range-track" />
                        <div
                          className="budget-range-fill"
                          style={{
                            left: `${(budgetMin / 30000) * 100}%`,
                            width: `${((budget - budgetMin) / 30000) * 100}%`,
                          }}
                        />
                        {/* 左つまみ（最低予算） */}
                        <input
                          type="range"
                          min="0"
                          max="30000"
                          step="500"
                          value={budgetMin}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (v <= (budget ?? 50000)) setBudgetMin(v);
                          }}
                        />
                        {/* 右つまみ（最高予算） */}
                        <input
                          type="range"
                          min="0"
                          max="30000"
                          step="500"
                          value={budget}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (v >= budgetMin) setBudget(v);
                          }}
                        />
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.6, marginTop: "10px" }}>
                        <span>¥0</span>
                        <span>¥5,000</span>
                        <span>¥15,000</span>
                        <span>¥30,000</span>
                      </div>
                    </>
                  )}
                </div>

                {/* クイック選択ボタン */}
                <div style={{ fontSize: "12px", fontWeight: 800, color: "#9b7080", marginBottom: "8px" }}>
                  {lang === "en" ? UI_EN.step5QuickLabel : "よく使う範囲:"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "24px" }}>
                  {(lang === "en" ? [
                    { label: "Undecided", min: undefined, max: undefined },
                    { label: "Free", min: 0, max: 0 },
                    { label: "~¥3,000", min: 0, max: 3000 },
                    { label: "~¥5,000", min: 0, max: 5000 },
                    { label: "~¥10,000", min: 0, max: 10000 },
                    { label: "¥10,000+", min: 10000, max: 30000 },
                  ] : [
                    { label: "未定", min: undefined, max: undefined },
                    { label: "無料", min: 0, max: 0 },
                    { label: "〜¥3,000", min: 0, max: 3000 },
                    { label: "〜¥5,000", min: 0, max: 5000 },
                    { label: "〜¥10,000", min: 0, max: 10000 },
                    { label: "¥10,000〜", min: 10000, max: 30000 },
                  ] as { label: string; min: number | undefined; max: number | undefined }[]).map(({ label, min, max }) => {
                    const isSelected = max === undefined ? budget === undefined : budget === max && budgetMin === (min ?? 0);
                    return (
                      <button
                        key={label}
                        onClick={() => {
                          if (max === undefined) { setBudget(undefined); }
                          else { setBudgetMin(min ?? 0); setBudget(max); }
                        }}
                        style={{
                          borderRadius: "999px",
                          border: "1px solid #ead7db",
                          background: isSelected ? "#ffe9ea" : "#fff",
                          color: "#4a3034",
                          padding: "10px 8px",
                          fontSize: "13px",
                          fontWeight: 800,
                          cursor: "pointer",
                          textAlign: "center",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => { setBudget(undefined); setBudgetMin(0); setStep(5); }}
                  style={{ background: "none", border: "none", color: "#b07080", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "block", margin: "0 auto 10px", textDecoration: "underline" }}
                >
                  {lang === "en" ? UI_EN.skip : "スキップ →"}
                </button>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button onClick={() => setStep(3)} style={{ ...secondaryButtonStyle, flex: 1 }}>
                    {lang === "en" ? UI_EN.back : "戻る"}
                  </button>
                  <button onClick={() => setStep(5)} style={{ ...primaryButtonStyle, flex: 1 }}>
                    {lang === "en" ? UI_EN.next : "次へ"}
                  </button>
                </div>
              </>
            )}

            {step === 5 && (
              <>
                {selectedMood === "お腹すいた" ? (() => {
                  // お腹すいた: 時間ではなく距離感を選ぶ（4択）
                  const foodDistOpts = ["近場🚶（歩きでも行ける距離）", "多少🚃（駅１、２隣）", "ほどほど遠く🚇（電車で３０分ほど）", "ガッツリ遠くてもOK🚗（１つ県外でも）"];
                  const foodDistOptsEn = ["Nearby 🚶 (walking distance)", "A bit further 🚃 (1-2 stations)", "Moderate 🚇 (30 min by train)", "Far is fine 🚗 (even next prefecture)"];
                  const displayOpts = lang === "en" ? foodDistOptsEn : foodDistOpts;
                  const currentDistAns = dynamicAnswers["food_distance"] ?? "";
                  return (
                    <>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #fff0f3 0%, #ffe8ec 100%)", border: "1px solid #ffd0d8", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#c0385a", marginBottom: "12px" }}>
                        🍜 {lang === "en" ? "How far are you willing to go?" : "どのくらいの距離感がいい？"}
                      </div>
                      <h2 style={{ fontSize: "34px", marginTop: 0, marginBottom: "4px", fontWeight: 900 }}>
                        {lang === "en" ? "How far are you willing to go?" : "どのくらいの距離感がいい？"}
                      </h2>
                      <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "0px", opacity: 0.7 }}>
                        {lang === "en" ? "We'll find restaurants that match your travel preference." : "移動距離に合わせたお店を探します。"}
                      </p>
                      {renderOptionGrid(
                        foodDistOpts,
                        currentDistAns,
                        (val) => {
                          setDynamicAnswers((prev) => ({ ...prev, food_distance: val }));
                          // selectedTime に距離→時間でマッピング（distance計算に使用）
                          const distToTime: Record<string, string> = {
                            "近場🚶（歩きでも行ける距離）": "15〜30分",
                            "多少🚃（駅１、２隣）": "30〜60分",
                            "ほどほど遠く🚇（電車で３０分ほど）": "1〜2時間",
                            "ガッツリ遠くてもOK🚗（１つ県外でも）": "4〜6時間",
                          };
                          setSelectedTime(distToTime[val] ?? "30〜60分");
                        },
                        lang === "en" ? foodDistOptsEn : undefined
                      )}
                    </>
                  );
                })() : (
                  // 全気分共通: どのくらい時間がある？
                  <>
                    <h2 style={{ fontSize: "38px", marginTop: 0, marginBottom: "4px", fontWeight: 900 }}>
                      {lang === "en" ? UI_EN.step6Title : "どのくらい時間がある？"}
                    </h2>
                    <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "0px", opacity: 0.7 }}>
                      {lang === "en" ? UI_EN.step6Subtitle : "未選択のままでも進めます。"}
                    </p>
                    {renderOptionGrid(
                      timeOptions,
                      selectedTime,
                      setSelectedTime,
                      lang === "en" ? OPTIONS_EN.time : undefined,
                      ["近所のスポット 🏠", "徒歩・自転車圏内 🚶", "電車で数駅 🚃", "隣の市・区 🚇", "同じ県内 🗺️", "県外まで行くよ！ ✈️"]
                    )}
                  </>
                )}
                <button
                  onClick={() => {
                    setSelectedTime("");
                    if (selectedMood === "お腹すいた") {
                      setDynamicAnswers(prev => { const next = { ...prev }; delete next["food_distance"]; return next; });
                    }
                    // わいわい・ドライブはStep8へ、自然感じたいはStep9へ（動的質問なし）
                    if (selectedMood === "時間潰したい") { setStep(7); return; }
                    const _isNatureSkip = selectedMood === "自然感じたい" ||
                      (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("自然の中"));
                    setStep(_isNatureSkip ? 9 : (selectedMood === "わいわい楽しみたい" || selectedMood === "ドライブしたい" || selectedMood === "集中したい" || selectedMood === "体を動かしたい" || selectedMood === "遠くに行きたい") ? 8 : 6);
                  }}
                  style={{ background: "none", border: "none", color: "#b07080", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "block", margin: "0 auto 10px", textDecoration: "underline" }}
                >
                  {lang === "en" ? UI_EN.skip : "スキップ →"}
                </button>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button onClick={() => setStep(4)} style={{ ...secondaryButtonStyle, flex: 1 }}>
                    {lang === "en" ? UI_EN.back : "戻る"}
                  </button>
                  <button
                    onClick={() => {
                      if (selectedMood === "時間潰したい") { setStep(7); return; }
                      const _isNat = selectedMood === "自然感じたい" ||
                        (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("自然の中"));
                      setStep(_isNat ? 9 : (selectedMood === "わいわい楽しみたい" || selectedMood === "ドライブしたい" || selectedMood === "集中したい" || selectedMood === "体を動かしたい" || selectedMood === "遠くに行きたい") ? 8 : 6);
                    }}
                    style={{ ...primaryButtonStyle, flex: 1 }}
                  >
                    {lang === "en" ? UI_EN.next : "次へ"}
                  </button>
                </div>
              </>
            )}

            {step === 6 && (
              <>
                {(() => {
                  const startIdx = 0;
                  const questionsToShow = dynamicQuestions.slice(startIdx);
                  if (questionsToShow.length === 0) return null;
                  const moodObj = moods.find(m => m.key === selectedMood);
                  const moodLabel = lang === "en" ? (MOOD_EN[selectedMood]?.label ?? moodObj?.label) : moodObj?.label;
                  const enQs = MOOD_QUESTIONS_EN[selectedMood] ?? [];
                  return (
                    <>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #fff0f3 0%, #ffe8ec 100%)", border: "1px solid #ffd0d8", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#c0385a", marginBottom: "8px" }}>
                        {moodObj && <img src={moodObj.icon} alt={moodObj.label} style={{ width: "16px", height: "16px", objectFit: "contain", verticalAlign: "middle" }} />}
                        {lang === "en" ? UI_EN.moodDetailTag : `${moodLabel}の気分をもっと教えてください`}
                      </div>
                      <p style={{ fontSize: "13px", color: "#b07080", fontWeight: 700, marginBottom: "4px", marginTop: 0 }}>
                        {lang === "en" ? "Answer as many as you like." : "未選択のままでも進めます。"}
                      </p>
                      {questionsToShow.map((dq) => {
                        const enQ = enQs.find(q => q.key === dq.key);
                        const displayQ = lang === "en" && enQ ? enQ : dq;
                        return (
                          <div key={dq.key} style={{ marginBottom: "20px" }}>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#4a3034", marginBottom: "8px" }}>
                              {displayQ.question}
                            </div>
                            {renderOptionGrid(
                              dq.options,
                              dynamicAnswers[dq.key] ?? "",
                              (val) => {
                                setDynamicAnswers(prev => ({ ...prev, [dq.key]: val }));
                                // お腹すいた: ジャンルが変わったらサブ選択の回答をリセット（step8で別ページ表示）
                                if (selectedMood === "お腹すいた" && dq.key === "food_genre_new") {
                                  setDynamicAnswers(prev => { const next = { ...prev, [dq.key]: val }; delete next["food_sub_choice"]; return next; });
                                }
                                // まったりしたい: 場所が変わったらサブ選択の回答をリセット（step8で別ページ表示）
                                if (selectedMood === "まったりしたい" && dq.key === "relax_place") {
                                  setDynamicAnswers(prev => { const next = { ...prev, [dq.key]: val }; delete next["relax_sub_choice"]; return next; });
                                }
                              },
                              lang === "en" && enQ ? enQ.options : undefined
                            )}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
                <button
                  onClick={() => {
                    // 自然パスはstep9（サブジャンル選択）を必ず通す。カフェ・わいわい・ドライブ・集中はstep8。
                    const relax = (dynamicAnswers["relax_place"] ?? "");
                    const isNatureMood = selectedMood === "自然感じたい" ||
                      (selectedMood === "まったりしたい" && relax.includes("自然の中"));
                    const isCafeMood   = selectedMood === "まったりしたい" && relax.includes("カフェ");
                    const isWaiWaiMood = selectedMood === "わいわい楽しみたい";
                    const isDriveMood  = selectedMood === "ドライブしたい";
                    const isFocusMood   = selectedMood === "集中したい";
                    const isSportsMood  = selectedMood === "体を動かしたい";
                    const isTravelMood  = selectedMood === "遠くに行きたい";
                    setStep(isNatureMood ? 9 : isCafeMood || isWaiWaiMood || isDriveMood || isFocusMood || isSportsMood || isTravelMood ? 8 : 7);
                  }}
                  style={{ background: "none", border: "none", color: "#b07080", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "block", margin: "0 auto 10px", textDecoration: "underline" }}
                >
                  {lang === "en" ? UI_EN.skip : "スキップ →"}
                </button>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button onClick={() => setStep(5)} style={{ ...secondaryButtonStyle, flex: 1 }}>{lang === "en" ? UI_EN.back : "戻る"}</button>
                  <button
                    onClick={() => {
                      // お腹すいた: ジャンル選択済みの場合
                      // → サブ質問がある場合はstep8へ、ない場合（中華/韓国/お好み焼き・もんじゃ/高層ビル料理）はstep7へ直接進む
                      if (selectedMood === "お腹すいた" && dynamicAnswers["food_genre_new"]) {
                        const _genreAns = dynamicAnswers["food_genre_new"];
                        const _hasSub = Object.keys(FOOD_SUB_QUESTIONS_MAP).some(k => _genreAns.includes(k));
                        setStep(_hasSub ? 8 : 7);
                      // まったりしたい: 温泉・スパ → カテゴリ選択(step9)へ
                      } else if (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("温泉")) {
                        setStep(9);
                      // まったりしたい: 自然の中 → サブジャンル選択(step9)へ（距離感はスキップ）
                      } else if (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("自然の中")) {
                        setStep(9);
                      // まったりしたい: カフェ → サブカテゴリ選択(step8)へ
                      } else if (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("カフェ")) {
                        setStep(8);
                      // まったりしたい: 場所選択済み かつ サブ質問が存在する場合のみstep8へ
                      } else if (selectedMood === "まったりしたい" && dynamicAnswers["relax_place"] &&
                        Object.keys(RELAX_SUB_QUESTIONS_MAP).some(k => (dynamicAnswers["relax_place"] ?? "").includes(k) && RELAX_SUB_QUESTIONS_MAP[k] != null)) {
                        setStep(8);
                      // 自然感じたい → サブジャンル選択(step9)へ（距離感はスキップ）
                      } else if (selectedMood === "自然感じたい") {
                        setStep(9);
                      // わいわい楽しみたい → サブカテゴリ選択(step8)へ
                      } else if (selectedMood === "わいわい楽しみたい") {
                        setStep(8);
                      // ドライブしたい → サブカテゴリ選択(step8)へ
                      } else if (selectedMood === "ドライブしたい") {
                        setStep(8);
                      // 集中したい → サブカテゴリ選択(step8)へ
                      } else if (selectedMood === "集中したい") {
                        setStep(8);
                      // 体を動かしたい → サブカテゴリ選択(step8)へ
                      } else if (selectedMood === "体を動かしたい") {
                        setStep(8);
                      // 遠くに行きたい → サブカテゴリ選択(step8)へ
                      } else if (selectedMood === "遠くに行きたい") {
                        setStep(8);
                      } else {
                        setStep(7);
                      }
                    }}
                    style={{ ...primaryButtonStyle, flex: 1 }}
                  >{lang === "en" ? UI_EN.next : "次へ"}</button>
                </div>
              </>
            )}

            {/* Step 8: お腹すいた専用 ジャンル別サブ質問 */}
            {step === 8 && selectedMood === "お腹すいた" && (() => {
              const genreAns = dynamicAnswers["food_genre_new"] ?? "";
              const matchedGenre = Object.keys(FOOD_SUB_QUESTIONS_MAP).find(k => genreAns.includes(k));
              const subQ = matchedGenre ? FOOD_SUB_QUESTIONS_MAP[matchedGenre] : null;
              if (!subQ) return null;
              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #fff0f3 0%, #ffe8ec 100%)", border: "1px solid #ffd0d8", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#c0385a", marginBottom: "12px" }}>
                    🍜 {genreAns.replace(/[^　-鿿゠-ヿ＀-￯一-龯㐀-䶿a-zA-Z0-9・]/g, "").trim()}
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "4px", fontWeight: 900, lineHeight: 1.3 }}>
                    {subQ.question}
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "4px", opacity: 0.7 }}>
                    {lang === "en" ? "Answer as many as you like." : "未選択のままでも進めます。"}
                  </p>
                  {renderOptionGrid(
                    subQ.options,
                    dynamicAnswers["food_sub_choice"] ?? "",
                    (val) => setDynamicAnswers(prev => ({ ...prev, food_sub_choice: val }))
                  )}
                  <button
                    onClick={() => setStep(7)}
                    style={{ background: "none", border: "none", color: "#b07080", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "block", margin: "0 auto 10px", textDecoration: "underline" }}
                  >
                    {lang === "en" ? UI_EN.skip : "スキップ →"}
                  </button>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setStep(6)} style={{ ...secondaryButtonStyle, flex: 1 }}>{lang === "en" ? UI_EN.back : "戻る"}</button>
                    <button onClick={() => setStep(7)} style={{ ...primaryButtonStyle, flex: 1 }}>{lang === "en" ? UI_EN.next : "次へ"}</button>
                  </div>
                </>
              );
            })()}

            {/* Step 8: わいわい楽しみたい → サブカテゴリ選択 */}
            {step === 8 && selectedMood === "わいわい楽しみたい" && (() => {
              const WAIWAI_CATS: { key: WaiWaiSubCategory; emoji: string; label: string; sub: string }[] = [
                { key: "active",      emoji: "💪", label: "体を動かしてはしゃぎたい", sub: "ボウリング・トランポリン・スポッチャ" },
                { key: "party",       emoji: "🎤", label: "歌って飲んで騒ぎたい",     sub: "カラオケ・ダーツ・ビリヤード" },
                { key: "experience",  emoji: "🎲", label: "非日常の体験で盛り上がりたい", sub: "ボードゲームカフェ・脱出ゲーム" },
                { key: "food_drink",  emoji: "🍻", label: "美味しいご飯とお酒でワイワイ", sub: "居酒屋・焼肉・食べ放題・飲み放題" },
              ];
              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #fff0f8 0%, #ffe8f5 100%)", border: "1px solid #ffb3d9", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#c0186a", marginBottom: "12px" }}>
                    🎉 わいわい楽しみたい
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "6px", fontWeight: 900, lineHeight: 1.3 }}>
                    どんな楽しみ方をしたい？
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "18px", opacity: 0.7 }}>
                    1つ選んでください。ぴったりなスポットを探します。
                  </p>
                  <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                    {WAIWAI_CATS.map((cat) => {
                      const selected = waiWaiSubCategory === cat.key;
                      return (
                        <button
                          key={cat.key}
                          onClick={() => setWaiWaiSubCategory(cat.key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                            padding: "16px 20px",
                            borderRadius: "20px",
                            border: selected ? "2px solid #ff4da6" : "1.5px solid #ffb3d9",
                            background: selected ? "linear-gradient(135deg, #fff0f8 0%, #ffe4f2 100%)" : "#fffaf8",
                            cursor: "pointer",
                            textAlign: "left",
                            boxShadow: selected ? "0 6px 18px rgba(255,77,166,0.18)" : "0 2px 8px rgba(120,40,80,0.06)",
                            transition: "all 0.15s",
                          }}
                        >
                          <span style={{ fontSize: "32px", lineHeight: 1, flexShrink: 0 }}>{cat.emoji}</span>
                          <div>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#4a0030", marginBottom: "3px" }}>{cat.label}</div>
                            <div style={{ fontSize: "13px", color: "#9a2060", fontWeight: 600 }}>{cat.sub}</div>
                          </div>
                          {selected && (
                            <span style={{ marginLeft: "auto", fontSize: "20px", color: "#ff4da6", flexShrink: 0 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setStep(5)} style={{ ...secondaryButtonStyle, flex: 1 }}>戻る</button>
                    <button
                      onClick={() => { if (waiWaiSubCategory) setStep(7); }}
                      disabled={!waiWaiSubCategory}
                      style={{ ...primaryButtonStyle, flex: 1, opacity: waiWaiSubCategory ? 1 : 0.45, cursor: waiWaiSubCategory ? "pointer" : "default" }}
                    >
                      次へ
                    </button>
                  </div>
                </>
              );
            })()}

            {/* Step 8: ドライブしたい → サブカテゴリ選択 */}
            {step === 8 && selectedMood === "ドライブしたい" && (() => {
              const DRIVE_CATS: { key: DriveSubCategory; emoji: string; label: string; sub: string }[] = [
                { key: "ocean_drive",   emoji: "🌊", label: "海沿いを爽快に走りたい",         sub: "海岸線・絶景ドライブ・オーシャンビュー" },
                { key: "night_view",    emoji: "🌉", label: "綺麗な景色や夜景を見に行きたい", sub: "展望台・夜景スポット・パノラマビュー" },
                { key: "road_station",  emoji: "🏪", label: "道の駅やSAでご当地グルメ",       sub: "道の駅・サービスエリア・ご当地名物" },
                { key: "outlet",        emoji: "🛍️", label: "郊外の大型施設に行きたい",        sub: "アウトレットモール・大型ショッピングモール" },
              ];
              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #e3f2fd 0%, #d0e8fa 100%)", border: "1px solid #90caf9", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#0d47a1", marginBottom: "12px" }}>
                    🚗 ドライブしたい
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "6px", fontWeight: 900, lineHeight: 1.3 }}>
                    どんなドライブ？
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "18px", opacity: 0.7 }}>
                    1つ選んでください。目的地を探します。
                  </p>
                  <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                    {DRIVE_CATS.map((cat) => {
                      const selected = driveSubCategory === cat.key;
                      return (
                        <button
                          key={cat.key}
                          onClick={() => setDriveSubCategory(cat.key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                            padding: "16px 20px",
                            borderRadius: "20px",
                            border: selected ? "2px solid #1976d2" : "1.5px solid #90caf9",
                            background: selected ? "linear-gradient(135deg, #e3f2fd 0%, #d0e8fa 100%)" : "#f8fbff",
                            cursor: "pointer",
                            textAlign: "left",
                            boxShadow: selected ? "0 6px 18px rgba(25,118,210,0.18)" : "0 2px 8px rgba(10,50,120,0.06)",
                            transition: "all 0.15s",
                          }}
                        >
                          <span style={{ fontSize: "32px", lineHeight: 1, flexShrink: 0 }}>{cat.emoji}</span>
                          <div>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#0d2a5e", marginBottom: "3px" }}>{cat.label}</div>
                            <div style={{ fontSize: "13px", color: "#1565c0", fontWeight: 600 }}>{cat.sub}</div>
                          </div>
                          {selected && (
                            <span style={{ marginLeft: "auto", fontSize: "20px", color: "#1976d2", flexShrink: 0 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setStep(5)} style={{ ...secondaryButtonStyle, flex: 1 }}>戻る</button>
                    <button
                      onClick={() => { if (driveSubCategory) setStep(7); }}
                      disabled={!driveSubCategory}
                      style={{ ...primaryButtonStyle, flex: 1, opacity: driveSubCategory ? 1 : 0.45, cursor: driveSubCategory ? "pointer" : "default" }}
                    >
                      次へ
                    </button>
                  </div>
                </>
              );
            })()}

            {/* Step 8: 集中したい → サブカテゴリ選択 */}
            {step === 8 && selectedMood === "集中したい" && (() => {
              const FOCUS_CATS: { key: FocusSubCategory; emoji: string; label: string; sub: string }[] = [
                { key: "work_cafe",         emoji: "☕", label: "カフェで作業・勉強したい",         sub: "Wi-Fi・電源完備・落ち着いた雰囲気" },
                { key: "coworking",         emoji: "🖥️", label: "静かな専用スペースで集中したい",   sub: "コワーキング・自習室・ドロップイン" },
                { key: "family_restaurant", emoji: "🍳", label: "時間を気にせず深夜まで粘りたい",   sub: "ファミレス・ドリンクバー・24時間営業" },
                { key: "netcafe_library",   emoji: "📚", label: "漫画・本に囲まれて完全にこもりたい", sub: "ネットカフェ・マンガ喫茶・図書館" },
              ];
              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #f3f0ff 0%, #ebe8ff 100%)", border: "1px solid #c4b8ff", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#4a1fa8", marginBottom: "12px" }}>
                    📚 集中したい
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "6px", fontWeight: 900, lineHeight: 1.3 }}>
                    どこで集中する？
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "18px", opacity: 0.7 }}>
                    1つ選んでください。ぴったりな場所を探します。
                  </p>
                  <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                    {FOCUS_CATS.map((cat) => {
                      const selected = focusSubCategory === cat.key;
                      return (
                        <button
                          key={cat.key}
                          onClick={() => setFocusSubCategory(cat.key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                            padding: "16px 20px",
                            borderRadius: "20px",
                            border: selected ? "2px solid #7c3aed" : "1.5px solid #c4b8ff",
                            background: selected ? "linear-gradient(135deg, #f3f0ff 0%, #ebe8ff 100%)" : "#faf8ff",
                            cursor: "pointer",
                            textAlign: "left",
                            boxShadow: selected ? "0 6px 18px rgba(124,58,237,0.18)" : "0 2px 8px rgba(60,20,120,0.06)",
                            transition: "all 0.15s",
                          }}
                        >
                          <span style={{ fontSize: "32px", lineHeight: 1, flexShrink: 0 }}>{cat.emoji}</span>
                          <div>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#2d1a5e", marginBottom: "3px" }}>{cat.label}</div>
                            <div style={{ fontSize: "13px", color: "#6d28d9", fontWeight: 600 }}>{cat.sub}</div>
                          </div>
                          {selected && (
                            <span style={{ marginLeft: "auto", fontSize: "20px", color: "#7c3aed", flexShrink: 0 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setStep(5)} style={{ ...secondaryButtonStyle, flex: 1 }}>戻る</button>
                    <button
                      onClick={() => { if (focusSubCategory) setStep(7); }}
                      disabled={!focusSubCategory}
                      style={{ ...primaryButtonStyle, flex: 1, opacity: focusSubCategory ? 1 : 0.45, cursor: focusSubCategory ? "pointer" : "default" }}
                    >
                      次へ
                    </button>
                  </div>
                </>
              );
            })()}

            {/* Step 8: 遠くに行きたい → サブカテゴリ選択 */}
            {step === 8 && selectedMood === "遠くに行きたい" && (() => {
              const TRAVEL_CATS: { key: TravelSubCategory; emoji: string; label: string; sub: string }[] = [
                { key: "power_spot",  emoji: "⛩️", label: "パワースポット・歴史の地へ",       sub: "有名な神社・寺院・霊場・歴史的名所" },
                { key: "theme_park",  emoji: "🎡", label: "別世界のテーマパークへ",            sub: "遊園地・テーマパーク・水族館" },
                { key: "town_walk",   emoji: "🚶", label: "知らない街をブラブラ歩きたい",     sub: "古い町並み・食べ歩き・レトロ商店街" },
                { key: "super_view",  emoji: "🌄", label: "息を呑む絶景・大自然を見に行く",   sub: "絶景スポット・景勝地・国定公園" },
              ];
              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #fff8e1 0%, #fff3c4 100%)", border: "1px solid #fde68a", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#92400e", marginBottom: "12px" }}>
                    ✈️ 遠くに行きたい
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "6px", fontWeight: 900, lineHeight: 1.3 }}>
                    どこへ行く？
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "18px", opacity: 0.7 }}>
                    1つ選んでください。遠出先を探します。
                  </p>
                  <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                    {TRAVEL_CATS.map((cat) => {
                      const selected = travelSubCategory === cat.key;
                      return (
                        <button
                          key={cat.key}
                          onClick={() => setTravelSubCategory(cat.key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                            padding: "16px 20px",
                            borderRadius: "20px",
                            border: selected ? "2px solid #d97706" : "1.5px solid #fde68a",
                            background: selected ? "linear-gradient(135deg, #fff8e1 0%, #fff3c4 100%)" : "#fffdf7",
                            cursor: "pointer",
                            textAlign: "left",
                            boxShadow: selected ? "0 6px 18px rgba(217,119,6,0.18)" : "0 2px 8px rgba(120,80,10,0.06)",
                            transition: "all 0.15s",
                          }}
                        >
                          <span style={{ fontSize: "32px", lineHeight: 1, flexShrink: 0 }}>{cat.emoji}</span>
                          <div>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#451a03", marginBottom: "3px" }}>{cat.label}</div>
                            <div style={{ fontSize: "13px", color: "#92400e", fontWeight: 600 }}>{cat.sub}</div>
                          </div>
                          {selected && (
                            <span style={{ marginLeft: "auto", fontSize: "20px", color: "#d97706", flexShrink: 0 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setStep(5)} style={{ ...secondaryButtonStyle, flex: 1 }}>戻る</button>
                    <button
                      onClick={() => { if (travelSubCategory) setStep(7); }}
                      disabled={!travelSubCategory}
                      style={{ ...primaryButtonStyle, flex: 1, opacity: travelSubCategory ? 1 : 0.45, cursor: travelSubCategory ? "pointer" : "default" }}
                    >
                      次へ
                    </button>
                  </div>
                </>
              );
            })()}

            {/* Step 8: 体を動かしたい → サブカテゴリ選択 */}
            {step === 8 && selectedMood === "体を動かしたい" && (() => {
              const SPORTS_CATS: { key: SportsSubCategory; emoji: string; label: string; sub: string }[] = [
                { key: "training",        emoji: "💪", label: "がっつり汗を流してトレーニング", sub: "スポーツジム・市民プール・体育館" },
                { key: "stress_relief",   emoji: "🏏", label: "打って投げてストレス発散！",     sub: "バッティングセンター・ゴルフ練習場" },
                { key: "amusement_sport", emoji: "🎯", label: "遊び感覚でワイワイ体を動かす",   sub: "スポッチャ・トランポリン・屋内アスレチック" },
                { key: "outdoor_sports",  emoji: "🌳", label: "外の風を感じながらスポーツ",     sub: "公園・コート・運動広場" },
              ];
              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)", border: "1px solid #fed7aa", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#c2410c", marginBottom: "12px" }}>
                    🏃 体を動かしたい
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "6px", fontWeight: 900, lineHeight: 1.3 }}>
                    どんな風に動く？
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "18px", opacity: 0.7 }}>
                    1つ選んでください。ぴったりなスポットを探します。
                  </p>
                  <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                    {SPORTS_CATS.map((cat) => {
                      const selected = sportsSubCategory === cat.key;
                      return (
                        <button
                          key={cat.key}
                          onClick={() => setSportsSubCategory(cat.key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                            padding: "16px 20px",
                            borderRadius: "20px",
                            border: selected ? "2px solid #ea580c" : "1.5px solid #fed7aa",
                            background: selected ? "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)" : "#fffbf7",
                            cursor: "pointer",
                            textAlign: "left",
                            boxShadow: selected ? "0 6px 18px rgba(234,88,12,0.18)" : "0 2px 8px rgba(120,50,10,0.06)",
                            transition: "all 0.15s",
                          }}
                        >
                          <span style={{ fontSize: "32px", lineHeight: 1, flexShrink: 0 }}>{cat.emoji}</span>
                          <div>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#431407", marginBottom: "3px" }}>{cat.label}</div>
                            <div style={{ fontSize: "13px", color: "#c2410c", fontWeight: 600 }}>{cat.sub}</div>
                          </div>
                          {selected && (
                            <span style={{ marginLeft: "auto", fontSize: "20px", color: "#ea580c", flexShrink: 0 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setStep(5)} style={{ ...secondaryButtonStyle, flex: 1 }}>戻る</button>
                    <button
                      onClick={() => { if (sportsSubCategory) setStep(7); }}
                      disabled={!sportsSubCategory}
                      style={{ ...primaryButtonStyle, flex: 1, opacity: sportsSubCategory ? 1 : 0.45, cursor: sportsSubCategory ? "pointer" : "default" }}
                    >
                      次へ
                    </button>
                  </div>
                </>
              );
            })()}

            {/* Step 8: まったりしたい専用 場所別サブ質問（カフェ以外） */}
            {step === 8 && selectedMood === "まったりしたい" && (() => {
              const placeAns = dynamicAnswers["relax_place"] ?? "";
              // カフェは専用のサブカテゴリ選択ステップを使う
              if (placeAns.includes("カフェ")) return null;
              const matchedPlace = Object.keys(RELAX_SUB_QUESTIONS_MAP).find(k => placeAns.includes(k));
              const subQ = matchedPlace ? RELAX_SUB_QUESTIONS_MAP[matchedPlace] : null;
              if (!subQ) return null;
              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #f0f7ff 0%, #e8f0ff 100%)", border: "1px solid #c8d8ff", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#3860c0", marginBottom: "12px" }}>
                    🌿 {placeAns}
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "4px", fontWeight: 900, lineHeight: 1.3 }}>
                    {subQ.question}
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "4px", opacity: 0.7 }}>
                    {lang === "en" ? "Answer as many as you like." : "未選択のままでも進めます。"}
                  </p>
                  {renderOptionGrid(
                    subQ.options,
                    dynamicAnswers["relax_sub_choice"] ?? "",
                    (val) => setDynamicAnswers(prev => ({ ...prev, relax_sub_choice: val }))
                  )}
                  <button
                    onClick={() => setStep(7)}
                    style={{ background: "none", border: "none", color: "#b07080", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "block", margin: "0 auto 10px", textDecoration: "underline" }}
                  >
                    {lang === "en" ? UI_EN.skip : "スキップ →"}
                  </button>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setStep(6)} style={{ ...secondaryButtonStyle, flex: 1 }}>{lang === "en" ? UI_EN.back : "戻る"}</button>
                    <button onClick={() => setStep(7)} style={{ ...primaryButtonStyle, flex: 1 }}>{lang === "en" ? UI_EN.next : "次へ"}</button>
                  </div>
                </>
              );
            })()}

            {/* Step 8: まったりしたい + カフェ → 距離感選択 */}
            {step === 8 && selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("カフェ") && (() => {
              const DIST_OPTS: { key: CafeDistancePref; emoji: string; label: string; range: string; desc: string }[] = [
                { key: "近場",    emoji: "🏃", label: "近場",    range: "〜5km",    desc: "歩いてでも行ける範囲で" },
                { key: "ほどほど", emoji: "🚃", label: "ほどほど", range: "3〜15km",  desc: "ちょっとした遠出を楽しみたい" },
                { key: "遠く",    emoji: "🚗", label: "遠く",    range: "10〜40km", desc: "思い切ってどこか遠くへ" },
              ];
              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #fff8e1 0%, #fff3cc 100%)", border: "1px solid #ffe082", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#e65100", marginBottom: "12px" }}>
                    ☕ カフェ
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "6px", fontWeight: 900, lineHeight: 1.3 }}>
                    どのくらいの距離感が良い？
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "20px", opacity: 0.7 }}>
                    選択するとその距離圏内のカフェを優先します。
                  </p>
                  <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                    {DIST_OPTS.map((opt) => {
                      const selected = cafeDistancePref === opt.key;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => setCafeDistancePref(opt.key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "16px",
                            padding: "16px 20px",
                            borderRadius: "20px",
                            border: selected ? "2px solid #ffb300" : "1.5px solid #ffe082",
                            background: selected ? "linear-gradient(135deg, #fffde7 0%, #fff8e1 100%)" : "#fffdf5",
                            cursor: "pointer",
                            textAlign: "left",
                            boxShadow: selected ? "0 6px 18px rgba(255,179,0,0.22)" : "0 2px 8px rgba(80,60,20,0.06)",
                            transition: "all 0.15s",
                            width: "100%",
                          }}
                        >
                          <span style={{ fontSize: "36px", lineHeight: 1, flexShrink: 0 }}>{opt.emoji}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "3px" }}>
                              <span style={{ fontSize: "17px", fontWeight: 900, color: "#4a3000" }}>{opt.label}</span>
                              <span style={{ fontSize: "13px", fontWeight: 700, color: "#e65100", background: "#fff3cc", borderRadius: "6px", padding: "1px 8px" }}>{opt.range}</span>
                            </div>
                            <div style={{ fontSize: "13px", color: "#8a6500", fontWeight: 600 }}>{opt.desc}</div>
                          </div>
                          {selected && <span style={{ fontSize: "20px", color: "#ffb300", flexShrink: 0 }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    onClick={() => setStep(9)}
                    style={{ background: "none", border: "none", color: "#b07080", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "block", margin: "0 auto 10px", textDecoration: "underline" }}
                  >
                    スキップ →
                  </button>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setStep(6)} style={{ ...secondaryButtonStyle, flex: 1 }}>戻る</button>
                    <button
                      onClick={() => setStep(9)}
                      disabled={!cafeDistancePref}
                      style={{ ...primaryButtonStyle, flex: 1, opacity: cafeDistancePref ? 1 : 0.45, cursor: cafeDistancePref ? "pointer" : "default" }}
                    >次へ</button>
                  </div>
                </>
              );
            })()}

            {step === 7 && (
              <>
                <h2 style={{ fontSize: "38px", marginTop: 0, marginBottom: "6px", fontWeight: 900 }}>
                  {lang === "en" ? UI_EN.step9Title : "自由ワード"}
                </h2>
                <p style={{ fontSize: "15px", lineHeight: 1.7, marginBottom: "8px", opacity: 0.7 }}>
                  {lang === "en" ? UI_EN.step9Subtitle : "行きたい場所のイメージがあれば自由に書いてください。"}
                </p>
                <textarea
                  value={freeWord}
                  onChange={(e) => setFreeWord(e.target.value)}
                  placeholder={lang === "en" ? UI_EN.step9Placeholder : "例：夜景、甘いもの、公園、静かな場所、海が見たい など"}
                  style={{
                    width: "100%",
                    minHeight: "130px",
                    borderRadius: "22px",
                    border: "1px solid #ead7db",
                    padding: "16px",
                    fontSize: "15px",
                    resize: "vertical",
                    boxSizing: "border-box",
                    outline: "none",
                    background: "#fffaf8",
                    marginBottom: "24px",
                  }}
                />
                <div style={{ display: "flex", gap: "12px" }}>
                  <button
                    onClick={() => {
                      // お腹すいた: サブ質問がある場合のみstep8へ戻る。ない場合はstep6（ジャンル選択）へ
                      if (selectedMood === "お腹すいた" && dynamicAnswers["food_genre_new"]) {
                        const _gAns = dynamicAnswers["food_genre_new"];
                        const _hasSubBack = Object.keys(FOOD_SUB_QUESTIONS_MAP).some(k => _gAns.includes(k));
                        setStep(_hasSubBack ? 8 : 6);
                      // 時間潰したい → step5（時間）へ戻る
                      } else if (selectedMood === "時間潰したい") {
                        setStep(5);
                      // まったりしたい: 温泉・スパ → カテゴリ選択(step9)へ戻る
                      } else if (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("温泉")) {
                        setStep(9);
                      // まったりしたい: 自然の中 → 自然サブジャンル選択(step9)へ戻る
                      } else if (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("自然の中")) {
                        setStep(9);
                      // まったりしたい: サブ質問が存在する場合のみstep8へ戻る
                      } else if (selectedMood === "まったりしたい" && dynamicAnswers["relax_place"] &&
                        Object.keys(RELAX_SUB_QUESTIONS_MAP).some(k => (dynamicAnswers["relax_place"] ?? "").includes(k) && RELAX_SUB_QUESTIONS_MAP[k] != null)) {
                        setStep(8);
                      // 自然感じたい → サブジャンル選択(step9)へ戻る
                      } else if (selectedMood === "自然感じたい") {
                        setStep(9);
                      // わいわい楽しみたい → サブカテゴリ選択(step8)へ戻る
                      } else if (selectedMood === "わいわい楽しみたい") {
                        setStep(8);
                      // ドライブしたい → サブカテゴリ選択(step8)へ戻る
                      } else if (selectedMood === "ドライブしたい") {
                        setStep(8);
                      } else {
                        setStep(6);
                      }
                    }}
                    style={{ ...secondaryButtonStyle, flex: 1 }}
                  >
                    {lang === "en" ? UI_EN.back : "戻る"}
                  </button>
                  <button onClick={() => setStep(10)} style={{ ...primaryButtonStyle, flex: 1 }}>
                    {lang === "en" ? UI_EN.next : "次へ"}
                  </button>
                </div>
              </>
            )}

            {/* Step 9: 温泉・スパ カテゴリ選択 */}
            {step === 9 && selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("温泉") && (() => {
              const ONSEN_CATS: { key: OnsenCategory; emoji: string; label: string; sub: string }[] = [
                { key: "natural_onsen",  emoji: "♨️",  label: "天然温泉・日帰り温泉", sub: "源泉かけ流し・日帰り入浴" },
                { key: "sento",          emoji: "🛁",  label: "銭湯",               sub: "昔ながらの公衆浴場" },
                { key: "super_sento",    emoji: "🏊",  label: "スーパー銭湯・健康ランド", sub: "岩盤浴・休憩・食事も" },
                { key: "sauna_ganban",   emoji: "🔥",  label: "サウナ・岩盤浴",       sub: "ととのい・デトックス" },
                { key: "all_onsen",      emoji: "🌊",  label: "温泉施設全般",          sub: "とにかく近くの温浴施設を探す" },
              ];
              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #fff3e6 0%, #ffe8d6 100%)", border: "1px solid #ffd0a8", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#a04800", marginBottom: "12px" }}>
                    ♨️ 温泉・スパ
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "6px", fontWeight: 900, lineHeight: 1.3 }}>
                    どのタイプの施設？
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "18px", opacity: 0.7 }}>
                    お好みのカテゴリを1つ選んでください。
                  </p>
                  <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                    {ONSEN_CATS.map((cat) => {
                      const selected = onsenCategory === cat.key;
                      return (
                        <button
                          key={cat.key}
                          onClick={() => setOnsenCategory(cat.key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                            padding: "16px 20px",
                            borderRadius: "20px",
                            border: selected ? "2px solid #ff8f7f" : "1.5px solid #ead7db",
                            background: selected ? "linear-gradient(135deg, #fff3f0 0%, #ffe8e4 100%)" : "#fffaf8",
                            cursor: "pointer",
                            textAlign: "left",
                            boxShadow: selected ? "0 6px 18px rgba(255,143,127,0.22)" : "0 2px 8px rgba(74,48,52,0.06)",
                            transition: "all 0.15s",
                          }}
                        >
                          <span style={{ fontSize: "32px", lineHeight: 1, flexShrink: 0 }}>{cat.emoji}</span>
                          <div>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#4a3034", marginBottom: "3px" }}>{cat.label}</div>
                            <div style={{ fontSize: "13px", color: "#9b7080", fontWeight: 600 }}>{cat.sub}</div>
                          </div>
                          {selected && (
                            <span style={{ marginLeft: "auto", fontSize: "20px", color: "#ff8f7f", flexShrink: 0 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setStep(6)} style={{ ...secondaryButtonStyle, flex: 1 }}>
                      {lang === "en" ? UI_EN.back : "戻る"}
                    </button>
                    <button
                      onClick={() => { if (onsenCategory) setStep(7); }}
                      disabled={!onsenCategory}
                      style={{ ...primaryButtonStyle, flex: 1, opacity: onsenCategory ? 1 : 0.45, cursor: onsenCategory ? "pointer" : "default" }}
                    >
                      {lang === "en" ? UI_EN.next : "次へ"}
                    </button>
                  </div>
                </>
              );
            })()}

            {/* Step 9: 自然感じたい / まったりしたい+自然の中 サブジャンル選択 */}
            {step === 9 && (selectedMood === "自然感じたい" || (selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("自然の中"))) && (() => {
              const NATURE_CATS: { key: NatureSubGenre; emoji: string; label: string; sub: string }[] = [
                { key: "ocean",  emoji: "🌊", label: "波の音と海風",      sub: "海岸・海浜公園・ビーチ" },
                { key: "forest", emoji: "🌳", label: "森の中で深呼吸",    sub: "森林浴・自然公園・散策路" },
                { key: "park",   emoji: "🧺", label: "広い芝生でゴロゴロ", sub: "大型公園・芝生広場・ピクニック" },
                { key: "view",   emoji: "⛰️", label: "圧倒的な絶景",      sub: "展望台・絶景スポット・高台" },
              ];
              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #e8f5e9 0%, #dcedc8 100%)", border: "1px solid #aed581", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#33691e", marginBottom: "12px" }}>
                    🍀 自然感じたい
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "6px", fontWeight: 900, lineHeight: 1.3 }}>
                    どんな自然の中へ行く？
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "18px", opacity: 0.7 }}>
                    1つ選んでください。あなたに合うスポットを探します。
                  </p>
                  <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                    {NATURE_CATS.map((cat) => {
                      const selected = natureSubGenre === cat.key;
                      return (
                        <button
                          key={cat.key}
                          onClick={() => setNatureSubGenre(cat.key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                            padding: "16px 20px",
                            borderRadius: "20px",
                            border: selected ? "2px solid #66bb6a" : "1.5px solid #c8e6c9",
                            background: selected ? "linear-gradient(135deg, #f1f8e9 0%, #e8f5e9 100%)" : "#fafff9",
                            cursor: "pointer",
                            textAlign: "left",
                            boxShadow: selected ? "0 6px 18px rgba(102,187,106,0.22)" : "0 2px 8px rgba(40,80,40,0.06)",
                            transition: "all 0.15s",
                          }}
                        >
                          <span style={{ fontSize: "32px", lineHeight: 1, flexShrink: 0 }}>{cat.emoji}</span>
                          <div>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#2e4a2e", marginBottom: "3px" }}>{cat.label}</div>
                            <div style={{ fontSize: "13px", color: "#558b5e", fontWeight: 600 }}>{cat.sub}</div>
                          </div>
                          {selected && (
                            <span style={{ marginLeft: "auto", fontSize: "20px", color: "#66bb6a", flexShrink: 0 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setStep(5)} style={{ ...secondaryButtonStyle, flex: 1 }}>
                      {lang === "en" ? UI_EN.back : "戻る"}
                    </button>
                    <button
                      onClick={() => { if (natureSubGenre) setStep(7); }}
                      disabled={!natureSubGenre}
                      style={{ ...primaryButtonStyle, flex: 1, opacity: natureSubGenre ? 1 : 0.45, cursor: natureSubGenre ? "pointer" : "default" }}
                    >
                      {lang === "en" ? UI_EN.next : "次へ"}
                    </button>
                  </div>
                </>
              );
            })()}

            {/* Step 9: まったりしたい + カフェ → サブカテゴリ選択 or 深掘り質問 */}
            {step === 9 && selectedMood === "まったりしたい" && (dynamicAnswers["relax_place"] ?? "").includes("カフェ") && (() => {
              // ── サブカテゴリ選択画面 ──────────────────────────────────
              if (!cafeDetailMode) {
                const CAFE_CATS: { key: CafeSubCategory; emoji: string; label: string; sub: string }[] = [
                  { key: "book_relax", emoji: "📚", label: "ブックカフェ・隠れ家カフェ", sub: "静かに読書・非日常空間でのんびり" },
                  { key: "animal",     emoji: "🐱", label: "アニマルカフェ",             sub: "猫・ふくろう・うさぎと癒し時間" },
                  { key: "view",       emoji: "🌅", label: "景色が良いカフェ",           sub: "テラス席・絶景・自然の中のカフェ" },
                  { key: "sweets",     emoji: "🍰", label: "絶品スイーツカフェ",         sub: "パンケーキ・ケーキ・アフタヌーンティー" },
                ];
                return (
                  <>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #fff8e1 0%, #fff3cc 100%)", border: "1px solid #ffe082", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#e65100", marginBottom: "12px" }}>
                      ☕ カフェ
                    </div>
                    <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "6px", fontWeight: 900, lineHeight: 1.3 }}>
                      どんなカフェに行きたい？
                    </h2>
                    <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "18px", opacity: 0.7 }}>
                      1つ選んでください。ぴったりなカフェを探します。
                    </p>
                    <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                      {CAFE_CATS.map((cat) => {
                        const selected = cafeSubCategory === cat.key;
                        return (
                          <button
                            key={cat.key}
                            onClick={() => { setCafeSubCategory(cat.key); setCafeDetail(null); }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "14px",
                              padding: "16px 20px",
                              borderRadius: "20px",
                              border: selected ? "2px solid #ffb300" : "1.5px solid #ffe082",
                              background: selected ? "linear-gradient(135deg, #fffde7 0%, #fff8e1 100%)" : "#fffdf5",
                              cursor: "pointer",
                              textAlign: "left",
                              boxShadow: selected ? "0 6px 18px rgba(255,179,0,0.22)" : "0 2px 8px rgba(80,60,20,0.06)",
                              transition: "all 0.15s",
                            }}
                          >
                            <span style={{ fontSize: "32px", lineHeight: 1, flexShrink: 0 }}>{cat.emoji}</span>
                            <div>
                              <div style={{ fontSize: "16px", fontWeight: 900, color: "#4a3000", marginBottom: "3px" }}>{cat.label}</div>
                              <div style={{ fontSize: "13px", color: "#8a6500", fontWeight: 600 }}>{cat.sub}</div>
                            </div>
                            {selected && (
                              <span style={{ marginLeft: "auto", fontSize: "20px", color: "#ffb300", flexShrink: 0 }}>✓</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: "12px" }}>
                      <button onClick={() => setStep(8)} style={{ ...secondaryButtonStyle, flex: 1 }}>戻る</button>
                      <button
                        onClick={() => {
                          if (!cafeSubCategory) return;
                          // animal / view は深掘り質問へ、それ以外は次ステップへ
                          if (cafeSubCategory === "animal" || cafeSubCategory === "view") {
                            setCafeDetailMode(true);
                          } else {
                            setStep(7);
                          }
                        }}
                        disabled={!cafeSubCategory}
                        style={{ ...primaryButtonStyle, flex: 1, opacity: cafeSubCategory ? 1 : 0.45, cursor: cafeSubCategory ? "pointer" : "default" }}
                      >
                        次へ
                      </button>
                    </div>
                  </>
                );
              }

              // ── 深掘り質問画面（animal / view）──────────────────────
              const isAnimal = cafeSubCategory === "animal";
              const DETAIL_OPTS: { key: CafeDetail; emoji: string; label: string; sub: string }[] = isAnimal
                ? [
                    { key: "cat",  emoji: "🐱", label: "猫カフェ",            sub: "ゆったり猫と過ごすまったり時間" },
                    { key: "dog",  emoji: "🐶", label: "犬カフェ",            sub: "ワンちゃんと触れ合う元気なカフェ" },
                    { key: "rare", emoji: "🦔", label: "小動物・珍しい動物", sub: "ふくろう・ハリネズミ・うさぎなど" },
                  ]
                : [
                    { key: "ocean",  emoji: "🌊", label: "海・水辺",     sub: "オーシャンビュー・テラスカフェ" },
                    { key: "forest", emoji: "🌲", label: "森・緑",       sub: "自然に囲まれた癒やしカフェ" },
                    { key: "city",   emoji: "🏙️", label: "街並み・高層ビル", sub: "夜景・展望カフェ・テラス席" },
                  ];

              return (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "linear-gradient(135deg, #fff8e1 0%, #fff3cc 100%)", border: "1px solid #ffe082", borderRadius: "999px", padding: "4px 12px", fontSize: "12px", fontWeight: 900, color: "#e65100", marginBottom: "12px" }}>
                    {isAnimal ? "🐱 アニマルカフェ" : "🌅 景色が良いカフェ"}
                  </div>
                  <h2 style={{ fontSize: "28px", marginTop: 0, marginBottom: "6px", fontWeight: 900, lineHeight: 1.3 }}>
                    {isAnimal ? "どの動物に会いたい？" : "どんな景色を眺めたい？"}
                  </h2>
                  <p style={{ fontSize: "15px", lineHeight: 1.6, marginBottom: "18px", opacity: 0.7 }}>
                    1つ選んでください。
                  </p>
                  <div style={{ display: "grid", gap: "12px", marginBottom: "24px" }}>
                    {DETAIL_OPTS.map((opt) => {
                      const selected = cafeDetail === opt.key;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => setCafeDetail(opt.key)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                            padding: "16px 20px",
                            borderRadius: "20px",
                            border: selected ? "2px solid #ffb300" : "1.5px solid #ffe082",
                            background: selected ? "linear-gradient(135deg, #fffde7 0%, #fff8e1 100%)" : "#fffdf5",
                            cursor: "pointer",
                            textAlign: "left",
                            boxShadow: selected ? "0 6px 18px rgba(255,179,0,0.22)" : "0 2px 8px rgba(80,60,20,0.06)",
                            transition: "all 0.15s",
                          }}
                        >
                          <span style={{ fontSize: "32px", lineHeight: 1, flexShrink: 0 }}>{opt.emoji}</span>
                          <div>
                            <div style={{ fontSize: "16px", fontWeight: 900, color: "#4a3000", marginBottom: "3px" }}>{opt.label}</div>
                            <div style={{ fontSize: "13px", color: "#8a6500", fontWeight: 600 }}>{opt.sub}</div>
                          </div>
                          {selected && (
                            <span style={{ marginLeft: "auto", fontSize: "20px", color: "#ffb300", flexShrink: 0 }}>✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "12px" }}>
                    <button onClick={() => setCafeDetailMode(false)} style={{ ...secondaryButtonStyle, flex: 1 }}>戻る</button>
                    <button
                      onClick={() => { if (cafeDetail) setStep(7); }}
                      disabled={!cafeDetail}
                      style={{ ...primaryButtonStyle, flex: 1, opacity: cafeDetail ? 1 : 0.45, cursor: cafeDetail ? "pointer" : "default" }}
                    >
                      次へ
                    </button>
                  </div>
                </>
              );
            })()}

            {step === 10 && (
              <>
                {/* ローディング中は全画面オーバーレイ表示（通常パス） */}
                {isLoadingRecommendations && (
                  <div style={{
                    position: "fixed", inset: 0, zIndex: 9000,
                    background: "linear-gradient(160deg, #fff5f7 0%, #fff0fc 100%)",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    gap: "20px",
                  }}>
                    <div style={{
                      width: "72px", height: "72px", borderRadius: "999px",
                      border: "6px solid #ffdde5", borderTopColor: "#ff6b8a",
                      animation: "moodgo-spin 0.9s linear infinite",
                    }} />
                    <style>{`@keyframes moodgo-spin{to{transform:rotate(360deg)}} @keyframes moodgo-msg{0%,100%{opacity:0.5;transform:translateY(4px)}50%{opacity:1;transform:translateY(0)}}`}</style>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "18px", fontWeight: 900, color: "#4a3034", marginBottom: "10px" }}>
                        おすすめを探しています
                      </div>
                      <div style={{
                        fontSize: "14px", color: "#b07080", fontWeight: 700,
                        animation: "moodgo-msg 2.2s ease-in-out infinite",
                        minHeight: "22px",
                      }}>
                        {LOADING_MESSAGES[loadingMsgIdx]}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "10px" }}>
                      {[0,1,2].map((i) => (
                        <div key={i} style={{
                          width: "10px", height: "10px", borderRadius: "999px",
                          background: "#ff6b8a",
                          opacity: i === loadingMsgIdx % 3 ? 1 : 0.2,
                          transition: "opacity 0.4s",
                        }} />
                      ))}
                    </div>
                  </div>
                )}

                {/* ローディング中は全画面オーバーレイ表示（温泉パス） */}
                {isLoadingOnsen && (
                  <div style={{
                    position: "fixed", inset: 0, zIndex: 9000,
                    background: "linear-gradient(160deg, #fff8f2 0%, #fff3e8 100%)",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    gap: "20px",
                  }}>
                    <div style={{ fontSize: "48px", marginBottom: "4px" }}>♨️</div>
                    <div style={{
                      width: "72px", height: "72px", borderRadius: "999px",
                      border: "6px solid #ffddc0", borderTopColor: "#ff8f40",
                      animation: "moodgo-spin 0.9s linear infinite",
                    }} />
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "18px", fontWeight: 900, color: "#4a3034", marginBottom: "10px" }}>
                        温泉・スパを探しています
                      </div>
                      <div style={{ fontSize: "14px", color: "#a07040", fontWeight: 700 }}>
                        Yahoo!ローカルサーチ + Google でリアルタイム検索中...
                      </div>
                    </div>
                  </div>
                )}

                <h2 style={{ fontSize: "38px", marginTop: 0, marginBottom: "6px", fontWeight: 900 }}>
                  {lang === "en" ? UI_EN.step10Title : "今いるエリアは？"}
                </h2>
                <p style={{ fontSize: "15px", lineHeight: 1.7, marginBottom: "8px", opacity: 0.7 }}>
                  {lang === "en" ? UI_EN.step10Subtitle : "現在地を使うか、エリア名を手入力してください。"}
                </p>
                
                <div
                  style={{
                    background: "#fffaf8",
                    borderRadius: "28px",
                    padding: "24px",
                    border: "1px solid #f1dfe3",
                    marginBottom: "24px",
                  }}
                >
                  <button
                    onClick={handleUseCurrentLocation}
                    disabled={isLocating}
                    style={{
                      ...primaryButtonStyle,
                      width: "100%",
                      opacity: isLocating ? 0.7 : 1,
                      marginBottom: "18px",
                    }}
                  >
                    {isLocating
                      ? (lang === "en" ? UI_EN.step10Getting : "現在地を取得中...")
                      : (lang === "en" ? UI_EN.step10UseLocation : "現在地を使う")}
                  </button>
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: "14px",
                      fontWeight: 800,
                      opacity: 0.75,
                      marginBottom: "18px",
                    }}
                  >
                    {lang === "en" ? UI_EN.step10Or : "または"}
                  </div>
                  <input
                    type="text"
                    value={selectedArea}
                    onFocus={() => {
                      setOriginLat(undefined);
                      setOriginLng(undefined);
                      setLocationDisplayArea("");
                    }}
                    onChange={(e) => {
                      setSelectedArea(e.target.value);
                      setOriginLat(undefined);
                      setOriginLng(undefined);
                      setLocationDisplayArea("");
                    }}
                    placeholder={lang === "en" ? UI_EN.step10Placeholder : "例：横浜 / 渋谷 / みなとみらい"}
                    style={{
                      width: "100%",
                      height: "56px",
                      borderRadius: "18px",
                      border: "1px solid #ead7db",
                      padding: "0 16px",
                      fontSize: "16px",
                      outline: "none",
                      color: "#4a3034",
                      background: "#fff",
                      marginBottom: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                  {locationDisplayArea && !selectedArea && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px", padding: "8px 12px", background: "#f0fdf4", borderRadius: "12px", border: "1px solid #bbf7d0" }}>
                      <span style={{ fontSize: "16px" }}>📍</span>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#166534" }}>{locationDisplayArea} を使用中</span>
                      <button onClick={() => { setLocationDisplayArea(""); setOriginLat(undefined); setOriginLng(undefined); }}
                        style={{ marginLeft: "auto", background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "12px", padding: "0" }}>✕</button>
                    </div>
                  )}
                  <div style={{ fontSize: "13px", opacity: 0.75, lineHeight: 1.6 }}>
                    {lang === "en" ? UI_EN.step10Helper : "現在地がうまく取れない場合は、エリア名をそのまま入力してください。"}
                  </div>
                  {locationError ? (
                    <div style={{ marginTop: "12px", fontSize: "13px", lineHeight: 1.6, color: "#9b3c50" }}>
                      {locationError}
                    </div>
                  ) : null}
                </div>
                <button
                  onClick={() => { setSelectedArea(""); setOriginLat(undefined); setOriginLng(undefined); openResults(); }}
                  style={{ background: "none", border: "none", color: "#b07080", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "block", margin: "0 auto 10px", textDecoration: "underline" }}
                >
                  {lang === "en" ? UI_EN.step10Search : "スキップして検索 →"}
                </button>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button
                    onClick={() => setStep(7)}
                    style={{ ...secondaryButtonStyle, flex: 1 }}
                  >
                    {lang === "en" ? UI_EN.back : "戻る"}
                  </button>
                  <button
                    onClick={async () => {
                      // 手入力エリア名をジオコードしてから検索（GPS未使用時）
                      if (!originLat && !originLng && selectedArea.trim()) {
                        try {
                          const geoRes = await fetch(`/api/geocode?area=${encodeURIComponent(selectedArea.trim())}`);
                          const geoData = await geoRes.json();
                          if (geoData.ok && geoData.lat && geoData.lng) {
                            setOriginLat(geoData.lat);
                            setOriginLng(geoData.lng);
                            setLocationDisplayArea(selectedArea.trim());
                            // setStateは非同期のため、直接openResultsに座標を渡す
                            if (selectedMood === "時間潰したい") { fetchRandomSpots(); }
                            else { await openResults(undefined, geoData.lat, geoData.lng); }
                            return;
                          }
                        } catch { /* geocode失敗時はそのまま検索 */ }
                      }
                      if (selectedMood === "時間潰したい") { fetchRandomSpots(); } else { openResults(); }
                    }}
                    style={{ ...primaryButtonStyle, flex: 1 }}
                  >
                    {isLoadingRecommendations || isLoadingOnsen || isLoadingNature || isLoadingCafe || isLoadingWaiWai || isLoadingDrive || isLoadingFocus || isLoadingSports || isLoadingTravel || isLoadingRandom
                      ? (lang === "en" ? UI_EN.step10Thinking : "考え中...")
                      : (lang === "en" ? UI_EN.step10Go : "おすすめを見る")}
                  </button>
                </div>
              </>
            )}

            {step === 11 && (
              <>
                <h2 style={{ fontSize: "34px", marginTop: 0, marginBottom: "10px", fontWeight: 900 }}>
                  {randomFacilities !== null
                    ? "🎲 今日の運命スポット"
                    : travelFacilities
                    ? `${travelSubCategoryLabel || "おでかけスポット"}の検索結果`
                    : sportsFacilities
                    ? `${sportsSubCategoryLabel || "スポーツスポット"}の検索結果`
                    : focusFacilities
                    ? `${focusSubCategoryLabel || "集中スポット"}の検索結果`
                    : driveFacilities
                    ? `${driveSubCategoryLabel || "ドライブスポット"}の検索結果`
                    : waiWaiFacilities
                    ? `${waiWaiSubCategoryLabel || "わいわいスポット"}の検索結果`
                    : cafeFacilities
                    ? `${cafeSubCategoryLabel || "カフェ"}の検索結果`
                    : onsenFacilities
                    ? `${onsenCategoryLabel || "温泉・スパ"}の検索結果`
                    : natureFacilities
                    ? `${natureSubGenreLabel || "自然スポット"}の検索結果`
                    : (lang === "en" ? `Spots near ${answers.area}` : `${answers.area}でのおすすめ`)}
                </h2>
                {locationDisplayArea && locationDisplayArea !== answers.area && (
                  <div style={{ fontSize: "13px", color: "#5a7a5a", fontWeight: 700, marginBottom: "10px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>📍</span><span>{locationDisplayArea}</span>
                  </div>
                )}

                {/* ── 都道府県フィルターボタン ── */}
                {prefectureButtons.length > 0 && (lastSearchParams || travelFacilities) && !randomFacilities && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "4px 0 16px" }}>
                    <button
                      onClick={() => { setSelectedPrefecture(""); setPrefFilteredFacilities(null); }}
                      style={{
                        padding: "6px 14px", borderRadius: "20px", fontSize: "13px",
                        fontWeight: selectedPrefecture === "" ? 700 : 400,
                        background: selectedPrefecture === "" ? "#4f46e5" : "#f3f4f6",
                        color: selectedPrefecture === "" ? "#fff" : "#374151",
                        border: selectedPrefecture === "" ? "none" : "1px solid #e5e7eb",
                        cursor: "pointer",
                      }}
                    >全て</button>
                    {prefectureButtons.map(pref => (
                      <button
                        key={pref}
                        onClick={() => handlePrefectureFilter(pref)}
                        style={{
                          padding: "6px 14px", borderRadius: "20px", fontSize: "13px",
                          fontWeight: selectedPrefecture === pref ? 700 : 400,
                          background: selectedPrefecture === pref ? "#4f46e5" : "#f3f4f6",
                          color: selectedPrefecture === pref ? "#fff" : "#374151",
                          border: selectedPrefecture === pref ? "none" : "1px solid #e5e7eb",
                          cursor: "pointer",
                        }}
                      >
                        {pref === userPrefecture ? `📍 ${pref}` : pref}
                      </button>
                    ))}
                    {isLoadingPrefFilter && (
                      <span style={{ fontSize: "12px", color: "#9ca3af", display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ width: "14px", height: "14px", border: "2px solid #e5e7eb", borderTopColor: "#4f46e5", borderRadius: "50%", display: "inline-block", animation: "moodgo-spin 0.8s linear infinite" }} />
                        検索中...
                      </span>
                    )}
                  </div>
                )}

                {/* ── フィルター/ソートバー (Feature 1, 2, 4, 5, 9) ── */}
                {!randomFacilities && (
                  <div style={{ marginBottom: "16px" }}>
                    {/* 行1: 営業中フィルター・シャッフル・シェア・設定 */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
                      <button
                        onClick={() => setFilterOpenNow(v => !v)}
                        style={{
                          padding: "7px 14px", borderRadius: "20px", fontSize: "13px", fontWeight: 700,
                          background: filterOpenNow ? "#16a34a" : "#f3f4f6",
                          color: filterOpenNow ? "#fff" : "#374151",
                          border: filterOpenNow ? "none" : "1px solid #e5e7eb",
                          cursor: "pointer",
                        }}
                      >
                        {filterOpenNow ? "🟢 営業中のみ ✓" : "🟢 営業中のみ"}
                      </button>
                      <button
                        onClick={reshuffleFacilities}
                        disabled={isShuffling}
                        style={{
                          padding: "7px 14px", borderRadius: "20px", fontSize: "13px", fontWeight: 700,
                          background: isShuffling ? "#e5e7eb" : "#f3f4f6",
                          color: isShuffling ? "#9ca3af" : "#374151",
                          border: "1px solid #e5e7eb", cursor: isShuffling ? "not-allowed" : "pointer",
                          display: "flex", alignItems: "center", gap: "6px",
                        }}
                      >
                        {isShuffling
                          ? <><span style={{ width: "13px", height: "13px", border: "2px solid #d1d5db", borderTopColor: "#6b7280", borderRadius: "50%", display: "inline-block", animation: "moodgo-spin 0.8s linear infinite" }} />検索中...</>
                          : "🔀 シャッフル"}
                      </button>
                      <button
                        onClick={handleShare}
                        style={{
                          padding: "7px 14px", borderRadius: "20px", fontSize: "13px", fontWeight: 700,
                          background: "#f3f4f6", color: "#374151",
                          border: "1px solid #e5e7eb", cursor: "pointer",
                        }}
                      >
                        📤 シェア
                      </button>
                    </div>
                    {/* 行2: ソートボタン */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {(["default", "rating", "near", "far"] as const).map(mode => {
                        const labels: Record<string, string> = { default: "デフォルト", rating: "⭐ 評価順", near: "📍 近い順", far: "🚗 遠い順" };
                        return (
                          <button
                            key={mode}
                            onClick={() => setSortMode(mode)}
                            style={{
                              padding: "6px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: 700,
                              background: sortMode === mode ? "#4f46e5" : "#f3f4f6",
                              color: sortMode === mode ? "#fff" : "#374151",
                              border: sortMode === mode ? "none" : "1px solid #e5e7eb",
                              cursor: "pointer",
                            }}
                          >
                            {labels[mode]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}


                {/* 都道府県フィルター適用時: フィルター結果を上書き表示 */}
                {selectedPrefecture && prefFilteredFacilities !== null && !isLoadingPrefFilter && lastSearchParams && !travelFacilities && !randomFacilities && (() => {
                  const visible = sortFacilities(prefFilteredFacilities.filter(f => !allBlockedSet.has(f.name) && (!filterOpenNow || f.openNow === true)));
                  return (
                    <>
                      {visible.length === 0 ? (
                        <div style={{ background: "#f9fafb", borderRadius: "16px", border: "1px solid #e5e7eb", padding: "24px", textAlign: "center", marginBottom: "20px" }}>
                          <div style={{ fontSize: "32px", marginBottom: "8px" }}>🔍</div>
                          <div style={{ fontWeight: 700, color: "#374151", marginBottom: "4px" }}>{selectedPrefecture}でのスポットが見つかりませんでした</div>
                          <div style={{ fontSize: "13px", color: "#6b7280" }}>「全て」ボタンで全エリアの結果に戻れます。</div>
                        </div>
                      ) : (
                        <div className="result-list" style={{ display: "grid", gap: "18px", marginBottom: "24px" }}>
                          {visible.map((fac, idx) => {
                            const photoList = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
                            const item: Recommendation = {
                              title: fac.name,
                              reason: fac.description || undefined,
                              address: fac.address,
                              mapUrl: fac.googleMapsUrl,
                              rating: fac.rating,
                              userRatingCount: fac.reviewCount,
                              photoUrl: fac.imageUrl || undefined,
                              photoUrls: photoList,
                              openNow: fac.openNow ?? undefined,
                              openingHoursText: fac.openingHours ?? undefined,
                              priceLevel: fac.priceLevel ?? undefined,
                              features: fac.category ? [fac.category] : [],
                              distanceText: fac.distanceInfo || undefined,
                              stationText: fac.stationInfo || undefined,
                            };
                            const favorited = isFavorited(item.title);
                            const visited = visitedPlaces.includes(item.title);
                            return (
                              <div key={`pref-${fac.id}-${idx}`} style={resultCardStyle} className="result-card">
                                <div style={{ position: "relative" }}>
                                  {(item.photoUrls?.length ?? 0) > 0 ? (() => {
                                    const photos = item.photoUrls!;
                                    const pi = photoIndices[item.title] ?? 0;
                                    return (
                                      <div className="result-card-photo" style={{ position: "relative", height: "220px", overflow: "hidden" }}>
                                        <img src={photos[pi]} alt={`${item.title} ${pi + 1}`} onClick={() => setLightboxSrc(photos[pi])} style={{ width: "100%", height: "220px", objectFit: "cover", display: "block", cursor: "zoom-in" }} />
                                        {pi > 0 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi - 1 })); }} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>‹</button>}
                                        {pi < photos.length - 1 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi + 1 })); }} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>›</button>}
                                        {photos.length > 1 && <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "5px" }}>{photos.map((_, di) => <div key={di} style={{ width: "6px", height: "6px", borderRadius: "999px", background: di === pi ? "#fff" : "rgba(255,255,255,0.45)" }} />)}</div>}
                                      </div>
                                    );
                                  })() : (
                                    <div className="result-card-photo" style={{ width: "100%", height: "220px", background: "linear-gradient(135deg, #f3f4f6, #e5e7eb)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 900, color: "#6b7280" }}>MoodGo recommendation</div>
                                  )}
                                  <button onClick={() => toggleFavorite(item)} style={{ position: "absolute", top: "14px", right: "14px", width: "48px", height: "48px", borderRadius: "999px", border: "none", background: favorited ? "#ff8fa5" : "rgba(255,255,255,0.92)", color: favorited ? "#ffffff" : "#ff8fa5", fontSize: "24px", fontWeight: 900, cursor: "pointer", boxShadow: "0 10px 20px rgba(74,48,52,0.16)" }}>{favorited ? "♥" : "♡"}</button>
                                  <button onClick={() => { setReportingSpot({ title: item.title, address: item.address ?? "" }); setReportReason(""); setReportNote(""); setReportDone(false); }} style={{ position: "absolute", top: "14px", left: "14px", height: "30px", padding: "0 10px", borderRadius: "999px", border: "none", background: "rgba(220,38,38,0.82)", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>🚩 報告</button>
                                  {visited && <div style={{ position: "absolute", top: "14px", right: "70px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}
                                </div>
                                <div className="result-card-body" style={{ padding: "20px 18px 18px" }}>
                                  <div style={{ fontWeight: 900, fontSize: "28px", lineHeight: 1.2, letterSpacing: "-0.03em", marginBottom: "10px" }}>{item.title}</div>
                                  {item.address ? <div style={{ fontSize: "14px", opacity: 0.76, marginBottom: "12px" }}>{item.address}</div> : null}
                                  {item.reason ? <div style={{ fontSize: "14px", lineHeight: 1.6, marginBottom: "12px", color: "#555" }}>{item.reason}</div> : null}
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                    {item.rating !== null && item.rating !== undefined ? <div style={chipStyle}>⭐ {item.rating}{item.userRatingCount ? ` (${item.userRatingCount})` : ""}</div> : null}
                                    {item.openNow != null ? <div style={{ ...chipStyle, background: item.openNow ? "#f0fdf4" : "#fef2f2", color: item.openNow ? "#16a34a" : "#dc2626", border: `1px solid ${item.openNow ? "#bbf7d0" : "#fecaca"}` }}>{item.openNow ? "🟢 営業中" : "🔴 営業時間外"}</div> : null}
                                    {item.distanceText ? <div style={chipStyle}>📍 {item.distanceText}</div> : null}
                                  </div>
                                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                                    {item.mapUrl && (
                                      <a href={item.mapUrl} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "52px", padding: "0 20px", borderRadius: "999px", background: "linear-gradient(135deg, #4184ff 0%, #2a6fe6 100%)", color: "#fff", fontSize: "15px", fontWeight: 900, textDecoration: "none", boxShadow: "0 10px 22px rgba(42,111,230,0.2)" }}>
                                        Googleマップで見る
                                      </a>
                                    )}
                                    <button onClick={() => toggleVisited(item.title)} style={{ padding: "10px 16px", borderRadius: "999px", border: visited ? "none" : "1.5px solid #d1d5db", background: visited ? "#16a34a" : "transparent", color: visited ? "#fff" : "#6b7280", fontSize: "13px", fontWeight: 900, cursor: "pointer" }}>
                                      {visited ? "✅ 行った！" : "🗺️ 行った！"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* ── 時間潰したい: ランダムスポット ── */}
                {isLoadingRandom && (
                  <div style={{ background: "linear-gradient(135deg, #f0f4ff 0%, #e8d5ff 100%)", borderRadius: "24px", border: "1px solid #c4b5fd", padding: "32px 24px", marginBottom: "20px", textAlign: "center" }}>
                    <div style={{ fontSize: "48px", marginBottom: "16px", animation: "moodgo-spin 1.5s linear infinite", display: "inline-block" }}>🎲</div>
                    <div style={{ fontWeight: 900, fontSize: "16px", color: "#4c1d95", marginBottom: "8px" }}>近くのスポットをシャッフル中...</div>
                    <div style={{ fontSize: "13px", color: "#7c3aed" }}>どこが当たるかはお楽しみ！</div>
                  </div>
                )}
                {randomFacilities !== null && !isLoadingRandom && (() => {
                  const RANDOM_COLORS = [
                    { bg: "linear-gradient(135deg,#fff0f6,#ffd6e7)", border: "#ffadd2", accent: "#c2255c", emoji: "🌸" },
                    { bg: "linear-gradient(135deg,#f0f4ff,#d0e8ff)", border: "#91caff", accent: "#1677ff", emoji: "🔷" },
                    { bg: "linear-gradient(135deg,#f6ffed,#d9f7be)", border: "#95de64", accent: "#389e0d", emoji: "🌿" },
                    { bg: "linear-gradient(135deg,#fff7e6,#ffe7ba)", border: "#ffd591", accent: "#d46b08", emoji: "🍊" },
                    { bg: "linear-gradient(135deg,#f9f0ff,#efdbff)", border: "#d3adf7", accent: "#722ed1", emoji: "💜" },
                    { bg: "linear-gradient(135deg,#e6fffb,#b5f5ec)", border: "#5cdbd3", accent: "#08979c", emoji: "🌊" },
                    { bg: "linear-gradient(135deg,#fff1f0,#ffd8bf)", border: "#ffbb96", accent: "#d4380d", emoji: "🔥" },
                    { bg: "linear-gradient(135deg,#feffe6,#ffffb8)", border: "#fffb8f", accent: "#ad8b00", emoji: "⭐" },
                  ];
                  const visible = randomFacilities.filter(f => !allBlockedSet.has(f.name));
                  if (visible.length === 0) return (
                    <div style={{ background: "linear-gradient(135deg, #f0f4ff 0%, #e8d5ff 100%)", borderRadius: "24px", border: "1px solid #c4b5fd", padding: "32px 24px", textAlign: "center", marginBottom: "20px" }}>
                      <div style={{ fontSize: "48px", marginBottom: "12px" }}>🎲</div>
                      <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "8px", color: "#4c1d95" }}>近くにスポットが見つかりませんでした</div>
                      <div style={{ fontSize: "14px", color: "#7c3aed", marginBottom: "16px" }}>現在地を設定してから試してみてください。</div>
                    </div>
                  );
                  return (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", borderRadius: "999px", padding: "4px 14px", fontSize: "13px", fontWeight: 900, color: "#fff" }}>
                            🎲 ランダム
                          </span>
                          <span style={{ fontSize: "13px", color: "#7c3aed", fontWeight: 700 }}>{visible.length}件</span>
                        </div>
                        <button
                          onClick={fetchRandomSpots}
                          style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", border: "none", borderRadius: "999px", padding: "8px 18px", fontSize: "13px", fontWeight: 900, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
                        >
                          🔀 もう一度シャッフル
                        </button>
                      </div>
                      <div style={{ fontSize: "13px", color: "#7c3aed", fontWeight: 600, marginBottom: "16px", opacity: 0.8 }}>
                        半径{randomRadiusKm}km以内{selectedCompanion ? `・${selectedCompanion}向け` : ""}のスポットからランダムでピックアップ ✨
                        {freeWord && <span style={{ marginLeft: "6px", background: "#ede9fe", borderRadius: "6px", padding: "1px 8px" }}>「{freeWord}」</span>}
                      </div>
                      {visible.map((fac, idx) => {
                        const col = RANDOM_COLORS[idx % RANDOM_COLORS.length];
                        const photoList = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
                        const favorited = isFavorited(fac.name);
                        return (
                          <div key={`random-${fac.id}-${idx}`} style={{ ...resultCardStyle, border: `1.5px solid ${col.border}`, marginBottom: "16px" }} className="result-card">
                            <div style={{ position: "relative" }}>
                              {photoList.length > 0 ? (() => {
                                const pi = photoIndices[fac.name] ?? 0;
                                return (
                                  <div className="result-card-photo" style={{ position: "relative", height: "200px", overflow: "hidden" }}>
                                    <img src={photoList[pi]} alt={fac.name} onClick={() => setLightboxSrc(photoList[pi])} style={{ width: "100%", height: "200px", objectFit: "cover", display: "block", cursor: "zoom-in" }} />
                                    {pi > 0 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [fac.name]: pi - 1 })); }} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "32px", height: "32px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "16px", cursor: "pointer" }}>‹</button>}
                                    {pi < photoList.length - 1 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [fac.name]: pi + 1 })); }} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "32px", height: "32px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "16px", cursor: "pointer" }}>›</button>}
                                    {/* カラーアクセントバッジ */}
                                    <div style={{ position: "absolute", top: "10px", left: "10px", background: col.bg, border: `1px solid ${col.border}`, borderRadius: "999px", padding: "2px 10px", fontSize: "12px", fontWeight: 900, color: col.accent }}>
                                      {col.emoji} #{idx + 1}
                                    </div>
                                  </div>
                                );
                              })() : (
                                <div className="result-card-photo" style={{ width: "100%", height: "200px", background: col.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "64px" }}>
                                  {col.emoji}
                                </div>
                              )}
                              <button onClick={() => { const item: Recommendation = { title: fac.name, address: fac.address, mapUrl: fac.googleMapsUrl, rating: fac.rating, userRatingCount: fac.reviewCount, photoUrl: fac.imageUrl || undefined, photoUrls: photoList }; toggleFavorite(item); }} style={{ position: "absolute", top: "10px", right: "10px", width: "44px", height: "44px", borderRadius: "999px", border: "none", background: favorited ? col.accent : "rgba(255,255,255,0.92)", color: favorited ? "#ffffff" : col.accent, fontSize: "22px", cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>{favorited ? "♥" : "♡"}</button>
                              <button onClick={() => { setReportingSpot({ title: fac.name, address: fac.address ?? "" }); setReportReason(""); setReportNote(""); setReportDone(false); }} style={{ position: "absolute", top: "10px", left: "10px", height: "28px", padding: "0 10px", borderRadius: "999px", border: "none", background: "rgba(220,38,38,0.82)", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>🚩 報告</button>
                              {visitedPlaces.includes(fac.name) && <div style={{ position: "absolute", top: "10px", right: "62px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}
                            </div>
                            <div className="result-card-body" style={{ padding: "18px 16px 16px", background: col.bg }}>
                              <div style={{ fontWeight: 900, fontSize: "24px", lineHeight: 1.25, letterSpacing: "-0.02em", marginBottom: "4px", color: col.accent }}>
                                {fac.name}
                              </div>
                              {fac.catchphrase && (
                                <div style={{ fontSize: "14px", fontWeight: 800, color: col.accent, marginBottom: "6px", lineHeight: 1.4 }}>{fac.catchphrase}</div>
                              )}
                              {fac.description && (
                                <div style={{ fontSize: "12px", color: col.accent, fontWeight: 500, marginBottom: "8px", opacity: 0.75, lineHeight: 1.5 }}>{fac.description}</div>
                              )}
                              {fac.address && <div style={{ fontSize: "13px", opacity: 0.7, marginBottom: "10px" }}>{fac.address}</div>}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px" }}>
                                {fac.rating != null && <span style={{ background: "rgba(255,255,255,0.7)", border: `1px solid ${col.border}`, borderRadius: "999px", padding: "2px 10px", fontSize: "12px", fontWeight: 700, color: col.accent }}>⭐ {fac.rating}{fac.reviewCount ? ` (${fac.reviewCount})` : ""}</span>}
                                {fac.distanceInfo && <span style={{ background: "rgba(255,255,255,0.7)", border: `1px solid ${col.border}`, borderRadius: "999px", padding: "2px 10px", fontSize: "12px", fontWeight: 700, color: col.accent }}>📍 {fac.distanceInfo}</span>}
                                {fac.openNow != null && <span style={{ background: fac.openNow ? "rgba(240,253,244,0.9)" : "rgba(254,242,242,0.9)", border: `1px solid ${fac.openNow ? "#bbf7d0" : "#fecaca"}`, borderRadius: "999px", padding: "2px 10px", fontSize: "12px", fontWeight: 700, color: fac.openNow ? "#16a34a" : "#dc2626" }}>{fac.openNow ? "🟢 営業中" : "🔴 営業時間外"}</span>}
                              </div>
                              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                                {fac.googleMapsUrl && (
                                  <a href={fac.googleMapsUrl} target="_blank" rel="noopener noreferrer"
                                    style={{ display: "inline-block", padding: "10px 20px", borderRadius: "999px", background: col.accent, color: "#fff", fontSize: "14px", fontWeight: 900, textDecoration: "none" }}>
                                    Google マップで見る →
                                  </a>
                                )}
                                <button onClick={() => toggleVisited(fac.name)} style={{ padding: "10px 16px", borderRadius: "999px", border: visitedPlaces.includes(fac.name) ? "none" : `1.5px solid ${col.border}`, background: visitedPlaces.includes(fac.name) ? "#16a34a" : "rgba(255,255,255,0.6)", color: visitedPlaces.includes(fac.name) ? "#fff" : col.accent, fontSize: "13px", fontWeight: 900, cursor: "pointer" }}>
                                  {visitedPlaces.includes(fac.name) ? "✅ 行った！" : "🗺️ 行った！"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}

                {/* ── スポーツローディング ── */}
                {isLoadingSports && (
                  <div style={{ background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)", borderRadius: "24px", border: "1px solid #fed7aa", padding: "32px 24px", marginBottom: "20px", textAlign: "center" }}>
                    <div style={{ width: "56px", height: "56px", borderRadius: "999px", border: "5px solid #fed7aa", borderTopColor: "#ea580c", margin: "0 auto 20px", animation: "moodgo-spin 0.9s linear infinite" }} />
                    <div style={{ fontWeight: 900, fontSize: "16px", color: "#431407", marginBottom: "8px" }}>スポーツスポットを探しています</div>
                    <div style={{ fontSize: "13px", color: "#c2410c" }}>Google・Yahooでリアルタイム検索中...</div>
                  </div>
                )}

                {/* ── スポーツ結果リスト ── */}
                {sportsFacilities && !isLoadingSports && (!selectedPrefecture || prefFilteredFacilities === null || isLoadingPrefFilter) && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                      <span style={{ background: "linear-gradient(135deg, #fff7ed, #ffedd5)", border: "1px solid #fed7aa", borderRadius: "999px", padding: "4px 14px", fontSize: "13px", fontWeight: 900, color: "#c2410c" }}>
                        {sportsSubCategoryLabel}
                      </span>
                      <span style={{ fontSize: "13px", color: "#ea580c", fontWeight: 700 }}>{sportsFacilities.length}件</span>
                    </div>
                    {(() => {
                      const visible = sortFacilities(sportsFacilities.filter(f => !allBlockedSet.has(f.name) && (!filterOpenNow || f.openNow === true)));
                      if (visible.length === 0) return (
                        <div style={{ background: "#fffbf7", borderRadius: "24px", border: "1px solid #fed7aa", padding: "32px 24px", textAlign: "center", marginBottom: "20px" }}>
                          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🏃</div>
                          <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "8px", color: "#431407" }}>スポットが見つかりませんでした</div>
                          <div style={{ fontSize: "14px", color: "#c2410c" }}>検索範囲を広げるか、エリアを変更してください。</div>
                        </div>
                      );
                      return visible.map((fac, idx) => {
                        const photoList = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
                        const item: Recommendation = {
                          title:            fac.name,
                          address:          fac.address,
                          mapUrl:           fac.googleMapsUrl,
                          rating:           fac.rating,
                          userRatingCount:  fac.reviewCount,
                          photoUrl:         fac.imageUrl || undefined,
                          photoUrls:        photoList,
                          openNow:          fac.openNow ?? undefined,
                          openingHoursText: fac.openingHours ?? undefined,
                          priceLevel:       fac.priceLevel ?? undefined,
                          features:         [sportsSubCategoryLabel],
                          distanceText:     fac.distanceInfo || undefined,
                          stationText:      fac.stationInfo  || undefined,
                        };
                        const favorited = isFavorited(item.title);
                        const visited = visitedPlaces.includes(item.title);
                        return (
                          <div key={`sports-${fac.id}-${idx}`} style={resultCardStyle} className="result-card">
                            <div style={{ position: "relative" }}>
                              {(item.photoUrls?.length ?? 0) > 0 ? (() => {
                                const photos = item.photoUrls!;
                                const pi = photoIndices[item.title] ?? 0;
                                return (
                                  <div className="result-card-photo" style={{ position: "relative", height: "220px", overflow: "hidden" }}>
                                    <img src={photos[pi]} alt={`${item.title} ${pi + 1}`} onClick={() => setLightboxSrc(photos[pi])} style={{ width: "100%", height: "220px", objectFit: "cover", display: "block", cursor: "zoom-in" }} />
                                    {pi > 0 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi - 1 })); }} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>‹</button>}
                                    {pi < photos.length - 1 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi + 1 })); }} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>›</button>}
                                    {photos.length > 1 && <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "5px" }}>{photos.map((_, di) => <div key={di} style={{ width: "6px", height: "6px", borderRadius: "999px", background: di === pi ? "#fff" : "rgba(255,255,255,0.45)" }} />)}</div>}
                                  </div>
                                );
                              })() : (
                                <div className="result-card-photo" style={{ width: "100%", height: "220px", background: "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "56px" }}>🏃</div>
                              )}
                              <button onClick={() => toggleFavorite(item)} style={{ position: "absolute", top: "14px", right: "14px", width: "48px", height: "48px", borderRadius: "999px", border: "none", background: favorited ? "#ea580c" : "rgba(255,255,255,0.92)", color: favorited ? "#ffffff" : "#ea580c", fontSize: "24px", cursor: "pointer", boxShadow: "0 10px 20px rgba(234,88,12,0.16)" }}>{favorited ? "♥" : "♡"}</button>
                              <button onClick={() => { setReportingSpot({ title: item.title, address: item.address ?? "" }); setReportReason(""); setReportNote(""); setReportDone(false); }} style={{ position: "absolute", top: "14px", left: "14px", height: "30px", padding: "0 10px", borderRadius: "999px", border: "none", background: "rgba(220,38,38,0.82)", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>🚩 報告</button>
                              {visited && <div style={{ position: "absolute", top: "14px", right: "70px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}
                            </div>
                            <div className="result-card-body" style={{ padding: "20px 18px 18px" }}>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                                <div className="result-title" style={{ fontWeight: 900, fontSize: "28px", lineHeight: 1.2, letterSpacing: "-0.03em", flex: 1 }}>{item.title}</div>
                              </div>
                              {fac.description && (
                                <div style={{ fontSize: "14px", color: "#c2410c", fontWeight: 700, marginBottom: "8px" }}>🏃 {fac.description}</div>
                              )}
                              {item.address ? <div style={{ fontSize: "14px", opacity: 0.76, marginBottom: "12px" }}>{item.address}</div> : null}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                {item.rating !== null && item.rating !== undefined ? <div style={chipStyle}>⭐ {item.rating}{item.userRatingCount ? ` (${item.userRatingCount})` : ""}</div> : null}
                                {item.openNow != null ? <div style={{ ...chipStyle, background: item.openNow ? "#f0fdf4" : "#fef2f2", color: item.openNow ? "#16a34a" : "#dc2626", border: `1px solid ${item.openNow ? "#bbf7d0" : "#fecaca"}` }}>{item.openNow ? "🟢 営業中" : "🔴 営業時間外"}</div> : null}
                                {item.distanceText ? <div style={chipStyle}>📍 {item.distanceText}</div> : null}
                              </div>
                              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                                {item.mapUrl && (
                                  <a href={item.mapUrl} target="_blank" rel="noopener noreferrer"
                                    style={{ display: "inline-block", padding: "10px 20px", borderRadius: "999px", background: "linear-gradient(135deg, #ea580c, #c2410c)", color: "#fff", fontSize: "14px", fontWeight: 900, textDecoration: "none" }}>
                                    Google マップで見る →
                                  </a>
                                )}
                                <button onClick={() => toggleVisited(item.title)} style={{ padding: "10px 16px", borderRadius: "999px", border: visited ? "none" : "1.5px solid #d1d5db", background: visited ? "#16a34a" : "transparent", color: visited ? "#fff" : "#6b7280", fontSize: "13px", fontWeight: 900, cursor: "pointer" }}>
                                  {visited ? "✅ 行った！" : "🗺️ 行った！"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </>
                )}

                {/* ── 集中ローディング ── */}
                {isLoadingFocus && (
                  <div style={{ background: "linear-gradient(135deg, #f3f0ff 0%, #ebe8ff 100%)", borderRadius: "24px", border: "1px solid #c4b8ff", padding: "32px 24px", marginBottom: "20px", textAlign: "center" }}>
                    <div style={{ width: "56px", height: "56px", borderRadius: "999px", border: "5px solid #c4b8ff", borderTopColor: "#7c3aed", margin: "0 auto 20px", animation: "moodgo-spin 0.9s linear infinite" }} />
                    <div style={{ fontWeight: 900, fontSize: "16px", color: "#2d1a5e", marginBottom: "8px" }}>集中できる場所を探しています</div>
                    <div style={{ fontSize: "13px", color: "#6d28d9" }}>Google・Yahooでリアルタイム検索中...</div>
                  </div>
                )}

                {/* ── 集中結果リスト ── */}
                {focusFacilities && !isLoadingFocus && (!selectedPrefecture || prefFilteredFacilities === null || isLoadingPrefFilter) && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                      <span style={{ background: "linear-gradient(135deg, #f3f0ff, #ebe8ff)", border: "1px solid #c4b8ff", borderRadius: "999px", padding: "4px 14px", fontSize: "13px", fontWeight: 900, color: "#4a1fa8" }}>
                        {focusSubCategoryLabel}
                      </span>
                      <span style={{ fontSize: "13px", color: "#6d28d9", fontWeight: 700 }}>{focusFacilities.length}件</span>
                    </div>
                    {(() => {
                      const visible = sortFacilities(focusFacilities.filter(f => !allBlockedSet.has(f.name) && (!filterOpenNow || f.openNow === true)));
                      if (visible.length === 0) return (
                        <div style={{ background: "#faf8ff", borderRadius: "24px", border: "1px solid #c4b8ff", padding: "32px 24px", textAlign: "center", marginBottom: "20px" }}>
                          <div style={{ fontSize: "40px", marginBottom: "12px" }}>📚</div>
                          <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "8px", color: "#2d1a5e" }}>スポットが見つかりませんでした</div>
                          <div style={{ fontSize: "14px", color: "#6d28d9" }}>検索範囲を広げるか、エリアを変更してください。</div>
                        </div>
                      );
                      return visible.map((fac, idx) => {
                        const photoList = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
                        const item: Recommendation = {
                          title:            fac.name,
                          address:          fac.address,
                          mapUrl:           fac.googleMapsUrl,
                          rating:           fac.rating,
                          userRatingCount:  fac.reviewCount,
                          photoUrl:         fac.imageUrl || undefined,
                          photoUrls:        photoList,
                          openNow:          fac.openNow ?? undefined,
                          openingHoursText: fac.openingHours ?? undefined,
                          priceLevel:       fac.priceLevel ?? undefined,
                          features:         [focusSubCategoryLabel],
                          distanceText:     fac.distanceInfo || undefined,
                          stationText:      fac.stationInfo  || undefined,
                        };
                        const favorited = isFavorited(item.title);
                        const visited = visitedPlaces.includes(item.title);
                        return (
                          <div key={`focus-${fac.id}-${idx}`} style={resultCardStyle} className="result-card">
                            <div style={{ position: "relative" }}>
                              {(item.photoUrls?.length ?? 0) > 0 ? (() => {
                                const photos = item.photoUrls!;
                                const pi = photoIndices[item.title] ?? 0;
                                return (
                                  <div className="result-card-photo" style={{ position: "relative", height: "220px", overflow: "hidden" }}>
                                    <img src={photos[pi]} alt={`${item.title} ${pi + 1}`} onClick={() => setLightboxSrc(photos[pi])} style={{ width: "100%", height: "220px", objectFit: "cover", display: "block", cursor: "zoom-in" }} />
                                    {pi > 0 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi - 1 })); }} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>‹</button>}
                                    {pi < photos.length - 1 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi + 1 })); }} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>›</button>}
                                    {photos.length > 1 && <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "5px" }}>{photos.map((_, di) => <div key={di} style={{ width: "6px", height: "6px", borderRadius: "999px", background: di === pi ? "#fff" : "rgba(255,255,255,0.45)" }} />)}</div>}
                                  </div>
                                );
                              })() : (
                                <div className="result-card-photo" style={{ width: "100%", height: "220px", background: "linear-gradient(135deg, #f3f0ff 0%, #ebe8ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "56px" }}>📚</div>
                              )}
                              <button onClick={() => toggleFavorite(item)} style={{ position: "absolute", top: "14px", right: "14px", width: "48px", height: "48px", borderRadius: "999px", border: "none", background: favorited ? "#7c3aed" : "rgba(255,255,255,0.92)", color: favorited ? "#ffffff" : "#7c3aed", fontSize: "24px", cursor: "pointer", boxShadow: "0 10px 20px rgba(124,58,237,0.16)" }}>{favorited ? "♥" : "♡"}</button>
                              <button onClick={() => { setReportingSpot({ title: item.title, address: item.address ?? "" }); setReportReason(""); setReportNote(""); setReportDone(false); }} style={{ position: "absolute", top: "14px", left: "14px", height: "30px", padding: "0 10px", borderRadius: "999px", border: "none", background: "rgba(220,38,38,0.82)", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>🚩 報告</button>
                              {visited && <div style={{ position: "absolute", top: "14px", right: "70px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}
                            </div>
                            <div className="result-card-body" style={{ padding: "20px 18px 18px" }}>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                                <div className="result-title" style={{ fontWeight: 900, fontSize: "28px", lineHeight: 1.2, letterSpacing: "-0.03em", flex: 1 }}>{item.title}</div>
                              </div>
                              {fac.description && (
                                <div style={{ fontSize: "14px", color: "#6d28d9", fontWeight: 700, marginBottom: "8px" }}>📚 {fac.description}</div>
                              )}
                              {item.address ? <div style={{ fontSize: "14px", opacity: 0.76, marginBottom: "12px" }}>{item.address}</div> : null}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                {item.rating !== null && item.rating !== undefined ? <div style={chipStyle}>⭐ {item.rating}{item.userRatingCount ? ` (${item.userRatingCount})` : ""}</div> : null}
                                {item.openNow != null ? <div style={{ ...chipStyle, background: item.openNow ? "#f0fdf4" : "#fef2f2", color: item.openNow ? "#16a34a" : "#dc2626", border: `1px solid ${item.openNow ? "#bbf7d0" : "#fecaca"}` }}>{item.openNow ? "🟢 営業中" : "🔴 営業時間外"}</div> : null}
                                {item.distanceText ? <div style={chipStyle}>📍 {item.distanceText}</div> : null}
                              </div>
                              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                                {item.mapUrl && (
                                  <a href={item.mapUrl} target="_blank" rel="noopener noreferrer"
                                    style={{ display: "inline-block", padding: "10px 20px", borderRadius: "999px", background: "linear-gradient(135deg, #7c3aed, #5b21b6)", color: "#fff", fontSize: "14px", fontWeight: 900, textDecoration: "none" }}>
                                    Google マップで見る →
                                  </a>
                                )}
                                <button onClick={() => toggleVisited(item.title)} style={{ padding: "10px 16px", borderRadius: "999px", border: visited ? "none" : "1.5px solid #d1d5db", background: visited ? "#16a34a" : "transparent", color: visited ? "#fff" : "#6b7280", fontSize: "13px", fontWeight: 900, cursor: "pointer" }}>
                                  {visited ? "✅ 行った！" : "🗺️ 行った！"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </>
                )}

                {/* ── 遠くに行きたいローディング ── */}
                {isLoadingTravel && (
                  <div style={{ background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)", borderRadius: "24px", border: "1px solid #fde68a", padding: "32px 24px", marginBottom: "20px", textAlign: "center" }}>
                    <div style={{ width: "56px", height: "56px", borderRadius: "999px", border: "5px solid #fde68a", borderTopColor: "#d97706", margin: "0 auto 20px", animation: "moodgo-spin 0.9s linear infinite" }} />
                    <div style={{ fontWeight: 900, fontSize: "16px", color: "#451a03", marginBottom: "8px" }}>おでかけスポットを探しています</div>
                    <div style={{ fontSize: "13px", color: "#b45309" }}>Google・Yahooでリアルタイム検索中...</div>
                  </div>
                )}

                {/* ── 遠くに行きたい結果リスト ── */}
                {travelFacilities && !isLoadingTravel && (
                  <>
                    {/* 県フィルター中ローディング */}
                    {isLoadingPrefFilter && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px 0 8px", color: "#6b7280", fontSize: "13px" }}>
                        <span style={{ width: "16px", height: "16px", border: "2px solid #e5e7eb", borderTopColor: "#4f46e5", borderRadius: "50%", display: "inline-block", animation: "moodgo-spin 0.8s linear infinite" }} />
                        {selectedPrefecture}で検索中...
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                      <span style={{ background: "linear-gradient(135deg, #fffbeb, #fef3c7)", border: "1px solid #fde68a", borderRadius: "999px", padding: "4px 14px", fontSize: "13px", fontWeight: 900, color: "#92400e" }}>
                        {travelSubCategoryLabel}
                      </span>
                      <span style={{ fontSize: "13px", color: "#d97706", fontWeight: 700 }}>
                        {selectedPrefecture && prefFilteredFacilities !== null
                          ? `${prefFilteredFacilities.filter(f => !allBlockedSet.has(f.name)).length}件`
                          : `${travelFacilities.length}件`}
                      </span>
                      {selectedPrefecture && (
                        <span style={{ fontSize: "12px", background: "#4f46e5", color: "#fff", borderRadius: "999px", padding: "2px 10px", fontWeight: 700 }}>
                          📍 {selectedPrefecture}
                        </span>
                      )}
                    </div>
                    {!isLoadingPrefFilter && (() => {
                      // 県フィルター適用時は prefFilteredFacilities を使う
                      const base = (selectedPrefecture && prefFilteredFacilities !== null)
                        ? prefFilteredFacilities
                        : travelFacilities;
                      const visible = sortFacilities(base.filter(f => !allBlockedSet.has(f.name) && (!filterOpenNow || f.openNow === true)));
                      if (visible.length === 0) return (
                        <div style={{ background: "#fffbeb", borderRadius: "24px", border: "1px solid #fde68a", padding: "32px 24px", textAlign: "center", marginBottom: "20px" }}>
                          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🗺️</div>
                          <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "8px", color: "#451a03" }}>スポットが見つかりませんでした</div>
                          <div style={{ fontSize: "14px", color: "#b45309" }}>検索範囲を広げるか、エリアを変更してください。</div>
                        </div>
                      );
                      return visible.map((fac, idx) => {
                        const photoList = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
                        const item: Recommendation = {
                          title:            fac.name,
                          address:          fac.address,
                          mapUrl:           fac.googleMapsUrl,
                          rating:           fac.rating,
                          userRatingCount:  fac.reviewCount,
                          photoUrl:         fac.imageUrl || undefined,
                          photoUrls:        photoList,
                          openNow:          fac.openNow ?? undefined,
                          openingHoursText: fac.openingHours ?? undefined,
                          priceLevel:       fac.priceLevel ?? undefined,
                          features:         [travelSubCategoryLabel],
                          distanceText:     fac.distanceInfo || undefined,
                          stationText:      fac.stationInfo  || undefined,
                        };
                        const favorited = isFavorited(item.title);
                        const visited = visitedPlaces.includes(item.title);
                        return (
                          <div key={`travel-${fac.id}-${idx}`} style={resultCardStyle} className="result-card">
                            <div style={{ position: "relative" }}>
                              {(item.photoUrls?.length ?? 0) > 0 ? (() => {
                                const photos = item.photoUrls!;
                                const pi = photoIndices[item.title] ?? 0;
                                return (
                                  <div className="result-card-photo" style={{ position: "relative", height: "220px", overflow: "hidden" }}>
                                    <img src={photos[pi]} alt={`${item.title} ${pi + 1}`} onClick={() => setLightboxSrc(photos[pi])} style={{ width: "100%", height: "220px", objectFit: "cover", display: "block", cursor: "zoom-in" }} />
                                    {pi > 0 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi - 1 })); }} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>‹</button>}
                                    {pi < photos.length - 1 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi + 1 })); }} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>›</button>}
                                    {photos.length > 1 && <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "5px" }}>{photos.map((_, di) => <div key={di} style={{ width: "6px", height: "6px", borderRadius: "999px", background: di === pi ? "#fff" : "rgba(255,255,255,0.45)" }} />)}</div>}
                                  </div>
                                );
                              })() : (
                                <div className="result-card-photo" style={{ width: "100%", height: "220px", background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "56px" }}>🗺️</div>
                              )}
                              <button onClick={() => toggleFavorite(item)} style={{ position: "absolute", top: "14px", right: "14px", width: "48px", height: "48px", borderRadius: "999px", border: "none", background: favorited ? "#d97706" : "rgba(255,255,255,0.92)", color: favorited ? "#ffffff" : "#d97706", fontSize: "24px", cursor: "pointer", boxShadow: "0 10px 20px rgba(217,119,6,0.16)" }}>{favorited ? "♥" : "♡"}</button>
                              <button onClick={() => { setReportingSpot({ title: item.title, address: item.address ?? "" }); setReportReason(""); setReportNote(""); setReportDone(false); }} style={{ position: "absolute", top: "14px", left: "14px", height: "30px", padding: "0 10px", borderRadius: "999px", border: "none", background: "rgba(220,38,38,0.82)", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>🚩 報告</button>
                              {visited && <div style={{ position: "absolute", top: "14px", right: "70px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}
                            </div>
                            <div className="result-card-body" style={{ padding: "20px 18px 18px" }}>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                                <div className="result-title" style={{ fontWeight: 900, fontSize: "28px", lineHeight: 1.2, letterSpacing: "-0.03em", flex: 1 }}>{item.title}</div>
                              </div>
                              {fac.description && (
                                <div style={{ fontSize: "14px", color: "#b45309", fontWeight: 700, marginBottom: "8px" }}>🗺️ {fac.description}</div>
                              )}
                              {item.address ? <div style={{ fontSize: "14px", opacity: 0.76, marginBottom: "12px" }}>{item.address}</div> : null}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                {item.rating !== null && item.rating !== undefined ? <div style={chipStyle}>⭐ {item.rating}{item.userRatingCount ? ` (${item.userRatingCount})` : ""}</div> : null}
                                {item.openNow != null ? <div style={{ ...chipStyle, background: item.openNow ? "#f0fdf4" : "#fef2f2", color: item.openNow ? "#16a34a" : "#dc2626", border: `1px solid ${item.openNow ? "#bbf7d0" : "#fecaca"}` }}>{item.openNow ? "🟢 営業中" : "🔴 営業時間外"}</div> : null}
                                {item.distanceText ? <div style={chipStyle}>📍 {item.distanceText}</div> : null}
                              </div>
                              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                                {item.mapUrl && (
                                  <a href={item.mapUrl} target="_blank" rel="noopener noreferrer"
                                    style={{ display: "inline-block", padding: "10px 20px", borderRadius: "999px", background: "linear-gradient(135deg, #d97706, #b45309)", color: "#fff", fontSize: "14px", fontWeight: 900, textDecoration: "none" }}>
                                    Google マップで見る →
                                  </a>
                                )}
                                <button onClick={() => toggleVisited(item.title)} style={{ padding: "10px 16px", borderRadius: "999px", border: visited ? "none" : "1.5px solid #d1d5db", background: visited ? "#16a34a" : "transparent", color: visited ? "#fff" : "#6b7280", fontSize: "13px", fontWeight: 900, cursor: "pointer" }}>
                                  {visited ? "✅ 行った！" : "🗺️ 行った！"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </>
                )}

                {/* ── ドライブローディング ── */}

                {isLoadingDrive && (
                  <div style={{ background: "linear-gradient(135deg, #e3f2fd 0%, #d0e8fa 100%)", borderRadius: "24px", border: "1px solid #90caf9", padding: "32px 24px", marginBottom: "20px", textAlign: "center" }}>
                    <div style={{ width: "56px", height: "56px", borderRadius: "999px", border: "5px solid #90caf9", borderTopColor: "#1976d2", margin: "0 auto 20px", animation: "moodgo-spin 0.9s linear infinite" }} />
                    <div style={{ fontWeight: 900, fontSize: "16px", color: "#0d2a5e", marginBottom: "8px" }}>ドライブスポットを探しています</div>
                    <div style={{ fontSize: "13px", color: "#1565c0" }}>Google・Yahooでリアルタイム検索中...</div>
                  </div>
                )}

                {/* ── ドライブ結果リスト ── */}
                {driveFacilities && !isLoadingDrive && (!selectedPrefecture || prefFilteredFacilities === null || isLoadingPrefFilter) && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                      <span style={{ background: "linear-gradient(135deg, #e3f2fd, #d0e8fa)", border: "1px solid #90caf9", borderRadius: "999px", padding: "4px 14px", fontSize: "13px", fontWeight: 900, color: "#0d47a1" }}>
                        {driveSubCategoryLabel}
                      </span>
                      <span style={{ fontSize: "13px", color: "#1565c0", fontWeight: 700 }}>{driveFacilities.length}件</span>
                    </div>
                    {(() => {
                      const visible = sortFacilities(driveFacilities.filter(f => !allBlockedSet.has(f.name) && (!filterOpenNow || f.openNow === true)));
                      if (visible.length === 0) return (
                        <div style={{ background: "#f8fbff", borderRadius: "24px", border: "1px solid #90caf9", padding: "32px 24px", textAlign: "center", marginBottom: "20px" }}>
                          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🚗</div>
                          <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "8px", color: "#0d2a5e" }}>スポットが見つかりませんでした</div>
                          <div style={{ fontSize: "14px", color: "#1565c0" }}>検索範囲を広げるか、エリアを変更してください。</div>
                        </div>
                      );
                      return visible.map((fac, idx) => {
                        const photoList = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
                        const item: Recommendation = {
                          title:            fac.name,
                          address:          fac.address,
                          mapUrl:           fac.googleMapsUrl,
                          rating:           fac.rating,
                          userRatingCount:  fac.reviewCount,
                          photoUrl:         fac.imageUrl || undefined,
                          photoUrls:        photoList,
                          openNow:          fac.openNow ?? undefined,
                          openingHoursText: fac.openingHours ?? undefined,
                          priceLevel:       fac.priceLevel ?? undefined,
                          features:         [driveSubCategoryLabel],
                          distanceText:     fac.distanceInfo || undefined,
                          stationText:      fac.stationInfo  || undefined,
                        };
                        const favorited = isFavorited(item.title);
                        const visited = visitedPlaces.includes(item.title);
                        return (
                          <div key={`${item.title}-${idx}`} style={resultCardStyle} className="result-card">
                            <div style={{ position: "relative" }}>
                              {(item.photoUrls?.length ?? 0) > 0 ? (() => {
                                const photos = item.photoUrls!;
                                const pi = photoIndices[item.title] ?? 0;
                                return (
                                  <div className="result-card-photo" style={{ position: "relative", height: "220px", overflow: "hidden" }}>
                                    <img src={photos[pi]} alt={`${item.title} ${pi + 1}`} onClick={() => setLightboxSrc(photos[pi])} style={{ width: "100%", height: "220px", objectFit: "cover", display: "block", cursor: "zoom-in" }} />
                                    {pi > 0 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi - 1 })); }} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>‹</button>}
                                    {pi < photos.length - 1 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi + 1 })); }} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>›</button>}
                                    {photos.length > 1 && <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "5px" }}>{photos.map((_, di) => <div key={di} style={{ width: "6px", height: "6px", borderRadius: "999px", background: di === pi ? "#fff" : "rgba(255,255,255,0.45)" }} />)}</div>}
                                  </div>
                                );
                              })() : (
                                <div className="result-card-photo" style={{ width: "100%", height: "220px", background: "linear-gradient(135deg, #e3f2fd 0%, #d0e8fa 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "56px" }}>🚗</div>
                              )}
                              <button onClick={() => toggleFavorite(item)} style={{ position: "absolute", top: "14px", right: "14px", width: "48px", height: "48px", borderRadius: "999px", border: "none", background: favorited ? "#1976d2" : "rgba(255,255,255,0.92)", color: favorited ? "#ffffff" : "#1976d2", fontSize: "24px", cursor: "pointer", boxShadow: "0 10px 20px rgba(13,74,136,0.16)" }}>{favorited ? "♥" : "♡"}</button>
                              <button onClick={() => { setReportingSpot({ title: item.title, address: item.address ?? "" }); setReportReason(""); setReportNote(""); setReportDone(false); }} style={{ position: "absolute", top: "14px", left: "14px", height: "30px", padding: "0 10px", borderRadius: "999px", border: "none", background: "rgba(220,38,38,0.82)", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>🚩 報告</button>
                              {visited && <div style={{ position: "absolute", top: "14px", right: "70px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}
                            </div>
                            <div className="result-card-body" style={{ padding: "20px 18px 18px" }}>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                                <div className="result-title" style={{ fontWeight: 900, fontSize: "28px", lineHeight: 1.2, letterSpacing: "-0.03em", flex: 1 }}>{item.title}</div>
                              </div>
                              {fac.description && (
                                <div style={{ fontSize: "14px", color: "#1565c0", fontWeight: 700, marginBottom: "8px" }}>🚗 {fac.description}</div>
                              )}
                              {item.address ? <div style={{ fontSize: "14px", opacity: 0.76, marginBottom: "12px" }}>{item.address}</div> : null}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                {item.rating !== null && item.rating !== undefined ? <div style={chipStyle}>⭐ {item.rating}{item.userRatingCount ? ` (${item.userRatingCount})` : ""}</div> : null}
                                {item.openNow !== undefined || item.openingHoursText ? (
                                  <div style={getOpeningChipStyle(item.openNow)}>
                                    🕒 {item.openNow === true ? "営業中" : item.openNow === false ? "閉店中" : "営業時間あり"}
                                  </div>
                                ) : null}
                              </div>
                              <div style={{ display: "grid", gap: "10px", marginBottom: "18px" }}>
                                {item.openingHoursText || item.openNow !== undefined ? (
                                  <div style={{ ...infoLineStyle, alignItems: "flex-start" }}>
                                    <span style={{ fontSize: "20px", flexShrink: 0 }}>🕒</span>
                                    <span style={{ whiteSpace: "pre-line", lineHeight: 1.7 }}>{formatOpeningHours(item.openingHoursText) || (item.openNow ? "営業中" : "閉店中")}</span>
                                  </div>
                                ) : null}
                                {item.stationText ? (
                                  <div style={infoLineStyle}><span style={{ fontSize: "20px" }}>🚉</span><span>{item.stationText}</span></div>
                                ) : null}
                                {item.distanceText ? (
                                  <div style={infoLineStyle}><span style={{ fontSize: "20px" }}>📍</span><span>{item.distanceText}</span></div>
                                ) : null}
                              </div>
                              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                                {item.mapUrl ? (
                                  <a href={item.mapUrl} target="_blank" rel="noreferrer" style={{ height: "52px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, #1976d2 0%, #0d47a1 100%)", color: "#ffffff", fontSize: "15px", fontWeight: 900, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px", boxShadow: "0 10px 22px rgba(13,71,161,0.22)" }}>
                                    Googleマップで見る
                                  </a>
                                ) : null}
                                <button onClick={() => toggleVisited(item.title)} style={{ padding: "10px 16px", borderRadius: "999px", border: visited ? "none" : "1.5px solid #d1d5db", background: visited ? "#16a34a" : "transparent", color: visited ? "#fff" : "#6b7280", fontSize: "13px", fontWeight: 900, cursor: "pointer" }}>
                                  {visited ? "✅ 行った！" : "🗺️ 行った！"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </>
                )}

                {/* ── わいわいローディング ── */}
                {isLoadingWaiWai && (
                  <div style={{ background: "linear-gradient(135deg, #fff0f8 0%, #ffe8f5 100%)", borderRadius: "24px", border: "1px solid #ffb3d9", padding: "32px 24px", marginBottom: "20px", textAlign: "center" }}>
                    <div style={{ width: "56px", height: "56px", borderRadius: "999px", border: "5px solid #ffb3d9", borderTopColor: "#ff4da6", margin: "0 auto 20px", animation: "moodgo-spin 0.9s linear infinite" }} />
                    <div style={{ fontWeight: 900, fontSize: "16px", color: "#4a0030", marginBottom: "8px" }}>わいわいスポットを探しています</div>
                    <div style={{ fontSize: "13px", color: "#9a2060" }}>Yahoo・Google・HotPepperでリアルタイム検索中...</div>
                  </div>
                )}

                {/* ── わいわい結果リスト ── */}
                {waiWaiFacilities && !isLoadingWaiWai && (!selectedPrefecture || prefFilteredFacilities === null || isLoadingPrefFilter) && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                      <span style={{ background: "linear-gradient(135deg, #ffe8f5, #ffd0ec)", border: "1px solid #ffb3d9", borderRadius: "999px", padding: "4px 14px", fontSize: "13px", fontWeight: 900, color: "#c0186a" }}>
                        {waiWaiSubCategoryLabel}
                      </span>
                      <span style={{ fontSize: "13px", color: "#9a2060", fontWeight: 700 }}>{waiWaiFacilities.length}件</span>
                    </div>
                    {(() => {
                      const visible = sortFacilities(waiWaiFacilities.filter(f => !allBlockedSet.has(f.name) && (!filterOpenNow || f.openNow === true)));
                      if (visible.length === 0) return (
                        <div style={{ background: "#fffaf8", borderRadius: "24px", border: "1px solid #ffb3d9", padding: "32px 24px", textAlign: "center", marginBottom: "20px" }}>
                          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🎉</div>
                          <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "8px", color: "#4a0030" }}>スポットが見つかりませんでした</div>
                          <div style={{ fontSize: "14px", color: "#9a2060" }}>検索範囲を広げるか、エリアを変更してください。</div>
                        </div>
                      );
                      return visible.map((fac, idx) => {
                        const photoList = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
                        const item: Recommendation = {
                          title:            fac.name,
                          address:          fac.address,
                          mapUrl:           fac.googleMapsUrl,
                          rating:           fac.rating,
                          userRatingCount:  fac.reviewCount,
                          photoUrl:         fac.imageUrl || undefined,
                          photoUrls:        photoList,
                          openNow:          fac.openNow ?? undefined,
                          openingHoursText: fac.openingHours ?? undefined,
                          priceLevel:       fac.priceLevel ?? undefined,
                          features:         [waiWaiSubCategoryLabel],
                          distanceText:     fac.distanceInfo || undefined,
                          stationText:      fac.stationInfo  || undefined,
                        };
                        const favorited = isFavorited(item.title);
                        const visited = visitedPlaces.includes(item.title);
                        return (
                          <div key={`${item.title}-${idx}`} style={resultCardStyle} className="result-card">
                            <div style={{ position: "relative" }}>
                              {(item.photoUrls?.length ?? 0) > 0 ? (() => {
                                const photos = item.photoUrls!;
                                const pi = photoIndices[item.title] ?? 0;
                                return (
                                  <div className="result-card-photo" style={{ position: "relative", height: "220px", overflow: "hidden" }}>
                                    <img src={photos[pi]} alt={`${item.title} ${pi + 1}`} onClick={() => setLightboxSrc(photos[pi])} style={{ width: "100%", height: "220px", objectFit: "cover", display: "block", cursor: "zoom-in" }} />
                                    {pi > 0 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi - 1 })); }} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>‹</button>}
                                    {pi < photos.length - 1 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi + 1 })); }} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>›</button>}
                                    {photos.length > 1 && <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "5px" }}>{photos.map((_, di) => <div key={di} style={{ width: "6px", height: "6px", borderRadius: "999px", background: di === pi ? "#fff" : "rgba(255,255,255,0.45)" }} />)}</div>}
                                  </div>
                                );
                              })() : (
                                <div className="result-card-photo" style={{ width: "100%", height: "220px", background: "linear-gradient(135deg, #ffe8f5 0%, #ffd0ec 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "56px" }}>🎉</div>
                              )}
                              <button onClick={() => toggleFavorite(item)} style={{ position: "absolute", top: "14px", right: "14px", width: "48px", height: "48px", borderRadius: "999px", border: "none", background: favorited ? "#ff8fa5" : "rgba(255,255,255,0.92)", color: favorited ? "#ffffff" : "#ff8fa5", fontSize: "24px", cursor: "pointer", boxShadow: "0 10px 20px rgba(74,48,52,0.16)" }}>{favorited ? "♥" : "♡"}</button>
                              <button onClick={() => { setReportingSpot({ title: item.title, address: item.address ?? "" }); setReportReason(""); setReportNote(""); setReportDone(false); }} style={{ position: "absolute", top: "14px", left: "14px", height: "30px", padding: "0 10px", borderRadius: "999px", border: "none", background: "rgba(220,38,38,0.82)", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>🚩 報告</button>
                              {visited && <div style={{ position: "absolute", top: "14px", right: "70px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}
                            </div>
                            <div className="result-card-body" style={{ padding: "20px 18px 18px" }}>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                                <div className="result-title" style={{ fontWeight: 900, fontSize: "28px", lineHeight: 1.2, letterSpacing: "-0.03em", flex: 1 }}>{item.title}</div>
                              </div>
                              {fac.description && (
                                <div style={{ fontSize: "14px", color: "#c0186a", fontWeight: 700, marginBottom: "8px" }}>✨ {fac.description}</div>
                              )}
                              {item.address ? <div style={{ fontSize: "14px", opacity: 0.76, marginBottom: "12px" }}>{item.address}</div> : null}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                {item.rating !== null && item.rating !== undefined ? <div style={chipStyle}>⭐ {item.rating}{item.userRatingCount ? ` (${item.userRatingCount})` : ""}</div> : null}
                                {item.openNow !== undefined || item.openingHoursText ? (
                                  <div style={getOpeningChipStyle(item.openNow)}>
                                    🕒 {item.openNow === true ? "営業中" : item.openNow === false ? "閉店中" : "営業時間あり"}
                                  </div>
                                ) : null}
                              </div>
                              <div style={{ display: "grid", gap: "10px", marginBottom: "18px" }}>
                                {item.openingHoursText || item.openNow !== undefined ? (
                                  <div style={{ ...infoLineStyle, alignItems: "flex-start" }}>
                                    <span style={{ fontSize: "20px", flexShrink: 0 }}>🕒</span>
                                    <span style={{ whiteSpace: "pre-line", lineHeight: 1.7 }}>{formatOpeningHours(item.openingHoursText) || (item.openNow ? "営業中" : "閉店中")}</span>
                                  </div>
                                ) : null}
                                {item.stationText ? (
                                  <div style={infoLineStyle}><span style={{ fontSize: "20px" }}>🚉</span><span>{item.stationText}</span></div>
                                ) : null}
                                {item.distanceText ? (
                                  <div style={infoLineStyle}><span style={{ fontSize: "20px" }}>📍</span><span>{item.distanceText}</span></div>
                                ) : null}
                              </div>
                              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                                {item.mapUrl ? (
                                  <a href={item.mapUrl} target="_blank" rel="noreferrer" style={{ height: "52px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, #ff4da6 0%, #c0186a 100%)", color: "#ffffff", fontSize: "15px", fontWeight: 900, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px", boxShadow: "0 10px 22px rgba(192,24,106,0.2)" }}>
                                    Googleマップで見る
                                  </a>
                                ) : null}
                                <button onClick={() => toggleVisited(item.title)} style={{ padding: "10px 16px", borderRadius: "999px", border: visited ? "none" : "1.5px solid #d1d5db", background: visited ? "#16a34a" : "transparent", color: visited ? "#fff" : "#6b7280", fontSize: "13px", fontWeight: 900, cursor: "pointer" }}>
                                  {visited ? "✅ 行った！" : "🗺️ 行った！"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </>
                )}

                {/* ── 自然ローディング ── */}
                {isLoadingNature && (
                  <div style={{ background: "linear-gradient(135deg, #f1f8e9 0%, #e8f5e9 100%)", borderRadius: "24px", border: "1px solid #c5e1a5", padding: "32px 24px", marginBottom: "20px", textAlign: "center" }}>
                    <div style={{ width: "56px", height: "56px", borderRadius: "999px", border: "5px solid #c5e1a5", borderTopColor: "#66bb6a", margin: "0 auto 20px", animation: "moodgo-spin 0.9s linear infinite" }} />
                    <div style={{ fontWeight: 900, fontSize: "16px", color: "#2e4a2e", marginBottom: "8px" }}>自然スポットを探しています</div>
                    <div style={{ fontSize: "13px", color: "#558b5e" }}>Google マップでリアルタイム検索中...</div>
                  </div>
                )}

                {/* ── 自然結果リスト ── */}
                {natureFacilities && !isLoadingNature && (!selectedPrefecture || prefFilteredFacilities === null || isLoadingPrefFilter) && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                      <span style={{ background: "linear-gradient(135deg, #e8f5e9, #dcedc8)", border: "1px solid #aed581", borderRadius: "999px", padding: "4px 14px", fontSize: "13px", fontWeight: 900, color: "#33691e" }}>
                        {natureSubGenreLabel}
                      </span>
                      <span style={{ fontSize: "13px", color: "#558b5e", fontWeight: 700 }}>{natureFacilities.length}件</span>
                    </div>
                    {(() => {
                      const visible = sortFacilities(natureFacilities.filter(f => !allBlockedSet.has(f.name) && (!filterOpenNow || f.openNow === true)));
                      if (visible.length === 0) return (
                        <div style={{ background: "#fafff9", borderRadius: "24px", border: "1px solid #c8e6c9", padding: "32px 24px", textAlign: "center", marginBottom: "20px" }}>
                          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🌿</div>
                          <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "8px", color: "#2e4a2e" }}>スポットが見つかりませんでした</div>
                          <div style={{ fontSize: "14px", color: "#558b5e" }}>検索範囲を広げるか、エリアを変更してください。</div>
                        </div>
                      );
                      return visible.map((fac, idx) => {
                        const photoList = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
                        const item: Recommendation = {
                          title:            fac.name,
                          address:          fac.address,
                          mapUrl:           fac.googleMapsUrl,
                          rating:           fac.rating,
                          userRatingCount:  fac.reviewCount,
                          photoUrl:         fac.imageUrl || undefined,
                          photoUrls:        photoList,
                          openNow:          fac.openNow ?? undefined,
                          openingHoursText: fac.openingHours ?? undefined,
                          priceLevel:       fac.priceLevel ?? undefined,
                          features:         [natureSubGenreLabel],
                          distanceText:     fac.distanceInfo || undefined,
                          stationText:      fac.stationInfo  || undefined,
                        };
                        const favorited = isFavorited(item.title);
                        const visited = visitedPlaces.includes(item.title);
                        return (
                          <div key={`${item.title}-${idx}`} style={resultCardStyle} className="result-card">
                            <div style={{ position: "relative" }}>
                              {(item.photoUrls?.length ?? 0) > 0 ? (() => {
                                const photos = item.photoUrls!;
                                const pi = photoIndices[item.title] ?? 0;
                                return (
                                  <div className="result-card-photo" style={{ position: "relative", height: "220px", overflow: "hidden" }}>
                                    <img src={photos[pi]} alt={`${item.title} ${pi + 1}`} onClick={() => setLightboxSrc(photos[pi])} style={{ width: "100%", height: "220px", objectFit: "cover", display: "block", cursor: "zoom-in" }} />
                                    {pi > 0 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi - 1 })); }} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>‹</button>}
                                    {pi < photos.length - 1 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi + 1 })); }} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>›</button>}
                                    {photos.length > 1 && <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "5px" }}>{photos.map((_, di) => <div key={di} style={{ width: "6px", height: "6px", borderRadius: "999px", background: di === pi ? "#fff" : "rgba(255,255,255,0.45)" }} />)}</div>}
                                  </div>
                                );
                              })() : (
                                <div className="result-card-photo" style={{ width: "100%", height: "220px", background: "linear-gradient(135deg, #e8f5e9 0%, #dcedc8 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "56px" }}>🌿</div>
                              )}
                              <button onClick={() => toggleFavorite(item)} style={{ position: "absolute", top: "14px", right: "14px", width: "48px", height: "48px", borderRadius: "999px", border: "none", background: favorited ? "#ff8fa5" : "rgba(255,255,255,0.92)", color: favorited ? "#ffffff" : "#ff8fa5", fontSize: "24px", cursor: "pointer", boxShadow: "0 10px 20px rgba(74,48,52,0.16)" }}>{favorited ? "♥" : "♡"}</button>
                              <button onClick={() => { setReportingSpot({ title: item.title, address: item.address ?? "" }); setReportReason(""); setReportNote(""); setReportDone(false); }} style={{ position: "absolute", top: "14px", left: "14px", height: "30px", padding: "0 10px", borderRadius: "999px", border: "none", background: "rgba(220,38,38,0.82)", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>🚩 報告</button>
                              {visited && <div style={{ position: "absolute", top: "14px", right: "70px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}
                            </div>
                            <div className="result-card-body" style={{ padding: "20px 18px 18px" }}>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                                <div className="result-title" style={{ fontWeight: 900, fontSize: "28px", lineHeight: 1.2, letterSpacing: "-0.03em", flex: 1 }}>{item.title}</div>
                              </div>
                              {item.address ? <div style={{ fontSize: "14px", opacity: 0.76, marginBottom: "12px" }}>{item.address}</div> : null}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                {item.rating !== null && item.rating !== undefined ? <div style={chipStyle}>⭐ {item.rating}{item.userRatingCount ? ` (${item.userRatingCount})` : ""}</div> : null}
                                {item.openNow !== undefined || item.openingHoursText ? (
                                  <div style={getOpeningChipStyle(item.openNow)}>
                                    🕒 {item.openNow === true ? "営業中" : item.openNow === false ? "閉店中" : "営業時間あり"}
                                  </div>
                                ) : null}
                              </div>
                              <div style={{ display: "grid", gap: "10px", marginBottom: "18px" }}>
                                {item.openingHoursText || item.openNow !== undefined ? (
                                  <div style={{ ...infoLineStyle, alignItems: "flex-start" }}>
                                    <span style={{ fontSize: "20px", flexShrink: 0 }}>🕒</span>
                                    <span style={{ whiteSpace: "pre-line", lineHeight: 1.7 }}>
                                      {formatOpeningHours(item.openingHoursText) || (item.openNow ? "営業中" : "閉店中")}
                                    </span>
                                  </div>
                                ) : null}
                                {item.distanceText ? (
                                  <div style={infoLineStyle}><span style={{ fontSize: "20px" }}>📍</span><span>{item.distanceText}</span></div>
                                ) : null}
                              </div>
                              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                                {item.mapUrl ? (
                                  <a href={item.mapUrl} target="_blank" rel="noreferrer" style={{ height: "52px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, #4184ff 0%, #2a6fe6 100%)", color: "#ffffff", fontSize: "15px", fontWeight: 900, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px", boxShadow: "0 10px 22px rgba(42,111,230,0.2)" }}>
                                    Googleマップで見る
                                  </a>
                                ) : null}
                                <button onClick={() => toggleVisited(item.title)} style={{ padding: "10px 16px", borderRadius: "999px", border: visited ? "none" : "1.5px solid #d1d5db", background: visited ? "#16a34a" : "transparent", color: visited ? "#fff" : "#6b7280", fontSize: "13px", fontWeight: 900, cursor: "pointer" }}>
                                  {visited ? "✅ 行った！" : "🗺️ 行った！"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </>
                )}

                {/* ── カフェローディング ── */}
                {isLoadingCafe && (
                  <div style={{ background: "linear-gradient(135deg, #fffde7 0%, #fff8e1 100%)", borderRadius: "24px", border: "1px solid #ffe082", padding: "32px 24px", marginBottom: "20px", textAlign: "center" }}>
                    <div style={{ width: "56px", height: "56px", borderRadius: "999px", border: "5px solid #ffe082", borderTopColor: "#ffb300", margin: "0 auto 20px", animation: "moodgo-spin 0.9s linear infinite" }} />
                    <style>{`@keyframes moodgo-spin{to{transform:rotate(360deg)}}`}</style>
                    <div style={{ fontWeight: 900, fontSize: "16px", color: "#4a3000", marginBottom: "8px" }}>カフェを探しています</div>
                    <div style={{ fontSize: "13px", color: "#8a6500" }}>Google でリアルタイム検索中...</div>
                  </div>
                )}

                {/* ── カフェ結果リスト ── */}
                {cafeFacilities && !isLoadingCafe && (!selectedPrefecture || prefFilteredFacilities === null || isLoadingPrefFilter) && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                      <span style={{ background: "linear-gradient(135deg, #fff8e1, #fff3cc)", border: "1px solid #ffe082", borderRadius: "999px", padding: "4px 14px", fontSize: "13px", fontWeight: 900, color: "#e65100" }}>
                        {cafeSubCategoryLabel}
                      </span>
                      <span style={{ fontSize: "13px", color: "#8a6500", fontWeight: 700 }}>{cafeFacilities.length}件</span>
                    </div>
                    {(() => {
                      const visible = sortFacilities(cafeFacilities.filter(f => !allBlockedSet.has(f.name) && (!filterOpenNow || f.openNow === true)));
                      if (visible.length === 0) return (
                        <div style={{ background: "#fffdf5", borderRadius: "24px", border: "1px solid #ffe082", padding: "32px 24px", textAlign: "center", marginBottom: "20px" }}>
                          <div style={{ fontSize: "40px", marginBottom: "12px" }}>☕</div>
                          <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "8px", color: "#4a3000" }}>カフェが見つかりませんでした</div>
                          <div style={{ fontSize: "14px", color: "#8a6500" }}>検索範囲を広げるか、エリアを変更してください。</div>
                        </div>
                      );
                      return visible.map((fac, idx) => {
                        const photoList = (fac.photoUrls ?? []).length > 0 ? fac.photoUrls : fac.imageUrl ? [fac.imageUrl] : [];
                        const item: Recommendation = {
                          title:            fac.name,
                          address:          fac.address,
                          mapUrl:           fac.googleMapsUrl,
                          rating:           fac.rating,
                          userRatingCount:  fac.reviewCount,
                          photoUrl:         fac.imageUrl || undefined,
                          photoUrls:        photoList,
                          openNow:          fac.openNow ?? undefined,
                          openingHoursText: fac.openingHours ?? undefined,
                          priceLevel:       fac.priceLevel ?? undefined,
                          features:         [cafeSubCategoryLabel],
                          distanceText:     fac.distanceInfo || undefined,
                          stationText:      fac.stationInfo  || undefined,
                          source:           fac.source,
                          hotpepperUrl:     fac.hotpepperUrl,
                        };
                        const favorited = isFavorited(item.title);
                        const visited = visitedPlaces.includes(item.title);
                        return (
                          <div key={`${item.title}-${idx}`} style={resultCardStyle} className="result-card">
                            <div style={{ position: "relative" }}>
                              {(item.photoUrls?.length ?? 0) > 0 ? (() => {
                                const photos = item.photoUrls!;
                                const pi = photoIndices[item.title] ?? 0;
                                return (
                                  <div className="result-card-photo" style={{ position: "relative", height: "220px", overflow: "hidden" }}>
                                    <img src={photos[pi]} alt={`${item.title} ${pi + 1}`} onClick={() => setLightboxSrc(photos[pi])} style={{ width: "100%", height: "220px", objectFit: "cover", display: "block", cursor: "zoom-in" }} />
                                    {pi > 0 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi - 1 })); }} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>‹</button>}
                                    {pi < photos.length - 1 && <button onClick={(e) => { e.stopPropagation(); setPhotoIndices(prev => ({ ...prev, [item.title]: pi + 1 })); }} style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer" }}>›</button>}
                                    {photos.length > 1 && <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "5px" }}>{photos.map((_, di) => <div key={di} style={{ width: "6px", height: "6px", borderRadius: "999px", background: di === pi ? "#fff" : "rgba(255,255,255,0.45)" }} />)}</div>}
                                  </div>
                                );
                              })() : (
                                <div className="result-card-photo" style={{ width: "100%", height: "220px", background: "linear-gradient(135deg, #fff8e1 0%, #ffe082 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "56px" }}>☕</div>
                              )}
                              <button onClick={() => toggleFavorite(item)} style={{ position: "absolute", top: "14px", right: "14px", width: "48px", height: "48px", borderRadius: "999px", border: "none", background: favorited ? "#ff8fa5" : "rgba(255,255,255,0.92)", color: favorited ? "#ffffff" : "#ff8fa5", fontSize: "24px", cursor: "pointer", boxShadow: "0 10px 20px rgba(74,48,52,0.16)" }}>{favorited ? "♥" : "♡"}</button>
                              <button onClick={() => { setReportingSpot({ title: item.title, address: item.address ?? "" }); setReportReason(""); setReportNote(""); setReportDone(false); }} style={{ position: "absolute", top: "14px", left: "14px", height: "30px", padding: "0 10px", borderRadius: "999px", border: "none", background: "rgba(220,38,38,0.82)", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>🚩 報告</button>
                              {visited && <div style={{ position: "absolute", top: "14px", right: "70px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}
                            </div>
                            <div className="result-card-body" style={{ padding: "20px 18px 18px" }}>
                              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                                <div className="result-title" style={{ fontWeight: 900, fontSize: "28px", lineHeight: 1.2, letterSpacing: "-0.03em", flex: 1 }}>{item.title}</div>
                              </div>
                              {item.address ? <div style={{ fontSize: "14px", opacity: 0.76, marginBottom: "12px" }}>{item.address}</div> : null}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                {item.rating !== null && item.rating !== undefined ? <div style={chipStyle}>⭐ {item.rating}{item.userRatingCount ? ` (${item.userRatingCount})` : ""}</div> : null}
                                {item.openNow !== undefined || item.openingHoursText ? (
                                  <div style={getOpeningChipStyle(item.openNow)}>
                                    🕒 {item.openNow === true ? "営業中" : item.openNow === false ? "閉店中" : "営業時間あり"}
                                  </div>
                                ) : null}
                              </div>
                              <div style={{ display: "grid", gap: "10px", marginBottom: "18px" }}>
                                {item.openingHoursText || item.openNow !== undefined ? (
                                  <div style={{ ...infoLineStyle, alignItems: "flex-start" }}>
                                    <span style={{ fontSize: "20px", flexShrink: 0 }}>🕒</span>
                                    <span style={{ whiteSpace: "pre-line", lineHeight: 1.7 }}>
                                      {formatOpeningHours(item.openingHoursText) || (item.openNow ? "営業中" : "閉店中")}
                                    </span>
                                  </div>
                                ) : null}
                                {item.distanceText ? (
                                  <div style={infoLineStyle}><span style={{ fontSize: "20px" }}>📍</span><span>{item.distanceText}</span></div>
                                ) : null}
                                {item.hotpepperUrl ? (
                                  <div style={infoLineStyle}><span style={{ fontSize: "20px" }}>🍽️</span><a href={item.hotpepperUrl} target="_blank" rel="noreferrer" style={{ color: "#e65100", fontWeight: 700, textDecoration: "underline" }}>ホットペッパーで見る</a></div>
                                ) : null}
                              </div>
                              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                                {item.mapUrl ? (
                                  <a href={item.mapUrl} target="_blank" rel="noreferrer" style={{ height: "52px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, #4184ff 0%, #2a6fe6 100%)", color: "#ffffff", fontSize: "15px", fontWeight: 900, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px", boxShadow: "0 10px 22px rgba(42,111,230,0.2)" }}>
                                    Googleマップで見る
                                  </a>
                                ) : null}
                                <button onClick={() => toggleVisited(item.title)} style={{ padding: "10px 16px", borderRadius: "999px", border: visited ? "none" : "1.5px solid #d1d5db", background: visited ? "#16a34a" : "transparent", color: visited ? "#fff" : "#6b7280", fontSize: "13px", fontWeight: 900, cursor: "pointer" }}>
                                  {visited ? "✅ 行った！" : "🗺️ 行った！"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </>
                )}

                {/* ── 温泉ローディング ── */}
                {isLoadingOnsen && (
                  <div style={{ background: "linear-gradient(135deg, #fff8f2 0%, #fff2e8 100%)", borderRadius: "24px", border: "1px solid #ffddc0", padding: "32px 24px", marginBottom: "20px", textAlign: "center" }}>
                    <div style={{ width: "56px", height: "56px", borderRadius: "999px", border: "5px solid #ffddc0", borderTopColor: "#ff8f40", margin: "0 auto 20px", animation: "moodgo-spin 0.9s linear infinite" }} />
                    <style>{`@keyframes moodgo-spin{to{transform:rotate(360deg)}}`}</style>
                    <div style={{ fontWeight: 900, fontSize: "16px", color: "#4a3034", marginBottom: "8px" }}>温泉・スパを探しています</div>
                    <div style={{ fontSize: "13px", color: "#a07040" }}>Yahoo!ローカルサーチ + Google でリアルタイム検索中...</div>
                  </div>
                )}

                {/* ── 温泉結果リスト ── */}
                {onsenFacilities && !isLoadingOnsen && (!selectedPrefecture || prefFilteredFacilities === null || isLoadingPrefFilter) && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                      <span style={{ background: "linear-gradient(135deg, #fff3e0, #ffe0b2)", border: "1px solid #ffcc80", borderRadius: "999px", padding: "4px 14px", fontSize: "13px", fontWeight: 900, color: "#a04800" }}>
                        ♨️ {onsenCategoryLabel}
                      </span>
                      <span style={{ fontSize: "13px", color: "#9b7060", fontWeight: 700 }}>{onsenFacilities.length}件</span>
                    </div>
                    {(() => { const visibleOnsen = sortFacilities(onsenFacilities.filter(f => !allBlockedSet.has(f.name) && (!filterOpenNow || f.openNow === true))); return visibleOnsen.length === 0 ? (
                      <div style={{ background: "#fffaf8", borderRadius: "24px", border: "1px solid #f0dfe3", padding: "32px 24px", textAlign: "center", marginBottom: "20px" }}>
                        <div style={{ fontSize: "40px", marginBottom: "12px" }}>😢</div>
                        <div style={{ fontWeight: 900, color: "#4a3034", marginBottom: "8px" }}>施設が見つかりませんでした</div>
                        <div style={{ fontSize: "13px", color: "#9b7080" }}>検索範囲を広げるか、エリアを変更してください。</div>
                      </div>
                    ) : (
                      <div className="result-list" style={{ display: "grid", gap: "18px", marginBottom: "24px" }}>
                        {visibleOnsen.map((fac, idx) => {
                          // PlaceResponse → Recommendation 変換（グルメ画面と完全統一）
                          const photoList = (fac.photoUrls ?? []).length > 0
                            ? fac.photoUrls
                            : fac.imageUrl ? [fac.imageUrl] : [];
                          const item: Recommendation = {
                            title:            fac.name,
                            reason:           fac.description || undefined,   // ✨ AIおすすめ理由
                            address:          fac.address,
                            mapUrl:           fac.googleMapsUrl,
                            rating:           fac.rating,
                            userRatingCount:  fac.reviewCount,
                            photoUrl:         fac.imageUrl || undefined,
                            photoUrls:        photoList,
                            openNow:          fac.openNow ?? undefined,
                            openingHoursText: fac.openingHours ?? undefined,
                            priceLevel:       fac.priceLevel ?? undefined,
                            vibe:             undefined,                        // summaryなし
                            features:         fac.category ? [fac.category] : [], // カテゴリタグ
                            distanceText:     fac.distanceInfo || undefined,
                            stationText:      fac.stationInfo  || undefined,   // 最寄り駅
                          };
                          const favorited = isFavorited(item.title);
                          const visited = visitedPlaces.includes(item.title);
                          return (
                            <div key={`${item.title}-${idx}`} style={resultCardStyle} className="result-card">
                              <div style={{ position: "relative" }}>
                                {(item.photoUrls?.length ?? 0) > 0 ? (() => {
                                  const photos = item.photoUrls!;
                                  const pi = photoIndices[item.title] ?? 0;
                                  const hasPrev = pi > 0;
                                  const hasNext = pi < photos.length - 1;
                                  return (
                                    <div className="result-card-photo" style={{ position: "relative", height: "220px", overflow: "hidden" }}>
                                      <img
                                        src={photos[pi]}
                                        alt={`${item.title} ${pi + 1}`}
                                        onClick={() => setLightboxSrc(photos[pi])}
                                        style={{ width: "100%", height: "220px", objectFit: "cover", display: "block", cursor: "zoom-in" }}
                                      />
                                      {hasPrev && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setPhotoIndices((prev) => ({ ...prev, [item.title]: pi - 1 })); }}
                                          style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                          aria-label="前の写真"
                                        >‹</button>
                                      )}
                                      {hasNext && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setPhotoIndices((prev) => ({ ...prev, [item.title]: pi + 1 })); }}
                                          style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                                          aria-label="次の写真"
                                        >›</button>
                                      )}
                                      {photos.length > 1 && (
                                        <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "5px" }}>
                                          {photos.map((_, di) => (
                                            <div key={di} style={{ width: "6px", height: "6px", borderRadius: "999px", background: di === pi ? "#fff" : "rgba(255,255,255,0.45)" }} />
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })() : (
                                  <div className="result-card-photo" style={{ width: "100%", height: "220px", background: "linear-gradient(135deg, #fff2ef 0%, #ffe3e8 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 900, color: "#8b6d72" }}>
                                    MoodGo recommendation
                                  </div>
                                )}
                                <button
                                  onClick={() => toggleFavorite(item)}
                                  style={{ position: "absolute", top: "14px", right: "14px", width: "48px", height: "48px", borderRadius: "999px", border: "none", background: favorited ? "#ff8fa5" : "rgba(255,255,255,0.92)", color: favorited ? "#ffffff" : "#ff8fa5", fontSize: "24px", fontWeight: 900, cursor: "pointer", boxShadow: "0 10px 20px rgba(74,48,52,0.16)" }}
                                  aria-label="お気に入り"
                                >
                                  {favorited ? "♥" : "♡"}
                                </button>
                                <button
                                  onClick={() => { if (window.confirm(`「${item.title}」を今後の結果から除外しますか？`)) blockPlace(item.title); }}
                                  style={{ position: "absolute", top: "14px", left: "14px", height: "30px", padding: "0 10px", borderRadius: "999px", border: "none", background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: "11px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", backdropFilter: "blur(4px)" }}
                                  aria-label="結果から除外"
                                >
                                  🚫 {lang === "en" ? "Hide" : "非表示"}
                                </button>
                                {visited && <div style={{ position: "absolute", top: "14px", right: "70px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}
                              </div>

                              <div className="result-card-body" style={{ padding: "20px 18px 18px" }}>
                                {(() => {
                                  const isEN = !!showEnglish[item.title];
                                  const tr = (translatedCards[item.title] ?? {}) as Record<string, unknown>;
                                  const displayTitle = isEN && tr.title ? String(tr.title) : item.title;
                                  const displayVibe = isEN && tr.vibe ? String(tr.vibe) : (item.vibe ?? "");
                                  const displayHours = formatOpeningHours(isEN && tr.openingHoursText ? String(tr.openingHoursText) : (item.openingHoursText ?? ""));
                                  return (
                                    <>
                                      {/* タイトル + EN翻訳ボタン */}
                                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                                        <div className="result-title" style={{ fontWeight: 900, fontSize: "34px", lineHeight: 1.15, letterSpacing: "-0.03em", flex: 1 }}>
                                          {displayTitle}
                                        </div>
                                        <button
                                          onClick={() => translateCard(item)}
                                          style={{ flexShrink: 0, height: "32px", padding: "0 14px", borderRadius: "999px", border: showEnglish[item.title] ? "2px solid #4184ff" : "1.5px solid #d0bfc2", background: showEnglish[item.title] ? "#4184ff" : "#fff", color: showEnglish[item.title] ? "#fff" : "#7a5860", fontSize: "12px", fontWeight: 900, cursor: "pointer", letterSpacing: "0.06em", marginTop: "6px" }}
                                          aria-label="英語に翻訳"
                                        >
                                          {translatingCards[item.title] ? "…" : showEnglish[item.title] ? "🌐 JP" : "🌐 EN"}
                                        </button>
                                      </div>

                                      {/* 住所 */}
                                      {item.address ? (
                                        <div style={{ fontSize: "14px", opacity: 0.76, marginBottom: "12px" }}>{item.address}</div>
                                      ) : null}

                                      {/* 概要 */}
                                      {displayVibe ? (
                                        <div style={{ fontSize: "15px", lineHeight: 1.7, marginBottom: "14px" }}>{displayVibe}</div>
                                      ) : null}

                                      {/* チップ行（レストランカードと統一） */}
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                        {(() => {
                                          const label = priceLevelLabel(item.priceLevel);
                                          return label ? (
                                            <div style={{ ...chipStyle, background: "#fff8e1", color: "#6d4c00", border: "1px solid #ffe082" }}>💴 {label}</div>
                                          ) : null;
                                        })()}
                                        {item.rating !== null && item.rating !== undefined ? (
                                          <div style={chipStyle}>⭐ {item.rating}{item.userRatingCount ? ` (${item.userRatingCount})` : ""}</div>
                                        ) : null}
                                        {item.openNow !== undefined || item.openingHoursText ? (
                                          <div style={getOpeningChipStyle(item.openNow)}>
                                            🕒 {item.openNow === true ? ((isEN || lang === "en") ? "Open now" : "営業中") : item.openNow === false ? ((isEN || lang === "en") ? "Closed" : "閉店中") : ((isEN || lang === "en") ? "Hours available" : "営業時間あり")}
                                          </div>
                                        ) : null}
                                      </div>

                                      {/* infoLine（レストランカードと同じ構造） */}
                                      <div style={{ display: "grid", gap: "10px", marginBottom: "18px" }}>
                                        {item.openingHoursText || item.openNow !== undefined ? (
                                          <div style={{ ...infoLineStyle, alignItems: "flex-start" }}>
                                            <span style={{ fontSize: "20px", flexShrink: 0 }}>🕒</span>
                                            <span style={{ whiteSpace: "pre-line", lineHeight: 1.7 }}>{displayHours || (item.openNow ? ((isEN || lang === "en") ? "Open now" : "営業中") : ((isEN || lang === "en") ? "Closed" : "閉店中"))}</span>
                                          </div>
                                        ) : null}
                                        {item.distanceText ? (
                                          <div style={infoLineStyle}>
                                            <span style={{ fontSize: "20px" }}>📍</span>
                                            <span>{item.distanceText}</span>
                                          </div>
                                        ) : null}
                                        {item.stationText ? (
                                          <div style={infoLineStyle}>
                                            <span style={{ fontSize: "20px" }}>🚉</span>
                                            <span>{item.stationText}</span>
                                          </div>
                                        ) : null}
                                      </div>
                                    </>
                                  );
                                })()}

                                {/* Googleマップボタン */}
                                <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" }}>
                                  {item.mapUrl ? (
                                    <a
                                      href={item.mapUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={() => setMapClickedInSession((prev) => prev.includes(item.title) ? prev : [...prev, item.title])}
                                      style={{ flex: 1, height: "52px", borderRadius: "999px", border: "none", background: "linear-gradient(135deg, #4184ff 0%, #2a6fe6 100%)", color: "#ffffff", fontSize: "15px", fontWeight: 900, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 22px rgba(42,111,230,0.2)", minWidth: "140px" }}
                                    >
                                      {lang === "en" ? "Open in Google Maps" : "Googleマップで見る"}
                                    </a>
                                  ) : null}
                                  <button onClick={() => toggleVisited(item.title)} style={{ padding: "10px 16px", borderRadius: "999px", border: visitedPlaces.includes(item.title) ? "none" : "1.5px solid #d1d5db", background: visitedPlaces.includes(item.title) ? "#16a34a" : "transparent", color: visitedPlaces.includes(item.title) ? "#fff" : "#6b7280", fontSize: "13px", fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap" }}>
                                    {visitedPlaces.includes(item.title) ? "✅ 行った！" : "🗺️ 行った！"}
                                  </button>
                                </div>

                                {/* 気分フィードバック */}
                                {(() => {
                                  const verdict = placeRatings[item.title];
                                  if (verdict) {
                                    return (
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "12px", borderRadius: "16px", background: verdict === "good" ? "#e9f8ef" : "#fce4e4", border: `1px solid ${verdict === "good" ? "#bfe7cc" : "#f5c0c8"}`, fontSize: "13px", fontWeight: 800, color: verdict === "good" ? "#18794e" : "#c0385a" }}>
                                        {verdict === "good" ? "👍 気になる！AIが覚えました" : "👎 興味なし。次回から除外します"}
                                      </div>
                                    );
                                  }
                                  return (
                                    <div style={{ borderTop: "1px solid #f5e8eb", paddingTop: "12px" }}>
                                      <div style={{ fontSize: "13px", fontWeight: 800, color: "#7a5860", marginBottom: "8px", textAlign: "center" }}>
                                        {answers.mood ? `「${answers.mood}」の気分の時にこの場所は？` : "この気分の時にこの場所は？"}
                                      </div>
                                      <div style={{ display: "flex", gap: "8px" }}>
                                        <button
                                          onClick={() => submitPlaceRating(item.title, "good")}
                                          style={{ flex: 1, height: "44px", borderRadius: "999px", border: "1.5px solid #bfe7cc", background: "#e9f8ef", color: "#18794e", fontSize: "16px", fontWeight: 900, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                                        >
                                          👍 この気分に合う
                                        </button>
                                        <button
                                          onClick={() => submitPlaceRating(item.title, "bad")}
                                          style={{ flex: 1, height: "44px", borderRadius: "999px", border: "1.5px solid #f5c0c8", background: "#fce4e4", color: "#c0385a", fontSize: "16px", fontWeight: 900, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                                        >
                                          👎 この気分には合わない
                                        </button>
                                      </div>
                                      <div style={{ textAlign: "center", marginTop: "12px" }}>
                                        <button
                                          onClick={() => { setReportingSpot({ title: item.title, address: item.address ?? "" }); setReportReason(""); setReportNote(""); setReportDone(false); }}
                                          style={{ background: "none", border: "none", color: "#b0a0a5", fontSize: "11px", cursor: "pointer", textDecoration: "underline", padding: "4px 8px" }}
                                        >
                                          ⚠ {lang === "en" ? "Report inappropriate" : "不適切を報告"}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) })()} {/* end visibleOnsen IIFE */}
                    {/* もう一度ボタン */}
                    <button
                      onClick={() => { setOnsenFacilities(null); setOnsenCategory(null); setStep(1); }}
                      style={{ ...secondaryButtonStyle, width: "100%", marginBottom: "32px" }}
                    >
                      もう一度診断する
                    </button>
                  </>
                )}

                {/* 温泉・自然・ドライブ・集中・スポーツ・遠くに行きたいパス以外: 通常のローディング・結果表示 */}
                {!onsenFacilities && !isLoadingOnsen && !natureFacilities && !isLoadingNature && !driveFacilities && !isLoadingDrive && !focusFacilities && !isLoadingFocus && !sportsFacilities && !isLoadingSports && !travelFacilities && !isLoadingTravel && (
                  <>

                {/* ── ローディング中アニメーション ── */}
                {isLoadingRecommendations && (
                  <div style={{
                    background: "linear-gradient(135deg, #fff8f8 0%, #fff2fb 100%)",
                    borderRadius: "24px",
                    border: "1px solid #f0dfe3",
                    padding: "32px 24px",
                    marginBottom: "20px",
                    textAlign: "center",
                  }}>
                    {/* スピナー */}
                    <div style={{
                      width: "56px", height: "56px", borderRadius: "999px",
                      border: "5px solid #ffdde5",
                      borderTopColor: "#ff6b8a",
                      margin: "0 auto 20px",
                      animation: "moodgo-spin 0.9s linear infinite",
                    }} />
                    <style>{`@keyframes moodgo-spin{to{transform:rotate(360deg)}} @keyframes moodgo-fade{0%,100%{opacity:0.6}50%{opacity:1}}`}</style>
                    <div style={{ fontWeight: 900, fontSize: "16px", color: "#4a3034", marginBottom: "10px" }}>
                      {lang === "en" ? "Finding the perfect spots for you..." : "おすすめを探しています"}
                    </div>
                    <div style={{
                      fontSize: "13px", color: "#b07080", lineHeight: 1.6,
                      minHeight: "22px",
                      animation: "moodgo-fade 2.2s ease-in-out infinite",
                    }}>
                      {lang === "en"
                        ? ["Analyzing your mood...", "Searching nearby spots...", "Picking the best for you...", "Checking opening hours...", "Almost ready..."][loadingMsgIdx % 5]
                        : LOADING_MESSAGES[loadingMsgIdx]}
                    </div>
                    <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "20px" }}>
                      {[0,1,2].map((i) => (
                        <div key={i} style={{
                          width: "8px", height: "8px", borderRadius: "999px",
                          background: "#ff6b8a",
                          opacity: i === loadingMsgIdx % 3 ? 1 : 0.25,
                          transition: "opacity 0.4s",
                        }} />
                      ))}
                    </div>
                  </div>
                )}

                {apiWarning && apiWarning !== "noResultsFood" ? (
                  <div
                    style={{
                      background: "#fff7e6",
                      borderRadius: "18px",
                      padding: "12px 14px",
                      border: "1px solid #f0d7dc",
                      marginBottom: "16px",
                      fontSize: "13px",
                      lineHeight: 1.6,
                    }}
                  >
                    {apiWarning}
                  </div>
                ) : null}

                <div
                  style={{
                    background: "#fffaf8",
                    borderRadius: "24px",
                    padding: "16px",
                    border: "1px solid #f0dfe3",
                    marginBottom: "20px",
                  }}
                >
                  <div style={{ fontWeight: 900, marginBottom: "10px" }}>
                    {lang === "en" ? UI_EN.conditionTitle : "今回の条件"}
                  </div>
                  {(() => {
                    const moodObj2 = moods.find((m) => m.key === answers.mood);
                    // お腹すいた用：selectedTime(timeVal) → 距離ラベルに変換
                    const FOOD_DIST_LABELS: Record<string, string> = {
                      "15〜30分": "近場がいい 🏠",
                      "30〜60分": "少し歩いてもOK 🚶",
                      "1〜2時間": "電車でも行く 🚃",
                      "2〜4時間": "遠くても最高の一皿 🔥",
                    };
                    // emoji: SVGパスの場合はimgで、絵文字はspanで表示
                    type CondItem = { icon: string; isImg: boolean; label: string; value: string };
                    const items: CondItem[] = [];

                    // 気分（常に表示・SVGアイコン使用）
                    if (answers.mood) items.push({ icon: moodObj2?.icon ?? "🎯", isImg: !!(moodObj2?.icon), label: lang === "en" ? "Mood" : "気分", value: answers.mood });

                    // エリア（常に表示）
                    if (answers.area) items.push({ icon: "📍", isImg: false, label: lang === "en" ? "Area" : "エリア", value: answers.area });

                    // 誰と
                    if (answers.companion) items.push({ icon: "👥", isImg: false, label: lang === "en" ? "With" : "誰と", value: answers.companion });

                    // 交通手段：ドライブしたいは常に車なので省略
                    if (answers.mood !== "ドライブしたい" && answers.transport) {
                      const t = Array.isArray(answers.transport) ? answers.transport.join("・") : String(answers.transport);
                      if (t) items.push({ icon: "🚇", isImg: false, label: lang === "en" ? "Transport" : "交通手段", value: t });
                    }

                    // 予算
                    if (answers.budget !== undefined) {
                      const budStr = answers.budgetMin && answers.budgetMin > 0
                        ? `¥${answers.budgetMin.toLocaleString("ja-JP")}〜¥${answers.budget.toLocaleString("ja-JP")}`
                        : `〜¥${answers.budget.toLocaleString("ja-JP")}`;
                      items.push({ icon: "💰", isImg: false, label: lang === "en" ? "Budget" : "予算", value: budStr });
                    }

                    // 時間 / 距離感
                    if (answers.time) {
                      const isFood = answers.mood === "お腹すいた";
                      items.push({
                        icon: isFood ? "🗺️" : "⏱️",
                        isImg: false,
                        label: isFood ? (lang === "en" ? "Distance" : "距離感") : (lang === "en" ? "Time" : "時間"),
                        value: isFood ? (FOOD_DIST_LABELS[answers.time] ?? answers.time) : answers.time,
                      });
                    }

                    // 雰囲気（回答済みの場合のみ）
                    if (answers.atmosphere) items.push({ icon: "✨", isImg: false, label: lang === "en" ? "Vibe" : "雰囲気", value: answers.atmosphere });

                    // 優先（回答済みの場合のみ）
                    if (answers.priority) items.push({ icon: "🏆", isImg: false, label: lang === "en" ? "Priority" : "優先", value: answers.priority });

                    // 自由ワード
                    if (answers.freeWord) items.push({ icon: "🔍", isImg: false, label: lang === "en" ? "Keyword" : "キーワード", value: answers.freeWord });

                    return (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                        {items.map(({ icon, isImg, label, value }) => (
                          <div key={label} style={{
                            display: "inline-flex", alignItems: "center", gap: "5px",
                            background: "#fff", border: "1px solid #f0d5d9",
                            borderRadius: "10px", padding: "5px 10px",
                            fontSize: "12px", color: "#4a3034",
                          }}>
                            {isImg
                              ? <img src={icon} alt={value} style={{ width: "15px", height: "15px", objectFit: "contain", verticalAlign: "middle" }} />
                              : <span style={{ fontSize: "14px", lineHeight: 1 }}>{icon}</span>
                            }
                            <span style={{ color: "#b07080", fontSize: "11px", fontWeight: 600 }}>{label}</span>
                            <span style={{ fontWeight: 700 }}>{value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* 未見フィルタボタン */}
                {(() => {
                  const seenTitles = new Set(history.flatMap((h) => [h.topRecommendation]));
                  const unseenCount = recommendations.filter((r) => !seenTitles.has(r.title)).length;
                  const seenCount = recommendations.filter((r) => seenTitles.has(r.title)).length;
                  if (seenCount === 0) return null;
                  return (
                    <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
                      <button
                        onClick={() => setShowUnseenOnly(false)}
                        style={{
                          borderRadius: "999px",
                          padding: "8px 16px",
                          fontSize: "13px",
                          fontWeight: 900,
                          cursor: "pointer",
                          background: !showUnseenOnly ? "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)" : "#fff",
                          color: !showUnseenOnly ? "#fff" : "#4a3034",
                          boxShadow: !showUnseenOnly ? "0 4px 12px rgba(255,143,127,0.3)" : "0 2px 6px rgba(74,48,52,0.08)",
                          border: showUnseenOnly ? "1px solid #ead7db" : "none",
                        } as React.CSSProperties}
                      >
                        {lang === "en" ? "Show all" : "全て表示"}
                      </button>
                      <button
                        onClick={() => setShowUnseenOnly(true)}
                        style={{
                          borderRadius: "999px",
                          padding: "8px 16px",
                          fontSize: "13px",
                          fontWeight: 900,
                          cursor: "pointer",
                          background: showUnseenOnly ? "linear-gradient(135deg, #a8edea 0%, #5b6dff 100%)" : "#fff",
                          color: showUnseenOnly ? "#fff" : "#4a3034",
                          boxShadow: showUnseenOnly ? "0 4px 12px rgba(91,109,255,0.3)" : "0 2px 6px rgba(74,48,52,0.08)",
                          border: !showUnseenOnly ? "1px solid #ead7db" : "none",
                        } as React.CSSProperties}
                      >
                        ✨ {lang === "en" ? `New spots only (${unseenCount})` : `初めての場所だけ（${unseenCount}件）`}
                      </button>
                    </div>
                  );
                })()}

                <div className="result-list" style={{ display: "grid", gap: "18px", marginBottom: "24px" }}>
                  {(() => {
                    const seenTitles = new Set(history.flatMap((h) => [h.topRecommendation]));
                    const filtered = showUnseenOnly
                      ? recommendations.filter((r) => !seenTitles.has(r.title))
                      : recommendations;
                    return filtered;
                  })().length > 0 ? (
                    (() => {
                      const seenTitles = new Set(history.flatMap((h) => [h.topRecommendation]));
                      const filtered = showUnseenOnly
                        ? recommendations.filter((r) => !seenTitles.has(r.title))
                        : recommendations;
                      return filtered;
                    })().map((item, index) => {
                      const favorited = isFavorited(item.title);
                      const visitedItem = visitedPlaces.includes(item.title);

                      return (
                        <div key={`${item.title}-${index}`} style={resultCardStyle} className="result-card">
                          <div style={{ position: "relative" }}>
                            {(item.photoUrls?.length ?? 0) > 0 ? (() => {
                              const photos = item.photoUrls!;
                              const pi = photoIndices[item.title] ?? 0;
                              const hasPrev = pi > 0;
                              const hasNext = pi < photos.length - 1;
                              return (
                                <div className="result-card-photo" style={{ position: "relative", height: "220px", overflow: "hidden" }}>
                                  <img
                                    src={photos[pi]}
                                    alt={`${item.title} ${pi + 1}`}
                                    onClick={() => setLightboxSrc(photos[pi])}
                                    style={{ width: "100%", height: "220px", objectFit: "cover", display: "block", cursor: "zoom-in" }}
                                  />
                                  {item.hasUserPhotos && pi < (item.userPhotoCount ?? 0) && (
                                    <div style={{
                                      position: "absolute", top: "12px", left: "12px",
                                      background: "rgba(0,0,0,0.52)", borderRadius: "999px",
                                      padding: "4px 10px", fontSize: "11px", color: "#fff", fontWeight: 800,
                                      display: "flex", alignItems: "center", gap: "4px",
                                      backdropFilter: "blur(4px)",
                                    }}>
                                      📸 {lang === "en" ? "User photo" : "投稿写真"}
                                    </div>
                                  )}
                                  {hasPrev && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setPhotoIndices((prev) => ({ ...prev, [item.title]: pi - 1 })); }}
                                      style={{
                                        position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)",
                                        width: "36px", height: "36px", borderRadius: "999px", border: "none",
                                        background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px",
                                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                                      }}
                                      aria-label="前の写真"
                                    >‹</button>
                                  )}
                                  {hasNext && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setPhotoIndices((prev) => ({ ...prev, [item.title]: pi + 1 })); }}
                                      style={{
                                        position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
                                        width: "36px", height: "36px", borderRadius: "999px", border: "none",
                                        background: "rgba(0,0,0,0.45)", color: "#fff", fontSize: "18px",
                                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                                      }}
                                      aria-label="次の写真"
                                    >›</button>
                                  )}
                                  {photos.length > 1 && (
                                    <div style={{
                                      position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)",
                                      display: "flex", gap: "5px",
                                    }}>
                                      {photos.map((_, di) => (
                                        <div key={di} style={{
                                          width: "6px", height: "6px", borderRadius: "999px",
                                          background: di === pi ? "#fff" : "rgba(255,255,255,0.45)",
                                        }} />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })() : (
                              <div
                                className="result-card-photo"
                                style={{
                                  width: "100%",
                                  height: "220px",
                                  background: "linear-gradient(135deg, #fff2ef 0%, #ffe3e8 100%)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: "16px",
                                  fontWeight: 900,
                                  color: "#8b6d72",
                                }}
                              >
                                MoodGo recommendation
                              </div>
                            )}

                            <button
                              onClick={() => toggleFavorite(item)}
                              style={{
                                position: "absolute",
                                top: "14px",
                                right: "14px",
                                width: "48px",
                                height: "48px",
                                borderRadius: "999px",
                                border: "none",
                                background: favorited ? "#ff8fa5" : "rgba(255,255,255,0.92)",
                                color: favorited ? "#ffffff" : "#ff8fa5",
                                fontSize: "24px",
                                fontWeight: 900,
                                cursor: "pointer",
                                boxShadow: "0 10px 20px rgba(74,48,52,0.16)",
                              }}
                              aria-label="お気に入り"
                            >
                              {favorited ? "♥" : "♡"}
                            </button>

                            {/* 非表示ボタン（左上） */}
                            <button
                              onClick={() => {
                                if (window.confirm(`「${item.title}」を今後の結果から除外しますか？`)) {
                                  blockPlace(item.title);
                                }
                              }}
                              style={{
                                position: "absolute",
                                top: "14px",
                                left: "14px",
                                height: "30px",
                                padding: "0 10px",
                                borderRadius: "999px",
                                border: "none",
                                background: "rgba(0,0,0,0.5)",
                                color: "#fff",
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                                backdropFilter: "blur(4px)",
                              }}
                              aria-label="結果から除外"
                            >
                              🚫 {lang === "en" ? "Hide" : "非表示"}
                            </button>
                            {visitedItem && <div style={{ position: "absolute", top: "14px", right: "70px", background: "#16a34a", color: "#fff", borderRadius: "999px", padding: "4px 10px", fontSize: "12px", fontWeight: 900 }}>済</div>}

                          </div>

                          <div className="result-card-body" style={{ padding: "20px 18px 18px" }}>
                            {(() => {
                              const isEN = !!showEnglish[item.title];
                              const tr = (translatedCards[item.title] ?? {}) as Record<string, unknown>;
                              const displayTitle = isEN && tr.title ? String(tr.title) : item.title;
                              const displayReason = isEN && tr.reason ? String(tr.reason) : (item.reason ?? "");
                              const displayVibe = isEN && tr.vibe ? String(tr.vibe) : (item.vibe ?? "");
                              const displayFeatures: string[] = isEN && Array.isArray(tr.features) ? tr.features as string[] : (item.features ?? []);
                              const displayStation = isEN && tr.stationText ? String(tr.stationText) : (item.stationText ?? "");
                              const displayHours = isEN && tr.openingHoursText ? String(tr.openingHoursText) : (item.openingHoursText ?? "");
                              return (
                                <>
                                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "10px" }}>
                                    <div className="result-title" style={{ fontWeight: 900, fontSize: "34px", lineHeight: 1.15, letterSpacing: "-0.03em", flex: 1 }}>
                                      {displayTitle}
                                    </div>
                                    <button
                                      onClick={() => translateCard(item)}
                                      style={{
                                        flexShrink: 0,
                                        height: "32px",
                                        padding: "0 14px",
                                        borderRadius: "999px",
                                        border: showEnglish[item.title] ? "2px solid #4184ff" : "1.5px solid #d0bfc2",
                                        background: showEnglish[item.title] ? "#4184ff" : "#fff",
                                        color: showEnglish[item.title] ? "#fff" : "#7a5860",
                                        fontSize: "12px",
                                        fontWeight: 900,
                                        cursor: "pointer",
                                        letterSpacing: "0.06em",
                                        marginTop: "6px",
                                      }}
                                      aria-label="英語に翻訳"
                                    >
                                      {translatingCards[item.title] ? "…" : showEnglish[item.title] ? "🌐 JP" : "🌐 EN"}
                                    </button>
                                  </div>

                                  {item.isUserSpot && (
                                    <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)", border: "1px solid rgba(74,48,52,0.12)", borderRadius: "999px", padding: "4px 10px", fontSize: "11px", fontWeight: 900, color: "#4a3034", marginBottom: "8px" }}>
                                      📍 {(isEN || lang === "en") ? "User-submitted Hidden Gem" : "ユーザー投稿の穴場スポット"}
                                    </div>
                                  )}

                                  {displayReason ? (
                                    <div style={{ fontSize: "14px", color: "#c0385a", fontWeight: 700, marginBottom: "8px", lineHeight: 1.5 }}>
                                      ✨ {displayReason}
                                    </div>
                                  ) : null}

                                  {displayFeatures.length > 0 && (
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                                      {displayFeatures.map((tag, ti) => (
                                        <span key={ti} style={{ padding: "4px 10px", borderRadius: "999px", background: "#fff3e6", border: "1px solid #ffd8a8", fontSize: "12px", fontWeight: 700, color: "#8a4500" }}>{tag}</span>
                                      ))}
                                    </div>
                                  )}

                                  {item.address ? (
                                    <div style={{ fontSize: "14px", opacity: 0.76, marginBottom: "12px" }}>{item.address}</div>
                                  ) : null}

                                  {displayVibe ? (
                                    <div style={{ fontSize: "15px", lineHeight: 1.7, marginBottom: "14px" }}>{displayVibe}</div>
                                  ) : null}

                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                                    {item.budget && !item.budget.startsWith("PRICE_LEVEL") ? <div style={chipStyle}>{item.budget}</div> : null}
                                    {item.time ? <div style={chipStyle}>{item.time}</div> : null}
                                    {(() => {
                                      const label = priceLevelLabel(item.priceLevel);
                                      return label ? (
                                        <div style={{ ...chipStyle, background: item.priceLevel === "PRICE_LEVEL_FREE" ? "#e8f5e9" : "#fff8e1", color: item.priceLevel === "PRICE_LEVEL_FREE" ? "#2e7d32" : "#6d4c00", border: "1px solid " + (item.priceLevel === "PRICE_LEVEL_FREE" ? "#c8e6c9" : "#ffe082") }}>
                                          💴 {label}
                                        </div>
                                      ) : null;
                                    })()}
                                    {item.rating !== null && item.rating !== undefined ? (
                                      <div style={chipStyle}>⭐ {item.rating}{item.userRatingCount ? ` (${item.userRatingCount})` : ""}</div>
                                    ) : null}
                                    {item.routesByMode && item.routesByMode.length > 0
                                      ? item.routesByMode.map((m, i) => m.distanceText
                                          ? <div key={i} style={chipStyle}>{m.icon} {m.distanceText}</div>
                                          : null
                                        )
                                      : item.distanceText
                                        ? <div style={chipStyle}>{travelIcon} {item.distanceText}</div>
                                        : null
                                    }
                                    {item.openNow !== undefined || item.openingHoursText ? (
                                      <div style={getOpeningChipStyle(item.openNow)}>
                                        🕒 {item.openNow === true ? ((isEN || lang === "en") ? "Open now" : "営業中") : item.openNow === false ? ((isEN || lang === "en") ? "Closed" : "閉店中") : displayHours}
                                      </div>
                                    ) : null}
                                  </div>

                                  <div style={{ display: "grid", gap: "10px", marginBottom: "18px" }}>
                                    {item.openingHoursText || item.openNow !== undefined ? (
                                      <div style={infoLineStyle}>
                                        <span style={{ fontSize: "20px" }}>🕒</span>
                                        <span>{displayHours || (item.openNow ? ((isEN || lang === "en") ? "Open now" : "営業中") : ((isEN || lang === "en") ? "Closed" : "閉店中"))}</span>
                                      </div>
                                    ) : null}
                                    {item.routesByMode && item.routesByMode.length > 0
                                      ? item.routesByMode.map((m, i) =>
                                          m.distanceText || m.durationText ? (
                                            <div key={i} style={infoLineStyle}>
                                              <span style={{ fontSize: "20px" }}>{m.icon}</span>
                                              <span>{[m.distanceText, m.durationText].filter(Boolean).join(" / ")}</span>
                                            </div>
                                          ) : null
                                        )
                                      : item.distanceText || item.durationText
                                        ? (
                                          <div style={infoLineStyle}>
                                            <span style={{ fontSize: "20px" }}>{travelIcon}</span>
                                            <span>{[item.distanceText, item.durationText].filter(Boolean).join(" / ")}</span>
                                          </div>
                                        ) : null
                                    }
                                    {displayStation ? (
                                      <div style={infoLineStyle}>
                                        <span style={{ fontSize: "20px" }}>🚉</span>
                                        <span>{displayStation}</span>
                                      </div>
                                    ) : null}
                                  </div>
                                </>
                              );
                            })()}

                            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px" }}>
                              {item.mapUrl ? (
                                <a
                                  href={item.mapUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={() => setMapClickedInSession((prev) => prev.includes(item.title) ? prev : [...prev, item.title])}
                                  style={{
                                    flex: 1,
                                    height: "52px",
                                    borderRadius: "999px",
                                    border: "none",
                                    background: "linear-gradient(135deg, #4184ff 0%, #2a6fe6 100%)",
                                    color: "#ffffff",
                                    fontSize: "15px",
                                    fontWeight: 900,
                                    textDecoration: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    boxShadow: "0 10px 22px rgba(42, 111, 230, 0.2)",
                                    minWidth: "140px",
                                  }}
                                >
                                  {lang === "en" ? "Open in Google Maps" : "Googleマップで見る"}
                                </a>
                              ) : null}
                              <button onClick={() => toggleVisited(item.title)} style={{ padding: "10px 16px", borderRadius: "999px", border: visitedItem ? "none" : "1.5px solid #d1d5db", background: visitedItem ? "#16a34a" : "transparent", color: visitedItem ? "#fff" : "#6b7280", fontSize: "13px", fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap" }}>
                                {visitedItem ? "✅ 行った！" : "🗺️ 行った！"}
                              </button>
                            </div>

                            {/* 場所ごとの個別評価 */}
                            {(() => {
                              const verdict = placeRatings[item.title];
                              if (verdict) {
                                return (
                                  <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "8px",
                                    padding: "12px",
                                    borderRadius: "16px",
                                    background: verdict === "good" ? "#e9f8ef" : "#fce4e4",
                                    border: `1px solid ${verdict === "good" ? "#bfe7cc" : "#f5c0c8"}`,
                                    fontSize: "13px",
                                    fontWeight: 800,
                                    color: verdict === "good" ? "#18794e" : "#c0385a",
                                  }}>
                                    {verdict === "good" ? "👍 気になる！AIが覚えました" : "👎 興味なし。次回から除外します"}
                                  </div>
                                );
                              }
                              return (
                                <div style={{
                                  borderTop: "1px solid #f5e8eb",
                                  paddingTop: "12px",
                                }}>
                                  <div style={{ fontSize: "13px", fontWeight: 800, color: "#7a5860", marginBottom: "8px", textAlign: "center" }}>
                                    {answers.mood ? `「${answers.mood}」の気分の時にこの場所は？` : "この気分の時にこの場所は？"}
                                  </div>
                                  <div style={{ display: "flex", gap: "8px" }}>
                                    <button
                                      onClick={() => submitPlaceRating(item.title, "good")}
                                      style={{
                                        flex: 1,
                                        height: "44px",
                                        borderRadius: "999px",
                                        border: "1.5px solid #bfe7cc",
                                        background: "#e9f8ef",
                                        color: "#18794e",
                                        fontSize: "16px",
                                        fontWeight: 900,
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "6px",
                                      }}
                                    >
                                      👍 この気分に合う
                                    </button>
                                    <button
                                      onClick={() => submitPlaceRating(item.title, "bad")}
                                      style={{
                                        flex: 1,
                                        height: "44px",
                                        borderRadius: "999px",
                                        border: "1.5px solid #f5c0c8",
                                        background: "#fce4e4",
                                        color: "#c0385a",
                                        fontSize: "16px",
                                        fontWeight: 900,
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "6px",
                                      }}
                                    >
                                      👎 この気分には合わない
                                    </button>
                                  </div>
                                  {/* 不適切報告ボタン */}
                                  <div style={{ textAlign: "center", marginTop: "12px" }}>
                                    <button
                                      onClick={() => {
                                        setReportingSpot({ title: item.title, address: item.address ?? "" });
                                        setReportReason("");
                                        setReportNote("");
                                        setReportDone(false);
                                      }}
                                      style={{
                                        background: "none",
                                        border: "none",
                                        color: "#b0a0a5",
                                        fontSize: "11px",
                                        cursor: "pointer",
                                        textDecoration: "underline",
                                        padding: "4px 8px",
                                      }}
                                    >
                                      ⚠ {lang === "en" ? "Report inappropriate" : "不適切を報告"}
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div
                      style={{
                        background: "#fff",
                        borderRadius: "26px",
                        padding: "18px",
                        border: "1px solid #f0dfe3",
                        textAlign: "center",
                        lineHeight: 1.8,
                      }}
                    >
                      {showUnseenOnly
                        ? (lang === "en" ? "No new spots found. Try switching to \"Show all\"." : "初めての場所が見つかりませんでした。「全て表示」に切り替えてください。")
                        : apiWarning === "noResultsFood"
                          ? (
                            <div>
                              <div style={{ fontSize: "32px", marginBottom: "8px" }}>🍽️</div>
                              <div style={{ fontWeight: 900, fontSize: "16px", color: "#c0385a", marginBottom: "6px" }}>
                                周辺に見つかりませんでした
                              </div>
                              <div style={{ fontSize: "14px", color: "#7a5860", lineHeight: 1.7 }}>
                                遠くの場所を検索したら<br />見つかるかもしれません
                              </div>
                            </div>
                          )
                          : (lang === "en" ? "No matches found. Try adjusting your selections and search again." : "条件に合う候補が見つからなかったよ。条件を少し変えてもう一度試してみてね。")
                      }
                    </div>
                  )}
                </div>


                {/* リファインメント（再絞り込み） */}
                <div
                  ref={resultsBottomRef}
                  style={{
                    background: "#fffaf8",
                    borderRadius: "24px",
                    padding: "20px",
                    border: "1px solid #f0dfe3",
                    marginBottom: "20px",
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: "15px", marginBottom: "10px", color: "#4a3034" }}>
                    🔄 {lang === "en" ? "Refine results" : "結果を絞り込む"}
                  </div>
                  <div style={{ fontSize: "12px", color: "#9b7b82", marginBottom: "10px" }}>
                    {lang === "en"
                      ? "Want something different? Tell us more and we'll search again."
                      : "「もっと屋内にして」「駅近で」「1000円以内で」など自由に入力できます"}
                  </div>
                  <textarea
                    value={refinementText}
                    onChange={(e) => setRefinementText(e.target.value)}
                    placeholder={lang === "en" ? "e.g. indoors only, closer to station, under ¥1000..." : "例：もっと静かな場所で、駅近で、無料で楽しめる場所..."}
                    rows={2}
                    style={{
                      width: "100%",
                      borderRadius: "14px",
                      border: "1px solid #ead7db",
                      padding: "10px 14px",
                      fontSize: "14px",
                      outline: "none",
                      background: "#fff",
                      resize: "none",
                      boxSizing: "border-box",
                      fontFamily: '"Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif',
                      marginBottom: "10px",
                    }}
                  />
                  <button
                    onClick={() => {
                      if (refinementText.trim()) openResults(refinementText.trim());
                    }}
                    disabled={isLoadingRecommendations || !refinementText.trim()}
                    style={{
                      width: "100%",
                      height: "46px",
                      borderRadius: "999px",
                      border: "none",
                      background: refinementText.trim()
                        ? "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)"
                        : "#e8dfe0",
                      color: refinementText.trim() ? "#fff" : "#bba8aa",
                      fontSize: "14px",
                      fontWeight: 900,
                      cursor: refinementText.trim() ? "pointer" : "default",
                      boxShadow: refinementText.trim() ? "0 6px 16px rgba(255,143,127,0.28)" : "none",
                    }}
                  >
                    {isRefining
                      ? (lang === "en" ? "Searching..." : "絞り込み中...")
                      : (lang === "en" ? "Search again 🚀" : "もう一度探す 🚀")}
                  </button>
                </div>

                {/* Feedback section */}
                {!feedbackSubmitted ? (
                  <div
                    style={{
                      background: "#fffaf8",
                      borderRadius: "24px",
                      padding: "20px",
                      border: "1px solid #f0dfe3",
                      marginBottom: "20px",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: "16px", marginBottom: "14px" }}>
                      💬 {lang === "en" ? "How were these results?" : "この結果はどうでしたか？"}
                    </div>
                    <div style={{ display: "flex", gap: "8px", marginBottom: "16px", justifyContent: "center" }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => setFeedbackRating(star)}
                          style={{
                            width: "48px",
                            height: "48px",
                            borderRadius: "999px",
                            border: feedbackRating === star ? "2px solid #ff8fa5" : "1px solid #ead7db",
                            background: feedbackRating !== null && star <= feedbackRating ? "#ffe3e8" : "#fff",
                            fontSize: "22px",
                            cursor: "pointer",
                          }}
                        >
                          {star <= (feedbackRating ?? 0) ? "⭐" : "☆"}
                        </button>
                      ))}
                    </div>
                    {feedbackRating !== null && (
                      <button
                        onClick={() => {
                          const newFeedback: FeedbackItem = {
                            id: `${Date.now()}`,
                            answers: {
                              mood: answers.mood,
                              area: answers.area,
                              age: answers.age,
                              gender: answers.gender,
                              companion: answers.companion,
                              transport: answers.transport,
                              atmosphere: answers.atmosphere,
                              priority: answers.priority,
                              freeWord: answers.freeWord,
                              dynamicQ1: answers.dynamicQ1,
                              dynamicQ2: answers.dynamicQ2,
                              dynamicQ3: answers.dynamicQ3,
                            },
                            topRecommendations: recommendations.slice(0, 3).map((r) => r.title),
                            rating: feedbackRating,
                            visitedPlace: "",
                            createdAt: new Date().toISOString(),
                          };
                          const updated = [newFeedback, ...pastFeedback].slice(0, 50);
                          setPastFeedback(updated);
                          if (typeof window !== "undefined") {
                            window.localStorage.setItem(FEEDBACK_KEY, JSON.stringify(updated));
                            // 全員に次回「どこに行ったか」を聞く
                            window.localStorage.setItem(PENDING_VISITED_KEY, JSON.stringify(newFeedback));
                            setPendingVisited(newFeedback);
                          }
                          // Supabase にも送信（失敗しても続行）
                          fetch("/api/feedback", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              mood: answers.mood,
                              area: answers.area,
                              age: answers.age,
                              gender: answers.gender,
                              companion: answers.companion,
                              atmosphere: answers.atmosphere,
                              priority: answers.priority,
                              topRecommendations: recommendations.slice(0, 3).map((r) => r.title),
                              rating: feedbackRating,
                              visitedPlace: "",
                              likedPlaces: likedInSession,
                              mapClickedPlaces: mapClickedInSession,
                            }),
                          }).catch(() => {});
                          setFeedbackSubmitted(true);
                        }}
                        style={{
                          width: "100%",
                          height: "48px",
                          borderRadius: "999px",
                          border: "none",
                          background: "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)",
                          color: "#ffffff",
                          fontSize: "15px",
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                      >
                        {lang === "en" ? "Submit" : "送信する"}
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      background: "#e9f8ef",
                      borderRadius: "18px",
                      padding: "14px 18px",
                      border: "1px solid #bfe7cc",
                      marginBottom: "20px",
                      fontSize: "14px",
                      color: "#18794e",
                      fontWeight: 800,
                      textAlign: "center",
                    }}
                  >
                    ✅ {lang === "en" ? "Thanks for your feedback! We'll use it to improve future suggestions." : "フィードバックありがとうございます！次回の提案に活かします。"}
                  </div>
                )}

                <div style={{ display: "flex", gap: "12px" }}>
                  <button onClick={() => setStep(1)} style={{ ...secondaryButtonStyle, flex: 1 }}>
                    {lang === "en" ? "Adjust selections" : "条件を見直す"}
                  </button>
                  <button
                    onClick={() => {
                      setApiRecommendations([]);
                      setApiWarning("");
                      setLocationError("");
                      setStarted(false);
                      setStep(1);
                    }}
                    style={{ ...primaryButtonStyle, flex: 1 }}
                  >
                    {lang === "en" ? "Back to home" : "ホームに戻る"}
                  </button>
                </div>
                  </>
                )} {/* end !onsenFacilities wrapper */}
              </>
            )}
          </div>
        )}
      </div>

      {/* 不適切報告モーダル */}
      {reportingSpot && (
        <div
          onClick={() => setReportingSpot(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(30,10,15,0.55)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: "480px",
              background: "#fff",
              borderRadius: "28px 28px 0 0",
              padding: "28px 24px 40px",
              boxShadow: "0 -8px 40px rgba(74,48,52,0.18)",
            }}
          >
            {/* グラブバー */}
            <div style={{ width: "40px", height: "4px", borderRadius: "999px", background: "#e0d0d5", margin: "0 auto 20px" }} />

            {reportDone ? (
              /* 送信完了 */
              <div style={{ textAlign: "center", padding: "16px 0 8px" }}>
                <div style={{ fontSize: "48px", marginBottom: "12px" }}>✅</div>
                <div style={{ fontWeight: 900, fontSize: "18px", color: "#4a3034", marginBottom: "8px" }}>
                  {lang === "en" ? "Report sent" : "報告を受け付けました"}
                </div>
                <div style={{ fontSize: "13px", color: "#8a7080", lineHeight: 1.6 }}>
                  {lang === "en"
                    ? "Thank you. We will review the report."
                    : "ご協力ありがとうございます。内容を確認します。"}
                </div>
                <button
                  onClick={() => setReportingSpot(null)}
                  style={{
                    marginTop: "24px", padding: "12px 32px",
                    borderRadius: "999px", border: "none",
                    background: "linear-gradient(135deg, #ff8fa5, #ffb347)",
                    color: "#fff", fontWeight: 900, fontSize: "14px", cursor: "pointer",
                  }}
                >
                  {lang === "en" ? "Close" : "閉じる"}
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontWeight: 900, fontSize: "17px", color: "#4a3034", marginBottom: "4px" }}>
                  ⚠ {lang === "en" ? "Report inappropriate content" : "不適切なコンテンツを報告"}
                </div>
                <div style={{ fontSize: "12px", color: "#9a8088", marginBottom: "20px", lineHeight: 1.5 }}>
                  {reportingSpot.title}
                </div>

                {/* 理由選択 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" }}>
                  {[
                    { key: "irrelevant",  label: lang === "en" ? "Irrelevant or off-topic result"   : "不適切な検索および関連度の低い検索" },
                    { key: "dislike",     label: lang === "en" ? "I don't like this place"           : "好きではない" },
                    { key: "misinfoinfo", label: lang === "en" ? "Incorrect information"             : "誤情報" },
                    { key: "restricted",  label: lang === "en" ? "Restricted or prohibited place"    : "規制対象の場" },
                    { key: "other",       label: lang === "en" ? "Other"                             : "その他" },
                  ].map(({ key, label }) => (
                    <label
                      key={key}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px",
                        padding: "12px 16px",
                        borderRadius: "14px",
                        border: reportReason === key ? "2px solid #ff8fa5" : "1.5px solid #eee",
                        background: reportReason === key ? "#fff5f7" : "#fafafa",
                        cursor: "pointer",
                        fontWeight: reportReason === key ? 800 : 500,
                        fontSize: "14px",
                        color: reportReason === key ? "#c0385a" : "#4a3034",
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{
                        width: "20px", height: "20px", borderRadius: "999px", flexShrink: 0,
                        border: reportReason === key ? "6px solid #ff8fa5" : "2px solid #ccc",
                        background: "#fff",
                        transition: "border 0.15s",
                      }} />
                      <input
                        type="radio"
                        name="report_reason"
                        value={key}
                        checked={reportReason === key}
                        onChange={() => setReportReason(key)}
                        style={{ display: "none" }}
                      />
                      {label}
                    </label>
                  ))}
                </div>

                {/* 補足テキスト（その他選択時に目立つ） */}
                <textarea
                  value={reportNote}
                  onChange={(e) => setReportNote(e.target.value)}
                  placeholder={lang === "en" ? "Additional details (optional)" : "補足があれば入力（任意）"}
                  rows={2}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "12px 14px", borderRadius: "12px",
                    border: "1.5px solid #edd",
                    fontSize: "13px", resize: "none", outline: "none",
                    background: "#fdfafa", marginBottom: "18px",
                    fontFamily: "inherit",
                  }}
                />

                <button
                  onClick={submitReport}
                  disabled={!reportReason || reportSubmitting}
                  style={{
                    width: "100%", padding: "14px",
                    borderRadius: "999px", border: "none",
                    background: reportReason
                      ? "linear-gradient(135deg, #ff8fa5, #ffb347)"
                      : "#e8dde0",
                    color: reportReason ? "#fff" : "#b0a0a5",
                    fontWeight: 900, fontSize: "15px",
                    cursor: reportReason ? "pointer" : "not-allowed",
                    transition: "all 0.2s",
                  }}
                >
                  {reportSubmitting
                    ? (lang === "en" ? "Sending…" : "送信中…")
                    : (lang === "en" ? "Send report" : "報告を送信する")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
