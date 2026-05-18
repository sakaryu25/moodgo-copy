import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AGE_OPTIONS    = ['10代', '20代', '30代', '40代', '50代', '60代以上'];
const GENDER_OPTIONS = ['男性', '女性', 'その他', '答えたくない'];

type Props = {
  visible: boolean;
  onClose: () => void;
  lang: 'ja' | 'en';
  onChangeLang: (v: 'ja' | 'en') => void;
  profileAge: string;
  profileGender: string;
  onSaveProfile: (age: string, gender: string) => void;
  onClearHistory: () => void;
};

const T = {
  ja: {
    title: '設定',
    done: '完了',
    sectionDisplay: '表示',
    language: '言語',
    sectionProfile: 'プロフィール',
    ageLabel: '年代',
    genderLabel: '性別',
    saveProfile: '保存する',
    sectionData: 'データ',
    clearHistory: '履歴をすべてクリア',
    clearConfirmTitle: '履歴を削除',
    clearConfirmMsg: 'これまでの検索履歴がすべて消えます。よろしいですか？',
    clearConfirmOk: '削除する',
    clearConfirmCancel: 'キャンセル',
    sectionAbout: 'このアプリについて',
    version: 'バージョン',
    versionVal: '1.0.0',
  },
  en: {
    title: 'Settings',
    done: 'Done',
    sectionDisplay: 'Display',
    language: 'Language',
    sectionProfile: 'Profile',
    ageLabel: 'Age group',
    genderLabel: 'Gender',
    saveProfile: 'Save',
    sectionData: 'Data',
    clearHistory: 'Clear all history',
    clearConfirmTitle: 'Clear history',
    clearConfirmMsg: 'All past search history will be deleted. Continue?',
    clearConfirmOk: 'Delete',
    clearConfirmCancel: 'Cancel',
    sectionAbout: 'About',
    version: 'Version',
    versionVal: '1.0.0',
  },
} as const;

export default function SettingsView({
  visible, onClose, lang, onChangeLang,
  profileAge, profileGender, onSaveProfile, onClearHistory,
}: Props) {
  const insets = useSafeAreaInsets();
  const t = T[lang];

  const [ageInput, setAgeInput] = useState(profileAge);
  const [genderInput, setGenderInput] = useState(profileGender);

  useEffect(() => {
    if (visible) {
      setAgeInput(profileAge);
      setGenderInput(profileGender);
    }
  }, [visible, profileAge, profileGender]);

  const handleClearHistory = () => {
    Alert.alert(t.clearConfirmTitle, t.clearConfirmMsg, [
      { text: t.clearConfirmCancel, style: 'cancel' },
      { text: t.clearConfirmOk, style: 'destructive', onPress: onClearHistory },
    ]);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[s.root, { paddingTop: insets.top || 20 }]}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>{t.title}</Text>
          <TouchableOpacity onPress={() => { onSaveProfile(ageInput, genderInput); onClose(); }} style={s.doneBtn}>
            <Text style={s.doneBtnText}>{t.done}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Display ── */}
          <Text style={s.sectionLabel}>{t.sectionDisplay}</Text>
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t.language}</Text>
              <View style={s.segmented}>
                {(['ja', 'en'] as const).map((l) => (
                  <TouchableOpacity
                    key={l}
                    onPress={() => onChangeLang(l)}
                    style={[s.segment, lang === l && s.segmentActive]}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.segmentText, lang === l && s.segmentTextActive]}>
                      {l === 'ja' ? '日本語' : 'English'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {/* ── Profile ── */}
          <Text style={s.sectionLabel}>{t.sectionProfile}</Text>
          <View style={s.card}>
            <View style={[s.row, s.rowBorder]}>
              <Text style={s.rowLabel}>{t.ageLabel}</Text>
            </View>
            <View style={s.optionGrid}>
              {AGE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => setAgeInput(opt)}
                  style={[s.optionChip, ageInput === opt && s.optionChipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[s.optionChipText, ageInput === opt && s.optionChipTextActive]}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={[s.row, s.rowBorder, { marginTop: 4 }]}>
              <Text style={s.rowLabel}>{t.genderLabel}</Text>
            </View>
            <View style={s.optionGrid}>
              {GENDER_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => setGenderInput(opt)}
                  style={[s.optionChip, genderInput === opt && s.optionChipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[s.optionChipText, genderInput === opt && s.optionChipTextActive]}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <TouchableOpacity
            onPress={() => onSaveProfile(ageInput, genderInput)}
            style={s.saveBtn}
            activeOpacity={0.8}
          >
            <Text style={s.saveBtnText}>{t.saveProfile}</Text>
          </TouchableOpacity>

          {/* ── Data ── */}
          <Text style={s.sectionLabel}>{t.sectionData}</Text>
          <View style={s.card}>
            <TouchableOpacity onPress={handleClearHistory} style={s.row} activeOpacity={0.7}>
              <Text style={s.destructiveText}>{t.clearHistory}</Text>
            </TouchableOpacity>
          </View>

          {/* ── About ── */}
          <Text style={s.sectionLabel}>{t.sectionAbout}</Text>
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t.version}</Text>
              <Text style={s.rowValue}>{t.versionVal}</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2F2F7' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: '#F2F2F7',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.12)',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#000' },
  doneBtn: { paddingVertical: 4, paddingHorizontal: 2 },
  doneBtnText: { fontSize: 17, fontWeight: '600', color: '#FF6B35' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 24, gap: 0 },
  sectionLabel: {
    fontSize: 13, fontWeight: '500', color: '#8E8E93',
    textTransform: 'uppercase', letterSpacing: 0.4,
    paddingHorizontal: 4, marginBottom: 6, marginTop: 24,
  },
  card: {
    backgroundColor: '#fff', borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 13, minHeight: 48,
  },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  rowLabel: { fontSize: 16, color: '#000', fontWeight: '400' },
  rowValue: { fontSize: 16, color: '#8E8E93' },

  // Option grid (age / gender)
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 },
  optionChip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#F2F2F7', borderWidth: 1, borderColor: '#E5E5EA',
  },
  optionChipActive: { backgroundColor: '#FF6B3515', borderColor: '#FF6B35' },
  optionChipText: { fontSize: 14, fontWeight: '500', color: '#3C3C43' },
  optionChipTextActive: { color: '#FF6B35', fontWeight: '600' },

  // Language segmented control
  segmented: {
    flexDirection: 'row', backgroundColor: '#E5E5EA', borderRadius: 8, padding: 2, gap: 2,
  },
  segment: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6,
  },
  segmentActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 },
  segmentText: { fontSize: 14, fontWeight: '500', color: '#8E8E93' },
  segmentTextActive: { color: '#000', fontWeight: '600' },

  saveBtn: {
    marginTop: 10, backgroundColor: '#FF6B35', borderRadius: 10, paddingVertical: 13,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  destructiveText: { fontSize: 16, color: '#FF3B30', fontWeight: '400' },
});
