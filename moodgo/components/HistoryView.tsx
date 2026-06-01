import { LinearGradient } from 'expo-linear-gradient';
import { Clock, ChevronRight, RotateCcw, Trash2, MapPin, Users, Banknote, Navigation } from 'lucide-react-native';
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

const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const GRAD_LIGHT: [string, string, string] = [
  'rgba(244,114,182,0.15)',
  'rgba(192,132,252,0.15)',
  'rgba(96,165,250,0.15)',
];

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
    backToList: '履歴一覧',
    title: '履歴',
    sub: 'これまで見たおすすめ',
    clear: 'クリア',
    empty: 'まだ履歴はありません',
    emptySub: '気分から場所を探してみましょう！',
    recCount: (n: number) => `${n}件`,
    reSearch: '再検索',
    noRecs: '詳細なし',
    today: '今日',
    yesterday: '昨日',
    thisWeek: '今週',
    older: 'それ以前',
    withLabel: '同伴',
    budgetLabel: '予算',
    distanceLabel: '距離',
    free: '無料',
  },
  en: {
    backToList: 'History',
    title: 'History',
    sub: 'Past recommendations',
    clear: 'Clear',
    empty: 'No history yet',
    emptySub: "Let's find a place by mood!",
    recCount: (n: number) => `${n} spots`,
    reSearch: 'Re-search',
    noRecs: 'No detail',
    today: 'Today',
    yesterday: 'Yesterday',
    thisWeek: 'This Week',
    older: 'Earlier',
    withLabel: 'With',
    budgetLabel: 'Budget',
    distanceLabel: 'Distance',
    free: 'Free',
  },
} as const;

function getDateGroup(dateStr: string | undefined, t: TStrings): string {
  if (!dateStr) return t.older;
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t.today;
  if (diffDays === 1) return t.yesterday;
  if (diffDays <= 7) return t.thisWeek;
  return t.older;
}

