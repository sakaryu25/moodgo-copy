import { Image } from 'expo-image';
import { Heart, MapPin, Navigation } from 'lucide-react-native';
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
import { COLORS } from '@/constants/Colors';

type Props = {
  favorites: FavoriteItem[];
  favoriteSort: 'newest' | 'title';
  onSetFavoriteSort: (v: 'newest' | 'title') => void;
  onRemoveFavorite: (title: string) => void;
  lang?: 'ja' | 'en';
};

const T = {
  ja: {
    title: 'お気に入り',
    sub: '保存した場所',
    newest: '新しい順',
    byName: '名前順',
    empty: 'まだ保存した場所はありません\n気に入った場所を♡で保存しよう！',
    map: 'マップ',
    remove: '削除',
  },
  en: {
    title: 'Favorites',
    sub: 'Saved places',
    newest: 'Newest',
    byName: 'By name',
    empty: 'No saved places yet\nSave places you like with ♡!',
    map: 'Map',
    remove: 'Remove',
  },
};

export default function FavoritesView({ favorites, favoriteSort, onSetFavoriteSort, onRemoveFavorite, lang = 'ja' }: Props) {
  const insets = useSafeAreaInsets();
  const t = T[lang];

  const sorted = useMemo(() => {
    return [...favorites].sort((a, b) => {
      if (favoriteSort === 'title') return a.title.localeCompare(b.title, 'ja');
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
  }, [favorites, favoriteSort]);

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={s.pageTitle}>{t.title}</Text>
      <Text style={s.pageSub}>{t.sub}</Text>

      {/* iOS segmented control style sort */}
      <View style={s.segmented}>
        {(['newest', 'title'] as const).map((sort) => (
          <TouchableOpacity
            key={sort}
            onPress={() => onSetFavoriteSort(sort)}
            style={[s.segBtn, favoriteSort === sort && s.segBtnActive]}
            activeOpacity={0.7}
          >
            <Text style={[s.segText, favoriteSort === sort && s.segTextActive]}>
              {sort === 'newest' ? t.newest : t.byName}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {sorted.length === 0 ? (
        <View style={s.emptyBox}>
          <Heart size={52} color="#FECDD3" strokeWidth={1.5} />
          <Text style={s.emptyText}>{t.empty}</Text>
        </View>
      ) : (
        sorted.map((item) => (
          <View key={item.title} style={s.card}>
            <View style={s.cardInner}>
              {item.photoUrl ? (
                <Image source={{ uri: item.photoUrl }} style={s.cardImg} contentFit="cover" />
              ) : (
                <View style={[s.cardImg, s.cardImgPlaceholder]}>
                  <Navigation size={24} color="#FECDD3" strokeWidth={1.5} />
                </View>
              )}
              <View style={s.cardBody}>
                <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                {item.area ? (
                  <View style={s.areaRow}>
                    <MapPin size={11} color={COLORS.textMuted} strokeWidth={2} />
                    <Text style={s.cardArea}>{item.area}</Text>
                  </View>
                ) : null}
                {item.vibe ? <Text style={s.cardVibe} numberOfLines={2}>{item.vibe}</Text> : null}
                <View style={s.cardActions}>
                  {item.mapUrl ? (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(item.mapUrl!)}
                      style={s.mapBtn}
                    >
                      <MapPin size={12} color="#fff" strokeWidth={2.5} />
                      <Text style={s.mapBtnText}>{t.map}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => onRemoveFavorite(item.title)}
                    style={s.deleteBtn}
                  >
                    <Text style={s.deleteBtnText}>{t.remove}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  content: { padding: 16 },
  pageTitle: { fontSize: 34, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  pageSub: { fontSize: 13, color: '#6B7280', marginTop: 2, marginBottom: 16 },
  segmented: { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3, marginBottom: 16, alignSelf: 'flex-start' },
  segBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 8 },
  segBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  segText: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  segTextActive: { color: '#111827', fontWeight: '700' },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 16 },
  emptyText: { fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 24 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3, borderWidth: 1, borderColor: '#F3F4F6' },
  cardInner: { flexDirection: 'row', gap: 12 },
  cardImg: { width: 80, height: 80, borderRadius: 14 },
  cardImgPlaceholder: { backgroundColor: '#FFF5F6', alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#111827', lineHeight: 21 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardArea: { fontSize: 12, color: '#6B7280' },
  cardVibe: { fontSize: 12, color: '#9CA3AF', lineHeight: 18 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#F43F5E' },
  mapBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  deleteBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#FFF5F6', borderWidth: 1, borderColor: '#FECDD3' },
  deleteBtnText: { fontSize: 12, fontWeight: '600', color: '#F43F5E' },
});
