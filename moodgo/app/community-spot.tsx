/**
 * community-spot.tsx
 * 全国みんなの穴場 — スポット詳細ページ
 * /api/community-spot?id=X を取得して表示。
 * 利用者投稿写真を優先（無ければGoogle補強）。
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft, Clock, Heart, MapPin, Phone, Globe, Train, Star, Wallet,
} from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { loadJSON, saveJSON, FAVORITES_KEY } from '@/lib/storage';
import type { FavoriteItem } from '@/types/app';

const PINK = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const IG_GRAD: [string, string, string] = ['#FCAF45', '#E1306C', '#833AB4'];

type Spot = {
  id: string;
  userTitle: string;
  placeName: string;
  description: string;
  priceText: string;
  rating: number;
  imageUrls: string[];
  hasUserPhotos: boolean;
  address: string;
  phone: string;
  website: string;
  googleMapsUri: string;
  stationText: string;
  openingHoursText: string;
  prefecture: string;
  lat?: number;
  lng?: number;
  placeId?: string;
};

function Stars({ n }: { n: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={18} color={i <= n ? '#F59E0B' : '#E5E7EB'} fill={i <= n ? '#F59E0B' : '#E5E7EB'} strokeWidth={0} />
      ))}
    </View>
  );
}

export default function CommunitySpotScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [spot, setSpot] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [photoW, setPhotoW] = useState(0);
  const [faved, setFaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/community-spot?id=${id}`);
        const d = await res.json();
        if (d.ok) {
          setSpot(d.spot);
          const faves = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
          setFaved(faves.some((f) => f.title === (d.spot.placeName || d.spot.userTitle)));
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [id]);

  const toggleFav = async () => {
    if (!spot) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const faves = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
    const title = spot.placeName || spot.userTitle;
    let next: FavoriteItem[];
    if (faves.some((f) => f.title === title)) {
      next = faves.filter((f) => f.title !== title);
      setFaved(false);
    } else {
      next = [{
        title, area: spot.prefecture, vibe: '',
        photoUrl: spot.imageUrls[0] ?? '', mapUrl: spot.googleMapsUri,
        createdAt: new Date().toISOString(), placeId: spot.placeId,
        address: spot.address, rating: spot.rating || null,
      }, ...faves];
      setFaved(true);
    }
    await saveJSON(FAVORITES_KEY, next);
  };

  const onPhotoScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (photoW <= 0) return;
    setPhotoIdx(Math.round(e.nativeEvent.contentOffset.x / photoW));
  };

  const openInstagram = () => {
    if (!spot) return;
    const tag = (spot.placeName || spot.userTitle).replace(/\s+/g, '');
    Linking.openURL(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`)
      .catch(() => Linking.openURL(`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(spot.placeName)}`));
  };

  // ── ローディング ──
  if (loading) {
    return (
      <View style={[s.root, s.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }
  if (!spot) {
    return (
      <View style={[s.root, s.center, { paddingTop: insets.top }]}>
        <Text style={{ color: '#888' }}>スポットが見つかりませんでした</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: PURPLE, fontWeight: '800' }}>戻る</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const photos = spot.imageUrls.length > 0 ? spot.imageUrls : [];

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 110 }} showsVerticalScrollIndicator={false}>
        {/* ── 写真カルーセル ── */}
        <View style={s.photoWrap} onLayout={(e) => setPhotoW(e.nativeEvent.layout.width)}>
          {photos.length > 0 && photoW > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              decelerationRate="fast" onMomentumScrollEnd={onPhotoScroll}>
              {photos.map((uri, i) => (
                <Image key={i} source={{ uri }} style={{ width: photoW, height: 300 }} contentFit="cover" transition={250} />
              ))}
            </ScrollView>
          ) : (
            <LinearGradient colors={['#E8E0FF', '#D6EAF8']} style={{ width: '100%', height: 300, alignItems: 'center', justifyContent: 'center' }}>
              <MapPin size={42} color={PURPLE} strokeWidth={1.5} />
            </LinearGradient>
          )}

          {/* 利用者投稿バッジ */}
          {spot.hasUserPhotos && photos.length > 0 && (
            <View style={s.userPhotoBadge}>
              <Text style={s.userPhotoBadgeText}>📷 利用者の写真</Text>
            </View>
          )}
          {/* ページドット */}
          {photos.length > 1 && (
            <View style={s.dots}>
              {photos.map((_, i) => (
                <View key={i} style={[s.dot, i === photoIdx && s.dotActive]} />
              ))}
            </View>
          )}

          {/* 戻る・いいね */}
          <TouchableOpacity onPress={() => router.back()} style={[s.backBtn, { top: insets.top + 8 }]} activeOpacity={0.8}>
            <ChevronLeft size={22} color="#1A0A2E" strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleFav} style={[s.favBtn, { top: insets.top + 8 }]} activeOpacity={0.8}>
            <Heart size={20} color={faved ? PINK : '#9CA3AF'} fill={faved ? PINK : 'transparent'} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        {/* ── 本文カード ── */}
        <View style={s.body}>
          {/* タイトル */}
          {spot.prefecture ? <Text style={s.pref}>📍 {spot.prefecture}</Text> : null}
          <Text style={s.title}>{spot.userTitle || spot.placeName}</Text>
          {spot.placeName && spot.placeName !== spot.userTitle ? (
            <Text style={s.placeName}>{spot.placeName}</Text>
          ) : null}

          {/* おすすめ度 */}
          {spot.rating > 0 && (
            <View style={s.ratingRow}>
              <Stars n={spot.rating} />
              <Text style={s.ratingLabel}>おすすめ度</Text>
            </View>
          )}

          {/* ── 大目玉: 利用者コメント ── */}
          {spot.description ? (
            <View style={s.commentBox}>
              <Text style={s.commentLabel}>💬 どんな場所？</Text>
              <Text style={s.commentText}>{spot.description}</Text>
            </View>
          ) : null}

          {/* ── 情報リスト ── */}
          <View style={s.infoList}>
            {spot.priceText ? (
              <InfoRow Icon={Wallet} label="目安の値段" value={spot.priceText} />
            ) : null}
            {spot.address ? (
              <InfoRow Icon={MapPin} label="住所" value={spot.address} />
            ) : null}
            {spot.stationText ? (
              <InfoRow Icon={Train} label="最寄駅" value={spot.stationText} />
            ) : null}
            {spot.phone ? (
              <InfoRow Icon={Phone} label="電話番号" value={spot.phone}
                onPress={() => Linking.openURL(`tel:${spot.phone}`)} />
            ) : null}
            {spot.website ? (
              <InfoRow Icon={Globe} label="ウェブサイト" value={spot.website} link
                onPress={() => Linking.openURL(spot.website)} />
            ) : null}
            {spot.openingHoursText ? (
              <InfoRow Icon={Clock} label="営業時間" value={spot.openingHoursText} multiline />
            ) : null}
          </View>

          {/* ── アクションボタン ── */}
          <View style={s.actionRow}>
            <TouchableOpacity style={s.flex1} activeOpacity={0.88}
              onPress={() => {
                const url = spot.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.placeName || spot.address)}`;
                Linking.openURL(url);
              }}>
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mapBtn}>
                <MapPin size={17} color="#fff" strokeWidth={2.4} />
                <Text style={s.mapBtnText}>Googleマップで見る</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Instagram検索 */}
          <TouchableOpacity onPress={openInstagram} activeOpacity={0.85} style={s.igBtn}>
            <LinearGradient colors={IG_GRAD} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={s.igIcon}>
              <View style={s.igOuter}><View style={s.igLens} /><View style={s.igDot} /></View>
            </LinearGradient>
            <Text style={s.igText}>Instagramで検索</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({ Icon, label, value, onPress, link, multiline }: {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string; value: string; onPress?: () => void; link?: boolean; multiline?: boolean;
}) {
  const content = (
    <View style={s.infoRow}>
      <View style={s.infoIcon}><Icon size={16} color={PURPLE} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={[s.infoValue, link && { color: BLUE }]} numberOfLines={multiline ? 8 : 3}>{value}</Text>
      </View>
    </View>
  );
  return onPress ? <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity> : content;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F0FF' },
  center: { alignItems: 'center', justifyContent: 'center' },

  photoWrap: { position: 'relative', backgroundColor: '#E8E0FF' },
  userPhotoBadge: {
    position: 'absolute', bottom: 12, left: 12,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  userPhotoBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  dots: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive: { backgroundColor: '#fff', width: 18 },
  backBtn: {
    position: 'absolute', left: 14, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center',
  },
  favBtn: {
    position: 'absolute', right: 14, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center',
  },

  body: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    marginTop: -20, paddingHorizontal: 20, paddingTop: 22, minHeight: 400,
  },
  pref: { fontSize: 12, color: '#9CA3AF', marginBottom: 4, fontWeight: '600' },
  title: { fontSize: 23, fontWeight: '900', color: '#1A0A2E', lineHeight: 30 },
  placeName: { fontSize: 14, color: '#6B7280', marginTop: 4, fontWeight: '600' },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  ratingLabel: { fontSize: 12, fontWeight: '700', color: '#D97706' },

  commentBox: {
    marginTop: 18, backgroundColor: '#F5F0FF', borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(155,107,255,0.16)', padding: 16,
  },
  commentLabel: { fontSize: 13, fontWeight: '900', color: PURPLE, marginBottom: 8 },
  commentText: { fontSize: 15, color: '#3D2E5C', lineHeight: 24, fontWeight: '500' },

  infoList: { marginTop: 20, gap: 4 },
  infoRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'flex-start' },
  infoIcon: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: '#F5F0FF',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  infoLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '700', marginBottom: 2 },
  infoValue: { fontSize: 14, color: '#1F2937', lineHeight: 20, fontWeight: '500' },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  flex1: { flex: 1 },
  mapBtn: {
    height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  mapBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },

  igBtn: {
    marginTop: 12, height: 52, borderRadius: 16,
    borderWidth: 1.5, borderColor: '#F3D9E8', backgroundColor: '#FFF5FA',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  igIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  igOuter: { width: 15, height: 15, borderRadius: 5, borderWidth: 1.6, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  igLens: { width: 7, height: 7, borderRadius: 4, borderWidth: 1.6, borderColor: '#fff' },
  igDot: { position: 'absolute', top: 1, right: 1, width: 2.4, height: 2.4, borderRadius: 1.2, backgroundColor: '#fff' },
  igText: { fontSize: 15, fontWeight: '800', color: '#C13584' },
});
