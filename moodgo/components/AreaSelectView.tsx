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
  emoji: string;
  style: ViewStyle;
  onPress: () => void;
};

function RegionFloatingButton({ label, emoji, style, onPress }: RegionFloatingButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.72}
      style={[s.floatBtn, style]}
    >
      <Text style={s.floatEmoji}>{emoji}</Text>
      <Text style={s.floatLabel}>{label}</Text>
      <Text style={s.floatArrow}>›</Text>
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
        emoji="❄️"
        style={{ position: 'absolute', top: 14, right: 8 }}
        onPress={() => onSelectRegion('hokkaido-tohoku')}
      />
      {/* 関東: 右中央 */}
      <RegionFloatingButton
        label="関東"
        emoji="🗼"
        style={{ position: 'absolute', top: 148, right: 8 }}
        onPress={() => onSelectRegion('kanto')}
      />
      {/* 中部: 中央やや右 */}
      <RegionFloatingButton
        label="中部"
        emoji="⛰️"
        style={{ position: 'absolute', top: 204, right: 52 }}
        onPress={() => onSelectRegion('chubu')}
      />
      {/* 近畿: 中央下 */}
      <RegionFloatingButton
        label="近畿"
        emoji="🏯"
        style={{ position: 'absolute', top: 240, left: CARD_W * 0.28 }}
        onPress={() => onSelectRegion('kinki')}
      />
      {/* 中国: 左中央 */}
      <RegionFloatingButton
        label="中国"
        emoji="🌉"
        style={{ position: 'absolute', top: 204, left: 8 }}
        onPress={() => onSelectRegion('chugoku')}
      />
      {/* 四国: 左下寄り */}
      <RegionFloatingButton
        label="四国"
        emoji="🏝️"
        style={{ position: 'absolute', bottom: 88, left: 30 }}
        onPress={() => onSelectRegion('shikoku')}
      />
      {/* 九州・沖縄: 左下 */}
      <RegionFloatingButton
        label="九州・沖縄"
        emoji="🌴"
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
    <ScrollView
      style={s.root}
      contentContainerStyle={[
        s.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 100 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* 背景デコ円 */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={s.decoCircle1} />
        <View style={s.decoCircle2} />
      </View>

      {/* ページタイトル */}
      <Text style={s.pageTitle}>特集</Text>

      {/* サブヘッダー */}
      <Text style={s.sectionTitle}>エリアを選ぶ</Text>
      <Text style={s.sectionDesc}>
        行きたいエリアを選ぶと、あなたに合った特集が見られます。
      </Text>

      {/* 日本地図カード */}
      <JapanMapCard onSelectRegion={onSelectRegion} />
    </ScrollView>
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
    backgroundColor: '#FFFFFF',
  },
  content: {
    paddingHorizontal: 20,
  },

  // デコ円
  decoCircle1: {
    position: 'absolute',
    top: -50,
    right: -70,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(229,107,155,0.11)',
  },
  decoCircle2: {
    position: 'absolute',
    top: 60,
    right: -90,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(168,120,230,0.08)',
  },

  // ヘッダー
  pageTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 22,
    letterSpacing: -0.5,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  sectionDesc: {
    fontSize: 14,
    color: '#777777',
    lineHeight: 20,
    marginBottom: 24,
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
  floatEmoji: {
    fontSize: 13,
  },
  floatLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333333',
    letterSpacing: -0.1,
  },
  floatArrow: {
    fontSize: 14,
    color: '#BBAAAA',
    fontWeight: '600',
    marginLeft: 1,
  },
});
