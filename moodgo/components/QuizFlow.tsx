/**
 * QuizFlow.tsx — 共通質問 (Step 1〜8)
 *
 * Step 1  今の気分は？     (mood 3×3 grid)
 * Step 2  誰と？           (companion 3×2 grid)
 * Step 3  エリアはどこ？    (location input — moved from old step 10)
 * Step 4  距離感は？        (NEW — 3×3 grid, only if areaMode === 'current_location')
 * Step 5  予算は？          (range slider + preset chips)
 * Step 6  深掘り L1        (conditional on mood)
 * Step 7  深掘り L2        (conditional on L1 having subs)
 * Step 8  自由ワード        (free text)
 *
 * Layout: back circle · gradient progress dots · title · scroll · fixed gradient Next
 */

import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Activity, BookOpen,
  ChefHat, Check, Cherry, ChevronLeft,
  Coffee, Compass, Dumbbell,
  Fish, Flame, Footprints, Gamepad2, Globe,
  Heart, Home,
  Laptop, Leaf, MapPin, Moon, Mountain, Plane,
  ShoppingBag, Shuffle, Sparkles,
  Star, Sunset, Timer, TreePine,
  Trophy, UtensilsCrossed,
  User, UserCheck, Users, UsersRound,
  Waves, Wine, Zap,
  Navigation, Camera, Building2, Car,
} from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import React, { useEffect, useRef, useState } from 'react';
import PuniPressable from './PuniPressable';
import IMESafeTextInput from './IMESafeTextInput';
import {
  Animated, Dimensions, Easing, Keyboard, PanResponder,
  Platform, ScrollView, StyleSheet, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Type imports kept for Props compatibility with index.tsx
import type { OnsenCategory } from '@/types/onsen';
import type { NatureSubGenre, NatureDistancePref } from '@/types/nature';
import type { CafeSubCategory, CafeDetail, CafeDistancePref } from '@/types/cafe';
import type { WaiWaiSubCategory } from '@/types/waiwai';
import type { DynamicQuestion } from '@/types/app';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const PAD = 24;
const GAP = 10;
const CW3 = Math.floor((SCREEN_W - PAD * 2 - GAP * 2) / 3);
const CW2 = Math.floor((SCREEN_W - PAD * 2 - GAP) / 2);
const SLIDER_W = SCREEN_W - PAD * 2;
const THUMB_D = 28;
const MAX_BUDGET = 15000;
const BSTEP = 500;

// Step 4 is conditional (not in STEP_SEQ dots — shares step 3's dot)
const STEP_SEQ = [1, 2, 3, 5, 6, 7, 8];

type LucideIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

// ─── Data ─────────────────────────────────────────────────────────────────────

// ホームの気分チップ(HomeView)からも参照＝キーのズレを構造的に防ぐためexport
export const MOODS: { key: string; label: string; sub: string; Icon: LucideIcon; dark?: boolean }[] = [
  { key: 'お腹すいた', label: 'お腹すいた', sub: '絶品グルメ',  Icon: UtensilsCrossed },
  { key: 'まったり',   label: 'まったり',   sub: '癒やし',      Icon: Coffee },
  { key: '自然',       label: '自然',       sub: '絶景',        Icon: Leaf },
  { key: '楽しみたい', label: '楽しみたい', sub: 'アミューズメント', Icon: Sparkles },
  { key: 'ドライブ',   label: 'ドライブ',   sub: 'ツーリング',  Icon: Car },
  { key: '集中',       label: '集中',       sub: '作業・勉強',  Icon: BookOpen },
  { key: '運動',       label: '運動',       sub: 'スポーツ',    Icon: Activity },
  { key: '旅行',       label: '旅行・観光', sub: '小旅行',      Icon: Plane },
  { key: 'ショッピング', label: 'ショッピング', sub: 'お買い物', Icon: ShoppingBag },
  { key: 'スリル',     label: 'スリル',     sub: '絶叫・冒険',  Icon: Flame },
  { key: '時間潰し',   label: '時間潰し',   sub: 'のんびり',    Icon: Shuffle },
  // 遊び心枠: 夜カラーの特別カード。選ぶとお疲れさまコメントが出る
  { key: '疲れた・眠い', label: '疲れた・眠い', sub: 'おつかれさま', Icon: Moon, dark: true },
];

// 「疲れた・眠い」を選んだときのねぎらいコメント（ランダム表示）
const TIRED_KEY = '疲れた・眠い';
const TIRED_MESSAGES = [
  '今日もおつかれさま🌙 よくがんばったね',
  'むりは禁物だよ〜 ゆっくり休めるとこ探そ☕️',
  'がんばったね、えらい！今日は自分を甘やかそ🛋️',
  'おつかれさま✨ いっしょに癒やされに行こ',
  'ねむいよね…わかる…🌙 のんびりできる場所いこ',
];

const COMPANIONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: '一人',           label: '一人',   Icon: User },
  { key: '友達',           label: '友達',   Icon: Users },
  { key: '恋人',           label: '恋人',   Icon: Heart },
  { key: '家族',           label: '家族',   Icon: Home },
  { key: '大人数グループ', label: '大人数', Icon: UsersRound },
  { key: '先輩',           label: '先輩',   Icon: UserCheck },
];

const DISTANCE_FEELINGS: { key: string; sub: string; hint: string; radiusKm: number; Icon: LucideIcon }[] = [
  { key: 'すぐそこ',           sub: '1km以内',   hint: '徒歩\n約12分',     radiusKm: 1,   Icon: Footprints },
  { key: '近場でいい',          sub: '3km以内',   hint: '自転車\n約10分',   radiusKm: 3,   Icon: Navigation },
  { key: '少し歩ける',          sub: '5km以内',   hint: '自転車\n約20分',   radiusKm: 5,   Icon: Timer },
  { key: '近めにお出かけ',      sub: '10km以内',  hint: '電車\n約15〜20分', radiusKm: 10,  Icon: Compass },
  { key: '今日は出かけたい',    sub: '20km以内',  hint: '電車\n約30分',     radiusKm: 20,  Icon: Car },
  { key: 'ちょっと遠くてもOK',  sub: '40km以内',  hint: '電車\n約45〜60分', radiusKm: 40,  Icon: Activity },
  { key: '県またぎもあり',      sub: '70km以内',  hint: '車で\n約1時間',    radiusKm: 70,  Icon: Mountain },
  { key: '小旅行気分',          sub: '120km以内', hint: '車で\n約2時間',    radiusKm: 120, Icon: Plane },
  { key: 'どこでも行きたい',    sub: '200km以内', hint: '新幹線\n約1〜2時間', radiusKm: 200, Icon: Globe },
];

const BUDGET_CHIPS: { label: string; max: number | undefined; min: number }[] = [
  { label: '未定',       max: undefined, min: 0 },
  { label: '無料',       max: 0,         min: 0 },
  { label: '〜¥3,000',   max: 3000,      min: 0 },
  { label: '〜¥5,000',   max: 5000,      min: 0 },
  { label: '〜¥10,000',  max: 10000,     min: 0 },
  { label: '¥10,000〜',  max: 99999,     min: 10000 },
];

// ─── Deep Dive Data ───────────────────────────────────────────────────────────

type SubOpt  = { key: string; label: string; Icon: LucideIcon };
type DiveOpt = { key: string; label: string; sub: string; Icon: LucideIcon; subs?: SubOpt[] };
type DiveConfig = { title: string; options: DiveOpt[] };

