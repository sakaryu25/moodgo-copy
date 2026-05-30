/**
 * QuizFlow.tsx — 共通質問 (Step 1〜5 + エリア)
 *
 * Step 1  今の気分は？     (mood 3×3 grid)
 * Step 2  誰と？           (companion 3×2 grid)
 * Step 3  交通手段は？     (transport multi-select, なんでも exclusive)
 * Step 4  予算は？         (range slider + preset chips)
 * Step 5  どのくらい時間？  (time 3×2 grid with sub-labels)
 * Step 10 エリアは？        (location input)
 *
 * Layout: back circle · gradient progress dots · title · scroll · fixed gradient Next
 */

import { LinearGradient } from 'expo-linear-gradient';
import {
  Activity, Bike, BookOpen, Building2, Camera, Car,
  ChefHat, Check, ChevronLeft,
  Clock, Coffee, Compass, Dumbbell,
  Fish, Flame, Footprints, Gamepad2, Globe,
  Heart, Home, Hourglass,
  Laptop, Leaf, Moon, Mountain, Plane,
  ShoppingBag, Shuffle, Sparkles,
  Star, Sunset, Timer, TrainFront, TreePine,
  Trophy, UtensilsCrossed,
  User, UserCheck, Users, UsersRound,
  Waves, Wine, Zap,
} from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Dimensions, Easing, PanResponder,
  ScrollView, StyleSheet, Text, TextInput,
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
const SLIDER_W = SCREEN_W - PAD * 2;
const THUMB_D = 28;
const MAX_BUDGET = 15000;
const BSTEP = 500;
const STEP_SEQ = [1, 2, 3, 4, 5, 6, 10, 11];

type LucideIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

// ─── Data ─────────────────────────────────────────────────────────────────────

const MOODS: { key: string; label: string; sub: string; Icon: LucideIcon }[] = [
  { key: 'お腹すいた', label: 'お腹すいた', sub: '絶品グルメ',  Icon: UtensilsCrossed },
  { key: 'まったり',   label: 'まったり',   sub: '癒やし',      Icon: Coffee },
  { key: 'わいわい',   label: 'わいわい',   sub: 'エンタメ',    Icon: Sparkles },
  { key: '自然',       label: '自然',       sub: '絶景',        Icon: Leaf },
  { key: 'ドライブ',   label: 'ドライブ',   sub: 'ツーリング',  Icon: Car },
  { key: '集中',       label: '集中',       sub: '作業・勉強',  Icon: BookOpen },
  { key: '運動',       label: '運動',       sub: 'スポーツ',    Icon: Activity },
  { key: '旅行',       label: '旅行',       sub: '小旅行',      Icon: Plane },
  { key: '時間潰し',   label: '時間潰し',   sub: 'のんびり',    Icon: Shuffle },
];

const COMPANIONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: '一人',           label: '一人',   Icon: User },
  { key: '友達',           label: '友達',   Icon: Users },
  { key: '恋人',           label: '恋人',   Icon: Heart },
  { key: '家族',           label: '家族',   Icon: Home },
  { key: '大人数グループ', label: '大人数', Icon: UsersRound },
  { key: '先輩',           label: '先輩',   Icon: UserCheck },
];

const TRANSPORTS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: '徒歩',       label: '徒歩',       Icon: Footprints },
  { key: '自転車',     label: '自転車',     Icon: Bike },
  { key: '電車・バス', label: '電車・バス', Icon: TrainFront },
  { key: '車・バイク', label: '車・バイク', Icon: Car },
  { key: 'なんでも',   label: 'なんでも',   Icon: Shuffle },
];

