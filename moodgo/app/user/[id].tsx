// ── /user/[id] ────────────────────────────────────────────────────────────────
// 他人のフルプロフィールページ（idは公開ハッシュposterId・生device_idは扱わない）。
//   プロフィールタブと同じデザイン言語（アバター左＋名前/@IDの横並び）:
//   ナビ(戻る/名前) → アバター/名前/@ID → 統計5列(投稿/行った/いいね/フォロワー/フォロー中)
//   → フォローボタン(自分のページ isMe では非表示) → 投稿のMasonryグリッド。
//   行った/いいねは spot_post_reactions 実数（/api/user-profile が集計）。
import { router, useLocalSearchParams } from 'expo-router';
import { UserRound } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '@/components/AppBackground';
import MyPostGrid from '@/components/myposts/MyPostGrid';
import MyPostsHeader from '@/components/myposts/MyPostsHeader';
import { MP, type MyPost } from '@/components/myposts/types';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { showToast } from '@/lib/toast';
import { useCollapsibleHeader } from '@/lib/useCollapsibleHeader';

const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];

type ProfilePost = {
  id: string; kind: string; spot_name: string; prefecture: string;
  image: string | null; likes?: number; visited?: number; created_at: string;
};
type Profile = {
  posterId: string;
  name: string | null; handle: string | null; icon: string | null; isMe?: boolean;
  postCount: number; likeCount: number; visitedCount: number;
  followerCount: number; followingCount: number; isFollowing: boolean;
  posts: ProfilePost[];
};

// 数値を 1.2万 / 3.4千 に丸めて表示（大きな数でも列が崩れない）
function fmt(n: number): string {
  if (!n || n < 0) return '0';
  if (n >= 10000) { const m = n / 10000; return (m >= 10 ? Math.round(m).toString() : m.toFixed(1).replace(/\.0$/, '')) + '万'; }
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + '千';
  return String(n);
}

