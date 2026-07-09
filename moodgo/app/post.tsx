// ── app/post.tsx ──────────────────────────────────────────────────────────────
// 統一投稿画面（Phase2）。穴場・moodログ・ブログを1つのフォームに集約。
//   - 既存スポット(placeId param あり／検索で選択)→ /api/spot-posts（moodログ＝場所への口コミ）
//   - 新スポット(名前を入力)→ /api/suggestions（穴場＝運営が審査して掲載）
// どちらもユーザーから見れば「投稿する」1つだけ。裏のテーブルは触らず分岐するだけ＝安全。
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Calendar, Camera, Check, MapPin, Search, Send, Star, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import AppBackground, { APP_BG } from '@/components/AppBackground';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { findNgWord } from '@/lib/ngwords';
import { showToast } from '@/lib/toast';
import { markFeedStale } from '@/lib/feedRefresh';
import { DEEP_DIVE } from '@/components/QuizFlow';
import { useSettings } from '@/lib/settingsStore';

// 画面の表示文言（値・キーは含めない＝MOODS/PRICE_CHIPS/タグ等は翻訳しない）
const T = {
  ja: {
    editTitle: '投稿を編集',
    postTitle: 'みんなの穴場に投稿',
    doneEditTitle: '更新しました',
    donePostTitle: '投稿しました',
    doneEditSub: '編集内容を保存しました。反映まで少し時間がかかることがあります。',
    doneExistingSub: 'ありがとうございます！あなたの投稿は「全国みんなの穴場」とスポットのページにすぐ表示されます。',
    doneNewSub: 'ありがとうございます！あなたの投稿は「全国みんなの穴場」にすぐ表示されます。',
    close: '閉じる',
    leadText: 'あなたが知っている素敵な場所を投稿しよう。\n掲載された場合は特典をプレゼント予定です🎁',
    spotNameLabel: 'スポット名 ',
    change: '変更',
    spotNamePh: '例：海が見える穴場カフェ',
    dupHint: '同じ名前のスポットが見つかりました。タップで選ぶと、その場所への投稿になります👇',
    newSpotHint: (name: string) => `一覧に無ければ、このまま「${name}」を新しいスポットとして登録できます`,
    captionLabel: 'どんな場所？おすすめポイント ',
    captionPh: 'どんな場所？何が良い？雰囲気やおすすめポイントを自由に',
    moodLabel: '合う気分 ',
    moodLabelSuffix: '（1つ以上）',
    autoTagPre: '🏷 この投稿には ',
    autoTagMid: ' と ',
    autoTagPost: ' が自動で付きます',
    genreLabel: '詳しいジャンル（任意・当てはまるものをタップ）',
    priceLabel: '目安の値段（任意）',
    priceHint: '1人あたりの大体の金額',
    priceNotePh: '詳細があれば（例: ランチ800円、ディナー2,000円〜）',
    periodLabel: '公開期間（任意）',
    periodHint: '期間限定スポットの場合に設定。空欄なら常時公開です。',
    dateFrom: '開始日',
    dateUntil: '終了日',
    ratingLabel: 'おすすめ度（任意）',
    addrLabel: '場所・住所 ',
    addrPh: '住所・エリア名を入力（例: 神奈川県横浜市…）',
    locating: '取得中',
    locate: '現在地',
    gotLoc: (addr: string) => `📍 位置を取得しました${addr ? `（${addr}）` : ''}`,
    openingHoursPh: '営業時間（任意・例: 11:00〜22:00、月曜休）',
    stationPh: '最寄駅（任意・例: JR横浜駅 徒歩5分）',
    editNote: '※ 写真の変更はできません。名前・紹介文・気分タグ・公開範囲・おすすめ度・値段・連絡先を編集できます。',
    photoLabel: '写真（1〜3枚・必須）',
    photoHint: '駐車場の看板、穴場の建物、景色など。雰囲気が伝わる写真を！',
    addPhoto: '追加',
    contactLabel: '連絡先（任意）',
    contactHint: '掲載された場合に特典をお送りするため、LINEのIDやメールアドレスを教えていただけると助かります。',
    contactPh: '例: @line_id / example@email.com',
    visLabel: '公開のしかた',
    visPublicLabel: '名前を出して公開する',
    visPublic: '名前を出して公開',
    visAnonLabel: '匿名で公開する',
    visAnon: '匿名で公開',
    visNoteAnon: '投稿者名は表示されず、あなたのプロフィールにも表示されません。',
    visNotePublic: 'ニックネームと@IDが投稿に表示され、プロフィールの投稿一覧に載ります。',
    visPrivate: '非公開',
    visPrivateLabel: '自分だけが見られる非公開にする',
    visNotePrivate: '自分だけが見られます。みんなの穴場フィードには表示されません。',
    licenseText: '自分で撮影した、または使用許可のある写真・内容です（必須）',
    licenseNote: '※ Google画像・Googleマップ・SNS等から保存した画像の投稿は禁止です。',
    sending: '送信中…',
    updateBtn: '更新する',
    postBtn: '投稿する',
    pickerFromTitle: '公開を始める日',
    pickerUntilTitle: '公開を終える日',
    cancel: 'キャンセル',
    pickerOk: 'この日にする',
    // トースト（タイトル・本文）
    tCannotEditTitle: '編集できません',
    tCannotEditSub: 'この投稿は編集できません',
    tLoadFailTitle: '読み込みに失敗しました',
    tNetworkSub: '通信環境を確認してください',
    tCaptionTitle: '紹介文を入力してください',
    tCaptionSub: 'どんな場所？何が良い？を一言でも',
    tMoodTitle: '気分タグを選んでください',
    tMoodSub: '合う気分を1つ以上タップ',
    tNgTitle: '不適切な表現があります',
    tNgSub: '内容を見直してください',
    tUpdateFailTitle: '更新できませんでした',
    tRetrySub: 'しばらくして再度お試しください',
    tUpdateFailSub2Title: '更新に失敗しました',
    tSpotNameTitle: 'スポット名を入力してください',
    tSpotNameSub: '例: 海が見える穴場カフェ',
    tPlaceTitle: '場所を教えてください',
    tPlaceSub: '「現在地」タップ or 住所・エリアを入力',
    tPhotoTitle: '写真を1枚以上追加してください',
    tPhotoSub: '雰囲気が伝わる写真が投稿の主役です（最大3枚）',
    tLicenseTitle: '権利確認が必要です',
    tLicenseSub: '「自分で撮影／使用許可あり」にチェック',
    tPostFailTitle: '投稿できませんでした',
    tPostFailSub2Title: '投稿に失敗しました',
    tPostFailSub2: '通信環境を確認して再度お試しください',
    // 写真アクセス許可
    aPhotoTitle: '写真へのアクセスが必要です',
    aPhotoMsg: '設定 → MoodGo → 写真 で許可してください。',
    aOpenSettings: '設定を開く',
    aErrorTitle: 'エラー',
    aPhotoPickFail: '写真の選択に失敗しました。',
    tLocPermTitle: '位置情報の許可が必要です',
    tLocPermSub: '設定アプリ → MoodGo → 位置情報 で許可してください',
  },
  en: {
    editTitle: 'Edit post',
    postTitle: 'Share a hidden gem',
    doneEditTitle: 'Updated',
    donePostTitle: 'Posted',
    doneEditSub: 'Your changes have been saved. It may take a little while to appear.',
    doneExistingSub: 'Thank you! Your post will appear right away in "Hidden gems nationwide" and on the spot\'s page.',
    doneNewSub: 'Thank you! Your post will appear right away in "Hidden gems nationwide".',
    close: 'Close',
    leadText: 'Share a great place you know.\nWe plan to send a reward if it gets featured 🎁',
    spotNameLabel: 'Spot name ',
    change: 'Change',
    spotNamePh: 'e.g. Hidden café with a sea view',
    dupHint: 'We found spots with the same name. Tap one to post about that place 👇',
    newSpotHint: (name: string) => `If it's not in the list, you can register "${name}" as a new spot`,
    captionLabel: 'What kind of place? What makes it great ',
    captionPh: 'What kind of place is it? What\'s good about it? Share the vibe and highlights',
    moodLabel: 'Matching moods ',
    moodLabelSuffix: ' (pick 1 or more)',
    autoTagPre: '🏷 This post is automatically tagged ',
    autoTagMid: ' and ',
    autoTagPost: '',
    genreLabel: 'More detail (optional — tap any that fit)',
    priceLabel: 'Approximate price (optional)',
    priceHint: 'Rough cost per person',
    priceNotePh: 'Add details if any (e.g. lunch ¥800, dinner from ¥2,000)',
    periodLabel: 'Availability period (optional)',
    periodHint: 'Set this for limited-time spots. Leave blank for always available.',
    dateFrom: 'Start date',
    dateUntil: 'End date',
    ratingLabel: 'Rating (optional)',
    addrLabel: 'Location / address ',
    addrPh: 'Enter address or area (e.g. Yokohama, Kanagawa…)',
    locating: 'Locating',
    locate: 'Current location',
    gotLoc: (addr: string) => `📍 Location captured${addr ? ` (${addr})` : ''}`,
    openingHoursPh: 'Hours (optional — e.g. 11:00–22:00, closed Mon)',
    stationPh: 'Nearest station (optional — e.g. 5 min walk from JR Yokohama)',
    editNote: '※ Photos can\'t be changed. You can edit the name, text, mood tags, visibility, rating, price and contact.',
    photoLabel: 'Photos (1–3, required)',
    photoHint: 'Parking signs, the building, the scenery — photos that convey the vibe!',
    addPhoto: 'Add',
    contactLabel: 'Contact (optional)',
    contactHint: 'So we can send a reward if your post gets featured, it helps to share your LINE ID or email address.',
    contactPh: 'e.g. @line_id / example@email.com',
    visLabel: 'Visibility',
    visPublicLabel: 'Post with your name shown',
    visPublic: 'Show my name',
    visAnonLabel: 'Post anonymously',
    visAnon: 'Post anonymously',
    visNoteAnon: 'Your name won\'t be shown, and it won\'t appear on your profile.',
    visNotePublic: 'Your nickname and @ID appear on the post and in your profile\'s post list.',
    visPrivate: 'Private',
    visPrivateLabel: 'Make it private, visible only to you',
    visNotePrivate: 'Only you can see this. It won\'t appear in the public feed.',
    licenseText: 'These photos and content are my own or I have permission to use them (required)',
    licenseNote: '※ Posting images saved from Google Images, Google Maps, social media, etc. is prohibited.',
    sending: 'Sending…',
    updateBtn: 'Update',
    postBtn: 'Post',
    pickerFromTitle: 'Start date',
    pickerUntilTitle: 'End date',
    cancel: 'Cancel',
    pickerOk: 'Use this date',
    // トースト（タイトル・本文）
    tCannotEditTitle: 'Can\'t edit',
    tCannotEditSub: 'This post can\'t be edited',
    tLoadFailTitle: 'Failed to load',
    tNetworkSub: 'Please check your connection',
    tCaptionTitle: 'Please enter a description',
    tCaptionSub: 'Even a word about what the place is or what\'s good',
    tMoodTitle: 'Please pick a mood tag',
    tMoodSub: 'Tap one or more matching moods',
    tNgTitle: 'Inappropriate wording found',
    tNgSub: 'Please review the content',
    tUpdateFailTitle: 'Couldn\'t update',
    tRetrySub: 'Please try again in a moment',
    tUpdateFailSub2Title: 'Failed to update',
    tSpotNameTitle: 'Please enter a spot name',
    tSpotNameSub: 'e.g. Hidden café with a sea view',
    tPlaceTitle: 'Please tell us the location',
    tPlaceSub: 'Tap "Current location" or enter an address/area',
    tPhotoTitle: 'Please add at least one photo',
    tPhotoSub: 'Photos are the star of your post (up to 3)',
    tLicenseTitle: 'Rights confirmation needed',
    tLicenseSub: 'Check "Shot by me / have permission"',
    tPostFailTitle: 'Couldn\'t post',
    tPostFailSub2Title: 'Failed to post',
    tPostFailSub2: 'Please check your connection and try again',
    // 写真アクセス許可
    aPhotoTitle: 'Photo access needed',
    aPhotoMsg: 'Allow it in Settings → MoodGo → Photos.',
    aOpenSettings: 'Open Settings',
    aErrorTitle: 'Error',
    aPhotoPickFail: 'Failed to select photos.',
    tLocPermTitle: 'Location permission needed',
    tLocPermSub: 'Allow it in Settings app → MoodGo → Location',
  },
} as const;

