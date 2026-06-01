import { LinearGradient } from 'expo-linear-gradient';
import {
  Clock, ChevronLeft, ChevronRight, RotateCcw, Trash2,
  MapPin, Users, Banknote, Navigation, MessageSquare, Tag,
  Sparkles, List,
} from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Alert,
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
  moodLabel: string;
  withLabel: string;
  budgetLabel: string;
  distanceLabel: string;
  areaLabel: string;
  deepDiveLabel: string;
  freeWordLabel: string;
  conditionsLabel: string;
  free: string;
  reportTitle: string;
  reportMsg: string;
  reportCancel: string;
  reportSend: string;
};

const T: Record<'ja' | 'en', TStrings> = {
  ja: {
    backToList:      '戻る',
    title:           '履歴',
    sub:             'これまで見たおすすめ',
    clear:           'クリア',
    empty:           'まだ履歴はありません',
    emptySub:        '気分から場所を探してみましょう！',
    recCount:        (n: number) => `${n}件`,
    reSearch:        '再検索',
    noRecs:          '詳細なし',
    today:           '今日',
    yesterday:       '昨日',
    thisWeek:        '今週',
    older:           'それ以前',
    moodLabel:       '気分',
    withLabel:       '誰と',
    budgetLabel:     '予算',
    distanceLabel:   '距離',
    areaLabel:       'エリア',
    deepDiveLabel:   'こだわり',
    freeWordLabel:   'キーワード',
    conditionsLabel: '今回の条件',
    free:            '無料',
    reportTitle:     '報告',
    reportMsg:       'この場所の情報に問題がありますか？',
    reportCancel:    'キャンセル',
    reportSend:      '報告する',
  },
  en: {
    backToList:      'Back',
    title:           'History',
    sub:             'Past recommendations',
    clear:           'Clear',
    empty:           'No history yet',
    emptySub:        "Let's find a place by mood!",
    recCount:        (n: number) => `${n} spots`,
    reSearch:        'Re-search',
    noRecs:          'No detail',
    today:           'Today',
    yesterday:       'Yesterday',
    thisWeek:        'This Week',
    older:           'Earlier',
    moodLabel:       'Mood',
    withLabel:       'With',
    budgetLabel:     'Budget',
    distanceLabel:   'Distance',
    areaLabel:       'Area',
    deepDiveLabel:   'Preference',
    freeWordLabel:   'Keyword',
    conditionsLabel: 'Conditions',
    free:            'Free',
    reportTitle:     'Report',
    reportMsg:       'Is there an issue with this place?',
    reportCancel:    'Cancel',
    reportSend:      'Report',
  },
};

const GROUP_ORDER = ['今日', '昨日', '今週', 'それ以前', 'Today', 'Yesterday', 'This Week', 'Earlier'];

function getDateGroup(dateStr: string | undefined, t: TStrings): string {
  if (!dateStr) return t.older;
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t.today;
  if (diffDays === 1) return t.yesterday;
  if (diffDays <= 7) return t.thisWeek;
  return t.older;
}

function formatTime(dateStr: string | undefined, lang: 'ja' | 'en'): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString(lang === 'ja' ? 'ja-JP' : 'en-US', {
    hour: '2-digit', minute: '2-digit',
  });
}

function formatFullDate(dateStr: string | undefined, lang: 'ja' | 'en'): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const datePart = d.toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });
  const timePart = d.toLocaleTimeString(lang === 'ja' ? 'ja-JP' : 'en-US', {
    hour: '2-digit', minute: '2-digit',
  });
  return `${datePart} ${timePart}`;
}

