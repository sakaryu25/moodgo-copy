// ── (tabs)/profile ─────────────────────────────────────────────────────────
// プロフィールタブ（2026-07-06 全面リニューアル・完成系デザイン準拠）
//   構成: ヒーロー(アバター/名前/@handle/オンライン/統計/編集ボタン)
//         → ✨自分の投稿 → 🏅バッジ(行った！から生成) → 📍最近チェックしたスポット
//   接続: 編集/カメラ/ギア=既存SettingsView ・ ＋投稿する=既存 /post（穴場と同じ）
//         バッジ=lib/spotLog(visited) ・ 最近チェック=lib/spotLog(viewed)
//   「>」は全件サブビュー（タブ内オーバーレイ・戻るで復帰）。
//   デザイントークン: BG #F7F7FA / INK #1E1548 / SUB #8B88A6 / GRAD #FF63A9→#5A8DFF
//   角丸28・カード余白24・画面左右24・間隔24・影 0 8 30 rgba(0,0,0,.05)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import {
  Award, Camera, ChevronLeft, ChevronRight, MapPin, PenLine, Plus,
  Settings as SettingsIcon, Sparkles, UserRound,
} from 'lucide-react-native';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Dimensions, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '@/components/AppBackground';
import MyPostsGlassCard from '@/components/MyPostsGlassCard';
import PuniPressable from '@/components/PuniPressable';
import SettingsView from '@/components/SettingsView';
import { useTabReset } from '@/lib/useTabReset';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { HISTORY_KEY } from '@/lib/storage';
import { loadViewedLog, loadVisitedLog, relativeTime, type SpotLogItem } from '@/lib/spotLog';
import { setSelectedPlace } from '@/lib/selectedPlace';
import type { Recommendation } from '@/types/app';
import {
  useSettings, hydrateSettings, setLang, saveProfile, unblockPlace, clearBlocked,
} from '@/lib/settingsStore';

// SettingsView / GroupsView と同じキー（同期のため）
const NICKNAME_KEY  = 'moodgo-group-nickname';
const USER_ICON_KEY = 'moodgo-user-icon';
const HANDLE_KEY    = 'moodgo-user-handle';   // ユーザーID(@ハンドル)のローカルキャッシュ

// ── デザイントークン（完成系指定）────────────────────────────────────────────
const BG    = '#F7F7FA';
const INK   = '#1E1548';
const SUB   = '#8B88A6';
const PINK  = '#FF63A9';
const BLUE  = '#5A8DFF';
const GRAD: [string, string] = [PINK, BLUE];
const CARD_BORDER = 'rgba(90,90,120,0.08)';
const R = 22;            // 角丸
const SIDE = 20;         // 画面左右余白
const CARD_PAD = 18;     // カード内余白
const GAP_Y = 16;        // カード間隔
const { width: W } = Dimensions.get('window');

type MyPost = {
  id: string;
  kind?: string;                 // 'suggestion' | 'moodlog' | 'blog'
  spot_name: string;
  prefecture: string;
  description: string | null;
  image_urls: string[] | null;
  created_at: string;
  status?: string | null;
};

// community-feed / CommunityFeed と同じ遷移: ブログ=/blog-post、それ以外=/community-spot
function openPost(item: MyPost) {
  if (item.kind === 'blog') {
    router.push({ pathname: '/blog-post', params: { id: item.id.replace(/^bp-/, '') } });
    return;
  }
  router.push({ pathname: '/community-spot', params: { id: item.id } });
}

const KIND_LABEL: Record<string, string> = { suggestion: '穴場', moodlog: 'moodログ', blog: 'おすすめ' };
// 承認前/却下のステータスだけ本人に見せる（approved / null は非表示）
function statusLabel(status?: string | null): string | null {
  if (!status) return null;
  if (status === 'pending')  return '審査中';
  if (status === 'rejected') return '非公開';
  return null;
}

