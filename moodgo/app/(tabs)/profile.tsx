// ── (tabs)/profile ─────────────────────────────────────────────────────────
// プロフィールタブ（下タブ一番右・つぶやきタブを外した枠に追加）
//   ① ニックネーム / アイコン（＋編集＝設定を開く）
//   ② 自分の投稿一覧（/api/my-posts）
//   ③ 設定（SettingsView をこのタブ内から開く。ホームからは撤去）
// 設定 state（言語/プロフィール/非表示）は lib/settingsStore に持ち上げてホームと共有する。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { MapPin, Settings as SettingsIcon, Sparkles, UserRound } from 'lucide-react-native';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, Dimensions, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '@/components/AppBackground';
import PuniPressable from '@/components/PuniPressable';
import SettingsView from '@/components/SettingsView';
import { useTabReset } from '@/lib/useTabReset';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { HISTORY_KEY } from '@/lib/storage';
import {
  useSettings, hydrateSettings, setLang, saveProfile, unblockPlace, clearBlocked,
} from '@/lib/settingsStore';

// SettingsView / GroupsView と同じキー（同期のため）
const NICKNAME_KEY  = 'moodgo-group-nickname';
const USER_ICON_KEY = 'moodgo-user-icon';

const PINK   = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE   = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
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

