// AppActionSheet — アプリ共通のアクションシート／確認ダイアログ。
//   iOS標準の Alert.alert（未ブランドの灰色ダイアログ）の置き換え。下から競り上がるボトムシートで、
//   タイトル＋任意メッセージ＋オプション群＋キャンセルを表示する。メニューにも確認にも使える。
//   2026-07-21: アプリのグラデ世界観に寄せるため gradientHeader / option.icon / option.primary を追加（全て任意・後方互換）。
//
// ⚠ Modalは使わず「絶対配置オーバーレイ＋pointerEventsトグル」で実装（post.tsxのピッカーと同方式）。
//   → Fabricの透明Modalバグを回避でき、pageSheet Modal(SettingsView等)の中に置いても安全に重なる。
//   呼び出し側は画面ルート直下（フルスクリーンの祖先）に常時描画する: `<AppActionSheet visible={x} .../>`。
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// アプリのホームGRAD（ピンク→紫→青）。colors.ts には無いため各所と同値をローカル定義。
const GRAD = ['#F56CB3', '#9B6BFF', '#4FA3FF'] as const;

export type SheetOption = {
  label: string;
  onPress: () => void;
  destructive?: boolean;   // 赤字（削除など）
  disabled?: boolean;
  icon?: React.ReactNode;  // 左に表示する lucide アイコン等（任意）
  primary?: boolean;       // グラデ塗りの主アクション（任意）
};

export default function AppActionSheet({
  visible, title, message, options, cancelLabel, onClose, gradientHeader,
}: {
  visible: boolean;
  title?: string;
  message?: string;
  options: SheetOption[];
  cancelLabel?: string;
  onClose: () => void;
  gradientHeader?: boolean;   // タイトル帯をアプリのグラデにする（任意）
}) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;   // 0=閉じ / 1=開き
  useEffect(() => {
    if (visible) Haptics.selectionAsync().catch(() => {});
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 240 : 170,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [60, 0] });

  // 選択時: 先にシートを閉じてからアクションを実行（別シート/遷移が重ならないよう2フレーム待つ）
  const pick = (fn: () => void) => { onClose(); requestAnimationFrame(() => requestAnimationFrame(fn)); };
  const hasHead = !!(title || message);
  const hasIcons = options.some((o) => !!o.icon);

  const Head = hasHead ? (
    gradientHeader ? (
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.headGrad}>
        {title ? <Text style={s.titleOnGrad}>{title}</Text> : null}
        {message ? <Text style={s.messageOnGrad}>{message}</Text> : null}
      </LinearGradient>
    ) : (
      <View style={s.head}>
        {title ? <Text style={s.title}>{title}</Text> : null}
        {message ? <Text style={s.message}>{message}</Text> : null}
      </View>
    )
  ) : null;

  // 常時描画。閉じている間は pointerEvents='none' で下の操作を奪わない（opacityは0で不可視）。
  return (
    <View style={[StyleSheet.absoluteFill, s.root]} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, s.backdrop, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="閉じる" />
      </Animated.View>
      <Animated.View style={[s.wrap, { paddingBottom: insets.bottom + 10, opacity: anim, transform: [{ translateY }] }]}>
        <View style={s.card}>
          {Head}
          {options.map((o, i) => {
            const rowStyle = [
              s.opt,
              (i > 0 || hasHead) && s.optBorder,
              (hasIcons || !!o.icon) && s.optRow,
              o.disabled ? { opacity: 0.4 } : null,
            ];
            const inner = (
              <>
                {o.icon ? <View style={s.optIcon}>{o.icon}</View> : (hasIcons ? <View style={s.optIcon} /> : null)}
                <Text style={[s.optText, o.primary ? s.optTextPrimary : (o.destructive && s.optDanger)]}>{o.label}</Text>
              </>
            );
            if (o.primary) {
              return (
                <TouchableOpacity key={i} activeOpacity={0.8} disabled={o.disabled}
                  onPress={() => pick(o.onPress)} accessibilityRole="button" accessibilityLabel={o.label}>
                  <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.opt, s.optRow, s.optPrimary]}>
                    {inner}
                  </LinearGradient>
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity key={i} activeOpacity={0.55} disabled={o.disabled}
                onPress={() => pick(o.onPress)} style={rowStyle}
                accessibilityRole="button" accessibilityLabel={o.label}>
                {inner}
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={s.cancel} accessibilityRole="button">
          <Text style={s.cancelText}>{cancelLabel ?? 'キャンセル'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const CARD_SHADOW = {
  shadowColor: '#1A0A2E', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 20, elevation: 8,
};

const s = StyleSheet.create({
  root: { justifyContent: 'flex-end', zIndex: 1000, elevation: 1000 },
  backdrop: { backgroundColor: 'rgba(20,12,40,0.38)' },
  wrap: { paddingHorizontal: 10 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, overflow: 'hidden', ...CARD_SHADOW },
  head: { paddingVertical: 16, paddingHorizontal: 18, alignItems: 'center' },
  headGrad: { paddingVertical: 17, paddingHorizontal: 18, alignItems: 'center' },
  title: { fontSize: 15.5, fontWeight: '800', color: '#1A0A2E', textAlign: 'center', letterSpacing: -0.2 },
  message: { fontSize: 12.5, color: '#8B85A0', marginTop: 5, textAlign: 'center', lineHeight: 18 },
  titleOnGrad: { fontSize: 16, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', letterSpacing: -0.2 },
  messageOnGrad: { fontSize: 12.5, color: 'rgba(255,255,255,0.92)', marginTop: 5, textAlign: 'center', lineHeight: 18 },
  opt: { paddingVertical: 16, alignItems: 'center' },
  optRow: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 16 },
  optIcon: { width: 26, alignItems: 'center', marginRight: 8 },
  optBorder: { borderTopWidth: 1, borderTopColor: '#F0ECF8' },
  optPrimary: { borderTopWidth: 0 },
  optText: { fontSize: 16.5, fontWeight: '700', color: '#3B2A63' },
  optTextPrimary: { color: '#FFFFFF', fontWeight: '800' },
  optDanger: { color: '#EF4444' },
  cancel: { marginTop: 8, backgroundColor: '#FFFFFF', borderRadius: 20, paddingVertical: 16, alignItems: 'center', ...CARD_SHADOW },
  cancelText: { fontSize: 16.5, fontWeight: '800', color: '#1A0A2E' },
});
