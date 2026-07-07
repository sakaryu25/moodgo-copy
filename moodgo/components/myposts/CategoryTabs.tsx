// カテゴリ横スクロールチップ。選択中=濃い紫 / 未選択=白。
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { CATEGORIES, MP, type Category } from './types';

export default function CategoryTabs({
  selected, onSelect,
}: { selected: Category; onSelect: (c: Category) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
      {CATEGORIES.map((c) => {
        const on = c === selected;
        return (
          <TouchableOpacity key={c} onPress={() => onSelect(c)} activeOpacity={0.8}
            style={[s.chip, on && s.chipOn]}
            accessibilityRole="button" accessibilityLabel={`カテゴリ ${c}`} accessibilityState={{ selected: on }}>
            <Text style={[s.chipText, on && s.chipTextOn]}>{c}</Text>
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
