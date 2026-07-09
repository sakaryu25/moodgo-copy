// 並び替え: 人気順 / 最新順 / 評価順 / 価格順、右端に昇降トグル。
import { ArrowDownWideNarrow, ArrowUpNarrowWide, TrendingUp } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSettings } from '@/lib/settingsStore';
import { MP, SORTS, type SortKey } from './types';

// SORTS.label(日本語)はSortKey(安定した英語キー)から表示ラベルを引き直す。keyは不変
const SORT_LABEL: Record<SortKey, { ja: string; en: string }> = {
  popular: { ja: '人気順', en: 'Popular' },
  new: { ja: '最新順', en: 'Newest' },
  rating: { ja: '評価順', en: 'Top rated' },
  price: { ja: '価格順', en: 'Price' },
};

const T = {
  ja: {
    a11ySortBy: (label: string) => `${label}に並び替え`,
    a11yDesc: '降順に切り替え',
    a11yAsc: '昇順に切り替え',
  },
  en: {
    a11ySortBy: (label: string) => `Sort by ${label}`,
    a11yDesc: 'Switch to descending',
    a11yAsc: 'Switch to ascending',
  },
} as const;

export default function SortBar({
  sortKey, asc, onSort, onToggleAsc,
}: { sortKey: SortKey; asc: boolean; onSort: (k: SortKey) => void; onToggleAsc: () => void }) {
  const { lang } = useSettings();
  const t = T[lang];
  return (
    <View style={s.row}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sorts}>
        {SORTS.map(({ key }) => {
          const on = key === sortKey;
          const label = SORT_LABEL[key][lang];
          return (
            <TouchableOpacity key={key} onPress={() => onSort(key)} activeOpacity={0.7} style={s.sortBtn}
              accessibilityRole="button" accessibilityLabel={t.a11ySortBy(label)} accessibilityState={{ selected: on }}>
              {on && <TrendingUp size={13} color={MP.INK} strokeWidth={2.4} />}
              <Text style={[s.sortText, on && s.sortTextOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <TouchableOpacity onPress={onToggleAsc} style={s.filterBtn} activeOpacity={0.7}
        accessibilityRole="button" accessibilityLabel={asc ? t.a11yDesc : t.a11yAsc}>
        {asc
          ? <ArrowUpNarrowWide size={17} color={MP.INK} strokeWidth={2.1} />
          : <ArrowDownWideNarrow size={17} color={MP.INK} strokeWidth={2.1} />}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: MP.SIDE, paddingRight: MP.SIDE - 4 },
  sorts: { gap: 18, alignItems: 'center', paddingRight: 12 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8 },
  sortText: { fontSize: 13, fontWeight: '600', color: MP.SUB },
  sortTextOn: { color: MP.INK, fontWeight: '800' },
  filterBtn: { padding: 6 },
});
