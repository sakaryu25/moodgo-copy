// ─── 初回起動の利用規約・プライバシー同意ゲート（App Store 1.2 / EULA要件）──────
// 投稿型UGC（穴場・グループトーク・写真）を持つため、初回に利用規約への明示同意を取る。
// 同意フラグは端末ローカルに保存し、以後は表示しない。
//
// ⚠ New Architecture(Fabric)では <Modal transparent> の中身が描画されず、
//   “見えないのに最前面でタッチだけ奪う”不具合が起きる（画面は見えるが何も押せない／
//   ネイティブのタブバーだけ効く、という症状になる）。これを避けるため Modal をやめ、
//   ツリー内の絶対配置オーバーレイで表示する。show=false 時は null を返すため、
//   同意後はタッチを一切ブロックしない。
import { useEffect, useState } from 'react';
import { Text, View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { loadJSON, saveJSON, CONSENT_KEY } from '@/lib/storage';

export default function ConsentGate() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    loadJSON<boolean>(CONSENT_KEY, false)
      .then(agreed => { setShow(!agreed); setChecked(true); })
      .catch(() => { setShow(true); setChecked(true); });
  }, []);

  // まだ判定前、または同意済み → 何も描画しない（＝タッチをブロックしない）
  if (!checked || !show) return null;

  const agree = () => { saveJSON(CONSENT_KEY, true); setShow(false); };

  return (
    <View style={s.overlay}>
      <View style={s.card}>
        <Text style={s.title}>はじめる前に</Text>
        <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
          <Text style={s.body}>
            MoodGo をご利用いただくには、利用規約とプライバシーポリシーへの同意が必要です。{'\n\n'}
            本アプリには利用者が投稿するスポット情報・写真・グループ内メッセージが含まれます。
            不適切な投稿は通報・ブロックでき、運営は規約に違反する投稿を削除する場合があります。{'\n\n'}
            提案されるスポット情報は第三者提供データを含み、正確性・営業状況を保証するものではありません。
          </Text>
        </ScrollView>
        <View style={s.links}>
          <Pressable onPress={() => router.push('/terms')}><Text style={s.link}>利用規約</Text></Pressable>
          <Text style={s.dot}>・</Text>
          <Pressable onPress={() => router.push('/privacy')}><Text style={s.link}>プライバシーポリシー</Text></Pressable>
        </View>
        <Pressable onPress={agree} style={s.agreeBtn}>
          <Text style={s.agreeText}>同意して始める</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // ツリー内の絶対配置オーバーレイ（最前面）。Modal を使わないので Fabric でも確実に描画される。
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 22, padding: 22 },
  title: { fontSize: 19, fontWeight: '800', color: '#1F2937', marginBottom: 12 },
  body: { fontSize: 13.5, lineHeight: 21, color: '#4B5563' },
  links: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, marginBottom: 16 },
  link: { fontSize: 13, fontWeight: '700', color: '#7C3AED', textDecorationLine: 'underline' },
  dot: { color: '#9CA3AF', marginHorizontal: 6 },
  agreeBtn: { backgroundColor: '#7C3AED', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  agreeText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
