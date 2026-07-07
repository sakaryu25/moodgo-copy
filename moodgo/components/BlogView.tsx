// ── BlogView ─────────────────────────────────────────────────────────────────
// ユーザーおすすめブログ：①Insta風3列グリッド一覧 ②詳細 ③投稿フォーム を内部モードで切替。
// 承認済み(approved)のみ一覧/詳細に出る。投稿は pending で保存され管理者承認後に公開。
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, Linking,
  type NativeScrollEvent, type NativeSyntheticEvent,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Bookmark, Check, ChevronLeft, Flag, Heart, MapPin, MessageCircle, Search, Users, Wallet, X } from 'lucide-react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { GlassView } from 'expo-glass-effect';
import { LIQUID_GLASS } from './GlassSurface';
import PuniPressable from './PuniPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@/constants/colors';
import { HERO_BAND_H } from '@/lib/headerBand';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { openInGoogleMaps } from '@/lib/openMaps';
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
const COMPANIONS = ['#1人', '#友達', '#恋人', '#家族', '#大人数'];
const BUDGETS = ['#無料', '#〜3000', '#〜5000', '#〜10000', '#10000〜'];

function formatNum(n: number): string {
  if (!n || n < 0) return '0';
  if (n >= 10000) { const m = n / 10000; return (m >= 10 ? Math.round(m).toString() : m.toFixed(1).replace(/\.0$/, '')) + '万'; }
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + '千';
  return String(n);
}

type GridItem = { id: string; title: string; placeName: string | null; moodTags: string[]; photo: string; helpfulCount: number };
export type Detail = {
  id: string; title: string; caption: string | null; body: string | null; place_name: string | null;
  address: string | null; mood_tags: string[] | null; scene_tags: string[] | null; companion_tags: string[] | null;
  budget_level: string | null; google_maps_url: string | null; poster_name: string | null;
  poster_handle?: string | null;   // @ユーザーID（未設定はnull）
  helpful_count: number; photos: string[]; isOwn?: boolean;
};

