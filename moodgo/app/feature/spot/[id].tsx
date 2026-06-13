import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarClock, Check, Clock, MapPin, Phone, Search, Train, Users } from 'lucide-react-native';
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

type MenuItem = { name: string; category?: string; price?: string; description?: string; image_url?: string };
type EventItem = { title: string; start_date?: string; end_date?: string; description?: string; image_url?: string };
type DayHours = { open?: string; close?: string; closed?: boolean };
type Hours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', DayHours>> & { note?: string };

type FeaturedSpot = {
  id: string;
  title: string;
  location?: string;
  catch_copy?: string;
  description?: string;
  image_url?: string;
  gallery_image_urls?: string[];
  tags?: string[];
  features?: string[];
  address?: string;
  access?: string;
  phone?: string;
  website?: string;
  instagram?: string;
  congestion_info?: string;
  closed_days?: string;
  hours?: Hours;
  menu_items?: MenuItem[];
  events?: EventItem[];
  prefecture?: string;
};

const WEEKDAYS: { key: keyof Hours; label: string }[] = [
  { key: 'mon', label: '月' }, { key: 'tue', label: '火' }, { key: 'wed', label: '水' },
  { key: 'thu', label: '木' }, { key: 'fri', label: '金' }, { key: 'sat', label: '土' }, { key: 'sun', label: '日' },
];

// "2026-06-01" → "6/1"
function fmtMd(d?: string): string {
  if (!d) return '';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return d;
  return `${Number(m[2])}/${Number(m[3])}`;
}

// 期間限定イベントの開催状況（today は YYYY-MM-DD で比較）
function eventStatus(ev: EventItem): { label: string; color: string } | null {
  const today = new Date().toISOString().slice(0, 10);
  const start = ev.start_date ?? '';
  const end = ev.end_date ?? '';
  if (start && today < start) return { label: '開催予定', color: '#4D84C4' };
  if (end && today > end) return { label: '終了', color: '#9b7b82' };
  if (start || end) return { label: '開催中', color: '#16a34a' };
  return null;
}

function hasHours(h?: Hours): boolean {
  if (!h) return false;
  return WEEKDAYS.some(({ key }) => {
    const d = h[key] as DayHours | undefined;
    return d && (d.closed || d.open || d.close);
  }) || !!h.note;
}

