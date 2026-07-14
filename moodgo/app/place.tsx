// ── app/place.tsx ─────────────────────────────────────────────────────────────
// 場所詳細ページ（フルスクリーン）
// selectedPlace ストアから Recommendation を読み出して表示し、
// placeId があれば /api/place-detail から電話・公式サイト・口コミを取得。

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { router, Stack } from 'expo-router';
import {
  ArrowLeft, CalendarClock, CalendarX, Camera, ChevronDown, ChevronRight, ChevronUp, Clock, Footprints, Globe, Heart,
  Flag, MapPin, Moon, Navigation, Phone, RefreshCw, Share2, Star, ThumbsUp, Train, Wallet,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSelectedPlace, getSelectedContext } from '@/lib/selectedPlace';
import { openInGoogleMaps } from '@/lib/openMaps';
import { API_BASE, apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { showToast } from '@/lib/toast';
import { addSpotPhoto, useSpotPhotos } from '@/lib/spotPhotos';
import MoodLogSection from '@/components/MoodLogSection';
import ReportModal from '@/components/ReportModal';
import CommentsSection from '@/components/CommentsSection';
import SpotRating from '@/components/SpotRating';
import PhotoViewer from '@/components/PhotoViewer';

// この場所のコメント欄を出せるのは Supabase の場所ID(UUID)を持つスポットのみ
// （Google専用スポットは安定した恒久IDが無いためコメントを紐づけない）。
const PLACE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { copyPlaceName } from '@/lib/clipboard';
import { loadJSON, saveJSON, FAVORITES_KEY } from '@/lib/storage';
import { pushServerFavorites } from '@/lib/favoritesServer';
import { sameFav } from '@/lib/favKey';
import { addViewedLog } from '@/lib/spotLog';
import { genrePlaceholder } from '@/lib/genrePlaceholder';
import { useSettings, type Lang } from '@/lib/settingsStore';
import type { Recommendation, FavoriteItem } from '@/types/app';

const GRAD: [string, string, string] = ['#F472B6', '#C084FC', '#60A5FA'];
const GRAD_DARK: [string, string] = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)'];

// ── 表示テキスト（日本語 / 英語） ──────────────────────────────────────────────
const T = {
  ja: {
    close: '閉じる',
    readMore: '続きを読む',
    photoPermTitle: '写真へのアクセスが必要です',
    photoPermMsg: '設定アプリからMoodGoに写真の許可をしてください。',
    uploadFailed: '送信に失敗しました',
    firstThanksTitle: 'ありがとうございます！',
    firstThanksMsg: 'この場所の一番乗りです。あなたの写真がサムネに使われます 📸',
    errorTitle: 'エラー',
    photoUploadFailed: '写真の投稿に失敗しました',
    notFound: 'データが見つかりませんでした',
    openNow: '営業中',
    closedNow: '閉店中',
    spookyContributeTitle: '写真を提供してください',
    spookyContributeSub: 'あなたの写真でこの場所を伝えてください 🙏',
    addPhoto: '写真を追加',
    spookyNoPhotoTitle: 'この場所の写真がありません',
    spookyNoPhotoSub: '写真をお持ちの方は、ぜひ提供してください 🙏',
    noPhotoYet: 'まだ写真がありません',
    inviteTitle: 'あなたが「最初の1枚」の主に',
    inviteSub: 'ここを探す次の人の、いちばんの手がかりになります',
    addFirstPhoto: '一番乗りで写真を追加',
    contributeMoreTitle: 'あなたの1枚も、この場所に',
    contributeMoreSub: '違う角度・季節・時間帯の写真が、魅力をもっと伝えます',
    map: 'マップ',
    eventOngoing: '開催中',
    eventUpcoming: '開催予定',
    eventKicker: '期間限定イベント',
    limitedSpot: '期間限定の穴場',
    limitedEnded: '期間限定（終了）',
    ended: '終了',
    overallRating: '総合評価',
    overallRatingCount: (n: number) => `総合評価（${n}）`,
    visited: '行った！',
    loadingDetail: '詳細情報を読み込み中...',
    hoursLoadFailed: '営業時間などの読み込みに失敗しました。タップして再試行',
    searchInstagram: 'Instagramで検索',
    openingHours: '営業時間',
    hoursCheckedAt: (fresh: string) => `営業時間の最終確認: ${fresh}`,
    freshToday: '今日',
    freshYesterday: '昨日',
    freshDaysAgo: (n: number) => `${n}日前`,
    freshMonthsAgo: (n: number) => `${n}ヶ月前`,
  },
  en: {
    close: 'Close',
    readMore: 'Read more',
    photoPermTitle: 'Photo access needed',
    photoPermMsg: 'Please allow MoodGo to access your photos in Settings.',
    uploadFailed: 'Upload failed',
    firstThanksTitle: 'Thank you!',
    firstThanksMsg: "You're the first here. Your photo will be used as the thumbnail 📸",
    errorTitle: 'Error',
    photoUploadFailed: 'Failed to upload photo',
    notFound: 'No data found',
    openNow: 'Open',
    closedNow: 'Closed',
    spookyContributeTitle: 'Please share a photo',
    spookyContributeSub: 'Help show this place with your photo 🙏',
    addPhoto: 'Add photo',
    spookyNoPhotoTitle: 'No photos of this place yet',
    spookyNoPhotoSub: 'If you have a photo, please share it 🙏',
    noPhotoYet: 'No photos yet',
    inviteTitle: 'Be the first to add a photo',
    inviteSub: 'It becomes the best clue for the next person looking for this spot',
    addFirstPhoto: 'Be the first to add a photo',
    contributeMoreTitle: 'Add your shot to this place',
    contributeMoreSub: 'A different angle, season or time of day shows off the vibe',
    map: 'Map',
    eventOngoing: 'Now on',
    eventUpcoming: 'Upcoming',
    eventKicker: 'Limited-time event',
    limitedSpot: 'Limited-time spot',
    limitedEnded: 'Limited-time (ended)',
    ended: 'Ended',
    overallRating: 'Overall',
    overallRatingCount: (n: number) => `Overall (${n})`,
    visited: 'Been here!',
    loadingDetail: 'Loading details...',
    hoursLoadFailed: 'Failed to load hours and more. Tap to retry',
    searchInstagram: 'Search on Instagram',
    openingHours: 'Opening hours',
    hoursCheckedAt: (fresh: string) => `Hours last checked: ${fresh}`,
    freshToday: 'Today',
    freshYesterday: 'Yesterday',
    freshDaysAgo: (n: number) => `${n} day${n === 1 ? '' : 's'} ago`,
    freshMonthsAgo: (n: number) => `${n} month${n === 1 ? '' : 's'} ago`,
  },
} as const;

// ── 住所からエリア名（市区町村）を抽出 ────────────────────────────────────────
function extractAreaName(address: string | null | undefined): string | null {
  if (!address) return null;
  // 郵便番号を除去
  const cleaned = address.replace(/〒\d{3}-\d{4}\s*/, '').trim();
  // 都道府県の後の市区町村を取得（例: "東京都品川区" → "品川区"）
  const m = cleaned.match(/[都道府県]([^\s\d０-９]+?[市区町村郡])/);
  if (m) return m[1];
  return null;
}

// ── 営業時間パーサー ──────────────────────────────────────────────────────────
const DAY_ORDER = ['月', '火', '水', '木', '金', '土', '日'];

function formatOpeningHours(text: string): { label: string; time: string; isToday?: boolean }[] {
  const today = ['日', '月', '火', '水', '木', '金', '土'][new Date().getDay()];
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // 各行を構造化パース（Google Places API 形式: "月曜日: 9:00〜23:00"）
  type Entry = { day: string; hours: string };
  const parsed: Entry[] = [];
  let parseOk = true;

  for (const line of lines) {
    const m = line.match(/^([月火水木金土日])曜日?[：:]\s*(.+)$/);
    if (!m) { parseOk = false; break; }
    parsed.push({ day: m[1], hours: m[2].trim() });
  }

  // 構造化パースに成功した場合：同じ時間の曜日をグループ化
  if (parseOk && parsed.length > 0) {
    parsed.sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
    const groups: { days: string[]; hours: string }[] = [];
    for (const { day, hours } of parsed) {
      const last = groups[groups.length - 1];
      if (last && last.hours === hours) last.days.push(day);
      else groups.push({ days: [day], hours });
    }
    return groups.map(({ days, hours }) => {
      let label: string;
      if (days.length === 1) {
        label = `${days[0]}曜`;
      } else {
        const startIdx = DAY_ORDER.indexOf(days[0]);
        const isConsecutive = days.every((d, i) => DAY_ORDER.indexOf(d) === startIdx + i);
        label = (isConsecutive && days.length >= 3)
          ? `${days[0]}〜${days[days.length - 1]}曜`
          : days.map(d => `${d}曜`).join('・');
      }
      return { label, time: hours, isToday: days.includes(today) };
    });
  }

  // フォールバック: 行ごとにそのまま表示（ラベルと時間を ": " で分割）
  return lines.map(line => {
    const sep = line.indexOf(':');
    // コロン前が数字だけなら「10:00~21:00」のような時刻＝ラベル分割しない（10｜00~21:00に割れるバグ対策）
    if (sep > 0 && sep < 10 && !/^\d+$/.test(line.slice(0, sep).trim())) {
      const label = line.slice(0, sep).trim();
      const time = line.slice(sep + 1).trim();
      const dayChar = label.charAt(0);
      const isToday = ['月','火','水','木','金','土','日'].includes(dayChar)
        && dayChar === today;
      return { label, time, isToday };
    }
    return { label: '', time: line };
  });
}