// 住所→都道府県（短い場所表記）
function prefOf(addr?: string): string {
  const m = (addr ?? '').match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
  return m ? m[1].replace(/[都府県]$/, '') : '';
}
// スポット記録→詳細画面へ（既存 /place を利用）
function openSpot(x: SpotLogItem) {
  const rec: Recommendation = {
    title: x.title, address: x.address, photoUrl: x.photoUrl,
    photoUrls: x.photoUrl ? [x.photoUrl] : [], placeId: x.placeId,
    supabaseId: x.supabaseId, tags: x.tags, vibe: '',
  };
  setSelectedPlace(rec);
  router.push('/place');
}

export default function ProfileTab() {
  const insets = useSafeAreaInsets();
  const settings = useSettings();

  const [nickname, setNickname] = useState('');
  const [userHandle, setUserHandle] = useState('');   // ユーザーID(@)。未設定なら空
  const [iconUrl,  setIconUrl]  = useState('');
  const [posts,    setPosts]    = useState<MyPost[]>([]);
  const [badges,   setBadges]   = useState<SpotLogItem[]>([]);
  const [viewed,   setViewed]   = useState<SpotLogItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'profile' | 'other'>('other');
  // 「>」の全件サブビュー（タブ内オーバーレイ）
  const [subView, setSubView] = useState<null | 'posts' | 'badges' | 'viewed'>(null);

  // #14: プロフィールタブを再タップ → サブビュー/設定を閉じてスクロール先頭へ（振り出し）
  const scrollRef = useRef<ScrollView>(null);
  useTabReset(() => { setShowSettings(false); setSubView(null); scrollRef.current?.scrollTo({ y: 0, animated: true }); });

  // ── 入場アニメーション（Fade + TranslateY20 の Stagger・iOS的Spring）──────────
  const anims = useRef(Array.from({ length: 4 }, () => new Animated.Value(0))).current;
  const playEntrance = useCallback(() => {
    anims.forEach((a) => a.setValue(0));
    Animated.stagger(70, anims.map((a) =>
      Animated.spring(a, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 130, mass: 0.9 }),
    )).start();
  }, [anims]);
  const sectionStyle = (i: number) => ({
    opacity: anims[i],
    transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  });

  // 名前・アイコンを読み直す（設定で変更後の反映用）
  const loadProfile = useCallback(async () => {
    const [nick, icon, hnd] = await Promise.all([
      AsyncStorage.getItem(NICKNAME_KEY).catch(() => null),
      AsyncStorage.getItem(USER_ICON_KEY).catch(() => null),
      AsyncStorage.getItem(HANDLE_KEY).catch(() => null),
    ]);
    setNickname(nick ?? '');
    setIconUrl(icon ?? '');
    setUserHandle(hnd ?? '');
  }, []);

  // 自分の投稿を取得
  const loadPosts = useCallback(async () => {
    try {
      const deviceId = await getDeviceId();
      // deviceIdは資格情報なのでURLクエリに載せずPOST bodyで送る（アクセスログ残留対策）
      const res = await apiFetch('/api/my-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json();
      setPosts(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setPosts([]);
    }
  }, []);

  // バッジ(行った！)・最近チェック（端末ローカル記録）
  const loadLogs = useCallback(async () => {
    const [v, w] = await Promise.all([loadVisitedLog(), loadViewedLog()]);
    setBadges(v);
    setViewed(w);
  }, []);

  // フォロワー/フォロー中（user_follows・テーブル未適用は0）
  const [follows, setFollows] = useState({ followers: 0, following: 0 });
  const loadFollows = useCallback(async () => {
    try {
      const deviceId = await getDeviceId();
      const d = await apiFetch('/api/user-follows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'me', deviceId }),
      }).then((r) => r.json());
      if (d?.ok) setFollows({ followers: d.followerCount ?? 0, following: d.followingCount ?? 0 });
    } catch { /* 0のまま */ }
  }, []);

  // タブにフォーカスするたびに最新化（設定変更・投稿・行った！・閲覧の反映）
  useFocusEffect(
    useCallback(() => {
      hydrateSettings();
      loadProfile();
      loadLogs();
      loadFollows();
      playEntrance();
      (async () => {
        setLoading(true);
        await loadPosts();
        setLoading(false);
      })();
    }, [loadProfile, loadPosts, loadLogs, loadFollows, playEntrance]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadProfile(), loadPosts(), loadLogs(), loadFollows()]);
    setRefreshing(false);
  };

  const displayName = nickname.trim() || 'MoodGo';
  const GAP = 10;
  // ⚠ セル幅は「2列＋gap＝内寸ちょうど」だと端数誤差で折り返して縦積みになる。
  //   floor＋1pxの安全マージンで必ず2列/3列に収まるようにする。
  const tileCell   = Math.floor((W - SIDE * 2 - CARD_PAD * 2 - GAP * 2) / 3) - 1;  // カード内3列
  const badgeCell  = Math.floor((W - SIDE * 2 - CARD_PAD * 2 - GAP) / 2) - 1;      // カード内2列
  const tileCellFull  = Math.floor((W - SIDE * 2 - GAP * 2) / 3) - 1;         // サブビュー3列
  const badgeCellFull = Math.floor((W - SIDE * 2 - GAP) / 2) - 1;             // サブビュー2列

  // ── 部品 ────────────────────────────────────────────────────────────────
  const CardHeader = ({ icon, title, onMore }: { icon: React.ReactNode; title: string; onMore?: () => void }) => (
    <View style={s.cardHeader}>
      <View style={s.cardHeaderLeft}>
        {icon}
        <Text style={s.cardTitle}>{title}</Text>
      </View>
      {onMore && (
        <TouchableOpacity onPress={onMore} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button" accessibilityLabel={`${title}をすべて見る`}>
          <ChevronRight size={18} color={SUB} strokeWidth={2.2} />
        </TouchableOpacity>
      )}
    </View>
  );

  const Empty = ({ icon, title, sub, action }: { icon: React.ReactNode; title: string; sub: string; action?: React.ReactNode }) => (
    <View style={s.emptyWrap}>
      <View style={s.emptyIconCircle}>{icon}</View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptySub}>{sub}</Text>
      {action}
    </View>
  );

  const PostTile = ({ item, size }: { item: MyPost; size: number }) => {
    const photo = item.image_urls?.[0];
    const st = statusLabel(item.status);
    return (
      <TouchableOpacity onPress={() => openPost(item)} activeOpacity={0.85}
        style={[s.tile, { width: size, height: size }]}>
        {photo ? (
          <Image source={{ uri: photo }} style={s.tileImg} contentFit="cover" transition={200} />
        ) : (
          <LinearGradient colors={['#EDE9FF', '#E3ECFF']} style={[s.tileImg, s.tilePh]}>
            <MapPin size={Math.round(size * 0.24)} color={BLUE} strokeWidth={1.6} />
          </LinearGradient>
        )}
        <LinearGradient colors={['transparent', 'rgba(30,21,72,0.55)']} style={s.tileScrim} pointerEvents="none" />
        {item.kind && (
          <View style={s.kindBadge}><Text style={s.kindBadgeText}>{KIND_LABEL[item.kind] ?? '投稿'}</Text></View>
        )}
        {st && <View style={s.statusBadge}><Text style={s.statusBadgeText}>{st}</Text></View>}
        <Text style={s.tileLoc} numberOfLines={1}>{item.prefecture || item.spot_name}</Text>
      </TouchableOpacity>
    );
  };

  const BadgeItem = ({ item, size }: { item: SpotLogItem; size: number }) => (
    <TouchableOpacity onPress={() => openSpot(item)} activeOpacity={0.85} style={[s.badgeItem, { width: size }]}>
      <View style={s.badgeRing}>
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.badgeRingGrad}>
          <View style={s.badgeImgWrap}>
            {item.photoUrl ? (
              <Image source={{ uri: item.photoUrl }} style={s.badgeImg} contentFit="cover" transition={200} />
            ) : (
              <View style={[s.badgeImg, s.badgePh]}>
                <Award size={22} color={BLUE} strokeWidth={1.8} />
              </View>
            )}
          </View>
        </LinearGradient>
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.badgeMedal}>
          <Award size={10} color="#fff" strokeWidth={2.4} />
        </LinearGradient>
      </View>
      <Text style={s.badgeName} numberOfLines={1}>{item.title}</Text>
      <Text style={s.badgeDate}>{new Date(item.at).getMonth() + 1}/{new Date(item.at).getDate()} 達成</Text>
    </TouchableOpacity>
  );

  const ViewedRow = ({ item }: { item: SpotLogItem }) => (
    <TouchableOpacity onPress={() => openSpot(item)} activeOpacity={0.8} style={s.viewedRow}>
      {item.photoUrl ? (
        <Image source={{ uri: item.photoUrl }} style={s.viewedThumb} contentFit="cover" transition={200} />
      ) : (
        <View style={[s.viewedThumb, s.viewedThumbPh]}>
          <MapPin size={18} color={BLUE} strokeWidth={1.8} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.viewedName} numberOfLines={1}>{item.title}</Text>
        <Text style={s.viewedArea} numberOfLines={1}>{prefOf(item.address) || item.area || 'スポット'}</Text>
      </View>
      <Text style={s.viewedTime}>{relativeTime(item.at)}</Text>
    </TouchableOpacity>
  );

  // ── サブビュー（全件表示）────────────────────────────────────────────────
  const renderSubView = () => {
    const title = subView === 'posts' ? '自分の投稿' : subView === 'badges' ? 'すべてのバッジ' : 'チェックしたスポット';
    return (
      <View style={[s.root, StyleSheet.absoluteFill]}>
        <AppBackground />
        <View style={[s.subHeader, { paddingTop: insets.top + 8 }]}>
          <PuniPressable onPress={() => setSubView(null)} style={s.glassBtn}>
            <ChevronLeft size={20} color={INK} strokeWidth={2.2} />
          </PuniPressable>
          <Text style={s.subTitle} numberOfLines={1}>{title}</Text>
          <View style={{ width: 42 }} />
        </View>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: 8, paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
        >
          {subView === 'posts' && (
            posts.length === 0 ? (
              <Empty icon={<PenLine size={22} color={BLUE} strokeWidth={1.8} />} title="まだ投稿がありません"
                sub="気になったスポットで「投稿」してみよう！" />
            ) : (
              <View style={[s.grid, { gap: GAP }]}>
                {posts.map((p) => <PostTile key={p.id} item={p} size={tileCellFull} />)}
              </View>
            )
          )}
          {subView === 'badges' && (
            badges.length === 0 ? (
              <Empty icon={<Award size={22} color={BLUE} strokeWidth={1.8} />} title="バッジはまだありません"
                sub="いろいろなスポットを訪れてバッジを集めよう！" />
            ) : (
              <View style={[s.grid, { gap: GAP }]}>
                {badges.map((b, i) => <BadgeItem key={`${b.title}-${i}`} item={b} size={badgeCellFull} />)}
              </View>
            )
          )}
          {subView === 'viewed' && (
            viewed.length === 0 ? (
              <Empty icon={<MapPin size={22} color={BLUE} strokeWidth={1.8} />} title="最近チェックしたスポットはありません"
                sub="気になるスポットをチェックしてみよう！" />
            ) : (
              <View style={{ gap: 4 }}>
                {viewed.map((v, i) => <ViewedRow key={`${v.title}-${i}`} item={v} />)}
              </View>
            )
          )}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={s.root}>
      <AppBackground />
      {/* 上部のラベンダーフェード（完成系の背景トーン） */}
      <LinearGradient colors={['#E9E3FF', 'rgba(233,227,255,0)']} style={s.topFade} pointerEvents="none" />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: insets.top + 6, paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} />}
      >
        {/* ── ヘッダー：中央タイトル＋右ギア(Glass 48) ── */}
        <View style={s.headerRow}>
          <View style={{ width: 42 }} />
          <Text style={s.pageTitle}>プロフィール</Text>
          <PuniPressable onPress={() => { setSettingsSection('other'); setShowSettings(true); }}
            style={s.glassBtn}>
            <SettingsIcon size={19} color={INK} strokeWidth={2} />
          </PuniPressable>
        </View>

        {/* ── ヒーロー：アバター＋名前＋@handle＋オンライン＋統計＋編集 ── */}
        <Animated.View style={sectionStyle(0)}>
          <View style={s.heroRow}>
            {/* アバター 120 / グラデリング / 白枠4 / カメラバッジ */}
            <View style={s.avatarBox}>
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatarRing}>
                <View style={s.avatarWhite}>
                  {iconUrl ? (
                    <Image source={{ uri: iconUrl }} style={s.avatarImg} contentFit="cover" />
                  ) : (
                    <View style={[s.avatarImg, s.avatarPh]}>
                      <UserRound size={34} color={BLUE} strokeWidth={1.6} />
                    </View>
                  )}
                </View>
              </LinearGradient>
              <PuniPressable onPress={() => { setSettingsSection('profile'); setShowSettings(true); }}
                style={s.cameraBadge}>
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.cameraBadgeGrad}>
                  <Camera size={13} color="#fff" strokeWidth={2.2} />
                </LinearGradient>
              </PuniPressable>
            </View>

            <View style={s.heroRight}>
              <View style={s.nameRow}>
                <Text style={s.nickname} numberOfLines={1}>{displayName}</Text>
              </View>
              <View style={s.handleRow}>
                {userHandle ? (
                  <Text style={s.handle} numberOfLines={1}>@{userHandle}</Text>
                ) : (
                  <TouchableOpacity onPress={() => { setSettingsSection('profile'); setShowSettings(true); }} activeOpacity={0.7}>
                    <Text style={s.handle} numberOfLines={1}>IDを設定 ›</Text>
                  </TouchableOpacity>
                )}
                <View style={s.onlinePill}>
                  <View style={s.onlineDot} />
                  <Text style={s.onlineText}>オンライン</Text>
                </View>
              </View>
              {/* 統計 3列（縦線区切り） */}
              <View style={s.statsRow}>
                <View style={s.statCol}>
                  <Text style={s.statNum}>{posts.length}</Text>
                  <Text style={s.statLabel}>投稿</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statCol}>
                  <Text style={s.statNum}>{follows.followers}</Text>
                  <Text style={s.statLabel}>フォロワー</Text>
                </View>
                <View style={s.statDivider} />
                <View style={s.statCol}>
                  <Text style={s.statNum}>{follows.following}</Text>
                  <Text style={s.statLabel}>フォロー中</Text>
                </View>
              </View>
            </View>
          </View>

          {/* プロフィールを編集（h60 / r999 / グラデ #FF63A9→#5A8DFF）→ 既存の編集画面へ */}
          <PuniPressable onPress={() => { setSettingsSection('profile'); setShowSettings(true); }} style={s.editBtn}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.editBtnInner}>
              <PenLine size={16} color="#fff" strokeWidth={2.2} />
              <Text style={s.editBtnText}>プロフィールを編集</Text>
            </LinearGradient>
          </PuniPressable>
        </Animated.View>

        {/* ── ✨ 自分の投稿（投稿あり=Glassmorphismカード / ロード中・0件=既存デザイン）── */}
        <Animated.View style={sectionStyle(1)}>
          {loading || posts.length === 0 ? (
            <View style={s.card}>
              <CardHeader icon={<Sparkles size={16} color={PINK} strokeWidth={2.2} />} title="自分の投稿"
                onMore={() => router.push('/my-posts')} />
              {loading ? (
                <View style={s.loadingWrap}><ActivityIndicator color={BLUE} size="small" /></View>
              ) : (
                <Empty
                  icon={<PenLine size={22} color={BLUE} strokeWidth={1.8} />}
                  title="まだ投稿がありません"
                  sub="気になったスポットで「投稿」してみよう！"
                  action={
                    // 全国みんなの穴場と同じ投稿画面(/post)をそのまま開く（新規画面は作らない）
                    <PuniPressable onPress={() => router.push('/post')} style={s.outlineBtn}>
                      <Plus size={15} color={BLUE} strokeWidth={2.4} />
                      <Text style={s.outlineBtnText}>投稿する</Text>
                    </PuniPressable>
                  }
                />
              )}
            </View>
          ) : (
            <MyPostsGlassCard
              posts={posts}
              onMore={() => router.push('/my-posts')}
              onPressPost={(p) => openPost(p as MyPost)}
            />
          )}
        </Animated.View>

        {/* ── 🏅 バッジ（行った！から生成） ── */}
        <Animated.View style={[s.card, sectionStyle(2)]}>
          <CardHeader icon={<Award size={16} color="#F5A623" strokeWidth={2.2} />} title="バッジ"
            onMore={() => setSubView('badges')} />
          {badges.length === 0 ? (
            <Empty icon={<Award size={22} color={BLUE} strokeWidth={1.8} />} title="バッジはまだありません"
              sub="いろいろなスポットを訪れてバッジを集めよう！" />
          ) : (
            <View style={[s.grid, { gap: GAP }]}>
              {badges.slice(0, 4).map((b, i) => <BadgeItem key={`${b.title}-${i}`} item={b} size={badgeCell} />)}
            </View>
          )}
        </Animated.View>

        {/* ── 📍 最近チェックしたスポット ── */}
        <Animated.View style={[s.card, sectionStyle(3)]}>
          <CardHeader icon={<MapPin size={16} color={BLUE} strokeWidth={2.2} />} title="最近チェックしたスポット"
            onMore={() => setSubView('viewed')} />
          {viewed.length === 0 ? (
            <Empty icon={<MapPin size={22} color={BLUE} strokeWidth={1.8} />} title="最近チェックしたスポットはありません"
              sub="気になるスポットをチェックしてみよう！" />
          ) : (
            <View style={{ gap: 4 }}>
              {viewed.slice(0, 4).map((v, i) => <ViewedRow key={`${v.title}-${i}`} item={v} />)}
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {/* 「>」全件サブビュー（タブ内オーバーレイ） */}
      {subView && renderSubView()}

      {/* ── 設定（既存SettingsViewへ接続。profile=編集 / other=設定）── */}
      <SettingsView
        visible={showSettings}
        section={settingsSection}
        onClose={() => { setShowSettings(false); loadProfile(); }}
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
  root: { flex: 1, backgroundColor: BG },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 300 },

  // ヘッダー
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  pageTitle: { fontSize: 20, fontWeight: '800', color: INK, letterSpacing: -0.3 },
  glassBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: CARD_BORDER,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 14, elevation: 2,
  },

  // ヒーロー
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  avatarBox: { width: 96, height: 96 },
  avatarRing: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  avatarWhite: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: 80, height: 80, borderRadius: 40 },
  avatarPh: { backgroundColor: '#F0EDFF', alignItems: 'center', justifyContent: 'center' },
  cameraBadge: { position: 'absolute', right: 2, bottom: 2 },
  cameraBadgeGrad: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: '#fff',
  },
  heroRight: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nickname: { fontSize: 24, fontWeight: '800', color: INK, letterSpacing: -0.5, flexShrink: 1 },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  handle: { fontSize: 13, fontWeight: '600', color: SUB, flexShrink: 1 },
  onlinePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3.5,
    borderWidth: 1, borderColor: CARD_BORDER,
  },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#34C759' },
  onlineText: { fontSize: 10.5, fontWeight: '700', color: INK },

  // 統計
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  statCol: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 20, fontWeight: '800', color: INK, letterSpacing: -0.5 },
  statLabel: { fontSize: 11.5, fontWeight: '600', color: SUB, marginTop: 1 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: 'rgba(90,90,120,0.18)' },

  // 編集ボタン
  editBtn: {
    borderRadius: 999, overflow: 'hidden', marginBottom: GAP_Y,
    shadowColor: PINK, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 14, elevation: 4,
  },
  editBtnInner: {
    height: 52, borderRadius: 999, flexDirection: 'row', gap: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  editBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '800', letterSpacing: 0.2 },

  // カード共通（角丸28 / 余白24 / 影 0 8 30 .05 / 枠 rgba(90,90,120,.08)）
  card: {
    backgroundColor: '#fff', borderRadius: R, padding: CARD_PAD, marginBottom: GAP_Y,
    borderWidth: 1, borderColor: CARD_BORDER,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.05, shadowRadius: 24, elevation: 3,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: INK, letterSpacing: -0.2 },

  loadingWrap: { height: 70, alignItems: 'center', justifyContent: 'center' },

  // 空状態
  emptyWrap: { alignItems: 'center', paddingVertical: 16, gap: 6 },
  emptyIconCircle: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#F0EDFF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  emptyTitle: { fontSize: 14.5, fontWeight: '800', color: INK },
  emptySub: { fontSize: 12, fontWeight: '500', color: SUB, textAlign: 'center' },
  outlineBtn: {
    marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(90,141,255,0.45)',
    paddingHorizontal: 24, paddingVertical: 11, backgroundColor: '#fff', alignSelf: 'stretch',
  },
  outlineBtnText: { fontSize: 13.5, fontWeight: '800', color: BLUE },

  // 投稿タイル
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#EFEDF8', position: 'relative' },
  tileImg: { width: '100%', height: '100%' },
  tilePh: { alignItems: 'center', justifyContent: 'center' },
  tileScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  kindBadge: {
    position: 'absolute', top: 6, left: 6, borderRadius: 7,
    backgroundColor: 'rgba(30,21,72,0.72)', paddingHorizontal: 6, paddingVertical: 2,
  },
  kindBadgeText: { color: '#fff', fontSize: 8.5, fontWeight: '800' },
  statusBadge: {
    position: 'absolute', top: 6, right: 6, borderRadius: 7,
    backgroundColor: 'rgba(244,63,94,0.9)', paddingHorizontal: 6, paddingVertical: 2,
  },
  statusBadgeText: { color: '#fff', fontSize: 8.5, fontWeight: '800' },
  tileLoc: {
    position: 'absolute', left: 7, right: 7, bottom: 6, color: '#fff', fontSize: 10, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },

  // バッジ
  badgeItem: { alignItems: 'center', paddingVertical: 6 },
  badgeRing: { width: 70, height: 70, marginBottom: 6 },
  badgeRingGrad: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
  badgeImgWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  badgeImg: { width: 58, height: 58, borderRadius: 29 },
  badgePh: { backgroundColor: '#F0EDFF', alignItems: 'center', justifyContent: 'center' },
  badgeMedal: {
    position: 'absolute', right: 0, bottom: 3, width: 21, height: 21, borderRadius: 10.5,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff',
  },
  badgeName: { fontSize: 12.5, fontWeight: '800', color: INK, maxWidth: '92%' },
  badgeDate: { fontSize: 11, fontWeight: '600', color: SUB, marginTop: 2 },

  // 最近チェック
  viewedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7,
  },
  viewedThumb: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#F0EDFF' },
  viewedThumbPh: { alignItems: 'center', justifyContent: 'center' },
  viewedName: { fontSize: 13.5, fontWeight: '800', color: INK },
  viewedArea: { fontSize: 11.5, fontWeight: '600', color: SUB, marginTop: 1 },
  viewedTime: { fontSize: 11, fontWeight: '600', color: SUB, marginLeft: 6 },

  // サブビュー
  subHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SIDE, paddingBottom: 10,
  },
  subTitle: { fontSize: 17, fontWeight: '800', color: INK, flexShrink: 1 },
});
