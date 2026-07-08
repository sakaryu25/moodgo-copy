/**
 * CommentsSection — 投稿へのコメント（TikTok風・2026-07-08刷新）
 *   インライン: 入力行＋最新4件のみ＋「すべてのコメントを見る」
 *   全件表示: 下から画面の2/3が競り上がるボトムシート（常時マウントModal+visibleトグル）
 *   長押し: 翻訳する / コピー / 通報する（自分のコメントは＋削除）がスライドメニューで出る
 * テーブル未適用(ready:false)は「準備中」を表示。
 */
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Ban, ChevronDown, Copy, Flag, Heart, Languages, MessageSquare, Send, Trash2, UserRound, X,
} from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Easing, FlatList, Keyboard, Modal,
  Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { blockUser } from '@/lib/blockStore';
import VerifiedBadge from '@/components/VerifiedBadge';
import { relativeTime } from '@/lib/spotLog';
import { showToast } from '@/lib/toast';

const PURPLE = '#9B6BFF';
const SCREEN_H = Dimensions.get('window').height;
const SHEET_H = Math.round(SCREEN_H * 0.66);   // 画面の2/3（TikTokのコメント欄と同じ比率）
const INLINE_MAX = 4;                          // インラインに出す最大件数

type Comment = {
  id: string; body: string; created_at: string;
  handle: string | null; posterId: string; icon: string | null; mine: boolean;
  parentId?: string | null; likeCount?: number; liked?: boolean; accountType?: string | null;
};
type Trans = { status: 'loading' | 'done'; text?: string };