export default function BlogView({ resetKey }: { resetKey?: number }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'list' | 'detail' | 'create'>('list');
  const [items, setItems] = useState<GridItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [moodFilter, setMoodFilter] = useState<string>('');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const scrollRef = useRef<ScrollView>(null);   // 再タップで先頭へ戻す用
  // ── ヘッダー内コントロール（人気/近く・@ID検索）: 見栄え改善でグラデ帯へ移設 ──
  const [sortMode, setSortMode] = useState<'popular' | 'near'>('popular');
  // 無限スクロール: 末尾接近でキーを増やして CommunityFeed に次ページ取得を促す
  const [loadMoreKey, setLoadMoreKey] = useState(0);
  const nearEndRef = useRef(false);
  const onFeedScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - 600;
    if (near && !nearEndRef.current) { nearEndRef.current = true; setLoadMoreKey((k) => k + 1); }
    else if (!near && nearEndRef.current) { nearEndRef.current = false; }
  };
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

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set('list', '1');
      if (moodFilter) p.set('mood', moodFilter);
      if (q.trim()) p.set('q', q.trim());
      const res = await apiFetch(`/api/blog-posts?${p.toString()}`, { timeoutMs: 15000 });
      const d = await res.json();
      setItems(d?.posts ?? []);
    } catch { setItems([]); } finally { setLoading(false); }
  }, [moodFilter, q]);

  useEffect(() => { if (mode === 'list') loadList(); }, [mode, moodFilter, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // 下部バー再タップ: 詳細/投稿フォームを閉じ、気分・キーワード絞り込みも解除して振り出しの一覧へ
  useEffect(() => {
    if (resetKey === undefined) return;
    setMode('list'); setMoodFilter(''); setQ(''); setDetail(null);
    setSortMode('popular'); clearUser();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [resetKey]);  // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = async (id: string) => {
    setLoading(true);
    try {
      const did = await getDeviceId();
      const res = await apiFetch(`/api/blog-posts?id=${id}&deviceId=${encodeURIComponent(did)}`);
      const d = await res.json();
      if (d?.ok && d.post) { setDetail(d.post); setMode('detail'); }
    } catch { /* noop */ } finally { setLoading(false); }
  };

  if (mode === 'create') return <CreateForm onDone={() => { setMode('list'); loadList(); }} onCancel={() => setMode('list')} />;
  if (mode === 'detail' && detail) return <DetailView post={detail} onBack={() => setMode('list')} onSearchMood={(t) => { setMoodFilter(t); setMode('list'); }} />;

  // ── 統一フィード（穴場＋moodログ＋ブログを1つに）──
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* グラデ帯ヘッダー（タブ見出し）*/}
      <LinearGradient colors={['#F472B6', '#C084FC', '#60A5FA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.hero, { paddingTop: insets.top + 12, minHeight: insets.top + HERO_BAND_H }]}>
        <View style={s.heroDeco1} pointerEvents="none" />
        <View style={s.heroDeco2} pointerEvents="none" />
        {/* タイトル行: 右側に 人気/近く（お気に入りのソートピルと同じ設計言語）*/}
        <View style={s.heroTopRow}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={s.heroTitle}>全国みんなの穴場</Text>
            <Text style={s.heroSub}>気分でめぐる、みんなのおすすめスポット</Text>
          </View>
          <View style={s.heroToggleRow}>
            <TouchableOpacity onPress={() => setSortMode('popular')} style={[s.hToggleBtn, sortMode === 'popular' && s.hToggleBtnOn]} activeOpacity={0.8}>
              <Text style={[s.hToggleText, sortMode === 'popular' && s.hToggleTextOn]}>人気</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={selectNear} style={[s.hToggleBtn, sortMode === 'near' && s.hToggleBtnOn]} activeOpacity={0.8}>
              <Text style={[s.hToggleText, sortMode === 'near' && s.hToggleTextOn]}>{locLoading ? '取得中…' : '近く'}</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* @ID検索バー（帯の中・白ボックス）*/}
        <View style={s.heroSearchBox}>
          <Search size={15} color="#8B88A6" strokeWidth={2.2} />
          <TextInput
            value={uq}
            onChangeText={onChangeUq}
            placeholder="スポット名・@IDで検索"
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
      {/* 背景はタブ側の AppBackground(ホームと同じM透かし)を透過で見せる */}
      <ScrollView ref={scrollRef} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 130 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" onScroll={onFeedScroll} scrollEventThrottle={160}>
        <CommunityFeed full sortMode={sortMode} coords={coords} posterHandle={uActive?.handle ?? null} searchQuery={uActive ? null : (kw || null)} loadMoreKey={loadMoreKey} />
      </ScrollView>
      {/* ＋投稿（現状はブログ投稿フォーム。将来1つの投稿フローに統合予定）*/}
      <PuniPressable onPress={() => router.push('/post')} containerStyle={s.fab}>
        {/* ヘッダー帯と同じブランド3色グラデでアプリ全体の色に統一（旧ローズ→オレンジを廃止）*/}
        <LinearGradient colors={['#F472B6', '#C084FC', '#60A5FA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fabInner}>
          {LIQUID_GLASS && (
            <GlassView glassEffectStyle="clear" isInteractive style={[StyleSheet.absoluteFill, { borderRadius: 30 }]} />
          )}
          <Text style={s.fabText}>＋ 投稿</Text>
        </LinearGradient>
      </PuniPressable>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, active && s.chipActive]}>
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── 詳細 ──
export function DetailView({ post, onBack, onSearchMood }: { post: Detail; onBack: () => void; onSearchMood: (tag: string) => void }) {
  const insets = useSafeAreaInsets();
  const [reported, setReported] = useState(false);
  const [helped, setHelped] = useState(false);
  const react = async (rtype: 'helpful' | 'save', undo = false) => {
    try { const did = await getDeviceId();
      await apiFetch('/api/blog-posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'react', postId: post.id, deviceId: did, rtype, undo }) });
    } catch { /* noop */ }
  };
  const report = async () => {
    try { const did = await getDeviceId();
      await apiFetch('/api/blog-posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'report', postId: post.id, deviceId: did, reason: '不適切' }) });
      setReported(true);
    } catch { /* noop */ }
  };
  const [saved, setSaved] = useState(false);
  const [page, setPage] = useState(0);
  const tags = [...(post.mood_tags ?? []), ...(post.scene_tags ?? [])];
  const photos = post.photos ?? [];
  const name = post.poster_name || 'MoodGoユーザー';
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
          <TouchableOpacity onPress={() => { const next = !saved; setSaved(next); react('save', !next); }} style={[s.csCircleBtn, { top: insets.top + 6, right: 14 }]} activeOpacity={0.85}>
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
              <Text style={s.csPosterName} numberOfLines={1}>{name}さんのおすすめ</Text>
              {post.poster_handle ? <Text style={s.csPosterHandle} numberOfLines={1}>@{post.poster_handle}</Text> : null}
            </View>
          </View>

          {/* タイトル + マップピル */}
          <View style={s.csTitleRow}>
            <Text style={s.csTitle}>{post.title}</Text>
            {(post.place_name || post.google_maps_url) ? (
              <TouchableOpacity onPress={openMap} activeOpacity={0.85}>
                <LinearGradient colors={CS_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.csMapPill}>
                  <MapPin size={15} color="#fff" strokeWidth={2.5} />
                  <Text style={s.csMapPillText}>地図</Text>
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
              <Text style={s.csLikesText}>{formatNum(likeCount)}件の「参考になった」</Text>
            </View>
          ) : null}

          {/* コメントカード（大目玉）*/}
          {(post.caption || post.body) ? (
            <View style={s.csCommentCard}>
              <View style={s.csCommentLabelRow}>
                <MessageCircle size={14} color={CS_PURPLE} fill={CS_PURPLE} strokeWidth={0} />
                <Text style={s.csCommentLabel}>どんな場所？</Text>
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
                    <Text style={s.csInfoLabel}>予算感</Text>
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
                      <Text style={s.csInfoLabel}>おすすめの相手</Text>
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
              <LinearGradient colors={[COLORS.gradStart, COLORS.gradEnd]} style={s.csMapBtnInner}><Text style={s.csMapBtnText}>この場所を見る</Text></LinearGradient>
            </TouchableOpacity>
          ) : null}

          {/* 通報 */}
          <TouchableOpacity onPress={() => Alert.alert('この投稿を通報しますか？', '不適切な内容として運営に報告します。', [{ text: 'キャンセル', style: 'cancel' }, { text: '通報する', style: 'destructive', onPress: report }])} disabled={reported} style={{ marginTop: 18, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {!reported && <Flag size={13} color="#B0AAB8" strokeWidth={2} />}
            <Text style={s.reportText}>{reported ? '通報しました' : 'この投稿を通報'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* 参考になった FAB */}
      <TouchableOpacity onPress={() => { const next = !helped; setHelped(next); react('helpful', !next); }} style={[s.csFab, { bottom: insets.bottom + 18 }]} activeOpacity={0.85}>
        <Heart size={24} color={CS_PINK} fill={helped ? CS_PINK : 'transparent'} strokeWidth={2.4} />
      </TouchableOpacity>
    </View>
  );
}

// ── 投稿フォーム ──
function CreateForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  const [images, setImages] = useState<{ uri: string; base64?: string }[]>([]);
  const [title, setTitle] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [address, setAddress] = useState('');
  const [caption, setCaption] = useState('');
  const [body, setBody] = useState('');
  const [moods, setMoods] = useState<string[]>([]);
  const [companions, setCompanions] = useState<string[]>([]);
  const [budget, setBudget] = useState('');
  const [license, setLicense] = useState(false);
  const [posting, setPosting] = useState(false);

  const pick = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        alert('写真へのアクセスが許可されていません。\n設定アプリ →（MoodGo/Expo Go）→ 写真 で「すべての写真」または「選択した写真」を許可してください。');
        return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 1, exif: false });
      if (!r.canceled && r.assets && r.assets.length > 0) {
        const slots = Math.max(0, 10 - images.length);
        // 送信前に1080pxへリサイズ＋圧縮してbase64化（4MB制限・本文サイズ超過を防ぐ）
        const resized = await Promise.all(r.assets.slice(0, slots).map(async (a) => {
          try {
            const small = await ImageManipulator.manipulateAsync(a.uri, [{ resize: { width: 1080 } }],
              { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true });
            return { uri: small.uri, base64: small.base64 ?? undefined };
          } catch { return { uri: a.uri, base64: a.base64 ?? undefined }; }
        }));
        setImages(prev => [...prev, ...resized].slice(0, 10));
      }
    } catch (e) {
      alert('写真の読み込みでエラーが発生しました: ' + String(e).slice(0, 150));
    }
  };
  const toggle = (arr: string[], setArr: (v: string[]) => void, t: string) => setArr(arr.includes(t) ? arr.filter(x => x !== t) : [...arr, t]);

  const submit = async () => {
    if (!title.trim()) return alert('タイトルを入力してください');
    if (!placeName.trim()) return alert('場所名/お店名を入力してください');
    if (!license) return alert('写真の権利確認にチェックしてください');
    setPosting(true);
    try {
      const deviceId = await getDeviceId();
      const imgs = images.map(i => i.base64 ? `data:image/jpeg;base64,${i.base64}` : '').filter(Boolean);
      const res = await apiFetch('/api/blog-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: 30000,
        body: JSON.stringify({
          action: 'create', deviceId, title: title.trim(), placeName: placeName.trim(), address: address.trim(),
          caption: caption.trim(), body: body.trim(), moodTags: moods, companionTags: companions,
          budgetLevel: budget || undefined, licenseDeclared: license, images: imgs,
        }),
      });
      const d = await res.json();
      if (d?.ok) { alert('投稿しました！運営の承認後に公開されます。'); onDone(); }
      else alert('投稿に失敗しました: ' + (d?.error ?? ''));
    } catch { alert('通信エラー'); } finally { setPosting(false); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 8, paddingBottom: 140 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <TouchableOpacity onPress={onCancel}><Text style={s.backText}>キャンセル</Text></TouchableOpacity>
        <Text style={[s.headerTitle, { flex: 1, textAlign: 'center' }]}>おすすめを投稿</Text>
        <View style={{ width: 60 }} />
      </View>

      <TouchableOpacity onPress={pick} style={s.photoAdd}>
        <Text style={s.photoAddText}>＋ 写真を追加（1〜10枚）</Text>
      </TouchableOpacity>
      {images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
          {images.map((im, i) => (
            <View key={i}>
              <Image source={{ uri: im.uri }} style={{ width: 92, height: 92, borderRadius: 10 }} contentFit="cover" />
              <TouchableOpacity onPress={() => setImages(images.filter((_, j) => j !== i))} style={s.imgDel}><Text style={{ color: '#fff', fontWeight: '700' }}>×</Text></TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      <Field label="タイトル *" value={title} onChange={setTitle} placeholder="例: 夕方に行きたい静かな散歩スポット" />
      <Field label="場所名 / お店名 *" value={placeName} onChange={setPlaceName} placeholder="例: 称名寺市民の森" />
      <Field label="住所・エリア" value={address} onChange={setAddress} placeholder="例: 横浜市金沢区" />

      <Text style={s.fLabel}>気分タグ</Text>
      <View style={s.tagWrap}>{MOODS.map(m => <Toggle key={m.tag} label={m.label} on={moods.includes(m.tag)} onPress={() => toggle(moods, setMoods, m.tag)} />)}</View>
      <Text style={s.fLabel}>誰と</Text>
      <View style={s.tagWrap}>{COMPANIONS.map(c => <Toggle key={c} label={c.replace('#', '')} on={companions.includes(c)} onPress={() => toggle(companions, setCompanions, c)} />)}</View>
      <Text style={s.fLabel}>予算感</Text>
      <View style={s.tagWrap}>{BUDGETS.map(b => <Toggle key={b} label={b.replace('#', '')} on={budget === b} onPress={() => setBudget(budget === b ? '' : b)} />)}</View>

      <Field label="ひとこと" value={caption} onChange={setCaption} placeholder="どんな気分の日におすすめ？" />
      <Field label="本文" value={body} onChange={setBody} placeholder="どんな場所か、行った感想など" multiline />

      <TouchableOpacity onPress={() => setLicense(!license)} style={s.checkRow}>
        <View style={[s.checkbox, license && s.checkboxOn]}>{license && <Check size={13} color="#fff" strokeWidth={3} />}</View>
        <Text style={s.checkText}>自分で撮影した、または使用許可のある写真です（Google画像/マップ/他サイトの転載ではありません）</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={submit} disabled={posting} activeOpacity={0.9} style={{ marginTop: 18 }}>
        <LinearGradient colors={[COLORS.gradStart, COLORS.gradEnd]} style={s.submitBtn}>
          <Text style={s.submitText}>{posting ? '投稿中…' : '投稿する（承認後に公開）'}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({ label, value, onChange, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={s.fLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={COLORS.textMuted}
        multiline={multiline} style={[s.input, multiline && { height: 110, textAlignVertical: 'top' }]} />
    </View>
  );
}
function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress} style={[s.toggle, on && s.toggleOn]}><Text style={[s.toggleText, on && s.toggleTextOn]}>{label}</Text></TouchableOpacity>;
}

const s = StyleSheet.create({
  csPosterHandle: { fontSize: 11.5, fontWeight: '600', color: '#8B88A6', marginTop: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 6 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  // 帯高はお気に入り基準で統一(HERO_BAND_H=139: 12+タイトル57+10+検索40+20)・下端寄せ
  hero: { paddingHorizontal: 20, paddingBottom: 20, overflow: 'hidden', justifyContent: 'flex-end' },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  heroTitle: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  heroSub: { fontSize: 12, color: 'rgba(255,255,255,0.82)', marginTop: 3 },
  // 人気/近く ピル（お気に入りのソートピルと同じ見た目）
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
  chip: { height: 38, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 19, backgroundColor: COLORS.muted },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: { fontSize: 13, color: COLORS.textSub, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' },
  chipTextActive: { color: '#fff' },
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
  fLabel: { fontSize: 13, fontWeight: '700', color: COLORS.textSub, marginBottom: 6 },
  input: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: COLORS.text },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  toggle: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: COLORS.muted },
  toggleOn: { backgroundColor: COLORS.primary },
  toggleText: { fontSize: 13, color: COLORS.textSub, fontWeight: '700' }, toggleTextOn: { color: '#fff' },
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