export const DEEP_DIVE: Record<string, DiveConfig> = {
  'お腹すいた': {
    title: 'どんなジャンルを食べたい？',
    options: [
      { key: '居酒屋',           label: '居酒屋',           sub: '個室・大衆',            Icon: Wine,
        subs: [
          { key: '個室居酒屋',  label: '個室居酒屋',  Icon: Users },
          { key: '大衆酒場',    label: '大衆酒場',    Icon: Heart },
        ],
      },
      { key: '和食',             label: '和食',             sub: '海鮮・天ぷらなど',        Icon: Fish,
        subs: [
          { key: '海鮮・お寿司',  label: '海鮮・お寿司',   Icon: Fish },
          { key: '天ぷら',        label: '天ぷら',          Icon: Flame },
          { key: 'うどん・そば',  label: 'うどん・そば',   Icon: Coffee },
          { key: '懐石料理',      label: '懐石料理',        Icon: ChefHat },
        ],
      },
      { key: '洋食',             label: '洋食',             sub: 'ハンバーグ系',          Icon: ChefHat,
        subs: [
          { key: 'ハンバーグ',   label: 'ハンバーグ',   Icon: ChefHat },
          { key: 'オムライス',   label: 'オムライス',   Icon: Star },
          { key: 'ステーキ',     label: 'ステーキ',     Icon: Flame },
          { key: 'レトロ洋食',   label: 'レトロ洋食',   Icon: Timer },
        ],
      },
      { key: 'イタリアン',       label: 'イタリアン',       sub: 'パスタ・ピザ',            Icon: UtensilsCrossed },
      { key: '中華料理',         label: '中華料理',         sub: '点心・担々麺など',        Icon: Globe },
      { key: '焼肉',             label: '焼肉',             sub: '食べ放題他',            Icon: Flame,
        subs: [
          { key: '焼肉食べ放題', label: '食べ放題',    Icon: Users },
          { key: '高級焼肉',     label: '高級焼肉',    Icon: Trophy },
          { key: '焼肉単品',     label: '単品メニュー', Icon: Sparkles },
        ],
      },
      { key: '韓国料理',         label: '韓国料理',         sub: 'タッカルビほか',        Icon: Zap },
      { key: 'アジア系統',       label: 'アジア系統',       sub: 'インド・タイ等',        Icon: Globe,
        subs: [
          { key: 'インド・ネパール',       label: 'インドネパール料理',   Icon: Sparkles },
          { key: 'タイ料理',               label: 'タイ料理',             Icon: Leaf },
          { key: 'ベトナム料理',           label: 'ベトナム料理',         Icon: Leaf },
          { key: 'アジアンエスニック料理', label: 'アジアンエスニック',   Icon: Globe },
        ],
      },
      { key: '各国料理',         label: '各国料理',         sub: '南米・他国',            Icon: Compass,
        subs: [
          { key: 'メキシコ料理', label: 'メキシコ料理', Icon: Sparkles },
          { key: 'ブラジル料理', label: 'ブラジル料理', Icon: Flame },
          { key: 'ロシア料理',   label: 'ロシア料理',   Icon: Star },
          { key: 'その他各国',   label: '他国料理',     Icon: Globe },
        ],
      },
      { key: 'ラーメン',         label: 'ラーメン',         sub: 'こってり系他',          Icon: Coffee,
        subs: [
          { key: 'こってりラーメン',   label: 'こってり系',       Icon: Flame },
          { key: 'あっさりラーメン',   label: 'あっさり系',       Icon: Leaf },
          { key: '味噌ラーメン',       label: '味噌',             Icon: Mountain },
          { key: 'つけ麺・まぜそば',   label: 'つけ麺・まぜそば', Icon: Shuffle },
        ],
      },
      { key: 'お好み焼き',       label: 'お好み焼き',       sub: '鉄板焼き系',            Icon: Flame },
      { key: 'カフェスイーツ',   label: 'カフェスイーツ',   sub: 'パンケーキ系',          Icon: Heart,
        subs: [
          { key: 'フルーツ', label: 'フルーツ',  Icon: Cherry },
          { key: '喫茶店',           label: '喫茶店・レトロ',  Icon: Coffee },
          { key: '流行りカフェ',     label: '流行りカフェ',    Icon: Camera },
        ],
      },
      { key: '高層ビル料理',     label: '高層ビル料理',     sub: '絶景ダイニング',        Icon: Building2 },
      { key: 'こだわらない',     label: 'こだわらない',     sub: 'なんでもOK',             Icon: Shuffle },
    ],
  },

  'まったり': {
    title: 'どこで癒やされたい？',
    options: [
      { key: '自然の中',   label: '自然の中',   sub: '海辺・公園など',        Icon: Leaf,
        subs: [
          { key: '波の音と海風',       label: '波の音と海風',       Icon: Waves },
          { key: '森の中で深呼吸',     label: '森の中で深呼吸',     Icon: TreePine },
          { key: '広い芝生でゴロゴロ', label: '広い芝生でゴロゴロ', Icon: Leaf },
          { key: '圧倒的な絶景',       label: '圧倒的な絶景',       Icon: Mountain },
        ],
      },
      { key: 'カフェ',     label: '癒しカフェ', sub: 'のんびりくつろぐ',      Icon: Coffee,
        subs: [
          { key: 'ブックカフェ・隠れカフェ', label: 'ブックカフェ',   Icon: BookOpen },
          { key: '絶品スイーツカフェ',       label: 'スイーツカフェ', Icon: Star },
        ],
      },
      { key: '動物カフェ', label: '動物カフェ', sub: '猫犬とふれあう',       Icon: Heart,
        subs: [
          { key: '猫カフェ',     label: '猫カフェ',     Icon: Heart },
          { key: '犬カフェ',     label: '犬カフェ',     Icon: Heart },
          { key: '小動物カフェ', label: '小動物カフェ', Icon: Sparkles },
        ],
      },
      { key: '景色良いカフェ', label: '景色良いカフェ', sub: '絶景を眺める',          Icon: Camera,
        subs: [
          { key: '海辺カフェ',     label: '海辺カフェ',     Icon: Waves },
          { key: '森林カフェ',     label: '森林カフェ',     Icon: TreePine },
          { key: '高層ビルカフェ', label: '高層ビルカフェ', Icon: Building2 },
          { key: '高層ビル料理',   label: '高層ビル料理',   Icon: Building2 },
        ],
      },
      { key: '温泉スパ',   label: '温泉・スパ', sub: '深くリラックス',        Icon: Waves,
        subs: [
          { key: 'サウナ・岩盤浴', label: 'サウナ・岩盤浴', Icon: Flame },
          { key: '温泉施設全般',   label: '温泉施設全般',   Icon: Waves },
        ],
      },
      { key: '絶景スポット', label: '絶景スポット', sub: '絶景で癒し',            Icon: Mountain },
      { key: 'こだわらない', label: 'こだわらない', sub: 'なんでもOK', Icon: Shuffle },
    ],
  },

  '自然': {
    title: 'どんな自然を感じたい？',
    options: [
      { key: '波の音と海風',       label: '波の音と海風',       sub: '海辺・ビーチ',         Icon: Waves },
      { key: '森の中で深呼吸',     label: '森の中で深呼吸',     sub: '山・森・渓谷',         Icon: TreePine },
      { key: '広い芝生でゴロゴロ', label: '芝生でゴロゴロ',   sub: '広々した大型公園',     Icon: Leaf },
      { key: '圧倒的な絶景',       label: '圧倒的な絶景',       sub: '展望台・絶景',         Icon: Mountain },
      { key: 'こだわらない',       label: 'こだわらない',       sub: 'なんでもOK',           Icon: Shuffle },
    ],
  },

  '楽しみたい': {
    title: 'どう楽しみたい？',
    options: [
      { key: '王道で遊ぶ',       label: '定番あそび', sub: '遊園地・カラオケ', Icon: Star },
      { key: 'アクティブに遊ぶ', label: 'アクティブ', sub: 'ゲーセン・脱出',   Icon: Gamepad2 },
      { key: '観て楽しむ',       label: '観て楽しむ', sub: '水族館・映画館',   Icon: Camera },
      { key: 'つくる・体験',     label: 'つくる体験', sub: '陶芸・工場見学',   Icon: ChefHat },
      { key: 'こだわらない',     label: 'こだわらない',     sub: 'なんでもOK',                   Icon: Shuffle },
    ],
  },

  'ドライブ': {
    title: 'ドライブの目的地は？',
    options: [
      { key: '海沿いを爽快に走りたい',         label: '海沿いドライブ',     sub: 'シーサイドロード',     Icon: Waves },
      { key: '綺麗な景色や夜景を見に行きたい', label: '景色・夜景',         sub: '山・峠・展望台',       Icon: Mountain },
      { key: '道の駅でご当地グルメ',           label: '道の駅グルメ',       sub: '地元の名物料理',     Icon: UtensilsCrossed },
      { key: '郊外の大型施設に行きたい',       label: '郊外の大型施設',     sub: 'アウトレット',        Icon: ShoppingBag },
      { key: 'こだわらない',                   label: 'こだわらない',       sub: 'なんでもOK',           Icon: Shuffle },
    ],
  },

  '集中': {
    title: 'どこで集中したい？',
    options: [
      { key: 'カフェで作業・勉強したい',       label: 'カフェで作業・勉強',   sub: 'ファミレス・スタバなど', Icon: Laptop },
      { key: '静かな専用スペースで集中したい', label: '静かな専用スペース',   sub: '図書館・自習室',       Icon: BookOpen },
      { key: 'こだわらない',                   label: 'こだわらない',         sub: 'なんでもOK',           Icon: Shuffle },
    ],
  },

  '運動': {
    title: 'どんな風に体を動かしたい？',
    options: [
      { key: 'がっつり運動',   label: 'がっつり運動',   sub: 'ジム・プール系',   Icon: Dumbbell },
      { key: '外でひろびろ',   label: '外でひろびろ',   sub: '公園・屋外',       Icon: Activity },
      { key: '室内でのんびり', label: '室内でのんびり', sub: 'ヨガ・ストレッチ', Icon: Leaf },
      { key: 'ゲーム感覚で',   label: 'ゲーム感覚で',   sub: 'ボウリング系',     Icon: Gamepad2 },
      { key: 'こだわらない',   label: 'こだわらない',   sub: 'なんでもOK',       Icon: Shuffle },
    ],
  },

  '旅行': {
    title: '旅のテーマを選んで',
    options: [
      { key: 'パワースポット',       label: 'パワースポット',     sub: '神社・絶景',           Icon: Compass },
      { key: '別世界のテーマパーク', label: 'テーマパーク',       sub: '大型施設で楽しむ',   Icon: Star },
      { key: '知らない街をぶらぶら', label: '知らない街へ',       sub: 'ご当地グルメ',        Icon: Footprints },
      { key: '息を呑む絶景',         label: '息を呑む絶景',       sub: '自然の絶景',           Icon: Camera },
      { key: 'こだわらない',         label: 'こだわらない',       sub: 'なんでもOK',           Icon: Shuffle },
    ],
  },

  'ショッピング': {
    title: '何を買いに行く？',
    options: [
      { key: '服・アクセサリー', label: '服・アクセサリ', sub: '洋服・靴ほか',    Icon: ShoppingBag,
        subs: [
          { key: '新品・現行',         label: '新品・現行',    Icon: ShoppingBag },
          { key: '古着・ヴィンテージ', label: '古着・vintage', Icon: Sparkles },
        ],
      },
      { key: '雑貨・インテリア',       label: '雑貨インテリア', sub: '暮らし用品',     Icon: Home },
      { key: 'コスメ・美容',           label: 'コスメ・美容',   sub: 'スキンケア系',   Icon: Sparkles },
      { key: '大型ショッピングモール', label: '大型モール',     sub: 'SC・アウトレット', Icon: Building2 },
      { key: 'お土産・ギフト',         label: 'お土産・ギフト', sub: '贈り物探し',     Icon: Star },
    ],
  },

  'スリル': {
    title: 'どんなスリルを求める？',
    options: [
      { key: '絶叫',   label: '絶叫',   sub: '遊園地・絶叫マシン',   Icon: Zap },
      { key: '心霊',   label: '心霊',   sub: 'お化け屋敷・心霊',     Icon: Moon },
      { key: '高所',   label: '高所',   sub: '展望台・吊り橋',       Icon: Mountain },
      { key: '体験型', label: '体験型', sub: 'VR・脱出・アスレチック', Icon: Gamepad2 },
      { key: 'こだわらない', label: 'こだわらない', sub: 'なんでもOK', Icon: Shuffle },
    ],
  },
};

