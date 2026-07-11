// ── BlogView ─────────────────────────────────────────────────────────────────
// 「全国みんなの穴場」ページ本体: グラデヘッダー＋検索/絞り込みチップ＋統一フィード(CommunityFeed)。
// 投稿は post.tsx(spot_posts・即時公開)。旧blog_posts系の一覧/投稿フォームは撤去済みで、
// 過去のブログ投稿の閲覧だけ DetailView(export・app/blog-post.tsx から利用)が残る。
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Linking,
  type NativeScrollEvent, type NativeSyntheticEvent,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Bell, Bookmark, ChevronLeft, Clock3, Flag, Flame, Heart, MapPin, MessageCircle, Navigation, Search, Sparkles, UserRound, Users, Wallet, X } from 'lucide-react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { GlassView } from 'expo-glass-effect';
import { LIQUID_GLASS } from './GlassSurface';
import PuniPressable from './PuniPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants/colors';
import { HERO_BAND_H } from '@/lib/headerBand';
import { useCollapsibleHeader } from '@/lib/useCollapsibleHeader';
import { apiFetch } from '@/lib/api';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useMyIdentity } from '@/lib/myIdentity';
import { getDeviceId } from '@/lib/abtest';
import { openInGoogleMaps } from '@/lib/openMaps';
import { useSettings } from '@/lib/settingsStore';
import { hasUnread } from '@/lib/notifications';
import { categoryStyle } from './community/postTypes';
import CommunityFeed from './CommunityFeed';

const SCREEN_W = Dimensions.get('window').width;
const GAP = 8;       // カード間の余白（丸みカード感）
const PAD_H = 12;    // 画面端からの余白
const COL = 3;
const CELL = Math.floor((SCREEN_W - PAD_H * 2 - GAP * (COL - 1)) / COL);

// 投稿詳細を「全国みんなの穴場」詳細(community-spot)と同じ配色に
const CS_PINK = '#F56CB3';
const CS_PURPLE = '#9B6BFF';
const CS_BLUE = '#4FA3FF';
const CS_GRAD: [string, string, string] = [CS_PINK, CS_PURPLE, CS_BLUE];

const MOODS: { label: string; tag: string }[] = [
  { label: '自然', tag: '#自然感じたい' }, { label: 'まったり', tag: '#まったりしたい' },
  { label: 'わいわい', tag: '#わいわい楽しみたい' }, { label: 'お腹すいた', tag: '#お腹すいた' },
  { label: 'ドライブ', tag: '#ドライブしたい' }, { label: '集中', tag: '#集中したい' },
  { label: '運動', tag: '#体動かしたい' }, { label: '旅行', tag: '#遠くに行きたい' },
  { label: '買い物', tag: '#ショッピング' }, { label: 'スリル', tag: '#スリル味わいたい' },
];

const T = {
  ja: {
    heroTitle: '全国みんなの穴場',
    heroSub: '気分でめぐる、みんなのおすすめスポット',
    popular: '人気',
    near: '近く',
    newest: '新着',
    fetching: '取得中…',
    searchPlaceholder: 'スポット・気分・@IDで検索',
    scopeAll: 'すべて',
    scopeFollowing: 'フォロー中',
    notifA11y: '通知',
    myPageA11y: 'マイページ',
    post: '＋ 投稿',
    map: '地図',
    whatPlace: 'どんな場所？',
    likesCount: (n: string) => `${n}件の「参考になった」`,
    budgetLabel: '予算感',
    companionLabel: 'おすすめの相手',
    seeThisPlace: 'この場所を見る',
    reportThis: 'この投稿を通報',
    reported: '通報しました',
    reportTitle: 'この投稿を通報しますか？',
    reportMsg: '不適切な内容として運営に報告します。',
    cancel: 'キャンセル',
    doReport: '通報する',
    recommendedBy: (name: string) => `${name}さんのおすすめ`,
    moodLabels: {
      '#自然感じたい': '自然', '#まったりしたい': 'まったり', '#わいわい楽しみたい': 'わいわい',
      '#お腹すいた': 'お腹すいた', '#ドライブしたい': 'ドライブ', '#集中したい': '集中',
      '#体動かしたい': '運動', '#遠くに行きたい': '旅行', '#ショッピング': '買い物', '#スリル味わいたい': 'スリル',
    } as Record<string, string>,
    defaultPoster: 'MoodGoユーザー',
  },
  en: {
    heroTitle: 'Hidden gems nationwide',
    heroSub: "Explore everyone's favorite spots by mood",
    popular: 'Popular',
    near: 'Nearby',
    newest: 'Newest',
    fetching: 'Locating…',
    searchPlaceholder: 'Search spots, moods, @ID',
    scopeAll: 'All',
    scopeFollowing: 'Following',
    notifA11y: 'Notifications',
    myPageA11y: 'My page',
    post: '＋ Post',
    map: 'Map',
    whatPlace: "What's it like?",
    likesCount: (n: string) => `${n} found this helpful`,
    budgetLabel: 'Budget',
    companionLabel: 'Great with',
    seeThisPlace: 'View this place',
    reportThis: 'Report this post',
    reported: 'Reported',
    reportTitle: 'Report this post?',
    reportMsg: "We'll report it to our team as inappropriate.",
    cancel: 'Cancel',
    doReport: 'Report',
    recommendedBy: (name: string) => `Recommended by ${name}`,
    moodLabels: {
      '#自然感じたい': 'Nature', '#まったりしたい': 'Relax', '#わいわい楽しみたい': 'Lively',
      '#お腹すいた': 'Hungry', '#ドライブしたい': 'Drive', '#集中したい': 'Focus',
      '#体動かしたい': 'Exercise', '#遠くに行きたい': 'Travel', '#ショッピング': 'Shopping', '#スリル味わいたい': 'Thrill',
    } as Record<string, string>,
    defaultPoster: 'MoodGo user',
  },
} as const;

