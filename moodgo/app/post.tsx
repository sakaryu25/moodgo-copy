// ── app/post.tsx ──────────────────────────────────────────────────────────────
// 統一投稿画面（Phase2）。穴場・moodログ・ブログを1つのフォームに集約。
//   - 既存スポット(placeId param あり／検索で選択)→ /api/spot-posts（moodログ＝場所への口コミ）
//   - 新スポット(名前を入力)→ /api/suggestions（穴場＝運営が審査して掲載）
// どちらもユーザーから見れば「投稿する」1つだけ。裏のテーブルは触らず分岐するだけ＝安全。
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Calendar, Camera, Check, MapPin, Search, Send, Star, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
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
import { DEEP_DIVE } from '@/components/QuizFlow';

const GRAD: [string, string, string] = ['#F56CB3', '#9B6BFF', '#4FA3FF'];
const MOODS = ['#まったりしたい', '#自然感じたい', '#わいわい楽しみたい', '#お腹すいた', '#ドライブしたい', '#集中したい', '#体動かしたい', '#遠くに行きたい', '#ショッピング', '#スリル味わいたい'];
// 投稿の気分タグ → QuizFlowのDEEP_DIVEキー（綴りが違うのでマップ）。深掘り(サブジャンル)タグを出すため。
const MOOD_TAG_TO_DIVE: Record<string, string> = {
  '#お腹すいた': 'お腹すいた', '#まったりしたい': 'まったり', '#自然感じたい': '自然',
  '#わいわい楽しみたい': '楽しみたい', '#ドライブしたい': 'ドライブ', '#集中したい': '集中',
  '#体動かしたい': '運動', '#遠くに行きたい': '旅行', '#ショッピング': 'ショッピング',
  '#スリル味わいたい': 'スリル',
};

type PlaceHit = { id: string; name: string; address?: string };