export default function ProfileTab() {
  const insets = useSafeAreaInsets();
  const settings = useSettings();

  const [nickname, setNickname] = useState('');
  const [iconUrl,  setIconUrl]  = useState('');
  const [posts,    setPosts]    = useState<MyPost[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'profile' | 'other'>('other');
  // #14: プロフィールタブを再タップ → 設定を閉じてスクロール先頭へ（振り出し）
  const scrollRef = useRef<ScrollView>(null);
  useTabReset(() => { setShowSettings(false); scrollRef.current?.scrollTo({ y: 0, animated: true }); });

  // 名前・アイコンを読み直す（設定で変更後の反映用）
  const loadProfile = useCallback(async () => {
    const [nick, icon] = await Promise.all([
      AsyncStorage.getItem(NICKNAME_KEY).catch(() => null),
      AsyncStorage.getItem(USER_ICON_KEY).catch(() => null),
    ]);
    setNickname(nick ?? '');
    setIconUrl(icon ?? '');
  }, []);

  // 自分の投稿を取得
  const loadPosts = useCallback(async () => {
    try {
      const deviceId = await getDeviceId();
      const res = await apiFetch(`/api/my-posts?deviceId=${encodeURIComponent(deviceId)}`);
      const data = await res.json();
      setPosts(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setPosts([]);
    }
  }, []);

  // タブにフォーカスするたびに最新化（設定で名前/アイコン/言語を変えても戻れば反映）
  useFocusEffect(
    useCallback(() => {
      hydrateSettings();
      loadProfile();
      (async () => {
        setLoading(true);
        await loadPosts();
        setLoading(false);
      })();
    }, [loadProfile, loadPosts]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadProfile(), loadPosts()]);
    setRefreshing(false);
  };

  // インスタ風3列グリッド
  const GAP = 3;
  const COLS = 3;
  const cell = (W - 40 - GAP * (COLS - 1)) / COLS;   // 左右padding 20*2

  return (
    <View style={s.root}>
      <AppBackground />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE} />}
      >
        {/* ── ヘッダー（タイトル＋設定ギア）── */}
        <View style={s.headerRow}>
          <Text style={s.pageTitle}>プロフィール</Text>
          <PuniPressable onPress={() => { setSettingsSection('other'); setShowSettings(true); }} style={s.gearBtn}>
            <SettingsIcon size={20} color="#7C3AED" strokeWidth={2} />
          </PuniPressable>
        </View>

        {/* ── ① ニックネーム / アイコン（＋編集）── */}
        <View style={s.profileCard}>
          <View style={s.avatarWrap}>
            {iconUrl ? (
              <Image source={{ uri: iconUrl }} style={s.avatarImg} contentFit="cover" />
            ) : (
              <View style={[s.avatarImg, s.avatarPh]}>
                <UserRound size={38} color={PURPLE} strokeWidth={1.8} />
              </View>
            )}
          </View>
          <Text style={s.nickname} numberOfLines={1}>
            {nickname.trim() || 'MoodGoユーザー'}
          </Text>
          <PuniPressable onPress={() => { setSettingsSection('profile'); setShowSettings(true); }} style={s.editBtn}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.editBtnInner}>
              <Text style={s.editBtnText}>プロフィールを編集</Text>
            </LinearGradient>
          </PuniPressable>
        </View>

        {/* ── ② 自分の投稿一覧 ── */}
        <View style={s.sectionHeader}>
          <Sparkles size={15} color={PURPLE} strokeWidth={2} />
          <Text style={s.sectionLabel}>自分の投稿</Text>
          {!loading && posts.length > 0 && <Text style={s.sectionCount}>{posts.length}</Text>}
        </View>

        {loading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator color={PURPLE} size="small" />
          </View>
        ) : posts.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyText}>まだ投稿がありません</Text>
            <Text style={s.emptySub}>気になったスポットで「投稿」してみよう</Text>
          </View>
        ) : (
          <View style={[s.grid, { gap: GAP }]}>
            {posts.map((item) => {
              const photo = item.image_urls?.[0];
              const st = statusLabel(item.status);
              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => openPost(item)}
                  activeOpacity={0.85}
                  style={[s.tile, { width: cell, height: cell }]}
                >
                  {photo ? (
                    <Image source={{ uri: photo }} style={s.tileImg} contentFit="cover" transition={200} />
                  ) : (
                    <LinearGradient colors={['#C5D8F0', '#A8C8E8']} style={[s.tileImg, s.tilePh]}>
                      <MapPin size={Math.round(cell * 0.24)} color={PURPLE} strokeWidth={1.6} />
                    </LinearGradient>
                  )}
                  <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} style={s.tileScrim} pointerEvents="none" />
                  {item.kind && (
                    <View style={s.kindBadge}>
                      <Text style={s.kindBadgeText}>{KIND_LABEL[item.kind] ?? '投稿'}</Text>
                    </View>
                  )}
                  {st && (
                    <View style={s.statusBadge}>
                      <Text style={s.statusBadgeText}>{st}</Text>
                    </View>
                  )}
                  <Text style={s.tileLoc} numberOfLines={1}>{item.prefecture || item.spot_name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* ── ③ 設定（ホームから撤去し、ここへ集約）── */}
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
  root: { flex: 1, backgroundColor: '#F3F1EF' },

  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  pageTitle: { fontSize: 26, fontWeight: '900', color: '#1E0753', letterSpacing: -0.5 },
  gearBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDE9FE',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(124,58,237,0.12)',
  },

  // プロフィールカード
  profileCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 22, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#EDE9FE',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.09, shadowRadius: 12, elevation: 3,
  },
  avatarWrap: { width: 92, height: 92, marginBottom: 12 },
  avatarImg: { width: 92, height: 92, borderRadius: 46 },
  avatarPh: {
    backgroundColor: '#F3EEFF', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#DDD6FE',
  },
  nickname: { fontSize: 20, fontWeight: '900', color: '#1E0753', marginBottom: 14, maxWidth: '90%' },
  editBtn: { borderRadius: 999, overflow: 'hidden' },
  editBtnInner: { paddingHorizontal: 22, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  editBtnText: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },

  // セクション
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 26, marginBottom: 12,
  },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: PURPLE, letterSpacing: 0.3 },
  sectionCount: {
    fontSize: 11, fontWeight: '800', color: '#fff', backgroundColor: '#C4B5FD',
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden',
  },

  loadingWrap: { height: 80, alignItems: 'center', justifyContent: 'center' },
  emptyBox: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 6,
    backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 18,
  },
  emptyText: { fontSize: 14, fontWeight: '700', color: '#7C6BA8' },
  emptySub: { fontSize: 12, color: '#A78BFA' },

  // グリッド
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { borderRadius: 8, overflow: 'hidden', backgroundColor: '#E8E0FF', position: 'relative' },
  tileImg: { width: '100%', height: '100%' },
  tilePh: { alignItems: 'center', justifyContent: 'center' },
  tileScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  kindBadge: {
    position: 'absolute', top: 5, left: 5, borderRadius: 6,
    backgroundColor: 'rgba(124,58,237,0.85)', paddingHorizontal: 6, paddingVertical: 1.5,
  },
  kindBadgeText: { color: '#fff', fontSize: 8.5, fontWeight: '800' },
  statusBadge: {
    position: 'absolute', top: 5, right: 5, borderRadius: 6,
    backgroundColor: 'rgba(244,63,94,0.9)', paddingHorizontal: 6, paddingVertical: 1.5,
  },
  statusBadgeText: { color: '#fff', fontSize: 8.5, fontWeight: '800' },
  tileLoc: {
    position: 'absolute', left: 5, right: 5, bottom: 4, color: '#fff', fontSize: 9.5, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
});
