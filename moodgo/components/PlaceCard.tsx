import { Image } from 'expo-image';
import { Clock, Heart, MapPin, Navigation, Share2, Star, Train } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Linking,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Recommendation } from '@/types/app';

const T = {
  ja: {
    openNow: '営業中',
    closedNow: '閉店中',
    mapBtn: 'マップで見る',
    hide: '表示しない',
    report: '報告する',
    share: '共有',
    reviewCount: (n: number) => `(${n.toLocaleString('ja-JP')}件)`,
  },
  en: {
    openNow: 'Open',
    closedNow: 'Closed',
    mapBtn: 'View on map',
    hide: 'Hide',
    report: 'Report',
    share: 'Share',
    reviewCount: (n: number) => `(${n.toLocaleString('en-US')} reviews)`,
  },
};

type Props = {
  item: Recommendation;
  isFavorited: boolean;
  onToggleFavorite: () => void;
  onBlock?: () => void;
  onReport?: () => void;
  accentColor?: string;
  lang?: 'ja' | 'en';
};

export default function PlaceCard({
  item, isFavorited, onToggleFavorite, onBlock, onReport, accentColor = '#FF6B35', lang = 'ja',
}: Props) {
  const t = T[lang];
  const photos = (item.photoUrls ?? []).length > 0
    ? item.photoUrls!
    : item.photoUrl ? [item.photoUrl] : [];
  const [photoIdx, setPhotoIdx] = useState(0);

  const openNowColor =
    item.openNow === true  ? '#34C759' :
    item.openNow === false ? '#8E8E93' : '#8E8E93';
  const openNowLabel =
    item.openNow === true  ? t.openNow :
    item.openNow === false ? t.closedNow : '';

  const handleShare = () => {
    const parts = [item.title];
    if (item.address) parts.push(item.address);
    if (item.mapUrl)  parts.push(item.mapUrl);
    Share.share({ message: parts.join('\n') });
  };

  return (
    <View style={s.card}>
      {/* Photo */}
      <View style={s.photoWrap}>
        {photos.length > 0 ? (
          <Image source={{ uri: photos[photoIdx] }} style={s.photo} contentFit="cover" />
        ) : (
          <View style={[s.photo, s.photoPlaceholder]}>
            <Navigation size={36} color="#C7C7CC" strokeWidth={1.5} />
          </View>
        )}

        {/* Photo nav */}
        {photos.length > 1 && (
          <>
            {photoIdx > 0 && (
              <TouchableOpacity onPress={() => setPhotoIdx((i) => i - 1)} style={[s.arrowBtn, { left: 10 }]}>
                <Text style={s.arrowText}>‹</Text>
              </TouchableOpacity>
            )}
            {photoIdx < photos.length - 1 && (
              <TouchableOpacity onPress={() => setPhotoIdx((i) => i + 1)} style={[s.arrowBtn, { right: 10 }]}>
                <Text style={s.arrowText}>›</Text>
              </TouchableOpacity>
            )}
            <View style={s.pageDots}>
              {photos.map((_, i) => (
                <View key={i} style={[s.pageDot, i === photoIdx && s.pageDotActive]} />
              ))}
            </View>
          </>
        )}

        {/* Fav button */}
        <TouchableOpacity
          onPress={onToggleFavorite}
          style={[s.favBtn, isFavorited && s.favBtnActive]}
        >
          <Heart
            size={18}
            color={isFavorited ? '#fff' : '#FF3B30'}
            fill={isFavorited ? '#fff' : 'none'}
            strokeWidth={2}
          />
        </TouchableOpacity>

        {/* Open now badge */}
        {item.openNow !== undefined && openNowLabel ? (
          <View style={[s.openBadge, { backgroundColor: item.openNow ? '#34C75922' : '#8E8E9322' }]}>
            <View style={[s.openDot, { backgroundColor: openNowColor }]} />
            <Text style={[s.openText, { color: openNowColor }]}>{openNowLabel}</Text>
          </View>
        ) : null}
      </View>

      {/* Body */}
      <View style={s.body}>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>

        {/* Rating row */}
        {item.rating != null && (
          <View style={s.ratingRow}>
            <Star size={14} color="#FF9F0A" fill="#FF9F0A" />
            <Text style={s.ratingText}>
              {item.rating.toFixed(1)}
              {item.userRatingCount ? <Text style={s.ratingCount}>  {t.reviewCount(item.userRatingCount)}</Text> : null}
            </Text>
          </View>
        )}

        {/* Address */}
        {item.address ? (
          <View style={s.infoRow}>
            <MapPin size={13} color="#8E8E93" strokeWidth={2} />
            <Text style={s.infoText} numberOfLines={1}>{item.address}</Text>
          </View>
        ) : null}

        {/* Distance */}
        {item.distanceText ? (
          <View style={s.infoRow}>
            <Navigation size={13} color="#8E8E93" strokeWidth={2} />
            <Text style={s.infoText}>{item.distanceText}{item.durationText ? `  ·  ${item.durationText}` : ''}</Text>
          </View>
        ) : null}

        {/* Station */}
        {item.stationText ? (
          <View style={s.infoRow}>
            <Train size={13} color="#8E8E93" strokeWidth={2} />
            <Text style={s.infoText}>{item.stationText}</Text>
          </View>
        ) : null}

        {/* Hours */}
        {item.openingHoursText ? (
          <View style={s.infoRow}>
            <Clock size={13} color="#8E8E93" strokeWidth={2} />
            <Text style={s.infoText} numberOfLines={1}>{item.openingHoursText}</Text>
          </View>
        ) : null}

        {/* Feature tags */}
        {item.features && item.features.length > 0 && (
          <View style={s.tagRow}>
            {item.features.map((f, i) => (
              <View key={i} style={[s.tag, { borderColor: accentColor + '55' }]}>
                <Text style={[s.tagText, { color: accentColor }]}>{f}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Divider */}
        <View style={s.divider} />

        {/* Actions */}
        <View style={s.actions}>
          {item.mapUrl ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(item.mapUrl!)}
              style={s.mapBtn}
              activeOpacity={0.75}
            >
              <MapPin size={15} color="#fff" strokeWidth={2.5} />
              <Text style={s.mapBtnText}>{t.mapBtn}</Text>
            </TouchableOpacity>
          ) : null}
          {item.hotpepperUrl ? (
            <TouchableOpacity
              onPress={() => Linking.openURL(item.hotpepperUrl!)}
              style={[s.mapBtn, { backgroundColor: '#CC0000' }]}
              activeOpacity={0.75}
            >
              <Text style={s.mapBtnText}>ホットペッパー</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Share / Block / Report */}
        <View style={s.footRow}>
          <TouchableOpacity onPress={handleShare} style={s.footBtnShare}>
            <Share2 size={12} color="#8E8E93" strokeWidth={2} />
            <Text style={s.footBtnText}>{t.share}</Text>
          </TouchableOpacity>
          <View style={s.footRight}>
            {onBlock && (
              <TouchableOpacity onPress={onBlock} style={s.footBtn}>
                <Text style={s.footBtnText}>{t.hide}</Text>
              </TouchableOpacity>
            )}
            {onReport && (
              <TouchableOpacity onPress={onReport} style={s.footBtn}>
                <Text style={s.footBtnText}>{t.report}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },

  // Photo
  photoWrap: { position: 'relative' },
  photo: { width: '100%', height: 200 },
  photoPlaceholder: { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  arrowBtn: {
    position: 'absolute', top: '50%', marginTop: -18,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  arrowText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  pageDots: {
    position: 'absolute', bottom: 10, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  pageDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.5)' },
  pageDotActive: { backgroundColor: '#fff', width: 14 },

  favBtn: {
    position: 'absolute', top: 12, right: 12,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4,
  },
  favBtnActive: { backgroundColor: '#FF3B30' },

  openBadge: {
    position: 'absolute', bottom: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  openDot: { width: 7, height: 7, borderRadius: 3.5 },
  openText: { fontSize: 12, fontWeight: '700' },

  // Body
  body: { padding: 16, gap: 7 },
  title: { fontSize: 20, fontWeight: '700', color: '#000', letterSpacing: -0.3, lineHeight: 26 },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ratingText: { fontSize: 14, fontWeight: '600', color: '#1C1C1E' },
  ratingCount: { fontSize: 13, fontWeight: '400', color: '#8E8E93' },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoText: { flex: 1, fontSize: 13, color: '#6D6D72', lineHeight: 18 },

  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6, borderWidth: 1,
    backgroundColor: 'transparent',
  },
  tagText: { fontSize: 12, fontWeight: '600' },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E5EA', marginVertical: 4 },

  actions: { flexDirection: 'row', gap: 8 },
  mapBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, borderRadius: 10,
    backgroundColor: '#007AFF',
  },
  mapBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },

  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  footBtnShare: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  footRight: { flexDirection: 'row', gap: 12 },
  footBtn: { paddingVertical: 2 },
  footBtnText: { fontSize: 12, color: '#C7C7CC' },
});
