// カテゴリ横スクロールチップ。選択中=濃い紫 / 未選択=白。
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSettings } from '@/lib/settingsStore';
import { CATEGORIES, MP, type Category } from './types';

// カテゴリ値(=日本語キー)は状態/比較にそのまま使うので不変。表示ラベルだけ言語別に引く
const CAT_LABEL: Record<Category, { ja: string; en: string }> = {
  'すべて': { ja: 'すべて', en: 'All' },
  '景色': { ja: '景色', en: 'Scenery' },
  'グルメ': { ja: 'グルメ', en: 'Food' },
  '温泉': { ja: '温泉', en: 'Hot springs' },
  '絶景': { ja: '絶景', en: 'Views' },
  'カフェ': { ja: 'カフェ', en: 'Cafés' },
  '神社仏閣': { ja: '神社仏閣', en: 'Shrines & temples' },
  'その他': { ja: 'その他', en: 'Other' },
};

const T = {
  ja: { a11yCategory: (label: string) => `カテゴリ ${label}` },
  en: { a11yCategory: (label: string) => `Category ${label}` },
} as const;

export default function CategoryTabs({
  selected, onSelect,
}: { selected: Category; onSelect: (c: Category) => void }) {
  const { lang } = useSettings();
  const t = T[lang];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
      {CATEGORIES.map((c) => {
        const on = c === selected;
        const label = CAT_LABEL[c][lang];
        return (
          <TouchableOpacity key={c} onPress={() => onSelect(c)} activeOpacity={0.8}
            style={[s.chip, on && s.chipOn]}
            accessibilityRole="button" accessibilityLabel={t.a11yCategory(label)} accessibilityState={{ selected: on }}>
            <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { gap: 9, paddingHorizontal: MP.SIDE, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)',
    shadowColor: '#111', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  chipOn: { backgroundColor: '#2A1B5E', borderColor: '#2A1B5E' },
  chipText: { fontSize: 12.5, fontWeight: '700', color: MP.INK },
  chipTextOn: { color: '#FFFFFF' },
});
