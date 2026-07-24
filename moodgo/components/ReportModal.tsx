/**
 * ReportModal.tsx
 * 不適切な内容の報告モーダル（共通コンポーネント・2026-07-08 最適化）
 * - 理由チップ（アイコン付き2列）＋詳細入力 → /api/reports に送信（adminが確認・削除できる）
 * - コミュニティフィード・投稿詳細・Moodログ節・履歴のどこからでも使える＝通報の唯一の入口
 * - suggestionId が投稿ID（"ml-"+UUID=Moodログ / 生UUID=旧穴場投稿）の時は post_id/post_kind も
 *   送信し、サーバー側でid基準の自動非表示カウント（3件でhidden）が効く（2026-07-11統一）
 */

import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ban, Check, Flag, Info, MoreHorizontal, ShieldAlert, Store } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import IMESafeTextInput from '@/components/IMESafeTextInput';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RED = '#EF4444';
const REASONS: { label: string; Icon: typeof Info }[] = [
  { label: '閉店・閉業', Icon: Store },
  { label: '不正確な情報', Icon: Info },
  { label: '不適切なコンテンツ', Icon: ShieldAlert },
  { label: 'その他', Icon: MoreHorizontal },
];
// カスタム理由（reasons prop）用のアイコン割当。未知のラベルは Info。
const ICON_BY_LABEL: Record<string, typeof Info> = {
  '閉店・閉業': Store, '不適切なコンテンツ': ShieldAlert, 'その他': MoreHorizontal,
};

type Props = {
  visible: boolean;
  spotName: string;
  spotAddress?: string;
  /** 任意: 対象スポットのID（adminが特定・削除しやすくする） */
  suggestionId?: string;
  /** 任意: 投稿者の公開ID（サーバーが返すdeviceHash）。指定時は「投稿者をブロック」を表示 */
  posterId?: string;
  /** 任意: 投稿者ブロック時のコールバック（公開IDを渡す。生device_idは扱わない） */
  onBlockUser?: (posterId: string) => void;
  /** 任意: 通報が受け付けられた時（リストから対象を消す等・閉じる前に呼ばれる） */
  onReported?: () => void;
  /** 任意: 理由リストの差し替え（場所詳細の「場所名/営業時間/最寄り駅が違う」等） */
  reasons?: string[];
  /** 任意: 詳細入力のプレースホルダ差し替え（例:「正しい情報を教えてください」） */
  notePlaceholder?: string;
  onClose: () => void;
};

