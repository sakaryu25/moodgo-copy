/**
 * MoodBookSpread — Mood Book の「見開き」（左右2ページ）
 * 1ページ=1スポット。写真が主役の整理されたフォトブック表現:
 *   ・クリーム紙＋中央の綴じ目（薄いグラデ影＋ヘアライン）＋下に重なる紙の気配
 *   ・ページ構成: 日付 / 場所名 / エリア / メイン写真 / サブ写真×2 / 一言 / Moodタグ
 *   ・シール/手書き装飾は使わない（上質な旅行記・写真集のトーン）
 * ページ全体タップ→投稿詳細（呼び出し側が遷移を担当）。右ページが無い時は「余白の紙」。
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BookOpen, MapPin, Plus } from 'lucide-react-native';
import ThumbImage from '@/components/ThumbImage';
import { useSettings } from '@/lib/settingsStore';
import { fmtPageDate, type MoodBookPage } from '@/lib/moodBooks';
import { DATE_TEXT, INK, PAGE_TEXT, PAPER, PAPER_EDGE, PAPER_LINE, PH_GRAD, SUB, VIOLET } from './shared';

const T = {
  ja: {
    deleted: '元の投稿は削除されました',
    addPage: 'ページを追加',
    toBeContinued: 'つづく',
    a11yPage: (name: string) => `${name}のページを開く`,
    a11yAdd: '新しいページを追加',
  },
  en: {
    deleted: 'Original post was deleted',
    addPage: 'Add a page',
    toBeContinued: 'To be continued',
    a11yPage: (name: string) => `Open page for ${name}`,
    a11yAdd: 'Add a new page',
  },
} as const;

function PagePhoto({ uri, style, big }: { uri: string | null; style: object; big?: boolean }) {
  if (!uri) {
    return (
      <LinearGradient colors={PH_GRAD} style={[style, s.phCenter]}>
        <MapPin size={big ? 26 : 14} color="#B9AEE8" strokeWidth={1.6} />
      </LinearGradient>
    );
  }
  return <ThumbImage uri={uri} style={style} contentFit="cover" transition={200} />;
}

// 1ページ分の中身（写真1枚=大きく1枚 / 複数=メイン1＋サブ2 の自動レイアウト）
function PageInner({ page, compact }: { page: MoodBookPage; compact?: boolean }) {
  const { lang } = useSettings();
  const t = T[lang];
  const photos = page.photo_urls ?? [];
  const main = photos[0] ?? null;
  const subs = photos.slice(1, 3);
  const tags = (page.mood_tags ?? []).slice(0, compact ? 2 : 3);
  return (
    <View style={s.pageInner}>
      <Text style={s.date}>{fmtPageDate(page.date)}</Text>
      <Text style={s.title} numberOfLines={1}>{page.title || '…'}</Text>
      {!!page.area && (
        <View style={s.areaRow}>
          <MapPin size={9.5} color={SUB} strokeWidth={2.2} />
          <Text style={s.areaText} numberOfLines={1}>{page.area}</Text>
        </View>
      )}
      <PagePhoto uri={main} style={[s.mainPhoto, subs.length === 0 && s.mainPhotoTall]} big />
      {subs.length > 0 && (
        <View style={s.subRow}>
          {subs.map((u, i) => <PagePhoto key={`${u}-${i}`} uri={u} style={s.subPhoto} />)}
          {subs.length === 1 && <View style={s.subPhotoGhost} />}
        </View>
      )}
      {!!page.text && (
        <Text style={s.excerpt} numberOfLines={compact ? 2 : 3}>{page.text}</Text>
      )}
      {tags.length > 0 && (
        <View style={s.tagRow}>
          {tags.map((tag) => (
            <Text key={tag} style={s.tagText} numberOfLines={1}>
              {tag.startsWith('#') ? tag : `#${tag}`}
            </Text>
          ))}
        </View>
      )}
      {page.post_deleted && <Text style={s.deleted}>{t.deleted}</Text>}
    </View>
  );
}

// 右ページが無い時の「余白の紙」。onAdd があれば控えめな追加導線を出す
function EmptyPaper({ onAdd }: { onAdd?: () => void }) {
  const { lang } = useSettings();
  const t = T[lang];
  if (!onAdd) {
    return (
      <View style={[s.pageInner, s.emptyCenter]}>
        <BookOpen size={20} color="rgba(139,136,166,0.35)" strokeWidth={1.6} />
        <Text style={s.emptyText}>{t.toBeContinued}</Text>
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={[s.pageInner, s.emptyCenter]} activeOpacity={0.8} onPress={onAdd}
      accessibilityRole="button" accessibilityLabel={t.a11yAdd}
    >
      <View style={s.addCircle}><Plus size={16} color={VIOLET} strokeWidth={2.4} /></View>
      <Text style={s.emptyAddText}>{t.addPage}</Text>
    </TouchableOpacity>
  );
}

export default function MoodBookSpread({
  left, right, onPressPage, onAddPage, compact, minHeight,
}: {
  left?: MoodBookPage | null;
  right?: MoodBookPage | null;
  onPressPage?: (p: MoodBookPage) => void;
  onAddPage?: () => void;         // 右ページ空きに「ページを追加」を出す（詳細画面用）
  compact?: boolean;              // プロフィールプレビュー用（本文2行など）
  minHeight?: number;
}) {
  const { lang } = useSettings();
  const t = T[lang];
  const renderSide = (page: MoodBookPage | null | undefined, side: 'left' | 'right') => {
    if (!page) return <EmptyPaper onAdd={side === 'right' ? onAddPage : undefined} />;
    const inner = <PageInner page={page} compact={compact} />;
    if (!onPressPage) return inner;
    return (
      <TouchableOpacity
        activeOpacity={0.85} onPress={() => onPressPage(page)} style={{ flex: 1 }}
        accessibilityRole="button" accessibilityLabel={t.a11yPage(page.title)}
      >
        {inner}
      </TouchableOpacity>
    );
  };
  return (
    <View style={s.stackWrap}>
      {/* 下に重なるページの気配（2枚・ごく薄く） */}
      <View style={[s.paperUnder, { bottom: -3, left: 10, right: 10, opacity: 0.9 }]} />
      <View style={[s.paperUnder, { bottom: -6, left: 18, right: 18, opacity: 0.6 }]} />
      <View style={[s.book, minHeight ? { minHeight } : null]}>
        <View style={s.pageCol}>{renderSide(left, 'left')}</View>
        <View style={s.pageCol}>{renderSide(right, 'right')}</View>
        {/* 中央の綴じ目（薄いグラデ影＋ヘアライン）*/}
        <LinearGradient
          colors={['rgba(30,21,72,0)', 'rgba(30,21,72,0.05)', 'rgba(30,21,72,0.09)', 'rgba(30,21,72,0.05)', 'rgba(30,21,72,0)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={s.spine} pointerEvents="none"
        />
        <View style={s.spineLine} pointerEvents="none" />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  stackWrap: { position: 'relative' },
  paperUnder: {
    position: 'absolute', top: 8, borderRadius: 16, backgroundColor: PAPER_EDGE,
    height: '100%',
  },
  book: {
    flexDirection: 'row', borderRadius: 16, backgroundColor: PAPER,
    borderWidth: 1, borderColor: 'rgba(90,90,120,0.07)', overflow: 'hidden',
    shadowColor: '#1E1548', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07, shadowRadius: 14, elevation: 3,
  },
  pageCol: { flex: 1 },
  spine: {
    position: 'absolute', top: 0, bottom: 0, left: '50%', width: 28, marginLeft: -14,
  },
  spineLine: {
    position: 'absolute', top: 0, bottom: 0, left: '50%', width: StyleSheet.hairlineWidth,
    backgroundColor: PAPER_LINE,
  },

  pageInner: { flex: 1, padding: 13 },
  date: { fontSize: 10, fontWeight: '700', color: DATE_TEXT, letterSpacing: 0.8 },
  title: { fontSize: 14, fontWeight: '800', color: INK, letterSpacing: -0.2, marginTop: 2 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  areaText: { fontSize: 10, fontWeight: '600', color: SUB },
  mainPhoto: {
    marginTop: 8, aspectRatio: 4 / 3, borderRadius: 10, overflow: 'hidden',
    backgroundColor: '#EFEAF7',
  },
  mainPhotoTall: { aspectRatio: 1.05 },   // 写真1枚だけの投稿は大きく見せる
  phCenter: { alignItems: 'center', justifyContent: 'center' },
  subRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  subPhoto: { flex: 1, aspectRatio: 1.5, borderRadius: 8, overflow: 'hidden', backgroundColor: '#EFEAF7' },
  subPhotoGhost: { flex: 1 },
  excerpt: { marginTop: 8, fontSize: 11, fontWeight: '500', color: PAGE_TEXT, lineHeight: 16.5 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  tagText: { fontSize: 10, fontWeight: '700', color: VIOLET },
  deleted: { marginTop: 6, fontSize: 9.5, fontWeight: '600', color: '#C58A9B' },

  emptyCenter: { alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 150 },
  emptyText: { fontSize: 10.5, fontWeight: '600', color: 'rgba(139,136,166,0.45)', letterSpacing: 1 },
  addCircle: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(139,92,246,0.08)', borderWidth: 1, borderColor: 'rgba(139,92,246,0.22)',
  },
  emptyAddText: { fontSize: 11, fontWeight: '700', color: VIOLET },
});
