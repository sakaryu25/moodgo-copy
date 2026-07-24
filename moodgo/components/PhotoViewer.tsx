// ── PhotoViewer ───────────────────────────────────────────────────────────────
// 全画面フォトビューア（検索カード/場所詳細/投稿詳細で共通・全画像拡大のUIを統一）。
// Instagram/X風の操作感:
//   ・開く: 背景フェード＋写真がふわっと拡大（スプリング）
//   ・下(上)スワイプで閉じる: 指に追従して写真が縮み背景が透けて元の画面が見える
//   ・横スワイプでページ切替、ピンチズーム、ダブルタップでズームin/out
//   ・シングルタップでクローム(閉じる/カウンター/サムネ)の表示切替
//   ・複数枚はサムネイルストリップ(下部)からジャンプ
// ⚠ Fabricの<Modal transparent>は「条件付きマウント(表示した瞬間visible=trueでマウント)」だと
//   中身を描画せずタッチだけ奪う既知バグ（ConsentGate/ReportModalで実証・c5adb7c）。
//   本コンポーネントは ReportModal と同じ「常時マウント＋visible=false始まりのトグル」で使うこと。
//   呼び出し側で {open && <PhotoViewer …/>} の条件付きマウントに変えないこと。
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Dimensions, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const THUMB = 52;          // サムネイル一辺
const THUMB_GAP = 8;
const DISMISS_DIST = 110;  // これ以上ドラッグしたら閉じる
const DISMISS_VEL = 900;   // フリック速度でも閉じる

