// ── components/MoodLogSection.tsx ─────────────────────────────────────────────
// スポット詳細の「みんなのMoodログ」セクション（Google口コミの代わりの気分ベース口コミ）。
// GET /api/spot-posts で承認済み投稿を取得し、写真・気分タグ・ひとこと・誰と・時間帯・
// また行きたい・リアクション（いいね/参考になった/また行きたい）・通報を表示。
// 「Moodログを投稿」ボタンは mood-log 画面へ遷移（スポット情報をparamsで渡す）。
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, type Href } from 'expo-router';
import { MessageCirclePlus, ThumbsUp, Sparkles, Flag } from 'lucide-react-native';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { useSettings } from '@/lib/settingsStore';
import { relativeTime } from '@/lib/spotLog';
import ReportModal from '@/components/ReportModal';

const T = {
  ja: {
    you: '（あなた）',
    wantRevisit: 'また行きたい',
    matchesPhoto: '写真どおり',
    like: 'いいね',
    helpful: '参考',
    reportTitle: 'この投稿を通報',
    sectionTitle: 'みんなのMoodログ',
    count: (n: number) => `${n}件`,
    postBtn: '投稿する',
    empty: 'まだMoodログがありません。\nこの場所の最初のMoodログを投稿しませんか？',
  },
  en: {
    you: ' (You)',
    wantRevisit: 'Want to revisit',
    matchesPhoto: 'Matches photo',
    like: 'Like',
    helpful: 'Helpful',
    reportTitle: 'Report this post',
    sectionTitle: 'Everyone’s Mood logs',
    count: (n: number) => `${n}`,
    postBtn: 'Post',
    empty: 'No Mood logs yet.\nBe the first to post a Mood log for this place.',
  },
} as const;

export type MoodPost = {
  id: string; author: string; isOwn: boolean;
  caption?: string; moodTags: string[]; companion?: string | null;
  timeOfDay?: string | null; wantRevisit?: boolean | null; matchesPhoto?: boolean | null;
  photos: string[];
  likeCount: number; helpfulCount: number; revisitCount: number;
  myLike: boolean; myHelpful: boolean; myRevisit: boolean;
  createdAt?: string;
};


