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
      '高層ビル料理🏙️',
    ]},
  ],
  'まったりしたい': [
    { key: 'relax_place', question: 'どこで癒やされたい？', options: ['自然の中🌿', 'カフェ☕', '温泉・スパ♨️', '絶景スポット🌅'] },
  ],
  'わいわい楽しみたい': [],
  'ドライブしたい': [],
  '自然感じたい': [],
  '集中したい': [],
  '体を動かしたい': [],
  '遠くに行きたい': [],
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
  // food sub-questions
  '海鮮・魚介系🐟': Fish, '焼き鳥・串焼き🍡': Utensils, 'もつ・ホルモン系🔥': Flame, '創作料理・おしゃれ系✨': Sparkles, 'なんでもOK': Shuffle,
  '寿司・海鮮🍣': Fish, 'そば・うどん🍜': Soup, '天ぷら・揚げ物🍤': EggFried, '定食・家庭的🍱': Home,
  'ハンバーグ・ステーキ🥩': Flame, 'パスタ・ピザ🍝': UtensilsCrossed, 'カフェ飯・ランチ🥗': Coffee, 'ハンバーガー🍔': Utensils,
  '本格ピザ🍕': UtensilsCrossed, 'パスタ中心🍝': Utensils, 'トラットリア（家庭的）🏠': Home, 'リストランテ（高級）✨': Star,
  '高級和牛🥩': Flame, 'コスパ重視💰': Coins, 'ホルモン系🔥': Flame, '1人焼肉🙋': User,
  'タイ料理🍛': Compass, 'ベトナム料理🍜': Soup, 'インド料理🍲': Wheat, '中東・トルコ料理🌯': Globe,
  'メキシコ・スペイン🌮': Sun, 'フレンチ・欧州🥐': Star, 'アフリカ・中東🌍': Globe, '珍しい国の料理🗺️': Map,
  '醤油・塩🍜': Soup, '豚骨🐖': Utensils, '味噌🌾': Wheat, 'つけ麺・まぜそば🍣': Soup,
  'パンケーキ・ワッフル🥞': Wheat, 'ケーキ・パティスリー🎂': Star, 'チョコレート系🍫': Heart, '和スイーツ・あんこ🍡': Leaf,
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
  '徒歩': Footprints, '自転車': Bike, '電車・バス': TrainFront, '車・バイク': Car, 'なんでも': Shuffle,
  '自転車・バイク': Bike, '電車': TrainFront, '車': Car, 'バス': Bus,
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
const TRANSPORT_OPTIONS = ['徒歩', '自転車', '電車・バス', '車・バイク', 'なんでも'];
const TIME_OPTIONS = ['15〜30分', '30〜60分', '1〜2時間', '2〜4時間', '4〜6時間', '6時間以上'];
const ATMOSPHERE_OPTIONS = ['静か', '賑やか', 'アクティブ', 'スリル', 'ロマンティック', 'アットホーム'];
const PRIORITY_OPTIONS = ['コスパ', '映え', '距離', '快適さ', '楽しさ', '質の高さ'];

const ONSEN_CATEGORIES = [
  { key: 'natural_onsen' as OnsenCategory, label: '天然温泉・日帰り温泉', sub: '源泉かけ流し・露天風呂', emoji: '♨️' },
  { key: 'sento' as OnsenCategory, label: '銭湯', sub: '昔ながらの公衆浴場', emoji: '🚿' },
  { key: 'super_sento' as OnsenCategory, label: 'スーパー銭湯・健康ランド', sub: '岩盤浴・休憩・食事も', emoji: '🛁' },
  { key: 'sauna_ganban' as OnsenCategory, label: 'サウナ・岩盤浴', sub: 'ととのい・デトックス', emoji: '🧖' },
  { key: 'all_onsen' as OnsenCategory, label: '温泉施設全般（おまかせ）', sub: 'とにかく近くの温浴施設を探す', emoji: '🌊' },
];

const NATURE_SUBGENRES = [
  { key: 'ocean' as NatureSubGenre, label: '波の音と海風', sub: '波・磯の香り・海辺', emoji: '🌊' },
  { key: 'forest' as NatureSubGenre, label: '森の中で深呼吸', sub: '森林・自然公園', emoji: '🌳' },
  { key: 'park' as NatureSubGenre, label: '広い芝生でゴロゴロ', sub: '大型公園・芝生広場', emoji: '🧺' },
  { key: 'view' as NatureSubGenre, label: '圧倒的な絶景', sub: '展望台・絶景スポット', emoji: '🌅' },
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
  { key: 'book_relax' as CafeSubCategory, label: 'ブックカフェ・隠れ家カフェ', sub: '静かに読書・非日常空間でのんびり', emoji: '📚' },
  { key: 'animal' as CafeSubCategory, label: 'アニマルカフェ', sub: '猫・ふくろう・うさぎと癒し時間', emoji: '🐱' },
  { key: 'view' as CafeSubCategory, label: '景色が良いカフェ', sub: 'テラス席・絶景・自然の中のカフェ', emoji: '🌅' },
  { key: 'sweets' as CafeSubCategory, label: '絶品スイーツカフェ', sub: 'パンケーキ・ケーキ・アフタヌーンティー', emoji: '🍰' },
];

