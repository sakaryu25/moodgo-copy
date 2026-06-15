// ── app/mood-log.tsx ──────────────────────────────────────────────────────────
// Moodログ投稿画面（気分ベースの口コミ＝Google口コミの代用＋スポット写真の補完）。
// スポット詳細から遷移（params: placeId, placeName, address）。
// 写真1〜3＋気分タグ＋ひとこと＋誰と＋時間帯＋また行きたい/写真どおり＋公開範囲＋
// 権利確認チェック＋スポット写真使用OKチェック → POST /api/spot-posts。
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Camera, Check, Send, X } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Alert, Image, KeyboardAvoidingView, Linking, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { findNgWord } from '@/lib/ngwords';
import { showToast } from '@/lib/toast';

const MOODS = ['#まったりしたい', '#自然感じたい', '#わいわい楽しみたい', '#お腹すいた', '#ドライブしたい', '#集中したい', '#体動かしたい', '#遠くに行きたい', '#ショッピング', '#スリル味わいたい'];
const COMPANIONS = ['ひとり', '友達', '恋人', '家族', 'グループ'];
const TIMES = ['朝', '昼', '夕方', '夜'];
const VIS: { key: string; label: string; sub: string }[] = [
  { key: 'spot_public_anonymous', label: 'スポットに匿名公開', sub: '名前を出さずこの場所に公開（おすすめ）' },
  { key: 'public', label: '全体公開', sub: '名前つきで全体に公開' },
  { key: 'group', label: 'グループだけ', sub: '参加グループにのみ共有' },
  { key: 'private', label: '自分だけ', sub: '記録用（スポット写真には使われません）' },
];

