/**
 * ProfileSetup.tsx — 初回起動セットアップ画面 (MoodGo UI統一)
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Check, ChevronRight, MapPin, UserRound, X } from 'lucide-react-native';
import React, { useRef, useEffect, useState } from 'react';
import {
  ActivityIndicator, Animated, Dimensions, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs, LinearGradient as SvgGrad, Stop, Text as SvgText,
} from 'react-native-svg';
import { PREFECTURE_OPTIONS } from './PrefecturePicker';
import { getDeviceId } from '@/lib/abtest';
import { apiFetch } from '@/lib/api';
import { saveHandle } from '@/lib/settingsStore';
import IMESafeTextInput from '@/components/IMESafeTextInput';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;   // 半角英数と_ のみ・3〜20文字（/api/user-handle と一致）

// ─── tokens ──────────────────────────────────────────────────────────────────
const PINK   = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE   = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const BG     = '#F5F0FF';
const { width: W } = Dimensions.get('window');

const AGE_OPTIONS    = ['10代', '20代', '30代', '40代以上'];
const GENDER_OPTIONS = ['男性', '女性', 'その他', '答えたくない'];

type Props = {
  onDone: (age: string, gender: string, prefecture: string) => void;
};

// ─── Logo ─────────────────────────────────────────────────────────────────────
function GradientLogo() {
  const fs = Math.round(W * 0.13);
  return (
    <Svg width={W * 0.7} height={fs * 1.5}>
      <Defs>
        <SvgGrad id="pg" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor={PINK}   />
          <Stop offset="48%"  stopColor={PURPLE}  />
          <Stop offset="100%" stopColor={BLUE}   />
        </SvgGrad>
      </Defs>
      <SvgText x="50%" y={fs} textAnchor="middle"
        fill="url(#pg)" fontSize={fs} fontWeight="800" letterSpacing={-0.5}>
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

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ProfileSetup({ onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [age, setAge]               = useState('');
  const [gender, setGender]         = useState('');
  const [prefecture, setPrefecture] = useState('');
  const [showPrefPicker, setShowPrefPicker] = useState(false);

  // ── ユーザーID（@ハンドル）＝必須。空きチェック(check)→取得(claim)まで通らないと開始不可 ──
  const [handle, setHandle]             = useState('');
  const [handleStatus, setHandleStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [handleReason, setHandleReason] = useState('');
  const [claiming, setClaiming]         = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChangeHandle = (raw: string) => {
    const v = raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);   // 半角英数と_ のみに整形
    setHandle(v);
    if (checkTimer.current) clearTimeout(checkTimer.current);
    if (!v) { setHandleStatus('idle'); setHandleReason(''); return; }
    if (!HANDLE_RE.test(v)) { setHandleStatus('invalid'); setHandleReason('3〜20文字・半角英数と_のみ'); return; }
    setHandleStatus('checking'); setHandleReason('');
    checkTimer.current = setTimeout(async () => {   // 500msデバウンスで空きチェック
      try {
        const id = await getDeviceId();
        const res = await apiFetch('/api/user-handle', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check', handle: v, deviceId: id }),
        });
        const d = await res.json();
        if (d?.ok && d.available) { setHandleStatus('ok'); setHandleReason(''); }
        else { setHandleStatus('taken'); setHandleReason(d?.reason ?? d?.error ?? 'このIDはすでに使われています'); }
      } catch { setHandleStatus('idle'); setHandleReason('通信に失敗しました'); }
    }, 500);
  };

  const finish = async () => {
    if (handleStatus !== 'ok' || claiming) return;
    const h = handle.trim();
    if (!HANDLE_RE.test(h)) { setHandleStatus('invalid'); setHandleReason('3〜20文字・半角英数と_のみ'); return; }
    setClaiming(true);
    try {
      const id = await getDeviceId();
      const res = await apiFetch('/api/user-handle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim', deviceId: id, handle: h }),
      });
      const d = await res.json();
      if (!d?.ok) {   // 取得失敗（重複/形式）＝開始させない
        setHandleStatus(d?.taken ? 'taken' : 'invalid');
        setHandleReason(d?.error ?? '取得できませんでした。別のIDにしてください');
        setClaiming(false);
        return;
      }
      saveHandle(h);                       // ストア＋AsyncStorageへ即時反映（@IDが全画面に出る）
      onDone(age, gender, prefecture);     // 取得成功後にだけ初回セットアップを完了させる
    } catch {
      setHandleReason('通信に失敗しました。もう一度お試しください');
      setClaiming(false);
    }
  };
  const canStart = handleStatus === 'ok' && !claiming;

  // フェードイン
  const fade  = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(30)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade,   { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideY, { toValue: 0, tension: 140, friction: 22, useNativeDriver: true }),
    ]).start();
  }, []);

  // 都道府県ピッカー画面
  if (showPrefPicker) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.pickerHeader}>
          <TouchableOpacity onPress={() => setShowPrefPicker(false)} style={s.backCircle}>
            <Text style={s.backCircleText}>←</Text>
          </TouchableOpacity>
          <Text style={s.pickerTitle}>都道府県</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32, paddingTop: 8 }}>
          {PREFECTURE_OPTIONS.map((opt) => (
            <TouchableOpacity key={opt}
              onPress={() => { setPrefecture(opt); setShowPrefPicker(false); }}
              style={[s.prefRow, prefecture === opt && s.prefRowActive]}
              activeOpacity={0.72}>
              {prefecture === opt && (
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill} />
              )}
              <Text style={[s.prefText, prefecture === opt && s.prefTextActive]}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Animated.View style={[s.flex, { opacity: fade, transform: [{ translateY: slideY }] }]}>
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ロゴ */}
          <View style={s.logoWrap}>
            <GradientLogo />
          </View>

          {/* アイコン + タイトル */}
          <View style={s.iconWrap}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.iconCircle}>
              <UserRound size={32} color="#fff" strokeWidth={1.8} />
            </LinearGradient>
          </View>
          <Text style={s.title}>はじめる前に教えてください</Text>
          <Text style={s.subtitle}>まずはあなたのIDを決めましょう。{'\n'}年代などは提案の参考に使います（あとで変更可）。</Text>

          {/* ユーザーID（必須・最初に決める） */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>ユーザーID（必須）</Text>
            <View style={[s.handleRow, handleStatus === 'ok' && s.handleRowOk, (handleStatus === 'taken' || handleStatus === 'invalid') && s.handleRowBad]}>
              <Text style={s.handleAt}>@</Text>
              <IMESafeTextInput
                value={handle}
                onChangeText={onChangeHandle}
                placeholder="eiga_suki"
                placeholderTextColor="#C4B5FD"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                maxLength={20}
                style={s.handleInput}
              />
              {handleStatus === 'checking' && <ActivityIndicator size="small" color={PURPLE} />}
              {handleStatus === 'ok' && <Check size={18} color="#10B981" strokeWidth={2.6} />}
              {(handleStatus === 'taken' || handleStatus === 'invalid') && <X size={18} color="#EF4444" strokeWidth={2.6} />}
            </View>
            <Text style={[s.handleHint, (handleStatus === 'taken' || handleStatus === 'invalid') && s.handleHintBad]}>
              {handleReason || '半角英数と_・3〜20文字。プロフィールに表示され、あとから変更できます'}
            </Text>
          </View>

          {/* 年代 */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>年代</Text>
            <View style={s.chipRow}>
              {AGE_OPTIONS.map((opt) => (
                <Chip key={opt} label={opt} active={age === opt} onPress={() => setAge(opt)} />
              ))}
            </View>
          </View>

          {/* 性別 */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>性別</Text>
            <View style={s.chipRow}>
              {GENDER_OPTIONS.map((opt) => (
                <Chip key={opt} label={opt} active={gender === opt} onPress={() => setGender(opt)} />
              ))}
            </View>
          </View>

          {/* 都道府県 */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>都道府県</Text>
            <TouchableOpacity onPress={() => setShowPrefPicker(true)} activeOpacity={0.8} style={s.prefBtn}>
              <MapPin size={18} color={prefecture ? PURPLE : '#A78BFA'} strokeWidth={2} />
              <Text style={[s.prefBtnText, prefecture && s.prefBtnTextFilled]}>
                {prefecture || '選択してください'}
              </Text>
              <ChevronRight size={16} color="#A78BFA" strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {/* はじめるボタン（@IDの取得が済むまで無効） */}
          <TouchableOpacity
            onPress={finish}
            activeOpacity={0.88}
            disabled={!canStart}
            style={[s.startWrap, !canStart && s.startWrapDisabled]}
          >
            <LinearGradient colors={canStart ? GRAD : ['#D8CEF2', '#D0C6EE', '#CBD6F2']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.startBtn}>
              {claiming ? <ActivityIndicator color="#fff" /> : <Text style={s.startText}>はじめる</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: 'transparent' },
  flex:    { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 16, alignItems: 'center' },

  logoWrap: { marginBottom: 8 },
  iconWrap: { marginBottom: 16 },
  iconCircle: {
    width: 72, height: 72, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 16, elevation: 8,
  },

  title:    { fontSize: 22, fontWeight: '900', color: '#1E0753', textAlign: 'center', marginBottom: 10, letterSpacing: -0.4 },
  subtitle: { fontSize: 13, color: '#A78BFA', textAlign: 'center', lineHeight: 20, marginBottom: 8 },

  section:      { width: '100%', marginTop: 24 },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: '#7C3AED', marginBottom: 12, letterSpacing: 0.3 },
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  chip: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#DDD6FE',
    overflow: 'hidden',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  chipActive:     { borderColor: 'transparent', shadowColor: PURPLE, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  chipText:       { fontSize: 14, fontWeight: '600', color: '#374151' },
  chipTextActive: { color: '#fff', fontWeight: '800' },

  prefBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#DDD6FE',
    paddingHorizontal: 16, paddingVertical: 14,
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  prefBtnText:       { flex: 1, fontSize: 15, color: '#C4B5FD', fontWeight: '500' },
  prefBtnTextFilled: { color: '#1E0753', fontWeight: '700' },

  startWrap: {
    marginTop: 32, width: '100%', borderRadius: 18, overflow: 'hidden',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.38, shadowRadius: 20, elevation: 10,
  },
  startBtn:  { height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  startText: { fontSize: 18, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  startWrapDisabled: { shadowOpacity: 0.12 },

  // @ID 入力
  handleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#DDD6FE',
    paddingHorizontal: 16,
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  handleRowOk:  { borderColor: '#10B981' },
  handleRowBad: { borderColor: '#FCA5A5' },
  handleAt:     { fontSize: 17, fontWeight: '800', color: PURPLE },
  handleInput:  { flex: 1, fontSize: 16, color: '#1E0753', fontWeight: '600', paddingVertical: 13 },
  handleHint:   { fontSize: 11.5, color: '#A78BFA', marginTop: 7, marginLeft: 4 },
  handleHintBad: { color: '#EF4444' },

  skipBtn:  { marginTop: 16, padding: 10 },
  skipText: { fontSize: 14, color: '#A78BFA', fontWeight: '500' },

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
    borderRadius: 14, overflow: 'hidden', paddingVertical: 14, paddingHorizontal: 18,
    backgroundColor: '#fff', marginBottom: 8,
    borderWidth: 1.5, borderColor: '#DDD6FE',
  },
  prefRowActive:  { borderColor: 'transparent' },
  prefText:       { fontSize: 15, fontWeight: '600', color: '#374151' },
  prefTextActive: { color: '#fff', fontWeight: '800' },
});
