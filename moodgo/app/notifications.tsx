// ── /notifications ────────────────────────────────────────────────────────────
// アプリ内通知: 自分の投稿への いいね/行った！ ＋ 新しいフォロワー を新着順で表示。
// 開いた時点で既読（lastSeenをローカル更新）。タップで対象の投稿/相手のプロフィールへ。
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Bell, Footprints, Heart, UserPlus, UserRound } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppBackground from '@/components/AppBackground';
import MyPostsHeader from '@/components/myposts/MyPostsHeader';
import { MP } from '@/components/myposts/types';
import { fetchNotifications, getLastSeen, markSeen, type Notice } from '@/lib/notifications';
import { relativeTime } from '@/lib/spotLog';
import { useCollapsibleHeader } from '@/lib/useCollapsibleHeader';
import { useSettings } from '@/lib/settingsStore';

const TYPE_STYLE = {
  like:    { Icon: Heart,      tint: '#F06292', bg: '#FDEBF2' },
  visited: { Icon: Footprints, tint: '#F5A623', bg: '#FDF3E1' },
  follow:  { Icon: UserPlus,   tint: '#8B6BF2', bg: '#F1EBFF' },
} as const;

const T = {
  ja: {
    title: '通知',
    emptyTitle: '通知はまだありません',
    emptySub: '投稿にいいねや行った！が付くとここに届きます',
    someone: '誰か',
    spot: 'スポット',
    // 表示専用のメッセージ組み立て（type値そのものは翻訳しない）
    followText: (who: string) => `${who}があなたをフォローしました`,
    likeText: (who: string, spot: string) => `${who}があなたの「${spot}」にいいねしました`,
    visitedText: (who: string, spot: string) => `${who}があなたの「${spot}」に行った！しました`,
  },
  en: {
    title: 'Notifications',
    emptyTitle: 'No notifications yet',
    emptySub: "You'll be notified here when someone likes or marks your posts as been here",
    someone: 'Someone',
    spot: 'spot',
    followText: (who: string) => `${who} followed you`,
    likeText: (who: string, spot: string) => `${who} liked your "${spot}"`,
    visitedText: (who: string, spot: string) => `${who} marked your "${spot}" as been here`,
  },
} as const;

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { lang } = useSettings();
  const t = T[lang];
  const [items, setItems] = useState<Notice[]>([]);
  const [lastSeen, setLastSeen] = useState('');
  const [loading, setLoading] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    (async () => {
      const [list, seen] = await Promise.all([fetchNotifications(50), getLastSeen()]);
      if (!isMounted.current) return;
      setItems(list);
      setLastSeen(seen);
      setLoading(false);
      markSeen();   // 開いた時点で既読
    })();
    return () => { isMounted.current = false; };
  }, []);

  const openNotice = (n: Notice) => {
    if (n.type === 'follow' && n.actorId) {
      router.push({ pathname: '/user/[id]', params: { id: n.actorId } });
    } else if (n.targetId) {
      router.push({ pathname: '/community-spot', params: { id: n.targetId } });
    }
  };

  // 下スクロールでナビバーを格納（ナビ高=inset+48固定）
  const collapse = useCollapsibleHeader({
    initialHeight: insets.top + 48,
    listener: (e) => setScrolled(e.nativeEvent.contentOffset.y > 8),
  });

  return (
    <View style={s.root}>
      <AppBackground />
      <Animated.ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 56, paddingBottom: insets.bottom + 40, paddingHorizontal: MP.SIDE }}
        showsVerticalScrollIndicator={false}
        onScroll={collapse.onScroll}
        scrollEventThrottle={16}
      >
        {loading ? (
          <View style={s.center}><ActivityIndicator color={MP.MAIN} size="small" /></View>
        ) : items.length === 0 ? (
          <View style={s.center}>
            <View style={s.emptyIcon}><Bell size={22} color={MP.MAIN} strokeWidth={1.8} /></View>
            <Text style={s.emptyTitle}>{t.emptyTitle}</Text>
            <Text style={s.emptySub}>{t.emptySub}</Text>
          </View>
        ) : (
          items.map((n, i) => {
            const st = TYPE_STYLE[n.type];
            const unread = !!n.at && (!lastSeen || n.at > lastSeen);
            const who = n.actorHandle ? `@${n.actorHandle}` : t.someone;
            const spot = n.spotName ?? t.spot;
            const text = n.type === 'follow'
              ? t.followText(who)
              : n.type === 'visited'
                ? t.visitedText(who, spot)
                : t.likeText(who, spot);
            return (
              <TouchableOpacity key={`${n.type}-${n.at}-${i}`} style={[s.row, unread && s.rowUnread]}
                onPress={() => openNotice(n)} activeOpacity={0.75}
                accessibilityRole="button" accessibilityLabel={text}>
                <View style={[s.iconCircle, { backgroundColor: st.bg }]}>
                  <st.Icon size={16} color={st.tint} strokeWidth={2.2} />
                </View>
                {n.actorIcon ? (
                  <Image source={{ uri: n.actorIcon }} style={s.avatar} contentFit="cover" />
                ) : (
                  <View style={[s.avatar, s.avatarPh]}><UserRound size={15} color={MP.MAIN} strokeWidth={1.8} /></View>
                )}
                <Text style={s.text} numberOfLines={2}>{text}</Text>
                <View style={s.rightCol}>
                  <Text style={s.time}>{relativeTime(n.at, lang)}</Text>
                  {unread && <View style={s.unreadDot} />}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </Animated.ScrollView>

      <MyPostsHeader
        topInset={insets.top}
        scrolled={scrolled}
        translateY={collapse.translateY}
        title={t.title}
        showNew={false}
        onBack={() => router.back()}
        onNew={() => {}}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 6 },
  emptyIcon: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: '#F0EBFF',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyTitle: { fontSize: 14.5, fontWeight: '800', color: MP.INK },
  emptySub: { fontSize: 12, fontWeight: '500', color: MP.SUB, textAlign: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: MP.CARD, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8,
    shadowColor: '#111', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1,
  },
  rowUnread: { backgroundColor: '#FBF8FF', borderWidth: 1, borderColor: 'rgba(139,107,242,0.18)' },
  iconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F0EBFF' },
  avatarPh: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontSize: 12.5, fontWeight: '600', color: MP.INK, lineHeight: 18 },
  rightCol: { alignItems: 'flex-end', gap: 4 },
  time: { fontSize: 10.5, fontWeight: '500', color: MP.SUB },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F06292' },
});
