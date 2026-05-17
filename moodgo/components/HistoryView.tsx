import { Clock } from 'lucide-react-native';
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HistoryItem, FavoriteItem, Recommendation } from '@/types/app';
import PlaceCard from './PlaceCard';

type Props = {
  history: HistoryItem[];
  selectedHistoryItem: HistoryItem | null;
  onSelectHistoryItem: (item: HistoryItem | null) => void;
  onClearHistory: () => void;
  favorites: FavoriteItem[];
  onToggleFavorite: (rec: Recommendation) => void;
  lang?: 'ja' | 'en';
};

const T = {
  ja: {
    backToList: '← 履歴一覧に戻る',
    title: '履歴',
    sub: 'これまで見たおすすめ',
    clear: 'クリア',
    empty: 'まだ履歴はありません\n気分から場所を探してみましょう！',
  },
  en: {
    backToList: '← Back to history',
    title: 'History',
    sub: 'Past recommendations',
    clear: 'Clear',
    empty: 'No history yet\nLet\'s find a place by mood!',
  },
};

export default function HistoryView({
  history, selectedHistoryItem, onSelectHistoryItem, onClearHistory,
  favorites, onToggleFavorite, lang = 'ja',
}: Props) {
  const insets = useSafeAreaInsets();
  const isFav = (title: string) => favorites.some((f) => f.title === title);
  const t = T[lang];

  if (selectedHistoryItem) {
    return (
      <ScrollView
        style={s.root}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => onSelectHistoryItem(null)} style={s.backRow}>
          <Text style={s.backText}>{t.backToList}</Text>
        </TouchableOpacity>
        <Text style={s.detailMood}>{selectedHistoryItem.mood}</Text>
        <Text style={s.detailArea}>{selectedHistoryItem.area}</Text>
        {selectedHistoryItem.recommendations && selectedHistoryItem.recommendations.map((rec, i) => (
          <PlaceCard
            key={`${rec.title}-${i}`}
            item={rec}
            isFavorited={isFav(rec.title)}
            onToggleFavorite={() => onToggleFavorite(rec)}
          />
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.titleRow}>
        <View>
          <Text style={s.pageTitle}>{t.title}</Text>
          <Text style={s.pageSub}>{t.sub}</Text>
        </View>
        {history.length > 0 && (
          <TouchableOpacity onPress={onClearHistory} style={s.clearBtn}>
            <Text style={s.clearText}>{t.clear}</Text>
          </TouchableOpacity>
        )}
      </View>

      {history.length === 0 ? (
        <View style={s.emptyBox}>
          <Clock size={52} color="#C7C7CC" strokeWidth={1.5} />
          <Text style={s.emptyText}>{t.empty}</Text>
        </View>
      ) : (
        history.map((item) => (
          <TouchableOpacity
            key={item.id}
            onPress={() => onSelectHistoryItem(item)}
            style={s.historyCard}
            activeOpacity={0.7}
          >
            <View style={s.historyHeader}>
              <View style={s.moodBadge}>
                <Text style={s.moodBadgeText}>{item.mood}</Text>
              </View>
              {item.createdAt && (
                <Text style={s.dateText}>
                  {new Date(item.createdAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                </Text>
              )}
            </View>
            <Text style={s.spotName} numberOfLines={1}>{item.topRecommendation}</Text>
            <View style={s.tags}>
              {[item.area, item.companion].filter(Boolean).map((tag, i) => (
                <View key={i} style={s.tag}>
                  <Text style={s.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  content: { padding: 16 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  pageTitle: { fontSize: 34, fontWeight: '700', color: '#000', letterSpacing: -0.5 },
  pageSub: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  clearBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  clearText: { fontSize: 15, color: '#FF3B30', fontWeight: '400' },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 16 },
  emptyText: { fontSize: 15, color: '#8E8E93', textAlign: 'center', lineHeight: 24 },
  historyCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    marginBottom: 10, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moodBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
    backgroundColor: '#FF6B3515',
  },
  moodBadgeText: { fontSize: 12, fontWeight: '600', color: '#FF6B35' },
  dateText: { fontSize: 12, color: '#8E8E93' },
  spotName: { fontSize: 17, fontWeight: '600', color: '#000' },
  tags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6,
    backgroundColor: '#F2F2F7',
  },
  tagText: { fontSize: 12, fontWeight: '500', color: '#6D6D72' },
  backRow: { marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: '500', color: '#FF6B35' },
  detailMood: { fontSize: 13, fontWeight: '600', color: '#FF6B35', marginBottom: 4 },
  detailArea: { fontSize: 28, fontWeight: '700', color: '#000', marginBottom: 20, letterSpacing: -0.5 },
});
