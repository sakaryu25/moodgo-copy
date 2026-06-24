// 保存（お気に入り）タブ
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import AppBackground from '@/components/AppBackground';
import FavoritesView from '@/components/FavoritesView';
import { useFavorites } from '@/lib/useFavorites';
import { setSelectedPlace } from '@/lib/selectedPlace';
import type { FavoriteItem, Recommendation } from '@/types/app';

export default function FavoritesTab() {
  const { favorites, removeFavorite } = useFavorites();
  const [favoriteSort, setFavoriteSort] = useState<'newest' | 'title'>('newest');

  const handlePressCard = (item: FavoriteItem) => {
    const rec: Recommendation = {
      title: item.title,
      address: item.address ?? item.area,
      vibe: item.vibe,
      photoUrl: item.photoUrl,
      photoUrls: item.photoUrls ?? (item.photoUrl ? [item.photoUrl] : []),
      mapUrl: item.mapUrl,
      placeId: item.placeId,
      rating: item.rating ?? undefined,
      openingHoursText: item.openingHoursText,
      openNow: item.openNow,
      stationText: item.stationText,
      distanceText: item.distanceText,
      priceLevel: item.priceLevel,
      phone: item.phone,
      website: item.website,
      tags: item.tags,
      supabaseId: item.supabaseId,
    };
    setSelectedPlace(rec);
    router.push('/place');
  };

  return (
    <View style={styles.root}>
      <AppBackground />
      <FavoritesView
        favorites={favorites}
        favoriteSort={favoriteSort}
        onSetFavoriteSort={setFavoriteSort}
        onRemoveFavorite={removeFavorite}
        onPressCard={handlePressCard}
      />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#F3F1EF' } });
