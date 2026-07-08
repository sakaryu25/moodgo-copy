// カード下部の投稿者情報: アイコン＋名前（左）／ 投稿時間＋⋯メニュー（右）
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { MoreHorizontal } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Post } from './postTypes';
import { relativeTime } from './postTypes';
import VerifiedBadge from '@/components/VerifiedBadge';

const AVATAR_BG = ['#FDEBD0', '#D5F5E3', '#D6EAF8', '#E8DAEF', '#D1F2EB', '#FDCEDF', '#FFF3CD', '#E8E0FF'];

export default function UserInfo({ post, onMenu }: { post: Post; onMenu: () => void }) {
  const name = post.raw.poster_name?.trim() || 'MoodGo ユーザー';
  const icon = post.raw.poster_icon || null;
  const [imgOk, setImgOk] = useState(true);
  const bg = AVATAR_BG[(name.charCodeAt(0) ?? 0) % AVATAR_BG.length];

  // 投稿者(非匿名)タップ→フルプロフィールへ。匿名(名前なし)は遷移しない
  const posterId = post.raw.poster_id;
  const canOpen = !!posterId && !!post.raw.poster_name;
  const openUser = () => { if (canOpen) router.push({ pathname: '/user/[id]', params: { id: posterId! } }); };
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
        <VerifiedBadge type={post.raw.poster_type} size={12} />
      </TouchableOpacity>
      <View style={s.right}>
        <Text style={s.time}>{relativeTime(post.createdAt)}</Text>
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
  right: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  time: { fontSize: 10.5, color: '#9B96A6', fontWeight: '500' },
});
