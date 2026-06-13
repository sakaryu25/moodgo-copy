// 法務ページ（プライバシーポリシー・利用規約）のアプリ内ネイティブ画面の共通レイアウト。
// 外部サイトに飛ばさず、アプリ内の新しいページとして表示する。
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PuniPressable from '@/components/PuniPressable';

const PURPLE = '#9B6BFF';
const BG = '#F5F0FF';

export type LegalSection = { h?: string; body: string };

type Props = {
  title: string;
  updated: string;
  lead?: string;
  sections: LegalSection[];
  footer?: string;
};

export default function LegalScreen({ title, updated, lead, sections, footer }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <PuniPressable onPress={() => router.back()} style={s.backCircle}>
          <ChevronLeft size={20} color="#7C3AED" strokeWidth={2.5} />
        </PuniPressable>
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: insets.bottom + 48 }}>
        <Text style={s.docTitle}>{title}</Text>
        <Text style={s.updated}>最終更新日：{updated}</Text>
        {!!lead && <Text style={s.lead}>{lead}</Text>}
        {sections.map((sec, i) => (
          <View key={i}>
            {!!sec.h && <Text style={s.h}>{sec.h}</Text>}
            <Text style={s.body}>{sec.body}</Text>
          </View>
        ))}
        {!!footer && <Text style={s.footer}>{footer}</Text>}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backCircle: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#EDE9FE',
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: '#1E0753' },
  docTitle: { fontSize: 22, fontWeight: '900', color: '#1E0753', marginBottom: 4 },
  updated: { fontSize: 12, color: '#A78BFA', marginBottom: 16 },
  lead: { fontSize: 14, color: '#4A3B6B', lineHeight: 23, marginBottom: 8 },
  h: { fontSize: 15.5, fontWeight: '800', color: '#1E0753', marginTop: 22, marginBottom: 8 },
  body: { fontSize: 13.5, color: '#4A3B6B', lineHeight: 22 },
  footer: { fontSize: 12, color: '#A78BFA', marginTop: 36 },
});
