/**
 * ai-chat.tsx
 * OpenAI 自由入力チャット画面（プレースホルダー）
 * AI相談FABから遷移する。中身は今後実装。
 */

import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ChevronLeft, Sparkles } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const GRAD: [string, string, string] = ['#F56CB3', '#9B6BFF', '#4FA3FF'];

export default function AiChatScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* ヘッダー */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backCircle} activeOpacity={0.7}>
          <ChevronLeft size={20} color="#7C3AED" strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>AI相談</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* プレースホルダー本文 */}
      <View style={s.center}>
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.iconBg}>
          <Sparkles size={36} color="#fff" strokeWidth={2} fill="#fff" />
        </LinearGradient>
        <Text style={s.title}>AIに自由に相談</Text>
        <Text style={s.sub}>
          行きたい場所や気分を{'\n'}自由に入力してAIに相談できます。{'\n'}（実装準備中）
        </Text>
      </View>
    </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 40 },
  iconBg: {
    width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  title: { fontSize: 20, fontWeight: '900', color: '#1A0A2E' },
  sub: { fontSize: 14, color: '#888', textAlign: 'center', lineHeight: 22 },
});
