/**
 * /books — Mood Book 一覧（マイBOOK）
 * プロフィールのMood Bookカード「すべて見る/＋新しいBOOK」から遷移。
 *   ・表紙2列グリッド（表紙写真はAPIが先頭ページから自動解決）
 *   ・＋新しいBOOK: タイトル入力（候補チップ）→ 投稿選択（任意）→ 作成して詳細へ
 *   ・⋯メニュー: 開く / 削除（確認つき）
 * ルーティングは既存のフラット構成（my-posts.tsx等）に合わせる。
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, Modal, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BookOpen, ChevronLeft, Plus, X } from 'lucide-react-native';
import AppBackground from '@/components/AppBackground';
import PuniPressable from '@/components/PuniPressable';
import MoodBookCoverCard from '@/components/moodbook/MoodBookCoverCard';
import PostPickerModal from '@/components/moodbook/PostPickerModal';
import { GRAD, INK, SUB, VIOLET } from '@/components/moodbook/shared';
import { useSettings } from '@/lib/settingsStore';
import {
  BOOK_TITLE_IDEAS, createBook, deleteBook, fetchOverview, loadCachedOverview,
  type MoodBookMeta,
} from '@/lib/moodBooks';

const T = {
  ja: {
    title: 'Mood Book',
    subtitle: '行った場所を、自分だけのBOOKに',
    newBook: '新しいBOOK',
    emptyTitle: 'まだBOOKがありません',
    emptySub: '最初のBOOKを作って、思い出のページを集めよう',
    create: 'BOOKを作る',
    errTitle: 'BOOKを読み込めませんでした',
    errSub: '通信環境を確認して、もう一度お試しください',
    retry: 'もう一度試す',
    // 作成モーダル
    modalTitle: '新しいBOOK',
    titleLabel: 'BOOKのタイトル',
    titlePlaceholder: '例: 2026 Summer',
    pickLabel: '投稿からページを追加（あとからでもOK）',
    pickBtn: (n: number) => (n > 0 ? `${n}件を選択中` : '投稿を選ぶ'),
    createGo: '作成する',
    creating: '作成中…',
    createFail: '作成できませんでした。時間をおいて試してください',
    menuOpen: '開く',
    menuDelete: '削除',
    deleteTitle: 'BOOKを削除しますか？',
    deleteSub: 'ページはBOOKから外れますが、元の投稿は消えません。',
    cancel: 'キャンセル',
    back: '戻る',
  },
  en: {
    title: 'Mood Book',
    subtitle: 'Your visited places, as books',
    newBook: 'New book',
    emptyTitle: 'No books yet',
    emptySub: 'Create your first book and collect memory pages',
    create: 'Create a book',
    errTitle: "Couldn't load books",
    errSub: 'Check your connection and try again',
    retry: 'Try again',
    modalTitle: 'New book',
    titleLabel: 'Book title',
    titlePlaceholder: 'e.g. 2026 Summer',
    pickLabel: 'Add pages from posts (optional)',
    pickBtn: (n: number) => (n > 0 ? `${n} selected` : 'Choose posts'),
    createGo: 'Create',
    creating: 'Creating…',
    createFail: "Couldn't create. Please try again later",
    menuOpen: 'Open',
    menuDelete: 'Delete',
    deleteTitle: 'Delete this book?',
    deleteSub: 'Pages will be removed but original posts stay.',
    cancel: 'Cancel',
    back: 'Back',
  },
} as const;

const { width: W } = Dimensions.get('window');
const SIDE = 20;
const COL_GAP = 14;
const CARD_W = Math.floor((W - SIDE * 2 - COL_GAP) / 2) - 1;

export default function BooksScreen() {
  const insets = useSafeAreaInsets();
  const { lang } = useSettings();
  const t = T[lang];
  const [books, setBooks] = useState<MoodBookMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);   // キャッシュも無く取得失敗（空状態と区別）
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    let hadCache = false;
    try {
      const cached = await loadCachedOverview();
      if (cached) { setBooks(cached.books); setLoading(false); hadCache = true; }
    } catch { /* noop */ }
    try {
      const ov = await fetchOverview();
      setBooks(ov.books);
      setFailed(false);
    } catch {
      // 通信失敗を「まだBOOKがありません」と誤表示しない（重複BOOK作成の誘発を防ぐ）
      if (!hadCache) setFailed(true);
    }
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openBook = (id: string) =>
    router.push({ pathname: '/books/[bookId]', params: { bookId: id } });

  const onMenu = (b: MoodBookMeta) => {
    Alert.alert(b.title, undefined, [
      { text: t.menuOpen, onPress: () => openBook(b.id) },
      {
        text: t.menuDelete, style: 'destructive',
        onPress: () => Alert.alert(t.deleteTitle, t.deleteSub, [
          { text: t.cancel, style: 'cancel' },
          {
            text: t.menuDelete, style: 'destructive',
            onPress: async () => {
              try { await deleteBook(b.id); } catch { /* 失敗時は次のloadで復元表示 */ }
              load();
            },
          },
        ]),
      },
      { text: t.cancel, style: 'cancel' },
    ]);
  };

  // 2列グリッド（端数誤差の折返し対策で-1px済みのCARD_W）
  const rows = useMemo(() => {
    const out: MoodBookMeta[][] = [];
    for (let i = 0; i < books.length; i += 2) out.push(books.slice(i, i + 2));
    return out;
  }, [books]);

  return (
    <View style={s.root}>
      <AppBackground />
      {/* ヘッダー（グラデ・特集詳細と同じ文法） */}
      <LinearGradient colors={['#F472B6', '#C084FC', '#60A5FA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[s.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={s.backBtn} activeOpacity={0.75} onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 16 }}
          accessibilityRole="button" accessibilityLabel={t.back}>
          <ChevronLeft size={18} color="#fff" strokeWidth={2.6} />
          <Text style={s.backText}>{t.back}</Text>
        </TouchableOpacity>
        <View style={s.headerRow}>
          <View>
            <Text style={s.headerTitle}>{t.title}</Text>
            <Text style={s.headerSub}>{t.subtitle}</Text>
          </View>
          <PuniPressable onPress={() => setShowCreate(true)} style={s.newBtn}>
            <Plus size={14} color={VIOLET} strokeWidth={2.6} />
            <Text style={s.newBtnText}>{t.newBook}</Text>
          </PuniPressable>
        </View>
      </LinearGradient>

      {loading && books.length === 0 ? (
        <View style={s.center}><ActivityIndicator color={VIOLET} size="large" /></View>
      ) : failed && books.length === 0 ? (
        <View style={s.center}>
          <BookOpen size={34} color={SUB} strokeWidth={1.5} />
          <Text style={s.emptyTitle}>{t.errTitle}</Text>
          <Text style={s.emptySub}>{t.errSub}</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85}
            onPress={() => { setFailed(false); setLoading(true); load(); }}
            accessibilityRole="button" accessibilityLabel={t.retry}>
            <Text style={s.retryText}>{t.retry}</Text>
          </TouchableOpacity>
        </View>
      ) : books.length === 0 ? (
        <View style={s.center}>
          <BookOpen size={34} color={SUB} strokeWidth={1.5} />
          <Text style={s.emptyTitle}>{t.emptyTitle}</Text>
          <Text style={s.emptySub}>{t.emptySub}</Text>
          <PuniPressable onPress={() => setShowCreate(true)} style={s.emptyBtnWrap}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.emptyBtn}>
              <BookOpen size={15} color="#fff" strokeWidth={2.2} />
              <Text style={s.emptyBtnText}>{t.create}</Text>
            </LinearGradient>
          </PuniPressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SIDE, paddingBottom: insets.bottom + 60 }}
          showsVerticalScrollIndicator={false}>
          {rows.map((row, i) => (
            <View key={i} style={s.gridRow}>
              {row.map((b) => (
                <MoodBookCoverCard key={b.id} book={b} width={CARD_W}
                  onPress={() => openBook(b.id)} onMenu={() => onMenu(b)} />
              ))}
              {row.length === 1 && <View style={{ width: CARD_W }} />}
            </View>
          ))}
        </ScrollView>
      )}

      <CreateBookModal visible={showCreate} onClose={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); load(); openBook(id); }} />
    </View>
  );
}

