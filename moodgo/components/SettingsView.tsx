/**
 * SettingsView.tsx — 設定画面 (MoodGo UI統一)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { Camera, Check, ChevronRight, EyeOff, FileText, Globe, Lock, Mail, MapPin, Navigation, ShieldCheck, Trash2, UserRound } from 'lucide-react-native';
import { router, type Href } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Image, Linking, Modal, ScrollView,
  StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs, LinearGradient as SvgGrad, Stop, Text as SvgText,
} from 'react-native-svg';
import { getDeviceId } from '@/lib/abtest';
import { useSettings, saveProfileExtras } from '@/lib/settingsStore';
import { apiFetch } from '@/lib/api';
import { FAVORITES_KEY, HISTORY_KEY, FEEDBACK_KEY, PENDING_VISITED_KEY, BLOCKED_PLACES_KEY, BLOCKED_USERS_KEY, PROFILE_KEY } from '@/lib/storage';
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

// トーク（グループ）のニックネームと同じキーで保存して同期させる
const NICKNAME_KEY  = 'moodgo-group-nickname';
// ユーザーID（@ハンドル）のローカルキャッシュ（真実はサーバーの user_handles）
const HANDLE_KEY    = 'moodgo-user-handle';
const USER_ICON_KEY = 'moodgo-user-icon';

const AGE_OPTIONS_JA    = ['10代', '20代', '30代', '40代以上'];
const AGE_OPTIONS_EN    = ['10s', '20s', '30s', '40+'];
const GENDER_OPTIONS_JA = ['男性', '女性', 'その他', '答えたくない'];
const GENDER_OPTIONS_EN = ['Male', 'Female', 'Other', 'Prefer not to say'];

type Props = {
  visible: boolean;
  onClose: () => void;
  section?: 'profile' | 'other';   // profile=プロフィール項目のみ / other=言語・位置情報・データ等 / 省略=全部
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
  visible, onClose, section, lang, onChangeLang,
  profileAge, profileGender, profilePrefecture, onSaveProfile, onClearHistory,
  blockedPlaces, onUnblockPlace, onClearBlocked,
}: Props) {
  const insets = useSafeAreaInsets();
  // section で表示を出し分け（profile=プロフィールだけ / other=それ以外だけ / 省略=全部）
  const showProfile = section !== 'other';
  const showOther   = section !== 'profile';

  const ageOptions    = lang === 'ja' ? AGE_OPTIONS_JA    : AGE_OPTIONS_EN;
  const genderOptions = lang === 'ja' ? GENDER_OPTIONS_JA : GENDER_OPTIONS_EN;

  const [ageInput, setAgeInput]               = useState(profileAge);
  const [genderInput, setGenderInput]         = useState(profileGender);
  const [prefectureInput, setPrefectureInput] = useState(profilePrefecture);
  // 一言メッセージ＋在住地の表示有無（自分の投稿ページ用・ストア直結）
  const storeSettings = useSettings();
  const [bioInput, setBioInput] = useState(storeSettings.profileBio);
  const [showPrefInput, setShowPrefInput] = useState(storeSettings.showPrefecture);
  const [showPrefPicker, setShowPrefPicker]   = useState(false);
  const [saved, setSaved]                     = useState(false);
  // アイコンと名前
  const [nameInput, setNameInput] = useState('');
  const [iconUrl, setIconUrl]     = useState('');
  const [iconBusy, setIconBusy]   = useState(false);
  // ユーザーID（@ハンドル）: 半角英数_のみ3〜20・小文字。一意性はサーバー(user_handles PK)が保証
  const [handleInput, setHandleInput]   = useState('');
  const [savedHandle, setSavedHandle]   = useState('');   // 現在確定しているID
  const [handleStatus, setHandleStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid' | 'same'>('idle');
  const [handleReason, setHandleReason] = useState('');
  const [handleLockDays, setHandleLockDays] = useState(0);   // >0 = 変更後14日ロック中の残り日数（入力不可）
  const handleCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 位置情報の許可状態
  const [locStatus, setLocStatus] = useState<Location.PermissionStatus | null>(null);
  const [locCanAsk, setLocCanAsk] = useState(true);
  // 写真ライブラリの許可状態
  const [photoStatus, setPhotoStatus] = useState<ImagePicker.PermissionStatus | null>(null);
  const [photoCanAsk, setPhotoCanAsk] = useState(true);

  useEffect(() => {
    if (visible) {
      setAgeInput(profileAge);
      setGenderInput(profileGender);
      setPrefectureInput(profilePrefecture);
      setBioInput(storeSettings.profileBio);
      setShowPrefInput(storeSettings.showPrefecture);
      setSaved(false);
      setShowPrefPicker(false);
      // 保存済みの名前・アイコンを読み込み
      AsyncStorage.getItem(NICKNAME_KEY).then(v => setNameInput(v ?? '')).catch(() => {});
      AsyncStorage.getItem(USER_ICON_KEY).then(v => setIconUrl(v ?? '')).catch(() => {});
      // ユーザーID: ローカルキャッシュ→サーバーの順で読込（サーバーが真実）
      setHandleStatus('idle'); setHandleReason('');
      AsyncStorage.getItem(HANDLE_KEY).then(v => { if (v) { setHandleInput(v); setSavedHandle(v); } }).catch(() => {});
      getDeviceId().then(id =>
        apiFetch('/api/user-handle', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get', deviceId: id }),
        }).then(r => r.json()).then(d => {
          if (d?.ok && typeof d.handle === 'string' && d.handle) {
            setHandleInput(d.handle); setSavedHandle(d.handle);
            AsyncStorage.setItem(HANDLE_KEY, d.handle).catch(() => {});
          }
          if (d?.ok && typeof d.daysLeft === 'number') setHandleLockDays(d.daysLeft);   // 変更ロックの残り日数
        }),
      ).catch(() => {});
      // 開くたびに最新の許可状態をチェック
      Location.getForegroundPermissionsAsync()
        .then(p => { setLocStatus(p.status); setLocCanAsk(p.canAskAgain); })
        .catch(() => {});
      ImagePicker.getMediaLibraryPermissionsAsync()
        .then(p => { setPhotoStatus(p.status); setPhotoCanAsk(p.canAskAgain); })
        .catch(() => {});
    }
  }, [visible, profileAge, profileGender, profilePrefecture]);

  // アイコン: 端末の写真を選んで512pxに縮小→アップロード（即時保存）
  const handlePickIcon = async () => {
    if (iconBusy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        lang === 'ja' ? '写真へのアクセスが必要です' : 'Photo access needed',
        lang === 'ja' ? '設定アプリからMoodGoに写真の許可をしてね' : 'Please allow photo access in the Settings app',
      );
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,   // 正方形に切り抜き
      aspect: [1, 1],
      quality: 0.9,
    });
    if (picked.canceled || !picked.assets?.length) return;
    setIconBusy(true);
    try {
      const small = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: 512 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      const deviceId = await getDeviceId();
      const res = await apiFetch('/api/user-icon', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, imageBase64: small.base64 }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? '設定に失敗しました');
      setIconUrl(data.icon);
      await AsyncStorage.setItem(USER_ICON_KEY, data.icon);
    } catch (e) {
      Alert.alert('エラー', e instanceof Error ? e.message : '設定に失敗しました');
    } finally { setIconBusy(false); }
  };

  const handleLocPermission = async () => {
    // 許可済み or 再確認不可（一度拒否）→ 設定アプリへ。未設定ならその場でOSダイアログ
    if (locStatus === 'granted' || (locStatus === 'denied' && !locCanAsk)) {
      Linking.openSettings();
      return;
    }
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      setLocStatus(p.status);
      setLocCanAsk(p.canAskAgain);
    } catch { /* noop */ }
  };

  const handlePhotoPermission = async () => {
    // 許可済み or 再確認不可（一度拒否）→ 設定アプリへ。未設定ならその場でOSダイアログ
    if (photoStatus === 'granted' || (photoStatus === 'denied' && !photoCanAsk)) {
      Linking.openSettings();
      return;
    }
    try {
      const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
      setPhotoStatus(p.status);
      setPhotoCanAsk(p.canAskAgain);
    } catch { /* noop */ }
  };

  // ── ユーザーID: 入力整形（小文字英数_のみ）＋500msデバウンスで空きチェック ──
  const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
  const onChangeHandle = (raw: string) => {
    const v = raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    setHandleInput(v);
    if (handleCheckTimer.current) clearTimeout(handleCheckTimer.current);
    if (!v) { setHandleStatus('idle'); setHandleReason(''); return; }
    if (v === savedHandle) { setHandleStatus('same'); setHandleReason(''); return; }
    if (!HANDLE_RE.test(v)) { setHandleStatus('invalid'); setHandleReason('3〜20文字・半角英数と_のみ'); return; }
    setHandleStatus('checking'); setHandleReason('');
    handleCheckTimer.current = setTimeout(async () => {
      try {
        const id = await getDeviceId();
        const res = await apiFetch('/api/user-handle', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check', handle: v, deviceId: id }),
        });
        const d = await res.json();
        if (d?.ok && d.available) { setHandleStatus('ok'); setHandleReason(''); }
        else { setHandleStatus('taken'); setHandleReason(d?.reason ?? d?.error ?? 'このIDはすでに使われています'); }
      } catch { setHandleStatus('idle'); }
    }, 500);
  };

  // 保存本体。ID変更の確認は handleSave（ラッパー）で先に行う。
  const doSave = async () => {
    onSaveProfile(ageInput, genderInput, prefectureInput);
    saveProfileExtras(bioInput.trim().slice(0, 40), showPrefInput);
    // 名前を保存（トークのニックネームと同期。参加中グループのメンバー名も更新）
    const name = nameInput.trim().slice(0, 20);
    AsyncStorage.setItem(NICKNAME_KEY, name).catch(() => {});
    if (name) {
      getDeviceId()
        .then(id => apiFetch('/api/mood-groups', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set_nickname', deviceId: id, nickname: name }),
        }))
        .catch(() => {});
    }
    // ユーザーIDの確定（変更がある時だけ）。一意性はサーバー(user_handles PK)が最終保証＝
    // 同時に同じIDを取ろうとしても片方は必ず「使われています」で失敗する。
    const h = handleInput.trim();
    if (h && h !== savedHandle) {
      if (!HANDLE_RE.test(h)) {
        Alert.alert('IDを確認してください', '3〜20文字・半角英数と_のみで入力してください');
        return;
      }
      try {
        const id = await getDeviceId();
        const res = await apiFetch('/api/user-handle', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'claim', deviceId: id, handle: h }),
        });
        const d = await res.json();
        if (!d?.ok) {
          if (d?.locked) {
            // 14日ロック中: 入力欄を無効化し残り日数を表示
            if (typeof d.daysLeft === 'number') setHandleLockDays(d.daysLeft);
            setHandleInput(savedHandle);   // 入力を確定IDへ戻す
            Alert.alert('IDは変更できません', d?.error ?? 'ID変更後14日間は再変更できません');
            return;
          }
          setHandleStatus(d?.taken ? 'taken' : 'invalid');
          setHandleReason(d?.error ?? 'このIDは使用できません');
          Alert.alert('IDを保存できませんでした', d?.error ?? 'このIDはすでに使われています');
          return;  // ID失敗時は✓を出さない（他項目は保存済み）
        }
        setSavedHandle(h);
        setHandleStatus('same'); setHandleReason('');
        if (typeof d.daysLeft === 'number') setHandleLockDays(d.daysLeft);   // 変更成功なら14日ロック開始
        AsyncStorage.setItem(HANDLE_KEY, h).catch(() => {});
      } catch {
        Alert.alert('通信エラー', 'IDを保存できませんでした。時間をおいて再度お試しください');
        return;
      }
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  // 保存の入口: ID「変更」（初回設定ではない）のときは2週間ロックの確認を挟む
  const handleSave = () => {
    const h = handleInput.trim();
    const isHandleChange = !!h && h !== savedHandle && !!savedHandle;
    if (isHandleChange) {
      Alert.alert(
        lang === 'ja' ? 'IDを変更しますか？' : 'Change your ID?',
        lang === 'ja'
          ? `@${savedHandle} → @${h}\n\n⚠️ 一度変更すると14日間（2週間）は再変更できません。`
          : `@${savedHandle} → @${h}\n\n⚠️ After changing, you can't change it again for 14 days.`,
        [
          { text: lang === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
          { text: lang === 'ja' ? '変更する' : 'Change', style: 'destructive', onPress: () => { void doSave(); } },
        ],
      );
      return;
    }
    void doSave();
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

  const handleDeleteAccount = () => {
    Alert.alert(
      lang === 'ja' ? 'データを削除' : 'Delete my data',
      lang === 'ja'
        ? '投稿したMoodログ・写真・評価・穴場投稿・グループの活動・お気に入り等をすべて削除します。\nこの操作は取り消せません。よろしいですか？'
        : 'This permanently deletes your Mood logs, photos, ratings, posts, group activity and favorites. This cannot be undone. Continue?',
      [
        { text: lang === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
        { text: lang === 'ja' ? '完全に削除' : 'Delete everything', style: 'destructive', onPress: async () => {
          // App Store 5.1.1(v): 削除の失敗を無音にしない（成功と偽らない）。監査2026-07-05対応。
          let serverOk = true;
          let localOk = true;
          try {
            const deviceId = await getDeviceId();
            const res = await apiFetch('/api/account-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId }) });
            serverOk = (await res.json().catch(() => null))?.ok === true;
          } catch { serverOk = false; }
          try {
            await AsyncStorage.multiRemove([
              NICKNAME_KEY, USER_ICON_KEY, FAVORITES_KEY, HISTORY_KEY, FEEDBACK_KEY,
              PENDING_VISITED_KEY, BLOCKED_PLACES_KEY, BLOCKED_USERS_KEY, PROFILE_KEY, HANDLE_KEY, 'moodgo-device-id',
            ]);
          } catch { localOk = false; }
          if (serverOk && localOk) {
            Alert.alert(
              lang === 'ja' ? '削除しました' : 'Deleted',
              lang === 'ja' ? 'あなたのデータを削除しました。ご利用ありがとうございました。' : 'Your data has been deleted.',
            );
          } else {
            Alert.alert(
              lang === 'ja' ? '一部削除できませんでした' : 'Partially deleted',
              lang === 'ja'
                ? (serverOk
                    ? '端末内データの一部を消去できませんでした。アプリを再起動して再度お試しください。'
                    : '通信エラーでサーバー上のデータを削除できませんでした。通信環境を確認して、もう一度お試しください。')
                : 'Some data could not be deleted. Please check your connection and try again.',
            );
          }
          onClose();
        } },
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
            <Text style={s.pageTitle}>
              {section === 'profile'
                ? (lang === 'ja' ? 'プロフィールを編集' : 'Edit Profile')
                : (lang === 'ja' ? '設定' : 'Settings')}
            </Text>

            {/* ── プロフィール（section='other'の時は隠す）── */}
            {showProfile && (<>
            <SectionHeader
              icon={<UserRound size={15} color={PURPLE} strokeWidth={2} />}
              label={lang === 'ja' ? 'プロフィール' : 'Profile'}
            />
            <View style={s.card}>
              {/* アイコン（タップで写真を設定） */}
              <View style={{ alignItems: 'center', marginBottom: 16 }}>
                <PuniPressable onPress={handlePickIcon} disabled={iconBusy} style={s.avatarWrap}>
                  {iconUrl ? (
                    <Image source={{ uri: iconUrl }} style={s.avatarImg} />
                  ) : (
                    <View style={[s.avatarImg, s.avatarPh]}>
                      <UserRound size={36} color={PURPLE} strokeWidth={1.8} />
                    </View>
                  )}
                  {iconBusy ? (
                    <View style={s.avatarBusy}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  ) : (
                    <View style={s.avatarBadge}>
                      <Camera size={12} color="#fff" strokeWidth={2.5} />
                    </View>
                  )}
                </PuniPressable>
                <Text style={s.avatarHint}>
                  {lang === 'ja' ? 'タップして写真を設定' : 'Tap to set a photo'}
                </Text>
              </View>

              {/* 名前 */}
              <Text style={s.fieldLabel}>{lang === 'ja' ? '名前（ニックネーム）' : 'Name'}</Text>
              <TextInput
                value={nameInput}
                onChangeText={setNameInput}
                placeholder={lang === 'ja' ? '例: りゅうき' : 'e.g. Ryuki'}
                placeholderTextColor="#C4B5FD"
                style={s.nameInput}
                maxLength={20}
              />
              <Text style={s.nameHint}>
                {lang === 'ja' ? 'トーク（グループ）で表示される名前です' : 'Shown in group talks'}
              </Text>

              {/* ユーザーID（@ハンドル・全ユーザーで一意） */}
              <Text style={[s.fieldLabel, { marginTop: 18 }]}>{lang === 'ja' ? 'ユーザーID' : 'User ID'}</Text>
              <View style={[s.handleRow, handleLockDays > 0 && s.handleRowLocked]}>
                <Text style={s.handleAt}>@</Text>
                <TextInput
                  value={handleInput}
                  onChangeText={onChangeHandle}
                  placeholder={lang === 'ja' ? '例: ryuki_25' : 'e.g. ryuki_25'}
                  placeholderTextColor="#C4B5FD"
                  style={s.handleInput}
                  maxLength={20}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="ascii-capable"
                  editable={handleLockDays === 0}   // 変更後14日はロック
                />
                {handleLockDays > 0 && <Lock size={15} color="#A78BFA" strokeWidth={2.2} />}
                {handleLockDays === 0 && handleStatus === 'checking' && <ActivityIndicator size="small" color={PURPLE} />}
                {handleLockDays === 0 && handleStatus === 'ok'   && <Check size={18} color="#22C55E" strokeWidth={2.6} />}
                {handleLockDays === 0 && (handleStatus === 'taken' || handleStatus === 'invalid') && (
                  <Text style={s.handleNg}>✕</Text>
                )}
              </View>
              {handleLockDays > 0 ? (
                // ロック中: 残り日数を表示
                <Text style={[s.nameHint, { color: '#7C3AED', fontWeight: '700' }]}>
                  {lang === 'ja'
                    ? `🔒 IDは変更後14日間ロックされます。あと${handleLockDays}日で再変更できます`
                    : `🔒 Locked for 14 days after a change. ${handleLockDays} day(s) left`}
                </Text>
              ) : (
                <>
                  <Text style={[
                    s.nameHint,
                    handleStatus === 'ok' && { color: '#16A34A' },
                    (handleStatus === 'taken' || handleStatus === 'invalid') && { color: '#DC2626' },
                  ]}>
                    {handleStatus === 'ok' ? (lang === 'ja' ? 'このIDは利用できます' : 'Available')
                      : (handleStatus === 'taken' || handleStatus === 'invalid') ? (handleReason || (lang === 'ja' ? 'このIDはすでに使われています' : 'Already taken'))
                      : (lang === 'ja' ? 'あなただけのID。3〜20文字・半角英数と_（他の人と同じIDは使えません）' : '3-20 chars, a-z 0-9 _ (must be unique)')}
                  </Text>
                  {/* 既にIDを持つ人には「変更すると2週間ロック」を控えめに常時表示 */}
                  {!!savedHandle && (
                    <Text style={s.handleLockWarn}>
                      {lang === 'ja' ? '⚠️ IDは一度変更すると2週間（14日）は再変更できません' : '⚠️ Once changed, you can\'t change it again for 14 days'}
                    </Text>
                  )}
                </>
              )}

              {/* 年代 */}
              <Text style={[s.fieldLabel, { marginTop: 18 }]}>{lang === 'ja' ? '年代' : 'Age group'}</Text>
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

              {/* 在住地の表示有無（自分の投稿ページの「◯◯在住」）*/}
              <View style={s.togglePrefRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.togglePrefLabel}>{lang === 'ja' ? '在住地を表示' : 'Show prefecture'}</Text>
                  <Text style={s.togglePrefHint}>
                    {lang === 'ja' ? '自分の投稿ページに「◯◯在住」を表示します' : 'Shows "Lives in ..." on your posts page'}
                  </Text>
                </View>
                <Switch
                  value={showPrefInput}
                  onValueChange={setShowPrefInput}
                  trackColor={{ false: '#E4E0EE', true: '#C4B5FD' }}
                  thumbColor={showPrefInput ? PURPLE : '#f4f3f4'}
                />
              </View>

              {/* 一言メッセージ */}
              <Text style={[s.fieldLabel, { marginTop: 18 }]}>{lang === 'ja' ? '一言メッセージ' : 'Bio'}</Text>
              <TextInput
                value={bioInput}
                onChangeText={setBioInput}
                placeholder={lang === 'ja' ? '例: 日本中の穴場スポットを探しています。' : 'e.g. Exploring hidden gems across Japan.'}
                placeholderTextColor="#C4B5FD"
                style={s.nameInput}
                maxLength={40}
              />
              <Text style={s.nameHint}>
                {lang === 'ja' ? '自分の投稿ページの名前の下に表示されます（40文字まで）' : 'Shown under your name on the posts page (max 40)'}
              </Text>
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
            </>)}

            {/* ── 言語以降（section='profile'の時は隠す）── */}
            {showOther && (<>
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

            {/* ── 位置情報 ── */}
            <SectionHeader
              icon={<Navigation size={15} color={PURPLE} strokeWidth={2} />}
              label={lang === 'ja' ? '位置情報' : 'Location'}
            />
            <View style={s.card}>
              <View style={s.locStatusRow}>
                <View style={[s.locDot, {
                  backgroundColor:
                    locStatus === 'granted' ? '#10B981' :
                    locStatus === 'denied'  ? '#EF4444' : '#F59E0B',
                }]} />
                <Text style={s.locStatusText}>
                  {locStatus === 'granted'
                    ? (lang === 'ja' ? '許可されています' : 'Allowed')
                    : locStatus === 'denied'
                      ? (lang === 'ja' ? '許可されていません' : 'Not allowed')
                      : (lang === 'ja' ? '未設定' : 'Not set')}
                </Text>
              </View>
              <Text style={s.locHint}>
                {lang === 'ja'
                  ? '現在地から近くのスポットを探すために使います'
                  : 'Used to find spots near your current location.'}
              </Text>
              <PuniPressable onPress={handleLocPermission} style={s.locBtn}>
                <Text style={s.locBtnText}>
                  {locStatus === 'granted'
                    ? (lang === 'ja' ? '設定アプリで変更する' : 'Change in Settings app')
                    : locStatus === 'denied' && !locCanAsk
                      ? (lang === 'ja' ? '設定アプリで許可する' : 'Allow in Settings app')
                      : (lang === 'ja' ? '位置情報を許可する' : 'Allow location access')}
                </Text>
              </PuniPressable>
            </View>

            {/* ── 写真 ── */}
            <SectionHeader
              icon={<Camera size={15} color={PURPLE} strokeWidth={2} />}
              label={lang === 'ja' ? '写真' : 'Photos'}
            />
            <View style={s.card}>
              <View style={s.locStatusRow}>
                <View style={[s.locDot, {
                  backgroundColor:
                    photoStatus === 'granted' ? '#10B981' :
                    photoStatus === 'denied'  ? '#EF4444' : '#F59E0B',
                }]} />
                <Text style={s.locStatusText}>
                  {photoStatus === 'granted'
                    ? (lang === 'ja' ? '許可されています' : 'Allowed')
                    : photoStatus === 'denied'
                      ? (lang === 'ja' ? '許可されていません' : 'Not allowed')
                      : (lang === 'ja' ? '未設定' : 'Not set')}
                </Text>
              </View>
              <Text style={s.locHint}>
                {lang === 'ja'
                  ? 'アイコンやスポットの写真を投稿するときに使います'
                  : 'Used when you post an icon or spot photos.'}
              </Text>
              <PuniPressable onPress={handlePhotoPermission} style={s.locBtn}>
                <Text style={s.locBtnText}>
                  {photoStatus === 'granted'
                    ? (lang === 'ja' ? '設定アプリで変更する' : 'Change in Settings app')
                    : photoStatus === 'denied' && !photoCanAsk
                      ? (lang === 'ja' ? '設定アプリで許可する' : 'Allow in Settings app')
                      : (lang === 'ja' ? '写真へのアクセスを許可する' : 'Allow photo access')}
                </Text>
              </PuniPressable>
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
              <TouchableOpacity onPress={handleClearHistory} style={[s.dangerRow, s.linkRowBorder]} activeOpacity={0.7}>
                <Text style={s.dangerText}>
                  {lang === 'ja' ? '履歴をすべてクリア' : 'Clear all history'}
                </Text>
              </TouchableOpacity>
              {/* App Store 5.1.1(v): アプリ内からアカウント/データ削除を開始できること */}
              <TouchableOpacity onPress={handleDeleteAccount} style={s.dangerRow} activeOpacity={0.7}>
                <Text style={[s.dangerText, { fontWeight: '800' }]}>
                  {lang === 'ja' ? 'アカウント・投稿データを削除' : 'Delete account & data'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── 規約・サポート ── */}
            <SectionHeader
              icon={<FileText size={15} color={PURPLE} strokeWidth={2} />}
              label={lang === 'ja' ? '規約・サポート' : 'Legal & Support'}
            />
            <View style={s.card}>
              <TouchableOpacity onPress={() => { onClose(); router.push('/privacy' as Href); }} style={[s.linkRow, s.linkRowBorder]} activeOpacity={0.7}>
                <ShieldCheck size={17} color={PURPLE} strokeWidth={2} />
                <Text style={s.linkRowText}>{lang === 'ja' ? 'プライバシーポリシー' : 'Privacy Policy'}</Text>
                <ChevronRight size={16} color="#C4B5FD" strokeWidth={2} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { onClose(); router.push('/terms' as Href); }} style={[s.linkRow, s.linkRowBorder]} activeOpacity={0.7}>
                <FileText size={17} color={PURPLE} strokeWidth={2} />
                <Text style={s.linkRowText}>{lang === 'ja' ? '利用規約' : 'Terms of Service'}</Text>
                <ChevronRight size={16} color="#C4B5FD" strokeWidth={2} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { onClose(); router.push('/contact' as Href); }} style={s.linkRow} activeOpacity={0.7}>
                <Mail size={17} color={PURPLE} strokeWidth={2} />
                <Text style={s.linkRowText}>{lang === 'ja' ? 'お問い合わせ' : 'Contact'}</Text>
                <ChevronRight size={16} color="#C4B5FD" strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {/* ── バージョン ── */}
            <View style={s.versionRow}>
              <Text style={s.versionText}>MoodGo  v1.0.0</Text>
              {/* OSMデータのライセンス帰属（ODbL）。スポット情報の一部は OpenStreetMap 由来 */}
              <Text style={s.attributionText}>
                {lang === 'ja'
                  ? 'スポット情報の一部に © OpenStreetMap contributors のデータを利用しています'
                  : 'Some place data © OpenStreetMap contributors'}
              </Text>
            </View>
            </>)}
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

  // アイコンと名前
  avatarWrap: { width: 88, height: 88 },
  avatarImg:  { width: 88, height: 88, borderRadius: 44 },
  avatarPh: {
    backgroundColor: '#F3EEFF', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#DDD6FE',
  },
  avatarBusy: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 44, backgroundColor: 'rgba(30,7,83,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute', right: 0, bottom: 0,
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#7C3AED',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  avatarHint: { fontSize: 10, color: '#A78BFA', marginTop: 7 },
  nameInput: {
    height: 48, borderRadius: 12,
    backgroundColor: '#FAFAFF', borderWidth: 1.5, borderColor: '#DDD6FE',
    paddingHorizontal: 14, fontSize: 14, fontWeight: '600', color: '#1E0753',
  },
  nameHint: { fontSize: 10, color: '#A78BFA', marginTop: 6 },
  // ユーザーID入力（@固定プレフィックス＋状態アイコン）
  handleRow: {
    height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FAFAFF', borderWidth: 1.5, borderColor: '#DDD6FE', paddingHorizontal: 14,
  },
  handleRowLocked: { backgroundColor: '#F3F0FA', borderColor: '#E5DEF7' },   // 変更ロック中は淡くグレーアウト
  handleAt: { fontSize: 15, fontWeight: '800', color: '#A78BFA' },
  handleInput: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1E0753', paddingVertical: 0 },
  handleNg: { fontSize: 15, fontWeight: '900', color: '#DC2626' },
  handleLockWarn: { fontSize: 10.5, color: '#B0A0D8', marginTop: 4, fontWeight: '600' },
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
  togglePrefRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16,
    paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(155,107,255,0.1)',
  },
  togglePrefLabel: { fontSize: 13.5, fontWeight: '700', color: '#3B2A63' },
  togglePrefHint: { fontSize: 11, color: '#8B7BB8', marginTop: 2 },
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

  // 位置情報
  locStatusRow:  { flexDirection: 'row', alignItems: 'center', gap: 7 },
  locDot:        { width: 9, height: 9, borderRadius: 4.5 },
  locStatusText: { fontSize: 14, fontWeight: '800', color: '#1E0753' },
  locHint:       { fontSize: 11, color: '#A78BFA', marginTop: 6, lineHeight: 16 },
  locBtn: {
    marginTop: 12, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F3EEFF', borderWidth: 1.5, borderColor: '#DDD6FE',
  },
  locBtnText: { fontSize: 13, fontWeight: '800', color: '#7C3AED' },

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

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  linkRowBorder: { borderBottomWidth: 1, borderBottomColor: '#F1ECFF' },
  linkRowText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1E0753' },

  versionRow: { alignItems: 'center', marginTop: 32 },
  versionText: { fontSize: 12, color: '#C4B5FD', fontWeight: '500' },
  attributionText: { fontSize: 10, color: '#C4B5FD', fontWeight: '400', marginTop: 8, textAlign: 'center', paddingHorizontal: 24, lineHeight: 15 },

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
