// ── app/post.tsx ──────────────────────────────────────────────────────────────
// 統一投稿画面（Phase2）。穴場・moodログ・ブログを1つのフォームに集約。
//   - 既存スポット(placeId param あり／検索で選択)→ /api/spot-posts（moodログ＝場所への口コミ）
//   - 新スポット(名前を入力)→ /api/suggestions（穴場＝運営が審査して掲載）
// どちらもユーザーから見れば「投稿する」1つだけ。裏のテーブルは触らず分岐するだけ＝安全。
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Calendar, Camera, Check, Clock, MapPin, Plus, Search, Send, Star, Tag, X } from 'lucide-react-native';
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
import LiquidSuccess from '@/components/LiquidSuccess';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';
import { findNgWord } from '@/lib/ngwords';
import { showToast } from '@/lib/toast';
import { markFeedStale } from '@/lib/feedRefresh';
import { DEEP_DIVE } from '@/components/QuizFlow';
import { useSettings } from '@/lib/settingsStore';
import { registerForPushNotificationsAsync } from '@/lib/push';

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
    doneLinkedSub: (name: string) => `近くに既存の「${name}」があったため、重複を防いでそこにまとめました。あなたの投稿はそのスポットのページに表示されます。ありがとうございます！`,
    close: '閉じる',
    leadText: 'あなたが知っている素敵な場所を投稿しよう。\n掲載された場合は特典をプレゼント予定です🎁',
    spotNameLabel: 'スポット名 ',
    change: '変更',
    spotNamePh: '例：海が見える穴場カフェ',
    dupHint: '投稿する場所は一覧から選んでください。同じ場所があればタップ',
    noHitHint: '候補が見つからない時は、下のボタンから新しいスポットとして追加できます',
    searchingHint: '候補を検索中…',
    addNewSpot: (name: string) => `「${name}」を新しいスポットとして追加`,
    addNewSpotSub: '一覧に無い時だけ（重複防止のため先に候補をご確認ください）',
    newSpotBadge: '新しいスポットとして追加',
    tPickTitle: '場所の選択が必要です',
    tPickSub: '候補から選ぶか「新しいスポットとして追加」を押してください',
    captionLabel: 'どんな場所？おすすめポイント ',
    captionPh: 'どんな場所？何が良い？雰囲気やおすすめポイントを自由に',
    moodLabel: '合う気分 ',
    moodLabelSuffix: '（1つ以上）',
    autoTagPre: 'この投稿には ',
    autoTagMid: ' と ',
    autoTagPost: ' が自動で付きます',
    genreLabel: '詳しいジャンル（任意・当てはまるものをタップ）',
    priceLabel: '目安の値段（任意）',
    priceHint: '1人あたりの大体の金額',
    priceNotePh: '詳細があれば（例: ランチ800円、ディナー2,000円〜）',
    periodLabel: '公開期間（任意）',
    periodHint: '期間限定スポットの場合に設定。空欄なら常時公開です。',
    periodWhatLabel: '何の期間限定？',
    periodWhatPh: '例: 夏季限定オープン、桜まつり、GWポップアップ',
    periodWhatNote: '期間を設定したら「何の期間限定か」は必須です（投稿の先頭に表示されます）。',
    dateFrom: '開始日',
    dateUntil: '終了日',
    // 既存スポットへの「期間限定イベント/ポップアップ」投稿
    eventLabel: '期間限定イベント・ポップアップ（任意）',
    eventHint: 'この場所で期間限定の催し（コラボ/ポップアップ等）があれば、開催期間を設定してください。',
    eventNameLabel: 'イベント名',
    eventNamePh: '例: ちいかわコラボの水族館',
    eventNamePreview: (name: string, base: string) => `「${name}＠${base}」として新しいスポットになります（写真もそちらだけに付き、元の場所には入りません）。`,
    tEventNameTitle: 'イベント名を入力してください',
    tEventNameSub: '期間を設定した場合、何の期間限定かの名前が必須です',
    tEventEndTitle: '終了日を入れてください',
    tEventEndSub: '期間限定イベントには終了日が必要です（終了日を過ぎると自動で削除されます）',
    eventEndNote: '※ 開催期間中は検索にも表示され、終了日を過ぎるとこの期間限定スポットは自動で削除されます。',
    ratingLabel: 'おすすめ度（任意）',
    addrLabel: '場所・住所 ',
    addrPh: '住所・エリア名を入力（例: 神奈川県横浜市…）',
    locating: '取得中',
    locate: '現在地',
    gotLoc: (addr: string) => `📍 位置を取得しました${addr ? `（${addr}）` : ''}`,
    openingHoursPh: '営業時間（任意・例: 11:00〜22:00、月曜休）',
    hoursLabel: '営業時間（任意）',
    closedLabel: '休業日（任意）',
    completeHint: 'この場所は住所や営業時間が未登録です。分かる範囲で教えてください（任意・空欄でもOK）',
    hoursOpen: '開店',
    hoursClose: '閉店',
    hours24: '24時間営業',
    stationPh: '最寄駅（任意・例: JR横浜駅 徒歩5分）',
    editNote: '※ 自分で作った穴場は住所・営業時間・最寄駅・公開期間も編集できます。',
    editPhotoHint: '写真の追加・削除ができます（×で削除・「追加」で選択）。最低1枚は必要です',
    photoLabel: '写真（1枚以上）',
    photoHint: '駐車場の看板、穴場の建物、景色など。雰囲気が伝わる写真を！何枚でもOK',
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
    tPhotoSub: '雰囲気が伝わる写真が投稿の主役です',
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
    doneLinkedSub: (name: string) => `We found an existing "${name}" nearby, so we merged your post there to avoid a duplicate. It appears on that spot's page. Thank you!`,
    close: 'Close',
    leadText: 'Share a great place you know.\nWe plan to send a reward if it gets featured 🎁',
    spotNameLabel: 'Spot name ',
    change: 'Change',
    spotNamePh: 'e.g. Hidden café with a sea view',
    dupHint: 'Pick the place from the list. Tap it if it already exists',
    noHitHint: 'No match? Add it as a new spot with the button below',
    searchingHint: 'Searching…',
    addNewSpot: (name: string) => `Add "${name}" as a new spot`,
    addNewSpotSub: 'Only when not in the list (helps prevent duplicates)',
    newSpotBadge: 'Adding as a new spot',
    tPickTitle: 'Please choose a place',
    tPickSub: 'Pick from the list or tap "Add as a new spot"',
    captionLabel: 'What kind of place? What makes it great ',
    captionPh: 'What kind of place is it? What\'s good about it? Share the vibe and highlights',
    moodLabel: 'Matching moods ',
    moodLabelSuffix: ' (pick 1 or more)',
    autoTagPre: 'This post is automatically tagged ',
    autoTagMid: ' and ',
    autoTagPost: '',
    genreLabel: 'More detail (optional — tap any that fit)',
    priceLabel: 'Approximate price (optional)',
    priceHint: 'Rough cost per person',
    priceNotePh: 'Add details if any (e.g. lunch ¥800, dinner from ¥2,000)',
    periodLabel: 'Availability period (optional)',
    periodHint: 'Set this for limited-time spots. Leave blank for always available.',
    periodWhatLabel: 'What is limited-time?',
    periodWhatPh: 'e.g. Summer-only opening, Cherry blossom festival, GW popup',
    periodWhatNote: 'If you set dates, describing the limited-time is required (shown at the start of the post).',
    dateFrom: 'Start date',
    dateUntil: 'End date',
    eventLabel: 'Limited-time event / popup (optional)',
    eventHint: 'If there is a limited-time event (collab/popup) at this place, set its dates.',
    eventNameLabel: 'Event name',
    eventNamePh: 'e.g. Chiikawa Collab Aquarium',
    eventNamePreview: (name: string, base: string) => `Will be created as a new spot "${name}＠${base}" (photos go only there, not to the original place).`,
    tEventNameTitle: 'Please enter an event name',
    tEventNameSub: 'When you set dates, a name for the limited event is required',
    tEventEndTitle: 'Please set an end date',
    tEventEndSub: 'A limited-time event needs an end date (it is deleted automatically after it ends)',
    eventEndNote: '※ Shown in search during the event, and deleted automatically once the end date passes.',
    ratingLabel: 'Rating (optional)',
    addrLabel: 'Location / address ',
    addrPh: 'Enter address or area (e.g. Yokohama, Kanagawa…)',
    locating: 'Locating',
    locate: 'Current location',
    gotLoc: (addr: string) => `📍 Location captured${addr ? ` (${addr})` : ''}`,
    openingHoursPh: 'Hours (optional — e.g. 11:00–22:00, closed Mon)',
    hoursLabel: 'Opening hours (optional)',
    closedLabel: 'Closed days (optional)',
    completeHint: 'This spot has no address or hours yet. Fill in what you know (optional).',
    hoursOpen: 'Open',
    hoursClose: 'Close',
    hours24: 'Open 24h',
    stationPh: 'Nearest station (optional — e.g. 5 min walk from JR Yokohama)',
    editNote: '※ Address, hours, station and availability are also editable for spots you created.',
    editPhotoHint: 'Add or remove photos (× to remove, “Add” to pick). At least one is required.',
    photoLabel: 'Photos (1+)',
    photoHint: 'Parking signs, the building, the scenery — photos that convey the vibe! Add as many as you like.',
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
    tPhotoSub: 'Photos are the star of your post',
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

