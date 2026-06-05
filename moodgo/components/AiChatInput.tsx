/**
 * AiChatInput.tsx
 * AI相談の入力画面。
 * - ボタンを押した時点で位置情報を自動取得（プロップ status で表示）
 * - 自由ワードを1つ入力 → OpenAI に提案を任せる
 * - 送信すると onSubmit(text) が呼ばれ、いつもの結果画面に遷移する
 */

import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, MapPin, Send } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

const PINK = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];

const EXAMPLES = [
  '雨の日でも楽しめる屋内スポット',
  '一人でのんびりできるカフェ',
  'デートで映える夜景スポット',
  '子連れで遊べる場所',
  '安くて美味しい穴場グルメ',
];

// 吹き出し＋AI＋スパークル（FABと同じデザイン）
function AiBubbleIcon({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 30 30">
      <Path
        d="M7 4 H23 a5 5 0 0 1 5 5 V16 a5 5 0 0 1 -5 5 H14 l-5 5 v-5 H7 a5 5 0 0 1 -5 -5 V9 a5 5 0 0 1 5 -5 Z"
        fill="none" stroke="#fff" strokeWidth={2.2} strokeLinejoin="round"
      />
      <SvgText x="15" y="16.5" fill="#fff" fontSize="11" fontWeight="900" textAnchor="middle">AI</SvgText>
      <Path d="M22 6 C22 8.8 22.4 9.2 25.2 9.2 C22.4 9.2 22 9.6 22 12.4 C22 9.6 21.6 9.2 18.8 9.2 C21.6 9.2 22 8.8 22 6 Z" fill="#fff" />
    </Svg>
  );
}

type Props = {
  /** 位置情報の状態 */
  locating: boolean;
  hasLocation: boolean;
  locationLabel?: string;
  /** 戻る */
  onBack: () => void;
  /** 送信（自由ワード） */
  onSubmit: (text: string) => void;
};

export default function AiChatInput({ locating, hasLocation, locationLabel, onBack, onSubmit }: Props) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const canSubmit = text.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSubmit(text.trim());
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.root, { paddingTop: insets.top }]}>
        {/* ヘッダー */}
        <View style={s.header}>
          <TouchableOpacity onPress={onBack} style={s.backCircle} activeOpacity={0.7}>
            <ChevronLeft size={20} color="#7C3AED" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>AI相談</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 120 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ヒーロー */}
          <View style={s.hero}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroIcon}>
              <AiBubbleIcon size={44} />
            </LinearGradient>
            <Text style={s.heroTitle}>どんな場所を探していますか？</Text>
            <Text style={s.heroSub}>
              気分やシーンを自由に入力するだけ。{'\n'}AIがあなたにぴったりの場所を提案します。
            </Text>
          </View>

          {/* 位置情報ステータス */}
          <View style={[s.locChip, hasLocation && s.locChipDone]}>
            <MapPin size={15} color={hasLocation ? '#059669' : '#A78BFA'} strokeWidth={2.2} />
            <Text style={[s.locChipText, hasLocation && { color: '#059669' }]}>
              {locating ? '現在地を取得中…' : hasLocation ? `現在地を取得済み${locationLabel ? `（${locationLabel}）` : ''}` : '現在地は取得できませんでした'}
            </Text>
          </View>

          {/* 入力欄 */}
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="例：友達と行ける雰囲気のいい居酒屋"
            placeholderTextColor="#C4B5FD"
            multiline
            textAlignVertical="top"
            style={s.input}
            autoFocus
          />

          {/* 例（タップで入力） */}
          <Text style={s.examplesLabel}>こんな相談ができます</Text>
          <View style={s.exampleWrap}>
            {EXAMPLES.map((ex) => (
              <TouchableOpacity key={ex} onPress={() => setText(ex)} activeOpacity={0.75} style={s.exampleChip}>
                <Text style={s.exampleText}>{ex}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* 送信ボタン（下部固定） */}
        <View style={[s.submitWrap, { paddingBottom: insets.bottom + 14 }]}>
          <TouchableOpacity onPress={submit} disabled={!canSubmit} activeOpacity={0.85}>
            <LinearGradient
              colors={GRAD}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[s.submitBtn, !canSubmit && { opacity: 0.5 }]}
            >
              <Send size={18} color="#fff" strokeWidth={2.2} />
              <Text style={s.submitText}>AIに提案してもらう</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F0FF' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backCircle: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 6, elevation: 2,
  },
  headerTitle: { fontSize: 17, fontWeight: '900', color: '#1A0A2E' },

  scroll: { paddingHorizontal: 20, paddingTop: 8 },

  hero: { alignItems: 'center', gap: 12, marginBottom: 22 },
  heroIcon: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  heroTitle: { fontSize: 20, fontWeight: '900', color: '#1A0A2E', textAlign: 'center' },
  heroSub: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 20 },

  locChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#EDE9FE', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 7, marginBottom: 14,
  },
  locChipDone: { backgroundColor: '#D1FAE5' },
  locChipText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },

  input: {
    minHeight: 110, borderRadius: 16, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#DDD6FE',
    padding: 16, fontSize: 16, color: '#1E0753', lineHeight: 24,
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },

  examplesLabel: { fontSize: 12, fontWeight: '800', color: '#7C3AED', marginTop: 22, marginBottom: 10 },
  exampleWrap: { gap: 8 },
  exampleChip: {
    backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#EDE9FE',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  exampleText: { fontSize: 13, fontWeight: '600', color: '#6D28D9' },

  submitWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20, paddingTop: 10,
    backgroundColor: 'rgba(245,240,255,0.94)',
    borderTopWidth: 1, borderTopColor: 'rgba(155,107,255,0.12)',
  },
  submitBtn: {
    height: 56, borderRadius: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  submitText: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
});
