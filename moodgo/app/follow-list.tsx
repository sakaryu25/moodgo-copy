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

type Row = { id: string; handle: string | null; icon: string | null };

export default function FollowListScreen() {
  const insets = useSafeAreaInsets();
  const { id, kind } = useLocalSearchParams<{ id?: string; kind?: string }>();
  const targetId = String(id ?? '');
  const mode = kind === 'following' ? 'following' : 'followers';
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await apiFetch('/api/user-follows', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list', targetId, kind: mode }),
        }).then((r) => r.json());
        if (active) setRows(Array.isArray(d?.items) ? (d.items as Row[]) : []);
      } catch { /* 空表示 */ } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [targetId, mode]);

  return (
    <View style={s.root}>
      <AppBackground />
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn} accessibilityLabel="戻る">
          <ChevronLeft size={24} color="#1A0A2E" strokeWidth={2.4} />
        </Pressable>
        <Text style={s.title}>{mode === 'followers' ? 'フォロワー' : 'フォロー中'}</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#9B6BFF" /></View>
      ) : rows.length === 0 ? (
        <View style={s.center}>
          <UserRound size={34} color="#C9BCE6" strokeWidth={1.8} />
          <Text style={s.empty}>{mode === 'followers' ? 'フォロワーはいません' : 'まだ誰もフォローしていません'}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 30, paddingTop: 4 }}>
          {rows.map((r) => (
            <Pressable key={r.id} style={s.row} onPress={() => router.push({ pathname: '/user/[id]', params: { id: r.id } })}>
              {r.icon ? (
                <Image source={{ uri: r.icon }} style={s.avatar} contentFit="cover" />
              ) : (
                <View style={[s.avatar, s.avatarPh]}><UserRound size={20} color="#B7A9D6" strokeWidth={2} /></View>
              )}
              <Text style={s.name} numberOfLines={1}>{r.handle ? `@${r.handle}` : 'MoodGoユーザー'}</Text>
              <ChevronRight size={18} color="#C9BCE6" strokeWidth={2.4} />
            </Pressable>
          ))}
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
});
