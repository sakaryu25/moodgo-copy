// ── app/follow-list.tsx ───────────────────────────────────────────────────────
// フォロワー / フォロー中 の一覧。params: { id=公開ハッシュ, kind=followers|following }。
// アイコンはハッシュから直接(user-icons/{hash}.jpg)、@IDは user-follows list が解決して返す。
// タップで相手のプロフィール(/user/[id])へ。
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronLeft, ChevronRight, UserRound } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '@/components/AppBackground';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { useSettings } from '@/lib/settingsStore';

const T = {
  ja: {
    back: '戻る',
    title: 'つながり',
    tabFollowers: 'フォロワー',
    tabFollowing: 'フォロー中',
    suggestTitle: 'おすすめのユーザー',
    defaultName: 'MoodGoユーザー',
    following: 'フォロー中',
    follow: 'フォロー',
    emptyFollowers: 'フォロワーはいません',
    emptyFollowing: 'まだ誰もフォローしていません',
  },
  en: {
    back: 'Back',
    title: 'Connections',
    tabFollowers: 'Followers',
    tabFollowing: 'Following',
    suggestTitle: 'Suggested users',
    defaultName: 'MoodGo user',
    following: 'Following',
    follow: 'Follow',
    emptyFollowers: 'No followers yet',
    emptyFollowing: 'Not following anyone yet',
  },
} as const;

type Row = { id: string; handle: string | null; icon: string | null };

export default function FollowListScreen() {
  const insets = useSafeAreaInsets();
  const { lang } = useSettings();
  const t = T[lang];
  const { id, kind } = useLocalSearchParams<{ id?: string; kind?: string }>();
  const targetId = String(id ?? '');
  const [mode, setMode] = useState<'followers' | 'following'>(kind === 'following' ? 'following' : 'followers');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggests, setSuggests] = useState<Row[]>([]);
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);   // 切替時もスピナー
    (async () => {
      try {
        const d = await apiFetch('/api/user-follows', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', targetId, kind: mode }),
        }).then((r) => r.json());
        if (active) setRows(Array.isArray(d?.items) ? (d.items as Row[]) : []);
      } catch { /* 空表示 */ } finally { if (active) setLoading(false); }
    })();
    // フォロー中ビューではおすすめユーザーも取得
    if (mode === 'following') {
      (async () => {
        try {
          const deviceId = await getDeviceId();
          const d = await apiFetch('/api/user-suggest', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId }),
          }).then((r) => r.json());
          if (active) setSuggests(Array.isArray(d?.items) ? (d.items as Row[]) : []);
        } catch { /* noop */ }
      })();
    }
    return () => { active = false; };
  }, [targetId, mode]);

  const doFollow = async (hash: string) => {
    setFollowed((prev) => new Set(prev).add(hash));   // 楽観的
    try {
      const deviceId = await getDeviceId();
      const d = await apiFetch('/api/user-follows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'follow', deviceId, targetId: hash }),
      }).then((r) => r.json());
      if (!d?.ok) throw new Error('follow失敗');
    } catch {
      setFollowed((prev) => { const n = new Set(prev); n.delete(hash); return n; });   // 失敗はロールバック
    }
  };

  return (
    <View style={s.root}>
      <AppBackground />
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn} accessibilityLabel={t.back}>
          <ChevronLeft size={24} color="#1A0A2E" strokeWidth={2.4} />
        </Pressable>
        <Text style={s.title}>{t.title}</Text>
        <View style={{ width: 34 }} />
      </View>

      <View style={s.segRow}>
        <Pressable style={[s.seg, mode === 'followers' && s.segOn]} onPress={() => setMode('followers')}>
          <Text style={[s.segText, mode === 'followers' && s.segTextOn]}>{t.tabFollowers}</Text>
        </Pressable>
        <Pressable style={[s.seg, mode === 'following' && s.segOn]} onPress={() => setMode('following')}>
          <Text style={[s.segText, mode === 'following' && s.segTextOn]}>{t.tabFollowing}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#9B6BFF" /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 30, paddingTop: 4 }}>
          {mode === 'following' && suggests.length > 0 && (
            <View style={{ marginBottom: 18 }}>
              <Text style={s.sectionTitle}>{t.suggestTitle}</Text>
              {suggests.map((u) => (
                <View key={u.id} style={s.row}>
                  {u.icon ? (
                    <Image source={{ uri: u.icon }} style={s.avatar} contentFit="cover" />
                  ) : (
                    <View style={[s.avatar, s.avatarPh]}><UserRound size={20} color="#B7A9D6" strokeWidth={2} /></View>
                  )}
                  <Pressable style={{ flex: 1 }} onPress={() => router.push({ pathname: '/user/[id]', params: { id: u.id } })}>
                    <Text style={s.name} numberOfLines={1}>{u.handle ? `@${u.handle}` : t.defaultName}</Text>
                  </Pressable>
                  {followed.has(u.id) ? (
                    <Text style={s.followedTag}>{t.following}</Text>
                  ) : (
                    <Pressable style={s.followBtn} onPress={() => doFollow(u.id)}><Text style={s.followBtnText}>{t.follow}</Text></Pressable>
                  )}
                </View>
              ))}
            </View>
          )}
          {rows.length === 0 ? (
            <View style={s.centerPad}>
              <UserRound size={34} color="#C9BCE6" strokeWidth={1.8} />
              <Text style={s.empty}>{mode === 'followers' ? t.emptyFollowers : t.emptyFollowing}</Text>
            </View>
          ) : (
            rows.map((r) => (
              <Pressable key={r.id} style={s.row} onPress={() => router.push({ pathname: '/user/[id]', params: { id: r.id } })}>
                {r.icon ? (
                  <Image source={{ uri: r.icon }} style={s.avatar} contentFit="cover" />
                ) : (
                  <View style={[s.avatar, s.avatarPh]}><UserRound size={20} color="#B7A9D6" strokeWidth={2} /></View>
                )}
                <Text style={s.name} numberOfLines={1}>{r.handle ? `@${r.handle}` : t.defaultName}</Text>
                <ChevronRight size={18} color="#C9BCE6" strokeWidth={2.4} />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F1F7' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 10 },
  backBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: '#1A0A2E' },
  segRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  seg: { flex: 1, paddingVertical: 9, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center' },
  segOn: { backgroundColor: '#7C3AED' },
  segText: { fontSize: 13.5, fontWeight: '800', color: '#8B88A6' },
  segTextOn: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 30 },
  empty: { fontSize: 14, color: '#8B88A6', fontWeight: '600', textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderRadius: 16, padding: 12, marginBottom: 10,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#EFE9FB' },
  avatarPh: { alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, fontSize: 14.5, fontWeight: '800', color: '#1A0A2E' },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#8B88A6', marginBottom: 8, marginLeft: 2 },
  centerPad: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 50 },
  followBtn: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 999, backgroundColor: '#7C3AED' },
  followBtnText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  followedTag: { fontSize: 12.5, fontWeight: '700', color: '#9B94B4', paddingHorizontal: 8 },
});