// ─── 気分別ヒントタグ ─────────────────────────────────────────────────────────

const FREE_WORD_HINTS: Record<string, string[]> = {
  'お腹すいた': [
    '個室あり', 'テラス席', '予約不要', '深夜営業', '駅チカ', '子連れOK',
    '食べ放題', '景色が良い', 'コスパ重視', 'ランチ営業', '駐車場あり', '一人でも入りやすい',
  ],
  'まったり': [
    '長居OK', '静かな雰囲気', '景色が良い', '隠れ家的', 'ペット可', '屋外席あり',
    '読書できる', '混みにくい', '個室あり', '駅チカ', '駐車場あり', '一人でもOK',
  ],
  '自然': [
    '海が見える', '山・森の中', '川・湖沿い', '展望台あり', '夕日が綺麗', '無料で入れる',
    '犬と行ける', '駐車場あり', '歩いて回れる', '桜・紅葉スポット', 'アクセスしやすい', '夜もOK',
  ],
  'ドライブ': [
    '海沿いの道', '山道・峠', '夜景が綺麗', '途中で食事できる', '駐車場が広い', '日帰りできる',
    '渋滞しにくい', '2時間以内', '温泉あり', '絶景展望台', 'アウトレット近く', 'ご当地グルメあり',
  ],
  '集中': [
    'Wi-Fi完備', '電源あり', '個室・半個室', '静かな席', '長時間OK', '混みにくい',
    '深夜も営業', '飲食しながらOK', '予約できる', '荷物が置ける', '学生割引', '駅チカ',
  ],
  '運動': [
    '初心者でもOK', 'レンタル用品あり', '手ぶらでOK', 'シャワーあり', '屋内施設', '屋外フィールド',
    '一人でもOK', '仲間と行ける', '予約できる', '駅チカ', '駐車場あり', '体験プランあり',
  ],
  '旅行': [
    '日帰りできる', '温泉あり', '体験・アクティビティ', '歴史・文化スポット', '絶景あり', '宿泊も可',
    '食事も楽しめる', '子連れOK', 'ペット可', 'インスタ映え', '公共交通アクセス可', '駐車場あり',
  ],
  'ショッピング': [
    'セール中', '駐車場あり', 'アウトレット', 'カード払いOK', '試着できる', '子連れOK',
    '免税対応', '駅チカ', '混みにくい', '休憩スペースあり', '大型商業施設', '最新商品あり',
  ],
  'スリル': [
    '絶叫マシンあり', '夜も営業', '初心者OK', '予約できる', '駐車場あり', '雨でもOK',
    '屋内施設', '友達と行ける', 'カップル向け', '一人でもOK', '駅チカ', '体験プランあり',
  ],
  '時間潰し': [
    '無料で楽しめる', '屋内', '一人でも入りやすい', '何時間でもOK', '雨でもOK', '駅チカ',
    '飲食できる', '24時間営業', '混みにくい', '座れる', '静かな環境', 'アクセス良い',
  ],
};

const FREE_WORD_HINTS_DEFAULT = [
  '駅チカ', '駐車場あり', '屋内', '景色が良い', '静かな雰囲気', '穴場スポット',
  '予約不要', '一人でもOK', '子連れOK', '長居OK', '混みにくい', '雨でもOK',
];

const STEP_META: Record<number, { title: string; sub: string }> = {
  1: { title: '今の気分は？',         sub: 'タップして選択' },
  2: { title: '誰と？',               sub: '誰と行くかでおすすめが変わります。' },
  3: { title: 'エリアはどこ？',       sub: '現在地を使うかエリア名を入力してください。' },
  4: { title: '距離感は？',           sub: 'どのくらいの範囲で探しますか？' },
  5: { title: '予算はどのくらい？',   sub: 'スライダーで範囲を設定できます。' },
  8: { title: '自由ワード',           sub: '行きたいイメージを自由に書いてください（任意）' },
};

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  lang: 'ja' | 'en';
  step: number;
  selectedMood: string;
  selectedArea: string;
  locationDisplayArea: string;
  selectedCompanion: string;
  budget: number | undefined;
  budgetMin: number;
  showUnseenOnly: boolean;
  freeWord: string;
  dynamicQuestions: DynamicQuestion[];
  dynamicAnswers: Record<string, string>;
  isLocating: boolean;
  locationError: string;
  areaMode: 'current_location' | 'manual';
  distanceFeeling: string;
  radiusKm: number;
  onSelectMood: (v: string) => void;
  onSelectArea: (v: string) => void;
  onSelectCompanion: (v: string) => void;
  onSetBudget: (v: number | undefined) => void;
  onSetBudgetMin: (v: number) => void;
  onSetShowUnseenOnly: (v: boolean) => void;
  onSetFreeWord: (v: string) => void;
  onSetDynamicQuestions: (v: DynamicQuestion[]) => void;
  onSetDynamicAnswers: (v: Record<string, string>) => void;
  onUseCurrentLocation: () => void;
  onSetStep: (v: number) => void;
  onBack: () => void;
  onOpenResults: () => void;
  onSetAreaMode: (v: 'current_location' | 'manual') => void;
  onSetDistanceFeeling: (label: string, km: number) => void;
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
  // 深掘り
  deepDiveL1: string;
  deepDiveL2: string;
  onSetDeepDiveL1: (v: string) => void;
  onSetDeepDiveL2: (v: string) => void;
};

// ─── Budget Range Slider ──────────────────────────────────────────────────────

const TRACK_H = 6;
const TRACK_TOP = (72 - TRACK_H) / 2;

