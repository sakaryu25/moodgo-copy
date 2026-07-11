/**
 * CommunityFeed.tsx
 * 全国みんなの穴場 — Pinterest風 2カラム Masonry タイムライン
 *
 *  - ホーム埋め込み(非full): 新着順・最大8件(2×4)＋「もっと見る」
 *  - 一覧ページ(full=BlogView): 全件・無限スクロール(親のloadMoreKeyで追加読み込み)
 *  カードは components/community/*（PostGrid/PostCard/ImageCard/TextCard/UserInfo）。
 */
import { router, useFocusEffect } from 'expo-router';
import { ChevronDown, Map } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { feedStaleVersion } from '@/lib/feedRefresh';
import * as Location from 'expo-location';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { loadJSON, saveJSON, BLOCKED_USERS_KEY } from '@/lib/storage';
import { useBlocks, blockUser } from '@/lib/blockStore';
import ReportModal from './ReportModal';
import PostGrid from './community/PostGrid';
import ExploreGrid from './community/ExploreGrid';
import { useSettings } from '@/lib/settingsStore';
import { parsePost, type FeedLike, type Post } from './community/postTypes';

const PURPLE = '#9B6BFF';
const PAGE = 30;
// 前回の先頭ページを端末に保持し、次回は即表示→裏で最新化（体感速度対策）
const FEED_CACHE_KEY = 'moodgo-feed-cache-v1';

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
  sortMode?: 'popular' | 'near' | 'new';   // new=新着順（人気/近くを解除した状態）
  coords?: { lat: number; lng: number } | null;
  posterHandle?: string | null;
  searchQuery?: string | null;   // full: スポット名/本文のキーワード検索（@ID絞り込みと排他）
  feedScope?: 'all' | 'following';   // full: すべて / フォロー中のみ
  loadMoreKey?: number;   // full: 親(BlogView)が末尾スクロールで+1して追加読み込みを促す
  moodTag?: string | null;   // full: 気分チップの絞り込み（auto_tags一致・読み込み済み分に適用）
  refreshKey?: number;   // 親が+1したら最新を再取得（タブ再タップの「更新」用）
};