const TIMES: { key: string; label: string; sub: string; Icon: LucideIcon }[] = [
  { key: '15〜30分',   label: '15〜30分',   sub: '近所のスポット',    Icon: Timer },
  { key: '30〜60分',   label: '30〜60分',   sub: '徒歩・自転車圏内',  Icon: Clock },
  { key: '1〜2時間',   label: '1〜2時間',   sub: '電車で数駅',        Icon: Hourglass },
  { key: '2〜4時間',   label: '2〜4時間',   sub: '隣の市・区',        Icon: Hourglass },
  { key: '4〜6時間',   label: '4〜6時間',   sub: '同じ県内',          Icon: Sunset },
  { key: '6時間以上',  label: '6時間以上',  sub: '県外まで行くよ！',  Icon: Moon },
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

const DEEP_DIVE: Record<string, DiveConfig> = {
  'お腹すいた': {
    title: 'どんなジャンルを食べたい？',
    options: [
      { key: '居酒屋',           label: '居酒屋',           sub: '個室・大衆スタイル',      Icon: Wine,
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
      { key: '洋食',             label: '洋食',             sub: 'ハンバーグ・ステーキ',    Icon: ChefHat,
        subs: [
          { key: 'ハンバーグ',   label: 'ハンバーグ',   Icon: ChefHat },
          { key: 'オムライス',   label: 'オムライス',   Icon: Star },
          { key: 'ステーキ',     label: 'ステーキ',     Icon: Flame },
          { key: 'レトロ洋食',   label: 'レトロ洋食',   Icon: Clock },
        ],
      },
      { key: 'イタリアン',       label: 'イタリアン',       sub: 'パスタ・ピザ',            Icon: UtensilsCrossed },
      { key: '中華料理',         label: '中華料理',         sub: '点心・担々麺など',        Icon: Globe },
      { key: '焼肉',             label: '焼肉',             sub: '食べ放題・高級など',      Icon: Flame,
        subs: [
          { key: '焼肉食べ放題', label: '食べ放題',    Icon: Users },
          { key: '高級焼肉',     label: '高級焼肉',    Icon: Trophy },
          { key: '焼肉単品',     label: '単品メニュー', Icon: Sparkles },
        ],
      },
      { key: '韓国料理',         label: '韓国料理',         sub: 'チーズタッカルビなど',   Icon: Zap },
      { key: 'アジア料理',       label: 'アジア料理',       sub: 'インド・タイなど',        Icon: Globe,
        subs: [
          { key: 'インド・ネパール',     label: 'インド・ネパール', Icon: Sparkles },
          { key: 'タイ料理',            label: 'タイ料理',         Icon: Leaf },
          { key: 'ベトナム料理',        label: 'ベトナム料理',     Icon: Leaf },
          { key: 'アジアンエスニック',  label: 'アジアンエスニック', Icon: Globe },
        ],
      },
      { key: '各国料理',         label: '各国料理',         sub: 'メキシコ・ブラジルなど',  Icon: Compass,
        subs: [
          { key: 'メキシコ料理', label: 'メキシコ料理', Icon: Sparkles },
          { key: 'ブラジル料理', label: 'ブラジル料理', Icon: Flame },
          { key: 'ロシア料理',   label: 'ロシア料理',   Icon: Star },
          { key: 'その他各国',   label: 'その他の国',   Icon: Globe },
        ],
      },
      { key: 'ラーメン',         label: 'ラーメン',         sub: 'こってり・あっさりなど',  Icon: Coffee,
        subs: [
          { key: 'こってりラーメン',   label: 'こってり系',       Icon: Flame },
          { key: 'あっさりラーメン',   label: 'あっさり系',       Icon: Leaf },
          { key: '味噌ラーメン',       label: '味噌',             Icon: Mountain },
          { key: 'つけ麺・まぜそば',   label: 'つけ麺・まぜそば', Icon: Shuffle },
        ],
      },
      { key: 'お好み焼き',       label: 'お好み焼き・もんじゃ', sub: '鉄板焼き系',         Icon: Flame },
      { key: 'カフェスイーツ',   label: 'カフェ・スイーツ', sub: 'パンケーキ・スイーツ',   Icon: Heart,
        subs: [
          { key: 'スイーツカフェ', label: 'スイーツカフェ',  Icon: Heart },
          { key: '喫茶店',         label: '喫茶店・レトロ',  Icon: Coffee },
          { key: '流行りカフェ',   label: '流行りカフェ',    Icon: Camera },
        ],
      },
      { key: '高層ビルレストラン', label: '高層ビルレストラン', sub: '絶景を楽しみながら',  Icon: Building2 },
    ],
  },

  'まったり': {
    title: 'どこで癒やされたい？',
    options: [
      { key: '自然の中',   label: '自然の中',   sub: '海辺・公園など',        Icon: Leaf,
        subs: [
          { key: '海辺',        label: '海辺',        Icon: Waves },
          { key: '自然公園',    label: '自然公園',    Icon: TreePine },
          { key: '大型公園',    label: '大型公園',    Icon: Leaf },
          { key: '絶景スポット', label: '絶景スポット', Icon: Mountain },
        ],
      },
      { key: 'カフェ',     label: '癒しカフェ', sub: 'のんびりくつろぐ',      Icon: Coffee,
        subs: [
          { key: 'ブックカフェ',    label: 'ブックカフェ',    Icon: BookOpen },
          { key: '動物カフェ',      label: '動物カフェ',      Icon: Heart },
          { key: '景色良いカフェ',  label: '景色良いカフェ',  Icon: Camera },
          { key: 'スイーツカフェ',  label: 'スイーツカフェ',  Icon: Star },
        ],
      },
      { key: '温泉サウナ', label: '温泉・サウナ', sub: '体の芯からリラックス',  Icon: Waves,
        subs: [
          { key: '温泉旅館',  label: '温泉旅館',    Icon: Waves },
          { key: 'サウナ',    label: 'サウナ専門店', Icon: Flame },
          { key: '岩盤浴',    label: '岩盤浴',      Icon: Sparkles },
        ],
      },
      { key: '絶景スポット', label: '絶景スポット', sub: '美しい景色に癒される', Icon: Mountain,
        subs: [
          { key: '都会の夜景',  label: '都会の夜景', Icon: Building2 },
          { key: '海辺・夕日',  label: '海辺・夕日', Icon: Waves },
          { key: '展望台',      label: '展望台',     Icon: Compass },
        ],
      },
    ],
  },

  'わいわい': {
    title: '何をして楽しみたい？',
    options: [
      { key: '体を動かす',    label: '体を動かす',    sub: 'アクティブに遊ぶ',     Icon: Activity },
      { key: 'アミューズメント', label: 'アミューズメント', sub: 'テーマパーク・施設', Icon: Zap },
      { key: '体験型ゲーム',  label: '体験型ゲーム',  sub: '謎解き・VRなど',      Icon: Gamepad2 },
    ],
  },

  '自然': {
    title: 'どんな自然を感じたい？',
    options: [
      { key: '海辺',     label: '海辺',     sub: '波の音・砂浜',   Icon: Waves },
      { key: '自然公園', label: '自然公園', sub: '森・山・渓谷',   Icon: TreePine },
      { key: '大型公園', label: '大型公園', sub: '広々した芝生',   Icon: Leaf },
      { key: '展望台',   label: '展望台',   sub: 'パノラマ絶景',   Icon: Mountain },
    ],
  },

  'ドライブ': {
    title: 'ドライブの目的地は？',
    options: [
      { key: '海辺ドライブ',  label: '海辺',         sub: 'シーサイドロード',     Icon: Waves },
      { key: '絶景スポット',  label: '絶景スポット', sub: '山・峠・展望台',       Icon: Mountain },
      { key: 'ショッピング',  label: 'ショッピング', sub: 'アウトレット・モール', Icon: ShoppingBag },
      { key: 'ご当地グルメ',  label: 'ご当地グルメ', sub: '地元の名物料理',       Icon: UtensilsCrossed },
    ],
  },

  '集中': {
    title: 'どこで集中したい？',
    options: [
      { key: 'カフェ作業',  label: 'カフェで作業', sub: 'コーヒー片手に',   Icon: Laptop },
      { key: '図書館',      label: '図書館・自習室', sub: 'しっかり集中',   Icon: BookOpen },
      { key: 'ファミレス',  label: 'ファミレス',   sub: '食事しながら作業', Icon: UtensilsCrossed },
      { key: 'ブックカフェ', label: 'ブックカフェ', sub: '本に囲まれて',    Icon: Coffee },
    ],
  },

  '運動': {
    title: 'どんな風に体を動かしたい？',
    options: [
      { key: 'ガッツリ運動',  label: 'ガッツリ運動', sub: 'ジム・フィットネス',      Icon: Dumbbell },
      { key: 'スポーツ',      label: 'スポーツ',     sub: '球技・ランニング',        Icon: Trophy },
      { key: '体験型ゲーム',  label: '体験型ゲーム', sub: 'ボウリング・ビリヤード',  Icon: Gamepad2 },
      { key: '屋外スポーツ',  label: '屋外スポーツ', sub: '山・川・海',              Icon: Activity },
    ],
  },

  '旅行': {
    title: '旅のテーマを選んで',
    options: [
      { key: 'パワースポット', label: 'パワースポット', sub: '神社・絶景',         Icon: Compass },
      { key: 'テーマパーク',   label: 'テーマパーク',   sub: '大型施設で楽しむ',   Icon: Star },
      { key: '街歩き',         label: '街歩き・散策',   sub: '路地裏・観光地',     Icon: Footprints },
      { key: '絶景スポット',   label: '絶景スポット',   sub: '自然の絶景',         Icon: Camera },
    ],
  },
};

const STEP_META: Record<number, { title: string; sub: string }> = {
  1:  { title: '今の気分は？',           sub: 'タップして選択' },
  2:  { title: '誰と？',                 sub: '誰と行くかでおすすめが変わります。' },
  3:  { title: '交通手段は？',           sub: 'なんでも以外は複数選べます。' },
  4:  { title: '予算はどのくらい？',     sub: 'スライダーで範囲を設定できます。' },
  5:  { title: 'どのくらい時間がある？', sub: '空き時間に合う過ごし方を提案します。' },
  10: { title: 'エリアはどこ？',         sub: '現在地を使うか、エリア名を入力してください。' },
};

// ─── Props (kept fully compatible with index.tsx) ─────────────────────────────

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
  // 深掘り
  deepDiveL1: string;
  deepDiveL2: string;
  onSetDeepDiveL1: (v: string) => void;
  onSetDeepDiveL2: (v: string) => void;
};

// ─── Budget Range Slider ──────────────────────────────────────────────────────

function BudgetRangeSlider({
  minVal, maxVal, onChangeMin, onChangeMax,
}: {
  minVal: number; maxVal: number | undefined;
  onChangeMin: (v: number) => void; onChangeMax: (v: number | undefined) => void;
}) {
  const toX   = (v: number) => Math.max(0, Math.min((v / MAX_BUDGET) * (SLIDER_W - THUMB_D), SLIDER_W - THUMB_D));
  const toMaxX = (v: number | undefined) =>
    v === undefined || v >= MAX_BUDGET ? SLIDER_W - THUMB_D : toX(Math.min(v, MAX_BUDGET));

  const [minX, setMinX] = useState(() => toX(minVal));
  const [maxX, setMaxX] = useState(() => toMaxX(maxVal));
  const minXR = useRef(minX);
  const maxXR = useRef(maxX);

  useEffect(() => {
    const a = toX(minVal); const b = toMaxX(maxVal);
    setMinX(a); setMaxX(b); minXR.current = a; maxXR.current = b;
  }, [minVal, maxVal]);

  const sMin = useRef(0); const sMax = useRef(0);

  const panMin = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { sMin.current = minXR.current; },
    onPanResponderMove: (_, g) => {
      const nx = Math.max(0, Math.min(sMin.current + g.dx, maxXR.current - THUMB_D * 1.5));
      setMinX(nx); minXR.current = nx;
      onChangeMin(Math.round(((nx / (SLIDER_W - THUMB_D)) * MAX_BUDGET) / BSTEP) * BSTEP);
    },
  })).current;

  const panMax = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { sMax.current = maxXR.current; },
    onPanResponderMove: (_, g) => {
      const nx = Math.min(SLIDER_W - THUMB_D, Math.max(sMax.current + g.dx, minXR.current + THUMB_D * 1.5));
      setMaxX(nx); maxXR.current = nx;
      if (nx >= SLIDER_W - THUMB_D - 5) onChangeMax(undefined);
      else onChangeMax(Math.round(((nx / (SLIDER_W - THUMB_D)) * MAX_BUDGET) / BSTEP) * BSTEP);
    },
  })).current;

  const aL = minX + THUMB_D / 2;
  const aW = Math.max(0, maxX + THUMB_D / 2 - aL);
  const minLbl = minVal === 0 ? '¥0' : `¥${minVal.toLocaleString()}`;
  const maxLbl = maxVal === undefined || maxVal >= MAX_BUDGET ? '上限なし' : `¥${maxVal.toLocaleString()}`;

  return (
    <View style={rsl.wrap}>
      <View style={rsl.displayWrap}>
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={rsl.displayGrad}>
          <Text style={rsl.displayText}>{minLbl}  〜  {maxLbl}</Text>
        </LinearGradient>
      </View>
      <View style={{ width: SLIDER_W, height: 60, alignSelf: 'center' }}>
        <View style={rsl.trackBg} />
        <View style={[rsl.trackActive, { left: aL, width: aW }]}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        </View>
        <View {...panMin.panHandlers} style={[rsl.thumb, { left: minX }]}>
          <LinearGradient colors={['#F472B6', '#C084FC']} style={rsl.thumbInner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        </View>
        <View {...panMax.panHandlers} style={[rsl.thumb, { left: maxX }]}>
          <LinearGradient colors={['#C084FC', '#60A5FA']} style={rsl.thumbInner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        </View>
        <View style={rsl.scaleRow}>
          <Text style={rsl.scaleText}>¥0</Text>
          <Text style={rsl.scaleText}>¥15,000+</Text>
        </View>
      </View>
    </View>
  );
}

const rsl = StyleSheet.create({
  wrap: { marginBottom: 20 },
  displayWrap: {
    alignSelf: 'center', borderRadius: 18, overflow: 'hidden', marginBottom: 20,
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 6,
  },
  displayGrad: { paddingHorizontal: 32, paddingVertical: 14, borderRadius: 18 },
  displayText: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  trackBg: {
    position: 'absolute', left: THUMB_D / 2, right: THUMB_D / 2,
    height: 5, borderRadius: 99, backgroundColor: '#DDD6FE', top: (60 - 5) / 2,
  },
  trackActive: {
    position: 'absolute', height: 5, borderRadius: 99, overflow: 'hidden', top: (60 - 5) / 2,
  },
  thumb: {
    position: 'absolute', width: THUMB_D, height: THUMB_D, borderRadius: THUMB_D / 2,
    top: (60 - THUMB_D) / 2, backgroundColor: '#fff', overflow: 'hidden',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  thumbInner: { flex: 1 },
  scaleRow: {
    position: 'absolute', left: 0, right: 0, bottom: 2,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: THUMB_D / 2,
  },
  scaleText: { fontSize: 11, color: '#A78BFA', fontWeight: '500' },
});

// ─── Mood Card (Step 1 専用) ──────────────────────────────────────────────────

function MoodCard({ label, sub, Icon, active, onPress, index }: {
  label: string; sub?: string; Icon: LucideIcon;
  active: boolean; onPress: () => void; index: number;
}) {
  // 出現アニメ (spring, staggered)
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

  // タップアニメ
  const pressScale = useRef(new Animated.Value(1)).current;
  const pIn  = () => Animated.spring(pressScale, { toValue: 0.95, tension: 300, friction: 10, useNativeDriver: true }).start();
  const pOut = () => Animated.spring(pressScale, { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }).start();

  return (
    <Animated.View style={{
      width: CW3, opacity: entryOp,
      transform: [{ translateY: entryY }, { scale: entryScale }],
    }}>
      <Animated.View style={{ transform: [{ scale: pressScale }] }}>
        <TouchableOpacity
          onPress={onPress}
          onPressIn={pIn}
          onPressOut={pOut}
          activeOpacity={1}
          style={[mc.card, active && mc.cardActive]}
        >
          {active && (
            <LinearGradient
              colors={['#EC4899', '#A855F7', '#3B82F6']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          )}
          {/* チェックバッジ */}
          {active && (
            <View style={mc.checkWrap}>
              <View style={mc.checkCircle}>
                <Check size={10} color="#7C3AED" strokeWidth={3} />
              </View>
            </View>
          )}
          {/* アイコンサークル */}
          <View style={[mc.iconCircle, active && mc.iconCircleA]}>
            <Icon size={24} color={active ? '#fff' : '#374151'} strokeWidth={1.8} />
          </View>
          {/* ラベル */}
          <Text style={[mc.label, active && mc.labelA]} numberOfLines={1}>{label}</Text>
          {sub ? <Text style={[mc.sublabel, active && mc.sublabelA]} numberOfLines={1}>{sub}</Text> : null}
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

function OptionCard({ label, sub, Icon, active, onPress, width, height, index = 0 }: {
  label: string; sub?: string; Icon: LucideIcon;
  active: boolean; onPress: () => void; width: number; height: number; index?: number;
}) {
  // 出現アニメ (MoodCard と同じ staggered spring)
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

  // タップアニメ
  const pressScale = useRef(new Animated.Value(1)).current;
  const pIn  = () => Animated.spring(pressScale, { toValue: 0.90, tension: 350, friction: 14, useNativeDriver: true }).start();
  const pOut = () => Animated.spring(pressScale, { toValue: 1,    tension: 350, friction: 14, useNativeDriver: true }).start();

  return (
    <Animated.View style={{ width, height, opacity: entryOp, transform: [{ translateY: entryY }, { scale: entryScale }] }}>
      <Animated.View style={{ flex: 1, transform: [{ scale: pressScale }] }}>
        <TouchableOpacity onPress={onPress} onPressIn={pIn} onPressOut={pOut} activeOpacity={1}
          style={[oc.card, { width, height }, active && oc.cardActive]}>
          {active && <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
          {active && <View style={oc.badge}><Text style={oc.badgeTxt}>✓</Text></View>}
          <Icon size={26} color={active ? '#fff' : '#A78BFA'} strokeWidth={1.8} />
          <Text style={[oc.lbl, active && oc.lblA]} numberOfLines={2}>{label}</Text>
          {sub ? <Text style={[oc.sub, active && oc.subA]} numberOfLines={2}>{sub}</Text> : null}
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
  badge: {
    position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  badgeTxt: { fontSize: 10, color: '#fff', fontWeight: '900' },
  lbl: { fontSize: 12, fontWeight: '700', color: '#1E0753', textAlign: 'center', lineHeight: 16 },
  lblA: { color: '#fff', fontWeight: '800' },
  sub: { fontSize: 10, color: '#A78BFA', textAlign: 'center', lineHeight: 13 },
  subA: { color: 'rgba(255,255,255,0.85)' },
});

// ─── Step Entrance Wrapper (fade + slide up, for non-grid content) ────────────

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
  const {
    lang, step,
    selectedMood, onSelectMood,
    selectedCompanion, onSelectCompanion,
    selectedTransports, onSelectTransports,
    budget, budgetMin, onSetBudget, onSetBudgetMin,
    selectedTime, onSelectTime,
    selectedArea, onSelectArea,
    locationDisplayArea, isLocating, locationError,
    onUseCurrentLocation, onSetStep, onBack, onOpenResults,
    deepDiveL1, deepDiveL2, onSetDeepDiveL1, onSetDeepDiveL2,
  } = props;

  const stepOp  = useRef(new Animated.Value(1)).current;
  const stepSlX = useRef(new Animated.Value(0)).current;
  const prevSt  = useRef(step);

  useEffect(() => {
    const dir = step >= prevSt.current ? 1 : -1;
    prevSt.current = step;
    stepSlX.setValue(dir * 40); stepOp.setValue(0);
    Animated.parallel([
      Animated.timing(stepOp,  { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(stepSlX, { toValue: 0, tension: 220, friction: 28, useNativeDriver: true }),
    ]).start();
  }, [step]);

  // ステップ6/7はDEEP_DIVEがある気分のときのみ表示
  const hasDive = !!DEEP_DIVE[selectedMood];
  const diveConfig = DEEP_DIVE[selectedMood];
  const selectedDiveOpt = diveConfig?.options.find(o => o.key === deepDiveL1);
  const hasDiveL2 = !!(deepDiveL1 && selectedDiveOpt?.subs?.length);

  const meta = step === 6
    ? { title: diveConfig?.title ?? 'こだわりを教えて', sub: 'スキップもできます' }
    : step === 7
      ? { title: `${deepDiveL1}のスタイルは？`, sub: 'さらに絞り込めます' }
      : (STEP_META[step] ?? { title: '', sub: '' });

  // step 7 は STEP_SEQ に含まれないので step 6 のドットを共有
  const dotIdx = step === 7 ? STEP_SEQ.indexOf(6) : STEP_SEQ.indexOf(step);

  const handleBack = () => {
    if (step === 1)  { onBack(); return; }
    if (step === 2)  { onSetStep(1);  return; }
    if (step === 3)  { onSetStep(2);  return; }
    if (step === 4)  { onSetStep(3);  return; }
    if (step === 5)  { onSetStep(4);  return; }
    if (step === 6)  { onSetStep(5);  return; }
    if (step === 7)  { onSetStep(6);  return; }
    if (step === 10) { onSetStep(hasDive ? 6 : 5); return; }
    onBack();
  };

  const handleNext = () => {
    if (step === 1)  { onSetStep(2);  return; }
    if (step === 2)  { onSetStep(3);  return; }
    if (step === 3)  { onSetStep(4);  return; }
    if (step === 4)  { onSetStep(5);  return; }
    if (step === 5)  { onSetStep(hasDive ? 6 : 10); return; }
    if (step === 6)  { onSetStep(hasDiveL2 ? 7 : 10); return; }
    if (step === 7)  { onSetStep(10); return; }
    if (step === 10) { onOpenResults(); return; }
  };

  const nextLabel = step === 10
    ? (lang === 'ja' ? 'おすすめを見る' : 'Show me spots')
    : (step === 1 && !selectedMood) || (step === 6 && !deepDiveL1) || (step === 7 && !deepDiveL2)
      ? (lang === 'ja' ? 'スキップ' : 'Skip')
      : (lang === 'ja' ? '次へ  →' : 'Next  →');

  const renderContent = () => {
    if (step === 1) return (
      <View style={s.grid}>
        {MOODS.map((m, i) => (
          <MoodCard
            key={m.key}
            label={m.label}
            sub={m.sub}
            Icon={m.Icon}
            active={selectedMood === m.key}
            index={i}
            onPress={() => onSelectMood(m.key)}
          />
        ))}
      </View>
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

    if (step === 3) return (
      <>
        <View style={s.hint}>
          <Text style={s.hintTxt}>{lang === 'ja' ? '複数選択できます（なんでも は単独）' : 'Multi-select · "Any" is exclusive'}</Text>
        </View>
        <View style={s.grid}>
          {TRANSPORTS.map((m, i) => {
            const active = selectedTransports.includes(m.key);
            return (
              <OptionCard key={m.key} label={m.label} Icon={m.Icon}
                active={active} width={CW3} height={CW3}
                index={i}
                onPress={() => {
                  if (m.key === 'なんでも') { onSelectTransports(active ? [] : ['なんでも']); }
                  else {
                    const w = selectedTransports.filter((x) => x !== 'なんでも' && x !== m.key);
                    onSelectTransports(active ? w : [...w, m.key]);
                  }
                }} />
            );
          })}
        </View>
      </>
    );

    if (step === 4) return (
      <>
        <StepEntrance delay={0}>
          <BudgetRangeSlider minVal={budgetMin} maxVal={budget} onChangeMin={onSetBudgetMin} onChangeMax={onSetBudget} />
        </StepEntrance>
        <StepEntrance delay={80}>
          <Text style={s.chipsLbl}>{lang === 'ja' ? 'よく使う範囲' : 'Common ranges'}</Text>
          <View style={s.chipsGrid}>
            {BUDGET_CHIPS.map((chip, i) => {
              const active = budget === chip.max && budgetMin === chip.min;
              return (
                <StepEntrance key={chip.label} delay={80 + i * 50}>
                  <TouchableOpacity onPress={() => { onSetBudget(chip.max); onSetBudgetMin(chip.min); }}
                    style={[s.chip, active && s.chipA]}>
                    {active && <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
                    <Text style={[s.chipTxt, active && s.chipTxtA]}>{chip.label}</Text>
                  </TouchableOpacity>
                </StepEntrance>
              );
            })}
          </View>
        </StepEntrance>
      </>
    );

    if (step === 5) return (
      <View style={s.grid}>
        {TIMES.map((m, i) => (
          <OptionCard key={m.key} label={m.label} sub={m.sub} Icon={m.Icon}
            active={selectedTime === m.key} width={CW3} height={CW3 + 20}
            index={i}
            onPress={() => onSelectTime(m.key)} />
        ))}
      </View>
    );

    if (step === 10) return (
      <>
        <StepEntrance delay={0}>
          <TouchableOpacity onPress={onUseCurrentLocation} disabled={isLocating} activeOpacity={0.85} style={s.locWrap}>
            <LinearGradient colors={isLocating ? ['#ccc', '#ccc'] : GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.locBtn}>
              <Text style={s.locBtnTxt}>{isLocating ? (lang === 'ja' ? '現在地を取得中...' : 'Getting location...') : (lang === 'ja' ? '📍 現在地を使う' : '📍 Use my location')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </StepEntrance>
        {locationDisplayArea ? <View style={s.locTag}><Text style={s.locTagTxt}>📍 {locationDisplayArea}</Text></View> : null}
        <StepEntrance delay={80}>
          <Text style={s.orDiv}>{lang === 'ja' ? 'または' : 'or'}</Text>
          <TextInput value={selectedArea} onChangeText={onSelectArea}
            placeholder={lang === 'ja' ? '例：渋谷 / 横浜 / 新宿' : 'e.g. Shibuya / Yokohama'}
            placeholderTextColor="#C4B5FD" style={s.areaInput} />
        </StepEntrance>
        {locationError ? <Text style={s.errTxt}>{locationError}</Text> : null}
      </>
    );

    // ── Step 6: 深掘り Level 1 ──────────────────────────────────────────────
    if (step === 6 && diveConfig) return (
      <View style={s.grid}>
        {diveConfig.options.map((opt, i) => (
          <MoodCard
            key={opt.key}
            label={opt.label}
            sub={opt.subs?.length ? (lang === 'ja' ? 'さらに絞り込む ›' : 'More options ›') : opt.sub}
            Icon={opt.Icon}
            active={deepDiveL1 === opt.key}
            index={i}
            onPress={() => {
              onSetDeepDiveL1(opt.key);
              onSetDeepDiveL2(''); // L1 変更時 L2 リセット
            }}
          />
        ))}
      </View>
    );

    // ── Step 7: 深掘り Level 2 ──────────────────────────────────────────────
    if (step === 7 && selectedDiveOpt?.subs) return (
      <View style={s.grid}>
        {selectedDiveOpt.subs.map((sub, i) => (
          <MoodCard
            key={sub.key}
            label={sub.label}
            Icon={sub.Icon}
            active={deepDiveL2 === sub.key}
            index={i}
            onPress={() => onSetDeepDiveL2(sub.key)}
          />
        ))}
      </View>
    );

    return null;
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Nav row */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={handleBack} style={s.backCircle} activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ChevronLeft size={20} color="#7C3AED" strokeWidth={2.5} />
        </TouchableOpacity>
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
        </View>
        <ScrollView style={s.flex} contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {renderContent()}
        </ScrollView>
      </Animated.View>

      {/* Fixed Next button */}
      <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <TouchableOpacity onPress={handleNext} activeOpacity={0.88} style={s.nextWrap}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.nextBtn}>
            <Text style={s.nextTxt}>{nextLabel}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F0FF' },
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
  locWrap: {
    borderRadius: 16, overflow: 'hidden', marginBottom: 14,
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  locBtn: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
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
  bottomBar: {
    paddingHorizontal: PAD, paddingTop: 12,
    backgroundColor: 'rgba(245,240,255,0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(167,139,250,0.25)',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 10,
  },
  nextWrap: {
    borderRadius: 18, overflow: 'hidden',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  nextBtn: { height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  nextTxt: { fontSize: 18, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
});