function BudgetRangeSlider({
  minVal, maxVal, onChangeMin, onChangeMax,
}: {
  minVal: number; maxVal: number | undefined;
  onChangeMin: (v: number) => void; onChangeMax: (v: number | undefined) => void;
}) {
  const toX    = (v: number) => Math.max(0, Math.min((v / MAX_BUDGET) * (SLIDER_W - THUMB_D), SLIDER_W - THUMB_D));
  const toMaxX = (v: number | undefined) =>
    v === undefined || v >= MAX_BUDGET ? SLIDER_W - THUMB_D : toX(Math.min(v, MAX_BUDGET));

  const minXAnim = useRef(new Animated.Value(toX(minVal))).current;
  const maxXAnim = useRef(new Animated.Value(toMaxX(maxVal))).current;
  const minXRef  = useRef(toX(minVal));
  const maxXRef  = useRef(toMaxX(maxVal));

  const [dispMin, setDispMin] = useState(minVal);
  const [dispMax, setDispMax] = useState(maxVal);

  useEffect(() => {
    const a = toX(minVal); const b = toMaxX(maxVal);
    minXAnim.setValue(a); maxXAnim.setValue(b);
    minXRef.current = a; maxXRef.current = b;
    setDispMin(minVal); setDispMax(maxVal);
  }, [minVal, maxVal]);

  const sMin = useRef(0); const sMax = useRef(0);

  const panMin = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { sMin.current = minXRef.current; },
    onPanResponderMove: (_, g) => {
      const nx = Math.max(0, Math.min(sMin.current + g.dx, maxXRef.current - THUMB_D * 1.5));
      minXAnim.setValue(nx);
      minXRef.current = nx;
      const v = Math.round(((nx / (SLIDER_W - THUMB_D)) * MAX_BUDGET) / BSTEP) * BSTEP;
      setDispMin(v);
    },
    onPanResponderRelease: () => {
      const v = Math.round(((minXRef.current / (SLIDER_W - THUMB_D)) * MAX_BUDGET) / BSTEP) * BSTEP;
      onChangeMin(v);
    },
  })).current;

  const panMax = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { sMax.current = maxXRef.current; },
    onPanResponderMove: (_, g) => {
      const nx = Math.min(SLIDER_W - THUMB_D, Math.max(sMax.current + g.dx, minXRef.current + THUMB_D * 1.5));
      maxXAnim.setValue(nx);
      maxXRef.current = nx;
      const v = nx >= SLIDER_W - THUMB_D - 5
        ? undefined
        : Math.round(((nx / (SLIDER_W - THUMB_D)) * MAX_BUDGET) / BSTEP) * BSTEP;
      setDispMax(v);
    },
    onPanResponderRelease: () => {
      const nx = maxXRef.current;
      if (nx >= SLIDER_W - THUMB_D - 5) onChangeMax(undefined);
      else onChangeMax(Math.round(((nx / (SLIDER_W - THUMB_D)) * MAX_BUDGET) / BSTEP) * BSTEP);
    },
  })).current;

  const trackLeft  = Animated.add(minXAnim, THUMB_D / 2);
  const trackWidth = Animated.subtract(maxXAnim, minXAnim);

  const minLbl = dispMin === 0 ? '¥0' : `¥${dispMin.toLocaleString()}`;
  const maxLbl = dispMax === undefined || dispMax >= MAX_BUDGET ? '上限なし' : `¥${dispMax.toLocaleString()}`;

  return (
    <View style={rsl.wrap}>
      <View style={rsl.valueRow}>
        <Text style={rsl.valueMin}>{minLbl}</Text>
        <View style={rsl.valueDashWrap}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={rsl.valueDash} />
        </View>
        <Text style={rsl.valueMax}>{maxLbl}</Text>
      </View>

      <View style={{ width: SLIDER_W, height: 72, alignSelf: 'center' }}>
        <View style={rsl.trackBg} />
        <Animated.View style={[rsl.trackActive, { left: trackLeft, width: trackWidth }]}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View {...panMin.panHandlers} style={[rsl.thumb, { left: minXAnim }]}>
          <LinearGradient colors={['#F472B6', '#C084FC']} style={rsl.thumbGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
          <View style={rsl.thumbLine} />
        </Animated.View>
        <Animated.View {...panMax.panHandlers} style={[rsl.thumb, { left: maxXAnim }]}>
          <LinearGradient colors={['#C084FC', '#60A5FA']} style={rsl.thumbGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
          <View style={rsl.thumbLine} />
        </Animated.View>
        <View style={rsl.scaleRow}>
          <Text style={rsl.scaleText}>¥0</Text>
          <Text style={rsl.scaleText}>¥15,000+</Text>
        </View>
      </View>
    </View>
  );
}

const rsl = StyleSheet.create({
  wrap: { marginBottom: 4 },
  valueRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: 20, gap: 12,
  },
  valueMin: { fontSize: 26, fontWeight: '900', color: '#F472B6', letterSpacing: -0.5, minWidth: 80, textAlign: 'right' },
  valueMax: { fontSize: 26, fontWeight: '900', color: '#60A5FA', letterSpacing: -0.5, minWidth: 80 },
  valueDashWrap: { paddingHorizontal: 2 },
  valueDash: { width: 28, height: 3, borderRadius: 99 },
  trackBg: {
    position: 'absolute', left: THUMB_D / 2, right: THUMB_D / 2,
    height: TRACK_H, borderRadius: 99, backgroundColor: '#EDE9FE', top: TRACK_TOP,
  },
  trackActive: {
    position: 'absolute', height: TRACK_H, borderRadius: 99, overflow: 'hidden', top: TRACK_TOP,
  },
  thumb: {
    position: 'absolute', width: THUMB_D, height: THUMB_D, borderRadius: THUMB_D / 2,
    top: (72 - THUMB_D) / 2, overflow: 'hidden',
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 12, elevation: 10,
  },
  thumbGrad: { ...StyleSheet.absoluteFillObject },
  thumbLine: {
    position: 'absolute', left: '50%', top: '20%', bottom: '20%',
    width: 2, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.55)',
    transform: [{ translateX: -1 }],
  },
  scaleRow: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: THUMB_D / 2,
  },
  scaleText: { fontSize: 10, color: '#C4B5FD', fontWeight: '600' },
});

// ─── MarqueeText（汎用・横スクロールテキスト）────────────────────────────────
// カード幅に収まらない長いテキストだけを、左方向へゆっくりループで流して全文を見せる。
// 収まる短いテキストは静止表示（…にならない）。タイトル・サブラベル共用。
//   props: text / style? / speed?(px/秒) / delay?(1周ごとの先頭休止ms) / containerWidth?
const MQ_GAP = 36;       // 1周の末尾に入れる余白(px)＝先頭テキストとの間隔
const MQ_SPEED = 22;     // 既定スクロール速度(px/秒) ← ゆっくり
const MQ_DELAY = 1200;   // 既定: 1周ごとに先頭で休止する時間(ms)

function MarqueeText({ text, style, speed = MQ_SPEED, delay = MQ_DELAY, containerWidth }: {
  text: string;
  style?: any;
  speed?: number;
  delay?: number;
  containerWidth?: number;
}) {
  const [measuredBoxW, setMeasuredBoxW] = useState(0);
  const [textW, setTextW] = useState(0);
  const tx = useRef(new Animated.Value(0)).current;

  // 表示領域の幅: 明示指定があればそれ、無ければ onLayout で実測
  const boxW = containerWidth != null ? containerWidth : measuredBoxW;
  // 自然なテキスト幅が表示領域を1pxでも超えたらスクロール（収まるなら静止＝…を出さない）
  const needsScroll = textW > 0 && boxW > 0 && textW > boxW;

  useEffect(() => {
    tx.stopAnimation();
    tx.setValue(0);
    if (!needsScroll) return;
    const distance = textW + MQ_GAP;            // この距離スクロールすると2枚目が先頭位置に来る
    const duration = (distance / speed) * 1000; // px / (px/秒) → 秒 → ms
    // Animated.loop はネイティブ側で繰り返すため JS往復のカクつきが無く滑らか。
    // [流す → 先頭で delay 休止] を1周とし、2コピー+間隔なので先頭への戻りは継ぎ目なし。
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(tx, {
          toValue: -distance,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.delay(delay),
      ]),
      { resetBeforeIteration: true },
    );
    anim.start();
    return () => { anim.stop(); tx.stopAnimation(); };
  }, [needsScroll, textW, speed, delay]);

  return (
    <View
      style={[{ overflow: 'hidden' }, containerWidth != null ? { width: containerWidth } : { alignSelf: 'stretch' }]}
      onLayout={containerWidth != null ? undefined : (e) => {
        const w = Math.floor(e.nativeEvent.layout.width);
        if (w > 0 && w !== measuredBoxW) setMeasuredBoxW(w);
      }}
    >
      {needsScroll ? (
        // 同じテキストを2コピー並べ、距離 distance だけ流して0へ戻す＝途切れず流れ続ける
        <Animated.View style={{
          flexDirection: 'row', alignSelf: 'flex-start',
          width: textW * 2 + MQ_GAP, transform: [{ translateX: tx }],
        }}>
          <Text style={[style, { width: textW, textAlign: 'left' }]} numberOfLines={1}>{text}</Text>
          <View style={{ width: MQ_GAP }} />
          <Text style={[style, { width: textW, textAlign: 'left' }]} numberOfLines={1}>{text}</Text>
        </Animated.View>
      ) : (
        <Text style={[style, boxW > 0 ? { width: boxW } : null]} numberOfLines={1}>{text}</Text>
      )}
      {/* 幅計測用ゴースト（rowで自然幅を測る・非表示）
          row 内の子は幅制約を受けず自然幅で測れるため、…で切られた幅にならない */}
      <View style={{ position: 'absolute', top: 0, left: 0, opacity: 0, flexDirection: 'row' }} pointerEvents="none">
        <Text
          style={style}
          numberOfLines={1}
          onLayout={(e) => {
            const w = Math.ceil(e.nativeEvent.layout.width);
            if (w > 0 && w !== textW) setTextW(w);
          }}
        >{text}</Text>
      </View>
    </View>
  );
}

