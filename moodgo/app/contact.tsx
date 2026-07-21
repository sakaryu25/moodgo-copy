// お問い合わせ / バグ報告フォーム（2026-07-08 最適化）。設定画面の「お問い合わせ」から開く。
//   種別（バグ・不具合/ご要望・ご意見/アカウント/その他）で振り分け＋バグ報告は端末情報を自動添付。
//   種別・端末情報は本文にまとめて /api/contact に送る（contactsテーブルは変更不要）。
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Bug, Check, ChevronLeft, MessageSquarePlus, Send, Sparkles, UserRound } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppBackground from '@/components/AppBackground';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { showToast } from '@/lib/toast';
import PuniPressable from '@/components/PuniPressable';
import IMESafeTextInput from '@/components/IMESafeTextInput';

const PINK = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const INK = '#1E0753';
const SUB = '#7C6BA8';

const NICKNAME_KEY = 'moodgo-group-nickname';

// 種別（運営の振り分け用）。バグ報告のときだけ端末情報を自動添付する。
type CatKey = 'bug' | 'request' | 'account' | 'other';
const CATEGORIES: { key: CatKey; label: string; Icon: typeof Bug; hint: string }[] = [
  { key: 'bug', label: 'バグ・不具合', Icon: Bug, hint: '不具合の内容と、起きたときの操作を教えてください。端末情報は自動で添付します。' },
  { key: 'request', label: 'ご要望・ご意見', Icon: Sparkles, hint: 'こんな機能がほしい・こうだと嬉しい、などご自由にどうぞ。' },
  { key: 'account', label: 'アカウント', Icon: UserRound, hint: 'ログイン・プロフィール・データに関するお問い合わせはこちら。' },
  { key: 'other', label: 'その他', Icon: MessageSquarePlus, hint: '上記に当てはまらないお問い合わせ。' },
];