// ── 詳細ビューのサブコンポーネント ────────────────────────────────────────────
function DetailView({
  item, t, lang, isFav, onToggleFavorite, onResearch, insets, onBack,
}: {
  item: HistoryItem;
  t: TStrings;
  lang: 'ja' | 'en';
  isFav: (title: string) => boolean;
  onToggleFavorite: (rec: Recommendation) => void;
  onResearch?: (item: HistoryItem) => void;
  insets: ReturnType<typeof useSafeAreaInsets>;
  onBack: () => void;
}) {
  const recCount = item.recommendations?.length ?? 0;
  const sa = item.savedAnswers ?? {};
  const [visitedSet, setVisitedSet] = useState<Set<string>>(new Set());

  // ResultsView と同じスタイルの条件チップ
  type LIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  type CondChip = { Icon: LIcon; label: string; value: string };
  const condChips: CondChip[] = [];

  if (item.mood)                              condChips.push({ Icon: Sparkles,      label: t.moodLabel,      value: item.mood });
  if (item.companion)                         condChips.push({ Icon: Users,         label: t.withLabel,      value: item.companion });
  if (item.budget != null && item.budget > 0) condChips.push({ Icon: Banknote,      label: t.budgetLabel,    value: `〜¥${item.budget.toLocaleString()}` });
  if (sa.distanceFeeling)                     condChips.push({ Icon: Navigation,    label: t.distanceLabel,  value: sa.distanceFeeling });
  else if (sa.radiusKm)                       condChips.push({ Icon: Navigation,    label: t.distanceLabel,  value: `${sa.radiusKm}km以内` });
  if (item.area)                              condChips.push({ Icon: MapPin,        label: t.areaLabel,      value: item.area });
  if ((sa as any).deepDiveL1 && (sa as any).deepDiveL1 !== 'こだわらない') condChips.push({ Icon: Tag, label: t.deepDiveLabel, value: (sa as any).deepDiveL1 });
  if ((sa as any).deepDiveL2 && (sa as any).deepDiveL2 !== 'こだわらない') condChips.push({ Icon: Tag, label: t.deepDiveLabel, value: (sa as any).deepDiveL2 });
  if (item.freeWord)                          condChips.push({ Icon: MessageSquare, label: t.freeWordLabel,  value: item.freeWord });

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
      showsVerticalScrollIndicator={false}
    >
      {/* グラデーションヘッダー */}
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.detailHeader, { paddingTop: insets.top + 10 }]}>
        {/* 戻るボタン */}
        <TouchableOpacity onPress={onBack} style={s.backBtn} activeOpacity={0.8}>
          <ChevronLeft size={20} color="#fff" strokeWidth={2.5} />
          <Text style={s.backText}>{t.backToList}</Text>
        </TouchableOpacity>

        {/* 気分 → 大きく */}
        <Text style={s.detailMoodBig}>{item.mood}</Text>

        {/* エリア → 小さく */}
        {item.area ? (
          <View style={s.areaRow}>
            <MapPin size={13} color="rgba(255,255,255,0.75)" />
            <Text style={s.detailAreaSmall} numberOfLines={1}>{item.area}</Text>
          </View>
        ) : null}

        <Text style={s.detailDate}>{formatFullDate(item.createdAt, lang)}</Text>
      </LinearGradient>

      {/* 条件チップ一覧（ResultsView「今回の条件」と同スタイル） */}
      {condChips.length > 0 && (
        <View style={s.condSection}>
          <View style={s.condHeaderRow}>
            <List size={15} color="#374151" strokeWidth={2} />
            <Text style={s.condSectionTitle}>{t.conditionsLabel}</Text>
            {recCount > 0 && (
              <View style={s.recCountBadge}>
                <Text style={s.recCountBadgeText}>{t.recCount(recCount)}</Text>
              </View>
            )}
          </View>
          <View style={s.condChips}>
            {condChips.map((c, i) => (
              <View key={i} style={s.condChip}>
                <c.Icon size={13} color="#A78BFA" strokeWidth={2} />
                <Text style={s.condChipLabel}>{c.label}</Text>
                <Text style={s.condChipValue}>{c.value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

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
      <View style={{ paddingHorizontal: 0, paddingTop: 8 }}>
        {item.recommendations && item.recommendations.length > 0
          ? item.recommendations.map((rec, i) => (
            <PlaceCard
              key={`${rec.title}-${i}`}
              item={rec}
              isFavorited={isFav(rec.title)}
              onToggleFavorite={() => onToggleFavorite(rec)}
              lang={lang}
              isVisited={visitedSet.has(rec.title)}
              onMarkVisited={() => setVisitedSet(prev => new Set([...prev, rec.title]))}
              onReport={() =>
                Alert.alert(t.reportTitle, t.reportMsg, [
                  { text: t.reportCancel, style: 'cancel' },
                  { text: t.reportSend, style: 'destructive' },
                ])
              }
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

// ── メインコンポーネント ──────────────────────────────────────────────────────
export default function HistoryView({
  history, selectedHistoryItem, onSelectHistoryItem, onClearHistory,
  favorites, onToggleFavorite, onResearch, lang = 'ja',
}: Props) {
  const insets = useSafeAreaInsets();
  const isFav = (title: string) => favorites.some((f) => f.title === title);
  const t = T[lang];

  // ── 詳細ビュー ──
  if (selectedHistoryItem) {
    return (
      <DetailView
        item={selectedHistoryItem}
        t={t}
        lang={lang}
        isFav={isFav}
        onToggleFavorite={onToggleFavorite}
        onResearch={onResearch}
        insets={insets}
        onBack={() => onSelectHistoryItem(null)}
      />
    );
  }

  // ── 一覧ビュー ──
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
            <Text style={s.emptySubText}>{t.emptySub}</Text>
          </View>
        ) : (
          sortedGroups.map((group) => (
            <View key={group} style={s.section}>
              <View style={s.sectionHeader}>
                <Text style={s.sectionLabel}>{group}</Text>
                <View style={s.sectionLine} />
              </View>

              {grouped[group].map((item) => {
                const recCount = item.recommendations?.length ?? 0;
                return (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => onSelectHistoryItem(item)}
                    style={s.card}
                    activeOpacity={0.75}
                  >
                    <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.cardAccentBar} />
                    <View style={s.cardBody}>
                      <View style={s.cardTop}>
                        <LinearGradient colors={GRAD_LIGHT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.moodBadge}>
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
                      <Text style={s.spotName} numberOfLines={1}>{item.topRecommendation}</Text>
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
  heroHeader:  { paddingHorizontal: 20, paddingBottom: 20 },
  heroContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  heroTitle:   { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  heroSub:     { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 3 },
  clearBtn:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)' },
  clearText:   { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },

  // ── リスト ──
  listScroll:  { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 20 },

  // ── セクション ──
  section:       { marginBottom: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, marginTop: 4 },
  sectionLabel:  { fontSize: 12, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.5, textTransform: 'uppercase' },
  sectionLine:   { flex: 1, height: 1, backgroundColor: '#F3F4F6' },

  // ── カード ──
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 18, marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.12)',
  },
  cardAccentBar: { width: 4, alignSelf: 'stretch' },
  cardBody:      { flex: 1, padding: 14, gap: 7 },
  cardTop:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moodBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  moodBadgeText: { fontSize: 12, fontWeight: '700', color: '#C084FC' },
  cardTopRight:  { flexDirection: 'row', alignItems: 'center', gap: 7 },
  recBadge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0' },
  recBadgeText:  { fontSize: 11, fontWeight: '600', color: '#10B981' },
  timeText:      { fontSize: 12, color: '#9CA3AF', fontWeight: '500' },
  spotName:      { fontSize: 17, fontWeight: '700', color: '#111827', letterSpacing: -0.2 },
  tagRow:        { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tagChip:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#F3F4F6' },
  tagText:       { fontSize: 11, color: '#6B7280', fontWeight: '500' },
  cardArrow:     { marginRight: 12 },

  // ── 空状態 ──
  emptyBox:    { alignItems: 'center', paddingVertical: 72, gap: 14 },
  emptyIconBg: { width: 88, height: 88, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  emptyTitle:  { fontSize: 17, fontWeight: '700', color: '#111827' },
  emptySubText:{ fontSize: 14, color: '#9CA3AF', textAlign: 'center' },
  emptyText:   { fontSize: 14, color: '#9CA3AF', textAlign: 'center' },

  // ── 詳細ヘッダー ──
  detailHeader:   { paddingHorizontal: 20, paddingBottom: 28, gap: 8 },
  backBtn:        { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: 8, paddingVertical: 4 },
  backText:       { fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.95)' },
  detailMoodBig:  { fontSize: 38, fontWeight: '900', color: '#fff', letterSpacing: -1, lineHeight: 44 },
  areaRow:        { flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailAreaSmall:{ fontSize: 15, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  detailDate:     { fontSize: 13, color: 'rgba(255,255,255,0.65)', fontWeight: '400', marginTop: 2 },

  // ── 条件セクション（ResultsView「今回の条件」準拠） ──
  condSection:      { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  condHeaderRow:    { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  condSectionTitle: { fontSize: 13, fontWeight: '700', color: '#374151', flex: 1 },
  recCountBadge:    { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0' },
  recCountBadgeText:{ fontSize: 11, fontWeight: '600', color: '#10B981' },
  condChips:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  condChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FAF8FF', borderRadius: 10,
    paddingHorizontal: 9, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.2)',
  },
  condChipLabel: { fontSize: 10, fontWeight: '600', color: '#A78BFA' },
  condChipValue: { fontSize: 12, fontWeight: '700', color: '#1E0753' },

  // ── 再検索ボタン ──
  reSearchBtn:  { marginHorizontal: 16, marginTop: 14, marginBottom: 2, borderRadius: 14, overflow: 'hidden' },
  reSearchGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  reSearchText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
