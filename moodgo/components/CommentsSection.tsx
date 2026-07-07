/**
 * CommentsSection — 投稿へのコメント（1階層・返信なし）
 * community-spot 詳細で使用。一覧（新着順）＋入力行。本人のコメントは長押しで削除、
 * 他人のコメントは長押しで通報。テーブル未適用(ready:false)は「準備中」を表示。
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { MessageSquare, Send, UserRound } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { relativeTime } from '@/lib/spotLog';
import { showToast } from '@/lib/toast';

const PURPLE = '#9B6BFF';

type Comment = {
  id: string; body: string; created_at: string;
  handle: string | null; posterId: string; icon: string | null; mine: boolean;
};

export default function CommentsSection({ targetId }: { targetId: string }) {
  const [items, setItems] = useState<Comment[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const isMounted = useRef(true);

  const load = async () => {
    try {
      const deviceId = await getDeviceId();
      const d = await apiFetch('/api/spot-comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', targetId, deviceId }),
      }).then((r) => r.json());
      if (!isMounted.current) return;
      if (d?.ok) {
        setReady(d.ready !== false);
        setItems(Array.isArray(d.items) ? d.items : []);
      }
    } catch { /* noop */ }
    finally { if (isMounted.current) setLoading(false); }
  };

  useEffect(() => {
    isMounted.current = true;
    setLoading(true);
    load();
    return () => { isMounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    try {
      const deviceId = await getDeviceId();
      const d = await apiFetch('/api/spot-comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', targetId, deviceId, body }),
      }).then((r) => r.json());
      if (d?.ok) {
        setText('');
        load();   // 追加後に再取得（@handle等をサーバー整形で揃える）
      } else {
        showToast('コメントできませんでした', d?.error ?? '時間をおいてお試しください');
      }
    } catch { showToast('コメントできませんでした', '通信に失敗しました'); }
    finally { if (isMounted.current) setSending(false); }
  };

  const onLongPress = (c: Comment) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (c.mine) {
      Alert.alert('コメントを削除しますか？', '', [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除', style: 'destructive',
          onPress: async () => {
            const deviceId = await getDeviceId();
            await apiFetch('/api/spot-comments', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'delete', commentId: c.id, deviceId }),
            }).catch(() => {});
            setItems((prev) => prev.filter((x) => x.id !== c.id));
          },
        },
      ]);
    } else {
      Alert.alert('このコメントを通報しますか？', '不適切な内容として運営に報告します。', [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '通報する', style: 'destructive',
          onPress: async () => {
            const deviceId = await getDeviceId();
            await apiFetch('/api/spot-comments', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'report', commentId: c.id, deviceId }),
            }).catch(() => {});
            showToast('通報しました', 'ご協力ありがとうございます');
          },
        },
      ]);
    }
  };

  return (
    <View style={s.card}>
      <View style={s.head}>
        <MessageSquare size={16} color={PURPLE} strokeWidth={2.2} />
        <Text style={s.title}>コメント</Text>
        {items.length > 0 && <Text style={s.count}>{items.length}件</Text>}
      </View>

      {/* 入力行 */}
      {ready && (
        <View style={s.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="コメントを書く…"
            placeholderTextColor="#B9B6CC"
            style={s.input}
            maxLength={200}
            multiline
          />
          <TouchableOpacity onPress={send} disabled={!text.trim() || sending} style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
            accessibilityRole="button" accessibilityLabel="コメントを送信">
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <Send size={15} color="#fff" strokeWidth={2.4} />}
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={s.centerPad}><ActivityIndicator color={PURPLE} size="small" /></View>
      ) : !ready ? (
        <Text style={s.emptyText}>コメント機能は準備中です</Text>
      ) : items.length === 0 ? (
        <Text style={s.emptyText}>最初のコメントを書いてみませんか？</Text>
      ) : (
        items.map((c) => (
          <TouchableOpacity key={c.id} style={s.row} activeOpacity={0.8} onLongPress={() => onLongPress(c)}>
            <TouchableOpacity
              onPress={() => c.posterId && router.push({ pathname: '/user/[id]', params: { id: c.posterId } })}
              accessibilityRole="button" accessibilityLabel="コメント者のプロフィールを見る">
              {c.icon ? (
                <Image source={{ uri: c.icon }} style={s.avatar} contentFit="cover" />
              ) : (
                <View style={[s.avatar, s.avatarPh]}><UserRound size={14} color={PURPLE} strokeWidth={1.8} /></View>
              )}
            </TouchableOpacity>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={s.metaRow}>
                <Text style={s.handle} numberOfLines={1}>{c.handle ? `@${c.handle}` : 'MoodGoユーザー'}</Text>
                <Text style={s.time}>{relativeTime(c.created_at)}</Text>
                {c.mine && <Text style={s.mineTag}>自分</Text>}
              </View>
              <Text style={s.body}>{c.body}</Text>
            </View>
          </TouchableOpacity>
        ))
      )}
      {ready && items.length > 0 && (
        <Text style={s.hint}>長押しで{items.some((c) => c.mine) ? '削除・' : ''}通報できます</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 14,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 },
  title: { fontSize: 15, fontWeight: '800', color: '#1A0A2E', flex: 1 },
  count: { fontSize: 12, fontWeight: '700', color: '#8B88A6' },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 12 },
  input: {
    flex: 1, minHeight: 40, maxHeight: 96, borderRadius: 14,
    backgroundColor: '#F6F4FB', paddingHorizontal: 13, paddingVertical: 10,
    fontSize: 13.5, color: '#1F2937',
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: PURPLE,
    alignItems: 'center', justifyContent: 'center',
  },

  centerPad: { paddingVertical: 18, alignItems: 'center' },
  emptyText: { fontSize: 12.5, color: '#9CA3AF', fontWeight: '600', textAlign: 'center', paddingVertical: 10 },

  row: { flexDirection: 'row', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#F2EFF7' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F0EDFF' },
  avatarPh: { alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  handle: { fontSize: 12, fontWeight: '800', color: '#4B3B6B', flexShrink: 1 },
  time: { fontSize: 10.5, fontWeight: '500', color: '#9CA3AF' },
  mineTag: {
    fontSize: 9.5, fontWeight: '800', color: '#7C3AED',
    backgroundColor: '#F1EBFF', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1,
  },
  body: { fontSize: 13.5, color: '#2D2240', lineHeight: 20, marginTop: 3 },
  hint: { fontSize: 10.5, color: '#B7B3C2', textAlign: 'center', marginTop: 8 },
});
