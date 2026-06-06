/**
 * CommunityFeed.tsx
 * 全国みんなの穴場 — Masonry 2カラムタイムライン
 *
 * ホーム画面の気分セクション直下に組み込む。
 * 独自の ScrollView を持たず、HomeView の ScrollView 内に配置される。
 * アイコンはすべて lucide-react-native（ベクター生成）で統一。
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  Activity, Car, ChevronDown, Cloud, Leaf, Map, MapPin,
  MoreHorizontal, Plane, ShoppingBag, Sparkles, Star, UtensilsCrossed,
} from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { apiFetch } from '@/lib/api';
import ReportModal from './ReportModal';

// ─── Design tokens ───────────────────────────────────────────────────────────
const PINK   = '#F56CB3';
const PURPLE = '#9B6BFF';

// ─── Types ───────────────────────────────────────────────────────────────────
type FeedItem = {
  id: string;
  spot_name: string;
  prefecture: string;
  description: string | null;
  address: string | null;
  image_urls: string[] | null;
  auto_tags: string[] | null;
  created_at: string;
};

type IconComp = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number; fill?: string }>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'たった今';
  if (m < 60)  return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 7)   return d === 1 ? '昨日' : `${d}日前`;
  return `${Math.floor(d / 7)}週間前`;
}

// spot_name の文字コードから淡いパステル色を生成
const AVATAR_BG = ['#FDEBD0','#D5F5E3','#D6EAF8','#E8DAEF','#D1F2EB','#FDCEDF','#FFF3CD','#E8E0FF'];
function avatarBg(name: string): string {
  return AVATAR_BG[(name.charCodeAt(0) ?? 0) % AVATAR_BG.length];
}

// auto_tags から代表アイコン（lucide）と色を取得
function tagIcon(tags: string[] | null): { Icon: IconComp; color: string } {
  if (tags) {
    if (tags.includes('#お腹すいた'))         return { Icon: UtensilsCrossed, color: '#E67E22' };
    if (tags.includes('#まったりしたい'))      return { Icon: Cloud,          color: '#6BA3BE' };
    if (tags.includes('#自然感じたい'))        return { Icon: Leaf,           color: '#27AE60' };
    if (tags.includes('#わいわい楽しみたい'))  return { Icon: Sparkles,       color: '#E91E8C' };
    if (tags.includes('#ドライブしたい'))      return { Icon: Car,            color: '#2980B9' };
    if (tags.includes('#体動かしたい'))        return { Icon: Activity,       color: '#16A085' };
    if (tags.includes('#遠くに行きたい'))      return { Icon: Plane,          color: '#7B68EE' };
    if (tags.includes('#ショッピング'))        return { Icon: ShoppingBag,    color: '#E91E8C' };
    if (tags.includes('#穴場スポット'))        return { Icon: Map,            color: PURPLE };
  }
  return { Icon: MapPin, color: PURPLE };
}

// ─── Stars（lucide Star を5つ）─────────────────────────────────────────────────
function Stars({ n = 5 }: { n?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[1,2,3,4,5].map(i => (
        <Star
          key={i}
          size={11}
          color={i <= n ? '#F59E0B' : '#E5E7EB'}
          fill={i <= n ? '#F59E0B' : '#E5E7EB'}
          strokeWidth={0}
        />
      ))}
    </View>
  );
}

// ─── UserRow ─────────────────────────────────────────────────────────────────
function UserRow({ item, onReport }: { item: FeedItem; onReport: (i: FeedItem) => void }) {
  const bg = avatarBg(item.spot_name);
  const { Icon, color } = tagIcon(item.auto_tags);
  return (
    <View style={s.userRow}>
      <View style={[s.avatar, { backgroundColor: bg }]}>
        <Icon size={13} color={color} strokeWidth={2} />
      </View>
      <Text style={s.userName}>MoodGoユーザー</Text>
      <Text style={s.timestamp}>{relativeTime(item.created_at)}</Text>
      {/* ⋯ → 報告（adminへ） */}
      <TouchableOpacity
        onPress={(e) => { e.stopPropagation?.(); onReport(item); }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <MoreHorizontal size={18} color="#9CA3AF" strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

// ─── StatusRow（星評価のみ）─────────────────────────────────────────────────
function StatusRow() {
  return (
    <View style={s.statusRow}>
      <Stars n={5} />
    </View>
  );
}

// ─── LocationBadge ───────────────────────────────────────────────────────────
function LocationBadge({ prefecture, spotName }: { prefecture: string; spotName: string }) {
  const label = prefecture ? `${prefecture} / ${spotName}` : spotName;
  return (
    <View style={s.badge}>
      <MapPin size={10} color="#fff" strokeWidth={2.2} />
      <Text style={s.badgeText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// カードタップ → 詳細ページへ
function openSpot(id: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  router.push({ pathname: '/community-spot', params: { id } });
}

// ─── PhotoCard ───────────────────────────────────────────────────────────────
function PhotoCard({ item, onReport }: { item: FeedItem; onReport: (i: FeedItem) => void }) {
  const imgUri = item.image_urls?.[0];
  const hasReview = item.description && item.description.length > 5;
  const { Icon, color } = tagIcon(item.auto_tags);

  return (
    <TouchableOpacity style={s.card} activeOpacity={0.85} onPress={() => openSpot(item.id)}>
      {/* Image area */}
      <View style={s.imgWrap}>
        {imgUri ? (
          <Image
            source={{ uri: imgUri }}
            style={s.img}
            contentFit="cover"
            transition={300}
          />
        ) : (
          // 画像なし → グラデーションプレースホルダー（タグアイコン）
          <LinearGradient
            colors={['#C5D8F0', '#A8C8E8']}
            style={s.img}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Icon size={34} color={color} strokeWidth={1.6} />
          </LinearGradient>
        )}
        {/* 右下ロケーションバッジ */}
        <LocationBadge prefecture={item.prefecture} spotName={item.spot_name} />
      </View>

      {/* Body */}
      <View style={s.cardBody}>
        {hasReview && (
          <Text style={s.reviewText} numberOfLines={3}>
            {item.description}
          </Text>
        )}
        <StatusRow />
        <UserRow item={item} onReport={onReport} />
      </View>
    </TouchableOpacity>
  );
}

// ─── TextCard ────────────────────────────────────────────────────────────────
function TextCard({ item, onReport }: { item: FeedItem; onReport: (i: FeedItem) => void }) {
  const { Icon, color } = tagIcon(item.auto_tags);
  const hasReview = item.description && item.description.length > 5;
  const bg = avatarBg(item.spot_name);

  return (
    <TouchableOpacity style={s.card} activeOpacity={0.85} onPress={() => openSpot(item.id)}>
      <View style={s.cardBody}>
        {/* ヘッダー: サムネ + スポット名 */}
        <View style={s.textCardHeader}>
          <View style={[s.thumb, { backgroundColor: bg }]}>
            <Icon size={22} color={color} strokeWidth={1.8} />
          </View>
          <View style={s.thumbRight}>
            <View style={s.prefRow}>
              <MapPin size={10} color="#9CA3AF" strokeWidth={2} />
              <Text style={s.prefLabel}>{item.prefecture || item.address?.slice(0, 6)}</Text>
            </View>
            <Text style={s.spotName} numberOfLines={2}>{item.spot_name}</Text>
          </View>
        </View>

        <StatusRow />

        {hasReview && (
          <Text style={[s.reviewText, { marginTop: 8 }]} numberOfLines={4}>
            {item.description}
          </Text>
        )}
        <UserRow item={item} onReport={onReport} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Dummy data (API が空の場合のフォールバック) ──────────────────────────────
const DUMMY: FeedItem[] = [
  {
    id: 'd1', spot_name: '抱瓶', prefecture: '東京',
    description: '隠れた名店！地酒が豊富で料理も絶品。予約必須だけど絶対行く価値あり。',
    address: '東京都渋谷区',
    image_urls: ['https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&h=300&fit=crop'],
    auto_tags: ['#お腹すいた', '#穴場スポット'],
    created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: 'd2', spot_name: '美ら海水族館', prefecture: '沖縄',
    description: null,
    address: '沖縄県国頭郡本部町',
    image_urls: ['https://images.unsplash.com/photo-1546026423-cc4642628d2b?w=400&h=340&fit=crop'],
    auto_tags: ['#自然感じたい', '#穴場スポット'],
    created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
  },
  {
    id: 'd3', spot_name: 'ENDELEA COFFEE', prefecture: '熊本',
    description: '入口が２つあって（右から入る！）分かりにくいけど内装すっごいオシャレ！コーヒーも絶品。',
    address: '熊本市中央区',
    image_urls: null,
    auto_tags: ['#まったりしたい', '#穴場スポット'],
    created_at: new Date(Date.now() - 24 * 3600000).toISOString(),
  },
  {
    id: 'd4', spot_name: '幸せのパンケーキ 淡路島テラス', prefecture: '兵庫',
    description: '映えって感じで美味しかった。ジンジャーエールはオーガニック系のしっかりしょうがのやつ。',
    address: '兵庫県淡路市',
    image_urls: ['https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=400&h=260&fit=crop'],
    auto_tags: ['#お腹すいた', '#穴場スポット'],
    created_at: new Date(Date.now() - 5 * 3600000).toISOString(),
  },
  {
    id: 'd5', spot_name: '北野異人館', prefecture: '神戸',
    description: null,
    address: '兵庫県神戸市中央区',
    image_urls: ['https://images.unsplash.com/photo-1528360983277-13d401cdc186?w=400&h=240&fit=crop'],
    auto_tags: ['#まったりしたい', '#穴場スポット'],
    created_at: new Date(Date.now() - 2 * 24 * 3600000).toISOString(),
  },
  {
    id: 'd6', spot_name: '伏見稲荷大社', prefecture: '京都',
    description: '早朝に行くと人が少なくて最高！千本鳥居の奥の方まで歩くと絶景がある。早起き必須！',
    address: '京都府京都市伏見区',
    image_urls: null,
    auto_tags: ['#自然感じたい', '#穴場スポット'],
    created_at: new Date(Date.now() - 24 * 3600000).toISOString(),
  },
];

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CommunityFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    (async () => {
      try {
        const res = await apiFetch('/api/community-feed?limit=20');
        const data = await res.json();
        if (isMounted.current) {
          const fetched: FeedItem[] = data?.items ?? [];
          setItems(fetched.length > 0 ? fetched : DUMMY);
        }
      } catch {
        if (isMounted.current) setItems(DUMMY);
      } finally {
        if (isMounted.current) setLoading(false);
      }
    })();
    return () => { isMounted.current = false; };
  }, []);

  // 報告モーダル
  const [reportTarget, setReportTarget] = useState<FeedItem | null>(null);
  const openReport = (i: FeedItem) => setReportTarget(i);

  // 2カラムに分割。
  // ・画像なし（テキスト）カードは左右交互に振り分け → 片側だけ画像/テキストに偏らない
  // ・画像ありカードは枚数の少ない列に入れて左右をバランス
  const hasImg = (it: FeedItem) => Array.isArray(it.image_urls) && it.image_urls.length > 0;
  const leftItems: FeedItem[] = [];
  const rightItems: FeedItem[] = [];
  let textToggle = 0;
  for (const it of items) {
    if (!hasImg(it)) {
      (textToggle === 0 ? leftItems : rightItems).push(it);
      textToggle ^= 1;
    } else {
      (leftItems.length <= rightItems.length ? leftItems : rightItems).push(it);
    }
  }

  const renderItem = (item: FeedItem) => {
    const hasImg = Array.isArray(item.image_urls) && item.image_urls.length > 0;
    return hasImg
      ? <PhotoCard key={item.id} item={item} onReport={openReport} />
      : <TextCard  key={item.id} item={item} onReport={openReport} />;
  };

  return (
    <View style={s.section}>
      {/* ── セクションヘッダー ── */}
      <View style={s.sectionHeader}>
        <View>
          <Text style={s.sectionSub}>COMMUNITY PICKS</Text>
          <View style={s.titleRow}>
            <Text style={s.sectionTitle}>全国みんなの穴場</Text>
            <Map size={16} color={PURPLE} strokeWidth={2.2} />
          </View>
        </View>
      </View>

      {/* ── ローディング ── */}
      {loading && (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={PURPLE} size="small" />
        </View>
      )}

      {/* ── Masonry 2カラム ── */}
      {!loading && (
        <View style={s.columns}>
          <View style={s.column}>{leftItems.map(renderItem)}</View>
          <View style={s.column}>{rightItems.map(renderItem)}</View>
        </View>
      )}

      {/* もっと見るボタン */}
      {!loading && items.length > 0 && (
        <TouchableOpacity style={s.moreBtn} activeOpacity={0.7}>
          <Text style={s.moreBtnText}>もっと見る</Text>
          <ChevronDown size={15} color={PURPLE} strokeWidth={2.4} />
        </TouchableOpacity>
      )}

      {/* 報告モーダル（⋯から） */}
      <ReportModal
        visible={!!reportTarget}
        spotName={reportTarget?.spot_name ?? ''}
        spotAddress={reportTarget?.address ?? ''}
        suggestionId={reportTarget?.id}
        onClose={() => setReportTarget(null)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // HomeView の scrollContent (paddingHorizontal:20) 内に置かれるため水平paddingは0
  section: { paddingTop: 4 },

  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-end', marginBottom: 14,
  },
  sectionSub: {
    fontSize: 10, color: PINK, fontWeight: '700', letterSpacing: 0.4, marginBottom: 3,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 17, fontWeight: '900', color: '#1A0A2E' },
  newBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(155,107,255,0.10)', borderRadius: 99,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  newBadgeText: { fontSize: 10, fontWeight: '700', color: PURPLE },

  loadingWrap: { height: 60, alignItems: 'center', justifyContent: 'center' },

  columns: { flexDirection: 'row', gap: 10 },
  column: { flex: 1 },

  // ── Card ──
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#9B6BFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 10,
    elevation: 4,
  },

  // ── Photo card ──
  imgWrap: { position: 'relative' },
  img: {
    width: '100%', height: 170,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    position: 'absolute', bottom: 8, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3,
    maxWidth: '85%',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // ── Text card ──
  textCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  thumb: {
    width: 46, height: 46, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  thumbRight: { flex: 1, minWidth: 0 },
  prefRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3 },
  prefLabel: { fontSize: 10, color: '#9CA3AF' },
  spotName: { fontSize: 13, fontWeight: '800', color: '#1F2937', lineHeight: 18 },

  // ── Shared body ──
  cardBody: { padding: 11 },
  reviewText: {
    fontSize: 12, color: '#4B5563', lineHeight: 18,
    marginBottom: 8,
  },

  // ── Status row（星評価）──
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 9 },

  // ── User row ──
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatar: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  userName: { flex: 1, fontSize: 11, color: '#374151', fontWeight: '600' },
  timestamp: { fontSize: 10, color: '#9CA3AF' },

  // ── More button ──
  moreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 14,
  },
  moreBtnText: { fontSize: 13, fontWeight: '700', color: PURPLE },
});