function formatNum(n: number, lang: 'ja' | 'en' = 'ja'): string {
  if (!n || n < 0) return '0';
  if (lang === 'en') {
    if (n >= 1_000_000) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  if (n >= 10000) { const m = n / 10000; return (m >= 10 ? Math.round(m).toString() : m.toFixed(1).replace(/\.0$/, '')) + '万'; }
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + '千';
  return String(n);
}

export type Detail = {
  id: string; title: string; caption: string | null; body: string | null; place_name: string | null;
  address: string | null; mood_tags: string[] | null; scene_tags: string[] | null; companion_tags: string[] | null;
  budget_level: string | null; google_maps_url: string | null; poster_name: string | null;
  poster_handle?: string | null;   // @ユーザーID（未設定はnull）
  poster_type?: string | null;     // account_type（認証/店舗バッジ）
  helpful_count: number; photos: string[]; isOwn?: boolean; saved?: boolean; helped?: boolean;
};

export default function BlogView({ resetKey }: { resetKey?: number }) {
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const { lang } = settings;
  const t = T[lang];
  const scrollRef = useRef<ScrollView>(null);   // 再タップで先頭へ戻す用
  // ── ヘッダー内コントロール（人気/近く・@ID検索）: 見栄え改善でグラデ帯へ移設 ──
  // 人気/近くは「トグル」: 選択中をもう一度押すと解除され新着順(new)に戻る
  const [sortMode, setSortMode] = useState<'popular' | 'near' | 'new'>('popular');
  // すべて / フォロー中 の切替（フォロー中=自分がフォローした投稿者の公開投稿のみ）
  const [feedScope, setFeedScope] = useState<'all' | 'following'>('all');
  // 気分チップの絞り込み（''=なし。タグはMOODSのtag）
  const [moodTag, setMoodTag] = useState('');
  // ベルの未読ドット（通知画面を開くと消える・profileタブと同じ方式）
  const [notifUnread, setNotifUnread] = useState(false);
  // フォーカス毎に未読を再チェック（通知画面を開いて戻ったらドットが消える・profileと同方式）
  useFocusEffect(useCallback(() => { hasUnread().then(setNotifUnread).catch(() => {}); }, []));
  // 無限スクロール: 末尾接近でキーを増やして CommunityFeed に次ページ取得を促す
  const [loadMoreKey, setLoadMoreKey] = useState(0);
  const nearEndRef = useRef(false);
  const onFeedScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - 600;
    if (near && !nearEndRef.current) { nearEndRef.current = true; setLoadMoreKey((k) => k + 1); }
    else if (!near && nearEndRef.current) { nearEndRef.current = false; }
  };
  // 下スクロールでグラデ帯を格納・上スクロールで再表示（ヘッダーはoverlay化しリストはpaddingTopで逃がす）
  const collapse = useCollapsibleHeader({ initialHeight: insets.top + HERO_BAND_H + 47, listener: onFeedScroll });
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [uq, setUq] = useState('');
  const [uUsers, setUUsers] = useState<Array<{ handle: string; posterId: string; icon: string }>>([]);
  const [uActive, setUActive] = useState<{ handle: string } | null>(null);
  const uTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 近く順: 端末の現在地を遅延取得（近くタップ時のみ）
  const selectNear = async () => {
    if (coords) { setSortMode('near'); return; }
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSortMode('near');
      }
    } catch { /* 位置取得失敗時は人気順のまま */ } finally { setLocLoading(false); }
  };

  // 検索（400msデバウンス）: 「@〜」=ユーザーID検索 / それ以外=スポット名・本文のキーワード検索
  const [kw, setKw] = useState('');
  const onChangeUq = (raw: string) => {
    setUq(raw);
    if (uActive) setUActive(null);
    if (uTimer.current) clearTimeout(uTimer.current);
    const trimmed = raw.trim();
    const isAt = trimmed.startsWith('@');
    const qn = trimmed.toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    uTimer.current = setTimeout(async () => {
      // キーワード検索（@始まりは投稿検索しない）
      setKw(isAt ? '' : trimmed);
      // ユーザー候補（英数2文字以上の時だけ）
      if (qn.length >= 2) {
        try {
          const res = await apiFetch('/api/user-handle', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'search', query: qn }),
          });
          const d = await res.json();
          setUUsers(Array.isArray(d?.users) ? d.users : []);
        } catch { /* noop */ }
      } else {
        setUUsers([]);
      }
    }, 400);
  };
  const selectUser = (u: { handle: string }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUActive({ handle: u.handle });
    setUUsers([]);
    setKw('');
    setUq(`@${u.handle}`);
  };
  const clearUser = () => { setUActive(null); setUq(''); setUUsers([]); setKw(''); };

  // 下部バー再タップ: 気分・キーワード絞り込みを解除して振り出しの一覧へ
  useEffect(() => {
    if (resetKey === undefined) return;
    setSortMode('popular'); setFeedScope('all'); setMoodTag(''); clearUser();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [resetKey]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── 統一フィード（穴場＋moodログ）──
  //   旧blog_posts系の一覧取得/詳細/投稿フォームはここから撤去済み（作成導線が無い遺構。
  //   過去のブログ投稿の閲覧は my-posts/profile → app/blog-post.tsx(DetailView) が担う）
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* グラデ帯ヘッダー（タブ見出し）: 下スクロールで上に格納・上スクロールで復帰 */}
      <Animated.View
        style={[s.heroOverlay, { transform: [{ translateY: collapse.translateY }] }]}
        onLayout={(e) => {
          // 候補ユーザーチップで帯が一時的に伸びた高さは基準にしない
          if (uUsers.length === 0 || collapse.headerH === 0) collapse.onHeaderLayout(e);
        }}
      >
      <LinearGradient colors={['#F472B6', '#C084FC', '#60A5FA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.hero, { paddingTop: insets.top + 12, minHeight: insets.top + HERO_BAND_H }]}>
        <View style={s.heroDeco1} pointerEvents="none" />
        <View style={s.heroDeco2} pointerEvents="none" />
        {/* タイトル行: 左=タイトル＋キラキラ / 右=通知ベル・マイページ（Instagram発見タブ風の顔）*/}
        <View style={s.heroTopRow}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <View style={s.heroTitleRow}>
              <Text style={s.heroTitle}>{t.heroTitle}</Text>
              <Sparkles size={17} color="rgba(255,255,255,0.92)" strokeWidth={2.2} />
            </View>
            <Text style={s.heroSub}>{t.heroSub}</Text>
          </View>
          <View style={s.heroIconRow}>
            <TouchableOpacity
              style={s.heroIconBtn}
              onPress={() => { setNotifUnread(false); router.push('/notifications'); }}
              activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t.notifA11y}>
              <Bell size={16.5} color="#fff" strokeWidth={2.2} />
              {notifUnread && <View style={s.heroNotifDot} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={s.heroIconBtn}
              onPress={() => router.navigate('/profile')}
              activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={t.myPageA11y}>
              {settings.iconUrl
                ? <Image source={{ uri: settings.iconUrl }} style={s.heroAvatar} contentFit="cover" />
                : <UserRound size={16.5} color="#fff" strokeWidth={2.2} />}
            </TouchableOpacity>
          </View>
        </View>
        {/* @ID検索バー（帯の中・白ボックス）*/}
        <View style={s.heroSearchBox}>
          <Search size={15} color="#8B88A6" strokeWidth={2.2} />
          <TextInput
            value={uq}
            onChangeText={onChangeUq}
            placeholder={t.searchPlaceholder}
            placeholderTextColor="#B9B6CC"
            style={s.heroSearchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {(uq.length > 0 || uActive) && (
            <TouchableOpacity onPress={clearUser} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={15} color="#8B88A6" strokeWidth={2.4} />
            </TouchableOpacity>
          )}
        </View>
        {/* フィルターチップ（1行横スクロール）: 並び順（人気/近く/新着/フォロー中）＋ 気分で絞る */}
        {(() => {
          const isFollowing = feedScope === 'following';
          const isPopular = !isFollowing && sortMode === 'popular';
          const isNear = !isFollowing && sortMode === 'near';
          const isNew = !isFollowing && sortMode === 'new';
          const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const primary: Array<{ key: string; label: string; Icon: typeof Flame; color: string; on: boolean; press: () => void }> = [
            { key: 'popular', label: t.popular, Icon: Flame, color: '#E0559B', on: isPopular, press: () => { tap(); setFeedScope('all'); setSortMode('popular'); } },
            { key: 'near', label: locLoading ? t.fetching : t.near, Icon: Navigation, color: '#4FA3FF', on: isNear, press: () => { tap(); setFeedScope('all'); if (sortMode !== 'near') selectNear(); } },
            { key: 'new', label: t.newest, Icon: Clock3, color: '#9B6BFF', on: isNew, press: () => { tap(); setFeedScope('all'); setSortMode('new'); } },
            { key: 'following', label: t.scopeFollowing, Icon: Users, color: '#7A5CFF', on: isFollowing, press: () => { tap(); setFeedScope('following'); } },
          ];
          return (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.fChipRow} keyboardShouldPersistTaps="handled">
              {primary.map(({ key, label, Icon, color, on, press }) => (
                <TouchableOpacity key={key} onPress={press} style={[s.fChip, on && s.fChipOn]} activeOpacity={0.8}
                  accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Icon size={12} color={on ? color : 'rgba(255,255,255,0.92)'} strokeWidth={2.4} />
                  <Text style={[s.fChipText, on && s.fChipTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
              <View style={s.fDivider} />
              {/* 気分チップ: MoodGoらしい「気分で探す」軸（もう一度押すと解除）*/}
              {MOODS.map(({ tag }) => {
                const { Icon, color } = categoryStyle([tag]);
                const on = moodTag === tag;
                return (
                  <TouchableOpacity key={tag} onPress={() => { tap(); setMoodTag(on ? '' : tag); }}
                    style={[s.fChip, on && s.fChipOn]} activeOpacity={0.8}
                    accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <Icon size={12} color={on ? color : 'rgba(255,255,255,0.92)'} strokeWidth={2.4} />
                    <Text style={[s.fChipText, on && s.fChipTextOn]}>{t.moodLabels[tag] ?? tag.replace(/^#/, '')}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          );
        })()}

        {/* 候補ユーザーのチップ（入力中のみ・帯が下に伸びる）*/}
        {uUsers.length > 0 && !uActive && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.heroChipRow} keyboardShouldPersistTaps="handled">
            {uUsers.map((u) => (
              <TouchableOpacity key={u.handle} onPress={() => selectUser(u)} style={s.heroChip} activeOpacity={0.8}>
                <Image source={{ uri: u.icon }} style={s.heroChipIcon} contentFit="cover" />
                <Text style={s.heroChipText}>@{u.handle}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </LinearGradient>
      </Animated.View>
      {/* 背景はタブ側の AppBackground(ホームと同じM透かし)を透過で見せる */}
      <Animated.ScrollView ref={scrollRef} contentContainerStyle={{ paddingHorizontal: 8, paddingTop: collapse.headerH + 14, paddingBottom: 130 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" onScroll={collapse.onScroll} scrollEventThrottle={16}>
        <CommunityFeed full sortMode={sortMode} coords={coords} posterHandle={uActive?.handle ?? null} searchQuery={uActive ? null : (kw || null)} feedScope={feedScope} loadMoreKey={loadMoreKey} moodTag={moodTag || null} refreshKey={resetKey} />
      </Animated.ScrollView>
      {/* ＋投稿（現状はブログ投稿フォーム。将来1つの投稿フローに統合予定）*/}
      <PuniPressable onPress={() => router.push('/post')} containerStyle={s.fab}>
        {/* ヘッダー帯と同じブランド3色グラデでアプリ全体の色に統一（旧ローズ→オレンジを廃止）*/}
        <LinearGradient colors={['#F472B6', '#C084FC', '#60A5FA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fabInner}>
          {LIQUID_GLASS && (
            <GlassView glassEffectStyle="clear" isInteractive style={[StyleSheet.absoluteFill, { borderRadius: 30 }]} />
          )}
          <Text style={s.fabText}>{t.post}</Text>
        </LinearGradient>
      </PuniPressable>
    </View>
  );
}

// ── 詳細 ──
export function DetailView({ post, onBack, onSearchMood }: { post: Detail; onBack: () => void; onSearchMood: (tag: string) => void }) {
  const insets = useSafeAreaInsets();
  const { lang } = useSettings();
  const t = T[lang];
  const me = useMyIdentity();
  const isMe = !!post.isOwn;   // 自分の投稿なら投稿者表示を現在プロフィールで上書き（全画面統一）
  const [reported, setReported] = useState(false);
  const [helped, setHelped] = useState(!!post.helped);   // サーバーの自分の反応状態で初期化（開き直しても保持）
  const react = async (rtype: 'helpful' | 'save', undo = false): Promise<boolean> => {
    try { const did = await getDeviceId();
      const d = await apiFetch('/api/blog-posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'react', postId: post.id, deviceId: did, rtype, undo }) }).then((r) => r.json());
      return d?.ok !== false;   // 成否を返し、呼び出し側が失敗時にロールバック
    } catch { return false; }
  };
  const report = async () => {
    try { const did = await getDeviceId();
      const d = await apiFetch('/api/blog-posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'report', postId: post.id, deviceId: did, reason: '不適切' }) }).then((r) => r.json());
      if (d?.ok) setReported(true);   // 成功時のみ「通報済み」にする（偽の成功を防ぐ）
    } catch { /* 失敗時は据え置き＝再試行可能 */ }
  };
  const [saved, setSaved] = useState(!!post.saved);   // サーバーの自分の保存状態で初期化
  const [page, setPage] = useState(0);
  const tags = [...(post.mood_tags ?? []), ...(post.scene_tags ?? [])];
  const photos = post.photos ?? [];
  const name = (isMe && me.name) || post.poster_name || t.defaultPoster;
  const posterHandle = (isMe && me.handle) || post.poster_handle || null;
  const posterBadge = isMe ? (me.accountType || post.poster_type) : post.poster_type;
  const initial = (name.trim().charAt(0) || 'M').toUpperCase();
  const likeCount = (post.helpful_count ?? 0) + (helped ? 1 : 0);
  const openMap = () => openInGoogleMaps({ query: [post.place_name, post.address].filter(Boolean).join(' '), mapsUri: post.google_maps_url ?? undefined });
  return (
    <View style={{ flex: 1, backgroundColor: '#F3F1F7' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        {/* ── 写真カルーセル（穴場詳細と同じ構成）── */}
        <View style={s.csPhotoWrap}>
          {photos.length > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} decelerationRate="fast"
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}>
              {photos.map((u, i) => <Image key={i} source={{ uri: u }} style={{ width: SCREEN_W, height: 340 }} contentFit="cover" transition={250} />)}
            </ScrollView>
          ) : (
            <LinearGradient colors={['#E8E0FF', '#D6EAF8']} style={{ width: '100%', height: 340, alignItems: 'center', justifyContent: 'center' }}>
              <MapPin size={44} color={CS_PURPLE} strokeWidth={1.5} />
            </LinearGradient>
          )}
          <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent']} style={s.csTopScrim} pointerEvents="none" />
          <TouchableOpacity onPress={onBack} style={[s.csCircleBtn, { top: insets.top + 6, left: 14 }]} activeOpacity={0.85}>
            <ChevronLeft size={22} color="#1A0A2E" strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { const next = !saved; setSaved(next); react('save', !next).then((ok) => { if (!ok) setSaved(!next); }); }} style={[s.csCircleBtn, { top: insets.top + 6, right: 14 }]} activeOpacity={0.85}>
            <Bookmark size={18} color={saved ? CS_PINK : '#1A0A2E'} fill={saved ? CS_PINK : 'transparent'} strokeWidth={2.4} />
          </TouchableOpacity>
          {photos.length > 0 ? <View style={s.csCounter}><Text style={s.csCounterText}>{page + 1} / {photos.length}</Text></View> : null}
          {photos.length > 1 ? (
            <View style={s.csDots}>{photos.slice(0, 10).map((_, i) => <View key={i} style={[s.csDot, i === page && s.csDotOn]} />)}</View>
          ) : null}
        </View>

        {/* ── 本文 ── */}
        <View style={s.csBody}>
          {/* 投稿者 */}
          <View style={s.csPosterRow}>
            <LinearGradient colors={[COLORS.gradStart, COLORS.gradEnd]} style={s.csPosterAvatar}><Text style={s.csPosterAvatarText}>{initial}</Text></LinearGradient>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={[s.csPosterName, { flexShrink: 1 }]} numberOfLines={1}>{t.recommendedBy(name)}</Text>
                <VerifiedBadge type={posterBadge} size={14} />
              </View>
              {posterHandle ? <Text style={s.csPosterHandle} numberOfLines={1}>@{posterHandle}</Text> : null}
            </View>
          </View>

          {/* タイトル + マップピル */}
          <View style={s.csTitleRow}>
            <Text style={s.csTitle}>{post.title}</Text>
            {(post.place_name || post.google_maps_url) ? (
              <TouchableOpacity onPress={openMap} activeOpacity={0.85}>
                <LinearGradient colors={CS_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.csMapPill}>
                  <MapPin size={15} color="#fff" strokeWidth={2.5} />
                  <Text style={s.csMapPillText}>{t.map}</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : null}
          </View>
          {post.place_name ? <Text style={s.csPlaceName}>{post.place_name}</Text> : null}

          {/* エリアチップ */}
          {post.address ? (
            <View style={s.csAreaChip}>
              <MapPin size={13} color={CS_PURPLE} strokeWidth={2.2} />
              <Text style={s.csAreaChipText} numberOfLines={1} ellipsizeMode="tail">{post.address}</Text>
            </View>
          ) : null}

          {/* 参考になった数 */}
          {likeCount > 0 ? (
            <View style={s.csLikesRow}>
              <Heart size={13} color={CS_PINK} fill={CS_PINK} strokeWidth={0} />
              <Text style={s.csLikesText}>{t.likesCount(formatNum(likeCount, lang))}</Text>
            </View>
          ) : null}

          {/* コメントカード（大目玉）*/}
          {(post.caption || post.body) ? (
            <View style={s.csCommentCard}>
              <View style={s.csCommentLabelRow}>
                <MessageCircle size={14} color={CS_PURPLE} fill={CS_PURPLE} strokeWidth={0} />
                <Text style={s.csCommentLabel}>{t.whatPlace}</Text>
              </View>
              {post.caption ? <Text style={s.csCommentText}>{post.caption}</Text> : null}
              {post.body ? <Text style={[s.csCommentText, post.caption ? { marginTop: 8 } : null]}>{post.body}</Text> : null}
            </View>
          ) : null}

          {/* タグ（タップで気分検索）*/}
          {tags.length > 0 ? (
            <View style={s.csTags}>
              {tags.map(t => (
                <TouchableOpacity key={t} onPress={() => onSearchMood(post.mood_tags?.[0] ?? t)} activeOpacity={0.6} style={s.csTagChip}>
                  <Text style={s.csTagText}>{t.startsWith('#') ? t : `#${t}`}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {/* 情報カード（予算・誰と）*/}
          {(post.budget_level || (post.companion_tags && post.companion_tags.length > 0)) ? (
            <View style={s.csInfoCard}>
              {post.budget_level ? (
                <View style={s.csInfoRow}>
                  <View style={s.csInfoIcon}><Wallet size={17} color={CS_PURPLE} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.csInfoLabel}>{t.budgetLabel}</Text>
                    <Text style={s.csInfoValue}>{post.budget_level.replace('#', '')}</Text>
                  </View>
                </View>
              ) : null}
              {post.companion_tags && post.companion_tags.length > 0 ? (
                <>
                  {post.budget_level ? <View style={s.csDivider} /> : null}
                  <View style={s.csInfoRow}>
                    <View style={s.csInfoIcon}><Users size={17} color={CS_PURPLE} strokeWidth={2} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.csInfoLabel}>{t.companionLabel}</Text>
                      <Text style={s.csInfoValue}>{post.companion_tags.map(c => c.replace('#', '')).join('・')}</Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>
          ) : null}

          {/* この場所を見る */}
          {(post.place_name || post.google_maps_url) ? (
            <TouchableOpacity onPress={openMap} style={s.csMapBtn} activeOpacity={0.9}>
              <LinearGradient colors={[COLORS.gradStart, COLORS.gradEnd]} style={s.csMapBtnInner}><Text style={s.csMapBtnText}>{t.seeThisPlace}</Text></LinearGradient>
            </TouchableOpacity>
          ) : null}

          {/* 通報 */}
          <TouchableOpacity onPress={() => Alert.alert(t.reportTitle, t.reportMsg, [{ text: t.cancel, style: 'cancel' }, { text: t.doReport, style: 'destructive', onPress: report }])} disabled={reported} style={{ marginTop: 18, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {!reported && <Flag size={13} color="#B0AAB8" strokeWidth={2} />}
            <Text style={s.reportText}>{reported ? t.reported : t.reportThis}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* 参考になった FAB */}
      <TouchableOpacity onPress={() => { const next = !helped; setHelped(next); react('helpful', !next).then((ok) => { if (!ok) setHelped(!next); }); }} style={[s.csFab, { bottom: insets.bottom + 18 }]} activeOpacity={0.85}>
        <Heart size={24} color={CS_PINK} fill={helped ? CS_PINK : 'transparent'} strokeWidth={2.4} />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  csPosterHandle: { fontSize: 11.5, fontWeight: '600', color: '#8B88A6', marginTop: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 6 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  // 帯高はお気に入り基準で統一(HERO_BAND_H=139: 12+タイトル57+10+検索40+20)・下端寄せ
  // スクロール格納のためabsolute overlay化（リストは contentPaddingTop=headerH で逃がす）
  heroOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  // 下端は横線ではなく角丸（コンテンツに浮かぶカード風・お気に入り/特集と統一）
  hero: { paddingHorizontal: 20, paddingBottom: 20, overflow: 'hidden', justifyContent: 'flex-end', borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroTitle: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.82)', marginTop: 3 },
  // 右上のベル/マイページ（半透明の丸ボタン）
  heroIconRow: { flexDirection: 'row', gap: 8 },
  heroIconBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  heroAvatar: { width: 36, height: 36, borderRadius: 18 },
  heroNotifDot: {
    position: 'absolute', top: 7, right: 8, width: 7, height: 7, borderRadius: 3.5,
    backgroundColor: '#FF5B8C', borderWidth: 1.5, borderColor: '#E9A8F5',
  },
  // 人気/近く ピル（お気に入りのソートピルと同じ見た目）
  // フィルターチップ（並び順＋気分・1行横スクロール）
  fChipRow: { gap: 7, marginTop: 11, paddingRight: 20, alignItems: 'center' },
  fChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4.5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
  fChipOn: {
    backgroundColor: '#fff', borderColor: '#fff',
    shadowColor: '#3A1D6E', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  fChipText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.92)' },
  fChipTextOn: { color: '#3A3357', fontWeight: '800' },
  fDivider: { width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.4)', marginHorizontal: 2 },
  heroToggleRow: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  hToggleBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  hToggleBtnOn: { backgroundColor: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.5)' },
  hToggleText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  hToggleTextOn: { fontSize: 12, fontWeight: '700', color: '#fff' },
  // @ID検索バー（帯の中の白ボックス）
  scopeRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  scopeBtn: {
    paddingHorizontal: 14, paddingVertical: 6.5, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  scopeBtnOn: { backgroundColor: '#fff', borderColor: '#fff' },
  scopeText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  scopeTextOn: { color: '#7C3AED' },
  heroSearchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, height: 40, marginTop: 10,
    shadowColor: '#7A5CFF', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 3,
  },
  heroSearchInput: { flex: 1, fontSize: 13.5, fontWeight: '600', color: '#1E1548', paddingVertical: 0 },
  heroChipRow: { gap: 8, paddingRight: 8, marginTop: 10 },
  heroChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff', borderRadius: 999, paddingLeft: 4, paddingRight: 12, paddingVertical: 4,
  },
  heroChipIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F0EDFF' },
  heroChipText: { fontSize: 12.5, fontWeight: '800', color: '#5A8DFF' },
  heroDeco1: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.10)', top: -60, right: -40 },
  heroDeco2: { position: 'absolute', width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.07)', bottom: -30, left: -10 },
  searchWrap: { paddingHorizontal: 16, paddingTop: 12 },
  search: { marginTop: 8, backgroundColor: COLORS.muted, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, color: COLORS.text },
  chipRow: { height: 54, marginTop: 6, marginBottom: 8 },
  // 丸みのあるカード（外: 影 / 内: 角丸クリップ）
  card: { borderRadius: 16, backgroundColor: '#fff', shadowColor: '#1A0A2E', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 5 },
  cardInner: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: COLORS.muted },
  tileScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  tileCount: { position: 'absolute', left: 7, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileLoc: { position: 'absolute', right: 8, bottom: 7, maxWidth: '68%', flexDirection: 'row', alignItems: 'center', gap: 2 },
  tileLocText: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  tileCountText: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  empty: { textAlign: 'center', color: COLORS.textMuted, marginTop: 60, paddingHorizontal: 30, lineHeight: 22 },
  fab: { position: 'absolute', right: 18, bottom: 100 },
  fabInner: { paddingHorizontal: 22, paddingVertical: 14, borderRadius: 30, shadowColor: '#7A5CFF', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  fabText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  backBtn: { padding: 14 }, backText: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  dTitle: { fontSize: 21, fontWeight: '800', color: COLORS.text },
  dPlace: { fontSize: 15, color: COLORS.textSub, marginTop: 6 },
  // ── インスタ投稿風 詳細 ──
  igTop: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  igAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  igAvatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  igName: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  igPlace: { fontSize: 12, color: COLORS.textSub, marginTop: 1 },
  igDots: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 8 },
  igDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  igDotOn: { backgroundColor: COLORS.primary },
  igActions: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },
  igLikes: { fontSize: 14, fontWeight: '800', color: COLORS.text, paddingHorizontal: 14, marginTop: 4 },
  igCaptionWrap: { paddingHorizontal: 14, marginTop: 6 },
  igCaption: { fontSize: 15, color: COLORS.text, lineHeight: 22 },
  igCaptionName: { fontWeight: '800' },
  igCaptionTitle: { fontWeight: '700' },
  igTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, marginTop: 10 },
  igTag: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  dTag: { backgroundColor: COLORS.muted, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  dTagText: { fontSize: 12, color: COLORS.primary, fontWeight: '700' },
  dMeta: { fontSize: 14, color: COLORS.textSub, marginTop: 2 },
  dCaption: { fontSize: 16, color: COLORS.text, marginTop: 12, lineHeight: 24, fontWeight: '600' },
  dBody: { fontSize: 15, color: COLORS.text, marginTop: 10, lineHeight: 25 },
  dAuthor: { fontSize: 13, color: COLORS.textMuted, marginTop: 14 },
  actBtn: { backgroundColor: COLORS.muted, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  actBtnOn: { backgroundColor: COLORS.primary },
  actText: { fontSize: 14, color: COLORS.textSub, fontWeight: '700' }, actTextOn: { color: '#fff' },
  searchMoodBtn: { marginTop: 16 },
  searchMoodInner: { paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  searchMoodText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  reportText: { color: COLORS.textMuted, fontSize: 13 },
  photoAdd: { borderWidth: 1.5, borderColor: COLORS.borderRose, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 22, alignItems: 'center', marginBottom: 12 },
  photoAddText: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  imgDel: { position: 'absolute', top: -6, right: -6, backgroundColor: COLORS.error, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 8 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: COLORS.borderRose, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkText: { flex: 1, fontSize: 13, color: COLORS.textSub, lineHeight: 19 },
  submitBtn: { paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  // ── 投稿詳細（穴場詳細＝community-spot のデザイン言語に統一）──
  csPhotoWrap: { position: 'relative', backgroundColor: '#E8E0FF' },
  csTopScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 100 },
  csCircleBtn: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3 },
  csCounter: { position: 'absolute', bottom: 28, right: 14, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  csCounterText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  csDots: { position: 'absolute', bottom: 14, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  csDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  csDotOn: { backgroundColor: '#fff', width: 18 },
  csBody: { backgroundColor: '#F3F1F7', borderTopLeftRadius: 26, borderTopRightRadius: 26, marginTop: -22, paddingHorizontal: 18, paddingTop: 18 },
  csPosterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  csPosterAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  csPosterAvatarText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  csPosterName: { fontSize: 13, color: '#6B7280', fontWeight: '700', flex: 1 },
  csTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  csTitle: { flex: 1, fontSize: 21, fontWeight: '800', color: '#1A0A2E', lineHeight: 28, letterSpacing: -0.3 },
  csMapPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, shadowColor: CS_PURPLE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  csMapPillText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  csPlaceName: { fontSize: 13, color: '#6B7280', marginTop: -2, marginBottom: 10, fontWeight: '600' },
  csAreaChip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 12, shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  csAreaChipText: { fontSize: 12, fontWeight: '700', color: '#6D28D9', flexShrink: 1 },
  csLikesRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 12 },
  csLikesText: { fontSize: 12.5, fontWeight: '700', color: '#EC4899' },
  csCommentCard: { backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(155,107,255,0.14)', shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 },
  csCommentLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  csCommentLabel: { fontSize: 12.5, fontWeight: '900', color: CS_PURPLE },
  csCommentText: { fontSize: 14, color: '#2D2240', lineHeight: 22, fontWeight: '500' },
  csTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  csTagChip: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(155,107,255,0.18)' },
  csTagText: { fontSize: 12.5, color: '#6D28D9', fontWeight: '700' },
  csInfoCard: { backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 16, marginBottom: 14, shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 2 },
  csInfoRow: { flexDirection: 'row', gap: 13, paddingVertical: 14, alignItems: 'center' },
  csInfoIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#F3EFFC', alignItems: 'center', justifyContent: 'center' },
  csInfoLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '700', marginBottom: 2 },
  csInfoValue: { fontSize: 14, color: '#1F2937', lineHeight: 21, fontWeight: '600' },
  csDivider: { height: 1, backgroundColor: '#F2EFF7' },
  csMapBtn: { marginTop: 2, marginBottom: 4 },
  csMapBtnInner: { paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  csMapBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  csFab: { position: 'absolute', right: 18, width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FCE7F3', shadowColor: '#F56CB3', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
});
