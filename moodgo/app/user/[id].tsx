// ── /user/[id] ────────────────────────────────────────────────────────────────
// 投稿者のフルプロフィール（案7 Pinterest風・2026-07-08 全面リニューアル）。
//   idは公開ハッシュposterId（生device_idは扱わない）。データは既存 /api/user-profile。
//   構成: 戻る/…メニュー → アバター左+名前/@ID → 統計5列(カード無し・背景直載せ)
//        → グラデ フォローボタン → タブ(投稿/保存) → Pinterest2列3:4グリッド。
//   Apple的な余白・薄い影・線少なめ・白ベース。背景はアプリ共通のM透かし(AppBackground)。
//   スマホ(iPhone)専用・レスポンシブ不要。新ライブラリ追加なし。
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
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
import VerifiedBadge from '@/components/VerifiedBadge';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { showToast } from '@/lib/toast';
import { useSettings } from '@/lib/settingsStore';
import { useBlocks, blockUser, muteUser, unblockUser } from '@/lib/blockStore';
import { registerForPushNotificationsAsync } from '@/lib/push';
import { feedStaleVersion } from '@/lib/feedRefresh';

const SCREEN_W = Dimensions.get('window').width;
const SIDE = 16;                                   // 画面左右の余白
const GAP = 12;                                    // カード間（横・縦）
const COL_W = Math.floor((SCREEN_W - SIDE * 2 - GAP) / 2);
const CARD_H = Math.round(COL_W * 4 / 3);          // カード比率 3:4（既定）
// みんなの穴場のような段差(masonry)にするためカード高さ比率を循環させる
const CARD_RATIOS = [1.34, 1.0, 1.18, 1.5];
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
  name: string | null; handle: string | null; icon: string | null; isMe?: boolean; bio?: string | null; accountType?: string | null;
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
function Stat({ num, label, onPress }: { num: number; label: string; onPress?: () => void }) {
  // ルート自身に statCol(flex:1) を当てる。以前はタップ可能な時だけ Pressable が
  // flex 無しで挟まり、その列だけ内容幅に潰れて5列が不均等になっていた。
  const inner = (
    <>
      <Text style={s.statNum} numberOfLines={1}>{compact(num)}</Text>
      <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
    </>
  );
  return onPress
    ? <Pressable onPress={onPress} hitSlop={6} style={s.statCol}>{inner}</Pressable>
    : <View style={s.statCol}>{inner}</View>;
}

