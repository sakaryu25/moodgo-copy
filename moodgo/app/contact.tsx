// お問い合わせフォーム画面。設定画面の「お問い合わせ」から開く。
// 名前・メール（任意）＋内容（必須）→ /api/contact に送信。
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Check, ChevronLeft, Send } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import PuniPressable from '@/components/PuniPressable';

const PINK = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const BG = '#F5F0FF';

const NICKNAME_KEY = 'moodgo-group-nickname';

export default function ContactScreen() {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(NICKNAME_KEY).then(v => { if (v) setName(v); }).catch(() => {});
  }, []);

  const canSend = message.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSend) return;
    setSubmitting(true);
    try {
      const deviceId = await getDeviceId();
      const res = await apiFetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          deviceId,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) {
        throw new Error(data.error ?? '送信に失敗しました');
      }
      setDone(true);
    } catch {
      setSubmitting(false);
      // 失敗時はボタンを再度押せる状態に戻すだけ（簡潔に）
    }
  };

  if (done) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.successWrap}>
          <View style={s.successIcon}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.successIconGrad}>
              <Check size={34} color="#fff" strokeWidth={3} />
            </LinearGradient>
          </View>
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
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <PuniPressable onPress={() => router.back()} style={s.backCircle}>
          <ChevronLeft size={20} color="#7C3AED" strokeWidth={2.5} />
        </PuniPressable>
        <Text style={s.headerTitle}>お問い合わせ</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Text style={s.lead}>
          ご意見・ご要望・不具合のご報告などをお送りください。{'\n'}返信が必要な場合はメールアドレスをご記入ください。
        </Text>

        <Text style={s.label}>お名前<Text style={s.optional}>（任意）</Text></Text>
        <TextInput
          value={name} onChangeText={setName}
          placeholder="例：山田 太郎" placeholderTextColor="#C4B5FD"
          style={s.input} maxLength={50}
        />

        <Text style={s.label}>メールアドレス<Text style={s.optional}>（任意・返信が必要な場合）</Text></Text>
        <TextInput
          value={email} onChangeText={setEmail}
          placeholder="例：example@email.com" placeholderTextColor="#C4B5FD"
          style={s.input} autoCapitalize="none" keyboardType="email-address" maxLength={120}
        />

        <Text style={s.label}>お問い合わせ内容<Text style={s.required}> *</Text></Text>
        <TextInput
          value={message} onChangeText={setMessage}
          placeholder="ご自由にご記入ください" placeholderTextColor="#C4B5FD"
          style={[s.input, s.textarea]} multiline textAlignVertical="top" maxLength={2000}
        />
        <Text style={s.counter}>{message.length} / 2000</Text>

        <TouchableOpacity onPress={submit} disabled={!canSend} activeOpacity={0.85} style={{ marginTop: 18 }}>
          <LinearGradient
            colors={canSend ? GRAD : ['#D8CCFF', '#D8CCFF', '#D8CCFF']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.sendBtn}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <><Send size={18} color="#fff" strokeWidth={2.5} /><Text style={s.sendText}>送信する</Text></>}
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backCircle: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#EDE9FE',
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1E0753' },
  lead: { fontSize: 13.5, color: '#7C6BA8', lineHeight: 21, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '700', color: '#1E0753', marginTop: 16, marginBottom: 8 },
  optional: { fontSize: 12, fontWeight: '600', color: '#A78BFA' },
  required: { color: '#FF6B8A', fontWeight: '900' },
  input: {
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#EDE9FE',
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 14.5, color: '#1E0753',
  },
  textarea: { minHeight: 140 },
  counter: { alignSelf: 'flex-end', fontSize: 11, color: '#A78BFA', marginTop: 6 },
  sendBtn: {
    height: 54, borderRadius: 16, flexDirection: 'row', gap: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  sendText: { fontSize: 16, fontWeight: '900', color: '#fff' },

  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 14 },
  successIcon: { marginBottom: 6 },
  successIconGrad: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 22, fontWeight: '900', color: '#1E0753' },
  successSub: { fontSize: 14, color: '#7C6BA8', textAlign: 'center', lineHeight: 22 },
  successBtnWrap: { marginTop: 18, width: '100%' },
  successBtn: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  successBtnText: { fontSize: 16, fontWeight: '900', color: '#fff' },
});
