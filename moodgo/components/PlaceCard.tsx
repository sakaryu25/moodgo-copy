// ── PlaceCard ──────────────────────────────────────────────────────────────
// Web版と同じレイアウト + MoodGo グラデーション配色
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Camera, Check, Clock, Flame, Heart, Map, MapPin, MessageCircle, Moon, Navigation, Share2, Star, Train, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import PuniPressable from './PuniPressable';
import { shareSpotToGroup } from '@/lib/groupShare';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { showToast } from '@/lib/toast';
import { addSpotPhoto, useSpotPhotos } from '@/lib/spotPhotos';
import { sendEngagement } from '@/lib/engagement';
import { copyPlaceName } from '@/lib/clipboard';
import { genrePlaceholder } from '@/lib/genrePlaceholder';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Recommendation } from '@/types/app';

// 写真URLがWikimedia Commons由来なら、その画像のCommonsファイルページURLを返す（CC帰属表示用）。
//   写真はphoto-proxy経由(.../api/photo-proxy?url=<commons>)で来るため、url=パラメータも見て判定する。
function commonsFileUrl(uri?: string): string | null {
  if (!uri || uri.indexOf('commons.wikimedia.org') === -1) return null;
  try {
    let target = uri;
    const m = uri.match(/[?&]url=([^&]+)/);
    if (m) target = decodeURIComponent(m[1]);
    const fm = target.match(/Special:FilePath\/([^?&#]+)/);
    if (!fm) return null;
    return 'https://commons.wikimedia.org/wiki/File:' + fm[1];
  } catch { return null; }
}
import { COLORS } from '@/constants/colors';

// MoodGo brand
const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const BRAND = '#C084FC';

// ── 営業時間フォーマッター ────────────────────────────────────────────────
const DAY_ORDER = ['月', '火', '水', '木', '金', '土', '日'];

function formatOpeningHours(text: string): string {
  if (!text) return text;

  // 改行 or 読点で分割
  const lines = text
    .split(/\n|、(?=[月火水木金土日]曜)/)
    .map(l => l.trim().replace(/。$/, ''))
    .filter(Boolean);

  if (lines.length < 2) return text;

  // 各行を「曜日 → 時間」にパース
  // 対応フォーマット例: "月曜日: 9:00 – 21:00" / "月曜日：24時間営業"
  type DayEntry = { day: string; hours: string };
  const parsed: DayEntry[] = [];

  for (const line of lines) {
    const m = line.match(/^([月火水木金土日])曜日?[：:]\s*(.+)$/);
    if (!m) return text; // 解析できなければそのまま返す
    parsed.push({ day: m[1], hours: m[2].trim() });
  }

  if (parsed.length === 0) return text;

  // 曜日順にソート
  parsed.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));

  // 全日同じ → 「毎日」
  if (parsed.length === 7 && parsed.every(d => d.hours === parsed[0].hours)) {
    return `毎日：${parsed[0].hours}`;
  }

  // 同じ時間のグループをまとめる
  const groups: { days: string[]; hours: string }[] = [];
  for (const { day, hours } of parsed) {
    const last = groups[groups.length - 1];
    if (last && last.hours === hours) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], hours });
    }
  }

  // 各グループを「月〜金」「土・日」などに整形
  return groups.map(({ days, hours }) => {
    let dayStr: string;
    if (days.length === 1) {
      dayStr = `${days[0]}曜`;
    } else {
      // 連続しているか確認
      const startIdx = DAY_ORDER.indexOf(days[0]);
      const isConsecutive = days.every((d, i) => DAY_ORDER.indexOf(d) === startIdx + i);
      if (isConsecutive && days.length >= 3) {
        dayStr = `${days[0]}〜${days[days.length - 1]}曜`;
      } else {
        dayStr = days.map(d => `${d}曜`).join('・');
      }
    }
    return `${dayStr}：${hours}`;
  }).join('\n');
}

const T = {
  ja: {
    openNow:          '営業中',
    closedNow:        '閉店中',
    mapBtn:           'Googleマップで見る',
    hide:             '表示しない',
    report:           '報告',
    share:            '共有',
    reviewCount:      (n: number) => `(${n.toLocaleString('ja-JP')}件)`,
    visited:          '行った！',
    visitedDone:      '行った',
    moodMatch:        'この気分に合う',
    moodNotMatch:     '気分には合わない',
    moodMatchDone:    '気分に合う！と評価しました',
    moodNotMatchDone: '気分には合わないと評価しました',
    moodQuestion:     (mood: string) => `「${mood}」の気分の時にこの場所は？`,
  },
  en: {
    openNow:          'Open',
    closedNow:        'Closed',
    mapBtn:           'Google Maps',
    hide:             'Hide',
    report:           'Report',
    share:            'Share',
    reviewCount:      (n: number) => `(${n.toLocaleString('en-US')} reviews)`,
    visited:          'Been there!',
    visitedDone:      'Visited',
    moodMatch:        'Matches my mood',
    moodNotMatch:     "Doesn't match",
    moodMatchDone:    'Marked as mood match!',
    moodNotMatchDone: 'Marked as not matching',
    moodQuestion:     (mood: string) => `How is this place for "${mood}"?`,
  },
};