function formatTime(dateStr: string | undefined, lang: 'ja' | 'en'): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString(lang === 'ja' ? 'ja-JP' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFullDate(dateStr: string | undefined, lang: 'ja' | 'en'): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

// 日付グループ順
const GROUP_ORDER = ['今日', '昨日', '今週', 'それ以前', 'Today', 'Yesterday', 'This Week', 'Earlier'];

type TStrings = {
  backToList: string;
  title: string;
  sub: string;
  clear: string;
  empty: string;
  emptySub: string;
  recCount: (n: number) => string;
  reSearch: string;
  noRecs: string;
  today: string;
  yesterday: string;
  thisWeek: string;
  older: string;
  withLabel: string;
  budgetLabel: string;
  distanceLabel: string;
  free: string;
};

export default function HistoryView({
  history, selectedHistoryItem, onSelectHistoryItem, onClearHistory,
  favorites, onToggleFavorite, onResearch, lang = 'ja',
}: Props) {
  const insets = useSafeAreaInsets();
  const isFav = (title: string) => favorites.some((f) => f.title === title);
  const t = T[lang];

  // ── 詳細ビュー ──────────────────────────────────────────────────────────────
  if (selectedHistoryItem) {
    const item = selectedHistoryItem;
    const recCount = item.recommendations?.length ?? 0;

    return (
      <ScrollView
        style={s.root}
        contentContainerStyle={[s.detailContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 詳細ヘッダー */}
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.detailHeader, { paddingTop: insets.top + 16 }]}>
          <TouchableOpacity onPress={() => onSelectHistoryItem(null)} style={s.backBtn} activeOpacity={0.8}>
            <ChevronRight size={18} color="#fff" style={{ transform: [{ rotate: '180deg' }] }} />
            <Text style={s.backText}>{t.backToList}</Text>
          </TouchableOpacity>

          <View style={s.detailMoodBadge}>
            <Text style={s.detailMoodText}>{item.mood}</Text>
          </View>
          <Text style={s.detailArea} numberOfLines={2}>{item.area || '—'}</Text>
          <Text style={s.detailDate}>{formatFullDate(item.createdAt, lang)}</Text>
        </LinearGradient>

        {/* メタ情報 */}
        <View style={s.metaRow}>
          {item.companion ? (
            <View style={s.metaChip}>
              <Users size={13} color="#C084FC" />
              <Text style={s.metaChipText}>{item.companion}</Text>
            </View>
          ) : null}
          {(item as any).distanceFeeling ? (
            <View style={s.metaChip}>
              <Navigation size={13} color="#C084FC" />
              <Text style={s.metaChipText}>{(item as any).distanceFeeling}</Text>
            </View>
          ) : null}
          {item.budget != null && item.budget > 0 ? (
            <View style={s.metaChip}>
              <Banknote size={13} color="#C084FC" />
              <Text style={s.metaChipText}>¥{item.budget.toLocaleString()}</Text>
            </View>
          ) : null}
          {recCount > 0 && (
            <View style={[s.metaChip, s.metaChipGreen]}>
              <Text style={s.metaChipGreenText}>{t.recCount(recCount)}</Text>
            </View>
          )}
        </View>

        {/* 再検索ボタン */}
        {item.savedAnswers?.mood && onResearch && (
          <TouchableOpacity onPress={() => onResearch(item)} style={s.reSearchBtn} activeOpacity={0.8}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.reSearchGrad}>
              <RotateCcw size={16} color="#fff" />
              <Text style={s.reSearchText}>{t.reSearch}</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* おすすめスポット */}
        <View style={s.detailCards}>
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
        </View>
      </ScrollView>
    );
  }

  // ── 一覧ビュー ──────────────────────────────────────────────────────────────

  // 日付グループ化
  const grouped: Record<string, HistoryItem[]> = {};
  for (const item of history) {
    const group = getDateGroup(item.createdAt, t);
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(item);
  }
  const sortedGroups = Object.keys(grouped).sort(
    (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)
  );

  return (
    <View style={s.root}>
      {/* グラデーションヘッダー */}
      <LinearGradient
        colors={GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.heroHeader, { paddingTop: insets.top + 12 }]}
      >
        <View style={s.heroContent}>
          <View>
            <Text style={s.heroTitle}>{t.title}</Text>
            <Text style={s.heroSub}>{t.sub}</Text>
          </View>
          {history.length > 0 && (
            <TouchableOpacity onPress={onClearHistory} style={s.clearBtn} activeOpacity={0.8}>
              <Trash2 size={15} color="rgba(255,255,255,0.8)" />
              <Text style={s.clearText}>{t.clear}</Text>
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      <ScrollView
        style={s.listScroll}
        contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {history.length === 0 ? (
          <View style={s.emptyBox}>
            <LinearGradient colors={GRAD_LIGHT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.emptyIconBg}>
              <Clock size={36} color="#C084FC" strokeWidth={1.5} />
            </LinearGradient>
            <Text style={s.emptyTitle}>{t.empty}</Text>
            <Text style={s.emptySub}>{t.emptySub}</Text>
          </View>
        ) : (
          sortedGroups.map((group) => (
            <View key={group} style={s.section}>
              {/* セクションヘッダー */}
              <View style={s.sectionHeader}>
                <Text style={s.sectionLabel}>{group}</Text>
                <View style={s.sectionLine} />
              </View>

              {/* カード */}
              {grouped[group].map((item) => {
                const recCount = item.recommendations?.length ?? 0;
                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => onSelectHistoryItem(item)}
                    style={s.card}
                    activeOpacity={0.75}
                  >
                    {/* 左: グラデーションアクセントバー */}
                    <LinearGradient
                      colors={GRAD}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={s.cardAccentBar}
                    />

                    {/* カード本体 */}
                    <View style={s.cardBody}>
                      {/* 上部: ムードバッジ + 時間 + 件数 */}
                      <View style={s.cardTop}>
                        <LinearGradient
                          colors={GRAD_LIGHT}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={s.moodBadge}
                        >
                          <Text style={s.moodBadgeText}>{item.mood}</Text>
                        </LinearGradient>
                        <View style={s.cardTopRight}>
                          {recCount > 0 && (
                            <View style={s.recBadge}>
                              <Text style={s.recBadgeText}>{t.recCount(recCount)}</Text>
                            </View>
                          )}
                          <Text style={s.timeText}>{formatTime(item.createdAt, lang)}</Text>
                        </View>
                      </View>

                      {/* スポット名 */}
                      <Text style={s.spotName} numberOfLines={1}>{item.topRecommendation}</Text>

                      {/* タグ行 */}
                      <View style={s.tagRow}>
                        {item.area ? (
                          <View style={s.tagChip}>
                            <MapPin size={11} color="#9CA3AF" />
                            <Text style={s.tagText} numberOfLines={1}>{item.area}</Text>
                          </View>
                        ) : null}
                        {item.companion ? (
                          <View style={s.tagChip}>
                            <Users size={11} color="#9CA3AF" />
                            <Text style={s.tagText}>{item.companion}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    {/* 右: 矢印 */}
                    <ChevronRight size={18} color="#D1D5DB" style={s.cardArrow} />
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },

  // ── ヒーローヘッダー ──
  heroHeader: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  heroContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 3,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  clearText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },

  // ── リスト ──
  listScroll: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 20, gap: 4 },

  // ── セクション ──
  section: { marginBottom: 8 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#F3F4F6',
  },

  // ── カード ──
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#C084FC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: 'rgba(192,132,252,0.12)',
  },
  cardAccentBar: {
    width: 4,
    alignSelf: 'stretch',
  },
  cardBody: {
    flex: 1,
    padding: 14,
    gap: 7,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moodBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  moodBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#C084FC',
  },
  cardTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  recBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  recBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#10B981',
  },
  timeText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  spotName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.2,
  },
  tagRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  tagText: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  cardArrow: {
    marginRight: 12,
  },

  // ── 空状態 ──
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 72,
    gap: 14,
  },
  emptyIconBg: {
    width: 88,
    height: 88,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  emptySub: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },

  // ── 詳細ビュー ──
  detailContent: { gap: 0 },
  detailHeader: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 10,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  detailMoodBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  detailMoodText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  detailArea: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  detailDate: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '500',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(192,132,252,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(192,132,252,0.2)',
  },
  metaChipText: {
    fontSize: 12,
    color: '#6B21A8',
    fontWeight: '600',
  },
  metaChipGreen: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  metaChipGreenText: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '700',
  },
  reSearchBtn: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 2,
    borderRadius: 14,
    overflow: 'hidden',
  },
  reSearchGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  reSearchText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  detailCards: {
    paddingHorizontal: 0,
    paddingTop: 8,
  },
});
