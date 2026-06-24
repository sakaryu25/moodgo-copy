// みんな（みんなのMoodログ / ブログ投稿）タブ
import { StyleSheet, View } from 'react-native';
import AppBackground from '@/components/AppBackground';
import BlogView from '@/components/BlogView';

export default function BlogTab() {
  return (
    <View style={styles.root}>
      <AppBackground />
      <BlogView />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#F3F1EF' } });
