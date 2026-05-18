import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import {
  Activity,
  Beer,
  ChevronLeft,
  BicepsFlexed,
  Bike,
  BookOpen,
  Bus,
  Camera,
  Car,
  ChefHat,
  Clock,
  Coffee,
  Compass,
  Coins,
  Droplets,
  Dumbbell,
  EggFried,
  Eye,
  FerrisWheel,
  Fish,
  Flame,
  Footprints,
  Globe,
  Heart,
  Home,
  Hourglass,
  Infinity,
  Landmark,
  Laptop,
  Layers,
  Leaf,
  Map,
  MapPin,
  Mic,
  Moon,
  Mountain,
  Music,
  PawPrint,
  Pencil,
  Plane,
  Shuffle,
  Smile,
  Sofa,
  Soup,
  Sparkles,
  Star,
  Sun,
  Sunset,
  Thermometer,
  Timer,
  TrainFront,
  TreePine,
  Trees,
  Trophy,
  User,
  UserCheck,
  Users,
  UsersRound,
  Utensils,
  UtensilsCrossed,
  Volume1,
  Volume2,
  VolumeX,
  Waves,
  Wheat,
  Wifi,
  Zap,
} from 'lucide-react-native';
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { OnsenCategory } from '@/types/onsen';
import type { NatureSubGenre, NatureDistancePref } from '@/types/nature';
import type { CafeSubCategory, CafeDetail, CafeDistancePref } from '@/types/cafe';
import type { WaiWaiSubCategory } from '@/types/waiwai';
import type { DynamicQuestion } from '@/types/app';

// ─── Quiz data ───────────────────────────────────────────────────────────────

const MOODS = [
  { key: 'お腹すいた', label: 'お腹すいた', Icon: UtensilsCrossed, sub: '絶品グルメ' },
  { key: 'まったりしたい', label: 'まったりしたい', Icon: Coffee, sub: '癒やし・リラックス' },
  { key: 'わいわい楽しみたい', label: 'わいわい楽しみたい', Icon: Sparkles, sub: 'エンタメ・遊び' },
  { key: '自然感じたい', label: '自然感じたい', Icon: Leaf, sub: '自然・絶景・アウトドア' },
  { key: 'ドライブしたい', label: 'ドライブしたい', Icon: Car, sub: 'ドライブ・ツーリング' },
  { key: '集中したい', label: '集中したい', Icon: BookOpen, sub: '作業・勉強' },
  { key: '体を動かしたい', label: '体を動かしたい', Icon: Activity, sub: 'スポーツ・アウトドア' },
  { key: '遠くに行きたい', label: '遠くに行きたい', Icon: Plane, sub: '小旅行・お出かけ' },
  { key: '時間潰したい', label: '時間潰したい', Icon: Shuffle, sub: '近くのスポットをランダムに' },
];

const MOOD_QUESTIONS: Record<string, DynamicQuestion[]> = {
  'お腹すいた': [
    { key: 'food_genre_new', question: '食べたいジャンルは？', options: [
      '居酒屋🍺', '和食🍣', '洋食🍳', 'イタリアン🍝',
      '中華🥟', '焼肉🥩', '韓国🌶️', 'アジア系統🍛',
      '各国料理🌍', 'ラーメン🍜', 'お好み焼き・もんじゃ🥞', 'カフェ・スイーツ☕',
    ]},
  ],
  'まったりしたい': [
    { key: 'relax_place', question: 'どこで癒やされたい？', options: ['自然の中🌿', 'カフェ☕', '温泉・スパ♨️', '絶景スポット🌅'] },
  ],
  'わいわい楽しみたい': [],
  'ドライブしたい': [
    { key: 'drive_distance', question: 'どのくらい遠出したい？', options: ['30分（サクッと）', '1時間（ほどよく）', '2時間（ガッツリ）', '3時間〜（旅）'] },
    { key: 'drive_vibe', question: '雰囲気は？', options: ['絶景🌅', '休憩☕', '遊べる🎡', '穴場🗺️'] },
    { key: 'drive_road', question: '走りたい道は？', options: ['海沿い🌊', '山⛰️', '都会🌃'] },
  ],
  '自然感じたい': [
    { key: 'nature_view', question: 'どの自然の景色を見たい？', options: ['海・川・湖🌊', '山・森🌲'] },
    { key: 'nature_how', question: '自然の中でどのように過ごしたい？', options: ['景色を眺める👀', 'カフェでまったり☕', '自然の中を散歩🚶'] },
    { key: 'nature_scale', question: 'どのくらいの規模の自然？', options: ['近場の公園🌳', '整備された綺麗な公園🌸', '広大な自然や絶景🏔'] },
  ],
  '集中したい': [
    { key: 'focus_task', question: '何をする？', options: ['勉強・受験📖', 'PC作業・リモートワーク💻', '読書📚', '創作・趣味✏️'] },
    { key: 'focus_needs', question: '必須の設備は？', options: ['wifi・電源🔌', '静かな机🪑', '飲み物☕'] },
    { key: 'focus_noise', question: '雑音の許容度は？', options: ['無音に近い方が良い🔇', '適度なざわつき🔉', '多少賑やかでも大丈夫🔊', 'BGM程なら🎵'] },
  ],
  '体を動かしたい': [
    { key: 'sports_intensity', question: '運動の強度は？', options: ['ガッツリ汗をかきたい💪', 'ほどよく動きたい🏃', '軽く散歩程度🚶', '外に出るだけでOK🌞'] },
    { key: 'sports_type', question: 'どんな運動？', options: ['スポーツ・競技🏀', 'ランニング・ウォーキング🏃', 'アウトドア・ハイキング🏔', '水泳・プール🏊'] },
    { key: 'sports_place', question: '場所は？', options: ['室内施設・ジム🏋️', '広い公園・グラウンド⚽', '山・自然の中🌲', '海・川・湖🌊'] },
  ],
  '遠くに行きたい': [
    { key: 'travel_time', question: 'どのくらい時間がある？', options: ['午前中のみ⏰', '夕方まで🌆', '日跨ぐ前まで🌙', '日越してもOK🌟'] },
    { key: 'travel_place', question: '行きたい場所のイメージは？', options: ['自然・山・海🌊', '観光地・名所⛩️', '温泉・リゾート♨️', '都市・異文化🌆'] },
    { key: 'travel_goal', question: '旅の目的は？', options: ['非日常を味わいたい✨', '絶景を見たい🌅', '楽しみたい🎉', 'ゆっくり過ごしたい😴'] },
  ],
  '時間潰したい': [],
};

// ─── Icon map & emoji stripper ────────────────────────────────────────────────

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{27FF}\u{FE00}-\u{FE0F}♨🔌🪑]/gu;
const stripEmoji = (s: string) => s.replace(EMOJI_RE, '').trim();

type LucideIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const OPTION_ICONS: Record<string, LucideIcon> = {
  // food genres
  '居酒屋🍺': Beer, '和食🍣': Fish, '洋食🍳': EggFried, 'イタリアン🍝': UtensilsCrossed,
  '中華🥟': ChefHat, '焼肉🥩': Flame, '韓国🌶️': Zap, 'アジア系統🍛': Compass,
  '各国料理🌍': Globe, 'ラーメン🍜': Soup, 'お好み焼き・もんじゃ🥞': Wheat, 'カフェ・スイーツ☕': Coffee,
  // relax place
  '自然の中🌿': Leaf, 'カフェ☕': Coffee, '温泉・スパ♨️': Waves, '絶景スポット🌅': Sunset,
  // drive
  '30分（サクッと）': Timer, '1時間（ほどよく）': Clock, '2時間（ガッツリ）': Hourglass, '3時間〜（旅）': Infinity,
  '絶景🌅': Sunset, '休憩☕': Coffee, '遊べる🎡': FerrisWheel, '穴場🗺️': Map,
  '海沿い🌊': Waves, '山⛰️': Mountain, '都会🌃': Layers,
  // nature
  '海・川・湖🌊': Waves, '山・森🌲': TreePine,
  '景色を眺める👀': Eye, 'カフェでまったり☕': Coffee, '自然の中を散歩🚶': Footprints,
  '近場の公園🌳': MapPin, '整備された綺麗な公園🌸': Trees, '広大な自然や絶景🏔': Mountain,
  // focus
  '勉強・受験📖': BookOpen, 'PC作業・リモートワーク💻': Laptop, '読書📚': BookOpen, '創作・趣味✏️': Pencil,
  'wifi・電源🔌': Wifi, '静かな机🪑': Sofa, '飲み物☕': Coffee,
  '無音に近い方が良い🔇': VolumeX, '適度なざわつき🔉': Volume1, '多少賑やかでも大丈夫🔊': Volume2, 'BGM程なら🎵': Music,
  // sports
  'ガッツリ汗をかきたい💪': BicepsFlexed, 'ほどよく動きたい🏃': Activity, '軽く散歩程度🚶': Footprints, '外に出るだけでOK🌞': Sun,
  'スポーツ・競技🏀': Trophy, 'ランニング・ウォーキング🏃': Activity, 'アウトドア・ハイキング🏔': Mountain, '水泳・プール🏊': Waves,
  '室内施設・ジム🏋️': Dumbbell, '広い公園・グラウンド⚽': Trees, '山・自然の中🌲': TreePine,
  // travel
  '午前中のみ⏰': Timer, '夕方まで🌆': Sunset, '日跨ぐ前まで🌙': Moon, '日越してもOK🌟': Star,
  '自然・山・海🌊': Waves, '観光地・名所⛩️': Landmark, '温泉・リゾート♨️': Waves, '都市・異文化🌆': Layers,
  '非日常を味わいたい✨': Sparkles, '絶景を見たい🌅': Camera, '楽しみたい🎉': Smile, 'ゆっくり過ごしたい😴': Moon,
  // companions
  '一人': User, '友達': Users, '恋人': Heart, '家族': Home, '大人数グループ': UsersRound, '先輩': UserCheck,
  // transport
  '徒歩': Footprints, '自転車・バイク': Bike, '電車': TrainFront, '車': Car, 'バス': Bus, 'なんでも': Shuffle,
  // time
  '15〜30分': Timer, '30〜60分': Clock, '1〜2時間': Hourglass, '2〜4時間': Hourglass, '4〜6時間': Sunset, '6時間以上': Moon,
  // atmosphere
  '静か': VolumeX, '賑やか': Music, 'アクティブ': Activity, 'スリル': Zap, 'ロマンティック': Heart, 'アットホーム': Home,
  // priority
  'コスパ': Coins, '映え': Camera, '距離': MapPin, '快適さ': Sofa, '楽しさ': Smile, '質の高さ': Star,
  // nature distance
  '近場': MapPin, 'ほどほど': Footprints, '遠く': Plane,
  // food distance
  '近場🚶（歩きでも行ける）': Footprints,
  '少し🚃（駅1〜2つ）': TrainFront,
  'ほどほど🚇（電車30分ほど）': Clock,
  '遠くてもOK🚗（県外も可）': Car,
};

const COMPANIONS = ['一人', '友達', '恋人', '家族', '大人数グループ', '先輩'];
const TRANSPORT_OPTIONS = ['徒歩', '自転車・バイク', '電車', '車', 'バス', 'なんでも'];
const TIME_OPTIONS = ['15〜30分', '30〜60分', '1〜2時間', '2〜4時間', '4〜6時間', '6時間以上'];
const ATMOSPHERE_OPTIONS = ['静か', '賑やか', 'アクティブ', 'スリル', 'ロマンティック', 'アットホーム'];
const PRIORITY_OPTIONS = ['コスパ', '映え', '距離', '快適さ', '楽しさ', '質の高さ'];

const ONSEN_CATEGORIES = [
  { key: 'natural_onsen' as OnsenCategory, label: '天然温泉・日帰り温泉', Icon: Waves },
  { key: 'sento' as OnsenCategory, label: '銭湯', Icon: Droplets },
  { key: 'super_sento' as OnsenCategory, label: 'スーパー銭湯・健康ランド', Icon: Activity },
  { key: 'sauna_ganban' as OnsenCategory, label: 'サウナ・岩盤浴', Icon: Thermometer },
  { key: 'all_onsen' as OnsenCategory, label: '温泉施設全般（おまかせ）', Icon: Sparkles },
];

const NATURE_SUBGENRES = [
  { key: 'sea' as NatureSubGenre, label: '波の音と海風', Icon: Waves },
  { key: 'forest' as NatureSubGenre, label: '森の中で深呼吸', Icon: TreePine },
  { key: 'park' as NatureSubGenre, label: '広い芝生でゴロゴロ', Icon: Sun },
  { key: 'panorama' as NatureSubGenre, label: '圧倒的なパノラマ', Icon: Mountain },
];

const NATURE_DISTANCES: NatureDistancePref[] = ['近場', 'ほどほど', '遠く'];

const FOOD_DISTANCE_OPTIONS = [
  '近場🚶（歩きでも行ける）',
  '少し🚃（駅1〜2つ）',
  'ほどほど🚇（電車30分ほど）',
  '遠くてもOK🚗（県外も可）',
];
const FOOD_DISTANCE_EN = [
  'Nearby 🚶 (walking distance)',
  'Short trip 🚃 (1-2 stations)',
  'Moderate 🚇 (~30 min by train)',
  'Far is fine 🚗 (another city)',
];

const CAFE_SUBCATEGORIES = [
  { key: 'book_relax' as CafeSubCategory, label: 'ブックカフェ・隠れ家', Icon: BookOpen },
  { key: 'animal' as CafeSubCategory, label: 'アニマルカフェ', Icon: PawPrint },
  { key: 'view' as CafeSubCategory, label: '景色が良いカフェ', Icon: Sun },
  { key: 'sweets' as CafeSubCategory, label: '絶品スイーツカフェ', Icon: Sparkles },
];

const WAIWAI_SUBCATEGORIES = [
  { key: 'active' as WaiWaiSubCategory, label: '体を動かしてはしゃぎたい', Icon: Dumbbell },
  { key: 'party' as WaiWaiSubCategory, label: '歌って飲んで騒ぎたい', Icon: Mic },
  { key: 'experience' as WaiWaiSubCategory, label: '非日常の体験で盛り上がりたい', Icon: Sparkles },
  { key: 'food_drink' as WaiWaiSubCategory, label: 'ご飯とお酒でワイワイ', Icon: UtensilsCrossed },
];

const FOOD_SUB_QUESTIONS_MAP: Record<string, { question: string; options: string[] }> = {
  '居酒屋🍺': { question: 'どんな居酒屋？', options: ['海鮮・魚介系🐟', '焼き鳥・串焼き🍡', 'もつ・ホルモン系🔥', '創作料理・おしゃれ系✨', 'なんでもOK'] },
  '和食🍣': { question: 'どんな和食？', options: ['寿司・海鮮🍣', 'そば・うどん🍜', '天ぷら・揚げ物🍤', '定食・家庭的🍱', 'なんでもOK'] },
  '洋食🍳': { question: 'どんな洋食？', options: ['ハンバーグ・ステーキ🥩', 'パスタ・ピザ🍝', 'カフェ飯・ランチ🥗', 'ハンバーガー🍔', 'なんでもOK'] },
  'イタリアン🍝': { question: 'どんなイタリアン？', options: ['本格ピザ🍕', 'パスタ中心🍝', 'トラットリア（家庭的）🏠', 'リストランテ（高級）✨', 'なんでもOK'] },
  '焼肉🥩': { question: 'どんな焼肉？', options: ['高級和牛🥩', 'コスパ重視💰', 'ホルモン系🔥', '1人焼肉🙋', 'なんでもOK'] },
  'アジア系統🍛': { question: 'どのアジア料理？', options: ['タイ料理🍛', 'ベトナム料理🍜', 'インド料理🍲', '中東・トルコ料理🌯', 'なんでもOK'] },
  '各国料理🌍': { question: 'どの国の料理？', options: ['メキシコ・スペイン🌮', 'フレンチ・欧州🥐', 'アフリカ・中東🌍', '珍しい国の料理🗺️', 'なんでもOK'] },
  'ラーメン🍜': { question: 'どんなラーメン？', options: ['醤油・塩🍜', '豚骨🐖', '味噌🌾', 'つけ麺・まぜそば🍣', 'なんでもOK'] },
  'カフェ・スイーツ☕': { question: 'どんなスイーツ？', options: ['パンケーキ・ワッフル🥞', 'ケーキ・パティスリー🎂', 'チョコレート系🍫', '和スイーツ・あんこ🍡', 'なんでもOK'] },
};

