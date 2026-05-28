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
import { COLORS } from '@/constants/colors';

type Props = {
  history: HistoryItem[];
  selectedHistoryItem: HistoryItem | null;
  onSelectHistoryItem: (item: HistoryItem | null) => void;
  onClearHistory: () => void;
  favorites: FavoriteItem[];
  onToggleFavorite: (rec: Recommendation) => void;
  onResearch?: (item: HistoryItem) => void;
  lang?: 'ja' | 'en';
};

const T = {
  ja: {
    backToList: '← 履歴一覧',
    title: '履歴',
    sub: 'これまで見たおすすめ',
    clear: 'クリア',
    empty: 'まだ履歴はありません\n気分から場所を探してみましょう！',
    recCount: (n: number) => `${n}件のおすすめ`,
    reSearch: '再検索',
    noRecs: '詳細なし',
    today: '今日',
    withLabel: '同伴', transportLabel: '交通', budgetLabel: '予算', timeLabel: '時間',
    free: '無料',
  },
  en: {
    backToList: '← History',
    title: 'History',
    sub: 'Past recommendations',
    clear: 'Clear',
    empty: 'No history yet\nLet\'s find a place by mood!',
    recCount: (n: number) => `${n} spots`,
    reSearch: 'Re-search',
    noRecs: 'No detail',
    today: 'Today',
    withLabel: 'With', transportLabel: 'Transport', budgetLabel: 'Budget', timeLabel: 'Time',
    free: 'Free',
  },
} as const;

function formatDate(dateStr: string | undefined, lang: 'ja' | 'en'): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString(lang === 'ja' ? 'ja-JP' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric' });
}

export default function HistoryView({
  history, selectedHistoryItem, onSelectHistoryItem, onClearHistory,
  favorites, onToggleFavorite, onResearch, lang = 'ja',
}: Props) {
  const insets = useSafeAreaInsets();
  const isFav = (title: string) => favorites.some((f) => f.title === title);
  const t = T[lang];

  if (selectedHistoryItem) {
    const item = selectedHistoryItem;
    const recCount = item.recommendations?.length ?? 0;
    const transports = Array.isArray(item.transport) ? item.transport.join('・') : item.transport;

    return (
      <ScrollView
        style={s.root}
        contentContainerStyle={[s.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => onSelectHistoryItem(null)} style={s.backRow}>
          <Text style={s.backText}>{t.backToList}</Text>
        </TouchableOpacity>

        {/* Session summary card */}
        <View style={s.summaryCard}>
          <View style={s.summaryTop}>
            <View style={s.moodBadgeLg}>
              <Text style={s.moodBadgeLgText}>{item.mood}</Text>
            </View>
            <Text style={s.summaryDate}>
              {item.createdAt
                ? new Date(item.createdAt).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                : ''}
            </Text>
          </View>
          <Text style={s.summaryArea} numberOfLines={1}>{item.area || '—'}</Text>
          <View style={s.summaryMeta}>
            {item.companion ? (
              <View style={s.metaChip}>
                <Text style={s.metaChipLabel}>{t.withLabel}</Text>
                <Text style={s.metaChipValue}>{item.companion}</Text>
              </View>
            ) : null}
            {transports ? (
              <View style={s.metaChip}>
                <Text style={s.metaChipLabel}>{t.transportLabel}</Text>
                <Text style={s.metaChipValue}>{transports}</Text>
              </View>
            ) : null}
            {item.time ? (
              <View style={s.metaChip}>
                <Text style={s.metaChipLabel}>{t.timeLabel}</Text>
                <Text style={s.metaChipValue}>{item.time}</Text>
              </View>
            ) : null}
            {item.budget != null && item.budget > 0 ? (
              <View style={s.metaChip}>
                <Text style={s.metaChipLabel}>{t.budgetLabel}</Text>
                <Text style={s.metaChipValue}>¥{item.budget.toLocaleString()}</Text>
              </View>
            ) : null}
          </View>
          <View style={s.summaryFooter}>
            {recCount > 0 && (
              <Text style={s.recCountText}>{t.recCount(recCount)}</Text>
            )}
            {item.savedAnswers?.mood && onResearch && (
              <TouchableOpacity onPress={() => onResearch(item)} style={s.reSearchBtn} activeOpacity={0.8}>
                <Text style={s.reSearchText}>{t.reSearch}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {item.recommendations && item.recommendations.length > 0
          ? item.recommendations.map((rec, i) => (
            <PlaceCard
              key={`${rec.title}-${i}`}
              item={rec}
              isFavorited={isFav(rec.title)}
              onToggleFavorite={() => onToggleFavorite(rec)}
              lang={lang}
            />
          ))
          : (
            <View style={s.emptyBox}>
              <Text style={s.emptyText}>{t.noRecs}</Text>
            </View>
          )
        }
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[s.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 80 }]}
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
          <Clock size={52} color="#FECDD3" strokeWidth={1.5} />
          <Text style={s.emptyText}>{t.empty}</Text>
        </View>
      ) : (
        history.map((item) => {
          const recCount = item.recommendations?.length ?? 0;
          return (
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
                <View style={s.headerRight}>
                  {recCount > 0 && (
                    <View style={s.recBadge}>
                      <Text style={s.recBadgeText}>{t.recCount(recCount)}</Text>
                    </View>
                  )}
                  <Text style={s.dateText}>{formatDate(item.createdAt, lang)}</Text>
                </View>
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
          );
        })
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  content: { padding: 16 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  pageTitle: { fontSize: 34, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  pageSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  clearBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  clearText: { fontSize: 15, color: '#F43F5E', fontWeight: '500' },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 16 },
  emptyText: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 24 },
  historyCard: { backgroundColor: '#fff', borderRadius: 20, padding: 16, marginBottom: 10, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3, borderWidth: 1, borderColor: '#F3F4F6' },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moodBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#FFF5F6', borderWidth: 1, borderColor: '#FECDD3' },
  moodBadgeText: { fontSize: 12, fontWeight: '700', color: '#F43F5E' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0' },
  recBadgeText: { fontSize: 11, fontWeight: '600', color: '#10B981' },
  dateText: { fontSize: 12, color: '#9CA3AF' },
  spotName: { fontSize: 17, fontWeight: '700', color: '#111827' },
  tags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#F3F4F6' },
  tagText: { fontSize: 12, fontWeight: '500', color: '#6B7280' },
  backRow: { marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: '600', color: '#F43F5E' },
  summaryCard: { backgroundColor: '#fff', borderRadius: 20, padding: 18, marginBottom: 16, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3, borderWidth: 1, borderColor: '#F3F4F6' },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moodBadgeLg: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: '#FFF5F6', borderWidth: 1, borderColor: '#FECDD3' },
  moodBadgeLgText: { fontSize: 14, fontWeight: '700', color: '#F43F5E' },
  summaryDate: { fontSize: 13, color: '#9CA3AF' },
  summaryArea: { fontSize: 24, fontWeight: '800', color: '#111827', letterSpacing: -0.4, lineHeight: 30 },
  summaryMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#F3F4F6' },
  metaChipLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '500' },
  metaChipValue: { fontSize: 12, color: '#111827', fontWeight: '700' },
  recCountText: { fontSize: 13, color: '#10B981', fontWeight: '700' },
  summaryFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reSearchBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: '#FFF5F6', borderWidth: 1.5, borderColor: '#FECDD3' },
  reSearchText: { fontSize: 14, fontWeight: '700', color: '#F43F5E' },
});
