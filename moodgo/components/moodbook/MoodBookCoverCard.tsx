/**
 * MoodBookCoverCard — マイBOOK一覧の表紙カード
 * 表紙写真（無ければ紙色＋タイトル）＋タイトル＋作成日＋ページ数＋⋯メニュー。
 * 表紙はBOOK内の写真から自動（cover_image_url はAPI側でフォールバック解決済み）。
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BookOpen, MoreHorizontal } from 'lucide-react-native';
import ThumbImage from '@/components/ThumbImage';
import { useSettings } from '@/lib/settingsStore';
import { fmtFullDate, type MoodBookMeta } from '@/lib/moodBooks';
import { INK, PAPER, SUB } from './shared';

const T = {
  ja: { pages: (n: number) => `${n}ページ`, created: (d: string) => `${d} 作成`, a11y: (t: string) => `BOOK「${t}」を開く`, a11yMenu: (t: string) => `BOOK「${t}」のメニュー` },
  en: { pages: (n: number) => `${n} pages`, created: (d: string) => `Created ${d}`, a11y: (t: string) => `Open book "${t}"`, a11yMenu: (t: string) => `Menu for "${t}"` },
} as const;

export default function MoodBookCoverCard({
  book, width = 104, onPress, onMenu,
}: {
  book: MoodBookMeta;
  width?: number;
  onPress: () => void;
  onMenu?: () => void;
}) {
  const { lang } = useSettings();
  const t = T[lang];
  const coverH = Math.round(width * 1.24);
  return (
    <TouchableOpacity
      style={{ width }} activeOpacity={0.85} onPress={onPress}
      accessibilityRole="button" accessibilityLabel={t.a11y(book.title)}
    >
      <View style={[s.cover, { width, height: coverH }]}>
        {/* 背表紙の気配（左端の濃いライン） */}
        {book.cover_image_url ? (
          <ThumbImage uri={book.cover_image_url} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
        ) : (
          <View style={[StyleSheet.absoluteFill, s.paperCover]}>
            <BookOpen size={18} color="rgba(139,136,166,0.4)" strokeWidth={1.6} />
            <Text style={s.paperTitle} numberOfLines={2}>{book.title}</Text>
          </View>
        )}
        <LinearGradient
          colors={['rgba(30,21,72,0.16)', 'rgba(30,21,72,0)']}
          start={{ x: 0, y: 0 }} end={{ x: 0.35, y: 0 }}
          style={StyleSheet.absoluteFill} pointerEvents="none"
        />
        {onMenu && (
          <TouchableOpacity
            style={s.menuBtn} onPress={onMenu} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button" accessibilityLabel={t.a11yMenu(book.title)}
          >
            <MoreHorizontal size={14} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={s.title} numberOfLines={1}>{book.title}</Text>
      <Text style={s.meta} numberOfLines={1}>
        {t.pages(book.page_count)} · {t.created(fmtFullDate(book.created_at))}
      </Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  cover: {
    borderRadius: 12, overflow: 'hidden', backgroundColor: PAPER,
    borderWidth: 1, borderColor: 'rgba(90,90,120,0.08)',
    shadowColor: '#1E1548', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
  },
  paperCover: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 10 },
  paperTitle: { fontSize: 11.5, fontWeight: '800', color: INK, textAlign: 'center', letterSpacing: -0.2 },
  menuBtn: {
    position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(30,21,72,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  title: { marginTop: 6, fontSize: 12, fontWeight: '800', color: INK, letterSpacing: -0.2 },
  meta: { marginTop: 1, fontSize: 10, fontWeight: '600', color: SUB },
});
