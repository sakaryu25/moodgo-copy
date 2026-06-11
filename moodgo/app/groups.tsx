/**
 * groups.tsx — 仲良しグループで「今の気分」をつぶやく
 * - 招待コード制（アカウント不要・端末ID＋ニックネーム）
 * - グループ一覧 → 作成 / コード参加
 * - グループ内: 気分チップ＋一言でつぶやき、メンバーのフィード表示
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import {
  ChevronLeft, ChevronRight, Copy, LogOut, Moon, Plus, Send, Users,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PuniPressable from '@/components/PuniPressable';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

// ─── tokens ───────────────────────────────────────────────────────────────────
const PINK   = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE   = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const BG     = '#F5F0FF';
const INK    = '#1E0753';

const NICKNAME_KEY = 'moodgo-group-nickname';

// つぶやき用の気分チップ（クイズの気分と同じキー）
const MOOD_CHIPS: { key: string; emoji: string }[] = [
  { key: 'お腹すいた',   emoji: '🍜' },
  { key: 'まったり',     emoji: '☕️' },
  { key: '自然',         emoji: '🌿' },
  { key: '楽しみたい',   emoji: '🎉' },
  { key: 'ドライブ',     emoji: '🚗' },
  { key: '集中',         emoji: '📚' },
  { key: '運動',         emoji: '💪' },
  { key: '旅行',         emoji: '✈️' },
  { key: 'ショッピング', emoji: '🛍️' },
  { key: '時間潰し',     emoji: '🎲' },
  { key: '疲れた・眠い', emoji: '🌙', },
];
const moodEmoji = (key: string) => MOOD_CHIPS.find(m => m.key === key)?.emoji ?? '💭';

type Group = { id: string; name: string; invite_code: string; member_count?: number };
type Post  = { id: string; device_id: string; nickname: string; mood: string; comment: string | null; created_at: string };
type Member = { device_id: string; nickname: string };

// 相対時刻（3分前 / 2時間前 / 昨日 / 6/8）
function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1)  return 'たった今';
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d === 1) return '昨日';
  if (d < 7)   return `${d}日前`;
  const dt = new Date(t);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();

  const [deviceId, setDeviceId]   = useState('');
  const [nickname, setNickname]   = useState('');
  const [nickDraft, setNickDraft] = useState('');

  const [groups, setGroups]       = useState<Group[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 作成・参加フォーム
  const [newGroupName, setNewGroupName] = useState('');
  const [joinCode, setJoinCode]         = useState('');
  const [busy, setBusy]                 = useState(false);

  // グループ詳細
  const [active, setActive]   = useState<Group | null>(null);
  const [posts, setPosts]     = useState<Post[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selMood, setSelMood] = useState('');
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);

  // ── 初期化 ──
  useEffect(() => {
    (async () => {
      const id = await getDeviceId();
      setDeviceId(id);
      const nick = (await AsyncStorage.getItem(NICKNAME_KEY)) ?? '';
      setNickname(nick);
      setNickDraft(nick);
      await fetchGroups(id);
      setLoading(false);
    })();
  }, []);

  const fetchGroups = async (id: string) => {
    try {
      const res = await apiFetch(`/api/mood-groups?deviceId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.ok) setGroups(data.groups);
    } catch { /* オフライン時は空のまま */ }
  };

  const fetchGroupDetail = useCallback(async (g: Group, id: string) => {
    try {
      const res = await apiFetch(`/api/mood-groups?groupId=${encodeURIComponent(g.id)}&deviceId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (data.ok) { setPosts(data.posts); setMembers(data.members); }
    } catch { /* keep */ }
  }, []);

  const saveNickname = async () => {
    const nick = nickDraft.trim().slice(0, 20);
    if (!nick) return;
    setNickname(nick);
    await AsyncStorage.setItem(NICKNAME_KEY, nick);
  };

  // ── グループ作成 ──
  const handleCreate = async () => {
    const name = newGroupName.trim();
    if (!name || !nickname || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/mood-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, nickname, deviceId }),
      });
      const data = await res.json();
      if (!data.ok) { Alert.alert('エラー', data.error ?? '作成に失敗しました'); return; }
      setNewGroupName('');
      await fetchGroups(deviceId);
      Alert.alert(
        'グループを作ったよ🎉',
        `招待コード: ${data.group.invite_code}\nこのコードを友達に教えてね`,
        [
          { text: 'コードを共有', onPress: () => Share.share({ message: `MoodGoのグループ「${data.group.name}」に招待！\n招待コード: ${data.group.invite_code}` }) },
          { text: 'OK' },
        ],
      );
    } catch { Alert.alert('エラー', '通信に失敗しました'); }
    finally { setBusy(false); }
  };

  // ── コードで参加 ──
  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code || !nickname || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/mood-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code, nickname, deviceId }),
      });
      const data = await res.json();
      if (!data.ok) { Alert.alert('エラー', data.error ?? '参加に失敗しました'); return; }
      setJoinCode('');
      await fetchGroups(deviceId);
      openGroup(data.group);
    } catch { Alert.alert('エラー', '通信に失敗しました'); }
    finally { setBusy(false); }
  };

  const openGroup = (g: Group) => {
    setActive(g); setPosts([]); setMembers([]); setSelMood(''); setComment('');
    fetchGroupDetail(g, deviceId);
  };

  // ── つぶやく ──
  const handlePost = async () => {
    if (!active || !selMood || posting) return;
    setPosting(true);
    try {
      const res = await apiFetch('/api/mood-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'post', groupId: active.id, deviceId, mood: selMood, comment: comment.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setPosts(prev => [data.post, ...prev]);
        setSelMood(''); setComment('');
      } else {
        Alert.alert('エラー', data.error ?? '投稿に失敗しました');
      }
    } catch { Alert.alert('エラー', '通信に失敗しました'); }
    finally { setPosting(false); }
  };

  const handleLeave = () => {
    if (!active) return;
    Alert.alert('グループを抜ける', `「${active.name}」から抜けますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '抜ける', style: 'destructive',
        onPress: async () => {
          await apiFetch('/api/mood-groups', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'leave', groupId: active.id, deviceId }),
          }).catch(() => {});
          setActive(null);
          fetchGroups(deviceId);
        },
      },
    ]);
  };

  const shareCode = (g: Group) =>
    Share.share({ message: `MoodGoのグループ「${g.name}」に招待！\n招待コード: ${g.invite_code}` });

  const onRefresh = async () => {
    setRefreshing(true);
    if (active) await fetchGroupDetail(active, deviceId);
    else await fetchGroups(deviceId);
    setRefreshing(false);
  };

  // ─── グループ詳細画面 ────────────────────────────────────────────────────────
  if (active) {
    const canPost = !!selMood && !posting;
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.root, { paddingTop: insets.top }]}>
          {/* ヘッダー */}
          <View style={s.header}>
            <PuniPressable onPress={() => setActive(null)} style={s.backCircle}>
              <ChevronLeft size={20} color="#7C3AED" strokeWidth={2.5} />
            </PuniPressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={s.headerTitle} numberOfLines={1}>{active.name}</Text>
              <PuniPressable onPress={() => shareCode(active)} style={s.codeChip}>
                <Copy size={10} color="#7C3AED" strokeWidth={2} />
                <Text style={s.codeChipText}>{active.invite_code}</Text>
              </PuniPressable>
            </View>
            <PuniPressable onPress={handleLeave} style={s.backCircle}>
              <LogOut size={17} color="#F43F5E" strokeWidth={2} />
            </PuniPressable>
          </View>

          {/* メンバー */}
          {members.length > 0 && (
            <Text style={s.membersLine} numberOfLines={1}>
              👥 {members.map(m => m.nickname).join('・')}
            </Text>
          )}

          {/* フィード */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 12 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE} />}
          >
            {posts.length === 0 ? (
              <View style={s.emptyBox}>
                <Moon size={36} color="#C4B5FD" strokeWidth={1.5} />
                <Text style={s.emptyText}>まだつぶやきがないよ{'\n'}最初の気分をつぶやいてみて！</Text>
              </View>
            ) : posts.map(p => {
              const mine = p.device_id === deviceId;
              return (
                <View key={p.id} style={[s.post, mine && s.postMine]}>
                  <Text style={s.postEmoji}>{moodEmoji(p.mood)}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={s.postHead}>
                      <Text style={s.postNick}>{mine ? `${p.nickname}（自分）` : p.nickname}</Text>
                      <Text style={s.postTime}>{timeAgo(p.created_at)}</Text>
                    </View>
                    <Text style={s.postMood}>いまの気分: {p.mood}</Text>
                    {p.comment ? <Text style={s.postComment}>{p.comment}</Text> : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* つぶやき入力 */}
          <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
              {MOOD_CHIPS.map(m => {
                const on = selMood === m.key;
                const dark = m.key === '疲れた・眠い';
                return (
                  <PuniPressable
                    key={m.key}
                    onPress={() => setSelMood(on ? '' : m.key)}
                    style={[s.chip, dark && s.chipDark, on && (dark ? s.chipOnDark : s.chipOn)]}
                  >
                    <Text style={s.chipEmoji}>{m.emoji}</Text>
                    <Text style={[s.chipText, dark && s.chipTextDark, on && s.chipTextOn]}>{m.key}</Text>
                  </PuniPressable>
                );
              })}
            </ScrollView>
            <View style={s.inputRow}>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="ひとこと（任意）"
                placeholderTextColor="#C4B5FD"
                style={s.commentInput}
                maxLength={200}
              />
              <PuniPressable onPress={handlePost} disabled={!canPost} style={[s.sendBtn, !canPost && { opacity: 0.4 }]}>
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.sendBtnInner}>
                  <Send size={17} color="#fff" strokeWidth={2.2} />
                </LinearGradient>
              </PuniPressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ─── グループ一覧画面 ────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <PuniPressable onPress={() => router.back()} style={s.backCircle}>
            <ChevronLeft size={20} color="#7C3AED" strokeWidth={2.5} />
          </PuniPressable>
          <Text style={s.headerTitle}>気分をつぶやく</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 30 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE} />}
        >
          {/* ニックネーム */}
          <Text style={s.label}>ニックネーム</Text>
          <Text style={s.hint}>グループ内でこの名前が表示されます</Text>
          <View style={s.inputRow}>
            <TextInput
              value={nickDraft}
              onChangeText={setNickDraft}
              placeholder="例: りゅうき"
              placeholderTextColor="#C4B5FD"
              style={[s.input, { flex: 1 }]}
              maxLength={20}
            />
            {nickDraft.trim() !== nickname && (
              <PuniPressable onPress={saveNickname} style={s.nickSaveBtn}>
                <Text style={s.nickSaveText}>保存</Text>
              </PuniPressable>
            )}
          </View>

          {/* 所属グループ */}
          <Text style={[s.label, { marginTop: 24 }]}>マイグループ</Text>
          {loading ? (
            <ActivityIndicator color={PURPLE} style={{ marginVertical: 20 }} />
          ) : groups.length === 0 ? (
            <View style={s.emptyBox}>
              <Users size={34} color="#C4B5FD" strokeWidth={1.5} />
              <Text style={s.emptyText}>まだグループがないよ{'\n'}作るか、招待コードで参加してね</Text>
            </View>
          ) : groups.map(g => (
            <PuniPressable key={g.id} onPress={() => openGroup(g)} style={s.groupCard}>
              <View style={s.groupIconCircle}>
                <Users size={18} color="#7C3AED" strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.groupName}>{g.name}</Text>
                <Text style={s.groupMeta}>{g.member_count ?? 1}人 ・ コード {g.invite_code}</Text>
              </View>
              <ChevronRight size={18} color="#C4B5FD" />
            </PuniPressable>
          ))}

          {/* 作成 */}
          <Text style={[s.label, { marginTop: 24 }]}>グループを作る</Text>
          {!nickname && <Text style={s.warnText}>↑ 先にニックネームを保存してね</Text>}
          <View style={s.inputRow}>
            <TextInput
              value={newGroupName}
              onChangeText={setNewGroupName}
              placeholder="グループ名（例: いつめん）"
              placeholderTextColor="#C4B5FD"
              style={[s.input, { flex: 1 }]}
              maxLength={30}
            />
            <PuniPressable
              onPress={handleCreate}
              disabled={!newGroupName.trim() || !nickname || busy}
              style={[s.actionBtn, (!newGroupName.trim() || !nickname || busy) && { opacity: 0.4 }]}
            >
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionBtnInner}>
                <Plus size={18} color="#fff" strokeWidth={2.5} />
              </LinearGradient>
            </PuniPressable>
          </View>

          {/* 参加 */}
          <Text style={[s.label, { marginTop: 24 }]}>招待コードで参加</Text>
          <View style={s.inputRow}>
            <TextInput
              value={joinCode}
              onChangeText={t => setJoinCode(t.toUpperCase())}
              placeholder="6桁コード（例: AB3XY9）"
              placeholderTextColor="#C4B5FD"
              autoCapitalize="characters"
              style={[s.input, { flex: 1, letterSpacing: 2 }]}
              maxLength={6}
            />
            <PuniPressable
              onPress={handleJoin}
              disabled={joinCode.trim().length !== 6 || !nickname || busy}
              style={[s.actionBtn, (joinCode.trim().length !== 6 || !nickname || busy) && { opacity: 0.4 }]}
            >
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionBtnInner}>
                <Users size={18} color="#fff" strokeWidth={2.2} />
              </LinearGradient>
            </PuniPressable>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, gap: 8,
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: INK },
  backCircle: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#EDE9FE',
    alignItems: 'center', justifyContent: 'center',
  },
  codeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2,
    backgroundColor: '#EDE9FE', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
  },
  codeChipText: { fontSize: 11, fontWeight: '800', color: '#7C3AED', letterSpacing: 1 },
  membersLine: { fontSize: 12, color: '#7C6BA8', paddingHorizontal: 20, paddingBottom: 6 },

  label: { fontSize: 12, fontWeight: '900', color: '#7C3AED', marginBottom: 6 },
  hint:  { fontSize: 11, color: '#A78BFA', marginBottom: 8, lineHeight: 16 },
  warnText: { fontSize: 11, color: '#D97706', marginBottom: 6 },
  input: {
    height: 48, borderRadius: 14, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#DDD6FE',
    paddingHorizontal: 14, fontSize: 14, color: INK,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nickSaveBtn: {
    height: 48, paddingHorizontal: 16, borderRadius: 14, backgroundColor: '#7C3AED',
    alignItems: 'center', justifyContent: 'center',
  },
  nickSaveText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  actionBtn: { borderRadius: 14, overflow: 'hidden' },
  actionBtnInner: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },

  groupCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: '#EDE9FE',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  groupIconCircle: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F3FF',
    alignItems: 'center', justifyContent: 'center',
  },
  groupName: { fontSize: 15, fontWeight: '800', color: INK },
  groupMeta: { fontSize: 11, color: '#A78BFA', marginTop: 2 },

  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  emptyText: { fontSize: 13, color: '#A78BFA', textAlign: 'center', lineHeight: 20 },

  post: {
    flexDirection: 'row', gap: 10, backgroundColor: '#fff',
    borderRadius: 16, padding: 13, marginBottom: 10,
    borderWidth: 1.5, borderColor: '#EDE9FE',
  },
  postMine: { borderColor: '#C4B5FD', backgroundColor: '#FCFAFF' },
  postEmoji: { fontSize: 26 },
  postHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  postNick: { fontSize: 13, fontWeight: '800', color: INK },
  postTime: { fontSize: 11, color: '#C4B5FD' },
  postMood: { fontSize: 12, fontWeight: '700', color: '#7C3AED', marginTop: 2 },
  postComment: { fontSize: 13, color: '#4C3575', marginTop: 4, lineHeight: 19 },

  composer: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 10, paddingHorizontal: 12,
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08, shadowRadius: 10, elevation: 10,
  },
  chipRow: { gap: 7, paddingBottom: 10, paddingHorizontal: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999,
    backgroundColor: '#F5F3FF', borderWidth: 1.5, borderColor: '#EDE9FE',
  },
  chipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  chipDark: { backgroundColor: '#1E1B4B', borderColor: '#312E81' },
  chipOnDark: { backgroundColor: '#312E81', borderColor: '#6366F1' },
  chipEmoji: { fontSize: 14 },
  chipText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  chipTextDark: { color: '#C7D2FE' },
  chipTextOn: { color: '#fff' },
  commentInput: {
    flex: 1, height: 44, borderRadius: 999, backgroundColor: '#F5F3FF',
    borderWidth: 1.5, borderColor: '#EDE9FE',
    paddingHorizontal: 16, fontSize: 13, color: INK,
  },
  sendBtn: { borderRadius: 999, overflow: 'hidden' },
  sendBtnInner: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
