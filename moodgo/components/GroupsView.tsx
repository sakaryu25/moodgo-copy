/**
 * GroupsView.tsx — 仲良しグループで「今の気分」をつぶやく（チャット形式）
 * - タブとして表示。グループを開くとチャット画面（タブバーは親側で非表示に）
 * - 自分のつぶやき: 右側の紫グラデバブル / メンバー: 左側の白バブル＋アバター
 * - 15秒ごとにフィード自動更新＋新着で自動スクロール
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import {
  Activity, BookOpen, Bot, Camera, Car, Check, ChevronLeft, Coffee, Copy, Dices,
  EyeOff, Flag, Flame, Heart, Languages, Laugh, Leaf, LogOut, MapPin, Meh, MessageCircle,
  Moon, Navigation, PartyPopper, Plane, Plus, Reply, Send, Settings, ShoppingBag,
  Shuffle, Sparkles, ThumbsUp, Undo2, UtensilsCrossed, Users, X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Image, KeyboardAvoidingView,
  Modal, PanResponder, Platform, Pressable, RefreshControl, ScrollView, Share,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground, { APP_BG } from '@/components/AppBackground';
import PuniPressable from '@/components/PuniPressable';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { openInGoogleMaps } from '@/lib/openMaps';
import { loadJSON, saveJSON, BLOCKED_USERS_KEY } from '@/lib/storage';
import { findNgWord } from '@/lib/ngwords';
import ReportModal from '@/components/ReportModal';
import type { FavoriteItem } from '@/types/app';

// ─── tokens ───────────────────────────────────────────────────────────────────
const PINK   = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE   = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const INK    = '#1E0753';

const NICKNAME_KEY = 'moodgo-group-nickname';
const POLL_MS = 15000; // チャット表示中の自動更新間隔

// つぶやき用の気分チップ（クイズの気分カードと同じSVGアイコン）
type MoodIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
const MOOD_CHIPS: { key: string; Icon: MoodIcon }[] = [
  { key: 'お腹すいた',   Icon: UtensilsCrossed },
  { key: 'まったり',     Icon: Coffee },
  { key: '自然',         Icon: Leaf },
  { key: '楽しみたい',   Icon: Sparkles },
  { key: 'ドライブ',     Icon: Car },
  { key: '集中',         Icon: BookOpen },
  { key: '運動',         Icon: Activity },
  { key: '旅行',         Icon: Plane },
  { key: 'ショッピング', Icon: ShoppingBag },
  { key: '時間潰し',     Icon: Shuffle },
  { key: '疲れた・眠い', Icon: Moon },
];
const moodIcon = (key: string): MoodIcon =>
  MOOD_CHIPS.find(m => m.key === key)?.Icon ?? MessageCircle;

type LastPost = {
  nickname: string; mood: string; comment: string | null;
  spot_name?: string | null; created_at: string;
};
type Group = {
  id: string; name: string; invite_code: string; member_count?: number;
  icon?: string | null;   // アイコン写真の公開URL
  last_post?: LastPost | null;
};

const isIconUrl = (icon?: string | null): icon is string => !!icon && icon.startsWith('http');
type Post  = {
  id: string; device_id: string; nickname: string; mood: string; comment: string | null;
  spot_name?: string | null; spot_address?: string | null; spot_url?: string | null;
  reply_to_name?: string | null; reply_to_text?: string | null;
  created_at: string;
};
type Member = { device_id: string; nickname: string; icon?: string | null };
type Reaction = { post_id: string; device_id: string; rtype: 'vote' | 'emoji'; value: string };

// メンバーアバター: 設定したプロフィール写真を表示（未設定/読込失敗なら頭文字）
function MemberAvatar({ icon, label, size = 36, style }: {
  icon?: string | null; label: string; size?: number; style?: object;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View
      style={[
        {
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: '#DDD6FE', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {icon && !failed ? (
        <Image
          source={{ uri: icon }}
          style={{ width: size, height: size }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={{ fontSize: Math.round(size * 0.39), fontWeight: '800', color: '#7C3AED' }}>
          {label.slice(0, 1)}
        </Text>
      )}
    </View>
  );
}

// 長押しで選べるリアクション（絵文字ではなくアプリ内アイコンで生成）
type RIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number; fill?: string }>;
const REACTIONS: { key: string; Icon: RIcon; color: string; fill?: string }[] = [
  { key: 'thumbs',  Icon: ThumbsUp,        color: '#7C3AED' },
  { key: 'heart',   Icon: Heart,           color: '#EC4899', fill: '#FBCFE8' },
  { key: 'fire',    Icon: Flame,           color: '#F97316', fill: '#FED7AA' },
  { key: 'laugh',   Icon: Laugh,           color: '#F59E0B' },
  { key: 'sparkle', Icon: Sparkles,        color: '#8B5CF6' },
  { key: 'food',    Icon: UtensilsCrossed, color: '#10B981' },
];
const reactionDef = (key: string) => REACTIONS.find(r => r.key === key);

// 相対時刻（たった今 / 3分前 / 2時間前 / 昨日 / 6/8）
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

type Props = {
  /** アクティブタブ再タップでチャットを閉じて一覧に戻す */
  resetKey?: number;
  /** チャット画面の開閉を親へ通知（タブバーの表示/非表示用） */
  onChatOpenChange?: (open: boolean) => void;
  /** いいねした場所・投稿（チャットからそのまま共有するため） */
  favorites?: FavoriteItem[];
};

