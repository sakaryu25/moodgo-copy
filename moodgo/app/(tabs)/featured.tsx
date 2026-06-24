// 特集タブ
import { StyleSheet, View } from 'react-native';
import AppBackground from '@/components/AppBackground';
import FeatureScreen from '@/components/FeatureScreen';

export default function FeaturedTab() {
  return (
    <View style={styles.root}>
      <AppBackground />
      <FeatureScreen />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#F3F1EF' } });