export default function CommunityFeed({ full, sortMode: propSort, coords: propCoords, posterHandle, searchQuery, feedScope = 'all', loadMoreKey, moodTag, refreshKey }: CommunityFeedProps) {
  const { lang } = useSettings();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const { hidden: blockedUsers } = useBlocks();   // ブロック/ミュート(サーバー同期)。フィード/一覧の除外に使う
  const [width, setWidth] = useState(0);
  const [uItems, setUItems] = useState<FeedItem[]>([]);
  const [uLoading, setULoading] = useState(false);
  const isMounted = useRef(true);
  const offsetRef = useRef(0);
  // カーソルページング: サーバーの nextCursor(最後のcreated_at)。offset方式は2ソース合流で
  // 投稿が欠落するため、2ページ目以降は cursor を送る（旧サーバー互換で offset も併送）。
  const cursorRef = useRef<string | null>(null);
  // 次ページの先読み: 表示直後に裏で次カーソル分を取得して保持 → 末尾到達時は即appendで待ち時間ゼロ
  type Page = { items: FeedItem[]; nextCursor: string | null; hasMore: boolean };
  const prefetchRef = useRef<Page | null>(null);
  const prefetchNext = useCallback(async () => {
    if (!full || posterHandle || prefetchRef.current) return;
    try {
      const cursorQ = cursorRef.current ? `&cursor=${encodeURIComponent(cursorRef.current)}` : '';
      const res = await apiFetch(`/api/community-feed?limit=${PAGE}&offset=${offsetRef.current}${cursorQ}`);
      const data = await res.json();
      if (data?.ok !== false && isMounted.current) {
        const items: FeedItem[] = data?.items ?? [];
        prefetchRef.current = {
          items,
          nextCursor: data?.nextCursor
            ?? (items.length ? String(items[items.length - 1]?.created_at ?? '') || null : cursorRef.current),
          hasMore: data?.hasMore ?? items.length >= PAGE,
        };
      }
    } catch { /* 先読み失敗は無害（末尾で通常フェッチされる） */ }
  }, [full, posterHandle]);

  // フォロー中フィード（full: フォローしている投稿者の公開投稿のみ）
  const followingMode = full && feedScope === 'following';
  const [fItems, setFItems] = useState<FeedItem[]>([]);
  const [fLoading, setFLoading] = useState(false);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const loadFollowing = useCallback(async () => {
    setFLoading(true);
    try {
      const deviceId = await getDeviceId();
      const res = await apiFetch('/api/following-feed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, limit: 60 }),
      });
      const d = await res.json();
      if (isMounted.current) {
        setFItems(Array.isArray(d?.items) ? d.items : []);
        setFollowingCount(typeof d?.following === 'number' ? d.following : null);
      }
    } catch { if (isMounted.current) setFItems([]); }
    finally { if (isMounted.current) setFLoading(false); }
  }, []);
  useEffect(() => {
    if (!followingMode) { setFItems([]); setFLoading(false); return; }
    loadFollowing();
  }, [followingMode, loadFollowing]);

  // キーワード検索（full: サーバー側でスポット名/本文の部分一致）
  const kw = (searchQuery ?? '').trim();
  const [kItems, setKItems] = useState<FeedItem[]>([]);
  const [kLoading, setKLoading] = useState(false);
  useEffect(() => {
    if (!full) return;
    if (!kw) { setKItems([]); setKLoading(false); return; }
    let cancelled = false;
    setKLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/community-feed?limit=60&q=${encodeURIComponent(kw)}`);
        const d = await res.json();
        if (!cancelled && isMounted.current) setKItems(Array.isArray(d?.items) ? d.items : []);
      } catch { if (!cancelled && isMounted.current) setKItems([]); }
      finally { if (!cancelled && isMounted.current) setKLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [full, kw]);

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

  // 初回ロード（再試行ボタンからも呼ぶ）。エラーは空状態と区別して loadError に立てる。
  //   前回の先頭ページ(端末キャッシュ)があれば即表示し、裏で最新を取得して置き換える。
  const loadInitial = useCallback(async (fresh = false) => {
    setLoading(true);
    setLoadError(false);
    let hadCache = false;
    try {
      const cached = await loadJSON<FeedItem[]>(FEED_CACHE_KEY, []);
      if (isMounted.current) {
        if (Array.isArray(cached) && cached.length > 0) {
          hadCache = true;
          setItems(cached);
          setLoading(false);   // スピナーを出さず前回結果を即表示
        }
      }
      // fresh=true（投稿直後など）は CDN の s-maxage=60 キャッシュを避けて即時反映させる
      const bust = fresh ? `&_=${Date.now()}` : '';
      const res = await apiFetch(`/api/community-feed?limit=${PAGE}&offset=0${bust}`);
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error('community-feed error');
      if (isMounted.current) {
        const fetched: FeedItem[] = data?.items ?? [];
        setItems(fetched);
        offsetRef.current = fetched.length;
        cursorRef.current = data?.nextCursor
          ?? (fetched.length ? String(fetched[fetched.length - 1]?.created_at ?? '') || null : null);
        setHasMore(data?.hasMore ?? fetched.length >= PAGE);
        saveJSON(FEED_CACHE_KEY, fetched.slice(0, PAGE));
        // 次ページを裏で先読み（末尾到達時に待ち時間ゼロでappend）
        prefetchRef.current = null;
        if (data?.hasMore ?? fetched.length >= PAGE) prefetchNext();
      }
    } catch {
      // キャッシュを出せている時は静かに前回結果のまま（エラーで置き換えない）
      if (isMounted.current && !hadCache) { setItems([]); setLoadError(true); }
    }
    finally { if (isMounted.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetchNext]);

  useEffect(() => {
    isMounted.current = true;
    // このセッションで投稿/いいね等があれば、初回マウントでもCDNキャッシュを避けて新鮮に取る
    // （みんなタブを初めて開いた時などに、直前の自分の投稿が抜ける60秒キャッシュ問題を解消）。
    loadInitial(feedStaleVersion() > 0);
    return () => { isMounted.current = false; };
  }, [loadInitial]);

  // 投稿の作成/編集/削除・いいねでフィードが古くなった時だけ、次のフォーカスで再取得。
  // ⚠ バージョン方式＝この実体が前回見た版と違えば再取得（複数フィードが各々独立に更新される）。
  //   投稿/いいね直後はキャッシュバスターで即時反映（CDNの60秒キャッシュを回避）。
  const lastFeedVersion = useRef(feedStaleVersion());
  useFocusEffect(useCallback(() => {
    if (feedStaleVersion() === lastFeedVersion.current) return;
    lastFeedVersion.current = feedStaleVersion();
    // 表示中のモードに応じて最新化（フォロー中/通常フィード）。検索・特定投稿者表示は対象外。
    if (followingMode) loadFollowing();
    else if (!kw && !posterHandle) loadInitial(true);
  }, [loadInitial, loadFollowing, followingMode, kw, posterHandle]));

  // タブ再タップ（親がrefreshKeyを+1）→ 最新を再取得。初回マウントのloadInitialとは重複させない。
  const prevRefreshRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === undefined || refreshKey === prevRefreshRef.current) return;
    prevRefreshRef.current = refreshKey;
    loadInitial(true);   // タブ再タップは明示的な更新＝CDNを避けて最新を取る
  }, [refreshKey, loadInitial]);

  // 無限スクロール（full時・親のloadMoreKeyが増えたら次ページ）
  useEffect(() => {
    if (!full || loadMoreKey === undefined || loadMoreKey === 0) return;
    if (loadingMore || !hasMore || posterHandle || kw || followingMode) return;
    // 先読み済みなら即append（体感ゼロ待ち）→ 次の先読みを開始
    const pre = prefetchRef.current;
    if (pre) {
      prefetchRef.current = null;
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const add = pre.items.filter((m) => !seen.has(m.id));
        offsetRef.current += pre.items.length;
        return [...prev, ...add];
      });
      cursorRef.current = pre.nextCursor;
      setHasMore(pre.hasMore);
      if (pre.hasMore) prefetchNext();
      return;
    }
    let cancelled = false;
    setLoadingMore(true);
    (async () => {
      try {
        const cursorQ = cursorRef.current ? `&cursor=${encodeURIComponent(cursorRef.current)}` : '';
        const res = await apiFetch(`/api/community-feed?limit=${PAGE}&offset=${offsetRef.current}${cursorQ}`);
        const data = await res.json();
        const more: FeedItem[] = data?.items ?? [];
        if (!cancelled && isMounted.current) {
          setItems((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            const add = more.filter((m) => !seen.has(m.id));
            offsetRef.current += more.length;
            return [...prev, ...add];
          });
          cursorRef.current = data?.nextCursor
            ?? (more.length ? String(more[more.length - 1]?.created_at ?? '') || null : cursorRef.current);
          const nextHasMore = data?.hasMore ?? more.length >= PAGE;
          setHasMore(nextHasMore);
          if (nextHasMore) prefetchNext();   // 続きも先読みしておく
        }
      } catch { /* 追加読み込み失敗は次の末尾スクロールで自然に再試行される */ }
      finally { if (!cancelled && isMounted.current) setLoadingMore(false); }
    })();
    return () => { cancelled = true; };
  }, [loadMoreKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 報告モーダル
  const [reportTarget, setReportTarget] = useState<FeedItem | null>(null);
  // ブロックは blockStore 経由（ローカル即時＋サーバー同期）。購読で blockedUsers が更新され再描画される。
  const handleBlockUser = (posterId: string) => { blockUser(posterId); };

  // メモ化: 毎renderで新配列を返すと posts useMemo→PostGridのmasonry計算→parsePost(正規表現)が
  // 全カード分再実行されるため、items/blockedUsers が変わった時だけ再計算する。
  const visibleItems = useMemo(
    () => items.filter((it) => !it.poster_id || !blockedUsers.includes(it.poster_id)),
    [items, blockedUsers],
  );

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
  // キーワード検索中はその結果
  const kPosts: Post[] = useMemo(
    () => kItems.filter((it) => !it.poster_id || !blockedUsers.includes(it.poster_id)).map(parsePost),
    [kItems, blockedUsers],
  );
  // フォロー中フィード
  const fPosts: Post[] = useMemo(
    () => fItems.filter((it) => !it.poster_id || !blockedUsers.includes(it.poster_id)).map(parsePost),
    [fItems, blockedUsers],
  );

  const searching = full && !!kw && !posterHandle;
  const gridPosts = full && posterHandle ? uPosts : searching ? kPosts : followingMode ? fPosts : posts;
  // 気分チップ絞り込み（full・読み込み済みの投稿に適用。追加読み込みでも維持される）
  const displayPosts = useMemo(
    () => (full && moodTag ? gridPosts.filter((p) => p.raw.auto_tags?.includes(moodTag)) : gridPosts),
    [full, moodTag, gridPosts],
  );
  // 気分絞り込みだけで0件（投稿自体はある）→ 専用の空メッセージ
  const moodEmpty = full && !!moodTag && gridPosts.length > 0 && displayPosts.length === 0;
  // エラーは「まだ投稿がありません」と別扱い（実際は投稿があるのに無いと断言しない）
  const showError = !loading && !uLoading && !kLoading && !fLoading && loadError
    && !(full && posterHandle) && !searching && !followingMode;
  const showEmpty = !loading && !uLoading && !kLoading && !fLoading && !showError
    && ((full && posterHandle) ? uItems.length === 0
      : searching ? kItems.length === 0
      : followingMode ? fItems.length === 0
      : visibleItems.length === 0);

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

      {/* キーワード検索中バナー */}
      {searching && !kLoading && (
        <View style={s.uBanner}>
          <Text style={s.uBannerText} numberOfLines={1}>「{kw}」の検索結果</Text>
          <Text style={s.uBannerCount}>{kItems.length}件</Text>
        </View>
      )}

      {(loading || uLoading || kLoading || fLoading) && (
        <View style={s.loadingWrap}><ActivityIndicator color={PURPLE} size="small" /></View>
      )}

      {!loading && !uLoading && !kLoading && !fLoading && (
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && displayPosts.length > 0 && (
            full ? (
              // 一覧ページ: Instagram発見タブ風の3列画像グリッド
              <ExploreGrid
                posts={displayPosts}
                containerWidth={width}
                onPressPost={(p) => openSpot(p.raw as FeedItem)}
                onMenuPost={(p) => setReportTarget(p.raw as FeedItem)}
              />
            ) : (
              // ホーム埋め込み: 従来の2列カード
              <PostGrid
                posts={displayPosts}
                containerWidth={width}
                onPressPost={(p) => openSpot(p.raw as FeedItem)}
                onMenuPost={(p) => setReportTarget(p.raw as FeedItem)}
              />
            )
          )}
        </View>
      )}

      {/* 気分チップで絞って0件（投稿はある）*/}
      {moodEmpty && !loading && (
        <View style={s.loadingWrap}>
          <Text style={{ color: '#9CA3AF', fontSize: 13 }}>
            {lang === 'en' ? 'No posts for this mood yet' : 'この気分の投稿はまだありません'}
          </Text>
        </View>
      )}

      {/* 無限スクロールのロード表示 */}
      {full && loadingMore && (
        <View style={s.loadingWrap}><ActivityIndicator color={PURPLE} size="small" /></View>
      )}

      {/* 取得失敗（空状態とは区別し、再試行導線を出す）*/}
      {showError && (
        <View style={s.loadingWrap}>
          <Text style={{ color: '#9CA3AF', fontSize: 13, marginBottom: 12 }}>読み込めませんでした</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.7} onPress={() => loadInitial(true)}>
            <Text style={s.retryText}>再試行</Text>
          </TouchableOpacity>
        </View>
      )}

      {showEmpty && (
        <View style={s.loadingWrap}>
          <Text style={{ color: '#9CA3AF', fontSize: 13 }}>
            {(full && posterHandle) ? 'このユーザーの公開投稿はまだありません'
              : searching ? `「${kw}」に一致する投稿は見つかりませんでした`
              : followingMode ? (followingCount === 0
                ? 'まだ誰もフォローしていません。投稿者をフォローするとここに出ます'
                : 'フォロー中のユーザーの投稿はまだありません')
              : 'まだ投稿がありません'}
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
  retryBtn: {
    paddingHorizontal: 22, paddingVertical: 9, borderRadius: 999,
    backgroundColor: 'rgba(155,107,255,0.1)',
  },
  retryText: { fontSize: 13, fontWeight: '800', color: PURPLE },
  moreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    marginTop: 18, marginBottom: 4, paddingVertical: 12,
    backgroundColor: 'rgba(155,107,255,0.08)', borderRadius: 14,
  },
  moreBtnText: { fontSize: 13, fontWeight: '800', color: PURPLE },
});
