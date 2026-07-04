/**
 * GroupShareSheet.tsx — LINE風「送信先を選択」シート
 * shareSpotToGroup() から呼ばれ、画面下からスライドして所属グループをグリッド表示。
 * 複数選択 → 「転送」で選んだ全グループにスポットカードを一括送信。
 * _layout.tsx にマウントしてあるので、どの画面の「トーク」ボタンからでも出る。
 *
 * ⚠ New Architecture(Fabric)では <Modal transparent> の中身が描画されず、
 *   “見えないのに最前面でタッチだけ奪う”不具合が起きる（ConsentGate で実証・コミット c5adb7c）。
 *   このシートは spot をセットした瞬間に visible=true でマウントされる＝同じ発火パターンなので、
 *   Modal をやめ、_layout の最前面に置くツリー内の絶対配置オーバーレイで表示する。
 *   spot===null 時は null を返すため、閉じている間はタッチを一切ブロックしない。
 */
import { LinearGradient } from 'expo-linear-gradient';
import { Check, MapPin, MessageCircle, X } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Dimensions, Image, Pressable,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PuniPressable from '@/components/PuniPressable';
import { getDeviceId } from '@/lib/abtest';
import {
  fetchMyGroups, postSpotToGroup, registerGroupSharePresenter,
  type ShareableSpot, type ShareTargetGroup,
} from '@/lib/groupShare';

const GRAD: [string, string, string] = ['#F56CB3', '#9B6BFF', '#4FA3FF'];
const INK = '#1E0753';
const SHEET_H = Math.round(Dimensions.get('window').height * 0.62);
const isIconUrl = (icon?: string | null): icon is string => !!icon && icon.startsWith('http');

