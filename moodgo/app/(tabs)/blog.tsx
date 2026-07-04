// みんな（みんなのMoodログ / ブログ投稿）タブ
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AppBackground from '@/components/AppBackground';
import BlogView from '@/components/BlogView';
import { useTabReset } from '@/lib/useTabReset';

export default function BlogTab() {
  // #14: みんなタブを再タップ → 投稿詳細を閉じて一覧へ（振り出しに戻す）
  const [resetKey, setResetKey] = useState(0);
  useTabReset(() => setResetKey(k => k + 1));
  return (
    <View style={styles.root}>
      <AppBackground />
      <BlogView resetKey={resetKey} />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#F3F1EF' } });
