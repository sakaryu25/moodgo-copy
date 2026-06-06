/**
 * feature-spot.tsx
 * 特集の有名スポット詳細（DBに無い仮スポット用）
 * name + area から /api/feature-spot で Google 情報を取得して表示。
 */
import { Image as ExpoImage } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Clock, MapPin, Phone, Globe, Train, Star, ChevronLeft } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { openInGoogleMaps } from '@/lib/openMaps';

const { width: W } = Dimensions.get('window');
const ACCENT = '#F26A3D';

type Spot = {
  placeId?: string;
  name: string;
  summary?: string;
  photos: string[];
  rating: number | null;
  reviewCount: number | null;
  openNow: boolean | null;
  address: string;
  openingHoursText: string;
  phone: string;
  website: string;
  googleMapsUri: string;
  stationText: string;
  lat?: number;
  lng?: number;
};

export default function FeatureSpotScreen() {
  const params = useLocalSearchParams<{ name?: string; area?: string; desc?: string; image?: string }>();
  const name = (params.name ?? '').toString();
  const area = (params.area ?? '').toString();
  const desc = (params.desc ?? '').toString();
  const fallbackImage = (params.image ?? '').toString();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [spot, setSpot] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!name) { setLoading(false); return; }
    apiFetch(`/api/feature-spot?name=${encodeURIComponent(name)}&area=${encodeURIComponent(area)}`)
      .then((r) => r.json())
      .then((d) => { if (d?.ok && d.spot) setSpot(d.spot); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [name, area]);

  const photos = (spot?.photos?.length ? spot.photos : (fallbackImage ? [fallbackImage] : []));

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <ChevronLeft size={22} color="#222" />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{name || '特集スポット'}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        style={s.flex}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 写真カルーセル */}
        {photos.length > 0 ? (
          <View style={s.gallery}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
            >
              {photos.map((u, i) => (
                <ExpoImage key={i} source={{ uri: u }} style={s.galleryImg} contentFit="cover" transition={150} cachePolicy="memory-disk" />
              ))}
            </ScrollView>
            {photos.length > 1 && (
              <>
                <View style={s.counter}><Text style={s.counterText}>{idx + 1} / {photos.length}</Text></View>
                <View style={s.dots}>
                  {photos.map((_, i) => <View key={i} style={[s.dot, i === idx && s.dotActive]} />)}
                </View>
              </>
            )}
          </View>
        ) : (
          <View style={[s.gallery, s.galleryEmpty]}>
            {loading ? <ActivityIndicator color={ACCENT} /> : <MapPin size={36} color="#ccc" />}
          </View>
        )}

        <View style={s.body}>
          {/* タイトル + マップ */}
          <View style={s.titleRow}>
            <Text style={s.title}>{name}</Text>
            {(spot?.googleMapsUri || spot?.address || name) && (
              <TouchableOpacity
                style={s.mapPill}
                activeOpacity={0.8}
                onPress={() => openInGoogleMaps({
                  query: [area, name].filter(Boolean).join(' '),
                  lat: spot?.lat, lng: spot?.lng, mapsUri: spot?.googleMapsUri,
                })}
              >
                <MapPin size={13} color="#fff" />
                <Text style={s.mapPillText}>マップ</Text>
              </TouchableOpacity>
            )}
          </View>

          {area ? <Text style={s.area}>{area}</Text> : null}

          {/* 説明 */}
          {(spot?.summary || desc) ? (
            <Text style={s.desc}>{spot?.summary || desc}</Text>
          ) : null}

          {/* 評価 */}
          {loading && !spot ? (
            <View style={s.loadingRow}><ActivityIndicator color={ACCENT} /><Text style={s.loadingText}>情報を取得中…</Text></View>
          ) : null}

          {spot?.rating != null && (
            <View style={s.ratingCard}>
              <Star size={20} color="#FFB400" fill="#FFB400" />
              <Text style={s.ratingBig}>{spot.rating.toFixed(1)}</Text>
              {spot.reviewCount != null && <Text style={s.ratingSub}>Googleの口コミ {spot.reviewCount}件</Text>}
              {spot.openNow != null && (
                <View style={[s.openBadge, { backgroundColor: spot.openNow ? '#E7F7EC' : '#FBE9E9' }]}>
                  <Text style={[s.openText, { color: spot.openNow ? '#1F9D55' : '#C0392B' }]}>
                    {spot.openNow ? '営業中' : '営業時間外'}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* 情報 */}
          {(spot?.address || spot?.stationText || spot?.phone || spot?.website) && (
            <View style={s.infoCard}>
              {spot?.address ? (
                <View style={s.infoRow}><MapPin size={16} color={ACCENT} /><Text style={s.infoText}>{spot.address}</Text></View>
              ) : null}
              {spot?.stationText ? (
                <View style={s.infoRow}><Train size={16} color={ACCENT} /><Text style={s.infoText}>{spot.stationText}</Text></View>
              ) : null}
              {spot?.phone ? (
                <TouchableOpacity style={s.infoRow} onPress={() => Linking.openURL(`tel:${spot.phone}`)}>
                  <Phone size={16} color={ACCENT} /><Text style={[s.infoText, s.link]}>{spot.phone}</Text>
                </TouchableOpacity>
              ) : null}
              {spot?.website ? (
                <TouchableOpacity style={s.infoRow} onPress={() => Linking.openURL(spot.website)}>
                  <Globe size={16} color={ACCENT} /><Text style={[s.infoText, s.link]} numberOfLines={1}>公式サイト</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {/* 営業時間 */}
          {spot?.openingHoursText ? (
            <View style={s.infoCard}>
              <View style={s.hoursHead}><Clock size={16} color={ACCENT} /><Text style={s.hoursTitle}>営業時間</Text></View>
              <Text style={s.hoursText}>{spot.openingHoursText}</Text>
            </View>
          ) : null}

          {/* マップで開く */}
          <TouchableOpacity
            style={s.mapBtn}
            activeOpacity={0.85}
            onPress={() => openInGoogleMaps({
              query: [area, name].filter(Boolean).join(' '),
              lat: spot?.lat, lng: spot?.lng, mapsUri: spot?.googleMapsUri,
            })}
          >
            <MapPin size={17} color="#fff" />
            <Text style={s.mapBtnText}>Googleマップで見る</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10,
    backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: '#222' },

  gallery: { width: W, height: W * 0.66, backgroundColor: '#f1efed' },
  galleryEmpty: { alignItems: 'center', justifyContent: 'center' },
  galleryImg: { width: W, height: W * 0.66 },
  counter: {
    position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
  },
  counterText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  dots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { backgroundColor: '#fff', width: 18 },

  body: { padding: 18, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { flex: 1, fontSize: 21, fontWeight: '900', color: '#1c1c1e', letterSpacing: -0.3 },
  mapPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ACCENT,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7,
  },
  mapPillText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  area: { fontSize: 13, color: '#888', fontWeight: '600', marginTop: -6 },
  desc: { fontSize: 14, color: '#444', lineHeight: 22 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  loadingText: { fontSize: 13, color: '#888' },

  ratingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFBF3',
    borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#FCEBC9',
  },
  ratingBig: { fontSize: 26, fontWeight: '900', color: '#1c1c1e' },
  ratingSub: { fontSize: 12, color: '#888', flex: 1 },
  openBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  openText: { fontSize: 12, fontWeight: '800' },

  infoCard: { backgroundColor: '#FAF8F6', borderRadius: 14, padding: 14, gap: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { flex: 1, fontSize: 14, color: '#333', lineHeight: 20 },
  link: { color: ACCENT, fontWeight: '700' },
  hoursHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hoursTitle: { fontSize: 14, fontWeight: '800', color: '#1c1c1e' },
  hoursText: { fontSize: 13, color: '#555', lineHeight: 22 },

  mapBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: 999, backgroundColor: ACCENT, marginTop: 4,
  },
  mapBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
});
