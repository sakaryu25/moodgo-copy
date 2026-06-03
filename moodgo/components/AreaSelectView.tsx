// AreaSelectView — エリア選択画面
//
// 日本列島画像は assets/images/japan-map.png に置いてください。
// 推奨仕様:
//   - 透過PNG / 1000×1200px 前後
//   - 背景なし、地方ごとに淡い色分け
//   - 境界線は白または薄いグレー、文字なし
//   - 地方カラー例:
//       北海道・東北: #BEE3F8  関東: #C6F6D5  中部: #B2F5EA
//       近畿: #FEFCBF          中国: #FED7E2  四国: #E9D8FD
//       九州・沖縄: #FEEBC8

import {
  Building2,
  ChevronRight,
  Landmark,
  Leaf,
  Mountain,
  Snowflake,
  Sun,
  Waves,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Dimensions,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];

// 画像を assets/images/japan-map.png に置いてください
const JAPAN_MAP_IMAGE = require('../assets/images/japan-map.png');

const { width: W } = Dimensions.get('window');
const CARD_W  = W - 40;   // 画面幅 90%
const CARD_H  = 400;
const MAP_H   = 320;

// ─── 地方定義 ──────────────────────────────────────────────────────────────────

export type Region =
  | 'hokkaido-tohoku'
  | 'kanto'
  | 'chubu'
  | 'kinki'
  | 'chugoku'
  | 'shikoku'
  | 'kyushu-okinawa';

export const REGION_LABELS: Record<Region, string> = {
  'hokkaido-tohoku': '北海道・東北',
  'kanto':           '関東',
  'chubu':           '中部',
  'kinki':           '近畿',
  'chugoku':         '中国',
  'shikoku':         '四国',
  'kyushu-okinawa':  '九州・沖縄',
};

// ─── RegionFloatingButton ─────────────────────────────────────────────────────

type RegionFloatingButtonProps = {
  label: string;
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  iconColor: string;
  style: ViewStyle;
  onPress: () => void;
};

function RegionFloatingButton({ label, Icon, iconColor, style, onPress }: RegionFloatingButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.72}
      style={[s.floatBtn, style]}
    >
      <Icon size={13} color={iconColor} strokeWidth={2} />
      <Text style={s.floatLabel}>{label}</Text>
      <ChevronRight size={11} color="#C0B0B0" strokeWidth={2} />
    </TouchableOpacity>
  );
}

// ─── JapanMapCard ─────────────────────────────────────────────────────────────

type JapanMapCardProps = {
  onSelectRegion: (region: Region) => void;
};

function JapanMapCard({ onSelectRegion }: JapanMapCardProps) {
  return (
    <View style={s.mapCard}>
      {/* 日本列島画像 */}
      <Image
        source={JAPAN_MAP_IMAGE}
        style={s.mapImage}
        resizeMode="contain"
      />

      {/* 地方ボタン — 地図の周りに浮かせる配置 */}
      {/* 北海道・東北: 右上 */}
      <RegionFloatingButton
        label="北海道・東北"
        Icon={Snowflake}
        iconColor="#5BA3C9"
        style={{ position: 'absolute', top: 14, right: 8 }}
        onPress={() => onSelectRegion('hokkaido-tohoku')}
      />
      {/* 関東: 右中央 */}
      <RegionFloatingButton
        label="関東"
        Icon={Building2}
        iconColor="#4A9E6B"
        style={{ position: 'absolute', top: 148, right: 8 }}
        onPress={() => onSelectRegion('kanto')}
      />
      {/* 中部: 中央やや右 */}
      <RegionFloatingButton
        label="中部"
        Icon={Mountain}
        iconColor="#3A9E8A"
        style={{ position: 'absolute', top: 204, right: 52 }}
        onPress={() => onSelectRegion('chubu')}
      />
      {/* 近畿: 中央下 */}
      <RegionFloatingButton
        label="近畿"
        Icon={Landmark}
        iconColor="#9E8A2A"
        style={{ position: 'absolute', top: 240, left: CARD_W * 0.28 }}
        onPress={() => onSelectRegion('kinki')}
      />
      {/* 中国: 左中央 */}
      <RegionFloatingButton
        label="中国"
        Icon={Waves}
        iconColor="#C96B8A"
        style={{ position: 'absolute', top: 204, left: 8 }}
        onPress={() => onSelectRegion('chugoku')}
      />
      {/* 四国: 左下寄り */}
      <RegionFloatingButton
        label="四国"
        Icon={Leaf}
        iconColor="#8A5BC9"
        style={{ position: 'absolute', bottom: 88, left: 30 }}
        onPress={() => onSelectRegion('shikoku')}
      />
      {/* 九州・沖縄: 左下 */}
      <RegionFloatingButton
        label="九州・沖縄"
        Icon={Sun}
        iconColor="#C97A3A"
        style={{ position: 'absolute', bottom: 28, left: 8 }}
        onPress={() => onSelectRegion('kyushu-okinawa')}
      />
    </View>
  );
}

// ─── AreaSelectView (メイン) ──────────────────────────────────────────────────

type Props = {
  onSelectRegion: (region: Region) => void;
  lang?: 'ja' | 'en';
};

export default function AreaSelectView({ onSelectRegion, lang = 'ja' }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={s.root}>
      {/* ── グラデーションヘッダー（履歴・お気に入りと共通デザイン）── */}
      <LinearGradient
        colors={GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.heroHeader, { paddingTop: insets.top + 14 }]}
      >
        <View style={s.decoCircle1} pointerEvents="none" />
        <View style={s.decoCircle2} pointerEvents="none" />
        <View style={s.heroContent}>
          <View>
            <Text style={s.heroTitle}>{lang === 'ja' ? '特集' : 'Featured'}</Text>
            <Text style={s.heroSub}>{lang === 'ja' ? 'どこへ行く？' : 'Pick your destination'}</Text>
          </View>
        </View>
      </LinearGradient>

      {/* ── スクロールコンテンツ ── */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={s.sectionDesc}>
          {lang === 'ja' ? 'エリアをタップして特集を見る' : 'Tap a region to see the feature'}
        </Text>

        {/* 日本地図カード */}
        <JapanMapCard onSelectRegion={onSelectRegion} />
      </ScrollView>
    </View>
  );
}

// ─── スタイル ─────────────────────────────────────────────────────────────────

const CARD_SHADOW = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
  android: { elevation: 2 },
});

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8F6FF',
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },

  // ── グラデーションヘッダー（履歴・お気に入りと共通）─────────────────────────
  heroHeader: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    overflow: 'hidden',
  },
  decoCircle1: {
    position: 'absolute',
    top: -30,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  decoCircle2: {
    position: 'absolute',
    top: 40,
    right: 40,
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  heroContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '500',
  },

  sectionDesc: {
    fontSize: 14,
    color: '#9CA3AF',
    lineHeight: 20,
    marginBottom: 20,
  },

  // 地図カード
  mapCard: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: '#FFFDFB',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#EFE5DF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',  // ボタンがはみ出せるように
    ...CARD_SHADOW,
  },
  mapImage: {
    width: '100%',
    height: MAP_H,
    opacity: 0.95,
  },

  // 地方ボタン
  floatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#EFE5DF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  floatLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333333',
    letterSpacing: -0.1,
  },
});