const DRIVE_SUBCATEGORIES = [
  { key: 'ocean_drive', label: '海沿いドライブ', Icon: Waves },
  { key: 'night_view', label: '夜景・絶景ドライブ', Icon: Sunset },
  { key: 'road_station', label: '道の駅・ご当地グルメ', Icon: MapPin },
  { key: 'outlet', label: '郊外アウトレット', Icon: Map },
];

const FOCUS_SUBCATEGORIES = [
  { key: 'work_cafe', label: 'カフェで作業', Icon: Coffee },
  { key: 'coworking', label: 'コワーキングスペース', Icon: Laptop },
  { key: 'family_restaurant', label: 'ファミレスで粘る', Icon: Utensils },
  { key: 'netcafe_library', label: '本に囲まれてこもる', Icon: BookOpen },
];

const SPORTS_SUBCATEGORIES = [
  { key: 'training', label: 'ガッツリトレーニング', Icon: Dumbbell },
  { key: 'stress_relief', label: 'ストレス発散', Icon: Zap },
  { key: 'amusement_sport', label: '遊び感覚でワイワイ', Icon: Smile },
  { key: 'outdoor_sports', label: '外でスポーツ', Icon: Trees },
];

const TRAVEL_SUBCATEGORIES = [
  { key: 'power_spot', label: 'パワースポット', Icon: Landmark },
  { key: 'theme_park', label: 'テーマパーク', Icon: FerrisWheel },
  { key: 'town_walk', label: '街をぶらぶら', Icon: Footprints },
  { key: 'super_view', label: '絶景・大自然', Icon: Mountain },
];

// ─── Translations ─────────────────────────────────────────────────────────────

const T = {
  ja: {
    step1Title: '今の気分は？', step1Sub: '一番近いものを選んでください。',
    step2Title: '誰と？', step2Sub: '誰と行くかでおすすめが変わります。',
    step3Title: '交通手段は？', step3Sub: '複数選べます。',
    step4Title: '予算は？', step4Sub: 'ざっくりで大丈夫です。',
    step5Title: 'エリアは？', step5Sub: '現在地を使うか、エリア名を入力してください。',
    step6Title: 'どのくらい時間ある？', step6Sub: '空き時間に合う過ごし方を提案します。',
    step7Title: '自由に教えてください', step7Sub: '行きたい場所のイメージがあれば自由に。なくてもOK。',
    step10Title: '確認', step10Sub: '条件を確認してください。',
    next: '次へ', back: '戻る', skip: 'スキップ', submit: 'おすすめを見る',
    useLocation: '📍 現在地を使う', locating: '現在地を取得中...',
    orDivider: 'または', areaPlaceholder: '例：渋谷 / 横浜 / 新宿',
    freeWordPlaceholder: '例：夜景、甘いもの、公園、静かな場所、海が見たい など',
    free: '無料',
    onsenTitle: '温泉の種類は？', onsenSub: 'どんな温泉施設をお探しですか？',
    natureTitle: 'どんな自然？', natureSub: '行きたい自然のタイプを選んでください。',
    cafeTitle: 'どんなカフェ？', cafeSub: 'お好みのカフェタイプを選んでください。',
    waiwaiTitle: 'どんな楽しみ方？', waiwaiSub: '盛り上がり方のスタイルを選んでください。',
    driveTitle: 'どんなドライブ？', driveSub: '行き先のイメージを選んでください。',
    focusTitle: 'どこで集中する？', focusSub: '作業・勉強の場所を選んでください。',
    sportsTitle: 'どんな体の動かし方？', sportsSub: 'スタイルを選んでください。',
    travelTitle: 'どこに行く？', travelSub: '旅のイメージを選んでください。',
    natureDistTitle: 'どのくらい遠い？', natureDistSub: '現在地からの距離感を選んでください。',
    cafeDetailTitle: 'もう少し詳しく', cafeDetailSub: 'お好みのタイプを選んでください。',
    atmTitle: '雰囲気は？', atmSub: '今日の気分に合う空気感を選んでください。',
    priorTitle: '優先したいのは？', priorSub: 'いちばん大事にしたいポイントを選んでください。',
    foodSubSub: 'もう少し絞り込みましょう。',
    foodDistTitle: '距離感は？', foodDistSub: 'どのくらいの距離のお店が良いですか？',
    driveVibeTitle: 'ドライブのこだわりは？', driveVibeSub: '気分に合う条件を選んでください。',
    travelDetailTitle: '旅のプランは？', travelDetailSub: '詳しく教えてください。',
    reviewMood: '気分', reviewArea: 'エリア', reviewWith: '同伴', reviewTransport: '交通',
    reviewBudget: '予算', reviewTime: '時間', reviewAtm: '雰囲気', reviewPriority: '優先', reviewMemo: 'メモ',
    driveDetail: 'ドライブの詳細を教えてください',
  },
  en: {
    step1Title: "What's your mood?", step1Sub: 'Pick the one that feels closest.',
    step2Title: 'Who are you going with?', step2Sub: 'This helps us suggest the right spots.',
    step3Title: 'How will you get there?', step3Sub: 'Select all that apply.',
    step4Title: 'What\'s your budget?', step4Sub: 'Rough estimate is fine.',
    step5Title: 'Which area?', step5Sub: 'Use your current location or type an area.',
    step6Title: 'How much time do you have?', step6Sub: "We'll match activities to your schedule.",
    step7Title: 'Any other requests?', step7Sub: 'Optional — describe what you\'re looking for.',
    step10Title: 'Review', step10Sub: 'Check your preferences before submitting.',
    next: 'Next', back: 'Back', skip: 'Skip', submit: 'Show recommendations',
    useLocation: '📍 Use my location', locating: 'Getting location...',
    orDivider: 'or', areaPlaceholder: 'e.g. Shibuya / Yokohama / Shinjuku',
    freeWordPlaceholder: 'e.g. night view, sweets, park, quiet, ocean view...',
    free: 'Free',
    onsenTitle: 'Type of hot spring?', onsenSub: 'What kind of facility are you looking for?',
    natureTitle: 'What kind of nature?', natureSub: 'Choose the type you want to visit.',
    cafeTitle: 'What kind of café?', cafeSub: 'Choose your preferred café style.',
    waiwaiTitle: 'How do you want to have fun?', waiwaiSub: 'Pick your vibe.',
    driveTitle: 'What kind of drive?', driveSub: 'Choose your destination style.',
    focusTitle: 'Where will you focus?', focusSub: 'Choose your work/study spot.',
    sportsTitle: 'How do you want to move?', sportsSub: 'Choose your activity style.',
    travelTitle: 'Where are you headed?', travelSub: 'Choose your travel vibe.',
    natureDistTitle: 'How far are you willing to go?', natureDistSub: 'Distance from your current location.',
    cafeDetailTitle: 'A bit more detail', cafeDetailSub: 'Choose your preferred type.',
    atmTitle: 'What vibe are you after?', atmSub: 'Pick the atmosphere that fits your mood.',
    priorTitle: 'What matters most?', priorSub: 'Pick your top priority.',
    foodSubSub: "Let's narrow it down a bit.",
    foodDistTitle: 'How far?', foodDistSub: 'How far are you willing to travel?',
    driveVibeTitle: 'What\'s your drive vibe?', driveVibeSub: 'Pick what matters most for your drive.',
    travelDetailTitle: 'Trip details', travelDetailSub: 'Tell us more about your trip.',
    reviewMood: 'Mood', reviewArea: 'Area', reviewWith: 'With', reviewTransport: 'Transport',
    reviewBudget: 'Budget', reviewTime: 'Time', reviewAtm: 'Vibe', reviewPriority: 'Priority', reviewMemo: 'Notes',
    driveDetail: 'Tell us about your drive',
  },
} as const;

