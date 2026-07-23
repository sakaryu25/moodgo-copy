// ── app/blog-post.tsx ─────────────────────────────────────────────────────────
// ブログ投稿の専用詳細（統一フィードからブログ(kind=blog)をタップした時に開く）。
// BlogView の DetailView（穴場詳細と同じデザイン言語）を再利用。
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { DetailView, type Detail } from '@/components/BlogView';
import { useSettings } from '@/lib/settingsStore';

const PURPLE = '#9B6BFF';

const T = {
  ja: { notFound: '投稿が見つかりませんでした', loadFailed: '読み込めませんでした', retry: '再試行', back: '戻る' },
  en: { notFound: 'Post not found', loadFailed: "Couldn't load", retry: 'Retry', back: 'Back' },
} as const;

export default function BlogPostScreen() {
  const insets = useSafeAreaInsets();
  const { lang } = useSettings();
  const t = T[lang];
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [post, setPost] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  // 通信失敗（notFound=削除済みと区別して再試行を出す）
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    (async () => {
      setLoadFailed(false);
      try {
        const did = await getDeviceId();
        const res = await apiFetch(`/api/blog-posts?id=${id}&deviceId=${encodeURIComponent(did)}`);
        const d = await res.json();
        if (d?.ok && d.post) setPost(d.post);
      } catch { setLoadFailed(true); } finally { setLoading(false); }
    })();
  }, [id, retryNonce]);

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }}><ActivityIndicator color={PURPLE} size="large" /></View>;
  }
  if (!post) {
    // 通信失敗と「投稿が存在しない(削除済み等)」は別物として表示
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }}>
        <Text style={{ color: '#888' }}>{loadFailed ? t.loadFailed : t.notFound}</Text>
        {loadFailed && (
          <TouchableOpacity onPress={() => { setLoading(true); setRetryNonce((n) => n + 1); }} style={{ marginTop: 16 }}
            accessibilityRole="button" accessibilityLabel={t.retry}>
            <Text style={{ color: PURPLE, fontWeight: '800' }}>{t.retry}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={{ color: PURPLE, fontWeight: '800' }}>{t.back}</Text></TouchableOpacity>
      </View>
    );
  }
  return <DetailView post={post} onBack={() => router.back()} onSearchMood={() => router.back()} />;
}
