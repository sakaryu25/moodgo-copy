/**
 * CommunityFeed.tsx
 * 全国みんなの穴場 — Pinterest風 2カラム Masonry タイムライン
 *
 *  - ホーム埋め込み(非full): 新着順・最大8件(2×4)＋「もっと見る」
 *  - 一覧ページ(full=BlogView): 全件・無限スクロール(親のloadMoreKeyで追加読み込み)
 *  カードは components/community/*（PostGrid/PostCard/ImageCard/TextCard/UserInfo）。
 */
import { router } from 'expo-router';
import { ChevronDown, Map } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { apiFetch } from '@/lib/api';
import { loadJSON, saveJSON, BLOCKED_USERS_KEY } from '@/lib/storage';
import ReportModal from './ReportModal';
import PostGrid from './community/PostGrid';
import { parsePost, type FeedLike, type Post } from './community/postTypes';

const PURPLE = '#9B6BFF';
const PAGE = 30;

type FeedItem = FeedLike & {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  place_id?: string | null;
};

// 2点間距離(m)。近く順ソート用。
function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function userRating(desc: string | null): number {
  const m = desc?.match(/【おすすめ度】\s*★(\d)/);
  return m ? Math.min(5, Math.max(1, Number(m[1]))) : 0;
}

// カードタップ → 詳細(/community-spot)。穴場(UUID)/Moodログ(ml-)は API が両対応。
function openSpot(item: FeedItem) {
  if (item.kind === 'blog') { router.push({ pathname: '/blog-post', params: { id: item.id.replace(/^bp-/, '') } }); return; }
  router.push({ pathname: '/community-spot', params: { id: item.id } });
}

type CommunityFeedProps = {
  full?: boolean;
  sortMode?: 'popular' | 'near';
  coords?: { lat: number; lng: number } | null;
  posterHandle?: string | null;
  loadMoreKey?: number;   // full: 親(BlogView)が末尾スクロールで+1して追加読み込みを促す
};