const MOOD_EN: Record<string, { label: string; sub: string }> = {
  'お腹すいた':         { label: "I'm Hungry 🍜",       sub: 'Food & Gourmet' },
  'まったりしたい':     { label: 'Chill Out 😌',         sub: 'Relaxation & Healing' },
  'わいわい楽しみたい': { label: 'Have Fun! 🎉',          sub: 'Entertainment & Play' },
  '自然感じたい':       { label: 'Into Nature 🌿',        sub: 'Nature & Scenery' },
  'ドライブしたい':     { label: 'Let\'s Drive 🚗',       sub: 'Drive & Touring' },
  '集中したい':         { label: 'Focus Mode 📚',         sub: 'Work & Study' },
  '体を動かしたい':     { label: 'Get Moving 💪',         sub: 'Sports & Outdoors' },
  '遠くに行きたい':     { label: 'Day Trip ✈️',           sub: 'Travel & Excursion' },
  '時間潰したい':       { label: 'Just Exploring 🎲',     sub: 'Random spots nearby' },
};

const COMPANIONS_EN = ['Solo', 'Friends', 'Partner', 'Family', 'Large Group', 'With Seniors'];
const TRANSPORT_EN  = ['Walking', 'Bike', 'Train', 'Car', 'Bus', 'Any'];
const TIME_EN       = ['15-30 min', '30-60 min', '1-2 hrs', '2-4 hrs', '4-6 hrs', '6+ hrs'];
const ATM_EN        = ['Quiet', 'Lively', 'Active', 'Thrilling', 'Romantic', 'Cozy'];
const PRIORITY_EN   = ['Value', 'Instagrammable', 'Proximity', 'Comfort', 'Fun', 'Quality'];
const NATURE_DIST_EN: Record<string, string> = { '近場': 'Nearby', 'ほどほど': 'Moderate', '遠く': 'Far' };
const ONSEN_EN: Record<string, string> = {
  '天然温泉・日帰り温泉': 'Natural Hot Spring',
  '銭湯': 'Public Bath',
  'スーパー銭湯・健康ランド': 'Super Sentō',
  'サウナ・岩盤浴': 'Sauna / Stone Bath',
  '温泉施設全般（おまかせ）': 'Any (Surprise me)',
};
const NATURE_EN: Record<string, string> = {
  '波の音と海風': 'Ocean & Sea Breeze',
  '森の中で深呼吸': 'Deep Breath in the Forest',
  '広い芝生でゴロゴロ': 'Sprawling Lawn',
  '圧倒的なパノラマ': 'Panoramic Views',
};
const CAFE_EN: Record<string, string> = {
  'ブックカフェ・隠れ家': 'Book Café / Hidden Gem',
  'アニマルカフェ': 'Animal Café',
  '景色が良いカフェ': 'Café with a View',
  '絶品スイーツカフェ': 'Amazing Sweets Café',
};
const WAIWAI_EN: Record<string, string> = {
  '体を動かしてはしゃぎたい': 'Active & Physical',
  '歌って飲んで騒ぎたい': 'Sing, Drink & Party',
  '非日常の体験で盛り上がりたい': 'Unique Experiences',
  'ご飯とお酒でワイワイ': 'Food & Drinks',
};
const DRIVE_EN: Record<string, string> = {
  '海沿いドライブ': 'Coastal Drive',
  '夜景・絶景ドライブ': 'Night View / Scenic Drive',
  '道の駅・ご当地グルメ': 'Road Station & Local Food',
  '郊外アウトレット': 'Suburban Outlet Mall',
};
const FOCUS_EN: Record<string, string> = {
  'カフェで作業': 'Work at a Café',
  'コワーキングスペース': 'Coworking Space',
  'ファミレスで粘る': 'Family Restaurant',
  '本に囲まれてこもる': 'Surrounded by Books',
};
const SPORTS_EN: Record<string, string> = {
  'ガッツリトレーニング': 'Intense Training',
  'ストレス発散': 'Stress Relief',
  '遊び感覚でワイワイ': 'Fun & Social Sports',
  '外でスポーツ': 'Outdoor Sports',
};
const TRAVEL_EN: Record<string, string> = {
  'パワースポット': 'Power Spot / Shrine',
  'テーマパーク': 'Theme Park',
  '街をぶらぶら': 'Town Stroll',
  '絶景・大自然': 'Scenic Views / Nature',
};

// ─── Props ───────────────────────────────────────────────────────────────────