export default function GroupsView({ resetKey = 0, onChatOpenChange, favorites = [] }: Props) {
  const insets = useSafeAreaInsets();

  const [deviceId, setDeviceId]   = useState('');
  const [nickname, setNickname]   = useState('');

  const [groups, setGroups]         = useState<Group[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 作成・参加フォーム（右上＋のモーダル内）
  const [showAdd, setShowAdd]           = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [joinCode, setJoinCode]         = useState('');
  const [busy, setBusy]                 = useState(false);

  // チャット（グループ詳細）
  const [active, setActive]   = useState<Group | null>(null);
  const [posts, setPosts]     = useState<Post[]>([]);   // 新しい順で保持・表示時に反転
  const [members, setMembers] = useState<Member[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [reactTarget, setReactTarget] = useState<string | null>(null);  // 長押し中の投稿ID
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; text: string } | null>(null);
  const [translated, setTranslated] = useState<Record<string, string>>({});  // postId→翻訳文
  const [hiddenPosts, setHiddenPosts] = useState<Set<string>>(new Set());     // 自分の端末だけで非表示
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);             // ブロックした投稿者(device_id)
  const [reportTarget, setReportTarget] = useState<Post | null>(null);        // 通報対象の投稿
  const [reactFrame, setReactFrame] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const bubbleRefs = useRef<Record<string, View | null>>({});
  const pickerAnim = useRef(new Animated.Value(0)).current;             // オーバーレイのヌルッと出現用

  useEffect(() => {
    if (!reactTarget) return;
    pickerAnim.setValue(0);
    Animated.spring(pickerAnim, {
      toValue: 1, useNativeDriver: true, mass: 0.6, damping: 11, stiffness: 230,
    }).start();
  }, [reactTarget]);

  // ブロックした投稿者を読み込み（端末ローカル・コミュニティフィードと共通のキー）
  useEffect(() => {
    loadJSON<string[]>(BLOCKED_USERS_KEY, []).then(setBlockedUsers).catch(() => {});
  }, []);

  // 投稿者をブロック（以後その端末の投稿を非表示に・App Store 1.2のブロック要件）
  const handleBlockUser = useCallback((blockId: string) => {
    if (!blockId) return;
    setBlockedUsers(prev => {
      if (prev.includes(blockId)) return prev;
      const next = [...prev, blockId];
      saveJSON(BLOCKED_USERS_KEY, next);
      return next;
    });
  }, []);

  // 長押し: バブルの画面位置を測ってインスタ風オーバーレイを開く
  const openReactions = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const node = bubbleRefs.current[id];
    if (!node) { setReactFrame(null); setReactTarget(id); return; }
    node.measureInWindow((x, y, w, h) => {
      setReactFrame({ x, y, w, h });
      setReactTarget(id);
    });
  };
  const closeReactions = () => {
    Animated.timing(pickerAnim, { toValue: 0, duration: 130, useNativeDriver: true })
      .start(() => setReactTarget(null));
  };

  // ルーレット
  const [showRoulette, setShowRoulette] = useState(false);
  const [rIdx, setRIdx] = useState(0);
  const [rDone, setRDone] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rouSel, setRouSel] = useState<Set<string>>(new Set());  // ルーレットに参加させる候補
  const spinRef = useRef(false);

  // 気分一致 → AI提案
  const [matchInfo, setMatchInfo] = useState<{ mood: string; count: number } | null>(null);
  const [matchBusy, setMatchBusy] = useState(false);
  const matchShownRef = useRef('');   // 同じ一致で何度も出さないため
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);

  // ── いいねから送るボトムシート ──
  const SHEET_H = Math.round(Dimensions.get('window').height * 0.52);
  const [showFavSheet, setShowFavSheet] = useState(false);
  const [favTab, setFavTab] = useState(0);             // 0=場所, 1=投稿
  const [sendingFav, setSendingFav] = useState(false);
  const sheetY = useRef(new Animated.Value(SHEET_H)).current;
  const favPagerRef = useRef<ScrollView>(null);

  const openFavSheet = () => {
    setFavTab(0);
    setShowFavSheet(true);
    sheetY.setValue(SHEET_H);
    Animated.spring(sheetY, {
      toValue: 0, useNativeDriver: true, mass: 0.7, damping: 16, stiffness: 180,
    }).start();
    requestAnimationFrame(() => favPagerRef.current?.scrollTo({ x: 0, animated: false }));
  };
  const closeFavSheet = () => {
    Animated.timing(sheetY, { toValue: SHEET_H, duration: 180, useNativeDriver: true })
      .start(() => setShowFavSheet(false));
  };

  // いいねした場所をこのグループにスポットカードとして送信
  const sendFavoriteSpot = async (f: FavoriteItem) => {
    if (!active || sendingFav) return;
    setSendingFav(true);
    try {
      const res = await apiFetch('/api/mood-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'post', groupId: active.id, deviceId,
          spotName: f.title,
          spotAddress: f.address ?? f.area ?? '',
          spotUrl: f.mapUrl ?? '',
        }),
      });
      const data = await res.json();
      if (!data.ok) { Alert.alert('エラー', data.error ?? '送信に失敗しました'); return; }
      setPosts(prev => [data.post, ...prev]);
      closeFavSheet();
    } catch { Alert.alert('エラー', '通信に失敗しました'); }
    finally { setSendingFav(false); }
  };
  const [selMood, setSelMood] = useState('');
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);
  const autoScrollRef = useRef(true);   // 新着メッセージ時だけ最下部へスクロールするフラグ
  const prevPostLenRef = useRef(0);

  // ── 左端スワイプでチャットから一覧へ戻る ──
  const SW = Dimensions.get('window').width;
  const dragX = useRef(new Animated.Value(0)).current;
  const closeChatRef = useRef<() => void>(() => {});
  const chatSwipePan = useRef(
    PanResponder.create({
      // 画面の左端(40px以内)から右方向のドラッグで開始
      onMoveShouldSetPanResponderCapture: (e, g) =>
        e.nativeEvent.pageX - g.dx < 40 && g.dx > 12 && Math.abs(g.dy) < Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dx > 0) dragX.setValue(g.dx);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx > SW / 3 || g.vx > 0.8) {
          // しきい値超え → 画面外までスライドして閉じる
          // dragXはSWのまま閉じる（先に0へ戻すとチャットが一瞬全画面に戻って見える）。
          // 一覧に戻った後 useEffect で dragX を0にリセットする。
          Animated.timing(dragX, { toValue: SW, duration: 160, useNativeDriver: true }).start(() => {
            closeChatRef.current();
          });
        } else {
          Animated.spring(dragX, { toValue: 0, useNativeDriver: true, mass: 0.8, damping: 18, stiffness: 240 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragX, { toValue: 0, useNativeDriver: true, mass: 0.8, damping: 18, stiffness: 240 }).start();
      },
    })
  ).current;

  // ── 初期化 ──
  useEffect(() => {
    (async () => {
      const id = await getDeviceId();
      setDeviceId(id);
      const nick = (await AsyncStorage.getItem(NICKNAME_KEY)) ?? '';
      setNickname(nick);
      try {
        const raw = await AsyncStorage.getItem('moodgo-hidden-posts');
        if (raw) setHiddenPosts(new Set(JSON.parse(raw) as string[]));
      } catch { /* ignore */ }
      await fetchGroups(id);
      setLoading(false);
    })();
  }, []);

  // ── 長押しメニューの各アクション ──
  const HIDDEN_KEY = 'moodgo-hidden-posts';
  const postText = (p: Post) =>
    [p.spot_name, p.spot_address, p.mood ? `#${p.mood}` : '', p.comment].filter(Boolean).join(' ').trim();

  const actCopy = async (p: Post) => {
    await Clipboard.setStringAsync(postText(p) || p.comment || '');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const actReply = (p: Post) => {
    setReplyTo({ id: p.id, name: p.nickname, text: (p.spot_name || p.comment || `#${p.mood}`).slice(0, 60) });
  };

  const actTranslate = async (p: Post) => {
    const src = p.comment || p.spot_name || '';
    if (!src) return;
    if (translated[p.id]) { setTranslated(t => { const n = { ...t }; delete n[p.id]; return n; }); return; } // 再タップで戻す
    try {
      const res = await apiFetch('/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: src }),
      });
      const data = await res.json();
      if (data.ok) setTranslated(t => ({ ...t, [p.id]: data.text }));
      else Alert.alert('翻訳できませんでした', data.error ?? '');
    } catch { Alert.alert('エラー', '翻訳に失敗しました'); }
  };

  const actHideForMe = async (p: Post) => {
    const next = new Set(hiddenPosts); next.add(p.id);
    setHiddenPosts(next);
    await AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])).catch(() => {});
  };

  const actUnsend = (p: Post) => {
    if (!active) return;
    Alert.alert('送信を取り消す', 'このメッセージをみんなの画面から消します。よろしいですか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '取り消す', style: 'destructive',
        onPress: async () => {
          setPosts(prev => prev.filter(x => x.id !== p.id));   // 楽観的に消す
          try {
            const res = await apiFetch('/api/mood-groups', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'unsend', groupId: active.id, deviceId, postId: p.id }),
            });
            const data = await res.json();
            if (!data.ok) { fetchGroupDetail(active, deviceId); Alert.alert('エラー', data.error ?? '取り消しに失敗しました'); }
          } catch { fetchGroupDetail(active, deviceId); Alert.alert('エラー', '通信に失敗しました'); }
        },
      },
    ]);
  };

  // タブ再タップ → チャットを閉じて一覧へ
  useEffect(() => {
    if (resetKey > 0) closeChat();
  }, [resetKey]);

  // アンマウント時はタブバーを戻す
  useEffect(() => () => onChatOpenChange?.(false), []);

  // チャット表示中は定期的に新着を取得
  useEffect(() => {
    if (!active || !deviceId) return;
    const t = setInterval(() => fetchGroupDetail(active, deviceId), POLL_MS);
    return () => clearInterval(t);
  }, [active, deviceId]);

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
      if (data.ok) {
        setPosts(data.posts); setMembers(data.members);
        setReactions(data.reactions ?? []);
        // アイコンなど他メンバーの変更を反映
        if (data.group) setActive(a => (a && a.id === data.group.id ? { ...a, ...data.group } : a));
      }
    } catch { /* keep */ }
  }, []);

  // 名前は設定（プロフィール）で入力したものを使う
  const requireNickname = (): string | null => {
    const nick = nickname.trim().slice(0, 20);
    if (!nick) {
      Alert.alert(
        '名前を設定してね',
        'ホーム右上の⚙設定 → プロフィールの「名前」を入れると、グループを作成・参加できるよ',
      );
      return null;
    }
    return nick;
  };

  // ＋モーダルを開く（設定で変えた名前を読み直す）
  const openAdd = async () => {
    const nick = (await AsyncStorage.getItem(NICKNAME_KEY)) ?? '';
    setNickname(nick);
    setShowAdd(true);
  };

  // ── グループ作成 ──
  const handleCreate = async () => {
    const name = newGroupName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const nick = requireNickname();
      if (!nick) return;
      const res = await apiFetch('/api/mood-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, nickname: nick, deviceId }),
      });
      const data = await res.json();
      if (!data.ok) { Alert.alert('エラー', data.error ?? '作成に失敗しました'); return; }
      setNewGroupName('');
      setShowAdd(false);
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
    if (!code || busy) return;
    setBusy(true);
    try {
      const nick = requireNickname();
      if (!nick) return;
      const res = await apiFetch('/api/mood-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code, nickname: nick, deviceId }),
      });
      const data = await res.json();
      if (!data.ok) { Alert.alert('エラー', data.error ?? '参加に失敗しました'); return; }
      setJoinCode('');
      setShowAdd(false);
      await fetchGroups(deviceId);
      openGroup(data.group);
    } catch { Alert.alert('エラー', '通信に失敗しました'); }
    finally { setBusy(false); }
  };

  const openGroup = (g: Group) => {
    setActive(g); setPosts([]); setMembers([]); setSelMood(''); setComment('');
    setShowGroupSettings(false); setIconBusy(false);
    onChatOpenChange?.(true);
    fetchGroupDetail(g, deviceId);
    // 右からスライドイン（戻る時と対になる動き）
    dragX.setValue(SW);
    Animated.timing(dragX, { toValue: 0, duration: 220, useNativeDriver: true }).start();
  };

  // ── アイコン変更（写真を選んで512pxに縮小→アップロード） ──
  const handlePickIcon = async () => {
    if (!active || iconBusy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('写真へのアクセスが必要です', '設定アプリからMoodGoに写真の許可をしてね');
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
      const res = await apiFetch('/api/mood-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_icon_photo', groupId: active.id, deviceId, imageBase64: small.base64,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? '変更に失敗しました');
      const url = data.icon as string;
      setActive(a => (a ? { ...a, icon: url } : a));
      setGroups(gs => gs.map(g => (g.id === active.id ? { ...g, icon: url } : g)));
    } catch (e) {
      Alert.alert('エラー', e instanceof Error ? e.message : '変更に失敗しました');
    } finally { setIconBusy(false); }
  };

  const closeChat = () => {
    setActive(null);
    setShowGroupSettings(false);
    setShowFavSheet(false);
    onChatOpenChange?.(false);
    if (deviceId) fetchGroups(deviceId); // 一覧の最新メッセージプレビューを更新
  };

  // 戻るボタン: スワイプバックと同じスライドアニメで閉じる
  // dragXはSWのまま閉じる（先に0へ戻すとチャットが一瞬全画面に戻って見える＝チラつきの原因）
  const animateCloseChat = () => {
    Animated.timing(dragX, { toValue: SW, duration: 200, useNativeDriver: true }).start(() => {
      closeChat();
    });
  };
  closeChatRef.current = closeChat;

  // チャットが閉じきって一覧に戻ったら dragX を0へ戻す（チャット未マウントなので見た目に影響なし）
  useEffect(() => {
    if (!active) dragX.setValue(0);
  }, [active]);

  // メッセージ件数が増えたときだけ「最下部へスクロール」を許可（リアクションでは下げない）
  useEffect(() => {
    if (posts.length > prevPostLenRef.current) autoScrollRef.current = true;
    prevPostLenRef.current = posts.length;
  }, [posts.length]);

  // ── つぶやく ──
  // 気分チップ・ひとことのどちらか一方でも入っていれば送信できる
  const handlePost = async () => {
    if (!active || (!selMood && !comment.trim()) || posting) return;
    // 不適切語のクライアント側フィルタ（サーバー側でも再チェック）
    const ng = findNgWord(comment.trim());
    if (ng) { Alert.alert('投稿できません', '不適切な表現が含まれています。'); return; }
    setPosting(true);
    try {
      const res = await apiFetch('/api/mood-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'post', groupId: active.id, deviceId, mood: selMood, comment: comment.trim(),
          replyToName: replyTo?.name ?? '', replyToText: replyTo?.text ?? '',
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setReplyTo(null);
        setPosts(prev => [data.post, ...prev]);
        setSelMood(''); setComment('');
        // 全員の気分が揃った！ → お祝い＋AI提案の案内（同じ一致では1回だけ）
        if (data.moodMatch) {
          const key = `${active.id}:${data.moodMatch.mood}`;
          if (matchShownRef.current !== key) {
            matchShownRef.current = key;
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setMatchInfo(data.moodMatch);
          }
        }
      } else {
        Alert.alert('エラー', data.error ?? '投稿に失敗しました');
      }
    } catch { Alert.alert('エラー', '通信に失敗しました'); }
    finally { setPosting(false); }
  };

  // ── 投票・絵文字リアクション（楽観更新＋失敗時は再取得で復元） ──
  const sendReaction = async (postId: string, rtype: 'vote' | 'emoji', value: string) => {
    if (!active) return;
    Haptics.selectionAsync();
    setReactions(prev => {
      const i = prev.findIndex(r => r.post_id === postId && r.device_id === deviceId && r.rtype === rtype);
      if (i >= 0) {
        const next = prev.slice();
        const mine = next.splice(i, 1)[0];
        if (mine.value !== value) next.push({ post_id: postId, device_id: deviceId, rtype, value });
        return next;
      }
      return [...prev, { post_id: postId, device_id: deviceId, rtype, value }];
    });
    try {
      const res = await apiFetch('/api/mood-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'react', groupId: active.id, deviceId, postId, rtype, value }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'リアクションに失敗しました');
    } catch (e) {
      fetchGroupDetail(active, deviceId);
      Alert.alert('エラー', e instanceof Error ? e.message : 'リアクションに失敗しました');
    }
  };

  // ── ルーレット（共有済みスポットから1つに決定） ──
  const rouletteCands = (() => {
    const seen = new Set<string>();
    const out: Post[] = [];
    for (const p of posts) {
      if (!p.spot_name || seen.has(p.spot_name)) continue;
      seen.add(p.spot_name);
      out.push(p);
      if (out.length >= 8) break;
    }
    return out;
  })();

  // ルーレットに参加させる候補（チェックを付けたものだけ）
  const rouSelCands = rouletteCands.filter(c => rouSel.has(c.id));

  const toggleRouSel = (id: string) => {
    if (spinRef.current) return;  // 回転中は変更不可
    Haptics.selectionAsync();
    setRDone(false);
    setRIdx(0);
    setRouSel(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startRoulette = () => {
    const n = rouSelCands.length;
    if (spinRef.current || n < 2) return;
    spinRef.current = true;
    setSpinning(true);
    setRDone(false);
    const total = 16 + Math.floor(Math.random() * n * 2);
    let step = 0;
    let cur = rIdx % n;
    const tick = () => {
      cur = (cur + 1) % n;
      setRIdx(cur);
      Haptics.selectionAsync();
      step++;
      if (step < total) {
        setTimeout(tick, 55 + ((step / total) ** 2) * 330);  // だんだん減速
      } else {
        spinRef.current = false;
        setSpinning(false);
        setRDone(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    };
    tick();
  };

  const sendRouletteResult = async () => {
    const win = rouSelCands[rIdx];
    if (!active || !win) return;
    setShowRoulette(false);
    try {
      const res = await apiFetch('/api/mood-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'post', groupId: active.id, deviceId,
          spotName: win.spot_name, spotAddress: win.spot_address ?? '', spotUrl: win.spot_url ?? '',
          comment: 'ルーレットで決定！',
        }),
      });
      const data = await res.json();
      if (data.ok) setPosts(prev => [data.post, ...prev]);
    } catch { /* 失敗時は次のポーリングに任せる */ }
  };

  // ── 気分一致 → AIがおすすめを探してチャットに投下 ──
  const runMoodMatchSearch = async () => {
    if (!active || !matchInfo || matchBusy) return;
    setMatchBusy(true);
    try {
      // 現在地（取れなければ位置なしで検索）
      let lat: number | undefined, lng: number | undefined;
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.granted) {
          const pos = (await Location.getLastKnownPositionAsync()) ??
            (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
          lat = pos?.coords.latitude; lng = pos?.coords.longitude;
        }
      } catch { /* 位置なしで続行 */ }

      const res = await apiFetch('/api/recommend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: {
            mood: matchInfo.mood,
            companion: '友達',
            freeWord: matchInfo.count >= 4 ? `${matchInfo.count}人で行ける場所` : '',
            radiusKm: 8,
            areaMode: 'current_location',
            originLat: lat, originLng: lng,
            dynamicQs: [],
          },
        }),
      });
      const d = await res.json();
      type Rec = { title: string; address?: string; mapUrl?: string };
      const recs: Rec[] = (d.recommendations ?? d.data ?? []).slice(0, 3);
      if (recs.length === 0) {
        Alert.alert('ごめん！', 'いまの条件ではおすすめが見つからなかったよ');
        return;
      }
      // MoodGo名義で前置き＋スポットカードを投下
      const postBody = (extra: Record<string, unknown>) =>
        apiFetch('/api/mood-groups', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'post', groupId: active.id, deviceId, asBot: true, ...extra }),
        });
      await postBody({
        mood: matchInfo.mood,
        comment: `全員「${matchInfo.mood}」気分！${matchInfo.count}人へのおすすめを見つけたよ`,
      });
      for (const r of recs) {
        await postBody({ spotName: r.title, spotAddress: r.address ?? '', spotUrl: r.mapUrl ?? '' });
      }
      await fetchGroupDetail(active, deviceId);
      setMatchInfo(null);
    } catch {
      Alert.alert('エラー', 'おすすめの取得に失敗しました');
    } finally { setMatchBusy(false); }
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
          closeChat();
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

  const goFavTab = (i: number) => {
    setFavTab(i);
    favPagerRef.current?.scrollTo({ x: i * SW, animated: true });
  };

  // ─── チャット画面 ────────────────────────────────────────────────────────────
  if (active) {
    const canPost = (!!selMood || !!comment.trim()) && !posting;
    // 「自分のトークだけ消す」で隠した投稿を除外して、古い→新しい順に
    const timeline = posts.filter(p => !hiddenPosts.has(p.id) && !blockedUsers.includes(p.device_id)).slice().reverse();
    const placeFavs = favorites.filter(f => f.kind !== 'post');
    const postFavs  = favorites.filter(f => f.kind === 'post');

    // バブルの中身（タイムラインと長押しオーバーレイの両方で使う共通描画）
    const bubbleInner = (p: Post) => {
      const isBot = p.nickname === 'MoodGo';
      const mine = p.device_id === deviceId && !isBot;
      const darkMood = p.mood === '疲れた・眠い';
      const isSpot = !!p.spot_name;

      // リアクション集計
      const rx = reactions.filter(r => r.post_id === p.id);
      const emojiAgg = new Map<string, { count: number; mine: boolean }>();
      for (const r of rx) {
        if (r.rtype !== 'emoji') continue;
        const e = emojiAgg.get(r.value) ?? { count: 0, mine: false };
        e.count++;
        if (r.device_id === deviceId) e.mine = true;
        emojiAgg.set(r.value, e);
      }
      const wantCount = rx.filter(r => r.rtype === 'vote' && r.value === 'want').length;
      const mehCount  = rx.filter(r => r.rtype === 'vote' && r.value === 'meh').length;
      const myVote = rx.find(r => r.rtype === 'vote' && r.device_id === deviceId)?.value;
      const decided = members.length >= 2 && wantCount > members.length / 2;
      const hasChips = emojiAgg.size > 0 || wantCount > 0 || mehCount > 0;

      // 値札タグ風の気分バッジ（尖った先端＋紐穴）
      const moodTag = () => {
        const c = darkMood
          ? { bg: '#1E1B4B', border: '#4338CA', text: '#C7D2FE', hole: mine ? '#C084FC' : '#fff' }
          : mine
            ? { bg: '#fff', border: '#fff', text: '#7C3AED', hole: '#C084FC' }
            : { bg: '#EDE9FE', border: '#DDD6FE', text: '#7C3AED', hole: '#fff' };
        const TagIcon = moodIcon(p.mood);
        return (
          <View style={s.tagRow}>
            <View style={[s.tagPoint, { backgroundColor: c.bg, borderColor: c.border }]} />
            <View style={[s.tagBody, { backgroundColor: c.bg, borderColor: c.border }]}>
              <TagIcon size={12} color={c.text} strokeWidth={2.2} />
              <Text style={[s.moodTagText, { color: c.text }]}>#{p.mood}</Text>
            </View>
            <View style={[s.tagHole, { backgroundColor: c.hole }]} />
          </View>
        );
      };

      // スポット共有: ピンカード（タップで地図アプリを直接開く）
      const spotCard = () => (
        <PuniPressable
          onPress={() => {
            if (!p.spot_name && !p.spot_url) return;
            openInGoogleMaps({
              query: [p.spot_name, p.spot_address].filter(Boolean).join(' '),
              mapsUri: p.spot_url ?? undefined,
            });
          }}
          style={[s.spotCard, mine ? s.spotCardMine : null]}
        >
          <View style={s.spotCardLabelRow}>
            <MapPin size={10} color="#A78BFA" strokeWidth={2.4} />
            <Text style={s.spotCardLabel}>おすすめスポット</Text>
          </View>
          <Text style={s.spotCardName}>{p.spot_name}</Text>
          {p.spot_address ? <Text style={s.spotCardAddr} numberOfLines={1}>{p.spot_address}</Text> : null}
          {p.spot_url ? (
            <View style={s.spotCardLinkRow}>
              <MapPin size={11} color="#7C3AED" strokeWidth={2.2} />
              <Text style={s.spotCardLink}>地図で見る</Text>
            </View>
          ) : null}
        </PuniPressable>
      );

      return (
        <>
          {/* 返信の引用 */}
          {p.reply_to_text ? (
            <View style={[s.replyQuote, mine && s.replyQuoteMine]}>
              <Text style={s.replyQuoteName} numberOfLines={1}>{p.reply_to_name || 'メンバー'}</Text>
              <Text style={s.replyQuoteText} numberOfLines={2}>{p.reply_to_text}</Text>
            </View>
          ) : null}
          {/* スポット共有ならカード、気分があれば値札タグ、ひとことだけなら何も出さない */}
          {isSpot ? spotCard() : (p.mood ? moodTag() : null)}
          {p.comment ? (
            <Text style={mine ? s.bubbleMineText : s.bubbleOtherText}>{p.comment}</Text>
          ) : null}
          {/* 翻訳結果 */}
          {translated[p.id] ? (
            <View style={s.translateBox}>
              <Text style={s.translateLabel}>翻訳</Text>
              <Text style={mine ? s.bubbleMineText : s.bubbleOtherText}>{translated[p.id]}</Text>
            </View>
          ) : null}
          {hasChips && (
            <View style={s.reactChips}>
              {wantCount > 0 && (
                <PuniPressable
                  onPress={() => sendReaction(p.id, 'vote', 'want')}
                  style={[s.reactChip, myVote === 'want' && s.voteChipOnWant]}
                >
                  <Heart size={12} color="#10B981" fill="#D1FAE5" strokeWidth={2.2} />
                  <Text style={s.reactChipText}>行きたい {wantCount}</Text>
                </PuniPressable>
              )}
              {mehCount > 0 && (
                <PuniPressable
                  onPress={() => sendReaction(p.id, 'vote', 'meh')}
                  style={[s.reactChip, myVote === 'meh' && s.voteChipOnMeh]}
                >
                  <Meh size={12} color="#F97316" strokeWidth={2.2} />
                  <Text style={s.reactChipText}>微妙 {mehCount}</Text>
                </PuniPressable>
              )}
              {decided && (
                <View style={s.decidedBadge}>
                  <PartyPopper size={11} color="#92400E" strokeWidth={2.2} />
                  <Text style={s.decidedText}>決定！</Text>
                </View>
              )}
              {[...emojiAgg.entries()].map(([key, info]) => {
                const def = reactionDef(key);
                return (
                  <PuniPressable
                    key={key}
                    onPress={() => sendReaction(p.id, 'emoji', key)}
                    style={[s.reactChip, info.mine && s.reactChipMine]}
                  >
                    {def
                      ? <def.Icon size={12} color={def.color} fill={def.fill ?? 'none'} strokeWidth={2.2} />
                      : <Text style={s.reactChipText}>{key}</Text>}
                    <Text style={s.reactChipText}>{info.count}</Text>
                  </PuniPressable>
                );
              })}
            </View>
          )}
        </>
      );
    };
    return (
      <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={closeChat}>
        {/* フルスクリーンModalで包み、チャット中はネイティブタブバーを隠す（没入） */}
        <View style={{ flex: 1 }}>
        {/* 背面: グループ一覧（スワイプバック時にLINEのように透けて見える。パララックス＋薄暗→明転） */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [{
                translateX: dragX.interpolate({
                  inputRange: [0, SW], outputRange: [-SW * 0.28, 0], extrapolate: 'clamp',
                }),
              }],
            },
          ]}
        >
          {renderListScreen()}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: '#000',
                opacity: dragX.interpolate({ inputRange: [0, SW], outputRange: [0.14, 0], extrapolate: 'clamp' }),
              },
            ]}
          />
        </Animated.View>

        {/* 前面: チャット（不透明背景＋左端の影付きでスライド） */}
        <KeyboardAvoidingView style={StyleSheet.absoluteFill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View
          style={[s.chatRoot, { paddingTop: insets.top, transform: [{ translateX: dragX }] }]}
          {...chatSwipePan.panHandlers}
        >
          <AppBackground />
          {/* ヘッダー */}
          <View style={s.header}>
            <PuniPressable onPress={animateCloseChat} style={s.backCircle}>
              <ChevronLeft size={20} color="#7C3AED" strokeWidth={2.5} />
            </PuniPressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {isIconUrl(active.icon) && (
                  <Image source={{ uri: active.icon }} style={s.headerIconImg} />
                )}
                <Text style={s.headerTitle} numberOfLines={1}>{active.name}</Text>
              </View>
              <PuniPressable onPress={() => shareCode(active)} style={s.codeChip}>
                <Copy size={10} color="#7C3AED" strokeWidth={2} />
                <Text style={s.codeChipText}>{active.invite_code}</Text>
              </PuniPressable>
            </View>
            <PuniPressable onPress={() => setShowGroupSettings(true)} style={s.backCircle}>
              <Settings size={18} color="#7C3AED" strokeWidth={2} />
            </PuniPressable>
          </View>

          {/* メンバー */}
          {members.length > 0 && (
            <View style={s.membersLineRow}>
              <Users size={12} color="#7C6BA8" strokeWidth={2.2} />
              <Text style={s.membersLine} numberOfLines={1}>
                {members.map(m => m.nickname).join('・')}
              </Text>
            </View>
          )}

          {/* チャットタイムライン */}
          <ScrollView
            ref={chatScrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE} />}
            onContentSizeChange={() => {
              // 新着メッセージのときだけ最下部へ。リアクション等の高さ変化では下げない
              if (autoScrollRef.current) {
                chatScrollRef.current?.scrollToEnd({ animated: true });
                autoScrollRef.current = false;
              }
            }}
            keyboardShouldPersistTaps="handled"
          >
            {timeline.length === 0 ? (
              <View style={s.emptyBox}>
                <MessageCircle size={36} color="#C4B5FD" strokeWidth={1.5} />
                <Text style={s.emptyText}>まだつぶやきがないよ{'\n'}最初の気分をつぶやいてみて！</Text>
              </View>
            ) : timeline.map(p => {
              const isBot = p.nickname === 'MoodGo';
              const mine = p.device_id === deviceId && !isBot;  // AI投稿は常に左側に出す
              if (mine) {
                // 自分: 右側の紫グラデバブル（長押しでインスタ風リアクション）
                return (
                  <View key={p.id} style={s.rowMine}>
                    <Text style={s.bubbleTime}>{timeAgo(p.created_at)}</Text>
                    <Pressable
                      ref={(r) => { bubbleRefs.current[p.id] = r; }}
                      onLongPress={() => openReactions(p.id)}
                      delayLongPress={250}
                      style={s.bubbleMine}
                    >
                      {bubbleInner(p)}
                    </Pressable>
                  </View>
                );
              }
              // メンバー / MoodGo AI: 左側の白バブル＋アバター
              return (
                <View key={p.id} style={s.rowOther}>
                  {isBot ? (
                    <View style={[s.avatar, s.avatarBot]}>
                      <Bot size={17} color="#7C3AED" strokeWidth={2.2} />
                    </View>
                  ) : (
                    <MemberAvatar
                      icon={members.find(m => m.device_id === p.device_id)?.icon}
                      label={p.nickname}
                      size={32}
                      style={{ marginTop: 16 }}
                    />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.otherNick}>{p.nickname}</Text>
                    <View style={s.rowOtherBubbleLine}>
                      <Pressable
                        ref={(r) => { bubbleRefs.current[p.id] = r; }}
                        onLongPress={() => openReactions(p.id)}
                        delayLongPress={250}
                        style={s.bubbleOther}
                      >
                        {bubbleInner(p)}
                      </Pressable>
                      <Text style={s.bubbleTime}>{timeAgo(p.created_at)}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* つぶやき入力 */}
          <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            {/* 返信プレビュー */}
            {replyTo && (
              <View style={s.replyBar}>
                <View style={s.replyBarAccent} />
                <View style={{ flex: 1 }}>
                  <Text style={s.replyBarName} numberOfLines={1}>{replyTo.name} に返信</Text>
                  <Text style={s.replyBarText} numberOfLines={1}>{replyTo.text}</Text>
                </View>
                <PuniPressable onPress={() => setReplyTo(null)} style={s.replyBarClose}>
                  <X size={15} color="#7C3AED" strokeWidth={2.5} />
                </PuniPressable>
              </View>
            )}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.chipRow}
              keyboardShouldPersistTaps="always"
            >
              {MOOD_CHIPS.map(m => {
                const on = selMood === m.key;
                const dark = m.key === '疲れた・眠い';
                const iconColor = on ? '#fff' : dark ? '#C7D2FE' : '#7C3AED';
                return (
                  <PuniPressable
                    key={m.key}
                    onPress={() => setSelMood(on ? '' : m.key)}
                    style={[s.chip, dark && s.chipDark, on && (dark ? s.chipOnDark : s.chipOn)]}
                  >
                    <m.Icon size={13} color={iconColor} strokeWidth={2.2} />
                    <Text style={[s.chipText, dark && s.chipTextDark, on && s.chipTextOn]}>{m.key}</Text>
                  </PuniPressable>
                );
              })}
            </ScrollView>
            <View style={s.inputRow}>
              {/* いいねした場所をそのまま送る */}
              <PuniPressable onPress={openFavSheet} style={s.favHeartBtn}>
                <Heart size={18} color="#EC4899" fill="#FBCFE8" strokeWidth={2} />
              </PuniPressable>
              {/* ルーレットで行き先を決める */}
              <PuniPressable
                onPress={() => {
                  if (rouletteCands.length < 2) {
                    Alert.alert('候補が足りないよ', 'スポットを2件以上シェアするとルーレットで決められるよ');
                    return;
                  }
                  setRouSel(new Set(rouletteCands.map(c => c.id)));  // 最初は全員参加
                  setRDone(false);
                  setRIdx(0);
                  setShowRoulette(true);
                }}
                style={s.diceBtn}
              >
                <Dices size={20} color="#7C3AED" strokeWidth={2} />
              </PuniPressable>
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

          {/* グループ設定モーダル: アイコン・招待コード・メンバー・退会 */}
          <Modal
            visible={showGroupSettings}
            transparent
            animationType="fade"
            onRequestClose={() => setShowGroupSettings(false)}
          >
            <View style={s.modalOverlay}>
              <View style={[s.modalCard, { maxHeight: '78%' }]}>
                <View style={s.modalHeader}>
                  <Text style={s.modalTitle}>グループ設定</Text>
                  <PuniPressable onPress={() => setShowGroupSettings(false)} style={s.modalClose}>
                    <X size={18} color="#7C3AED" strokeWidth={2.5} />
                  </PuniPressable>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* アイコン（タップで写真を選択）＋グループ名 */}
                  <View style={{ alignItems: 'center' }}>
                    <PuniPressable onPress={handlePickIcon} disabled={iconBusy} style={s.bigIconCircle}>
                      {isIconUrl(active.icon)
                        ? <Image source={{ uri: active.icon }} style={s.bigIconImg} />
                        : <Text style={s.bigIconLetter}>{active.name.slice(0, 1)}</Text>}
                      {iconBusy ? (
                        <View style={s.iconBusyOverlay}>
                          <ActivityIndicator color="#fff" />
                        </View>
                      ) : (
                        <View style={s.iconEditBadge}>
                          <Camera size={12} color="#fff" strokeWidth={2.5} />
                        </View>
                      )}
                    </PuniPressable>
                    <Text style={s.iconHint}>タップして写真を変更</Text>
                    <Text style={s.settingsGroupName} numberOfLines={1}>{active.name}</Text>
                    <Text style={s.settingsMeta}>メンバー {members.length}人</Text>
                  </View>

                  {/* 招待コード */}
                  <Text style={s.label}>招待コード</Text>
                  <PuniPressable onPress={() => shareCode(active)} style={s.codeRow}>
                    <Text style={s.codeRowText}>{active.invite_code}</Text>
                    <View style={s.codeShareChip}>
                      <Copy size={12} color="#7C3AED" strokeWidth={2.2} />
                      <Text style={s.codeShareText}>共有</Text>
                    </View>
                  </PuniPressable>

                  {/* メンバー一覧 */}
                  <Text style={[s.label, { marginTop: 18 }]}>メンバー（{members.length}）</Text>
                  {members.map(m => (
                    <View key={m.device_id} style={s.memberRow}>
                      <MemberAvatar icon={m.icon} label={m.nickname} size={36} />
                      <Text style={s.memberNick} numberOfLines={1}>{m.nickname}</Text>
                      {m.device_id === deviceId && <Text style={s.meBadge}>自分</Text>}
                    </View>
                  ))}

                  {/* 退会 */}
                  <PuniPressable
                    onPress={() => { setShowGroupSettings(false); handleLeave(); }}
                    style={s.leaveBtn}
                  >
                    <LogOut size={15} color="#F43F5E" strokeWidth={2.2} />
                    <Text style={s.leaveText}>グループを抜ける</Text>
                  </PuniPressable>
                </ScrollView>
              </View>
            </View>
          </Modal>

          {/* インスタ風リアクションオーバーレイ: 背景ブラー＋押したバブルがその場に残り、上にバー・下に投票 */}
          <Modal visible={!!reactTarget} transparent animationType="none" onRequestClose={closeReactions}>
            {(() => {
              const tp = posts.find(pp => pp.id === reactTarget);
              if (!tp) return <View />;
              const isBotT = tp.nickname === 'MoodGo';
              const mineT = tp.device_id === deviceId && !isBotT;
              const isSpotT = !!tp.spot_name;
              const SH = Dimensions.get('window').height;
              const f = reactFrame ?? { x: 16, y: SH * 0.38, w: SW - 32, h: 60 };
              const BAR_W = REACTIONS.length * 44 + 20;
              const popIn = {
                opacity: pickerAnim,
                transform: [
                  { scale: pickerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
                  { translateY: pickerAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                ],
              };
              return (
                <View style={{ flex: 1 }}>
                  {/* 背景: すりガラスの暗転 */}
                  <Animated.View style={[StyleSheet.absoluteFill, { opacity: pickerAnim }]}>
                    <BlurView
                      intensity={45}
                      tint="dark"
                      experimentalBlurMethod="dimezisBlurView"
                      style={StyleSheet.absoluteFill}
                    />
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(12,6,32,0.35)' }]} />
                  </Animated.View>
                  <Pressable style={StyleSheet.absoluteFill} onPress={closeReactions} />

                  {/* 押したバブルをその場に浮かせて表示 */}
                  <View pointerEvents="none" style={{ position: 'absolute', top: f.y, left: f.x, width: f.w }}>
                    <View style={[mineT ? s.bubbleMine : s.bubbleOther, { width: f.w, maxWidth: '100%' }]}>
                      {bubbleInner(tp)}
                    </View>
                  </View>

                  {/* リアクションバー（バブルの真上にヌルッ） */}
                  <Animated.View
                    style={[
                      s.reactBar,
                      { top: Math.max(insets.top + 8, f.y - 66) },
                      mineT ? { right: 12 } : { left: Math.min(Math.max(12, f.x), SW - BAR_W - 12) },
                      popIn,
                    ]}
                  >
                    {REACTIONS.map(r => (
                      <PuniPressable
                        key={r.key}
                        onPress={() => { sendReaction(tp.id, 'emoji', r.key); closeReactions(); }}
                        style={s.pickerEmoji}
                      >
                        <r.Icon size={24} color={r.color} fill={r.fill ?? 'none'} strokeWidth={2} />
                      </PuniPressable>
                    ))}
                  </Animated.View>

                  {/* バブルの下にLINE風コンテキストメニュー */}
                  <Animated.View
                    style={[
                      s.ctxMenu,
                      { top: Math.min(f.y + f.h + 10, SH - 320) },
                      mineT ? { right: 12 } : { left: Math.max(12, f.x) },
                      popIn,
                    ]}
                  >
                    {isSpotT && (
                      <>
                        <PuniPressable onPress={() => { sendReaction(tp.id, 'vote', 'want'); closeReactions(); }} style={s.ctxRow}>
                          <Heart size={17} color="#10B981" fill="#D1FAE5" strokeWidth={2.2} />
                          <Text style={s.ctxText}>行きたい</Text>
                        </PuniPressable>
                        <View style={s.ctxDiv} />
                        <PuniPressable onPress={() => { sendReaction(tp.id, 'vote', 'meh'); closeReactions(); }} style={s.ctxRow}>
                          <Meh size={17} color="#F97316" strokeWidth={2.2} />
                          <Text style={s.ctxText}>微妙</Text>
                        </PuniPressable>
                        <View style={s.ctxDiv} />
                      </>
                    )}
                    <PuniPressable onPress={() => { actReply(tp); closeReactions(); }} style={s.ctxRow}>
                      <Reply size={17} color="#7C3AED" strokeWidth={2.2} />
                      <Text style={s.ctxText}>返信</Text>
                    </PuniPressable>
                    <View style={s.ctxDiv} />
                    <PuniPressable onPress={() => { actCopy(tp); closeReactions(); }} style={s.ctxRow}>
                      <Copy size={17} color="#7C3AED" strokeWidth={2.2} />
                      <Text style={s.ctxText}>コピー</Text>
                    </PuniPressable>
                    <View style={s.ctxDiv} />
                    <PuniPressable onPress={() => { actTranslate(tp); closeReactions(); }} style={s.ctxRow}>
                      <Languages size={17} color="#7C3AED" strokeWidth={2.2} />
                      <Text style={s.ctxText}>{translated[tp.id] ? '翻訳を消す' : '翻訳'}</Text>
                    </PuniPressable>
                    <View style={s.ctxDiv} />
                    <PuniPressable onPress={() => { actHideForMe(tp); closeReactions(); }} style={s.ctxRow}>
                      <EyeOff size={17} color="#6B7280" strokeWidth={2.2} />
                      <Text style={[s.ctxText, { color: '#6B7280' }]}>自分のトークだけ消す</Text>
                    </PuniPressable>
                    {!mineT && !isBotT && (
                      <>
                        <View style={s.ctxDiv} />
                        <PuniPressable onPress={() => { const target = tp; closeReactions(); setReportTarget(target); }} style={s.ctxRow}>
                          <Flag size={17} color="#F43F5E" strokeWidth={2.2} />
                          <Text style={[s.ctxText, { color: '#F43F5E' }]}>報告・ブロック</Text>
                        </PuniPressable>
                      </>
                    )}
                    {mineT && (
                      <>
                        <View style={s.ctxDiv} />
                        <PuniPressable onPress={() => { closeReactions(); actUnsend(tp); }} style={s.ctxRow}>
                          <Undo2 size={17} color="#F43F5E" strokeWidth={2.2} />
                          <Text style={[s.ctxText, { color: '#F43F5E' }]}>送信を取り消す</Text>
                        </PuniPressable>
                      </>
                    )}
                  </Animated.View>
                </View>
              );
            })()}
          </Modal>

          {/* ルーレット: 共有済みスポットから1つに決定 */}
          <Modal visible={showRoulette} transparent animationType="fade" onRequestClose={() => setShowRoulette(false)}>
            <View style={s.modalOverlay}>
              <View style={s.modalCard}>
                <View style={s.modalHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Dices size={18} color="#7C3AED" strokeWidth={2.2} />
                    <Text style={s.modalTitle}>ルーレットで決める</Text>
                  </View>
                  <PuniPressable onPress={() => setShowRoulette(false)} style={s.modalClose}>
                    <X size={18} color="#7C3AED" strokeWidth={2.5} />
                  </PuniPressable>
                </View>
                <Text style={s.rouHint}>タップして候補を選んでから回そう</Text>
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {rouletteCands.map((c) => {
                    const included = rouSel.has(c.id);
                    const selIdx = rouSelCands.findIndex(sc => sc.id === c.id);
                    const isActive = included && selIdx === rIdx && (spinning || rDone);
                    const isWin = rDone && isActive;
                    return (
                      <PuniPressable
                        key={c.id}
                        onPress={() => toggleRouSel(c.id)}
                        style={[
                          s.rouRow,
                          !included && s.rouRowOff,
                          isActive && (isWin ? s.rouRowWin : s.rouRowOn),
                        ]}
                      >
                        {isWin
                          ? <PartyPopper size={14} color="#92400E" strokeWidth={2.2} />
                          : <MapPin size={14} color={included ? '#7C3AED' : '#C4B5FD'} strokeWidth={2.2} />}
                        <Text
                          style={[s.rouText, !included && s.rouTextOff, isActive && s.rouTextOn]}
                          numberOfLines={1}
                        >
                          {c.spot_name}
                        </Text>
                        <View style={{ flex: 1 }} />
                        <View style={[s.rouCheck, included && s.rouCheckOn]}>
                          {included && <Check size={12} color="#fff" strokeWidth={3.2} />}
                        </View>
                      </PuniPressable>
                    );
                  })}
                </ScrollView>
                <PuniPressable
                  onPress={rDone ? sendRouletteResult : startRoulette}
                  disabled={spinning || rouSelCands.length < 2}
                  style={[s.rouBtn, (spinning || rouSelCands.length < 2) && { opacity: 0.5 }]}
                >
                  <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.rouBtnInner}>
                    <Text style={s.rouBtnText} numberOfLines={1}>
                      {spinning
                        ? '回転中…'
                        : rDone
                          ? `「${rouSelCands[rIdx]?.spot_name}」に決定として送る`
                          : rouSelCands.length < 2
                            ? '候補を2つ以上選んでね'
                            : `回す！（${rouSelCands.length}か所）`}
                    </Text>
                  </LinearGradient>
                </PuniPressable>
                {rDone && !spinning && (
                  <PuniPressable onPress={startRoulette} style={s.matchLater}>
                    <Text style={s.matchLaterText}>もう一回回す</Text>
                  </PuniPressable>
                )}
              </View>
            </View>
          </Modal>

          {/* 気分一致のお祝い → AI提案 */}
          <Modal
            visible={!!matchInfo}
            transparent
            animationType="fade"
            onRequestClose={() => { if (!matchBusy) setMatchInfo(null); }}
          >
            <View style={s.modalOverlay}>
              <View style={[s.modalCard, { alignItems: 'center' }]}>
                <PartyPopper size={48} color="#F59E0B" strokeWidth={1.8} />
                <Text style={s.matchTitle}>全員「{matchInfo?.mood}」気分！</Text>
                <Text style={s.matchSub}>{matchInfo?.count}人の気分がそろったよ</Text>
                <PuniPressable
                  onPress={runMoodMatchSearch}
                  disabled={matchBusy}
                  style={[s.rouBtn, { alignSelf: 'stretch' }]}
                  containerStyle={{ alignSelf: 'stretch' }}
                >
                  <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.rouBtnInner}>
                    {matchBusy
                      ? <ActivityIndicator color="#fff" size="small" />
                      : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Bot size={16} color="#fff" strokeWidth={2.2} />
                          <Text style={s.rouBtnText}>AIにおすすめを探してもらう</Text>
                        </View>
                      )}
                  </LinearGradient>
                </PuniPressable>
                <PuniPressable onPress={() => setMatchInfo(null)} disabled={matchBusy} style={s.matchLater}>
                  <Text style={s.matchLaterText}>今はいいかな</Text>
                </PuniPressable>
              </View>
            </View>
          </Modal>

          {/* いいねから送るボトムシート（画面下から半分までスライド） */}
          <Modal visible={showFavSheet} transparent animationType="none" onRequestClose={closeFavSheet}>
            <View style={{ flex: 1 }}>
              <Animated.View
                style={[
                  s.sheetOverlay,
                  { opacity: sheetY.interpolate({ inputRange: [0, SHEET_H], outputRange: [1, 0] }) },
                ]}
              >
                <Pressable style={StyleSheet.absoluteFill} onPress={closeFavSheet} />
              </Animated.View>

              <Animated.View
                style={[
                  s.favSheet,
                  { height: SHEET_H + insets.bottom, transform: [{ translateY: sheetY }] },
                ]}
              >
                <View style={s.sheetHandle} />
                <View style={s.sheetHeader}>
                  <Heart size={15} color="#EC4899" fill="#FBCFE8" strokeWidth={2} />
                  <Text style={s.sheetTitle}>いいねから送る</Text>
                </View>

                {/* 場所 / 投稿 セグメント */}
                <View style={s.favSegRow}>
                  {(['場所', '投稿'] as const).map((label, i) => {
                    const count = i === 0 ? placeFavs.length : postFavs.length;
                    const on = favTab === i;
                    return (
                      <PuniPressable
                        key={label}
                        onPress={() => goFavTab(i)}
                        containerStyle={{ flex: 1 }}
                        style={{ borderRadius: 999, overflow: 'hidden' }}
                      >
                        {on ? (
                          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.favSegInner}>
                            <Text style={s.favSegTextOn}>{label}（{count}）</Text>
                          </LinearGradient>
                        ) : (
                          <View style={[s.favSegInner, s.favSegOff]}>
                            <Text style={s.favSegText}>{label}（{count}）</Text>
                          </View>
                        )}
                      </PuniPressable>
                    );
                  })}
                </View>

                {/* 横スワイプの2ページ（いいね欄と同じ仕組み） */}
                <ScrollView
                  ref={favPagerRef}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={e => {
                    const i = Math.round(e.nativeEvent.contentOffset.x / SW);
                    if (i !== favTab) setFavTab(i);
                  }}
                >
                  {[placeFavs, postFavs].map((list, i) => (
                    <ScrollView
                      key={i}
                      style={{ width: SW }}
                      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}
                      showsVerticalScrollIndicator={false}
                    >
                      {list.length === 0 ? (
                        <View style={s.favEmpty}>
                          <Heart size={28} color="#FBCFE8" strokeWidth={1.5} />
                          <Text style={s.favEmptyText}>
                            {i === 0 ? 'まだいいねした場所がないよ' : 'まだいいねした投稿がないよ'}
                          </Text>
                        </View>
                      ) : list.map(f => (
                        <View key={f.title} style={s.favRow}>
                          {f.photoUrl ? (
                            <Image source={{ uri: f.photoUrl }} style={s.favThumb} />
                          ) : (
                            <View style={[s.favThumb, s.favThumbPh]}>
                              <Navigation size={16} color="#C084FC" strokeWidth={1.8} />
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <Text style={s.favTitle} numberOfLines={1}>{f.title}</Text>
                            {(f.area || f.address) ? (
                              <Text style={s.favArea} numberOfLines={1}>{f.area || f.address}</Text>
                            ) : null}
                          </View>
                          <PuniPressable
                            onPress={() => sendFavoriteSpot(f)}
                            disabled={sendingFav}
                            style={[s.favSendBtn, sendingFav && { opacity: 0.5 }]}
                          >
                            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.favSendInner}>
                              <Send size={14} color="#fff" strokeWidth={2.2} />
                            </LinearGradient>
                          </PuniPressable>
                        </View>
                      ))}
                    </ScrollView>
                  ))}
                </ScrollView>
              </Animated.View>
            </View>
          </Modal>
        </Animated.View>
        </KeyboardAvoidingView>
      </View>
      </Modal>
    );
  }

  return renderListScreen();

  // ─── グループ一覧画面（LINE風トーク一覧） ────────────────────────────────────
  // 関数宣言（巻き上げ）にして、チャット画面の背面レイヤーからも描画できるようにする
  function renderListScreen() {
  const canSubmitNick = !!nickname.trim();
  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <View style={{ width: 40 }} />
        <Text style={s.headerTitle}>トーク</Text>
        <PuniPressable onPress={openAdd} style={s.addBtn}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.addBtnInner}>
            <Plus size={20} color="#fff" strokeWidth={2.5} />
          </LinearGradient>
        </PuniPressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: insets.bottom + 110 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE} />}
      >
        {loading ? (
          <ActivityIndicator color={PURPLE} style={{ marginVertical: 20 }} />
        ) : groups.length === 0 ? (
          <View style={s.emptyBox}>
            <Users size={34} color="#C4B5FD" strokeWidth={1.5} />
            <Text style={s.emptyText}>まだグループがないよ{'\n'}右上の「＋」から作るか、招待コードで参加してね</Text>
          </View>
        ) : groups.map(g => {
          const lp = g.last_post;
          const preview = lp
            ? `${lp.nickname}: ${lp.spot_name ? `📍 ${lp.spot_name}` : `${lp.mood ? `#${lp.mood} ` : ''}${lp.comment ?? ''}`.trim()}`
            : 'まだつぶやきがないよ';
          return (
            <PuniPressable key={g.id} onPress={() => openGroup(g)} style={s.groupCard}>
              <View style={s.groupIconCircle}>
                {isIconUrl(g.icon)
                  ? <Image source={{ uri: g.icon }} style={s.groupIconImg} />
                  : <Text style={s.groupIconText}>{g.name.slice(0, 1)}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.groupTopRow}>
                  <Text style={s.groupName} numberOfLines={1}>
                    {g.name}
                    <Text style={s.groupCount}>（{g.member_count ?? 1}）</Text>
                  </Text>
                  {lp ? <Text style={s.groupTime}>{timeAgo(lp.created_at)}</Text> : null}
                </View>
                <Text style={[s.groupPreview, !lp && s.groupPreviewEmpty]} numberOfLines={1}>
                  {preview}
                </Text>
              </View>
            </PuniPressable>
          );
        })}
      </ScrollView>

      {/* ＋モーダル: グループを作る / 招待コードで参加 */}
      <Modal visible={showAdd} transparent animationType="fade" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>グループを作る・参加</Text>
              <PuniPressable onPress={() => setShowAdd(false)} style={s.modalClose}>
                <X size={18} color="#7C3AED" strokeWidth={2.5} />
              </PuniPressable>
            </View>

            {/* 名前は設定（プロフィール）のものを使用 */}
            {nickname.trim() ? (
              <View style={s.myNameRow}>
                <Text style={s.myNameLabel}>あなたの名前</Text>
                <Text style={s.myNameValue}>{nickname}</Text>
                <Text style={s.myNameHint}>（設定で変更できます）</Text>
              </View>
            ) : (
              <Text style={s.warnText}>
                先にホーム右上の⚙設定 → プロフィールで「名前」を入れてね
              </Text>
            )}

            {/* 作成 */}
            <Text style={[s.label, { marginTop: 20 }]}>グループを作る</Text>
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
                disabled={!newGroupName.trim() || !canSubmitNick || busy}
                style={[s.actionBtn, (!newGroupName.trim() || !canSubmitNick || busy) && { opacity: 0.4 }]}
              >
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionBtnInner}>
                  <Plus size={18} color="#fff" strokeWidth={2.5} />
                </LinearGradient>
              </PuniPressable>
            </View>

            {/* 参加 */}
            <Text style={[s.label, { marginTop: 20 }]}>招待コードで参加</Text>
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
                disabled={joinCode.trim().length !== 6 || !canSubmitNick || busy}
                style={[s.actionBtn, (joinCode.trim().length !== 6 || !canSubmitNick || busy) && { opacity: 0.4 }]}
              >
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionBtnInner}>
                  <Users size={18} color="#fff" strokeWidth={2.2} />
                </LinearGradient>
              </PuniPressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 通報・ブロック（App Store 1.2: 通報＋ブロック手段） */}
      <ReportModal
        visible={!!reportTarget}
        spotName={reportTarget ? (reportTarget.spot_name || reportTarget.comment || `#${reportTarget.mood}`).slice(0, 80) : ''}
        suggestionId={reportTarget?.id}
        posterId={reportTarget?.device_id}
        onBlockUser={handleBlockUser}
        onClose={() => setReportTarget(null)}
      />
    </View>
  );
  }
}

