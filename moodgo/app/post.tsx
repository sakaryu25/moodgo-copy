// ── app/post.tsx ──────────────────────────────────────────────────────────────
// 統一投稿画面（Phase2）。穴場・moodログ・ブログを1つのフォームに集約。
//   - 既存スポット(placeId param あり)→ /api/spot-posts（moodログ＝場所への口コミ）
//   - 新スポット(placeId なし／名前入力)→ /api/suggestions（穴場＝運営が審査して掲載）
// どちらもユーザーから見れば「投稿する」1つだけ。裏のテーブルは触らず分岐するだけ＝安全。
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Camera, Check, MapPin, Send, Star, X } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Alert, Image, KeyboardAvoidingView, Linking, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import AppBackground, { APP_BG } from '@/components/AppBackground';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { findNgWord } from '@/lib/ngwords';
import { showToast } from '@/lib/toast';

const GRAD: [string, string, string] = ['#F56CB3', '#9B6BFF', '#4FA3FF'];
const MOODS = ['#まったりしたい', '#自然感じたい', '#わいわい楽しみたい', '#お腹すいた', '#ドライブしたい', '#集中したい', '#体動かしたい', '#遠くに行きたい', '#ショッピング', '#スリル味わいたい'];

export default function PostScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ placeId?: string; placeName?: string; address?: string }>();
  const existingPlaceId = (params.placeId ?? '').toString();
  const isExisting = !!existingPlaceId;

  const [spotName, setSpotName] = useState((params.placeName ?? '').toString());
  const [address, setAddress] = useState((params.address ?? '').toString());
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [images, setImages] = useState<{ uri: string; base64?: string }[]>([]);
  const [moodTags, setMoodTags] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [rating, setRating] = useState(0);
  const [licenseOk, setLicenseOk] = useState(false);
  const [locating, setLocating] = useState(false);
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

  const useLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLat(pos.coords.latitude); setLng(pos.coords.longitude);
        try {
          const res = await apiFetch(`/api/reverse-geocode?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
          const d = await res.json();
          if (d.ok && d.address) setAddress(d.address);
        } catch { /* 住所自動入力は失敗してもOK */ }
      }
    } catch { /* 位置取得失敗 */ } finally { setLocating(false); }
  };

  const toggleMood = (t: string) => setMoodTags(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]));

  const submit = async () => {
    if (!isExisting && !spotName.trim()) { showToast('場所の名前を入力してください', '新しいスポット名を入れてね'); return; }
    if (!licenseOk) { showToast('権利確認が必要です', '「自分で撮影／使用許可あり」にチェック'); return; }
    if (moodTags.length === 0) { showToast('気分タグを選んでください', '合う気分を1つ以上タップ'); return; }
    if (findNgWord(caption) || findNgWord(spotName)) { showToast('不適切な表現があります', '内容を見直してください'); return; }
    setSubmitting(true);
    try {
      const deviceId = await getDeviceId();
      const posterName = (await AsyncStorage.getItem('moodgo-group-nickname'))?.trim() || undefined;
      // おすすめ度を本文末に埋め込み（フィードが【おすすめ度】★Nを拾って★表示する）
      const descWithRating = [caption.trim(), rating > 0 ? `【おすすめ度】★${rating}` : ''].filter(Boolean).join('\n');

      if (isExisting) {
        // 既存スポット → moodログ(spot-posts・JSON)
        const imgs = images.map(i => (i.base64 ? `data:image/jpeg;base64,${i.base64}` : '')).filter(Boolean);
        const res = await apiFetch('/api/spot-posts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: 30000,
          body: JSON.stringify({
            action: 'create', deviceId, posterName, placeId: existingPlaceId, placeName: spotName, address,
            caption: descWithRating, moodTags, visibility: 'spot_public_anonymous',
            canUseAsSpotPhoto: true, licenseDeclared: true, images: imgs,
          }),
        });
        const d = await res.json();
        if (!d?.ok) { showToast('投稿できませんでした', d?.error ?? 'しばらくして再度お試しください'); setSubmitting(false); return; }
      } else {
        // 新スポット → 穴場(suggestions・multipart/form-data)
        const fd = new FormData();
        fd.append('spotName', spotName.trim());
        if (deviceId) fd.append('deviceId', deviceId);
        if (posterName) fd.append('posterName', posterName);
        if (descWithRating) fd.append('description', descWithRating);
        if (address) fd.append('address', address);
        if (lat !== null) fd.append('lat', String(lat));
        if (lng !== null) fd.append('lng', String(lng));
        if (rating > 0) fd.append('rating', String(rating));
        fd.append('autoTags', JSON.stringify([...moodTags, '#穴場スポット']));
        images.forEach((img, i) => {
          if (img.uri) fd.append('images', { uri: img.uri, name: `photo_${i}.jpg`, type: 'image/jpeg' } as unknown as Blob);
        });
        const res = await apiFetch('/api/suggestions', { method: 'POST', body: fd, timeoutMs: 30000 });
        const d = await res.json();
        if (!d?.ok) { showToast('投稿できませんでした', d?.error ?? 'しばらくして再度お試しください'); setSubmitting(false); return; }
      }
      showToast('投稿ありがとう！✨', isExisting ? 'みんなの穴場に載りました' : '確認後にみんなの穴場へ載ります');
      router.back();
    } catch { showToast('投稿に失敗しました', '通信環境を確認して再度お試しください'); setSubmitting(false); }
  };

  return (
    <View style={s.root}>
      <AppBackground />
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.head, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><ArrowLeft size={22} color="#fff" /></TouchableOpacity>
        <Text style={s.headTitle} numberOfLines={1}>みんなの穴場に投稿</Text>
      </LinearGradient>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">

          {/* 場所 */}
          <Text style={s.label}>場所</Text>
          {isExisting ? (
            <View style={s.placeLocked}>
              <MapPin size={15} color="#7C3AED" strokeWidth={2.4} />
              <Text style={s.placeLockedText} numberOfLines={1}>{spotName}</Text>
            </View>
          ) : (
            <>
              <TextInput style={s.input} value={spotName} onChangeText={setSpotName} placeholder="スポット名（例: 称名寺市民の森）" placeholderTextColor="#B9ABD2" />
              <View style={s.addrRow}>
                <TextInput style={[s.input, { flex: 1, minHeight: 0 }]} value={address} onChangeText={setAddress} placeholder="住所・エリア（任意）" placeholderTextColor="#B9ABD2" />
                <TouchableOpacity style={s.locBtn} onPress={useLocation} disabled={locating} activeOpacity={0.8}>
                  <MapPin size={15} color="#fff" strokeWidth={2.4} />
                  <Text style={s.locBtnText}>{locating ? '取得中' : '現在地'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* 写真 */}
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

          {/* 気分タグ */}
          <Text style={s.label}>合う気分（1つ以上）</Text>
          <View style={s.chips}>
            {MOODS.map(t => (
              <TouchableOpacity key={t} onPress={() => toggleMood(t)} style={[s.chip, moodTags.includes(t) && s.chipOn]} activeOpacity={0.8}>
                <Text style={[s.chipText, moodTags.includes(t) && s.chipTextOn]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ひとこと */}
          <Text style={s.label}>ひとこと（短くても長くてもOK）</Text>
          <TextInput style={s.input} value={caption} onChangeText={setCaption} placeholder="どんな場所？ どんな気分の日におすすめ？" placeholderTextColor="#B9ABD2" multiline maxLength={1000} />

          {/* おすすめ度 */}
          <Text style={s.label}>おすすめ度（任意）</Text>
          <View style={s.starsRow}>
            {[1, 2, 3, 4, 5].map(n => (
              <TouchableOpacity key={n} onPress={() => setRating(rating === n ? 0 : n)} hitSlop={6} activeOpacity={0.7}>
                <Star size={30} color={n <= rating ? '#F59E0B' : '#E5E7EB'} fill={n <= rating ? '#F59E0B' : '#E5E7EB'} strokeWidth={0} />
              </TouchableOpacity>
            ))}
          </View>

          {/* 権利確認 */}
          <TouchableOpacity style={s.check} onPress={() => setLicenseOk(v => !v)} activeOpacity={0.8}>
            <View style={[s.box, licenseOk && s.boxOn]}>{licenseOk && <Check size={14} color="#fff" strokeWidth={3} />}</View>
            <Text style={s.checkText}>自分で撮影した、または使用許可のある写真・内容です（必須）</Text>
          </TouchableOpacity>
          <Text style={s.note}>※ Google画像・Googleマップ・SNS等から保存した画像の投稿は禁止です。</Text>

          <TouchableOpacity style={[s.submitWrap, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting} activeOpacity={0.85}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.submit}>
              <Send size={17} color="#fff" strokeWidth={2.4} />
              <Text style={s.submitText}>{submitting ? '投稿中…' : '投稿する'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: APP_BG },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  headTitle: { fontSize: 17, fontWeight: '800', color: '#fff' },
  label: { fontSize: 13, fontWeight: '800', color: '#4A2D7E', marginTop: 16, marginBottom: 8 },
  placeLocked: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#F3EEFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#E3D8F5' },
  placeLockedText: { flex: 1, fontSize: 15, fontWeight: '800', color: '#7C3AED' },
  addrRow: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' },
  locBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#7C3AED', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  locBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  photoGrid: { flexDirection: 'row', gap: 10 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 88, height: 88, borderRadius: 12, backgroundColor: '#EEE' },
  thumbX: { position: 'absolute', top: -6, right: -6, backgroundColor: '#1E0753', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: 88, height: 88, borderRadius: 12, borderWidth: 1.5, borderColor: '#E3D8F5', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: '#fff' },
  addPhotoText: { fontSize: 11, color: '#A78BCA', fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 16, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  chipText: { fontSize: 12.5, color: '#7E6CA0', fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 12, padding: 12, fontSize: 14, color: '#2A2235', minHeight: 48, textAlignVertical: 'top', backgroundColor: '#fff' },
  starsRow: { flexDirection: 'row', gap: 8 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#C9B6FF', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  checkText: { flex: 1, fontSize: 12.5, color: '#4A4256', lineHeight: 18 },
  note: { fontSize: 11, color: '#B0A2C8', marginTop: 10, lineHeight: 16 },
  submitWrap: { borderRadius: 16, overflow: 'hidden', marginTop: 22, shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8 },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 15 },
  submitText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
});
