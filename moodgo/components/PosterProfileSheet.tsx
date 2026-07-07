/**
 * PosterProfileSheet — 投稿者の公開プロフィール（ボトムシート）
 *
 * community-spot の投稿者カードから開く。名前 / @ID / 投稿数 / フォロワー / フォロー中、
 * フォロー・フォロー解除、その人の公開投稿グリッド（タップで投稿詳細へ）。
 *   ⚠ Fabricの透明Modalは「常時マウント＋visibleトグル」のみ安全（条件付きマウント禁止）。
 *   ⚠ 投稿者の識別は公開ハッシュ(posterId)のみ。生device_idは扱わない。
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { MapPin, UserRound, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Dimensions, Modal, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { showToast } from '@/lib/toast';

const PINK = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const INK = '#1E1548';
const SUB = '#8B88A6';
const { width: W } = Dimensions.get('window');

type ProfilePost = {
  id: string; kind: string; spot_name: string; prefecture: string;
  image: string | null; created_at: string;
};
type Profile = {
  posterId: string;
  name: string | null; handle: string | null; icon: string | null;
  postCount: number; followerCount: number; followingCount: number; isFollowing: boolean;
  posts: ProfilePost[];
};

export default function PosterProfileSheet({
  visible, posterId, fallbackName, fallbackHandle, fallbackIcon, onClose,
}: {
  visible: boolean;
  posterId: string | null;
  fallbackName?: string | null;      // シート読み込み中に出す既知の表示情報
  fallbackHandle?: string | null;
  fallbackIcon?: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const isMounted = useRef(true);
  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);

  // 開くたびに取得（posterIdが変わった時も）
  useEffect(() => {
    if (!visible || !posterId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setProfile(null);
      try {
        const viewerDeviceId = await getDeviceId();
        const res = await apiFetch('/api/user-profile', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetId: posterId, viewerDeviceId }),
        });
        const d = await res.json();
        if (!cancelled && isMounted.current && d?.ok && d.profile) {
          setProfile(d.profile);
          setFollowing(!!d.profile.isFollowing);
          setFollowerCount(d.profile.followerCount ?? 0);
        }
      } catch { /* フォールバック表示のまま */ }
      finally { if (!cancelled && isMounted.current) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [visible, posterId]);

  // フォロー/解除（楽観更新・失敗時ロールバック）
  const toggleFollow = useCallback(async () => {
    if (!posterId || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !following;
    setFollowing(next);
    setFollowerCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setBusy(true);
    try {
      const deviceId = await getDeviceId();
      const res = await apiFetch('/api/user-follows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: next ? 'follow' : 'unfollow', deviceId, targetId: posterId }),
      });
      const d = await res.json();
      if (!d?.ok) throw new Error(d?.tableMissing ? 'follow準備中' : 'follow失敗');
      if (isMounted.current && typeof d.followerCount === 'number') setFollowerCount(d.followerCount);
    } catch {
      // ロールバック
      if (isMounted.current) {
        setFollowing(!next);
        setFollowerCount((c) => Math.max(0, c + (next ? -1 : 1)));
        showToast('フォローできませんでした', '時間をおいてもう一度お試しください');
      }
    } finally { if (isMounted.current) setBusy(false); }
  }, [posterId, following, busy]);

  const openPost = (p: ProfilePost) => {
    onClose();
    // シートを閉じてから遷移（閉じアニメと競合しないよう1フレーム遅らせる）
    setTimeout(() => router.push({ pathname: '/community-spot', params: { id: p.id } }), 80);
  };

  const name = profile?.name?.trim() || fallbackName?.trim() || 'MoodGoユーザー';
  const handle = profile?.handle ?? fallbackHandle ?? null;
  const icon = profile?.icon ?? fallbackIcon ?? null;
  const posts = profile?.posts ?? [];
  const GAP = 8;
  const cell = (W - 20 * 2 - GAP * 2) / 3;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* 背景の暗幕（タップで閉じる）*/}
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="プロフィールを閉じる" />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
        {/* ハンドルバー＋閉じる */}
        <View style={s.grabber} />
        <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button" accessibilityLabel="閉じる">
          <X size={18} color={SUB} strokeWidth={2.4} />
        </TouchableOpacity>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
          {/* ── ヘッダー: アバター＋名前＋@ID ── */}
          <View style={s.head}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatarRing}>
              <View style={s.avatarWhite}>
                {icon ? (
                  <Image source={{ uri: icon }} style={s.avatar} contentFit="cover" />
                ) : (
                  <View style={[s.avatar, s.avatarPh]}><UserRound size={30} color={BLUE} strokeWidth={1.6} /></View>
                )}
              </View>
            </LinearGradient>
            <Text style={s.name} numberOfLines={1}>{name}</Text>
            {handle ? <Text style={s.handle} numberOfLines={1}>@{handle}</Text> : null}
          </View>

          {/* ── 統計: 投稿 / フォロワー / フォロー中 ── */}
          <View style={s.statsRow}>
            <View style={s.statCol}>
              <Text style={s.statNum}>{profile?.postCount ?? posts.length}</Text>
              <Text style={s.statLabel}>投稿</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statCol}>
              <Text style={s.statNum}>{followerCount}</Text>
              <Text style={s.statLabel}>フォロワー</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statCol}>
              <Text style={s.statNum}>{profile?.followingCount ?? 0}</Text>
              <Text style={s.statLabel}>フォロー中</Text>
            </View>
          </View>

          {/* ── フォローボタン ── */}
          <TouchableOpacity onPress={toggleFollow} activeOpacity={0.85} disabled={busy}
            accessibilityRole="button" accessibilityLabel={following ? 'フォローを解除' : 'フォローする'}>
            {following ? (
              <View style={s.followingBtn}><Text style={s.followingText}>フォロー中</Text></View>
            ) : (
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.followBtn}>
                <Text style={s.followText}>フォローする</Text>
              </LinearGradient>
            )}
          </TouchableOpacity>

          {/* ── 投稿グリッド ── */}
          {loading ? (
            <View style={s.loadingWrap}><ActivityIndicator color={PURPLE} size="small" /></View>
          ) : posts.length > 0 ? (
            <>
              <Text style={s.gridTitle}>投稿</Text>
              <View style={[s.grid, { gap: GAP }]}>
                {posts.map((p) => (
                  <TouchableOpacity key={p.id} onPress={() => openPost(p)} activeOpacity={0.85}
                    style={[s.tile, { width: cell, height: cell }]}
                    accessibilityRole="button" accessibilityLabel={`${p.spot_name}の投稿を開く`}>
                    {p.image ? (
                      <Image source={{ uri: p.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
                    ) : (
                      <LinearGradient colors={['#EDE9FF', '#E3ECFF']} style={[StyleSheet.absoluteFill, s.tilePh]}>
                        <MapPin size={Math.round(cell * 0.22)} color={BLUE} strokeWidth={1.6} />
                      </LinearGradient>
                    )}
                    <LinearGradient colors={['transparent', 'rgba(30,21,72,0.55)']} style={s.tileScrim} pointerEvents="none" />
                    <Text style={s.tileName} numberOfLines={1}>{p.spot_name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : (
            <View style={s.loadingWrap}><Text style={s.emptyText}>公開投稿はまだありません</Text></View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(16,10,32,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%',
    backgroundColor: '#FDFCFF', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 10,
    shadowColor: '#1A0A2E', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 12,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4.5, borderRadius: 3, backgroundColor: '#E4E0EE', marginBottom: 6 },
  closeBtn: {
    position: 'absolute', top: 14, right: 16, width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F0FA', alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },

  head: { alignItems: 'center', marginTop: 6 },
  avatarRing: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  avatarWhite: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 70, height: 70, borderRadius: 35 },
  avatarPh: { backgroundColor: '#F0EDFF', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 19, fontWeight: '800', color: INK, marginTop: 10, letterSpacing: -0.3, maxWidth: '86%' },
  handle: { fontSize: 12.5, fontWeight: '600', color: SUB, marginTop: 2 },

  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, marginBottom: 16 },
  statCol: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 19, fontWeight: '800', color: INK, letterSpacing: -0.4 },
  statLabel: { fontSize: 11, fontWeight: '600', color: SUB, marginTop: 1 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: 'rgba(90,90,120,0.18)' },

  followBtn: {
    height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 4,
  },
  followText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  followingBtn: {
    height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(155,107,255,0.4)',
  },
  followingText: { color: PURPLE, fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },

  gridTitle: { fontSize: 14, fontWeight: '800', color: INK, marginTop: 20, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: 8 },
  tile: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#EFEDF8' },
  tilePh: { alignItems: 'center', justifyContent: 'center' },
  tileScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '46%' },
  tileName: {
    position: 'absolute', left: 7, right: 7, bottom: 6, color: '#fff', fontSize: 10, fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 34 },
  emptyText: { fontSize: 12.5, color: SUB, fontWeight: '600' },
});