// ── 型 ────────────────────────────────────────────────────────────────────────
type Review = {
  rating: number | null;
  text: string;
  authorName: string;
  authorPhoto: string | null;
  relativeTime: string;
};

// 鮮度ラベル: ISO日時 → 「今日/昨日/N日前/Nヶ月前」（情報の最終確認の目安表示）
function freshnessLabel(iso: string, lang: Lang): string {
  const tt = T[lang];
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return tt.freshToday;
  if (days === 1) return tt.freshYesterday;
  if (days < 30) return tt.freshDaysAgo(days);
  return tt.freshMonthsAgo(Math.floor(days / 30));
}

type ExtraDetail = {
  phone?: string | null;
  website?: string | null;
  reviews?: Review[];
  // APIから取得した確実なデータ（recのAI生成データより優先）
  openingHoursText?: string | null;
  openNow?: boolean | null;
  rating?: number | null;
  userRatingCount?: number | null;
  priceLevel?: string | null;
  address?: string | null;
  mapUrl?: string | null;   // Google Places の正しいURL（2枚目のページ）
  checkedAt?: string | null;  // 情報の最終確認日時（鮮度表示用）
  loaded?: boolean;
};

// ── Instagram アイコン（expo-linear-gradient + lucide Camera） ────────────────
const IG_GRAD: [string, string, string] = ['#FCAF45', '#E1306C', '#833AB4'];
function IconInstagram() {
  return (
    <LinearGradient
      colors={IG_GRAD}
      start={{ x: 0, y: 1 }}
      end={{ x: 1, y: 0 }}
      style={igStyle.wrap}
    >
      {/* カメラ外枠 */}
      <View style={igStyle.outer}>
        {/* レンズ */}
        <View style={igStyle.lens} />
        {/* 右上ドット */}
        <View style={igStyle.dot} />
      </View>
    </LinearGradient>
  );
}
const igStyle = StyleSheet.create({
  wrap: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  outer: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center' },
  lens: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: '#fff' },
  dot: { position: 'absolute', top: 1, right: 1, width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#fff' },
});

// ── 星表示 ────────────────────────────────────────────────────────────────────
function StarRow({ rating, size = 13 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          size={size}
          strokeWidth={0}
          color={n <= Math.round(rating) ? '#F59E0B' : '#E5E7EB'}
          fill={n <= Math.round(rating) ? '#F59E0B' : '#E5E7EB'}
        />
      ))}
    </View>
  );
}

// ── レビューカード ─────────────────────────────────────────────────────────────
function ReviewCard({ review, index }: { review: Review; index: number }) {
  const { lang } = useSettings();
  const t = T[lang];
  const [expanded, setExpanded] = useState(false);
  const MAX = 120;
  const needsExpand = review.text.length > MAX;
  const displayText = expanded || !needsExpand ? review.text : review.text.slice(0, MAX) + '…';

  // アバター頭文字の背景色をインデックスで分散
  const avatarColors = ['#F472B6', '#C084FC', '#60A5FA', '#34D399', '#FB923C'];
  const avatarBg = avatarColors[index % avatarColors.length];
  const initial = review.authorName.charAt(0).toUpperCase();

  return (
    <View style={rs.card}>
      {/* ヘッダー：アバター + 名前 + 時間 */}
      <View style={rs.cardHeader}>
        {review.authorPhoto ? (
          <Image source={{ uri: review.authorPhoto }} style={rs.avatar} contentFit="cover" />
        ) : (
          <View style={[rs.avatarFallback, { backgroundColor: avatarBg }]}>
            <Text style={rs.avatarInitial}>{initial}</Text>
          </View>
        )}
        <View style={rs.authorInfo}>
          <Text style={rs.authorName}>{review.authorName}</Text>
          {review.relativeTime ? (
            <Text style={rs.relativeTime}>{review.relativeTime}</Text>
          ) : null}
        </View>
        {review.rating != null && <StarRow rating={review.rating} size={12} />}
      </View>

      {/* 本文 */}
      <Text style={rs.reviewText}>{displayText}</Text>

      {/* もっと見る */}
      {needsExpand && (
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setExpanded(v => !v); }}
          style={rs.expandBtn}
          activeOpacity={0.7}
        >
          {expanded
            ? <><ChevronUp size={13} color="#C084FC" strokeWidth={2} /><Text style={rs.expandText}>{t.close}</Text></>
            : <><ChevronDown size={13} color="#C084FC" strokeWidth={2} /><Text style={rs.expandText}>{t.readMore}</Text></>
          }
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── スケルトンローダー ─────────────────────────────────────────────────────────
function SkeletonBox({ widthPct, widthPx, height, radius = 8 }: { widthPct?: string; widthPx?: number; height: number; radius?: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{
      width: widthPx ?? (widthPct as any), height, borderRadius: radius,
      backgroundColor: '#E5E7EB', opacity,
    }} />
  );
}

function InfoSkeleton() {
  return (
    <View style={{ gap: 14 }}>
      {/* 評価バースケルトン */}
      <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 10,
        borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <SkeletonBox widthPx={52} height={38} radius={8} />
          <View style={{ gap: 8 }}>
            <SkeletonBox widthPx={100} height={14} />
            <SkeletonBox widthPx={80} height={12} />
          </View>
        </View>
      </View>
      {/* 情報カードスケルトン */}
      <View style={{ backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)' }}>
        {[0,1,2].map(i => (
          <View key={i} style={{ flexDirection: 'row', gap: 12, padding: 14,
            borderTopWidth: i > 0 ? 1 : 0, borderTopColor: 'rgba(192,132,252,0.08)' }}>
            <SkeletonBox widthPx={30} height={30} radius={9} />
            <View style={{ flex: 1, gap: 6, paddingTop: 4 }}>
              <SkeletonBox widthPct="80%" height={14} />
              {i === 0 && <SkeletonBox widthPct="60%" height={12} />}
            </View>
          </View>
        ))}
      </View>
      {/* 営業時間スケルトン */}
      <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 10,
        borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)' }}>
        <SkeletonBox widthPx={80} height={15} />
        {[0,1,2,3].map(i => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <SkeletonBox widthPx={70} height={13} />
            <SkeletonBox widthPx={120} height={13} />
          </View>
        ))}
      </View>
    </View>
  );
}

