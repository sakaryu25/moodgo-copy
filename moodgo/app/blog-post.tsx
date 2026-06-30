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

const PURPLE = '#9B6BFF';

export default function BlogPostScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [post, setPost] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const did = await getDeviceId();
        const res = await apiFetch(`/api/blog-posts?id=${id}&deviceId=${encodeURIComponent(did)}`);
        const d = await res.json();
        if (d?.ok && d.post) setPost(d.post);
      } catch { /* noop */ } finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }}><ActivityIndicator color={PURPLE} size="large" /></View>;
  }
  if (!post) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }}>
        <Text style={{ color: '#888' }}>投稿が見つかりませんでした</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={{ color: PURPLE, fontWeight: '800' }}>戻る</Text></TouchableOpacity>
      </View>
    );
  }
  return <DetailView post={post} onBack={() => router.back()} onSearchMood={() => router.back()} />;
}