function Stat({ num, label }: { num: number; label: string }) {
  return (
    <View style={s.statCol}>
      <Text style={s.statNum}>{fmt(num)}</Text>
      <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
    </View>
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
  const [scrolled, setScrolled] = useState(false);
  const [width, setWidth] = useState(0);
  const isMounted = useRef(true);

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
          setIsMe(!!d.profile.isMe);   // 自分のページはフォローボタンを出さない（サーバー判定）
        }
      } catch { /* 空表示 */ }
      finally { if (isMounted.current) setLoading(false); }
    })();
    return () => { isMounted.current = false; };
  }, [posterId]);

  // 自分自身の判定はフォローAPIの自己フォロー拒否に任せ、ボタン押下時にトーストで案内する
  const toggleFollow = useCallback(async () => {
    if (!posterId || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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

  // user-profileのpostsをMasonryグリッド(MyPost形)に変換（いいね/行った実数もカードへ）
  const gridPosts: MyPost[] = useMemo(() =>
    (profile?.posts ?? []).map((p) => ({
      id: p.id, kind: p.kind, spot_name: p.spot_name, prefecture: p.prefecture,
      description: null, image_urls: p.image ? [p.image] : null,
      likes: p.likes ?? 0, visited: p.visited ?? 0, created_at: p.created_at,
    })), [profile]);

  const openPost = (item: MyPost) => {
    router.push({ pathname: '/community-spot', params: { id: item.id } });
  };

  const name = profile?.name?.trim() || 'MoodGoユーザー';

  // 下スクロールでナビバーを格納（ナビ高=inset+48固定）
  const collapse = useCollapsibleHeader({
    initialHeight: insets.top + 48,
    listener: (e) => setScrolled(e.nativeEvent.contentOffset.y > 8),
  });

  return (
    <View style={s.root}>
      <AppBackground />
      <Animated.ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 56, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        onScroll={collapse.onScroll}
        scrollEventThrottle={16}
      >
        {loading ? (
          <View style={s.center}><ActivityIndicator color={MP.MAIN} size="small" /></View>
        ) : (
          <>
            {/* ── ヒーロー: アバター左 ＋ 名前/@ID（プロフィールタブと同じ横並び配置）── */}
            <View style={s.head}>
              <View style={s.heroRow}>
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatarRing}>
                  <View style={s.avatarWhite}>
                    {profile?.icon ? (
                      <Image source={{ uri: profile.icon }} style={s.avatar} contentFit="cover" />
                    ) : (
                      <View style={[s.avatar, s.avatarPh]}><UserRound size={32} color={MP.MAIN} strokeWidth={1.6} /></View>
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

              {/* ── 統計 5列: 投稿 / 行った / いいね / フォロワー / フォロー中 ── */}
              <View style={s.statsRow}>
                <Stat num={profile?.postCount ?? 0} label="投稿" />
                <View style={s.statDivider} />
                <Stat num={profile?.visitedCount ?? 0} label="行った" />
                <View style={s.statDivider} />
                <Stat num={profile?.likeCount ?? 0} label="いいね" />
                <View style={s.statDivider} />
                <Stat num={followerCount} label="フォロワー" />
                <View style={s.statDivider} />
                <Stat num={profile?.followingCount ?? 0} label="フォロー中" />
              </View>

              {/* フォローボタン（自分のページでは出さない） */}
              {!isMe && (
                <TouchableOpacity onPress={toggleFollow} activeOpacity={0.85} disabled={busy} style={s.followWrap}
                  accessibilityRole="button" accessibilityLabel={following ? 'フォローを解除' : 'フォローする'}>
                  {following ? (
                    <View style={s.followingBtn}><Text style={s.followingText}>フォロー中</Text></View>
                  ) : (
                    <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.followBtn}>
                      <Text style={s.followText}>フォローする</Text>
                    </LinearGradient>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* 投稿グリッド（Masonry） */}
            <View style={s.gridWrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
              {gridPosts.length > 0 && width > 0 ? (
                <MyPostGrid posts={gridPosts} containerWidth={width} onPressPost={openPost} />
              ) : (
                <View style={s.center}><Text style={s.emptyText}>公開投稿はまだありません</Text></View>
              )}
            </View>
          </>
        )}
      </Animated.ScrollView>

      {/* ナビ（戻る/名前。＋は出さない） */}
      <MyPostsHeader
        topInset={insets.top}
        scrolled={scrolled}
        translateY={collapse.translateY}
        title={name}
        showNew={false}
        onBack={() => router.back()}
        onNew={() => {}}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  head: { paddingHorizontal: MP.SIDE },
  // アバター左＋名前右の横並び（プロフィールタブと同じ配置言語）
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarRing: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  avatarWhite: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  avatarPh: { backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center' },
  heroRight: { flex: 1, minWidth: 0 },
  name: { fontSize: 22, fontWeight: '800', color: MP.INK, letterSpacing: -0.4 },
  handle: { fontSize: 13, fontWeight: '600', color: MP.MAIN, marginTop: 3 },
  handleMuted: { fontSize: 13, fontWeight: '600', color: MP.SUB, marginTop: 3 },

  // 統計 5列（投稿/行った/いいね/フォロワー/フォロー中）
  statsRow: {
    flexDirection: 'row', alignItems: 'center', marginTop: 18, alignSelf: 'stretch',
    backgroundColor: MP.CARD, borderRadius: 18, paddingVertical: 14,
    shadowColor: '#111', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1,
  },
  statCol: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  statNum: { fontSize: 17, fontWeight: '800', color: MP.INK, letterSpacing: -0.3 },
  statLabel: { fontSize: 10.5, fontWeight: '600', color: MP.SUB, marginTop: 3 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: 'rgba(0,0,0,0.1)' },

  followWrap: { alignSelf: 'stretch', marginTop: 16 },
  followBtn: {
    height: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 4,
  },
  followText: { color: '#fff', fontSize: 14.5, fontWeight: '800', letterSpacing: 0.2 },
  followingBtn: {
    height: 46, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(155,107,255,0.4)',
  },
  followingText: { color: '#7C3AED', fontSize: 14.5, fontWeight: '800', letterSpacing: 0.2 },

  gridWrap: { paddingHorizontal: MP.SIDE, marginTop: 20 },
  emptyText: { fontSize: 12.5, color: MP.SUB, fontWeight: '600' },
});