// ── コメント1行（インライン/シート共通）──────────────────────────────────────
function CommentRow({ c, trans, isReply, onLongPress, onPressUser, onLike, onReply }: {
  c: Comment; trans?: Trans; isReply?: boolean;
  onLongPress: (c: Comment) => void; onPressUser: (c: Comment) => void;
  onLike: (c: Comment) => void; onReply: (c: Comment) => void;
}) {
  return (
    <TouchableOpacity style={[s.row, isReply && s.replyRow]} activeOpacity={0.8} onLongPress={() => onLongPress(c)} delayLongPress={280}>
      <TouchableOpacity onPress={() => onPressUser(c)}
        accessibilityRole="button" accessibilityLabel="コメント者のプロフィールを見る">
        {c.icon ? (
          <Image source={{ uri: c.icon }} style={[s.avatar, isReply && s.avatarSm]} contentFit="cover" />
        ) : (
          <View style={[s.avatar, isReply && s.avatarSm, s.avatarPh]}><UserRound size={isReply ? 12 : 14} color={PURPLE} strokeWidth={1.8} /></View>
        )}
      </TouchableOpacity>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.metaRow}>
          <Text style={s.handle} numberOfLines={1}>{c.handle ? `@${c.handle}` : 'MoodGoユーザー'}</Text>
          <VerifiedBadge type={c.accountType} size={13} />
          <Text style={s.time}>{relativeTime(c.created_at)}</Text>
          {c.mine && <Text style={s.mineTag}>自分</Text>}
        </View>
        <Text style={s.body}>{renderBody(c.body)}</Text>
        {trans?.status === 'loading' ? (
          <View style={s.transLoadingRow}>
            <ActivityIndicator size="small" color={PURPLE} />
            <Text style={s.transLoadingText}>翻訳中…</Text>
          </View>
        ) : trans?.status === 'done' ? (
          <View style={s.transBox}>
            <View style={s.transLabelRow}>
              <Languages size={11} color={PURPLE} strokeWidth={2.2} />
              <Text style={s.transLabel}>翻訳</Text>
            </View>
            <Text style={s.body}>{trans.text}</Text>
          </View>
        ) : null}
        <View style={s.cmtFooter}>
          <TouchableOpacity onPress={() => onLike(c)} style={s.cmtAction} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
            <Heart size={13} color={c.liked ? '#E5484D' : '#B0A2C8'} fill={c.liked ? '#E5484D' : 'transparent'} strokeWidth={2} />
            {(c.likeCount ?? 0) > 0 && <Text style={[s.cmtActionText, c.liked && { color: '#E5484D' }]}>{c.likeCount}</Text>}
          </TouchableOpacity>
          {!isReply && (
            <TouchableOpacity onPress={() => onReply(c)} style={s.cmtAction} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
              <Text style={s.cmtActionText}>返信</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── 長押しメニュー（翻訳/コピー/通報/削除）: 下からスライドの角丸グループ ──────
function MenuRow({ Icon, label, danger, onPress }: {
  Icon: typeof Copy; label: string; danger?: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={s.menuRow} onPress={onPress} activeOpacity={0.7}
      accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={18} color={danger ? '#E5484D' : '#2D2240'} strokeWidth={2} />
      <Text style={[s.menuRowText, danger && { color: '#E5484D' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ActionMenu({ open, mine, hasTrans, bottomInset, onClose, onTranslate, onCopy, onReport, onBlock, onDelete }: {
  open: boolean; mine: boolean; hasTrans: boolean; bottomInset: number;
  onClose: () => void; onTranslate: () => void; onCopy: () => void; onReport: () => void; onBlock: () => void; onDelete: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      Animated.timing(anim, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setShown(false); });
    }
  }, [open, anim]);
  if (!shown) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(12,6,28,0.42)', opacity: anim }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="メニューを閉じる" />
      </Animated.View>
      <Animated.View style={[
        s.menuPanel,
        { paddingBottom: bottomInset + 10 },
        { transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [340, 0] }) }] },
      ]}>
        <View style={s.menuGroup}>
          <MenuRow Icon={Languages} label={hasTrans ? '原文を表示' : '翻訳する'} onPress={onTranslate} />
          <View style={s.menuDivider} />
          <MenuRow Icon={Copy} label="コピー" onPress={onCopy} />
          <View style={s.menuDivider} />
          <MenuRow Icon={Flag} label="通報する" onPress={onReport} />
          {!mine && (
            <>
              <View style={s.menuDivider} />
              <MenuRow Icon={Ban} label="この人をブロック" danger onPress={onBlock} />
            </>
          )}
          {mine && (
            <>
              <View style={s.menuDivider} />
              <MenuRow Icon={Trash2} label="削除" danger onPress={onDelete} />
            </>
          )}
        </View>
        <TouchableOpacity style={s.menuCancel} onPress={onClose} activeOpacity={0.8}>
          <Text style={s.menuCancelText}>キャンセル</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// 本文中の @id を色付き表示（メンションを見やすく）
function renderBody(body: string): React.ReactNode[] {
  return body.split(/(@[A-Za-z0-9_]{3,20})/g).map((p, i) =>
    /^@[A-Za-z0-9_]{3,20}$/.test(p) ? <Text key={i} style={s.mention}>{p}</Text> : p,
  );
}

// 返信を親の直下に並べる（親=新しい順・返信=古い順）。isReplyでインデント表示。
function buildThreaded(list: Comment[]): Array<Comment & { isReply?: boolean }> {
  const tops = list.filter((c) => !c.parentId);
  const byParent = new Map<string, Comment[]>();
  for (const c of list) if (c.parentId) { const a = byParent.get(c.parentId) ?? []; a.push(c); byParent.set(c.parentId, a); }
  const flat: Array<Comment & { isReply?: boolean }> = [];
  const shown = new Set<string>();
  for (const t of tops) {
    flat.push(t); shown.add(t.id);
    for (const r of (byParent.get(t.id) ?? []).slice().reverse()) { flat.push({ ...r, isReply: true }); shown.add(r.id); }
  }
  for (const c of list) if (!shown.has(c.id)) flat.push({ ...c, isReply: true });   // 親が消えた孤児返信の安全網
  return flat;
}

export default function CommentsSection({ targetId }: { targetId: string }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Comment[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);   // 返信先(親コメント)
  const isMounted = useRef(true);

  // 翻訳結果（コメントID→翻訳テキスト。もう一度「原文を表示」で消す）
  const [trans, setTrans] = useState<Record<string, Trans>>({});

  // ── ボトムシート（全コメント・画面の2/3）──
  const [sheetMounted, setSheetMounted] = useState(false);   // Modalのvisible（閉アニメ完了で下ろす）
  const [sheetOpen, setSheetOpen] = useState(false);         // アニメーションの向き
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const [kb, setKb] = useState(0);                           // キーボード高（シート内入力用）
  const [sheetNotice, setSheetNotice] = useState('');        // シート内ミニ通知（Modal上はルートToastが隠れるため）
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 長押しメニュー ──
  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFrom, setMenuFrom] = useState<'inline' | 'sheet'>('inline');
  const [inlineMenuVisible, setInlineMenuVisible] = useState(false);   // インライン用Modalのvisible

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
    return () => { isMounted.current = false; if (noticeTimer.current) clearTimeout(noticeTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  // キーボード高（シート内入力を持ち上げる）
  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEv, (e) => setKb(e.endCoordinates?.height ?? 0));
    const s2 = Keyboard.addListener(hideEv, () => setKb(0));
    return () => { s1.remove(); s2.remove(); };
  }, []);

  // シートの出入りアニメーション（閉じ終わったらModalを下ろす）
  useEffect(() => {
    if (!sheetMounted) return;
    Animated.timing(sheetAnim, {
      toValue: sheetOpen ? 1 : 0, duration: 280,
      easing: sheetOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished && !sheetOpen && isMounted.current) setSheetMounted(false); });
  }, [sheetOpen, sheetMounted, sheetAnim]);

  const openSheet = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSheetMounted(true);
    setSheetOpen(true);
  };
  const closeSheet = () => { Keyboard.dismiss(); setSheetOpen(false); };

  // Modal表示中はルートのToastが隠れるため、シート内は自前ミニ通知
  const notify = (title: string, subtitle?: string) => {
    if (sheetMounted) {
      setSheetNotice(title);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => { if (isMounted.current) setSheetNotice(''); }, 1600);
    } else {
      showToast(title, subtitle);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    try {
      const deviceId = await getDeviceId();
      const d = await apiFetch('/api/spot-comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', targetId, deviceId, body, parentId: replyTo?.id ?? undefined }),
      }).then((r) => r.json());
      if (d?.ok) {
        setText(''); setReplyTo(null);
        load();   // 追加後に再取得（@handle等をサーバー整形で揃える）
      } else {
        notify('コメントできませんでした', d?.error ?? '時間をおいてお試しください');
      }
    } catch { notify('コメントできませんでした', '通信に失敗しました'); }
    finally { if (isMounted.current) setSending(false); }
  };

  // コメントいいね（楽観的更新→サーバー整合）
  const toggleLike = async (c: Comment) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextLiked = !c.liked;
    setItems((prev) => prev.map((x) => x.id === c.id ? { ...x, liked: nextLiked, likeCount: Math.max(0, (x.likeCount ?? 0) + (nextLiked ? 1 : -1)) } : x));
    try {
      const deviceId = await getDeviceId();
      const d = await apiFetch('/api/spot-comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'like', commentId: c.id, deviceId }),
      }).then((r) => r.json());
      if (d?.ok && isMounted.current) setItems((prev) => prev.map((x) => x.id === c.id ? { ...x, liked: !!d.liked, likeCount: d.count ?? x.likeCount } : x));
    } catch { /* 失敗時は次のloadで整合 */ }
  };
  const startReply = (c: Comment) => { setReplyTo(c); };

  // @メンション補完: 末尾の @token を検知して候補を出し、タップで挿入
  const [mentionResults, setMentionResults] = useState<string[]>([]);
  const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeText = (t: string) => {
    setText(t);
    const m = t.match(/@([A-Za-z0-9_]{0,20})$/);
    if (mentionTimer.current) clearTimeout(mentionTimer.current);
    if (!m || m[1].length < 1) { setMentionResults([]); return; }
    const q = m[1];
    mentionTimer.current = setTimeout(async () => {
      try {
        const d = await apiFetch('/api/user-handle', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'search', q }),
        }).then((r) => r.json());
        if (isMounted.current) setMentionResults(Array.isArray(d?.handles) ? d.handles.slice(0, 6) : []);
      } catch { /* noop */ }
    }, 180);
  };
  const insertMention = (handle: string) => {
    setText((prev) => prev.replace(/@([A-Za-z0-9_]{0,20})$/, `@${handle} `));
    setMentionResults([]);
  };

  // ── 長押しメニュー開閉 ──
  const openMenu = (c: Comment, from: 'inline' | 'sheet') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenuFor(c);
    setMenuFrom(from);
    setMenuOpen(true);
    if (from === 'inline') setInlineMenuVisible(true);
  };
  const closeMenu = () => {
    setMenuOpen(false);
    setTimeout(() => {
      if (!isMounted.current) return;
      setInlineMenuVisible(false);
      setMenuFor(null);
    }, 230);
  };

  // ── メニューの各アクション ──
  const actCopy = async () => {
    const c = menuFor; closeMenu();
    if (!c) return;
    try {
      await Clipboard.setStringAsync(c.body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      notify('コピーしました');
    } catch { /* noop */ }
  };

  const actTranslate = async () => {
    const c = menuFor; closeMenu();
    if (!c) return;
    if (trans[c.id]?.status === 'done') {   // 原文を表示（翻訳を消す）
      setTrans((prev) => { const n = { ...prev }; delete n[c.id]; return n; });
      return;
    }
    setTrans((prev) => ({ ...prev, [c.id]: { status: 'loading' } }));
    try {
      const d = await apiFetch('/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: c.body }),
      }).then((r) => r.json());
      if (!isMounted.current) return;
      if (d?.ok && d.text) {
        setTrans((prev) => ({ ...prev, [c.id]: { status: 'done', text: String(d.text) } }));
      } else { throw new Error('translate失敗'); }
    } catch {
      if (isMounted.current) {
        setTrans((prev) => { const n = { ...prev }; delete n[c.id]; return n; });
        notify('翻訳できませんでした', '時間をおいてお試しください');
      }
    }
  };

  const actReport = () => {
    const c = menuFor; closeMenu();
    if (!c) return;
    setTimeout(() => {
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
            notify('通報しました', 'ご協力ありがとうございます');
          },
        },
      ]);
    }, 260);
  };

  const actDelete = () => {
    const c = menuFor; closeMenu();
    if (!c) return;
    setTimeout(() => {
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
            if (isMounted.current) setItems((prev) => prev.filter((x) => x.id !== c.id));
          },
        },
      ]);
    }, 260);
  };

  // 投稿者プロフィールへ（シートからは閉じてから遷移）
  const goUser = (c: Comment, fromSheet: boolean) => {
    if (!c.posterId) return;
    if (fromSheet) {
      closeSheet();
      setTimeout(() => router.push({ pathname: '/user/[id]', params: { id: c.posterId } }), 300);
    } else {
      router.push({ pathname: '/user/[id]', params: { id: c.posterId } });
    }
  };

  const threaded = buildThreaded(items);
  const inlineItems = threaded.slice(0, INLINE_MAX);
  const actBlock = () => {
    const c = menuFor; closeMenu();
    if (!c || !c.posterId) return;
    const pid = c.posterId;
    setTimeout(() => {
      Alert.alert('この投稿者をブロックしますか？', 'この人のコメントや投稿が表示されなくなります。', [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'ブロック', style: 'destructive', onPress: () => {
          blockUser(pid);
          setItems((prev) => prev.filter((x) => x.posterId !== pid));   // 表示中のコメントからも即消す
          notify('ブロックしました', 'この人のコメント・投稿を非表示にしました');
        } },
      ]);
    }, 260);
  };

  const menuProps = {
    mine: !!menuFor?.mine,
    hasTrans: !!(menuFor && trans[menuFor.id]?.status === 'done'),
    onClose: closeMenu, onTranslate: actTranslate, onCopy: actCopy, onReport: actReport, onBlock: actBlock, onDelete: actDelete,
  };

  const inputRow = (inSheet: boolean) => (
    <View>
      {replyTo ? (
        <View style={s.replyChip}>
          <Text style={s.replyChipText} numberOfLines={1}>@{replyTo.handle ?? 'MoodGoユーザー'} に返信</Text>
          <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="返信をやめる">
            <X size={13} color="#8B88A6" strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
      ) : null}
      {mentionResults.length > 0 ? (
        <View style={s.mentionBox}>
          {mentionResults.map((h) => (
            <TouchableOpacity key={h} onPress={() => insertMention(h)} style={s.mentionItem} activeOpacity={0.7}>
              <Text style={s.mentionItemText}>@{h}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      <View style={[s.inputRow, inSheet && s.inputRowSheet]}>
      <TextInput
        value={text}
        onChangeText={onChangeText}
        placeholder={replyTo ? '返信を書く…' : 'コメントを書く…'}
        placeholderTextColor="#B9B6CC"
        style={s.input}
        maxLength={200}
        multiline
      />
      <TouchableOpacity onPress={send} disabled={!text.trim() || sending}
        style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
        accessibilityRole="button" accessibilityLabel="コメントを送信">
        {sending ? <ActivityIndicator size="small" color="#fff" /> : <Send size={15} color="#fff" strokeWidth={2.4} />}
      </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={s.card}>
      <View style={s.head}>
        <MessageSquare size={16} color={PURPLE} strokeWidth={2.2} />
        <Text style={s.title}>コメント</Text>
        {items.length > 0 && <Text style={s.count}>{items.length}件</Text>}
      </View>

      {/* 入力行 */}
      {ready && inputRow(false)}

      {loading ? (
        <View style={s.centerPad}><ActivityIndicator color={PURPLE} size="small" /></View>
      ) : !ready ? (
        <Text style={s.emptyText}>コメント機能は準備中です</Text>
      ) : items.length === 0 ? (
        <Text style={s.emptyText}>最初のコメントを書いてみませんか？</Text>
      ) : (
        <>
          {inlineItems.map((c) => (
            <CommentRow key={c.id} c={c} trans={trans[c.id]} isReply={c.isReply}
              onLongPress={(cc) => openMenu(cc, 'inline')} onPressUser={(cc) => goUser(cc, false)}
              onLike={toggleLike} onReply={startReply} />
          ))}
          {items.length > INLINE_MAX && (
            <TouchableOpacity style={s.moreRow} onPress={openSheet} activeOpacity={0.8}
              accessibilityRole="button" accessibilityLabel="すべてのコメントを見る">
              <Text style={s.moreText}>すべてのコメントを見る（{items.length}件）</Text>
              <ChevronDown size={14} color={PURPLE} strokeWidth={2.4} />
            </TouchableOpacity>
          )}
        </>
      )}

      {/* ── インライン用 長押しメニュー（透明Modal・常時マウント+visibleトグル）── */}
      <Modal transparent visible={inlineMenuVisible} animationType="none" statusBarTranslucent onRequestClose={closeMenu}>
        <ActionMenu open={menuOpen && menuFrom === 'inline'} bottomInset={insets.bottom} {...menuProps} />
      </Modal>

      {/* ── 全コメントのボトムシート（画面の2/3・透明Modal・常時マウント+visibleトグル）── */}
      <Modal transparent visible={sheetMounted} animationType="none" statusBarTranslucent onRequestClose={closeSheet}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={[StyleSheet.absoluteFill, {
            backgroundColor: '#000',
            opacity: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] }),
          }]}>
            <Pressable style={{ flex: 1 }} onPress={closeSheet} accessibilityLabel="コメントを閉じる" />
          </Animated.View>

          <Animated.View style={[
            s.sheetPanel,
            {
              height: kb > 0 ? Math.min(SHEET_H, SCREEN_H - kb - 60) : SHEET_H,
              marginBottom: kb,
              transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [SHEET_H, 0] }) }],
            },
          ]}>
            <View style={s.grabber} />
            <View style={s.sheetHead}>
              <View style={{ width: 32 }} />
              <Text style={s.sheetTitle}>{items.length > 0 ? `${items.length}件のコメント` : 'コメント'}</Text>
              <TouchableOpacity onPress={closeSheet} style={s.sheetClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button" accessibilityLabel="閉じる">
                <X size={18} color="#4B3B6B" strokeWidth={2.4} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={threaded}
              keyExtractor={(c) => c.id}
              renderItem={({ item }) => (
                <CommentRow c={item} trans={trans[item.id]} isReply={item.isReply}
                  onLongPress={(cc) => openMenu(cc, 'sheet')} onPressUser={(cc) => goUser(cc, true)}
                  onLike={toggleLike} onReply={startReply} />
              )}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={<Text style={[s.emptyText, { paddingVertical: 28 }]}>最初のコメントを書いてみませんか？</Text>}
            />

            {/* シート下部の入力行 */}
            <View style={[s.sheetInputWrap, { paddingBottom: kb > 0 ? 10 : Math.max(insets.bottom, 10) }]}>
              {inputRow(true)}
            </View>

            {/* シート内ミニ通知（ルートToastはModalの下に隠れるため） */}
            {sheetNotice !== '' && (
              <View style={s.noticePill} pointerEvents="none">
                <Text style={s.noticeText}>{sheetNotice}</Text>
              </View>
            )}
          </Animated.View>

          {/* シート用 長押しメニュー（同じModal内のオーバーレイ） */}
          <ActionMenu open={menuOpen && menuFrom === 'sheet'} bottomInset={insets.bottom} {...menuProps} />
        </View>
      </Modal>
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
  inputRowSheet: { marginBottom: 0 },
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
  avatarSm: { width: 24, height: 24, borderRadius: 12 },
  replyRow: { paddingLeft: 26, borderTopWidth: 0, paddingVertical: 6 },
  cmtFooter: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 6 },
  cmtAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cmtActionText: { fontSize: 12, fontWeight: '700', color: '#8B88A6' },
  replyChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: '#F1ECFB', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 8 },
  replyChipText: { flex: 1, fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  handle: { fontSize: 12, fontWeight: '800', color: '#4B3B6B', flexShrink: 1 },
  time: { fontSize: 10.5, fontWeight: '500', color: '#9CA3AF' },
  mineTag: {
    fontSize: 9.5, fontWeight: '800', color: '#7C3AED',
    backgroundColor: '#F1EBFF', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1,
  },
  body: { fontSize: 13.5, color: '#2D2240', lineHeight: 20, marginTop: 3 },
  mention: { color: '#7C3AED', fontWeight: '700' },
  mentionBox: { backgroundColor: '#fff', borderRadius: 12, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#EDE9FB' },
  mentionItem: { paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F2EFF7' },
  mentionItemText: { fontSize: 13.5, fontWeight: '700', color: '#7C3AED' },
  hint: { fontSize: 10.5, color: '#B7B3C2', textAlign: 'center', marginTop: 8 },

  // 翻訳表示
  transLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  transLoadingText: { fontSize: 11, fontWeight: '600', color: '#8B88A6' },
  transBox: {
    marginTop: 6, backgroundColor: '#F7F4FE', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  transLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  transLabel: { fontSize: 10, fontWeight: '800', color: PURPLE },

  // すべて見る
  moreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 11, marginTop: 2, borderTopWidth: 1, borderTopColor: '#F2EFF7',
  },
  moreText: { fontSize: 12.5, fontWeight: '800', color: PURPLE },

  // ボトムシート（画面の2/3）
  sheetPanel: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 12,
  },
  grabber: {
    alignSelf: 'center', width: 40, height: 4.5, borderRadius: 3,
    backgroundColor: '#E4E0EE', marginTop: 8,
  },
  sheetHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#F2EFF7',
  },
  sheetTitle: { fontSize: 14, fontWeight: '800', color: '#1A0A2E' },
  sheetClose: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#F6F4FB',
    alignItems: 'center', justifyContent: 'center',
  },
  sheetInputWrap: {
    paddingHorizontal: 14, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: '#F2EFF7', backgroundColor: '#fff',
  },
  noticePill: {
    position: 'absolute', top: 52, alignSelf: 'center',
    backgroundColor: 'rgba(26,10,46,0.88)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8,
  },
  noticeText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // 長押しメニュー
  menuPanel: { position: 'absolute', left: 10, right: 10, bottom: 0 },
  menuGroup: { backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 15 },
  menuRowText: { fontSize: 14.5, fontWeight: '700', color: '#2D2240' },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(0,0,0,0.1)', marginLeft: 48 },
  menuCancel: {
    marginTop: 8, backgroundColor: '#fff', borderRadius: 18,
    alignItems: 'center', paddingVertical: 15,
  },
  menuCancelText: { fontSize: 14.5, fontWeight: '800', color: '#8B88A6' },
});