export default function ReportModal({ visible, spotName, spotAddress, suggestionId, posterId, onBlockUser, onReported, reasons, notePlaceholder, onClose }: Props) {
  const reasonList = reasons ? reasons.map((label) => ({ label, Icon: ICON_BY_LABEL[label] ?? Info })) : REASONS;
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => { setReason(''); setNote(''); setSubmitting(false); setDone(false); };
  const close = () => { reset(); onClose(); };

  const blockUser = () => {
    if (!posterId) return;
    Alert.alert(
      'この投稿者をブロック',
      'この投稿者の投稿が今後フィードに表示されなくなります。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'ブロック', style: 'destructive',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onBlockUser?.(posterId);
            close();
          },
        },
      ],
    );
  };

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // 対象が投稿なら種別を判別して post_id/post_kind を添える（サーバーの自動非表示カウント用）
      const rawId = (suggestionId ?? '').trim();
      const isMoodlog = rawId.startsWith('ml-');
      const postUuid = isMoodlog ? rawId.slice(3) : rawId;
      const isPost = UUID_RE.test(postUuid);
      const deviceId = await getDeviceId().catch(() => '');
      const d = await apiFetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spot_name: spotName,
          spot_address: spotAddress ?? '',
          reason,
          note: [suggestionId ? `[id:${suggestionId}]` : '', note].filter(Boolean).join(' '),
          device_id: deviceId || undefined,
          post_id: isPost ? postUuid : undefined,
          post_kind: isPost ? (isMoodlog ? 'moodlog' : 'suggestion') : undefined,
        }),
      }).then((r) => r.json());
      if (d?.ok) {
        onReported?.();
        setDone(true);
        setTimeout(close, 1400);
      } else {
        setSubmitting(false);
        Alert.alert('通報できませんでした', d?.error ?? '時間をおいてお試しください');
      }
    } catch {
      setSubmitting(false);
      Alert.alert('通報できませんでした', '通信に失敗しました。時間をおいてお試しください');
    }
  };

  return (
    // ⚠ New Arch(Fabric)の透明Modalは「visible=trueの状態で即マウント」だと中身を描画せず
    //   タッチだけ奪う既知バグがある（ConsentGateで実証・c5adb7c）。このModalは
    //   「常時マウント＋visible=false始まりのトグル」なので安全。呼び出し側で
    //   {show && <ReportModal visible … />} のような条件付きマウントに変えないこと。
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={close} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={s.handle} />
          {done ? (
            <View style={s.doneBox}>
              <LinearGradient colors={['#34D399', '#10B981']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.doneIcon}>
                <Check size={30} color="#fff" strokeWidth={3} />
              </LinearGradient>
              <Text style={s.doneTitle}>報告を受け付けました</Text>
              <Text style={s.doneSub}>運営が内容を確認します。{'\n'}ご協力ありがとうございます。</Text>
            </View>
          ) : (
            <>
              <View style={s.titleRow}>
                <View style={s.titleIcon}><Flag size={17} color={RED} strokeWidth={2.4} /></View>
                <Text style={s.title}>不適切な内容を報告</Text>
              </View>
              <Text style={s.spotName} numberOfLines={1}>{spotName}</Text>

              <Text style={s.label}>理由<Text style={s.required}> *</Text></Text>
              <View style={s.reasonWrap}>
                {reasonList.map(({ label, Icon }) => {
                  const active = reason === label;
                  return (
                    <TouchableOpacity key={label} onPress={() => { Haptics.selectionAsync(); setReason(label); }} activeOpacity={0.85}
                      style={[s.reasonChip, active && s.reasonChipActive]}
                      accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={label}>
                      <Icon size={15} color={active ? RED : '#9CA3AF'} strokeWidth={2.2} />
                      <Text style={[s.reasonText, active && s.reasonTextActive]} numberOfLines={1}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <IMESafeTextInput
                value={note}
                onChangeText={setNote}
                placeholder={notePlaceholder ?? "詳細（任意）"}
                placeholderTextColor="#B7BCC6"
                multiline
                textAlignVertical="top"
                maxLength={500}
                style={s.input}
              />

              <View style={s.actions}>
                <TouchableOpacity onPress={close} activeOpacity={0.8} style={s.cancelBtn}>
                  <Text style={s.cancelText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={submit} disabled={!reason || submitting} activeOpacity={0.85} style={s.sendWrap}>
                  <LinearGradient
                    colors={reason ? ['#F87171', RED] : ['#FBCFCF', '#FBCFCF']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={s.sendBtn}
                  >
                    {submitting ? <ActivityIndicator color="#fff" size="small" />
                      : <><Flag size={16} color="#fff" strokeWidth={2.5} /><Text style={s.sendText}>送信</Text></>}
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              {!!posterId && onBlockUser && (
                <TouchableOpacity onPress={blockUser} activeOpacity={0.7} style={s.blockBtn}>
                  <Ban size={14} color="#9CA3AF" strokeWidth={2.2} />
                  <Text style={s.blockText}>この投稿者をブロック</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 22, paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#E5E7EB', marginBottom: 16 },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  titleIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FEECEC', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '900', color: '#111827', letterSpacing: -0.2 },
  spotName: { fontSize: 13.5, color: '#9CA3AF', marginTop: 6, fontWeight: '600', marginLeft: 39 },

  label: { fontSize: 13, color: '#6B7280', fontWeight: '700', marginTop: 22, marginBottom: 10 },
  required: { color: RED, fontWeight: '900' },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  reasonChip: {
    width: '47.5%', flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, height: 48, borderRadius: 14,
    backgroundColor: '#F4F5F7', borderWidth: 1.5, borderColor: '#F4F5F7',
  },
  reasonChipActive: { backgroundColor: '#FEECEC', borderColor: '#F87171' },
  reasonText: { fontSize: 13.5, fontWeight: '800', color: '#4B5563', flexShrink: 1 },
  reasonTextActive: { color: '#DC2626' },

  input: {
    marginTop: 16, minHeight: 96, borderRadius: 14, backgroundColor: '#F7F8FA',
    borderWidth: 1.5, borderColor: '#EEF0F3', padding: 14, fontSize: 14, color: '#111827',
  },

  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1, height: 54, borderRadius: 16, backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: 16, fontWeight: '800', color: '#6B7280' },
  sendWrap: { flex: 1 },
  sendBtn: { height: 54, borderRadius: 16, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 16, fontWeight: '900', color: '#fff' },

  blockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, marginTop: 6 },
  blockText: { fontSize: 14, fontWeight: '700', color: '#9CA3AF' },

  doneBox: { alignItems: 'center', paddingVertical: 20, gap: 12 },
  doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 18, fontWeight: '900', color: '#111827' },
  doneSub: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
});
