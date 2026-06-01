import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Heart, MapPin, Navigation, Trash2, ArrowUpDown } from 'lucide-react-native';
import React, { useMemo } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FavoriteItem } from '@/types/app';

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
  lang?: 'ja' | 'en';
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
  },
};

export default function FavoritesView({
  favorites, favoriteSort, onSetFavoriteSort, onRemoveFavorite, lang = 'ja',
}: Props) {
  const insets = useSafeAreaInsets();
  const t = T[lang];

  const sorted = useMemo(() => {
    return [...favorites].sort((a, b) => {
      if (favoriteSort === 'title') return a.title.localeCompare(b.title, 'ja');
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
  }, [favorites, favoriteSort]);

  return (
    <View style={s.root}>
      {/* ── グラデーションヘッダー ── */}
      <LinearGradient
        colors={GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[s.heroHeader, { paddingTop: insets.top + 12 }]}
      >
        {/* 装飾サークル */}
        <View style={s.decoCircle1} pointerEvents="none" />
        <View style={s.decoCircle2} pointerEvents="none" />

        <View style={s.heroContent}>
          <View>
            <Text style={s.heroTitle}>{t.title}</Text>
            <Text style={s.heroSub}>
              {favorites.length > 0 ? t.count(favorites.length) : t.sub}
            </Text>
          </View>
          {/* ソートボタン */}
          <View style={s.sortRow}>
            {(['newest', 'title'] as const).map((sort) => (
              <TouchableOpacity
                key={sort}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onSetFavoriteSort(sort);
                }}
                style={[s.sortBtn, favoriteSort === sort && s.sortBtnActive]}
                activeOpacity={0.8}
              >
                <Text style={[s.sortText, favoriteSort === sort && s.sortTextActive]}>
                  {sort === 'newest' ? t.newest : t.byName}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </LinearGradient>

      {/* ── リスト ── */}
      <ScrollView
        style={s.listScroll}
        contentContainerStyle={[s.listContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {sorted.length === 0 ? (
          <View style={s.emptyBox}>
            <LinearGradient colors={GRAD_LIGHT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.emptyIconBg}>
              <Heart size={36} color="#C084FC" strokeWidth={1.5} />
            </LinearGradient>
            <Text style={s.emptyTitle}>{t.empty}</Text>
            <Text style={s.emptySub}>{t.emptySub}</Text>
          </View>
        ) : (
          sorted.map((item) => (
            <View key={item.title} style={s.card}>
              {/* 左グラデーションアクセントバー */}
              <LinearGradient
                colors={GRAD}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={s.cardAccentBar}
              />

              {/* 写真 */}
              {item.photoUrl ? (
                <Image
                  source={{ uri: item.photoUrl }}
                  style={s.cardImg}
                  contentFit="cover"
                />
              ) : (
                <LinearGradient colors={GRAD_LIGHT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.cardImg, s.cardImgPlaceholder]}>
                  <Navigation size={22} color="#C084FC" strokeWidth={1.5} />
                </LinearGradient>
              )}

              {/* テキスト情報 */}
              <View style={s.cardBody}>
                <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                {item.area ? (
                  <View style={s.areaRow}>
                    <MapPin size={11} color="#9CA3AF" strokeWidth={2} />
                    <Text style={s.cardArea} numberOfLines={1}>{item.area}</Text>
                  </View>
                ) : null}
                {item.vibe ? (
                  <View style={s.vibeBadge}>
                    <Text style={s.vibeText} numberOfLines={1}>{item.vibe}</Text>
                  </View>
                ) : null}

                {/* アクション */}
                <View style={s.cardActions}>
                  {item.mapUrl ? (
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        Linking.openURL(item.mapUrl!);
                      }}
                      style={s.mapBtn}
                      activeOpacity={0.85}
                    >
                      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mapBtnGrad}>
                        <MapPin size={12} color="#fff" strokeWidth={2.5} />
                        <Text style={s.mapBtnText}>{t.map}</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      onRemoveFavorite(item.title);
                    }}
                    style={s.deleteBtn}
                    activeOpacity={0.8}
                  >
                    <Trash2 size={13} color="#F43F5E" strokeWidth={2} />
                    <Text style={s.deleteBtnText}>{t.remove}</Text>
                  </TouchableOpacity>
                </View>
              </View>
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
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
    backgroundColor: '#FFF5F6',
    borderWidth: 1, borderColor: '#FECDD3',
  },
  deleteBtnText: { fontSize: 12, fontWeight: '600', color: '#F43F5E' },
});