export default function FeatureSpotPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [spot, setSpot] = useState<FeaturedSpot | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);

  useEffect(() => {
    if (!id) return;
    apiFetch(`/api/featured-pages/spot/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok || !d.data) setNotFound(true);
        else setSpot(d.data);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const allPhotos = [
    ...(spot?.image_url ? [spot.image_url] : []),
    ...(spot?.gallery_image_urls ?? []),
  ];

  // メニューをカテゴリでグルーピング
  const menuByCategory: { category: string; items: MenuItem[] }[] = (() => {
    const items = spot?.menu_items ?? [];
    if (!items.length) return [];
    const order: string[] = [];
    const map: Record<string, MenuItem[]> = {};
    for (const m of items) {
      const c = (m.category ?? '').trim() || '__none__';
      if (!map[c]) { map[c] = []; order.push(c); }
      map[c].push(m);
    }
    return order.map((c) => ({ category: c === '__none__' ? '' : c, items: map[c] }));
  })();

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>特集</Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#FF9500" />
        </View>
      ) : notFound || !spot ? (
        <View style={s.center}>
          <View style={s.notFoundIconWrap}>
            <Search size={40} color="#FF9500" strokeWidth={1.5} />
          </View>
          <Text style={s.notFoundText}>ページが見つかりませんでした</Text>
          <TouchableOpacity onPress={() => router.back()} style={s.backLink}>
            <Text style={s.backLinkText}>← 特集に戻る</Text>
          </TouchableOpacity>
        </View>
      ) : (
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
                    <TouchableOpacity onPress={() => setGalleryIdx((i) => i - 1)} style={[s.galleryArrow, { left: 12 }]}>
                      <Text style={s.galleryArrowText}>‹</Text>
                    </TouchableOpacity>
                  )}
                  {galleryIdx < allPhotos.length - 1 && (
                    <TouchableOpacity onPress={() => setGalleryIdx((i) => i + 1)} style={[s.galleryArrow, { right: 12 }]}>
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
            {spot.location ? <Text style={s.partnerName}>{spot.location}</Text> : null}
            <Text style={s.spotName}>{spot.title}</Text>
            {spot.catch_copy ? <Text style={s.catchCopy}>{spot.catch_copy}</Text> : null}

            {!!(spot.tags && spot.tags.length) && (
              <View style={s.tags}>
                {spot.tags.map((tag, i) => (
                  <View key={i} style={s.tag}><Text style={s.tagText}>{tag}</Text></View>
                ))}
              </View>
            )}

            {spot.description ? <Text style={s.description}>{spot.description}</Text> : null}
          </View>

          {/* Features */}
          {!!(spot.features && spot.features.length) && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>特徴</Text>
              {spot.features.map((f, i) => (
                <View key={i} style={s.featureRow}>
                  <View style={s.featureDot}><Check size={14} color="#FF9500" strokeWidth={2.5} /></View>
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}
            </View>
          )}

          {/* メニュー */}
          {menuByCategory.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>メニュー</Text>
              {menuByCategory.map((grp, gi) => (
                <View key={gi} style={{ gap: 10 }}>
                  {grp.category ? <Text style={s.menuCategory}>{grp.category}</Text> : null}
                  {grp.items.map((item, i) => (
                    <View key={i} style={s.recItem}>
                      {item.image_url ? (
                        <Image source={{ uri: item.image_url }} style={s.recImg} contentFit="cover" />
                      ) : null}
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={s.recName}>{item.name}</Text>
                        {item.price ? <Text style={s.recPrice}>{item.price}</Text> : null}
                        {item.description ? <Text style={s.recDesc}>{item.description}</Text> : null}
                      </View>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}

          {/* 期間限定イベント */}
          {!!(spot.events && spot.events.length) && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>期間限定イベント</Text>
              {spot.events.map((ev, i) => {
                const st = eventStatus(ev);
                const period = (ev.start_date || ev.end_date)
                  ? `${fmtMd(ev.start_date)}${ev.end_date ? `〜${fmtMd(ev.end_date)}` : '〜'}`
                  : '';
                return (
                  <View key={i} style={s.eventCard}>
                    {ev.image_url ? (
                      <Image source={{ uri: ev.image_url }} style={s.eventImg} contentFit="cover" />
                    ) : null}
                    <View style={{ flex: 1, gap: 5 }}>
                      <View style={s.eventTopRow}>
                        {st && (
                          <View style={[s.eventBadge, { backgroundColor: st.color }]}>
                            <Text style={s.eventBadgeText}>{st.label}</Text>
                          </View>
                        )}
                        {period ? (
                          <View style={s.eventPeriod}>
                            <CalendarClock size={13} color="#CC6600" strokeWidth={2} />
                            <Text style={s.eventPeriodText}>{period}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={s.eventTitle}>{ev.title}</Text>
                      {ev.description ? <Text style={s.eventDesc}>{ev.description}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* 営業時間 */}
          {(hasHours(spot.hours) || spot.closed_days) && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>営業時間</Text>
              {hasHours(spot.hours) && (
                <View style={s.hoursTable}>
                  {WEEKDAYS.map(({ key, label }) => {
                    const d = (spot.hours?.[key] ?? {}) as DayHours;
                    const txt = d.closed ? '定休日' : (d.open || d.close) ? `${d.open ?? ''}〜${d.close ?? ''}` : '—';
                    return (
                      <View key={key} style={s.hoursRow}>
                        <Text style={s.hoursDay}>{label}</Text>
                        <Text style={[s.hoursVal, d.closed && { color: '#c0392b' }]}>{txt}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
              {spot.hours?.note ? (
                <View style={s.infoRow}>
                  <Clock size={15} color="#FF9500" strokeWidth={2} />
                  <Text style={[s.infoText, { flex: 1 }]}>{spot.hours.note}</Text>
                </View>
              ) : null}
              {spot.closed_days ? (
                <Text style={s.closedDays}>定休日：{spot.closed_days}</Text>
              ) : null}
            </View>
          )}

          {/* Info */}
          {(spot.address || spot.access || spot.phone || spot.congestion_info) && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>アクセス・情報</Text>
              {spot.address ? (
                <View style={s.infoRow}>
                  <MapPin size={15} color="#FF9500" strokeWidth={2} />
                  <Text style={[s.infoText, { flex: 1 }]}>{spot.address}</Text>
                </View>
              ) : null}
              {spot.access ? (
                <View style={s.infoRow}>
                  <Train size={15} color="#FF9500" strokeWidth={2} />
                  <Text style={[s.infoText, { flex: 1 }]}>{spot.access}</Text>
                </View>
              ) : null}
              {spot.phone ? (
                <View style={s.infoRow}>
                  <Phone size={15} color="#FF9500" strokeWidth={2} />
                  <Text style={[s.infoText, { flex: 1 }]}>{spot.phone}</Text>
                </View>
              ) : null}
              {spot.congestion_info ? (
                <View style={s.infoRow}>
                  <Users size={15} color="#FF9500" strokeWidth={2} />
                  <Text style={[s.infoText, { flex: 1 }]}>{spot.congestion_info}</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Links */}
          {(spot.website || spot.instagram || spot.address) && (
            <View style={[s.section, { gap: 10 }]}>
              {spot.address ? (
                <TouchableOpacity
                  onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.address!)}`)}
                  style={s.mapBtn}
                >
                  <Text style={s.mapBtnText}>Googleマップで見る</Text>
                </TouchableOpacity>
              ) : null}
              {spot.website ? (
                <TouchableOpacity onPress={() => Linking.openURL(spot.website!)} style={[s.mapBtn, { backgroundColor: '#4a3034' }]}>
                  <Text style={s.mapBtnText}>公式サイトを見る</Text>
                </TouchableOpacity>
              ) : null}
              {spot.instagram ? (
                <TouchableOpacity onPress={() => Linking.openURL(spot.instagram!)} style={[s.mapBtn, { backgroundColor: '#C13584' }]}>
                  <Text style={s.mapBtnText}>Instagramを見る</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </ScrollView>
      )}
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

  menuCategory: { fontSize: 14, fontWeight: '800', color: '#CC6600', marginTop: 4 },
  recItem: { flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#f0dfe3' },
  recImg: { width: 80, height: 80, borderRadius: 12 },
  recName: { fontSize: 15, fontWeight: '800', color: '#1c1c1e' },
  recPrice: { fontSize: 13, color: '#FF9500', fontWeight: '700' },
  recDesc: { fontSize: 13, color: '#4a3034', lineHeight: 20 },

  eventCard: { flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#f0dfe3' },
  eventImg: { width: 80, height: 80, borderRadius: 12 },
  eventTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  eventBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  eventBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  eventPeriod: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eventPeriodText: { fontSize: 12, fontWeight: '700', color: '#CC6600' },
  eventTitle: { fontSize: 15, fontWeight: '800', color: '#1c1c1e' },
  eventDesc: { fontSize: 13, color: '#4a3034', lineHeight: 20 },

  hoursTable: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#f0dfe3', overflow: 'hidden' },
  hoursRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f5eef0' },
  hoursDay: { fontSize: 14, fontWeight: '700', color: '#4a3034', width: 28 },
  hoursVal: { fontSize: 14, color: '#1c1c1e', fontWeight: '600' },
  closedDays: { fontSize: 14, color: '#4a3034', lineHeight: 22 },

  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoText: { fontSize: 14, color: '#4a3034', lineHeight: 22 },
  mapBtn: {
    height: 52, borderRadius: 999, backgroundColor: '#ff8fa5',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3,
  },
  mapBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },
});