export default function PhotoViewer({ visible, photos, initialIdx, onClose, posters, onPressPoster }: {
  visible: boolean; photos: string[]; initialIdx: number; onClose: () => void;
  /** 写真URL→投稿者（公開ハッシュ＋アイコンURL）。ある写真だけ右下にアバターを出す */
  posters?: Record<string, { id: string; icon: string }>;
  /** アバタータップ（呼び出し側でビューアを閉じて /user/[id] へ遷移する） */
  onPressPoster?: (posterId: string) => void;
}) {
  const { width: SW, height: SH } = Dimensions.get('window');
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [openSeq, setOpenSeq] = useState(0);   // 開くたびにズームページを作り直してピンチ状態をリセット

  const outerRef = useRef<ScrollView | null>(null);
  const zoomRefs = useRef<Array<ScrollView | null>>([]);
  const stripRef = useRef<ScrollView | null>(null);
  const closingRef = useRef(false);
  const chromeOnRef = useRef(true);

  // ── アニメーション値 ──────────────────────────────────────────────────────
  const backdrop  = useRef(new Animated.Value(0)).current;     // 背景の黒(0→1)
  const openScale = useRef(new Animated.Value(0.94)).current;  // 開閉時の全体スケール
  const panY      = useRef(new Animated.Value(0)).current;     // ドラッグ追従
  const chromeA   = useRef(new Animated.Value(1)).current;     // クロームの表示(0/1)

  // ドラッグ量に応じて背景・クロームを減光、写真を少し縮める（指に「ついてくる」感）
  const dragDim = panY.interpolate({ inputRange: [-280, 0, 280], outputRange: [0.35, 1, 0.35], extrapolate: 'clamp' });
  const dragShrink = panY.interpolate({ inputRange: [-320, 0, 320], outputRange: [0.86, 1, 0.86], extrapolate: 'clamp' });
  const contentScale = Animated.multiply(openScale, dragShrink);
  const backdropOpacity = Animated.multiply(backdrop, dragDim);
  const chromeOpacity = Animated.multiply(chromeA, dragDim);

  // ── 開く: 状態リセット→初期ページへ→フェード＋スプリングイン ─────────────
  useEffect(() => {
    if (!visible) return;
    closingRef.current = false;
    chromeOnRef.current = true;
    const start = Math.min(Math.max(initialIdx, 0), Math.max(0, photos.length - 1));
    setIdx(start);
    setZoomed(false);
    setOpenSeq(s => s + 1);
    panY.setValue(0);
    chromeA.setValue(1);
    backdrop.setValue(0);
    openScale.setValue(0.94);
    requestAnimationFrame(() => {
      outerRef.current?.scrollTo({ x: start * SW, y: 0, animated: false });
      Animated.parallel([
        Animated.timing(backdrop, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(openScale, { toValue: 1, tension: 170, friction: 16, useNativeDriver: true }),
      ]).start();
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── 閉じる: ドラッグ方向へ抜けながらフェードアウト→onClose ────────────────
  const close = (dir: -1 | 0 | 1) => {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(openScale, { toValue: 0.96, duration: 180, useNativeDriver: true }),
      ...(dir !== 0 ? [Animated.timing(panY, { toValue: dir * SH * 0.5, duration: 200, useNativeDriver: true })] : []),
    ]).start(() => onClose());
  };

  // ── クローム表示切替（シングルタップ）─────────────────────────────────────
  const toggleChrome = () => {
    chromeOnRef.current = !chromeOnRef.current;
    Animated.timing(chromeA, { toValue: chromeOnRef.current ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  };

  // ── ダブルタップズーム（タップ位置中心にin / 済みならout）─────────────────
  const toggleZoom = (x: number, y: number) => {
    const sv = zoomRefs.current[idx];
    if (!sv) return;
    try {
      // getScrollResponder経由のzoomTo（iOS）。使えない環境でもピンチズームは生きる。
      const resp = (sv as unknown as { getScrollResponder?: () => { scrollResponderZoomTo?: (rect: { x: number; y: number; width: number; height: number; animated: boolean }) => void } }).getScrollResponder?.();
      const zoomTo = resp?.scrollResponderZoomTo;
      if (!zoomTo) return;
      if (zoomed) zoomTo({ x: 0, y: 0, width: SW, height: SH, animated: true });
      else zoomTo({ x: x - SW / 4.4, y: y - SH / 4.4, width: SW / 2.2, height: SH / 2.2, animated: true });
    } catch { /* zoomTo未対応でもピンチで代替できる */ }
  };

  // ── ジェスチャー: 縦ドラッグで閉じる（ズーム中は無効）＋タップ類 ───────────
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(visible && !zoomed)
      .activeOffsetY([-18, 18])     // 縦に18px動いたら発火
      .failOffsetX([-14, 14])       // 横優位は横スワイプ(ページ切替)に譲る
      .runOnJS(true)
      .onUpdate(e => { panY.setValue(e.translationY); })
      .onEnd(e => {
        if (Math.abs(e.translationY) > DISMISS_DIST || Math.abs(e.velocityY) > DISMISS_VEL) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          close(e.translationY >= 0 ? 1 : -1);
        } else {
          Animated.spring(panY, { toValue: 0, tension: 200, friction: 20, useNativeDriver: true }).start();
        }
      });
    const doubleTap = Gesture.Tap().numberOfTaps(2).runOnJS(true)
      .onEnd((e, ok) => { if (ok) toggleZoom(e.x, e.y); });
    const singleTap = Gesture.Tap().numberOfTaps(1).runOnJS(true)
      .onEnd((_e, ok) => { if (ok) toggleChrome(); });
    return Gesture.Race(pan, Gesture.Exclusive(doubleTap, singleTap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, zoomed, idx, photos.length]);

  // アクティブサムネをストリップ中央へ
  useEffect(() => {
    if (photos.length > 1) {
      stripRef.current?.scrollTo({ x: Math.max(0, idx * (THUMB + THUMB_GAP) - (SW - THUMB) / 2), animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const jumpTo = (i: number) => {
    Haptics.selectionAsync().catch(() => {});
    setIdx(i);
    outerRef.current?.scrollTo({ x: i * SW, y: 0, animated: true });
  };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={() => close(0)}>
      {visible ? (
        <View style={pv.root}>
          {/* 背景: ドラッグで透けて元の画面が見える */}
          <Animated.View style={[StyleSheet.absoluteFill, pv.backdrop, { opacity: backdropOpacity }]} />

          {/* 写真本体（ドラッグ追従＋開閉スケール） */}
          <GestureDetector gesture={gesture}>
            <Animated.View style={[pv.content, { transform: [{ translateY: panY }, { scale: contentScale }] }]}>
              <ScrollView
                ref={outerRef}
                horizontal
                pagingEnabled
                bounces={false}
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={e => {
                  const i = Math.round(e.nativeEvent.contentOffset.x / SW);
                  if (i !== idx) { setIdx(i); setZoomed(false); }
                }}
              >
                {photos.map((uri, i) => (
                  <ScrollView
                    key={`${openSeq}-${i}`}
                    ref={r => { zoomRefs.current[i] = r; }}
                    style={{ width: SW, height: SH }}
                    contentContainerStyle={{ width: SW, height: SH }}
                    maximumZoomScale={3}
                    minimumZoomScale={1}
                    bouncesZoom
                    centerContent
                    showsVerticalScrollIndicator={false}
                    showsHorizontalScrollIndicator={false}
                    scrollEventThrottle={32}
                    onScroll={e => {
                      if (i === idx) {
                        const z = e.nativeEvent.zoomScale ?? 1;
                        const nowZoomed = z > 1.02;
                        if (nowZoomed !== zoomed) setZoomed(nowZoomed);
                      }
                    }}
                  >
                    <View style={{ width: SW, height: SH }}>
                      {/* 読込中スピナー（画像がフェードインして覆う）。大画像で真っ黒のままを防ぐ */}
                      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
                        <ActivityIndicator color="rgba(255,255,255,0.85)" />
                      </View>
                      <Image source={{ uri }} style={{ width: SW, height: SH }} contentFit="contain" transition={180} />
                    </View>
                  </ScrollView>
                ))}
              </ScrollView>
            </Animated.View>
          </GestureDetector>

          {/* 上部クローム: グラデ＋閉じる＋カウンター（⚠高さ明示: 高さ0だと子の絶対配置ボタンがタップ不能） */}
          <Animated.View style={[pv.topChrome, { height: insets.top + 96, opacity: chromeOpacity }]} pointerEvents="box-none">
            <LinearGradient colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0)']}
              style={[pv.topGrad, { height: insets.top + 96 }]} pointerEvents="none" />
            <View style={[pv.topRow, { top: insets.top + 8 }]} pointerEvents="box-none">
              {photos.length > 1 ? (
                <View style={pv.counter}>
                  <Text style={pv.counterText}>{idx + 1} / {photos.length}</Text>
                </View>
              ) : <View />}
              <TouchableOpacity onPress={() => close(0)} style={pv.closeBtn} activeOpacity={0.85}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={20} color="#fff" strokeWidth={2.6} />
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* 投稿者バッジ: 表示中の写真が利用者投稿なら右下にアバター（タップでプロフィールへ）。
              クロームと同じopacityで消える＝写真鑑賞の邪魔をしない */}
          {(() => {
            const poster = posters?.[photos[idx] ?? ''];
            if (!poster || !onPressPoster) return null;
            return (
              <Animated.View
                style={[pv.posterWrap, {
                  opacity: chromeOpacity,
                  bottom: insets.bottom + (photos.length > 1 ? THUMB + 34 : 24),
                }]}
                pointerEvents="box-none"
              >
                <TouchableOpacity
                  onPress={() => onPressPoster(poster.id)} activeOpacity={0.8}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button" accessibilityLabel="投稿した人のプロフィールを見る"
                >
                  <View style={pv.posterRing}>
                    <Image source={{ uri: poster.icon }} style={pv.posterImg} contentFit="cover" transition={150} />
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })()}

          {/* 下部クローム: グラデ＋サムネイルストリップ（複数枚のみ） */}
          {photos.length > 1 && (
            <Animated.View style={[pv.bottomChrome, { opacity: chromeOpacity }]} pointerEvents="box-none">
              <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.66)']}
                style={[pv.bottomGrad, { height: insets.bottom + 118 }]} pointerEvents="none" />
              <ScrollView
                ref={stripRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={[pv.strip, { bottom: insets.bottom + 16 }]}
                contentContainerStyle={{ paddingHorizontal: 16, gap: THUMB_GAP, flexGrow: 1, justifyContent: photos.length * (THUMB + THUMB_GAP) < SW ? 'center' : 'flex-start' }}
              >
                {photos.map((uri, i) => (
                  <TouchableOpacity key={`t-${i}`} onPress={() => jumpTo(i)} activeOpacity={0.8}>
                    <Image source={{ uri }} style={[pv.thumb, i === idx && pv.thumbActive]} contentFit="cover" transition={120} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Animated.View>
          )}
        </View>
      ) : null}
    </Modal>
  );
}

const pv = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { backgroundColor: '#000' },
  content: { flex: 1 },

  topChrome: { position: 'absolute', top: 0, left: 0, right: 0 },
  topGrad: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  closeBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  counter: {
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  counterText: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },

  bottomChrome: { position: 'absolute', bottom: 0, left: 0, right: 0, top: 0 },
  bottomGrad: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  strip: { position: 'absolute', left: 0, right: 0 },
  thumb: {
    width: THUMB, height: THUMB, borderRadius: 12,
    opacity: 0.55, borderWidth: 2, borderColor: 'transparent',
  },
  thumbActive: { opacity: 1, borderColor: '#fff' },

  // 投稿者バッジ（右下）。白リング＋薄影で暗い写真上でも視認できるように
  posterWrap: { position: 'absolute', right: 16 },
  posterRing: {
    width: 44, height: 44, borderRadius: 22, padding: 2,
    backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4,
  },
  posterImg: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#C9BFE8' },
});
