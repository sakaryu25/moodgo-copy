import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Heart, MapPin, MessageCircle, Navigation, Trash2 } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Linking,
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
  onRemoveFavorite: (title: string) => void;
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
    map:    'Googleマップ',
    remove: '削除',
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
    map:    'Google Maps',
    remove: 'Remove',
    count:  (n: number) => `${n} saved`,
    tabPlace: 'Places',
    tabPost:  'Posts',
    emptyPlace: 'No saved places yet',
    emptyPost:  'No saved posts yet',
    emptyPostSub: 'Save posts you like with the heart!',
  },
};

export default function FavoritesView({
  favorites, favoriteSort, onSetFavoriteSort, onRemoveFavorite, onPressCard, lang = 'ja', resetKey,
}: Props) {
  const insets = useSafeAreaInsets();
  const t = T[lang];
  const pagerRef = useRef<ScrollView>(null);
  const [tab, setTab] = useState(0);   // 0=場所, 1=投稿

  useEffect(() => {
    if (resetKey === undefined) return;
    setTab(0);
    pagerRef.current?.scrollTo({ x: 0, animated: false });
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

  const renderList = (list: FavoriteItem[], emptyTitle: string, emptySub: string) => (
    <ScrollView
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
        list.map((item) => (
          <TouchableOpacity key={item.title} style={s.card} activeOpacity={0.75} onPress={() => handlePress(item)}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.cardAccentBar} />
            {item.photoUrl ? (
              <Image source={{ uri: item.photoUrl }} style={s.cardImg} contentFit="cover" />
            ) : (
              <LinearGradient colors={GRAD_LIGHT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.cardImg, s.cardImgPlaceholder]}>
                <Navigation size={22} color="#C084FC" strokeWidth={1.5} />
              </LinearGradient>
            )}
            <View style={s.cardBody}>
              <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
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
                {item.mapUrl ? (
                  <PuniPressable
                    onPress={() => Linking.openURL(item.mapUrl!)}
                    style={s.mapBtn}
                    containerStyle={{ flex: 1 }}
                  >
                    <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mapBtnGrad}>
                      <MapPin size={12} color="#fff" strokeWidth={2.5} />
                      <Text style={s.mapBtnText}>{t.map}</Text>
                    </LinearGradient>
                  </PuniPressable>
                ) : null}
                {/* 仲良しグループのチャットへ共有 */}
                <PuniPressable
                  onPress={() => shareSpotToGroup({ title: item.title, address: item.area, mapUrl: item.mapUrl })}
                  style={s.groupBtn}
                >
                  <MessageCircle size={13} color="#7C3AED" strokeWidth={2} />
                </PuniPressable>
                <PuniPressable
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onRemoveFavorite(item.title); }}
                  haptic={false}
                  style={s.deleteBtn}
                >
                  <Trash2 size={13} color="#F43F5E" strokeWidth={2} />
                  <Text style={s.deleteBtnText}>{t.remove}</Text>
                </PuniPressable>
              </View>
            </View>
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
        {renderList(placeFavs, t.emptyPlace, t.emptySub)}
        {renderList(postFavs, t.emptyPost, t.emptyPostSub)}
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 7, paddingHorizontal: 10,
  },
  mapBtnText:    { fontSize: 12, fontWeight: '700', color: '#fff' },
  groupBtn: {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: '#F5F3FF',
    borderWidth: 1, borderColor: '#DDD6FE',
  },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: '#FFF5F6',
    borderWidth: 1, borderColor: '#FECDD3',
  },
  deleteBtnText: { fontSize: 12, fontWeight: '600', color: '#F43F5E' },
});
