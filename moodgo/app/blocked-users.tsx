// ── app/blocked-users.tsx ─────────────────────────────────────────────────────
// ブロック / ミュートしたユーザーの管理画面（一覧＋解除）。App Store 1.2 のUGC要件で
// 「ブロックしたユーザーを見直せる」ことが求められるため用意。
//   公開ハッシュ(poster_id)しか持たないので、名前/アイコンは /api/user-profile で解決する。
import { router, Stack } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronLeft, UserRound } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '@/components/AppBackground';
import PuniPressable from '@/components/PuniPressable';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { useBlocks, unblockUser } from '@/lib/blockStore';

type Row = { hash: string; kind: 'block' | 'mute'; name: string | null; handle: string | null; icon: string | null };

export default function BlockedUsersScreen() {
  const insets = useSafeAreaInsets();
  const { blocked, muted } = useBlocks();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const resolvedOnce = useRef(false);

  // マウント時に一度だけ解決（解除は楽観的に行の削除で反映＝再フェッチのちらつきを避ける）
  useEffect(() => {
    if (resolvedOnce.current) return;
    resolvedOnce.current = true;
    let active = true;
    (async () => {
      const all: Array<{ hash: string; kind: 'block' | 'mute' }> = [
        ...blocked.map((h) => ({ hash: h, kind: 'block' as const })),
        ...muted.map((h) => ({ hash: h, kind: 'mute' as const })),
      ];
      if (all.length === 0) { if (active) { setRows([]); setLoading(false); } return; }
      let viewerDeviceId = '';
      try { viewerDeviceId = await getDeviceId(); } catch { /* 未取得でも公開情報は引ける */ }
      const resolved = await Promise.all(all.slice(0, 100).map(async ({ hash, kind }) => {
        try {
          const d = await apiFetch('/api/user-profile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetId: hash, viewerDeviceId }),
          }).then((r) => r.json());
          const p = d?.profile ?? {};
          return { hash, kind, name: p.name ?? null, handle: p.handle ?? null, icon: p.icon ?? null };
        } catch { return { hash, kind, name: null, handle: null, icon: null }; }
      }));
      if (active) { setRows(resolved); setLoading(false); }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUnblock = (hash: string) => {
    unblockUser(hash);
    setRows((prev) => prev.filter((r) => r.hash !== hash));
  };

  return (
    <View style={s.root}>
      <AppBackground />
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn} accessibilityLabel="戻る">
          <ChevronLeft size={24} color="#1A0A2E" strokeWidth={2.4} />
        </Pressable>
        <Text style={s.title}>ブロック・ミュート</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#9B6BFF" /></View>
      ) : rows.length === 0 ? (
        <View style={s.center}>
          <UserRound size={34} color="#C9BCE6" strokeWidth={1.8} />
          <Text style={s.empty}>ブロック・ミュートした{'\n'}ユーザーはいません</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 30 }}>
          <Text style={s.caption}>ブロックした人の投稿・コメントは表示されません。ミュートは相手に気づかれず非表示にします。</Text>
          {rows.map((r) => (
            <View key={r.hash} style={s.row}>
              {r.icon ? (
                <Image source={{ uri: r.icon }} style={s.avatar} contentFit="cover" />
              ) : (
                <View style={[s.avatar, s.avatarPh]}><UserRound size={18} color="#B7A9D6" strokeWidth={2} /></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{r.name || (r.handle ? `@${r.handle}` : 'ユーザー')}</Text>
                <Text style={s.sub} numberOfLines={1}>
                  {r.kind === 'block' ? 'ブロック中' : 'ミュート中'}{r.handle && r.name ? ` ・ @${r.handle}` : ''}
                </Text>
              </View>
              <PuniPressable onPress={() => onUnblock(r.hash)} style={s.unblockBtn} haptic>
                <Text style={s.unblockText}>解除</Text>
              </PuniPressable>
            </View>
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
  empty: { fontSize: 14, color: '#8B88A6', fontWeight: '600', textAlign: 'center', lineHeight: 21 },
  caption: { fontSize: 12, color: '#8B88A6', lineHeight: 18, marginBottom: 12, marginTop: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff',
    borderRadius: 16, padding: 12, marginBottom: 10,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EFE9FB' },
  avatarPh: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 14.5, fontWeight: '800', color: '#1A0A2E' },
  sub: { fontSize: 11.5, fontWeight: '600', color: '#9B94B4', marginTop: 2 },
  unblockBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: '#F1ECFB' },
  unblockText: { fontSize: 13, fontWeight: '800', color: '#7C3AED' },
});
