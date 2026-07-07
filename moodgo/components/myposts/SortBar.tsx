// 並び替え: 人気順 / 最新順 / 評価順 / 価格順、右端に昇降トグル。
import { ArrowDownWideNarrow, ArrowUpNarrowWide, TrendingUp } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MP, SORTS, type SortKey } from './types';

export default function SortBar({
  sortKey, asc, onSort, onToggleAsc,
}: { sortKey: SortKey; asc: boolean; onSort: (k: SortKey) => void; onToggleAsc: () => void }) {
  return (
    <View style={s.row}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sorts}>
        {SORTS.map(({ key, label }) => {
          const on = key === sortKey;
          return (
            <TouchableOpacity key={key} onPress={() => onSort(key)} activeOpacity={0.7} style={s.sortBtn}
              accessibilityRole="button" accessibilityLabel={`${label}に並び替え`} accessibilityState={{ selected: on }}>
              {on && <TrendingUp size={13} color={MP.INK} strokeWidth={2.4} />}
              <Text style={[s.sortText, on && s.sortTextOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <TouchableOpacity onPress={onToggleAsc} style={s.filterBtn} activeOpacity={0.7}
        accessibilityRole="button" accessibilityLabel={asc ? '降順に切り替え' : '昇順に切り替え'}>
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