// ─── ぷにん（選択した瞬間、むにっと潰れてぷるんと戻る） ─────────────────────────

function usePunin(active: boolean) {
  const puniX = useRef(new Animated.Value(1)).current;
  const puniY = useRef(new Animated.Value(1)).current;
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      // 拡大は控えめ（1.04まで）にして縮み主体のぷにんに。
      // 100%超の拡大はラスタライズ画像の引き伸ばしになり文字が荒れるため
      Animated.sequence([
        Animated.parallel([
          Animated.timing(puniX, { toValue: 1.04, duration: 90, useNativeDriver: true }),
          Animated.timing(puniY, { toValue: 0.90, duration: 90, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.spring(puniX, { toValue: 1, useNativeDriver: true, mass: 0.7, damping: 9, stiffness: 240 }),
          Animated.spring(puniY, { toValue: 1, useNativeDriver: true, mass: 0.7, damping: 9, stiffness: 240 }),
        ]),
      ]).start();
    }
    wasActive.current = active;
  }, [active]);
  return { puniX, puniY };
}

// ─── おつかれさま吹き出し（疲れた・眠い選択時） ────────────────────────────────

function TiredComfortBubble() {
  // 表示のたびにランダムで1つ選ぶ
  const msg = useRef(TIRED_MESSAGES[Math.floor(Math.random() * TIRED_MESSAGES.length)]).current;
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, damping: 9, stiffness: 160, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[
      tb.bubble,
      {
        opacity: anim,
        transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
      },
    ]}>
      <Text style={tb.text}>{msg}</Text>
      <View style={tb.tail} />
    </Animated.View>
  );
}

const tb = StyleSheet.create({
  bubble: {
    alignSelf: 'center',
    backgroundColor: '#1E1B4B',
    borderRadius: 18,
    paddingHorizontal: 18, paddingVertical: 11,
    marginBottom: 14,
    shadowColor: '#1E1B4B', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.30, shadowRadius: 10, elevation: 6,
  },
  text: { color: '#E0E7FF', fontSize: 13, fontWeight: '700', lineHeight: 19 },
  tail: {
    position: 'absolute', bottom: -6, alignSelf: 'center',
    width: 12, height: 12, backgroundColor: '#1E1B4B',
    transform: [{ rotate: '45deg' }], borderRadius: 2,
  },
});

// ─── Mood Card (Step 1 専用) ──────────────────────────────────────────────────