export default function MoodLogScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ placeId?: string; placeName?: string; address?: string }>();
  const placeName = (params.placeName ?? '').toString();
  const placeId = (params.placeId ?? '').toString();
  const address = (params.address ?? '').toString();

  const [images, setImages] = useState<{ uri: string; base64?: string }[]>([]);
  const [moodTags, setMoodTags] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [companion, setCompanion] = useState<string | null>(null);
  const [timeOfDay, setTimeOfDay] = useState<string | null>(null);
  const [wantRevisit, setWantRevisit] = useState(false);
  const [matchesPhoto, setMatchesPhoto] = useState(false);
  const [visibility, setVisibility] = useState('spot_public_anonymous');
  const [licenseOk, setLicenseOk] = useState(false);
  const [reuseOk, setReuseOk] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const pickImages = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('写真へのアクセスが必要です', '設定 → MoodGo → 写真 で許可してください。', [
          { text: 'キャンセル', style: 'cancel' }, { text: '設定を開く', onPress: () => Linking.openSettings() },
        ]); return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3, quality: 0.6, base64: true, exif: false });
      if (!r.canceled && r.assets.length > 0) {
        const add = r.assets.slice(0, 3 - images.length).map(a => ({ uri: a.uri, base64: a.base64 ?? undefined }));
        setImages(prev => [...prev, ...add].slice(0, 3));
      }
    } catch { Alert.alert('エラー', '写真の選択に失敗しました。'); }
  };

  const toggle = <T,>(arr: T[], v: T, set: (x: T[]) => void) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const submit = async () => {
    if (!licenseOk) { showToast('権利確認が必要です', '「自分で撮影／使用許可あり」にチェックしてください'); return; }
    if (moodTags.length === 0) { showToast('気分タグを選んでください', 'この場所が合う気分を1つ以上タップ'); return; }
    const ng = findNgWord(caption);
    if (ng) { showToast('不適切な表現があります', '記入内容を見直してください'); return; }
    setSubmitting(true);
    try {
      const deviceId = await getDeviceId();
      const posterName = (await AsyncStorage.getItem('moodgo-group-nickname'))?.trim() || undefined;
      const imgs = images.map(i => i.base64 ? `data:image/jpeg;base64,${i.base64}` : '').filter(Boolean);
      const res = await apiFetch('/api/spot-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', deviceId, posterName, placeId: placeId || undefined, placeName, address,
          caption, moodTags, companion, visibility, timeOfDay, wantRevisit, matchesPhoto,
          canUseAsSpotPhoto: reuseOk, licenseDeclared: licenseOk, images: imgs,
        }),
        timeoutMs: 30000,
      });
      const d = await res.json();
      if (!d?.ok) { showToast('投稿できませんでした', d?.error ?? 'しばらくしてからお試しください'); setSubmitting(false); return; }
      // MoodGoらしいトースト表示＋すぐ詳細へ戻る（トーストはルートマウントなので画面遷移後も表示される）
      showToast(d.status === 'pending' ? '送信しました📸' : 'Moodログを公開しました✨', d.status === 'pending' ? '確認後に公開されます。ありがとう！' : 'みんなの穴場にも載りました。ありがとう！');
      router.back();
    } catch { showToast('投稿に失敗しました', '通信環境を確認して再度お試しください'); setSubmitting(false); }
  };

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.head}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><ArrowLeft size={22} color="#3A1D6E" /></TouchableOpacity>
        <Text style={s.headTitle} numberOfLines={1}>Moodログを投稿</Text>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          <Text style={s.place}>{placeName}</Text>

          <Text style={s.label}>写真（最大3枚）</Text>
          <View style={s.photoGrid}>
            {images.map((im, i) => (
              <View key={i} style={s.thumbWrap}>
                <Image source={{ uri: im.uri }} style={s.thumb} />
                <TouchableOpacity style={s.thumbX} onPress={() => setImages(prev => prev.filter((_, j) => j !== i))}><X size={13} color="#fff" /></TouchableOpacity>
              </View>
            ))}
            {images.length < 3 && (
              <TouchableOpacity style={s.addPhoto} onPress={pickImages} activeOpacity={0.8}>
                <Camera size={22} color="#A78BCA" /><Text style={s.addPhotoText}>追加</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={s.label}>この場所が合う気分（1つ以上）</Text>
          <View style={s.chips}>
            {MOODS.map(t => (
              <TouchableOpacity key={t} onPress={() => toggle(moodTags, t, setMoodTags)} style={[s.chip, moodTags.includes(t) && s.chipOn]} activeOpacity={0.8}>
                <Text style={[s.chipText, moodTags.includes(t) && s.chipTextOn]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>ひとこと</Text>
          <TextInput style={s.input} value={caption} onChangeText={setCaption} placeholder="例: 夕方に行ったら静かで散歩にちょうどよかった" placeholderTextColor="#B9ABD2" multiline maxLength={300} />

          <Text style={s.label}>誰と行った？</Text>
          <View style={s.chips}>
            {COMPANIONS.map(c => (
              <TouchableOpacity key={c} onPress={() => setCompanion(companion === c ? null : c)} style={[s.chip, companion === c && s.chipOn]} activeOpacity={0.8}>
                <Text style={[s.chipText, companion === c && s.chipTextOn]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>良かった時間帯</Text>
          <View style={s.chips}>
            {TIMES.map(t => (
              <TouchableOpacity key={t} onPress={() => setTimeOfDay(timeOfDay === t ? null : t)} style={[s.chip, timeOfDay === t && s.chipOn]} activeOpacity={0.8}>
                <Text style={[s.chipText, timeOfDay === t && s.chipTextOn]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.toggleRow}>
            <TouchableOpacity style={[s.toggle, wantRevisit && s.toggleOn]} onPress={() => setWantRevisit(v => !v)} activeOpacity={0.8}><Text style={[s.toggleText, wantRevisit && s.toggleTextOn]}>また行きたい</Text></TouchableOpacity>
            <TouchableOpacity style={[s.toggle, matchesPhoto && s.toggleOn]} onPress={() => setMatchesPhoto(v => !v)} activeOpacity={0.8}><Text style={[s.toggleText, matchesPhoto && s.toggleTextOn]}>写真どおりだった</Text></TouchableOpacity>
          </View>

          <Text style={s.label}>公開範囲</Text>
          {VIS.map(v => (
            <TouchableOpacity key={v.key} style={[s.visRow, visibility === v.key && s.visRowOn]} onPress={() => setVisibility(v.key)} activeOpacity={0.8}>
              <View style={[s.radio, visibility === v.key && s.radioOn]}>{visibility === v.key && <View style={s.radioDot} />}</View>
              <View style={{ flex: 1 }}><Text style={s.visLabel}>{v.label}</Text><Text style={s.visSub}>{v.sub}</Text></View>
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={s.check} onPress={() => setLicenseOk(v => !v)} activeOpacity={0.8}>
            <View style={[s.box, licenseOk && s.boxOn]}>{licenseOk && <Check size={14} color="#fff" strokeWidth={3} />}</View>
            <Text style={s.checkText}>自分で撮影した、または使用許可のある写真・内容です（必須）</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.check} onPress={() => setReuseOk(v => !v)} activeOpacity={0.8}>
            <View style={[s.box, reuseOk && s.boxOn]}>{reuseOk && <Check size={14} color="#fff" strokeWidth={3} />}</View>
            <Text style={s.checkText}>この写真をこのスポットの写真として使ってOK</Text>
          </TouchableOpacity>
          <Text style={s.note}>※ Google画像・Googleマップ・SNS等から保存した画像の投稿は禁止です。</Text>

          <TouchableOpacity style={[s.submit, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting} activeOpacity={0.85}>
            <Send size={17} color="#fff" strokeWidth={2.4} />
            <Text style={s.submitText}>{submitting ? '投稿中…' : 'Moodログを投稿'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F0EAFA' },
  headTitle: { fontSize: 17, fontWeight: '800', color: '#3A1D6E' },
  place: { fontSize: 15, fontWeight: '800', color: '#7C3AED', marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '800', color: '#4A2D7E', marginTop: 16, marginBottom: 8 },
  photoGrid: { flexDirection: 'row', gap: 10 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 88, height: 88, borderRadius: 12, backgroundColor: '#EEE' },
  thumbX: { position: 'absolute', top: -6, right: -6, backgroundColor: '#1E0753', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: 88, height: 88, borderRadius: 12, borderWidth: 1.5, borderColor: '#E3D8F5', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 2 },
  addPhotoText: { fontSize: 11, color: '#A78BCA', fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 16, paddingVertical: 7, paddingHorizontal: 12 },
  chipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  chipText: { fontSize: 12.5, color: '#7E6CA0', fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 12, padding: 12, fontSize: 14, color: '#2A2235', minHeight: 80, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  toggle: { flex: 1, borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  toggleOn: { backgroundColor: '#FCE7F3', borderColor: '#DB2777' },
  toggleText: { fontSize: 13, color: '#7E6CA0', fontWeight: '800' },
  toggleTextOn: { color: '#DB2777' },
  visRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#EFE8FB', borderRadius: 12, padding: 12, marginBottom: 8 },
  visRowOn: { borderColor: '#7C3AED', backgroundColor: '#F8F4FF' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#C9B6FF', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: '#7C3AED' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#7C3AED' },
  visLabel: { fontSize: 13.5, fontWeight: '800', color: '#3A1D6E' },
  visSub: { fontSize: 11.5, color: '#9B89BE', marginTop: 2 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#C9B6FF', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  checkText: { flex: 1, fontSize: 12.5, color: '#4A4256', lineHeight: 18 },
  note: { fontSize: 11, color: '#B0A2C8', marginTop: 10, lineHeight: 16 },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#7C3AED', borderRadius: 16, paddingVertical: 15, marginTop: 22 },
  submitText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
});
