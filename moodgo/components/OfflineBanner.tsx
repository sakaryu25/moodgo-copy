// オフライン時に画面最上部へ薄いバナーを出す。_layout で一度だけマウントし全画面に重ねる。
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkStatus } from '@/lib/useNetworkStatus';

export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { isOnline } = useNetworkStatus();
  if (isOnline) return null;
  return (
    <View pointerEvents="none" style={[s.wrap, { paddingTop: insets.top + 6 }]}>
      <View style={s.pill}>
        <WifiOff size={14} color="#fff" strokeWidth={2.5} />
        <Text style={s.text}>インターネットに接続されていません</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 9999, paddingBottom: 6 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#374151', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
  },
  text: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
});