function MoodCard({ label, sub, Icon, active, onPress, index, cardWidth = CW3, dark = false }: {
  label: string; sub?: string; Icon: LucideIcon;
  active: boolean; onPress: () => void; index: number; cardWidth?: number; dark?: boolean;
}) {
  const entryAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(entryAnim, {
      toValue: 1,
      delay: index * 80,
      damping: 12,
      stiffness: 100,
      useNativeDriver: true,
    }).start();
  }, []);
  const entryY     = entryAnim.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });
  const entryOp    = entryAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.7, 1] });
  const entryScale = entryAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });

  const pressScale = useRef(new Animated.Value(1)).current;
  const pIn  = () => Animated.spring(pressScale, { toValue: 0.95, tension: 300, friction: 10, useNativeDriver: true }).start();
  const pOut = () => Animated.spring(pressScale, { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }).start();
  const { puniX, puniY } = usePunin(active);

  return (
    <Animated.View style={{
      width: cardWidth, opacity: entryOp,
      transform: [{ translateY: entryY }, { scale: entryScale }],
    }}>
      <Animated.View style={{ transform: [{ scale: pressScale }, { scaleX: puniX }, { scaleY: puniY }] }}>
        <TouchableOpacity
          onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
          onPressIn={pIn}
          onPressOut={pOut}
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          accessibilityLabel={sub ? `${label} ${sub}` : label}
          style={[mc.card, dark && mc.cardDark, active && (dark ? mc.cardActiveDark : mc.cardActive)]}
        >
          {active && (
            <LinearGradient
              colors={dark
                ? ['#0F172A', '#1E1B4B', '#312E81']   // 夜空グラデ（疲れた・眠い用）
                : ['#EC4899', '#A855F7', '#3B82F6']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={mc.fill}
            />
          )}
          {active && (
            <View style={mc.checkWrap}>
              <View style={mc.checkCircle}>
                <Check size={10} color={dark ? '#312E81' : '#7C3AED'} strokeWidth={3} />
              </View>
            </View>
          )}
          <View style={[mc.iconCircle, dark && mc.iconCircleDark, active && mc.iconCircleA]}>
            <Icon
              size={24}
              color={dark ? (active ? '#FDE68A' : '#C7D2FE') : (active ? '#fff' : '#374151')}
              strokeWidth={1.8}
            />
          </View>
          <MarqueeText text={label} style={[mc.label, dark && mc.labelDark, active && mc.labelA]} containerWidth={cardWidth - 24} />
          {sub ? <MarqueeText text={sub} style={[mc.sublabel, dark && mc.sublabelDark, active && mc.sublabelA]} containerWidth={cardWidth - 24} /> : null}
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const mc = StyleSheet.create({
  card: {
    borderRadius: 16, backgroundColor: '#fff',
    borderWidth: 2, borderColor: '#E5E7EB',
    padding: 12, alignItems: 'center', gap: 6, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    minHeight: CW3 + 8,
  },
  cardActive: {
    borderColor: 'transparent',
    shadowColor: '#A855F7', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.30, shadowRadius: 14, elevation: 8,
  },
  // 夜カラー（疲れた・眠い用）
  cardDark: {
    backgroundColor: '#1E1B4B', borderColor: '#312E81',
    shadowColor: '#1E1B4B',
  },
  cardActiveDark: {
    borderColor: 'transparent',
    shadowColor: '#312E81', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 14, elevation: 8,
  },
  iconCircleDark: { backgroundColor: 'rgba(199,210,254,0.12)' },
  labelDark:      { color: '#E0E7FF' },
  sublabelDark:   { color: '#A5B4FC' },
  // 枠線(2px)の下まで広げて、フチまでぴったり塗る
  fill: { position: 'absolute', top: -2, left: -2, right: -2, bottom: -2 },
  checkWrap: { position: 'absolute', top: 6, right: 6 },
  checkCircle: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#F9FAFB',
    alignItems: 'center', justifyContent: 'center',
  },
  iconCircleA: { backgroundColor: 'rgba(255,255,255,0.20)' },
  label: { fontSize: 12, fontWeight: '700', color: '#111827', textAlign: 'center', lineHeight: 16 },
  labelA: { color: '#fff', fontWeight: '800' },
  sublabel: { fontSize: 10, color: '#6B7280', textAlign: 'center', lineHeight: 14 },
  sublabelA: { color: 'rgba(255,255,255,0.82)' },
});

// ─── Option Card ──────────────────────────────────────────────────────────────

function OptionCard({ label, sub, hint, Icon, active, onPress, width, height, index = 0 }: {
  label: string; sub?: string; hint?: string; Icon: LucideIcon;
  active: boolean; onPress: () => void; width: number; height: number; index?: number;
}) {
  const entryAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(entryAnim, {
      toValue: 1,
      delay: index * 80,
      damping: 12,
      stiffness: 100,
      useNativeDriver: true,
    }).start();
  }, []);
  const entryY     = entryAnim.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });
  const entryOp    = entryAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.7, 1] });
  const entryScale = entryAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });

  const pressScale = useRef(new Animated.Value(1)).current;
  const pIn  = () => Animated.spring(pressScale, { toValue: 0.90, tension: 350, friction: 14, useNativeDriver: true }).start();
  const pOut = () => Animated.spring(pressScale, { toValue: 1,    tension: 350, friction: 14, useNativeDriver: true }).start();
  const { puniX, puniY } = usePunin(active);

  return (
    <Animated.View style={{ width, height, opacity: entryOp, transform: [{ translateY: entryY }, { scale: entryScale }] }}>
      <Animated.View style={{ flex: 1, transform: [{ scale: pressScale }, { scaleX: puniX }, { scaleY: puniY }] }}>
        <TouchableOpacity onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} onPressIn={pIn} onPressOut={pOut} activeOpacity={1}
          accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={sub ? `${label} ${sub}` : label}
          style={[oc.card, { width, height }, active && oc.cardActive]}>
          {active && <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={oc.fill} />}
          {active && <View style={oc.badge}><Check size={10} color="#fff" strokeWidth={3} /></View>}
          <Icon size={26} color={active ? '#fff' : '#A78BFA'} strokeWidth={1.8} />
          <MarqueeText text={label} style={[oc.lbl, active && oc.lblA]} containerWidth={width - 16} />
          {sub ? <MarqueeText text={sub} style={[oc.sub, active && oc.subA]} containerWidth={width - 16} /> : null}
          {hint ? (
            <View style={[oc.hintWrap, active && oc.hintWrapA]}>
              <Text style={[oc.hint, active && oc.hintA]}>{hint}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}
const oc = StyleSheet.create({
  card: {
    borderRadius: 18, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#EDE9FE',
    alignItems: 'center', justifyContent: 'center', padding: 8, gap: 4, overflow: 'hidden',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 6, elevation: 2,
  },
  cardActive: {
    borderColor: 'transparent',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  // 枠線(1.5px)の下まで広げて、フチまでぴったり塗る
  fill: { position: 'absolute', top: -2, left: -2, right: -2, bottom: -2 },
  badge: {
    position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  lbl: { fontSize: 12, fontWeight: '700', color: '#1E0753', textAlign: 'center', lineHeight: 16 },
  lblA: { color: '#fff', fontWeight: '800' },
  sub: { fontSize: 10, color: '#A78BFA', textAlign: 'center', lineHeight: 13 },
  subA: { color: 'rgba(255,255,255,0.85)' },
  hintWrap: {
    marginTop: 3, paddingHorizontal: 6, paddingVertical: 3,
    borderRadius: 7, backgroundColor: 'rgba(167,139,250,0.12)',
    alignItems: 'center',
  },
  hintWrapA: { backgroundColor: 'rgba(255,255,255,0.18)' },
  hint: { fontSize: 9, color: '#7C3AED', textAlign: 'center', fontWeight: '700', lineHeight: 14 },
  hintA: { color: 'rgba(255,255,255,0.92)' },
});

// ─── Step Entrance Wrapper ────────────────────────────────────────────────────

function StepEntrance({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1, delay, damping: 12, stiffness: 100, useNativeDriver: true,
    }).start();
  }, []);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [60, 0] });
  const opacity    = anim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.7, 1] });
  const scale      = anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  return (
    <Animated.View style={{ opacity, transform: [{ translateY }, { scale }] }}>
      {children}
    </Animated.View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function QuizFlow(props: Props) {
  const insets = useSafeAreaInsets();
  // キーボード高を追跡し、絶対配置の「次へ」バーをキーボード上へ持ち上げる（自由ワード/エリア入力でCTAが隠れるのを防ぐ）
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEvt, (e) => setKbH(e.endCoordinates?.height ?? 0));
    const s2 = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s1.remove(); s2.remove(); };
  }, []);
  const {
    lang, step,
    selectedMood, onSelectMood,
    selectedCompanion, onSelectCompanion,
    budget, budgetMin, onSetBudget, onSetBudgetMin,
    selectedArea, onSelectArea,
    locationDisplayArea, isLocating, locationError,
    freeWord, onSetFreeWord,
    onUseCurrentLocation, onSetStep, onBack, onOpenResults,
    deepDiveL1, deepDiveL2, onSetDeepDiveL1, onSetDeepDiveL2,
    distanceFeeling, radiusKm, areaMode,
    onSetAreaMode, onSetDistanceFeeling,
  } = props;

  const stepOp  = useRef(new Animated.Value(1)).current;
  const stepSlX = useRef(new Animated.Value(0)).current;
  const prevSt  = useRef(step);

  const [scrollEnabled, setScrollEnabled] = useState(false);
  const scrollContainerH = useRef(0);
  const scrollContentH   = useRef(0);
  const checkScrollable  = () => {
    setScrollEnabled(scrollContentH.current > scrollContainerH.current + 2);
  };

  useEffect(() => {
    const dir = step >= prevSt.current ? 1 : -1;
    prevSt.current = step;
    setScrollEnabled(false);
    scrollContentH.current = 0;
    stepSlX.setValue(dir * 40); stepOp.setValue(0);
    Animated.parallel([
      Animated.timing(stepOp,  { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(stepSlX, { toValue: 0, tension: 220, friction: 28, useNativeDriver: true }),
    ]).start();
  }, [step]);

  const hasDive = !!DEEP_DIVE[selectedMood];
  const diveConfig = DEEP_DIVE[selectedMood];
  const selectedDiveOpt = diveConfig?.options.find(o => o.key === deepDiveL1);
  // こだわらない を選んだ場合は L2 をスキップ
  const hasDiveL2 = !!(deepDiveL1 && deepDiveL1 !== 'こだわらない' && selectedDiveOpt?.subs?.length);

  const meta = step === 6
    ? { title: diveConfig?.title ?? 'こだわりを教えて', sub: 'スキップもできます' }
    : step === 7
      ? { title: `${deepDiveL1}のスタイルは？`, sub: 'さらに絞り込めます' }
      : (STEP_META[step] ?? { title: '', sub: '' });

  // step 4 shares step 3's dot; step 7 shares step 6's dot
  const dotIdx = step === 4
    ? STEP_SEQ.indexOf(3)
    : step === 7
      ? STEP_SEQ.indexOf(6)
      : STEP_SEQ.indexOf(step);

  const handleBack = () => {
    if (step === 1)  { onBack(); return; }
    if (step === 2)  { onSetStep(1);  return; }
    if (step === 3)  { onSetStep(2);  return; }
    if (step === 4)  { onSetStep(3);  return; }
    if (step === 5)  { onSetStep(areaMode === 'manual' ? 3 : 4); return; }
    if (step === 6)  { onSetStep(5);  return; }
    if (step === 7)  { onSetStep(6);  return; }
    if (step === 8)  {
      onSetStep(hasDiveL2 ? 7 : (hasDive && selectedMood !== '時間潰し') ? 6 : 5);
      return;
    }
    onBack();
  };

  // ── 右スワイプで前ページへ戻る（滑らかアニメーション付き） ─────────────────
  const _swipeBackRef = useRef(handleBack);
  _swipeBackRef.current = handleBack;
  const swipeDragX = useRef(new Animated.Value(0)).current;

  const swipePan = useRef(PanResponder.create({
    // 明確な右方向スワイプのみ受け取る（縦スクロール・スライダーとの競合を避ける）
    onMoveShouldSetPanResponder: (_, g) =>
      g.dx > 30 && Math.abs(g.dx) > Math.abs(g.dy) * 2.5,
    // ジェスチャー開始: 既存アニメを止めてドラッグ量を即反映
    onPanResponderGrant: (_, g) => {
      swipeDragX.stopAnimation();
      swipeDragX.setValue(Math.max(0, g.dx) * 0.35);
    },
    // ドラッグ中: 実移動量の35%を画面に追従させて「重さ」を演出
    onPanResponderMove: (_, g) => {
      swipeDragX.setValue(Math.max(0, g.dx) * 0.35);
    },
    // 指を離した時: 閾値超えなら即リセット＋戻る、未満なら弾けて戻る
    onPanResponderRelease: (_, g) => {
      if (g.dx > 80 && Math.abs(g.dy) < 120) {
        swipeDragX.setValue(0);          // ステップ遷移アニメに任せる
        _swipeBackRef.current();
      } else {
        Animated.spring(swipeDragX, {
          toValue: 0,
          tension: 180,
          friction: 18,
          useNativeDriver: true,
        }).start();
      }
    },
    // 他の要素にジェスチャーを奪われた場合も元に戻す
    onPanResponderTerminate: () => {
      Animated.spring(swipeDragX, {
        toValue: 0,
        tension: 180,
        friction: 18,
        useNativeDriver: true,
      }).start();
    },
  })).current;

  // 「疲れた・眠い」はねぎらい専用カード → 次へ進ませない
  const blockNext = step === 1 && selectedMood === TIRED_KEY;

  const handleNext = () => {
    if (step === 1)  { if (selectedMood === TIRED_KEY) return; onSetStep(2);  return; }
    if (step === 2)  { onSetStep(3);  return; }
    if (step === 3)  { onSetStep(areaMode === 'manual' ? 5 : 4); return; }
    if (step === 4)  { onSetStep(5);  return; }
    if (step === 5)  { onSetStep((hasDive && selectedMood !== '時間潰し') ? 6 : 8); return; }
    if (step === 6)  { onSetStep(hasDiveL2 ? 7 : 8); return; }
    if (step === 7)  { onSetStep(8);  return; }
    if (step === 8)  { onOpenResults(); return; }
  };

  const nextLabel = step === 8
    ? (lang === 'ja' ? 'おすすめを見る' : 'Show me spots')
    : (step === 1 && !selectedMood) ||
      (step === 3 && !selectedArea && !locationDisplayArea) ||
      (step === 6 && !deepDiveL1) ||
      (step === 7 && !deepDiveL2) ||
      (step === 8 && !freeWord)
      ? (lang === 'ja' ? 'スキップ' : 'Skip')
      : (lang === 'ja' ? '次へ  →' : 'Next  →');

  const renderContent = () => {
    if (step === 1) return (
      <>
        {selectedMood === TIRED_KEY && <TiredComfortBubble />}
        <View style={s.grid}>
          {MOODS.map((m, i) => (
            <MoodCard
              key={m.key}
              label={m.label}
              sub={m.sub}
              Icon={m.Icon}
              dark={m.dark}
              active={selectedMood === m.key}
              index={i}
              onPress={() => onSelectMood(m.key)}
            />
          ))}
        </View>
      </>
    );

    if (step === 2) return (
      <View style={s.grid}>
        {COMPANIONS.map((m, i) => (
          <OptionCard key={m.key} label={m.label} Icon={m.Icon}
            active={selectedCompanion === m.key} width={CW3} height={CW3}
            index={i}
            onPress={() => onSelectCompanion(m.key)} />
        ))}
      </View>
    );

    // ── Step 3: エリア ──────────────────────────────────────────────────────
    if (step === 3) return (
      <>
        <StepEntrance delay={0}>
          <TouchableOpacity
            onPress={() => {
              onSetAreaMode('current_location');
              onUseCurrentLocation();
            }}
            disabled={isLocating}
            activeOpacity={0.85}
            style={s.locWrap}
          >
            <LinearGradient
              colors={isLocating ? ['#ccc', '#ccc'] : GRAD}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={s.locBtn}
            >
              <MapPin size={18} color="#fff" strokeWidth={2} style={{ marginRight: 6 }} />
              <Text style={s.locBtnTxt}>
                {isLocating
                  ? (lang === 'ja' ? '現在地を取得中...' : 'Getting location...')
                  : (lang === 'ja' ? '現在地を使う' : 'Use my location')}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </StepEntrance>
        <StepEntrance delay={80}>
          <Text style={s.orDiv}>{lang === 'ja' ? 'または' : 'or'}</Text>
          <IMESafeTextInput
            value={selectedArea}
            onChangeText={(v) => {
              onSelectArea(v);
              if (v.length > 0) onSetAreaMode('manual');
            }}
            placeholder={lang === 'ja' ? '例：渋谷 / 横浜 / 新宿' : 'e.g. Shibuya / Yokohama'}
            placeholderTextColor="#C4B5FD"
            style={s.areaInput}
          />
        </StepEntrance>
        {locationError ? <Text style={s.errTxt}>{locationError}</Text> : null}
      </>
    );

    // ── Step 4: 距離感 (current_location のみ) ──────────────────────────────
    if (step === 4) return (
      <View style={s.grid}>
        {DISTANCE_FEELINGS.map((d, i) => (
          <OptionCard
            key={d.key}
            label={d.key}
            sub={d.sub}
            hint={d.hint}
            Icon={d.Icon}
            active={distanceFeeling === d.key}
            width={CW3}
            height={CW3 + 36}
            index={i}
            onPress={() => onSetDistanceFeeling(d.key, d.radiusKm)}
          />
        ))}
      </View>
    );

    // ── Step 5: 予算 ────────────────────────────────────────────────────────
    if (step === 5) return (
      <StepEntrance delay={0}>
        <View style={s.budgetCard}>
          <BudgetRangeSlider minVal={budgetMin} maxVal={budget} onChangeMin={onSetBudgetMin} onChangeMax={onSetBudget} />
        </View>
        <Text style={s.quickPickLabel}>{lang === 'ja' ? 'クイック選択' : 'Quick pick'}</Text>
        <View style={s.grid}>
          {BUDGET_CHIPS.map((chip) => {
            const active = budget === chip.max && budgetMin === chip.min;
            return (
              <TouchableOpacity
                key={chip.label}
                onPress={() => { onSetBudget(chip.max); onSetBudgetMin(chip.min); }}
                activeOpacity={0.82}
                style={[s.budgetChip, active && s.budgetChipA]}
              >
                {active && (
                  <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.budgetFill} />
                )}
                <Text style={[s.budgetChipTxt, active && s.budgetChipTxtA]}>{chip.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </StepEntrance>
    );

    // ── Step 8: 自由ワード ──────────────────────────────────────────────────
    if (step === 8) {
      const HINT_TAGS = FREE_WORD_HINTS[selectedMood] ?? FREE_WORD_HINTS_DEFAULT;
      return (
        <StepEntrance delay={0}>
          <View style={s.freeWordCard}>
            <IMESafeTextInput
              value={freeWord}
              onChangeText={onSetFreeWord}
              placeholder={lang === 'ja'
                ? '例：夜景、甘いもの、公園、静かな場所、海が見たい など'
                : 'e.g. night view, sweets, park, quiet place...'}
              placeholderTextColor="#C4B5FD"
              multiline
              textAlignVertical="top"
              style={s.freeWordInput}
            />
            {freeWord.length > 0 && (
              <View style={s.freeWordCount}>
                <Text style={s.freeWordCountTxt}>{freeWord.length}</Text>
              </View>
            )}
          </View>
          <Text style={s.freeWordHintLabel}>{lang === 'ja' ? 'ヒント' : 'Suggestions'}</Text>
          <View style={s.freeWordHints}>
            {HINT_TAGS.map((hint) => (
              <TouchableOpacity
                key={hint}
                onPress={() => onSetFreeWord(freeWord ? `${freeWord}、${hint}` : hint)}
                style={[s.freeWordTag, freeWord.includes(hint) && s.freeWordTagA]}
                activeOpacity={0.75}
              >
                {freeWord.includes(hint) && (
                  <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                )}
                <Text style={[s.freeWordTagTxt, freeWord.includes(hint) && s.freeWordTagTxtA]}>{hint}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </StepEntrance>
      );
    }

    // ── Step 6: 深掘り Level 1 ──────────────────────────────────────────────
    if (step === 6 && diveConfig) {
      const cw6 = diveConfig.options.length <= 4 ? CW2 : CW3;
      return (
        <View style={s.grid}>
          {diveConfig.options.map((opt, i) => (
            <MoodCard
              key={opt.key}
              label={opt.label}
              sub={opt.key === 'こだわらない' ? opt.sub : (opt.subs?.length ? (lang === 'ja' ? 'さらに絞り込む ›' : 'More options ›') : opt.sub)}
              Icon={opt.Icon}
              active={deepDiveL1 === opt.key}
              index={i}
              cardWidth={cw6}
              onPress={() => {
                onSetDeepDiveL1(opt.key);
                onSetDeepDiveL2('');
              }}
            />
          ))}
        </View>
      );
    }

    // ── Step 7: 深掘り Level 2 ──────────────────────────────────────────────
    if (step === 7 && selectedDiveOpt?.subs) {
      const cw7 = selectedDiveOpt.subs.length === 4 ? CW2 : CW3;
      return (
        <View style={s.grid}>
          {selectedDiveOpt.subs.map((sub, i) => (
            <MoodCard
              key={sub.key}
              label={sub.label}
              Icon={sub.Icon}
              active={deepDiveL2 === sub.key}
              index={i}
              cardWidth={cw7}
              onPress={() => onSetDeepDiveL2(sub.key)}
            />
          ))}
          {/* こだわらない for L2 */}
          <MoodCard
            key="こだわらない"
            label="こだわらない"
            sub="なんでもOK"
            Icon={Shuffle}
            active={deepDiveL2 === 'こだわらない'}
            index={selectedDiveOpt.subs.length}
            cardWidth={cw7}
            onPress={() => onSetDeepDiveL2('こだわらない')}
          />
        </View>
      );
    }

    return null;
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]} {...swipePan.panHandlers}>
      {/* スワイプ追従ラッパー — 全コンテンツをまとめてスライド */}
      <Animated.View style={[s.flex, { transform: [{ translateX: swipeDragX }] }]}>
        {/* Nav row */}
        <View style={s.topBar}>
          <PuniPressable onPress={handleBack} style={s.backCircle}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <ChevronLeft size={20} color="#7C3AED" strokeWidth={2.5} />
          </PuniPressable>
          <View style={s.dots}>
            {STEP_SEQ.map((_, i) => {
              const done = i < dotIdx; const cur = i === dotIdx;
              return (
                <View key={i} style={[s.dot, cur && s.dotCur]}>
                  {(done || cur) && <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />}
                </View>
              );
            })}
          </View>
        </View>

        {/* Animated title + scroll */}
        <Animated.View style={[s.flex, { opacity: stepOp, transform: [{ translateX: stepSlX }] }]}>
          <View style={s.titleBlock}>
            <Text style={s.title}>{meta.title}</Text>
            <Text style={s.sub}>{meta.sub}</Text>
            {step === 4 && (selectedArea || locationDisplayArea) ? (
              <View style={s.areaTag}>
                <MapPin size={12} color="#7C3AED" strokeWidth={2} />
                <Text style={s.areaTagTxt}>{selectedArea || locationDisplayArea} から検索</Text>
              </View>
            ) : null}
          </View>
          <ScrollView
            style={s.flex}
            contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom, 20) + 100 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={scrollEnabled}
            onLayout={(e) => {
              scrollContainerH.current = e.nativeEvent.layout.height;
              checkScrollable();
            }}
            onContentSizeChange={(_, h) => {
              scrollContentH.current = h;
              checkScrollable();
            }}
          >
            {renderContent()}
          </ScrollView>
        </Animated.View>

        {/* Fixed Next button — ガラスバー（タブバーと同じ世界観）。キーボード表示中はその上へ持ち上げる */}
        <View style={[s.bottomBar, { bottom: kbH, paddingBottom: kbH > 0 ? 12 : Math.max(insets.bottom, 20) }]}>
          <BlurView
            intensity={55}
            tint="light"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={s.bottomBarTint} />
          <PuniPressable onPress={handleNext} disabled={blockNext} style={[s.nextWrap, blockNext && { opacity: 0.4 }]}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.nextBtn}>
              <Text style={s.nextTxt}>{blockNext ? (lang === 'ja' ? 'ゆっくり休んでね🌙' : 'Rest well 🌙') : nextLabel}</Text>
            </LinearGradient>
          </PuniPressable>
        </View>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: PAD, paddingTop: 10, paddingBottom: 6, gap: 12,
  },
  backCircle: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDE9FE',
    alignItems: 'center', justifyContent: 'center',
  },
  dots: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DDD6FE', overflow: 'hidden' },
  dotCur: { width: 24, height: 8, borderRadius: 4, overflow: 'hidden' },
  titleBlock: { paddingHorizontal: PAD, paddingTop: 14, paddingBottom: 8 },
  title: { fontSize: 30, fontWeight: '900', color: '#1E0753', marginBottom: 4, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: '#A78BFA', lineHeight: 20 },
  areaTag: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', marginTop: 8,
    backgroundColor: '#EDE9FE', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.3)',
  },
  areaTagTxt: { fontSize: 13, fontWeight: '700', color: '#7C3AED' },
  scrollContent: { paddingHorizontal: PAD, paddingTop: 4, paddingBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, justifyContent: 'center' },
  hint: {
    alignSelf: 'center', backgroundColor: '#EDE9FE',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 14,
  },
  hintTxt: { fontSize: 12, color: '#7C3AED', fontWeight: '600' },
  chipsLbl: { fontSize: 13, fontWeight: '700', color: '#7C3AED', marginBottom: 10 },
  chipsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 24, borderWidth: 1.5, borderColor: '#DDD6FE',
    backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, overflow: 'hidden',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  chipA: {
    borderColor: 'transparent',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  chipTxt: { fontSize: 14, fontWeight: '600', color: '#1E0753' },
  chipTxtA: { color: '#fff', fontWeight: '800' },
  budgetCard: {
    backgroundColor: '#fff', borderRadius: 22,
    padding: 20, marginBottom: 24,
    borderWidth: 1.5, borderColor: '#EDE9FE',
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12, shadowRadius: 20, elevation: 5,
  },
  quickPickLabel: {
    fontSize: 12, fontWeight: '800', color: '#7C3AED',
    letterSpacing: 0.5, marginBottom: 12, textTransform: 'uppercase',
  },
  budgetChip: {
    width: CW3, height: 52, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#DDD6FE',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  budgetChipA: {
    borderColor: 'transparent',
    shadowColor: '#C084FC', shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
  },
  // 枠線(1.5px)の下まで広げて、フチまでぴったり塗る
  budgetFill: { position: 'absolute', top: -2, left: -2, right: -2, bottom: -2 },
  budgetChipTxt: { fontSize: 13, fontWeight: '700', color: '#1E0753' },
  budgetChipTxtA: { color: '#fff', fontWeight: '800' },
  locWrap: {
    borderRadius: 16, overflow: 'hidden', marginBottom: 14,
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  locBtn: {
    height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row',
  },
  locBtnTxt: { fontSize: 16, fontWeight: '700', color: '#fff' },
  locTag: {
    alignSelf: 'center', backgroundColor: '#EDE9FE', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 6, marginBottom: 10,
  },
  locTagTxt: { fontSize: 13, fontWeight: '600', color: '#7C3AED' },
  orDiv: { textAlign: 'center', fontSize: 13, color: '#A78BFA', marginBottom: 12, marginTop: 2 },
  areaInput: {
    height: 54, borderRadius: 14, backgroundColor: '#fff',
    paddingHorizontal: 16, fontSize: 15, color: '#1E0753',
    borderWidth: 1.5, borderColor: '#DDD6FE',
  },
  errTxt: { fontSize: 13, color: '#EF4444', marginTop: 8 },
  freeWordCard: {
    backgroundColor: '#fff', borderRadius: 22,
    padding: 20, marginBottom: 20,
    borderWidth: 1.5, borderColor: '#EDE9FE',
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12, shadowRadius: 20, elevation: 5,
    minHeight: 160,
  },
  freeWordInput: {
    fontSize: 16, color: '#1E0753',
    lineHeight: 26, minHeight: 120,
    paddingTop: 0,
  },
  freeWordCount: {
    alignSelf: 'flex-end', marginTop: 8,
    backgroundColor: '#EDE9FE', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 3,
  },
  freeWordCountTxt: { fontSize: 11, fontWeight: '700', color: '#7C3AED' },
  freeWordHintLabel: {
    fontSize: 12, fontWeight: '800', color: '#7C3AED',
    letterSpacing: 0.5, marginBottom: 12, textTransform: 'uppercase',
  },
  freeWordHints: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  freeWordTag: {
    paddingHorizontal: 16, paddingVertical: 9,
    backgroundColor: '#fff', borderRadius: 999,
    borderWidth: 1.5, borderColor: '#DDD6FE', overflow: 'hidden',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  freeWordTagA: { borderColor: 'transparent', shadowColor: '#C084FC', shadowOpacity: 0.28, shadowRadius: 8, elevation: 4 },
  freeWordTagTxt: { fontSize: 13, fontWeight: '600', color: '#374151' },
  freeWordTagTxtA: { color: '#fff', fontWeight: '800' },
  bottomBar: {
    // コンテンツの上に浮かせて、背後がガラス越しに透ける
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: PAD, paddingTop: 12,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.65)',
  },
  bottomBarTint: {
    ...StyleSheet.absoluteFillObject,
    // タブバーと同じ白透明の曇り
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.72)',
  },
  nextWrap: {
    borderRadius: 18, overflow: 'hidden',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  nextBtn: { height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  nextTxt: { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
});
