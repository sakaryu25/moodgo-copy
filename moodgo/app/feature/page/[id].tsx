// 特集詳細ページ（システムB: featured_pages_v2）。
//   特集TOP（FeatureScreen）のメイン/サブカード「特集を読む」から遷移。
//   /api/featured-pages/[id]（公開中のみ返す）から取得し、
//   FeatureScreen の MagazineFeature（ヒーロー＋スポット記事）で描画する。
import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft, MapPin } from "lucide-react-native";
import { apiFetch } from "@/lib/api";
import { MagazineFeature, type FeaturedPageV2 } from "@/components/FeatureScreen";
import { openSpot } from "@/components/FeatureScreen";

const GRAD: [string, string, string] = ["#F472B6", "#C084FC", "#60A5FA"];

export default function FeaturePageDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [page, setPage] = useState<FeaturedPageV2 | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!id) { setState("error"); return; }
    let active = true;
    apiFetch(`/api/featured-pages/${id}`)
      .then((r) => r.json())
      .then(({ ok, data }: { ok: boolean; data?: FeaturedPageV2 }) => {
        if (!active) return;
        if (ok && data) { setPage(data); setState("ok"); }
        else setState("error");
      })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [id]);

  return (
    <View style={st.root}>
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[st.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={st.backBtn} activeOpacity={0.75} onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 16 }}>
          <ChevronLeft size={18} color="#fff" strokeWidth={2.6} />
          <Text style={st.backText}>特集</Text>
        </TouchableOpacity>
        {!!page && <Text style={st.headerTitle} numberOfLines={1}>{page.scope_key || page.prefecture}エリアの特集</Text>}
      </LinearGradient>

      {state === "loading" && (
        <View style={st.center}><ActivityIndicator size="large" color="#8B5CF6" /></View>
      )}
      {state === "error" && (
        <View style={st.center}>
          <MapPin size={36} color="#9A93B5" strokeWidth={1.6} />
          <Text style={st.errTitle}>この特集は見つかりませんでした</Text>
          <Text style={st.errText}>公開が終了したか、URLが変更された可能性があります。</Text>
          <TouchableOpacity style={st.errBtn} activeOpacity={0.85} onPress={() => router.back()}>
            <Text style={st.errBtnText}>特集TOPへ戻る</Text>
          </TouchableOpacity>
        </View>
      )}
      {state === "ok" && page && (
        <ScrollView showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
          <MagazineFeature page={page} onOpenSpot={(spotId) => openSpot(router, { spotId, title: "" })} />
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F7F5FC" },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start" },
  backText: { fontSize: 14, fontWeight: "800", color: "#fff" },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#fff", marginTop: 6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40 },
  errTitle: { fontSize: 16, fontWeight: "800", color: "#2A2440", marginTop: 6 },
  errText: { fontSize: 12.5, color: "#8A82A6", textAlign: "center", lineHeight: 18 },
  errBtn: { marginTop: 14, backgroundColor: "#8B5CF6", borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  errBtnText: { fontSize: 13.5, fontWeight: "800", color: "#fff" },
});
