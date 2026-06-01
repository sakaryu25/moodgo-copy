import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Check, ChevronLeft, MapPin, Send, Tag, X } from 'lucide-react-native';
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
// ─── Tag hierarchy ────────────────────────────────────────────────────────────
const MOODS = [
  '#お腹すいた', '#まったりしたい', '#わいわい楽しみたい', '#自然感じたい',
  '#ドライブしたい', '#集中したい', '#体動かしたい', '#遠くに行きたい',
];

// L2: 気分タグ → 深掘りタグ
const MOOD_DRILL: Record<string, string[]> = {
  '#お腹すいた':         ['#居酒屋', '#和食', '#洋食', '#イタリアン', '#中華料理', '#焼肉', '#韓国料理', '#アジア系統', '#各国料理', '#ラーメン', '#お好み焼きもんじゃ', '#カフェスイーツ', '#高層ビル料理'],
  '#まったりしたい':     ['#自然感じたい', '#癒しカフェ', '#温泉', '#絶景スポット'],
  '#わいわい楽しみたい': ['#体動かしたい', '#アミューズメントパーク', '#体験型ゲーム'],
  '#自然感じたい':       ['#海辺', '#自然公園', '#大型公園', '#展望台'],
  '#ドライブしたい':     ['#海辺', '#絶景スポット', '#ショッピング', '#ご当地グルメ'],
  '#集中したい':         ['#カフェ作業', '#勉強場', '#ファミレス', '#book場'],
  '#体動かしたい':       ['#ガッツリ運動', '#スポーツ', '#体験型ゲーム', '#屋外スポーツ'],
  '#遠くに行きたい':     ['#パワースポット', '#テーマパーク', '#お散歩', '#絶景スポット'],
};

// L3: 深掘りタグ → さらに深掘り
const TAG_DRILL: Record<string, string[]> = {
  '#居酒屋':        ['#居酒屋個室', '#大衆酒場'],
  '#和食':          ['#海鮮', '#天ぷら', '#うどんそば', '#懐石料理'],
  '#洋食':          ['#ハンバーグ', '#オムライス', '#ステーキ', '#レトロ洋食'],
  '#焼肉':          ['#焼肉食べ放題', '#高級焼肉', '#焼肉単品あり'],
  '#アジア系統':    ['#インドネパール料理', '#タイ料理', '#ベトナム料理', '#アジアンエスタニック料理'],
  '#各国料理':      ['#メキシコ料理', '#ブラジル料理', '#ロシア料理', '#他国料理'],
  '#ラーメン':      ['#こってりラーメン', '#あっさりラーメン', '#味噌ラーメン', '#つけ麺まぜそば'],
  '#カフェスイーツ':['#喫茶店', '#流行りカフェ'],
  '#自然感じたい':  ['#海辺', '#自然公園', '#大型公園', '#絶景スポット'],
  '#癒しカフェ':    ['#ブックカフェ', '#動物カフェ', '#景色良いカフェ', '#カフェスイーツ'],
  '#動物カフェ':    ['#猫カフェ', '#犬カフェ', '#小動物カフェ'],
  '#景色良いカフェ':['#海辺カフェ', '#森林カフェ', '#高層ビル料理'],
  '#温泉':          ['#サウナ', '#岩盤浴'],
  '#絶景スポット':  ['#都会', '#海辺', '#展望台'],
};

// 補足タグ
const EXTRA_TAGS = ['#無料駐車場', '#有料駐車場', '#カラオケ', '#ダーツ', '#ビリヤード', '#ボウリング', '#おすすめ'];

// ─── Design tokens (MoodGo統一) ──────────────────────────────────────────────
const PINK   = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE   = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const BG     = '#F5F0FF';


