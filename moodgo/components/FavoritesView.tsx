import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { Check, Footprints, Heart, MapPin, MessageCircle, Moon, Navigation } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FavoriteItem } from '@/types/app';
import { shareSpotToGroup } from '@/lib/groupShare';
import { openInGoogleMaps } from '@/lib/openMaps';
import { apiFetch } from '@/lib/api';
import { useSpotPhotos } from '@/lib/spotPhotos';
import { fetchUserPhotoMaps, userPhotosFor, type UserPhotoMaps } from '@/lib/userPhotos';
import { copyPlaceName } from '@/lib/clipboard';
import { addVisitedLog, loadVisitedLog, removeVisitedLog } from '@/lib/spotLog';
import { creditVisited, creditVisitedPost } from '@/lib/visitedCredit';
import PuniPressable from './PuniPressable';

const { width: SCREEN_W } = Dimensions.get('window');

const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const GRAD_LIGHT: [string, string, string] = [
  'rgba(244,114,182,0.15)',
  'rgba(192,132,252,0.15)',
  'rgba(96,165,250,0.15)',
];

type Props = {
  favorites: FavoriteItem[];
  favoriteSort: 'newest' | 'title';
  onSetFavoriteSort: (v: 'newest' | 'title') => void;
  onRemoveFavorite: (item: FavoriteItem) => void;  // 同名別スポット誤削除防止でitem渡し(sameFav判定)
  onPressCard?: (item: FavoriteItem) => void;
  lang?: 'ja' | 'en';
  resetKey?: number;
};

const T = {
  ja: {
    title:  'お気に入り',
    sub:    '保存した場所',
    newest: '新しい順',
    byName: '名前順',
    empty:  'まだ保存した場所はありません',
    emptySub: '気に入った場所をハートで保存しよう！',
    map:    'マップ',
    talk:   'トーク',
    visited:     '行った！',
    visitedDone: '行った',
    count:  (n: number) => `${n}件保存中`,
    tabPlace: '場所',
    tabPost:  '投稿',
    emptyPlace: 'まだ保存した場所はありません',
    emptyPost:  'まだ保存した投稿はありません',
    emptyPostSub: 'みんなの穴場で気になる投稿を♡しよう！',
  },
  en: {
    title:  'Favorites',
    sub:    'Saved places',
    newest: 'Newest',
    byName: 'By name',
    empty:  'No saved places yet',
    emptySub: 'Save places you like with the heart button!',
    map:    'Map',
    talk:   'Talk',
    visited:     'Been there!',
    visitedDone: 'Visited',
    count:  (n: number) => `${n} saved`,
    tabPlace: 'Places',
    tabPost:  'Posts',
    emptyPlace: 'No saved places yet',
    emptyPost:  'No saved posts yet',
    emptyPostSub: 'Save posts you like with the heart!',
  },
};

