// ── components/MoodLogSection.tsx ─────────────────────────────────────────────
// スポット詳細の「みんなのMoodログ」セクション（Google口コミの代わりの気分ベース口コミ）。
// GET /api/spot-posts で承認済み投稿を取得し、写真・気分タグ・ひとこと・誰と・時間帯・
// また行きたい・リアクション（いいね/参考になった/また行きたい）・通報を表示。
// 「Moodログを投稿」ボタンは mood-log 画面へ遷移（スポット情報をparamsで渡す）。
import React, { useCallback, useState } from 'react';
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { MessageCirclePlus, ThumbsUp, Repeat2, Sparkles, Flag } from 'lucide-react-native';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

export type MoodPost = {
  id: string; author: string; isOwn: boolean;
  caption?: string; moodTags: string[]; companion?: string | null;
  timeOfDay?: string | null; wantRevisit?: boolean | null; matchesPhoto?: boolean | null;
  photos: string[];
  likeCount: number; helpfulCount: number; revisitCount: number;
  myLike: boolean; myHelpful: boolean; myRevisit: boolean;
  createdAt?: string;
};

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime(); if (isNaN(t)) return '';
  const d = Math.floor((Date.now() - t) / 1000);
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}分前`;
  if (d < 86400) return `${Math.floor(d / 3600)}時間前`;
  if (d < 2592000) return `${Math.floor(d / 86400)}日前`;
  return `${Math.floor(d / 2592000)}ヶ月前`;
}

export default function MoodLogSection({ placeId, placeName, address }: { placeId?: string; placeName: string; address?: string }) {
  const [posts, setPosts] = useState<MoodPost[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const did = await getDeviceId().catch(() => '');
      const qs = new URLSearchParams();
      if (placeId) qs.set('placeId', placeId);
      if (placeName) qs.set('placeName', placeName);
      if (did) qs.set('deviceId', did);
      const res = await apiFetch(`/api/spot-posts?${qs.toString()}`);
      const d = await res.json();
      setPosts(Array.isArray(d?.posts) ? d.posts : []);
    } catch { /* 取得失敗は空 */ } finally { setLoading(false); }
  }, [placeId, placeName]);

  // 画面がフォーカスされるたびに再取得（投稿→戻った直後に新しいMoodログが表示される）
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // 新規ルート（expo-routerの型は次回生成で解決・実行時はファイルベースで有効）→ unknown経由でHrefにキャスト
  const goPost = () => router.push({ pathname: '/post', params: { placeId: placeId ?? '', placeName, address: address ?? '' } } as unknown as Href);

  const react = async (post: MoodPost, rtype: 'like' | 'helpful' | 'revisit') => {
    // #13: 既に押していたら解除(undo)、でなければ付与＝トグル。以前は if(mine) return で解除不可だった。
    const mine = rtype === 'like' ? post.myLike : rtype === 'helpful' ? post.myHelpful : post.myRevisit;
    const undo = mine;
    const d = undo ? -1 : 1;
    setPosts(prev => prev.map(p => p.id !== post.id ? p : ({
      ...p,
      likeCount: Math.max(0, p.likeCount + (rtype === 'like' ? d : 0)), myLike: rtype === 'like' ? !undo : p.myLike,
      helpfulCount: Math.max(0, p.helpfulCount + (rtype === 'helpful' ? d : 0)), myHelpful: rtype === 'helpful' ? !undo : p.myHelpful,
      revisitCount: Math.max(0, p.revisitCount + (rtype === 'revisit' ? d : 0)), myRevisit: rtype === 'revisit' ? !undo : p.myRevisit,
    })));
    try {
      const did = await getDeviceId();
      await apiFetch('/api/spot-posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'react', postId: post.id, deviceId: did, rtype, undo }) });
    } catch { /* 失敗は楽観表示のまま */ }
  };

  const report = (post: MoodPost) => {
    Alert.alert('この投稿を通報', '不適切・無断転載・関係ない写真などの場合に通報できます。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: '通報する', style: 'destructive', onPress: async () => {
        try {
          const did = await getDeviceId();
          await apiFetch('/api/spot-posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'report', postId: post.id, deviceId: did, reason: 'user_report' }) });
          setPosts(prev => prev.filter(p => p.id !== post.id));
          Alert.alert('通報を受け付けました', 'ご協力ありがとうございます。');
        } catch {
          Alert.alert('通報を送信できませんでした', '通信環境を確認して再度お試しください。');
        }
      } },
    ]);
  };

  // 1枚のMoodログカード（2カラム配置で左右どちらの列にも描画する）
  const renderPost = (post: MoodPost) => (
    <View key={post.id} style={s.card}>
      <View style={s.cardTop}>
        <Text style={s.author} numberOfLines={1}>{post.author}{post.isOwn ? '（あなた）' : ''}</Text>
        <Text style={s.time}>{timeAgo(post.createdAt)}</Text>
        <TouchableOpacity onPress={() => report(post)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Flag size={13} color="#C4B5D6" strokeWidth={2} />
        </TouchableOpacity>
      </View>

      {post.photos.length > 0 && (
        <View style={s.photoWrap}>
          <Image source={{ uri: post.photos[0] }} style={s.photo} />
          {post.photos.length > 1 && (
            <View style={s.photoBadge}><Text style={s.photoBadgeText}>+{post.photos.length - 1}</Text></View>
          )}
        </View>
      )}

      {(post.moodTags.length > 0 || post.companion || post.timeOfDay || post.wantRevisit) && (
        <View style={s.chips}>
          {post.moodTags.slice(0, 4).map(t => <View key={t} style={s.chip}><Text style={s.chipText}>{t}</Text></View>)}
          {post.companion ? <View style={s.chipAlt}><Text style={s.chipAltText}>{post.companion}</Text></View> : null}
          {post.timeOfDay ? <View style={s.chipAlt}><Text style={s.chipAltText}>{post.timeOfDay}</Text></View> : null}
          {post.wantRevisit ? <View style={s.chipGood}><Text style={s.chipGoodText}>また行きたい</Text></View> : null}
          {post.matchesPhoto ? <View style={s.chipGood}><Text style={s.chipGoodText}>写真どおり</Text></View> : null}
        </View>
      )}

      {post.caption ? <Text style={s.caption}>{post.caption}</Text> : null}

      <View style={s.reactions}>
        <TouchableOpacity style={[s.reactBtn, post.myLike && s.reactOn]} onPress={() => react(post, 'like')} activeOpacity={0.7}>
          <ThumbsUp size={12} color={post.myLike ? '#fff' : '#A78BCA'} strokeWidth={2.2} />
          <Text style={[s.reactText, post.myLike && s.reactTextOn]}>いいね {post.likeCount || ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.reactBtn, post.myHelpful && s.reactOn]} onPress={() => react(post, 'helpful')} activeOpacity={0.7}>
          <Sparkles size={12} color={post.myHelpful ? '#fff' : '#A78BCA'} strokeWidth={2.2} />
          <Text style={[s.reactText, post.myHelpful && s.reactTextOn]}>参考 {post.helpfulCount || ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.reactBtn, post.myRevisit && s.reactOn]} onPress={() => react(post, 'revisit')} activeOpacity={0.7}>
          <Repeat2 size={12} color={post.myRevisit ? '#fff' : '#A78BCA'} strokeWidth={2.2} />
          <Text style={[s.reactText, post.myRevisit && s.reactTextOn]}>また {post.revisitCount || ''}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={s.section}>
      <View style={s.header}>
        <Sparkles size={15} color="#C084FC" strokeWidth={2} />
        <Text style={s.title}>みんなのMoodログ</Text>
        {posts.length > 0 && <Text style={s.count}>{posts.length}件</Text>}
        <TouchableOpacity onPress={goPost} style={s.postBtn} activeOpacity={0.85}>
          <MessageCirclePlus size={14} color="#fff" strokeWidth={2.4} />
          <Text style={s.postBtnText}>投稿する</Text>
        </TouchableOpacity>
      </View>

      {!loading && posts.length === 0 && (
        <TouchableOpacity onPress={goPost} activeOpacity={0.8} style={s.empty}>
          <Text style={s.emptyText}>まだMoodログがありません。{'\n'}この場所の最初のMoodログを投稿しませんか？📸</Text>
        </TouchableOpacity>
      )}

      {posts.length > 0 && (
        <View style={s.cols}>
          <View style={s.col}>{posts.filter((_, i) => i % 2 === 0).map(renderPost)}</View>
          <View style={s.col}>{posts.filter((_, i) => i % 2 === 1).map(renderPost)}</View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: 18 },
  cols: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },   // 横2カラム
  col: { flex: 1, minWidth: 0 },   // minWidth:0 が無いと内容で片方の列が潰れる
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '800', color: '#3A1D6E' },
  count: { fontSize: 12, color: '#9B89BE', fontWeight: '700' },
  postBtn: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#7C3AED', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12 },
  postBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  empty: { backgroundColor: '#F6F2FD', borderRadius: 14, padding: 18, alignItems: 'center' },
  emptyText: { fontSize: 13, color: '#7E6CA0', textAlign: 'center', lineHeight: 20 },
  card: { backgroundColor: '#FBF9FF', borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#EFE8FB' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  author: { flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: '800', color: '#4A2D7E' },
  time: { fontSize: 10.5, color: '#B0A2C8' },
  photoWrap: { position: 'relative', marginBottom: 8 },
  photo: { width: '100%', height: 124, borderRadius: 10, backgroundColor: '#EEE' },
  photoBadge: { position: 'absolute', right: 6, bottom: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  photoBadgeText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 6 },
  chip: { backgroundColor: '#EEE7FA', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  chipText: { fontSize: 11, color: '#7C3AED', fontWeight: '700' },
  chipAlt: { backgroundColor: '#F0F0F4', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  chipAltText: { fontSize: 11, color: '#6B7280', fontWeight: '700' },
  chipGood: { backgroundColor: '#FCE7F3', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  chipGoodText: { fontSize: 11, color: '#DB2777', fontWeight: '700' },
  caption: { fontSize: 13.5, color: '#3F3550', lineHeight: 20, marginBottom: 8 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },   // 半幅カードで折り返す
  reactBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 11, paddingVertical: 4, paddingHorizontal: 7 },
  reactOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  reactText: { fontSize: 10.5, color: '#A78BCA', fontWeight: '700' },
  reactTextOn: { color: '#fff' },
});
