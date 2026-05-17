import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, MapPin, Camera, Tag, Send } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { TAG_CATEGORIES, MOOD_TAGS } from '@/lib/predefined-tags';

const SHOWN_CATEGORIES = ['mood', 'companion', 'scenery', 'activity', 'atmosphere'];

const T = {
  ja: {
    headerTitle: '穴場スポットを教えて！',
    back: '戻る',
    lead: 'あなたが知っている素敵な場所をMoodGoに投稿しよう。掲載された場合は特典をプレゼント予定です🎁',
    labelName: 'スポット名',
    labelDesc: 'どんな場所？おすすめポイント',
    labelLocation: '場所・住所',
    labelPhotos: '写真を添付（最大3枚）',
    labelTags: '🏷 気分タグを選ぼう',
    labelContact: '連絡先',
    placeholderName: '例：緑ヶ丘公園の秘密の展望台',
    placeholderDesc: '例：駐車場が平日2時間無料で穴場だから空いてる。夕日が最高！',
    placeholderAddr: 'または住所・エリア名を入力（例：神奈川県横浜市中区）',
    placeholderContact: '例：@line_id / example@email.com',
    hintPhotos: '駐車場の看板、穴場の建物、景色など。雰囲気が伝わる写真を！',
    hintContact: '掲載された場合に特典をお送りするため、LINEのIDやメールアドレスを教えていただけると助かります。',
    optional: '（任意）',
    locating: '取得中...',
    locateDone: '✅ 位置情報取得済み',
    locateBtn: '📍 現在地を自動取得（推奨）',
    photoBtn: '📷 写真を選ぶ',
    tagOpen: '▼ タグを選ぶ',
    tagClose: '▲ タグ選択を閉じる',
    submit: '投稿する 🚀',
    submitting: '送信中...',
    errName: 'スポット名を入力してください',
    errLocation: '位置情報の許可が必要です。',
    errLocationFail: '位置情報の取得に失敗しました。住所を手入力してください。',
    errPhoto: '写真へのアクセスを許可してください。',
    errPhotoFail: '画像の選択に失敗しました。',
    successTitle: 'ありがとうございます！',
    successBody: '投稿を受け付けました。\nスタッフが確認後、MoodGoに掲載されます。\n掲載された場合はご連絡いたします！',
    successBtn: 'ホームへ戻る',
  },
  en: {
    headerTitle: 'Share a hidden gem!',
    back: 'Back',
    lead: 'Tell MoodGo about a great spot you know. If we feature it, you\'ll get a special reward 🎁',
    labelName: 'Spot name',
    labelDesc: 'What\'s it like? Why do you love it?',
    labelLocation: 'Location / Address',
    labelPhotos: 'Add photos (up to 3)',
    labelTags: '🏷 Pick mood tags',
    labelContact: 'Contact',
    placeholderName: 'e.g. Secret viewpoint at Midorigaoka Park',
    placeholderDesc: 'e.g. Free parking on weekdays and it\'s never crowded. Amazing sunset!',
    placeholderAddr: 'Or enter an address / area name',
    placeholderContact: 'e.g. @line_id / example@email.com',
    hintPhotos: 'Parking signs, the spot\'s exterior, scenery — anything that captures the vibe!',
    hintContact: 'We\'d love a LINE ID or email to send your reward if we feature the spot.',
    optional: '(optional)',
    locating: 'Getting location...',
    locateDone: '✅ Location captured',
    locateBtn: '📍 Use current location (recommended)',
    photoBtn: '📷 Choose photos',
    tagOpen: '▼ Choose tags',
    tagClose: '▲ Close tag picker',
    submit: 'Submit 🚀',
    submitting: 'Sending...',
    errName: 'Please enter a spot name',
    errLocation: 'Location permission is required.',
    errLocationFail: 'Failed to get location. Please enter the address manually.',
    errPhoto: 'Please allow photo access.',
    errPhotoFail: 'Failed to select images.',
    successTitle: 'Thank you!',
    successBody: 'We received your submission.\nOur team will review it and add it to MoodGo.\nWe\'ll reach out if it gets featured!',
    successBtn: 'Back to home',
  },
};