const s = StyleSheet.create({
  // 背景は index.tsx の AppBackground（共通背景）を透過で見せる
  root: { flex: 1, backgroundColor: 'transparent' },
  // チャットは背面に一覧を透かすため不透明背景＋左端の影（LINE風スワイプバック用）
  chatRoot: {
    flex: 1, backgroundColor: APP_BG,
    shadowColor: '#000', shadowOffset: { width: -6, height: 0 },
    shadowOpacity: 0.12, shadowRadius: 14, elevation: 24,
  },
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
  membersLineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 20, paddingBottom: 6,
  },
  membersLine: { fontSize: 12, color: '#7C6BA8', flexShrink: 1 },

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

  addBtn: { borderRadius: 999, overflow: 'hidden' },
  addBtnInner: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  groupCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
    borderWidth: 1.5, borderColor: '#EDE9FE',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  groupIconCircle: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#EDE9FE',
    alignItems: 'center', justifyContent: 'center',
  },
  groupIconText: { fontSize: 18, fontWeight: '800', color: '#7C3AED' },
  groupIconImg: { width: 46, height: 46, borderRadius: 23 },
  headerIconImg: { width: 22, height: 22, borderRadius: 11 },
  groupTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  groupName: { fontSize: 15, fontWeight: '800', color: INK, flexShrink: 1 },
  groupCount: { fontSize: 12, fontWeight: '700', color: '#A78BFA' },
  groupTime: { fontSize: 10, color: '#A78BFA' },
  groupPreview: { fontSize: 12, color: '#8B7BB8', marginTop: 3 },
  groupPreviewEmpty: { color: '#C4B5FD' },

  // ── ＋モーダル ──
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(30,7,83,0.35)',
    justifyContent: 'center', padding: 24,
  },
  modalCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: INK },
  // ＋モーダル: 設定済みの名前の表示行
  myNameRow: {
    flexDirection: 'row', alignItems: 'baseline', gap: 6,
    backgroundColor: '#F5F3FF', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  myNameLabel: { fontSize: 11, fontWeight: '700', color: '#A78BFA' },
  myNameValue: { fontSize: 14, fontWeight: '800', color: INK },
  myNameHint:  { fontSize: 10, color: '#C4B5FD' },
  modalClose: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#F5F3FF',
    alignItems: 'center', justifyContent: 'center',
  },

  // ── グループ設定モーダル ──
  bigIconCircle: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#EDE9FE',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  bigIconLetter: { fontSize: 34, fontWeight: '800', color: '#7C3AED' },
  bigIconImg: { width: 84, height: 84, borderRadius: 42 },
  iconBusyOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 42, backgroundColor: 'rgba(30,7,83,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconEditBadge: {
    position: 'absolute', right: 0, bottom: 0,
    width: 26, height: 26, borderRadius: 13, backgroundColor: '#7C3AED',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  iconHint: { fontSize: 10, color: '#A78BFA', marginBottom: 8 },
  settingsGroupName: { fontSize: 18, fontWeight: '800', color: INK },
  settingsMeta: { fontSize: 12, color: '#A78BFA', marginTop: 2, marginBottom: 14 },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F5F3FF', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1.5, borderColor: '#EDE9FE',
  },
  codeRowText: { fontSize: 16, fontWeight: '800', color: INK, letterSpacing: 2 },
  codeShareChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#EDE9FE', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  codeShareText: { fontSize: 11, fontWeight: '800', color: '#7C3AED' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  memberAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#DDD6FE',
    alignItems: 'center', justifyContent: 'center',
  },
  memberNick: { fontSize: 14, fontWeight: '700', color: INK, flex: 1 },
  meBadge: {
    fontSize: 10, fontWeight: '800', color: '#7C3AED',
    backgroundColor: '#EDE9FE', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 20, marginBottom: 6, paddingVertical: 12, borderRadius: 14,
    backgroundColor: '#FFF1F2', borderWidth: 1.5, borderColor: '#FECDD3',
  },
  leaveText: { fontSize: 13, fontWeight: '800', color: '#F43F5E' },

  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  emptyText: { fontSize: 13, color: '#A78BFA', textAlign: 'center', lineHeight: 20 },

  // ── チャットバブル ──
  rowMine: {
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end',
    gap: 6, marginBottom: 10,
  },
  bubbleMine: {
    maxWidth: '76%',
    backgroundColor: '#E4D9FF',   // LINE風: 自分は淡い色＋濃い文字
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 18, borderBottomRightRadius: 4,
  },
  bubbleMineText: { fontSize: 13, color: INK, marginTop: 6, lineHeight: 19 },

  rowOther: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  avatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#DDD6FE',
    alignItems: 'center', justifyContent: 'center', marginTop: 16,
  },
  avatarText: { fontSize: 14, fontWeight: '800', color: '#7C3AED' },
  otherNick: { fontSize: 10, fontWeight: '700', color: '#A78BFA', marginBottom: 2, marginLeft: 4 },
  rowOtherBubbleLine: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  bubbleOther: {
    maxWidth: '78%', backgroundColor: '#fff',
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 18, borderBottomLeftRadius: 4,
  },
  bubbleOtherText: { fontSize: 13, color: INK, marginTop: 6, lineHeight: 19 },
  bubbleTime: { fontSize: 9, color: '#C4B5FD', marginBottom: 2 },

  // ── 値札タグ風の気分バッジ（先端の尖り＋紐穴） ──
  tagRow: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    marginLeft: 3,
    transform: [{ rotate: '-2deg' }],   // ちょっと傾けてしおり感
  },
  tagPoint: {
    width: 17, height: 17, borderRadius: 4, borderWidth: 1,
    transform: [{ rotate: '45deg' }],
    marginRight: -12,
  },
  tagBody: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingLeft: 8, paddingRight: 11, paddingVertical: 4,
    borderTopRightRadius: 9, borderBottomRightRadius: 9,
    borderTopLeftRadius: 2, borderBottomLeftRadius: 2,
    borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 0,
  },
  tagHole: {
    position: 'absolute', left: 5.5, top: '50%', marginTop: -2.5,
    width: 5, height: 5, borderRadius: 2.5,
  },
  moodTagText: { fontSize: 12, fontWeight: '800' },

  // ── スポット共有カード ──
  spotCard: {
    backgroundColor: '#fff', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: '#EDE9FE',
    minWidth: 170,
  },
  spotCardMine: { borderColor: '#D4C5FF' },
  spotCardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 2 },
  spotCardLabel: { fontSize: 9, fontWeight: '800', color: '#A78BFA' },
  spotCardName: { fontSize: 13, fontWeight: '800', color: INK, lineHeight: 18 },
  spotCardAddr: { fontSize: 10, color: '#9CA3AF', marginTop: 2 },
  spotCardLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  spotCardLink: { fontSize: 11, fontWeight: '800', color: '#7C3AED' },

  // ── コンポーザー ──
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

  // ── いいねから送る（ハート＋ボトムシート） ──
  favHeartBtn: {
    width: 44, height: 44, borderRadius: 999,
    backgroundColor: '#FDF2F8', borderWidth: 1.5, borderColor: '#FBCFE8',
    alignItems: 'center', justifyContent: 'center',
  },
  sheetOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(30,7,83,0.35)' },
  favSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 20,
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 5, borderRadius: 3,
    backgroundColor: '#E9D5FF', marginTop: 10, marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginBottom: 10,
  },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: INK },
  favSegRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  favSegInner: { paddingVertical: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  favSegOff: { backgroundColor: '#F5F3FF', borderWidth: 1, borderColor: '#EDE9FE' },
  favSegText: { fontSize: 12, fontWeight: '700', color: '#A78BFA' },
  favSegTextOn: { fontSize: 12, fontWeight: '800', color: '#fff' },
  favEmpty: { alignItems: 'center', gap: 8, paddingVertical: 36 },
  favEmptyText: { fontSize: 12, color: '#A78BFA' },
  favRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FAF8FF', borderRadius: 16, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: '#F1EBFE',
  },
  favThumb: { width: 48, height: 48, borderRadius: 12 },
  favThumbPh: { backgroundColor: '#F5F3FF', alignItems: 'center', justifyContent: 'center' },

  // ── 投票・リアクション ──
  avatarBot: { backgroundColor: '#EDE9FE' },
  // 自分が投票済みのチップ強調（行きたい=緑 / 微妙=オレンジ）
  voteChipOnWant: { backgroundColor: '#ECFDF5', borderColor: '#34D399' },
  voteChipOnMeh:  { backgroundColor: '#FFF7ED', borderColor: '#FDBA74' },
  decidedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#FDE68A', borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  decidedText: { fontSize: 11, fontWeight: '900', color: '#92400E' },
  reactChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  reactChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#EDE9FE',
  },
  reactChipMine: { backgroundColor: '#EDE9FE', borderColor: '#A78BFA' },
  reactChipText: { fontSize: 11, fontWeight: '700', color: INK },
  // インスタ風オーバーレイ: バブル上のリアクションバー＋下の投票メニュー
  reactBar: {
    position: 'absolute', flexDirection: 'row',
    backgroundColor: '#fff', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22, shadowRadius: 22, elevation: 16,
  },
  pickerEmoji: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // LINE風コンテキストメニュー
  ctxMenu: {
    position: 'absolute', width: 220,
    backgroundColor: '#fff', borderRadius: 18, paddingVertical: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22, shadowRadius: 22, elevation: 16,
  },
  ctxRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  ctxText: { fontSize: 14, fontWeight: '700', color: INK },
  ctxDiv: { height: 1, backgroundColor: '#F3F0FF', marginHorizontal: 12 },

  // 返信プレビュー（コンポーザー上）
  replyBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F5F3FF', borderRadius: 12,
    paddingVertical: 8, paddingHorizontal: 10, marginBottom: 8,
  },
  replyBarAccent: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: '#9B6BFF' },
  replyBarName: { fontSize: 11, fontWeight: '800', color: '#7C3AED' },
  replyBarText: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  replyBarClose: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#EDE9FE',
    alignItems: 'center', justifyContent: 'center',
  },

  // バブル内の返信引用
  replyQuote: {
    borderLeftWidth: 3, borderLeftColor: '#C4B5FD',
    paddingLeft: 8, paddingVertical: 3, marginBottom: 6,
  },
  replyQuoteMine: { borderLeftColor: '#A78BFA' },
  replyQuoteName: { fontSize: 10, fontWeight: '800', color: '#7C3AED' },
  replyQuoteText: { fontSize: 11, color: '#8B7BB8', marginTop: 1 },

  // 翻訳結果
  translateBox: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(124,58,237,0.12)' },
  translateLabel: { fontSize: 9, fontWeight: '800', color: '#A78BFA', marginBottom: 2 },

  // ── ルーレット・気分一致 ──
  diceBtn: {
    width: 44, height: 44, borderRadius: 999,
    backgroundColor: '#F5F3FF', borderWidth: 1.5, borderColor: '#DDD6FE',
    alignItems: 'center', justifyContent: 'center',
  },
  rouHint: { fontSize: 11, color: '#A78BFA', textAlign: 'center', marginBottom: 10 },
  rouRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 6,
    backgroundColor: '#FAF8FF', borderWidth: 1.5, borderColor: '#F1EBFE',
  },
  rouRowOff: { opacity: 0.45 },
  rouRowOn:  { backgroundColor: '#EDE9FE', borderColor: '#A78BFA' },
  rouRowWin: { backgroundColor: '#FEF3C7', borderColor: '#F59E0B' },
  rouText:   { fontSize: 13, fontWeight: '700', color: INK, flexShrink: 1 },
  rouTextOff: { color: '#A78BFA' },
  rouTextOn: { fontWeight: '900' },
  rouCheck: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#DDD6FE', backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  rouCheckOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  rouBtn: { borderRadius: 999, overflow: 'hidden', marginTop: 10 },
  rouBtnInner: { paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  rouBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  matchTitle: { fontSize: 19, fontWeight: '900', color: INK, marginTop: 6 },
  matchSub: { fontSize: 12, color: '#A78BFA', marginTop: 4, marginBottom: 16 },
  matchLater: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  matchLaterText: { fontSize: 12, fontWeight: '700', color: '#A78BFA' },
  favTitle: { fontSize: 14, fontWeight: '800', color: INK },
  favArea: { fontSize: 11, color: '#A78BFA', marginTop: 2 },
  favSendBtn: { borderRadius: 999, overflow: 'hidden' },
  favSendInner: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