// ── メインコンポーネント ────────────────────────────────────────────────────────
export default function PlaceDetailPage() {
  const insets = useSafeAreaInsets();
  const { lang } = useSettings();
  const t = T[lang];
  const place = getSelectedPlace();
  const detailCtx = getSelectedContext();   // 検索文脈（気分/同行/深掘り）→★評価の学習に使う
  const [rec, setRec] = useState<Recommendation | null>(place);
  const [reportOpen, setReportOpen] = useState(false);   // 情報の間違い報告（場所名/営業時間/最寄り駅など）

  // 経路差の自己解決（2026-07-15）: supabaseId無しで開かれた場合（お気に入り/投稿詳細経由の一部等）は
  //   名前からSupabaseの正規place IDを引いて rec に補完する。recはstateなので補完すると
  //   コメント(ID必須)/Moodログ/写真/評価の取得キーが一斉に揃い、どこから開いても同じ表示になる
  //   （同じ場所なのに経路で表示が割れる問題の根治）。同名チェーンの誤リンクを避けるため
  //   「正規化名の完全一致がちょうど1件」の時だけ採用する。
  useEffect(() => {
    if (!rec?.title) return;
    const hasId = !!(rec.supabaseId && PLACE_UUID_RE.test(rec.supabaseId));
    const missing = !rec.openingHoursText || !rec.stationText || !rec.address;
    if (hasId && !missing) return;   // IDも情報も揃っていれば何もしない
    let active = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/place-search?q=${encodeURIComponent(rec.title)}`);
        const d = await r.json();
        type Hit = { id: string; name: string; address?: string | null; openHours?: string | null; station?: string | null };
        const hits = Array.isArray(d?.places) ? (d.places as Hit[]) : [];
        const norm = (s: string) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
        // ID一致を最優先。無ければ「正規化名の完全一致がちょうど1件」の時だけ採用（チェーン誤リンク防止）
        const byId = hasId ? hits.find((h) => h.id === rec.supabaseId) : undefined;
        const exact = hits.filter((h) => norm(h.name) === norm(rec.title));
        const hit = byId ?? (exact.length === 1 ? exact[0] : undefined);
        if (active && hit?.id) {
          setRec(prev => (prev ? {
            ...prev,
            supabaseId: prev.supabaseId && PLACE_UUID_RE.test(prev.supabaseId) ? prev.supabaseId : hit.id,
            // 欠けている項目だけ place行から補完＝どの経路で開いても住所/営業時間/最寄り駅が揃う
            address: prev.address || hit.address || undefined,
            openingHoursText: prev.openingHoursText || hit.openHours || undefined,
            stationText: prev.stationText || hit.station || undefined,
          } : prev));
        }
      } catch { /* 解決できなくても従来表示のまま */ }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.title, rec?.supabaseId]);
  const [ratingDelta, setRatingDelta] = useState(0);  // 自分が今セッションで新規評価した分(件数を即時+1)
  // 総合評価バー（投稿詳細と統一）: MoodGo★平均＋この場所の「行った!」延べ人数
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [priceAvg, setPriceAvg] = useState<string | null>(null);   // 利用者の値段の平均（みんなの目安）
  const [priceCount, setPriceCount] = useState(0);
  const [placeVisited, setPlaceVisited] = useState(0);
  // この場所で開催中/開催予定の「期間限定イベント派生スポット」への導線
  const [placeEvents, setPlaceEvents] = useState<Array<{ targetId: string; eventName: string; until: string | null; upcoming: boolean }>>([]);
  useEffect(() => {
    const pid = rec?.supabaseId ?? rec?.placeId;
    const name = rec?.title;
    if (!name && !pid) return;
    let active = true;
    (async () => {
      try {
        const qs = new URLSearchParams();
        if (pid) qs.set('placeId', String(pid));
        if (name) qs.set('placeName', name);
        const d = await apiFetch(`/api/spot-rating?${qs.toString()}`).then((r) => r.json());
        if (active && d?.ok) { setAvgRating(d.avg ?? null); setRatingCount(d.count ?? 0); setPriceAvg(d.priceAvg ?? null); setPriceCount(d.priceCount ?? 0); }
      } catch { /* noop */ }
    })();
    (async () => {
      try {
        const d = await apiFetch('/api/place-visited', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'count', placeName: name, supabaseId: rec?.supabaseId, placeId: rec?.placeId, address: rec?.address }),
        }).then((r) => r.json());
        if (active && d?.ok) setPlaceVisited(d.count ?? 0);
      } catch { /* noop */ }
    })();
    return () => { active = false; };
  }, [rec?.supabaseId, rec?.placeId, rec?.title, rec?.address]);
  const [extra, setExtra] = useState<ExtraDetail>({
    phone: place?.phone ?? null,
    website: place?.website ?? null,
    reviews: [],
    loaded: false,
  });
  const [fetchError, setFetchError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [faved, setFaved] = useState(false);

  // お気に入り状態を読み込み
  useEffect(() => {
    (async () => {
      if (!place?.title) return;
      const faves = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
      setFaved(faves.some((f) => sameFav(f, place)));  // 同名別スポット混線防止(ID優先判定)
    })();
  }, [place?.title]);

  // プロフィール「最近チェックしたスポット」用の閲覧記録（端末ローカル・最新が先頭）
  useEffect(() => {
    if (!rec?.title) return;
    addViewedLog({
      title: rec.title, photoUrl: rec.photoUrl ?? rec.photoUrls?.[0],
      address: rec.address, placeId: rec.placeId, supabaseId: rec.supabaseId, tags: rec.tags,
    });
  }, [rec?.title]);

  // この場所を保存している人数（みんなの合計）。ハート下に表示＝押した分がカウントされるのを可視化。
  const [favCount, setFavCount] = useState(0);
  const favKey = String(rec?.supabaseId ?? rec?.placeId ?? rec?.title ?? '').trim();   // サーバーのfav_keyと同じ優先度
  useEffect(() => {
    if (!favKey) return;
    let alive = true;
    apiFetch('/api/user-favorites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'count', favKey }),
    }).then((r) => r.json())
      .then((d) => { if (alive && typeof d?.count === 'number') setFavCount(d.count); })
      .catch(() => {});
    return () => { alive = false; };
  }, [favKey]);

  const toggleFav = async () => {
    if (!rec) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextFaved = !faved;
    setFaved(nextFaved);   // 楽観的に即トグル（ハートは押した瞬間に反映・ストレージ整合は後追い）
    setFavCount((c) => Math.max(0, c + (nextFaved ? 1 : -1)));   // カウントも即±1（サーバー集計は後追い）
    const faves = await loadJSON<FavoriteItem[]>(FAVORITES_KEY, []);
    const next: FavoriteItem[] = nextFaved
      ? (faves.some((f) => sameFav(f, rec)) ? faves : [{
          title: rec.title, area: '', vibe: rec.vibe ?? '',
          photoUrl: rec.photoUrl ?? '', photoUrls: rec.photoUrls,
          mapUrl: rec.mapUrl, createdAt: new Date().toISOString(),
          placeId: rec.placeId, address: rec.address, rating: rec.rating ?? null,
          stationText: rec.stationText, distanceText: rec.distanceText,
          priceLevel: rec.priceLevel, kind: 'place',
          supabaseId: rec.supabaseId,  // 同一判定用(sameFav)
        }, ...faves])
      : faves.filter((f) => !sameFav(f, rec));
    await saveJSON(FAVORITES_KEY, next);
    pushServerFavorites(next);   // 行きたいリストのサーバー同期
  };
  const [photoIdx, setPhotoIdx] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);   // 写真タップで全画面ビューア
  // API削減: 1枚目だけ即読込み、残りは到達ページまで読み込む（未到達はImage描画せず=Google解決を遅延）
  const [maxLoaded, setMaxLoaded] = useState(0);
  const [photoWidth, setPhotoWidth] = useState(0);
  const photoScrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;

  // 心霊スポット判定: タグ or サーバ判定（古いお気に入り＝tag未保存でも拾う）
  const tagShinrei = !!rec?.tags?.includes('#心霊スポット');
  const [serverShinrei, setServerShinrei] = useState(false);
  const isSpooky = tagShinrei || serverShinrei;
  const storePhotos = useSpotPhotos(rec?.supabaseId, rec?.title);
  const [fetchedPhotos, setFetchedPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // 心霊は保存済みGoogle写真を一切使わない（利用者投稿/プレースホルダーのみ）
  const basePhotos = (rec && !isSpooky)
    ? ((rec.photoUrls ?? []).length > 0 ? rec.photoUrls! : rec.photoUrl ? [rec.photoUrl] : [])
    : [];
  // 利用者投稿写真（このセッションの投稿＋取得済みの承認・再利用OK写真）
  const userPhotos = [...new Set([...storePhotos, ...fetchedPhotos])];
  // 利用者写真が3枚以上集まったら Google等(basePhotos)は使わず利用者写真のみ（ユーザー要望）。
  //   3枚未満は 利用者写真を先頭に＋既存(Google)で補完。
  const photos = userPhotos.length >= 3
    ? userPhotos
    : [...new Set([...userPhotos, ...basePhotos])];
  // 通常スポットの写真ゼロ時の招待枠用: タグ→ジャンル絵文字/淡グラデ（null=汎用）
  const ph = genrePlaceholder(rec?.tags);
  // 心霊で写真がある場合、末尾に「提供してください」スライドを追加
  // 写真がある全スポットで、ヒーロー末尾に「写真を追加」ページを常に出す（何枚あっても募集を継続）。
  const showContribute = photos.length > 0;
  const heroPageCount = photos.length + (showContribute ? 1 : 0);

  // 投稿写真の取得＋心霊判定。
  //   ・心霊/独自スポット(placeIdなし): 全投稿写真を取得（従来どおり・isShinrei判定も兼ねる）。
  //   ・通常のGoogleスポット: 承認済み&再利用OK(reusable=1)の利用者投稿写真だけをヒーロー候補に取得。
  //     → 利用者投稿があればカード同様に詳細のメイン画像も利用者写真になる（3枚以上ならGoogleを使わない）。
  useEffect(() => {
    if (!rec) return;
    let active = true;
    const params = new URLSearchParams();
    if (rec.supabaseId) params.set('placeId', rec.supabaseId);
    else if (rec.title) params.set('placeName', rec.title);
    if (![...params.keys()].length) return;
    // placeIdあり=通常Googleスポット → 承認済み&再利用OKのみ（pending/private/非再利用を出さない）
    if (!tagShinrei && rec.placeId) params.set('reusable', '1');
    apiFetch(`/api/spot-photo?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (!active || !d?.ok) return;
        if (Array.isArray(d.photos)) setFetchedPhotos(d.photos);
        if (d.isShinrei) setServerShinrei(true);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [tagShinrei, rec?.placeId, rec?.supabaseId, rec?.title]);

  // この場所で開催中/開催予定の「期間限定イベント派生スポット」を取得（元スポット→イベントへの導線）。
  useEffect(() => {
    const name = rec?.title?.trim();
    if (!name || name.length < 2) { setPlaceEvents([]); return; }
    let active = true;
    apiFetch(`/api/place-events?placeName=${encodeURIComponent(name)}`)
      .then(r => r.json())
      .then(d => { if (active && d?.ok && Array.isArray(d.events)) setPlaceEvents(d.events.filter((e: { targetId?: string }) => !!e.targetId)); })
      .catch(() => {});
    return () => { active = false; };
  }, [rec?.title]);

  // 写真を提供（誰でも追加可・削除は管理者のみ）
  const handleAddSpotPhoto = async () => {
    if (uploadingPhoto || !rec) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert(t.photoPermTitle, t.photoPermMsg); return; }
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (picked.canceled || !picked.assets?.length) return;
      setUploadingPhoto(true);
      const small = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri, [{ resize: { width: 1080 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      const deviceId = await getDeviceId().catch(() => '');
      const res = await apiFetch('/api/spot-photo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: rec.supabaseId, placeName: rec.title, address: rec.address ?? '', deviceId, imageBase64: small.base64 }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) throw new Error(data.error ?? t.uploadFailed);
      addSpotPhoto(rec.supabaseId, rec.title, data.url);  // 共有ストアへ→一覧にも即反映
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // 一番乗り（写真ゼロだった場所）への投稿だけ、達成感を言語化して次の投稿動機に
      // 結果通知はトーストに統一（確認ダイアログのみAlert・2026-07-11）
      if (userPhotos.length === 0 && !isSpooky) {
        showToast(t.firstThanksTitle, t.firstThanksMsg);
      }
    } catch (e) {
      showToast(t.errorTitle, e instanceof Error ? e.message : t.photoUploadFailed);
    } finally { setUploadingPhoto(false); }
  };

  // Google Place Detail APIから完全な情報を取得
  const fetchDetail = useCallback(async (retries = 1) => {
    if (!rec) return;
    // 心霊スポットはGoogleを一切使わない（写真・口コミ・営業時間も取得しない）
    if (rec.tags?.includes('#心霊スポット')) {
      setExtra(prev => ({ ...prev, loaded: true }));
      return;
    }
    setFetchError(false);
    setExtra(prev => ({ ...prev, loaded: false }));

    // #9: 「通信失敗」と「正常応答だが詳細データ無し(Google未収録のOSM/自前スポット等)」を区別する。
    //   後者は失敗ではないのでエラー表示せず、基本情報だけ出す（口コミ・営業時間は元から無いのが正常）。
    let hadNetError = false;
    // APIを呼び出してデータを返す（stateはセットしない）
    type PlaceData = Record<string, unknown>;
    const fetchPlace = async (body: Record<string, unknown>): Promise<PlaceData | null> => {
      try {
        const res = await fetch(`${API_BASE}/api/place-detail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await res.json();
        if (d.ok && d.place) return d.place as PlaceData;
        return null;  // 正常応答・詳細なし（通信失敗ではない）
      } catch {
        hadNetError = true;  // 通信失敗のみ true
        return null;
      }
    };

    // データの品質を判定（口コミまたは営業時間があれば「完全」）
    const isComplete = (p: PlaceData) =>
      ((p.reviews as unknown[])?.length ?? 0) > 0 || !!p.openingHoursText;

    // stateに反映
    const applyData = (p: PlaceData) => {
      setExtra({
        phone: (p.phone as string) ?? null,
        website: (p.website as string) ?? null,
        reviews: (p.reviews as Review[]) ?? [],
        openingHoursText: (p.openingHoursText as string) ?? null,
        openNow: (p.openNow as boolean) ?? null,
        rating: typeof p.rating === 'number' ? p.rating : null,
        userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
        priceLevel: (p.priceLevel as string) ?? null,
        address: (p.address as string) || null,
        mapUrl: (p.mapUrl as string) || null,
        checkedAt: (p.checkedAt as string) || null,
        loaded: true,
      });
      setRec(prev => prev ? {
        ...prev,
        mapUrl:    (p.mapUrl as string) || prev.mapUrl,
        // 心霊スポットはGoogle由来の写真を取り込まない（利用者投稿のみ）
        photoUrls: prev.tags?.includes('#心霊スポット')
          ? prev.photoUrls
          : ((p.photoUrls as string[])?.length ? (p.photoUrls as string[]) : prev.photoUrls),
        lat:       (p.lat as number)    ?? prev.lat,
        lng:       (p.lng as number)    ?? prev.lng,
      } : prev);
    };

    const nameBody = { name: rec.title, address: rec.address ?? '' };
    const idBody   = rec.placeId ? { placeId: rec.placeId } : null;

    // 戦略:
    // 1. placeIdで取得 → 口コミ・営業時間あり → 採用
    // 2. placeIdで取得したが不完全 → 名前+住所で再取得 → より良い方を採用
    // 3. placeIdなし / 失敗 → 名前+住所のみ
    // 4. 全失敗 → 1秒後リトライ
    let best: PlaceData | null = null;

    if (idBody) {
      const byId = await fetchPlace(idBody);
      if (byId) {
        best = byId;
        // 不完全（口コミ・営業時間なし）なら名前検索でも試みる
        if (!isComplete(byId)) {
          const byName = await fetchPlace(nameBody);
          // 名前検索の方が完全なデータを持っていれば優先
          if (byName && isComplete(byName)) best = byName;
        }
      } else {
        best = await fetchPlace(nameBody);
      }
    } else {
      best = await fetchPlace(nameBody);
    }

    if (!best && retries > 0) {
      await new Promise(r => setTimeout(r, 1200));
      best = idBody ? (await fetchPlace(idBody) ?? await fetchPlace(nameBody))
                    : await fetchPlace(nameBody);
    }

    if (best) {
      applyData(best);
    } else {
      // 詳細データが取れなくても、通信失敗でなければエラーにしない（Google未収録＝正常）。
      setExtra(prev => ({ ...prev, loaded: true }));
      setFetchError(hadNetError);
    }
  }, [rec?.title, rec?.placeId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDetail(1);
    setRefreshing(false);
  }, [fetchDetail]);

  useEffect(() => { fetchDetail(); }, []);

  const onPhotoScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (photoWidth <= 0) return;
    const idx = Math.round(e.nativeEvent.contentOffset.x / photoWidth);
    if (idx !== photoIdx) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPhotoIdx(idx);
    }
    setMaxLoaded(m => Math.max(m, idx));
  }, [photoWidth, photoIdx]);

  const scrollToPhoto = (idx: number) => {
    setMaxLoaded(m => Math.max(m, idx));
    photoScrollRef.current?.scrollTo({ x: idx * photoWidth, animated: true });
    setPhotoIdx(idx);
  };

  const handleShare = () => {
    if (!rec) return;
    const parts: string[] = [rec.title];
    if (displayAddress) parts.push(displayAddress);
    const shareUrl = (extra.loaded && extra.mapUrl) ? extra.mapUrl : rec.mapUrl;
    if (shareUrl) parts.push(shareUrl);
    Share.share({ message: parts.join('\n') });
  };

  const headerOpacity = scrollY.interpolate({
    inputRange: [200, 260],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  if (!rec) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtnSolid}>
          <ArrowLeft size={20} color="#374151" strokeWidth={2.5} />
        </TouchableOpacity>
        <View style={s.errorBox}>
          <Text style={s.errorText}>{t.notFound}</Text>
        </View>
      </View>
    );
  }

  // APIデータを優先、なければ rec のデータにフォールバック
  const areaName = extractAreaName(extra.loaded ? (extra.address || rec.address) : rec.address);
  const displayRating = extra.loaded ? (extra.rating ?? rec.rating) : rec.rating;
  const baseRatingCount = extra.loaded ? (extra.userRatingCount ?? rec.userRatingCount) : rec.userRatingCount;
  const displayUserRatingCount = (baseRatingCount ?? 0) + ratingDelta;  // MoodGo評価を押すたびに『○○件の評価』が増える
  const displayOpenNow = extra.loaded ? (extra.openNow ?? rec.openNow) : rec.openNow;
  const displayPriceLevel = extra.loaded ? (extra.priceLevel ?? rec.priceLevel) : rec.priceLevel;
  // 値段: 利用者の平均があればそれを「みんなの目安」として、無ければGoogleの価格帯を表示
  const priceDisplay = priceCount > 0 && priceAvg
    ? (priceCount >= 2 ? `${priceAvg}（${priceCount}人の平均）` : priceAvg)
    : (extra.loaded ? displayPriceLevel : null);
  const displayAddress = extra.loaded ? (extra.address || rec.address) : rec.address;
  // mapUrl: APIの正しいURL（2枚目のページ）を優先、なければrecのAI生成URL
  const displayMapUrl = (extra.loaded && extra.mapUrl) ? extra.mapUrl : rec.mapUrl;
  // 営業時間: APIデータ優先。ロード前のみ rec のデータを暫定表示
  // （extra.loaded 後は AI生成の不完全データにフォールバックしない）
  const hoursSource = extra.loaded
    ? (extra.openingHoursText || rec.openingHoursText)   // Google優先・無ければ投稿/place行の営業時間（ユーザー/OSMスポットで消えないように）
    : rec.openingHoursText;                           // 読み込み中は暫定表示
  if (__DEV__ && hoursSource) {
    console.log('[place.tsx] hoursSource lines:', hoursSource.split('\n').length, hoursSource.slice(0, 80));
  }
  const openNowColor = displayOpenNow === true ? '#10B981' : displayOpenNow === false ? '#EF4444' : '#9CA3AF';
  const openNowLabel = displayOpenNow === true ? t.openNow : displayOpenNow === false ? t.closedNow : null;
  const hoursRows = hoursSource ? formatOpeningHours(hoursSource) : [];
  // 曜日ラベル付き(Google週間形式)は下部テーブル、それ以外(「10:00~21:00（水曜定休）」等)は情報カードの行に出す（投稿詳細と統一）
  const isWeekdayHours = hoursRows.some(r => r.label);
  const inlineHours = !isWeekdayHours ? String(hoursSource ?? '').trim() : '';

  return (
    <View style={s.root}>
      {/* スワイプで前のページに戻る（左端エッジ発火＝硬め・_layout の既定に合わせる）*/}
      <Stack.Screen options={{ gestureEnabled: true, fullScreenGestureEnabled: false }} />

      {/* ── スティッキーヘッダー ── */}
      <Animated.View
        style={[s.stickyHeader, { paddingTop: insets.top, opacity: headerOpacity }]}
        pointerEvents="none"
      >
        <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        <Text style={s.stickyTitle} numberOfLines={1}>{rec.title}</Text>
      </Animated.View>

      {/* ── フローティングボタン ── */}
      <View style={[s.topBtns, { top: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={s.overlayBtn}
          activeOpacity={0.85}
        >
          <ArrowLeft size={18} color="#fff" strokeWidth={2.5} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={() => setReportOpen(true)} style={s.overlayBtn} activeOpacity={0.85}
            accessibilityRole="button" accessibilityLabel="情報の間違いを報告">
            <Flag size={16} color="#fff" strokeWidth={2.2} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} style={s.overlayBtn} activeOpacity={0.85}>
            <Share2 size={18} color="#fff" strokeWidth={2} />
          </TouchableOpacity>
        </View>
      </View>

      <Animated.ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#C084FC"
            colors={['#C084FC', '#F472B6']}
          />
        }
      >
        {/* ── ヒーロー写真 ── */}
        <View style={s.heroWrap} onLayout={e => setPhotoWidth(e.nativeEvent.layout.width)}>
          {photos.length > 0 && photoWidth > 0 ? (
            <ScrollView
              ref={photoScrollRef}
              horizontal pagingEnabled
              scrollEnabled={heroPageCount > 1}
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast" bounces={false}
              onMomentumScrollEnd={onPhotoScrollEnd}
              style={{ width: photoWidth, height: 300 }}
            >
              {photos.map((uri, i) => (
                i <= maxLoaded ? (
                  // タップで全画面ビューア（スワイプ切替・ピンチズーム）
                  <TouchableOpacity key={i} activeOpacity={0.95} onPress={() => setViewerOpen(true)}>
                    <Image source={{ uri }}
                      style={{ width: photoWidth, height: 300 }} contentFit="cover" transition={200} />
                  </TouchableOpacity>
                ) : (
                  // 未到達ページ: 画像を読み込まずプレースホルダ（スクロールで読み込む＝API削減）
                  <View key={i} style={{ width: photoWidth, height: 300, backgroundColor: '#EFEAF7' }} />
                )
              ))}
              {showContribute && (isSpooky ? (
                <LinearGradient colors={['#2A1A45', '#160C28', '#0C0718']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
                  style={[s.heroPlaceholder, { width: photoWidth, height: 300 }]}>
                  <Moon size={44} color="rgba(180,160,255,0.55)" strokeWidth={1.3} />
                  <Text style={s.heroSpookyTitle}>{t.spookyContributeTitle}</Text>
                  <Text style={s.heroSpookySub}>{t.spookyContributeSub}</Text>
                  <TouchableOpacity onPress={handleAddSpotPhoto} disabled={uploadingPhoto} activeOpacity={0.8} style={s.heroSpookyBtn}>
                    {uploadingPhoto
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <><Camera size={16} color="#fff" strokeWidth={2.2} /><Text style={s.heroSpookyBtnText}>{t.addPhoto}</Text></>}
                  </TouchableOpacity>
                </LinearGradient>
              ) : (
                // 通常スポット: 写真がすでにあっても末尾に明るい「写真を追加」ページを出す（何枚でも募集継続）
                <LinearGradient colors={ph ? ph.colors : ['#F7F2FF', '#EDE4FF']} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }}
                  style={[s.heroPlaceholder, { width: photoWidth, height: 300 }]}>
                  <View style={s.heroGenreIconWrap}>
                    <Camera size={28} color="#8A6BF0" strokeWidth={1.9} />
                  </View>
                  <Text style={s.heroInviteTitle}>{t.contributeMoreTitle}</Text>
                  <Text style={s.heroInviteSub}>{t.contributeMoreSub}</Text>
                  <TouchableOpacity onPress={handleAddSpotPhoto} disabled={uploadingPhoto} activeOpacity={0.85} style={s.heroInviteBtnWrap}>
                    <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroInviteBtn}>
                      {uploadingPhoto
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <><Camera size={16} color="#fff" strokeWidth={2.4} /><Text style={s.heroInviteBtnText}>{t.addPhoto}</Text></>}
                    </LinearGradient>
                  </TouchableOpacity>
                </LinearGradient>
              ))}
            </ScrollView>
          ) : isSpooky ? (
            <LinearGradient colors={['#2A1A45', '#160C28', '#0C0718']} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={s.heroPlaceholder}>
              <Moon size={48} color="rgba(180,160,255,0.55)" strokeWidth={1.3} />
              <Text style={s.heroSpookyTitle}>{t.spookyNoPhotoTitle}</Text>
              <Text style={s.heroSpookySub}>{t.spookyNoPhotoSub}</Text>
              <TouchableOpacity onPress={handleAddSpotPhoto} disabled={uploadingPhoto} activeOpacity={0.8} style={s.heroSpookyBtn}>
                {uploadingPhoto
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <><Camera size={16} color="#fff" strokeWidth={2.2} /><Text style={s.heroSpookyBtnText}>{t.addPhoto}</Text></>}
              </TouchableOpacity>
            </LinearGradient>
          ) : (
            // 通常スポット・写真ゼロ: 明るい「一番乗り」招待枠（心霊の暗テンプレとは別系統）
            <LinearGradient
              colors={ph ? ph.colors : ['#F7F2FF', '#EDE4FF']}
              start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }}
              style={s.heroPlaceholder}
            >
              <View style={s.heroGenreIconWrap}>
                <Camera size={28} color="#8A6BF0" strokeWidth={1.9} />
              </View>
              <View style={s.heroFirstPill}>
                <Camera size={12} color="#7C3AED" strokeWidth={2.4} />
                <Text style={s.heroFirstPillText}>{t.noPhotoYet}</Text>
              </View>
              <Text style={s.heroInviteTitle}>{t.inviteTitle}</Text>
              <Text style={s.heroInviteSub}>{t.inviteSub}</Text>
              <TouchableOpacity onPress={handleAddSpotPhoto} disabled={uploadingPhoto} activeOpacity={0.85} style={s.heroInviteBtnWrap}>
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroInviteBtn}>
                  {uploadingPhoto
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <><Camera size={16} color="#fff" strokeWidth={2.4} /><Text style={s.heroInviteBtnText}>{t.addFirstPhoto}</Text></>}
                </LinearGradient>
              </TouchableOpacity>
            </LinearGradient>
          )}

          <LinearGradient colors={GRAD_DARK} style={s.heroOverlay} pointerEvents="none" />

          {heroPageCount > 1 && (
            <>
              {photoIdx > 0 && (
                <TouchableOpacity onPress={() => scrollToPhoto(photoIdx - 1)} style={[s.arrowBtn, { left: 12 }]}>
                  <Text style={s.arrowText}>‹</Text>
                </TouchableOpacity>
              )}
              {photoIdx < heroPageCount - 1 && (
                <TouchableOpacity onPress={() => scrollToPhoto(photoIdx + 1)} style={[s.arrowBtn, { right: 12 }]}>
                  <Text style={s.arrowText}>›</Text>
                </TouchableOpacity>
              )}
              <View style={s.pageDots}>
                {Array.from({ length: heroPageCount }).map((_, i) => (
                  <View key={i} style={[s.pageDot, i === photoIdx && s.pageDotActive]} />
                ))}
              </View>
            </>
          )}
          {photos.length > 0 && (
            <View style={s.photoCount}>
              <Text style={s.photoCountText}>{photoIdx + 1} / {heroPageCount}</Text>
            </View>
          )}
        </View>

        {/* ── ボディ ── */}
        <View style={s.body}>

          {/* タイトル + マップボタン（同一行）+ vibeバッジ */}
          <View style={s.titleBlock}>
            <View style={s.titleRow}>
              <Text style={s.title} onLongPress={() => copyPlaceName(rec.title)} suppressHighlighting>{rec.title}</Text>
              {/* マップ: buildGoogleMapsUrlは名前＋住所で動くのでURL未取得のユーザー作成スポットでも常に表示
                  （旧: displayMapUrl必須＝投稿詳細→場所詳細でボタンが消えていた・2026-07-14） */}
              {rec.title ? (
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    // 名前＋住所で検索＝店ページ(営業時間/口コミ)に着地。座標はMapsアプリのcenterヒント（全マップ導線で統一）
                    openInGoogleMaps({ query: [rec.title, rec.address].filter(Boolean).join(' '), lat: rec.lat, lng: rec.lng, mapsUri: displayMapUrl ?? undefined });
                  }}
                  activeOpacity={0.82}
                  style={s.mapPillBtn}
                >
                  <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.mapPillGrad}>
                    <MapPin size={12} color="#fff" strokeWidth={2.5} />
                    <Text style={s.mapPillText}>{t.map}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              ) : null}
            </View>
            {(rec.vibe || areaName) ? (
              <View style={s.badgeRow}>
                {rec.vibe ? (
                  <View style={s.vibeBadge}>
                    <Text style={s.vibeText}>{rec.vibe}</Text>
                  </View>
                ) : null}
                {areaName ? (
                  <View style={s.areaBadge}>
                    <MapPin size={10} color="#6B7280" strokeWidth={2.5} />
                    <Text style={s.areaText}>{areaName}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* この場所で開催中/開催予定の期間限定イベントへの導線（派生スポット「◯◯＠この場所」へ遷移） */}
          {placeEvents.length > 0 && (
            <View style={s.eventWrap}>
              {placeEvents.map((ev, i) => (
                <TouchableOpacity key={i} activeOpacity={0.85}
                  onPress={() => router.push({ pathname: '/community-spot', params: { id: ev.targetId } })}
                  accessibilityRole="button" accessibilityLabel={ev.eventName}>
                  {/* 期間限定の統一デザイン: 「期間限定の穴場」カードと同じアンバー系（2026-07-15統一） */}
                  <View style={s.eventRow}>
                    <View style={s.eventIcon}>
                      <CalendarClock size={17} color="#fff" strokeWidth={2.4} />
                    </View>
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
                    <ChevronRight size={16} color="#D97706" strokeWidth={2.4} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* ── 総合評価バー（投稿詳細ページと統一: 総合評価 / 行った!）── */}
          <View style={s.voiceBar}>
            <View style={s.voiceCell}>
              <View style={s.voiceValRow}>
                <Star size={13} color="#F59E0B" fill="#F59E0B" strokeWidth={0} />
                <Text style={s.voiceVal}>{ratingCount > 0 && avgRating != null ? avgRating.toFixed(1) : '—'}</Text>
              </View>
              <Text style={s.voiceLabel}>{ratingCount > 0 ? t.overallRatingCount(ratingCount) : t.overallRating}</Text>
            </View>
            <View style={s.voiceDivider} />
            <View style={s.voiceCell}>
              <View style={s.voiceValRow}>
                <Footprints size={13} color="#10B981" strokeWidth={2.2} />
                <Text style={s.voiceVal}>{placeVisited}</Text>
              </View>
              <Text style={s.voiceLabel}>{t.visited}</Text>
            </View>
          </View>

          {/* ── あなたの評価（総合評価バー直下＝上部に集約）── */}
          <SpotRating placeId={rec.supabaseId ?? rec.placeId} placeName={rec.title} mood={detailCtx.mood} companion={detailCtx.companion} subCategory={detailCtx.subCategory} hideAggregate onAvg={(a, c) => { setAvgRating(a); setRatingCount(c); }} />

          {/* ── データ読み込み中：スケルトン ── */}
          {!extra.loaded ? (
            <>
              <View style={s.loadingBanner}>
                <ActivityIndicator size="small" color="#C084FC" />
                <Text style={s.loadingText}>{t.loadingDetail}</Text>
              </View>
              <InfoSkeleton />
            </>
          ) : fetchError ? (
            /* ── APIエラー（リトライボタン）── 評価や住所があっても常に表示 */
            <TouchableOpacity style={s.retryBtn} onPress={() => fetchDetail()} activeOpacity={0.8}>
              <RefreshCw size={14} color="#C084FC" strokeWidth={2} />
              <Text style={s.retryText}>{t.hoursLoadFailed}</Text>
            </TouchableOpacity>
          ) : null}

          {/* Google評価バーは廃止 → MoodGo総合評価に一本化（上部の総合評価バー参照） */}

          {/* 価格帯は情報カード内（住所→金額→…の順）に移設 */}

          {/* ── 期間限定の穴場（このスポット自体に公開期間がある場合・投稿詳細と統一・終了はグレー）── */}
          {(rec.availableFrom || rec.availableUntil) ? (() => {
            const ended = !!(rec.availableUntil && String(rec.availableUntil).slice(0, 10) < new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10));   // JST基準
            const fp = (d?: string | null) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return `${y}/${m}/${dd}`; };
            const label = rec.availableFrom && rec.availableUntil
              ? `${fp(rec.availableFrom)} 〜 ${fp(rec.availableUntil)}`
              : rec.availableFrom ? `${fp(rec.availableFrom)} 〜` : `〜 ${fp(rec.availableUntil)}`;
            return (
              <View style={[s.periodCard, ended && s.periodCardEnded]}>
                <View style={[s.periodIconWrap, ended && s.periodIconWrapEnded]}>
                  {ended ? <CalendarX size={17} color="#fff" strokeWidth={2.4} /> : <CalendarClock size={17} color="#fff" strokeWidth={2.4} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.periodLabel, ended && s.periodLabelEnded]}>{ended ? t.limitedEnded : t.limitedSpot}</Text>
                  <Text style={[s.periodValue, ended && s.periodValueEnded]}>{label}</Text>
                </View>
                {ended ? <View style={s.periodEndedTag}><Text style={s.periodEndedTagText}>{t.ended}</Text></View> : null}
              </View>
            );
          })() : null}

          {/* ─── 情報カード（読み込み完了後のみ） ─── */}
          {extra.loaded && (
          <View style={s.infoCard}>
            {/* 順番: 住所 → 金額(みんなの平均/Google) → 最寄駅 → 所要 → 電話 → web → Instagram（投稿詳細と統一）。
                詳しい営業時間は下の週間テーブルに表示 */}
            {displayAddress ? (
              <View style={s.infoRow}>
                <View style={s.infoIconWrap}><MapPin size={15} color="#C084FC" strokeWidth={2} /></View>
                <Text style={s.infoText} selectable>{displayAddress}</Text>
              </View>
            ) : null}

            {inlineHours ? (
              <View style={[s.infoRow, displayAddress ? s.infoRowBorder : null]}>
                <View style={s.infoIconWrap}><Clock size={15} color="#C084FC" strokeWidth={2} /></View>
                <Text style={s.infoText}>{inlineHours}</Text>
              </View>
            ) : null}

            {priceDisplay ? (
              <View style={[s.infoRow, (displayAddress || inlineHours) ? s.infoRowBorder : null]}>
                <View style={s.infoIconWrap}><Wallet size={15} color="#C084FC" strokeWidth={2} /></View>
                <Text style={s.infoText}>{priceDisplay}</Text>
              </View>
            ) : null}

            {rec.stationText ? (
              <View style={[s.infoRow, (displayAddress || priceDisplay) ? s.infoRowBorder : null]}>
                <View style={s.infoIconWrap}><Train size={15} color="#C084FC" strokeWidth={2} /></View>
                <Text style={s.infoText}>{rec.stationText}</Text>
              </View>
            ) : null}

            {rec.distanceText ? (
              <View style={[s.infoRow, (displayAddress || priceDisplay || rec.stationText) ? s.infoRowBorder : null]}>
                <View style={s.infoIconWrap}><Navigation size={15} color="#C084FC" strokeWidth={2} /></View>
                <Text style={s.infoText}>{rec.distanceText}{rec.durationText ? `  /  ${rec.durationText}` : ''}</Text>
              </View>
            ) : null}

            {extra.phone ? (
              <TouchableOpacity
                style={[s.infoRow, (displayAddress || priceDisplay || rec.stationText || rec.distanceText) ? s.infoRowBorder : null]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Linking.openURL(`tel:${extra.phone}`); }}
                activeOpacity={0.7}
              >
                <View style={s.infoIconWrap}><Phone size={15} color="#C084FC" strokeWidth={2} /></View>
                <Text style={[s.infoText, s.infoLink]}>{extra.phone}</Text>
              </TouchableOpacity>
            ) : null}

            {extra.website ? (
              <TouchableOpacity
                style={[s.infoRow, (displayAddress || priceDisplay || rec.stationText || rec.distanceText || extra.phone) ? s.infoRowBorder : null]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Linking.openURL(extra.website!); }}
                activeOpacity={0.7}
              >
                <View style={s.infoIconWrap}><Globe size={15} color="#C084FC" strokeWidth={2} /></View>
                <Text style={[s.infoText, s.infoLink]} numberOfLines={1}>{extra.website!.replace(/^https?:\/\//, '').replace(/\/$/, '')}</Text>
              </TouchableOpacity>
            ) : null}

            {/* Instagram 検索 */}
            <TouchableOpacity
              style={[s.infoRow, (displayAddress || priceDisplay || rec.stationText || rec.distanceText || extra.phone || extra.website) ? s.infoRowBorder : null]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const tag = encodeURIComponent(rec.title.replace(/\s+/g, ''));
                Linking.openURL(`https://www.instagram.com/explore/tags/${tag}/`);
              }}
              activeOpacity={0.7}
            >
              <View style={s.infoIconWrap}><IconInstagram /></View>
              <View style={{ flex: 1 }}>
                <Text style={[s.infoText, { color: '#C13584', paddingTop: 0 }]}>{t.searchInstagram}</Text>
                <Text style={s.infoSubText}>#{rec.title.replace(/\s+/g, '')}</Text>
              </View>
            </TouchableOpacity>
          </View>
          )}

          {/* ─── 営業時間セクション（心霊は出さない）─── */}
          {!isSpooky && extra.loaded && isWeekdayHours && hoursRows.length > 0 && (
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <Clock size={15} color="#C084FC" strokeWidth={2} />
                <Text style={s.sectionTitle}>{t.openingHours}</Text>
                {openNowLabel && (
                  <View style={[s.openPillSm, { backgroundColor: openNowColor + '20', borderColor: openNowColor + '60' }]}>
                    <View style={[s.openDot, { backgroundColor: openNowColor, width: 6, height: 6 }]} />
                    <Text style={[s.openTextSm, { color: openNowColor }]}>{openNowLabel}</Text>
                  </View>
                )}
              </View>
              <View style={s.hoursTable}>
                {hoursRows.map((row, i) => (
                  <View key={i} style={[
                    s.hoursRow,
                    i % 2 === 0 && s.hoursRowEven,
                    row.isToday && s.hoursRowToday,
                  ]}>
                    <View style={s.hoursDayWrap}>
                      {row.isToday && <View style={s.todayDot} />}
                      <Text style={[s.hoursDay, row.isToday && s.hoursDayToday]}>{row.label}</Text>
                    </View>
                    <Text style={[s.hoursTime, row.isToday && s.hoursTimeToday]}>{row.time}</Text>
                  </View>
                ))}
              </View>
              {extra.checkedAt && (
                <Text style={s.hoursChecked}>{t.hoursCheckedAt(freshnessLabel(extra.checkedAt, lang))}</Text>
              )}
            </View>
          )}


          {/* ─── 口コミ（投稿詳細と統一: コメント → みんなのMoodログ[一番下]。あなたの評価は上部へ移設済み）─── */}
          {/* コメント（場所ごと。SupabaseスポットID[UUID]がある場合のみ）*/}
          {rec.supabaseId && PLACE_UUID_RE.test(rec.supabaseId) ? (
            <View style={{ marginTop: 14 }}>
              <CommentsSection targetId={rec.supabaseId} />
            </View>
          ) : null}
          {/* みんなのMoodログ（気分ベースの口コミ＝Google口コミの代用）＝一番下 */}
          <MoodLogSection placeId={rec.supabaseId ?? rec.placeId} placeName={rec.title} address={rec.address} openHours={extra.openingHoursText ?? undefined} />

        </View>
      </Animated.ScrollView>

      {/* 写真タップの全画面ビューア（投稿詳細と共通・スワイプで閉じる/サムネ/ズーム）
          ⚠常時マウント+visibleトグル（Fabricの透明Modalバグ回避・条件付きマウント禁止） */}
      <PhotoViewer visible={viewerOpen && photos.length > 0} photos={photos}
        initialIdx={Math.min(photoIdx, Math.max(0, photos.length - 1))} onClose={() => setViewerOpen(false)} />

      {/* 情報の間違い報告（場所名/営業時間/最寄り駅/住所）。[place:UUID]マーカーでadminが特定して
          🛠場所編集タブから修正できる。⚠常時マウント+visibleトグル（Fabric透明Modal安全パターン） */}
      <ReportModal
        visible={reportOpen}
        spotName={rec.title}
        spotAddress={rec.address}
        suggestionId={rec.supabaseId ? `place-${rec.supabaseId}` : undefined}
        reasons={['場所名が違う', '営業時間が違う', '最寄り駅が違う', '住所が違う', '閉店・閉業', 'その他']}
        notePlaceholder="正しい情報を教えてください（例: 営業時間は10:00〜19:00）"
        onClose={() => setReportOpen(false)}
      />

      {/* お気に入りハート（右下フローティング・投稿詳細と同様）
          未保存はグレー輪郭＋グレー数字・保存済みはピンク塗り＋ピンク数字。
          数字=この場所を保存した人数（押すと即±1で「カウントされた」ことが分かる） */}
      <TouchableOpacity onPress={toggleFav} style={[s.favFab, faved && s.favFabOn, { bottom: insets.bottom + 18 }]} activeOpacity={0.85}
        accessibilityRole="button" accessibilityState={{ selected: faved }}>
        <Heart size={22} color={faved ? '#F56CB3' : '#B9B3C8'} fill={faved ? '#F56CB3' : 'transparent'} strokeWidth={2.4} />
        <Text style={[s.favFabCount, !faved && s.favFabCountOff]}>{favCount}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── ReviewCardスタイル ────────────────────────────────────────────────────────
const rs = StyleSheet.create({
  card: {
    backgroundColor: '#FAFAFA',
    borderRadius: 14,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(192,132,252,0.1)',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 14, fontWeight: '700', color: '#fff' },
  authorInfo: { flex: 1 },
  authorName: { fontSize: 13, fontWeight: '700', color: '#111827' },
  relativeTime: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  reviewText: { fontSize: 13, color: '#374151', lineHeight: 21 },
  expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  expandText: { fontSize: 12, fontWeight: '600', color: '#C084FC' },
});

// ── メインスタイル ────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F9FB' },

  // ローディング
  loadingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(192,132,252,0.08)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.15)',
  },
  loadingText: { fontSize: 13, color: '#7C3AED', fontWeight: '500' },

  // リトライ
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(192,132,252,0.06)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.2)',
  },
  retryText: { flex: 1, fontSize: 13, color: '#7C3AED' },

  stickyHeader: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
    paddingBottom: 14, paddingHorizontal: 60,
    alignItems: 'center', justifyContent: 'flex-end',
    height: 100,
  },
  stickyTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },

  topBtns: {
    position: 'absolute', left: 0, right: 0, zIndex: 30,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16,
  },
  overlayBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },

  backBtnSolid: {
    margin: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 15, color: '#9CA3AF' },

  scroll: { flex: 1 },

  // ヒーロー
  heroWrap: { position: 'relative', height: 300 },
  // 角丸シートが下端22pxに重なるため、中央寄せの中身を少し上へ逃がす
  heroPlaceholder: { width: '100%', height: 300, alignItems: 'center', justifyContent: 'center', paddingBottom: 18 },
  // 通常スポットの「一番乗り」招待枠（絵文字は使わずlucideのCameraで統一）
  heroGenreIconWrap: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.78)', marginBottom: 6,
    shadowColor: '#7A5CFF', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
  },
  heroFirstPill:     { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.82)', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, marginTop: 2 },
  heroFirstPillText: { color: '#7C3AED', fontSize: 11.5, fontWeight: '800', letterSpacing: 0.2 },
  heroInviteTitle:   { color: '#1E1548', fontSize: 17, fontWeight: '800', marginTop: 12, letterSpacing: 0.2 },
  heroInviteSub:     { color: '#8B88A6', fontSize: 12.5, fontWeight: '600', marginTop: 5, textAlign: 'center', paddingHorizontal: 34, lineHeight: 18 },
  heroInviteBtnWrap: { marginTop: 16, borderRadius: 24, overflow: 'hidden', shadowColor: '#7A5CFF', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  heroInviteBtn:     { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 20, paddingVertical: 11 },
  heroInviteBtnText: { color: '#fff', fontSize: 14.5, fontWeight: '800', letterSpacing: 0.3 },
  heroSpookyTitle: { color: 'rgba(225,215,255,0.95)', fontSize: 16, fontWeight: '800', marginTop: 14 },
  heroSpookySub: { color: 'rgba(195,180,240,0.72)', fontSize: 13, marginTop: 5, textAlign: 'center', paddingHorizontal: 30 },
  heroSpookyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18,
    paddingHorizontal: 20, paddingVertical: 11, borderRadius: 999,
    backgroundColor: 'rgba(150,110,230,0.55)', borderWidth: 1, borderColor: 'rgba(200,180,255,0.4)',
  },
  heroSpookyBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  heroAddMini: {
    position: 'absolute', bottom: 36, left: 14, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(20,12,35,0.72)',
    borderWidth: 1, borderColor: 'rgba(200,180,255,0.35)',
  },
  heroAddMiniText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  heroOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 130 },
  arrowBtn: {
    position: 'absolute', top: '50%', marginTop: -20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center',
  },
  arrowText: { color: '#fff', fontSize: 22, fontWeight: '600' },
  pageDots: {
    // 角丸シート(22px重なり)の上に見えるよう少し上げる
    position: 'absolute', bottom: 36, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  pageDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.4)' },
  pageDotActive: { backgroundColor: '#fff', width: 16, borderRadius: 3 },
  photoCount: {
    position: 'absolute', bottom: 36, right: 14,
    backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  photoCountText: { fontSize: 11, fontWeight: '600', color: '#fff' },

  // ボディ全体: 写真に22px重ねた角丸シート（community-spot/blog詳細と同じ設計言語）
  body: {
    backgroundColor: '#F8F9FB', borderTopLeftRadius: 26, borderTopRightRadius: 26,
    marginTop: -22, paddingHorizontal: 18, paddingTop: 22, gap: 14,
  },

  // タイトルブロック
  titleBlock: { gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 26, fontWeight: '800', color: '#111827', letterSpacing: -0.5, lineHeight: 34 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  vibeBadge: {
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
    backgroundColor: 'rgba(192,132,252,0.12)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.3)',
  },
  vibeText: { fontSize: 12, fontWeight: '700', color: '#7C3AED' },
  areaBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: '#F3F4F6',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  areaText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  // マップピルボタン（タイトル横インライン）
  mapPillBtn: {
    borderRadius: 999, overflow: 'hidden',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 4,
  },
  mapPillGrad: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 11, paddingVertical: 7,
  },
  mapPillText: { fontSize: 11, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },

  // 開催中イベント導線（元スポット→派生イベント）
  eventWrap: { gap: 8, marginBottom: 14 },
  eventRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: '#FFF7ED', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 13,
    borderWidth: 1, borderColor: '#FED7AA',
  },
  eventIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F59E0B' },
  eventTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 },
  eventKicker: { fontSize: 10, fontWeight: '800', color: '#B45309', letterSpacing: 0.6 },
  eventDatePill: { backgroundColor: '#FFEDD5', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2.5 },
  eventDateText: { fontSize: 10.5, fontWeight: '800', color: '#B45309' },
  eventName: { fontSize: 15, fontWeight: '800', color: '#9A3412', letterSpacing: -0.2 },

  // 総合評価バー（投稿詳細ページと統一）
  voiceBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 16, paddingVertical: 13,
    shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 1,
  },
  voiceCell: { flex: 1, alignItems: 'center', gap: 3 },
  voiceValRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voiceVal: { fontSize: 16, fontWeight: '800', color: '#1A0A2E', letterSpacing: -0.3 },
  voiceLabel: { fontSize: 10.5, fontWeight: '600', color: '#8B88A6' },
  voiceDivider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: 'rgba(0,0,0,0.09)' },

  // 評価バー（旧Google評価・未使用）
  ratingBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 14, padding: 14,
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)',
  },
  ratingBig: { fontSize: 32, fontWeight: '800', color: '#111827', letterSpacing: -1 },
  ratingMid: { flex: 1, gap: 4 },
  ratingCount: { fontSize: 12, color: '#9CA3AF' },
  openPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1,
  },
  openPillSm: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1,
    marginLeft: 'auto' as any,
  },
  openDot: { width: 7, height: 7, borderRadius: 3.5 },
  openText: { fontSize: 12, fontWeight: '700' },
  openTextSm: { fontSize: 11, fontWeight: '700' },
  pricePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
    backgroundColor: '#F0FDF4', borderWidth: 1, borderColor: '#BBF7D0',
  },
  priceText: { fontSize: 12, fontWeight: '700', color: '#15803D' },

  // 情報カード
  // ── 期間限定の穴場カード（投稿詳細 community-spot と同一デザイン）──
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
  periodCardEnded: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  periodIconWrapEnded: { backgroundColor: '#9CA3AF' },
  periodLabelEnded: { color: '#6B7280' },
  periodValueEnded: { color: '#9CA3AF', textDecorationLine: 'line-through' },
  periodEndedTag: { backgroundColor: '#6B7280', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  periodEndedTagText: { fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  infoCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)',
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  infoRowBorder: { borderTopWidth: 1, borderTopColor: 'rgba(192,132,252,0.08)' },
  infoIconWrap: {
    width: 30, height: 30, borderRadius: 9,
    backgroundColor: 'rgba(192,132,252,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  infoText: { flex: 1, fontSize: 14, color: '#374151', lineHeight: 22, paddingTop: 4 },
  infoLink: { color: '#7C3AED' },
  infoSubText: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },

  // セクション共通
  section: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 12,
    shadowColor: '#C084FC', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.1)',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  reviewSubLabel: { fontSize: 11, color: '#9CA3AF', marginLeft: 'auto' as any },

  // 営業時間
  hoursTable: { gap: 2 },
  hoursChecked: { fontSize: 11, color: '#A78BCA', marginTop: 8, textAlign: 'right' },
  hoursRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9,
  },
  hoursRowEven: { backgroundColor: 'rgba(192,132,252,0.04)' },
  hoursRowToday: { backgroundColor: 'rgba(192,132,252,0.1)', borderWidth: 1, borderColor: 'rgba(192,132,252,0.2)' },
  hoursDayWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, width: 90 },
  todayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#C084FC' },
  hoursDay: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  hoursDayToday: { fontWeight: '700', color: '#7C3AED' },
  hoursTime: { flex: 1, fontSize: 13, color: '#374151', textAlign: 'right' },
  hoursTimeToday: { fontWeight: '700', color: '#7C3AED' },

  // このスポットについて
  descText: { fontSize: 14, color: '#4B5563', lineHeight: 22 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  tag: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999,
    backgroundColor: 'rgba(192,132,252,0.08)',
    borderWidth: 1, borderColor: 'rgba(192,132,252,0.2)',
  },
  tagText: { fontSize: 12, fontWeight: '600', color: '#7C3AED' },

  // お気に入りハート（右下フローティング）
  favFab: {
    // 未保存: グレー枠・無彩色の影（押していない状態が一目で分かるように）
    position: 'absolute', right: 18, width: 58, height: 66, borderRadius: 29,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingTop: 2,
    borderWidth: 2, borderColor: '#E7E4EE',
    shadowColor: '#1A1330', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14, shadowRadius: 10, elevation: 6,
  },
  // 保存済み: ピンク枠＋ピンクの影（塗りハートとセットで「押した」状態を明示）
  favFabOn: { borderColor: '#FCE7F3', shadowColor: '#F56CB3', shadowOpacity: 0.3 },
  favFabCount: { fontSize: 12, fontWeight: '800', color: '#F56CB3', marginTop: 1 },
  // 未保存時の数字はグレー＝みんなの合計数（自分の押下印ではない）
  favFabCountOff: { color: '#8B88A6' },
});