export default function MoodLogSection(
  { placeId, placeName, address, openHours, excludePostId }:
  { placeId?: string; placeName: string; address?: string; openHours?: string; excludePostId?: string },
) {
  const { lang } = useSettings();
  const t = T[lang];
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
      const arr: MoodPost[] = Array.isArray(d?.posts) ? d.posts : [];
      // いま詳細で見ている投稿自身は「みんなのMoodログ」から除外（同じログが二重に出ない）
      setPosts(excludePostId ? arr.filter((p) => p.id !== excludePostId) : arr);
    } catch { /* 取得失敗は空 */ } finally { setLoading(false); }
  }, [placeId, placeName, excludePostId]);

  // 画面がフォーカスされるたびに再取得（投稿→戻った直後に新しいMoodログが表示される）
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // 新規ルート（expo-routerの型は次回生成で解決・実行時はファイルベースで有効）→ unknown経由でHrefにキャスト
  const goPost = () => router.push({ pathname: '/post', params: { placeId: placeId ?? '', placeName, address: address ?? '', openHours: openHours ?? '' } } as unknown as Href);

  // カードタップ → そのMoodログの投稿詳細（community-spotはml-プレフィックスで両対応）
  const openDetail = (post: MoodPost) =>
    router.push({ pathname: '/community-spot', params: { id: `ml-${post.id}` } } as unknown as Href);

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
      const res = await apiFetch('/api/spot-posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'react', postId: post.id, deviceId: did, rtype, undo }) });
      const ok = (await res.json().catch(() => null))?.ok === true;
      if (!ok) throw new Error('react failed');
    } catch {
      // 失敗時は楽観表示を巻き戻す（表示とサーバー状態の不整合防止・監査2026-07-05）
      setPosts(prev => prev.map(p => p.id !== post.id ? p : ({
        ...p,
        likeCount: Math.max(0, p.likeCount - (rtype === 'like' ? d : 0)), myLike: rtype === 'like' ? undo : p.myLike,
        helpfulCount: Math.max(0, p.helpfulCount - (rtype === 'helpful' ? d : 0)), myHelpful: rtype === 'helpful' ? undo : p.myHelpful,
        revisitCount: Math.max(0, p.revisitCount - (rtype === 'revisit' ? d : 0)), myRevisit: rtype === 'revisit' ? undo : p.myRevisit,
      })));
    }
  };

  // 通報は全画面共通のReportModal（理由選択・adminログ＋自動非表示カウント）に統一（2026-07-11）
  const [reportTarget, setReportTarget] = useState<MoodPost | null>(null);

  // 1枚のMoodログカード（2カラム配置で左右どちらの列にも描画する）
  // カード全体タップで投稿詳細へ（内側のリアクション/通報ボタンはそれぞれのタップを優先）
  const renderPost = (post: MoodPost) => (
    <TouchableOpacity key={post.id} style={s.card} onPress={() => openDetail(post)} activeOpacity={0.85}
      accessibilityRole="button" accessibilityLabel={`${post.author}のMoodログ詳細を見る`}>
      <View style={s.cardTop}>
        <Text style={s.author} numberOfLines={1}>{post.author}{post.isOwn ? t.you : ''}</Text>
        <Text style={s.time}>{relativeTime(post.createdAt ?? '', lang)}</Text>
        <TouchableOpacity onPress={() => setReportTarget(post)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button" accessibilityLabel={t.reportTitle}>
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
          {post.wantRevisit ? <View style={s.chipGood}><Text style={s.chipGoodText}>{t.wantRevisit}</Text></View> : null}
          {post.matchesPhoto ? <View style={s.chipGood}><Text style={s.chipGoodText}>{t.matchesPhoto}</Text></View> : null}
        </View>
      )}

      {post.caption ? <Text style={s.caption}>{post.caption}</Text> : null}

      <View style={s.reactions}>
        <TouchableOpacity style={[s.reactBtn, post.myLike && s.reactOn]} onPress={() => react(post, 'like')} activeOpacity={0.7}>
          <ThumbsUp size={12} color={post.myLike ? '#fff' : '#A78BCA'} strokeWidth={2.2} />
          <Text style={[s.reactText, post.myLike && s.reactTextOn]}>{t.like} {post.likeCount || ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.reactBtn, post.myHelpful && s.reactOn]} onPress={() => react(post, 'helpful')} activeOpacity={0.7}>
          <Sparkles size={12} color={post.myHelpful ? '#fff' : '#A78BCA'} strokeWidth={2.2} />
          <Text style={[s.reactText, post.myHelpful && s.reactTextOn]}>{t.helpful} {post.helpfulCount || ''}</Text>
        </TouchableOpacity>
        {/* 「また」ボタンは廃止（いいね/参考の2つに集約・2026-07-10ユーザー指示）。
            サーバーのrevisit集計は既存データのため残る（表示しないだけ）。 */}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={s.section}>
      <View style={s.header}>
        <Sparkles size={15} color="#C084FC" strokeWidth={2} />
        <Text style={s.title}>{t.sectionTitle}</Text>
        {posts.length > 0 && <Text style={s.count}>{t.count(posts.length)}</Text>}
        <TouchableOpacity onPress={goPost} style={s.postBtnWrap} activeOpacity={0.85}>
          {/* ホーム画面と同じブランドグラデ（濃紫単色は「怖い」検索結果専用のため使わない） */}
          <LinearGradient colors={['#F56CB3', '#9B6BFF', '#4FA3FF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.postBtn}>
            <MessageCirclePlus size={14} color="#fff" strokeWidth={2.4} />
            <Text style={s.postBtnText}>{t.postBtn}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {loading && posts.length === 0 && (
        <View style={s.empty}><ActivityIndicator color="#9B6BFF" /></View>
      )}

      {!loading && posts.length === 0 && (
        <TouchableOpacity onPress={goPost} activeOpacity={0.8} style={s.empty}>
          <Text style={s.emptyText}>{t.empty}</Text>
        </TouchableOpacity>
      )}

      {posts.length > 0 && (
        <View style={s.cols}>
          <View style={s.col}>{posts.filter((_, i) => i % 2 === 0).map(renderPost)}</View>
          <View style={s.col}>{posts.filter((_, i) => i % 2 === 1).map(renderPost)}</View>
        </View>
      )}

      {/* 通報（フィード/投稿詳細と同じReportModal・受付後はこの一覧から対象を隠す）
          ⚠常時マウント+visibleトグル（Fabricの透明Modalバグ回避） */}
      <ReportModal
        visible={!!reportTarget}
        spotName={placeName || reportTarget?.author || '投稿'}
        spotAddress={address ?? ''}
        suggestionId={reportTarget ? `ml-${reportTarget.id}` : undefined}
        onReported={() => { const id = reportTarget?.id; if (id) setPosts(prev => prev.filter(p => p.id !== id)); }}
        onClose={() => setReportTarget(null)}
      />
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
  postBtnWrap: { marginLeft: 'auto', borderRadius: 14, overflow: 'hidden' },
  postBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12 },
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
  chipText: { fontSize: 11, color: '#9B6BFF', fontWeight: '700' },
  chipAlt: { backgroundColor: '#F0F0F4', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  chipAltText: { fontSize: 11, color: '#6B7280', fontWeight: '700' },
  chipGood: { backgroundColor: '#FCE7F3', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  chipGoodText: { fontSize: 11, color: '#DB2777', fontWeight: '700' },
  caption: { fontSize: 13.5, color: '#3F3550', lineHeight: 20, marginBottom: 8 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },   // 半幅カードで折り返す
  reactBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 11, paddingVertical: 4, paddingHorizontal: 7 },
  reactOn: { backgroundColor: '#9B6BFF', borderColor: '#9B6BFF' },
  reactText: { fontSize: 10.5, color: '#A78BCA', fontWeight: '700' },
  reactTextOn: { color: '#fff' },
});
