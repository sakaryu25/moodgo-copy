import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarClock, Check, ChevronLeft, Clock, MapPin, Phone, Search, Train, Users } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';

const { width: W } = Dimensions.get('window');
// 記事感を出す明朝系フォント（OS標準・Webフォント不要）
const SERIF = Platform.select({ ios: 'Hiragino Mincho ProN', android: 'serif', default: 'serif' });

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

const ACCENT = '#F26A3D';
const PAPER = '#FBF9F6';
const INK = '#23201E';
const SUB = '#6E6A66';
const LINE = '#ECE5DE';

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
  if (end && today > end) return { label: '終了', color: '#9b8f88' };
  if (start || end) return { label: '開催中', color: '#1D9E75' };
  return null;
}

function hasHours(h?: Hours): boolean {
  if (!h) return false;
  return WEEKDAYS.some(({ key }) => {
    const d = h[key] as DayHours | undefined;
    return d && (d.closed || d.open || d.close);
  }) || !!h.note;
}

// 記事セクションの見出し（英語キッカー＋明朝の和題）
function SectionHeading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <View style={s.secHead}>
      <Text style={s.secKicker}>{kicker}</Text>
      <Text style={s.secTitle}>{title}</Text>
    </View>
  );
}

export default function FeatureSpotPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [spot, setSpot] = useState<FeaturedSpot | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
  const cover = allPhotos[0];
  const extraPhotos = allPhotos.slice(1);

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

  const BackButton = (
    <TouchableOpacity onPress={() => router.back()} style={[s.backBtn, { top: insets.top + 6 }]} activeOpacity={0.8}>
      <ChevronLeft size={22} color="#fff" strokeWidth={2.4} />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  if (notFound || !spot) {
    return (
      <View style={[s.root, s.center, { paddingTop: insets.top }]}>
        <View style={s.notFoundIconWrap}><Search size={36} color={ACCENT} strokeWidth={1.5} /></View>
        <Text style={s.notFoundText}>ページが見つかりませんでした</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <Text style={s.backLinkText}>← 特集に戻る</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
        bounces={false}
      >
        {/* ── ヒーロー（全面・記事扉）── */}
        <View style={s.hero}>
          {cover ? (
            <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#E6DED6' }]} />
          )}
          <LinearGradient
            colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.62)']}
            locations={[0, 0.4, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[s.heroText, { paddingBottom: 22 }]}>
            {!!spot.location && <Text style={s.heroKicker}>{spot.location}</Text>}
            <Text style={s.heroTitle}>{spot.title}</Text>
          </View>
        </View>

        {/* ── リード（キャッチ）＋本文 ── */}
        <View style={s.body}>
          {!!spot.catch_copy && <Text style={s.lead}>{spot.catch_copy}</Text>}

          {!!(spot.tags && spot.tags.length) && (
            <View style={s.tags}>
              {spot.tags.map((t, i) => (
                <Text key={i} style={s.tag}>#{t}</Text>
              ))}
            </View>
          )}

          {!!spot.description && <Text style={s.paragraph}>{spot.description}</Text>}
        </View>

        {/* ── 追加写真ストリップ ── */}
        {extraPhotos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stripContent}>
            {extraPhotos.map((p, i) => (
              <Image key={i} source={{ uri: p }} style={s.stripImg} contentFit="cover" />
            ))}
          </ScrollView>
        )}

        {/* ── 特徴 ── */}
        {!!(spot.features && spot.features.length) && (
          <View style={s.section}>
            <SectionHeading kicker="FEATURES" title="この店のいいところ" />
            {spot.features.map((f, i) => (
              <View key={i} style={s.featureRow}>
                <Check size={15} color={ACCENT} strokeWidth={2.6} />
                <Text style={s.featureText}>{f}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── メニュー ── */}
        {menuByCategory.length > 0 && (
          <View style={s.section}>
            <SectionHeading kicker="MENU" title="メニュー" />
            {menuByCategory.map((grp, gi) => (
              <View key={gi}>
                {!!grp.category && <Text style={s.menuCategory}>{grp.category}</Text>}
                {grp.items.map((item, i) => (
                  <View key={i} style={[s.menuRow, i < grp.items.length - 1 && s.menuRowBorder]}>
                    {!!item.image_url && (
                      <Image source={{ uri: item.image_url }} style={s.menuImg} contentFit="cover" />
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={s.menuNameRow}>
                        <Text style={s.menuName}>{item.name}</Text>
                        {!!item.price && <Text style={s.menuPrice}>{item.price}</Text>}
                      </View>
                      {!!item.description && <Text style={s.menuDesc}>{item.description}</Text>}
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* ── 期間限定イベント ── */}
        {!!(spot.events && spot.events.length) && (
          <View style={s.section}>
            <SectionHeading kicker="LIMITED" title="期間限定イベント" />
            {spot.events.map((ev, i) => {
              const st = eventStatus(ev);
              const period = (ev.start_date || ev.end_date)
                ? `${fmtMd(ev.start_date)}${ev.end_date ? `〜${fmtMd(ev.end_date)}` : '〜'}`
                : '';
              return (
                <View key={i} style={s.eventCard}>
                  {!!ev.image_url && <Image source={{ uri: ev.image_url }} style={s.eventImg} contentFit="cover" />}
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={s.eventTopRow}>
                      {st && (
                        <View style={[s.eventBadge, { backgroundColor: st.color }]}>
                          <Text style={s.eventBadgeText}>{st.label}</Text>
                        </View>
                      )}
                      {!!period && (
                        <View style={s.eventPeriod}>
                          <CalendarClock size={13} color={ACCENT} strokeWidth={2} />
                          <Text style={s.eventPeriodText}>{period}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.eventTitle}>{ev.title}</Text>
                    {!!ev.description && <Text style={s.eventDesc}>{ev.description}</Text>}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* ── 営業時間 ── */}
        {(hasHours(spot.hours) || spot.closed_days) && (
          <View style={s.section}>
            <SectionHeading kicker="HOURS" title="営業時間" />
            {hasHours(spot.hours) && (
              <View style={s.hoursTable}>
                {WEEKDAYS.map(({ key, label }, idx) => {
                  const d = (spot.hours?.[key] ?? {}) as DayHours;
                  const txt = d.closed ? '定休日' : (d.open || d.close) ? `${d.open ?? ''}〜${d.close ?? ''}` : '—';
                  return (
                    <View key={key} style={[s.hoursRow, idx < WEEKDAYS.length - 1 && s.menuRowBorder]}>
                      <Text style={s.hoursDay}>{label}</Text>
                      <Text style={[s.hoursVal, d.closed && { color: '#c0392b' }]}>{txt}</Text>
                    </View>
                  );
                })}
              </View>
            )}
            {!!spot.hours?.note && <Text style={s.hoursNote}>※ {spot.hours.note}</Text>}
            {!!spot.closed_days && <Text style={s.hoursNote}>定休日：{spot.closed_days}</Text>}
          </View>
        )}

        {/* ── 情報 ── */}
        {(spot.address || spot.access || spot.phone || spot.congestion_info) && (
          <View style={s.section}>
            <SectionHeading kicker="ACCESS" title="アクセス・情報" />
            {!!spot.address && (
              <View style={s.infoRow}><MapPin size={15} color={ACCENT} strokeWidth={2} /><Text style={s.infoText}>{spot.address}</Text></View>
            )}
            {!!spot.access && (
              <View style={s.infoRow}><Train size={15} color={ACCENT} strokeWidth={2} /><Text style={s.infoText}>{spot.access}</Text></View>
            )}
            {!!spot.phone && (
              <View style={s.infoRow}><Phone size={15} color={ACCENT} strokeWidth={2} /><Text style={s.infoText}>{spot.phone}</Text></View>
            )}
            {!!spot.congestion_info && (
              <View style={s.infoRow}><Users size={15} color={ACCENT} strokeWidth={2} /><Text style={s.infoText}>{spot.congestion_info}</Text></View>
            )}
          </View>
        )}

        {/* ── リンク ── */}
        {(spot.website || spot.instagram || spot.address) && (
          <View style={[s.section, { gap: 10 }]}>
            {!!spot.address && (
              <TouchableOpacity
                onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(spot.address!)}`)}
                style={s.linkBtn} activeOpacity={0.85}
              >
                <Text style={s.linkBtnText}>Googleマップで見る</Text>
              </TouchableOpacity>
            )}
            {!!spot.website && (
              <TouchableOpacity onPress={() => Linking.openURL(spot.website!)} style={[s.linkBtn, s.linkBtnDark]} activeOpacity={0.85}>
                <Text style={s.linkBtnText}>公式サイトを見る</Text>
              </TouchableOpacity>
            )}
            {!!spot.instagram && (
              <TouchableOpacity onPress={() => Linking.openURL(spot.instagram!)} style={[s.linkBtn, { backgroundColor: '#C13584' }]} activeOpacity={0.85}>
                <Text style={s.linkBtnText}>Instagramを見る</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {BackButton}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: PAPER },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  notFoundIconWrap: { width: 78, height: 78, borderRadius: 22, backgroundColor: '#F6E7DF', alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: 16, color: INK, fontWeight: '700', textAlign: 'center', fontFamily: SERIF },
  backLinkText: { fontSize: 15, color: ACCENT, fontWeight: '700' },

  backBtn: {
    position: 'absolute', left: 14, width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center',
  },

  // ヒーロー
  hero: { width: W, height: 360, justifyContent: 'flex-end', backgroundColor: '#E6DED6' },
  heroText: { paddingHorizontal: 22 },
  heroKicker: { color: 'rgba(255,255,255,0.92)', fontSize: 12, letterSpacing: 2, marginBottom: 8, fontWeight: '700' },
  heroTitle: { color: '#fff', fontSize: 30, lineHeight: 42, fontFamily: SERIF, letterSpacing: 0.5 },

  // 本文
  body: { paddingHorizontal: 22, paddingTop: 22 },
  lead: { fontFamily: SERIF, fontSize: 19, lineHeight: 32, color: INK },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  tag: { fontSize: 13, color: ACCENT, fontWeight: '700' },
  paragraph: { fontFamily: SERIF, fontSize: 15.5, lineHeight: 30, color: '#3C3833', marginTop: 16 },

  // 写真ストリップ
  stripContent: { paddingHorizontal: 22, paddingTop: 20, gap: 10 },
  stripImg: { width: 150, height: 104, borderRadius: 10, backgroundColor: '#E6DED6' },

  // セクション
  section: { paddingHorizontal: 22, paddingTop: 30 },
  secHead: { marginBottom: 16 },
  secKicker: { fontSize: 11, letterSpacing: 2.5, color: ACCENT, fontWeight: '800', marginBottom: 4 },
  secTitle: { fontSize: 21, fontFamily: SERIF, color: INK, letterSpacing: 0.3 },

  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 10 },
  featureText: { flex: 1, fontSize: 15, lineHeight: 23, color: '#3C3833' },

  // メニュー
  menuCategory: { fontSize: 12, fontWeight: '800', color: ACCENT, letterSpacing: 1, marginTop: 8, marginBottom: 4 },
  menuRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 13 },
  menuRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  menuImg: { width: 62, height: 62, borderRadius: 8, backgroundColor: '#E6DED6' },
  menuNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  menuName: { flex: 1, fontSize: 16, fontFamily: SERIF, color: INK },
  menuPrice: { fontSize: 14, color: ACCENT, fontWeight: '700' },
  menuDesc: { fontSize: 13, lineHeight: 20, color: SUB, marginTop: 3 },

  // イベント
  eventCard: { flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: LINE, marginBottom: 10 },
  eventImg: { width: 76, height: 76, borderRadius: 10, backgroundColor: '#E6DED6' },
  eventTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  eventBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  eventBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  eventPeriod: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eventPeriodText: { fontSize: 12, fontWeight: '700', color: ACCENT },
  eventTitle: { fontSize: 16, fontFamily: SERIF, color: INK },
  eventDesc: { fontSize: 13, lineHeight: 20, color: '#3C3833' },

  // 営業時間
  hoursTable: { backgroundColor: '#fff', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: LINE, paddingHorizontal: 14 },
  hoursRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11 },
  hoursDay: { fontSize: 14, fontWeight: '700', color: INK, width: 28 },
  hoursVal: { fontSize: 14, color: '#3C3833' },
  hoursNote: { fontSize: 13, color: SUB, lineHeight: 22, marginTop: 8 },

  // 情報・リンク
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 11 },
  infoText: { flex: 1, fontSize: 14.5, lineHeight: 22, color: '#3C3833' },
  linkBtn: { height: 52, borderRadius: 999, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  linkBtnDark: { backgroundColor: '#4a3034' },
  linkBtnText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