const GRAD: [string, string, string] = ['#F56CB3', '#9B6BFF', '#4FA3FF'];
const MOODS = ['#まったりしたい', '#自然感じたい', '#わいわい楽しみたい', '#お腹すいた', '#ドライブしたい', '#集中したい', '#体動かしたい', '#遠くに行きたい', '#ショッピング', '#スリル味わいたい'];
// 投稿の気分タグ → QuizFlowのDEEP_DIVEキー（綴りが違うのでマップ）。深掘り(サブジャンル)タグを出すため。
const MOOD_TAG_TO_DIVE: Record<string, string> = {
  '#お腹すいた': 'お腹すいた', '#まったりしたい': 'まったり', '#自然感じたい': '自然',
  '#わいわい楽しみたい': '楽しみたい', '#ドライブしたい': 'ドライブ', '#集中したい': '集中',
  '#体動かしたい': '運動', '#遠くに行きたい': '旅行', '#ショッピング': 'ショッピング',
  '#スリル味わいたい': 'スリル',
};

type PlaceHit = { id: string; name: string; address?: string };

// 目安の値段チップ（独立カラムで保存・説明文には埋め込まない）
const PRICE_CHIPS = ['無料', '〜¥500', '〜¥1,000', '〜¥3,000', '¥3,000〜'];

