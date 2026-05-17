import { Image } from 'expo-image';
import { Camera, Star } from 'lucide-react-native';
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FeaturedPageSummary } from '@/types/app';
import { useRouter } from 'expo-router';

type Props = {
  featuredList: FeaturedPageSummary[];
  featuredListLoading: boolean;
  lang?: 'ja' | 'en';
};

const T = {
  ja: {
    title: '特集',
    sub: 'MoodGoが厳選したスポット',
    empty: '特集コンテンツを読み込み中…\nインターネット接続を確認してください。',
  },
  en: {
    title: 'Featured',
    sub: 'Spots curated by MoodGo',
    empty: 'Loading featured content…\nPlease check your internet connection.',
  },
};

export default function FeaturedView({ featuredList, featuredListLoading, lang = 'ja' }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = T[lang];

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 80 }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={s.pageTitle}>{t.title}</Text>
      <Text style={s.pageSub}>{t.sub}</Text>

      {featuredListLoading ? (
        <View style={s.loading}>
          <ActivityIndicator size="large" color="#FF6B35" />
        </View>
      ) : featuredList.length === 0 ? (
        <View style={s.emptyBox}>
          <Star size={52} color="#C7C7CC" strokeWidth={1.5} />
          <Text style={s.emptyText}>{t.empty}</Text>
        </View>
      ) : (
        featuredList.map((item) => (
          <TouchableOpacity
            key={item.id}
            onPress={() => router.push({ pathname: '/feature/[slug]', params: { slug: item.slug } })}
            style={s.card}
            activeOpacity={0.85}
          >
            {item.cover_image_url ? (
              <Image source={{ uri: item.cover_image_url }} style={s.cardImg} contentFit="cover" />
            ) : (
              <View style={[s.cardImg, s.cardImgPlaceholder]}>
                <Camera size={40} color="#C7C7CC" strokeWidth={1.5} />
              </View>
            )}
            <View style={s.cardBody}>
              <Text style={s.cardTitle} numberOfLines={2}>{item.spot_name}</Text>
              {item.catch_copy ? (
                <Text style={s.cardCopy} numberOfLines={2}>{item.catch_copy}</Text>
              ) : null}
              <View style={s.tags}>
                {item.tags.slice(0, 3).map((tag, i) => (
                  <View key={i} style={s.tag}>
                    <Text style={s.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
              {item.partner_name ? (
                <Text style={s.partnerName}>by {item.partner_name}</Text>
              ) : null}
            </View>
          </TouchableOpacity>
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
  loading: { paddingVertical: 60, alignItems: 'center' },
  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 16 },
  emptyText: { fontSize: 15, color: '#8E8E93', textAlign: 'center', lineHeight: 24 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  cardImg: { width: '100%', height: 180 },
  cardImgPlaceholder: { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 14, gap: 6 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#000', lineHeight: 24 },
  cardCopy: { fontSize: 14, color: '#3C3C43', lineHeight: 20 },
  tags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
    backgroundColor: '#F2F2F7',
  },
  tagText: { fontSize: 12, fontWeight: '500', color: '#6D6D72' },
  partnerName: { fontSize: 12, color: '#8E8E93', marginTop: 2 },
});
