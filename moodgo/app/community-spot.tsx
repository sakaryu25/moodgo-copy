/**
 * community-spot.tsx
 * 全国みんなの穴場 — スポット詳細ページ
 * place.tsx のデザイン言語に寄せつつ、コミュニティ独自要素
 * （利用者コメント・投稿者おすすめ度・利用者写真）を活かす。
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import {
  CalendarClock, Camera, ChevronLeft, ChevronRight, Clock, Globe, Heart, MapPin, MessageCircle, MoreHorizontal, Phone, Star, Train, UserRound, Wallet,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, NativeScrollEvent, NativeSyntheticEvent,
  Share, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { loadJSON, saveJSON, FAVORITES_KEY } from '@/lib/storage';
import { sameFav } from '@/lib/favKey';
import { openInGoogleMaps } from '@/lib/openMaps';
import { showToast } from '@/lib/toast';
import CommentsSection from '@/components/CommentsSection';
import MoodLogSection from '@/components/MoodLogSection';
import VoicesSection, { type VoiceStat } from '@/components/VoicesSection';
import type { FavoriteItem } from '@/types/app';

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
  kind?: string;              // 'moodlog' | 'suggestion'（いいねtargetId構築用）
  likeCount?: number;         // 投稿へのいいね数
  visitedCount?: number;      // 行った！された回数（閲覧者が押した数）
};

// "2026-04-15" → "2026/4/15"。null/未設定はnull。
function fmtJpDate(d?: string | null): string | null {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : d;
}
// 公開期間の表示。開始未設定→「即日」、終了未設定→「無期限」。
function fmtPeriod(from?: string | null, until?: string | null): string {
  return `${fmtJpDate(from) ?? '即日'} 〜 ${fmtJpDate(until) ?? '無期限'}`;
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
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [spot, setSpot] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [photoW, setPhotoW] = useState(0);
  const [faved, setFaved] = useState(false);
  // 投稿へのいいね＋投稿者プロフィールシート
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [isMine, setIsMine] = useState(false);   // 自分の投稿なら編集/削除を出す（moodログのみ）

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/api/community-spot?id=${id}`);
        const d = await res.json();
        if (d.ok) {
          setSpot(d.spot);
          if (typeof d.spot.likeCount === 'number') setLikeCount(d.spot.likeCount);
          const faves = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
          setFaved(faves.some((f) => sameFav(f, { title: d.spot.placeName || d.spot.userTitle, placeId: d.spot.placeId })));
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
  }, [id]);

  // 右下ハート＝いいね（サーバーカウント）＋お気に入り保存を1タップで。
  //   楽観更新・失敗時はいいねのみロールバック（お気に入りはローカルなので成功扱い）。
  const onHeartPress = async () => {
    if (!spot || likeBusy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !(liked || faved);
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setLikeBusy(true);
    setFavTo(next).catch(() => {});
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

  // お気に入り保存/解除（ローカル）を目標状態に合わせる
  const setFavTo = async (on: boolean) => {
    if (!spot) return;
    const faves = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
    const title = spot.placeName || spot.userTitle;
    const target = { title, placeId: spot.placeId };  // sameFav: ID優先の同一判定
    const has = faves.some((f) => sameFav(f, target));
    let next: FavoriteItem[] | null = null;
    if (!on && has) next = faves.filter((f) => !sameFav(f, target));
    if (on && !has) {
      next = [{ title, area: spot.prefecture, vibe: '', photoUrl: spot.imageUrls[0] ?? '', mapUrl: spot.googleMapsUri,
        createdAt: new Date().toISOString(), placeId: spot.placeId, address: spot.address, rating: spot.googleRating,
        kind: 'post', spotId: id || spot.id }, ...faves];
    }
    setFaved(on);
    if (next) await saveJSON(FAVORITES_KEY, next);
  };

  const onPhotoScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (photoW <= 0) return;
    setPhotoIdx(Math.round(e.nativeEvent.contentOffset.x / photoW));
  };
  const openMap = () => {
    if (!spot) return;
    // 住所（座標）優先で開く。名前だと別の同名スポットに飛ぶため query は住所を使う。
    openInGoogleMaps({
      query: spot.address || spot.placeName || spot.userTitle,
      lat: spot.lat,
      lng: spot.lng,
      mapsUri: spot.googleMapsUri,
    });
  };
  const openInstagram = () => {
    if (!spot) return;
    const tag = (spot.placeName || spot.userTitle).replace(/\s+/g, '');
    Linking.openURL(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`).catch(() => {});
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
  // 自分の投稿を削除（確認 → サーバー削除 → 戻る）
  const onDelete = () => {
    if (!spot) return;
    Alert.alert('投稿を削除しますか？', 'この操作は取り消せません。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する', style: 'destructive',
        onPress: async () => {
          try {
            const deviceId = await getDeviceId();
            const d = await apiFetch('/api/spot-posts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'delete', postId: spot.id, deviceId }),
            }).then((r) => r.json());
            if (d?.ok) { showToast('投稿を削除しました'); router.back(); }
            else showToast('削除できませんでした', d?.error ?? '時間をおいてお試しください');
          } catch { showToast('削除できませんでした', '通信に失敗しました'); }
        },
      },
    ]);
  };
  // 右上「…」メニュー: 自分の投稿は 編集/削除/共有、他人は 共有/通報
  const openMenu = () => {
    if (!spot) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const opts = isMine
      ? [
          { text: '投稿を編集', onPress: onEdit },
          { text: '投稿を削除', style: 'destructive' as const, onPress: onDelete },
          { text: '共有する', onPress: onShare },
          { text: 'キャンセル', style: 'cancel' as const },
        ]
      : [
          { text: '共有する', onPress: onShare },
          { text: '通報する', style: 'destructive' as const, onPress: () => showToast('通報しました', 'ご協力ありがとうございます') },
          { text: 'キャンセル', style: 'cancel' as const },
        ];
    Alert.alert('メニュー', undefined, opts);
  };

  if (loading) {
    return <View style={[s.root, s.center, { paddingTop: insets.top }]}><ActivityIndicator color={PURPLE} size="large" /></View>;
  }
  if (!spot) {
    return (
      <View style={[s.root, s.center, { paddingTop: insets.top }]}>
        <Text style={{ color: '#888' }}>スポットが見つかりませんでした</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={{ color: PURPLE, fontWeight: '800' }}>戻る</Text></TouchableOpacity>
      </View>
    );
  }

  const photos = spot.imageUrls;
  const hasGoogleRating = spot.googleRating != null;

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        {/* ── 写真カルーセル ── */}
        <View style={s.photoWrap} onLayout={(e) => setPhotoW(e.nativeEvent.layout.width)}>
          {photos.length > 0 && photoW > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} decelerationRate="fast" onMomentumScrollEnd={onPhotoScroll}>
              {photos.map((uri, i) => (
                <Image key={i} source={{ uri }} style={{ width: photoW, height: 340 }} contentFit="cover" transition={250} />
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
            accessibilityRole="button" accessibilityLabel="メニュー（共有・編集・削除など）">
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
              <Text style={s.userBadgeText}>利用者の写真</Text>
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

          {/* タイトル行 + マップピル（同じ高さで中央揃え）*/}
          <View style={s.titleRow}>
            <Text style={s.title}>{spot.userTitle || spot.placeName}</Text>
            <TouchableOpacity onPress={openMap} activeOpacity={0.85}>
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mapPill}>
                <MapPin size={15} color="#fff" strokeWidth={2.5} />
                <Text style={s.mapPillText}>マップ</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
          {spot.placeName && spot.placeName !== spot.userTitle ? <Text style={s.placeName}>{spot.placeName}</Text> : null}

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
            {spot.posterId ? (
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/user/[id]', params: { id: spot.posterId! } })}
                activeOpacity={0.75} style={s.posterMain}
                accessibilityRole="button" accessibilityLabel={`${spot.posterName?.trim() || 'MoodGoユーザー'}のプロフィールを見る`}>
                {spot.posterIcon ? (
                  <Image source={{ uri: spot.posterIcon }} style={s.posterCardAvatar} contentFit="cover" />
                ) : (
                  <View style={[s.posterCardAvatar, s.posterAvatarPh]}>
                    <UserRound size={20} color={PURPLE} strokeWidth={1.8} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.posterKicker}>投稿者</Text>
                  <View style={s.posterNameRow}>
                    <Text style={s.posterName} numberOfLines={1}>{spot.posterName?.trim() || 'MoodGoユーザー'}</Text>
                    {spot.posterHandle ? <Text style={s.posterHandle} numberOfLines={1}>@{spot.posterHandle}</Text> : null}
                  </View>
                </View>
                <ChevronRight size={17} color="#B7B3C2" strokeWidth={2.2} />
              </TouchableOpacity>
            ) : (
              <View style={s.posterMain}>
                <View style={[s.posterCardAvatar, s.posterAvatarPh]}>
                  <UserRound size={20} color={PURPLE} strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.posterKicker}>投稿者</Text>
                  <Text style={s.posterName}>匿名の投稿</Text>
                </View>
              </View>
            )}
          </View>

          {/* ── 期間限定の穴場（公開期間が設定されている場合）── */}
          {(spot.availableFrom || spot.availableUntil) ? (
            <View style={s.periodCard}>
              <View style={s.periodIconWrap}>
                <CalendarClock size={17} color="#fff" strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.periodLabel}>期間限定の穴場</Text>
                <Text style={s.periodValue}>{fmtPeriod(spot.availableFrom, spot.availableUntil)}</Text>
              </View>
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
                    <Text style={s.commentLabel}>どんな場所？</Text>
                  </View>
                  <Text style={s.commentText}>{spot.description}</Text>
                </>
              ) : null}
              {spot.rating > 0 ? (
                <View style={[s.posterRate, !spot.description && s.posterRateTop]}>
                  <Text style={s.posterRateLabel}>投稿者のおすすめ度</Text>
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
                  <Text style={s.reviewCount}>{spot.reviewCount.toLocaleString('ja-JP')}件の口コミ</Text>
                )}
              </View>
            </View>
          )}

          {/* ── 情報カード ── */}
          <View style={s.infoCard}>
            {spot.priceText ? (<><InfoRow Icon={Wallet} label="目安の値段" value={spot.priceText} /><Divider /></>) : null}
            {spot.address ? (<><InfoRow Icon={MapPin} label="住所" value={spot.address} /><Divider /></>) : null}
            {spot.stationText ? (<><InfoRow Icon={Train} label="最寄駅" value={spot.stationText} /><Divider /></>) : null}
            {spot.phone ? (<><InfoRow Icon={Phone} label="電話番号" value={spot.phone} onPress={() => Linking.openURL(`tel:${spot.phone}`)} /><Divider /></>) : null}
            {spot.website ? (<><InfoRow Icon={Globe} label="ウェブサイト" value={spot.website} link onPress={() => Linking.openURL(spot.website)} /><Divider /></>) : null}
            {/* Instagram検索（行スタイル）*/}
            <TouchableOpacity onPress={openInstagram} activeOpacity={0.7}>
              <View style={s.infoRow}>
                <LinearGradient colors={IG_GRAD} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={s.igIcon}>
                  <View style={s.igOuter}><View style={s.igLens} /><View style={s.igDot} /></View>
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={[s.infoValue, { color: '#C13584', fontWeight: '800' }]}>Instagramで検索</Text>
                  <Text style={s.infoLabel}>#{(spot.placeName || spot.userTitle).replace(/\s+/g, '')}</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* ── 営業時間カード ── */}
          {spot.openingHoursText ? (
            <View style={s.hoursCard}>
              <View style={s.hoursHead}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Clock size={16} color={PURPLE} strokeWidth={2.2} />
                  <Text style={s.hoursTitle}>営業時間</Text>
                </View>
                {spot.openNow != null && (
                  <View style={[s.openBadge, !spot.openNow && s.closedBadge]}>
                    <View style={[s.openDot, !spot.openNow && { backgroundColor: '#EF4444' }]} />
                    <Text style={[s.openText, !spot.openNow && { color: '#EF4444' }]}>{spot.openNow ? '営業中' : '営業時間外'}</Text>
                  </View>
                )}
              </View>
              {spot.openingHoursText.split('\n').map((line, i) => {
                const [day, ...rest] = line.split(/:\s*/);
                return (
                  <View key={i} style={s.hoursLine}>
                    <View style={s.hoursBullet} />
                    <Text style={s.hoursDay}>{day}</Text>
                    <Text style={s.hoursTime}>{rest.join(': ')}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* ── 口コミ（ためになった順）── */}
          {spot.reviews && spot.reviews.length > 0 && (
            <View style={s.reviewsCard}>
              <View style={s.reviewsHead}>
                <MessageCircle size={16} color={PURPLE} strokeWidth={2.2} />
                <Text style={s.reviewsTitle}>ためになった口コミ</Text>
              </View>
              {spot.reviews.map((r, i) => (
                <ReviewCard key={i} review={r} last={i === spot.reviews!.length - 1} />
              ))}
            </View>
          )}

          {/* ── みんなの声（評価/Moodログ/コメントを1つに集約）── */}
          <VoicesSection stats={([
            spot.rating > 0 ? { kind: 'star', value: `${spot.rating}.0`, label: '評価' } : null,
            { kind: 'heart', value: String(likeCount), label: 'いいね' },
            { kind: 'foot', value: String(spot.visitedCount ?? 0), label: '行った！' },
          ].filter(Boolean)) as VoiceStat[]}>
            {/* みんなのMoodログ（同じ場所への他の投稿）。いま見ている投稿自身は除外 */}
            <MoodLogSection placeId={spot.placeId} placeName={spot.placeName || spot.userTitle} address={spot.address}
              excludePostId={spot.kind === 'moodlog' ? spot.id : undefined} />
            {/* コメント（この投稿への会話・1階層）*/}
            <CommentsSection targetId={spot.kind === 'moodlog' ? `ml-${spot.id}` : spot.id} />
          </VoicesSection>
        </View>
      </ScrollView>

      {/* いいね（右下フローティング）: 押すとみんなのいいねにカウント＋お気に入り保存 */}
      <TouchableOpacity onPress={onHeartPress} style={[s.favFab, { bottom: insets.bottom + 18 }]} activeOpacity={0.85}
        accessibilityRole="button" accessibilityLabel={(liked || faved) ? 'いいねを取り消す' : 'この投稿にいいね'}>
        <Heart size={22} color={PINK} fill={(liked || faved) ? PINK : 'transparent'} strokeWidth={2.4} />
        <Text style={s.favFabCount}>{likeCount}</Text>
      </TouchableOpacity>

    </View>
  );
}

function Divider() { return <View style={s.divider} />; }

const REVIEW_AVATAR_BG = ['#FDEBD0', '#D5F5E3', '#D6EAF8', '#E8DAEF', '#D1F2EB', '#FDCEDF'];
function ReviewCard({ review, last }: { review: Review; last?: boolean }) {
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
          <Text style={s.reviewMore}>{expanded ? '閉じる' : 'もっと見る'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function InfoRow({ Icon, label, value, onPress, link }: {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string; value: string; onPress?: () => void; link?: boolean;
}) {
  const content = (
    <View style={s.infoRow}>
      <View style={s.infoIcon}><Icon size={17} color={PURPLE} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={[s.infoValue, link && { color: BLUE }]}>{value}</Text>
      </View>
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
  title: { flex: 1, fontSize: 21, fontWeight: '800', color: '#1A0A2E', lineHeight: 28, letterSpacing: -0.3 },
  placeName: { fontSize: 13, color: '#6B7280', marginTop: -2, marginBottom: 12, fontWeight: '600' },
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
  posterCardAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0EDFF' },
  posterAvatarPh: { alignItems: 'center', justifyContent: 'center' },
  posterKicker: { fontSize: 10, fontWeight: '800', color: '#B7A9E0', letterSpacing: 0.8, marginBottom: 1 },
  posterNameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  posterName: { fontSize: 13.5, fontWeight: '800', color: '#1E1548', flexShrink: 1 },
  posterHandle: { fontSize: 11, fontWeight: '600', color: '#8B88A6', flexShrink: 1 },
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
  infoCard: {
    backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 16, marginBottom: 14,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 2,
  },
  infoRow: { flexDirection: 'row', gap: 13, paddingVertical: 14, alignItems: 'center' },
  infoIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#F3EFFC', alignItems: 'center', justifyContent: 'center' },
  igIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  igOuter: { width: 18, height: 18, borderRadius: 6, borderWidth: 1.8, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  igLens: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.8, borderColor: '#fff' },
  igDot: { position: 'absolute', top: 1.5, right: 1.5, width: 2.6, height: 2.6, borderRadius: 1.3, backgroundColor: '#fff' },
  infoLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '700', marginBottom: 2 },
  infoValue: { fontSize: 14, color: '#1F2937', lineHeight: 21, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#F2EFF7' },

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
    position: 'absolute', right: 18, width: 58, height: 66, borderRadius: 29,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingTop: 2,
    borderWidth: 2, borderColor: '#FCE7F3',
    shadowColor: PINK, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  favFabCount: { fontSize: 12, fontWeight: '800', color: PINK, marginTop: 1 },
});