// メール形式の軽いチェック（空はOK＝任意項目）
function emailLooksValid(v: string): boolean {
  const t = v.trim();
  return t.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export default function ContactScreen() {
  const insets = useSafeAreaInsets();
  const [cat, setCat] = useState<CatKey>('bug');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(NICKNAME_KEY).then((v) => { if (v) setName(v); }).catch(() => {});
  }, []);

  const current = CATEGORIES.find((c) => c.key === cat)!;
  const emailOk = emailLooksValid(email);
  const canSend = message.trim().length > 0 && emailOk && !submitting;

  const submit = async () => {
    if (!canSend) {
      if (!emailOk) showToast('メールアドレスをご確認ください', '正しい形式で入力してください');
      else if (!message.trim()) showToast('内容をご記入ください', 'お問い合わせ内容は必須です');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSubmitting(true);
    try {
      const deviceId = await getDeviceId();
      // 種別＋（バグ報告のみ）端末情報を本文にまとめる＝運営が振り分け・調査しやすい
      const appVer = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '?';
      const env = `${Platform.OS} ${String(Platform.Version)} / MoodGo ${appVer}`;
      const composed =
        `【種別】${current.label}\n` +
        (cat === 'bug' ? `【環境】${env}\n` : '') +
        `\n${message.trim()}`;
      const res = await apiFetch('/api/contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: composed, deviceId }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) throw new Error(data.error ?? '送信に失敗しました');
      setDone(true);
    } catch {
      setSubmitting(false);
      showToast('送信できませんでした', '通信環境を確認して再度お試しください');
    }
  };

  if (done) {
    return (
      <View style={s.root}>
        <AppBackground />
        <View style={[s.successWrap, { paddingTop: insets.top }]}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.successIconGrad}>
            <Check size={34} color="#fff" strokeWidth={3} />
          </LinearGradient>
          <Text style={s.successTitle}>送信しました</Text>
          <Text style={s.successSub}>お問い合わせありがとうございます。{'\n'}内容を確認のうえ対応いたします。</Text>
          <PuniPressable onPress={() => router.back()} style={s.successBtnWrap}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.successBtn}>
              <Text style={s.successBtnText}>閉じる</Text>
            </LinearGradient>
          </PuniPressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <AppBackground />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.header, { paddingTop: insets.top + 8 }]}>
          <PuniPressable onPress={() => router.back()} style={s.backCircle}>
            <ChevronLeft size={20} color={PURPLE} strokeWidth={2.5} />
          </PuniPressable>
          <Text style={s.headerTitle}>お問い合わせ</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* 種別（運営の振り分け用）*/}
          <Text style={s.label}>種類</Text>
          <View style={s.catRow}>
            {CATEGORIES.map((c) => {
              const on = c.key === cat;
              return (
                <TouchableOpacity key={c.key} onPress={() => { Haptics.selectionAsync(); setCat(c.key); }}
                  activeOpacity={0.85} style={s.catChipWrap}
                  accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={c.label}>
                  {on ? (
                    <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.catChip}>
                      <c.Icon size={15} color="#fff" strokeWidth={2.3} />
                      <Text style={[s.catText, s.catTextOn]}>{c.label}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={[s.catChip, s.catChipOff]}>
                      <c.Icon size={15} color={PURPLE} strokeWidth={2.2} />
                      <Text style={s.catText}>{c.label}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={s.hint}>{current.hint}</Text>

          <Text style={s.label}>お名前<Text style={s.optional}>（任意）</Text></Text>
          <IMESafeTextInput value={name} onChangeText={setName} placeholder="例：山田 太郎" placeholderTextColor="#C4B5FD"
            style={s.input} maxLength={50} />

          <Text style={s.label}>メールアドレス<Text style={s.optional}>（任意・返信が必要な場合）</Text></Text>
          <IMESafeTextInput value={email} onChangeText={setEmail} placeholder="例：example@email.com" placeholderTextColor="#C4B5FD"
            style={[s.input, !emailOk && s.inputError]} autoCapitalize="none" keyboardType="email-address" maxLength={120} />
          {!emailOk && <Text style={s.errorText}>メールアドレスの形式をご確認ください</Text>}

          <Text style={s.label}>{cat === 'bug' ? '不具合の内容' : 'お問い合わせ内容'}<Text style={s.required}> *</Text></Text>
          <IMESafeTextInput value={message} onChangeText={setMessage}
            placeholder={cat === 'bug' ? '例：投稿ボタンを押すと画面が固まる。◯◯を開いて△△したときに起きます。' : 'ご自由にご記入ください'}
            placeholderTextColor="#C4B5FD" style={[s.input, s.textarea]} multiline textAlignVertical="top" maxLength={2000} />
          <Text style={s.counter}>{message.length} / 2000</Text>

          {cat === 'bug' && (
            <View style={s.envNote}>
              <Bug size={13} color={PURPLE} strokeWidth={2.2} />
              <Text style={s.envNoteText}>調査のため、端末・アプリのバージョン情報を自動で添付します。</Text>
            </View>
          )}

          <TouchableOpacity onPress={submit} disabled={submitting} activeOpacity={0.85} style={{ marginTop: 18 }}>
            <LinearGradient colors={canSend ? GRAD : ['#D8CCFF', '#D8CCFF', '#D8CCFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.sendBtn}>
              {submitting
                ? <ActivityIndicator color="#fff" />
                : <><Send size={18} color="#fff" strokeWidth={2.5} /><Text style={s.sendText}>送信する</Text></>}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backCircle: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#111', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: INK },

  label: { fontSize: 14, fontWeight: '700', color: INK, marginTop: 18, marginBottom: 9 },
  optional: { fontSize: 12, fontWeight: '600', color: '#A78BFA' },
  required: { color: '#FF6B8A', fontWeight: '900' },

  // 種別チップ（2列で折り返し）
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  catChipWrap: { width: '48%' },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    height: 46, borderRadius: 14, paddingHorizontal: 14, justifyContent: 'center',
  },
  catChipOff: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#EAE3FB' },
  catText: { fontSize: 13.5, fontWeight: '800', color: '#5B4B86' },
  catTextOn: { color: '#fff' },
  hint: { fontSize: 12.5, color: SUB, lineHeight: 19, marginTop: 10 },

  input: {
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#EAE3FB',
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 14.5, color: INK,
  },
  inputError: { borderColor: '#FCA5C4' },
  errorText: { fontSize: 11.5, color: '#EF5A82', fontWeight: '700', marginTop: 6 },
  textarea: { minHeight: 150 },
  counter: { alignSelf: 'flex-end', fontSize: 11, color: '#A78BFA', marginTop: 6 },

  envNote: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14,
    backgroundColor: '#F5F0FF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  envNoteText: { flex: 1, fontSize: 11.5, color: '#6D28D9', fontWeight: '600', lineHeight: 17 },

  sendBtn: {
    height: 54, borderRadius: 16, flexDirection: 'row', gap: 8,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 3,
  },
  sendText: { fontSize: 16, fontWeight: '900', color: '#fff' },

  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 14 },
  successIconGrad: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  successTitle: { fontSize: 22, fontWeight: '900', color: INK },
  successSub: { fontSize: 14, color: SUB, textAlign: 'center', lineHeight: 22 },
  successBtnWrap: { marginTop: 18, width: '100%' },
  successBtn: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  successBtnText: { fontSize: 16, fontWeight: '900', color: '#fff' },
});
