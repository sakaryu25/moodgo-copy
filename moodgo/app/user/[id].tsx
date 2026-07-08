// ── /user/[id] ────────────────────────────────────────────────────────────────
// 投稿者のフルプロフィール（案7 Pinterest風・2026-07-08 全面リニューアル）。
//   idは公開ハッシュposterId（生device_idは扱わない）。データは既存 /api/user-profile。
//   構成: 戻る/…メニュー → アバター左+名前/@ID → 統計5列(カード無し・背景直載せ)
//        → グラデ フォローボタン → タブ(投稿/保存) → Pinterest2列3:4グリッド。
//   Apple的な余白・薄い影・線少なめ・白ベース。背景はアプリ共通のM透かし(AppBackground)。
//   スマホ(iPhone)専用・レスポンシブ不要。新ライブラリ追加なし。
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Award, ChevronLeft, Footprints, Heart, MapPin, MoreHorizontal, UserRound } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Easing,
  type NativeScrollEvent, type NativeSyntheticEvent,
  Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '@/components/AppBackground';
import ThumbImage from '@/components/ThumbImage';
import PuniPressable from '@/components/PuniPressable';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { showToast } from '@/lib/toast';
import { useSettings } from '@/lib/settingsStore';

const SCREEN_W = Dimensions.get('window').width;
const SIDE = 16;                                   // 画面左右の余白
const GAP = 12;                                    // カード間（横・縦）
const COL_W = Math.floor((SCREEN_W - SIDE * 2 - GAP) / 2);
const CARD_H = Math.round(COL_W * 4 / 3);          // カード比率 3:4
const PAGE = 8;                                    // 無限スクロールの1回の追加数

// 配色（白ベース・線少なめ・高級感）
const INK = '#1A1420';
const SUB = '#8A8698';
const BRAND = '#7C3AED';
const RING_GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const FOLLOW_GRAD: [string, string] = ['#FF5FB2', '#5EA6FF'];   // 指定のグラデ

type ProfilePost = {
  id: string; kind: string; spot_name: string; prefecture: string;
  image: string | null; likes?: number; visited?: number; created_at: string;
};
type VisitedSpot = { id: string; name: string; image: string | null; at: string | null };
type Profile = {
  posterId: string;
  name: string | null; handle: string | null; icon: string | null; isMe?: boolean; bio?: string | null;
  postCount: number; likeCount: number; visitedCount: number;
  followerCount: number; followingCount: number; isFollowing: boolean;
  posts: ProfilePost[];
  visitedSpots?: VisitedSpot[];
};