const DAYS_JP = ['月', '火', '水', '木', '金', '土', '日'];   // 休業日チップの表示順

type PlaceHit = { id: string; name: string; address?: string; dist?: number | null };

// 目安の値段チップ（独立カラムで保存・説明文には埋め込まない）
const PRICE_CHIPS = ['無料', '〜¥500', '〜¥1,000', '〜¥3,000', '¥3,000〜'];

// 住所が「未登録相当」か（空 / 「日本」だけ / 都道府県だけ）＝既存スポットで住所入力を促す判定用
function isAddrIncomplete(a: string): boolean {
  const t = (a ?? '').trim().replace(/^日本[、,\s]*/, '');
  return !t || t === '日本' || /^(北海道|東京都|京都府|大阪府|.{2,3}県)$/.test(t);
}

// 投稿の下書き保存キー（自由入力の新スポット投稿のみ）。誤って戻る/アプリ終了でも入力を失わず続きから。
const POST_DRAFT_KEY = 'moodgo-post-draft-v1';

export default function PostScreen() {
  const insets = useSafeAreaInsets();
  const { lang } = useSettings();
  const t = T[lang];
  const params = useLocalSearchParams<{ placeId?: string; placeName?: string; address?: string; openHours?: string; editId?: string }>();
  const paramPlaceId = (params.placeId ?? '').toString();   // 場所詳細から来た既存スポット
  const paramAddress = (params.address ?? '').toString();       // 既存スポットの現在の住所（不足補完の判定用・入力stateとは別）
  const paramOpenHours = (params.openHours ?? '').toString();   // 既存スポットの現在の営業時間（同上）
  const editId = (params.editId ?? '').toString();          // 自分の投稿を編集（community-spotの…メニューから）
  const editMode = !!editId;

  const [spotName, setSpotName] = useState((params.placeName ?? '').toString());
  const [address, setAddress] = useState((params.address ?? '').toString());
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [images, setImages] = useState<{ uri: string; base64?: string; existing?: boolean }[]>([]);   // existing=既存(サーバ済)写真＝再アップロードしない
  const originalPhotos = useRef<string[]>([]);   // 編集時の元写真URL（削除差分の算出用）
  const [thumbLoaded, setThumbLoaded] = useState<Record<string, boolean>>({});   // 写真サムネの読込完了（未完了はスピナー表示）
  const [gridW, setGridW] = useState(0);   // 写真グリッドの実測幅（横4列のセル幅算出用）
  const [pickBusy, setPickBusy] = useState(false);   // 写真選択の処理中（追加ボタンにスピナー）
  const [moodTags, setMoodTags] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [rating, setRating] = useState(0);
  const [availFrom, setAvailFrom] = useState('');   // 期間限定(任意・新スポットのみ)
  const [availUntil, setAvailUntil] = useState('');
  const [station, setStation] = useState('');            // 最寄駅(任意・新スポット)
  const [showPicker, setShowPicker] = useState<null | 'from' | 'until' | 'open' | 'close'>(null);  // 期間カレンダー＋営業時間の時刻ピッカー
  const [tempDate, setTempDate] = useState(new Date());
  const [openTime, setOpenTime] = useState('');    // 開店時刻 HH:MM（営業時間ピッカー）
  const [closeTime, setCloseTime] = useState('');  // 閉店時刻 HH:MM
  const [is24h, setIs24h] = useState(false);       // 24時間営業
  const [closedDays, setClosedDays] = useState<string[]>([]);   // 定休の曜日（月..日・任意）
  const [placeEditable, setPlaceEditable] = useState(false);  // 編集時: 自分で作った穴場なら場所情報も編集可
  const [eventName, setEventName] = useState('');  // 期間限定イベント名（既存スポットに期間を設定した時のみ必須）
  const [licenseOk, setLicenseOk] = useState(false);
  // 公開範囲: false=名前を出して公開(デフォルト・プロフィール/フォロー対象) / true=匿名で公開
  const [vis, setVis] = useState<'public' | 'anon' | 'private'>('public');   // 公開範囲: 名前/匿名/非公開
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);   // 二重送信防止の同期フラグ（stateは非同期で連打の2回目に間に合わない）
  const [linkedTo, setLinkedTo] = useState<string | null>(null);   // 重複防止で既存スポットに紐付いた時その名前（完了画面で案内）
  const [priceChip, setPriceChip] = useState('');   // 目安の値段（チップ・任意）
  const [priceNote, setPriceNote] = useState('');   // 値段の自由記入（任意）
  const [contact, setContact] = useState('');       // 連絡先（任意・掲載特典の連絡用）
  const [done, setDone] = useState(false);          // 送信後の完了画面

  // 既存スポット候補（スポット名を打つと被る既存placeが出る）
  const [results, setResults] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pickedId, setPickedId] = useState('');   // 候補から選んだ既存スポットID
  const [newSpotOk, setNewSpotOk] = useState(false);   // 「新しいスポットとして追加」を明示確定（候補選択の必須化＝重複抑止）
  // 候補の「近い順」用の現在地。許可済みの時だけ静かに最終既知位置を使う（フォームの住所/座標には触れない）
  const searchCoords = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getLastKnownPositionAsync();
        if (pos) searchCoords.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch { /* 取れなくても名前一致だけで検索できる */ }
    })();
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 画面を離れる時に検索タイマーを止める（unmount後のsetState/古い結果上書きを防ぐ）
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const existingPlaceId = paramPlaceId || pickedId;  // 既存(param or 検索選択)
  const isExisting = !!existingPlaceId;
  // 場所詳細から来た投稿はスポット名を固定（placeId無しのユーザー作成スポットでも
  // placeNameパラメータで判定＝この場所への投稿なので名前は変更させない）。編集時も固定。
  const paramPlaceName = (params.placeName ?? '').toString().trim();
  const lockedFromParam = !!paramPlaceId || !!paramPlaceName || editMode;
  // 既存スポットで住所/営業時間が未登録なら、投稿時に入力を促して補完する（2b・空の項目だけ即反映）。
  //   判定は遷移元から渡ったparam値で固定（入力stateの変化に追従させない）。編集は対象外。
  const addrMissing = isExisting && !editMode && isAddrIncomplete(paramAddress);
  const hoursMissing = isExisting && !editMode && !paramOpenHours.trim();
  const spotIncomplete = addrMissing || hoursMissing;

  // 編集モード: 自分の投稿を読み込んでプレフィル（本文・気分タグ・評価・値段＋自分で作った穴場は
  //   住所/営業時間/最寄駅/期間も）。写真は変更しない。
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
          // 場所情報（住所/営業時間/最寄駅/期間）＝自分で作った穴場(placeEditable)のみ編集可
          setPlaceEditable(!!d.post.placeEditable);
          setAddress(String(d.post.address ?? ''));
          setStation(String(d.post.station ?? ''));
          setAvailFrom(String(d.post.availableFrom ?? '').slice(0, 10));
          setAvailUntil(String(d.post.availableUntil ?? '').slice(0, 10));
          // 営業時間文字列をピッカーへ復元（"HH:MM〜HH:MM" / "24時間営業"＋（◯曜定休）。旧・自由入力形式は空＝再設定）
          const oh = String(d.post.openingHours ?? '').trim();
          const cm = oh.match(/([月火水木金土日](?:・[月火水木金土日])*)曜定休/);
          if (cm) setClosedDays(cm[1].split('・'));
          const core = oh.replace(/（[^）]*）/g, '').replace(/[月火水木金土日](?:・[月火水木金土日])*曜定休/g, '').trim();
          if (core === '24時間営業') { setIs24h(true); }
          else {
            const m = core.match(/^(\d{1,2}:\d{2})\s*[〜~]\s*(\d{1,2}:\d{2})$/);
            if (m) { setOpenTime(m[1]); setCloseTime(m[2]); }
          }
          // 既存の写真をプレフィル（編集で削除／追加できる）。uri=リモートURL・existing=trueで再アップロードしない
          //   ⚠ get-mine は post.photos に既存URLを返す（d.photos ではなく d.post.photos）
          const ph = Array.isArray(d.post.photos) ? (d.post.photos as unknown[]).filter((u): u is string => typeof u === 'string') : [];
          originalPhotos.current = ph;
          if (ph.length > 0) setImages(ph.map((u) => ({ uri: u, existing: true })));
          if (active) setEditLoaded(true);   // 元投稿の反映完了→この後に下書きを上書き適用
        } else {
          showToast(t.tCannotEditTitle, d?.error ?? t.tCannotEditSub);
          router.back();
        }
      } catch { if (active) { showToast(t.tLoadFailTitle, t.tNetworkSub); setEditLoaded(true); } }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // ── 下書き保存: 誤って戻る/アプリ終了でも続きから ────────────────────────────
  //   「自由入力の新スポット」に加え「編集モード」でも有効（編集途中で戻っても消えない）。
  //   編集はpostIdごとに別キー＝別投稿の編集内容と混ざらない。場所詳細から固定された新規投稿
  //   (paramPlaceId/Name)のみ対象外。
  const draftKey = editMode ? `${POST_DRAFT_KEY}-edit-${editId}` : POST_DRAFT_KEY;
  const draftEnabled = editMode || (!paramPlaceId && !paramPlaceName);
  // 編集モードはサーバーから元投稿を読み込む(get-mine)。その完了後に下書きを上書き適用する
  //   （読み込みと復元が競合して下書きがサーバー値で潰れるのを防ぐ）。新規は即true。
  const [editLoaded, setEditLoaded] = useState(!editMode);
  const draftRestored = useRef(false);
  const clearDraft = () => { AsyncStorage.removeItem(draftKey).catch(() => {}); };

  // 復元（初回のみ）。base64はメモリ節約で保存しない＝画像はuriのみ（送信時にuriから再生成）。
  useEffect(() => {
    if (!draftEnabled) { draftRestored.current = true; return; }
    if (!editLoaded || draftRestored.current) return;   // 編集は元投稿の読込が済んでから復元
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(draftKey);
        const d = raw ? JSON.parse(raw) : null;
        if (d && typeof d === 'object') {
          if (typeof d.spotName === 'string') setSpotName(d.spotName);
          if (typeof d.address === 'string') setAddress(d.address);
          if (typeof d.lat === 'number') setLat(d.lat);
          if (typeof d.lng === 'number') setLng(d.lng);
          // 空配列の下書きでは上書きしない（get-mineで読んだ既存写真を消さない＝旧バグ下書き対策）
          if (Array.isArray(d.images) && d.images.length > 0) setImages(d.images.filter((x: unknown) => !!x && typeof (x as { uri?: unknown }).uri === 'string').map((x: { uri: string; existing?: boolean }) => ({ uri: x.uri, existing: !!x.existing })));
          if (Array.isArray(d.moodTags)) setMoodTags(d.moodTags.filter((x: unknown) => typeof x === 'string'));
          if (typeof d.caption === 'string') setCaption(d.caption);
          if (typeof d.rating === 'number') setRating(d.rating);
          if (typeof d.availFrom === 'string') setAvailFrom(d.availFrom);
          if (typeof d.availUntil === 'string') setAvailUntil(d.availUntil);
          if (typeof d.station === 'string') setStation(d.station);
          if (typeof d.openTime === 'string') setOpenTime(d.openTime);
          if (typeof d.closeTime === 'string') setCloseTime(d.closeTime);
          if (typeof d.is24h === 'boolean') setIs24h(d.is24h);
          if (Array.isArray(d.closedDays)) setClosedDays(d.closedDays.filter((x: unknown): x is string => typeof x === 'string'));
          if (typeof d.priceChip === 'string') setPriceChip(d.priceChip);
          if (typeof d.priceNote === 'string') setPriceNote(d.priceNote);
          if (typeof d.contact === 'string') setContact(d.contact);
          if (d.vis === 'public' || d.vis === 'anon' || d.vis === 'private') setVis(d.vis);
        }
      } catch { /* 破損した下書きは無視 */ }
      draftRestored.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftEnabled, editLoaded]);

  // 保存（復元完了後、入力変更のたびに軽くデバウンス）。内容が空になったら下書きを消す。
  useEffect(() => {
    if (!draftEnabled || !draftRestored.current) return;
    const hasContent = !!(spotName || caption || moodTags.length || images.length || address ||
      rating || priceChip || priceNote || contact || station || availFrom || availUntil ||
      openTime || closeTime || is24h || closedDays.length > 0);
    const h = setTimeout(() => {
      if (hasContent) {
        AsyncStorage.setItem(draftKey, JSON.stringify({
          spotName, address, lat, lng, images: images.map((i) => ({ uri: i.uri, existing: i.existing })),
          moodTags, caption, rating, availFrom, availUntil, station,
          openTime, closeTime, is24h, closedDays, priceChip, priceNote, contact, vis,
        })).catch(() => {});
      } else {
        AsyncStorage.removeItem(draftKey).catch(() => {});
      }
    }, 400);
    return () => clearTimeout(h);
  }, [draftEnabled, spotName, address, lat, lng, images, moodTags, caption, rating, availFrom, availUntil, station, openTime, closeTime, is24h, closedDays, priceChip, priceNote, contact, vis]);

  // スポット名を打つたびに既存placeを検索（被り候補を出す）。空/1文字なら候補クリア。
  const onNameChange = (text: string) => {
    setSpotName(text);
    setNewSpotOk(false);   // 名前を打ち直したら新規確定を解除（既存に一致するかもしれない）
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const qs = new URLSearchParams({ q: text.trim() });
        const c = searchCoords.current;
        if (c) { qs.set('lat', String(c.lat)); qs.set('lng', String(c.lng)); }   // 近い順ランキング用
        const res = await apiFetch(`/api/place-search?${qs.toString()}`);
        const d = await res.json();
        setResults(Array.isArray(d?.places) ? d.places : []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 300);
  };
  // 候補から既存スポットを選択＝その場所への口コミ(moodログ)として投稿
  const pickPlace = (p: PlaceHit) => {
    if (timer.current) clearTimeout(timer.current);
    setPickedId(p.id); setSpotName(p.name); setAddress(p.address ?? '');
    setResults([]); setNewSpotOk(false);
  };
  const clearPicked = () => { setPickedId(''); setSpotName(''); setAddress(''); setResults([]); setNewSpotOk(false); };
  // 「新しいスポットとして追加」を明示確定（候補に無い時だけの入口＝重複抑止）
  const confirmNewSpot = () => {
    if (timer.current) clearTimeout(timer.current);
    setSearching(false); setResults([]); setNewSpotOk(true);
  };

  const pickImages = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t.aPhotoTitle, t.aPhotoMsg, [
          { text: t.cancel, style: 'cancel' }, { text: t.aOpenSettings, onPress: () => Linking.openSettings() },
        ]); return;
      }
      // 上限なし（selectionLimit:0）。多数選択時のメモリ節約でpickerからはbase64を取らず、
      // 送信時に uri から縮小して生成する（submit の ImageManipulator）。
      setPickBusy(true);   // 選択後の取り込み処理中を追加ボタンに表示
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 0, quality: 0.6, exif: false });
      if (!r.canceled && r.assets.length > 0) {
        const add = r.assets.map(a => ({ uri: a.uri }));
        setImages(prev => [...prev, ...add]);   // サムネはonLoadEndまでスピナー表示
      }
    } catch { showToast(t.aErrorTitle, t.aPhotoPickFail); }   // 結果通知はトーストに統一
    finally { setPickBusy(false); }
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
  // 営業時間の時刻ピッカー（開店/閉店）。日付ピッカーと同じ tempDate/showPicker を流用（mode=time）
  const fmtTime = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const openTimePicker = (which: 'open' | 'close') => {
    const cur = which === 'open' ? openTime : closeTime;
    const base = new Date();
    if (cur) { const [h, m] = cur.split(':').map(Number); base.setHours(h || 0, m || 0, 0, 0); }
    else base.setHours(which === 'open' ? 10 : 18, 0, 0, 0);   // 既定: 開店10時/閉店18時
    setTempDate(base);
    setShowPicker(which);
  };
  const applyPickedTime = (d: Date) => {
    const tt = fmtTime(d);
    if (showPicker === 'open') setOpenTime(tt); else if (showPicker === 'close') setCloseTime(tt);
  };
  // 送信用の営業時間文字列: 24時間営業 or 「開店〜閉店」＋休業日は（◯曜定休）で付記（未入力は空）
  const closedPart = closedDays.length > 0 ? `${DAYS_JP.filter(d => closedDays.includes(d)).join('・')}曜定休` : '';
  const hoursCore = is24h ? '24時間営業' : (openTime && closeTime ? `${openTime}〜${closeTime}` : '');
  const composedHours = hoursCore ? (closedPart ? `${hoursCore}（${closedPart}）` : hoursCore) : closedPart;

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
  // 画像をアップロード用に縮小（メイン1440px＋サムネ400px, base64）。新規写真のみ渡す＝既存(existing)は対象外。
  const prepareUploads = (imgs: { uri: string; base64?: string }[]) => Promise.all(imgs.map(async (img) => {
    try {
      const main = await ImageManipulator.manipulateAsync(img.uri, [{ resize: { width: 1440 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const thumb = await ImageManipulator.manipulateAsync(img.uri, [{ resize: { width: 400 } }], { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      return { main: main.base64 ? `data:image/jpeg;base64,${main.base64}` : '', thumb: thumb.base64 ? `data:image/jpeg;base64,${thumb.base64}` : '' };
    } catch {
      // 縮小失敗時は従来どおり元のbase64を送る（サムネ無し）
      return { main: img.base64 ? `data:image/jpeg;base64,${img.base64}` : '', thumb: '' };
    }
  }));
  const doSubmit = async () => {
    // ── 編集モード: 名前・本文・気分・公開範囲・評価・値段・連絡先を更新（最初の投稿と同項目）──
    if (editMode) {
      if (!spotName.trim()) { showToast(t.tSpotNameTitle, t.tSpotNameSub); return; }
      if (!caption.trim()) { showToast(t.tCaptionTitle, t.tCaptionSub); return; }
      if (moodTags.length === 0) { showToast(t.tMoodTitle, t.tMoodSub); return; }
      if (images.length === 0) { showToast(t.tPhotoTitle, t.tPhotoSub); return; }   // 編集でも写真は1枚以上（全削除は不可）
      if (findNgWord(caption) || findNgWord(spotName) || findNgWord(contact)) { showToast(t.tNgTitle, t.tNgSub); return; }
      setSubmitting(true);
      try {
        const deviceId = await getDeviceId();
        // 削除された既存写真＝元にありUIに残っていないもの / 追加＝existingでない新規写真
        const keptUrls = new Set(images.filter((im) => im.existing).map((im) => im.uri));
        const removePhotoUrls = originalPhotos.current.filter((u) => !keptUrls.has(u));
        const newImgs = images.filter((im) => !im.existing);
        const d = await apiFetch('/api/spot-posts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: 30000,
          body: JSON.stringify({
            action: 'update', postId: editId, deviceId,
            placeName: spotName.trim(), visibility: visServer,
            caption: caption.trim(), moodTags,
            rating: rating > 0 ? rating : undefined,
            priceChip: priceChip || undefined,
            priceNote: priceNote.trim() || undefined,
            contact: contact.trim() || undefined,
            removePhotoUrls,
            // 自分で作った穴場のみ場所情報も更新（サーバー側で source_type=user を確認）
            ...(placeEditable ? {
              address: address.trim(),
              openingHours: composedHours,
              station: station.trim(),
              availableFrom: availFrom.trim(),
              availableUntil: availUntil.trim(),
            } : {}),
          }),
        }).then((r) => r.json());
        if (!d?.ok) { setSubmitting(false); showToast(t.tUpdateFailTitle, d?.error ?? t.tRetrySub); return; }
        // 追加した新規写真を1枚ずつアップロード（既存はexisting=trueなので対象外・失敗しても本文更新は成立）
        if (newImgs.length > 0) {
          const preparedNew = (await prepareUploads(newImgs)).filter((p2) => p2.main);
          for (const p2 of preparedNew) {
            try {
              await apiFetch('/api/spot-posts', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: 30000,
                body: JSON.stringify({ action: 'add-photo', deviceId, postId: editId, image: p2.main, thumbImage: p2.thumb }),
              });
            } catch { /* best-effort: 追記失敗は更新全体を失敗にしない */ }
          }
        }
        setSubmitting(false);
        clearDraft(); markFeedStale(); setDone(true);   // 下書き破棄＋フィード再取得（写真/公開範囲/名前の変更を反映）
      } catch { setSubmitting(false); showToast(t.tUpdateFailSub2Title, t.tNetworkSub); }
      return;
    }

    // バリデーションはフォームの並び順（名前→紹介文→気分→…→場所）に合わせる＝下の項目のエラーが先に出ない
    if (!isExisting && !spotName.trim()) { showToast(t.tSpotNameTitle, t.tSpotNameSub); return; }
    // 候補選択の必須化: 既存を選ばない投稿は「新しいスポットとして追加」の明示確定が必要（重複抑止・2026-07-14）。
    //   場所詳細から来た placeName のみのケース(lockedFromParam)は既知の場所なので免除。
    if (!isExisting && !lockedFromParam && !newSpotOk) { showToast(t.tPickTitle, t.tPickSub); return; }
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
    // 期間限定イベント派生スポット: 既存スポットに期間を設定したら「イベント名＠元スポット」を新スポット化。
    //   期間を入れたのにイベント名が空なら必須エラー。
    const isEventPost = isExisting && !editMode && !!(availFrom.trim() || availUntil.trim());
    if (isEventPost && !eventName.trim()) { showToast(t.tEventNameTitle, t.tEventNameSub); return; }
    if (isEventPost && !availUntil.trim()) { showToast(t.tEventEndTitle, t.tEventEndSub); return; }
    // 新スポットで公開期間を設定したら「何の期間限定か」を必須に（マスト）＝投稿先頭に付ける
    const newPeriodLabel = (!isExisting && !editMode && (availFrom.trim() || availUntil.trim())) ? eventName.trim() : '';
    if (!isExisting && !editMode && (availFrom.trim() || availUntil.trim()) && !newPeriodLabel) { showToast(t.tEventNameTitle, t.tEventNameSub); return; }
    setSubmitting(true);
    try {
      const deviceId = await getDeviceId();
      const posterName = (await AsyncStorage.getItem('moodgo-group-nickname'))?.trim() || undefined;
      // 画像はクライアントで縮小してから送る（メイン1440px＋サムネ400px）。新規投稿は全imagesが対象。
      const prepared = await prepareUploads(images);
      const valid = prepared.filter(p2 => p2.main);
      if (valid.length === 0) { showToast(t.tPhotoTitle, t.tPhotoSub); setSubmitting(false); return; }
      // 画像上限なし対応: create は1枚だけ送り（Vercelのボディ上限回避）、残りは add-photo で1枚ずつ追記。
      const first = valid[0];
      const rest = valid.slice(1);
      // 期間限定イベントは「イベント名＠元スポット」を新スポットとして作る（元の場所は無変更・写真も分離）。
      const derivedName = isEventPost ? `${eventName.trim()}＠${spotName}`.slice(0, 190) : spotName;
      // 投稿は全て spot-posts に一本化。新スポット(placeId無し)はAPI側でplacesに仮登録され、admin承認で検索に出る。
      // ⚠ 価格/おすすめ度は独立フィールドで送る（captionへの【目安価格】【おすすめ度】埋め込みは廃止＝
      //    検索カードの説明が汚れない・除去処理も不要）。
      const res = await apiFetch('/api/spot-posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: 30000,
        body: JSON.stringify({
          action: 'create', deviceId, posterName,
          // イベント: placeId無し(=新スポット化)＋parentPlaceIdで元スポットの位置を継承。写真は新スポットに紐づく。
          placeId: isEventPost ? undefined : (existingPlaceId || undefined),
          parentPlaceId: isEventPost ? (existingPlaceId || undefined) : undefined,
          placeName: derivedName, address,
          lat: lat ?? undefined, lng: lng ?? undefined,
          // 名前を出して公開(public)=投稿者カード/プロフィール/フォロー対象。匿名は本人特定不可のまま公開。
          caption: newPeriodLabel ? `【${newPeriodLabel}】${caption.trim()}` : caption.trim(), moodTags, visibility: visServer,
          canUseAsSpotPhoto: true, licenseDeclared: true, images: [first.main], thumbImages: [first.thumb],
          priceChip: priceChip || undefined,
          priceNote: priceNote.trim() || undefined,
          rating: rating > 0 ? rating : undefined,
          contact: contact.trim() || undefined,
          // 新スポット(穴場)＝営業時間/最寄駅/期間を送る。既存スポットへのmoodログでは送らない(既存placeを上書きしない)。
          //   イベント派生スポットは新スポット扱いなので営業時間・期間を送る。
          openingHours: (!isExisting || isEventPost || hoursMissing) ? (composedHours || undefined) : undefined,
          station: (!isExisting || spotIncomplete) ? (station.trim() || undefined) : undefined,
          // 既存スポットの未登録項目を投稿者入力で補完（サーバー側で「空の項目だけ」埋める）
          completePlace: isExisting && spotIncomplete,
          availableFrom: (!isExisting || isEventPost) ? (availFrom.trim() || undefined) : undefined,
          availableUntil: (!isExisting || isEventPost) ? (availUntil.trim() || undefined) : undefined,
        }),
      });
      const d = await res.json();
      if (!d?.ok) { showToast(t.tPostFailTitle, d?.error ?? t.tRetrySub); setSubmitting(false); return; }
      // 残りの写真を1枚ずつ追記（本人のみ・各リクエストは軽量）。失敗しても1枚は保存済で投稿は成立。
      const newPostId = String(d.id ?? '');
      if (newPostId && rest.length > 0) {
        for (const p2 of rest) {
          try {
            await apiFetch('/api/spot-posts', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, timeoutMs: 30000,
              body: JSON.stringify({ action: 'add-photo', deviceId, postId: newPostId, image: p2.main, thumbImage: p2.thumb }),
            });
          } catch { /* best-effort: 追記失敗は投稿全体を失敗にしない */ }
        }
      }
      setSubmitting(false);
      clearDraft();      // 投稿成功＝下書きを破棄
      markFeedStale();   // 新規投稿をフィードに反映（次のフィード表示で再取得）
      // 投稿した＝いいね/行った！の通知を受け取る側になる文脈なので、ここで
      // プッシュ通知の許可＋トークン登録を行う（拒否済み/シミュレータはno-op）
      registerForPushNotificationsAsync().catch(() => {});
      if (typeof d.linkedTo === 'string' && d.linkedTo) setLinkedTo(d.linkedTo);   // 近接＋表記ゆれで既存スポットにまとめられた
      setDone(true);   // 完了画面へ切替（トースト+即戻るをやめ、受付を明確に伝える）
    } catch { showToast(t.tPostFailSub2Title, t.tPostFailSub2); setSubmitting(false); }
  };

  // 二重送信防止: ボタンの disabled={submitting} は state 更新が非同期で連打の2回目に間に合わない。
  //   同期の ref で「送信中は2回目以降を無視」。成功/失敗/バリデーション落ち後は finally で必ず解除。
  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try { await doSubmit(); } finally { submittingRef.current = false; }
  };

  // 写真グリッドは横4列: 実測幅から (幅 - gap×3) / 4 でセル幅を出す（未測定は概算82）
  const photoCell = gridW > 0 ? Math.floor((gridW - 30) / 4) : 82;

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
          {/* 液体サクセスアニメーション（円のみ差し替え・レイアウト/文字/ボタンは不変） */}
          <LiquidSuccess size={84} colors={GRAD} style={{ marginBottom: 6 }} />
          <Text style={s.doneTitle}>{editMode ? t.doneEditTitle : t.donePostTitle}</Text>
          <Text style={s.doneSub}>
            {editMode
              ? t.doneEditSub
              : linkedTo
              ? t.doneLinkedSub(linkedTo)
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
          ) : newSpotOk ? (
            // 「新しいスポットとして追加」を確定済み（変更で候補選択へ戻れる）
            <View style={s.pickedRow}>
              <Plus size={15} color="#7C3AED" strokeWidth={2.6} />
              <View style={{ flex: 1 }}>
                <Text style={[s.pickedText, { flex: 0 }]} numberOfLines={1}>{spotName}</Text>
                <Text style={s.newSpotTag}>{t.newSpotBadge}</Text>
              </View>
              <TouchableOpacity onPress={() => setNewSpotOk(false)} hitSlop={8}><Text style={s.changeBtn}>{t.change}</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={s.searchWrap}>
                <Search size={16} color="#A78BCA" strokeWidth={2.2} />
                <TextInput style={s.searchInput} value={spotName} onChangeText={onNameChange} placeholder={t.spotNamePh} placeholderTextColor="#B9ABD2" />
                {searching && <ActivityIndicator size="small" color="#9B6BFF" />}
              </View>
              {/* 場所は必ずこの候補から選ぶ（重複抑止）。見つからない時だけ下の「新しいスポットとして追加」 */}
              {spotName.trim().length >= 2 && (
                <View style={s.suggestBox}>
                  <Text style={s.suggestHint}>{searching ? t.searchingHint : results.length > 0 ? t.dupHint : t.noHitHint}</Text>
                  {results.map(p => (
                    <TouchableOpacity key={p.id} onPress={() => pickPlace(p)} style={s.resultRow} activeOpacity={0.8}>
                      <MapPin size={14} color="#7C3AED" strokeWidth={2.2} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.resultName} numberOfLines={1}>{p.name}</Text>
                        {p.address ? <Text style={s.resultAddr} numberOfLines={1}>{p.address}</Text> : null}
                      </View>
                      {typeof p.dist === 'number' ? (
                        <Text style={s.resultDist}>{p.dist < 1 ? `${Math.max(100, Math.round(p.dist * 1000))}m` : `${p.dist.toFixed(1)}km`}</Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity onPress={confirmNewSpot} style={s.addNewRow} activeOpacity={0.85}>
                    <Plus size={15} color="#7C3AED" strokeWidth={2.6} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.addNewText} numberOfLines={1}>{t.addNewSpot(spotName.trim())}</Text>
                      <Text style={s.addNewSub}>{t.addNewSpotSub}</Text>
                    </View>
                  </TouchableOpacity>
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
          <View style={s.autoTagRow}>
            <Tag size={11} color="#7A5CFF" strokeWidth={2.4} />
            <Text style={[s.autoTagHint, { marginTop: 0, flex: 1 }]}>{t.autoTagPre}<Text style={s.autoTagStrong}>#穴場スポット</Text>{t.autoTagMid}<Text style={s.autoTagStrong}>#時間潰し</Text>{t.autoTagPost}</Text>
          </View>
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
          {!isExisting && (!editMode || placeEditable) && (
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
              {/* 期間を設定したら「何の期間限定か」を必須で書いてもらう（マスト） */}
              {(availFrom || availUntil) ? (
                <>
                  <Text style={[s.label, { marginTop: 14 }]}>{t.periodWhatLabel}<Text style={s.req}>*</Text></Text>
                  <TextInput style={[s.input, { minHeight: 48 }]} value={eventName} onChangeText={setEventName} placeholder={t.periodWhatPh} placeholderTextColor="#B9ABD2" maxLength={60} />
                  <Text style={s.note}>{t.periodWhatNote}</Text>
                </>
              ) : null}
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

          {/* ⑥.5 期間限定イベント・ポップアップ（既存スポットへの投稿時のみ）。
              期間を設定すると「イベント名＠元スポット」を新スポット化＝写真も分離・期限で自動削除。 */}
          {isExisting && !editMode && (
            <>
              <Text style={s.label}>{t.eventLabel}</Text>
              <Text style={s.hint}>{t.eventHint}</Text>
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
              {(availFrom || availUntil) ? (
                <>
                  <Text style={[s.label, { marginTop: 14 }]}>{t.eventNameLabel}<Text style={s.req}>*</Text></Text>
                  <TextInput style={[s.input, { minHeight: 48 }]} value={eventName} onChangeText={setEventName} placeholder={t.eventNamePh} placeholderTextColor="#B9ABD2" maxLength={60} />
                  {eventName.trim() ? <Text style={s.note}>{t.eventNamePreview(eventName.trim(), spotName)}</Text> : null}
                  <Text style={[s.note, { color: '#C2410C' }]}>{t.eventEndNote}</Text>
                </>
              ) : null}
            </>
          )}

          {/* ⑦ 場所・住所（新スポットのみ必須: 現在地 or 住所・編集では非表示） */}
          {(!isExisting || spotIncomplete) && (!editMode || placeEditable) && (
            <>
              {isExisting && <Text style={[s.hint, { marginBottom: 6 }]}>{t.completeHint}</Text>}
              <Text style={s.label}>{t.addrLabel}{!isExisting && <Text style={s.req}>*</Text>}</Text>
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
              {/* 営業時間: 開店/閉店の時刻ピッカー＋24時間トグル（自由入力の表示崩れを根絶し統一） */}
              <Text style={[s.label, { marginTop: 14 }]}>{t.hoursLabel}</Text>
              {is24h ? (
                <TouchableOpacity style={[s.input, s.dateBtn, { minHeight: 48, marginTop: 8 }]} onPress={() => setIs24h(false)} activeOpacity={0.8}>
                  <Clock size={15} color="#9B6BFF" strokeWidth={2.2} />
                  <Text style={[s.dateBtnText, { flex: 1 }]}>{t.hours24}</Text>
                  <X size={14} color="#B9ABD2" />
                </TouchableOpacity>
              ) : (
                <View style={s.periodRow}>
                  <TouchableOpacity style={[s.input, s.dateBtn, { flex: 1, minHeight: 48 }]} onPress={() => openTimePicker('open')} activeOpacity={0.8}>
                    <Clock size={15} color="#9B6BFF" strokeWidth={2.2} />
                    <Text style={[s.dateBtnText, !openTime && s.dateBtnPh, { flex: 1 }]} numberOfLines={1}>{openTime || t.hoursOpen}</Text>
                    {openTime ? <TouchableOpacity onPress={() => setOpenTime('')} hitSlop={8}><X size={14} color="#B9ABD2" /></TouchableOpacity> : null}
                  </TouchableOpacity>
                  <Text style={s.periodTilde}>〜</Text>
                  <TouchableOpacity style={[s.input, s.dateBtn, { flex: 1, minHeight: 48 }]} onPress={() => openTimePicker('close')} activeOpacity={0.8}>
                    <Clock size={15} color="#9B6BFF" strokeWidth={2.2} />
                    <Text style={[s.dateBtnText, !closeTime && s.dateBtnPh, { flex: 1 }]} numberOfLines={1}>{closeTime || t.hoursClose}</Text>
                    {closeTime ? <TouchableOpacity onPress={() => setCloseTime('')} hitSlop={8}><X size={14} color="#B9ABD2" /></TouchableOpacity> : null}
                  </TouchableOpacity>
                </View>
              )}
              {!is24h && (
                <TouchableOpacity onPress={() => { setIs24h(true); setOpenTime(''); setCloseTime(''); }} activeOpacity={0.7} style={{ alignSelf: 'flex-start', marginTop: 8 }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#9B6BFF' }}>＋ {t.hours24}</Text>
                </TouchableOpacity>
              )}
              {/* 休業日（定休の曜日・任意）: 「（水曜定休）」として営業時間に保存され検索カード/詳細に表示される */}
              <Text style={[s.label, { marginTop: 14 }]}>{t.closedLabel}</Text>
              <View style={s.dayChipRow}>
                {DAYS_JP.map((d) => (
                  <TouchableOpacity key={d} activeOpacity={0.8}
                    onPress={() => setClosedDays(p => (p.includes(d) ? p.filter(x => x !== d) : [...p, d]))}
                    style={[s.dayChip, closedDays.includes(d) && s.dayChipOn]}>
                    <Text style={[s.dayChipText, closedDays.includes(d) && s.dayChipTextOn]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={[s.input, { marginTop: 12, minHeight: 48 }]} value={station} onChangeText={setStation} placeholder={t.stationPh} placeholderTextColor="#B9ABD2" />
            </>
          )}

          {/* ⑧ 写真: 新規は1枚以上必須／編集時も既存の削除＋新規追加ができる（圧縮base64送信） */}
          <Text style={s.label}>{t.photoLabel}{!editMode && <Text style={s.req}>*</Text>}</Text>
          <Text style={s.hint}>{editMode ? t.editPhotoHint : t.photoHint}</Text>
          <View style={s.photoGrid} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
            {images.map((im, i) => (
              <View key={`${im.uri}-${i}`} style={[s.thumbWrap, { width: photoCell }]}>
                <Image source={{ uri: im.uri }} style={[s.thumb, { width: photoCell, height: photoCell }]}
                  onLoadEnd={() => setThumbLoaded(p => ({ ...p, [im.uri]: true }))} />
                {/* 読込完了までスピナー＝「追加/保存中」を明示（写真が付いたか分かる） */}
                {!thumbLoaded[im.uri] && (
                  <View style={s.thumbLoading}><ActivityIndicator size="small" color="#9B6BFF" /></View>
                )}
                <TouchableOpacity style={s.thumbX} onPress={() => setImages(prev => prev.filter((_, j) => j !== i))}><X size={13} color="#fff" /></TouchableOpacity>
              </View>
            ))}
            {/* 枚数上限なし＝追加ボタンは常時表示（横4列で折り返す） */}
            <TouchableOpacity style={[s.addPhoto, { width: photoCell, height: photoCell }]} onPress={pickImages} activeOpacity={0.8} disabled={pickBusy}>
              {pickBusy ? <ActivityIndicator size="small" color="#A78BCA" /> : <><Camera size={22} color="#A78BCA" /><Text style={s.addPhotoText}>{t.addPhoto}</Text></>}
            </TouchableOpacity>
          </View>
          {editMode && <Text style={[s.note, { marginTop: 10 }]}>{t.editNote}</Text>}

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
      {showPicker !== null && (() => {
        const isTime = showPicker === 'open' || showPicker === 'close';
        const commit = (d: Date) => { if (isTime) applyPickedTime(d); else applyPickedDate(d); };
        const title = showPicker === 'from' ? t.pickerFromTitle
          : showPicker === 'until' ? t.pickerUntilTitle
          : showPicker === 'open' ? t.hoursOpen : t.hoursClose;
        return Platform.OS === 'ios' ? (
          <View style={s.pickerOverlay}>
            <View style={s.pickerSheet}>
              <Text style={s.pickerTitle}>{title}</Text>
              <DateTimePicker
                value={tempDate}
                mode={isTime ? 'time' : 'date'}
                display={isTime ? 'spinner' : 'inline'}
                locale="ja-JP"
                minuteInterval={isTime ? 5 : undefined}
                onChange={(_e, d) => { if (d) setTempDate(d); }}
                style={{ alignSelf: 'stretch' }}
                accentColor="#9B6BFF"
                textColor="#1E0753"
                themeVariant="light"
              />
              <View style={s.pickerBtns}>
                <TouchableOpacity onPress={() => setShowPicker(null)} style={s.pickerCancel} activeOpacity={0.8}>
                  <Text style={s.pickerCancelText}>{t.cancel}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { commit(tempDate); setShowPicker(null); }} style={s.pickerOk} activeOpacity={0.8}>
                  <Text style={s.pickerOkText}>{t.pickerOk}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <DateTimePicker
            value={tempDate}
            mode={isTime ? 'time' : 'date'}
            minuteInterval={isTime ? 5 : undefined}
            onChange={(e, d) => { if (e.type === 'set' && d) commit(d); setShowPicker(null); }}
            themeVariant="light"
          />
        );
      })()}
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
  addNewRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 8, borderWidth: 1.2, borderColor: '#CDB6F2', borderStyle: 'dashed' },
  addNewText: { fontSize: 13.5, fontWeight: '800', color: '#7C3AED' },
  addNewSub: { fontSize: 10.5, color: '#9B89BE', fontWeight: '600', marginTop: 2 },
  resultDist: { fontSize: 11, fontWeight: '800', color: '#7C3AED' },
  newSpotTag: { fontSize: 10.5, color: '#9B89BE', fontWeight: '700', marginTop: 2 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6, borderWidth: 1, borderColor: '#EFE8FB' },
  resultName: { fontSize: 14, fontWeight: '700', color: '#2A2235' },
  resultAddr: { fontSize: 11.5, color: '#9B89BE', marginTop: 2 },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#F3EEFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#E3D8F5' },
  pickedText: { flex: 1, fontSize: 15, fontWeight: '800', color: '#7C3AED' },
  changeBtn: { color: '#7C3AED', fontSize: 12, fontWeight: '800' },
  addrRow: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' },
  locBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#7C3AED', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 },
  locBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },   // 折り返し＝5枚目以降も全て表示
  thumbLoading: { ...StyleSheet.absoluteFillObject, borderRadius: 12, backgroundColor: 'rgba(240,236,248,0.72)', alignItems: 'center', justifyContent: 'center' },
  thumbWrap: { position: 'relative' },
  thumb: { width: 88, height: 88, borderRadius: 12, backgroundColor: '#EEE' },
  thumbX: { position: 'absolute', top: -6, right: -6, backgroundColor: '#1E0753', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: 88, height: 88, borderRadius: 12, borderWidth: 1.5, borderColor: '#E3D8F5', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: '#fff' },
  addPhotoText: { fontSize: 11, color: '#A78BCA', fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 16, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#fff' },
  dayChipRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  dayChip: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: '#E3D8F5', borderRadius: 12, paddingVertical: 9, backgroundColor: '#fff' },
  dayChipOn: { backgroundColor: '#9B6BFF', borderColor: '#9B6BFF' },
  dayChipText: { fontSize: 13, fontWeight: '700', color: '#7A6B99' },
  dayChipTextOn: { color: '#fff' },
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
  autoTagRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 8 },
  autoTagHint: { fontSize: 11.5, color: '#7A5CFF', marginTop: 8, lineHeight: 16, fontWeight: '600' },
  autoTagStrong: { fontWeight: '800', color: '#7C3AED' },
  gotLoc: { fontSize: 12, color: '#16A34A', fontWeight: '700', marginTop: 8 },
  // 完了画面
  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  doneTitle: { fontSize: 20, fontWeight: '800', color: '#1E0753' },
  doneSub: { fontSize: 13.5, color: '#6B5E85', textAlign: 'center', lineHeight: 21 },
  doneBtnWrap: { marginTop: 14, alignSelf: 'stretch', borderRadius: 16, overflow: 'hidden' },
  doneBtn: { paddingVertical: 15, alignItems: 'center', borderRadius: 16 },
  doneBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
});