export default function SuggestScreen() {
  const insets = useSafeAreaInsets();
  const { lang: langParam } = useLocalSearchParams<{ lang?: string }>();
  const lang = (langParam === 'en' ? 'en' : 'ja') as 'ja' | 'en';
  const t = T[lang];

  const [spotName, setSpotName]       = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress]         = useState('');
  const [lat, setLat]                 = useState<number | null>(null);
  const [lng, setLng]                 = useState<number | null>(null);
  const [contact, setContact]         = useState('');
  const [images, setImages]           = useState<{ uri: string; base64?: string }[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [isLocating, setIsLocating]   = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted]     = useState(false);
  const [error, setError]             = useState('');

  const handleGetLocation = async () => {
    setIsLocating(true);
    setError('');
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError(t.errLocation);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLat(pos.coords.latitude);
      setLng(pos.coords.longitude);
    } catch {
      setError(t.errLocationFail);
    } finally {
      setIsLocating(false);
    }
  };

  const handlePickImages = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t.errPhoto);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 3,
        quality: 0.7,
        base64: true,
      });
      if (!result.canceled) {
        setImages(result.assets.slice(0, 3).map(a => ({ uri: a.uri, base64: a.base64 ?? undefined })));
      }
    } catch {
      Alert.alert(t.errPhotoFail);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleSubmit = async () => {
    if (!spotName.trim()) { setError(t.errName); return; }
    setIsSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        spotName: spotName.trim(),
        description,
        address,
        contact,
        autoTags: selectedTags,
      };
      if (lat !== null) body.lat = lat;
      if (lng !== null) body.lng = lng;
      if (images.length > 0) {
        body.images = images.map(img => img.base64 ? `data:image/jpeg;base64,${img.base64}` : img.uri);
      }
      const res = await apiFetch('/api/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? '送信失敗');
      setSubmitted(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.successWrap}>
          <Text style={s.successEmoji}>🎉</Text>
          <Text style={s.successTitle}>{t.successTitle}</Text>
          <Text style={s.successBody}>{t.successBody}</Text>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85}>
            <LinearGradient colors={['#ffbf67', '#ff7b54']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.successBtn}>
              <Text style={s.successBtnText}>{t.successBtn}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.root, { paddingTop: insets.top }]}>
        {/* ── Header ── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.6}>
            <ChevronLeft size={20} color="#FF6B35" strokeWidth={2.5} />
            <Text style={s.backText}>{t.back}</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t.headerTitle}</Text>
          <View style={{ width: 64 }} />
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={s.lead}>{t.lead}</Text>

          <View style={s.card}>
            {/* Spot name */}
            <Text style={s.label}>{t.labelName} <Text style={s.required}>*</Text></Text>
            <TextInput value={spotName} onChangeText={setSpotName} placeholder={t.placeholderName} placeholderTextColor="#b07080" style={s.input} />

            {/* Description */}
            <Text style={[s.label, { marginTop: 16 }]}>{t.labelDesc}</Text>
            <TextInput value={description} onChangeText={setDescription} placeholder={t.placeholderDesc} placeholderTextColor="#b07080" multiline numberOfLines={4} textAlignVertical="top" style={s.textarea} />

            {/* Location */}
            <Text style={[s.label, { marginTop: 16 }]}>{t.labelLocation}</Text>
            <TouchableOpacity onPress={handleGetLocation} disabled={isLocating} activeOpacity={0.85} style={s.locationBtnWrap}>
              <LinearGradient colors={lat ? ['#d1fae5', '#a7f3d0'] : ['#ffbf67', '#ff7b54']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.locationBtn}>
                <MapPin size={16} color={lat ? '#065f46' : '#fff'} strokeWidth={2} />
                <Text style={[s.locationBtnText, lat !== null && { color: '#065f46' }]}>
                  {isLocating ? t.locating : lat ? t.locateDone : t.locateBtn}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
            <TextInput value={address} onChangeText={setAddress} placeholder={t.placeholderAddr} placeholderTextColor="#b07080" style={[s.input, { marginTop: 8 }]} />
            {lat ? <Text style={s.latText}>{lat.toFixed(5)}, {lng?.toFixed(5)}</Text> : null}

            {/* Photos */}
            <Text style={[s.label, { marginTop: 16 }]}>{t.labelPhotos}</Text>
            <Text style={s.hint}>{t.hintPhotos}</Text>
            <TouchableOpacity onPress={handlePickImages} activeOpacity={0.85} style={s.imagePicker}>
              <Camera size={20} color="#b07080" strokeWidth={1.8} />
              <Text style={s.imagePickerText}>{t.photoBtn}</Text>
            </TouchableOpacity>
            {images.length > 0 && (
              <View style={s.imageRow}>
                {images.map((img, i) => (
                  <Image key={i} source={{ uri: img.uri }} style={s.imageThumb} />
                ))}
              </View>
            )}

            {/* Tags */}
            <Text style={[s.label, { marginTop: 16 }]}>{t.labelTags} <Text style={s.optional}>{t.optional}</Text></Text>
            <TouchableOpacity onPress={() => setTagPickerOpen(p => !p)} activeOpacity={0.85} style={s.tagToggle}>
              <Tag size={16} color="#b07080" strokeWidth={1.8} />
              <Text style={s.tagToggleText}>{tagPickerOpen ? t.tagClose : t.tagOpen}</Text>
            </TouchableOpacity>

            {selectedTags.length > 0 && (
              <View style={s.tagRow}>
                {selectedTags.map(tag => (
                  <TouchableOpacity key={tag} onPress={() => toggleTag(tag)} style={[s.tagChip, MOOD_TAGS.includes(tag) && s.tagChipMood]}>
                    <Text style={[s.tagChipText, MOOD_TAGS.includes(tag) && s.tagChipTextMood]}>{tag} ✕</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {tagPickerOpen && (
              <View style={s.tagPicker}>
                {TAG_CATEGORIES.filter(c => SHOWN_CATEGORIES.includes(c.key)).map(cat => (
                  <View key={cat.key} style={{ marginBottom: 12 }}>
                    <Text style={s.tagCatLabel}>{cat.key === 'mood' ? '🎭 ' : ''}{cat.label}</Text>
                    <View style={s.tagGrid}>
                      {cat.tags.map(tag => {
                        const active = selectedTags.includes(tag);
                        return (
                          <TouchableOpacity key={tag} onPress={() => toggleTag(tag)} style={[s.tagOption, active && (cat.key === 'mood' ? s.tagOptionMoodActive : s.tagOptionActive)]}>
                            <Text style={[s.tagOptionText, active && (cat.key === 'mood' ? s.tagOptionTextMoodActive : s.tagOptionTextActive)]}>
                              {active ? '✓ ' : ''}{tag}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Contact */}
            <Text style={[s.label, { marginTop: 16 }]}>{t.labelContact} <Text style={s.optional}>{t.optional}</Text></Text>
            <Text style={s.hint}>{t.hintContact}</Text>
            <TextInput value={contact} onChangeText={setContact} placeholder={t.placeholderContact} placeholderTextColor="#b07080" style={s.input} />
          </View>

          {error ? <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View> : null}

          <TouchableOpacity onPress={handleSubmit} disabled={isSubmitting || !spotName.trim()} activeOpacity={0.85} style={{ opacity: spotName.trim() ? 1 : 0.5 }}>
            <LinearGradient colors={['#ffbf67', '#ff7b54']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.submitBtn}>
              <Send size={18} color="#fff" strokeWidth={2} />
              <Text style={s.submitText}>{isSubmitting ? t.submitting : t.submit}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.12)' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 8, minWidth: 64 },
  backText: { fontSize: 17, color: '#FF6B35' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#000' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },
  lead: { fontSize: 13, color: '#7a5860', lineHeight: 20 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  label: { fontSize: 14, fontWeight: '800', color: '#4a3034', marginBottom: 8 },
  required: { color: '#ff6b6b' },
  optional: { fontSize: 12, fontWeight: '400', color: '#9b7080' },
  hint: { fontSize: 12, color: '#9b7080', lineHeight: 18, marginBottom: 10 },
  input: { height: 52, borderRadius: 14, backgroundColor: '#fffaf8', borderWidth: 1, borderColor: '#ead7db', paddingHorizontal: 16, fontSize: 15, color: '#4a3034' },
  textarea: { borderRadius: 14, backgroundColor: '#fffaf8', borderWidth: 1, borderColor: '#ead7db', padding: 14, fontSize: 15, color: '#4a3034', minHeight: 100, lineHeight: 22 },
  locationBtnWrap: { marginBottom: 4 },
  locationBtn: { height: 48, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  locationBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  latText: { fontSize: 12, color: '#065f46', fontWeight: '700', marginTop: 4 },
  imagePicker: { height: 52, borderRadius: 18, borderWidth: 2, borderColor: '#f0c0c8', borderStyle: 'dashed', backgroundColor: '#fffaf8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  imagePickerText: { fontSize: 14, fontWeight: '800', color: '#b07080' },
  imageRow: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  imageThumb: { width: 90, height: 90, borderRadius: 14, borderWidth: 1, borderColor: '#f0dfe3' },
  tagToggle: { height: 44, borderRadius: 16, borderWidth: 1, borderColor: '#f0c0c8', backgroundColor: '#fffaf8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  tagToggleText: { fontSize: 14, fontWeight: '800', color: '#b07080' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tagChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#fff3e6', borderWidth: 1, borderColor: '#ffd8a8' },
  tagChipMood: { backgroundColor: '#ffe0e8', borderColor: '#ffb0c0' },
  tagChipText: { fontSize: 12, fontWeight: '700', color: '#8a4500' },
  tagChipTextMood: { color: '#c0385a' },
  tagPicker: { borderWidth: 1, borderColor: '#ead7db', borderRadius: 16, padding: 12, backgroundColor: '#fffaf8', marginBottom: 4 },
  tagCatLabel: { fontSize: 11, fontWeight: '900', color: '#6a4a50', marginBottom: 6 },
  tagGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tagOption: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: '#f0f0f0', borderWidth: 1, borderColor: '#d0d0d0' },
  tagOptionActive: { backgroundColor: '#e8f4ff', borderColor: '#90c0f0' },
  tagOptionMoodActive: { backgroundColor: '#ffe0e8', borderColor: '#ffb0c0' },
  tagOptionText: { fontSize: 12, fontWeight: '700', color: '#555' },
  tagOptionTextActive: { color: '#1a5080' },
  tagOptionTextMoodActive: { color: '#c0385a' },
  errorBox: { backgroundColor: '#fff0f2', borderWidth: 1, borderColor: '#ffc0c8', borderRadius: 14, padding: 12 },
  errorText: { fontSize: 13, color: '#c0385a' },
  submitBtn: { height: 56, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitText: { fontSize: 16, fontWeight: '900', color: '#fff' },
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successEmoji: { fontSize: 72, marginBottom: 16 },
  successTitle: { fontSize: 26, fontWeight: '900', color: '#4a3034', marginBottom: 12, textAlign: 'center' },
  successBody: { fontSize: 15, lineHeight: 26, color: '#7a5860', marginBottom: 24, textAlign: 'center' },
  successBtn: { height: 52, paddingHorizontal: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  successBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },
});