// 3,200 / 1.2万 のコンパクト表記（大きな数でも列が崩れない・Kではなく日本語表記で高級感）
function compact(n: number): string {
  if (!n || n < 0) return '0';
  if (n >= 10000) { const m = n / 10000; return (m >= 10 ? String(Math.round(m)) : m.toFixed(1).replace(/\.0$/, '')) + '万'; }
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ── 統計1列（数字大・ラベル小・中央・カード無し）──────────────────────────────
function Stat({ num, label }: { num: number; label: string }) {
  return (
    <View style={s.statCol}>
      <Text style={s.statNum} numberOfLines={1}>{compact(num)}</Text>
      <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

// ── 投稿カード（Pinterest風・画像いっぱい＋下部に黒グラデ＋タイトル/♥/📍）──────
function PostCard({ post, onPress }: { post: ProfilePost; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.card, pressed && { transform: [{ scale: 0.98 }] }]}
      accessibilityRole="button" accessibilityLabel={`${post.spot_name || '投稿'}を見る`}
    >
      {post.image ? (
        <ThumbImage uri={post.image} style={s.cardImg} contentFit="cover" transition={220} />
      ) : (
        <LinearGradient colors={['#EDE7FF', '#DDE9FB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.cardImg, s.cardPh]}>
          <MapPin size={26} color="#B7A7E8" strokeWidth={1.6} />
        </LinearGradient>
      )}
      {/* 下部の黒グラデ（文字を読みやすく）*/}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.06)', 'rgba(0,0,0,0.62)']} locations={[0, 0.5, 1]} style={s.cardScrim} pointerEvents="none" />
      <View style={s.cardMeta} pointerEvents="none">
        <Text style={s.cardTitle} numberOfLines={2}>{post.spot_name || 'おすすめスポット'}</Text>
        <View style={s.cardStatsRow}>
          <View style={s.cardStat}>
            <Heart size={12.5} color="#fff" fill="#fff" strokeWidth={0} />
            <Text style={s.cardStatText}>{compact(post.likes ?? 0)}</Text>
          </View>
          <View style={s.cardStat}>
            <Footprints size={12.5} color="#fff" strokeWidth={2.2} />
            <Text style={s.cardStatText}>{compact(post.visited ?? 0)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ── 行ったスポットの勲章バッジ（円形写真＋グラデリング＋メダル＋名前/達成日）──────
const MEDAL_W = Math.floor((SCREEN_W - SIDE * 2 - GAP) / 2);   // 2列
function fmtAchieved(at: string | null): string {
  if (!at) return '';
  const m = at.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])} 達成` : '達成';
}
function MedalBadge({ spot, onPress }: { spot: VisitedSpot; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.medal, pressed && { transform: [{ scale: 0.98 }] }]}
      accessibilityRole="button" accessibilityLabel={`${spot.name}に行った`}>
      <View style={s.medalRingWrap}>
        <LinearGradient colors={RING_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.medalRing}>
          <View style={s.medalWhite}>
            {spot.image ? (
              <ThumbImage uri={spot.image} style={s.medalImg} contentFit="cover" transition={200} />
            ) : (
              <View style={[s.medalImg, s.medalPh]}><MapPin size={22} color="#B7A7E8" strokeWidth={1.6} /></View>
            )}
          </View>
        </LinearGradient>
        <LinearGradient colors={RING_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.medalIcon}>
          <Award size={13} color="#fff" strokeWidth={2.4} />
        </LinearGradient>
      </View>
      <Text style={s.medalName} numberOfLines={1}>{spot.name}</Text>
      {spot.at ? <Text style={s.medalDate}>{fmtAchieved(spot.at)}</Text> : null}
    </Pressable>
  );
}

export default function UserProfileScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const posterId = String(id ?? '');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [isMe, setIsMe] = useState(false);
  const [tab, setTab] = useState<'posts' | 'visited'>('posts');
  const localSettings = useSettings();            // 自分のプロフィールなら一言をローカルからも表示
  const [shown, setShown] = useState(PAGE);       // 無限スクロールで表示中の件数
  const [pagingMore, setPagingMore] = useState(false);
  const pagingRef = useRef(false);
  const isMounted = useRef(true);

  // 画面フェードイン＋タブ下線アニメ
  const fade = useRef(new Animated.Value(0)).current;
  const underline = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    isMounted.current = true;
    if (!posterId) { setLoading(false); return; }
    (async () => {
      try {
        const viewerDeviceId = await getDeviceId();
        const res = await apiFetch('/api/user-profile', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetId: posterId, viewerDeviceId }),
        });
        const d = await res.json();
        if (isMounted.current && d?.ok && d.profile) {
          setProfile(d.profile);
          setFollowing(!!d.profile.isFollowing);
          setFollowerCount(d.profile.followerCount ?? 0);
          setIsMe(!!d.profile.isMe);
        }
      } catch { /* 空表示 */ }
      finally { if (isMounted.current) setLoading(false); }
    })();
    return () => { isMounted.current = false; };
  }, [posterId]);

  // 読み込み完了でふわっと表示
  useEffect(() => {
    if (loading) return;
    Animated.timing(fade, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [loading, fade]);

  // タブ切替（下線を200msでスライド）
  const switchTab = (t: 'posts' | 'visited') => {
    if (t === tab) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTab(t);
    setShown(PAGE);
    Animated.timing(underline, { toValue: t === 'posts' ? 0 : 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };

  const toggleFollow = useCallback(async () => {
    if (!posterId || busy || isMe) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !following;
    setFollowing(next);
    setFollowerCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setBusy(true);
    try {
      const deviceId = await getDeviceId();
      const d = await apiFetch('/api/user-follows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: next ? 'follow' : 'unfollow', deviceId, targetId: posterId }),
      }).then((r) => r.json());
      if (!d?.ok) {
        if (String(d?.error ?? '').includes('自分')) setIsMe(true);
        throw new Error('follow失敗');
      }
      if (isMounted.current && typeof d.followerCount === 'number') setFollowerCount(d.followerCount);
    } catch {
      if (isMounted.current) {
        setFollowing(!next);
        setFollowerCount((c) => Math.max(0, c + (next ? -1 : 1)));
        if (!isMe) showToast('フォローできませんでした', '時間をおいてもう一度お試しください');
      }
    } finally { if (isMounted.current) setBusy(false); }
  }, [posterId, following, busy, isMe]);

  const openMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('プロフィール', undefined, [
      { text: 'この投稿者を通報', style: 'destructive', onPress: () => showToast('通報しました', 'ご協力ありがとうございます') },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  };

  const posts = profile?.posts ?? [];
  const visible = useMemo(() => posts.slice(0, shown), [posts, shown]);
  const hasMore = shown < posts.length;
  // 貪欲2列（左=偶数index / 右=奇数index。3:4の均一グリッド）
  const [colL, colR] = useMemo(() => {
    const l: ProfilePost[] = [], r: ProfilePost[] = [];
    visible.forEach((p, i) => (i % 2 === 0 ? l : r).push(p));
    return [l, r];
  }, [visible]);

  // 無限スクロール（末尾接近で次ページを出す）
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (tab !== 'posts' || !hasMore || pagingRef.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - 600) {
      pagingRef.current = true;
      setPagingMore(true);
      setTimeout(() => {
        if (!isMounted.current) return;
        setShown((n) => n + PAGE);
        setPagingMore(false);
        pagingRef.current = false;
      }, 320);
    }
  };

  const openPost = (p: ProfilePost) => router.push({ pathname: '/community-spot', params: { id: p.id } });
  const openVisited = (v: VisitedSpot) => router.push({ pathname: '/community-spot', params: { id: v.id } });
  const name = profile?.name?.trim() || 'MoodGoユーザー';
  const tabW = (SCREEN_W - SIDE * 2) / 2;
  // 一言メッセージ: サーバー(公開)優先。自分のページはローカル設定にもフォールバック。
  const bioText = (profile?.bio?.trim() || (isMe ? (localSettings.profileBio ?? '').trim() : '') || '');
  const visitedSpots = profile?.visitedSpots ?? [];

  return (
    <View style={s.root}>
      <AppBackground />

      {loading ? (
        <View style={[s.center, { paddingTop: insets.top + 120 }]}><ActivityIndicator color={BRAND} size="small" /></View>
      ) : (
        <Animated.ScrollView
          style={{ opacity: fade }}
          contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {/* ── ヘッダー: 戻る / …メニュー（スクロールと一緒に流れる）── */}
          <View style={s.navRow}>
            <Pressable onPress={() => router.back()} style={s.navBtn} hitSlop={10}
              accessibilityRole="button" accessibilityLabel="戻る">
              <ChevronLeft size={22} color={INK} strokeWidth={2.4} />
            </Pressable>
            <Pressable onPress={openMenu} style={s.navBtn} hitSlop={10}
              accessibilityRole="button" accessibilityLabel="メニュー">
              <MoreHorizontal size={20} color={INK} strokeWidth={2.4} />
            </Pressable>
          </View>

          {/* ── ヒーロー: アバター90 + 名前/@ID ── */}
          <View style={s.hero}>
            <LinearGradient colors={RING_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatarRing}>
              <View style={s.avatarWhite}>
                {profile?.icon ? (
                  <Image source={{ uri: profile.icon }} style={s.avatar} contentFit="cover" />
                ) : (
                  <View style={[s.avatar, s.avatarPh]}><UserRound size={34} color={BRAND} strokeWidth={1.6} /></View>
                )}
              </View>
            </LinearGradient>
            <View style={s.heroRight}>
              <Text style={s.name} numberOfLines={1}>{name}</Text>
              {profile?.handle
                ? <Text style={s.handle} numberOfLines={1}>@{profile.handle}</Text>
                : <Text style={s.handleMuted} numberOfLines={1}>@MoodGoユーザー</Text>}
            </View>
          </View>

          {/* ── 一言メッセージ ── */}
          {bioText ? <Text style={s.bio}>{bioText}</Text> : null}

          {/* ── 統計 5列（カード無し・背景直載せ）── */}
          <View style={s.statsRow}>
            <Stat num={profile?.postCount ?? 0} label="投稿" />
            <Stat num={profile?.visitedCount ?? 0} label="行った" />
            <Stat num={profile?.likeCount ?? 0} label="いいね" />
            <Stat num={followerCount} label="フォロワー" />
            <Stat num={profile?.followingCount ?? 0} label="フォロー中" />
          </View>

          {/* ── フォローボタン（自分のページでは出さない）── */}
          {!isMe && (
            <View style={s.followWrap}>
              {following ? (
                <PuniPressable onPress={toggleFollow} disabled={busy} haptic={false} style={s.followingBtn}>
                  <Text style={s.followingText}>フォロー中</Text>
                </PuniPressable>
              ) : (
                <PuniPressable onPress={toggleFollow} disabled={busy} haptic={false} style={s.followBtnShadow}>
                  <LinearGradient colors={FOLLOW_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.followBtn}>
                    <Text style={s.followText}>フォローする</Text>
                  </LinearGradient>
                </PuniPressable>
              )}
            </View>
          )}

          {/* ── タブ（投稿 / 行ったスポット）＋200ms下線 ── */}
          <View style={s.tabs}>
            <Pressable style={s.tab} onPress={() => switchTab('posts')} accessibilityRole="tab" accessibilityState={{ selected: tab === 'posts' }}>
              <Text style={[s.tabText, tab === 'posts' && s.tabTextOn]}>投稿</Text>
            </Pressable>
            <Pressable style={s.tab} onPress={() => switchTab('visited')} accessibilityRole="tab" accessibilityState={{ selected: tab === 'visited' }}>
              <Text style={[s.tabText, tab === 'visited' && s.tabTextOn]}>行ったスポット</Text>
            </Pressable>
            <Animated.View style={[s.underline, {
              width: 28, left: tabW / 2 - 14,
              transform: [{ translateX: underline.interpolate({ inputRange: [0, 1], outputRange: [0, tabW] }) }],
            }]} />
          </View>

          {/* ── コンテンツ ── */}
          {tab === 'posts' ? (
            posts.length === 0 ? (
              <View style={s.emptyWrap}>
                <View style={s.emptyIcon}><MapPin size={22} color={BRAND} strokeWidth={1.8} /></View>
                <Text style={s.emptyText}>まだ投稿がありません</Text>
              </View>
            ) : (
              <>
                <View style={s.grid}>
                  <View style={s.col}>{colL.map((p) => <PostCard key={p.id} post={p} onPress={() => openPost(p)} />)}</View>
                  <View style={s.col}>{colR.map((p) => <PostCard key={p.id} post={p} onPress={() => openPost(p)} />)}</View>
                </View>
                {pagingMore && <ActivityIndicator color={BRAND} size="small" style={{ marginTop: 16 }} />}
              </>
            )
          ) : (
            // 行ったスポット＝勲章バッジ（2列×N・少数は中央揃え）
            visitedSpots.length === 0 ? (
              <View style={s.emptyWrap}>
                <View style={s.emptyIcon}><Award size={22} color={BRAND} strokeWidth={1.8} /></View>
                <Text style={s.emptyText}>まだ行ったスポットがありません</Text>
              </View>
            ) : (
              <View style={s.medalGrid}>
                {visitedSpots.map((v) => <MedalBadge key={v.id} spot={v} onPress={() => openVisited(v)} />)}
              </View>
            )
          )}
        </Animated.ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center' },

  // ナビ
  navRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SIDE, height: 44 },
  navBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1A1420', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },

  // ヒーロー
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: SIDE, marginTop: 14 },
  avatarRing: { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center' },
  avatarWhite: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 74, height: 74, borderRadius: 37 },
  avatarPh: { backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center' },
  heroRight: { flex: 1, minWidth: 0 },
  name: { fontSize: 24, fontWeight: '800', color: INK, letterSpacing: -0.5 },
  handle: { fontSize: 14, fontWeight: '700', color: BRAND, marginTop: 4 },
  handleMuted: { fontSize: 14, fontWeight: '600', color: SUB, marginTop: 4 },

  // 統計（カード無し）
  statsRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: SIDE, marginTop: 22 },
  statCol: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  statNum: { fontSize: 21, fontWeight: '800', color: INK, letterSpacing: -0.6 },
  statLabel: { fontSize: 11, fontWeight: '600', color: SUB, marginTop: 4 },

  // フォローボタン
  followWrap: { paddingHorizontal: SIDE, marginTop: 22 },
  followBtnShadow: {
    borderRadius: 999,
    shadowColor: '#FF5FB2', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.16, shadowRadius: 12, elevation: 3,
  },
  followBtn: { height: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  followText: { color: '#fff', fontSize: 15.5, fontWeight: '800', letterSpacing: 0.3 },
  followingBtn: {
    height: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(124,58,237,0.28)',
  },
  followingText: { color: BRAND, fontSize: 15.5, fontWeight: '800', letterSpacing: 0.3 },

  // タブ
  tabs: { flexDirection: 'row', marginHorizontal: SIDE, marginTop: 24, height: 44 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 14.5, fontWeight: '700', color: SUB },
  tabTextOn: { color: INK, fontWeight: '800' },
  underline: { position: 'absolute', bottom: 0, height: 3, borderRadius: 2, backgroundColor: BRAND },

  // グリッド（Pinterest 2列 3:4）
  grid: { flexDirection: 'row', gap: GAP, paddingHorizontal: SIDE, marginTop: 18, alignItems: 'flex-start' },
  col: { flex: 1, minWidth: 0, gap: GAP },
  card: {
    width: COL_W, height: CARD_H, borderRadius: 18, overflow: 'hidden', backgroundColor: '#ECE8F5',
    shadowColor: '#1A1420', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 2,
  },
  cardImg: { width: '100%', height: '100%' },
  cardPh: { alignItems: 'center', justifyContent: 'center' },
  cardScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%' },
  cardMeta: { position: 'absolute', left: 12, right: 12, bottom: 11 },
  cardTitle: { color: '#fff', fontSize: 13.5, fontWeight: '800', lineHeight: 18, letterSpacing: -0.2, textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  cardStatsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  cardStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardStatText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // 一言メッセージ
  bio: { fontSize: 14, fontWeight: '500', color: '#3A3348', lineHeight: 21, paddingHorizontal: SIDE, marginTop: 14 },

  // 行ったスポットの勲章バッジ（2列×N・少数は中央揃え）
  medalGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: GAP, paddingHorizontal: SIDE, marginTop: 18 },
  medal: { width: MEDAL_W, alignItems: 'center', paddingVertical: 8 },
  medalRingWrap: { width: 92, height: 92 },
  medalRing: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center' },
  medalWhite: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  medalImg: { width: 74, height: 74, borderRadius: 37 },
  medalPh: { backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center' },
  medalIcon: {
    position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: '#fff',
  },
  medalName: { fontSize: 12.5, fontWeight: '800', color: INK, marginTop: 9, maxWidth: MEDAL_W - 8, textAlign: 'center' },
  medalDate: { fontSize: 10.5, fontWeight: '600', color: SUB, marginTop: 2 },

  // 空状態
  emptyWrap: { alignItems: 'center', paddingVertical: 70, gap: 12 },
  emptyIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, fontWeight: '700', color: INK },
});