export default function PostScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ placeId?: string; placeName?: string; address?: string }>();
  const paramPlaceId = (params.placeId ?? '').toString();   // 場所詳細から来た既存スポット

  const [spotName, setSpotName] = useState((params.placeName ?? '').toString());
  const [address, setAddress] = useState((params.address ?? '').toString());
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [images, setImages] = useState<{ uri: string; base64?: string }[]>([]);
  const [moodTags, setMoodTags] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [rating, setRating] = useState(0);
  const [availFrom, setAvailFrom] = useState('');   // 期間限定(任意・新スポットのみ)
  const [availUntil, setAvailUntil] = useState('');
  const [openingHours, setOpeningHours] = useState('');  // 営業時間(任意・新スポット)
  const [station, setStation] = useState('');            // 最寄駅(任意・新スポット)
  const [showPicker, setShowPicker] = useState<null | 'from' | 'until'>(null);  // 公開期間のカレンダー
  const [tempDate, setTempDate] = useState(new Date());
  const [licenseOk, setLicenseOk] = useState(false);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 既存スポット候補（スポット名を打つと被る既存placeが出る）
  const [results, setResults] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickedId, setPickedId] = useState('');   // 候補から選んだ既存スポットID
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 画面を離れる時に検索タイマーを止める（unmount後のsetState/古い結果上書きを防ぐ）
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const existingPlaceId = paramPlaceId || pickedId;  // 既存(param or 検索選択)
  const isExisting = !!existingPlaceId;
  const lockedFromParam = !!paramPlaceId;

  // スポット名を打つたびに既存placeを検索（被り候補を出す）。空/1文字なら候補クリア。
  const onNameChange = (text: string) => {
    setSpotName(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/api/place-search?q=${encodeURIComponent(text.trim())}`);
        const d = await res.json();
        setResults(Array.isArray(d?.places) ? d.places : []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 300);
  };
  // 候補から既存スポットを選択＝その場所への口コミ(moodログ)として投稿
  const pickPlace = (p: PlaceHit) => {
    if (timer.current) clearTimeout(timer.current);
    setPickedId(p.id); setSpotName(p.name); setAddress(p.address ?? '');
    setResults([]);
  };
  const clearPicked = () => { setPickedId(''); setSpotName(''); setAddress(''); setResults([]); };

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
      } else {
        // 拒否時は無反応にせずフィードバック（写真許可と同様）
        showToast('位置情報の許可が必要です', '設定アプリ → MoodGo → 位置情報 で許可してください');
      }
    } catch { /* 位置取得失敗 */ } finally { setLocating(false); }
  };

  const toggleMood = (t: string) => setMoodTags(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]));

  // 公開期間のカレンダー。ローカル日付で YYYY-MM-DD 化（TZずれ回避）
  const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const openPicker = (which: 'from' | 'until') => {
    const cur = which === 'from' ? availFrom : availUntil;
    setTempDate(cur ? new Date(`${cur}T00:00:00`) : new Date());
    setShowPicker(which);
  };
  const applyPickedDate = (d: Date) => {
    const st = fmtDate(d);
    if (showPicker === 'from') setAvailFrom(st); else if (showPicker === 'until') setAvailUntil(st);
  };

  // 選んだ気分の深掘り(サブジャンル)タグを L1＋L2 フラットで出す（重複排除）
  const deepDiveOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; label: string }[] = [];
    for (const m of moodTags) {
      const cfg = DEEP_DIVE[MOOD_TAG_TO_DIVE[m] ?? ''];
      if (!cfg) continue;
      for (const opt of cfg.options) {
        if (!seen.has(opt.key)) { seen.add(opt.key); out.push({ key: opt.key, label: opt.label }); }
        for (const sub of (opt.subs ?? [])) {
          if (!seen.has(sub.key)) { seen.add(sub.key); out.push({ key: sub.key, label: sub.label }); }
        }
      }
    }
    return out;
  }, [moodTags]);

  const submit = async () => {
    // バリデーションはフォームの並び順（名前→気分→本文→権利）に合わせる＝下の項目のエラーが先に出ない
    if (!isExisting && !spotName.trim()) { showToast('場所の名前を入力してください', '新しいスポット名を入れてね'); return; }
    if (moodTags.length === 0) { showToast('気分タグを選んでください', '合う気分を1つ以上タップ'); return; }
    if (findNgWord(caption) || findNgWord(spotName)) { showToast('不適切な表現があります', '内容を見直してください'); return; }
    if (!licenseOk) { showToast('権利確認が必要です', '「自分で撮影／使用許可あり」にチェック'); return; }
    setSubmitting(true);
    try {
      const deviceId = await getDeviceId();
      const posterName = (await AsyncStorage.getItem('moodgo-group-nickname'))?.trim() || undefined;
      // おすすめ度を本文末に埋め込み（フィードが【おすすめ度】★Nを拾って★表示する）
      const descWithRating = [caption.trim(), rating > 0 ? `【おすすめ度】★${rating}` : ''].filter(Boolean).join('\n');

      const imgs = images.map(i => (i.base64 ? `data:image/jpeg;base64,${i.base64}` : '')).filter(Boolean);
      // 投稿は全て spot-posts に一本化。新スポット(placeId無し)はAPI側でplacesに仮登録され、admin承認で検索に出る。
      const res = await apiFetch('/api/spot-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: 30000,
        body: JSON.stringify({
          action: 'create', deviceId, posterName,
          placeId: existingPlaceId || undefined, placeName: spotName, address,
          lat: lat ?? undefined, lng: lng ?? undefined,
          caption: descWithRating, moodTags, visibility: 'spot_public_anonymous',
          canUseAsSpotPhoto: true, licenseDeclared: true, images: imgs,
          // 新スポット(穴場)の詳細。既存スポットへの投稿(moodログ)では送らない＝既存placeを上書きしない
          openingHours: !isExisting ? (openingHours.trim() || undefined) : undefined,
          station: !isExisting ? (station.trim() || undefined) : undefined,
          availableFrom: !isExisting ? (availFrom.trim() || undefined) : undefined,
          availableUntil: !isExisting ? (availUntil.trim() || undefined) : undefined,
        }),
      });
      const d = await res.json();
      if (!d?.ok) { showToast('投稿できませんでした', d?.error ?? 'しばらくして再度お試しください'); setSubmitting(false); return; }
      showToast('投稿ありがとう！✨', existingPlaceId ? '投稿しました' : '新スポットとして投稿（確認後に検索にも反映）');
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
          {lockedFromParam ? (
            <View style={s.pickedRow}>
              <MapPin size={15} color="#7C3AED" strokeWidth={2.4} />
              <Text style={s.pickedText} numberOfLines={1}>{spotName}</Text>
            </View>
          ) : pickedId ? (
            <View style={s.pickedRow}>
              <MapPin size={15} color="#7C3AED" strokeWidth={2.4} />
              <Text style={s.pickedText} numberOfLines={1}>{spotName}</Text>
              <TouchableOpacity onPress={clearPicked} hitSlop={8}><Text style={s.changeBtn}>変更</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              {/* スポット名（打つと被る既存スポットが候補で出る）*/}
              <View style={s.searchWrap}>
                <Search size={16} color="#A78BCA" strokeWidth={2.2} />
                <TextInput style={s.searchInput} value={spotName} onChangeText={onNameChange} placeholder="スポット名を入力（例: 称名寺市民の森）" placeholderTextColor="#B9ABD2" />
                {searching && <ActivityIndicator size="small" color="#9B6BFF" />}
              </View>

              {/* 既存スポットと名前が被ったら候補表示。タップ＝その場所への口コミ、無ければそのまま新規登録 */}
              {results.length > 0 && (
                <View style={s.suggestBox}>
                  <Text style={s.suggestHint}>同じ名前のスポットが見つかりました。タップで選ぶと、その場所への投稿になります👇</Text>
                  {results.map(p => (
                    <TouchableOpacity key={p.id} onPress={() => pickPlace(p)} style={s.resultRow} activeOpacity={0.8}>
                      <MapPin size={14} color="#7C3AED" strokeWidth={2.2} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.resultName} numberOfLines={1}>{p.name}</Text>
                        {p.address ? <Text style={s.resultAddr} numberOfLines={1}>{p.address}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  ))}
                  <Text style={s.suggestNew}>一覧に無ければ、このまま「{spotName.trim()}」を新しいスポットとして登録できます</Text>
                </View>
              )}

              {/* 住所（新しいスポットとして登録する場合）*/}
              <View style={s.addrRow}>
                <TextInput style={[s.input, { flex: 1, minHeight: 0 }]} value={address} onChangeText={setAddress} placeholder="住所・エリア（任意）" placeholderTextColor="#B9ABD2" />
                <TouchableOpacity style={s.locBtn} onPress={useLocation} disabled={locating} activeOpacity={0.8}>
                  <MapPin size={15} color="#fff" strokeWidth={2.4} />
                  <Text style={s.locBtnText}>{locating ? '取得中' : '現在地'}</Text>
                </TouchableOpacity>
              </View>

              {/* 営業時間・最寄駅（新しい穴場スポットの詳細情報・任意）*/}
              <TextInput style={[s.input, { marginTop: 8 }]} value={openingHours} onChangeText={setOpeningHours} placeholder="営業時間（任意・例: 11:00〜22:00、月曜休）" placeholderTextColor="#B9ABD2" multiline />
              <TextInput style={[s.input, { marginTop: 8, minHeight: 48 }]} value={station} onChangeText={setStation} placeholder="最寄駅（任意・例: JR横浜駅 徒歩5分）" placeholderTextColor="#B9ABD2" />

              {/* 期間限定の公開（任意・穴場・カレンダー選択） */}
              <Text style={s.label}>期間限定の公開（任意）</Text>
              <View style={s.periodRow}>
                <TouchableOpacity style={[s.input, s.dateBtn, { flex: 1, minHeight: 48 }]} onPress={() => openPicker('from')} activeOpacity={0.8}>
                  <Calendar size={15} color="#9B6BFF" strokeWidth={2.2} />
                  <Text style={[s.dateBtnText, !availFrom && s.dateBtnPh]} numberOfLines={1}>{availFrom || '開始日'}</Text>
                  {availFrom ? <TouchableOpacity onPress={() => setAvailFrom('')} hitSlop={8}><X size={14} color="#B9ABD2" /></TouchableOpacity> : null}
                </TouchableOpacity>
                <Text style={s.periodTilde}>〜</Text>
                <TouchableOpacity style={[s.input, s.dateBtn, { flex: 1, minHeight: 48 }]} onPress={() => openPicker('until')} activeOpacity={0.8}>
                  <Calendar size={15} color="#9B6BFF" strokeWidth={2.2} />
                  <Text style={[s.dateBtnText, !availUntil && s.dateBtnPh]} numberOfLines={1}>{availUntil || '終了日'}</Text>
                  {availUntil ? <TouchableOpacity onPress={() => setAvailUntil('')} hitSlop={8}><X size={14} color="#B9ABD2" /></TouchableOpacity> : null}
                </TouchableOpacity>
              </View>
              <Text style={s.note}>※ 期間限定イベント等の穴場に。空欄なら常時公開です。</Text>
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

          {/* 詳しいジャンル（選んだ気分の深掘りタグ・任意）*/}
          {deepDiveOptions.length > 0 && (
            <>
              <Text style={s.label}>詳しいジャンル（任意・当てはまるものをタップ）</Text>
              <View style={s.chips}>
                {deepDiveOptions.map(o => {
                  const tag = '#' + o.key;
                  const on = moodTags.includes(tag);
                  return (
                    <TouchableOpacity key={o.key} onPress={() => toggleMood(tag)} style={[s.chip, on && s.chipOn]} activeOpacity={0.8}>
                      <Text style={[s.chipText, on && s.chipTextOn]}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

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

      {/* 公開期間のカレンダー（iOS=モーダル内インライン / Android=ネイティブダイアログ） */}
      {showPicker !== null && (Platform.OS === 'ios' ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setShowPicker(null)}>
          <View style={s.pickerOverlay}>
            <View style={s.pickerSheet}>
              <Text style={s.pickerTitle}>{showPicker === 'from' ? '公開を始める日' : '公開を終える日'}</Text>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="inline"
                locale="ja-JP"
                onChange={(_e, d) => { if (d) setTempDate(d); }}
                style={{ alignSelf: 'stretch' }}
                accentColor="#9B6BFF"
              />
              <View style={s.pickerBtns}>
                <TouchableOpacity onPress={() => setShowPicker(null)} style={s.pickerCancel} activeOpacity={0.8}>
                  <Text style={s.pickerCancelText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { applyPickedDate(tempDate); setShowPicker(null); }} style={s.pickerOk} activeOpacity={0.8}>
                  <Text style={s.pickerOkText}>この日にする</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : (
        <DateTimePicker
          value={tempDate}
          mode="date"
          onChange={(e, d) => { if (e.type === 'set' && d) applyPickedDate(d); setShowPicker(null); }}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: APP_BG },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  headTitle: { fontSize: 17, fontWeight: '800', color: '#fff' },
  label: { fontSize: 13, fontWeight: '800', color: '#4A2D7E', marginTop: 16, marginBottom: 8 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#fff' },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: '#2A2235' },
  suggestBox: { marginTop: 8, backgroundColor: '#F7F2FF', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#E9DEFB' },
  suggestHint: { fontSize: 11.5, color: '#7C3AED', fontWeight: '800', lineHeight: 17 },
  suggestNew: { fontSize: 11, color: '#9B89BE', fontWeight: '700', marginTop: 8, lineHeight: 16 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6, borderWidth: 1, borderColor: '#EFE8FB' },
  resultName: { fontSize: 14, fontWeight: '700', color: '#2A2235' },
  resultAddr: { fontSize: 11.5, color: '#9B89BE', marginTop: 2 },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#F3EEFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#E3D8F5' },
  pickedText: { flex: 1, fontSize: 15, fontWeight: '800', color: '#7C3AED' },
  changeBtn: { color: '#7C3AED', fontSize: 12, fontWeight: '800' },
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
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  periodTilde: { fontSize: 14, color: '#9B89BE', fontWeight: '700' },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateBtnText: { flex: 1, fontSize: 14, color: '#2A2235', fontWeight: '700' },
  dateBtnPh: { color: '#B9ABD2', fontWeight: '500' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(20,10,40,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  pickerSheet: { backgroundColor: '#fff', borderRadius: 20, padding: 16, width: '100%', maxWidth: 380 },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: '#4A2D7E', textAlign: 'center', marginBottom: 4 },
  pickerBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  pickerCancel: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#E3D8F5', alignItems: 'center' },
  pickerCancelText: { fontSize: 14, fontWeight: '800', color: '#9B89BE' },
  pickerOk: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#7C3AED', alignItems: 'center' },
  pickerOkText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#C9B6FF', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  checkText: { flex: 1, fontSize: 12.5, color: '#4A4256', lineHeight: 18 },
  note: { fontSize: 11, color: '#B0A2C8', marginTop: 10, lineHeight: 16 },
  submitWrap: { borderRadius: 16, overflow: 'hidden', marginTop: 22, shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8 },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 15 },
  submitText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
});