const CAFE_DISTANCE_OPTIONS = [
  { key: '近場' as CafeDistancePref, label: '近場', sub: '〜5km圏内', emoji: '🚶' },
  { key: 'ほどほど' as CafeDistancePref, label: 'ほどほど', sub: '3〜15km', emoji: '🚃' },
  { key: '遠く' as CafeDistancePref, label: '遠く', sub: '10〜40km', emoji: '🚗' },
];

const WAIWAI_SUBCATEGORIES = [
  { key: 'active' as WaiWaiSubCategory, label: '体を動かしてはしゃぎたい', sub: 'ボウリング・トランポリン・スポッチャ', emoji: '💪' },
  { key: 'party' as WaiWaiSubCategory, label: '歌って飲んで騒ぎたい', sub: 'カラオケ・ダーツ・ビリヤード', emoji: '🎤' },
  { key: 'experience' as WaiWaiSubCategory, label: '非日常の体験で盛り上がりたい', sub: 'ボードゲームカフェ・脱出ゲーム', emoji: '🎲' },
  { key: 'food_drink' as WaiWaiSubCategory, label: '美味しいご飯とお酒でわいわい', sub: '居酒屋・焼肉・食べ放題・飲み放題', emoji: '🍻' },
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
  { key: 'ocean_drive', label: '海沿いを爽快に走りたい', sub: '海岸線・絶景ドライブ・オーシャンビュー', emoji: '🌊' },
  { key: 'night_view', label: '綺麗な景色や夜景を見に行きたい', sub: '展望台・夜景スポット・パノラマビュー', emoji: '🌉' },
  { key: 'road_station', label: '道の駅やSAでご当地グルメ', sub: '道の駅・サービスエリア・ご当地名物', emoji: '🏪' },
  { key: 'outlet', label: '郊外の大型施設に行きたい', sub: 'アウトレットモール・大型ショッピングモール', emoji: '🛍️' },
];

const FOCUS_SUBCATEGORIES = [
  { key: 'work_cafe', label: 'カフェで作業・勉強したい', sub: 'Wi-Fi・電源完備・落ち着いた雰囲気', emoji: '☕' },
  { key: 'coworking', label: '静かな専用スペースで集中したい', sub: 'コワーキング・自習室・ドロップイン', emoji: '🖥️' },
  { key: 'family_restaurant', label: '時間を気にせず深夜まで粘りたい', sub: 'ファミレス・ドリンクバー・24時間営業', emoji: '🍳' },
  { key: 'netcafe_library', label: '漫画・本に囲まれて完全にこもりたい', sub: 'ネットカフェ・マンガ喫茶・図書館', emoji: '📚' },
];

const SPORTS_SUBCATEGORIES = [
  { key: 'training', label: 'がっつり汗を流してトレーニング', sub: 'スポーツジム・市民プール・体育館', emoji: '💪' },
  { key: 'stress_relief', label: '打って投げてストレス発散', sub: 'バッティングセンター・ゴルフ練習場', emoji: '🏏' },
  { key: 'amusement_sport', label: '遊び感覚でわいわい', sub: 'スポッチャ・トランポリン・屋内アスレチック', emoji: '🎯' },
  { key: 'outdoor_sports', label: '外で風を感じながらスポーツ', sub: '公園・コート・運動広場', emoji: '🌳' },
];

const TRAVEL_SUBCATEGORIES = [
  { key: 'power_spot', label: 'パワースポット', sub: '有名な神社・寺院・霊場・歴史的名所', emoji: '⛩️' },
  { key: 'theme_park', label: '別世界のテーマパーク', sub: '遊園地・テーマパーク・水族館', emoji: '🎡' },
  { key: 'town_walk', label: '知らない街をぶらぶら', sub: '古い町並み・食べ歩き・レトロ商店街', emoji: '🚶' },
  { key: 'super_view', label: '息を呑む絶景', sub: '絶景スポット・景勝地・国定公園', emoji: '🌄' },
];

const SCENERY_SUBCATEGORIES = [
  { key: 'ocean_scenery', label: '海・湖の絶景', Icon: Waves },
  { key: 'mountain_scenery', label: '山・高原の絶景', Icon: Mountain },
  { key: 'night_view', label: '夜景スポット', Icon: Moon },
  { key: 'sunset_spot', label: '夕焼けスポット', Icon: Sunset },
];

const SCENERY_EN: Record<string, string> = {
  '海・湖の絶景': 'Ocean & Lake Views',
  '山・高原の絶景': 'Mountain & Highland Views',
  '夜景スポット': 'Night View',
  '夕焼けスポット': 'Sunset Spot',
};