export default function GroupShareSheet() {
  const insets = useSafeAreaInsets();
  const [spot, setSpot] = useState<ShareableSpot | null>(null);
  const [groups, setGroups] = useState<ShareTargetGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const y = useRef(new Animated.Value(SHEET_H)).current;

  // shareSpotToGroup() からの呼び出しを受けてシートを開く
  useEffect(() => {
    registerGroupSharePresenter((sp) => {
      setSpot(sp); setSelected(new Set()); setGroups([]); setLoading(true); setSending(false);
      y.setValue(SHEET_H);
      Animated.spring(y, {
        toValue: 0, useNativeDriver: true, mass: 0.7, damping: 16, stiffness: 180,
      }).start();
      (async () => {
        const id = await getDeviceId();
        setGroups(await fetchMyGroups(id));
        setLoading(false);
      })();
    });
    return () => registerGroupSharePresenter(null);
  }, []);

  const close = () => {
    Animated.timing(y, { toValue: SHEET_H, duration: 180, useNativeDriver: true })
      .start(() => setSpot(null));
  };

  const toggle = (gid: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid); else next.add(gid);
      return next;
    });

  // 選んだ全グループへ一括転送
  const handleForward = async () => {
    if (!spot || selected.size === 0 || sending) return;
    setSending(true);
    try {
      const id = await getDeviceId();
      const targets = groups.filter(g => selected.has(g.id));
      const results = await Promise.all(targets.map(g => postSpotToGroup(g.id, id, spot)));
      const okNames = targets.filter((_, i) => results[i]).map(g => g.name);
      const ngNames = targets.filter((_, i) => !results[i]).map(g => g.name);
      close();
      if (okNames.length === 0) {
        Alert.alert('エラー', '転送に失敗しました。通信環境を確認してね');
      } else {
        Alert.alert(
          '転送したよ🎉',
          `「${okNames.join('」「')}」に「${spot.title}」を送りました` +
          (ngNames.length ? `\n（失敗: ${ngNames.join('・')}）` : ''),
        );
      }
    } finally { setSending(false); }
  };

  if (!spot) return null;
  const canForward = selected.size > 0 && !sending;

  return (
    <View style={s.host}>
      <View style={{ flex: 1 }}>
        <Animated.View
          style={[
            s.overlay,
            { opacity: y.interpolate({ inputRange: [0, SHEET_H], outputRange: [1, 0] }) },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        </Animated.View>

        <Animated.View
          style={[s.sheet, { maxHeight: SHEET_H + insets.bottom, transform: [{ translateY: y }] }]}
        >
          <View style={s.handle} />

          {/* ヘッダー */}
          <View style={s.header}>
            <PuniPressable onPress={close} style={s.closeBtn}>
              <X size={18} color="#7C3AED" strokeWidth={2.5} />
            </PuniPressable>
            <Text style={s.title}>送信先を選択</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* 送るスポットのプレビュー */}
          <View style={s.spotRow}>
            <MapPin size={12} color="#7C3AED" strokeWidth={2.2} />
            <Text style={s.spotText} numberOfLines={1}>{spot.title}</Text>
          </View>

          {/* グループのグリッド（4列・タップで複数選択） */}
          {loading ? (
            <ActivityIndicator color="#9B6BFF" style={{ marginVertical: 36 }} />
          ) : groups.length === 0 ? (
            <View style={s.empty}>
              <MessageCircle size={30} color="#C4B5FD" strokeWidth={1.5} />
              <Text style={s.emptyText}>まだグループがないよ{'\n'}💬タブから作るか、招待コードで参加してね</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={s.grid} showsVerticalScrollIndicator={false}>
              {groups.map(g => {
                const on = selected.has(g.id);
                return (
                  <PuniPressable
                    key={g.id}
                    onPress={() => toggle(g.id)}
                    containerStyle={s.cell}
                    style={{ alignItems: 'center' }}
                  >
                    <View style={[s.avatarWrap, on && s.avatarWrapOn]}>
                      {isIconUrl(g.icon) ? (
                        <Image source={{ uri: g.icon }} style={s.avatarImg} />
                      ) : (
                        <View style={[s.avatarImg, s.avatarPh]}>
                          <Text style={s.avatarLetter}>{g.name.slice(0, 1)}</Text>
                        </View>
                      )}
                      {on && (
                        <View style={s.checkBadge}>
                          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.checkInner}>
                            <Check size={12} color="#fff" strokeWidth={3} />
                          </LinearGradient>
                        </View>
                      )}
                    </View>
                    <Text style={[s.cellName, on && s.cellNameOn]} numberOfLines={1}>{g.name}</Text>
                  </PuniPressable>
                );
              })}
            </ScrollView>
          )}

          {/* 転送ボタン */}
          {groups.length > 0 && !loading && (
            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <PuniPressable
                onPress={handleForward}
                disabled={!canForward}
                style={[s.fwdBtn, !canForward && { opacity: 0.4 }]}
              >
                <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.fwdInner}>
                  {sending
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.fwdText}>転送{selected.size > 0 ? `（${selected.size}）` : ''}</Text>}
                </LinearGradient>
              </PuniPressable>
            </View>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // _layout の最前面に重ねるツリー内オーバーレイ（Modal を使わず Fabric でも確実に描画）
  host: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(30,7,83,0.4)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 20,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 5, borderRadius: 3,
    backgroundColor: '#E9D5FF', marginTop: 10, marginBottom: 6,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, marginBottom: 10,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F3FF',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '800', color: INK },

  spotRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'center', maxWidth: '80%',
    backgroundColor: '#F5F3FF', borderRadius: 999,
    paddingHorizontal: 12, paddingVertical: 5, marginBottom: 14,
  },
  spotText: { fontSize: 12, fontWeight: '700', color: '#7C3AED', flexShrink: 1 },

  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingHorizontal: 12, paddingBottom: 8,
  },
  cell: { width: '25%', marginBottom: 16 },
  avatarWrap: {
    width: 68, height: 68, borderRadius: 34,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: 'transparent',
  },
  avatarWrapOn: { borderColor: '#9B6BFF' },
  avatarImg: { width: 58, height: 58, borderRadius: 29 },
  avatarPh: { backgroundColor: '#EDE9FE', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 22, fontWeight: '800', color: '#7C3AED' },
  checkBadge: {
    position: 'absolute', right: 0, bottom: 0,
    width: 22, height: 22, borderRadius: 11, overflow: 'hidden',
    borderWidth: 2, borderColor: '#fff',
  },
  checkInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cellName: {
    fontSize: 11, fontWeight: '700', color: '#6B7280',
    marginTop: 6, maxWidth: 76, textAlign: 'center',
  },
  cellNameOn: { color: '#7C3AED' },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  emptyText: { fontSize: 12, color: '#A78BFA', textAlign: 'center', lineHeight: 18 },

  footer: {
    paddingHorizontal: 16, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: '#F3F0FF',
  },
  fwdBtn: { borderRadius: 999, overflow: 'hidden' },
  fwdInner: { paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  fwdText: { fontSize: 15, fontWeight: '800', color: '#fff' },
});
