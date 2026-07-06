// カード下部の投稿者情報: アイコン＋名前（左）／ 投稿時間＋⋯メニュー（右）
import { Image } from 'expo-image';
import { MoreHorizontal } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Post } from './postTypes';
import { relativeTime } from './postTypes';

const AVATAR_BG = ['#FDEBD0', '#D5F5E3', '#D6EAF8', '#E8DAEF', '#D1F2EB', '#FDCEDF', '#FFF3CD', '#E8E0FF'];

export default function UserInfo({ post, onMenu }: { post: Post; onMenu: () => void }) {
  const name = post.raw.poster_name?.trim() || 'MoodGo ユーザー';
  const icon = post.raw.poster_icon || null;
  const [imgOk, setImgOk] = useState(true);
  const bg = AVATAR_BG[(name.charCodeAt(0) ?? 0) % AVATAR_BG.length];

  return (
    <View style={s.row}>
      <View style={s.left}>
        <View style={[s.avatar, { backgroundColor: bg }]}>
          {icon && imgOk
            ? <Image source={{ uri: icon }} style={s.avatarImg} contentFit="cover" onError={() => setImgOk(false)} />
            : <Text style={s.avatarInit}>{name.slice(0, 1)}</Text>}
        </View>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
      </View>
      <View style={s.right}>
        <Text style={s.time}>{relativeTime(post.createdAt)}</Text>
        <TouchableOpacity onPress={onMenu} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
          <MoreHorizontal size={17} color="#B7B3C2" strokeWidth={2} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  left: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  avatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: 24, height: 24 },
  avatarInit: { fontSize: 11, fontWeight: '800', color: '#6B6480' },
  name: { fontSize: 12.5, fontWeight: '700', color: '#555', flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { fontSize: 11.5, color: '#9B96A6', fontWeight: '500' },
});