type Props = {
  lang: 'ja' | 'en';
  step: number;
  selectedMood: string;
  selectedArea: string;
  locationDisplayArea: string;
  selectedCompanion: string;
  selectedTransports: string[];
  budget: number | undefined;
  budgetMin: number;
  showUnseenOnly: boolean;
  selectedTime: string;
  selectedAtmosphere: string;
  selectedPriority: string;
  freeWord: string;
  dynamicQuestions: DynamicQuestion[];
  dynamicAnswers: Record<string, string>;
  isLocating: boolean;
  locationError: string;
  onSelectMood: (v: string) => void;
  onSelectArea: (v: string) => void;
  onSelectCompanion: (v: string) => void;
  onSelectTransports: (v: string[]) => void;
  onSetBudget: (v: number | undefined) => void;
  onSetBudgetMin: (v: number) => void;
  onSetShowUnseenOnly: (v: boolean) => void;
  onSelectTime: (v: string) => void;
  onSelectAtmosphere: (v: string) => void;
  onSelectPriority: (v: string) => void;
  onSetFreeWord: (v: string) => void;
  onSetDynamicQuestions: (v: DynamicQuestion[]) => void;
  onSetDynamicAnswers: (v: Record<string, string>) => void;
  onUseCurrentLocation: () => void;
  onSetStep: (v: number) => void;
  onBack: () => void;
  onOpenResults: () => void;
  onsenCategory: OnsenCategory | null;
  onSetOnsenCategory: (v: OnsenCategory) => void;
  natureSubGenre: NatureSubGenre | null;
  onSetNatureSubGenre: (v: NatureSubGenre) => void;
  natureDistancePref: NatureDistancePref | null;
  onSetNatureDistancePref: (v: NatureDistancePref) => void;
  cafeSubCategory: CafeSubCategory | null;
  onSetCafeSubCategory: (v: CafeSubCategory) => void;
  cafeDetail: CafeDetail | null;
  onSetCafeDetail: (v: CafeDetail) => void;
  cafeDetailMode: boolean;
  onSetCafeDetailMode: (v: boolean) => void;
  cafeDistancePref: CafeDistancePref | null;
  onSetCafeDistancePref: (v: CafeDistancePref) => void;
  waiWaiSubCategory: WaiWaiSubCategory | null;
  onSetWaiWaiSubCategory: (v: WaiWaiSubCategory) => void;
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function QuizFlow(props: Props) {
  const insets = useSafeAreaInsets();
  const {
    lang,
    step, selectedMood, selectedArea, locationDisplayArea,
    selectedCompanion, selectedTransports, budget, budgetMin,
    selectedTime, selectedAtmosphere, selectedPriority, freeWord,
    dynamicQuestions, dynamicAnswers, isLocating, locationError,
    onSelectMood, onSelectArea, onSelectCompanion, onSelectTransports,
    onSetBudget, onSetBudgetMin, onSelectTime, onSelectAtmosphere,
    onSelectPriority, onSetFreeWord, onSetDynamicQuestions, onSetDynamicAnswers,
    onUseCurrentLocation, onSetStep, onBack, onOpenResults,
    onsenCategory, onSetOnsenCategory,
    natureSubGenre, onSetNatureSubGenre, natureDistancePref, onSetNatureDistancePref,
    cafeSubCategory, onSetCafeSubCategory, cafeDetail, onSetCafeDetail,
    cafeDetailMode, onSetCafeDetailMode, cafeDistancePref, onSetCafeDistancePref,
    waiWaiSubCategory, onSetWaiWaiSubCategory,
  } = props;

  // ─── Step animation ───────────────────────────────────────────────────
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const stepSlide   = useRef(new Animated.Value(0)).current;
  const prevStep    = useRef(step);

  useEffect(() => {
    const dir = step >= prevStep.current ? 1 : -1;
    prevStep.current = step;
    stepSlide.setValue(dir * 36);
    stepOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(stepOpacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(stepSlide,   { toValue: 0, tension: 200, friction: 26, useNativeDriver: true }),
    ]).start();
  }, [step]);

  const t = T[lang];

  const relaxPlace = dynamicAnswers['relax_place'] ?? '';
  const isNatureMode =
    selectedMood === '自然感じたい' ||
    (selectedMood === 'まったりしたい' && relaxPlace.includes('自然の中'));
  const isOnsenMode = selectedMood === 'まったりしたい' && relaxPlace.includes('温泉');
  const isCafeMode = selectedMood === 'まったりしたい' && relaxPlace.includes('カフェ');
  const isWaiWaiMode = selectedMood === 'わいわい楽しみたい';
  const isHaraMode = selectedMood === 'お腹すいた';
  const isDriveMode = selectedMood === 'ドライブしたい';
  const isFocusMode = selectedMood === '集中したい';
  const isSportsMode = selectedMood === '体を動かしたい';
  const isTravelMode = selectedMood === '遠くに行きたい';

  const foodGenreAns = dynamicAnswers['food_genre_new'] ?? '';
  const matchedFoodGenre = Object.keys(FOOD_SUB_QUESTIONS_MAP).find(k => foodGenreAns.includes(k));
  const foodSubQ = matchedFoodGenre ? FOOD_SUB_QUESTIONS_MAP[matchedFoodGenre] : null;

  // ─── Option grid ──────────────────────────────────────────────────────

  const renderOptions = (
    options: string[],
    selected: string,
    onSelect: (v: string) => void,
    cols = 2
  ) => (
    <View style={[s.grid, { gap: 10 }]}>
      {options.map((opt) => {
        const active = selected === opt;
        const Icon = OPTION_ICONS[opt];
        const label = stripEmoji(opt);
        return (
          <TouchableOpacity
            key={opt}
            onPress={() => onSelect(opt)}
            activeOpacity={0.7}
            style={[
              s.optBtn,
              { width: cols === 2 ? '48%' : cols === 3 ? '31%' : '100%' },
              active && s.optBtnActive,
            ]}
          >
            {Icon && (
              <Icon size={18} color={active ? '#CC6600' : '#9b7b82'} strokeWidth={1.8} />
            )}
            <Text style={[s.optText, active && s.optTextActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderMultiOptions = (
    options: string[],
    selected: string[],
    onToggle: (v: string) => void,
    cols = 2
  ) => (
    <View style={[s.grid, { gap: 10 }]}>
      {options.map((opt) => {
        const active = selected.includes(opt);
        const Icon = OPTION_ICONS[opt];
        const label = stripEmoji(opt);
        return (
          <TouchableOpacity
            key={opt}
            onPress={() => onToggle(opt)}
            activeOpacity={0.7}
            style={[
              s.optBtn,
              { width: cols === 2 ? '48%' : cols === 3 ? '31%' : '100%' },
              active && s.optBtnActive,
            ]}
          >
            {active && <Text style={s.check}>✓</Text>}
            {Icon && (
              <Icon size={18} color={active ? '#CC6600' : '#9b7b82'} strokeWidth={1.8} />
            )}
            <Text style={[s.optText, active && s.optTextActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ─── Next button ──────────────────────────────────────────────────────

  const renderNext = (onNext: () => void, label: string = t.next, disabled = false) => (
    <View style={[s.actionBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <TouchableOpacity onPress={disabled ? undefined : onNext} activeOpacity={0.85}>
        <LinearGradient
          colors={disabled ? ['#ccc', '#ccc'] : ['#ffbf67', '#ff7b54']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.nextBtn}
        >
          <Text style={s.nextText}>{label}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );

  // ─── Step content ──────────────────────────────────────────────────────

  const renderStepContent = () => {
    // Step 1: Mood selection
    if (step === 1) {
      return (
        <>
          <Text style={s.stepTitle}>{t.step1Title}</Text>
          <Text style={s.stepSub}>{t.step1Sub}</Text>
          <View style={s.grid}>
            {MOODS.map((m) => {
              const active = selectedMood === m.key;
              const en = MOOD_EN[m.key];
              return (
                <TouchableOpacity
                  key={m.key}
                  onPress={() => {
                    onSelectMood(m.key);
                    const pool = MOOD_QUESTIONS[m.key] ?? [];
                    onSetDynamicQuestions(pool);
                    onSetDynamicAnswers({});
                    if (m.key === '時間潰したい') onOpenResults();
                  }}
                  activeOpacity={0.7}
                  style={[s.moodBtn, active && s.moodBtnActive]}
                >
                  <View style={s.moodIconWrap}>
                    <m.Icon size={24} color={active ? '#CC6600' : '#4a3034'} strokeWidth={1.8} />
                  </View>
                  <Text style={[s.moodLabel, active && s.moodLabelActive]}>
                    {lang === 'en' && en ? en.label : m.label}
                  </Text>
                  <Text style={s.moodSub}>{lang === 'en' && en ? en.sub : m.sub}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      );
    }

    // Step 2: Companion
    if (step === 2) {
      const companions = lang === 'en' ? COMPANIONS_EN : COMPANIONS;
      return (
        <>
          <Text style={s.stepTitle}>{t.step2Title}</Text>
          <Text style={s.stepSub}>{t.step2Sub}</Text>
          {renderOptions(companions, selectedCompanion, (v) => {
            const idx = (lang === 'en' ? COMPANIONS_EN : COMPANIONS).indexOf(v);
            onSelectCompanion(idx >= 0 ? COMPANIONS[idx] : v);
          }, 2)}
        </>
      );
    }

    // Step 3: Transport (or drive distance for ドライブしたい)
    if (step === 3) {
      if (selectedMood === 'ドライブしたい' && dynamicQuestions[0]) {
        const dq = dynamicQuestions[0];
        return (
          <>
            <Text style={s.stepTitle}>{dq.question}</Text>
            <Text style={s.stepSub}>{t.driveDetail}</Text>
            {renderOptions(dq.options, dynamicAnswers[dq.key] ?? '', (v) =>
              onSetDynamicAnswers({ ...dynamicAnswers, [dq.key]: v })
            )}
          </>
        );
      }
      const transports = lang === 'en' ? TRANSPORT_EN : TRANSPORT_OPTIONS;
      return (
        <>
          <Text style={s.stepTitle}>{t.step3Title}</Text>
          <Text style={s.stepSub}>{t.step3Sub}</Text>
          {renderMultiOptions(transports, selectedTransports.map(v => {
            const idx = TRANSPORT_OPTIONS.indexOf(v);
            return lang === 'en' && idx >= 0 ? TRANSPORT_EN[idx] : v;
          }), (opt) => {
            const idx = (lang === 'en' ? TRANSPORT_EN : TRANSPORT_OPTIONS).indexOf(opt);
            const jaVal = idx >= 0 ? TRANSPORT_OPTIONS[idx] : opt;
            const anyVal = lang === 'en' ? TRANSPORT_EN[TRANSPORT_OPTIONS.indexOf('なんでも')] : 'なんでも';
            if (opt === anyVal) {
              onSelectTransports(selectedTransports.includes('なんでも') ? [] : ['なんでも']);
            } else {
              const without = selectedTransports.filter((t) => t !== 'なんでも');
              onSelectTransports(
                selectedTransports.includes(jaVal)
                  ? without.filter((t) => t !== jaVal)
                  : [...without, jaVal]
              );
            }
          }, 3)}
        </>
      );
    }

    // Step 4: Budget
    if (step === 4) {
      return (
        <>
          <Text style={s.stepTitle}>{t.step4Title}</Text>
          <Text style={s.stepSub}>{t.step4Sub}</Text>
          <View style={s.budgetBox}>
            <Text style={s.budgetValue}>
              {budgetMin > 0 ? `¥${budgetMin.toLocaleString('ja-JP')} 〜 ` : ''}
              {budget === 0 ? t.free : `¥${(budget ?? 0).toLocaleString('ja-JP')}`}
            </Text>
            <Slider
              style={{ width: '100%', height: 36 }}
              minimumValue={0} maximumValue={50000} step={500}
              value={budget ?? 0}
              onValueChange={(v) => onSetBudget(Math.round(v))}
              minimumTrackTintColor="#FF9500"
              maximumTrackTintColor="#e5e5ea"
              thumbTintColor="#FF9500"
            />
            <View style={s.budgetLabels}>
              {['¥0', '¥10,000', '¥30,000', '¥50,000'].map((l) => (
                <Text key={l} style={s.budgetLabelText}>{l}</Text>
              ))}
            </View>
          </View>
          <View style={[s.grid, { gap: 8 }]}>
            {[0, 1000, 3000, 5000, 10000, 30000].map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => { onSetBudget(p); onSetBudgetMin(0); }}
                style={[s.budgetChip, (budget ?? 0) === p && s.budgetChipActive]}
              >
                <Text style={[(budget ?? 0) === p ? s.budgetChipTextActive : s.budgetChipText]}>
                  {p === 0 ? t.free : `¥${p.toLocaleString('ja-JP')}`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      );
    }

    // Step 5: Area / Location
    if (step === 5) {
      return (
        <>
          <Text style={s.stepTitle}>{t.step5Title}</Text>
          <Text style={s.stepSub}>{t.step5Sub}</Text>
          <TouchableOpacity
            onPress={onUseCurrentLocation}
            disabled={isLocating}
            activeOpacity={0.85}
            style={s.locationBtnWrap}
          >
            <LinearGradient
              colors={isLocating ? ['#ccc', '#ccc'] : ['#ffbf67', '#ff7b54']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.locationBtn}
            >
              <Text style={s.locationBtnText}>
                {isLocating ? t.locating : t.useLocation}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
          {locationDisplayArea ? (
            <View style={s.locatedTag}>
              <Text style={s.locatedTagText}>📍 {locationDisplayArea}</Text>
            </View>
          ) : null}
          <Text style={s.orDivider}>{t.orDivider}</Text>
          <TextInput
            value={selectedArea}
            onChangeText={onSelectArea}
            placeholder={t.areaPlaceholder}
            placeholderTextColor="#b07080"
            style={s.textInput}
          />
          {locationError ? <Text style={s.errorText}>{locationError}</Text> : null}
        </>
      );
    }

    // Step 6: Time + dynamic questions (for moods that have them)
    if (step === 6) {
      // For お腹すいた: show food distance instead of time
      if (isHaraMode) {
        const distOpts = lang === 'en' ? FOOD_DISTANCE_EN : FOOD_DISTANCE_OPTIONS;
        const currentDist = dynamicAnswers['food_distance'] ?? '';
        const displayDist = lang === 'en'
          ? FOOD_DISTANCE_EN[FOOD_DISTANCE_OPTIONS.indexOf(currentDist)] ?? currentDist
          : currentDist;
        return (
          <>
            <Text style={s.stepTitle}>{t.foodDistTitle}</Text>
            <Text style={s.stepSub}>{t.foodDistSub}</Text>
            {renderOptions(distOpts, displayDist, (v) => {
              const idx = distOpts.indexOf(v);
              onSetDynamicAnswers({ ...dynamicAnswers, food_distance: idx >= 0 ? FOOD_DISTANCE_OPTIONS[idx] : v });
            }, 2)}
            {dynamicQuestions.map((dq) => (
              <View key={dq.key} style={{ marginTop: 24 }}>
                <Text style={s.dynQuestion}>{dq.question}</Text>
                {renderOptions(dq.options, dynamicAnswers[dq.key] ?? '', (v) =>
                  onSetDynamicAnswers({ ...dynamicAnswers, [dq.key]: v })
                )}
              </View>
            ))}
          </>
        );
      }

      // ドライブしたい: skip time picker, show drive vibe + road questions only
      if (isDriveMode) {
        const driveDqs = dynamicQuestions.filter((dq) => dq.key !== 'drive_distance');
        return (
          <>
            <Text style={s.stepTitle}>{t.driveVibeTitle}</Text>
            <Text style={s.stepSub}>{t.driveVibeSub}</Text>
            {driveDqs.map((dq, i) => (
              <View key={dq.key} style={i > 0 ? { marginTop: 24 } : {}}>
                <Text style={[s.dynQuestion, i === 0 && { marginBottom: 10 }]}>{dq.question}</Text>
                {renderOptions(dq.options, dynamicAnswers[dq.key] ?? '', (v) =>
                  onSetDynamicAnswers({ ...dynamicAnswers, [dq.key]: v })
                )}
              </View>
            ))}
          </>
        );
      }

      // 遠くに行きたい: dynamicQuestions already include travel_time, skip generic time picker
      if (isTravelMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.travelDetailTitle}</Text>
            <Text style={s.stepSub}>{t.travelDetailSub}</Text>
            {dynamicQuestions.map((dq, i) => (
              <View key={dq.key} style={i > 0 ? { marginTop: 24 } : {}}>
                <Text style={[s.dynQuestion, i === 0 && { marginBottom: 10 }]}>{dq.question}</Text>
                {renderOptions(dq.options, dynamicAnswers[dq.key] ?? '', (v) =>
                  onSetDynamicAnswers({ ...dynamicAnswers, [dq.key]: v })
                )}
              </View>
            ))}
          </>
        );
      }

      const moodDqs = dynamicQuestions.filter((dq) => true);
      const timeOpts = lang === 'en' ? TIME_EN : TIME_OPTIONS;
      return (
        <>
          <Text style={s.stepTitle}>{t.step6Title}</Text>
          <Text style={s.stepSub}>{t.step6Sub}</Text>
          {renderOptions(timeOpts, lang === 'en'
            ? TIME_EN[TIME_OPTIONS.indexOf(selectedTime)] ?? selectedTime
            : selectedTime,
            (v) => {
              const idx = timeOpts.indexOf(v);
              onSelectTime(idx >= 0 ? TIME_OPTIONS[idx] : v);
            }, 2)}

          {moodDqs.map((dq) => (
            <View key={dq.key} style={{ marginTop: 24 }}>
              <Text style={s.dynQuestion}>{dq.question}</Text>
              {renderOptions(dq.options, dynamicAnswers[dq.key] ?? '', (v) =>
                onSetDynamicAnswers({ ...dynamicAnswers, [dq.key]: v })
              )}
            </View>
          ))}
        </>
      );
    }

    // Step 7: Free-form text
    if (step === 7) {
      return (
        <>
          <Text style={s.stepTitle}>{t.step7Title}</Text>
          <Text style={s.stepSub}>{t.step7Sub}</Text>
          <TextInput
            value={freeWord}
            onChangeText={onSetFreeWord}
            placeholder={t.freeWordPlaceholder}
            placeholderTextColor="#b07080"
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={s.textarea}
          />
        </>
      );
    }

    // Step 8: Mood-specific subcategory
    if (step === 8) {
      if (isHaraMode && foodSubQ) {
        return (
          <>
            <Text style={s.stepTitle}>{foodSubQ.question}</Text>
            <Text style={s.stepSub}>{t.foodSubSub}</Text>
            {renderOptions(foodSubQ.options, dynamicAnswers['food_sub_choice'] ?? '', (v) =>
              onSetDynamicAnswers({ ...dynamicAnswers, food_sub_choice: v })
            )}
          </>
        );
      }

      if (isDriveMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.driveTitle}</Text>
            <Text style={s.stepSub}>{t.driveSub}</Text>
            <View style={s.grid}>
              {DRIVE_SUBCATEGORIES.map((cat) => {
                const active = dynamicAnswers['drive_subcategory'] === cat.key;
                const label = lang === 'en' ? (DRIVE_EN[cat.label] ?? cat.label) : cat.label;
                return (
                  <TouchableOpacity key={cat.key} onPress={() => onSetDynamicAnswers({ ...dynamicAnswers, drive_subcategory: cat.key })} style={[s.catBtn, active && s.catBtnActive]} activeOpacity={0.7}>
                    <View style={s.catIconWrap}><cat.Icon size={24} color={active ? '#CC6600' : '#4a3034'} strokeWidth={1.8} /></View>
                    <Text style={[s.catLabel, active && s.catLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );
      }

      if (isFocusMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.focusTitle}</Text>
            <Text style={s.stepSub}>{t.focusSub}</Text>
            <View style={s.grid}>
              {FOCUS_SUBCATEGORIES.map((cat) => {
                const active = dynamicAnswers['focus_subcategory'] === cat.key;
                const label = lang === 'en' ? (FOCUS_EN[cat.label] ?? cat.label) : cat.label;
                return (
                  <TouchableOpacity key={cat.key} onPress={() => onSetDynamicAnswers({ ...dynamicAnswers, focus_subcategory: cat.key })} style={[s.catBtn, active && s.catBtnActive]} activeOpacity={0.7}>
                    <View style={s.catIconWrap}><cat.Icon size={24} color={active ? '#CC6600' : '#4a3034'} strokeWidth={1.8} /></View>
                    <Text style={[s.catLabel, active && s.catLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );
      }

      if (isSportsMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.sportsTitle}</Text>
            <Text style={s.stepSub}>{t.sportsSub}</Text>
            <View style={s.grid}>
              {SPORTS_SUBCATEGORIES.map((cat) => {
                const active = dynamicAnswers['sports_subcategory'] === cat.key;
                const label = lang === 'en' ? (SPORTS_EN[cat.label] ?? cat.label) : cat.label;
                return (
                  <TouchableOpacity key={cat.key} onPress={() => onSetDynamicAnswers({ ...dynamicAnswers, sports_subcategory: cat.key })} style={[s.catBtn, active && s.catBtnActive]} activeOpacity={0.7}>
                    <View style={s.catIconWrap}><cat.Icon size={24} color={active ? '#CC6600' : '#4a3034'} strokeWidth={1.8} /></View>
                    <Text style={[s.catLabel, active && s.catLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );
      }

      if (isTravelMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.travelTitle}</Text>
            <Text style={s.stepSub}>{t.travelSub}</Text>
            <View style={s.grid}>
              {TRAVEL_SUBCATEGORIES.map((cat) => {
                const active = dynamicAnswers['travel_subcategory'] === cat.key;
                const label = lang === 'en' ? (TRAVEL_EN[cat.label] ?? cat.label) : cat.label;
                return (
                  <TouchableOpacity key={cat.key} onPress={() => onSetDynamicAnswers({ ...dynamicAnswers, travel_subcategory: cat.key })} style={[s.catBtn, active && s.catBtnActive]} activeOpacity={0.7}>
                    <View style={s.catIconWrap}><cat.Icon size={24} color={active ? '#CC6600' : '#4a3034'} strokeWidth={1.8} /></View>
                    <Text style={[s.catLabel, active && s.catLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );
      }

      if (isOnsenMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.onsenTitle}</Text>
            <Text style={s.stepSub}>{t.onsenSub}</Text>
            <View style={s.grid}>
              {ONSEN_CATEGORIES.map((cat) => {
                const active = onsenCategory === cat.key;
                const label = lang === 'en' ? (ONSEN_EN[cat.label] ?? cat.label) : cat.label;
                return (
                  <TouchableOpacity key={cat.key} onPress={() => onSetOnsenCategory(cat.key)} style={[s.catBtn, active && s.catBtnActive]} activeOpacity={0.7}>
                    <View style={s.catIconWrap}><cat.Icon size={24} color={active ? '#CC6600' : '#4a3034'} strokeWidth={1.8} /></View>
                    <Text style={[s.catLabel, active && s.catLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );
      }

      if (isNatureMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.natureTitle}</Text>
            <Text style={s.stepSub}>{t.natureSub}</Text>
            <View style={s.grid}>
              {NATURE_SUBGENRES.map((sg) => {
                const active = natureSubGenre === sg.key;
                const label = lang === 'en' ? (NATURE_EN[sg.label] ?? sg.label) : sg.label;
                return (
                  <TouchableOpacity key={sg.key} onPress={() => onSetNatureSubGenre(sg.key)} style={[s.catBtn, active && s.catBtnActive]} activeOpacity={0.7}>
                    <View style={s.catIconWrap}><sg.Icon size={24} color={active ? '#CC6600' : '#4a3034'} strokeWidth={1.8} /></View>
                    <Text style={[s.catLabel, active && s.catLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );
      }

      if (isCafeMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.cafeTitle}</Text>
            <Text style={s.stepSub}>{t.cafeSub}</Text>
            <View style={s.grid}>
              {CAFE_SUBCATEGORIES.map((cat) => {
                const active = cafeSubCategory === cat.key;
                const label = lang === 'en' ? (CAFE_EN[cat.label] ?? cat.label) : cat.label;
                return (
                  <TouchableOpacity key={cat.key} onPress={() => onSetCafeSubCategory(cat.key)} style={[s.catBtn, active && s.catBtnActive]} activeOpacity={0.7}>
                    <View style={s.catIconWrap}><cat.Icon size={24} color={active ? '#CC6600' : '#4a3034'} strokeWidth={1.8} /></View>
                    <Text style={[s.catLabel, active && s.catLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );
      }

      if (isWaiWaiMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.waiwaiTitle}</Text>
            <Text style={s.stepSub}>{t.waiwaiSub}</Text>
            <View style={s.grid}>
              {WAIWAI_SUBCATEGORIES.map((cat) => {
                const active = waiWaiSubCategory === cat.key;
                const label = lang === 'en' ? (WAIWAI_EN[cat.label] ?? cat.label) : cat.label;
                return (
                  <TouchableOpacity key={cat.key} onPress={() => onSetWaiWaiSubCategory(cat.key)} style={[s.catBtn, active && s.catBtnActive]} activeOpacity={0.7}>
                    <View style={s.catIconWrap}><cat.Icon size={24} color={active ? '#CC6600' : '#4a3034'} strokeWidth={1.8} /></View>
                    <Text style={[s.catLabel, active && s.catLabelActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );
      }

      // Default step 8: Atmosphere
      const atmOpts = lang === 'en' ? ATM_EN : ATMOSPHERE_OPTIONS;
      return (
        <>
          <Text style={s.stepTitle}>{t.atmTitle}</Text>
          <Text style={s.stepSub}>{t.atmSub}</Text>
          {renderOptions(atmOpts, lang === 'en' ? ATM_EN[ATMOSPHERE_OPTIONS.indexOf(selectedAtmosphere)] ?? selectedAtmosphere : selectedAtmosphere, (v) => {
            const idx = atmOpts.indexOf(v);
            onSelectAtmosphere(idx >= 0 ? ATMOSPHERE_OPTIONS[idx] : v);
          }, 2)}
        </>
      );
    }

    // Step 9: Mood-specific detail OR priority
    if (step === 9) {
      if (isNatureMode) {
        const distOpts = lang === 'en' ? NATURE_DISTANCES.map(d => NATURE_DIST_EN[d] ?? d) : NATURE_DISTANCES;
        return (
          <>
            <Text style={s.stepTitle}>{t.natureDistTitle}</Text>
            <Text style={s.stepSub}>{t.natureDistSub}</Text>
            <View style={s.grid}>
              {distOpts.map((d, i) => {
                const jaVal = NATURE_DISTANCES[i];
                return (
                  <TouchableOpacity key={d} onPress={() => onSetNatureDistancePref(jaVal)} style={[s.optBtn, { width: '31%' }, natureDistancePref === jaVal && s.optBtnActive]} activeOpacity={0.7}>
                    <Text style={[s.optText, natureDistancePref === jaVal && s.optTextActive]}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );
      }

      if (isCafeMode && (cafeSubCategory === 'animal' || cafeSubCategory === 'view')) {
        const detailOptions =
          cafeSubCategory === 'animal'
            ? [
                { key: 'cat' as CafeDetail, label: lang === 'en' ? 'Cat Café 🐱' : '猫カフェ 🐱' },
                { key: 'dog' as CafeDetail, label: lang === 'en' ? 'Dog Café 🐶' : '犬カフェ 🐶' },
                { key: 'rare' as CafeDetail, label: lang === 'en' ? 'Exotic Animals 🦔' : '小動物・珍しい動物 🦔' },
              ]
            : [
                { key: 'ocean' as CafeDetail, label: lang === 'en' ? 'Ocean View 🌊' : '海・水辺 🌊' },
                { key: 'forest' as CafeDetail, label: lang === 'en' ? 'Forest / Green 🌲' : '森・緑 🌲' },
                { key: 'city' as CafeDetail, label: lang === 'en' ? 'City View 🏙️' : '街並み・高層ビル 🏙️' },
              ];
        return (
          <>
            <Text style={s.stepTitle}>{t.cafeDetailTitle}</Text>
            <Text style={s.stepSub}>{t.cafeDetailSub}</Text>
            <View style={s.grid}>
              {detailOptions.map((d) => (
                <TouchableOpacity key={d.key} onPress={() => onSetCafeDetail(d.key)} style={[s.catBtn, cafeDetail === d.key && s.catBtnActive]} activeOpacity={0.7}>
                  <Text style={[s.catLabel, cafeDetail === d.key && s.catLabelActive]}>{d.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        );
      }

      // Default step 9: Priority
      const priorOpts = lang === 'en' ? PRIORITY_EN : PRIORITY_OPTIONS;
      return (
        <>
          <Text style={s.stepTitle}>{t.priorTitle}</Text>
          <Text style={s.stepSub}>{t.priorSub}</Text>
          {renderOptions(priorOpts, lang === 'en' ? PRIORITY_EN[PRIORITY_OPTIONS.indexOf(selectedPriority)] ?? selectedPriority : selectedPriority, (v) => {
            const idx = priorOpts.indexOf(v);
            onSelectPriority(idx >= 0 ? PRIORITY_OPTIONS[idx] : v);
          }, 2)}
        </>
      );
    }

    // Step 10: Review + Submit
    if (step === 10) {
      const summary = [
        selectedMood && `${t.reviewMood}：${lang === 'en' ? (MOOD_EN[selectedMood]?.label ?? selectedMood) : selectedMood}`,
        selectedArea && `${t.reviewArea}：${selectedArea}`,
        selectedCompanion && `${t.reviewWith}：${lang === 'en' ? (COMPANIONS_EN[COMPANIONS.indexOf(selectedCompanion)] ?? selectedCompanion) : selectedCompanion}`,
        selectedTransports.length > 0 && `${t.reviewTransport}：${selectedTransports.join('・')}`,
        budget !== undefined && `${t.reviewBudget}：¥${budget.toLocaleString('ja-JP')}`,
        selectedTime && `${t.reviewTime}：${lang === 'en' ? (TIME_EN[TIME_OPTIONS.indexOf(selectedTime)] ?? selectedTime) : selectedTime}`,
        selectedAtmosphere && `${t.reviewAtm}：${lang === 'en' ? (ATM_EN[ATMOSPHERE_OPTIONS.indexOf(selectedAtmosphere)] ?? selectedAtmosphere) : selectedAtmosphere}`,
        selectedPriority && `${t.reviewPriority}：${lang === 'en' ? (PRIORITY_EN[PRIORITY_OPTIONS.indexOf(selectedPriority)] ?? selectedPriority) : selectedPriority}`,
        freeWord && `${t.reviewMemo}：${freeWord}`,
      ].filter(Boolean);

      return (
        <>
          <Text style={s.stepTitle}>{t.step10Title}</Text>
          <Text style={s.stepSub}>{t.step10Sub}</Text>
          <View style={s.reviewCard}>
            {summary.map((line, i) => (
              <Text key={i} style={s.reviewLine}>{line as string}</Text>
            ))}
          </View>
        </>
      );
    }

    return null;
  };

  const nextStep = () => onSetStep(step + 1);
  const isLastStep = step === 10;

  return (
    <View style={s.root}>
      {/* iOS nav bar */}
      <View style={[s.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={onBack} style={s.backBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ChevronLeft size={20} color="#FF6B35" strokeWidth={2.5} />
          <Text style={s.backText}>{t.back}</Text>
        </TouchableOpacity>
        <View style={s.progressWrap}>
          <View style={[s.progressBar, { width: `${(step / 10) * 100}%` as any }]} />
        </View>
        <Text style={s.stepCount}>{step}/10</Text>
      </View>

      {/* Content */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingBottom: 120 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: stepOpacity, transform: [{ translateX: stepSlide }] }}>
          {renderStepContent()}
        </Animated.View>
      </ScrollView>

      {/* Next button */}
      {isLastStep
        ? renderNext(onOpenResults, t.submit)
        : renderNext(nextStep, step === 1 && !selectedMood ? t.skip : t.next)}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10,
    backgroundColor: '#fff', gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.12)',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 8, minWidth: 64 },
  backText: { fontSize: 17, color: '#FF6B35', fontWeight: '400' },
  progressWrap: {
    flex: 1, height: 3, backgroundColor: '#E5E5EA', borderRadius: 2, overflow: 'hidden',
  },
  progressBar: { height: '100%', backgroundColor: '#FF6B35', borderRadius: 2 },
  stepCount: { fontSize: 13, fontWeight: '500', color: '#8E8E93', minWidth: 36, textAlign: 'right', paddingRight: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
  stepTitle: { fontSize: 30, fontWeight: '700', color: '#000', marginBottom: 4, letterSpacing: -0.5 },
  stepSub: { fontSize: 14, color: '#8E8E93', marginBottom: 20, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optBtn: {
    paddingVertical: 11, paddingHorizontal: 14, borderRadius: 10,
    backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: '#C6C6C8',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  optBtnActive: {
    backgroundColor: '#FF6B3515', borderColor: '#FF6B35', borderWidth: 1.5,
  },
  optText: { fontSize: 14, fontWeight: '500', color: '#000', textAlign: 'center' },
  optTextActive: { color: '#FF6B35', fontWeight: '600' },
  check: { position: 'absolute', top: 5, right: 7, fontSize: 10, fontWeight: '700', color: '#FF6B35' },
  moodBtn: {
    width: '48%', paddingVertical: 16, paddingHorizontal: 14, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
    alignItems: 'flex-start', gap: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4,
    elevation: 2,
  },
  moodBtnActive: {
    backgroundColor: '#FF6B3512', borderColor: '#FF6B35', borderWidth: 1.5,
  },
  moodIconWrap: { marginBottom: 4 },
  moodLabel: { fontSize: 14, fontWeight: '600', color: '#000' },
  moodLabelActive: { color: '#FF6B35' },
  moodSub: { fontSize: 11, color: '#8E8E93', fontWeight: '400' },
  actionBar: {
    padding: 16, paddingBottom: 16, backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(0,0,0,0.12)',
  },
  nextBtn: {
    height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  nextText: { fontSize: 17, fontWeight: '600', color: '#fff' },
  budgetBox: {
    backgroundColor: '#fff', borderRadius: 14, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4,
  },
  budgetValue: { fontSize: 34, fontWeight: '700', color: '#000', textAlign: 'center', marginBottom: 8 },
  budgetLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  budgetLabelText: { fontSize: 11, color: '#8E8E93' },
  budgetChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#C6C6C8', backgroundColor: '#fff',
  },
  budgetChipActive: { backgroundColor: '#FF6B3515', borderColor: '#FF6B35', borderWidth: 1.5 },
  budgetChipText: { fontSize: 13, fontWeight: '500', color: '#000' },
  budgetChipTextActive: { fontSize: 13, fontWeight: '600', color: '#FF6B35' },
  locationBtnWrap: {
    shadowColor: '#FF6B35', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 10, elevation: 4, marginBottom: 12,
  },
  locationBtn: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  locationBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  locatedTag: {
    alignSelf: 'center', backgroundColor: '#FF6B3512', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8,
  },
  locatedTagText: { fontSize: 13, fontWeight: '600', color: '#FF6B35' },
  orDivider: { textAlign: 'center', fontSize: 13, color: '#8E8E93', marginBottom: 12 },
  textInput: {
    height: 52, borderRadius: 10, backgroundColor: '#fff',
    paddingHorizontal: 14, fontSize: 15, color: '#000',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#C6C6C8',
  },
  errorText: { fontSize: 13, color: '#FF3B30', marginTop: 8, lineHeight: 20 },
  dynQuestion: { fontSize: 17, fontWeight: '600', color: '#000', marginBottom: 10 },
  textarea: {
    borderRadius: 10, padding: 14, fontSize: 15, backgroundColor: '#fff', color: '#000',
    lineHeight: 24, minHeight: 140, textAlignVertical: 'top',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#C6C6C8',
  },
  catBtn: {
    width: '48%', paddingVertical: 16, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
    alignItems: 'center', gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4,
    elevation: 1,
  },
  catBtnActive: { backgroundColor: '#FF6B3512', borderColor: '#FF6B35', borderWidth: 1.5 },
  catIconWrap: { marginBottom: 2 },
  catLabel: { fontSize: 13, fontWeight: '500', color: '#000', textAlign: 'center', lineHeight: 18 },
  catLabelActive: { color: '#FF6B35', fontWeight: '600' },
  reviewCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 20, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4,
  },
  reviewLine: { fontSize: 14, color: '#3C3C43', fontWeight: '400', lineHeight: 22 },
});
