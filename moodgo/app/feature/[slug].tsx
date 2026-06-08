import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Clock, MapPin, Phone, Search, Train, Users } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';

type RecommendedItem = {
  name: string;
  description?: string;
  price?: string;
  image_url?: string;
};

type FeaturedPage = {
  id: string;
  slug: string;
  partner_name: string;
  spot_name: string;
  catch_copy?: string;
  description?: string;
  access?: string;
  address?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  website?: string;
  instagram?: string;
  business_hours?: string;
  recommended_items: RecommendedItem[];
  features: string[];
  congestion_info?: string;
  cover_image_url?: string;
  gallery_image_urls: string[];
  tags: string[];
  is_published: boolean;
};

const T = {
  ja: {
    headerTitle: '特集',
    notFound: 'ページが見つかりませんでした',
    backToList: '← 特集一覧に戻る',
    by: 'by',
    features: '特徴',
    recommended: 'おすすめ',
    access: 'アクセス・情報',
    viewMap: 'Googleマップで見る',
    viewSite: '公式サイトを見る',
    viewInsta: 'Instagramを見る',
  },
  en: {
    headerTitle: 'Featured',
    notFound: 'Page not found',
    backToList: '← Back to featured',
    by: 'by',
    features: 'Features',
    recommended: 'Recommended',
    access: 'Access & Info',
    viewMap: 'View on Google Maps',
    viewSite: 'Visit official site',
    viewInsta: 'View on Instagram',
  },
} as const;

