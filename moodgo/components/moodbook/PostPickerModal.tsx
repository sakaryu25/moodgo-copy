/**
 * PostPickerModal — BOOKへ入れる投稿を選ぶモーダル（作成時・ページ追加時に共用）
 * 自分の投稿(/api/my-posts・キャッシュ即表示→裏で最新化)をチェックリストで選択。
 * excludePostIds（既にBOOKにある投稿）は一覧から除外して二重追加を防ぐ。
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, MapPin, X } from 'lucide-react-native';
import ThumbImage from '@/components/ThumbImage';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { loadJSON } from '@/lib/storage';
import { useSettings } from '@/lib/settingsStore';
import { fmtFullDate } from '@/lib/moodBooks';
import { GRAD, INK, PH_GRAD, SUB } from './shared';

const T = {
  ja: {
    title: '投稿を選ぶ',
    empty: '追加できる投稿がありません',
    emptySub: '新しく投稿すると、ここからBOOKに入れられます',
    errTitle: '投稿を読み込めませんでした',
    errSub: '通信環境を確認して、もう一度お試しください',
    retry: 'もう一度試す',
    submit: (n: number) => `${n}件をBOOKに追加`,
    submitZero: '投稿を選んでください',
    close: '閉じる',
  },
  en: {
    title: 'Choose posts',
    empty: 'No posts to add',
    emptySub: 'Post a new spot to add it to your book',
    errTitle: "Couldn't load posts",
    errSub: 'Check your connection and try again',
    retry: 'Try again',
    submit: (n: number) => `Add ${n} to book`,
    submitZero: 'Select posts',
    close: 'Close',
  },
} as const;

type PickerPost = {
  id: string;
  spot_name: string;
  prefecture: string;
  image_urls: string[] | null;
  created_at: string;
};

export default function PostPickerModal({
  visible, onClose, onSubmit, excludePostIds = [], initialSelected = [], submitting = false,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (postIds: string[]) => void;
  excludePostIds?: string[];
  initialSelected?: string[];   // 再オープン時に前回の選択を復元（作成モーダル用）
  submitting?: boolean;
}) {
  const { lang } = useSettings();
  const t = T[lang];
  const [posts, setPosts] = useState<PickerPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = React.useCallback(async (): Promise<boolean> => {
    let hadCache = false;
    try {
      const cached = await loadJSON<PickerPost[]>('moodgo-my-posts-cache-v1', []);
      if (Array.isArray(cached) && cached.length > 0) { setPosts(cached); setLoading(false); hadCache = true; }
    } catch { /* noop */ }
    try {
      const deviceId = await getDeviceId();
      const d = await apiFetch('/api/my-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      }).then((r) => r.json());
      if (Array.isArray(d?.items)) { setPosts(d.items); return true; }
      return hadCache;
    } catch {
      return hadCache;   // キャッシュがあれば前回内容で続行、無ければ失敗
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setPicked(new Set(initialSelected));
    setFailed(false);
    let active = true;
    (async () => {
      setLoading(true);
      const ok = await load();
      if (!active) return;
      if (!ok) setFailed(true);
      setLoading(false);
    })();
    return () => { active = false; };
    // initialSelected は開いた瞬間の値だけ使う（毎レンダー配列が変わっても再購読しない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, load]);

  const exclude = useMemo(() => new Set(excludePostIds), [excludePostIds]);
  const selectable = useMemo(() => posts.filter((p) => !exclude.has(p.id)), [posts, exclude]);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.header}>
          <Text style={s.headerTitle}>{t.title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button" accessibilityLabel={t.close}>
            <X size={22} color={INK} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>
        {loading && selectable.length === 0 ? (
          <View style={s.center}><ActivityIndicator color="#8B5CF6" size="large" /></View>
        ) : failed && selectable.length === 0 ? (
          <View style={s.center}>
            <MapPin size={32} color={SUB} strokeWidth={1.6} />
            <Text style={s.emptyTitle}>{t.errTitle}</Text>
            <Text style={s.emptySub}>{t.errSub}</Text>
            <TouchableOpacity style={s.retryBtn} activeOpacity={0.85}
              onPress={async () => { setFailed(false); setLoading(true); const ok = await load(); if (!ok) setFailed(true); setLoading(false); }}
              accessibilityRole="button" accessibilityLabel={t.retry}>
              <Text style={s.retryText}>{t.retry}</Text>
            </TouchableOpacity>
          </View>
        ) : selectable.length === 0 ? (
          <View style={s.center}>
            <MapPin size={32} color={SUB} strokeWidth={1.6} />
            <Text style={s.emptyTitle}>{t.empty}</Text>
            <Text style={s.emptySub}>{t.emptySub}</Text>
          </View>
        ) : (
          <FlatList
            data={selectable}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
            renderItem={({ item }) => {
              const on = picked.has(item.id);
              const img = item.image_urls?.[0] ?? null;
              return (
                <Pressable style={s.row} onPress={() => toggle(item.id)}
                  accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                  accessibilityLabel={item.spot_name}>
                  {img ? (
                    <ThumbImage uri={img} style={s.thumb} contentFit="cover" />
                  ) : (
                    <LinearGradient colors={PH_GRAD} style={[s.thumb, s.thumbPh]}>
                      <MapPin size={16} color="#B9AEE8" strokeWidth={1.8} />
                    </LinearGradient>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>{item.spot_name}</Text>
                    <Text style={s.rowMeta} numberOfLines={1}>
                      {[item.prefecture, fmtFullDate(item.created_at)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={[s.checkCircle, on && s.checkCircleOn]}>
                    {on && <Check size={13} color="#fff" strokeWidth={3} />}
                  </View>
                </Pressable>
              );
            }}
          />
        )}
        {/* 決定ボタン（選択0件はディム） */}
        {selectable.length > 0 && (
          <View style={s.footer}>
            <TouchableOpacity
              activeOpacity={0.85} disabled={picked.size === 0 || submitting}
              onPress={() => onSubmit([...picked])}
              accessibilityRole="button" accessibilityLabel={t.submit(picked.size)}
            >
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={[s.submitBtn, (picked.size === 0 || submitting) && { opacity: 0.45 }]}>
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.submitText}>{picked.size === 0 ? t.submitZero : t.submit(picked.size)}</Text>}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F7FA' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: INK, letterSpacing: -0.2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 14.5, fontWeight: '800', color: INK },
  emptySub: { fontSize: 12, fontWeight: '500', color: SUB, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', borderRadius: 16, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(90,90,120,0.08)',
  },
  thumb: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden', backgroundColor: '#EFEAF7' },
  thumbPh: { alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 13.5, fontWeight: '800', color: INK },
  rowMeta: { fontSize: 11, fontWeight: '600', color: SUB, marginTop: 2 },
  checkCircle: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(139,92,246,0.4)',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  checkCircleOn: { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' },
  retryBtn: {
    marginTop: 8, borderRadius: 999, backgroundColor: '#8B5CF6',
    paddingHorizontal: 22, paddingVertical: 10,
  },
  retryText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingBottom: 34,
    backgroundColor: 'rgba(247,247,250,0.96)',
  },
  submitBtn: { height: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 14.5, fontWeight: '800', color: '#fff' },
});
