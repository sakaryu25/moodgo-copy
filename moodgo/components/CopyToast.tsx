import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Check } from 'lucide-react-native';
import { subscribeToast, type ToastMsg } from '@/lib/toast';

// MoodGoらしい紫グラデの自動消去トースト（OS標準Alertの置き換え）。
// ルートに1つだけマウントし、showToast() で表示する。
export default function CopyToast() {
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = subscribeToast((m) => {
      setMsg(m);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      anim.stopAnimation();
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 230, mass: 0.7 }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(anim, { toValue: 0, duration: 240, easing: Easing.in(Easing.quad), useNativeDriver: true })
          .start(({ finished }) => { if (finished) setMsg(null); });
      }, 1600);
    });
    return () => { unsub(); if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [anim]);

  if (!msg) return null;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [36, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[s.wrap, { bottom: insets.bottom + 90, opacity: anim, transform: [{ translateY }] }]}>
      <View style={s.pill}>
        <LinearGradient colors={['#A855F7', '#7C3AED']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.iconWrap}>
          <Check size={15} color="#fff" strokeWidth={3} />
        </LinearGradient>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.title}>{msg.title}</Text>
          {!!msg.subtitle && <Text style={s.sub} numberOfLines={1}>{msg.subtitle}</Text>}
        </View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 9999 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '88%',
    paddingVertical: 11, paddingLeft: 11, paddingRight: 18, borderRadius: 999,
    backgroundColor: 'rgba(28,16,46,0.97)',
    borderWidth: 1, borderColor: 'rgba(167,139,250,0.5)',
    shadowColor: '#7C3AED', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  iconWrap: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },
  sub: { color: 'rgba(214,200,250,0.88)', fontSize: 12, fontWeight: '600', marginTop: 1 },
});
