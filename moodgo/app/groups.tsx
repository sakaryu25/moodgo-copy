// つぶやき（グループチャット）画面
// NativeTabsからは外し、ホーム右上の「つぶやき」ボタンから router.push('/groups') で開く独立ルート。
// route path は /groups のまま。タブではなくStack上に載るのでタブバーを覆い、左上の戻るでホームへ返る。
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import AppBackground from '@/components/AppBackground';
import GroupsView from '@/components/GroupsView';
import { useFavorites } from '@/lib/useFavorites';

export default function GroupsScreen() {
  const { favorites } = useFavorites();
  return (
    <View style={styles.root}>
      <AppBackground />
      <GroupsView favorites={favorites} onBack={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#F3F1EF' } });
