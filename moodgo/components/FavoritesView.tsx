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
          <Heart size={52} color="#C7C7CC" strokeWidth={1.5} />
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
                  <Navigation size={24} color="#C7C7CC" strokeWidth={1.5} />
                </View>
              )}
              <View style={s.cardBody}>
                <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
                {item.area ? (
                  <View style={s.areaRow}>
                    <MapPin size={11} color="#8E8E93" strokeWidth={2} />
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
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  content: { padding: 16 },
  pageTitle: { fontSize: 34, fontWeight: '700', color: '#000', letterSpacing: -0.5 },
  pageSub: { fontSize: 13, color: '#8E8E93', marginTop: 2, marginBottom: 16 },

  // Segmented control
  segmented: {
    flexDirection: 'row', backgroundColor: '#E5E5EA', borderRadius: 8,
    padding: 2, marginBottom: 16, alignSelf: 'flex-start',
  },
  segBtn: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 7,
  },
  segBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2,
  },
  segText: { fontSize: 13, fontWeight: '500', color: '#6D6D72' },
  segTextActive: { color: '#000', fontWeight: '600' },

  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 16 },
  emptyText: { fontSize: 15, color: '#8E8E93', textAlign: 'center', lineHeight: 24 },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardInner: { flexDirection: 'row', gap: 12 },
  cardImg: { width: 76, height: 76, borderRadius: 10 },
  cardImgPlaceholder: { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#000', lineHeight: 21 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardArea: { fontSize: 12, color: '#8E8E93' },
  cardVibe: { fontSize: 12, color: '#6D6D72', lineHeight: 18 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  mapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: '#007AFF',
  },
  mapBtnText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  deleteBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: '#FF3B3015',
  },
  deleteBtnText: { fontSize: 12, fontWeight: '600', color: '#FF3B30' },
});
