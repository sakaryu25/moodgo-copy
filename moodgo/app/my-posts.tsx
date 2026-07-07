// ── /my-posts ────────────────────────────────────────────────────────────────
// 「自分の投稿」一覧ページ（プロフィールページではない）。
//   Instagram×Pinterest×Airbnb: 写真が映えるMasonry・美しい余白・iOSネイティブ感。
//   構成: ナビ(戻る/タイトル/＋) → ユーザー情報 → 統計(投稿/いいね/行った！/都道府県)
//        → カテゴリ → 並び替え → Masonry(無限スクロール＋スケルトン)。
//   「保存」の概念は無し。行った！(spot_post_reactions rtype=visited)が中心。
//   訪れた都道府県は既存の行った！ローカル記録(lib/spotLog visited)から算出。
import { router, useFocusEffect } from 'expo-router';
import { PenLine, Plus } from 'lucide-react-native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, NativeScrollEvent, NativeSyntheticEvent,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '@/components/AppBackground';
import CategoryTabs from '@/components/myposts/CategoryTabs';
import LoadingSkeleton from '@/components/myposts/LoadingSkeleton';
import MyPostGrid from '@/components/myposts/MyPostGrid';
import MyPostsHeader from '@/components/myposts/MyPostsHeader';
import SortBar from '@/components/myposts/SortBar';
import {
  MP, matchCategory, sortPosts, type Category, type MyPost, type SortKey,
} from '@/components/myposts/types';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { loadJSON, saveJSON } from '@/lib/storage';

const PAGE = 10;
// 前回の投稿一覧を端末に保持し、次回は即表示→裏で最新化（体感速度対策・プロフィールと共有）
const MY_POSTS_CACHE_KEY = 'moodgo-my-posts-cache-v1';

// community-feed / CommunityFeed と同じ遷移
function openPost(item: MyPost) {
  if (item.kind === 'blog') {
    router.push({ pathname: '/blog-post', params: { id: item.id.replace(/^bp-/, '') } });
    return;
  }
  router.push({ pathname: '/community-spot', params: { id: item.id } });
}

export default function MyPostsScreen() {
  const insets = useSafeAreaInsets();

  const [posts, setPosts] = useState<MyPost[]>([]);
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState<Category>('すべて');
  const [sortKey, setSortKey] = useState<SortKey>('popular');
  const [asc, setAsc] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [pagingMore, setPagingMore] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [width, setWidth] = useState(0);
  const pagingRef = useRef(false);
  const isMounted = useRef(true);

  // 初回 fade-up（上部セクション。カードは各自でアニメ）
  const enter = useRef(new Animated.Value(0)).current;

  const loadAll = useCallback(async () => {
    // 前回の投稿一覧を即表示（スピナーを出さない）→ 裏で最新を取得して置き換え
    const cached = await loadJSON<MyPost[]>(MY_POSTS_CACHE_KEY, []);
    if (!isMounted.current) return;
    if (Array.isArray(cached) && cached.length > 0) { setPosts(cached); setLoading(false); }
    try {
      const deviceId = await getDeviceId();
      const res = await apiFetch('/api/my-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json();
      if (isMounted.current && Array.isArray(data?.items)) {
        setPosts(data.items);
        saveJSON(MY_POSTS_CACHE_KEY, data.items);
      }
    } catch { if (isMounted.current && cached.length === 0) setPosts([]); }
    finally { if (isMounted.current) setLoading(false); }
  }, []);

  useFocusEffect(
    useCallback(() => {
      isMounted.current = true;
      loadAll();
      enter.setValue(0);
      Animated.timing(enter, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      return () => { isMounted.current = false; };
    }, [loadAll, enter]),
  );

  // カテゴリ→並び替え→ページング
  const filtered = useMemo(
    () => sortPosts(posts.filter((p) => matchCategory(p, category)), sortKey, asc),
    [posts, category, sortKey, asc],
  );
  const visible = filtered.slice(0, shown);
  const hasMore = shown < filtered.length;

  const resetPaging = () => { setShown(PAGE); pagingRef.current = false; setPagingMore(false); };

  // 無限スクロール（末尾接近でスケルトン→次ページ）
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    setScrolled(contentOffset.y > 8);
    if (!hasMore || pagingRef.current) return;
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - 700) {
      pagingRef.current = true;
      setPagingMore(true);
      setTimeout(() => {
        if (!isMounted.current) return;
        setShown((n) => n + PAGE);
        setPagingMore(false);
        pagingRef.current = false;
      }, 380);
    }
  };

  const fadeUp = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };

  return (
    <View style={s.root}>
      {/* ホームと同じM透かし背景（各カードは白なのでそのまま映える） */}
      <AppBackground />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 56, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        <Animated.View style={fadeUp}>
          {/* カテゴリ */}
          <View style={{ marginTop: 4 }}>
            <CategoryTabs selected={category} onSelect={(c) => { setCategory(c); resetPaging(); }} />
          </View>

          {/* 並び替え */}
          <View style={{ marginTop: 6 }}>
            <SortBar
              sortKey={sortKey} asc={asc}
              onSort={(k) => { setSortKey(k); resetPaging(); }}
              onToggleAsc={() => { setAsc((v) => !v); resetPaging(); }}
            />
          </View>
        </Animated.View>

        {/* 投稿一覧（Masonry）*/}
        <View style={s.gridWrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {loading ? (
            <LoadingSkeleton label="読み込み中…" />
          ) : visible.length > 0 && width > 0 ? (
            <>
              <MyPostGrid posts={visible} containerWidth={width} onPressPost={openPost} />
              {pagingMore && <View style={{ marginTop: MP.GAP }}><LoadingSkeleton /></View>}
              {!hasMore && filtered.length > PAGE && (
                <Text style={s.endText}>すべて表示しました</Text>
              )}
            </>
          ) : (
            <View style={s.emptyWrap}>
              <View style={s.emptyIcon}><PenLine size={22} color={MP.MAIN} strokeWidth={1.8} /></View>
              <Text style={s.emptyTitle}>
                {posts.length === 0 ? 'まだ投稿がありません' : 'このカテゴリの投稿はありません'}
              </Text>
              {posts.length === 0 && (
                <TouchableOpacity onPress={() => router.push('/post')} style={s.emptyBtn} activeOpacity={0.85}
                  accessibilityRole="button" accessibilityLabel="新しく投稿する">
                  <Plus size={15} color="#fff" strokeWidth={2.6} />
                  <Text style={s.emptyBtnText}>投稿する</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {loading && <ActivityIndicator color={MP.MAIN} size="small" style={{ marginTop: 8 }} />}
      </ScrollView>

      {/* ナビ（スクロールでブラー）*/}
      <MyPostsHeader
        topInset={insets.top}
        scrolled={scrolled}
        onBack={() => router.back()}
        onNew={() => router.push('/post')}
      />

    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },   // 背景はAppBackground(ホームのM透かし)
  gridWrap: { paddingHorizontal: MP.SIDE, marginTop: 14 },
  endText: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: MP.SUB, marginTop: 20 },
  emptyWrap: { alignItems: 'center', paddingVertical: 44, gap: 8 },
  emptyIcon: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: '#F0EBFF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: MP.INK },
  emptyBtn: {
    marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: MP.MAIN, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11,
  },
  emptyBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
});
