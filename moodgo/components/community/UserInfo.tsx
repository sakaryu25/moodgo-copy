// カード下部の投稿者情報: アイコン＋名前（左）／ 投稿時間＋⋯メニュー（右）
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Lock, MoreHorizontal } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Post } from './postTypes';
import { relativeTime } from './postTypes';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useSettings } from '@/lib/settingsStore';
import { useMyIdentity, resolvePoster } from '@/lib/myIdentity';

const AVATAR_BG = ['#FDEBD0', '#D5F5E3', '#D6EAF8', '#E8DAEF', '#D1F2EB', '#FDCEDF', '#FFF3CD', '#E8E0FF'];

export default function UserInfo({ post, onMenu }: { post: Post; onMenu: () => void }) {
  const { lang } = useSettings();
  const me = useMyIdentity();
  // 自分の投稿は公開/名前非公開を問わず常に自分の名前・アイコン・バッジで表示（全画面で統一）。
  // 他人の名前非公開(匿名)投稿だけ名前/アイコン/バッジを隠す＝逆引き不可のまま。
  const posterId = post.raw.poster_id;
  const anon = !!post.raw.poster_anonymous;
  const eff = resolvePoster(posterId, { name: post.raw.poster_name, icon: post.raw.poster_icon, accountType: post.raw.poster_type }, me);
  const hidden = anon && !eff.isMe;         // 他人の名前非公開＝名前を隠す
  const selfAnon = anon && eff.isMe;        // 自分の名前非公開＝名前は出すが「非公開」を明示
  const name = hidden ? (post.raw.poster_name?.trim() || 'MoodGo ユーザー') : (eff.name?.trim() || 'MoodGo ユーザー');
  const icon = hidden ? null : (eff.icon || null);
  const badgeType = hidden ? null : eff.accountType;
  const [imgOk, setImgOk] = useState(true);
  const bg = AVATAR_BG[(name.charCodeAt(0) ?? 0) % AVATAR_BG.length];

  // 自分の投稿は自分の公開プロフィールへ（名前非公開でも本人は開ける＝開く先は me.hash）。
  // 他人は公開かつ名前ありのみ遷移。
  const openId = eff.isMe ? (me.hash || posterId) : posterId;
  const canOpen = !hidden && !!openId && (eff.isMe || !!post.raw.poster_name);
  const openUser = () => { if (canOpen && openId) router.push({ pathname: '/user/[id]', params: { id: openId } }); };
  return (
    <View style={s.row}>
      <TouchableOpacity style={s.left} onPress={openUser} disabled={!canOpen} activeOpacity={0.7}
        accessibilityRole={canOpen ? 'button' : undefined}
        accessibilityLabel={canOpen ? `${name}のプロフィールを見る` : undefined}>
        <View style={[s.avatar, { backgroundColor: bg }]}>
          {icon && imgOk
            ? <Image source={{ uri: icon }} style={s.avatarImg} contentFit="cover" onError={() => setImgOk(false)} />
            : <Text style={s.avatarInit}>{name.slice(0, 1)}</Text>}
        </View>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
        <VerifiedBadge type={badgeType} size={12} />
        {selfAnon ? (
          <View style={s.privTag}>
            <Lock size={8} color="#9A96A8" strokeWidth={2.4} />
            <Text style={s.privTagText}>{lang === 'en' ? 'Private' : '非公開'}</Text>
          </View>
        ) : null}
      </TouchableOpacity>
      <View style={s.right}>
        <Text style={s.time}>{relativeTime(post.createdAt, lang)}</Text>
        <TouchableOpacity onPress={onMenu} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
          <MoreHorizontal size={15} color="#B7B3C2" strokeWidth={2} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  avatar: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: 20, height: 20 },
  avatarInit: { fontSize: 10, fontWeight: '800', color: '#6B6480' },
  name: { fontSize: 11.5, fontWeight: '700', color: '#555', flexShrink: 1 },
  // 自分の名前非公開投稿につく小さな「非公開」タグ（名前は出しつつ状態を明示）
  privTag: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#F0EEF5', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1, flexShrink: 0 },
  privTagText: { fontSize: 8.5, fontWeight: '700', color: '#9A96A8' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  time: { fontSize: 10.5, color: '#9B96A6', fontWeight: '500' },
});
