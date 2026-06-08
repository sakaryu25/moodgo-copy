/**
 * FeatureScreen.tsx
 * MoodGo — 特集タブ（現在は「Coming Soon」表示）
 *
 * ※ 以前の地図/エリア選択/特集コンテンツ実装は撤去済み。
 *   特集を再開する場合はここに改めて実装する。
 */

import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import {
  Landmark,
  type LucideIcon,
  MapPin,
  Mountain,
  Sparkles,
  Sun,
  Waves,
} from "lucide-react-native";

const GRAD: [string, string, string] = ["#F472B6", "#C084FC", "#60A5FA"];

const TEASERS: { Icon: LucideIcon; label: string }[] = [
  { Icon: Mountain, label: "絶景" },
  { Icon: Waves, label: "海・自然" },
  { Icon: Landmark, label: "歴史さんぽ" },
  { Icon: Sun, label: "季節の特集" },
];

export default function FeatureScreen() {
  const insets = useSafeAreaInsets();

  // アイコンのふわっとパルス
  const pulse = useRef(new Animated.Value(0)).current;
  // きらめきの回転
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true })
    ).start();
  }, []);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={cs.root}>
      {/* 背景グラデーション */}
      <LinearGradient colors={["#FAF7FF", "#F3ECFF", "#EAF2FF"]} style={StyleSheet.absoluteFill} />

      {/* ヘッダー */}
      <View style={[cs.header, { paddingTop: insets.top + 14 }]}>
        <Text style={cs.headerTitle}>特集</Text>
        <Text style={cs.headerSub}>Special Feature</Text>
      </View>

      <View style={cs.center}>
        {/* アイコンバッジ */}
        <View style={cs.badgeWrap}>
          <Animated.View style={[cs.glow, { opacity: glow, transform: [{ scale }] }]} />
          <Animated.View style={[cs.spark, { transform: [{ rotate }] }]} pointerEvents="none">
            <Sparkles size={20} color="#C084FC" fill="#C084FC" />
          </Animated.View>
          <Animated.View style={{ transform: [{ scale }] }}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={cs.badge}>
              <MapPin size={40} color="#fff" strokeWidth={2.2} />
            </LinearGradient>
          </Animated.View>
        </View>

        {/* テキスト */}
        <Text style={cs.comingPill}>準備中</Text>
        <Text style={cs.title}>Coming Soon</Text>
        <Text style={cs.lead}>全国のとっておき特集を{"\n"}ただいま編集中です。</Text>
        <Text style={cs.sub}>絶景・グルメ・季節のおでかけ…{"\n"}ワクワクする特集をお届けします。お楽しみに ✨</Text>

        {/* ティーザーチップ */}
        <View style={cs.teasers}>
          {TEASERS.map(({ Icon, label }) => (
            <View key={label} style={cs.teaser}>
              <Icon size={15} color="#9B6BFF" strokeWidth={2.2} />
              <Text style={cs.teaserText}>{label}</Text>
            </View>
          ))}
        </View>

        {/* 進捗バー（演出） */}
        <View style={cs.barTrack}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={cs.barFill} />
        </View>
        <Text style={cs.barLabel}>準備中… もうすぐ公開</Text>
      </View>
    </View>
  );
}

const cs = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FAF7FF" },
  header: { paddingHorizontal: 22, paddingBottom: 8 },
  headerTitle: { fontSize: 26, fontWeight: "900", color: "#1A0A2E", letterSpacing: -0.5 },
  headerSub: { fontSize: 12, color: "#9B6BFF", fontWeight: "700", letterSpacing: 1, marginTop: 2 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingBottom: 40 },

  badgeWrap: { alignItems: "center", justifyContent: "center", marginBottom: 26 },
  glow: { position: "absolute", width: 150, height: 150, borderRadius: 75, backgroundColor: "rgba(155,107,255,0.30)" },
  badge: {
    width: 104, height: 104, borderRadius: 34, alignItems: "center", justifyContent: "center",
    shadowColor: "#9B6BFF", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.4, shadowRadius: 20, elevation: 12,
  },
  spark: { position: "absolute", top: -6, right: 18 },

  comingPill: {
    fontSize: 11, fontWeight: "800", color: "#9B6BFF", letterSpacing: 2,
    backgroundColor: "rgba(155,107,255,0.12)", borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 5, overflow: "hidden", marginBottom: 12,
  },
  title: { fontSize: 34, fontWeight: "900", color: "#1A0A2E", letterSpacing: -0.5, marginBottom: 14 },
  lead: { fontSize: 17, fontWeight: "800", color: "#3A2A55", textAlign: "center", lineHeight: 26, marginBottom: 10 },
  sub: { fontSize: 13.5, color: "#7A6E8C", textAlign: "center", lineHeight: 22, marginBottom: 24 },

  teasers: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginBottom: 30 },
  teaser: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8,
    borderWidth: 1, borderColor: "rgba(155,107,255,0.18)",
    shadowColor: "#9B6BFF", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  teaserText: { fontSize: 13, fontWeight: "700", color: "#4A3A66" },

  barTrack: { width: 200, height: 7, borderRadius: 999, backgroundColor: "rgba(155,107,255,0.14)", overflow: "hidden", marginBottom: 10 },
  barFill: { width: "62%", height: "100%", borderRadius: 999 },
  barLabel: { fontSize: 12, color: "#9B6BFF", fontWeight: "700" },
});