// お気に入りカードのサムネ。心霊は投稿写真があればそれ、無ければ暗いPH。Google写真は使わない。
function FavoriteCardImage({ item, maps }: { item: FavoriteItem; maps: UserPhotoMaps }) {
  const isShinrei = !!item.tags?.includes('#心霊スポット');
  const storePhotos = useSpotPhotos(item.supabaseId, item.title);
  const [fetched, setFetched] = useState<string[]>([]);
  useEffect(() => {
    if (!isShinrei) return;
    let active = true;
    const params = new URLSearchParams();
    if (item.supabaseId) params.set('placeId', item.supabaseId);
    else params.set('placeName', item.title);
    apiFetch(`/api/spot-photo?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (active && d?.ok && Array.isArray(d.photos)) setFetched(d.photos); })
      .catch(() => {});
    return () => { active = false; };
  }, [isShinrei, item.supabaseId, item.title]);

  if (isShinrei) {
    const userPhoto = [storePhotos[0], fetched[0]].find(Boolean);
    return userPhoto ? (
      <Image source={{ uri: userPhoto }} style={s.cardImg} contentFit="cover" />
    ) : (
      <LinearGradient colors={['#2A1A45', '#160C28', '#0C0718']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[s.cardImg, s.cardImgPlaceholder]}>
        <Moon size={22} color="rgba(180,160,255,0.6)" strokeWidth={1.5} />
      </LinearGradient>
    );
  }
  // 通常スポット: 利用者投稿写真があればそれを最優先（無ければ保存済みGoogle写真）
  const img = userPhotosFor(maps, item.supabaseId, item.title)[0] ?? item.photoUrl;
  return img ? (
    <Image source={{ uri: img }} style={s.cardImg} contentFit="cover" />
  ) : (
    <LinearGradient colors={GRAD_LIGHT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.cardImg, s.cardImgPlaceholder]}>
      <Navigation size={22} color="#C084FC" strokeWidth={1.5} />
    </LinearGradient>
  );
}

export default function FavoritesView({
  favorites, favoriteSort, onSetFavoriteSort, onRemoveFavorite, onPressCard, lang = 'ja', resetKey,
}: Props) {
  const insets = useSafeAreaInsets();
  const t = T[lang];
  const pagerRef = useRef<ScrollView>(null);
  const listRefs = useRef<Array<ScrollView | null>>([]);  // 場所/投稿 各リスト（再タップで先頭へ）
  const [tab, setTab] = useState(0);   // 0=場所, 1=投稿
  // 開いた時点の利用者投稿写真をDBから取得（保存済みGoogle写真より優先表示）
  const [upMaps, setUpMaps] = useState<UserPhotoMaps>({ byId: {}, byName: {} });
  useEffect(() => {
    if (favorites.length === 0) return;
    let active = true;
    fetchUserPhotoMaps(favorites.map(f => ({ name: f.title, supabaseId: f.supabaseId })))
      .then(m => { if (active) setUpMaps(m); });
    return () => { active = false; };
  }, [favorites]);

  useEffect(() => {
    if (resetKey === undefined) return;
    setTab(0);
    pagerRef.current?.scrollTo({ x: 0, animated: false });
    listRefs.current.forEach((r) => r?.scrollTo({ y: 0, animated: false }));  // 各リストも先頭へ
  }, [resetKey]);

  // 並び替え + 種別で分割
  const { placeFavs, postFavs } = useMemo(() => {
    const sorted = [...favorites].sort((a, b) => {
      if (favoriteSort === 'title') return a.title.localeCompare(b.title, 'ja');
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
    return {
      placeFavs: sorted.filter((f) => f.kind !== 'post'),
      postFavs:  sorted.filter((f) => f.kind === 'post'),
    };
  }, [favorites, favoriteSort]);

  const goTab = (i: number) => {
    setTab(i);
    pagerRef.current?.scrollTo({ x: i * SCREEN_W, animated: true });
  };
  const onPagerScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (i !== tab) setTab(i);
  };

  const handlePress = (item: FavoriteItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.kind === 'post' && item.spotId) {
      router.push({ pathname: '/community-spot', params: { id: item.spotId } });
    } else {
      onPressCard?.(item);
    }
  };

  // ── いいね解除は「ページを離れたら確定」（誤タップ対策・Instagram型）──────────
  //   ハートを外してもカードは残り、再タップで元に戻せる。タブを離れた時にまとめて削除。
  const favKeyOf = (f: FavoriteItem) => `${f.kind ?? 'place'}|${f.supabaseId ?? f.placeId ?? f.spotId ?? f.title}`;
  const [pendingRemove, setPendingRemove] = useState<Set<string>>(new Set());
  const pendingRef = useRef(pendingRemove);
  pendingRef.current = pendingRemove;
  const favsRef = useRef(favorites);
  favsRef.current = favorites;

  const togglePendingRemove = (item: FavoriteItem) => {
    const k = favKeyOf(item);
    const willRemove = !pendingRemove.has(k);
    Haptics.impactAsync(willRemove ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    setPendingRemove((prev) => {
      const next = new Set(prev);
      if (willRemove) next.add(k); else next.delete(k);
      return next;
    });
  };

  const commitPendingRemovals = useCallback(() => {
    const pend = pendingRef.current;
    if (pend.size === 0) return;
    for (const f of favsRef.current) {
      if (pend.has(favKeyOf(f))) onRemoveFavorite(f);   // removeFavoriteは関数型更新=連続呼び出し安全
    }
    setPendingRemove(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRemoveFavorite]);

  // タブから離れた時（＋アンマウント保険）に確定
  useFocusEffect(
    useCallback(() => {
      return () => commitPendingRemovals();
    }, [commitPendingRemovals]),
  );
  useEffect(() => () => { commitPendingRemovals(); }, [commitPendingRemovals]);

  // 行った！のトグル: ローカル記録(バッジ/訪れた県)＋投稿者へのクレジットを付与/解除。
  const [visitedTitles, setVisitedTitles] = useState<Set<string>>(new Set());
  useEffect(() => {
    loadVisitedLog().then((list) => setVisitedTitles(new Set(list.map((e) => e.title)))).catch(() => {});
  }, []);
  const markVisited = (item: FavoriteItem) => {
    const on = !visitedTitles.has(item.title);
    Haptics.impactAsync(on ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    setVisitedTitles((prev) => {
      const next = new Set(prev);
      if (on) next.add(item.title); else next.delete(item.title);
      return next;
    });
    if (on) {
      addVisitedLog({
        title: item.title, photoUrl: item.photoUrl ?? item.photoUrls?.[0],
        address: item.address ?? item.area, placeId: item.placeId, supabaseId: item.supabaseId, tags: item.tags,
      }).catch(() => {});
    } else {
      removeVisitedLog({ title: item.title, placeId: item.placeId, supabaseId: item.supabaseId }).catch(() => {});
    }
    // 投稿お気に入りはIDで直クレジット、場所は場所解決クレジット（onに応じて付与/解除）
    if (item.kind === 'post' && item.spotId) creditVisitedPost(item.spotId, on);
    else creditVisited({ title: item.title, supabaseId: item.supabaseId, placeId: item.placeId, address: item.address ?? item.area }, on);
  };

  const renderList = (list: FavoriteItem[], emptyTitle: string, emptySub: string, idx: number) => (
    <ScrollView
      ref={(r) => { listRefs.current[idx] = r; }}
      style={{ width: SCREEN_W }}
      contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 90 }]}
      showsVerticalScrollIndicator={false}
    >
      {list.length === 0 ? (
        <View style={s.emptyBox}>
          <LinearGradient colors={GRAD_LIGHT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.emptyIconBg}>
            <Heart size={36} color="#C084FC" strokeWidth={1.5} />
          </LinearGradient>
          <Text style={s.emptyTitle}>{emptyTitle}</Text>
          <Text style={s.emptySub}>{emptySub}</Text>
        </View>
      ) : (
        list.map((item, idx) => (
          // 同名スポットでもReactキーが衝突しないよう複合キー（id優先・無ければ index 付与）
          <TouchableOpacity key={`${item.kind ?? 'place'}-${item.supabaseId ?? item.placeId ?? item.spotId ?? item.title}-${idx}`} style={s.card} activeOpacity={0.75} onPress={() => handlePress(item)}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.cardAccentBar} />
            <FavoriteCardImage item={item} maps={upMaps} />
            <View style={s.cardBody}>
              <Text style={[s.cardTitle, s.cardTitleClear]} numberOfLines={2} onPress={() => handlePress(item)} onLongPress={() => copyPlaceName(item.title)} suppressHighlighting>{item.title}</Text>
              {item.area ? (
                <View style={s.areaRow}>
                  <MapPin size={11} color="#9CA3AF" strokeWidth={2} />
                  <Text style={s.cardArea} numberOfLines={1}>{item.area}</Text>
                </View>
              ) : null}
              {item.vibe ? (
                <View style={s.vibeBadge}><Text style={s.vibeText} numberOfLines={1}>{item.vibe}</Text></View>
              ) : null}
              <View style={s.cardActions}>
                {/* マップ（場所/投稿 共通・住所や名前だけでも開ける）*/}
                <PuniPressable
                  onPress={() => openInGoogleMaps({
                    query: [item.title, item.address ?? item.area].filter(Boolean).join(' '),
                    mapsUri: item.mapUrl,
                  })}
                  style={s.mapBtn}
                  containerStyle={{ flex: 1 }}
                >
                  <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mapBtnGrad}>
                    <MapPin size={12} color="#fff" strokeWidth={2.5} />
                    <Text style={s.mapBtnText} numberOfLines={1}>{t.map}</Text>
                  </LinearGradient>
                </PuniPressable>
                {/* 仲良しグループのチャットへ共有 */}
                <PuniPressable
                  onPress={() => shareSpotToGroup({ title: item.title, address: item.area, mapUrl: item.mapUrl })}
                  style={s.groupBtn}
                  containerStyle={{ flex: 1 }}
                >
                  <MessageCircle size={13} color="#7C3AED" strokeWidth={2} />
                  <Text style={s.groupBtnText}>{t.talk}</Text>
                </PuniPressable>
                {/* 行った！（検索結果と共通の体験・押すと投稿者の実績にも加算）*/}
                <PuniPressable
                  onPress={() => markVisited(item)}
                  haptic={false}
                  style={[s.visitedBtn, visitedTitles.has(item.title) && s.visitedBtnDone]}
                  containerStyle={{ flex: 1 }}
                >
                  {visitedTitles.has(item.title) ? (
                    <><Check size={13} color="#10B981" strokeWidth={2.5} /><Text style={s.visitedBtnText}>{t.visitedDone}</Text></>
                  ) : (
                    <><Footprints size={13} color="#10B981" strokeWidth={2.2} /><Text style={s.visitedBtnText}>{t.visited}</Text></>
                  )}
                </PuniPressable>
              </View>
            </View>
            {/* 右上のハート＝お気に入り解除。誤タップ対策で即消さず、白抜き表示→ページを離れた時に確定。
                もう一度タップすれば元に戻る。 */}
            <TouchableOpacity
              onPress={() => togglePendingRemove(item)}
              style={s.heartRemove} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={pendingRemove.has(favKeyOf(item))
                ? `${item.title}をお気に入りに戻す`
                : `${item.title}をお気に入りから外す（ページを離れると確定）`}
            >
              {pendingRemove.has(favKeyOf(item)) ? (
                <Heart size={17} color="#F9A8D4" fill="transparent" strokeWidth={2.2} />
              ) : (
                <Heart size={17} color="#F472B6" fill="#F472B6" strokeWidth={0} />
              )}
            </TouchableOpacity>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );

  return (
    <View style={s.root}>
      {/* ── グラデーションヘッダー ── */}
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.heroHeader, { paddingTop: insets.top + 12 }]}>
        <View style={s.decoCircle1} pointerEvents="none" />
        <View style={s.decoCircle2} pointerEvents="none" />
        <View style={s.heroContent}>
          <View>
            <Text style={s.heroTitle}>{t.title}</Text>
            <Text style={s.heroSub}>{favorites.length > 0 ? t.count(favorites.length) : t.sub}</Text>
          </View>
          <View style={s.sortRow}>
            {(['newest', 'title'] as const).map((sort) => (
              <TouchableOpacity
                key={sort}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSetFavoriteSort(sort); }}
                style={[s.sortBtn, favoriteSort === sort && s.sortBtnActive]} activeOpacity={0.8}
              >
                <Text style={[s.sortText, favoriteSort === sort && s.sortTextActive]}>
                  {sort === 'newest' ? t.newest : t.byName}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── 場所 / 投稿 セグメント ── */}
        <View style={s.segWrap}>
          {[t.tabPlace + ` (${placeFavs.length})`, t.tabPost + ` (${postFavs.length})`].map((label, i) => (
            <TouchableOpacity key={i} style={s.segBtn} activeOpacity={0.85} onPress={() => goTab(i)}>
              <Text style={[s.segText, tab === i && s.segTextActive]}>{label}</Text>
              {tab === i && <View style={s.segUnderline} />}
            </TouchableOpacity>
          ))}
        </View>
      </LinearGradient>

      {/* ── 横スワイプの2ページ ── */}
      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPagerScroll}
        style={{ flex: 1 }}
      >
        {renderList(placeFavs, t.emptyPlace, t.emptySub, 0)}
        {renderList(postFavs, t.emptyPost, t.emptyPostSub, 1)}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },  // AppBackground(M透かし)を見せて他画面と統一

  // ── ヒーローヘッダー ──
  heroHeader: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    overflow: 'hidden',
  },
  decoCircle1: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.08)', top: -60, right: -40,
  },
  decoCircle2: {
    position: 'absolute', width: 100, height: 100, borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.06)', bottom: -30, left: -10,
  },
  heroContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  heroTitle: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
  heroSub:   { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 3 },

  // ── ソートボタン ──
  sortRow:       { flexDirection: 'row', gap: 6 },
  sortBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  sortBtnActive: { backgroundColor: 'rgba(255,255,255,0.35)', borderColor: 'rgba(255,255,255,0.5)' },
  sortText:      { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  sortTextActive:{ fontSize: 12, fontWeight: '700', color: '#fff' },

  // ── セグメント（場所/投稿）──
  segWrap: { flexDirection: 'row', marginTop: 16, gap: 8 },
  segBtn: { alignItems: 'center', paddingVertical: 4, paddingHorizontal: 6 },
  segText: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  segTextActive: { color: '#fff', fontWeight: '900' },
  segUnderline: { marginTop: 5, height: 3, width: '100%', borderRadius: 2, backgroundColor: '#fff' },

  // ── リスト ──
  listScroll:  { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 16 },

  // ── 空状態 ──
  emptyBox:    { alignItems: 'center', paddingVertical: 72, gap: 14 },
  emptyIconBg: { width: 88, height: 88, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  emptyTitle:  { fontSize: 17, fontWeight: '700', color: '#111827' },
  emptySub:    { fontSize: 14, color: '#9CA3AF', textAlign: 'center' },

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
  cardAccentBar: { width: 4, alignSelf: 'stretch' },
  cardImg: {
    width: 82, height: 82,
    margin: 12, borderRadius: 12,
  },
  cardImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardBody:  { flex: 1, paddingVertical: 12, paddingRight: 12, gap: 5 },
  // タイトルが右上のハートに被らないように（ハート分の逃げ）
  cardTitleClear: { paddingRight: 26 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#111827', lineHeight: 21, letterSpacing: -0.2 },
  areaRow:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardArea:  { fontSize: 12, color: '#6B7280', flex: 1 },
  vibeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(192,132,252,0.1)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.2)',
  },
  vibeText:  { fontSize: 11, fontWeight: '600', color: '#C084FC' },

  // ── アクションボタン ──
  cardActions: { flexDirection: 'row', gap: 7, marginTop: 2 },
  mapBtn:      { flex: 1, borderRadius: 10, overflow: 'hidden' },
  mapBtnGrad: {
    // 枠線(1px)があるトーク/削除と総高さを揃えるため paddingVertical は+1
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 8, paddingHorizontal: 10,
  },
  mapBtnText:    { fontSize: 12, fontWeight: '700', color: '#fff' },
  // マップ・トーク・削除を同じ幅（flex:1）・同じ高さで揃える
  groupBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 7, borderRadius: 10,
    backgroundColor: '#F5F3FF',
    borderWidth: 1, borderColor: '#DDD6FE',
  },
  groupBtnText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  // 行った！（検索結果カードと同トーン・押済みは薄く）
  visitedBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 7, borderRadius: 10,
    backgroundColor: '#ECFDF5',
    borderWidth: 1, borderColor: '#A7F3D0',
  },
  visitedBtnDone: { backgroundColor: '#F6FEFA', borderColor: '#D1FAE5', opacity: 0.85 },
  visitedBtnText: { fontSize: 12, fontWeight: '700', color: '#10B981' },
  // 右上のハート（お気に入り解除）
  heartRemove: { position: 'absolute', top: 10, right: 12 },
});
