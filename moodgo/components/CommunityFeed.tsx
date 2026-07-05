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
  MoreHorizontal, Plane, Search, ShoppingBag, Sparkles, Star, UtensilsCrossed, X,
} from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { apiFetch } from '@/lib/api';
import { loadJSON, saveJSON, BLOCKED_USERS_KEY } from '@/lib/storage';
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
  poster_name?: string | null;
  poster_handle?: string | null;   // @ユーザーID（匿名投稿はnull）
  poster_icon?: string | null;
  poster_id?: string | null;
  kind?: string;                 // 'suggestion'(穴場) | 'moodlog'(Moodログ)
  place_id?: string | null;      // moodlog用: 場所詳細を開くID
  place_name?: string;
  likes?: number;                // moodログのいいね数(穴場はundefined→★おすすめ度で代替)
  lat?: number | null;           // 近く順ソート用
  lng?: number | null;
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

// 2点間の距離(m)。近く順ソート用。
function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  // 投稿者がプロフィール写真を設定していれば表示（読込失敗時は気分アイコンにフォールバック）
  const [iconFailed, setIconFailed] = useState(false);
  const showPhoto = !!item.poster_icon && !iconFailed;
  return (
    <View style={s.userRow}>
      <View style={[s.avatar, { backgroundColor: bg, overflow: 'hidden' }]}>
        {showPhoto ? (
          <Image
            source={{ uri: item.poster_icon! }}
            style={{ width: 24, height: 24 }}
            contentFit="cover"
            onError={() => setIconFailed(true)}
          />
        ) : (
          <Icon size={13} color={color} strokeWidth={2} />
        )}
      </View>
      <Text style={s.userName}>{item.poster_name?.trim() || 'MoodGoユーザー'}</Text>
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

// 説明文から投稿者のおすすめ度（【おすすめ度】★N）を取り出す
function userRating(desc: string | null): number {
  const m = desc?.match(/【おすすめ度】\s*★(\d)/);
  return m ? Math.min(5, Math.max(1, Number(m[1]))) : 0;
}

// ─── StatusRow（投稿者のつけた星のみ。未記入なら非表示）────────────────────────
function StatusRow({ rating }: { rating: number }) {
  if (rating <= 0) return null;
  return (
    <View style={s.statusRow}>
      <Stars n={rating} />
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

// カードタップ → 詳細ページへ。穴場もMoodログ投稿も同じ詳細UI(/community-spot)で開く。
// （「投稿」ボタンから入る統一投稿＝Moodログも、穴場の作り込んだ詳細カードで表示する）
function openSpot(item: FeedItem) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  if (item.kind === 'blog') {
    // ブログは専用詳細へ（id は 'bp-' 接頭辞を外す）
    router.push({ pathname: '/blog-post', params: { id: item.id.replace(/^bp-/, '') } });
    return;
  }
  // 穴場(suggestion)= UUID、Moodログ(moodlog)= 'ml-<id>' を /api/community-spot が両対応。
  router.push({ pathname: '/community-spot', params: { id: item.id } });
}

// ─── KindBadge（穴場/moodログ/おすすめ の軽い区別）──────────────────────────────
function kindMeta(kind?: string): { label: string; color: string; bg: string } {
  if (kind === 'moodlog') return { label: 'moodログ', color: '#DB2777', bg: '#FCE7F3' };
  if (kind === 'blog')    return { label: 'おすすめ', color: '#2563EB', bg: '#DBEAFE' };
  return { label: '穴場', color: '#7C3AED', bg: '#EDE9FE' };  // suggestion(デフォルト)
}
function KindBadge({ kind }: { kind?: string }) {
  const m = kindMeta(kind);
  return (
    <View style={[s.kindBadge, { backgroundColor: m.bg }]}>
      <Text style={[s.kindBadgeText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

// PhotoCard / TextCard は renderTile 一本化に伴い撤去（旧2カラム描画の残骸）。

// ─── Dummy data (API が空の場合のフォールバック) ──────────────────────────────

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CommunityFeed({ full }: { full?: boolean }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<'popular' | 'near'>('popular');  // 人気/近く トグル
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [gridW, setGridW] = useState(0);
  // ── @IDユーザー検索（fullモード=みんなタブのみ表示）──
  const [uq, setUq] = useState('');
  const [uUsers, setUUsers] = useState<Array<{ handle: string; posterId: string; icon: string }>>([]);
  const [uActive, setUActive] = useState<{ handle: string } | null>(null);
  const [uItems, setUItems] = useState<FeedItem[]>([]);
  const [uLoading, setULoading] = useState(false);
  const uTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);

  const onChangeUq = (raw: string) => {
    setUq(raw);
    if (uActive) { setUActive(null); setUItems([]); }   // 入力し直したら絞り込み解除
    if (uTimer.current) clearTimeout(uTimer.current);
    const qn = raw.trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9_]/g, '');
    if (qn.length < 2) { setUUsers([]); return; }
    uTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/user-handle', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'search', query: qn }),
        });
        const d = await res.json();
        if (isMounted.current) setUUsers(Array.isArray(d?.users) ? d.users : []);
      } catch { /* noop */ }
    }, 400);
  };
  const selectUser = async (u: { handle: string }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUActive({ handle: u.handle });
    setUUsers([]);
    setUq(`@${u.handle}`);
    setULoading(true);
    try {
      const res = await apiFetch(`/api/community-feed?limit=60&posterHandle=${encodeURIComponent(u.handle)}`);
      const d = await res.json();
      if (isMounted.current) setUItems(Array.isArray(d?.items) ? d.items : []);
    } catch { if (isMounted.current) setUItems([]); }
    finally { if (isMounted.current) setULoading(false); }
  };
  const clearUser = () => { setUActive(null); setUItems([]); setUq(''); setUUsers([]); };

  useEffect(() => {
    isMounted.current = true;
    (async () => {
      try {
        const blocked = await loadJSON<string[]>(BLOCKED_USERS_KEY, []);
        if (isMounted.current) setBlockedUsers(blocked);
        const res = await apiFetch('/api/community-feed?limit=40');
        const data = await res.json();
        if (isMounted.current) {
          const fetched: FeedItem[] = data?.items ?? [];
          setItems(fetched);
        }
      } catch {
        if (isMounted.current) setItems([]);
      } finally {
        if (isMounted.current) setLoading(false);
      }
    })();
    return () => { isMounted.current = false; };
  }, []);

  // 報告モーダル
  const [reportTarget, setReportTarget] = useState<FeedItem | null>(null);
  const openReport = (i: FeedItem) => setReportTarget(i);

  // 投稿者をブロック（端末IDを保存し、以後その投稿者の投稿を非表示）
  const handleBlockUser = (deviceId: string) => {
    if (!deviceId) return;
    setBlockedUsers(prev => {
      if (prev.includes(deviceId)) return prev;
      const next = [...prev, deviceId];
      saveJSON(BLOCKED_USERS_KEY, next);
      return next;
    });
  };

  // ブロック済み投稿者の投稿を除外
  const visibleItems = items.filter(it => !it.poster_id || !blockedUsers.includes(it.poster_id));

  // 近く順: 端末の現在地を遅延取得（近くタップ時のみ・人気順は位置情報不要）
  const selectNear = async () => {
    if (coords) { setSortMode('near'); return; }
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSortMode('near');
      }
    } catch { /* 位置取得失敗時は人気順のまま */ } finally { setLocLoading(false); }
  };

  // 人気スコア: moodログ=いいね数 / 穴場=★おすすめ度（お互いの強みで統一）
  const popScore = (it: FeedItem) => (it.likes != null ? it.likes : userRating(it.description));

  // トグルで並べ替え → 8件に絞る
  const sorted = useMemo(() => {
    const arr = [...visibleItems];
    if (sortMode === 'near' && coords) {
      arr.sort((a, b) => {
        const da = a.lat != null && a.lng != null ? distM(coords.lat, coords.lng, a.lat, a.lng) : Infinity;
        const db = b.lat != null && b.lng != null ? distM(coords.lat, coords.lng, b.lat, b.lng) : Infinity;
        return da - db;
      });
    } else {
      arr.sort((a, b) => popScore(b) - popScore(a));
    }
    return full ? arr : arr.slice(0, 8);
  }, [visibleItems, sortMode, coords, full]);

  // インスタExplore風グリッド。3列の小タイルに、一定間隔で2x2の大タイルを挟む。
  const GAP = 3;
  const CELL = gridW > 0 ? (gridW - GAP * 2) / 3 : 0;  // 小タイル(3列)
  const BIG = CELL * 2 + GAP;                          // 大タイル(2x2)
  const renderTile = (item: FeedItem, size: number) => {
    const photo = item.image_urls?.[0];
    const { Icon, color } = tagIcon(item.auto_tags);
    // 種類(穴場/moodログ/おすすめ)はユーザーに見せない＝全部「1種類の投稿」として統一表示。遷移先のみ内部で出し分け。
    return (
      <TouchableOpacity key={item.id} onPress={() => openSpot(item)} onLongPress={() => openReport(item)} activeOpacity={0.85} style={[s.tile, { width: size, height: size }]}>
        {photo ? (
          <Image source={{ uri: photo }} style={s.tileImg} contentFit="cover" transition={200} />
        ) : (
          <LinearGradient colors={['#C5D8F0', '#A8C8E8']} style={[s.tileImg, { alignItems: 'center', justifyContent: 'center' }]}>
            <Icon size={Math.round(size * 0.26)} color={color} strokeWidth={1.6} />
          </LinearGradient>
        )}
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} style={s.tileScrim} pointerEvents="none" />
        <Text style={s.tileLoc} numberOfLines={1}>{item.prefecture || item.spot_name}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.section}>
      {/* ── セクションヘッダー ── */}
      <View style={s.sectionHeader}>
        {full ? <View /> : (
        <View>
          <Text style={s.sectionSub}>COMMUNITY PICKS</Text>
          <View style={s.titleRow}>
            <Text style={s.sectionTitle}>全国みんなの穴場</Text>
            <Map size={16} color={PURPLE} strokeWidth={2.2} />
          </View>
        </View>
        )}
        <View style={s.toggleRow}>
          <TouchableOpacity onPress={() => setSortMode('popular')} style={[s.toggleBtn, sortMode === 'popular' && s.toggleBtnOn]} activeOpacity={0.8}>
            <Text style={[s.toggleText, sortMode === 'popular' && s.toggleTextOn]}>人気</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={selectNear} style={[s.toggleBtn, sortMode === 'near' && s.toggleBtnOn]} activeOpacity={0.8}>
            <Text style={[s.toggleText, sortMode === 'near' && s.toggleTextOn]}>{locLoading ? '取得中…' : '近く'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── @IDユーザー検索（みんなタブのみ）── */}
      {full && (
        <View style={s.uSearchWrap}>
          <View style={s.uSearchBox}>
            <Search size={15} color="#8B88A6" strokeWidth={2.2} />
            <TextInput
              value={uq}
              onChangeText={onChangeUq}
              placeholder="@ユーザーIDで検索"
              placeholderTextColor="#B9B6CC"
              style={s.uSearchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {(uq.length > 0 || uActive) && (
              <TouchableOpacity onPress={clearUser} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X size={15} color="#8B88A6" strokeWidth={2.4} />
              </TouchableOpacity>
            )}
          </View>
          {uUsers.length > 0 && !uActive && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.uChipRow} keyboardShouldPersistTaps="handled">
              {uUsers.map((u) => (
                <TouchableOpacity key={u.handle} onPress={() => selectUser(u)} style={s.uChip} activeOpacity={0.8}>
                  <Image source={{ uri: u.icon }} style={s.uChipIcon} contentFit="cover" />
                  <Text style={s.uChipText}>@{u.handle}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {uActive && (
            <View style={s.uBanner}>
              <Text style={s.uBannerText}>@{uActive.handle} さんの投稿</Text>
              <Text style={s.uBannerCount}>{uItems.length}件</Text>
            </View>
          )}
        </View>
      )}

      {/* ── ローディング ── */}
      {(loading || uLoading) && (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={PURPLE} size="small" />
        </View>
      )}

      {/* ── 写真グリッド（インスタExplore風・大タイルを一定間隔で・タップで詳細・長押しで報告）── */}
      {!loading && !uLoading && (
        <View onLayout={(e) => setGridW(e.nativeEvent.layout.width)} style={s.grid}>
          {CELL > 0 && (() => {
            // ユーザー絞り込み中はその人の公開投稿だけ（ブロック済みは除外）
            const feed = uActive ? uItems.filter(it => !it.poster_id || !blockedUsers.includes(it.poster_id)) : sorted;
            const rows: React.ReactNode[] = [];
            let i = 0, unit = 0;
            while (i < feed.length) {
              if (unit % 2 === 0 && i + 3 <= feed.length) {
                // フィーチャー帯: 2x2大タイル＋小タイル2枚（左右交互）
                const bigLeft = unit % 4 === 0;
                const big = renderTile(feed[i], BIG);
                const col = (
                  <View key={`c${i}`} style={{ gap: GAP }}>
                    {renderTile(feed[i + 1], CELL)}
                    {renderTile(feed[i + 2], CELL)}
                  </View>
                );
                rows.push(<View key={`f${i}`} style={s.gridRow}>{bigLeft ? [big, col] : [col, big]}</View>);
                i += 3;
              } else {
                rows.push(<View key={`n${i}`} style={s.gridRow}>{feed.slice(i, i + 3).map(it => renderTile(it, CELL))}</View>);
                i += 3;
              }
              unit++;
            }
            return rows;
          })()}
        </View>
      )}

      {/* 空状態（API空/失敗時。捏造投稿は出さない＝App Store審査対策） */}
      {!loading && !uLoading && (uActive ? uItems.length === 0 : visibleItems.length === 0) && (
        <View style={s.loadingWrap}>
          <Text style={{ color: '#9CA3AF', fontSize: 13 }}>{uActive ? 'このユーザーの公開投稿はまだありません' : 'まだ投稿がありません'}</Text>
        </View>
      )}

      {/* もっと見るボタン */}
      {!loading && !full && visibleItems.length > 0 && (
        <TouchableOpacity style={s.moreBtn} activeOpacity={0.7} onPress={() => router.navigate('/blog')}>
          <Text style={s.moreBtnText}>みんなの投稿をもっと見る</Text>
          <ChevronDown size={15} color={PURPLE} strokeWidth={2.4} />
        </TouchableOpacity>
      )}

      {/* 報告モーダル（⋯から） */}
      <ReportModal
        visible={!!reportTarget}
        spotName={reportTarget?.spot_name ?? ''}
        spotAddress={reportTarget?.address ?? ''}
        suggestionId={reportTarget?.id}
        posterId={reportTarget?.poster_id ?? undefined}
        onBlockUser={handleBlockUser}
        onClose={() => setReportTarget(null)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // ── @IDユーザー検索 ──
  uSearchWrap: { marginBottom: 10, gap: 8 },
  uSearchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, height: 42,
    borderWidth: 1, borderColor: 'rgba(90,90,120,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 10, elevation: 1,
  },
  uSearchInput: { flex: 1, fontSize: 13.5, fontWeight: '600', color: '#1E1548', paddingVertical: 0 },
  uChipRow: { gap: 8, paddingRight: 8 },
  uChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff', borderRadius: 999, paddingLeft: 4, paddingRight: 12, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(90,90,120,0.08)',
  },
  uChipIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F0EDFF' },
  uChipText: { fontSize: 12.5, fontWeight: '800', color: '#5A8DFF' },
  uBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F4F1FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  uBannerText: { fontSize: 12.5, fontWeight: '800', color: '#7A5CFF' },
  uBannerCount: { fontSize: 11.5, fontWeight: '700', color: '#8B88A6' },

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
  kindBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 7 },
  kindBadgeText: { fontSize: 9.5, fontWeight: '800' },
  grid: { gap: 3 },
  gridRow: { flexDirection: 'row', gap: 3 },
  tile: { borderRadius: 4, overflow: 'hidden', backgroundColor: '#E8E0FF', position: 'relative' },
  tileImg: { width: '100%', height: '100%' },
  tileKind: { position: 'absolute', top: 5, left: 5, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1.5 },
  tileKindText: { fontSize: 8, fontWeight: '800' },
  tileScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  tileLoc: { position: 'absolute', left: 5, right: 5, bottom: 4, color: '#fff', fontSize: 9.5, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },

  // 人気/近く トグル
  toggleRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(155,107,255,0.08)' },
  toggleBtnOn: { backgroundColor: PURPLE },
  toggleText: { fontSize: 12, fontWeight: '800', color: PURPLE },
  toggleTextOn: { color: '#fff' },
});
