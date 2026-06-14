import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import {
  Clock, ChevronLeft, ChevronRight, Trash2,
  MapPin, Users, Banknote, Navigation, MessageSquare, Tag,
  Sparkles, List,
  Coffee, Music, Leaf, Plane, BookOpen, Zap, Droplets, Car,
  Laugh, Mountain, Wind,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PuniPressable from './PuniPressable';
import type { HistoryItem, FavoriteItem, Recommendation } from '@/types/app';
import PlaceCard from './PlaceCard';
import ReportModal from './ReportModal';
import { copyPlaceName } from '@/lib/clipboard';

const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];

// ── 気分ごとの画像マッピング ────────────────────────────────────────────────
// 画像ファイルを assets/moods/ に置いたら require() に変更してください
// 例: まったり.png → require('@/assets/moods/mattari.png')
type LIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

const MOOD_ICON_MAP: Record<string, LIcon> = {
  'まったり':    Coffee,
  'わいわい':    Laugh,
  'ドライブ':    Car,
  '自然':        Leaf,
  '旅行':        Plane,
  '集中':        BookOpen,
  '運動':        Zap,
  '時間潰し':    Clock,
  '温泉':        Droplets,
  '景色':        Mountain,
  'カフェ':      Coffee,
  'アウトドア':  Wind,
  '音楽':        Music,
};

// 画像ファイルが届いたらここに追加してください
// 例: const MOOD_IMAGE_MAP: Record<string, ReturnType<typeof require>> = {
//   'まったり': require('@/assets/moods/mattari.png'),
// };
const MOOD_IMAGE_MAP: Record<string, ReturnType<typeof require>> = {};

