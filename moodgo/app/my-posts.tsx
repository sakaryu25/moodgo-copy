// ── /my-posts ────────────────────────────────────────────────────────────────
// 「自分の投稿」一覧ページ（プロフィールページではない）。
//   Instagram×Pinterest×Airbnb: 写真が映えるMasonry・美しい余白・iOSネイティブ感。
//   構成: ナビ(戻る/タイトル/＋) → ユーザー情報 → 統計(投稿/いいね/行った！/都道府県)
//        → カテゴリ → 並び替え → Masonry(無限スクロール＋スケルトン)。
//   「保存」の概念は無し。行った！(spot_post_reactions rtype=visited)が中心。
//   訪れた都道府県は既存の行った！ローカル記録(lib/spotLog visited)から算出。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { MapPin, PenLine, Plus } from 'lucide-react-native';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, NativeScrollEvent, NativeSyntheticEvent,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '@/components/AppBackground';
import SettingsView from '@/components/SettingsView';
import CategoryTabs from '@/components/myposts/CategoryTabs';
import LoadingSkeleton from '@/components/myposts/LoadingSkeleton';
import MyPostGrid from '@/components/myposts/MyPostGrid';
import MyPostsHeader from '@/components/myposts/MyPostsHeader';
import SortBar from '@/components/myposts/SortBar';
import UserSummary from '@/components/myposts/UserSummary';
import {
  MP, matchCategory, sortPosts, type Category, type MyPost, type SortKey,
} from '@/components/myposts/types';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { HISTORY_KEY } from '@/lib/storage';
import { loadVisitedLog } from '@/lib/spotLog';
import {
  useSettings, hydrateSettings, setLang, saveProfile, unblockPlace, clearBlocked,
} from '@/lib/settingsStore';

const NICKNAME_KEY  = 'moodgo-group-nickname';
const USER_ICON_KEY = 'moodgo-user-icon';
const HANDLE_KEY    = 'moodgo-user-handle';
const PAGE = 10;

// 住所→都道府県（訪れた県の算出用）
function prefOf(addr?: string): string {
  const m = (addr ?? '').match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
  return m ? m[1].replace(/[都道府県]$/, '') : '';
}
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
  const settings = useSettings();

  const [posts, setPosts] = useState<MyPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [nickname, setNickname] = useState('');
  const [handle, setHandle] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [visitedPrefs, setVisitedPrefs] = useState(0);
  const [followers, setFollowers] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

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
    hydrateSettings();
    const [nick, icon, hnd, visited] = await Promise.all([
      AsyncStorage.getItem(NICKNAME_KEY).catch(() => null),
      AsyncStorage.getItem(USER_ICON_KEY).catch(() => null),
      AsyncStorage.getItem(HANDLE_KEY).catch(() => null),
      loadVisitedLog().catch(() => []),
    ]);
    if (!isMounted.current) return;
    setNickname(nick ?? '');
    setIconUrl(icon ?? '');
    setHandle(hnd ?? '');
    setVisitedPrefs(new Set(visited.map((v) => prefOf(v.address) || v.area || '').filter(Boolean)).size);
    try {
      const deviceId = await getDeviceId();
      const res = await apiFetch('/api/my-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json();
      if (isMounted.current) setPosts(Array.isArray(data?.items) ? data.items : []);
      // フォロワー数（user_follows・テーブル未適用は0）
      try {
        const f = await apiFetch('/api/user-follows', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'me', deviceId }),
        }).then((r) => r.json());
        if (isMounted.current && f?.ok) setFollowers(f.followerCount ?? 0);
      } catch { /* 0のまま */ }
    } catch { if (isMounted.current) setPosts([]); }
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

  // 統計（保存の概念は無い: 投稿 / もらったいいね / 行った！された回数 / 訪れた都道府県）
  const totalLikes = useMemo(() => posts.reduce((s, p) => s + (p.likes ?? 0), 0), [posts]);
  const totalVisited = useMemo(() => posts.reduce((s, p) => s + (p.visited ?? 0), 0), [posts]);

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
          {/* ユーザー情報 */}
          <UserSummary
            name={nickname.trim() || 'MoodGo'}
            handle={handle}
            iconUrl={iconUrl}
            prefecture={settings.profilePrefecture ?? ''}
            bio={settings.profileBio}
            showPrefecture={settings.showPrefecture}
            statPosts={posts.length}
            statVisited={totalVisited}
            statLikes={totalLikes}
            statFollowers={followers}
            onEdit={() => setShowSettings(true)}
          />

          {/* 訪れた都道府県（ヘッダーの数字行と重複しない情報だけをスリムに）*/}
          <View style={s.prefCard}>
            <View style={s.prefIcon}><MapPin size={15} color="#34B27D" strokeWidth={2.2} /></View>
            <Text style={s.prefLabel}>訪れた都道府県</Text>
            <Text style={s.prefValue}>{visitedPrefs}<Text style={s.prefUnit}> 県</Text></Text>
          </View>

          {/* カテゴリ */}
          <View style={{ marginTop: 18 }}>
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

      {/* プロフィール編集（既存SettingsViewをそのまま利用）*/}
      <SettingsView
        visible={showSettings}
        section="profile"
        onClose={() => { setShowSettings(false); loadAll(); }}
        lang={settings.lang}
        onChangeLang={setLang}
        profileAge={settings.profileAge}
        profileGender={settings.profileGender}
        profilePrefecture={settings.profilePrefecture}
        onSaveProfile={saveProfile}
        onClearHistory={() => { AsyncStorage.removeItem(HISTORY_KEY).catch(() => {}); }}
        blockedPlaces={settings.blockedPlaces}
        onUnblockPlace={unblockPlace}
        onClearBlocked={clearBlocked}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },   // 背景はAppBackground(ホームのM透かし)
  // 訪れた都道府県（スリム1行カード）
  prefCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: MP.SIDE, marginTop: 16,
    backgroundColor: MP.CARD, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#111', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.05, shadowRadius: 14, elevation: 2,
  },
  prefIcon: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#E5F5EE',
    alignItems: 'center', justifyContent: 'center',
  },
  prefLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: MP.INK },
  prefValue: { fontSize: 17, fontWeight: '800', color: MP.INK, letterSpacing: -0.3 },
  prefUnit: { fontSize: 11, fontWeight: '600', color: MP.SUB },
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