const T = {
  ja: {
    headerTitle: '穴場スポットを教えて！',
    back: '戻る',
    lead: 'あなたが知っている素敵な場所をMoodGoに投稿しよう。掲載された場合は特典をプレゼント予定です。',
    labelName: 'スポット名',
    labelDesc: 'どんな場所？おすすめポイント',
    labelLocation: '場所・住所',
    labelPhotos: '写真を添付（最大3枚）',
    labelTags: '気分タグを選ぼう',
    labelContact: '連絡先',
    placeholderName: '例：緑ヶ丘公園の秘密の展望台',
    placeholderDesc: '例：駐車場が平日2時間無料で穴場だから空いてる。夕日が最高！',
    placeholderAddr: 'または住所・エリア名を入力（例：神奈川県横浜市中区）',
    placeholderContact: '例：@line_id / example@email.com',
    hintPhotos: '駐車場の看板、穴場の建物、景色など。雰囲気が伝わる写真を！',
    hintContact: '掲載された場合に特典をお送りするため、LINEのIDやメールアドレスを教えていただけると助かります。',
    optional: '（任意）',
    locating: '取得中...',
    locateDone: '位置情報取得済み',
    locateBtn: '現在地を自動取得（推奨）',
    photoBtn: '写真を選ぶ',
    tagOpen: '▼ タグを選ぶ',
    tagClose: '▲ タグ選択を閉じる',
    submit: '投稿する',
    submitting: '送信中...',
    errName: 'スポット名を入力してください',
    errLocation: '位置情報の許可が必要です。',
    errLocationFail: '位置情報の取得に失敗しました。住所を手入力してください。',
    errPhoto: '写真へのアクセスを許可してください。',
    errPhotoFail: '画像の選択に失敗しました。',
    successTitle: 'ありがとうございます',
    successBody: '投稿を受け付けました。\nスタッフが確認後、MoodGoに掲載されます。\n掲載された場合はご連絡いたします！',
    successBtn: 'ホームへ戻る',
  },
  en: {
    headerTitle: 'Share a hidden gem!',
    back: 'Back',
    lead: "Tell MoodGo about a great spot you know. If we feature it, you'll get a special reward.",
    labelName: 'Spot name',
    labelDesc: "What's it like? Why do you love it?",
    labelLocation: 'Location / Address',
    labelPhotos: 'Add photos (up to 3)',
    labelTags: 'Pick mood tags',
    labelContact: 'Contact',
    placeholderName: 'e.g. Secret viewpoint at Midorigaoka Park',
    placeholderDesc: "e.g. Free parking on weekdays and it's never crowded. Amazing sunset!",
    placeholderAddr: 'Or enter an address / area name',
    placeholderContact: 'e.g. @line_id / example@email.com',
    hintPhotos: "Parking signs, the spot's exterior, scenery — anything that captures the vibe!",
    hintContact: "We'd love a LINE ID or email to send your reward if we feature the spot.",
    optional: '(optional)',
    locating: 'Getting location...',
    locateDone: 'Location captured',
    locateBtn: 'Use current location (recommended)',
    photoBtn: 'Choose photos',
    tagOpen: '▼ Choose tags',
    tagClose: '▲ Close tag picker',
    submit: 'Submit',
    submitting: 'Sending...',
    errName: 'Please enter a spot name',
    errLocation: 'Location permission is required.',
    errLocationFail: 'Failed to get location. Please enter the address manually.',
    errPhoto: 'Please allow photo access.',
    errPhotoFail: 'Failed to select images.',
    successTitle: 'Thank you',
    successBody: 'We received your submission.\nOur team will review it and add it to MoodGo.\nWe\'ll reach out if it gets featured!',
    successBtn: 'Back to home',
  },
};

