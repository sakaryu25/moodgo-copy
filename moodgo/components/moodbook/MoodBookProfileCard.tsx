/**
 * MoodBookProfileCard — プロフィール「自分の投稿」を進化させた Mood Book セクション
 * MyPostsGlassCard と同じガラスシェル（blur24・角丸32・白ボーダー）で統一しつつ、
 * 中身を「見開きBOOKプレビュー」に置き換える:
 *   ・代表BOOK（最新更新）の冒頭2ページを見開き表示 → 「BOOKを開く」で専用画面へ
 *   ・マイBOOKの表紙横スクロール（2冊以上のとき）
 *   ・空状態: 投稿あり=「最初のページを作る」(全投稿から自動生成) / 投稿なし=投稿導線
 *   ・投稿一覧への導線は下部に残す（既存機能を消さない）
 * データ取得は本カードが自前で行う（フォーカス毎にキャッシュ即表示→裏で最新化）。
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import {
  BookOpen, ChevronRight, Images, PenLine, Plus, RefreshCw, Sparkles,
} from 'lucide-react-native';
import PuniPressable from '@/components/PuniPressable';
import { useSettings } from '@/lib/settingsStore';
import {
  addPages, createBook, fetchOverview, loadCachedOverview, type MoodBookOverview,
} from '@/lib/moodBooks';
import MoodBookSpread from './MoodBookSpread';
import MoodBookSkeleton from './MoodBookSkeleton';
import MoodBookCoverCard from './MoodBookCoverCard';
import { BLUE, GRAD, INK, PINK, SUB, VIOLET } from './shared';

const T = {
  ja: {
    title: 'Mood Book',
    subtitle: '行った場所を、自分だけのBOOKに残そう',
    books: (n: number) => `${n}冊`,
    pages: (n: number) => `${n}ページ`,
    openBook: 'BOOKを開く',
    newBook: '新しいBOOK',
    myBooks: 'マイBOOK',
    seePosts: '投稿一覧を見る',
    emptyTitle: 'まだBOOKにページがありません',
    emptySub: '行った場所を投稿すると、思い出が1ページずつ増えていきます。',
    makeFirst: '最初のページを作る',
    postCta: 'スポットを投稿する',
    defaultBookTitle: '思い出BOOK',
    errTitle: 'Mood Bookを読み込めませんでした',
    retry: 'もう一度試す',
    createFail: '作成できませんでした。時間をおいて試してください',
    a11ySeeAll: 'BOOK一覧を見る',
    a11yOpenBook: (t: string) => `BOOK「${t}」を開く`,
  },
  en: {
    title: 'Mood Book',
    subtitle: 'Turn places you visited into your own book',
    books: (n: number) => `${n}`,
    pages: (n: number) => `${n} pages`,
    openBook: 'Open book',
    newBook: 'New book',
    myBooks: 'My books',
    seePosts: 'See all posts',
    emptyTitle: 'No pages in your book yet',
    emptySub: 'Post the places you visit and your memories grow page by page.',
    makeFirst: 'Create the first page',
    postCta: 'Post a spot',
    defaultBookTitle: 'My Book',
    errTitle: "Couldn't load Mood Book",
    retry: 'Try again',
    createFail: "Couldn't create. Please try again later",
    a11ySeeAll: 'See all books',
    a11yOpenBook: (t: string) => `Open book "${t}"`,
  },
} as const;

// 押下で微縮小（MyPostsGlassCardと同じ挙動）
function GlassPress({ onPress, style, children, label }: {
  onPress: () => void; style?: object; children: React.ReactNode; label: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  return (
    <Pressable onPress={onPress} onPressIn={() => to(0.97)} onPressOut={() => to(1)}
      accessibilityRole="button" accessibilityLabel={label}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// ガラス面（MyPostsGlassCardと同じローカル実装）
function GlassShell({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.shadowWrap}>
      <View style={[s.shell, { overflow: 'hidden' }]}>
        <BlurView
          intensity={24} tint="light" style={StyleSheet.absoluteFill}
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : 'none'}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
        <View style={s.inner}>{children}</View>
      </View>
    </View>
  );
}

export default function MoodBookProfileCard({
  postIds, postsLoading, onOpenBook, onSeeAll, onOpenPosts, onCompose,
}: {
  postIds: string[];            // 自分の投稿ID（BOOK自動生成＋CTA分岐に使用）
  postsLoading: boolean;
  onOpenBook: (bookId: string) => void;
  onSeeAll: () => void;
  onOpenPosts: () => void;
  onCompose: () => void;
}) {
  const { lang } = useSettings();
  const t = T[lang];
  const [overview, setOverview] = useState<MoodBookOverview | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');

  const load = useCallback(async () => {
    try {
      const fresh = await fetchOverview();
      setOverview(fresh);
      setPhase('ok');
    } catch {
      // キャッシュがあれば前回の内容で表示を保つ（セクション単位のエラーに留める）
      setPhase((p) => (p === 'ok' ? 'ok' : 'error'));
    }
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      const cached = await loadCachedOverview();
      if (active && cached) { setOverview(cached); setPhase('ok'); }
      await load();
    })();
    return () => { active = false; };
  }, [load]));

  const books = overview?.books ?? [];
  // 0ページのBOOK（タイトルだけ作成/全ページ外し）は白紙見開きにせず空状態へフォールバック
  const rawPrimary = overview?.primary ?? null;
  const primary = rawPrimary && rawPrimary.pages.length > 0 ? rawPrimary : null;

  // 「最初のページを作る」= 既存投稿からページを自動生成。
  //   BOOKが既にある（0ページ）ならそのBOOKへ追加し、無ければ新規作成（重複BOOKを作らない）
  const makeFirstBook = async () => {
    if (creating) return;
    setCreating(true); setCreateErr('');
    try {
      const ids = postIds.slice(0, 60);
      if (books.length > 0) await addPages(books[0].id, ids);
      else await createBook({ title: t.defaultBookTitle, postIds: ids });
      await load();
    } catch {
      setCreateErr(t.createFail);
    } finally { setCreating(false); }
  };

  return (
    <GlassShell>
      {/* ── ヘッダー: 左=アイコン+Mood Book / 右=冊数+一覧へ ── */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <BookOpen size={16} color={PINK} strokeWidth={2.2} />
          <Text style={s.title}>{t.title}</Text>
        </View>
        {books.length > 0 && (
          <Pressable onPress={onSeeAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button" accessibilityLabel={t.a11ySeeAll} style={s.headerRight}>
            <Text style={s.count}>{t.books(books.length)}</Text>
            <ChevronRight size={18} color={SUB} strokeWidth={2.2} />
          </Pressable>
        )}
      </View>
      <Text style={s.subtitle}>{t.subtitle}</Text>

      {/* ── 本体: ローディング / エラー / 空 / 見開きプレビュー ── */}
      {phase === 'loading' || (phase === 'ok' && !overview) ? (
        <MoodBookSkeleton />
      ) : phase === 'error' ? (
        <View style={s.stateWrap}>
          <BookOpen size={22} color={BLUE} strokeWidth={1.8} />
          <Text style={s.stateTitle}>{t.errTitle}</Text>
          <PuniPressable onPress={() => { setPhase('loading'); load(); }} style={s.outlineBtn}>
            <RefreshCw size={14} color={BLUE} strokeWidth={2.4} />
            <Text style={s.outlineBtnText}>{t.retry}</Text>
          </PuniPressable>
        </View>
      ) : !primary ? (
        <View style={s.stateWrap}>
          {/* 本の輪郭だけの控えめな空イラスト */}
          <View style={s.emptyBook}>
            <View style={s.emptyBookSpine} />
            <Sparkles size={16} color="rgba(139,92,246,0.45)" strokeWidth={1.8} style={s.emptySparkle} />
          </View>
          <Text style={s.stateTitle}>{t.emptyTitle}</Text>
          <Text style={s.stateSub}>{t.emptySub}</Text>
          {postsLoading ? (
            <ActivityIndicator color={BLUE} size="small" style={{ marginTop: 4 }} />
          ) : postIds.length > 0 ? (
            <PuniPressable onPress={makeFirstBook} style={s.gradBtnWrap}>
              <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.gradBtn}>
                {creating
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <BookOpen size={15} color="#fff" strokeWidth={2.2} />}
                <Text style={s.gradBtnText}>{t.makeFirst}</Text>
              </LinearGradient>
            </PuniPressable>
          ) : (
            <PuniPressable onPress={onCompose} style={s.outlineBtn}>
              <PenLine size={14} color={BLUE} strokeWidth={2.4} />
              <Text style={s.outlineBtnText}>{t.postCta}</Text>
            </PuniPressable>
          )}
          {!!createErr && <Text style={s.createErr}>{createErr}</Text>}
        </View>
      ) : (
        <>
          {/* 代表BOOK名＋ページ数 */}
          <View style={s.bookMetaRow}>
            <Text style={s.bookTitle} numberOfLines={1}>{primary.book.title}</Text>
            <Text style={s.bookPages}>{t.pages(primary.book.page_count)}</Text>
          </View>
          <GlassPress onPress={() => onOpenBook(primary.book.id)} label={t.a11yOpenBook(primary.book.title)}>
            <MoodBookSpread
              left={primary.pages[0] ?? null}
              right={primary.pages[1] ?? null}
              compact
              minHeight={190}
            />
          </GlassPress>
          {/* 下段: ＋新しいBOOK / BOOKを開く */}
          <View style={s.actionRow}>
            <Pressable onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
              accessibilityRole="button" accessibilityLabel={t.newBook} style={s.newBookBtn}>
              <Plus size={13} color={VIOLET} strokeWidth={2.6} />
              <Text style={s.newBookText}>{t.newBook}</Text>
            </Pressable>
            <PuniPressable onPress={() => onOpenBook(primary.book.id)} style={s.openBtn}>
              <BookOpen size={14} color={VIOLET} strokeWidth={2.2} />
              <Text style={s.openBtnText}>{t.openBook}</Text>
            </PuniPressable>
          </View>
          {/* マイBOOK横スクロール（2冊以上）*/}
          {books.length >= 2 && (
            <>
              <Text style={s.myBooksLabel}>{t.myBooks}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}
                style={s.coverScroll} contentContainerStyle={s.coverRow}>
                {books.map((b) => (
                  <MoodBookCoverCard key={b.id} book={b} width={96}
                    onPress={() => onOpenBook(b.id)} />
                ))}
              </ScrollView>
            </>
          )}
        </>
      )}

      {/* ── 投稿一覧への導線（既存機能を消さない・控えめに）── */}
      {postIds.length > 0 && (
        <Pressable onPress={onOpenPosts} style={s.postsLink}
          accessibilityRole="button" accessibilityLabel={t.seePosts}>
          <Images size={13} color={SUB} strokeWidth={2.2} />
          <Text style={s.postsLinkText}>{t.seePosts}</Text>
          <ChevronRight size={14} color={SUB} strokeWidth={2.2} />
        </Pressable>
      )}
    </GlassShell>
  );
}