function MoodVisual({ mood, size = 36 }: { mood: string; size?: number }) {
  const imgSrc = MOOD_IMAGE_MAP[mood];
  if (imgSrc) {
    return (
      <Image
        source={imgSrc}
        style={{ width: size, height: size }}
        contentFit="contain"
      />
    );
  }
  const IconComp: LIcon = MOOD_ICON_MAP[mood] ?? Sparkles;
  return <IconComp size={size} color="#fff" strokeWidth={1.8} />;
}
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
  onToggleFavorite?: (rec: Recommendation) => void;
  onResearch?: (item: HistoryItem) => void;
  onPressDetail?: (rec: Recommendation) => void;
  lang?: 'ja' | 'en';
  resetKey?: number;
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
  item, t, lang, isFav, favorites, onToggleFavorite, onResearch, insets, onBack, onPressDetail,
}: {
  item: HistoryItem;
  t: TStrings;
  lang: 'ja' | 'en';
  isFav: (title: string) => boolean;
  favorites: FavoriteItem[];
  onToggleFavorite?: (rec: Recommendation) => void;
  onResearch?: (item: HistoryItem) => void;
  onPressDetail?: (rec: Recommendation) => void;
  insets: ReturnType<typeof useSafeAreaInsets>;
  onBack: () => void;
}) {
  const recCount = item.recommendations?.length ?? 0;
  const sa = item.savedAnswers ?? {};
  const [visitedSet, setVisitedSet] = useState<Set<string>>(new Set());
  const [reportRec, setReportRec] = useState<Recommendation | null>(null);

  // 画面のどこからでも右スワイプで前のページ（履歴一覧）に戻る。
  // iOSネイティブ同様、指に追従して画面がスライドし、1/3超 or 軽いフリックで確定。
  // runOnJS(true) によりコールバックはJSスレッドで実行（worklet/babelプラグイン不要）。
  const SCREEN_W = Dimensions.get('window').width;
  const panX = useRef(new Animated.Value(0)).current;
  const swipeBack = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX(12)          // 横12pxでアクティブ化（軽め＝ネイティブ同等）
        .failOffsetY([-14, 14])     // 縦14px先行ならスクロール優先で失敗
        .onUpdate((e) => {
          // 指に追従（右方向のみ）。少し重みを付けて自然に
          panX.setValue(e.translationX > 0 ? e.translationX : 0);
        })
        .onEnd((e) => {
          const go = e.translationX > SCREEN_W * 0.32 || (e.translationX > 24 && e.velocityX > 300);
          if (go) {
            // panXはSWのまま閉じる（先に0へ戻すと詳細が一瞬全画面に戻って見える＝チラつきの原因）。
            // 詳細はonBackでアンマウントされ、panXはこのコンポーネント内のrefなので残っても影響なし。
            Animated.timing(panX, { toValue: SCREEN_W, duration: 160, useNativeDriver: true })
              .start(() => { onBack(); });
          } else {
            Animated.spring(panX, { toValue: 0, useNativeDriver: true, mass: 0.7, damping: 18, stiffness: 240 }).start();
          }
        }),
    [onBack, SCREEN_W],
  );

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
    <GestureDetector gesture={swipeBack}>
    <Animated.View style={{ flex: 1, backgroundColor: '#F3F1EF', transform: [{ translateX: panX }] }}>
    <ScrollView
      style={s.root}
      contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
      showsVerticalScrollIndicator={false}
    >
      {/* グラデーションヘッダー */}
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.detailHeader, { paddingTop: insets.top + 10 }]}>
        {/* 装飾サークル */}
        <View style={s.decoCircle1} pointerEvents="none" />
        <View style={s.decoCircle2} pointerEvents="none" />

        {/* 戻るボタン */}
        <TouchableOpacity onPress={onBack} style={s.backBtn} activeOpacity={0.8}>
          <ChevronLeft size={20} color="#fff" strokeWidth={2.5} />
          <Text style={s.backText}>{t.backToList}</Text>
        </TouchableOpacity>

        {/* 気分アイコン + テキスト */}
        <View style={s.moodTitleRow}>
          <View style={s.moodVisualBg}>
            <MoodVisual mood={item.mood} size={30} />
          </View>
          <Text style={s.detailMoodBig}>{item.mood}</Text>
        </View>

        {/* 今回の条件チップ（ヘッダー内・白半透明スタイル） */}
        {condChips.length > 0 && (
          <View style={s.headerCondSection}>
            <View style={s.headerCondHeaderRow}>
              <List size={13} color="rgba(255,255,255,0.8)" strokeWidth={2} />
              <Text style={s.headerCondTitle}>{t.conditionsLabel}</Text>
              {recCount > 0 && (
                <View style={s.headerRecBadge}>
                  <Text style={s.headerRecBadgeText}>{t.recCount(recCount)}</Text>
                </View>
              )}
            </View>
            <View style={s.headerCondChips}>
              {condChips.map((c, i) => (
                <View key={i} style={s.headerCondChip}>
                  <c.Icon size={12} color="rgba(255,255,255,0.8)" strokeWidth={2} />
                  <Text style={s.headerCondChipLabel}>{c.label}</Text>
                  <Text style={s.headerCondChipValue}>{c.value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* エリア + 日時 */}
        <View style={s.headerFooterRow}>
          {item.area ? (
            <View style={s.areaRow}>
              <MapPin size={12} color="rgba(255,255,255,0.75)" />
              <Text style={s.detailAreaSmall} numberOfLines={1}>{item.area}</Text>
            </View>
          ) : null}
          <Text style={s.detailDate}>{formatFullDate(item.createdAt, lang)}</Text>
        </View>
      </LinearGradient>

      {/* スポット一覧 */}
      <View style={{ paddingTop: 8 }}>
        {item.recommendations && item.recommendations.length > 0
          ? item.recommendations.map((rec, i) => {
            // 心霊判定はスポットのタグで（保存データに deepDiveL1 が無くても確実に拾える）
            const recShinrei = (sa as { deepDiveL1?: string }).deepDiveL1 === '心霊'
              || !!rec.tags?.includes('#心霊スポット');
            return (
            <PlaceCard
              key={`${rec.title}-${i}`}
              // 心霊は保存済みのGoogle写真を使わず、利用者投稿/プレースホルダーにする
              item={recShinrei ? { ...rec, photoUrl: undefined, photoUrls: undefined } : rec}
              isFavorited={(favorites ?? []).some((f) => f.title === rec.title)}
              onToggleFavorite={() => onToggleFavorite?.(rec)}
              lang={lang}
              isVisited={visitedSet.has(rec.title)}
              onMarkVisited={() => setVisitedSet(prev => new Set([...prev, rec.title]))}
              onReport={() => setReportRec(rec)}
              onPressDetail={onPressDetail
                ? () => onPressDetail(recShinrei
                    ? { ...rec, photoUrl: undefined, photoUrls: undefined, tags: [...(rec.tags ?? []), ...(rec.tags?.includes('#心霊スポット') ? [] : ['#心霊スポット'])] }
                    : rec)
                : undefined}
              spooky={recShinrei}
            />
            );
          })
          : (
            <View style={s.emptyBox}>
              <Text style={s.emptyText}>{t.noRecs}</Text>
            </View>
          )
        }
      </View>
    </ScrollView>
    <ReportModal
      visible={!!reportRec}
      spotName={reportRec?.title ?? ''}
      spotAddress={reportRec?.address ?? ''}
      suggestionId={reportRec?.supabaseId}
      onClose={() => setReportRec(null)}
    />
    </Animated.View>
    </GestureDetector>
  );
}

// ── メインコンポーネント ──────────────────────────────────────────────────────
export default function HistoryView({
  history, selectedHistoryItem, onSelectHistoryItem, onClearHistory,
  favorites, onToggleFavorite, onResearch, onPressDetail, lang = 'ja', resetKey,
}: Props) {
  const insets = useSafeAreaInsets();
  const isFav = (title: string) => favorites.some((f) => f.title === title);
  const t = T[lang];
  const scrollRef = useRef<ScrollView>(null);

  // resetKey が変わったら詳細を閉じてリストトップへ
  useEffect(() => {
    if (resetKey === undefined) return;
    onSelectHistoryItem(null);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [resetKey]);

  // ── 詳細ビュー ──
  if (selectedHistoryItem) {
    return (
      <DetailView
        item={selectedHistoryItem}
        t={t}
        lang={lang}
        isFav={isFav}
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
        onResearch={onResearch}
        onPressDetail={onPressDetail}
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
            <PuniPressable onPress={onClearHistory} style={s.clearBtn}>
              <Trash2 size={15} color="rgba(255,255,255,0.8)" />
              <Text style={s.clearText}>{t.clear}</Text>
            </PuniPressable>
          )}
        </View>
      </LinearGradient>

      <ScrollView
        ref={scrollRef}
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
                      <Text style={s.spotName} numberOfLines={1} onLongPress={() => copyPlaceName(item.topRecommendation)} suppressHighlighting>{item.topRecommendation}</Text>
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
  detailHeader: {
    paddingHorizontal: 20, paddingBottom: 24,
    gap: 12, overflow: 'hidden',
  },
  // 装飾サークル
  decoCircle1: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.08)',
    top: -60, right: -40,
  },
  decoCircle2: {
    position: 'absolute', width: 120, height: 120, borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.06)',
    bottom: -30, left: -20,
  },
  backBtn:        { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: 4 },
  backText:       { fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.95)' },
  moodTitleRow:   { flexDirection: 'row', alignItems: 'center', gap: 14 },
  moodVisualBg: {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  detailMoodBig:  { fontSize: 36, fontWeight: '900', color: '#fff', letterSpacing: -1, lineHeight: 44 },
  headerFooterRow: { gap: 3 },
  areaRow:        { flexDirection: 'row', alignItems: 'center', gap: 5 },
  detailAreaSmall:{ fontSize: 14, color: 'rgba(255,255,255,0.85)', fontWeight: '500' },
  detailDate:     { fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: '400' },

  // ── ヘッダー内「今回の条件」 ──
  headerCondSection:    { gap: 8 },
  headerCondHeaderRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerCondTitle:      { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)', flex: 1 },
  headerRecBadge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(16,185,129,0.35)' },
  headerRecBadgeText:   { fontSize: 11, fontWeight: '700', color: '#fff' },
  headerCondChips:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  headerCondChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  headerCondChipLabel:  { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  headerCondChipValue:  { fontSize: 12, fontWeight: '700', color: '#fff' },

  // ── 再検索ボタン ──
  reSearchBtn:  { marginHorizontal: 16, marginTop: 14, marginBottom: 2, borderRadius: 14, overflow: 'hidden' },
  reSearchGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  reSearchText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
