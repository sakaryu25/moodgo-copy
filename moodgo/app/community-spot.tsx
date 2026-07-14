/**
 * community-spot.tsx
 * 全国みんなの穴場 — スポット詳細ページ
 * place.tsx のデザイン言語に寄せつつ、コミュニティ独自要素
 * （利用者コメント・投稿者おすすめ度・利用者写真）を活かす。
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import {
  CalendarClock, CalendarX, Camera, ChevronLeft, ChevronRight, Clock, Footprints, Globe, Heart, Lock, MapPin, MessageCircle, MoreHorizontal, Phone, Star, Train, UserRound, Wallet,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, NativeScrollEvent, NativeSyntheticEvent,
  Share, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { useSettings } from '@/lib/settingsStore';
import { getDeviceId } from '@/lib/abtest';
import { openInGoogleMaps } from '@/lib/openMaps';
import { showToast } from '@/lib/toast';
import CommentsSection from '@/components/CommentsSection';
import MoodLogSection from '@/components/MoodLogSection';
import SpotRating from '@/components/SpotRating';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useMyIdentity, resolvePoster, getMyHash } from '@/lib/myIdentity';
import { setSelectedPlace } from '@/lib/selectedPlace';
import { markFeedStale } from '@/lib/feedRefresh';
import PhotoViewer from '@/components/PhotoViewer';
import ReportModal from '@/components/ReportModal';
import AppActionSheet from '@/components/AppActionSheet';
import { blockUser } from '@/lib/blockStore';

const PINK = '#F56CB3';
const PURPLE = '#9B6BFF';
const BLUE = '#4FA3FF';
const GRAD: [string, string, string] = [PINK, PURPLE, BLUE];
const IG_GRAD: [string, string, string] = ['#FCAF45', '#E1306C', '#833AB4'];

type Review = {
  rating: number | null; text: string; authorName: string;
  authorPhoto: string | null; relativeTime: string;
};

type Spot = {
  id: string; userTitle: string; placeName: string; description: string;
  priceText: string; rating: number; googleRating: number | null; reviewCount: number | null;
  openNow: boolean | null; imageUrls: string[]; hasUserPhotos: boolean;
  address: string; phone: string; website: string; googleMapsUri: string;
  stationText: string; openingHoursText: string; prefecture: string;
  reviews?: Review[];
  lat?: number; lng?: number; placeId?: string;
  availableFrom?: string | null; availableUntil?: string | null;  // 公開期間（期間限定投稿）
  posterName?: string | null; posterHandle?: string | null; posterIcon?: string | null;  // 投稿者（匿名はnull）
  posterId?: string | null;   // 投稿者の公開ハッシュ（プロフィール/フォロー用）
  posterType?: string | null; // 投稿者バッジ種別（official/store）＝詳細でもバッジ表示
  parentPlaceId?: string | null; parentPlaceName?: string | null;   // 期間限定イベントの親スポット（名前タップの遷移先）
  visibility?: string | null; isMine?: boolean;   // 公開範囲＋本人判定（本人は匿名でも自分の表示）
  kind?: string;              // 'moodlog' | 'suggestion'（いいねtargetId構築用）
  likeCount?: number;         // 投稿へのいいね数
  visitedCount?: number;      // 行った！された回数（閲覧者が押した数）
};

const T = {
  ja: {
    notFound: 'スポットが見つかりませんでした',
    back: '戻る',
    menuA11y: 'メニュー（共有・編集・削除など）',
    userPhotos: '利用者の写真',
    map: 'マップ',
    profileA11y: (name: string) => `${name}のプロフィールを見る`,
    placeDetailA11y: (name: string) => `${name}の場所詳細を見る`,
    defaultUser: 'MoodGoユーザー',
    poster: '投稿者',
    anonymousPost: '匿名の投稿',
    anonSelfName: 'あなたの投稿（名前非公開）',
    anonSelfNote: '他の人には名前が表示されません',
    privateTag: '非公開',
    overallRating: '総合評価',
    beenHere: '行った！',
    limitedSpot: '期間限定の穴場',
    limitedEnded: '期間限定（終了）',
    ended: '終了',
    whatPlace: 'どんな場所？',
    posterRecommend: '投稿者のおすすめ度',
    reviewCount: (n: string) => `${n}件の口コミ`,
    searchInstagram: 'Instagramで検索',
    hours: '営業時間',
    open: '営業中',
    closed: '営業時間外',
    eventOngoing: '開催中',
    eventUpcoming: '開催予定',
    eventKicker: '期間限定イベント',
    helpfulReviews: 'ためになった口コミ',
    close: '閉じる',
    seeMore: 'もっと見る',
    likeRemove: 'いいねを取り消す',
    likeAdd: 'この投稿にいいね',
    editPost: '投稿を編集',
    deletePost: '投稿を削除',
    share: '共有する',
    report: '通報する',
    cancel: 'キャンセル',
    menu: 'メニュー',
    deleteConfirmTitle: '投稿を削除しますか？',
    deleteConfirmMsg: 'この操作は取り消せません。',
    deleteAction: '削除する',
    deleted: '投稿を削除しました',
    deleteFailed: '削除できませんでした',
    deleteFailedRetry: '時間をおいてお試しください',
    deleteFailedNet: '通信に失敗しました',
    fromNow: '即日',
    noEnd: '無期限',
  },
  en: {
    notFound: 'Spot not found',
    back: 'Back',
    menuA11y: 'Menu (share, edit, delete, etc.)',
    userPhotos: 'User photos',
    map: 'Map',
    profileA11y: (name: string) => `View ${name}'s profile`,
    placeDetailA11y: (name: string) => `View place details for ${name}`,
    defaultUser: 'MoodGo user',
    poster: 'Posted by',
    anonymousPost: 'Anonymous post',
    anonSelfName: 'Your post (name hidden)',
    anonSelfNote: 'Your name isn\'t shown to others',
    privateTag: 'Private',
    overallRating: 'Overall rating',
    beenHere: 'Been here!',
    limitedSpot: 'Limited-time spot',
    limitedEnded: 'Limited-time (ended)',
    ended: 'Ended',
    whatPlace: 'What kind of place?',
    posterRecommend: "Poster's rating",
    reviewCount: (n: string) => `${n} reviews`,
    searchInstagram: 'Search on Instagram',
    hours: 'Hours',
    open: 'Open now',
    closed: 'Closed',
    eventOngoing: 'Now on',
    eventUpcoming: 'Upcoming',
    eventKicker: 'Limited-time event',
    helpfulReviews: 'Helpful reviews',
    close: 'Close',
    seeMore: 'See more',
    likeRemove: 'Remove like',
    likeAdd: 'Like this post',
    editPost: 'Edit post',
    deletePost: 'Delete post',
    share: 'Share',
    report: 'Report',
    cancel: 'Cancel',
    menu: 'Menu',
    deleteConfirmTitle: 'Delete this post?',
    deleteConfirmMsg: 'This action cannot be undone.',
    deleteAction: 'Delete',
    deleted: 'Post deleted',
    deleteFailed: "Couldn't delete",
    deleteFailedRetry: 'Please try again later',
    deleteFailedNet: 'Connection failed',
    fromNow: 'Today',
    noEnd: 'No end date',
  },
} as const;

// "2026-04-15" → "2026/4/15"。null/未設定はnull。
function fmtJpDate(d?: string | null): string | null {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : d;
}
// 公開期間の表示。開始未設定→「即日」、終了未設定→「無期限」。
function fmtPeriod(from: string | null | undefined, until: string | null | undefined, t: typeof T['ja' | 'en']): string {
  return `${fmtJpDate(from) ?? t.fromNow} 〜 ${fmtJpDate(until) ?? t.noEnd}`;
}

function Stars({ n, size = 16 }: { n: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} color={i <= Math.round(n) ? '#F59E0B' : '#E5E7EB'}
          fill={i <= Math.round(n) ? '#F59E0B' : '#E5E7EB'} strokeWidth={0} />
      ))}
    </View>
  );
}

export default function CommunitySpotScreen() {
  const me = useMyIdentity();   // 自分の投稿なら現在プロフィールで投稿者表示を上書き
  const insets = useSafeAreaInsets();
  const { lang } = useSettings();
  const t = T[lang];
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [spot, setSpot] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [photoW, setPhotoW] = useState(0);
  // 投稿へのいいね＋投稿者プロフィールシート
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [isMine, setIsMine] = useState(false);   // 自分の投稿なら編集/削除を出す（moodログのみ）
  const [viewerOpen, setViewerOpen] = useState(false);   // 写真タップで全画面ビューア
  const [reportOpen, setReportOpen] = useState(false);   // 通報モーダル（全画面共通のReportModal）
  const [menuOpen, setMenuOpen] = useState(false);       // 右上「…」メニュー（アプリ共通のAppActionSheet）
  const [deleteConfirm, setDeleteConfirm] = useState(false);   // 投稿削除の確認シート
  // 総合評価（この場所のみんなの★の平均）。SpotRatingが取得→onAvgで受け取りバーに表示
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [priceAvg, setPriceAvg] = useState<string | null>(null);   // 利用者の値段の平均（みんなの目安）
  const [priceCount, setPriceCount] = useState(0);
  // この場所で開催中/予定の期間限定イベント（派生スポット）＝場所詳細と同じバッジを投稿詳細にも出す（統一）
  const [placeEvents, setPlaceEvents] = useState<Array<{ targetId: string; eventName: string; until: string | null; upcoming: boolean }>>([]);
  useEffect(() => {
    const name = (spot?.placeName || spot?.userTitle || '').trim();
    if (!name || name.length < 2) { setPlaceEvents([]); return; }
    let active = true;
    apiFetch(`/api/place-events?placeName=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((d) => { if (active && d?.ok && Array.isArray(d.events)) setPlaceEvents(d.events.filter((e: { targetId?: string }) => !!e.targetId && e.targetId !== id)); })
      .catch(() => {});
    return () => { active = false; };
  }, [spot?.placeName, spot?.userTitle, id]);

  // フォーカスの度に再取得＝編集(公開範囲/名前等)から戻ると即その投稿に反映される
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const vh = await getMyHash().catch(() => '');
        const res = await apiFetch(`/api/community-spot?id=${id}${vh ? `&viewerHash=${encodeURIComponent(vh)}` : ''}`);
        const d = await res.json();
        if (d.ok) {
          setSpot(d.spot);
          if (typeof d.spot.isMine === 'boolean') setIsMine(d.spot.isMine);   // 本人なら匿名でも自分の表示＋編集/削除
          if (typeof d.spot.likeCount === 'number') setLikeCount(d.spot.likeCount);
          // 総合評価（みんなの★平均）をライブ取得してバーに表示（SpotRatingのキャッシュに依存しない）
          (async () => {
            try {
              const qs = new URLSearchParams();
              if (d.spot.placeId) qs.set('placeId', String(d.spot.placeId));
              qs.set('placeName', d.spot.placeName || d.spot.userTitle || '');
              const rr = await apiFetch(`/api/spot-rating?${qs.toString()}`).then((x) => x.json());
              if (rr?.ok) { setAvgRating(rr.avg ?? null); setRatingCount(rr.count ?? 0); setPriceAvg(rr.priceAvg ?? null); setPriceCount(rr.priceCount ?? 0); }
            } catch { /* noop */ }
          })();
          // 自分がいいね済みか（失敗しても未押下扱いで続行）
          try {
            const deviceId = await getDeviceId();
            const likeTarget = d.spot.kind === 'moodlog' ? `ml-${d.spot.id}` : d.spot.id;
            const st = await apiFetch('/api/spot-like', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'status', targetId: likeTarget, deviceId }),
            }).then((r) => r.json());
            if (st?.ok) {
              setLiked(!!st.liked);
              if (typeof st.count === 'number') setLikeCount(st.count);
            }
          } catch { /* noop */ }
          // 自分の投稿か判定（moodログのみ・編集/削除ボタンの表示に使う。生device_idはbodyのみ）
          if (d.spot.kind === 'moodlog') {
            try {
              const deviceId = await getDeviceId();
              const mine = await apiFetch('/api/spot-posts', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'is-mine', postId: d.spot.id, deviceId }),
              }).then((r) => r.json());
              if (mine?.ok) setIsMine(!!mine.mine);
            } catch { /* noop */ }
          }
        }
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, [id]));

  // 右下ハート＝この投稿への「いいね」専用（楽観更新・失敗時ロールバック）。
  //   場所の保存（お気に入り）は場所詳細のハートに分離＝ハートの意味を画面間で統一（2026-07-11）。
  //   投稿♥=いいね(数字=いいね数) / 場所♥=保存(数字=保存人数)。
  const onHeartPress = async () => {
    if (!spot || likeBusy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    markFeedStale();   // フィード/プロフィールのいいね数を次のフォーカスで再取得（すぐ反映）
    setLikeBusy(true);
    try {
      const deviceId = await getDeviceId();
      const likeTarget = spot.kind === 'moodlog' ? `ml-${spot.id}` : spot.id;
      const d = await apiFetch('/api/spot-like', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: next ? 'like' : 'unlike', targetId: likeTarget, deviceId }),
      }).then((r) => r.json());
      if (!d?.ok) throw new Error('like失敗');
      if (typeof d.count === 'number') setLikeCount(d.count);
    } catch {
      setLiked(!next);
      setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally { setLikeBusy(false); }
  };

  const onPhotoScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (photoW <= 0) return;
    setPhotoIdx(Math.round(e.nativeEvent.contentOffset.x / photoW));
  };
  const openMap = () => {
    if (!spot) return;
    // 名前＋住所で検索＝Googleの店舗リスティング(営業時間/口コミ)に着地する。
    // 座標はopenMaps側でcenterヒントに使われ、同名別店への誤着地を近傍優先で防ぐ（2026-07-14）。
    openInGoogleMaps({
      query: [spot.placeName || spot.userTitle, spot.address].filter(Boolean).join(' '),
      lat: spot.lat,
      lng: spot.lng,
      mapsUri: spot.googleMapsUri,
    });
  };
  const openInstagram = () => {
    if (!spot) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const tag = (spot.placeName || spot.userTitle).replace(/\s+/g, '');
    Linking.openURL(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`).catch(() => {});
  };
  // 場所名タップ → 場所詳細ページ（投稿が紐づく場所そのものを見る。営業時間/住所等は同じ情報源）
  const openPlaceDetail = () => {
    if (!spot) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // 期間限定イベント("◯◯＠親スポット")の名前タップ → 親スポット(例: 東京ドリームパーク)の場所詳細へ。
    //   住所/営業時間/座標は親から継承済みなのでそのまま渡す。写真は親のものをplace側で取得（イベント写真は渡さない）。
    if (spot.parentPlaceId) {
      setSelectedPlace({
        title: spot.parentPlaceName || spot.placeName || spot.userTitle,
        vibe: '',
        address: spot.address || undefined,
        mapUrl: spot.googleMapsUri || undefined,
        photoUrl: undefined, photoUrls: undefined,
        openingHoursText: spot.openingHoursText || undefined,
        stationText: spot.stationText || undefined,
        phone: spot.phone || undefined,
        website: spot.website || undefined,
        // parentPlaceIdはSupabase UUID。placeId(Google ID用)ではなくsupabaseIdに渡す＝
        // 場所詳細側の写真/Moodログ/評価の取得キーが正しく効き、検索から開いた時と同じ表示になる
        supabaseId: spot.parentPlaceId,
        lat: spot.lat, lng: spot.lng,
        hasUserPhotos: true,
        isUserSpot: true,
      });
      router.push('/place');
      return;
    }
    setSelectedPlace({
      title: spot.placeName || spot.userTitle,
      vibe: '',
      address: spot.address || undefined,
      mapUrl: spot.googleMapsUri || undefined,
      photoUrl: spot.imageUrls[0], photoUrls: spot.imageUrls.length > 0 ? spot.imageUrls : undefined,
      openingHoursText: spot.openingHoursText || undefined,
      stationText: spot.stationText || undefined,
      phone: spot.phone || undefined,
      website: spot.website || undefined,
      // place_idはSupabase UUID(選択/新規スポット)とGoogle ID(ChIJ…)が混在。
      // UUIDはsupabaseIdへ＝写真/Moodログ/評価の取得キーが効く。Google IDだけplaceIdへ。
      supabaseId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(spot.placeId ?? '') ? spot.placeId! : undefined,
      placeId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(spot.placeId ?? '') ? undefined : (spot.placeId || undefined),
      lat: spot.lat, lng: spot.lng,
      hasUserPhotos: spot.hasUserPhotos,
      isUserSpot: true,
    });
    router.push('/place');
  };
  const onShare = () => {
    if (!spot) return;
    // OGP付き共有ページ(/s/[id])のリンクを送る＝LINE/X等で写真付きカードが展開される
    const shareId = spot.kind === 'moodlog' ? `ml-${spot.id}` : spot.id;
    const url = `https://moodgo-qvmk.vercel.app/s/${shareId}`;
    Share.share({ message: `${spot.placeName || spot.userTitle} | MoodGo\n${url}` });
  };

  // 自分の投稿を編集（/post を編集モードで開く。テキスト項目を更新）
  const onEdit = () => {
    if (!spot) return;
    router.push({ pathname: '/post', params: { editId: spot.id } });
  };
  // 自分の投稿を削除（確認シート → サーバー削除 → 戻る）。確認はアプリ共通のAppActionSheet。
  const onDelete = () => { if (spot) setDeleteConfirm(true); };
  const doDelete = async () => {
    if (!spot) return;
    try {
      const deviceId = await getDeviceId();
      const d = await apiFetch('/api/spot-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', postId: spot.id, deviceId }),
      }).then((r) => r.json());
      if (d?.ok) { markFeedStale(); showToast(t.deleted); router.back(); }   // 削除をフィード/プロフィールに即反映
      else showToast(t.deleteFailed, d?.error ?? t.deleteFailedRetry);
    } catch { showToast(t.deleteFailed, t.deleteFailedNet); }
  };
  // 右上「…」メニュー: 自分の投稿は 編集/削除/共有、他人は 共有/通報（アプリ共通のAppActionSheet）
  const openMenu = () => {
    if (!spot) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMenuOpen(true);
  };

  if (loading) {
    return <View style={[s.root, s.center, { paddingTop: insets.top }]}><ActivityIndicator color={PURPLE} size="large" /></View>;
  }
  if (!spot) {
    return (
      <View style={[s.root, s.center, { paddingTop: insets.top }]}>
        <Text style={{ color: '#888' }}>{t.notFound}</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={{ color: PURPLE, fontWeight: '800' }}>{t.back}</Text></TouchableOpacity>
      </View>
    );
  }

  const photos = spot.imageUrls;
  // 値段: 利用者の平均があればそれを「みんなの目安」として、無ければこの投稿のprice_chipを表示
  const priceDisplay = priceCount > 0 && priceAvg
    ? (priceCount >= 2 ? `${priceAvg}（${priceCount}人の平均）` : priceAvg)
    : spot.priceText;
  // 期間限定の公開期間が過ぎたか（今日 > 終了日）＝「終了しました」表示に切り替える
  const periodEnded = !!(spot.availableUntil && String(spot.availableUntil).slice(0, 10) < new Date().toISOString().slice(0, 10));
  const hasGoogleRating = spot.googleRating != null;

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        {/* ── 写真カルーセル ── */}
        <View style={s.photoWrap} onLayout={(e) => setPhotoW(e.nativeEvent.layout.width)}>
          {photos.length > 0 && photoW > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} decelerationRate="fast" onMomentumScrollEnd={onPhotoScroll}>
              {photos.map((uri, i) => (
                // タップで全画面ビューア（場所詳細と共通のPhotoViewer）
                <TouchableOpacity key={i} activeOpacity={0.95} onPress={() => setViewerOpen(true)}>
                  <Image source={{ uri }} style={{ width: photoW, height: 340 }} contentFit="cover" transition={250} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <LinearGradient colors={['#E8E0FF', '#D6EAF8']} style={{ width: '100%', height: 340, alignItems: 'center', justifyContent: 'center' }}>
              <MapPin size={44} color={PURPLE} strokeWidth={1.5} />
            </LinearGradient>
          )}

          {/* 上のグラデ（アイコン視認性）*/}
          <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent']} style={s.topScrim} pointerEvents="none" />

          {/* 戻る / 共有 */}
          <TouchableOpacity onPress={() => router.back()} style={[s.circleBtn, { top: insets.top + 6, left: 14 }]} activeOpacity={0.85}>
            <ChevronLeft size={22} color="#1A0A2E" strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity onPress={openMenu} style={[s.circleBtn, { top: insets.top + 6, right: 14 }]} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel={t.menuA11y}>
            <MoreHorizontal size={20} color="#1A0A2E" strokeWidth={2.4} />
          </TouchableOpacity>

          {/* 写真カウンター */}
          {photos.length > 0 && (
            <View style={s.counter}><Text style={s.counterText}>{photoIdx + 1} / {photos.length}</Text></View>
          )}
          {/* 利用者写真バッジ */}
          {spot.hasUserPhotos && photos.length > 0 && (
            <View style={s.userBadge}>
              <Camera size={12} color="#fff" strokeWidth={2.2} />
              <Text style={s.userBadgeText}>{t.userPhotos}</Text>
            </View>
          )}
          {/* ドット */}
          {photos.length > 1 && (
            <View style={s.dots}>
              {photos.slice(0, 10).map((_, i) => <View key={i} style={[s.dot, i === photoIdx && s.dotActive]} />)}
            </View>
          )}
        </View>

        {/* ── 本文 ── */}
        <View style={s.body}>
          {/* 都道府県（独立行）*/}
          {spot.prefecture ? (
            <View style={s.prefRow}>
              <MapPin size={12} color="#9CA3AF" strokeWidth={2.2} />
              <Text style={s.pref}>{spot.prefecture}</Text>
            </View>
          ) : null}

          {/* タイトル行 + マップピル（同じ高さで中央揃え）。場所名タップで場所詳細ページへ */}
          <View style={s.titleRow}>
            <Text style={s.title} onPress={openPlaceDetail} suppressHighlighting>{spot.userTitle || spot.placeName}</Text>
            <TouchableOpacity onPress={openMap} activeOpacity={0.85}>
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mapPill}>
                <MapPin size={15} color="#fff" strokeWidth={2.5} />
                <Text style={s.mapPillText}>{t.map}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
          {spot.placeName && spot.placeName !== spot.userTitle ? (
            <TouchableOpacity onPress={openPlaceDetail} activeOpacity={0.7} style={s.placeNameRow}
              accessibilityRole="button" accessibilityLabel={t.placeDetailA11y(spot.placeName)}>
              <Text style={s.placeName}>{spot.placeName}</Text>
              <ChevronRight size={14} color="#9B96A6" strokeWidth={2.4} />
            </TouchableOpacity>
          ) : null}

          {/* 場所エリアチップ */}
          {spot.address ? (
            <View style={s.areaChip}>
              <MapPin size={13} color={PURPLE} strokeWidth={2.2} />
              {/* 下の住所欄と同じ住所を全文表示（固定文字数で切ると番地が欠けて別住所に見える） */}
              <Text style={s.areaChipText} numberOfLines={1} ellipsizeMode="tail">
                {spot.address.replace(/^日本[、,]\s*/, '').replace(/^〒?\s*\d{3}-?\d{4}\s*/, '')}
              </Text>
            </View>
          ) : null}

          {/* ── 投稿者カード（タップでプロフィール）＋投稿へのいいね ── */}
          <View style={s.posterCard}>
            {spot.visibility === 'spot_public_anonymous' && !isMine ? (
              // 他人の名前非公開投稿: 名前は出さない（匿名のまま＝逆引き不可）
              <View style={s.posterMain}>
                <View style={[s.posterCardAvatar, s.posterAvatarPh]}>
                  <UserRound size={20} color={PURPLE} strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.posterKicker}>{t.poster}</Text>
                  <Text style={s.posterName} numberOfLines={1}>{t.anonymousPost}</Text>
                </View>
              </View>
            ) : spot.posterId ? (() => {
              // 公開 or 自分の名前非公開: 現在プロフィール（名前/アイコン/@ID/バッジ）で表示＝全画面で名前を統一。
              //   自分の名前非公開は本人にだけ名前を出し「非公開」を明示（他者には上の匿名分岐で隠れる）。
              const poster = resolvePoster(spot.posterId, { name: spot.posterName, icon: spot.posterIcon, handle: spot.posterHandle, accountType: spot.posterType }, me);
              const selfAnon = isMine && spot.visibility === 'spot_public_anonymous';
              const openId = poster.isMe ? (me.hash || spot.posterId) : spot.posterId;
              return (
              <TouchableOpacity
                onPress={() => { if (openId) router.push({ pathname: '/user/[id]', params: { id: openId } }); }}
                disabled={!openId}
                activeOpacity={0.75} style={s.posterMain}
                accessibilityRole="button" accessibilityLabel={t.profileA11y(poster.name?.trim() || t.defaultUser)}>
                {poster.icon ? (
                  <Image source={{ uri: poster.icon }} style={s.posterCardAvatar} contentFit="cover" />
                ) : (
                  <View style={[s.posterCardAvatar, s.posterAvatarPh]}>
                    <UserRound size={20} color={PURPLE} strokeWidth={1.8} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.posterKicker}>{t.poster}</Text>
                  <View style={s.posterNameRow}>
                    <Text style={s.posterName} numberOfLines={1}>{poster.name?.trim() || t.defaultUser}</Text>
                    <VerifiedBadge type={poster.accountType} size={13} />
                    {selfAnon ? (
                      <View style={s.posterPrivTag}>
                        <Lock size={9} color="#9A96A8" strokeWidth={2.4} />
                        <Text style={s.posterPrivText}>{t.privateTag}</Text>
                      </View>
                    ) : null}
                  </View>
                  {poster.handle ? <Text style={s.posterHandle} numberOfLines={1}>@{poster.handle}</Text> : null}
                  {selfAnon ? <Text style={s.posterAnonNote}>{t.anonSelfNote}</Text> : null}
                </View>
                <ChevronRight size={17} color="#B7B3C2" strokeWidth={2.2} />
              </TouchableOpacity>
              );
            })() : (
              <View style={s.posterMain}>
                <View style={[s.posterCardAvatar, s.posterAvatarPh]}>
                  <UserRound size={20} color={PURPLE} strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.posterKicker}>{t.poster}</Text>
                  <Text style={s.posterName}>{t.anonymousPost}</Text>
                </View>
              </View>
            )}
          </View>

          {/* この場所で開催中/予定の期間限定イベントへの導線（場所詳細と統一・派生スポット「◯◯＠この場所」へ遷移）*/}
          {placeEvents.length > 0 && (
            <View style={s.eventWrap}>
              {placeEvents.map((ev, i) => (
                <TouchableOpacity key={i} activeOpacity={0.85}
                  onPress={() => router.push({ pathname: '/community-spot', params: { id: ev.targetId } })}
                  accessibilityRole="button" accessibilityLabel={ev.eventName}>
                  <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.eventRow}>
                    <View style={s.eventIcon}><CalendarClock size={17} color="#fff" strokeWidth={2.4} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={s.eventTopRow}>
                        <Text style={s.eventKicker}>{t.eventKicker}</Text>
                        <View style={s.eventDatePill}>
                          <Text style={s.eventDateText}>
                            {ev.upcoming ? t.eventUpcoming : t.eventOngoing}
                            {ev.until ? ` 〜${ev.until.split('-').slice(1).map(Number).join('/')}` : ''}
                          </Text>
                        </View>
                      </View>
                      <Text style={s.eventName} numberOfLines={1}>{ev.eventName}</Text>
                    </View>
                    <ChevronRight size={17} color="rgba(255,255,255,0.9)" strokeWidth={2.6} />
                  </LinearGradient>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── みんなの声のバー（総合評価＝みんなの★平均 / 行った!。いいね数は右下のハートFABのみ）── */}
          <View style={s.voiceBar}>
            <View style={s.voiceCell}>
              <View style={s.voiceValRow}><Star size={13} color="#F59E0B" fill="#F59E0B" strokeWidth={0} /><Text style={s.voiceVal}>{ratingCount > 0 && avgRating != null ? avgRating.toFixed(1) : '—'}</Text></View>
              <Text style={s.voiceLabel}>{t.overallRating}{ratingCount > 0 ? `（${ratingCount}）` : ''}</Text>
            </View>
            <View style={s.voiceDivider} />
            <View style={s.voiceCell}>
              <View style={s.voiceValRow}><Footprints size={13} color="#10B981" strokeWidth={2.2} /><Text style={s.voiceVal}>{spot.visitedCount ?? 0}</Text></View>
              <Text style={s.voiceLabel}>{t.beenHere}</Text>
            </View>
          </View>

          {/* ── あなたの評価（総合評価バーのすぐ下＝上部に配置）── */}
          <View style={{ marginBottom: 14 }}>
            <SpotRating placeId={spot.placeId} placeName={spot.placeName || spot.userTitle}
              hideAggregate onAvg={(a, c) => { setAvgRating(a); setRatingCount(c); }} />
          </View>

          {/* ── 期間限定の穴場（公開期間が設定されている場合）── */}
          {(spot.availableFrom || spot.availableUntil) ? (
            <View style={[s.periodCard, periodEnded && s.periodCardEnded]}>
              <View style={[s.periodIconWrap, periodEnded && s.periodIconWrapEnded]}>
                {periodEnded
                  ? <CalendarX size={17} color="#fff" strokeWidth={2.4} />
                  : <CalendarClock size={17} color="#fff" strokeWidth={2.4} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.periodLabel, periodEnded && s.periodLabelEnded]}>{periodEnded ? t.limitedEnded : t.limitedSpot}</Text>
                <Text style={[s.periodValue, periodEnded && s.periodValueEnded]}>{fmtPeriod(spot.availableFrom, spot.availableUntil, t)}</Text>
              </View>
              {periodEnded ? <View style={s.periodEndedTag}><Text style={s.periodEndedTagText}>{t.ended}</Text></View> : null}
            </View>
          ) : null}

          {/* ── 大目玉: 利用者コメント＋投稿者のおすすめ度 ── */}
          {(spot.description || spot.rating > 0) ? (
            <View style={s.commentCard}>
              {/* 投稿者表示は上の投稿者カードに移設（重複を避ける） */}
              {spot.description ? (
                <>
                  <View style={s.commentLabelRow}>
                    <MessageCircle size={14} color={PURPLE} fill={PURPLE} strokeWidth={0} />
                    <Text style={s.commentLabel}>{t.whatPlace}</Text>
                  </View>
                  <Text style={s.commentText}>{spot.description}</Text>
                </>
              ) : null}
              {spot.rating > 0 ? (
                <View style={[s.posterRate, !spot.description && s.posterRateTop]}>
                  <Text style={s.posterRateLabel}>{t.posterRecommend}</Text>
                  <Stars n={spot.rating} size={16} />
                  <Text style={s.posterRateNum}>{spot.rating}.0</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* ── 評価カード（Google）── */}
          {hasGoogleRating && (
            <View style={s.ratingCard}>
              <Text style={s.ratingBig}>{spot.googleRating!.toFixed(1)}</Text>
              <View style={{ flex: 1 }}>
                <Stars n={spot.googleRating!} size={18} />
                {spot.reviewCount != null && (
                  <Text style={s.reviewCount}>{t.reviewCount(spot.reviewCount.toLocaleString('ja-JP'))}</Text>
                )}
              </View>
            </View>
          )}

          {/* ── 情報カード（検索結果の場所詳細と同じ意匠: アイコン＋値・行の上罫線で区切り）── */}
          <View style={s.infoCard}>
            {/* 順番: 住所 → 営業時間 → 金額(みんなの平均) → 最寄駅 → 電話 → web → Instagram（場所詳細と統一）*/}
            {spot.address ? <InfoRow Icon={MapPin} value={spot.address} /> : null}
            {/* 営業時間。⚠ 曜日:時刻でsplitしない（「10:00〜23:00」を割る旧バグ回避）＝行そのまま表示 */}
            {spot.openingHoursText ? (
              <View style={[s.infoRow, spot.address ? s.infoRowBorder : null]}>
                <View style={s.infoIconWrap}><Clock size={15} color="#C084FC" strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  {spot.openingHoursText.split('\n').map((line, i) => (
                    <Text key={i} style={[s.infoText, { paddingTop: i === 0 ? 0 : 2 }]}>{line}</Text>
                  ))}
                </View>
                {spot.openNow != null && (
                  <View style={[s.openBadge, !spot.openNow && s.closedBadge]}>
                    <View style={[s.openDot, !spot.openNow && { backgroundColor: '#EF4444' }]} />
                    <Text style={[s.openText, !spot.openNow && { color: '#EF4444' }]}>{spot.openNow ? t.open : t.closed}</Text>
                  </View>
                )}
              </View>
            ) : null}
            {priceDisplay ? <InfoRow Icon={Wallet} value={priceDisplay} border={!!(spot.address || spot.openingHoursText)} /> : null}
            {spot.stationText ? <InfoRow Icon={Train} value={spot.stationText} border={!!(spot.address || spot.openingHoursText || priceDisplay)} /> : null}
            {spot.phone ? <InfoRow Icon={Phone} value={spot.phone} link onPress={() => Linking.openURL(`tel:${spot.phone}`)} border={!!(spot.address || spot.openingHoursText || priceDisplay || spot.stationText)} /> : null}
            {spot.website ? <InfoRow Icon={Globe} value={spot.website.replace(/^https?:\/\//, '').replace(/\/$/, '')} link onPress={() => Linking.openURL(spot.website)} border={!!(spot.address || spot.openingHoursText || priceDisplay || spot.stationText || spot.phone)} /> : null}
            {/* Instagram検索 */}
            <TouchableOpacity onPress={openInstagram} activeOpacity={0.7}
              style={[s.infoRow, (spot.address || spot.openingHoursText || priceDisplay || spot.stationText || spot.phone || spot.website) ? s.infoRowBorder : null]}>
              <View style={s.infoIconWrap}>
                <LinearGradient colors={IG_GRAD} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={s.igIcon}>
                  <View style={s.igOuter}><View style={s.igLens} /><View style={s.igDot} /></View>
                </LinearGradient>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.infoText, { color: '#C13584', paddingTop: 0 }]}>{t.searchInstagram}</Text>
                <Text style={s.infoSubText}>#{(spot.placeName || spot.userTitle).replace(/\s+/g, '')}</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* 営業時間は上の情報カード内(Instagramの上)に移設済み。旧・別枠カードは廃止(表示バグの温床だった) */}

          {/* ── 口コミ（ためになった順）── */}
          {spot.reviews && spot.reviews.length > 0 && (
            <View style={s.reviewsCard}>
              <View style={s.reviewsHead}>
                <MessageCircle size={16} color={PURPLE} strokeWidth={2.2} />
                <Text style={s.reviewsTitle}>{t.helpfulReviews}</Text>
              </View>
              {spot.reviews.map((r, i) => (
                <ReviewCard key={i} review={r} last={i === spot.reviews!.length - 1} />
              ))}
            </View>
          )}

          {/* ── コメント（この投稿への会話・1階層）＝Moodログより上 ── */}
          <CommentsSection targetId={spot.kind === 'moodlog' ? `ml-${spot.id}` : spot.id} />

          {/* ── みんなのMoodログ（同じ場所への他の投稿）＝一番下。いま見ている投稿自身は除外 ── */}
          <MoodLogSection placeId={spot.placeId} placeName={spot.placeName || spot.userTitle} address={spot.address} openHours={spot.openingHoursText ?? undefined}
            excludePostId={spot.kind === 'moodlog' ? spot.id : undefined} />
        </View>
      </ScrollView>

      {/* 写真タップの全画面ビューア（場所詳細と共通・スワイプで閉じる/サムネ/ズーム）
          ⚠常時マウント+visibleトグル（Fabricの透明Modalバグ回避・条件付きマウント禁止） */}
      <PhotoViewer visible={viewerOpen && photos.length > 0} photos={photos}
        initialIdx={Math.min(photoIdx, Math.max(0, photos.length - 1))} onClose={() => setViewerOpen(false)} />

      {/* 通報（フィードと同じReportModal＝理由選択・投稿者ブロック・自動非表示カウント統一）
          ⚠常時マウント+visibleトグル（Fabricの透明Modalバグ回避・条件付きマウント禁止） */}
      <ReportModal
        visible={reportOpen}
        spotName={spot.placeName || spot.userTitle || '投稿'}
        spotAddress={spot.address ?? ''}
        suggestionId={spot.kind === 'moodlog' ? `ml-${spot.id}` : spot.id}
        posterId={!isMine ? (spot.posterId ?? undefined) : undefined}
        onBlockUser={(pid) => { blockUser(pid); router.back(); }}
        onClose={() => setReportOpen(false)}
      />

      {/* 右上「…」メニュー（アプリ共通のアクションシート・常時マウント+visibleトグル）*/}
      <AppActionSheet
        visible={menuOpen}
        title={t.menu}
        onClose={() => setMenuOpen(false)}
        options={isMine
          ? [
              { label: t.editPost, onPress: onEdit },
              { label: t.deletePost, destructive: true, onPress: onDelete },
              { label: t.share, onPress: onShare },
            ]
          : [
              { label: t.share, onPress: onShare },
              { label: t.report, destructive: true, onPress: () => setReportOpen(true) },
            ]}
      />

      {/* 投稿削除の確認（アプリ共通のアクションシート・常時マウント）*/}
      <AppActionSheet
        visible={deleteConfirm}
        title={t.deleteConfirmTitle}
        message={t.deleteConfirmMsg}
        onClose={() => setDeleteConfirm(false)}
        options={[{ label: t.deleteAction, destructive: true, onPress: doDelete }]}
      />

      {/* いいね（右下フローティング）: この投稿への「いいね」専用（数字=みんなのいいね数）。
          場所の保存は場所詳細のハート＝ハートの意味を画面間で統一（2026-07-11）。
          未いいねはグレー輪郭＋グレー数字・押すとピンク塗り＋ピンク数字＝状態を明確化 */}
      <TouchableOpacity onPress={onHeartPress} style={[s.favFab, liked && s.favFabOn, { bottom: insets.bottom + 18 }]} activeOpacity={0.85}
        accessibilityRole="button" accessibilityState={{ selected: liked }} accessibilityLabel={liked ? t.likeRemove : t.likeAdd}>
        <Heart size={22} color={liked ? PINK : '#B9B3C8'} fill={liked ? PINK : 'transparent'} strokeWidth={2.4} />
        <Text style={[s.favFabCount, !liked && s.favFabCountOff]}>{likeCount}</Text>
      </TouchableOpacity>

    </View>
  );
}

const REVIEW_AVATAR_BG = ['#FDEBD0', '#D5F5E3', '#D6EAF8', '#E8DAEF', '#D1F2EB', '#FDCEDF'];
function ReviewCard({ review, last }: { review: Review; last?: boolean }) {
  const { lang } = useSettings();
  const t = T[lang];
  const [expanded, setExpanded] = useState(false);
  const MAX = 100;
  const needsExpand = review.text.length > MAX;
  const shown = expanded || !needsExpand ? review.text : review.text.slice(0, MAX) + '…';
  const initial = review.authorName.charAt(0).toUpperCase();
  const bg = REVIEW_AVATAR_BG[(review.authorName.charCodeAt(0) ?? 0) % REVIEW_AVATAR_BG.length];
  return (
    <View style={[s.reviewItem, last && { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 }]}>
      <View style={s.reviewHead}>
        {review.authorPhoto ? (
          <Image source={{ uri: review.authorPhoto }} style={s.reviewAvatar} contentFit="cover" />
        ) : (
          <View style={[s.reviewAvatar, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={s.reviewInitial}>{initial}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.reviewAuthor} numberOfLines={1}>{review.authorName}</Text>
          {review.relativeTime ? <Text style={s.reviewTime}>{review.relativeTime}</Text> : null}
        </View>
        {review.rating != null && <Stars n={review.rating} size={12} />}
      </View>
      <Text style={s.reviewText}>{shown}</Text>
      {needsExpand && (
        <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
          <Text style={s.reviewMore}>{expanded ? t.close : t.seeMore}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function InfoRow({ Icon, value, onPress, link, border }: {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  value: string; onPress?: () => void; link?: boolean; border?: boolean;
}) {
  const content = (
    <View style={[s.infoRow, border && s.infoRowBorder]}>
      <View style={s.infoIconWrap}><Icon size={15} color="#C084FC" strokeWidth={2} /></View>
      <Text style={[s.infoText, link && s.infoLink]} numberOfLines={link ? 1 : undefined}>{value}</Text>
    </View>
  );
  return onPress ? <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity> : content;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F1F7' },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Photo
  photoWrap: { position: 'relative', backgroundColor: '#E8E0FF' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 100 },
  circleBtn: {
    position: 'absolute', width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3,
  },
  counter: {
    position: 'absolute', bottom: 28, right: 14, backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
  },
  counterText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  userBadge: { position: 'absolute', bottom: 28, left: 14, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  userBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  dots: { position: 'absolute', bottom: 14, alignSelf: 'center', flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { backgroundColor: '#fff', width: 18 },

  // Body
  body: { backgroundColor: '#F3F1F7', borderTopLeftRadius: 26, borderTopRightRadius: 26, marginTop: -22, paddingHorizontal: 18, paddingTop: 22 },

  // タイトルとマップピルを縦中央で揃える
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  prefRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4 },
  pref: { fontSize: 12, color: '#9CA3AF', fontWeight: '600' },
  // 場所名はタップで場所詳細へ＝リンクと分かるよう下線を付ける（押せるか分からない問題の解消）
  title: { flex: 1, fontSize: 21, fontWeight: '800', color: '#1A0A2E', lineHeight: 28, letterSpacing: -0.3, textDecorationLine: 'underline', textDecorationColor: '#B7A0F0' },
  // 場所名（タップで場所詳細へ・ChevronRightで導線を明示）
  placeNameRow: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginTop: -2, marginBottom: 12 },
  placeName: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  mapPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    shadowColor: PURPLE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  mapPillText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  areaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', maxWidth: '100%',
    backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 16,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  areaChipText: { fontSize: 12, fontWeight: '700', color: '#6D28D9', flexShrink: 1 },

  // 期間限定カード（公開期間あり）— アンバーで「限定」を強調
  periodCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF7ED', borderRadius: 16, padding: 13, marginBottom: 14,
    borderWidth: 1, borderColor: '#FED7AA',
  },
  periodIconWrap: {
    width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F59E0B',
  },
  periodLabel: { fontSize: 11, fontWeight: '800', color: '#B45309', marginBottom: 2 },
  periodValue: { fontSize: 14.5, fontWeight: '800', color: '#9A3412', letterSpacing: -0.2 },
  // ── 期間終了時（今日 > 終了日）＝アンバーからグレーへ。終わったことが一目で分かるようにする ──
  periodCardEnded: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  periodIconWrapEnded: { backgroundColor: '#9CA3AF' },
  periodLabelEnded: { color: '#6B7280' },
  periodValueEnded: { color: '#9CA3AF', textDecorationLine: 'line-through' },
  periodEndedTag: { backgroundColor: '#6B7280', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  periodEndedTagText: { fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },

  // Comment (大目玉)
  commentCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(155,107,255,0.14)',
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3,
  },
  commentLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  commentLabel: { fontSize: 12.5, fontWeight: '900', color: PURPLE },
  commentText: { fontSize: 14, color: '#2D2240', lineHeight: 22, fontWeight: '500' },
  // 投稿者カード（タップでプロフィール・右にいいねピル）
  posterCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 2,
  },
  posterMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  posterCardAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#F0EDFF' },
  posterAvatarPh: { alignItems: 'center', justifyContent: 'center' },
  // みんなの声のバー（社会的証明・上部）
  eventWrap: { gap: 8, marginBottom: 14 },
  eventRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 13,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 8, elevation: 4,
  },
  eventIcon: {
    width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.45)',
  },
  eventTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 },
  eventKicker: { fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.6 },
  eventDatePill: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2.5 },
  eventDateText: { fontSize: 10.5, fontWeight: '800', color: '#9B6BFF' },
  eventName: { fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: -0.2 },
  voiceBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 16, paddingVertical: 13, marginBottom: 14,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 1,
  },
  voiceCell: { flex: 1, alignItems: 'center', gap: 3 },
  voiceValRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voiceVal: { fontSize: 16, fontWeight: '800', color: '#1A0A2E', letterSpacing: -0.3 },
  voiceLabel: { fontSize: 10.5, fontWeight: '600', color: '#8B88A6' },
  voiceDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: 'rgba(0,0,0,0.09)' },
  posterKicker: { fontSize: 10, fontWeight: '800', color: '#B7A9E0', letterSpacing: 0.8, marginBottom: 3 },
  posterAnonNote: { fontSize: 10.5, fontWeight: '700', color: '#B0A2C8', marginTop: 2 },
  // 自分の名前非公開投稿につく「非公開」タグ（本人だけに名前を出しつつ状態を明示）
  posterPrivTag: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#F0EEF5', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1.5, flexShrink: 0 },
  posterPrivText: { fontSize: 9.5, fontWeight: '800', color: '#9A96A8' },
  posterNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  posterName: { fontSize: 14.5, fontWeight: '800', color: '#1E1548', flexShrink: 1 },
  posterHandle: { fontSize: 11.5, fontWeight: '600', color: '#8B88A6', marginTop: 3 },
  posterRate: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0EDF7' },
  posterRateTop: { marginTop: 0, paddingTop: 0, borderTopWidth: 0 },
  posterRateLabel: { fontSize: 12, fontWeight: '700', color: '#D97706' },
  posterRateNum: { fontSize: 13, fontWeight: '800', color: '#D97706' },

  // Rating card
  ratingCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 16,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 2,
  },
  ratingBig: { fontSize: 32, fontWeight: '800', color: '#1A0A2E', letterSpacing: -1 },
  reviewCount: { fontSize: 12, color: '#9CA3AF', marginTop: 4, fontWeight: '600' },

  // Info card
  // 情報カード（place.tsx と統一: 白カード＋行の上罫線で区切り・アイコン30）
  infoCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  infoRowBorder: { borderTopWidth: 1, borderTopColor: 'rgba(192,132,252,0.08)' },
  infoIconWrap: { width: 30, height: 30, borderRadius: 9, backgroundColor: 'rgba(192,132,252,0.1)', alignItems: 'center', justifyContent: 'center' },
  infoText: { flex: 1, fontSize: 14, color: '#374151', lineHeight: 22, paddingTop: 4 },
  infoLink: { color: '#7C3AED' },
  infoSubText: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  igIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  igOuter: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  igLens: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: '#fff' },
  igDot: { position: 'absolute', top: 1, right: 1, width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#fff' },

  // Hours card
  hoursCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 14,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 2,
  },
  hoursHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  hoursTitle: { fontSize: 15, fontWeight: '800', color: '#1A0A2E' },
  openBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#D1FAE5', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  closedBadge: { backgroundColor: '#FEE2E2' },
  openDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#10B981' },
  openText: { fontSize: 12, fontWeight: '800', color: '#059669' },
  hoursLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  hoursBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: PURPLE, marginRight: 10 },
  hoursDay: { fontSize: 13, color: '#4B3B6B', fontWeight: '700', width: 60 },
  hoursTime: { fontSize: 13, color: '#1F2937', fontWeight: '500', flex: 1 },

  // Reviews
  reviewsCard: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 14,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 2,
  },
  reviewsHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 14 },
  reviewsTitle: { fontSize: 15, fontWeight: '800', color: '#1A0A2E' },
  reviewItem: { borderBottomWidth: 1, borderBottomColor: '#F0ECF7', paddingBottom: 14, marginBottom: 14 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  reviewAvatar: { width: 34, height: 34, borderRadius: 17 },
  reviewInitial: { fontSize: 15, fontWeight: '800', color: '#6B4FA0' },
  reviewAuthor: { fontSize: 13, fontWeight: '700', color: '#1F2937' },
  reviewTime: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  reviewText: { fontSize: 13, color: '#4B5563', lineHeight: 21 },
  reviewMore: { fontSize: 12, color: PURPLE, fontWeight: '700', marginTop: 6 },

  // いいねFAB（ハート＋みんなのいいね数）
  favFab: {
    // 未いいね: グレー枠・無彩色の影（押していない状態が一目で分かるように）
    position: 'absolute', right: 18, width: 58, height: 66, borderRadius: 29,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingTop: 2,
    borderWidth: 2, borderColor: '#E7E4EE',
    shadowColor: '#1A1330', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 10, elevation: 6,
  },
  // いいね済み: ピンク枠＋ピンクの影
  favFabOn: { borderColor: '#FCE7F3', shadowColor: PINK, shadowOpacity: 0.3 },
  favFabCount: { fontSize: 12, fontWeight: '800', color: PINK, marginTop: 1 },
  // 未いいね時の数字はグレー＝「みんなの合計数」であって自分が押した印ではないことを明確に
  favFabCountOff: { color: '#8B88A6' },
});
