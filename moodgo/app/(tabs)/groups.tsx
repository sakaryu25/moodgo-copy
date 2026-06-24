// つぶやき（グループチャット）タブ
import { StyleSheet, View } from 'react-native';
import AppBackground from '@/components/AppBackground';
import GroupsView from '@/components/GroupsView';
import { useFavorites } from '@/lib/useFavorites';

export default function GroupsTab() {
  const { favorites } = useFavorites();
  return (
    <View style={styles.root}>
      <AppBackground />
      <GroupsView favorites={favorites} />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#F3F1EF' } });