export default function FeaturePage() {
  const { slug, lang: langParam } = useLocalSearchParams<{ slug: string; lang?: string }>();
  const lang: 'ja' | 'en' = langParam === 'en' ? 'en' : 'ja';
  const t = T[lang];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<FeaturedPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);

  useEffect(() => {
    if (!slug) return;
    apiFetch(`/api/featured/${slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok || !d.data?.is_published) setNotFound(true);
        else setPage(d.data);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  const allPhotos = [
    ...(page?.cover_image_url ? [page.cover_image_url] : []),
    ...(page?.gallery_image_urls ?? []),
  ];

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{t.headerTitle}</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#FF9500" />
        </View>
      ) : notFound ? (
        <View style={s.center}>
          <View style={s.notFoundIconWrap}>
            <Search size={40} color="#FF9500" strokeWidth={1.5} />
          </View>
          <Text style={s.notFoundText}>{t.notFound}</Text>
          <TouchableOpacity onPress={() => router.back()} style={s.backLink}>
            <Text style={s.backLinkText}>{t.backToList}</Text>
          </TouchableOpacity>
        </View>
      ) : page ? (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Gallery */}
          {allPhotos.length > 0 && (
            <View style={s.gallery}>
              <Image source={{ uri: allPhotos[galleryIdx] }} style={s.galleryImg} contentFit="cover" />
              {allPhotos.length > 1 && (
                <>
                  {galleryIdx > 0 && (
                    <TouchableOpacity
                      onPress={() => setGalleryIdx((i) => i - 1)}
                      style={[s.galleryArrow, { left: 12 }]}
                    >
                      <Text style={s.galleryArrowText}>‹</Text>
                    </TouchableOpacity>
                  )}
                  {galleryIdx < allPhotos.length - 1 && (
                    <TouchableOpacity
                      onPress={() => setGalleryIdx((i) => i + 1)}
                      style={[s.galleryArrow, { right: 12 }]}
                    >
                      <Text style={s.galleryArrowText}>›</Text>
                    </TouchableOpacity>
                  )}
                  <View style={s.galleryDots}>
                    {allPhotos.map((_, i) => (
                      <View key={i} style={[s.dot, i === galleryIdx && s.dotActive]} />
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

          {/* Header */}
          <View style={s.section}>
            {page.partner_name && (
              <Text style={s.partnerName}>{t.by} {page.partner_name}</Text>
            )}
            <Text style={s.spotName}>{page.spot_name}</Text>
            {page.catch_copy && <Text style={s.catchCopy}>{page.catch_copy}</Text>}

            <View style={s.tags}>
              {page.tags.map((tag, i) => (
                <View key={i} style={s.tag}>
                  <Text style={s.tagText}>{tag}</Text>
                </View>
              ))}
            </View>

            {page.description && (
              <Text style={s.description}>{page.description}</Text>
            )}
          </View>

          {/* Features */}
          {page.features.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>{t.features}</Text>
              {page.features.map((f, i) => (
                <View key={i} style={s.featureRow}>
                  <View style={s.featureDot}><Check size={14} color="#FF9500" strokeWidth={2.5} /></View>
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Recommended items */}
          {page.recommended_items.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>{t.recommended}</Text>
              {page.recommended_items.map((item, i) => (
                <View key={i} style={s.recItem}>
                  {item.image_url && (
                    <Image source={{ uri: item.image_url }} style={s.recImg} contentFit="cover" />
                  )}
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.recName}>{item.name}</Text>
                    {item.price && <Text style={s.recPrice}>{item.price}</Text>}
                    {item.description && <Text style={s.recDesc}>{item.description}</Text>}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Info */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>{t.access}</Text>
            {page.address && (
              <View style={s.infoRow}>
                <MapPin size={15} color="#FF9500" strokeWidth={2} />
                <Text style={[s.infoText, { flex: 1 }]}>{page.address}</Text>
              </View>
            )}
            {page.access && (
              <View style={s.infoRow}>
                <Train size={15} color="#FF9500" strokeWidth={2} />
                <Text style={[s.infoText, { flex: 1 }]}>{page.access}</Text>
              </View>
            )}
            {page.business_hours && (
              <View style={s.infoRow}>
                <Clock size={15} color="#FF9500" strokeWidth={2} />
                <Text style={[s.infoText, { flex: 1 }]}>{page.business_hours}</Text>
              </View>
            )}
            {page.phone && (
              <View style={s.infoRow}>
                <Phone size={15} color="#FF9500" strokeWidth={2} />
                <Text style={[s.infoText, { flex: 1 }]}>{page.phone}</Text>
              </View>
            )}
            {page.congestion_info && (
              <View style={s.infoRow}>
                <Users size={15} color="#FF9500" strokeWidth={2} />
                <Text style={[s.infoText, { flex: 1 }]}>{page.congestion_info}</Text>
              </View>
            )}
          </View>

          {/* Links */}
          {(page.website || page.instagram || page.address) && (
            <View style={[s.section, { gap: 10 }]}>
              {page.address && (
                <TouchableOpacity
                  onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(page.address!)}`)}
                  style={s.mapBtn}
                >
                  <Text style={s.mapBtnText}>{t.viewMap}</Text>
                </TouchableOpacity>
              )}
              {page.website && (
                <TouchableOpacity
                  onPress={() => Linking.openURL(page.website!)}
                  style={[s.mapBtn, { backgroundColor: '#4a3034' }]}
                >
                  <Text style={s.mapBtnText}>{t.viewSite}</Text>
                </TouchableOpacity>
              )}
              {page.instagram && (
                <TouchableOpacity
                  onPress={() => Linking.openURL(page.instagram!)}
                  style={[s.mapBtn, { backgroundColor: '#C13584' }]}
                >
                  <Text style={s.mapBtnText}>{t.viewInsta}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f2f2f7' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: '#fff', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#f0dfe3',
    alignItems: 'center', justifyContent: 'center',
  },
  backArrow: { fontSize: 18, color: '#4a3034' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#1c1c1e' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  notFoundIconWrap: { width: 80, height: 80, borderRadius: 24, backgroundColor: '#FFF3E0', alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: 17, color: '#4a3034', fontWeight: '700', textAlign: 'center' },
  backLink: { padding: 8 },
  backLinkText: { fontSize: 15, color: '#FF9500', fontWeight: '700' },
  scroll: { flex: 1 },
  content: {},
  gallery: { position: 'relative' },
  galleryImg: { width: '100%', height: 280 },
  galleryArrow: {
    position: 'absolute', top: '50%', marginTop: -24,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  galleryArrowText: { color: '#fff', fontSize: 26, fontWeight: '700' },
  galleryDots: {
    position: 'absolute', bottom: 12, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive: { backgroundColor: '#fff' },
  section: { padding: 20, gap: 10 },
  partnerName: { fontSize: 13, color: '#9b7b82' },
  spotName: { fontSize: 28, fontWeight: '900', color: '#1c1c1e', lineHeight: 36, letterSpacing: -0.5 },
  catchCopy: { fontSize: 16, color: '#4a3034', lineHeight: 24 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
    backgroundColor: '#fff3e8', borderWidth: 1, borderColor: '#ffd0b0',
  },
  tagText: { fontSize: 13, fontWeight: '700', color: '#CC6600' },
  description: { fontSize: 15, color: '#4a3034', lineHeight: 26 },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: '#1c1c1e' },
  featureRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  featureDot: { marginTop: 3 },
  featureText: { flex: 1, fontSize: 15, color: '#4a3034', lineHeight: 22 },
  recItem: { flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#f0dfe3' },
  recImg: { width: 80, height: 80, borderRadius: 12 },
  recName: { fontSize: 15, fontWeight: '800', color: '#1c1c1e' },
  recPrice: { fontSize: 13, color: '#FF9500', fontWeight: '700' },
  recDesc: { fontSize: 13, color: '#4a3034', lineHeight: 20 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoText: { fontSize: 14, color: '#4a3034', lineHeight: 22 },
  mapBtn: {
    height: 52, borderRadius: 999, backgroundColor: '#ff8fa5',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3,
  },
  mapBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },
});
