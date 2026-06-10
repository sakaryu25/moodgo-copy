/**
 * SettingsView.tsx — 設定画面 (MoodGo UI統一)
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Check, ChevronRight, EyeOff, Globe, MapPin, Trash2, UserRound } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, Modal, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs, LinearGradient as SvgGrad, Stop, Text as SvgText,
} from 'react-native-svg';
import AppBackground from './AppBackground';
import { PREFECTURE_OPTIONS } from './PrefecturePicker';
import PuniPressable from './PuniPressable';

// ─── tokens ──────────────────────────────────────────────────────────────────
const PINK   = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE   = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const BG     = '#F5F0FF';
const { width: W } = Dimensions.get('window');

const AGE_OPTIONS_JA    = ['10代', '20代', '30代', '40代以上'];
const AGE_OPTIONS_EN    = ['10s', '20s', '30s', '40+'];
const GENDER_OPTIONS_JA = ['男性', '女性', 'その他', '答えたくない'];
const GENDER_OPTIONS_EN = ['Male', 'Female', 'Other', 'Prefer not to say'];

type Props = {
  visible: boolean;
  onClose: () => void;
  lang: 'ja' | 'en';
  onChangeLang: (v: 'ja' | 'en') => void;
  profileAge: string;
  profileGender: string;
  profilePrefecture: string;
  onSaveProfile: (age: string, gender: string, prefecture: string) => void;
  onClearHistory: () => void;
  blockedPlaces: string[];
  onUnblockPlace: (title: string) => void;
  onClearBlocked: () => void;
};

// ─── Logo ─────────────────────────────────────────────────────────────────────
function GradientLogo() {
  const fs = Math.round(W * 0.09);
  return (
    <Svg width={W * 0.5} height={fs * 1.5}>
      <Defs>
        <SvgGrad id="sg" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor={PINK}   />
          <Stop offset="48%"  stopColor={PURPLE}  />
          <Stop offset="100%" stopColor={BLUE}   />
        </SvgGrad>
      </Defs>
      <SvgText x="50%" y={fs} textAnchor="middle"
        fill="url(#sg)" fontSize={fs} fontWeight="800" letterSpacing={-0.5}>
        MoodGo
      </SvgText>
    </Svg>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────────
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pIn  = () => Animated.spring(scale, { toValue: 0.94, tension: 300, friction: 10, useNativeDriver: true }).start();
  const pOut = () => Animated.spring(scale, { toValue: 1,    tension: 300, friction: 10, useNativeDriver: true }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        onPress={onPress} onPressIn={pIn} onPressOut={pOut}
        activeOpacity={1}
        style={[s.chip, active && s.chipActive]}
      >
        {active && (
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill} />
        )}
        <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={s.sectionHeader}>
      {icon}
      <Text style={s.sectionLabel}>{label}</Text>
    </View>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SettingsView({
  visible, onClose, lang, onChangeLang,
  profileAge, profileGender, profilePrefecture, onSaveProfile, onClearHistory,
  blockedPlaces, onUnblockPlace, onClearBlocked,
}: Props) {
  const insets = useSafeAreaInsets();

  const ageOptions    = lang === 'ja' ? AGE_OPTIONS_JA    : AGE_OPTIONS_EN;
  const genderOptions = lang === 'ja' ? GENDER_OPTIONS_JA : GENDER_OPTIONS_EN;

  const [ageInput, setAgeInput]               = useState(profileAge);
  const [genderInput, setGenderInput]         = useState(profileGender);
  const [prefectureInput, setPrefectureInput] = useState(profilePrefecture);
  const [showPrefPicker, setShowPrefPicker]   = useState(false);
  const [saved, setSaved]                     = useState(false);

  useEffect(() => {
    if (visible) {
      setAgeInput(profileAge);
      setGenderInput(profileGender);
      setPrefectureInput(profilePrefecture);
      setSaved(false);
      setShowPrefPicker(false);
    }
  }, [visible, profileAge, profileGender, profilePrefecture]);

  const handleSave = () => {
    onSaveProfile(ageInput, genderInput, prefectureInput);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const handleClearHistory = () => {
    Alert.alert(
      lang === 'ja' ? '履歴を削除' : 'Clear history',
      lang === 'ja'
        ? 'これまでの検索履歴がすべて消えます。よろしいですか？'
        : 'All past search history will be deleted. Continue?',
      [
        { text: lang === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
        { text: lang === 'ja' ? '削除する' : 'Delete', style: 'destructive', onPress: onClearHistory },
      ]
    );
  };

  const handleClearBlocked = () => {
    Alert.alert(
      lang === 'ja' ? '非表示をすべて解除' : 'Unhide all',
      lang === 'ja'
        ? '非表示にしたスポットをすべて解除し、検索結果に再表示します。よろしいですか？'
        : 'All hidden spots will appear in search results again. Continue?',
      [
        { text: lang === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
        { text: lang === 'ja' ? 'すべて解除' : 'Unhide all', style: 'destructive', onPress: onClearBlocked },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[s.root, { paddingTop: insets.top || 20 }]}>
        <AppBackground />

        {/* ── Header ── */}
        <View style={s.header}>
          <GradientLogo />
          <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.7}>
            <Text style={s.closeBtnText}>{lang === 'ja' ? '完了' : 'Done'}</Text>
          </TouchableOpacity>
        </View>

        {showPrefPicker ? (
          /* ── Prefecture Picker ── */
          <View style={s.flex}>
            <View style={s.pickerHeader}>
              <TouchableOpacity onPress={() => setShowPrefPicker(false)} style={s.backCircle}>
                <Text style={s.backCircleText}>←</Text>
              </TouchableOpacity>
              <Text style={s.pickerTitle}>{lang === 'ja' ? '都道府県' : 'Prefecture'}</Text>
              <View style={{ width: 40 }} />
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32, paddingTop: 8 }}
            >
              {PREFECTURE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => { setPrefectureInput(opt); setShowPrefPicker(false); }}
                  style={[s.prefRow, prefectureInput === opt && s.prefRowActive]}
                  activeOpacity={0.72}
                >
                  {prefectureInput === opt && (
                    <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill} />
                  )}
                  <Text style={[s.prefText, prefectureInput === opt && s.prefTextActive]}>{opt}</Text>
                  {prefectureInput === opt && (
                    <Check size={16} color="#fff" strokeWidth={2.5} style={{ marginLeft: 'auto' }} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : (
          /* ── Main Settings ── */
          <ScrollView
            style={s.flex}
            contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* タイトル */}
            <Text style={s.pageTitle}>{lang === 'ja' ? '設定' : 'Settings'}</Text>

            {/* ── プロフィール ── */}
            <SectionHeader
              icon={<UserRound size={15} color={PURPLE} strokeWidth={2} />}
              label={lang === 'ja' ? 'プロフィール' : 'Profile'}
            />
            <View style={s.card}>
              {/* 年代 */}
              <Text style={s.fieldLabel}>{lang === 'ja' ? '年代' : 'Age group'}</Text>
              <View style={s.chipRow}>
                {ageOptions.map((opt) => (
                  <Chip key={opt} label={opt} active={ageInput === opt} onPress={() => setAgeInput(opt)} />
                ))}
              </View>

              {/* 性別 */}
              <Text style={[s.fieldLabel, { marginTop: 18 }]}>{lang === 'ja' ? '性別' : 'Gender'}</Text>
              <View style={s.chipRow}>
                {genderOptions.map((opt) => (
                  <Chip key={opt} label={opt} active={genderInput === opt} onPress={() => setGenderInput(opt)} />
                ))}
              </View>

              {/* 都道府県 */}
              <Text style={[s.fieldLabel, { marginTop: 18 }]}>{lang === 'ja' ? '都道府県' : 'Prefecture'}</Text>
              <TouchableOpacity onPress={() => setShowPrefPicker(true)} activeOpacity={0.8} style={s.prefBtn}>
                <MapPin size={16} color={prefectureInput ? PURPLE : '#A78BFA'} strokeWidth={2} />
                <Text style={[s.prefBtnText, prefectureInput && s.prefBtnTextFilled]}>
                  {prefectureInput || (lang === 'ja' ? '選択してください' : 'Select')}
                </Text>
                <ChevronRight size={15} color="#A78BFA" strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {/* 保存ボタン */}
            <PuniPressable onPress={handleSave} style={s.saveWrap}>
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.saveBtn}>
                {saved
                  ? <Check size={22} color="#fff" strokeWidth={2.5} />
                  : <Text style={s.saveBtnText}>{lang === 'ja' ? '保存する' : 'Save'}</Text>
                }
              </LinearGradient>
            </PuniPressable>

            {/* ── 言語 ── */}
            <SectionHeader
              icon={<Globe size={15} color={PURPLE} strokeWidth={2} />}
              label={lang === 'ja' ? '言語' : 'Language'}
            />
            <View style={s.card}>
              <View style={s.langRow}>
                {(['ja', 'en'] as const).map((l) => (
                  <TouchableOpacity
                    key={l}
                    onPress={() => onChangeLang(l)}
                    activeOpacity={0.8}
                    style={[s.langSegment, lang === l && s.langSegmentActive]}
                  >
                    {lang === l && (
                      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={StyleSheet.absoluteFill} />
                    )}
                    <Text style={[s.langSegmentText, lang === l && s.langSegmentTextActive]}>
                      {l === 'ja' ? '日本語' : 'English'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* ── 非表示にしたスポット ── */}
            <SectionHeader
              icon={<EyeOff size={15} color={PURPLE} strokeWidth={2} />}
              label={lang === 'ja' ? '非表示にしたスポット' : 'Hidden spots'}
            />
            <View style={s.card}>
              {blockedPlaces.length === 0 ? (
                <Text style={s.blockedEmpty}>
                  {lang === 'ja' ? '非表示にしたスポットはありません' : 'No hidden spots yet'}
                </Text>
              ) : (
                <>
                  {blockedPlaces.map((name, i) => (
                    <View
                      key={name}
                      style={[s.blockedRow, i < blockedPlaces.length - 1 && s.blockedRowBorder]}
                    >
                      <Text style={s.blockedName} numberOfLines={1}>{name}</Text>
                      <TouchableOpacity
                        onPress={() => onUnblockPlace(name)}
                        activeOpacity={0.7}
                        style={s.unblockBtn}
                      >
                        <Text style={s.unblockText}>{lang === 'ja' ? '解除' : 'Unhide'}</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity
                    onPress={handleClearBlocked}
                    style={[s.dangerRow, { marginTop: 14 }]}
                    activeOpacity={0.7}
                  >
                    <Text style={s.dangerText}>
                      {lang === 'ja' ? 'すべて解除' : 'Unhide all'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* ── データ ── */}
            <SectionHeader
              icon={<Trash2 size={15} color="#FF6B8A" strokeWidth={2} />}
              label={lang === 'ja' ? 'データ' : 'Data'}
            />
            <View style={s.card}>
              <TouchableOpacity onPress={handleClearHistory} style={s.dangerRow} activeOpacity={0.7}>
                <Text style={s.dangerText}>
                  {lang === 'ja' ? '履歴をすべてクリア' : 'Clear all history'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── バージョン ── */}
            <View style={s.versionRow}>
              <Text style={s.versionText}>MoodGo  v1.0.0</Text>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F1EF' },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(167,139,250,0.2)',
  },
  closeBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1.5, borderColor: '#DDD6FE',
    backgroundColor: '#fff',
  },
  closeBtnText: { fontSize: 14, fontWeight: '700', color: PURPLE },

  content: { paddingHorizontal: 20, paddingTop: 8 },
  pageTitle: {
    fontSize: 26, fontWeight: '900', color: '#1E0753',
    marginBottom: 20, marginTop: 8, letterSpacing: -0.5,
  },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 10, marginTop: 24,
  },
  sectionLabel: {
    fontSize: 13, fontWeight: '800', color: PURPLE, letterSpacing: 0.3,
  },

  card: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18,
    borderWidth: 1.5, borderColor: '#EDE9FE',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },

  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#7C3AED', marginBottom: 10, letterSpacing: 0.2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  chip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999,
    backgroundColor: '#FAFAFF', borderWidth: 1.5, borderColor: '#DDD6FE',
    overflow: 'hidden',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  chipActive:     { borderColor: 'transparent', shadowColor: PURPLE, shadowOpacity: 0.28, shadowRadius: 8, elevation: 4 },
  chipText:       { fontSize: 13, fontWeight: '600', color: '#374151' },
  chipTextActive: { color: '#fff', fontWeight: '800' },

  prefBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FAFAFF', borderRadius: 12, borderWidth: 1.5, borderColor: '#DDD6FE',
    paddingHorizontal: 14, paddingVertical: 12,
    marginTop: 4,
  },
  prefBtnText:       { flex: 1, fontSize: 14, color: '#C4B5FD', fontWeight: '500' },
  prefBtnTextFilled: { color: '#1E0753', fontWeight: '700' },

  saveWrap: {
    marginTop: 16, borderRadius: 16, overflow: 'hidden',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32, shadowRadius: 16, elevation: 8,
  },
  saveBtn: {
    height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 0.4 },

  langRow: {
    flexDirection: 'row', gap: 8,
  },
  langSegment: {
    flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#F3EEFF', borderWidth: 1.5, borderColor: '#DDD6FE',
  },
  langSegmentActive: { borderColor: 'transparent', shadowColor: PURPLE, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  langSegmentText:       { fontSize: 14, fontWeight: '700', color: '#9CA3AF' },
  langSegmentTextActive: { color: '#fff', fontWeight: '800' },

  dangerRow: {
    paddingVertical: 4, alignItems: 'center',
  },
  dangerText: { fontSize: 15, fontWeight: '700', color: '#FF6B8A' },

  blockedEmpty: {
    fontSize: 13, color: '#A78BFA', fontWeight: '500',
    textAlign: 'center', paddingVertical: 8,
  },
  blockedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, gap: 12,
  },
  blockedRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1ECFF' },
  blockedName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1E0753' },
  unblockBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    borderWidth: 1.5, borderColor: '#DDD6FE', backgroundColor: '#FAFAFF',
  },
  unblockText: { fontSize: 13, fontWeight: '700', color: PURPLE },

  versionRow: { alignItems: 'center', marginTop: 32 },
  versionText: { fontSize: 12, color: '#C4B5FD', fontWeight: '500' },

  // 都道府県ピッカー
  pickerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(167,139,250,0.2)',
  },
  backCircle: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDE9FE',
    alignItems: 'center', justifyContent: 'center',
  },
  backCircleText: { fontSize: 18, color: '#7C3AED', fontWeight: '700' },
  pickerTitle:    { fontSize: 16, fontWeight: '800', color: '#1E0753' },
  prefRow: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, overflow: 'hidden', paddingVertical: 14, paddingHorizontal: 18,
    backgroundColor: '#fff', marginBottom: 8,
    borderWidth: 1.5, borderColor: '#DDD6FE',
  },
  prefRowActive:  { borderColor: 'transparent' },
  prefText:       { fontSize: 15, fontWeight: '600', color: '#374151' },
  prefTextActive: { color: '#fff', fontWeight: '800' },
});