// ── 全画面フォトビューア ──────────────────────────────────────────────────
// タップで拡大表示。横スワイプで写真切替、ピンチでズーム（iOS）
function PhotoViewer({ photos, initialIdx, onClose }: {
  photos: string[]; initialIdx: number; onClose: () => void;
}) {
  const { width: SW, height: SH } = Dimensions.get('window');
  const [idx, setIdx] = useState(initialIdx);
  // ⚠ New Arch(Fabric)の <Modal transparent> は中身を描画せず透明のままタッチを奪う不具合がある
  //   （ConsentGate で実証・c5adb7c）。このビューアは viewerIdx をセットした瞬間に visible=true で
  //   マウントされる同じ発火パターンなので transparent を避ける。背景はほぼ不透明な黒なので、
  //   ネイティブの不透明フルスクリーンModal（＝onboarding/quizと同じ実績のある描画経路）に変更。
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={pv.root}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: initialIdx * SW, y: 0 }}
          onMomentumScrollEnd={e => setIdx(Math.round(e.nativeEvent.contentOffset.x / SW))}
        >
          {photos.map((uri, i) => (
            <ScrollView
              key={uri + i}
              style={{ width: SW, height: SH }}
              contentContainerStyle={{ width: SW, height: SH }}
              maximumZoomScale={3}
              minimumZoomScale={1}
              bouncesZoom
              centerContent
            >
              <Image source={{ uri }} style={{ width: SW, height: SH }} contentFit="contain" transition={150} />
            </ScrollView>
          ))}
        </ScrollView>
        {/* 閉じる */}
        <TouchableOpacity onPress={onClose} style={pv.closeBtn} activeOpacity={0.8}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={22} color="#fff" strokeWidth={2.5} />
        </TouchableOpacity>
        {/* カウンター */}
        {photos.length > 1 && (
          <View style={pv.counter}>
            <Text style={pv.counterText}>{idx + 1} / {photos.length}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const pv = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  closeBtn: {
    position: 'absolute', top: 56, right: 18,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  counter: {
    position: 'absolute', top: 64, alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 4,
  },
  counterText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

type Props = {
  item: Recommendation;
  isFavorited: boolean;
  onToggleFavorite: () => void;
  onBlock?: () => void;
  onReport?: () => void;
  onMarkVisited?: () => void;
  isVisited?: boolean;
  accentColor?: string;
  lang?: 'ja' | 'en';
  moodLabel?: string;   // 気分ラベル（任意）
  /** タイトルタップで詳細ページへ */
  onPressDetail?: () => void;
  /** 心霊・スリル系: 写真なしのとき暗い雰囲気プレースホルダーにする */
  spooky?: boolean;
  /** 心霊: カード全体を暗い（怖い）テーマにする */
  darkTheme?: boolean;
  /** 2カラム表示用のコンパクトモード（説明/営業時間/各種ボタンを省きタップで詳細へ） */
  compact?: boolean;
};

export default function PlaceCard({
  item, isFavorited, onToggleFavorite, onBlock, onReport, onMarkVisited, isVisited = false,
  accentColor = COLORS.primary, lang = 'ja',
  moodLabel, onPressDetail, spooky = false, darkTheme = false,
  compact = false,
}: Props) {
  const t = T[lang];
  // 利用者がその場で追加した写真（共有ストア＝画面をまたいで即反映）。Google補強はしない
  const storePhotos = useSpotPhotos(item.supabaseId, item.title);
  const [fetchedPhotos, setFetchedPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const basePhotos = (item.photoUrls ?? []).length > 0
    ? item.photoUrls!
    : item.photoUrl ? [item.photoUrl] : [];
  // 重複排除しつつ「投稿直後＞最新取得＞検索時点」の順でマージ
  const rawPhotos = [...new Set([...storePhotos, ...fetchedPhotos, ...basePhotos])];

  // 心霊スポットは、検索後に追加された写真も出すよう、マウント時に最新の投稿写真を取得
  useEffect(() => {
    if (!spooky) return;
    let active = true;
    const params = new URLSearchParams();
    if (item.supabaseId) params.set('placeId', item.supabaseId);
    else if (item.title) params.set('placeName', item.title);
    apiFetch(`/api/spot-photo?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (active && d?.ok && Array.isArray(d.photos)) setFetchedPhotos(d.photos); })
      .catch(() => {});
    return () => { active = false; };
  }, [spooky, item.supabaseId, item.title]);

  // 心霊スポット等への写真投稿：誰でも追加できる（削除は管理者のみ）
  const handleAddPhoto = async () => {
    if (uploading) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('写真へのアクセスが必要です', '設定アプリからMoodGoに写真の許可をしてください。');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (picked.canceled || !picked.assets?.length) return;
      setUploading(true);
      const small = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: 1080 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      const deviceId = await getDeviceId().catch(() => '');
      const res = await apiFetch('/api/spot-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placeId: item.supabaseId,
          placeName: item.title,
          address: item.address ?? '',
          deviceId,
          imageBase64: small.base64,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) throw new Error(data.error ?? '送信に失敗しました');
      addSpotPhoto(item.supabaseId, item.title, data.url);  // 共有ストアへ→全画面に即反映
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast('写真ありがとう！✨', 'あなたの1枚がみんなの参考になります');
    } catch (e) {
      Alert.alert('エラー', e instanceof Error ? e.message : '写真の投稿に失敗しました');
    } finally {
      setUploading(false);
    }
  };
  // 読み込みに失敗したURL（壊れた写真プロキシURL等）を除外し、全滅時はプレースホルダーへ
  const [failedUris, setFailedUris] = useState<Set<string>>(new Set());
  const photos = rawPhotos.filter(u => !!u && !failedUris.has(u));
  // 心霊で写真がある場合、カルーセル末尾に「提供してください」スライドを追加する
  const showContribute = spooky && photos.length > 0;
  const pageCount = photos.length + (showContribute ? 1 : 0);
  const onImgError = (uri: string) =>
    setFailedUris(prev => (prev.has(uri) ? prev : new Set(prev).add(uri)));
  const [photoIdx, setPhotoIdx] = useState(0);
  // API削減: 1枚目だけ即読込み、残りはスクロール(またはタップ)で到達した分だけ読み込む。
  //   未到達ページは <Image> を描画しない＝Google写真の photo-proxy 解決(課金)を遅延させる。
  const [maxLoaded, setMaxLoaded] = useState(0);
  const photoScrollRef = useRef<ScrollView>(null);
  const [photoWidth, setPhotoWidth] = useState(0);
  // タップで全画面拡大するビューア（null = 非表示）
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);

  // ページングScrollView: スクロール終了時にインデックス更新
  const onPhotoScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (photoWidth <= 0) return;
    const newIdx = Math.round(e.nativeEvent.contentOffset.x / photoWidth);
    if (newIdx !== photoIdx) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPhotoIdx(newIdx);
    }
    setMaxLoaded(m => Math.max(m, newIdx));   // 到達ページまで読み込み許可
  };

  // 矢印ボタン用: 指定ページへスムーズスクロール
  const scrollToPhoto = (idx: number) => {
    if (photoWidth <= 0) return;
    setMaxLoaded(m => Math.max(m, idx));      // スクロール先を読み込み許可
    photoScrollRef.current?.scrollTo({ x: idx * photoWidth, animated: true });
    setPhotoIdx(idx);
  };

  // スプリングプレスアニメーション
  const scale = useRef(new Animated.Value(1)).current;

  // Heart pulse
  const heartScale = useRef(new Animated.Value(1)).current;
  const pulseHeart = () => {
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.35, useNativeDriver: true, mass: 1, damping: 8,  stiffness: 300 }),
      Animated.spring(heartScale, { toValue: 1,    useNativeDriver: true, mass: 1, damping: 12, stiffness: 200 }),
    ]).start();
  };

  // #8: openStatusBadge（営業中/もうすぐ閉店/もうすぐ開店/営業時間外）を優先表示（日本語時のみ）。
  //   無い場合は従来の openNow ベースの 営業中/閉店 ラベルにフォールバック。
  const badge = lang === 'ja' ? item.openStatusBadge : undefined;
  const openNowColor =
    badge?.includes('もうすぐ閉店') ? '#F59E0B' :          // オレンジ（まもなく閉店）
    badge?.includes('もうすぐ開店') ? '#3B82F6' :          // 青（まもなく開店）
    badge === '営業時間外'          ? '#EF4444' :
    item.openNow === true  ? '#10B981' :
    item.openNow === false ? '#EF4444' : COLORS.textMuted;
  const openNowLabel =
    badge ? badge :
    item.openNow === true  ? t.openNow :
    item.openNow === false ? t.closedNow : '';

  const handleShare = () => {
    const parts = [item.title];
    if (item.address) parts.push(item.address);
    if (item.mapUrl)  parts.push(item.mapUrl);
    Share.share({ message: parts.join('\n') });
    sendEngagement(item.title, 'share', moodLabel);  // ② 学習ループ: 共有=強い好意シグナル
  };

  // 説明文：featuresの中で長い文はdescription扱い
  const description = item.features?.find(f => f.length > 15) ?? '';

  return (
    <Animated.View style={[s.card, darkTheme && s.cardDark, { transform: [{ scale }] }]}>

      {/* ── 写真エリア（常時表示。写真0は「写真を追加」招待枠）── */}
      <View
        style={s.photoWrap}
        onLayout={e => setPhotoWidth(e.nativeEvent.layout.width)}
      >
        {/* 写真カルーセル（水平ページングScrollView） */}
        {photos.length > 0 && photoWidth > 0 ? (
          <ScrollView
            ref={photoScrollRef}
            horizontal
            pagingEnabled
            scrollEnabled={pageCount > 1}
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            scrollEventThrottle={16}
            bounces={false}
            onMomentumScrollEnd={onPhotoScrollEnd}
            style={{ width: photoWidth, height: compact ? 150 : 220 }}
          >
            {photos.map((uri, i) => (
              <TouchableOpacity
                key={uri + i}
                activeOpacity={0.92}
                onPress={() => { if (onPressDetail) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPressDetail(); } else { setViewerIdx(i); } }}
              >
                {i <= maxLoaded ? (
                  <Image
                    source={{ uri }}
                    style={{ width: photoWidth, height: compact ? 150 : 220 }}
                    contentFit="cover"
                    transition={200}
                    onError={() => onImgError(uri)}
                  />
                ) : (
                  // 未到達ページ: 画像を読み込まず軽量プレースホルダ（スクロールで読み込む）
                  <View style={{ width: photoWidth, height: compact ? 150 : 220, backgroundColor: '#EFEAF7' }} />
                )}
              </TouchableOpacity>
            ))}
            {/* 末尾の「写真を提供してください」スライド（スライドすると出る） */}
            {showContribute && (
              <LinearGradient
                colors={['#2A1A45', '#160C28', '#0C0718']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
                style={[{ width: photoWidth, height: compact ? 150 : 220 }, s.photoPlaceholder]}
              >
                <Moon size={32} color="rgba(180,160,255,0.55)" strokeWidth={1.4} />
                <Text style={s.spookyAskTitle}>写真を提供してください</Text>
                <Text style={s.spookyAskSub}>あなたの写真でこの場所を伝えてください 🙏</Text>
                <TouchableOpacity onPress={handleAddPhoto} disabled={uploading} activeOpacity={0.8} style={s.spookyAddBtn}>
                  {uploading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Camera size={15} color="#fff" strokeWidth={2.2} /><Text style={s.spookyAddText}>写真を追加</Text></>}
                </TouchableOpacity>
              </LinearGradient>
            )}
          </ScrollView>
        ) : photos.length > 0 ? (
          // photoWidth 計測前の一瞬だけ先頭写真を表示
          <TouchableOpacity activeOpacity={0.92} onPress={() => { if (onPressDetail) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPressDetail(); } else { setViewerIdx(0); } }}>
            <Image source={{ uri: photos[0] }} style={s.photo} contentFit="cover" transition={300} onError={() => onImgError(photos[0])} />
          </TouchableOpacity>
        ) : spooky ? (
          // 心霊・スリル系の雰囲気プレースホルダー（暗い霧／月）＋写真提供のお願い
          <LinearGradient colors={['#2A1A45', '#160C28', '#0C0718']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[s.photo, s.photoPlaceholder]}>
            <Moon size={36} color="rgba(180,160,255,0.55)" strokeWidth={1.4} />
            <Text style={s.spookyAskTitle}>この場所の写真がありません</Text>
            <Text style={s.spookyAskSub}>写真をお持ちの方は、ぜひ提供してください 🙏</Text>
            <TouchableOpacity onPress={handleAddPhoto} disabled={uploading} activeOpacity={0.8} style={s.spookyAddBtn}>
              {uploading
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Camera size={15} color="#fff" strokeWidth={2.2} /><Text style={s.spookyAddText}>写真を追加</Text></>}
            </TouchableOpacity>
          </LinearGradient>
        ) : (
          // 写真なし: 投稿を促す招待プレースホルダー（「最初の1枚」＝写真追加の入口。帯は残し下部グラデだけ消す）
          <View style={[s.photo, s.photoPlaceholder, s.phClean]}>
            <Camera size={38} color="#B9AEE6" strokeWidth={1.7} />
            <Text style={s.phInviteTitle}>最初の1枚を追加しませんか？</Text>
            <Text style={s.phInviteSub}>あなたの写真がみんなの参考に📸</Text>
            <TouchableOpacity onPress={handleAddPhoto} disabled={uploading} activeOpacity={0.85} style={s.genrePhBtn}>
              {uploading
                ? <ActivityIndicator color={BRAND} size="small" />
                : <><Camera size={14} color={BRAND} strokeWidth={2.2} /><Text style={s.genrePhBtnText}>写真を追加</Text></>}
            </TouchableOpacity>
          </View>
        )}

        {/* 下部グラデ（可読性用）— 写真がある時だけ。写真0の招待枠には出さない（"スライドバー"消し）*/}
        {photos.length > 0 && (
          <LinearGradient
            colors={['transparent', 'rgba(15,10,30,0.45)']}
            style={s.photoOverlay}
            pointerEvents="none"
          />
        )}

        {/* Wikimedia Commons 写真クレジット（CC帰属表示・ファイルページへリンク）— 写真表示中のみ */}
        {photos.length > 0 && (() => {
          const fileUrl = commonsFileUrl(photos[photoIdx] ?? photos[0]);
          return fileUrl ? (
            <TouchableOpacity
              style={s.commonsCredit}
              activeOpacity={0.7}
              onPress={() => Linking.openURL(fileUrl)}
            >
              <Text style={s.commonsCreditText}>📷 Wikimedia Commons</Text>
            </TouchableOpacity>
          ) : null;
        })()}

        {/* ページングドット + 矢印ボタン（提供スライド含む） */}
        {pageCount > 1 && (
          <>
            {photoIdx > 0 && (
              <TouchableOpacity onPress={() => scrollToPhoto(photoIdx - 1)} style={[s.arrowBtn, { left: 10 }]}>
                <Text style={s.arrowText}>‹</Text>
              </TouchableOpacity>
            )}
            {photoIdx < pageCount - 1 && (
              <TouchableOpacity onPress={() => scrollToPhoto(photoIdx + 1)} style={[s.arrowBtn, { right: 10 }]}>
                <Text style={s.arrowText}>›</Text>
              </TouchableOpacity>
            )}
            <View style={s.pageDots}>
              {Array.from({ length: pageCount }).map((_, i) => (
                <View key={i} style={[s.pageDot, i === photoIdx && s.pageDotActive]} />
              ))}
            </View>
          </>
        )}


      </View>

      {/* ハートボタン — カード右上（写真の有無に関わらず常に表示） */}
      <TouchableOpacity
        onPress={() => {
          Haptics.impactAsync(isFavorited ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
          pulseHeart();
          onToggleFavorite();
        }}
        style={s.favBtn}
        activeOpacity={0.9}
      >
        <Animated.View style={{ transform: [{ scale: heartScale }] }}>
          <Heart
            size={20}
            color={isFavorited ? BRAND : '#C084FC'}
            fill={isFavorited ? BRAND : 'none'}
            strokeWidth={2}
          />
        </Animated.View>
      </TouchableOpacity>

      {/* ── ボディ ────────────────────────────────── */}
      <View style={s.body}>

        {/* 有料掲載ラベル（景表法/ストア審査の広告明示要件） */}
        {item.isSponsored && (
          <View style={s.prBadge}>
            <Text style={s.prBadgeText}>{lang === 'ja' ? 'PR・広告' : 'Sponsored'}</Text>
          </View>
        )}

        {/* 写真ゼロ=未開拓スポット強調（写真一番乗りを募集して投稿動機を作る） */}
        {photos.length === 0 && !spooky ? (
          <LinearGradient colors={['#F472B6', '#9B6BFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.pioneerBadge}>
            <Camera size={12} color="#fff" strokeWidth={2.6} />
            <Text style={s.pioneerBadgeText}>未開拓スポット・写真一番乗り募集</Text>
          </LinearGradient>
        ) : null}

        {/* タイトル */}
        {onPressDetail ? (
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPressDetail(); }}
            onLongPress={() => copyPlaceName(item.title)}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 24 }}
            activeOpacity={0.75}>
            <Text style={[s.title, s.titleTappable, darkTheme && s.titleDark]} numberOfLines={2}>{item.title}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={[s.title, darkTheme && s.titleDark]} numberOfLines={2} onLongPress={() => copyPlaceName(item.title)} suppressHighlighting>{item.title}</Text>
        )}

        {/* 説明文（Web版と同じ small gray text） */}
        {description ? (
          <Text style={[s.description, darkTheme && s.textDimDark]} numberOfLines={2}>{description}</Text>
        ) : null}

        {/* MoodGo独自バッジ（気分ベース口コミの反応・Google評価の代わり） */}
        {item.moodLog && item.moodLog.count > 0 ? (
          <View style={s.moodLogRow}>
            <Text style={s.moodLogMain}>📝 Moodログ {item.moodLog.count}件</Text>
            {item.moodLog.topMood ? <Text style={s.moodLogSub}>{item.moodLog.topMood.replace(/^#/, '').replace(/したい$|感じたい$/, '')}多め</Text> : null}
            {item.moodLog.topCompanion ? <Text style={s.moodLogSub}>{item.moodLog.topCompanion}向き</Text> : null}
            {item.moodLog.revisit ? <Text style={s.moodLogSub}>また行きたい{item.moodLog.revisit}</Text> : null}
          </View>
        ) : null}

        {/* 評価 + 営業状態 (ピル) */}
        <View style={s.pillRow}>
          {item.rating != null && (
            <View style={s.ratingPill}>
              <Star size={13} color="#F59E0B" fill="#F59E0B" strokeWidth={0} />
              <Text style={s.ratingNum}>{item.rating.toFixed(1)}</Text>
              {item.userRatingCount ? (
                <Text style={s.ratingCount}>{t.reviewCount(item.userRatingCount)}</Text>
              ) : null}
            </View>
          )}
          {openNowLabel ? (
            <View style={[s.openPill, { backgroundColor: openNowColor + '18', borderColor: openNowColor + '55' }]}>
              <View style={[s.openDot, { backgroundColor: openNowColor }]} />
              <Text style={[s.openText, { color: openNowColor }]}>{openNowLabel}</Text>
            </View>
          ) : null}
          {item.priceLevel ? (
            <View style={s.pricePill}>
              <Text style={s.priceText}>{item.priceLevel}</Text>
            </View>
          ) : null}
        </View>

        {/* 住所（長押しでコピー） */}
        {item.address ? (
          <Text style={[s.address, darkTheme && s.textDimDark]} numberOfLines={2}
            onLongPress={() => copyPlaceName(item.address)} suppressHighlighting>{item.address}</Text>
        ) : null}

        {/* 現在地からの所要（車で何分か）— マスト表示 */}
        {item.distanceText ? (
          <View style={s.hoursRow}>
            <Navigation size={13} color={darkTheme ? '#9C8CC4' : '#9CA3AF'} strokeWidth={2} />
            <Text style={[s.hoursText, darkTheme && s.textDimDark]}>
              {item.distanceText}{item.durationText ? `  /  ${item.durationText}` : ''}
            </Text>
          </View>
        ) : null}

        {/* 最寄り駅から何分か — マスト表示（自動保存・HeartRails無料） */}
        {item.stationText ? (
          <View style={s.hoursRow}>
            <Train size={13} color={darkTheme ? '#9C8CC4' : '#9CA3AF'} strokeWidth={2} />
            <Text style={[s.hoursText, darkTheme && s.textDimDark]}>{item.stationText}</Text>
          </View>
        ) : null}

        {/* 営業時間（週全体・まとめ表示） */}
        {item.openingHoursText ? (
          <View style={s.hoursRow}>
            <Clock size={14} color="#9CA3AF" strokeWidth={2} style={{ marginTop: 2 }} />
            <Text style={s.hoursText}>{formatOpeningHours(item.openingHoursText)}</Text>
          </View>
        ) : null}

        {/* コンパクト(2カラム)では説明文の下の操作系を省略し、タップで詳細へ誘導 */}
        {!compact && (<>
        {/* AIのおすすめ理由は非表示（汎用的な文言が多いため）。再表示する場合はここを戻す。 */}

        {/* ── アクションボタン: Googleマップ + 行った！ ── */}
        <View style={s.actions}>
          {item.mapUrl ? (
            <PuniPressable
              onPress={() => {
                if (Platform.OS === 'ios') {
                  const query = encodeURIComponent(item.title || '');
                  Linking.openURL(`comgooglemaps://?q=${query}`).catch(() => Linking.openURL(item.mapUrl!));
                } else {
                  Linking.openURL(item.mapUrl!);
                }
              }}
              style={s.mapBtn}
              containerStyle={{ flex: 1 }}
            >
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mapBtnGrad}>
                <MapPin size={15} color="#fff" strokeWidth={2.5} />
                <Text style={s.mapBtnText}>{t.mapBtn}</Text>
              </LinearGradient>
            </PuniPressable>
          ) : null}
          {onMarkVisited ? (
            <PuniPressable
              onPress={onMarkVisited}
              disabled={isVisited}
              style={[s.visitedBtn, darkTheme && s.visitedBtnDark, isVisited && s.visitedBtnDone]}
            >
              {isVisited
                ? <><Check size={13} color="#10B981" strokeWidth={2.5} /><Text style={[s.visitedBtnText, s.visitedBtnTextDone]}>{t.visitedDone}</Text></>
                : <><Map size={13} color={darkTheme ? '#B7A8D9' : '#6B7280'} strokeWidth={2} /><Text style={[s.visitedBtnText, darkTheme && s.textDimDark]}>{t.visited}</Text></>}
            </PuniPressable>
          ) : null}

          {/* ホットペッパー */}
          {item.hotpepperUrl ? (
            <PuniPressable
              onPress={() => Linking.openURL(item.hotpepperUrl!)}
              style={s.hotpepperBtn}
            >
              <Flame size={13} color="#EF4444" strokeWidth={2} />
              <Text style={s.hotpepperText}>ホットペッパー</Text>
            </PuniPressable>
          ) : null}
        </View>

        <View style={[s.divider, darkTheme && s.dividerDark]} />

        {/* 気分が合う/合わないボタンは廃止。学習は詳細ページの★評価に一本化（SpotRating）。 */}

        {/* ソース表示（osm-* 等の内部ラベルは出さず、意味のあるソースのみ表示）*/}
        {(() => {
          const label =
            item.source === 'admin'     ? '🗄 DB登録済み' :
            item.source === 'user'      ? '👤 ユーザー投稿' :
            item.source === 'google'    ? '🔍 Google検索' :
            item.source === 'hotpepper' ? '🍽 ホットペッパー' : '';
          return label ? (
            <View style={s.sourceRow}>
              <Text style={s.sourceText}>{label}</Text>
            </View>
          ) : null;
        })()}

        {/* フッター */}
        <View style={s.footRow}>
          <View style={s.footLeft}>
            <PuniPressable onPress={handleShare} style={s.footBtnShare}>
              <Share2 size={12} color={darkTheme ? '#8C7BB8' : COLORS.textMuted} strokeWidth={2} />
              <Text style={[s.footBtnText, darkTheme && s.footBtnTextDark]}>{t.share}</Text>
            </PuniPressable>
            {/* 仲良しグループのチャットへ共有 */}
            <PuniPressable
              onPress={() => { shareSpotToGroup({ title: item.title, address: item.address, mapUrl: item.mapUrl }); sendEngagement(item.title, 'share', moodLabel); }}
              style={s.footBtnShare}
            >
              <MessageCircle size={12} color={darkTheme ? '#8C7BB8' : COLORS.textMuted} strokeWidth={2} />
              <Text style={[s.footBtnText, darkTheme && s.footBtnTextDark]}>グループ</Text>
            </PuniPressable>
          </View>
          <View style={s.footRight}>
            {onBlock && (
              <PuniPressable onPress={onBlock} style={s.footBtn}>
                <Text style={[s.footBtnText, darkTheme && s.footBtnTextDark]}>{t.hide}</Text>
              </PuniPressable>
            )}
            {onReport && (
              <PuniPressable onPress={onReport} style={s.footBtn}>
                <Text style={[s.footBtnText, darkTheme && s.footBtnTextDark]}>{t.report}</Text>
              </PuniPressable>
            )}
          </View>
        </View>
        </>)}
      </View>

      {/* 写真の全画面ビューア */}
      {viewerIdx !== null && photos.length > 0 && (
        <PhotoViewer
          photos={photos}
          initialIdx={Math.min(viewerIdx, photos.length - 1)}
          onClose={() => setViewerIdx(null)}
        />
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#9B6BFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(192,132,252,0.12)',
  },
  // ── 心霊ダークテーマ ──
  cardDark: { backgroundColor: '#160C28', borderColor: 'rgba(140,110,210,0.28)', shadowColor: '#000' },
  titleDark: { color: '#EFE6FF' },
  textDimDark: { color: '#A99BC4' },
  dividerDark: { backgroundColor: 'rgba(150,120,220,0.18)' },
  visitedBtnDark: { backgroundColor: 'rgba(45,30,70,0.85)', borderColor: 'rgba(140,110,210,0.3)' },
  moodMatchBtnDark: { backgroundColor: 'rgba(16,80,60,0.35)', borderColor: 'rgba(16,185,129,0.4)' },
  moodNotMatchBtnDark: { backgroundColor: 'rgba(80,25,30,0.35)', borderColor: 'rgba(239,68,68,0.4)' },
  footBtnTextDark: { color: '#9C8CC4' },
  spookyPhotoTint: { backgroundColor: 'rgba(8,4,20,0.45)' },

  // 写真
  photoWrap:        { position: 'relative' },
  photo:            { width: '100%', height: 220 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  // 写真なし時のクリーンな「?」プレースホルダー背景（淡いviolet-gray）
  phClean: { backgroundColor: '#F3F0F9', gap: 4, paddingHorizontal: 24 },
  phInviteTitle: { color: '#6B5A8A', fontSize: 14, fontWeight: '800', marginTop: 6, letterSpacing: 0.2, textAlign: 'center' },
  phInviteSub: { color: 'rgba(107,90,138,0.78)', fontSize: 11.5, fontWeight: '600', textAlign: 'center' },
  pioneerBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, marginBottom: 7 },
  pioneerBadgeText: { color: '#fff', fontSize: 11.5, fontWeight: '800', letterSpacing: 0.2 },
  genrePhEmoji: { fontSize: 44, marginBottom: 4 },
  genrePhLabel: { color: '#7A5A4A', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  genrePhSub: { color: 'rgba(120,90,74,0.7)', fontSize: 11, fontWeight: '600', marginTop: 2 },
  genrePhBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  genrePhBtnText: { color: BRAND, fontSize: 12, fontWeight: '700' },
  spookyAskTitle: { color: 'rgba(220,210,255,0.92)', fontSize: 14, fontWeight: '800', marginTop: 12 },
  spookyAskSub: { color: 'rgba(190,175,235,0.7)', fontSize: 12, marginTop: 4, textAlign: 'center', paddingHorizontal: 24 },
  spookyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16,
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999,
    backgroundColor: 'rgba(150,110,230,0.55)', borderWidth: 1, borderColor: 'rgba(200,180,255,0.4)',
  },
  spookyAddText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  spookyAddMini: {
    position: 'absolute', bottom: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(20,12,35,0.7)',
    borderWidth: 1, borderColor: 'rgba(200,180,255,0.35)',
  },
  spookyAddMiniText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  photoOverlay:     { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  commonsCredit: {
    position: 'absolute', left: 8, bottom: 8,
    backgroundColor: 'rgba(15,10,30,0.55)', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  commonsCreditText: { color: 'rgba(255,255,255,0.92)', fontSize: 10, fontWeight: '600' },
  arrowBtn: {
    position: 'absolute', top: '50%', marginTop: -20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(15,10,30,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  arrowText:     { color: '#fff', fontSize: 22, fontWeight: '600' },
  pageDots: {
    position: 'absolute', bottom: 12, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  pageDot:       { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.45)' },
  pageDotActive: { backgroundColor: '#fff', width: 16, borderRadius: 3 },


  // ハートボタン
  favBtn: {
    position: 'absolute', top: 12, right: 12,
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6,
    // 写真0のカードではハートがbody上に重なるため、最前面＆タップ可能に
    zIndex: 5, elevation: 5,
  },

  // ボディ
  body:        { padding: 16, gap: 8 },
  prBadge:       { alignSelf: 'flex-start', backgroundColor: '#EEE7FA', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 5 },
  prBadgeText:   { fontSize: 10.5, fontWeight: '800', color: '#7C3AED', letterSpacing: 0.3 },
  moodLogRow:    { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  moodLogMain:   { fontSize: 11.5, fontWeight: '800', color: '#7C3AED' },
  moodLogSub:    { fontSize: 11, fontWeight: '700', color: '#A06CB8', backgroundColor: '#F7EEFB', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  title:         { fontSize: 20, fontWeight: '800', color: '#1E0753', letterSpacing: -0.4, lineHeight: 26 },
  titleTappable: { textDecorationLine: 'underline', textDecorationColor: 'rgba(192,132,252,0.5)' },
  description: { fontSize: 13, color: '#9CA3AF', lineHeight: 18 },

  // AI相談のおすすめ理由ブロック
  aiReasonBox: {
    marginTop: 12,
    backgroundColor: '#F5F0FF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(155,107,255,0.18)',
    padding: 12,
  },
  aiReasonHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  aiReasonLabel: { fontSize: 11, fontWeight: '800', color: '#9B6BFF', letterSpacing: 0.3 },
  aiReasonText: { fontSize: 13, color: '#4B3B6B', lineHeight: 20, fontWeight: '500' },
  address:     { fontSize: 13, color: '#6B7280', lineHeight: 18 },

  // 評価 + 営業ピル row
  pillRow:    { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  ratingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FFFBEB', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  ratingNum:  { fontSize: 13, fontWeight: '700', color: '#92400E' },
  pricePill:  { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#EDE9FE', borderWidth: 1, borderColor: '#DDD6FE' },
  priceText:  { fontSize: 12, fontWeight: '800', color: '#7C3AED' },
  ratingCount:{ fontSize: 12, color: '#B45309' },
  openPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1,
  },
  openDot:  { width: 7, height: 7, borderRadius: 3.5 },
  openText: { fontSize: 12, fontWeight: '700' },

  // 距離ピル（全幅）
  distPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: '#F9FAFB', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  distText: { flex: 1, fontSize: 13, color: '#374151', fontWeight: '500' },

  // 営業時間
  hoursRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  hoursText:{ flex: 1, fontSize: 13, color: '#6B7280', lineHeight: 20 },

  // タグ
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    backgroundColor: 'rgba(192,132,252,0.08)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.22)',
  },
  tagText: { fontSize: 12, fontWeight: '600', color: '#7C3AED' },

  divider: { height: 1, backgroundColor: 'rgba(192,132,252,0.12)', marginVertical: 2 },

  // アクションボタン
  actions:    { flexDirection: 'row', gap: 8 },
  mapBtn:     { flex: 1, borderRadius: 14, overflow: 'hidden' },
  mapBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 48, borderRadius: 14,
  },
  mapBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  visitedBtn: {
    paddingHorizontal: 14, height: 48, borderRadius: 14,
    backgroundColor: '#F9FAFB',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderColor: 'rgba(192,132,252,0.35)',
  },
  visitedBtnDone:     { backgroundColor: '#ECFDF5', borderColor: '#10B981' },
  visitedBtnText:     { fontSize: 13, fontWeight: '600', color: '#374151' },
  visitedBtnTextDone: { color: '#10B981' },
  hotpepperBtn: {
    paddingHorizontal: 12, height: 48, borderRadius: 14,
    backgroundColor: '#FFF5F5',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: '#FCA5A5',
  },
  hotpepperText: { fontSize: 13, fontWeight: '700', color: '#DC2626' },

  // 気分
  moodQuestion:   { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 2 },
  moodRow:        { flexDirection: 'row', gap: 8, marginTop: 2 },
  moodMatchBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, borderRadius: 12,
    backgroundColor: '#ECFDF5', borderWidth: 1.5, borderColor: '#6EE7B7',
  },
  moodMatchText:    { fontSize: 13, fontWeight: '600', color: '#10B981' },
  moodNotMatchBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, borderRadius: 12,
    backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: '#FCA5A5',
  },
  moodNotMatchText: { fontSize: 13, fontWeight: '600', color: '#EF4444' },
  moodDoneRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  moodDoneText:     { fontSize: 13, fontWeight: '600' },

  // ソース
  sourceRow:  { marginBottom: 2 },
  sourceText: { fontSize: 11, color: '#A78BFA', fontWeight: '500' },

  // フッター
  footRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  footLeft:     { flexDirection: 'row', alignItems: 'center', gap: 14 },
  footBtnShare: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  footRight:    { flexDirection: 'row', gap: 14, marginRight: 16 },
  footBtn:      { paddingVertical: 2 },
  footBtnText:  { fontSize: 12, color: COLORS.textMuted },
});