export default function PostScreen() {
  const insets = useSafeAreaInsets();
  const { lang } = useSettings();
  const t = T[lang];
  const params = useLocalSearchParams<{ placeId?: string; placeName?: string; address?: string; editId?: string }>();
  const paramPlaceId = (params.placeId ?? '').toString();   // 場所詳細から来た既存スポット
  const editId = (params.editId ?? '').toString();          // 自分の投稿を編集（community-spotの…メニューから）
  const editMode = !!editId;

  const [spotName, setSpotName] = useState((params.placeName ?? '').toString());
  const [address, setAddress] = useState((params.address ?? '').toString());
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [images, setImages] = useState<{ uri: string; base64?: string }[]>([]);
  const [moodTags, setMoodTags] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [rating, setRating] = useState(0);
  const [availFrom, setAvailFrom] = useState('');   // 期間限定(任意・新スポットのみ)
  const [availUntil, setAvailUntil] = useState('');
  const [openingHours, setOpeningHours] = useState('');  // 営業時間(任意・新スポット)
  const [station, setStation] = useState('');            // 最寄駅(任意・新スポット)
  const [showPicker, setShowPicker] = useState<null | 'from' | 'until'>(null);  // 公開期間のカレンダー
  const [tempDate, setTempDate] = useState(new Date());
  const [licenseOk, setLicenseOk] = useState(false);
  // 公開範囲: false=名前を出して公開(デフォルト・プロフィール/フォロー対象) / true=匿名で公開
  const [vis, setVis] = useState<'public' | 'anon' | 'private'>('public');   // 公開範囲: 名前/匿名/非公開
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [priceChip, setPriceChip] = useState('');   // 目安の値段（チップ・任意）
  const [priceNote, setPriceNote] = useState('');   // 値段の自由記入（任意）
  const [contact, setContact] = useState('');       // 連絡先（任意・掲載特典の連絡用）
  const [done, setDone] = useState(false);          // 送信後の完了画面

  // 既存スポット候補（スポット名を打つと被る既存placeが出る）
  const [results, setResults] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickedId, setPickedId] = useState('');   // 候補から選んだ既存スポットID
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 画面を離れる時に検索タイマーを止める（unmount後のsetState/古い結果上書きを防ぐ）
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const existingPlaceId = paramPlaceId || pickedId;  // 既存(param or 検索選択)
  const isExisting = !!existingPlaceId;
  const lockedFromParam = !!paramPlaceId || editMode;   // 編集時もスポット名は固定（場所は変えない）

  // 編集モード: 自分の投稿を読み込んでプレフィル（本文・気分タグ・評価・値段）。写真/場所は変更しない。
  useEffect(() => {
    if (!editId) return;
    let active = true;
    (async () => {
      try {
        const deviceId = await getDeviceId();
        const d = await apiFetch('/api/spot-posts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get-mine', postId: editId, deviceId }),
        }).then((r) => r.json());
        if (!active) return;
        if (d?.ok && d.post) {
          setSpotName(String(d.post.placeName ?? ''));
          setCaption(String(d.post.caption ?? ''));
          const tags = Array.isArray(d.post.moodTags) ? d.post.moodTags.filter((t: string) => t !== '#穴場スポット' && t !== '#時間潰し') : [];
          setMoodTags(tags);
          setRating(Number(d.post.rating) || 0);
          setPriceChip(String(d.post.priceChip ?? ''));
          setPriceNote(String(d.post.priceNote ?? ''));
          setContact(String(d.post.contact ?? ''));
          setVis(d.post.visibility === 'private' ? 'private' : d.post.visibility === 'public' ? 'public' : 'anon');
        } else {
          showToast(t.tCannotEditTitle, d?.error ?? t.tCannotEditSub);
          router.back();
        }
      } catch { if (active) showToast(t.tLoadFailTitle, t.tNetworkSub); }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // スポット名を打つたびに既存placeを検索（被り候補を出す）。空/1文字なら候補クリア。
  const onNameChange = (text: string) => {
    setSpotName(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch(`/api/place-search?q=${encodeURIComponent(text.trim())}`);
        const d = await res.json();
        setResults(Array.isArray(d?.places) ? d.places : []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 300);
  };
  // 候補から既存スポットを選択＝その場所への口コミ(moodログ)として投稿
  const pickPlace = (p: PlaceHit) => {
    if (timer.current) clearTimeout(timer.current);
    setPickedId(p.id); setSpotName(p.name); setAddress(p.address ?? '');
    setResults([]);
  };
  const clearPicked = () => { setPickedId(''); setSpotName(''); setAddress(''); setResults([]); };

  const pickImages = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t.aPhotoTitle, t.aPhotoMsg, [
          { text: t.cancel, style: 'cancel' }, { text: t.aOpenSettings, onPress: () => Linking.openSettings() },
        ]); return;
      }
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3, quality: 0.6, base64: true, exif: false });
      if (!r.canceled && r.assets.length > 0) {
        const add = r.assets.slice(0, 3 - images.length).map(a => ({ uri: a.uri, base64: a.base64 ?? undefined }));
        setImages(prev => [...prev, ...add].slice(0, 3));
      }
    } catch { Alert.alert(t.aErrorTitle, t.aPhotoPickFail); }
  };

  const useLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLat(pos.coords.latitude); setLng(pos.coords.longitude);
        try {
          const res = await apiFetch(`/api/reverse-geocode?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
          const d = await res.json();
          if (d.ok && d.address) setAddress(d.address);
        } catch { /* 住所自動入力は失敗してもOK */ }
      } else {
        // 拒否時は無反応にせずフィードバック（写真許可と同様）
        showToast(t.tLocPermTitle, t.tLocPermSub);
      }
    } catch { /* 位置取得失敗 */ } finally { setLocating(false); }
  };

  const toggleMood = (t: string) => setMoodTags(p => (p.includes(t) ? p.filter(x => x !== t) : [...p, t]));

  // 公開期間のカレンダー。ローカル日付で YYYY-MM-DD 化（TZずれ回避）
  const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const openPicker = (which: 'from' | 'until') => {
    const cur = which === 'from' ? availFrom : availUntil;
    setTempDate(cur ? new Date(`${cur}T00:00:00`) : new Date());
    setShowPicker(which);
  };
  const applyPickedDate = (d: Date) => {
    const st = fmtDate(d);
    if (showPicker === 'from') setAvailFrom(st); else if (showPicker === 'until') setAvailUntil(st);
  };

  // 選んだ気分の深掘り(サブジャンル)タグを L1＋L2 フラットで出す（重複排除）
  const deepDiveOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; label: string }[] = [];
    for (const m of moodTags) {
      const cfg = DEEP_DIVE[MOOD_TAG_TO_DIVE[m] ?? ''];
      if (!cfg) continue;
      for (const opt of cfg.options) {
        if (!seen.has(opt.key)) { seen.add(opt.key); out.push({ key: opt.key, label: opt.label }); }
        for (const sub of (opt.subs ?? [])) {
          if (!seen.has(sub.key)) { seen.add(sub.key); out.push({ key: sub.key, label: sub.label }); }
        }
      }
    }
    return out;
  }, [moodTags]);

  const visServer = vis === 'private' ? 'private' : vis === 'anon' ? 'spot_public_anonymous' : 'public';
  const submit = async () => {
    // ── 編集モード: 名前・本文・気分・公開範囲・評価・値段・連絡先を更新（最初の投稿と同項目）──
    if (editMode) {
      if (!spotName.trim()) { showToast(t.tSpotNameTitle, t.tSpotNameSub); return; }
      if (!caption.trim()) { showToast(t.tCaptionTitle, t.tCaptionSub); return; }
      if (moodTags.length === 0) { showToast(t.tMoodTitle, t.tMoodSub); return; }
      if (findNgWord(caption) || findNgWord(spotName) || findNgWord(contact)) { showToast(t.tNgTitle, t.tNgSub); return; }
      setSubmitting(true);
      try {
        const deviceId = await getDeviceId();
        const d = await apiFetch('/api/spot-posts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update', postId: editId, deviceId,
            placeName: spotName.trim(), visibility: visServer,
            caption: caption.trim(), moodTags,
            rating: rating > 0 ? rating : undefined,
            priceChip: priceChip || undefined,
            priceNote: priceNote.trim() || undefined,
            contact: contact.trim() || undefined,
          }),
        }).then((r) => r.json());
        setSubmitting(false);
        if (d?.ok) { markFeedStale(); setDone(true); }   // フィードを再取得対象に（公開範囲/名前の変更を反映）
        else showToast(t.tUpdateFailTitle, d?.error ?? t.tRetrySub);
      } catch { setSubmitting(false); showToast(t.tUpdateFailSub2Title, t.tNetworkSub); }
      return;
    }

    // バリデーションはフォームの並び順（名前→紹介文→気分→…→場所）に合わせる＝下の項目のエラーが先に出ない
    if (!isExisting && !spotName.trim()) { showToast(t.tSpotNameTitle, t.tSpotNameSub); return; }
    if (!caption.trim()) { showToast(t.tCaptionTitle, t.tCaptionSub); return; }
    if (moodTags.length === 0) { showToast(t.tMoodTitle, t.tMoodSub); return; }
    if (findNgWord(caption) || findNgWord(spotName) || findNgWord(contact)) { showToast(t.tNgTitle, t.tNgSub); return; }
    // 新スポットは場所必須（住所 or 現在地のどちらか）。既存スポット選択時は場所確定済み。
    if (!isExisting && !address.trim() && (lat == null || lng == null)) {
      showToast(t.tPlaceTitle, t.tPlaceSub); return;
    }
    // 写真は1枚以上必須（最大3枚は据え置き）。画像中心のフィードの主役なので空投稿を防ぐ。
    if (images.length === 0) { showToast(t.tPhotoTitle, t.tPhotoSub); return; }
    if (!licenseOk) { showToast(t.tLicenseTitle, t.tLicenseSub); return; }
    setSubmitting(true);
    try {
      const deviceId = await getDeviceId();
      const posterName = (await AsyncStorage.getItem('moodgo-group-nickname'))?.trim() || undefined;
      // 画像はクライアントで縮小してから送る:
      //   メイン=幅1440px(アップロード/表示とも軽量) ・ サムネ=幅400px(フィード表示用・_thumb規約で保存)
      const prepared = await Promise.all(images.map(async (img) => {
        try {
          const main = await ImageManipulator.manipulateAsync(
            img.uri, [{ resize: { width: 1440 } }],
            { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
          );
          const thumb = await ImageManipulator.manipulateAsync(
            img.uri, [{ resize: { width: 400 } }],
            { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG, base64: true },
          );
          return {
            main: main.base64 ? `data:image/jpeg;base64,${main.base64}` : '',
            thumb: thumb.base64 ? `data:image/jpeg;base64,${thumb.base64}` : '',
          };
        } catch {
          // 縮小失敗時は従来どおり元のbase64を送る（サムネ無し）
          return { main: img.base64 ? `data:image/jpeg;base64,${img.base64}` : '', thumb: '' };
        }
      }));
      const valid = prepared.filter(p2 => p2.main);
      const imgs = valid.map(p2 => p2.main);
      const thumbImgs = valid.map(p2 => p2.thumb);
      // 投稿は全て spot-posts に一本化。新スポット(placeId無し)はAPI側でplacesに仮登録され、admin承認で検索に出る。
      // ⚠ 価格/おすすめ度は独立フィールドで送る（captionへの【目安価格】【おすすめ度】埋め込みは廃止＝
      //    検索カードの説明が汚れない・除去処理も不要）。
      const res = await apiFetch('/api/spot-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: 30000,
        body: JSON.stringify({
          action: 'create', deviceId, posterName,
          placeId: existingPlaceId || undefined, placeName: spotName, address,
          lat: lat ?? undefined, lng: lng ?? undefined,
          // 名前を出して公開(public)=投稿者カード/プロフィール/フォロー対象。匿名は本人特定不可のまま公開。
          caption: caption.trim(), moodTags, visibility: visServer,
          canUseAsSpotPhoto: true, licenseDeclared: true, images: imgs, thumbImages: thumbImgs,
          priceChip: priceChip || undefined,
          priceNote: priceNote.trim() || undefined,
          rating: rating > 0 ? rating : undefined,
          contact: contact.trim() || undefined,
          // 新スポット(穴場)の詳細。既存スポットへの投稿(moodログ)では送らない＝既存placeを上書きしない
          openingHours: !isExisting ? (openingHours.trim() || undefined) : undefined,
          station: !isExisting ? (station.trim() || undefined) : undefined,
          availableFrom: !isExisting ? (availFrom.trim() || undefined) : undefined,
          availableUntil: !isExisting ? (availUntil.trim() || undefined) : undefined,
        }),
      });
      const d = await res.json();
      if (!d?.ok) { showToast(t.tPostFailTitle, d?.error ?? t.tRetrySub); setSubmitting(false); return; }
      setSubmitting(false);
      markFeedStale();   // 新規投稿をフィードに反映（次のフィード表示で再取得）
      setDone(true);   // 完了画面へ切替（トースト+即戻るをやめ、受付を明確に伝える）
    } catch { showToast(t.tPostFailSub2Title, t.tPostFailSub2); setSubmitting(false); }
  };

  return (
    <View style={s.root}>
      <AppBackground />
      <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.head, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><ArrowLeft size={22} color="#fff" /></TouchableOpacity>
        <Text style={s.headTitle} numberOfLines={1}>{editMode ? t.editTitle : t.postTitle}</Text>
      </LinearGradient>
      {done ? (
        /* ── 完了画面（送信後に切替）── */
        <View style={s.doneWrap}>
          <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.doneCircle}>
            <Check size={36} color="#fff" strokeWidth={3} />
          </LinearGradient>
          <Text style={s.doneTitle}>{editMode ? t.doneEditTitle : t.donePostTitle}</Text>
          <Text style={s.doneSub}>
            {editMode
              ? t.doneEditSub
              : isExisting
              ? t.doneExistingSub
              : t.doneNewSub}
          </Text>
          <TouchableOpacity onPress={() => router.back()} style={s.doneBtnWrap} activeOpacity={0.85}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.doneBtn}>
              <Text style={s.doneBtnText}>{t.close}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      ) : (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">

          {/* リード文（招待トーン＋特典予告） */}
          <View style={s.lead}>
            <Text style={s.leadText}>{t.leadText}</Text>
          </View>

          {/* ① スポット名（既存スポット検索つき: 打つと同じ場所の候補が出る。編集時は検索なしで自由編集） */}
          <Text style={s.label}>{t.spotNameLabel}<Text style={s.req}>*</Text></Text>
          {editMode ? (
            <TextInput style={s.input} value={spotName} onChangeText={setSpotName} placeholder={t.spotNamePh} placeholderTextColor="#B9ABD2" maxLength={100} />
          ) : lockedFromParam ? (
            <View style={s.pickedRow}>
              <MapPin size={15} color="#7C3AED" strokeWidth={2.4} />
              <Text style={s.pickedText} numberOfLines={1}>{spotName}</Text>
            </View>
          ) : pickedId ? (
            <View style={s.pickedRow}>
              <MapPin size={15} color="#7C3AED" strokeWidth={2.4} />
              <Text style={s.pickedText} numberOfLines={1}>{spotName}</Text>
              <TouchableOpacity onPress={clearPicked} hitSlop={8}><Text style={s.changeBtn}>{t.change}</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={s.searchWrap}>
                <Search size={16} color="#A78BCA" strokeWidth={2.2} />
                <TextInput style={s.searchInput} value={spotName} onChangeText={onNameChange} placeholder={t.spotNamePh} placeholderTextColor="#B9ABD2" />
                {searching && <ActivityIndicator size="small" color="#9B6BFF" />}
              </View>
              {results.length > 0 && (
                <View style={s.suggestBox}>
                  <Text style={s.suggestHint}>{t.dupHint}</Text>
                  {results.map(p => (
                    <TouchableOpacity key={p.id} onPress={() => pickPlace(p)} style={s.resultRow} activeOpacity={0.8}>
                      <MapPin size={14} color="#7C3AED" strokeWidth={2.2} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.resultName} numberOfLines={1}>{p.name}</Text>
                        {p.address ? <Text style={s.resultAddr} numberOfLines={1}>{p.address}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  ))}
                  <Text style={s.suggestNew}>{t.newSpotHint(spotName.trim())}</Text>
                </View>
              )}
            </>
          )}

          {/* ② 紹介文（必須） */}
          <Text style={s.label}>{t.captionLabel}<Text style={s.req}>*</Text></Text>
          <TextInput style={[s.input, { minHeight: 96 }]} value={caption} onChangeText={setCaption} placeholder={t.captionPh} placeholderTextColor="#B9ABD2" multiline maxLength={1000} />

          {/* ③ 気分タグ（必須） */}
          <Text style={s.label}>{t.moodLabel}<Text style={s.req}>*</Text>{t.moodLabelSuffix}</Text>
          <View style={s.chips}>
            {MOODS.map(t => (
              <TouchableOpacity key={t} onPress={() => toggleMood(t)} style={[s.chip, moodTags.includes(t) && s.chipOn]} activeOpacity={0.8}>
                <Text style={[s.chipText, moodTags.includes(t) && s.chipTextOn]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* 全投稿に自動で付く共通タグ（サーバーが必ず付与）。透明性のため明示。 */}
          <Text style={s.autoTagHint}>{t.autoTagPre}<Text style={s.autoTagStrong}>#穴場スポット</Text>{t.autoTagMid}<Text style={s.autoTagStrong}>#時間潰し</Text>{t.autoTagPost}</Text>
          {deepDiveOptions.length > 0 && (
            <>
              <Text style={s.label}>{t.genreLabel}</Text>
              <View style={s.chips}>
                {deepDiveOptions.map(o => {
                  const tag = '#' + o.key;
                  const on = moodTags.includes(tag);
                  return (
                    <TouchableOpacity key={o.key} onPress={() => toggleMood(tag)} style={[s.chip, on && s.chipOn]} activeOpacity={0.8}>
                      <Text style={[s.chipText, on && s.chipTextOn]}>{o.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* ④ 目安の値段（任意・独立カラム保存＝説明文に埋め込まない） */}
          <Text style={s.label}>{t.priceLabel}</Text>
          <Text style={s.hint}>{t.priceHint}</Text>
          <View style={s.chips}>
            {PRICE_CHIPS.map(c => (
              <TouchableOpacity key={c} onPress={() => setPriceChip(priceChip === c ? '' : c)} style={[s.chip, priceChip === c && s.chipOn]} activeOpacity={0.8}>
                <Text style={[s.chipText, priceChip === c && s.chipTextOn]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={[s.input, { marginTop: 8, minHeight: 48 }]} value={priceNote} onChangeText={setPriceNote} placeholder={t.priceNotePh} placeholderTextColor="#B9ABD2" maxLength={120} />

          {/* ⑤ 掲載期間（任意・新スポットのみ・編集では非表示） */}
          {!isExisting && !editMode && (
            <>
              <Text style={s.label}>{t.periodLabel}</Text>
              <Text style={s.hint}>{t.periodHint}</Text>
              <View style={s.periodRow}>
                <TouchableOpacity style={[s.input, s.dateBtn, { flex: 1, minHeight: 48 }]} onPress={() => openPicker('from')} activeOpacity={0.8}>
                  <Calendar size={15} color="#9B6BFF" strokeWidth={2.2} />
                  <Text style={[s.dateBtnText, !availFrom && s.dateBtnPh]} numberOfLines={1}>{availFrom || t.dateFrom}</Text>
                  {availFrom ? <TouchableOpacity onPress={() => setAvailFrom('')} hitSlop={8}><X size={14} color="#B9ABD2" /></TouchableOpacity> : null}
                </TouchableOpacity>
                <Text style={s.periodTilde}>〜</Text>
                <TouchableOpacity style={[s.input, s.dateBtn, { flex: 1, minHeight: 48 }]} onPress={() => openPicker('until')} activeOpacity={0.8}>
                  <Calendar size={15} color="#9B6BFF" strokeWidth={2.2} />
                  <Text style={[s.dateBtnText, !availUntil && s.dateBtnPh]} numberOfLines={1}>{availUntil || t.dateUntil}</Text>
                  {availUntil ? <TouchableOpacity onPress={() => setAvailUntil('')} hitSlop={8}><X size={14} color="#B9ABD2" /></TouchableOpacity> : null}
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ⑥ おすすめ度（任意・同じ星をもう一度で解除） */}
          <Text style={s.label}>{t.ratingLabel}</Text>
          <View style={s.starsRow}>
            {[1, 2, 3, 4, 5].map(n => (
              <TouchableOpacity key={n} onPress={() => setRating(rating === n ? 0 : n)} hitSlop={6} activeOpacity={0.7}>
                <Star size={30} color={n <= rating ? '#F59E0B' : '#E5E7EB'} fill={n <= rating ? '#F59E0B' : '#E5E7EB'} strokeWidth={0} />
              </TouchableOpacity>
            ))}
          </View>

          {/* ⑦ 場所・住所（新スポットのみ必須: 現在地 or 住所・編集では非表示） */}
          {!isExisting && !editMode && (
            <>
              <Text style={s.label}>{t.addrLabel}<Text style={s.req}>*</Text></Text>
              <View style={s.addrRow}>
                <TextInput style={[s.input, { flex: 1, minHeight: 0 }]} value={address} onChangeText={setAddress} placeholder={t.addrPh} placeholderTextColor="#B9ABD2" />
                <TouchableOpacity style={s.locBtn} onPress={useLocation} disabled={locating} activeOpacity={0.8}>
                  {locating ? <ActivityIndicator size="small" color="#fff" /> : <MapPin size={15} color="#fff" strokeWidth={2.4} />}
                  <Text style={s.locBtnText}>{locating ? t.locating : t.locate}</Text>
                </TouchableOpacity>
              </View>
              {lat != null && lng != null && (
                <Text style={s.gotLoc}>{t.gotLoc(address)}</Text>
              )}
              <TextInput style={[s.input, { marginTop: 8 }]} value={openingHours} onChangeText={setOpeningHours} placeholder={t.openingHoursPh} placeholderTextColor="#B9ABD2" multiline />
              <TextInput style={[s.input, { marginTop: 8, minHeight: 48 }]} value={station} onChangeText={setStation} placeholder={t.stationPh} placeholderTextColor="#B9ABD2" />
            </>
          )}

          {/* ⑧ 写真（最大3枚・圧縮base64送信）。編集時は写真を変更しない（本文・タグ・評価・値段のみ） */}
          {editMode ? (
            <Text style={s.note}>{t.editNote}</Text>
          ) : (
            <>
              <Text style={s.label}>{t.photoLabel}</Text>
              <Text style={s.hint}>{t.photoHint}</Text>
              <View style={s.photoGrid}>
                {images.map((im, i) => (
                  <View key={i} style={s.thumbWrap}>
                    <Image source={{ uri: im.uri }} style={s.thumb} />
                    <TouchableOpacity style={s.thumbX} onPress={() => setImages(prev => prev.filter((_, j) => j !== i))}><X size={13} color="#fff" /></TouchableOpacity>
                  </View>
                ))}
                {images.length < 3 && (
                  <TouchableOpacity style={s.addPhoto} onPress={pickImages} activeOpacity={0.8}>
                    <Camera size={22} color="#A78BCA" /><Text style={s.addPhotoText}>{t.addPhoto}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          {/* ⑨ 連絡先（任意・新スポット/編集時） */}
          {(!isExisting || editMode) && (
            <>
              <Text style={s.label}>{t.contactLabel}</Text>
              <Text style={s.hint}>{t.contactHint}</Text>
              <TextInput style={[s.input, { minHeight: 48 }]} value={contact} onChangeText={setContact} placeholder={t.contactPh} placeholderTextColor="#B9ABD2" autoCapitalize="none" autoCorrect={false} maxLength={120} />
            </>
          )}

          {/* 公開範囲: 名前を出す / 匿名 / 非公開（自分だけ）。編集でも変更可 */}
          <Text style={s.label}>{t.visLabel}</Text>
          <View style={s.visRow}>
            {([
              { k: 'public', label: t.visPublic, a11y: t.visPublicLabel },
              { k: 'anon', label: t.visAnon, a11y: t.visAnonLabel },
              { k: 'private', label: t.visPrivate, a11y: t.visPrivateLabel },
            ] as const).map((o) => (
              <TouchableOpacity key={o.k}
                style={[s.visChip, vis === o.k && s.visChipOn]} activeOpacity={0.8}
                onPress={() => setVis(o.k)}
                accessibilityRole="button" accessibilityLabel={o.a11y}>
                <Text style={[s.visChipText, vis === o.k && s.visChipTextOn]}>{o.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.note}>
            {vis === 'private' ? t.visNotePrivate : vis === 'anon' ? t.visNoteAnon : t.visNotePublic}
          </Text>

          {/* 権利確認（編集時は写真を変えないので不要） */}
          {!editMode && (<>
          <TouchableOpacity style={s.check} onPress={() => setLicenseOk(v => !v)} activeOpacity={0.8}>
            <View style={[s.box, licenseOk && s.boxOn]}>{licenseOk && <Check size={14} color="#fff" strokeWidth={3} />}</View>
            <Text style={s.checkText}>{t.licenseText}</Text>
          </TouchableOpacity>
          <Text style={s.note}>{t.licenseNote}</Text>
          </>)}

          <TouchableOpacity style={[s.submitWrap, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting} activeOpacity={0.85}>
            <LinearGradient colors={GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.submit}>
              <Send size={17} color="#fff" strokeWidth={2.4} />
              <Text style={s.submitText}>{submitting ? t.sending : editMode ? t.updateBtn : t.postBtn}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      )}

      {/* 公開期間のカレンダー（iOS=ツリー内オーバーレイ / Android=ネイティブダイアログ）
          ⚠ New Arch(Fabric)の <Modal transparent> は中身を描画せず透明のままタッチを奪う不具合が
             あるため（ConsentGate で実証・c5adb7c）、showPickerセット時に即マウントされる本Modalを
             やめ、post画面（Stackルート＝ネイティブタブバー無し）内の絶対配置オーバーレイに置換。 */}
      {showPicker !== null && (Platform.OS === 'ios' ? (
        <View style={s.pickerOverlay}>
          <View style={s.pickerSheet}>
              <Text style={s.pickerTitle}>{showPicker === 'from' ? t.pickerFromTitle : t.pickerUntilTitle}</Text>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="inline"
                locale="ja-JP"
                onChange={(_e, d) => { if (d) setTempDate(d); }}
                style={{ alignSelf: 'stretch' }}
                accentColor="#9B6BFF"
              />
              <View style={s.pickerBtns}>
                <TouchableOpacity onPress={() => setShowPicker(null)} style={s.pickerCancel} activeOpacity={0.8}>
                  <Text style={s.pickerCancelText}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { applyPickedDate(tempDate); setShowPicker(null); }} style={s.pickerOk} activeOpacity={0.8}>
                  <Text style={s.pickerOkText}>{t.pickerOk}</Text>
                </TouchableOpacity>
              </View>
            </View>
        </View>
      ) : (
        <DateTimePicker
          value={tempDate}
          mode="date"
          onChange={(e, d) => { if (e.type === 'set' && d) applyPickedDate(d); setShowPicker(null); }}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: APP_BG },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14 },
  headTitle: { fontSize: 17, fontWeight: '800', color: '#fff' },
  label: { fontSize: 13, fontWeight: '800', color: '#4A2D7E', marginTop: 16, marginBottom: 8 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#fff' },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: '#2A2235' },
  suggestBox: { marginTop: 8, backgroundColor: '#F7F2FF', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: '#E9DEFB' },
  suggestHint: { fontSize: 11.5, color: '#7C3AED', fontWeight: '800', lineHeight: 17 },
  suggestNew: { fontSize: 11, color: '#9B89BE', fontWeight: '700', marginTop: 8, lineHeight: 16 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6, borderWidth: 1, borderColor: '#EFE8FB' },
  resultName: { fontSize: 14, fontWeight: '700', color: '#2A2235' },
  resultAddr: { fontSize: 11.5, color: '#9B89BE', marginTop: 2 },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#F3EEFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#E3D8F5' },
  pickedText: { flex: 1, fontSize: 15, fontWeight: '800', color: '#7C3AED' },
  changeBtn: { color: '#7C3AED', fontSize: 12, fontWeight: '800' },
  addrRow: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' },
  locBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#7C3AED', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  locBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  photoGrid: { flexDirection: 'row', gap: 10 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 88, height: 88, borderRadius: 12, backgroundColor: '#EEE' },
  thumbX: { position: 'absolute', top: -6, right: -6, backgroundColor: '#1E0753', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: 88, height: 88, borderRadius: 12, borderWidth: 1.5, borderColor: '#E3D8F5', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: '#fff' },
  addPhotoText: { fontSize: 11, color: '#A78BCA', fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 16, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  chipText: { fontSize: 12.5, color: '#7E6CA0', fontWeight: '700' },
  chipTextOn: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 12, padding: 12, fontSize: 14, color: '#2A2235', minHeight: 48, textAlignVertical: 'top', backgroundColor: '#fff' },
  starsRow: { flexDirection: 'row', gap: 8 },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  periodTilde: { fontSize: 14, color: '#9B89BE', fontWeight: '700' },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateBtnText: { flex: 1, fontSize: 14, color: '#2A2235', fontWeight: '700' },
  dateBtnPh: { color: '#B9ABD2', fontWeight: '500' },
  pickerOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 9999, elevation: 9999, backgroundColor: 'rgba(20,10,40,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  pickerSheet: { backgroundColor: '#fff', borderRadius: 20, padding: 16, width: '100%', maxWidth: 380 },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: '#4A2D7E', textAlign: 'center', marginBottom: 4 },
  pickerBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  pickerCancel: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#E3D8F5', alignItems: 'center' },
  pickerCancelText: { fontSize: 14, fontWeight: '800', color: '#9B89BE' },
  pickerOk: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: '#7C3AED', alignItems: 'center' },
  pickerOkText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  // 公開のしかた（名前を出す/匿名）
  visRow: { flexDirection: 'row', gap: 10 },
  visChip: {
    flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(155,107,255,0.22)',
  },
  visChipOn: { backgroundColor: '#F1EBFF', borderColor: '#9B6BFF' },
  visChipText: { fontSize: 13, fontWeight: '700', color: '#8B88A6' },
  visChipTextOn: { color: '#6D28D9', fontWeight: '800' },

  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#C9B6FF', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  checkText: { flex: 1, fontSize: 12.5, color: '#4A4256', lineHeight: 18 },
  note: { fontSize: 11, color: '#B0A2C8', marginTop: 10, lineHeight: 16 },
  submitWrap: { borderRadius: 16, overflow: 'hidden', marginTop: 22, shadowColor: '#9B6BFF', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8 },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, paddingVertical: 15 },
  submitText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  // リード文・ヒント・必須マーク・現在地取得済み
  lead: { backgroundColor: '#F3EEFF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E3D8F5' },
  leadText: { fontSize: 13, color: '#4A2D7E', fontWeight: '700', lineHeight: 20 },
  req: { color: '#F56CB3' },
  hint: { fontSize: 11.5, color: '#9B89BE', marginBottom: 8, lineHeight: 16 },
  autoTagHint: { fontSize: 11.5, color: '#7A5CFF', marginTop: 8, lineHeight: 16, fontWeight: '600' },
  autoTagStrong: { fontWeight: '800', color: '#7C3AED' },
  gotLoc: { fontSize: 12, color: '#16A34A', fontWeight: '700', marginTop: 8 },
  // 完了画面
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  doneCircle: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  doneTitle: { fontSize: 20, fontWeight: '800', color: '#1E0753' },
  doneSub: { fontSize: 13.5, color: '#6B5E85', textAlign: 'center', lineHeight: 21 },
  doneBtnWrap: { marginTop: 14, alignSelf: 'stretch', borderRadius: 16, overflow: 'hidden' },
  doneBtn: { paddingVertical: 15, alignItems: 'center', borderRadius: 16 },
  doneBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
});