const s = StyleSheet.create({
  shadowWrap: {
    marginBottom: 16,
    borderRadius: 32,
    shadowColor: '#1E1548', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08, shadowRadius: 24, elevation: 4,
  },
  shell: { borderRadius: 32, borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)' },
  inner: { padding: 24 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  title: { fontSize: 15, fontWeight: '800', color: INK, letterSpacing: -0.2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  count: { fontSize: 12.5, fontWeight: '700', color: SUB },
  subtitle: { fontSize: 11.5, fontWeight: '600', color: SUB, marginTop: 3, marginBottom: 14 },

  stateWrap: { alignItems: 'center', paddingVertical: 14, gap: 6 },
  stateTitle: { fontSize: 14.5, fontWeight: '800', color: INK, marginTop: 2 },
  stateSub: { fontSize: 12, fontWeight: '500', color: SUB, textAlign: 'center', lineHeight: 18 },
  emptyBook: {
    width: 74, height: 52, borderRadius: 10, backgroundColor: '#FDFBF6',
    borderWidth: 1.5, borderColor: 'rgba(139,92,246,0.28)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  emptyBookSpine: {
    position: 'absolute', top: 5, bottom: 5, left: '50%', width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(139,92,246,0.3)',
  },
  emptySparkle: { position: 'absolute', top: -6, right: -8 },
  gradBtnWrap: {
    marginTop: 8, alignSelf: 'stretch', borderRadius: 999,
    shadowColor: PINK, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 14, elevation: 4,
  },
  gradBtn: {
    height: 44, borderRadius: 999, flexDirection: 'row', gap: 7,
    alignItems: 'center', justifyContent: 'center',
  },
  gradBtnText: { fontSize: 13.5, fontWeight: '800', color: '#fff' },
  outlineBtn: {
    marginTop: 8, alignSelf: 'stretch', borderRadius: 999, flexDirection: 'row', gap: 6,
    alignItems: 'center', justifyContent: 'center', paddingVertical: 11,
    borderWidth: 1.5, borderColor: 'rgba(90,141,255,0.45)', backgroundColor: '#fff',
  },
  outlineBtnText: { fontSize: 13.5, fontWeight: '800', color: BLUE },
  createErr: { fontSize: 11, fontWeight: '600', color: '#D6607F', marginTop: 4 },

  bookMetaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 },
  bookTitle: { fontSize: 13.5, fontWeight: '800', color: INK, letterSpacing: -0.2, flexShrink: 1 },
  bookPages: { fontSize: 10.5, fontWeight: '700', color: SUB },

  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 },
  newBookBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  newBookText: { fontSize: 12.5, fontWeight: '800', color: VIOLET },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999,
    paddingHorizontal: 18, paddingVertical: 10, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: 'rgba(139,92,246,0.45)',
  },
  openBtnText: { fontSize: 12.5, fontWeight: '800', color: VIOLET },

  myBooksLabel: { fontSize: 11.5, fontWeight: '800', color: SUB, marginTop: 16, marginBottom: 8, letterSpacing: 0.2 },
  coverScroll: { marginHorizontal: -24 },
  coverRow: { paddingHorizontal: 24, gap: 12 },

  postsLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    marginTop: 16, paddingVertical: 4,
  },
  postsLinkText: { fontSize: 11.5, fontWeight: '700', color: SUB },
});
