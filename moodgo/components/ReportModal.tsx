/**
 * ReportModal.tsx
 * 不適切な内容の報告モーダル（共通コンポーネント）
 * - 理由チップ＋詳細入力 → /api/reports に送信（adminが確認・削除できる）
 * - コミュニティフィード・履歴・結果のどこからでも使える
 */

import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import {
  ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';

const REASONS = ['閉店・閉業', '不正確な情報', '不適切なコンテンツ', 'その他'];

type Props = {
  visible: boolean;
  spotName: string;
  spotAddress?: string;
  /** 任意: 対象スポットのID（adminが特定・削除しやすくする） */
  suggestionId?: string;
  onClose: () => void;
};

export default function ReportModal({ visible, spotName, spotAddress, suggestionId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => { setReason(''); setNote(''); setSubmitting(false); setDone(false); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await apiFetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spot_name: spotName,
          spot_address: spotAddress ?? '',
          reason,
          note: [suggestionId ? `[id:${suggestionId}]` : '', note].filter(Boolean).join(' '),
        }),
      });
      setDone(true);
      setTimeout(close, 1400);
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={s.overlay}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={close} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
          {done ? (
            <View style={s.doneBox}>
              <View style={s.doneIcon}><Text style={{ fontSize: 26 }}>✓</Text></View>
              <Text style={s.doneTitle}>報告を受け付けました</Text>
              <Text style={s.doneSub}>運営が内容を確認します。ご協力ありがとうございます。</Text>
            </View>
          ) : (
            <>
              <View style={s.handle} />
              <Text style={s.title}>不適切な内容を報告</Text>
              <Text style={s.spotName} numberOfLines={1}>{spotName}</Text>

              <Text style={s.label}>理由</Text>
              <View style={s.reasonWrap}>
                {REASONS.map((r) => {
                  const active = reason === r;
                  return (
                    <TouchableOpacity key={r} onPress={() => setReason(r)} activeOpacity={0.8}
                      style={[s.reasonChip, active && s.reasonChipActive]}>
                      <Text style={[s.reasonText, active && s.reasonTextActive]}>{r}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="詳細（任意）"
                placeholderTextColor="#F0A8B8"
                multiline
                textAlignVertical="top"
                style={s.input}
              />

              <View style={s.actions}>
                <TouchableOpacity onPress={close} activeOpacity={0.8} style={s.cancelBtn}>
                  <Text style={s.cancelText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={submit} disabled={!reason || submitting} activeOpacity={0.85} style={s.sendWrap}>
                  <LinearGradient
                    colors={reason ? ['#F87171', '#EF4444'] : ['#FCA5A5', '#FCA5A5']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={s.sendBtn}
                  >
                    {submitting ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.sendText}>送信</Text>}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 22, paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#E5E7EB', marginBottom: 16 },
  title: { fontSize: 21, fontWeight: '900', color: '#111827' },
  spotName: { fontSize: 14, color: '#9CA3AF', marginTop: 4, fontWeight: '600' },

  label: { fontSize: 13, color: '#6B7280', fontWeight: '700', marginTop: 22, marginBottom: 10 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reasonChip: {
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14,
    backgroundColor: '#F3F4F6', borderWidth: 1.5, borderColor: '#F3F4F6',
  },
  reasonChipActive: { backgroundColor: '#FEE2E2', borderColor: '#F87171' },
  reasonText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  reasonTextActive: { color: '#DC2626' },

  input: {
    marginTop: 18, minHeight: 96, borderRadius: 14, backgroundColor: '#F9FAFB',
    borderWidth: 1.5, borderColor: '#F3F4F6', padding: 14, fontSize: 14, color: '#111827',
  },

  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1, height: 54, borderRadius: 16, backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: 16, fontWeight: '800', color: '#6B7280' },
  sendWrap: { flex: 1 },
  sendBtn: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 16, fontWeight: '900', color: '#fff' },

  doneBox: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  doneIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#D1FAE5', alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 18, fontWeight: '900', color: '#111827' },
  doneSub: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
});
