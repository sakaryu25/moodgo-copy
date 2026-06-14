// ─── 初回起動の利用規約・プライバシー同意ゲート（App Store 1.2 / EULA要件）──────
// 投稿型UGC（穴場・グループトーク・写真）を持つため、初回に利用規約への明示同意を取る。
// 同意フラグは端末ローカルに保存し、以後は表示しない。
import { useEffect, useState } from 'react';
import { Modal, Text, View, StyleSheet, Pressable, ScrollView } from 'react-native';
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

  if (!checked) return null;

  const agree = () => { saveJSON(CONSENT_KEY, true); setShow(false); };

  return (
    <Modal visible={show} transparent animationType="fade" onRequestClose={() => {}}>
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
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 22, padding: 22 },
  title: { fontSize: 19, fontWeight: '800', color: '#1F2937', marginBottom: 12 },
  body: { fontSize: 13.5, lineHeight: 21, color: '#4B5563' },
  links: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14, marginBottom: 16 },
  link: { fontSize: 13, fontWeight: '700', color: '#7C3AED', textDecorationLine: 'underline' },
  dot: { color: '#9CA3AF', marginHorizontal: 6 },
  agreeBtn: { backgroundColor: '#7C3AED', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  agreeText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