// ── 作成モーダル: タイトル（候補チップ）＋投稿選択（任意）→ 作成 ─────────────
function CreateBookModal({ visible, onClose, onCreated }: {
  visible: boolean; onClose: () => void; onCreated: (bookId: string) => void;
}) {
  const { lang } = useSettings();
  const t = T[lang];
  const [title, setTitle] = useState('');
  const [postIds, setPostIds] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reset = () => { setTitle(''); setPostIds([]); setErr(''); };

  const submit = async () => {
    const v = title.trim();
    if (!v || busy) return;
    setBusy(true); setErr('');
    try {
      const book = await createBook({ title: v, postIds });
      reset();
      onCreated(book.id);
    } catch {
      setErr(t.createFail);
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet"
      onRequestClose={() => { reset(); onClose(); }}>
      <View style={s.modalRoot}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>{t.modalTitle}</Text>
          <TouchableOpacity onPress={() => { reset(); onClose(); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button" accessibilityLabel={t.cancel}>
            <X size={22} color={INK} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={s.fieldLabel}>{t.titleLabel}</Text>
          <TextInput
            style={s.input} value={title} onChangeText={setTitle}
            placeholder={t.titlePlaceholder} placeholderTextColor="#B4AEC8"
            maxLength={30} returnKeyType="done"
          />
          {/* タイトル候補チップ（入力の呼び水） */}
          <View style={s.ideaRow}>
            {BOOK_TITLE_IDEAS[lang].map((idea) => (
              <TouchableOpacity key={idea} style={s.ideaChip} activeOpacity={0.8}
                onPress={() => setTitle(idea)}>
                <Text style={s.ideaChipText}>{idea}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[s.fieldLabel, { marginTop: 22 }]}>{t.pickLabel}</Text>
          <TouchableOpacity style={s.pickBtn} activeOpacity={0.8} onPress={() => setShowPicker(true)}>
            <Plus size={15} color={VIOLET} strokeWidth={2.4} />
            <Text style={s.pickBtnText}>{t.pickBtn(postIds.length)}</Text>
          </TouchableOpacity>

          {!!err && <Text style={s.errText}>{err}</Text>}
          <TouchableOpacity activeOpacity={0.85} disabled={!title.trim() || busy} onPress={submit}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[s.createBtn, (!title.trim() || busy) && { opacity: 0.45 }]}>
              {busy
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.createBtnText}>{t.createGo}</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>

        <PostPickerModal
          visible={showPicker}
          onClose={() => setShowPicker(false)}
          onSubmit={(ids) => { setPostIds(ids); setShowPicker(false); }}
          initialSelected={postIds}
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F7FA' },
  header: {
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  backText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff',
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9,
  },
  newBtnText: { fontSize: 12.5, fontWeight: '800', color: VIOLET },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 44 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: INK },
  emptySub: { fontSize: 12.5, fontWeight: '500', color: SUB, textAlign: 'center', lineHeight: 19 },
  emptyBtnWrap: { marginTop: 10, alignSelf: 'stretch', borderRadius: 999 },
  emptyBtn: {
    height: 48, borderRadius: 999, flexDirection: 'row', gap: 7,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  gridRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  retryBtn: {
    marginTop: 8, borderRadius: 999, backgroundColor: VIOLET,
    paddingHorizontal: 22, paddingVertical: 11,
  },
  retryText: { fontSize: 13.5, fontWeight: '800', color: '#fff' },

  modalRoot: { flex: 1, backgroundColor: '#F7F7FA' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: INK, letterSpacing: -0.2 },
  fieldLabel: { fontSize: 12.5, fontWeight: '800', color: SUB, marginBottom: 8 },
  input: {
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(90,90,120,0.12)',
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '700', color: INK,
  },
  ideaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  ideaChip: {
    borderRadius: 999, backgroundColor: 'rgba(139,92,246,0.08)',
    borderWidth: 1, borderColor: 'rgba(139,92,246,0.22)',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  ideaChipText: { fontSize: 12, fontWeight: '700', color: VIOLET },
  pickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(139,92,246,0.35)',
    backgroundColor: '#fff', paddingVertical: 13,
  },
  pickBtnText: { fontSize: 13.5, fontWeight: '800', color: VIOLET },
  errText: { fontSize: 11.5, fontWeight: '600', color: '#D6607F', marginTop: 12, textAlign: 'center' },
  createBtn: {
    height: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: 20,
  },
  createBtnText: { fontSize: 14.5, fontWeight: '800', color: '#fff' },
});