export default function CommunityFeed({ full, sortMode: propSort, coords: propCoords, posterHandle, loadMoreKey }: CommunityFeedProps) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [width, setWidth] = useState(0);
  const [uItems, setUItems] = useState<FeedItem[]>([]);
  const [uLoading, setULoading] = useState(false);
  const isMounted = useRef(true);
  const offsetRef = useRef(0);

  // @ID絞り込み（full: 検索UIは親ヘッダー・ここは取得のみ）
  useEffect(() => {
    if (!full) return;
    if (!posterHandle) { setUItems([]); setULoading(false); return; }
    let cancelled = false;
    setULoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/community-feed?limit=60&posterHandle=${encodeURIComponent(posterHandle)}`);
        const d = await res.json();
        if (!cancelled && isMounted.current) setUItems(Array.isArray(d?.items) ? d.items : []);
      } catch { if (!cancelled && isMounted.current) setUItems([]); }
      finally { if (!cancelled && isMounted.current) setULoading(false); }
    })();
    return () => { cancelled = true; };
  }, [full, posterHandle]);

  // 初回ロード
  useEffect(() => {
    isMounted.current = true;
    (async () => {
      try {
        const blocked = await loadJSON<string[]>(BLOCKED_USERS_KEY, []);
        if (isMounted.current) setBlockedUsers(blocked);
        const res = await apiFetch(`/api/community-feed?limit=${PAGE}&offset=0`);
        const data = await res.json();
        if (isMounted.current) {
          const fetched: FeedItem[] = data?.items ?? [];
          setItems(fetched);
          offsetRef.current = fetched.length;
          setHasMore(fetched.length >= PAGE);
        }
      } catch { if (isMounted.current) setItems([]); }
      finally { if (isMounted.current) setLoading(false); }
    })();
    return () => { isMounted.current = false; };
  }, []);

  // 無限スクロール（full時・親のloadMoreKeyが増えたら次ページ）
  useEffect(() => {
    if (!full || loadMoreKey === undefined || loadMoreKey === 0) return;
    if (loadingMore || !hasMore || posterHandle) return;
    let cancelled = false;
    setLoadingMore(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/community-feed?limit=${PAGE}&offset=${offsetRef.current}`);
        const data = await res.json();
        const more: FeedItem[] = data?.items ?? [];
        if (!cancelled && isMounted.current) {
          setItems((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            const add = more.filter((m) => !seen.has(m.id));
            offsetRef.current += more.length;
            return [...prev, ...add];
          });
          setHasMore(more.length >= PAGE);
        }
      } catch { /* noop */ }
      finally { if (!cancelled && isMounted.current) setLoadingMore(false); }
    })();
    return () => { cancelled = true; };
  }, [loadMoreKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 報告モーダル
  const [reportTarget, setReportTarget] = useState<FeedItem | null>(null);
  const handleBlockUser = (deviceId: string) => {
    if (!deviceId) return;
    setBlockedUsers((prev) => {
      if (prev.includes(deviceId)) return prev;
      const next = [...prev, deviceId];
      saveJSON(BLOCKED_USERS_KEY, next);
      return next;
    });
  };

  const visibleItems = items.filter((it) => !it.poster_id || !blockedUsers.includes(it.poster_id));

  // 並び順: 非full=新着順(created_at desc)・最大8。full=親ヘッダーのsort(人気/近く)。
  const effSort = full ? (propSort ?? 'popular') : 'new';
  const effCoords = full ? (propCoords ?? null) : null;
  const posts: Post[] = useMemo(() => {
    let arr = [...visibleItems];
    if (effSort === 'near' && effCoords) {
      arr.sort((a, b) => {
        const da = a.lat != null && a.lng != null ? distM(effCoords.lat, effCoords.lng, a.lat, a.lng) : Infinity;
        const db = b.lat != null && b.lng != null ? distM(effCoords.lat, effCoords.lng, b.lat, b.lng) : Infinity;
        return da - db;
      });
    } else if (effSort === 'popular') {
      arr.sort((a, b) => (b.likes != null ? b.likes : userRating(b.description)) - (a.likes != null ? a.likes : userRating(a.description)));
    } else {
      arr.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));  // 新着順
    }
    if (!full) arr = arr.slice(0, 8);
    return arr.map(parsePost);
  }, [visibleItems, effSort, effCoords, full]);

  // @ID絞り込み中はその人の公開投稿
  const uPosts: Post[] = useMemo(
    () => uItems.filter((it) => !it.poster_id || !blockedUsers.includes(it.poster_id)).map(parsePost),
    [uItems, blockedUsers],
  );

  const gridPosts = full && posterHandle ? uPosts : posts;
  const showEmpty = !loading && !uLoading && ((full && posterHandle) ? uItems.length === 0 : visibleItems.length === 0);

  return (
    <View style={s.section}>
      {/* セクション見出し（非fullのホーム埋め込みのみ）*/}
      {!full && (
        <View style={s.sectionHeader}>
          <View>
            <Text style={s.sectionSub}>COMMUNITY PICKS</Text>
            <View style={s.titleRow}>
              <Text style={s.sectionTitle}>全国みんなの穴場</Text>
              <Map size={16} color={PURPLE} strokeWidth={2.2} />
            </View>
          </View>
        </View>
      )}

      {/* @ID絞り込み中バナー */}
      {full && posterHandle && (
        <View style={s.uBanner}>
          <Text style={s.uBannerText}>@{posterHandle} さんの投稿</Text>
          <Text style={s.uBannerCount}>{uItems.length}件</Text>
        </View>
      )}

      {(loading || uLoading) && (
        <View style={s.loadingWrap}><ActivityIndicator color={PURPLE} size="small" /></View>
      )}

      {!loading && !uLoading && (
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && gridPosts.length > 0 && (
            <PostGrid
              posts={gridPosts}
              containerWidth={width}
              onPressPost={(p) => openSpot(p.raw as FeedItem)}
              onMenuPost={(p) => setReportTarget(p.raw as FeedItem)}
            />
          )}
        </View>
      )}

      {/* 無限スクロールのロード表示 */}
      {full && loadingMore && (
        <View style={s.loadingWrap}><ActivityIndicator color={PURPLE} size="small" /></View>
      )}

      {showEmpty && (
        <View style={s.loadingWrap}>
          <Text style={{ color: '#9CA3AF', fontSize: 13 }}>
            {(full && posterHandle) ? 'このユーザーの公開投稿はまだありません' : 'まだ投稿がありません'}
          </Text>
        </View>
      )}

      {/* もっと見る（非fullのみ）*/}
      {!loading && !full && visibleItems.length > 0 && (
        <TouchableOpacity style={s.moreBtn} activeOpacity={0.7} onPress={() => router.navigate('/blog')}>
          <Text style={s.moreBtnText}>みんなの投稿をもっと見る</Text>
          <ChevronDown size={15} color={PURPLE} strokeWidth={2.4} />
        </TouchableOpacity>
      )}

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

const s = StyleSheet.create({
  section: { paddingTop: 4 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 },
  sectionSub: { fontSize: 10.5, fontWeight: '800', color: '#B7A9E0', letterSpacing: 1.5, marginBottom: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: '#1E1548', letterSpacing: -0.3 },
  uBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F4F1FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12,
  },
  uBannerText: { fontSize: 12.5, fontWeight: '800', color: '#7A5CFF' },
  uBannerCount: { fontSize: 11.5, fontWeight: '700', color: '#8B88A6' },
  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28 },
  moreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    marginTop: 18, marginBottom: 4, paddingVertical: 12,
    backgroundColor: 'rgba(155,107,255,0.08)', borderRadius: 14,
  },
  moreBtnText: { fontSize: 13, fontWeight: '800', color: PURPLE },
});