const { width: SCREEN_W } = Dimensions.get('window');
const BTN_2 = Math.floor((SCREEN_W - 40 - 10) / 2);
const BTN_3 = Math.floor((SCREEN_W - 40 - 20) / 3);

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
    cafeDistTitle: 'どのくらいの距離？', cafeDistSub: '現在地からの距離感を選んでください。',
    driveVibeTitle: 'ドライブのこだわりは？', driveVibeSub: '気分に合う条件を選んでください。',
    travelDetailTitle: '旅のプランは？', travelDetailSub: '詳しく教えてください。',
    sceneryTitle: '絶景のタイプは？', scenerySub: '見たい絶景を選んでください。',
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
    cafeDistTitle: 'How far?', cafeDistSub: 'Distance from your current location.',
    driveVibeTitle: 'What\'s your drive vibe?', driveVibeSub: 'Pick what matters most for your drive.',
    travelDetailTitle: 'Trip details', travelDetailSub: 'Tell us more about your trip.',
    sceneryTitle: 'What kind of scenery?', scenerySub: 'Choose what you want to see.',
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
const TRANSPORT_EN  = ['Walking', 'Bike', 'Train / Bus', 'Car / Bike', 'Any'];
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
  '美味しいご飯とお酒でわいわい': 'Food & Drinks',
};
const DRIVE_EN: Record<string, string> = {
  '海沿いドライブ': 'Coastal Drive',
  '夜景・絶景ドライブ': 'Night View / Scenic Drive',
  '道の駅・ご当地グルメ': 'Road Station & Local Food',
  '郊外アウトレット': 'Suburban Outlet Mall',
};
const FOCUS_EN: Record<string, string> = {
  'カフェで作業・勉強したい': 'Work / Study at a Café',
  '静かな専用スペースで集中したい': 'Quiet Dedicated Space',
  '時間を気にせず深夜まで粘りたい': 'All-Night Diner',
  '漫画・本に囲まれて完全にこもりたい': 'Surrounded by Books',
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

// ─── FloatingButton ───────────────────────────────────────────────────────────

function FloatingButton({
  active, onPress, style, children, delay = 0,
}: {
  active: boolean;
  onPress: () => void;
  style: any;
  children: React.ReactNode;
  delay?: number;
}) {
  const floatY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (active) {
      floatY.stopAnimation();
      floatY.setValue(0);
      return;
    }
    let anim: Animated.CompositeAnimation;
    const id = setTimeout(() => {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(floatY, { toValue: -6, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(floatY, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      anim.start();
    }, delay);
    return () => { clearTimeout(id); anim?.stop(); };
  }, [active]);
  return (
    <Animated.View style={{ transform: [{ translateY: floatY }] }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={style}>
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

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
  onsenDistancePref: NatureDistancePref | null;
  onSetOnsenDistancePref: (v: NatureDistancePref) => void;
  scenerySubCategory: string | null;
  onSetScenerySubCategory: (v: string) => void;
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
    onsenDistancePref, onSetOnsenDistancePref,
    scenerySubCategory, onSetScenerySubCategory,
  } = props;

  // ─── Step animation ───────────────────────────────────────────────────
  const stepOpacity = useRef(new Animated.Value(1)).current;
  const stepSlide   = useRef(new Animated.Value(0)).current;
  const prevStep    = useRef(step);
  const scrollRef   = useRef<ScrollView>(null);

  useEffect(() => {
    const dir = step >= prevStep.current ? 1 : -1;
    prevStep.current = step;
    stepSlide.setValue(dir * 36);
    stepOpacity.setValue(0);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
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
  const isSceneryMode = selectedMood === 'まったりしたい' && relaxPlace.includes('絶景');
  const isWaiWaiMode = selectedMood === 'わいわい楽しみたい';
  const isHaraMode = selectedMood === 'お腹すいた';
  const isDriveMode = selectedMood === 'ドライブしたい';
  const isFocusMode = selectedMood === '集中したい';
  const isSportsMode = selectedMood === '体を動かしたい';
  const isTravelMode = selectedMood === '遠くに行きたい';

  useEffect(() => {
    if (step !== 6) return;
    const hasContent =
      (isHaraMode && dynamicQuestions.some(q => q.key === 'food_genre_new')) ||
      (selectedMood === 'まったりしたい' && dynamicQuestions.some(q => q.key === 'relax_place'));
    if (!hasContent) onSetStep(10);
  }, [step, selectedMood]);

  useEffect(() => {
    if (step !== 9) return;
    const showsContent = isNatureMode || isOnsenMode || isCafeMode;
    if (!showsContent) onSetStep(10);
  }, [step, selectedMood, relaxPlace]);

  const foodGenreAns = dynamicAnswers['food_genre_new'] ?? '';
  const matchedFoodGenre = Object.keys(FOOD_SUB_QUESTIONS_MAP).find(k => foodGenreAns.includes(k));
  const foodSubQ = matchedFoodGenre ? FOOD_SUB_QUESTIONS_MAP[matchedFoodGenre] : null;

  // ─── Option grid ──────────────────────────────────────────────────────

  const renderOptions = (
    options: string[],
    selected: string,
    onSelect: (v: string) => void,
    cols = 2
  ) => {
    const btnSize = cols === 2 ? BTN_2 : cols === 3 ? BTN_3 : null;
    const iconSize = cols === 2 ? 28 : 20;
    const textSize = cols === 2 ? 13 : 11;
    return (
      <View style={[s.grid, { gap: 10 }]}>
        {options.map((opt, idx) => {
          const active = selected === opt;
          const Icon = OPTION_ICONS[opt];
          const label = stripEmoji(opt);
          return (
            <FloatingButton
              key={opt}
              active={active}
              onPress={() => onSelect(opt)}
              delay={idx * 160}
              style={[
                s.optBtn,
                btnSize ? { width: btnSize, height: btnSize } : { width: '100%', paddingVertical: 14 },
                active && s.optBtnActive,
              ]}
            >
              {active && (
                <LinearGradient
                  colors={['#fff8f2', '#ffe5ea']}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                />
              )}
              {Icon && <Icon size={iconSize} color={active ? '#c0385a' : '#9b7b82'} strokeWidth={1.8} />}
              <Text style={[s.optText, { fontSize: textSize }, active && s.optTextActive]} numberOfLines={2}>
                {label}
              </Text>
            </FloatingButton>
          );
        })}
      </View>
    );
  };

  const renderMultiOptions = (
    options: string[],
    selected: string[],
    onToggle: (v: string) => void,
    cols = 2
  ) => {
    const btnSize = cols === 2 ? BTN_2 : cols === 3 ? BTN_3 : null;
    const iconSize = cols === 2 ? 28 : 20;
    const textSize = cols === 2 ? 13 : 11;
    return (
      <View style={[s.grid, { gap: 10 }]}>
        {options.map((opt, idx) => {
          const active = selected.includes(opt);
          const Icon = OPTION_ICONS[opt];
          const label = stripEmoji(opt);
          return (
            <FloatingButton
              key={opt}
              active={active}
              onPress={() => onToggle(opt)}
              delay={idx * 160}
              style={[
                s.optBtn,
                btnSize ? { width: btnSize, height: btnSize } : { width: '100%', paddingVertical: 14 },
                active && s.optBtnActive,
              ]}
            >
              {active && (
                <LinearGradient
                  colors={['#fff8f2', '#ffe5ea']}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                />
              )}
              {Icon && <Icon size={iconSize} color={active ? '#c0385a' : '#9b7b82'} strokeWidth={1.8} />}
              <Text style={[s.optText, { fontSize: textSize }, active && s.optTextActive]} numberOfLines={2}>
                {label}
              </Text>
            </FloatingButton>
          );
        })}
      </View>
    );
  };

  // ─── Vertical card list ───────────────────────────────────────────────

  const renderCatCards = <T extends { key: string; label: string; sub?: string; emoji?: string }>(
    items: T[],
    selectedKey: string | null | undefined,
    onSelect: (key: string) => void,
    getLabel?: (item: T) => string,
  ) => (
    <View>
      {items.map((item) => {
        const active = selectedKey === item.key;
        const label = getLabel ? getLabel(item) : item.label;
        return (
          <TouchableOpacity
            key={item.key}
            onPress={() => onSelect(item.key)}
            activeOpacity={0.7}
            style={[s.catCard, active && s.catCardActive]}
          >
            {active && (
              <LinearGradient
                colors={['#fff8f2', '#ffe5ea']}
                style={StyleSheet.absoluteFill}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
              />
            )}
            {item.emoji ? <Text style={s.catCardEmoji}>{item.emoji}</Text> : null}
            <View style={s.catCardRight}>
              <Text style={[s.catCardLabel, active && s.catCardLabelActive]}>{label}</Text>
              {item.sub ? <Text style={s.catCardSub}>{item.sub}</Text> : null}
            </View>
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
          colors={disabled ? ['#ccc', '#ccc'] : ['#ffbf67', '#ff8f7f']}
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
                    onSetStep(2);
                  }}
                  activeOpacity={0.7}
                  style={[s.moodBtn, active && s.moodBtnActive]}
                >
                  {active && (
                    <LinearGradient
                      colors={['#fff8f2', '#ffe5ea']}
                      style={StyleSheet.absoluteFill}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                    />
                  )}
                  <View style={s.moodIconWrap}>
                    <m.Icon size={28} color={active ? '#c0385a' : '#4a3034'} strokeWidth={1.8} />
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

    // Step 3: Transport
    if (step === 3) {
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
      const budgetChips = lang === 'en'
        ? [
            { label: 'Undecided', min: 0, max: undefined as number | undefined },
            { label: 'Free', min: 0, max: 0 },
            { label: '〜¥3,000', min: 0, max: 3000 },
            { label: '〜¥5,000', min: 0, max: 5000 },
            { label: '〜¥10,000', min: 0, max: 10000 },
            { label: '¥10,000+', min: 10000, max: 50000 },
          ]
        : [
            { label: '未定', min: 0, max: undefined as number | undefined },
            { label: '無料', min: 0, max: 0 },
            { label: '〜¥3,000', min: 0, max: 3000 },
            { label: '〜¥5,000', min: 0, max: 5000 },
            { label: '〜¥10,000', min: 0, max: 10000 },
            { label: '¥10,000〜', min: 10000, max: 50000 },
          ];
      const budgetDisplay =
        budget === undefined ? (lang === 'en' ? 'Undecided' : '未定') :
        budget === 0 && budgetMin === 0 ? t.free :
        budgetMin > 0 ? `¥${budgetMin.toLocaleString('ja-JP')} 〜 ¥${budget.toLocaleString('ja-JP')}` :
        `〜¥${budget.toLocaleString('ja-JP')}`;
      return (
        <>
          <Text style={s.stepTitle}>{t.step4Title}</Text>
          <Text style={s.stepSub}>{t.step4Sub}</Text>
          <View style={s.budgetBox}>
            <Text style={s.budgetValue}>{budgetDisplay}</Text>
            <Text style={s.budgetRangeLabel}>{lang === 'en' ? 'Min' : '下限'}</Text>
            <Slider
              style={{ width: '100%', height: 36 }}
              minimumValue={0} maximumValue={50000} step={500}
              value={budgetMin}
              onValueChange={(v) => {
                const min = Math.round(v);
                onSetBudgetMin(min);
                if (budget !== undefined && min > budget) onSetBudget(min);
              }}
              minimumTrackTintColor="#F43F5E"
              maximumTrackTintColor="#F3F4F6"
              thumbTintColor="#F43F5E"
            />
            <Text style={s.budgetRangeLabel}>{lang === 'en' ? 'Max' : '上限'}</Text>
            <Slider
              style={{ width: '100%', height: 36 }}
              minimumValue={0} maximumValue={50000} step={500}
              value={budget ?? 50000}
              onValueChange={(v) => {
                const max = Math.round(v);
                onSetBudget(max);
                if (max < budgetMin) onSetBudgetMin(max);
              }}
              minimumTrackTintColor="#F43F5E"
              maximumTrackTintColor="#F3F4F6"
              thumbTintColor="#F43F5E"
            />
            <View style={s.budgetLabels}>
              {['¥0', '¥25,000', '¥50,000'].map((l) => (
                <Text key={l} style={s.budgetLabelText}>{l}</Text>
              ))}
            </View>
          </View>
          <View style={[s.grid, { gap: 8, marginTop: 8 }]}>
            {budgetChips.map((chip) => {
              const active = budgetMin === chip.min && budget === chip.max;
              return (
                <TouchableOpacity
                  key={chip.label}
                  onPress={() => { onSetBudget(chip.max as any); onSetBudgetMin(chip.min); }}
                  style={[s.budgetChip, active && s.budgetChipActive]}
                >
                  <Text style={active ? s.budgetChipTextActive : s.budgetChipText}>
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      );
    }

    // Step 10: Area / Location
    if (step === 10) {
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

    // Step 5: Time (all moods)
    if (step === 5) {
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

    // Step 8: Mood-specific subcategory (vertical catCard list)
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

      if (isCafeMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.cafeDistTitle}</Text>
            <Text style={s.stepSub}>{t.cafeDistSub}</Text>
            {renderCatCards(
              CAFE_DISTANCE_OPTIONS,
              cafeDistancePref,
              (key) => onSetCafeDistancePref(key as CafeDistancePref),
            )}
          </>
        );
      }

      if (isWaiWaiMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.waiwaiTitle}</Text>
            <Text style={s.stepSub}>{t.waiwaiSub}</Text>
            {renderCatCards(
              WAIWAI_SUBCATEGORIES,
              waiWaiSubCategory,
              (key) => onSetWaiWaiSubCategory(key as WaiWaiSubCategory),
              lang === 'en' ? (item) => WAIWAI_EN[item.label] ?? item.label : undefined,
            )}
          </>
        );
      }

      if (isDriveMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.driveTitle}</Text>
            <Text style={s.stepSub}>{t.driveSub}</Text>
            {renderCatCards(
              DRIVE_SUBCATEGORIES,
              dynamicAnswers['drive_subcategory'] ?? null,
              (key) => onSetDynamicAnswers({ ...dynamicAnswers, drive_subcategory: key }),
              lang === 'en' ? (item) => DRIVE_EN[item.label] ?? item.label : undefined,
            )}
          </>
        );
      }

      if (isFocusMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.focusTitle}</Text>
            <Text style={s.stepSub}>{t.focusSub}</Text>
            {renderCatCards(
              FOCUS_SUBCATEGORIES,
              dynamicAnswers['focus_subcategory'] ?? null,
              (key) => onSetDynamicAnswers({ ...dynamicAnswers, focus_subcategory: key }),
              lang === 'en' ? (item) => FOCUS_EN[item.label] ?? item.label : undefined,
            )}
          </>
        );
      }

      if (isSportsMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.sportsTitle}</Text>
            <Text style={s.stepSub}>{t.sportsSub}</Text>
            {renderCatCards(
              SPORTS_SUBCATEGORIES,
              dynamicAnswers['sports_subcategory'] ?? null,
              (key) => onSetDynamicAnswers({ ...dynamicAnswers, sports_subcategory: key }),
              lang === 'en' ? (item) => SPORTS_EN[item.label] ?? item.label : undefined,
            )}
          </>
        );
      }

      if (isTravelMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.travelTitle}</Text>
            <Text style={s.stepSub}>{t.travelSub}</Text>
            {renderCatCards(
              TRAVEL_SUBCATEGORIES,
              dynamicAnswers['travel_subcategory'] ?? null,
              (key) => onSetDynamicAnswers({ ...dynamicAnswers, travel_subcategory: key }),
              lang === 'en' ? (item) => TRAVEL_EN[item.label] ?? item.label : undefined,
            )}
          </>
        );
      }

      return null;
    }

    // Step 6: Genre/place sub-question (お腹すいた → food genre, まったり → relax place)
    if (step === 6) {
      if (isHaraMode) {
        const foodGenreDq = dynamicQuestions.find(q => q.key === 'food_genre_new');
        if (!foodGenreDq) return null;
        return (
          <>
            <Text style={s.stepTitle}>{foodGenreDq.question}</Text>
            <Text style={s.stepSub}>{t.foodSubSub}</Text>
            {renderOptions(foodGenreDq.options, dynamicAnswers[foodGenreDq.key] ?? '', (v) =>
              onSetDynamicAnswers({ ...dynamicAnswers, [foodGenreDq.key]: v })
            )}
          </>
        );
      }

      if (selectedMood === 'まったりしたい') {
        const dq = dynamicQuestions.find(q => q.key === 'relax_place');
        if (!dq) return null;
        return (
          <>
            <Text style={s.stepTitle}>{dq.question}</Text>
            <Text style={s.stepSub}>{t.step1Sub}</Text>
            {renderOptions(dq.options, dynamicAnswers[dq.key] ?? '', (v) =>
              onSetDynamicAnswers({ ...dynamicAnswers, [dq.key]: v })
            )}
          </>
        );
      }

      return null;
    }

    // Step 9: Nature subgenre / Onsen category / Cafe subcategory+detail
    if (step === 9) {
      if (isNatureMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.natureTitle}</Text>
            <Text style={s.stepSub}>{t.natureSub}</Text>
            {renderCatCards(
              NATURE_SUBGENRES,
              natureSubGenre,
              (key) => onSetNatureSubGenre(key as NatureSubGenre),
              lang === 'en' ? (item) => NATURE_EN[item.label] ?? item.label : undefined,
            )}
          </>
        );
      }

      if (isOnsenMode) {
        return (
          <>
            <Text style={s.stepTitle}>{t.onsenTitle}</Text>
            <Text style={s.stepSub}>{t.onsenSub}</Text>
            {renderCatCards(
              ONSEN_CATEGORIES,
              onsenCategory,
              (key) => onSetOnsenCategory(key as OnsenCategory),
              lang === 'en' ? (item) => ONSEN_EN[item.label] ?? item.label : undefined,
            )}
          </>
        );
      }

      if (isCafeMode) {
        const animalDetailOptions = [
          { key: 'cat' as CafeDetail, label: lang === 'en' ? 'Cat Café' : '猫カフェ', sub: lang === 'en' ? 'Purring companions' : '猫と一緒にのんびり', emoji: '🐱' },
          { key: 'dog' as CafeDetail, label: lang === 'en' ? 'Dog Café' : '犬カフェ', sub: lang === 'en' ? 'Playful pups' : '犬と遊ぶ', emoji: '🐶' },
          { key: 'rare' as CafeDetail, label: lang === 'en' ? 'Exotic Animals' : '小動物・珍しい動物', sub: lang === 'en' ? 'Hedgehogs, owls & more' : 'ふくろう・ハリネズミなど', emoji: '🦔' },
        ];
        const viewDetailOptions = [
          { key: 'ocean' as CafeDetail, label: lang === 'en' ? 'Ocean View' : '海・水辺', sub: lang === 'en' ? 'Sea breeze & waves' : '海が見えるカフェ', emoji: '🌊' },
          { key: 'forest' as CafeDetail, label: lang === 'en' ? 'Forest / Green' : '森・緑', sub: lang === 'en' ? 'Nature surrounded' : '緑に囲まれたカフェ', emoji: '🌲' },
          { key: 'city' as CafeDetail, label: lang === 'en' ? 'City View' : '街並み・高層ビル', sub: lang === 'en' ? 'Urban panorama' : '街が一望できるカフェ', emoji: '🏙️' },
        ];
        return (
          <>
            <Text style={s.stepTitle}>{t.cafeTitle}</Text>
            <Text style={s.stepSub}>{t.cafeSub}</Text>
            {renderCatCards(
              CAFE_SUBCATEGORIES,
              cafeSubCategory,
              (key) => onSetCafeSubCategory(key as CafeSubCategory),
              lang === 'en' ? (item) => CAFE_EN[item.label] ?? item.label : undefined,
            )}
            {(cafeSubCategory === 'animal' || cafeSubCategory === 'view') && (
              <>
                <Text style={[s.dynQuestion, { marginTop: 24, marginBottom: 10 }]}>{t.cafeDetailTitle}</Text>
                <Text style={[s.stepSub, { marginBottom: 8 }]}>{t.cafeDetailSub}</Text>
                {renderCatCards(
                  cafeSubCategory === 'animal' ? animalDetailOptions : viewDetailOptions,
                  cafeDetail,
                  (key) => onSetCafeDetail(key as CafeDetail),
                )}
              </>
            )}
          </>
        );
      }

      return null;
    }

    return null;
  };

  const handleBack = () => {
    if (step <= 1) { onBack(); return; }
    if (step <= 5) { onSetStep(step - 1); return; }
    if (step === 6) { onSetStep(5); return; }

    if (step === 7) {
      if (selectedMood === '時間潰したい') { onSetStep(5); return; }
      if (
        isWaiWaiMode || isDriveMode || isFocusMode || isSportsMode || isTravelMode ||
        (isHaraMode && foodSubQ != null)
      ) { onSetStep(8); return; }
      if (selectedMood === 'まったりしたい' && (isNatureMode || isOnsenMode || isCafeMode)) { onSetStep(9); return; }
      if (selectedMood === '自然感じたい') { onSetStep(9); return; }
      onSetStep(6); return;
    }

    if (step === 8) {
      if (isHaraMode || isCafeMode) { onSetStep(6); return; }
      onSetStep(5); return;
    }

    if (step === 9) {
      if (selectedMood === '自然感じたい') { onSetStep(5); return; }
      if (selectedMood === 'まったりしたい' && isCafeMode) { onSetStep(8); return; }
      if (selectedMood === 'まったりしたい') { onSetStep(6); return; }
      onSetStep(10); return;
    }

    if (step === 10) {
      if (selectedMood === '時間潰したい') { onSetStep(5); return; }
      if (isWaiWaiMode || isDriveMode || isFocusMode || isSportsMode || isTravelMode ||
          (isHaraMode && foodSubQ != null)) { onSetStep(8); return; }
      if (selectedMood === 'まったりしたい' && (isNatureMode || isOnsenMode || isCafeMode)) { onSetStep(9); return; }
      if (selectedMood === '自然感じたい') { onSetStep(9); return; }
      onSetStep(6); return;
    }

    if (step === 7) { onSetStep(10); return; }
    onSetStep(step - 1);
  };

  const handleNext = () => {
    if (step === 5) {
      if (selectedMood === '時間潰したい') { onSetStep(10); return; }
      if (selectedMood === '自然感じたい') { onSetStep(9); return; }
      if (
        selectedMood === 'わいわい楽しみたい' ||
        selectedMood === 'ドライブしたい' ||
        selectedMood === '集中したい' ||
        selectedMood === '体を動かしたい' ||
        selectedMood === '遠くに行きたい'
      ) { onSetStep(8); return; }
      if (selectedMood === 'まったりしたい') {
        if (isNatureMode) { onSetStep(9); return; }
        if (isOnsenMode) { onSetStep(9); return; }
        if (isCafeMode) { onSetStep(8); return; }
        if (isSceneryMode) { onSetStep(10); return; }
      }
      onSetStep(6); return;
    }
    if (step === 6) {
      if (selectedMood === 'まったりしたい') {
        if (isNatureMode || isOnsenMode) { onSetStep(9); return; }
        if (isCafeMode) { onSetStep(8); return; }
        onSetStep(10); return;
      }
      if (isHaraMode && foodSubQ) { onSetStep(8); return; }
      onSetStep(10); return;
    }
    if (step === 10) { onSetStep(7); return; }
    if (step === 8) {
      if (isCafeMode) { onSetStep(9); return; }
      onSetStep(10); return;
    }
    if (step === 9) { onSetStep(10); return; }
    onSetStep(step + 1);
  };
  const isLastStep = step === 7;

  // Progress bar X/N
  const getProgressSeq = (): number[] => {
    const hasFoodSub = ['居酒屋🍺','和食🍣','洋食🍳','イタリアン🍝','焼肉🥩','アジア系統🍛','各国料理🌍','ラーメン🍜','カフェ・スイーツ☕']
      .some(k => (dynamicAnswers['food_genre_new'] ?? '').includes(k));
    if (selectedMood === '時間潰したい') return [1,2,3,4,5,10,7];
    if (selectedMood === '自然感じたい') return [1,2,3,4,5,9,10,7];
    if (['ドライブしたい','わいわい楽しみたい','集中したい','体を動かしたい','遠くに行きたい'].includes(selectedMood))
      return [1,2,3,4,5,8,10,7];
    if (selectedMood === 'お腹すいた')
      return hasFoodSub ? [1,2,3,4,5,6,8,10,7] : [1,2,3,4,5,6,10,7];
    if (selectedMood === 'まったりしたい') {
      if (isCafeMode) return [1,2,3,4,5,6,8,9,10,7];
      if (isNatureMode || isOnsenMode) return [1,2,3,4,5,6,9,10,7];
      return [1,2,3,4,5,6,10,7];
    }
    return [1,2,3,4,5,6,10,7];
  };
  const progressSeq = getProgressSeq();
  const progressIdx = Math.max(1, progressSeq.indexOf(step) + 1);
  const progressTotal = progressSeq.length;

  return (
    <View style={s.root}>
      {/* iOS nav bar */}
      <View style={[s.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={handleBack} style={s.backBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ChevronLeft size={20} color="#ff8f7f" strokeWidth={2.5} />
          <Text style={s.backText}>{t.back}</Text>
        </TouchableOpacity>
        <View style={s.progressWrap}>
          <View style={[s.progressBar, { width: `${(progressIdx / progressTotal) * 100}%` as any }]} />
        </View>
        <Text style={s.stepCount}>{progressIdx}/{progressTotal}</Text>
      </View>

      {/* Content */}
      <ScrollView
        ref={scrollRef}
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
        : renderNext(handleNext, step === 1 && !selectedMood ? t.skip : t.next)}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 12, backgroundColor: '#fff', gap: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 8, minWidth: 64 },
  backText: { fontSize: 17, color: '#F43F5E', fontWeight: '600' },
  progressWrap: { flex: 1, height: 4, backgroundColor: '#F3F4F6', borderRadius: 2, overflow: 'hidden' },
  progressBar: { height: '100%', backgroundColor: '#F43F5E', borderRadius: 2 },
  stepCount: { fontSize: 13, fontWeight: '600', color: '#9CA3AF', minWidth: 36, textAlign: 'right', paddingRight: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
  stepTitle: { fontSize: 30, fontWeight: '900', color: '#111827', marginBottom: 4, letterSpacing: -0.5 },
  stepSub: { fontSize: 14, color: '#6B7280', marginBottom: 20, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  optBtn: { borderRadius: 999, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4 },
  optBtnActive: { borderColor: '#F43F5E', borderWidth: 2, backgroundColor: '#FFF5F6', shadowColor: '#F43F5E', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  optText: { fontSize: 14, fontWeight: '700', color: '#374151', textAlign: 'center' },
  optTextActive: { color: '#F43F5E', fontWeight: '900' },
  check: { position: 'absolute', top: 5, right: 7, fontSize: 10, fontWeight: '700', color: '#F43F5E' },
  moodBtn: { width: '48%', paddingVertical: 18, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#F3F4F6', alignItems: 'flex-start', gap: 4, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  moodBtnActive: { borderColor: '#F43F5E', borderWidth: 2, backgroundColor: '#FFF5F6' },
  moodIconWrap: { marginBottom: 4 },
  moodLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
  moodLabelActive: { color: '#F43F5E' },
  moodSub: { fontSize: 11, color: '#9CA3AF', fontWeight: '400' },
  actionBar: { padding: 16, paddingBottom: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  nextBtn: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  nextText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  budgetBox: { backgroundColor: '#fff', borderRadius: 20, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  budgetValue: { fontSize: 36, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 8, letterSpacing: -0.5 },
  budgetRangeLabel: { fontSize: 12, fontWeight: '600', color: '#9CA3AF', marginTop: 8, marginBottom: -4 },
  budgetLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  budgetLabelText: { fontSize: 11, color: '#9CA3AF' },
  budgetChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: '#F3F4F6', backgroundColor: '#fff' },
  budgetChipActive: { backgroundColor: '#FFF5F6', borderColor: '#F43F5E', borderWidth: 2 },
  budgetChipText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  budgetChipTextActive: { fontSize: 13, fontWeight: '700', color: '#F43F5E' },
  locationBtnWrap: { shadowColor: '#F43F5E', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 5, marginBottom: 12 },
  locationBtn: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  locationBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  locatedTag: { alignSelf: 'center', backgroundColor: '#F0FDF4', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8, borderWidth: 1, borderColor: '#BBF7D0' },
  locatedTagText: { fontSize: 13, fontWeight: '700', color: '#10B981' },
  orDivider: { textAlign: 'center', fontSize: 13, color: '#9CA3AF', marginBottom: 12 },
  textInput: { height: 54, borderRadius: 14, backgroundColor: '#fff', paddingHorizontal: 16, fontSize: 15, color: '#111827', borderWidth: 1.5, borderColor: '#F3F4F6', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4 },
  errorText: { fontSize: 13, color: '#EF4444', marginTop: 8, lineHeight: 20 },
  dynQuestion: { fontSize: 17, fontWeight: '800', color: '#111827', marginBottom: 10 },
  textarea: { borderRadius: 14, padding: 14, fontSize: 15, backgroundColor: '#fff', color: '#111827', lineHeight: 24, minHeight: 140, textAlignVertical: 'top', borderWidth: 1.5, borderColor: '#F3F4F6' },
  catBtn: { borderRadius: 999, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  catBtnActive: { borderColor: '#F43F5E', borderWidth: 2, backgroundColor: '#FFF5F6' },
  catIconWrap: { marginBottom: 2 },
  catLabel: { fontSize: 12, fontWeight: '700', color: '#374151', textAlign: 'center', lineHeight: 16 },
  catLabelActive: { color: '#F43F5E', fontWeight: '900' },
  catCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 18, borderWidth: 1.5, borderColor: '#F3F4F6', padding: 16, marginBottom: 10, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  catCardActive: { borderColor: '#F43F5E', borderWidth: 2, backgroundColor: '#FFF5F6' },
  catCardEmoji: { fontSize: 28, lineHeight: 34, minWidth: 34, textAlign: 'center' },
  catCardRight: { flex: 1 },
  catCardLabel: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 2 },
  catCardLabelActive: { color: '#F43F5E' },
  catCardSub: { fontSize: 12, color: '#9CA3AF', lineHeight: 18 },
  reviewCard: { backgroundColor: '#fff', borderRadius: 18, padding: 20, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  reviewLine: { fontSize: 14, color: '#374151', fontWeight: '400', lineHeight: 22 },
});