// ─── TagSection helper ────────────────────────────────────────────────────────
function TagSection({ label, tags, selected, onToggle, isMood = false, indent = false }: {
  label: string;
  tags: string[];
  selected: string[];
  onToggle: (t: string) => void;
  isMood?: boolean;
  indent?: boolean;
}) {
  return (
    <View style={[tss.wrap, indent && tss.wrapIndent]}>
      <Text style={[tss.label, isMood && tss.labelMood]}>{label}</Text>
      <View style={tss.grid}>
        {tags.map(tag => {
          const active = selected.includes(tag);
          return (
            <TouchableOpacity
              key={tag}
              onPress={() => onToggle(tag)}
              style={[
                tss.chip,
                isMood && tss.chipMood,
                active && (isMood ? tss.chipMoodActive : tss.chipActive),
              ]}
            >
              {active && <Check size={10} color={isMood ? '#BE185D' : '#7C3AED'} strokeWidth={3} />}
              <Text style={[tss.text, active && (isMood ? tss.textMoodActive : tss.textActive)]}>
                {tag}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const tss = StyleSheet.create({
  wrap:          { marginBottom: 14 },
  wrapIndent:    { marginLeft: 12, borderLeftWidth: 2, borderLeftColor: '#DDD6FE', paddingLeft: 10 },
  label:         { fontSize: 11, fontWeight: '900', color: '#7C3AED', marginBottom: 8 },
  labelMood:     { fontSize: 12, color: '#BE185D' },
  grid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB',
  },
  chipMood:          { backgroundColor: '#FDF4FF', borderColor: '#F0ABFC' },
  chipActive:        { backgroundColor: '#EDE9FE', borderColor: '#A78BFA' },
  chipMoodActive:    { backgroundColor: '#FCE7F3', borderColor: '#F9A8D4' },
  text:              { fontSize: 12, fontWeight: '700', color: '#374151' },
  textActive:        { color: '#7C3AED' },
  textMoodActive:    { color: '#BE185D' },
});

export default function SuggestScreen() {
  const insets = useSafeAreaInsets();
  const { lang: langParam } = useLocalSearchParams<{ lang?: string }>();
  const lang = (langParam === 'en' ? 'en' : 'ja') as 'ja' | 'en';
  const t = T[lang];

  const [spotName, setSpotName]         = useState('');
  const [description, setDescription]   = useState('');
  const [address, setAddress]           = useState('');
  const [lat, setLat]                   = useState<number | null>(null);
  const [lng, setLng]                   = useState<number | null>(null);
  const [contact, setContact]           = useState('');
  const [images, setImages]             = useState<{ uri: string; base64?: string }[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [isLocating, setIsLocating]     = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted]       = useState(false);
  const [error, setError]               = useState('');

  const handleGetLocation = async () => {
    setIsLocating(true); setError('');
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError(t.errLocation); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setLat(pos.coords.latitude);
      setLng(pos.coords.longitude);
    } catch { setError(t.errLocationFail); }
    finally { setIsLocating(false); }
  };

  const handlePickImages = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert(t.errPhoto); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsMultipleSelection: true,
        selectionLimit: 3, quality: 0.7, base64: true,
      });
      if (!result.canceled) {
        setImages(result.assets.slice(0, 3).map(a => ({ uri: a.uri, base64: a.base64 ?? undefined })));
      }
    } catch { Alert.alert(t.errPhotoFail); }
  };

  const toggleTag = (tag: string) =>
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(x => x !== tag) : [...prev, tag]);

  const handleSubmit = async () => {
    if (!spotName.trim()) { setError(t.errName); return; }
    setIsSubmitting(true); setError('');
    try {
      const body: Record<string, unknown> = {
        spotName: spotName.trim(), description, address, contact, autoTags: selectedTags,
      };
      if (lat !== null) body.lat = lat;
      if (lng !== null) body.lng = lng;
      if (images.length > 0)
        body.images = images.map(img => img.base64 ? `data:image/jpeg;base64,${img.base64}` : img.uri);
      const res = await apiFetch('/api/suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? '送信失敗');
      setSubmitted(true);
    } catch (e) { setError(String(e)); }
    finally { setIsSubmitting(false); }
  };

  // ── 送信完了 ──────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <View style={[s.root, { paddingTop: insets.top + 20 }]}>
        <View style={s.successWrap}>
          <Text style={s.successTitle}>{t.successTitle}</Text>
          <Text style={s.successBody}>{t.successBody}</Text>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85} style={s.successBtnWrap}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.successBtn}>
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

        {/* ── ヘッダー ── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backCircle} activeOpacity={0.7}>
            <ChevronLeft size={20} color="#7C3AED" strokeWidth={2.5} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t.headerTitle}</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.scrollContent, { paddingBottom: insets.bottom + 40 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.lead}>{t.lead}</Text>

          <View style={s.card}>

            {/* スポット名 */}
            <Text style={s.label}>{t.labelName} <Text style={s.required}>*</Text></Text>
            <TextInput
              value={spotName} onChangeText={setSpotName}
              placeholder={t.placeholderName} placeholderTextColor="#C4B5FD"
              style={s.input}
            />

            {/* 説明 */}
            <Text style={[s.label, { marginTop: 18 }]}>{t.labelDesc}</Text>
            <TextInput
              value={description} onChangeText={setDescription}
              placeholder={t.placeholderDesc} placeholderTextColor="#C4B5FD"
              multiline numberOfLines={4} textAlignVertical="top"
              style={s.textarea}
            />

            {/* 位置情報 */}
            <Text style={[s.label, { marginTop: 18 }]}>{t.labelLocation}</Text>
            <TouchableOpacity onPress={handleGetLocation} disabled={isLocating} activeOpacity={0.85} style={s.locWrap}>
              <LinearGradient
                colors={lat ? ['#D1FAE5', '#A7F3D0'] : GRAD}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.locBtn}
              >
                <MapPin size={16} color={lat ? '#065F46' : '#fff'} strokeWidth={2} />
                <Text style={[s.locBtnText, lat !== null && { color: '#065F46' }]}>
                  {isLocating ? t.locating : lat ? t.locateDone : t.locateBtn}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
            <TextInput
              value={address} onChangeText={setAddress}
              placeholder={t.placeholderAddr} placeholderTextColor="#C4B5FD"
              style={[s.input, { marginTop: 10 }]}
            />
            {lat ? <Text style={s.latText}>{lat.toFixed(5)}, {lng?.toFixed(5)}</Text> : null}

            {/* 写真 */}
            <Text style={[s.label, { marginTop: 18 }]}>{t.labelPhotos}</Text>
            <Text style={s.hint}>{t.hintPhotos}</Text>
            <TouchableOpacity onPress={handlePickImages} activeOpacity={0.85} style={s.imagePicker}>
              <Camera size={20} color="#A78BFA" strokeWidth={1.8} />
              <Text style={s.imagePickerText}>{t.photoBtn}</Text>
            </TouchableOpacity>
            {images.length > 0 && (
              <View style={s.imageRow}>
                {images.map((img, i) => (
                  <Image key={i} source={{ uri: img.uri }} style={s.imageThumb} />
                ))}
              </View>
            )}

            {/* タグ */}
            <Text style={[s.label, { marginTop: 18 }]}>
              {t.labelTags} <Text style={s.optional}>{t.optional}</Text>
            </Text>
            <TouchableOpacity onPress={() => setTagPickerOpen(p => !p)} activeOpacity={0.85} style={s.tagToggle}>
              <Tag size={16} color="#A78BFA" strokeWidth={1.8} />
              <Text style={s.tagToggleText}>{tagPickerOpen ? t.tagClose : t.tagOpen}</Text>
            </TouchableOpacity>

            {selectedTags.length > 0 && (
              <View style={s.tagRow}>
                {selectedTags.map(tag => {
                  const isMood = MOODS.includes(tag);
                  return (
                    <TouchableOpacity key={tag} onPress={() => toggleTag(tag)}
                      style={[s.tagChip, isMood && s.tagChipMood]}>
                      <Text style={[s.tagChipText, isMood && s.tagChipTextMood]}>{tag}</Text>
                      <X size={11} color={isMood ? '#BE185D' : '#7C3AED'} strokeWidth={2.5} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {tagPickerOpen && (
              <View style={s.tagPicker}>

                {/* ── 気分タグ ── */}
                <TagSection
                  label="気分タグ（必須：最低1つ）"
                  tags={MOODS}
                  selected={selectedTags}
                  onToggle={toggleTag}
                  isMood
                />

                {/* ── 深掘りタグ (L2) ── */}
                {MOODS.filter(m => selectedTags.includes(m) && MOOD_DRILL[m]).map(mood => (
                  <View key={mood}>
                    <TagSection
                      label={`${mood} の深掘り`}
                      tags={MOOD_DRILL[mood]}
                      selected={selectedTags}
                      onToggle={toggleTag}
                    />
                    {/* ── さらに深掘り (L3) ── */}
                    {MOOD_DRILL[mood].filter(t => selectedTags.includes(t) && TAG_DRILL[t]).map(t2 => (
                      <TagSection
                        key={t2}
                        label={`${t2} の詳細`}
                        tags={TAG_DRILL[t2]}
                        selected={selectedTags}
                        onToggle={toggleTag}
                        indent
                      />
                    ))}
                  </View>
                ))}

                {/* ── 補足タグ ── */}
                <TagSection
                  label="補足タグ（任意）"
                  tags={EXTRA_TAGS}
                  selected={selectedTags}
                  onToggle={toggleTag}
                />
              </View>
            )}

            {/* 連絡先 */}
            <Text style={[s.label, { marginTop: 18 }]}>
              {t.labelContact} <Text style={s.optional}>{t.optional}</Text>
            </Text>
            <Text style={s.hint}>{t.hintContact}</Text>
            <TextInput
              value={contact} onChangeText={setContact}
              placeholder={t.placeholderContact} placeholderTextColor="#C4B5FD"
              style={s.input}
            />
          </View>

          {error ? (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* 投稿ボタン */}
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={isSubmitting || !spotName.trim()}
            activeOpacity={0.85}
            style={[s.submitWrap, { opacity: spotName.trim() ? 1 : 0.5 }]}
          >
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.submitBtn}>
              <Send size={18} color="#fff" strokeWidth={2} />
              <Text style={s.submitText}>{isSubmitting ? t.submitting : t.submit}</Text>
            </LinearGradient>
          </TouchableOpacity>

        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(167,139,250,0.2)',
    backgroundColor: BG,
  },
  backCircle: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDE9FE',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#1E0753' },

  // Scroll
  scroll:         { flex: 1 },
  scrollContent:  { padding: 20, gap: 16 },
  lead: { fontSize: 13, color: '#7C3AED', lineHeight: 20, backgroundColor: '#EDE9FE', borderRadius: 12, padding: 12 },

  // Card
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20,
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },

  // Form
  label:    { fontSize: 13, fontWeight: '800', color: '#1E0753', marginBottom: 8 },
  required: { color: '#F56CB3' },
  optional: { fontSize: 11, fontWeight: '400', color: '#A78BFA' },
  hint:     { fontSize: 12, color: '#A78BFA', lineHeight: 18, marginBottom: 10 },
  input: {
    height: 52, borderRadius: 14, backgroundColor: '#FAFAFF',
    borderWidth: 1.5, borderColor: '#DDD6FE',
    paddingHorizontal: 16, fontSize: 15, color: '#1E0753',
  },
  textarea: {
    borderRadius: 14, backgroundColor: '#FAFAFF',
    borderWidth: 1.5, borderColor: '#DDD6FE',
    padding: 14, fontSize: 15, color: '#1E0753',
    minHeight: 100, lineHeight: 22,
  },

  // Location
  locWrap: { marginBottom: 4, borderRadius: 14, overflow: 'hidden' },
  locBtn: { height: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  locBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  latText: { fontSize: 12, color: '#065F46', fontWeight: '700', marginTop: 6 },

  // Photos
  imagePicker: {
    height: 52, borderRadius: 14, borderWidth: 2, borderColor: '#DDD6FE',
    borderStyle: 'dashed', backgroundColor: '#FAFAFF',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  imagePickerText: { fontSize: 14, fontWeight: '700', color: '#A78BFA' },
  imageRow:  { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  imageThumb: { width: 90, height: 90, borderRadius: 14, borderWidth: 1.5, borderColor: '#DDD6FE' },

  // Tags
  tagToggle: {
    height: 44, borderRadius: 14, borderWidth: 1.5, borderColor: '#DDD6FE',
    backgroundColor: '#FAFAFF', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, marginBottom: 10,
  },
  tagToggleText: { fontSize: 14, fontWeight: '700', color: '#A78BFA' },
  tagRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  tagChip:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#EDE9FE', borderWidth: 1, borderColor: '#DDD6FE' },
  tagChipMood: { backgroundColor: '#FCE7F3', borderColor: '#FBCFE8' },
  tagChipText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  tagChipTextMood: { color: '#BE185D' },
  tagPicker: {
    borderWidth: 1.5, borderColor: '#DDD6FE', borderRadius: 14,
    padding: 14, backgroundColor: '#FAFAFF', marginBottom: 4,
  },

  // Error
  errorBox: {
    backgroundColor: '#FFF0F0', borderWidth: 1.5, borderColor: '#FECACA',
    borderRadius: 14, padding: 14,
  },
  errorText: { fontSize: 13, color: '#DC2626', fontWeight: '600' },

  // Submit
  submitWrap: {
    borderRadius: 18, overflow: 'hidden',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38, shadowRadius: 16, elevation: 8,
  },
  submitBtn: { height: 56, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitText: { fontSize: 17, fontWeight: '900', color: '#fff' },

  // Success
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successTitle: { fontSize: 26, fontWeight: '900', color: '#1E0753', marginBottom: 12, textAlign: 'center' },
  successBody: { fontSize: 15, lineHeight: 26, color: '#7C3AED', marginBottom: 28, textAlign: 'center' },
  successBtnWrap: { borderRadius: 18, overflow: 'hidden', shadowColor: '#C084FC', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  successBtn: { height: 52, paddingHorizontal: 40, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  successBtnText: { fontSize: 16, fontWeight: '900', color: '#fff' },
});
