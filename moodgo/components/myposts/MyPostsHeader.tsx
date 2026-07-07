// ナビゲーション: 左=戻る / 中央=自分の投稿 / 右=＋(新規投稿)。
// 背景は透明、スクロールすると薄いブラー＋ヘアラインが乗る（iOS標準の挙動）。
import { BlurView } from 'expo-blur';
import { ChevronLeft, Plus } from 'lucide-react-native';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MP } from './types';

export default function MyPostsHeader({
  topInset, scrolled, onBack, onNew,
}: { topInset: number; scrolled: boolean; onBack: () => void; onNew: () => void }) {
  return (
    <View style={[s.wrap, { paddingTop: topInset }]}>
      {scrolled && (
        <>
          <BlurView
            intensity={26} tint="light" style={StyleSheet.absoluteFill}
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : 'none'}
          />
          <View style={[StyleSheet.absoluteFill, s.blurTint]} />
          <View style={s.hairline} />
        </>
      )}
      <View style={s.bar}>
        <TouchableOpacity onPress={onBack} style={s.circleBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button" accessibilityLabel="戻る">
          <ChevronLeft size={22} color={MP.INK} strokeWidth={2.4} />
        </TouchableOpacity>
        <Text style={s.title}>自分の投稿</Text>
        <TouchableOpacity onPress={onNew} style={s.circleBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button" accessibilityLabel="新しく投稿する">
          <Plus size={20} color={MP.INK} strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, overflow: 'hidden' },
  blurTint: { backgroundColor: 'rgba(243,241,239,0.72)' },   // APP_BG(ホーム地色)に合わせる
  hairline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.12)' },
  bar: {
    height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  title: { fontSize: 16.5, fontWeight: '800', color: MP.INK, letterSpacing: -0.2 },
  circleBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#111', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 2,
  },
});