// ── 投稿カード（Pinterest風・画像いっぱい＋下部に黒グラデ＋タイトル/♥/📍）──────
function PostCard({ post, ratio = 1.34, onPress }: { post: ProfilePost; ratio?: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.card, { height: Math.round(COL_W * ratio) }, pressed && { transform: [{ scale: 0.98 }] }]}
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
const MEDAL_W = Math.floor((SCREEN_W - SIDE * 2 - GAP * 3) / 4);   // 行ったスポットは横4列（中央揃え）
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
  const blocks = useBlocks();                     // ブロック/ミュート状態（メニューの出し分け）
  const isBlocked = !!posterId && blocks.blocked.includes(posterId);
  const isMuted = !!posterId && blocks.muted.includes(posterId);
  const [shown, setShown] = useState(PAGE);       // 無限スクロールで表示中の件数
  const [pagingMore, setPagingMore] = useState(false);
  const pagingRef = useRef(false);
  const isMounted = useRef(true);

  // 画面フェードイン＋タブ下線アニメ
  const fade = useRef(new Animated.Value(0)).current;
  const underline = useRef(new Animated.Value(0)).current;

  const loadProfile = useCallback(async () => {
    if (!posterId) { setLoading(false); return; }
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
  }, [posterId]);

  useEffect(() => {
    isMounted.current = true;
    loadProfile();
    return () => { isMounted.current = false; };
  }, [loadProfile]);

  // 子画面(投稿詳細)でいいね/行った/コメント等をして戻った時に、投稿カードのカウントと
  // ヘッダー統計を最新化（マウント時のみ取得だとずっと古いままになる問題の解消）。
  const lastVer = useRef(feedStaleVersion());
  useFocusEffect(useCallback(() => {
    isMounted.current = true;
    if (feedStaleVersion() !== lastVer.current) {
      lastVer.current = feedStaleVersion();
      loadProfile();
    }
  }, [loadProfile]));

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
      // フォローした＝SNS的な関わりを持った明示的な文脈なので、ここでプッシュ通知の
      // 許可＋トークン登録を行う（フォロー返し等の通知を受け取れるように）。no-op安全。
      if (next) registerForPushNotificationsAsync().catch(() => {});
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
    const name = profile?.name || 'このユーザー';
    // 自分のプロフィールではブロック等を出さない
    if (isMe || !posterId) {
      Alert.alert(name, undefined, [{ text: 'キャンセル', style: 'cancel' }]);
      return;
    }
    // すでにブロック/ミュート中 → 解除
    if (isBlocked || isMuted) {
      Alert.alert(name, isBlocked ? 'ブロック中です' : 'ミュート中です', [
        { text: isBlocked ? 'ブロックを解除' : 'ミュートを解除', onPress: () => { unblockUser(posterId); showToast('解除しました', `${name}の表示を元に戻しました`); } },
        { text: 'キャンセル', style: 'cancel' },
      ]);
      return;
    }
    // ミュート（静かに非表示）/ ブロック（相互フォロー解除して遮断）/ 通報
    Alert.alert(name, undefined, [
      { text: 'ミュート', onPress: () => { muteUser(posterId); showToast('ミュートしました', 'この人の投稿を静かに非表示にしました'); } },
      { text: 'ブロック', style: 'destructive', onPress: () => { blockUser(posterId); showToast('ブロックしました', 'この人の投稿・コメントを非表示にしました'); router.back(); } },
      { text: 'この投稿者を通報', style: 'destructive', onPress: async () => {
        try {
          const deviceId = await getDeviceId();
          const d = await apiFetch('/api/reports', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ spot_name: `ユーザー: ${profile?.handle ? '@' + profile.handle : (profile?.name || name)}`, reason: '不適切なユーザー', note: `posterId=${posterId}`, device_id: deviceId }),
          }).then((r) => r.json());
          showToast(d?.ok ? '通報しました' : '通報できませんでした', d?.ok ? 'ご協力ありがとうございます' : '時間をおいてお試しください');
        } catch { showToast('通報できませんでした', '時間をおいてお試しください'); }
      } },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  };

  const posts = profile?.posts ?? [];
  const visible = useMemo(() => posts.slice(0, shown), [posts, shown]);
  const hasMore = shown < posts.length;
  // 貪欲2列（左=偶数index / 右=奇数index。3:4の均一グリッド）
  // みんなの穴場のような段差(masonry): 各カードに可変高さ比率を付け、低い方の列へ積む
  const [colL, colR] = useMemo(() => {
    const l: Array<ProfilePost & { _ratio: number }> = [], r: Array<ProfilePost & { _ratio: number }> = [];
    let hL = 0, hR = 0;
    visible.forEach((p, i) => {
      const ratio = CARD_RATIOS[i % CARD_RATIOS.length];
      if (hL <= hR) { l.push({ ...p, _ratio: ratio }); hL += ratio; }
      else { r.push({ ...p, _ratio: ratio }); hR += ratio; }
    });
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
  // 自分のページ(isMe)はローカル設定を優先＝プロフィール編集が即時反映（サーバー反映待ちしない）
  const name = (isMe && localSettings.nickname.trim()) || profile?.name?.trim() || 'MoodGoユーザー';
  const iconUri = (isMe && localSettings.iconUrl) ? localSettings.iconUrl : (profile?.icon ?? '');
  const badgeType = isMe ? (localSettings.accountType || profile?.accountType || null) : (profile?.accountType ?? null);
  const handleText = (isMe && localSettings.handle) ? localSettings.handle : (profile?.handle ?? '');
  const tabW = (SCREEN_W - SIDE * 2) / 2;
  // 一言メッセージ: 自分のページはローカル優先＝編集が即時反映（名前/アイコンと統一）。他人はサーバー(公開)値。
  const bioText = isMe ? ((localSettings.profileBio ?? '').trim() || profile?.bio?.trim() || '') : (profile?.bio?.trim() || '');
  // 在住地(県)はローカル保存のみ（サーバー未同期）→ 本人閲覧時だけプロフィールタブと同様に表示
  const prefText = isMe && localSettings.showPrefecture ? (localSettings.profilePrefecture ?? '').trim() : '';
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
                {iconUri ? (
                  <Image source={{ uri: iconUri }} style={s.avatar} contentFit="cover" />
                ) : (
                  <View style={[s.avatar, s.avatarPh]}><UserRound size={34} color={BRAND} strokeWidth={1.6} /></View>
                )}
              </View>
            </LinearGradient>
            <View style={s.heroRight}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={[s.name, { flexShrink: 1 }]} numberOfLines={1}>{name}</Text>
                <VerifiedBadge type={badgeType} size={17} />
              </View>
              {handleText
                ? <Text style={s.handle} numberOfLines={1}>@{handleText}</Text>
                : <Text style={s.handleMuted} numberOfLines={1}>@MoodGoユーザー</Text>}
              {/* 一言＋在住地(県): プロフィールタブと全く同じ配置（@IDの下・ピン付きで行末に県）。
                  県はローカル保存のみのため本人閲覧時だけ表示（他人の県はサーバー未同期） */}
              {(bioText || prefText) ? (
                <Text style={s.bioInline} numberOfLines={3}>
                  {bioText}
                  {prefText ? (
                    <Text style={s.prefInline}>
                      {bioText ? '　' : ''}
                      <MapPin size={11} color="#8B88A6" strokeWidth={2.4} />
                      {' '}{prefText}
                    </Text>
                  ) : null}
                </Text>
              ) : null}
            </View>
          </View>

          {/* ── 統計 5列（プロフィールタブと同じ順: 投稿/行った/フォロー中/フォロワー/いいね）── */}
          <View style={s.statsRow}>
            <Stat num={profile?.postCount ?? 0} label="投稿" />
            <View style={s.statDivider} />
            <Stat num={profile?.visitedCount ?? 0} label="行った" />
            <View style={s.statDivider} />
            <Stat num={profile?.followingCount ?? 0} label="フォロー中" onPress={() => router.push({ pathname: '/follow-list', params: { id: posterId, kind: 'following' } })} />
            <View style={s.statDivider} />
            <Stat num={followerCount} label="フォロワー" onPress={() => router.push({ pathname: '/follow-list', params: { id: posterId, kind: 'followers' } })} />
            <View style={s.statDivider} />
            <Stat num={profile?.likeCount ?? 0} label="いいね" />
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
                  <View style={s.col}>{colL.map((p) => <PostCard key={p.id} post={p} ratio={p._ratio} onPress={() => openPost(p)} />)}</View>
                  <View style={s.col}>{colR.map((p) => <PostCard key={p.id} post={p} ratio={p._ratio} onPress={() => openPost(p)} />)}</View>
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

  // 統計（カード無し・区切り線あり＝プロフィールタブと統一）
  statsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, marginTop: 22 },
  statCol: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: 'rgba(90,90,120,0.16)' },
  statNum: { fontSize: 19, fontWeight: '800', color: INK, letterSpacing: -0.6 },
  statLabel: { fontSize: 10.5, fontWeight: '600', color: SUB, marginTop: 4 },

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
    width: COL_W, borderRadius: 18, overflow: 'hidden', backgroundColor: '#ECE8F5',
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

  // 一言メッセージ＋在住地（プロフィールタブと同じ配置・配色: 右カラム内・県は薄グレー＋ピン）
  bioInline: { fontSize: 13.5, color: '#5B5470', lineHeight: 19, marginTop: 7 },
  prefInline: { color: '#8B88A6', fontWeight: '700' },

  // 行ったスポットの勲章バッジ（2列×N・少数は中央揃え）
  medalGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: GAP, paddingHorizontal: SIDE, marginTop: 18 },
  medal: { width: MEDAL_W, alignItems: 'center', paddingVertical: 8 },
  medalRingWrap: { width: 64, height: 64 },
  medalRing: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  medalWhite: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  medalImg: { width: 50, height: 50, borderRadius: 25 },
  medalPh: { backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center' },
  medalIcon: {
    position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff',
  },
  medalName: { fontSize: 10.5, fontWeight: '800', color: INK, marginTop: 7, maxWidth: MEDAL_W - 2, textAlign: 'center' },
  medalDate: { fontSize: 9, fontWeight: '600', color: SUB, marginTop: 1 },

  // 空状態
  emptyWrap: { alignItems: 'center', paddingVertical: 70, gap: 12 },
  emptyIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 14, fontWeight: '700', color: INK },
});
