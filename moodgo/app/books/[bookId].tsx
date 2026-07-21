/**
 * /books/[bookId] — Mood Book 専用画面（見開きビューア）
 *   ・横スワイプ（paging）で見開きをめくる＋左右ボタン＋ページ番号
 *   ・ページタップ→元投稿の詳細（/community-spot・/blog-post）へ
 *   ・⋯メニュー: ページを追加 / タイトル変更 / 公開範囲 / ページを編集（並替・削除）/ BOOK削除
 *   ・元投稿が削除されたページはスナップショット表示（タップ遷移なし）
 * ページデータはAPIが元投稿の最新値へ自動同期して返す（lib/moodBooks.getBook）。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Modal, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowDown, ArrowUp, BookOpen, Check, ChevronLeft, ChevronRight, Eye,
  ListOrdered, MoreHorizontal, PenLine, Plus, Trash2, X,
} from 'lucide-react-native';
import AppBackground from '@/components/AppBackground';
import MoodBookSpread from '@/components/moodbook/MoodBookSpread';
import MoodBookSkeleton from '@/components/moodbook/MoodBookSkeleton';
import PostPickerModal from '@/components/moodbook/PostPickerModal';
import ThumbImage from '@/components/ThumbImage';
import { GRAD, INK, PH_GRAD, SUB, VIOLET } from '@/components/moodbook/shared';
import { useSettings } from '@/lib/settingsStore';
import {
  addPages, deleteBook, getBook, removePage, reorderPages, updateBook,
  type MoodBookMeta, type MoodBookPage,
} from '@/lib/moodBooks';
import { MapPin } from 'lucide-react-native';

const T = {
  ja: {
    back: '戻る',
    pages: (n: number) => `${n}ページ`,
    indicator: (i: number, n: number) => `${i} / ${n}`,
    indicatorRange: (a: number, b: number, n: number) => (a === b ? `${a} / ${n}` : `${a}–${b} / ${n}`),
    moveUp: '上へ',
    moveDown: '下へ',
    errTitle: 'このBOOKは見つかりませんでした',
    errSub: '削除されたか、読み込みに失敗した可能性があります。',
    retry: 'もう一度試す',
    menuAdd: 'ページを追加',
    menuRename: 'タイトルを変更',
    menuVisibility: '公開範囲',
    menuEditPages: 'ページを編集',
    menuDelete: 'BOOKを削除',
    deleteTitle: 'BOOKを削除しますか？',
    deleteSub: 'ページはBOOKから外れますが、元の投稿は消えません。',
    cancel: 'キャンセル',
    delete: '削除',
    renameTitle: 'タイトルを変更',
    save: '保存',
    visTitle: '公開範囲',
    visNote: '※ いまはまだ自分だけが見られます（共有機能は準備中）',
    visPrivate: '自分だけ',
    visFriends: '友達だけ',
    visPublic: '全体公開',
    editTitle: 'ページを編集',
    removePageTitle: 'このページを外しますか？',
    remove: '外す',
    a11yMenu: 'BOOKのメニュー',
    a11yPrev: '前の見開きへ',
    a11yNext: '次の見開きへ',
    deletedNote: '元の投稿は削除されました',
  },
  en: {
    back: 'Back',
    pages: (n: number) => `${n} pages`,
    indicator: (i: number, n: number) => `${i} / ${n}`,
    indicatorRange: (a: number, b: number, n: number) => (a === b ? `${a} / ${n}` : `${a}–${b} / ${n}`),
    moveUp: 'Move up',
    moveDown: 'Move down',
    errTitle: 'Book not found',
    errSub: 'It may have been deleted or failed to load.',
    retry: 'Try again',
    menuAdd: 'Add pages',
    menuRename: 'Rename',
    menuVisibility: 'Visibility',
    menuEditPages: 'Edit pages',
    menuDelete: 'Delete book',
    deleteTitle: 'Delete this book?',
    deleteSub: 'Pages will be removed but original posts stay.',
    cancel: 'Cancel',
    delete: 'Delete',
    renameTitle: 'Rename book',
    save: 'Save',
    visTitle: 'Visibility',
    visNote: '* Only you can see your books for now (sharing is coming)',
    visPrivate: 'Only me',
    visFriends: 'Friends',
    visPublic: 'Public',
    editTitle: 'Edit pages',
    removePageTitle: 'Remove this page?',
    remove: 'Remove',
    a11yMenu: 'Book menu',
    a11yPrev: 'Previous spread',
    a11yNext: 'Next spread',
    deletedNote: 'Original post was deleted',
  },
} as const;

const { width: W } = Dimensions.get('window');

export default function MoodBookDetail() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const insets = useSafeAreaInsets();
  const { lang } = useSettings();
  const t = T[lang];
  const [book, setBook] = useState<MoodBookMeta | null>(null);
  const [pages, setPages] = useState<MoodBookPage[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading');
  const [spreadIdx, setSpreadIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [visOpen, setVisOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const listRef = useRef<FlatList>(null);
  // ⚠ iOSはModalのdismiss進行中に次のModalをpresentすると黙って破棄される（UIKit競合）。
  //   メニューから開く次のモーダルは「積んでおいて onDismiss（閉じ終わり）で開く」。
  //   AndroidはonDismissが来ないため直接開く（presentの競合も起きない）。
  type NextModal = 'picker' | 'rename' | 'vis' | 'edit';
  const pendingModalRef = useRef<NextModal | null>(null);
  const openModal = (m: NextModal) => {
    if (m === 'picker') setPickerOpen(true);
    else if (m === 'rename') setRenameOpen(true);
    else if (m === 'vis') setVisOpen(true);
    else setEditOpen(true);
  };
  const openFromMenu = (m: NextModal) => {
    if (Platform.OS === 'ios') { pendingModalRef.current = m; setMenuOpen(false); }
    else { setMenuOpen(false); openModal(m); }
  };
  const onMenuDismissed = () => {
    const m = pendingModalRef.current;
    pendingModalRef.current = null;
    if (m) openModal(m);
  };

  const load = useCallback(async () => {
    if (!bookId) { setPhase('error'); return; }
    try {
      const d = await getBook(String(bookId), 0, 100);
      setBook(d.book);
      setPages(d.pages);
      setPhase('ok');
    } catch {
      setPhase((p) => (p === 'ok' ? 'ok' : 'error'));
    }
  }, [bookId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // 見開き = 2ページずつ。0ページのBOOKは「追加導線つきの空見開き」1枚
  const spreads = useMemo(() => {
    const out: Array<[MoodBookPage | null, MoodBookPage | null]> = [];
    for (let i = 0; i < pages.length; i += 2) out.push([pages[i] ?? null, pages[i + 1] ?? null]);
    if (out.length === 0) out.push([null, null]);
    return out;
  }, [pages]);

  // ページ削除で見開き数が減った時、現在位置を範囲内へクランプ（「3 / 2」表示を防ぐ）
  React.useEffect(() => {
    if (spreadIdx > spreads.length - 1) {
      const next = Math.max(0, spreads.length - 1);
      setSpreadIdx(next);
      listRef.current?.scrollToOffset({ offset: next * W, animated: false });
    }
  }, [spreads.length, spreadIdx]);

  const openPagePost = (page: MoodBookPage) => {
    if (page.post_deleted || !page.post_id) return;
    if (page.kind === 'blog') {
      router.push({ pathname: '/blog-post', params: { id: page.post_id.replace(/^bp-/, '') } });
      return;
    }
    router.push({ pathname: '/community-spot', params: { id: page.post_id } });
  };

  const goSpread = (i: number) => {
    const next = Math.max(0, Math.min(spreads.length - 1, i));
    listRef.current?.scrollToOffset({ offset: next * W, animated: true });
    setSpreadIdx(next);
  };

  const onDeleteBook = () => {
    setMenuOpen(false);
    Alert.alert(t.deleteTitle, t.deleteSub, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.delete, style: 'destructive',
        onPress: async () => {
          try { await deleteBook(String(bookId)); router.back(); } catch { /* noop */ }
        },
      },
    ]);
  };

  const onAddPosts = async (postIds: string[]) => {
    if (pickerBusy) return;
    setPickerBusy(true);
    try {
      await addPages(String(bookId), postIds);
      setPickerOpen(false);
      await load();
    } catch { /* 失敗時はモーダルを開いたまま */ }
    setPickerBusy(false);
  };

  return (
    <View style={s.root}>
      <AppBackground />
      {/* ── ヘッダー ── */}
      <LinearGradient colors={['#F472B6', '#C084FC', '#60A5FA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={s.headerTop}>
          <TouchableOpacity style={s.backBtn} activeOpacity={0.75} onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 16 }}
            accessibilityRole="button" accessibilityLabel={t.back}>
            <ChevronLeft size={18} color="#fff" strokeWidth={2.6} />
            <Text style={s.backText}>Mood Book</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMenuOpen(true)} style={s.menuBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button" accessibilityLabel={t.a11yMenu}>
            <MoreHorizontal size={18} color="#fff" strokeWidth={2.4} />
          </TouchableOpacity>
        </View>
        {!!book && (
          <View style={s.headerMeta}>
            <Text style={s.headerTitle} numberOfLines={1}>{book.title}</Text>
            <Text style={s.headerPages}>{t.pages(book.page_count)}</Text>
          </View>
        )}
      </LinearGradient>

      {phase === 'loading' ? (
        <View style={{ padding: 16, paddingTop: 28 }}><MoodBookSkeleton /></View>
      ) : phase === 'error' ? (
        <View style={s.center}>
          <BookOpen size={34} color={SUB} strokeWidth={1.5} />
          <Text style={s.errTitle}>{t.errTitle}</Text>
          <Text style={s.errSub}>{t.errSub}</Text>
          <TouchableOpacity style={s.retryBtn} activeOpacity={0.85}
            onPress={() => { setPhase('loading'); load(); }}>
            <Text style={s.retryText}>{t.retry}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* ── 見開きビューア（横paging）── */}
          <FlatList
            ref={listRef}
            data={spreads}
            keyExtractor={(_, i) => `spread-${i}`}
            horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setSpreadIdx(Math.round(e.nativeEvent.contentOffset.x / W))}
            renderItem={({ item }) => (
              <ScrollView style={{ width: W }} contentContainerStyle={s.spreadWrap}
                showsVerticalScrollIndicator={false}>
                <MoodBookSpread
                  left={item[0]} right={item[1]}
                  onPressPage={openPagePost}
                  onAddPage={() => setPickerOpen(true)}
                  minHeight={300}
                />
              </ScrollView>
            )}
          />
          {/* ── ページ送り（左右ボタン＋番号）── */}
          <View style={[s.navRow, { paddingBottom: insets.bottom + 18 }]}>
            <TouchableOpacity style={[s.navBtn, spreadIdx === 0 && s.navBtnDim]}
              disabled={spreadIdx === 0} onPress={() => goSpread(spreadIdx - 1)}
              accessibilityRole="button" accessibilityLabel={t.a11yPrev}>
              <ChevronLeft size={18} color={spreadIdx === 0 ? '#C9C4DB' : VIOLET} strokeWidth={2.6} />
            </TouchableOpacity>
            <Text style={s.indicator}>
              {pages.length === 0
                ? t.indicator(1, 1)
                : t.indicatorRange(spreadIdx * 2 + 1, Math.min(pages.length, spreadIdx * 2 + 2), pages.length)}
            </Text>
            <TouchableOpacity style={[s.navBtn, spreadIdx >= spreads.length - 1 && s.navBtnDim]}
              disabled={spreadIdx >= spreads.length - 1} onPress={() => goSpread(spreadIdx + 1)}
              accessibilityRole="button" accessibilityLabel={t.a11yNext}>
              <ChevronRight size={18} color={spreadIdx >= spreads.length - 1 ? '#C9C4DB' : VIOLET} strokeWidth={2.6} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── ⋯メニュー（下からのシート）。次のモーダルは閉じ終わり(onDismiss)後に開く ── */}
      <Modal visible={menuOpen} transparent animationType="fade"
        onRequestClose={() => setMenuOpen(false)} onDismiss={onMenuDismissed}>
        <TouchableOpacity style={s.sheetBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <MenuRow icon={<Plus size={17} color={VIOLET} strokeWidth={2.4} />} label={t.menuAdd}
              onPress={() => openFromMenu('picker')} />
            <MenuRow icon={<PenLine size={16} color={INK} strokeWidth={2.2} />} label={t.menuRename}
              onPress={() => openFromMenu('rename')} />
            <MenuRow icon={<Eye size={17} color={INK} strokeWidth={2.2} />} label={t.menuVisibility}
              onPress={() => openFromMenu('vis')} />
            <MenuRow icon={<ListOrdered size={17} color={INK} strokeWidth={2.2} />} label={t.menuEditPages}
              onPress={() => openFromMenu('edit')} />
            <MenuRow icon={<Trash2 size={16} color="#E5476E" strokeWidth={2.2} />} label={t.menuDelete}
              danger onPress={onDeleteBook} />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── タイトル変更 ── */}
      {book && (
        <RenameModal visible={renameOpen} initial={book.title} title={t.renameTitle} save={t.save} cancel={t.cancel}
          onClose={() => setRenameOpen(false)}
          onSave={async (v) => {
            try { const b = await updateBook(book.id, { title: v }); setBook(b); } catch { /* noop */ }
            setRenameOpen(false);
          }} />
      )}

      {/* ── 公開範囲 ── */}
      {book && (
        <Modal visible={visOpen} transparent animationType="fade" onRequestClose={() => setVisOpen(false)}>
          <TouchableOpacity style={s.sheetBackdrop} activeOpacity={1} onPress={() => setVisOpen(false)}>
            <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
              <Text style={s.sheetTitle}>{t.visTitle}</Text>
              {([['private', t.visPrivate], ['friends', t.visFriends], ['public', t.visPublic]] as const).map(([v, label]) => (
                <MenuRow key={v}
                  icon={book.visibility === v
                    ? <Check size={17} color={VIOLET} strokeWidth={2.8} />
                    : <View style={{ width: 17 }} />}
                  label={label}
                  onPress={async () => {
                    try { const b = await updateBook(book.id, { visibility: v }); setBook(b); } catch { /* noop */ }
                    setVisOpen(false);
                  }} />
              ))}
              <Text style={s.visNote}>{t.visNote}</Text>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* ── ページを編集（並替・削除）── */}
      <Modal visible={editOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditOpen(false)}>
        <View style={s.editRoot}>
          <View style={s.editHeader}>
            <Text style={s.editTitle}>{t.editTitle}</Text>
            <TouchableOpacity onPress={() => setEditOpen(false)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button" accessibilityLabel={t.cancel}>
              <X size={22} color={INK} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
            {pages.map((p, i) => (
              <View key={p.id} style={s.editRow}>
                {p.photo_urls[0] ? (
                  <ThumbImage uri={p.photo_urls[0]} style={s.editThumb} contentFit="cover" />
                ) : (
                  <LinearGradient colors={PH_GRAD} style={[s.editThumb, s.editThumbPh]}>
                    <MapPin size={14} color="#B9AEE8" strokeWidth={1.8} />
                  </LinearGradient>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.editRowTitle} numberOfLines={1}>{p.title || '…'}</Text>
                  {p.post_deleted && <Text style={s.editRowDeleted}>{t.deletedNote}</Text>}
                </View>
                <IconBtn disabled={i === 0} onPress={() => movePage(i, i - 1)} a11y={t.moveUp}>
                  <ArrowUp size={15} color={i === 0 ? '#C9C4DB' : INK} strokeWidth={2.2} />
                </IconBtn>
                <IconBtn disabled={i === pages.length - 1} onPress={() => movePage(i, i + 1)} a11y={t.moveDown}>
                  <ArrowDown size={15} color={i === pages.length - 1 ? '#C9C4DB' : INK} strokeWidth={2.2} />
                </IconBtn>
                <IconBtn onPress={() => confirmRemove(p)} a11y={t.remove}>
                  <Trash2 size={15} color="#E5476E" strokeWidth={2.2} />
                </IconBtn>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* ── ページ追加（投稿選択）── */}
      <PostPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSubmit={onAddPosts}
        submitting={pickerBusy}
        excludePostIds={pages.map((p) => p.post_id).filter(Boolean)}
      />
    </View>
  );

  // ── ページ操作（ローカル即時反映→サーバー反映。失敗は次のloadで復元）──
  function movePage(from: number, to: number) {
    if (to < 0 || to >= pages.length) return;
    const next = [...pages];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setPages(next);
    reorderPages(String(bookId), next.map((p) => p.id)).catch(() => load());
  }
  function confirmRemove(p: MoodBookPage) {
    Alert.alert(t.removePageTitle, undefined, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.remove, style: 'destructive',
        onPress: async () => {
          setPages((prev) => prev.filter((x) => x.id !== p.id));
          try {
            const n = await removePage(String(bookId), p.id);
            setBook((b) => (b ? { ...b, page_count: n } : b));
          } catch { load(); }
        },
      },
    ]);
  }
}

function MenuRow({ icon, label, onPress, danger }: {
  icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean;
}) {
  return (
    <TouchableOpacity style={s.menuRow} activeOpacity={0.75} onPress={onPress}
      accessibilityRole="button" accessibilityLabel={label}>
      {icon}
      <Text style={[s.menuRowText, danger && { color: '#E5476E' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function IconBtn({ children, onPress, disabled, a11y }: {
  children: React.ReactNode; onPress: () => void; disabled?: boolean; a11y: string;
}) {
  return (
    <TouchableOpacity style={s.iconBtn} onPress={onPress} disabled={disabled}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      accessibilityRole="button" accessibilityLabel={a11y}>
      {children}
    </TouchableOpacity>
  );
}

// タイトル変更モーダル（小さな中央カード）
function RenameModal({ visible, initial, title, save, cancel, onClose, onSave }: {
  visible: boolean; initial: string; title: string; save: string; cancel: string;
  onClose: () => void; onSave: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  React.useEffect(() => { if (visible) setV(initial); }, [visible, initial]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.dialogBackdrop}>
        <View style={s.dialog}>
          <Text style={s.dialogTitle}>{title}</Text>
          <TextInput style={s.dialogInput} value={v} onChangeText={setV} maxLength={30}
            autoFocus returnKeyType="done" onSubmitEditing={() => v.trim() && onSave(v.trim())} />
          <View style={s.dialogRow}>
            <TouchableOpacity style={s.dialogBtn} onPress={onClose}>
              <Text style={s.dialogBtnText}>{cancel}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.dialogBtn, s.dialogBtnPrimary]} disabled={!v.trim()}
              onPress={() => onSave(v.trim())}>
              <Text style={[s.dialogBtnText, { color: '#fff' }]}>{save}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F7F7FA' },
  header: {
    paddingHorizontal: 20, paddingBottom: 14,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  menuBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  headerMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8 },
  headerTitle: { fontSize: 21, fontWeight: '800', color: '#fff', letterSpacing: -0.3, flexShrink: 1 },
  headerPages: { fontSize: 11.5, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 44 },
  errTitle: { fontSize: 16, fontWeight: '800', color: INK },
  errSub: { fontSize: 12.5, fontWeight: '500', color: SUB, textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    marginTop: 8, borderRadius: 999, backgroundColor: VIOLET,
    paddingHorizontal: 22, paddingVertical: 11,
  },
  retryText: { fontSize: 13.5, fontWeight: '800', color: '#fff' },

  spreadWrap: { padding: 16, paddingTop: 24, paddingBottom: 8 },
  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18,
    paddingTop: 6,
  },
  navBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(90,90,120,0.1)',
    shadowColor: '#1E1548', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  navBtnDim: { opacity: 0.55 },
  indicator: { fontSize: 12.5, fontWeight: '800', color: SUB, letterSpacing: 0.5, minWidth: 52, textAlign: 'center' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(30,21,72,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 14,
  },
  sheetTitle: { fontSize: 14.5, fontWeight: '800', color: INK, marginBottom: 6, marginLeft: 4 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 4 },
  menuRowText: { fontSize: 14.5, fontWeight: '700', color: INK },
  visNote: { fontSize: 10.5, fontWeight: '600', color: SUB, marginTop: 6, marginLeft: 4 },

  editRoot: { flex: 1, backgroundColor: '#F7F7FA' },
  editHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
  },
  editTitle: { fontSize: 17, fontWeight: '800', color: INK, letterSpacing: -0.2 },
  editRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 16, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(90,90,120,0.08)',
  },
  editThumb: { width: 44, height: 44, borderRadius: 11, overflow: 'hidden', backgroundColor: '#EFEAF7' },
  editThumbPh: { alignItems: 'center', justifyContent: 'center' },
  editRowTitle: { fontSize: 13, fontWeight: '800', color: INK },
  editRowDeleted: { fontSize: 10, fontWeight: '600', color: '#C58A9B', marginTop: 2 },
  iconBtn: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F4F2FA',
  },

  dialogBackdrop: {
    flex: 1, backgroundColor: 'rgba(30,21,72,0.35)',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  dialog: {
    alignSelf: 'stretch', backgroundColor: '#fff', borderRadius: 20, padding: 20,
  },
  dialogTitle: { fontSize: 15, fontWeight: '800', color: INK, marginBottom: 12 },
  dialogInput: {
    backgroundColor: '#F7F6FB', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(90,90,120,0.12)',
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontWeight: '700', color: INK,
  },
  dialogRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  dialogBtn: {
    flex: 1, height: 42, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F1EFF8',
  },
  dialogBtnPrimary: { backgroundColor: VIOLET },
  dialogBtnText: { fontSize: 13.5, fontWeight: '800', color: INK },
});
