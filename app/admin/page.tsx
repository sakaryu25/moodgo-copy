"use client";

import { useEffect, useRef, useState } from "react";
import { TAG_CATEGORIES, MOOD_TAGS, ALL_PREDEFINED_TAGS } from "@/lib/predefined-tags";

const ADMIN_PASSWORD = "moodgoadmin123";

type StatsData = {
  totalCount: number;
  avgRating: number | null;
  topPlaces: Array<{ name: string; heartCount: number; mapCount: number; totalEngagement: number }>;
  topVisited: Array<{ name: string; count: number }>;
  similarGoodVisited: Array<{ name: string; avgRating: number | null; goodCount: number; badCount: number; totalCount: number }>;
  similarBadVisited: string[];
  moodStats: Record<string, { count: number; avgRating: number | null }>;
  ageStats: Record<string, { count: number; avgRating: number | null }>;
  recentFeedback: Array<{
    mood: string;
    area: string;
    age: string;
    gender: string;
    rating: number;
    visited_place: string;
    top_recommendations: string[];
    created_at: string;
  }>;
};

type PlaceCandidate = {
  placeId: string;
  name: string;
  address: string;
  mapsUri: string;
  types: string[];
  rating: number | null;
  userRatingCount: number | null;
};

type Suggestion = {
  id: string;
  created_at: string;
  spot_name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  contact: string | null;
  image_urls: string[];
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  google_place_id: string | null;
  google_maps_uri: string | null;
  google_place_name: string | null;
  auto_tags: string[] | null;
  source?: string;
  is_chain?: boolean;
  available_from?: string | null;
  available_until?: string | null;
};

type FeedbackRecord = {
  id: string;
  mood: string | null;
  area: string | null;
  age: string | null;
  gender: string | null;
  companion: string | null;
  atmosphere: string | null;
  priority: string | null;
  top_recommendations: string[];
  rating: number | null;
  visited_place: string | null;
  liked_places: string[];
  map_clicked_places: string[];
  created_at: string;
};

type ReportRecord = {
  id: string;
  spot_name: string;
  spot_address: string | null;
  reason: string;
  note: string | null;
  created_at: string;
  status?: string; // "blocked" | null
};

const font = '"Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';

// ─── 開発ログ用データ（モジュールレベル定数） ───────────────────────────────
type TodoEntry = { id: string; text: string; done: boolean };

type DevRequest = { id: string; date: string; summary: string };

const DEVLOG_REQUESTS: DevRequest[] = [
  { id: "r01", date: "2026-04-11", summary: "質問内容に困った時用のスキップボタンを各ステップに追加してほしい" },
  { id: "r02", date: "2026-04-11", summary: "AIを使った最適な場所検索を実装してほしい。またスマホ画面でも綺麗に見えるUI にしてほしい" },
  { id: "r03", date: "2026-04-11", summary: "OpenAIのプロンプトを改善して検索精度を上げてほしい。年齢・性別の質問を追加してほしい。スキップ時は「未選択」扱いにしてほしい。フィードバックを収集してAIに学習させる仕組みを作ってほしい" },
  { id: "r04", date: "2026-04-11", summary: "「前回どこへ行きましたか？」を次回のアプリ起動時に最初に聞くようにしてほしい。予算をスキップした場合は「未定」として料金を気にせず検索できるようにしてほしい" },
  { id: "r05", date: "2026-04-11", summary: "admin専用の閲覧画面を新設してほしい。高評価ランキングの基準をサイト内ハート（goodボタン）またはGoogleマップへ飛んだ場合のみにしてほしい。前回行った場所を記入できる欄をポップアップで画面中央に出してほしい" },
  { id: "r06", date: "2026-04-11", summary: "気分だけでなく性別・年齢・同行者・交通手段・雰囲気・自由ワードをすべてAIに渡して検索精度を上げてほしい。過去の利用者データを次の人のおすすめに活かしてほしい" },
  { id: "r07", date: "2026-04-11", summary: "質問の順番を変えてほしい。年齢・性別を一番最初、現在地を最後にしてほしい" },
  { id: "r08", date: "2026-04-11", summary: "Supabaseと連携してフィードバックデータを蓄積し、AIの学習に活用できる仕組みにしてほしい。adminページでデータを確認できるようにしてほしい" },
  { id: "r09", date: "2026-04-11", summary: "ユーザーが穴場スポットを投稿できるページを作ってほしい（画像・位置情報付き）。内容は管理者だけが見られて、承認したものを検索結果に反映できるようにしてほしい。adminページにパスワードを設定してほしい（moodgoadmin123）" },
  { id: "r10", date: "2026-04-11", summary: "管理者が投稿を承認する際にGoogleマップと紐付けてほしい。「なぜおすすめか」の理由表示と、駐車場○時間無料などのタグを自動提案してほしい。検索結果にランダム性を持たせてほしい" },
  { id: "r11", date: "2026-04-11", summary: "検索結果の各スポットにグッド/バッド評価を追加してほしい。バッド評価は「その気分のときにこの場所はナシ」という意味でAIに学習させてほしい" },
  { id: "r12", date: "2026-04-11", summary: "予算を双方向スライダー（最小〜最大の範囲指定）にしてほしい。最大3万円まで。スライダーの間の色付けを正確にしてほしい" },
  { id: "r13", date: "2026-04-11", summary: "現在地の精度を番地まで詳細に表示してほしい。重複するスポットを1つにまとめてほしい。過去に見たことがない場所だけを表示するフィルターを追加してほしい" },
  { id: "r14", date: "2026-04-12", summary: "検索結果の画像を1枚だけでなく複数枚表示してほしい。画像の前後ナビゲーション（矢印ボタン）を追加してほしい" },
  { id: "r15", date: "2026-04-12", summary: "価格表示を「何円で利用可能」などわかりやすく表示してほしい。現在地の市を省略せず正確に表示してほしい" },
  { id: "r16", date: "2026-04-12", summary: "バッド評価は「場所が悪い」ではなく「この気分のときはこの場所はナシ」という意味でAIに正しく学習させてほしい。自由ワードをAI検索にしっかり活用してほしい" },
  { id: "r17", date: "2026-04-13", summary: "Googleマップに載っていない場所を管理者が画像付きで追加できるようにしてほしい。「○○駅から徒歩○分」の表示を追加してほしい" },
  { id: "r18", date: "2026-04-14", summary: "検索結果に表示される駅名を日本語に変換してほしい。最寄り駅から正確な徒歩時間を表示してほしい" },
  { id: "r19", date: "2026-04-14", summary: "各スポットカードにワンタップで英語に翻訳できるボタンを追加してほしい" },
  { id: "r20", date: "2026-04-14", summary: "営業時間APIで閉店中のスポットは検索結果に出さないようにしてほしい。天気APIで屋外スポットが天候に合わない場合はAIが判断して除外してほしい" },
  { id: "r21", date: "2026-04-14", summary: "管理者がスポットを追加する際にチェーン店に対応してほしい（例：全国のIKEAを一括で検索結果に載せるなど）" },
  { id: "r22", date: "2026-04-15", summary: "気分の選択結果によってステップ7・8の質問内容を変えてほしい。気分を深掘りできるランダムな質問を出してAIがより的確な場所を提案できるようにしてほしい" },
  { id: "r23", date: "2026-04-15", summary: "気分の深掘り質問（ステップ7・8）の回答をAIのおすすめ生成プロンプトに渡して活用してほしい" },
  { id: "r24", date: "2026-04-15", summary: "履歴を見るボタンを押した際、その履歴をタップしたら過去に出た検索結果をまるまる表示させてほしい" },
  { id: "r25", date: "2026-04-15", summary: "管理者画面にスポット追加した一覧を表示してほしい。訪問学習データを管理者が手作業で登録できる新しいページを作ってほしい" },
  { id: "r26", date: "2026-04-15", summary: "訪問学習データのページに、場所を検索するとAIが気分・エリア・雰囲気などを自動入力してくれる仕組みを作ってほしい。管理者スポット一覧に削除・編集機能をつけてほしい" },
  { id: "r27", date: "2026-04-15", summary: "質問内容など海外の人にもわかるよう、全画面を英語にも対応させてほしい（🌐ボタンで日英切替）" },
  { id: "r28", date: "2026-04-15", summary: "今まで行ってきた改善内容を別ページにチェックリストとToDoリストとして見やすくまとめてほしい" },
  { id: "r29", date: "2026-04-15", summary: "開発ログをadminページ内に移動してほしい。チェックリストは私のリクエスト内容のみ時系列で。ToDoは自由に投稿・編集できるようにしてほしい。全リクエストを網羅して完了済みにしてほしい" },
  { id: "r30", date: "2026-04-16", summary: "今の気分「スカッと発散したい」を「🚗ドライブしたい」に変更。以降の質問もドライブ向け5問（遠出距離・雰囲気・走る道・目的地での過ごし方・タイムリミット）に刷新" },
  { id: "r31", date: "2026-04-16", summary: "管理者スポットに期間限定公開機能を追加。開始日・終了日をカレンダーで設定でき、期間外スポットは検索結果に自動で表示されなくなる仕組みを実装" },
  { id: "r32", date: "2026-04-16", summary: "絵文字2重問題の修正（ドライブしたいラベルの🚗を1つに）。ドライブ時に交通手段質問を廃止し、ランダム深掘り質問をステップ6/7/8に配置。年代選択を40代以上までに変更" },
  { id: "r33", date: "2026-04-16", summary: "ドライブ30分選択時に実際に30分圏内の場所のみ表示するよう3重対策を実装（locationBias半径制限・durationTextフィルタ・AIプロンプトへの距離指示）" },
  { id: "r34", date: "2026-04-16", summary: "Supabaseのavailable_from/untilカラム未作成エラー(PGRST204)を段階的フォールバックパターンで修正。suggestions POST・GET・PATCHすべてに対応" },
  { id: "r35", date: "2026-04-16", summary: "穴場投稿ページの写真アップロード不具合を修正（iOS SafariでのlabelのhtmlFor方式に変更）。管理者スポット追加でもサムネイルプレビューとアップロード結果フィードバックを追加" },
  { id: "r36", date: "2026-04-17", summary: "気分問わず絶景スポットが出る問題を修正（scenicAllowedMoodsで対象外気分を除外）。検索結果カードに不適切を報告ボタン（mailto）を追加" },
  { id: "r37", date: "2026-04-17", summary: "「遠くに行きたい」の時間選択肢を実際の移動時間（午前中のみ/夕方まで/日跨ぐ前まで/日越してもOK）に変更し、それを移動距離としてAIに渡す。計画スタイル質問を削除" },
  { id: "r38", date: "2026-04-17", summary: "全質問（dynamicQ1/2/3・雰囲気・同行者・交通手段・予算・自由ワードすべて）をAIプロンプトへ漏れなく渡す実装。フィードバックのlocalStorage保存にもdynamicQを含めてパターン学習を強化" },
  { id: "r39", date: "2026-04-17", summary: "訪問済み・閲覧済みスポットの除外フィルタ完全実装（showUnseenOnly）。検索結果後のリファインメント機能（「もっと近い場所で」等の再絞り込み入力）を追加" },
  { id: "r40", date: "2026-04-17", summary: "Google Places APIにeditorialSummary（公式説明文）・goodForChildren・allowsDogs・restroom・駐車場・テラス席などブールフィールドを追加取得。AIの理由生成に活用し、アメニティタグをカードに表示。同行者・交通手段に応じたスコアリング強化" },
  { id: "r41", date: "2026-04-17", summary: "季節コンテキストを自動付加（春:桜・夏:海/花火・秋:紅葉・冬:イルミネーション等）。AIの検索クエリ生成ルールに季節ヒントを追加し、季節に合ったスポットを優先提案するよう改善" },
  { id: "r42", date: "2026-04-17", summary: "ユーザーの好みタイプをpastFeedbackから自動分析してバッジ表示（まったり派・グルメ好き・ドライブ好き等）。気分選択画面の上部に表示し、userPreferenceHintsとしてAIプロンプトに渡して提案精度を向上" },
  { id: "r43", date: "2026-04-17", summary: "ユーザー投稿写真を検索結果カードに表示。承認済みスポットのimage_urlsをuserPhotosMapとして構築し、Google Places写真の前に投稿写真を優先表示。写真が投稿写真の場合「📸 投稿写真」バッジをオーバーレイ表示。管理者スポット・チェーン店・通常結果すべてに対応" },
  { id: "r44", date: "2026-04-17", summary: "不適切報告をmailtoからインアプリ送信に変更。報告ボタン押下でボトムシートモーダルが開き「不適切な検索・好きではない・誤情報・規制対象・その他」から選択して送信。SupabaseのreportsテーブルへPOST。管理者の/adminページに⚠不適切報告タブを追加し理由別フィルターで一覧確認可能" },
  { id: "r45", date: "2026-04-17", summary: "交通手段を複数選択可能に変更（string[]化）。「電車のみ選択時は駅徒歩圏内のみ」「車なしは山奥・郊外除外」など交通手段ごとの制約をAIシステムプロンプトに追加。時間選択から移動距離を逆算（6時間以上は遠出スポット必須、30分以内は超近場のみ等）してAIプロンプトとスコアリング（durationSecondsベースのペナルティ）両方に反映。TRANSITモード（電車・バス選択時）対応" },
  { id: "r46", date: "2026-04-19", summary: "「徒歩のみ」→「徒歩」に表示変更。検索結果ページの今回の条件をチップ/タグレイアウトに刷新（気分アイコンをSVG imgで表示・ドライブ時は交通手段チップ非表示・お腹すいた時は距離感ラベルを表示するなど気分ごとに最適化）" },
  { id: "r47", date: "2026-04-19", summary: "グルナビ API v3・ホットペッパーグルメ API v1 をお腹すいたモードに統合。外部フード結果を ScoredItem に正規化してGooglePlaces結果とマージ。コンパニオン・雰囲気・時間帯スコアリングを適用" },
  { id: "r48", date: "2026-04-19", summary: "お腹すいたの動的質問（空腹度・食べたい味・食べたいジャンル・お店の雰囲気）の回答をAIクエリ・extraFoodPlans・グルナビ/ホットペッパーのキーワード引数すべてに反映。公園・自然スポット等の非食スポットをSTRICT_NON_FOOD_TYPESで完全除外" },
  { id: "r49", date: "2026-04-19", summary: "ドライブしたいの距離表示アイコンが🚶になっていたバグを修正（travelIcon変数を新設し気分・交通手段から動的に🚗/🚃/🚌/🚶を決定）。PRICE_LEVEL_EXPENSIVEなど生文字列がカードに表示されるバグを修正（表示側に.startsWith('PRICE_LEVEL')ガードを追加）" },
  { id: "r50", date: "2026-04-19", summary: "夜ドライブ+休憩モードで閉店中スポットが出る問題を修正。foodバケットの閉店中を hard filter で除外。openItemsをclosedItemsより常に優先ソート。「休憩（チル）」キーワードを24時間営業施設向けに変更" },
  { id: "r51", date: "2026-04-19", summary: "外部スポットAPI検討の結果、OpenStreetMap Overpass API（無料・APIキー不要）を統合。自然・展望台・道の駅・温泉など Google が苦手なスポットを補完。ドライブしたい・体を動かしたい・遠くに行きたいで有効化。Yahoo!ローカルサーチAPIは実装済みだがキー設定は後回し" },
  { id: "r52", date: "2026-04-20", summary: "ドライブしたいのランダム質問に「道路は？（一般道メイン🛣️ / 高速も使う🏎️）」を追加。道路種別に応じてAI到達距離説明文・locationBias半径・Durationフィルタをそれぞれ変更（一般道~40km/h・高速~90km/h基準）。DYNAMIC_ANSWER_KEYWORDSにも「道路は？」エントリを追加" },
  { id: "r53", date: "2026-04-20", summary: "開発ログに未登録だった r46〜r52 の全改善内容を追加。/devlogページを廃止してadmin画面の開発ログタブに一本化" },
  { id: "r54", date: "2026-04-21", summary: "質問フローを全面刷新。新気分「🍀 自然感じたい」を追加（海・川・湖/山・森/花畑/夕日の4問プール）。ランダム質問を2問→3問に増加。ドライブしたいのプールをdrive_distance(固定)+road_type/vibe/road/goalの4択ランダムに変更。道路は？に「どちらでも」選択肢追加。走りたい道は？にemoji追加。遠くに行きたいに移動ルート・スポット種別の2問追加（5問プール→3問ランダム）。DYNAMIC_ANSWER_KEYWORDSに自然感じたい・遠くに行きたい追加。AIシステムプロンプトに自然感じたい専用ルール追加" },
];

const DEVLOG_ALL_IDS = DEVLOG_REQUESTS.map((r) => r.id);

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [tab, setTab] = useState<"stats" | "suggestions" | "add-spot" | "import" | "visited" | "reports" | "devlog" | "featured" | "geocode" | "merge" | "retag">("stats");

  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState<Record<string, string>>({});

  // Googleマップ紐付け関連
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<Record<string, string>>({});
  const [searchLoading, setSearchLoading] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, PlaceCandidate[]>>({});
  const [selectedCandidate, setSelectedCandidate] = useState<Record<string, PlaceCandidate | null>>({});
  const [tagsLoading, setTagsLoading] = useState<string | null>(null);
  const [editableTags, setEditableTags] = useState<Record<string, string[]>>({});
  const [tagInput, setTagInput] = useState<Record<string, string>>({});

  // 管理者スポット追加フォーム
  const [newSpot, setNewSpot] = useState({
    name: "", description: "", address: "", stationInfo: "", mapUrl: "", tagInput: "",
  });
  const [newSpotTags, setNewSpotTags] = useState<string[]>([]);
  const [newSpotImages, setNewSpotImages] = useState<File[]>([]);
  const [newSpotImagePreviews, setNewSpotImagePreviews] = useState<string[]>([]);
  const [newSpotSubmitting, setNewSpotSubmitting] = useState(false);
  const [newSpotSuccess, setNewSpotSuccess] = useState(false);
  const [newSpotSuccessMsg, setNewSpotSuccessMsg] = useState("");
  const [newSpotError, setNewSpotError] = useState("");
  const newSpotFileInputRef = useRef<HTMLInputElement>(null);
  const [isChain, setIsChain] = useState(false);
  const [chainSearchQuery, setChainSearchQuery] = useState("");
  const [newSpotAvailableFrom, setNewSpotAvailableFrom] = useState("");
  const [newSpotAvailableUntil, setNewSpotAvailableUntil] = useState("");
  // 管理者追加済みスポット一覧
  const [adminSpots, setAdminSpots] = useState<Suggestion[]>([]);
  const [adminSpotsLoading, setAdminSpotsLoading] = useState(false);
  const [deletingSpotId, setDeletingSpotId] = useState<string | null>(null);
  const [editingSpotId, setEditingSpotId] = useState<string | null>(null);
  const [editSpotForm, setEditSpotForm] = useState<{
    name: string; description: string; address: string; stationInfo: string; mapUrl: string; isChain: boolean; chainSearchQuery: string; tags: string[]; availableFrom: string; availableUntil: string;
  }>({ name: "", description: "", address: "", stationInfo: "", mapUrl: "", isChain: false, chainSearchQuery: "", tags: [], availableFrom: "", availableUntil: "" });
  const [editSpotTagInput, setEditSpotTagInput] = useState("");
  const [editSpotSubmitting, setEditSpotSubmitting] = useState(false);
  const [editSpotExistingImages, setEditSpotExistingImages] = useState<string[]>([]);
  const [editSpotNewImages, setEditSpotNewImages] = useState<File[]>([]);
  const [editSpotNewPreviews, setEditSpotNewPreviews] = useState<string[]>([]);
  const editSpotFileInputRef = useRef<HTMLInputElement>(null);

  // タグピッカー開閉 & 重複スポット警告
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [duplicateChecking, setDuplicateChecking] = useState(false);

  // 訪問学習データ管理
  const [visitedData, setVisitedData] = useState<FeedbackRecord[]>([]);
  const [visitedLoading, setVisitedLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [visitedFilter, setVisitedFilter] = useState<"all" | "visited">("visited");

  // 重複統合タブ
  type DupPlace = { id: string; name: string; address: string; tags: string[]; lat: number | null; lng: number | null; google_place_id: string | null; is_active: boolean };
  const [mergeGroups, setMergeGroups] = useState<DupPlace[][]>([]);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeProcessing, setMergeProcessing] = useState<number | null>(null);
  const [mergeKeep, setMergeKeep] = useState<Record<number, string>>({});
  const [mergeResult, setMergeResult] = useState("");

  // 座標登録タブ
  const [geoPlaces, setGeoPlaces] = useState<{ id: string; name: string; address: string; lat: number | null; lng: number | null }[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoUpdating, setGeoUpdating] = useState<string | null>(null);
  const [geoBulkRunning, setGeoBulkRunning] = useState(false);
  const [geoBulkResult, setGeoBulkResult] = useState<string>("");
  const [geoManual, setGeoManual] = useState<Record<string, { lat: string; lng: string }>>({});

  // 一括タグ修正タブ（placesテーブル）
  const [retagAllInfo, setRetagAllInfo] = useState<{ total: number; needsRetag: number } | null>(null);
  const [retagAllLoading, setRetagAllLoading] = useState(false);
  const [retagAllRunning, setRetagAllRunning] = useState(false);
  const [retagAllResult, setRetagAllResult] = useState<{ updated: number; skipped: number; failed: number; results: { name: string; tags: string[]; action: string }[] } | null>(null);
  const [retagAllOverwrite, setRetagAllOverwrite] = useState(false);

  const [newFeedback, setNewFeedback] = useState({
    mood: "", area: "", age: "", gender: "", companion: "",
    atmosphere: "", priority: "", visitedPlace: "", rating: "4",
    topRecommendations: "",
  });
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");

  // 訪問学習 - 場所検索 & AI自動入力
  const [autoFillQuery, setAutoFillQuery] = useState("");
  const [autoFillCandidates, setAutoFillCandidates] = useState<{ placeId: string; name: string; address: string; types: string[] }[]>([]);
  const [autoFillSearching, setAutoFillSearching] = useState(false);
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [autoFillOpen, setAutoFillOpen] = useState(false);

  // ─── 特集ページ管理 ───────────────────────────────────────────────────────
  type RecommendedItem = { name: string; description: string; price: string; image_url: string };
  type FeaturedPageRecord = {
    id: string;
    slug: string;
    partner_name: string;
    spot_name: string;
    catch_copy: string;
    description: string;
    access: string;
    address: string;
    phone: string;
    website: string;
    instagram: string;
    business_hours: string;
    recommended_items: RecommendedItem[];
    features: string[];
    congestion_info: string;
    cover_image_url: string;
    gallery_image_urls: string[];
    tags: string[];
    contract_start: string;
    contract_end: string;
    is_published: boolean;
    created_at: string;
  };
  const emptyFeaturedForm = {
    slug: "", partner_name: "", spot_name: "", catch_copy: "",
    description: "", access: "", address: "", phone: "",
    website: "", instagram: "", business_hours: "",
    congestion_info: "", cover_image_url: "",
    contract_start: "", contract_end: "",
    is_published: false,
    features: [] as string[],
    gallery_image_urls: [] as string[],
    tags: [] as string[],
    recommended_items: [] as RecommendedItem[],
  };
  const [featuredPages, setFeaturedPages] = useState<FeaturedPageRecord[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(false);
  const [featuredError, setFeaturedError] = useState("");
  const [featuredForm, setFeaturedForm] = useState(emptyFeaturedForm);
  const [featuredSubmitting, setFeaturedSubmitting] = useState(false);
  const [featuredSuccess, setFeaturedSuccess] = useState("");
  const [editingFeaturedId, setEditingFeaturedId] = useState<string | null>(null);
  const [deletingFeaturedId, setDeletingFeaturedId] = useState<string | null>(null);
  const [featuredTagInput, setFeaturedTagInput] = useState("");
  const [featuredFeatureInput, setFeaturedFeatureInput] = useState("");
  const [featuredGalleryInput, setFeaturedGalleryInput] = useState("");
  const [featuredItemForm, setFeaturedItemForm] = useState({ name: "", description: "", price: "", image_url: "" });

  // ─── クイック投稿 ────────────────────────────────────────────────────────────
  const [quickModal, setQuickModal] = useState(false);
  const [quickStep, setQuickStep] = useState<"input" | "loading" | "preview">("input");
  const [quickQuery, setQuickQuery] = useState("");
  const [quickPlace, setQuickPlace] = useState<{
    name: string; address: string; phone: string | null; hours: string | null;
    photoUrls: string[]; website: string | null; lat: number; lng: number;
  } | null>(null);
  const [quickAI, setQuickAI] = useState<{
    catch_copy: string; description: string; tags: string[];
    recommended_items: string[];
  } | null>(null);
  const [quickCoverUrl, setQuickCoverUrl] = useState("");
  const [quickAdminHint, setQuickAdminHint] = useState("");
  const [quickTikTokUrl, setQuickTikTokUrl] = useState("");
  const [quickTikTokInfo, setQuickTikTokInfo] = useState<{ title: string; authorName: string } | null>(null);
  const [quickError, setQuickError] = useState("");
  const [quickPublishing, setQuickPublishing] = useState(false);

  const handleQuickFetchPlaces = async () => {
    if (!quickQuery.trim()) { setQuickError("スポット名を入力してください"); return; }
    setQuickStep("loading");
    setQuickError("");
    setQuickTikTokInfo(null);
    try {
      // Step 1: 場所情報取得 + TikTok oEmbed取得（並行）
      const res1 = await fetch("/api/admin/quickpost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "places",
          query: quickQuery.trim(),
          tikTokUrl: quickTikTokUrl.trim() || undefined,
          secret: ADMIN_PASSWORD,
        }),
      });
      const d1 = await res1.json();
      if (!d1.ok) throw new Error(d1.error ?? "場所情報の取得に失敗しました");
      setQuickPlace(d1.place);
      if (d1.place.photoUrls?.length > 0) setQuickCoverUrl(d1.place.photoUrls[0]);

      // TikTok oEmbed 結果を保存
      const tikTokInfo = d1.tikTokInfo as { title: string; authorName: string } | null;
      if (tikTokInfo?.title) setQuickTikTokInfo(tikTokInfo);

      // Step 2: AI生成（TikTok動画コンテキストをしっかり渡す）
      const tikTokContext = tikTokInfo?.title
        ? `動画タイトル: ${tikTokInfo.title}${tikTokInfo.authorName ? ` / 投稿者: ${tikTokInfo.authorName}` : ""}`
        : "";

      const res2 = await fetch("/api/admin/quickpost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "ai_generate",
          placeData: d1.place,
          adminHint: quickAdminHint.trim(),
          tikTokContext,
          secret: ADMIN_PASSWORD,
        }),
      });
      const d2 = await res2.json();
      if (!d2.ok) throw new Error(d2.error ?? "AI生成に失敗しました");
      setQuickAI(d2.ai);
      setQuickStep("preview");
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : String(e));
      setQuickStep("input");
    }
  };

  const handleQuickPublish = async () => {
    if (!quickPlace || !quickAI) return;
    setQuickPublishing(true);
    setQuickError("");
    try {
      const fd = new FormData();
      fd.append("spotName", quickPlace.name);
      fd.append("description", quickAI.description ?? "");
      fd.append("address", quickPlace.address ?? "");
      if (quickPlace.lat) fd.append("lat", String(quickPlace.lat));
      if (quickPlace.lng) fd.append("lng", String(quickPlace.lng));
      fd.append("source", "admin");
      fd.append("secret", ADMIN_PASSWORD);
      fd.append("autoTags", JSON.stringify(quickAI.tags ?? []));
      if (quickPlace.website) fd.append("manualMapUrl", quickPlace.website);
      // カバー画像を先頭にして全写真URLを渡す
      const orderedPhotos = quickCoverUrl
        ? [quickCoverUrl, ...(quickPlace.photoUrls ?? []).filter((u) => u !== quickCoverUrl)]
        : (quickPlace.photoUrls ?? []);
      fd.append("preloadedImageUrls", JSON.stringify(orderedPhotos));

      const res = await fetch("/api/suggestions", { method: "POST", body: fd });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? "公開に失敗しました");

      let successMsg = "クイック投稿で追加しました ✅";

      // ── Supabase places にも登録 ─────────────────────────────────────────
      if (quickRegisterToPlaces && quickAI && quickAI.tags.length > 0) {
        try {
          const orderedPhotos2 = quickCoverUrl
            ? [quickCoverUrl, ...(quickPlace.photoUrls ?? []).filter((u) => u !== quickCoverUrl)]
            : (quickPlace.photoUrls ?? []);
          const plRes = await fetch("/api/admin/places-register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              secret:        ADMIN_PASSWORD,
              name:          quickPlace.name,
              address:       quickPlace.address ?? "",
              lat:           quickPlace.lat ?? null,
              lng:           quickPlace.lng ?? null,
              tags:          quickAI.tags,
              description:   quickAI.description ?? null,
              imageUrls:     orderedPhotos2,
            }),
          });
          const plData = await plRes.json();
          if (plData.duplicate) {
            successMsg += ` ⚠️ Supabase places に同名スポットがすでに存在します（"${plData.existingName}"）`;
          } else if (plData.ok) {
            successMsg += " 🗄 Supabase placesにも登録完了！";
          } else {
            successMsg += ` ⚠️ places登録失敗: ${plData.error}`;
          }
        } catch (e) {
          successMsg += ` ⚠️ places登録エラー: ${e instanceof Error ? e.message : String(e)}`;
        }
      }

      // モーダルを閉じてリセット
      setQuickModal(false);
      setQuickStep("input");
      setQuickQuery("");
      setQuickPlace(null);
      setQuickAI(null);
      setQuickCoverUrl("");
      setQuickAdminHint("");
      setQuickTikTokUrl("");
      setQuickRegisterToPlaces(false);
      // admin スポット一覧を再読込
      setAdminSpotsLoading(true);
      fetch(`/api/suggestions?secret=${ADMIN_PASSWORD}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) setAdminSpots((data.suggestions as Suggestion[]).filter((s) => s.source === "admin" || s.source === undefined));
        })
        .finally(() => setAdminSpotsLoading(false));
      setNewSpotSuccess(true);
      setNewSpotSuccessMsg(successMsg);
      setTimeout(() => setNewSpotSuccess(false), 5000);
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : String(e));
    } finally {
      setQuickPublishing(false);
    }
  };

  const handleQuickFillForm = () => {
    if (!quickPlace || !quickAI) return;
    // add-spotフォームにデータを流し込んでモーダルを閉じる
    setNewSpot({
      name: quickPlace.name,
      description: quickAI.description ?? "",
      address: quickPlace.address ?? "",
      stationInfo: "",
      mapUrl: quickPlace.website ?? "",
      tagInput: "",
    });
    setNewSpotTags(quickAI.tags ?? []);
    setQuickModal(false);
    setQuickStep("input");
    setQuickQuery("");
    setQuickPlace(null);
    setQuickAI(null);
    setQuickCoverUrl("");
    setQuickAdminHint("");
    setQuickTikTokUrl("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const loadFeaturedPages = async () => {
    setFeaturedLoading(true);
    setFeaturedError("");
    try {
      const res = await fetch(`/api/featured?secret=${ADMIN_PASSWORD}`);
      const d = await res.json();
      if (d.ok) setFeaturedPages(d.data);
      else setFeaturedError(d.error ?? "取得失敗");
    } catch { setFeaturedError("通信エラー"); }
    setFeaturedLoading(false);
  };

  const handleFeaturedSubmit = async () => {
    if (!featuredForm.slug.trim() || !featuredForm.spot_name.trim()) {
      setFeaturedError("スラッグとスポット名は必須です"); return;
    }
    setFeaturedSubmitting(true);
    setFeaturedError("");
    try {
      const url = editingFeaturedId ? `/api/featured/${editingFeaturedId}` : "/api/featured";
      const method = editingFeaturedId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...featuredForm, secret: ADMIN_PASSWORD }),
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error ?? "失敗");
      setFeaturedSuccess(editingFeaturedId ? "更新しました ✅" : "作成しました ✅");
      setFeaturedForm(emptyFeaturedForm);
      setEditingFeaturedId(null);
      await loadFeaturedPages();
      setTimeout(() => setFeaturedSuccess(""), 3000);
    } catch (e: unknown) {
      setFeaturedError(e instanceof Error ? e.message : "エラー");
    }
    setFeaturedSubmitting(false);
  };

  const handleFeaturedDelete = async (id: string) => {
    if (!confirm("この特集ページを削除しますか？")) return;
    setDeletingFeaturedId(id);
    await fetch(`/api/featured/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: ADMIN_PASSWORD }),
    });
    await loadFeaturedPages();
    setDeletingFeaturedId(null);
  };

  const startEditFeatured = (p: FeaturedPageRecord) => {
    setFeaturedForm({
      slug: p.slug, partner_name: p.partner_name, spot_name: p.spot_name,
      catch_copy: p.catch_copy ?? "", description: p.description ?? "",
      access: p.access ?? "", address: p.address ?? "", phone: p.phone ?? "",
      website: p.website ?? "", instagram: p.instagram ?? "",
      business_hours: p.business_hours ?? "", congestion_info: p.congestion_info ?? "",
      cover_image_url: p.cover_image_url ?? "", contract_start: p.contract_start ?? "",
      contract_end: p.contract_end ?? "", is_published: p.is_published,
      features: p.features ?? [], gallery_image_urls: p.gallery_image_urls ?? [],
      tags: p.tags ?? [], recommended_items: p.recommended_items ?? [],
    });
    setEditingFeaturedId(p.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 不適切報告
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState("");
  const [reportFilter, setReportFilter] = useState<"all" | "irrelevant" | "dislike" | "misinfoinfo" | "restricted" | "other">("all");
  const [blockingReport, setBlockingReport] = useState<string | null>(null); // report.id
  const [globallyBlocked, setGloballyBlocked] = useState<string[]>([]); // spot_names
  const [blockError, setBlockError] = useState("");

  // ─── Supabase Places 登録（スポット追加タブ）──────────────────────────────
  const [registerToPlaces, setRegisterToPlaces] = useState(false);
  const [spotLat, setSpotLat] = useState("");
  const [spotLng, setSpotLng] = useState("");
  const [spotArea, setSpotArea] = useState("");

  // ─── Supabase Places 登録（ユーザー投稿タブ: 投稿ごとのパネル）────────────
  // key = suggestion.id
  const [placesPanelOpen, setPlacesPanelOpen] = useState<Record<string, boolean>>({});
  const [placesRegLat, setPlacesRegLat] = useState<Record<string, string>>({});
  const [placesRegLng, setPlacesRegLng] = useState<Record<string, string>>({});
  const [placesRegArea, setPlacesRegArea] = useState<Record<string, string>>({});
  const [placesRegTags, setPlacesRegTags] = useState<Record<string, string[]>>({});
  const [placesRegTagInput, setPlacesRegTagInput] = useState<Record<string, string>>({});
  const [placesRegLoading, setPlacesRegLoading] = useState<Record<string, boolean>>({});
  const [placesRegDone, setPlacesRegDone] = useState<Record<string, boolean>>({});
  const [placesRegError, setPlacesRegError] = useState<Record<string, string>>({});
  // 重複警告 (suggestion登録)
  const [placesRegDuplicate, setPlacesRegDuplicate] = useState<Record<string, { existingId: string; existingName: string }>>({});

  // ─── 一括移行（places-migrate） ───────────────────────────────────────────
  const [migrateLoading, setMigrateLoading] = useState(false);
  const [migrateResult, setMigrateResult] = useState<{
    total: number; registered: number; skipped: number; failed: number;
    skippedNames: string[]; failedNames: string[];
  } | null>(null);

  // ─── 一括再タグ付け（retag-spots） ────────────────────────────────────────
  const [retagLoading, setRetagLoading] = useState(false);
  const [retagResult, setRetagResult] = useState<{
    total: number; updated: number; failed: number; failedNames: string[];
  } | null>(null);

  // ─── places テーブル診断 ─────────────────────────────────────────────────
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugResult, setDebugResult] = useState<{
    total: number; noTagCount: number; noCoordCount: number;
    tagRanking: [string, number][];
    sample: { name: string; tags: string[]; hasCoord: boolean }[];
    tagTests: Record<string, number>;
  } | null>(null);

  // ─── スポット追加タブの重複警告 ──────────────────────────────────────────
  const [newSpotDuplicate, setNewSpotDuplicate] = useState<{ existingId: string; existingName: string } | null>(null);

  // ─── クイック投稿 → Supabase places 登録 ─────────────────────────────────
  const [quickRegisterToPlaces, setQuickRegisterToPlaces] = useState(false);

  // ─── エリア一括取り込み（importタブ） ────────────────────────────────────
  type ImportCandidate = {
    placeId: string; name: string; address: string;
    lat: number; lng: number; rating: number | null; userRatingCount: number | null;
    photoUrls: string[]; tags: string[]; distanceKm: number;
  };
  const [importKeyword, setImportKeyword] = useState("");
  const [importPlace, setImportPlace] = useState("横浜市金沢区");
  const [importLat, setImportLat] = useState("35.3328");
  const [importLng, setImportLng] = useState("139.6236");
  const [importGeoLabel, setImportGeoLabel] = useState("横浜市金沢区");
  const [importRadius, setImportRadius] = useState("100");
  const [importMax, setImportMax] = useState("20");
  const [importLoading, setImportLoading] = useState(false);
  const [importGeoLoading, setImportGeoLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([]);
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set());
  const [importEditTags, setImportEditTags] = useState<Record<string, string[]>>({});
  const [importTagInputs, setImportTagInputs] = useState<Record<string, string>>({});
  const [importRegistering, setImportRegistering] = useState(false);
  const [importRegResult, setImportRegResult] = useState<{ ok: number; skip: number; fail: number } | null>(null);
  const [importSkippedCount, setImportSkippedCount] = useState(0);

  // ─── OSM全国一括取り込み ────────────────────────────────────────────────────
  type OsmTypeOption = { id: string; label: string; defaultTags: string[] };
  type OsmPrefResult = { prefecture: string; fetched: number; inserted: number; skipped: number; errors: string[] };
  type OsmImportResult = { ok: boolean; dryRun: boolean; totalFetched: number; totalInserted: number; totalSkipped: number; prefectureResults: OsmPrefResult[] };

  const REGION_GROUPS_UI: Record<string, string[]> = {
    "北海道・東北": ["北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島"],
    "関東":         ["茨城", "栃木", "群馬", "埼玉", "千葉", "東京", "神奈川"],
    "中部":         ["新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知"],
    "近畿":         ["三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山"],
    "中国・四国":   ["鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知"],
    "九州・沖縄":   ["福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄"],
  };
  const OSM_TYPE_OPTIONS: OsmTypeOption[] = [
    { id: "amenity:cafe",             label: "☕ カフェ",            defaultTags: ["#癒しカフェ", "#まったりしたい"] },
    { id: "amenity:restaurant",       label: "🍽 レストラン",         defaultTags: ["#お腹すいた"] },
    { id: "amenity:bar",              label: "🍺 バー・居酒屋",       defaultTags: ["#居酒屋"] },
    { id: "leisure:park",             label: "🌳 公園",               defaultTags: ["#大型公園", "#自然感じたい"] },
    { id: "leisure:garden",           label: "🌸 庭園",               defaultTags: ["#自然感じたい"] },
    { id: "leisure:nature_reserve",   label: "🌲 自然保護区",         defaultTags: ["#自然公園"] },
    { id: "tourism:viewpoint",        label: "🗼 展望台・絶景",       defaultTags: ["#絶景スポット", "#展望台"] },
    { id: "tourism:museum",           label: "🏛 博物館・美術館",     defaultTags: ["#博物館", "#美術館"] },
    { id: "tourism:attraction",       label: "⭐ 観光スポット",       defaultTags: ["#わいわい楽しみたい"] },
    { id: "tourism:theme_park",       label: "🎡 テーマパーク",       defaultTags: ["#テーマパーク"] },
    { id: "tourism:zoo",              label: "🦁 動物園",             defaultTags: ["#動物園"] },
    { id: "tourism:aquarium",         label: "🐠 水族館",             defaultTags: ["#水族館"] },
    { id: "amenity:spa",              label: "♨️ スパ・温泉",        defaultTags: ["#温泉", "#サウナ"] },
    { id: "amenity:place_of_worship", label: "⛩️ 神社・寺",          defaultTags: ["#パワースポット"] },
    { id: "amenity:library",          label: "📚 図書館",             defaultTags: ["#book場", "#集中したい"] },
    { id: "leisure:fitness_centre",   label: "💪 ジム・フィットネス", defaultTags: ["#体動かしたい"] },
    { id: "leisure:sports_centre",    label: "🏀 スポーツセンター",   defaultTags: ["#スポーツ"] },
    { id: "leisure:swimming_pool",    label: "🏊 プール",             defaultTags: ["#体動かしたい"] },
    { id: "leisure:stadium",          label: "🏟 スタジアム",         defaultTags: ["#スポーツ"] },
    { id: "leisure:bowling_alley",    label: "🎳 ボウリング",         defaultTags: ["#ボウリング"] },
    { id: "natural:peak",             label: "⛰️ 山頂",              defaultTags: ["#絶景スポット", "#山頂", "#自然感じたい"] },
    { id: "natural:beach",            label: "🏖️ 海岸・砂浜",       defaultTags: ["#海辺", "#自然感じたい"] },
    { id: "natural:waterfall",        label: "💧 滝",                defaultTags: ["#絶景スポット", "#自然感じたい"] },
    { id: "natural:cliff",            label: "🪨 断崖・絶壁",        defaultTags: ["#絶景スポット", "#自然感じたい"] },
    { id: "natural:hot_spring",       label: "♨️ 野湯・源泉",       defaultTags: ["#温泉", "#自然感じたい"] },
    { id: "tourism:wilderness_hut",   label: "🏕️ 山小屋",           defaultTags: ["#絶景スポット", "#自然感じたい"] },
    { id: "tourism:camp_site",        label: "⛺ キャンプ場",        defaultTags: ["#自然感じたい", "#ドライブしたい"] },
    { id: "historic:castle",          label: "🏯 城・城跡",          defaultTags: ["#絶景スポット", "#パワースポット"] },
    { id: "historic:ruins",           label: "🏛️ 遺跡・史跡",       defaultTags: ["#パワースポット", "#まったりしたい"] },
    { id: "shop:mall",                label: "🛍️ ショッピングモール", defaultTags: ["#ショッピング"] },
  ];

  // OSMの都市定義（APIのGETから取得せずフロントに直接持つ）
  const OSM_CITY_LIST: Array<{ prefecture: string; cityName: string; lat: number; lng: number; radiusKm: number }> = [
    // ── 北海道 ──────────────────────────────────────────────────────────────
    { prefecture: "北海道", cityName: "札幌",    lat: 43.0642, lng: 141.3469, radiusKm: 12 },
    { prefecture: "北海道", cityName: "函館",    lat: 41.7688, lng: 140.7290, radiusKm: 8  },
    { prefecture: "北海道", cityName: "旭川",    lat: 43.7707, lng: 142.3651, radiusKm: 8  },
    { prefecture: "北海道", cityName: "小樽",    lat: 43.1907, lng: 140.9947, radiusKm: 6  },
    { prefecture: "北海道", cityName: "釧路",    lat: 42.9849, lng: 144.3820, radiusKm: 8  },
    { prefecture: "北海道", cityName: "帯広",    lat: 42.9234, lng: 143.1960, radiusKm: 8  },
    { prefecture: "北海道", cityName: "網走",    lat: 44.0142, lng: 144.2731, radiusKm: 6  },
    { prefecture: "北海道", cityName: "美瑛",    lat: 43.5862, lng: 142.4775, radiusKm: 10 },
    { prefecture: "北海道", cityName: "富良野",  lat: 43.3415, lng: 142.3829, radiusKm: 8  },
    { prefecture: "北海道", cityName: "登別",    lat: 42.4110, lng: 141.1059, radiusKm: 6  },
    { prefecture: "北海道", cityName: "ニセコ",  lat: 42.8047, lng: 140.6871, radiusKm: 8  },
    { prefecture: "北海道", cityName: "知床",    lat: 44.0783, lng: 145.1292, radiusKm: 8  },
    // ── 東北 ─────────────────────────────────────────────────────────────────
    { prefecture: "青森",   cityName: "青森市",  lat: 40.8244, lng: 140.7401, radiusKm: 8  },
    { prefecture: "青森",   cityName: "弘前",    lat: 40.6031, lng: 140.4638, radiusKm: 8  },
    { prefecture: "青森",   cityName: "十和田",  lat: 40.5274, lng: 141.2143, radiusKm: 8  },
    { prefecture: "岩手",   cityName: "盛岡",    lat: 39.7036, lng: 141.1527, radiusKm: 8  },
    { prefecture: "岩手",   cityName: "平泉",    lat: 38.9889, lng: 141.1133, radiusKm: 5  },
    { prefecture: "宮城",   cityName: "仙台",    lat: 38.2682, lng: 140.8694, radiusKm: 10 },
    { prefecture: "宮城",   cityName: "松島",    lat: 38.3686, lng: 141.0657, radiusKm: 6  },
    { prefecture: "秋田",   cityName: "秋田市",  lat: 39.7186, lng: 140.1024, radiusKm: 8  },
    { prefecture: "秋田",   cityName: "角館",    lat: 39.5912, lng: 140.5618, radiusKm: 5  },
    { prefecture: "山形",   cityName: "山形市",  lat: 38.2404, lng: 140.3636, radiusKm: 8  },
    { prefecture: "山形",   cityName: "蔵王",    lat: 38.1444, lng: 140.4561, radiusKm: 8  },
    { prefecture: "山形",   cityName: "鶴岡",    lat: 38.7280, lng: 139.8267, radiusKm: 8  },
    { prefecture: "福島",   cityName: "福島市",  lat: 37.7608, lng: 140.4748, radiusKm: 8  },
    { prefecture: "福島",   cityName: "郡山",    lat: 37.3941, lng: 140.3878, radiusKm: 8  },
    { prefecture: "福島",   cityName: "会津若松", lat: 37.4926, lng: 139.9294, radiusKm: 8  },
    // ── 関東 ─────────────────────────────────────────────────────────────────
    { prefecture: "茨城",   cityName: "水戸",    lat: 36.3418, lng: 140.4468, radiusKm: 8  },
    { prefecture: "茨城",   cityName: "つくば",  lat: 36.0837, lng: 140.0776, radiusKm: 8  },
    { prefecture: "栃木",   cityName: "宇都宮",  lat: 36.5548, lng: 139.8830, radiusKm: 8  },
    { prefecture: "栃木",   cityName: "日光",    lat: 36.7197, lng: 139.6983, radiusKm: 8  },
    { prefecture: "栃木",   cityName: "那須",    lat: 37.0246, lng: 139.9880, radiusKm: 8  },
    { prefecture: "群馬",   cityName: "前橋",    lat: 36.3893, lng: 139.0600, radiusKm: 8  },
    { prefecture: "群馬",   cityName: "草津温泉", lat: 36.6220, lng: 138.5961, radiusKm: 5  },
    { prefecture: "群馬",   cityName: "伊香保",  lat: 36.4719, lng: 138.9290, radiusKm: 5  },
    { prefecture: "埼玉",   cityName: "さいたま", lat: 35.8617, lng: 139.6455, radiusKm: 10 },
    { prefecture: "埼玉",   cityName: "川越",    lat: 35.9255, lng: 139.4857, radiusKm: 6  },
    { prefecture: "千葉",   cityName: "千葉市",  lat: 35.6074, lng: 140.1065, radiusKm: 10 },
    { prefecture: "千葉",   cityName: "成田",    lat: 35.7776, lng: 140.3854, radiusKm: 6  },
    { prefecture: "千葉",   cityName: "銚子",    lat: 35.7341, lng: 140.8269, radiusKm: 6  },
    { prefecture: "東京",   cityName: "新宿",    lat: 35.6938, lng: 139.7034, radiusKm: 4  },
    { prefecture: "東京",   cityName: "渋谷",    lat: 35.6580, lng: 139.7016, radiusKm: 4  },
    { prefecture: "東京",   cityName: "池袋",    lat: 35.7295, lng: 139.7109, radiusKm: 4  },
    { prefecture: "東京",   cityName: "上野",    lat: 35.7141, lng: 139.7774, radiusKm: 4  },
    { prefecture: "東京",   cityName: "吉祥寺",  lat: 35.7034, lng: 139.5796, radiusKm: 4  },
    { prefecture: "東京",   cityName: "立川",    lat: 35.6987, lng: 139.4130, radiusKm: 6  },
    { prefecture: "東京",   cityName: "お台場",  lat: 35.6254, lng: 139.7756, radiusKm: 4  },
    { prefecture: "神奈川", cityName: "横浜",    lat: 35.4437, lng: 139.6380, radiusKm: 10 },
    { prefecture: "神奈川", cityName: "川崎",    lat: 35.5309, lng: 139.7029, radiusKm: 8  },
    { prefecture: "神奈川", cityName: "鎌倉",    lat: 35.3197, lng: 139.5467, radiusKm: 6  },
    { prefecture: "神奈川", cityName: "箱根",    lat: 35.2272, lng: 139.1069, radiusKm: 8  },
    { prefecture: "神奈川", cityName: "湘南",    lat: 35.3194, lng: 139.4887, radiusKm: 8  },
    // ── 中部 ─────────────────────────────────────────────────────────────────
    { prefecture: "新潟",   cityName: "新潟市",  lat: 37.9162, lng: 139.0364, radiusKm: 10 },
    { prefecture: "新潟",   cityName: "妙高",    lat: 37.0166, lng: 138.2521, radiusKm: 8  },
    { prefecture: "富山",   cityName: "富山市",  lat: 36.6953, lng: 137.2113, radiusKm: 8  },
    { prefecture: "富山",   cityName: "黒部",    lat: 36.8699, lng: 137.4543, radiusKm: 8  },
    { prefecture: "石川",   cityName: "金沢",    lat: 36.5613, lng: 136.6562, radiusKm: 8  },
    { prefecture: "石川",   cityName: "輪島",    lat: 37.3901, lng: 136.8990, radiusKm: 6  },
    { prefecture: "福井",   cityName: "福井市",  lat: 36.0652, lng: 136.2219, radiusKm: 8  },
    { prefecture: "福井",   cityName: "東尋坊",  lat: 36.1719, lng: 136.0560, radiusKm: 5  },
    { prefecture: "山梨",   cityName: "甲府",    lat: 35.6635, lng: 138.5684, radiusKm: 8  },
    { prefecture: "山梨",   cityName: "河口湖",  lat: 35.5054, lng: 138.7631, radiusKm: 8  },
    { prefecture: "長野",   cityName: "長野市",  lat: 36.6486, lng: 138.1947, radiusKm: 8  },
    { prefecture: "長野",   cityName: "松本",    lat: 36.2381, lng: 137.9719, radiusKm: 6  },
    { prefecture: "長野",   cityName: "軽井沢",  lat: 36.3480, lng: 138.5958, radiusKm: 8  },
    { prefecture: "長野",   cityName: "諏訪",    lat: 36.0384, lng: 138.1136, radiusKm: 8  },
    { prefecture: "長野",   cityName: "上高地",  lat: 36.2399, lng: 137.6206, radiusKm: 6  },
    { prefecture: "岐阜",   cityName: "岐阜市",  lat: 35.4231, lng: 136.7608, radiusKm: 8  },
    { prefecture: "岐阜",   cityName: "高山",    lat: 36.1462, lng: 137.2523, radiusKm: 8  },
    { prefecture: "岐阜",   cityName: "白川郷",  lat: 36.2574, lng: 136.9067, radiusKm: 6  },
    { prefecture: "静岡",   cityName: "静岡市",  lat: 34.9769, lng: 138.3831, radiusKm: 8  },
    { prefecture: "静岡",   cityName: "浜松",    lat: 34.7108, lng: 137.7261, radiusKm: 8  },
    { prefecture: "静岡",   cityName: "熱海",    lat: 35.0967, lng: 139.0730, radiusKm: 6  },
    { prefecture: "静岡",   cityName: "伊東",    lat: 34.9712, lng: 139.1006, radiusKm: 6  },
    { prefecture: "静岡",   cityName: "下田",    lat: 34.6791, lng: 138.9449, radiusKm: 6  },
    { prefecture: "愛知",   cityName: "名古屋",  lat: 35.1815, lng: 136.9066, radiusKm: 12 },
    { prefecture: "愛知",   cityName: "豊田",    lat: 35.0828, lng: 137.1563, radiusKm: 8  },
    // ── 近畿 ─────────────────────────────────────────────────────────────────
    { prefecture: "三重",   cityName: "津市",    lat: 34.7303, lng: 136.5086, radiusKm: 8  },
    { prefecture: "三重",   cityName: "伊勢",    lat: 34.4878, lng: 136.7167, radiusKm: 6  },
    { prefecture: "三重",   cityName: "鳥羽",    lat: 34.4844, lng: 136.8434, radiusKm: 6  },
    { prefecture: "滋賀",   cityName: "大津",    lat: 35.0045, lng: 135.8686, radiusKm: 8  },
    { prefecture: "滋賀",   cityName: "彦根",    lat: 35.2746, lng: 136.2632, radiusKm: 6  },
    { prefecture: "京都",   cityName: "京都市",  lat: 35.0116, lng: 135.7681, radiusKm: 10 },
    { prefecture: "京都",   cityName: "天橋立",  lat: 35.5813, lng: 135.1967, radiusKm: 6  },
    { prefecture: "大阪",   cityName: "梅田",    lat: 34.7055, lng: 135.5008, radiusKm: 5  },
    { prefecture: "大阪",   cityName: "難波",    lat: 34.6688, lng: 135.4990, radiusKm: 5  },
    { prefecture: "大阪",   cityName: "天王寺",  lat: 34.6470, lng: 135.5136, radiusKm: 4  },
    { prefecture: "兵庫",   cityName: "神戸",    lat: 34.6913, lng: 135.1830, radiusKm: 10 },
    { prefecture: "兵庫",   cityName: "姫路",    lat: 34.8394, lng: 134.6939, radiusKm: 8  },
    { prefecture: "兵庫",   cityName: "城崎温泉", lat: 35.6271, lng: 134.8002, radiusKm: 5  },
    { prefecture: "奈良",   cityName: "奈良市",  lat: 34.6851, lng: 135.8048, radiusKm: 8  },
    { prefecture: "奈良",   cityName: "吉野",    lat: 34.3966, lng: 135.8567, radiusKm: 6  },
    { prefecture: "和歌山", cityName: "和歌山市", lat: 34.2261, lng: 135.1675, radiusKm: 8  },
    { prefecture: "和歌山", cityName: "白浜",    lat: 33.6782, lng: 135.3592, radiusKm: 6  },
    { prefecture: "和歌山", cityName: "那智勝浦", lat: 33.6312, lng: 135.9358, radiusKm: 6  },
    // ── 中国・四国 ───────────────────────────────────────────────────────────
    { prefecture: "鳥取",   cityName: "鳥取市",  lat: 35.5011, lng: 134.2351, radiusKm: 8  },
    { prefecture: "鳥取",   cityName: "鳥取砂丘", lat: 35.5393, lng: 134.2266, radiusKm: 5  },
    { prefecture: "島根",   cityName: "松江",    lat: 35.4681, lng: 133.0485, radiusKm: 8  },
    { prefecture: "島根",   cityName: "出雲",    lat: 35.3672, lng: 132.7548, radiusKm: 8  },
    { prefecture: "岡山",   cityName: "岡山市",  lat: 34.6551, lng: 133.9195, radiusKm: 10 },
    { prefecture: "岡山",   cityName: "倉敷",    lat: 34.5850, lng: 133.7723, radiusKm: 8  },
    { prefecture: "広島",   cityName: "広島市",  lat: 34.3853, lng: 132.4553, radiusKm: 10 },
    { prefecture: "広島",   cityName: "宮島",    lat: 34.2956, lng: 132.3197, radiusKm: 5  },
    { prefecture: "広島",   cityName: "尾道",    lat: 34.4086, lng: 133.2020, radiusKm: 6  },
    { prefecture: "山口",   cityName: "下関",    lat: 33.9542, lng: 130.9300, radiusKm: 6  },
    { prefecture: "山口",   cityName: "萩",      lat: 34.4080, lng: 131.3993, radiusKm: 6  },
    { prefecture: "山口",   cityName: "山口市",  lat: 34.1861, lng: 131.4706, radiusKm: 8  },
    { prefecture: "徳島",   cityName: "徳島市",  lat: 34.0658, lng: 134.5593, radiusKm: 8  },
    { prefecture: "香川",   cityName: "高松",    lat: 34.3402, lng: 134.0434, radiusKm: 8  },
    { prefecture: "香川",   cityName: "小豆島",  lat: 34.4800, lng: 134.2391, radiusKm: 8  },
    { prefecture: "愛媛",   cityName: "松山",    lat: 33.8417, lng: 132.7657, radiusKm: 8  },
    { prefecture: "愛媛",   cityName: "道後温泉", lat: 33.8508, lng: 132.7895, radiusKm: 5  },
    { prefecture: "高知",   cityName: "高知市",  lat: 33.5597, lng: 133.5311, radiusKm: 8  },
    { prefecture: "高知",   cityName: "四万十",  lat: 32.9911, lng: 132.9565, radiusKm: 8  },
    // ── 九州・沖縄 ──────────────────────────────────────────────────────────
    { prefecture: "福岡",   cityName: "博多",    lat: 33.5902, lng: 130.4017, radiusKm: 8  },
    { prefecture: "福岡",   cityName: "北九州",  lat: 33.8834, lng: 130.8751, radiusKm: 8  },
    { prefecture: "福岡",   cityName: "太宰府",  lat: 33.5125, lng: 130.5334, radiusKm: 5  },
    { prefecture: "佐賀",   cityName: "佐賀市",  lat: 33.2635, lng: 130.3009, radiusKm: 8  },
    { prefecture: "佐賀",   cityName: "嬉野温泉", lat: 33.0930, lng: 130.0853, radiusKm: 5  },
    { prefecture: "長崎",   cityName: "長崎市",  lat: 32.7503, lng: 129.8779, radiusKm: 8  },
    { prefecture: "長崎",   cityName: "雲仙",    lat: 32.7611, lng: 130.1891, radiusKm: 6  },
    { prefecture: "長崎",   cityName: "五島列島", lat: 32.6969, lng: 128.8364, radiusKm: 8  },
    { prefecture: "熊本",   cityName: "熊本市",  lat: 32.8031, lng: 130.7079, radiusKm: 10 },
    { prefecture: "熊本",   cityName: "阿蘇",    lat: 32.8837, lng: 131.0996, radiusKm: 10 },
    { prefecture: "大分",   cityName: "大分市",  lat: 33.2382, lng: 131.6126, radiusKm: 8  },
    { prefecture: "大分",   cityName: "別府",    lat: 33.2846, lng: 131.4923, radiusKm: 6  },
    { prefecture: "大分",   cityName: "由布院",  lat: 33.2580, lng: 131.3644, radiusKm: 6  },
    { prefecture: "宮崎",   cityName: "宮崎市",  lat: 31.9111, lng: 131.4239, radiusKm: 8  },
    { prefecture: "宮崎",   cityName: "高千穂",  lat: 32.7161, lng: 131.3089, radiusKm: 6  },
    { prefecture: "鹿児島", cityName: "鹿児島市", lat: 31.5602, lng: 130.5581, radiusKm: 10 },
    { prefecture: "鹿児島", cityName: "指宿",    lat: 31.2517, lng: 130.6349, radiusKm: 6  },
    { prefecture: "鹿児島", cityName: "屋久島",  lat: 30.3622, lng: 130.6522, radiusKm: 10 },
    { prefecture: "沖縄",   cityName: "那覇",    lat: 26.2124, lng: 127.6809, radiusKm: 8  },
    { prefecture: "沖縄",   cityName: "宮古島",  lat: 24.8055, lng: 125.2816, radiusKm: 10 },
    { prefecture: "沖縄",   cityName: "石垣島",  lat: 24.3408, lng: 124.1561, radiusKm: 10 },
    { prefecture: "沖縄",   cityName: "恩納村",  lat: 26.4833, lng: 127.8577, radiusKm: 8  },
  ];

  const [osmPrefectures, setOsmPrefectures] = useState<Set<string>>(new Set());
  const [osmTypes, setOsmTypes] = useState<Set<string>>(new Set(OSM_TYPE_OPTIONS.map(t => t.id)));
  const [osmDryRun, setOsmDryRun] = useState(true);
  const [osmLoading, setOsmLoading] = useState(false);
  const [osmError, setOsmError] = useState("");
  const [osmProgress, setOsmProgress] = useState<{ current: number; total: number; cityName: string } | null>(null);
  type OsmSpot = { name: string; address: string; tags: string[] };
  const [osmCityResults, setOsmCityResults] = useState<Array<{ prefecture: string; cityName: string; fetched: number; inserted: number; skipped: number; error?: string; spots: OsmSpot[] }>>([]);
  const [osmExpandedCity, setOsmExpandedCity] = useState<string | null>(null);
  const osmTotalInserted = osmCityResults.reduce((s, r) => s + r.inserted, 0);
  const osmTotalFetched  = osmCityResults.reduce((s, r) => s + r.fetched, 0);

  const handleOsmTogglePref = (pref: string) => {
    setOsmPrefectures(prev => { const next = new Set(prev); next.has(pref) ? next.delete(pref) : next.add(pref); return next; });
  };
  const handleOsmToggleRegion = (prefs: string[]) => {
    setOsmPrefectures(prev => {
      const next = new Set(prev);
      const allSelected = prefs.every(p => next.has(p));
      prefs.forEach(p => allSelected ? next.delete(p) : next.add(p));
      return next;
    });
  };
  const handleOsmToggleType = (id: string) => {
    setOsmTypes(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const handleOsmImport = async () => {
    if (osmPrefectures.size === 0) { setOsmError("都道府県を1つ以上選択してください"); return; }
    if (osmTypes.size === 0)       { setOsmError("スポット種別を1つ以上選択してください"); return; }

    const targetCities = OSM_CITY_LIST.filter(c => osmPrefectures.has(c.prefecture));
    if (targetCities.length === 0) { setOsmError("対象都市が見つかりません"); return; }

    setOsmError(""); setOsmCityResults([]); setOsmLoading(true);
    setOsmProgress({ current: 0, total: targetCities.length, cityName: "" });

    for (let i = 0; i < targetCities.length; i++) {
      const city = targetCities[i];
      setOsmProgress({ current: i + 1, total: targetCities.length, cityName: `${city.prefecture} / ${city.cityName}` });
      try {
        const res = await fetch("/api/admin/osm-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: ADMIN_PASSWORD,
            prefecture: city.prefecture,
            cityName: city.cityName,
            lat: city.lat, lng: city.lng, radiusKm: city.radiusKm,
            osmTypes: Array.from(osmTypes),
            dryRun: osmDryRun,
          }),
        });
        const data = await res.json();
        setOsmCityResults(prev => [...prev, {
          prefecture: city.prefecture, cityName: city.cityName,
          fetched: data.fetched ?? 0, inserted: data.inserted ?? 0, skipped: data.skipped ?? 0,
          error: data.errors?.[0],
          spots: data.spots ?? [],
        }]);
      } catch (e) {
        setOsmCityResults(prev => [...prev, {
          prefecture: city.prefecture, cityName: city.cityName,
          fetched: 0, inserted: 0, skipped: 0, error: String(e), spots: [],
        }]);
      }
    }
    setOsmLoading(false);
    setOsmProgress(null);
  };

  // ─── Supabase スポット検索 ───────────────────────────────────────────────────
  const [spSearchKeyword, setSpSearchKeyword] = useState("");
  const [spSearchLoading, setSpSearchLoading] = useState(false);
  const [spSearchResults, setSpSearchResults] = useState<Array<{ id: string; name: string; address: string; tags: string[]; is_active: boolean; google_place_id: string | null }> | null>(null);
  const [spSearchError, setSpSearchError]     = useState("");

  const handleSpSearch = async () => {
    if (!spSearchKeyword.trim()) return;
    setSpSearchLoading(true); setSpSearchError(""); setSpSearchResults(null);
    try {
      const res = await fetch("/api/admin/search-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: ADMIN_PASSWORD, keyword: spSearchKeyword }),
      });
      const data = await res.json();
      if (!data.ok) setSpSearchError(data.error ?? "エラーが発生しました");
      else setSpSearchResults(data.places);
    } catch (e) { setSpSearchError(String(e)); }
    setSpSearchLoading(false);
  };

  // ─── 有名スポット一括手動登録 ────────────────────────────────────────────────
  const [manualText, setManualText]           = useState("");
  const [manualDryRun, setManualDryRun]       = useState(true);
  const [manualLoading, setManualLoading]     = useState(false);
  const [manualError, setManualError]         = useState("");
  const [manualResults, setManualResults]     = useState<Array<{ name: string; status: string; address?: string; tags?: string[]; error?: string }> | null>(null);
  const [manualSummary, setManualSummary]     = useState<{ inserted: number; skipped: number; notFound: number } | null>(null);

  const handleManualRegister = async () => {
    const names = manualText.split("\n").map(s => s.trim()).filter(Boolean);
    if (names.length === 0) { setManualError("場所名を入力してください"); return; }
    setManualError(""); setManualResults(null); setManualSummary(null); setManualLoading(true);
    try {
      const res = await fetch("/api/admin/manual-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: ADMIN_PASSWORD, names, dryRun: manualDryRun }),
      });
      const data = await res.json();
      if (!data.ok) { setManualError(data.error ?? "エラー"); }
      else { setManualResults(data.results); setManualSummary({ inserted: data.inserted, skipped: data.skipped, notFound: data.notFound }); }
    } catch (e) { setManualError(String(e)); }
    setManualLoading(false);
  };

  // ─── Google Places 処理済みキャッシュ（localStorage） ───────────────────────
  const GB_DONE_KEY = "moodgo_gb_done";

  // 既に登録済みの旧65都市（新しく追加した都市は含めない）
  const LEGACY_CITIES = new Set([
    "札幌","函館","旭川","青森市","盛岡","仙台","秋田市","山形市","福島市","郡山",
    "水戸","宇都宮","前橋","さいたま","川越","千葉市","新宿","渋谷","池袋","上野",
    "吉祥寺","立川","横浜","川崎","鎌倉","新潟市","富山市","金沢","福井市","甲府",
    "長野市","松本","岐阜市","静岡市","浜松","名古屋","津市","大津","京都市",
    "梅田","難波","天王寺","神戸","姫路","奈良市","和歌山市","鳥取市","松江",
    "岡山市","広島市","下関","徳島市","高松","松山","高知市","博多","北九州",
    "佐賀市","長崎市","熊本市","大分市","別府","宮崎市","鹿児島市","那覇",
  ]);

  const [gbDoneKeys, setGbDoneKeys] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(GB_DONE_KEY) ?? "[]")); } catch { return new Set(); }
  });
  const gbDoneKey = (cityName: string, keyword: string) => `${cityName}::${keyword}`;
  const markGbDone = (cityName: string, keyword: string) => {
    setGbDoneKeys(prev => {
      const next = new Set(prev);
      next.add(gbDoneKey(cityName, keyword));
      localStorage.setItem(GB_DONE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };
  const clearGbDone = () => {
    localStorage.removeItem(GB_DONE_KEY);
    setGbDoneKeys(new Set());
  };
  const markLegacyCitiesDone = () => {
    setGbDoneKeys(prev => {
      const next = new Set(prev);
      GOOGLE_KEYWORDS.forEach(kw => {
        LEGACY_CITIES.forEach(city => next.add(gbDoneKey(city, kw)));
      });
      localStorage.setItem(GB_DONE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  // ─── Google Places 全国一括取り込み ────────────────────────────────────────
  const GOOGLE_KEYWORDS = [
    "カフェ", "公園", "温泉", "銭湯", "サウナ",
    "居酒屋", "レストラン", "神社", "寺", "展望台",
    "水族館", "動物園", "美術館", "博物館", "テーマパーク",
    "ビーチ", "ジム", "ボウリング場", "カラオケ", "図書館",
    "ショッピングモール",
    // カラオケチェーン
    "ビッグエコー", "ジョイサウンド", "カラオケまねきねこ", "カラオケバンバン", "カラオケ館",
    // ボウリングチェーン
    "ラウンドワン",
    // 絶景・自然
    "絶景スポット", "景勝地", "ドライブスポット", "山頂", "海辺", "自然スポット",
    // 動物カフェ
    "猫カフェ", "犬カフェ", "動物カフェ",
  ];

  const GB_PRESETS = [
    {
      label: "🎤 カラオケ・ボウリングチェーン",
      color: "#7c3aed",
      keywords: ["カラオケ", "ビッグエコー", "ジョイサウンド", "カラオケまねきねこ", "カラオケバンバン", "カラオケ館", "ボウリング場", "ラウンドワン"],
    },
    {
      label: "🏔 絶景・自然・ドライブ",
      color: "#059669",
      keywords: ["絶景スポット", "景勝地", "展望台", "ドライブスポット", "山頂", "海辺", "自然スポット", "ビーチ"],
    },
    {
      label: "🐾 動物カフェ",
      color: "#d97706",
      keywords: ["猫カフェ", "犬カフェ", "動物カフェ"],
    },
  ];

  type GBulkSpot = { name: string; address: string; tags: string[]; photoUrl: string };
  type GBulkResult = { prefecture: string; cityName: string; keyword: string; fetched: number; inserted: number; skipped: number; error?: string; spots: GBulkSpot[] };

  const [gbPrefectures, setGbPrefectures] = useState<Set<string>>(new Set());
  const [gbKeywords, setGbKeywords] = useState<Set<string>>(new Set(["カフェ", "公園", "温泉", "神社", "展望台"]));
  const [gbDryRun, setGbDryRun] = useState(true);
  const [gbLoading, setGbLoading] = useState(false);
  const [gbError, setGbError] = useState("");
  const [gbProgress, setGbProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [gbResults, setGbResults] = useState<GBulkResult[]>([]);
  const [gbExpandedKey, setGbExpandedKey] = useState<string | null>(null);
  const gbTotalInserted = gbResults.reduce((s, r) => s + r.inserted, 0);
  const gbTotalFetched  = gbResults.reduce((s, r) => s + r.fetched, 0);

  const handleGbTogglePref = (pref: string) => {
    setGbPrefectures(prev => { const next = new Set(prev); next.has(pref) ? next.delete(pref) : next.add(pref); return next; });
  };
  const handleGbToggleRegion = (prefs: string[]) => {
    setGbPrefectures(prev => {
      const next = new Set(prev);
      const allSelected = prefs.every(p => next.has(p));
      prefs.forEach(p => allSelected ? next.delete(p) : next.add(p));
      return next;
    });
  };
  const handleGbToggleKeyword = (kw: string) => {
    setGbKeywords(prev => { const next = new Set(prev); next.has(kw) ? next.delete(kw) : next.add(kw); return next; });
  };

  const handleGbImport = async () => {
    if (gbPrefectures.size === 0) { setGbError("都道府県を1つ以上選択してください"); return; }
    if (gbKeywords.size === 0)    { setGbError("キーワードを1つ以上選択してください"); return; }

    const targetCities = OSM_CITY_LIST.filter(c => gbPrefectures.has(c.prefecture));
    if (targetCities.length === 0) { setGbError("対象都市が見つかりません"); return; }

    const keywords = Array.from(gbKeywords);
    // 処理済みを除いた新規リストだけ実行
    const tasks = targetCities.flatMap(city =>
      keywords.map(keyword => ({ city, keyword }))
    ).filter(({ city, keyword }) => !gbDoneKeys.has(gbDoneKey(city.cityName, keyword)));

    const total = tasks.length;
    if (total === 0) { setGbError("選択した組み合わせは全て処理済みです。「処理済みをリセット」してから実行してください。"); return; }

    setGbError(""); setGbResults([]); setGbLoading(true);
    setGbProgress({ current: 0, total, label: "" });

    let counter = 0;
    for (const { city, keyword } of tasks) {
      counter++;
      setGbProgress({ current: counter, total, label: `${city.cityName} × ${keyword}` });
      try {
        const res = await fetch("/api/admin/google-bulk-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: ADMIN_PASSWORD,
            cityName: city.cityName,
            lat: city.lat, lng: city.lng, radiusKm: city.radiusKm,
            keyword,
            dryRun: gbDryRun,
          }),
        });
        const data = await res.json();
        setGbResults(prev => [...prev, {
          prefecture: city.prefecture, cityName: city.cityName, keyword,
          fetched: data.fetched ?? 0, inserted: data.inserted ?? 0, skipped: data.skipped ?? 0,
          error: data.errors?.[0],
          spots: data.spots ?? [],
        }]);
        // dryRunでなければ処理済みとして記録
        if (!gbDryRun) markGbDone(city.cityName, keyword);
      } catch (e) {
        setGbResults(prev => [...prev, {
          prefecture: city.prefecture, cityName: city.cityName, keyword,
          fetched: 0, inserted: 0, skipped: 0, error: String(e), spots: [],
        }]);
      }
      await new Promise(r => setTimeout(r, 200));
    }
    setGbLoading(false);
    setGbProgress(null);
  };

  // ─── スポットクリーンアップ ────────────────────────────────────────────────
  const CLEANUP_PRESETS = [
    { label: "ドッグランを削除",       pattern: "ドッグラン",   tag: null },
    { label: "ペットショップを削除",    pattern: "ペットショップ", tag: null },
    { label: "トリミングサロンを削除",  pattern: "トリミング",   tag: null },
    { label: "動物病院を削除",         pattern: "動物病院",     tag: null },
    { label: "ペットホテルを削除",      pattern: "ペットホテル", tag: null },
    { label: "バーを削除",             pattern: "バー",         tag: null },
    { label: "スナックを削除",         pattern: "スナック",     tag: null },
    { label: "クラブを削除",           pattern: "クラブ",       tag: null },
    { label: "株式会社を削除",         pattern: "株式会社",     tag: null },
    { label: "有限会社を削除",         pattern: "有限会社",     tag: null },
    { label: "合同会社を削除",         pattern: "合同会社",     tag: null },
    { label: "社団・財団法人を削除",   pattern: "法人",         tag: null },
    { label: "事務所・オフィスを削除", pattern: "事務所",       tag: null },
  ];
  const CLEANUP_ALL_PATTERNS = ["ドッグラン", "ペットショップ", "トリミング", "動物病院", "ペットホテル", "バー", "スナック", "クラブ", "株式会社", "有限会社", "合同会社", "法人", "事務所"];

  const [cleanupAllLoading, setCleanupAllLoading] = useState(false);
  const [cleanupAllResult, setCleanupAllResult]   = useState<{ total: number; details: { pattern: string; count: number }[] } | null>(null);
  const [cleanupAllDryRun, setCleanupAllDryRun]   = useState(true);

  const [subFacilityLoading, setSubFacilityLoading] = useState(false);
  const [subFacilityResult, setSubFacilityResult]   = useState<{ count: number; names: string[] } | null>(null);
  const [subFacilityDryRun, setSubFacilityDryRun]   = useState(true);

  const handleSubFacilityCleanup = async () => {
    setSubFacilityLoading(true); setSubFacilityResult(null);
    try {
      const res = await fetch("/api/admin/cleanup-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: ADMIN_PASSWORD, subFacilityOnly: true, dryRun: subFacilityDryRun }),
      });
      const data = await res.json();
      if (data.ok) setSubFacilityResult({ count: data.count, names: data.names ?? [] });
    } catch { /* skip */ }
    setSubFacilityLoading(false);
  };

  type AnalysisResult = {
    totalPlaces: number;
    exactDuplicates: Array<{ name: string; count: number; places: Array<{ id: string; name: string; address: string; tags: string[]; tagCount: number }> }>;
    subZones: Array<{ parentId: string; parentName: string; children: Array<{ id: string; name: string; address: string }> }>;
  };
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisResult, setAnalysisResult]   = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError]     = useState("");
  const [expandedDupe, setExpandedDupe]       = useState<string | null>(null);
  const [expandedZone, setExpandedZone]       = useState<string | null>(null);
  const [deletingIds, setDeletingIds]         = useState<Set<string>>(new Set());
  const [dupeFilter, setDupeFilter]           = useState("");
  const [zoneFilter, setZoneFilter]           = useState("");

  const handleAnalysis = async () => {
    setAnalysisLoading(true); setAnalysisResult(null); setAnalysisError("");
    try {
      const res = await fetch("/api/admin/analyze-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: ADMIN_PASSWORD }),
      });
      const data = await res.json();
      if (data.ok) setAnalysisResult(data);
      else setAnalysisError(data.error ?? "エラーが発生しました");
    } catch (e) { setAnalysisError(String(e)); }
    setAnalysisLoading(false);
  };

  const handleDeleteByIds = async (ids: string[]) => {
    setDeletingIds(new Set(ids));
    try {
      await fetch("/api/admin/cleanup-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: ADMIN_PASSWORD, ids, dryRun: false }),
      });
      // 削除後に分析を更新
      await handleAnalysis();
    } catch { /* skip */ }
    setDeletingIds(new Set());
  };

  const handleCleanupAll = async () => {
    setCleanupAllLoading(true); setCleanupAllResult(null);
    const details: { pattern: string; count: number }[] = [];
    let total = 0;
    for (const pattern of CLEANUP_ALL_PATTERNS) {
      try {
        const res = await fetch("/api/admin/cleanup-places", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: ADMIN_PASSWORD, namePattern: pattern, tag: null, dryRun: cleanupAllDryRun }),
        });
        const data = await res.json();
        if (data.ok) { details.push({ pattern, count: data.count }); total += data.count; }
      } catch { /* skip */ }
    }
    setCleanupAllResult({ total, details });
    setCleanupAllLoading(false);
  };
  const [cleanupPattern, setCleanupPattern]     = useState("");
  const [cleanupTag, setCleanupTag]             = useState("");
  const [cleanupDryRun, setCleanupDryRun]       = useState(true);
  const [cleanupLoading, setCleanupLoading]     = useState(false);
  const [cleanupResult, setCleanupResult]       = useState<{ count: number; names: string[] } | null>(null);
  const [cleanupError, setCleanupError]         = useState("");

  const handleCleanup = async () => {
    if (!cleanupPattern && !cleanupTag) { setCleanupError("名前パターンまたはタグを入力してください"); return; }
    setCleanupError(""); setCleanupResult(null); setCleanupLoading(true);
    try {
      const res = await fetch("/api/admin/cleanup-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: ADMIN_PASSWORD, namePattern: cleanupPattern || null, tag: cleanupTag || null, dryRun: cleanupDryRun }),
      });
      const data = await res.json();
      if (!data.ok) { setCleanupError(data.error ?? "エラーが発生しました"); }
      else { setCleanupResult({ count: data.count, names: data.names ?? [] }); }
    } catch (e) { setCleanupError(String(e)); }
    setCleanupLoading(false);
  };

  // 開発ログ
  const [devChecked, setDevChecked] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return Object.fromEntries(DEVLOG_ALL_IDS.map((id) => [id, true]));
    try {
      const stored = localStorage.getItem("moodgo_dev_checked");
      if (stored) return JSON.parse(stored);
      // 初回：全リクエストをデフォルト完了にする
      return Object.fromEntries(DEVLOG_ALL_IDS.map((id) => [id, true]));
    } catch { return Object.fromEntries(DEVLOG_ALL_IDS.map((id) => [id, true])); }
  });
  const [devTodos, setDevTodos] = useState<TodoEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem("moodgo_dev_todos") ?? "[]"); } catch { return []; }
  });
  const [newTodoText, setNewTodoText] = useState("");
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingTodoText, setEditingTodoText] = useState("");

  const saveDevChecked = (next: Record<string, boolean>) => {
    setDevChecked(next);
    localStorage.setItem("moodgo_dev_checked", JSON.stringify(next));
  };
  const saveDevTodos = (next: TodoEntry[]) => {
    setDevTodos(next);
    localStorage.setItem("moodgo_dev_todos", JSON.stringify(next));
  };
  const addTodo = () => {
    if (!newTodoText.trim()) return;
    saveDevTodos([...devTodos, { id: String(Date.now()), text: newTodoText.trim(), done: false }]);
    setNewTodoText("");
  };
  const toggleTodo = (id: string) =>
    saveDevTodos(devTodos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const deleteTodo = (id: string) =>
    saveDevTodos(devTodos.filter((t) => t.id !== id));
  const startEditTodo = (t: TodoEntry) => { setEditingTodoId(t.id); setEditingTodoText(t.text); };
  const saveEditTodo = (id: string) => {
    if (!editingTodoText.trim()) return;
    saveDevTodos(devTodos.map((t) => (t.id === id ? { ...t, text: editingTodoText.trim() } : t)));
    setEditingTodoId(null);
  };

  // ─── ユーザー投稿を Supabase places に登録するハンドラ ──────────────────────
  const handleRegisterSuggestionToPlaces = async (s: Suggestion, force = false) => {
    const id = s.id;
    const tags = placesRegTags[id] ?? editableTags[id] ?? s.auto_tags ?? [];
    if (tags.length === 0) {
      setPlacesRegError(prev => ({ ...prev, [id]: "タグを1つ以上設定してください" }));
      return;
    }
    setPlacesRegLoading(prev => ({ ...prev, [id]: true }));
    setPlacesRegError(prev => ({ ...prev, [id]: "" }));
    setPlacesRegDuplicate(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const res = await fetch("/api/admin/places-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret:          ADMIN_PASSWORD,
          name:            s.spot_name,
          address:         s.address ?? "",
          nearestStation:  (s as Suggestion & { station_info?: string }).station_info ?? "",
          lat:             placesRegLat[id] ? Number(placesRegLat[id]) : (s.lat ?? null),
          lng:             placesRegLng[id] ? Number(placesRegLng[id]) : (s.lng ?? null),
          googlePlaceId:   s.google_place_id ?? null,
          tags,
          area:            placesRegArea[id] || null,
          description:     s.description ?? null,
          imageUrls:       s.image_urls ?? [],
          force,
        }),
      });
      const data = await res.json();
      if (data.duplicate) {
        setPlacesRegDuplicate(prev => ({ ...prev, [id]: { existingId: data.existingId, existingName: data.existingName } }));
        return;
      }
      if (!data.ok) throw new Error(data.error ?? "登録失敗");
      setPlacesRegDone(prev => ({ ...prev, [id]: true }));
      setPlacesPanelOpen(prev => ({ ...prev, [id]: false }));
    } catch (e) {
      setPlacesRegError(prev => ({ ...prev, [id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setPlacesRegLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleNewSpotSubmit = async () => {
    if (!newSpot.name.trim()) { setNewSpotError("スポット名は必須です"); return; }
    // 気分タグが少なくとも1つ必要
    const hasMoodTag = newSpotTags.some((t) => MOOD_TAGS.includes(t));
    if (!hasMoodTag) {
      setNewSpotError("⚠️ 気分タグ（#お腹すいた など）を少なくとも1つ選択してください。これによりスポットが適切な気分検索にヒットします。");
      return;
    }
    setNewSpotSubmitting(true);
    setNewSpotError("");
    try {
      const fd = new FormData();
      fd.append("spotName", newSpot.name.trim());
      fd.append("description", newSpot.description.trim());
      fd.append("address", newSpot.address.trim());
      fd.append("stationInfo", newSpot.stationInfo.trim());
      fd.append("manualMapUrl", newSpot.mapUrl.trim());
      fd.append("source", "admin");
      fd.append("secret", ADMIN_PASSWORD);
      fd.append("autoTags", JSON.stringify(newSpotTags));
      fd.append("isChain", String(isChain));
      if (isChain && chainSearchQuery.trim()) fd.append("chainSearchQuery", chainSearchQuery.trim());
      if (newSpotAvailableFrom) fd.append("availableFrom", newSpotAvailableFrom);
      if (newSpotAvailableUntil) fd.append("availableUntil", newSpotAvailableUntil);
      for (const f of newSpotImages.slice(0, 5)) fd.append("images", f);

      const res = await fetch("/api/suggestions", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "登録失敗");
      const uploadedCount: number = data.uploadedCount ?? 0;
      const attemptedCount: number = newSpotImages.length;
      let msg = "✅ スポットを追加しました！検索結果に反映されます。";
      if (attemptedCount > 0) {
        if (uploadedCount === attemptedCount) {
          msg += ` 📷 画像 ${uploadedCount}枚アップロード完了`;
        } else if (uploadedCount > 0) {
          msg += ` ⚠️ 画像 ${uploadedCount}/${attemptedCount}枚のみアップロード（残りは失敗）`;
        } else {
          msg += ` ❌ 画像アップロード失敗（スポット名のみ登録）`;
        }
      }

      // ── Supabase places テーブルにも登録（常時ON） ───────────────────────
      if (newSpotTags.length > 0) {
        try {
          const plRes = await fetch("/api/admin/places-register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              secret:          ADMIN_PASSWORD,
              name:            newSpot.name.trim(),
              address:         newSpot.address.trim(),
              nearestStation:  newSpot.stationInfo.trim(),
              lat:             spotLat ? Number(spotLat) : null,
              lng:             spotLng ? Number(spotLng) : null,
              tags:            newSpotTags,
              area:            spotArea.trim() || null,
              description:     newSpot.description.trim() || null,
              imageUrls:       [],  // 画像はSupabase Storage経由のURLが必要なため後から別途更新
              force:           !!newSpotDuplicate,
            }),
          });
          const plData = await plRes.json();
          if (plData.duplicate) {
            setNewSpotDuplicate({ existingId: plData.existingId, existingName: plData.existingName });
            setNewSpotSuccessMsg(msg);
            setNewSpotSuccess(true);
            setNewSpotSubmitting(false);
            return;
          }
          if (plData.ok) {
            msg += " 🗄 Supabase placesにも登録完了！";
          } else {
            msg += ` ⚠️ places登録失敗: ${plData.error}`;
          }
        } catch (e) {
          msg += ` ⚠️ places登録エラー: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      setNewSpotDuplicate(null);
      // ────────────────────────────────────────────────────────────────────

      setNewSpotSuccessMsg(msg);
      setNewSpotSuccess(true);
      setNewSpot({ name: "", description: "", address: "", stationInfo: "", mapUrl: "", tagInput: "" });
      setNewSpotTags([]);
      setNewSpotImages([]);
      setNewSpotImagePreviews([]);
      if (newSpotFileInputRef.current) newSpotFileInputRef.current.value = "";
      setIsChain(false);
      setSpotLat("");
      setSpotLng("");
      setSpotArea("");
      setChainSearchQuery("");
      setNewSpotAvailableFrom("");
      setNewSpotAvailableUntil("");
      setTimeout(() => setNewSpotSuccess(false), 6000);
    } catch (e) {
      setNewSpotError(e instanceof Error ? e.message : String(e));
    } finally {
      setNewSpotSubmitting(false);
    }
  };

  // スポット名重複チェック（デバウンス用に外部から呼ぶ）
  const checkDuplicate = async (name: string) => {
    if (!name.trim() || name.trim().length < 2) { setDuplicateWarning(null); return; }
    setDuplicateChecking(true);
    try {
      const res = await fetch(`/api/suggestions?secret=${ADMIN_PASSWORD}&search=${encodeURIComponent(name.trim())}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.suggestions)) {
        const similar = data.suggestions.filter((s: { spot_name: string; google_place_name?: string }) => {
          const n = name.trim().toLowerCase();
          return (
            s.spot_name.toLowerCase().includes(n) ||
            (s.google_place_name ?? "").toLowerCase().includes(n) ||
            n.includes(s.spot_name.toLowerCase().slice(0, 4))
          );
        });
        if (similar.length > 0) {
          setDuplicateWarning(`⚠️ 似たスポットがすでに ${similar.length} 件あります：${similar.slice(0, 3).map((s: { spot_name: string }) => s.spot_name).join("、")}`);
        } else {
          setDuplicateWarning(null);
        }
      }
    } catch { /* ignore */ } finally {
      setDuplicateChecking(false);
    }
  };

  // ─── 一括再タグ付けハンドラ ──────────────────────────────────────────────
  const handleRetag = async () => {
    setRetagLoading(true);
    setRetagResult(null);
    try {
      const res = await fetch("/api/admin/retag-spots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: ADMIN_PASSWORD }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "再タグ付け失敗");
      setRetagResult(data);
      // スポット一覧を再読み込み
      setAdminSpotsLoading(true);
      fetch(`/api/suggestions?secret=${ADMIN_PASSWORD}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) setAdminSpots((d.suggestions as Suggestion[]).filter((s) => s.source === "admin" || s.source === undefined));
        })
        .finally(() => setAdminSpotsLoading(false));
    } catch (e) {
      setRetagResult({ total: 0, updated: 0, failed: 1, failedNames: [String(e)] });
    } finally {
      setRetagLoading(false);
    }
  };

  // ─── 一括移行ハンドラ ─────────────────────────────────────────────────────
  const handleMigrate = async (force = false) => {
    setMigrateLoading(true);
    setMigrateResult(null);
    try {
      const res = await fetch("/api/admin/places-migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: ADMIN_PASSWORD, force }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "移行失敗");
      setMigrateResult(data);
    } catch (e) {
      setMigrateResult({ total: 0, registered: 0, skipped: 0, failed: 1, skippedNames: [], failedNames: [String(e)] });
    } finally {
      setMigrateLoading(false);
    }
  };

  // ─── エリア一括取り込みハンドラ ──────────────────────────────────────────
  const handleImportGeocode = async () => {
    if (!importPlace.trim()) return;
    setImportGeoLoading(true);
    setImportError("");
    try {
      const res = await fetch(`/api/geocode?area=${encodeURIComponent(importPlace.trim())}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "ジオコーディング失敗");
      setImportLat(String(data.lat));
      setImportLng(String(data.lng));
      setImportGeoLabel(importPlace.trim());
    } catch (e) {
      setImportError(`📍 場所の座標取得に失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImportGeoLoading(false);
    }
  };

  const handleImportSearch = async () => {
    if (!importKeyword.trim()) { setImportError("検索ワードを入力してください"); return; }
    // 場所名が変わっていたら先にジオコーディング
    let lat = Number(importLat);
    let lng = Number(importLng);
    if (importPlace.trim() && importPlace.trim() !== importGeoLabel) {
      setImportGeoLoading(true);
      try {
        const res = await fetch(`/api/geocode?area=${encodeURIComponent(importPlace.trim())}`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "ジオコーディング失敗");
        lat = data.lat;
        lng = data.lng;
        setImportLat(String(data.lat));
        setImportLng(String(data.lng));
        setImportGeoLabel(importPlace.trim());
      } catch (e) {
        setImportError(`📍 場所の座標取得に失敗: ${e instanceof Error ? e.message : String(e)}`);
        setImportGeoLoading(false);
        return;
      } finally {
        setImportGeoLoading(false);
      }
    }
    setImportLoading(true);
    setImportError("");
    setImportCandidates([]);
    setImportSelected(new Set());
    setImportEditTags({});
    setImportRegResult(null);
    try {
      const res = await fetch("/api/admin/place-candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: ADMIN_PASSWORD,
          keyword: importKeyword.trim(),
          lat,
          lng,
          radiusKm: Number(importRadius),
          maxCount: Number(importMax),
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "取得失敗");
      setImportCandidates(data.candidates ?? []);
      setImportSkippedCount(data.skippedAlreadyRegistered ?? 0);
      // デフォルト全選択
      setImportSelected(new Set((data.candidates ?? []).map((c: { placeId: string }) => c.placeId)));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportRegister = async () => {
    const targets = importCandidates.filter(c => importSelected.has(c.placeId));
    if (targets.length === 0) { setImportError("登録するスポットを選択してください"); return; }
    setImportRegistering(true);
    setImportError("");
    let ok = 0, skip = 0, fail = 0;
    for (const c of targets) {
      const tags = importEditTags[c.placeId] ?? c.tags;
      if (tags.length === 0) { skip++; continue; }
      try {
        const res = await fetch("/api/admin/places-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: ADMIN_PASSWORD,
            name: c.name,
            address: c.address,
            lat: c.lat,
            lng: c.lng,
            googlePlaceId: c.placeId,
            tags,
            imageUrls: c.photoUrls,
            force: false,
          }),
        });
        const d = await res.json();
        if (d.duplicate || !d.ok) skip++;
        else ok++;
      } catch { fail++; }
    }
    setImportRegResult({ ok, skip, fail });
    setImportRegistering(false);
  };

  const handleLogin = () => {
    if (passwordInput === ADMIN_PASSWORD) {
      setAuthed(true);
      setPasswordError(false);
      // メインページのadmin判定用フラグを永続化
      try { localStorage.setItem("moodgo_admin", "1"); } catch { /* ignore */ }
    } else {
      setPasswordError(true);
    }
  };

  useEffect(() => {
    if (!authed || tab !== "stats") return;
    setStatsLoading(true);
    fetch("/api/feedback")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setStats(data);
        else setStatsError(data.error ?? "取得失敗");
      })
      .catch((e) => setStatsError(String(e)))
      .finally(() => setStatsLoading(false));
  }, [authed, tab]);

  useEffect(() => {
    if (!authed || tab !== "suggestions") return;
    setSuggestionsLoading(true);
    fetch(`/api/suggestions?secret=${ADMIN_PASSWORD}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          // 管理者が追加したスポット（source === "admin"）はユーザー投稿管理には表示しない
          setSuggestions((data.suggestions as Suggestion[]).filter((s) => s.source !== "admin"));
          // 既存のタグを editableTags に設定
          const initialTags: Record<string, string[]> = {};
          for (const s of data.suggestions) {
            if (s.auto_tags?.length) initialTags[s.id] = s.auto_tags;
          }
          setEditableTags(initialTags);
        }
      })
      .finally(() => setSuggestionsLoading(false));
  }, [authed, tab]);

  // 管理者追加済みスポット読み込み（add-spotタブ）
  useEffect(() => {
    if (!authed || tab !== "add-spot") return;
    setAdminSpotsLoading(true);
    fetch(`/api/suggestions?secret=${ADMIN_PASSWORD}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setAdminSpots((data.suggestions as Suggestion[]).filter((s) => s.source === "admin" || s.source === undefined));
        }
      })
      .finally(() => setAdminSpotsLoading(false));
  }, [authed, tab, newSpotSuccess]);

  // 訪問学習データ読み込み（visitedタブ）
  useEffect(() => {
    if (!authed || tab !== "visited") return;
    setVisitedLoading(true);
    fetch(`/api/feedback?secret=${ADMIN_PASSWORD}&mode=all`)
      .then((r) => r.json())
      .then((data) => { if (data.ok) setVisitedData(data.feedback); })
      .finally(() => setVisitedLoading(false));
  }, [authed, tab]);

  // 特集ページデータ読み込み（featuredタブ）
  useEffect(() => {
    if (!authed || tab !== "featured") return;
    loadFeaturedPages();
  }, [authed, tab]);

  // 不適切報告データ読み込み（reportsタブ）
  useEffect(() => {
    if (!authed || tab !== "reports") return;
    setReportsLoading(true);
    setReportsError("");
    Promise.all([
      fetch("/api/reports").then(r => r.json()),
      fetch("/api/admin/block-place").then(r => r.json()),
    ]).then(([reportData, blockData]) => {
      if (reportData.ok) setReports(reportData.reports ?? []);
      else setReportsError(reportData.error ?? "取得に失敗しました");
      if (blockData.ok) setGloballyBlocked((blockData.blocked ?? []).map((b: { spot_name: string }) => b.spot_name));
    })
    .catch((e) => setReportsError(String(e)))
    .finally(() => setReportsLoading(false));
  }, [authed, tab]);

  // 全体ブロック実行
  const handleGlobalBlock = async (report: ReportRecord) => {
    setBlockingReport(report.id);
    setBlockError("");
    try {
      const res = await fetch("/api/admin/block-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spot_name: report.spot_name, spot_address: report.spot_address, reason: report.reason, report_id: report.id }),
      });
      const data = await res.json();
      if (data.ok) {
        setGloballyBlocked(prev => [...prev, report.spot_name]);
        setReports(prev => prev.map(r => r.id === report.id ? { ...r, status: "blocked" } : r));
      } else {
        setBlockError(`エラー: ${data.error ?? "不明なエラー"}`);
      }
    } catch (e) {
      setBlockError(`通信エラー: ${String(e)}`);
    } finally {
      setBlockingReport(null);
    }
  };

  // 全体ブロック解除
  const handleGlobalUnblock = async (spotName: string) => {
    setBlockError("");
    try {
      const res = await fetch("/api/admin/block-place", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spot_name: spotName }),
      });
      const data = await res.json();
      if (data.ok) {
        setGloballyBlocked(prev => prev.filter(n => n !== spotName));
      } else {
        setBlockError(`解除エラー: ${data.error ?? "不明なエラー"}`);
      }
    } catch (e) {
      setBlockError(`通信エラー: ${String(e)}`);
    }
  };

  // 重複スポット読み込み（mergeタブ）
  useEffect(() => {
    if (!authed || tab !== "merge") return;
    setMergeLoading(true);
    setMergeResult("");
    fetch("/api/admin/merge-duplicates")
      .then(r => r.json())
      .then(d => { if (d.ok) setMergeGroups(d.groups ?? []); })
      .catch(() => {})
      .finally(() => setMergeLoading(false));
  }, [authed, tab]);

  // 座標未登録スポット読み込み（geocodeタブ）
  useEffect(() => {
    if (!authed || tab !== "geocode") return;
    setGeoLoading(true);
    setGeoBulkResult("");
    fetch("/api/admin/geocode-missing")
      .then(r => r.json())
      .then(d => { if (d.ok) setGeoPlaces(d.data ?? []); })
      .catch(() => {})
      .finally(() => setGeoLoading(false));
  }, [authed, tab]);

  // 一括タグ修正タブ: 件数確認
  useEffect(() => {
    if (!authed || tab !== "retag") return;
    setRetagAllLoading(true);
    setRetagAllResult(null);
    fetch("/api/admin/retag-all?secret=moodgoadmin123")
      .then(r => r.json())
      .then(d => { if (d.ok) setRetagAllInfo({ total: d.total, needsRetag: d.needsRetag }); })
      .catch(() => {})
      .finally(() => setRetagAllLoading(false));
  }, [authed, tab]);

  const handleAddFeedback = async () => {
    if (!newFeedback.visitedPlace.trim() && !newFeedback.topRecommendations.trim()) {
      setFeedbackError("訪問場所またはおすすめスポット名は必須です");
      return;
    }
    setFeedbackSubmitting(true);
    setFeedbackError("");
    try {
      const recs = newFeedback.topRecommendations.split(/[,、\n]/).map(s => s.trim()).filter(Boolean);
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mood: newFeedback.mood || null,
          area: newFeedback.area || null,
          age: newFeedback.age || null,
          gender: newFeedback.gender || null,
          companion: newFeedback.companion || null,
          atmosphere: newFeedback.atmosphere || null,
          priority: newFeedback.priority || null,
          visitedPlace: newFeedback.visitedPlace || null,
          rating: newFeedback.rating ? Number(newFeedback.rating) : null,
          topRecommendations: recs,
          likedPlaces: newFeedback.visitedPlace ? [newFeedback.visitedPlace] : [],
          mapClickedPlaces: [],
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "登録失敗");
      setFeedbackSuccess(true);
      setNewFeedback({ mood: "", area: "", age: "", gender: "", companion: "", atmosphere: "", priority: "", visitedPlace: "", rating: "4", topRecommendations: "" });
      setTimeout(() => setFeedbackSuccess(false), 3000);
      // リロード
      const refreshed = await fetch(`/api/feedback?secret=${ADMIN_PASSWORD}&mode=all`).then(r => r.json());
      if (refreshed.ok) setVisitedData(refreshed.feedback);
    } catch (e) {
      setFeedbackError(e instanceof Error ? e.message : String(e));
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleDeleteFeedback = async (id: string) => {
    if (!confirm("このフィードバックを削除しますか？")) return;
    setDeletingId(id);
    try {
      await fetch("/api/feedback", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, secret: ADMIN_PASSWORD }),
      });
      setVisitedData((prev) => prev.filter((f) => f.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  // ===== 管理者スポット 削除・編集 =====
  const handleDeleteSpot = async (id: string) => {
    if (!confirm("このスポットを削除しますか？")) return;
    setDeletingSpotId(id);
    try {
      await fetch("/api/suggestions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, secret: ADMIN_PASSWORD }),
      });
      setAdminSpots((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setDeletingSpotId(null);
    }
  };

  const startEditSpot = (s: Suggestion) => {
    setEditingSpotId(s.id);
    setEditSpotForm({
      name: s.spot_name,
      description: s.description ?? "",
      address: s.address ?? "",
      stationInfo: "",
      mapUrl: s.google_maps_uri ?? "",
      isChain: s.is_chain ?? false,
      chainSearchQuery: "",
      tags: s.auto_tags ?? [],
      availableFrom: s.available_from ?? "",
      availableUntil: s.available_until ?? "",
    });
    setEditSpotTagInput("");
    setEditSpotExistingImages(s.image_urls ?? []);
    setEditSpotNewImages([]);
    setEditSpotNewPreviews([]);
  };

  const handleEditSpotSubmit = async (id: string) => {
    if (!editSpotForm.name.trim()) return;
    setEditSpotSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("id", id);
      fd.append("secret", ADMIN_PASSWORD);
      fd.append("spotName", editSpotForm.name.trim());
      fd.append("description", editSpotForm.description.trim() || "");
      fd.append("address", editSpotForm.address.trim() || "");
      fd.append("stationInfo", editSpotForm.stationInfo.trim() || "");
      fd.append("autoTags", JSON.stringify(editSpotForm.tags));
      fd.append("isChain", String(editSpotForm.isChain));
      fd.append("chainSearchQuery", editSpotForm.isChain ? (editSpotForm.chainSearchQuery.trim() || "") : "");
      fd.append("availableFrom", editSpotForm.availableFrom || "");
      fd.append("availableUntil", editSpotForm.availableUntil || "");
      // 既存画像URL（削除されたものを除く）
      fd.append("existingImageUrls", JSON.stringify(editSpotExistingImages));
      // 新規ファイル
      for (const f of editSpotNewImages) fd.append("images", f);

      const res = await fetch("/api/suggestions/edit", { method: "POST", body: fd });
      const data = await res.json();
      if (data.ok) {
        setAdminSpots((prev) => prev.map((s) => s.id === id ? {
          ...s,
          spot_name: editSpotForm.name.trim(),
          description: editSpotForm.description.trim() || null,
          address: editSpotForm.address.trim() || null,
          auto_tags: editSpotForm.tags,
          is_chain: editSpotForm.isChain,
          available_from: editSpotForm.availableFrom || null,
          available_until: editSpotForm.availableUntil || null,
          image_urls: data.imageUrls ?? s.image_urls,
        } : s));
        setEditingSpotId(null);
        setEditSpotNewImages([]);
        setEditSpotNewPreviews([]);
      }
    } finally {
      setEditSpotSubmitting(false);
    }
  };

  // ===== 訪問学習 場所検索 & AI自動入力 =====
  const handleAutoFillSearch = async () => {
    if (!autoFillQuery.trim()) return;
    setAutoFillSearching(true);
    setAutoFillCandidates([]);
    try {
      const res = await fetch("/api/suggestions/find-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotName: autoFillQuery, secret: ADMIN_PASSWORD }),
      });
      const data = await res.json();
      if (data.ok) setAutoFillCandidates(data.candidates ?? []);
    } finally {
      setAutoFillSearching(false);
    }
  };

  const handleAutoFill = async (candidate: { name: string; address: string; types: string[] }) => {
    setAutoFillLoading(true);
    try {
      const res = await fetch("/api/feedback/auto-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeName: candidate.name,
          address: candidate.address,
          placeTypes: candidate.types,
          secret: ADMIN_PASSWORD,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setNewFeedback((prev) => ({
          ...prev,
          visitedPlace: candidate.name,
          mood: data.mood || prev.mood,
          area: data.area || prev.area,
          atmosphere: data.atmosphere || prev.atmosphere,
          companion: data.companion || prev.companion,
          priority: data.priority || prev.priority,
          rating: data.rating || prev.rating,
        }));
        setAutoFillCandidates([]);
        setAutoFillQuery("");
        setAutoFillOpen(false);
      }
    } finally {
      setAutoFillLoading(false);
    }
  };

  // Googleマップ候補を検索
  const handleFindPlace = async (s: Suggestion) => {
    const query = searchQuery[s.id] ?? `${s.spot_name} ${s.address ?? ""}`.trim();
    setSearchLoading(s.id);
    setCandidates((prev) => ({ ...prev, [s.id]: [] }));
    setSelectedCandidate((prev) => ({ ...prev, [s.id]: null }));
    try {
      const res = await fetch("/api/suggestions/find-place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spotName: s.spot_name,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          secret: ADMIN_PASSWORD,
          ...(searchQuery[s.id] ? { spotName: searchQuery[s.id] } : {}),
        }),
      });
      const data = await res.json();
      if (data.ok) setCandidates((prev) => ({ ...prev, [s.id]: data.candidates }));
    } catch {}
    setSearchLoading(null);
  };

  // 候補を選択してタグを自動生成
  const handleSelectCandidate = async (suggestionId: string, s: Suggestion, candidate: PlaceCandidate) => {
    setSelectedCandidate((prev) => ({ ...prev, [suggestionId]: candidate }));
    setTagsLoading(suggestionId);
    try {
      const res = await fetch("/api/suggestions/generate-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spotName: s.spot_name,
          description: s.description,
          placeTypes: candidate.types,
          placeName: candidate.name,
          secret: ADMIN_PASSWORD,
        }),
      });
      const data = await res.json();
      if (data.ok && data.tags?.length) {
        setEditableTags((prev) => ({ ...prev, [suggestionId]: data.tags }));
      }
    } catch {}
    setTagsLoading(null);
  };

  // タグ追加
  const handleAddTag = (id: string) => {
    const t = tagInput[id]?.trim();
    if (!t) return;
    setEditableTags((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), t] }));
    setTagInput((prev) => ({ ...prev, [id]: "" }));
  };

  // タグ削除
  const handleRemoveTag = (id: string, index: number) => {
    setEditableTags((prev) => {
      const arr = [...(prev[id] ?? [])];
      arr.splice(index, 1);
      return { ...prev, [id]: arr };
    });
  };

  // 承認（Googleマップ紐付けあり or なし）
  const handleApprove = async (s: Suggestion) => {
    setActionLoading(s.id);
    const candidate = selectedCandidate[s.id];
    try {
      await fetch("/api/suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: s.id,
          status: "approved",
          adminNote: noteInput[s.id] ?? s.admin_note ?? null,
          secret: ADMIN_PASSWORD,
          googlePlaceId: candidate?.placeId ?? s.google_place_id ?? null,
          googleMapsUri: candidate?.mapsUri ?? s.google_maps_uri ?? null,
          googlePlaceName: candidate?.name ?? s.google_place_name ?? null,
          autoTags: editableTags[s.id] ?? s.auto_tags ?? [],
        }),
      });
      setSuggestions((prev) =>
        prev.map((item) =>
          item.id === s.id
            ? {
                ...item,
                status: "approved",
                admin_note: noteInput[s.id] ?? item.admin_note,
                google_place_id: candidate?.placeId ?? item.google_place_id,
                google_maps_uri: candidate?.mapsUri ?? item.google_maps_uri,
                google_place_name: candidate?.name ?? item.google_place_name,
                auto_tags: editableTags[s.id] ?? item.auto_tags,
              }
            : item
        )
      );
      setLinkingId(null);
    } finally {
      setActionLoading(null);
    }
  };

  // 却下
  const handleReject = async (id: string) => {
    setActionLoading(id);
    try {
      await fetch("/api/suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "rejected", adminNote: noteInput[id] ?? null, secret: ADMIN_PASSWORD }),
      });
      setSuggestions((prev) => prev.map((s) => s.id === id ? { ...s, status: "rejected", admin_note: noteInput[id] ?? s.admin_note } : s));
    } finally {
      setActionLoading(null);
    }
  };

  // 審査中に戻す
  const handlePending = async (id: string) => {
    setActionLoading(id);
    try {
      await fetch("/api/suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "pending", adminNote: noteInput[id] ?? null, secret: ADMIN_PASSWORD }),
      });
      setSuggestions((prev) => prev.map((s) => s.id === id ? { ...s, status: "pending" } : s));
    } finally {
      setActionLoading(null);
    }
  };

  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: "20px",
    border: "1px solid #f0dfe3",
    padding: "20px",
    boxShadow: "0 8px 20px rgba(74,48,52,0.07)",
  };
  const titleStyle: React.CSSProperties = {
    fontWeight: 900,
    fontSize: "15px",
    marginBottom: "14px",
    color: "#4a3034",
  };
  const btnBase: React.CSSProperties = {
    borderRadius: "999px",
    border: "none",
    fontWeight: 900,
    cursor: "pointer",
    fontFamily: font,
  };

  const inputBase: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: "10px",
    border: "1.5px solid #e8d8dc",
    fontFamily: font,
    fontSize: "14px",
    color: "#4a3034",
    background: "#fff",
    outline: "none",
  };

  if (!authed) {
    return (
      <div style={{ minHeight: "100vh", background: "#fdf8f9", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: font }}>
        <div style={{ ...card, maxWidth: "360px", width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔐</div>
          <h1 style={{ fontSize: "22px", fontWeight: 900, color: "#4a3034", marginBottom: "6px" }}>MoodGo 管理画面</h1>
          <p style={{ fontSize: "13px", color: "#9b7080", marginBottom: "20px" }}>パスワードを入力してください</p>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="パスワード"
            style={{ width: "100%", height: "52px", borderRadius: "16px", border: passwordError ? "2px solid #ff6b6b" : "1px solid #ead7db", padding: "0 16px", fontSize: "16px", outline: "none", background: "#fffaf8", boxSizing: "border-box", marginBottom: "12px", fontFamily: font }}
            autoFocus
          />
          {passwordError && <div style={{ color: "#c0385a", fontSize: "13px", marginBottom: "10px" }}>パスワードが違います</div>}
          <button onClick={handleLogin} style={{ ...btnBase, width: "100%", height: "48px", background: "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)", color: "#fff", fontSize: "15px" }}>
            ログイン
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fdf8f9", padding: "24px 16px", fontFamily: font, color: "#4a3034" }}>
      <div style={{ maxWidth: "860px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "26px", fontWeight: 900, marginBottom: "4px" }}>MoodGo 管理ダッシュボード</h1>
        <p style={{ fontSize: "13px", opacity: 0.65, marginBottom: "20px" }}>全ユーザーのフィードバックを集計してAIの学習に活用しています</p>

        <div style={{ display: "flex", gap: "10px", marginBottom: "24px", flexWrap: "wrap" }}>
          {([
            { key: "stats", label: "📊 統計・学習データ" },
            { key: "suggestions", label: "📍 ユーザー投稿管理" },
            { key: "add-spot", label: "➕ スポット追加" },
            { key: "import", label: "🔍 一括取り込み" },
            { key: "visited", label: "🚶 訪問学習データ" },
            { key: "reports", label: "⚠ 不適切報告" },
            { key: "featured", label: "⭐ 特集ページ" },
            { key: "devlog", label: "📋 開発ログ" },
            { key: "geocode", label: "📍 座標登録" },
            { key: "merge",   label: "🔀 重複統合" },
            { key: "retag",   label: "🏷 一括タグ修正" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...btnBase,
                padding: "10px 20px",
                background: tab === t.key ? "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)" : "#fff",
                color: tab === t.key ? "#fff" : "#4a3034",
                fontSize: "14px",
                boxShadow: tab === t.key ? "0 6px 16px rgba(255,143,127,0.3)" : "0 2px 8px rgba(74,48,52,0.08)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ===== 統計タブ ===== */}
        {tab === "stats" && (
          statsLoading ? (
            <div style={{ textAlign: "center", padding: "40px", opacity: 0.6 }}>読み込み中...</div>
          ) : statsError ? (
            <div style={{ ...card, color: "#c0385a" }}>{statsError}</div>
          ) : stats ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "20px" }}>
                <div style={{ ...card, textAlign: "center" }}>
                  <div style={{ fontSize: "40px", fontWeight: 900, color: "#ff8f7f" }}>{stats.totalCount}</div>
                  <div style={{ fontSize: "13px", opacity: 0.7 }}>総フィードバック数</div>
                </div>
                <div style={{ ...card, textAlign: "center" }}>
                  <div style={{ fontSize: "40px", fontWeight: 900, color: "#ff8f7f" }}>
                    {stats.avgRating !== null ? stats.avgRating.toFixed(1) : "—"}
                  </div>
                  <div style={{ fontSize: "13px", opacity: 0.7 }}>平均評価（5段階）</div>
                </div>
              </div>

              <div style={{ ...card, marginBottom: "20px" }}>
                <div style={titleStyle}>🏆 人気スポットランキング（ハート・マップクリック数）</div>
                {stats.topPlaces.length === 0 ? (
                  <div style={{ fontSize: "13px", opacity: 0.6 }}>まだデータがありません</div>
                ) : stats.topPlaces.slice(0, 10).map((p, i) => (
                  <div key={p.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < Math.min(stats.topPlaces.length - 1, 9) ? "1px solid #f5e8eb" : "none", fontSize: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontWeight: 900, color: "#ff8f7f", minWidth: "24px" }}>
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                      </span>
                      <span style={{ fontWeight: 700 }}>{p.name}</span>
                    </div>
                    <div style={{ display: "flex", gap: "10px", fontSize: "13px", opacity: 0.8 }}>
                      <span>♥ {p.heartCount}</span>
                      <span>🗺 {p.mapCount}</span>
                      <span style={{ fontWeight: 800, color: "#ff8f7f" }}>計 {p.totalEngagement}</span>
                    </div>
                  </div>
                ))}
              </div>

              {((stats.similarGoodVisited?.length ?? 0) > 0 || (stats.similarBadVisited?.length ?? 0) > 0) && (
                <div style={{ ...card, marginBottom: "20px" }}>
                  <div style={titleStyle}>🎯 AIが学習した訪問データ（評価付き）</div>
                  {(stats.similarGoodVisited?.length ?? 0) > 0 && (
                    <>
                      <div style={{ fontWeight: 800, fontSize: "13px", color: "#18794e", marginBottom: "8px" }}>✅ 高評価で訪れた場所（AIが優先提案）</div>
                      {stats.similarGoodVisited.map((p, i) => (
                        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < stats.similarGoodVisited.length - 1 ? "1px solid #f5e8eb" : "none", fontSize: "14px" }}>
                          <span style={{ fontWeight: 700 }}>{p.name}</span>
                          <div style={{ display: "flex", gap: "10px", fontSize: "13px", opacity: 0.8 }}>
                            <span>⭐ {p.avgRating?.toFixed(1) ?? "—"}</span>
                            <span style={{ color: "#18794e" }}>高評価 {p.goodCount}人</span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  {(stats.similarBadVisited?.length ?? 0) > 0 && (
                    <>
                      <div style={{ fontWeight: 800, fontSize: "13px", color: "#c0385a", marginTop: "16px", marginBottom: "8px" }}>❌ 低評価で訪れた場所（AIが除外）</div>
                      {stats.similarBadVisited.map((name, i) => (
                        <div key={name} style={{ padding: "6px 0", borderBottom: i < stats.similarBadVisited.length - 1 ? "1px solid #f5e8eb" : "none", fontSize: "14px", color: "#9b3c50" }}>{name}</div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {stats.topVisited.length > 0 && (
                <div style={{ ...card, marginBottom: "20px" }}>
                  <div style={titleStyle}>🚶 利用者が実際に行った場所（全体）</div>
                  {stats.topVisited.map((p, i) => (
                    <div key={p.name} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < stats.topVisited.length - 1 ? "1px solid #f5e8eb" : "none", fontSize: "14px" }}>
                      <span>{p.name}</span>
                      <span style={{ opacity: 0.65 }}>{p.count}件</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "20px" }}>
                <div style={card}>
                  <div style={titleStyle}>💭 気分別 平均評価</div>
                  {Object.keys(stats.moodStats).length === 0 ? <div style={{ fontSize: "13px", opacity: 0.6 }}>データなし</div> :
                    Object.entries(stats.moodStats).sort(([, a], [, b]) => (b.avgRating ?? 0) - (a.avgRating ?? 0)).map(([mood, s]) => (
                      <div key={mood} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px", borderBottom: "1px solid #f5e8eb" }}>
                        <span>{mood}</span>
                        <span style={{ opacity: 0.75 }}>⭐{s.avgRating?.toFixed(1) ?? "—"} ({s.count}件)</span>
                      </div>
                    ))
                  }
                </div>
                <div style={card}>
                  <div style={titleStyle}>👤 年代別 平均評価</div>
                  {Object.keys(stats.ageStats).length === 0 ? <div style={{ fontSize: "13px", opacity: 0.6 }}>データなし</div> :
                    Object.entries(stats.ageStats).sort(([, a], [, b]) => (b.avgRating ?? 0) - (a.avgRating ?? 0)).map(([age, s]) => (
                      <div key={age} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: "13px", borderBottom: "1px solid #f5e8eb" }}>
                        <span>{age}</span>
                        <span style={{ opacity: 0.75 }}>⭐{s.avgRating?.toFixed(1) ?? "—"} ({s.count}件)</span>
                      </div>
                    ))
                  }
                </div>
              </div>

              <div style={card}>
                <div style={titleStyle}>📝 最近のフィードバック</div>
                {stats.recentFeedback.length === 0 ? <div style={{ fontSize: "13px", opacity: 0.6 }}>データなし</div> :
                  stats.recentFeedback.slice(0, 10).map((f, i) => (
                    <div key={i} style={{ padding: "12px 0", borderBottom: i < 9 ? "1px solid #f5e8eb" : "none", fontSize: "13px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <div style={{ fontWeight: 800 }}>{[f.mood, f.age, f.gender, f.area].filter(Boolean).join(" / ")}</div>
                        <div style={{ color: "#ff8f7f", fontWeight: 900 }}>{"⭐".repeat(f.rating ?? 0)}</div>
                      </div>
                      <div style={{ opacity: 0.65 }}>提案: {(f.top_recommendations ?? []).slice(0, 2).join("、")}</div>
                      {f.visited_place && <div style={{ color: "#18794e", marginTop: "2px" }}>→ 実際に行った: {f.visited_place}</div>}
                      <div style={{ opacity: 0.45, marginTop: "2px" }}>{new Date(f.created_at).toLocaleDateString("ja-JP")}</div>
                    </div>
                  ))
                }
              </div>
            </>
          ) : null
        )}

        {/* ===== 投稿管理タブ ===== */}
        {tab === "suggestions" && (
          suggestionsLoading ? (
            <div style={{ textAlign: "center", padding: "40px", opacity: 0.6 }}>読み込み中...</div>
          ) : (
            <>
              {suggestions.length === 0 ? (
                <div style={{ ...card, textAlign: "center", padding: "40px", opacity: 0.6 }}>まだ投稿がありません</div>
              ) : suggestions.map((s) => {
                const isLinking = linkingId === s.id;
                const cands = candidates[s.id] ?? [];
                const selCand = selectedCandidate[s.id];
                const tags = editableTags[s.id] ?? s.auto_tags ?? [];

                return (
                  <div key={s.id} style={{ ...card, marginBottom: "16px", borderLeft: `4px solid ${s.status === "approved" ? "#18794e" : s.status === "rejected" ? "#c0385a" : "#ffbf67"}` }}>
                    {/* ヘッダー */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                      <div>
                        <span style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: "999px",
                          fontSize: "11px",
                          fontWeight: 900,
                          marginBottom: "6px",
                          background: s.status === "approved" ? "#e8f5e9" : s.status === "rejected" ? "#fce4e4" : "#fff8e1",
                          color: s.status === "approved" ? "#18794e" : s.status === "rejected" ? "#c0385a" : "#b07030",
                        }}>
                          {s.status === "approved" ? "✅ 承認済み" : s.status === "rejected" ? "❌ 却下" : "⏳ 審査中"}
                        </span>
                        <div style={{ fontWeight: 900, fontSize: "17px", color: "#4a3034" }}>{s.spot_name}</div>
                      </div>
                      <div style={{ fontSize: "12px", opacity: 0.55 }}>{new Date(s.created_at).toLocaleDateString("ja-JP")}</div>
                    </div>

                    {s.description && <div style={{ fontSize: "14px", lineHeight: 1.7, marginBottom: "10px", color: "#7a5860" }}>{s.description}</div>}

                    {s.address && (
                      <div style={{ fontSize: "13px", marginBottom: "8px" }}>
                        📍 {s.address}
                        {s.lat && s.lng && (
                          <a href={`https://www.google.com/maps?q=${s.lat},${s.lng}`} target="_blank" rel="noreferrer"
                            style={{ marginLeft: "8px", color: "#4184ff", fontSize: "12px", fontWeight: 700 }}>
                            GPS地図 →
                          </a>
                        )}
                      </div>
                    )}

                    {s.contact && <div style={{ fontSize: "13px", marginBottom: "10px", color: "#18794e" }}>📬 連絡先: {s.contact}</div>}

                    {/* 承認済みのGoogleマップ紐付け情報 */}
                    {s.google_place_name && (
                      <div style={{ background: "#e8f5e9", borderRadius: "12px", padding: "10px 14px", marginBottom: "10px", fontSize: "13px" }}>
                        <span style={{ fontWeight: 800, color: "#18794e" }}>🗺 Googleマップ紐付け済み: </span>
                        <a href={s.google_maps_uri ?? "#"} target="_blank" rel="noreferrer" style={{ color: "#4184ff", fontWeight: 700 }}>
                          {s.google_place_name} →
                        </a>
                      </div>
                    )}

                    {/* 現在のタグ表示 */}
                    {tags.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                        {tags.map((tag, ti) => (
                          <span key={ti} style={{
                            padding: "4px 10px",
                            borderRadius: "999px",
                            background: "#fff3e6",
                            border: "1px solid #ffd8a8",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#8a4500",
                          }}>{tag}</span>
                        ))}
                      </div>
                    )}

                    {(s.image_urls?.length ?? 0) > 0 && (
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
                        {s.image_urls.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt={`img-${i}`} style={{ width: "100px", height: "100px", objectFit: "cover", borderRadius: "12px", border: "1px solid #f0dfe3" }} />
                          </a>
                        ))}
                      </div>
                    )}

                    {/* 管理メモ */}
                    <textarea
                      value={noteInput[s.id] ?? s.admin_note ?? ""}
                      onChange={(e) => setNoteInput((prev) => ({ ...prev, [s.id]: e.target.value }))}
                      placeholder="管理メモ（内部用）"
                      rows={2}
                      style={{ width: "100%", borderRadius: "12px", border: "1px solid #ead7db", padding: "10px 12px", fontSize: "13px", resize: "vertical", boxSizing: "border-box", outline: "none", background: "#fffaf8", fontFamily: font, marginBottom: "12px" }}
                    />

                    {/* ===== Googleマップ紐付けパネル ===== */}
                    <div style={{ marginBottom: "12px" }}>
                      <button
                        onClick={() => setLinkingId(isLinking ? null : s.id)}
                        style={{
                          ...btnBase,
                          padding: "8px 18px",
                          background: isLinking ? "#f0dfe3" : "linear-gradient(135deg, #4184ff 0%, #5b6dff 100%)",
                          color: isLinking ? "#4a3034" : "#fff",
                          fontSize: "13px",
                          marginBottom: isLinking ? "14px" : "0",
                        }}
                      >
                        🗺 Googleマップで紐付け {isLinking ? "▲ 閉じる" : "▼ 開く"}
                      </button>

                      {isLinking && (
                        <div style={{ background: "#f8f9ff", borderRadius: "16px", border: "1px solid #d0d8ff", padding: "16px", marginTop: "10px" }}>
                          {/* 検索フォーム */}
                          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                            <input
                              type="text"
                              value={searchQuery[s.id] ?? `${s.spot_name} ${s.address ?? ""}`.trim()}
                              onChange={(e) => setSearchQuery((prev) => ({ ...prev, [s.id]: e.target.value }))}
                              placeholder="スポット名や住所で検索"
                              style={{ flex: 1, height: "40px", borderRadius: "10px", border: "1px solid #c0c8e0", padding: "0 12px", fontSize: "13px", outline: "none", background: "#fff", fontFamily: font }}
                            />
                            <button
                              onClick={() => handleFindPlace(s)}
                              disabled={searchLoading === s.id}
                              style={{ ...btnBase, padding: "0 16px", height: "40px", background: "#4184ff", color: "#fff", fontSize: "13px", opacity: searchLoading === s.id ? 0.6 : 1 }}
                            >
                              {searchLoading === s.id ? "検索中..." : "🔍 検索"}
                            </button>
                          </div>

                          {/* 候補リスト */}
                          {cands.length > 0 && (
                            <div style={{ marginBottom: "14px" }}>
                              <div style={{ fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "8px" }}>検索結果（クリックで選択）:</div>
                              {cands.map((c) => (
                                <div
                                  key={c.placeId}
                                  onClick={() => handleSelectCandidate(s.id, s, c)}
                                  style={{
                                    padding: "10px 14px",
                                    borderRadius: "12px",
                                    border: `2px solid ${selCand?.placeId === c.placeId ? "#4184ff" : "#e0e4f0"}`,
                                    background: selCand?.placeId === c.placeId ? "#eef2ff" : "#fff",
                                    cursor: "pointer",
                                    marginBottom: "6px",
                                    transition: "all 0.15s",
                                  }}
                                >
                                  <div style={{ fontWeight: 800, fontSize: "14px", color: "#4a3034" }}>
                                    {selCand?.placeId === c.placeId ? "✅ " : ""}{c.name}
                                  </div>
                                  <div style={{ fontSize: "12px", color: "#7a8090", marginTop: "2px" }}>{c.address}</div>
                                  <div style={{ display: "flex", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
                                    {c.rating !== null && <span style={{ fontSize: "11px", background: "#fff8e1", padding: "2px 8px", borderRadius: "999px", fontWeight: 700 }}>⭐ {c.rating}</span>}
                                    {c.types.slice(0, 3).map((t) => <span key={t} style={{ fontSize: "11px", background: "#f0f4ff", padding: "2px 8px", borderRadius: "999px", color: "#4060b0" }}>{t}</span>)}
                                    <a href={c.mapsUri} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: "11px", color: "#4184ff", fontWeight: 700 }}>マップで確認 →</a>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* タグ編集エリア */}
                          {(selCand || s.google_place_name) && (
                            <div>
                              <div style={{ fontWeight: 800, fontSize: "13px", color: "#4a3034", marginBottom: "8px" }}>
                                🏷 特徴タグ（AIが自動生成・編集可能）:
                                {tagsLoading === s.id && <span style={{ fontSize: "11px", color: "#7a8090", marginLeft: "8px" }}>生成中...</span>}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
                                {tags.map((tag, ti) => (
                                  <span
                                    key={ti}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                      padding: "4px 10px",
                                      borderRadius: "999px",
                                      background: "#fff3e6",
                                      border: "1px solid #ffd8a8",
                                      fontSize: "12px",
                                      fontWeight: 700,
                                      color: "#8a4500",
                                      cursor: "pointer",
                                    }}
                                    onClick={() => handleRemoveTag(s.id, ti)}
                                    title="クリックで削除"
                                  >
                                    {tag} <span style={{ opacity: 0.5, fontSize: "10px" }}>✕</span>
                                  </span>
                                ))}
                                {tags.length === 0 && <span style={{ fontSize: "12px", opacity: 0.6 }}>タグがありません</span>}
                              </div>
                              <div style={{ display: "flex", gap: "6px" }}>
                                <input
                                  type="text"
                                  value={tagInput[s.id] ?? ""}
                                  onChange={(e) => setTagInput((prev) => ({ ...prev, [s.id]: e.target.value }))}
                                  onKeyDown={(e) => e.key === "Enter" && handleAddTag(s.id)}
                                  placeholder="例: 🅿 2時間無料駐車場"
                                  style={{ flex: 1, height: "36px", borderRadius: "10px", border: "1px solid #c0c8e0", padding: "0 10px", fontSize: "12px", outline: "none", fontFamily: font }}
                                />
                                <button
                                  onClick={() => handleAddTag(s.id)}
                                  style={{ ...btnBase, padding: "0 12px", height: "36px", background: "#ff8f7f", color: "#fff", fontSize: "13px" }}
                                >
                                  追加
                                </button>
                              </div>
                              <div style={{ fontSize: "11px", color: "#9b7080", marginTop: "6px" }}>タグをクリックすると削除できます</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Supabase Places 登録パネル ───────────────────────── */}
                    {s.status === "approved" && (
                      <div style={{ marginBottom: "12px" }}>
                        {placesRegDone[s.id] ? (
                          <div style={{ padding: "10px 14px", borderRadius: "12px", background: "#e8f5e9", color: "#18794e", fontSize: "13px", fontWeight: 800 }}>
                            ✅ Supabase places に登録済みです
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                const isOpen = placesPanelOpen[s.id];
                                setPlacesPanelOpen(prev => ({ ...prev, [s.id]: !isOpen }));
                                if (!isOpen && !placesRegTags[s.id]) {
                                  setPlacesRegTags(prev => ({ ...prev, [s.id]: editableTags[s.id] ?? s.auto_tags ?? [] }));
                                  setPlacesRegLat(prev => ({ ...prev, [s.id]: s.lat ? String(s.lat) : "" }));
                                  setPlacesRegLng(prev => ({ ...prev, [s.id]: s.lng ? String(s.lng) : "" }));
                                }
                              }}
                              style={{ ...btnBase, padding: "8px 16px", background: placesPanelOpen[s.id] ? "#f0dfe3" : "linear-gradient(135deg, #18794e, #10b977)", color: placesPanelOpen[s.id] ? "#4a3034" : "#fff", fontSize: "13px", marginBottom: placesPanelOpen[s.id] ? "12px" : "0" }}
                            >
                              🗄 Supabase Placesに登録 {placesPanelOpen[s.id] ? "▲ 閉じる" : "▼ 開く"}
                            </button>

                            {placesPanelOpen[s.id] && (
                              <div style={{ background: "#f0faf5", borderRadius: "14px", border: "1px solid #a0d4b8", padding: "16px" }}>
                                <div style={{ fontSize: "13px", fontWeight: 900, color: "#18794e", marginBottom: "12px" }}>🗄 Supabase places テーブルへの登録情報</div>

                                {/* タグ編集 */}
                                <div style={{ marginBottom: "12px" }}>
                                  <div style={{ fontSize: "12px", fontWeight: 800, color: "#18794e", marginBottom: "6px" }}>🏷 タグ（気分タグ必須）:</div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}>
                                    {(placesRegTags[s.id] ?? []).map((tag, ti) => (
                                      <span
                                        key={ti}
                                        onClick={() => setPlacesRegTags(prev => ({ ...prev, [s.id]: (prev[s.id] ?? []).filter((_, i) => i !== ti) }))}
                                        style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "999px", background: "#d8f5e8", border: "1px solid #a0d4b8", fontSize: "12px", fontWeight: 700, color: "#18794e", cursor: "pointer" }}
                                        title="クリックで削除"
                                      >
                                        {tag} <span style={{ opacity: 0.5, fontSize: "10px" }}>✕</span>
                                      </span>
                                    ))}
                                    {(placesRegTags[s.id] ?? []).length === 0 && <span style={{ fontSize: "12px", color: "#c0385a" }}>⚠️ タグを設定してください</span>}
                                  </div>
                                  {/* タグカテゴリから選ぶ */}
                                  <div style={{ marginBottom: "8px" }}>
                                    <select
                                      defaultValue=""
                                      onChange={(e) => {
                                        if (!e.target.value) return;
                                        const val = e.target.value;
                                        setPlacesRegTags(prev => {
                                          const cur = prev[s.id] ?? [];
                                          return { ...prev, [s.id]: cur.includes(val) ? cur : [...cur, val] };
                                        });
                                        e.target.value = "";
                                      }}
                                      style={{ width: "100%", height: "36px", borderRadius: "10px", border: "1px solid #a0d4b8", padding: "0 10px", fontSize: "12px", outline: "none", background: "#fff", fontFamily: font, marginBottom: "6px" }}
                                    >
                                      <option value="">＋ タグカテゴリから選ぶ…</option>
                                      {TAG_CATEGORIES.map(cat => (
                                        <optgroup key={cat.key} label={cat.label}>
                                          {cat.tags.map(t => <option key={t} value={t}>{t}</option>)}
                                        </optgroup>
                                      ))}
                                    </select>
                                  </div>
                                  <div style={{ display: "flex", gap: "6px" }}>
                                    <input
                                      type="text"
                                      value={placesRegTagInput[s.id] ?? ""}
                                      onChange={(e) => setPlacesRegTagInput(prev => ({ ...prev, [s.id]: e.target.value }))}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" && placesRegTagInput[s.id]?.trim()) {
                                          const val = placesRegTagInput[s.id].trim();
                                          setPlacesRegTags(prev => { const cur = prev[s.id] ?? []; return { ...prev, [s.id]: cur.includes(val) ? cur : [...cur, val] }; });
                                          setPlacesRegTagInput(prev => ({ ...prev, [s.id]: "" }));
                                        }
                                      }}
                                      placeholder="#タグを手入力してEnter"
                                      style={{ flex: 1, height: "34px", borderRadius: "10px", border: "1px solid #a0d4b8", padding: "0 10px", fontSize: "12px", outline: "none", background: "#fff", fontFamily: font }}
                                    />
                                    <button
                                      onClick={() => {
                                        const val = (placesRegTagInput[s.id] ?? "").trim();
                                        if (!val) return;
                                        setPlacesRegTags(prev => { const cur = prev[s.id] ?? []; return { ...prev, [s.id]: cur.includes(val) ? cur : [...cur, val] }; });
                                        setPlacesRegTagInput(prev => ({ ...prev, [s.id]: "" }));
                                      }}
                                      style={{ ...btnBase, padding: "0 12px", height: "34px", background: "#18794e", color: "#fff", fontSize: "12px" }}
                                    >追加</button>
                                  </div>
                                </div>

                                {/* 緯度・経度・エリア */}
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "12px" }}>
                                  <div>
                                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "4px", color: "#18794e" }}>緯度</label>
                                    <input
                                      type="number" step="any"
                                      value={placesRegLat[s.id] ?? ""}
                                      onChange={(e) => setPlacesRegLat(prev => ({ ...prev, [s.id]: e.target.value }))}
                                      placeholder="35.6812"
                                      style={{ width: "100%", height: "36px", borderRadius: "10px", border: "1px solid #a0d4b8", padding: "0 8px", fontSize: "12px", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: font }}
                                    />
                                  </div>
                                  <div>
                                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "4px", color: "#18794e" }}>経度</label>
                                    <input
                                      type="number" step="any"
                                      value={placesRegLng[s.id] ?? ""}
                                      onChange={(e) => setPlacesRegLng(prev => ({ ...prev, [s.id]: e.target.value }))}
                                      placeholder="139.7671"
                                      style={{ width: "100%", height: "36px", borderRadius: "10px", border: "1px solid #a0d4b8", padding: "0 8px", fontSize: "12px", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: font }}
                                    />
                                  </div>
                                  <div>
                                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "4px", color: "#18794e" }}>エリア</label>
                                    <input
                                      type="text"
                                      value={placesRegArea[s.id] ?? ""}
                                      onChange={(e) => setPlacesRegArea(prev => ({ ...prev, [s.id]: e.target.value }))}
                                      placeholder="例: 東京・渋谷"
                                      style={{ width: "100%", height: "36px", borderRadius: "10px", border: "1px solid #a0d4b8", padding: "0 8px", fontSize: "12px", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: font }}
                                    />
                                  </div>
                                </div>

                                {placesRegError[s.id] && (
                                  <div style={{ marginBottom: "10px", padding: "8px 12px", borderRadius: "10px", background: "#fce4e4", color: "#c0385a", fontSize: "12px", fontWeight: 700 }}>
                                    ❌ {placesRegError[s.id]}
                                  </div>
                                )}

                                {placesRegDuplicate[s.id] && (
                                  <div style={{ marginBottom: "10px", padding: "10px 14px", borderRadius: "10px", background: "#fff3e0", border: "1.5px solid #fb8c00" }}>
                                    <div style={{ fontWeight: 800, color: "#e65100", fontSize: "13px", marginBottom: "6px" }}>
                                      ⚠️ 同名スポットがすでに存在します：「{placesRegDuplicate[s.id].existingName}」
                                    </div>
                                    <div style={{ display: "flex", gap: "8px" }}>
                                      <button
                                        onClick={() => setPlacesRegDuplicate(prev => { const n = { ...prev }; delete n[s.id]; return n; })}
                                        style={{ ...btnBase, flex: 1, padding: "6px", background: "#f5f5f5", color: "#555", fontSize: "12px" }}
                                      >
                                        キャンセル
                                      </button>
                                      <button
                                        onClick={() => handleRegisterSuggestionToPlaces(s, true)}
                                        disabled={placesRegLoading[s.id]}
                                        style={{ ...btnBase, flex: 2, padding: "6px", background: "linear-gradient(135deg, #fb8c00, #e65100)", color: "#fff", fontSize: "12px", fontWeight: 900 }}
                                      >
                                        上書きして登録する
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {!placesRegDuplicate[s.id] && (
                                  <button
                                    onClick={() => handleRegisterSuggestionToPlaces(s)}
                                    disabled={placesRegLoading[s.id]}
                                    style={{ ...btnBase, width: "100%", height: "44px", background: placesRegLoading[s.id] ? "#ccc" : "linear-gradient(135deg, #18794e, #10b977)", color: "#fff", fontSize: "14px", fontWeight: 900 }}
                                  >
                                    {placesRegLoading[s.id] ? "登録中..." : "🗄 Supabase places に登録する"}
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {/* ──────────────────────────────────────────────────── */}

                    {/* アクションボタン */}
                    {s.status === "pending" && (
                      <div style={{ display: "flex", gap: "10px" }}>
                        <button
                          onClick={() => handleApprove(s)}
                          disabled={actionLoading === s.id}
                          style={{ flex: 1, height: "44px", ...btnBase, background: "linear-gradient(135deg, #18794e 0%, #10b977 100%)", color: "#fff", fontSize: "14px" }}
                        >
                          {actionLoading === s.id ? "..." : "✅ 承認する"}
                        </button>
                        <button
                          onClick={() => handleReject(s.id)}
                          disabled={actionLoading === s.id}
                          style={{ flex: 1, height: "44px", ...btnBase, background: "#c0385a", color: "#fff", fontSize: "14px" }}
                        >
                          {actionLoading === s.id ? "..." : "❌ 却下する"}
                        </button>
                      </div>
                    )}
                    {s.status === "approved" && (
                      <div style={{ display: "flex", gap: "10px" }}>
                        <button
                          onClick={() => handleApprove(s)}
                          disabled={actionLoading === s.id}
                          style={{ flex: 1, height: "40px", ...btnBase, background: "linear-gradient(135deg, #4184ff 0%, #5b6dff 100%)", color: "#fff", fontSize: "13px" }}
                        >
                          {actionLoading === s.id ? "..." : "🔄 タグ・紐付けを更新する"}
                        </button>
                        <button
                          onClick={() => handlePending(s.id)}
                          disabled={actionLoading === s.id}
                          style={{ height: "40px", padding: "0 16px", ...btnBase, border: "1px solid #ead7db", background: "#fff", color: "#4a3034", fontSize: "13px" }}
                        >
                          審査中に戻す
                        </button>
                      </div>
                    )}
                    {s.status === "rejected" && (
                      <button
                        onClick={() => handlePending(s.id)}
                        disabled={actionLoading === s.id}
                        style={{ height: "38px", padding: "0 20px", ...btnBase, border: "1px solid #ead7db", background: "#fff", color: "#4a3034", fontSize: "13px" }}
                      >
                        審査中に戻す
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )
        )}

        {/* ===== スポット追加タブ ===== */}
        {tab === "add-spot" && (
          <div style={{ ...card }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
              <div style={titleStyle}>➕ 管理者スポット追加（Googleマップにない場所）</div>
              <button
                onClick={() => { setQuickModal(true); setQuickStep("input"); setQuickError(""); }}
                style={{ ...btnBase, padding: "10px 20px", background: "linear-gradient(135deg, #7c3aed, #4f46e5)", color: "#fff", fontSize: "13px", fontWeight: 900, boxShadow: "0 4px 14px rgba(124,58,237,0.35)", whiteSpace: "nowrap" }}
              >
                ⚡ クイック投稿
              </button>
            </div>
            <p style={{ fontSize: "13px", color: "#7a5860", marginBottom: "20px", lineHeight: 1.7 }}>
              Googleマップに登録されていない独自スポットを直接追加できます。追加後は即座に検索結果に表示されます。
            </p>

            {/* クイック投稿モーダル */}
            {quickModal && (
              <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
                <div style={{ background: "#fff", borderRadius: "20px", width: "100%", maxWidth: "640px", maxHeight: "90vh", overflow: "auto", padding: "28px", fontFamily: font, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
                  {/* ヘッダー */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                    <div style={{ fontSize: "18px", fontWeight: 900, color: "#4a3034" }}>⚡ クイック投稿</div>
                    <button onClick={() => { setQuickModal(false); setQuickStep("input"); setQuickError(""); }} style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#9b7080" }}>✕</button>
                  </div>

                  {quickError && (
                    <div style={{ background: "#fff0f0", border: "1px solid #ffcccc", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px", color: "#c0385a", fontSize: "13px" }}>
                      ⚠ {quickError}
                    </div>
                  )}

                  {/* Step 1: 入力 */}
                  {quickStep === "input" && (
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#4a3034", marginBottom: "6px" }}>
                        スポット名 <span style={{ color: "#c0385a" }}>*</span>
                      </div>
                      <input
                        value={quickQuery}
                        onChange={(e) => setQuickQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleQuickFetchPlaces(); }}
                        placeholder="例: 渋谷 隠れ家カフェ、〇〇公園"
                        style={{ ...inputBase, width: "100%", boxSizing: "border-box", marginBottom: "16px", fontSize: "14px" }}
                        autoFocus
                      />
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#4a3034", marginBottom: "6px" }}>
                        TikTok URL <span style={{ fontWeight: 400, fontSize: "12px", color: "#9b7080" }}>（任意・参考用）</span>
                      </div>
                      <input
                        value={quickTikTokUrl}
                        onChange={(e) => setQuickTikTokUrl(e.target.value)}
                        placeholder="https://www.tiktok.com/@xxx/video/..."
                        style={{ ...inputBase, width: "100%", boxSizing: "border-box", marginBottom: "16px", fontSize: "13px" }}
                      />
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#4a3034", marginBottom: "6px" }}>
                        メモ <span style={{ fontWeight: 400, fontSize: "12px", color: "#9b7080" }}>（任意・AIの生成に反映）</span>
                      </div>
                      <input
                        value={quickAdminHint}
                        onChange={(e) => setQuickAdminHint(e.target.value)}
                        placeholder="例: 週末限定メニューあり、インスタ映えスポット"
                        style={{ ...inputBase, width: "100%", boxSizing: "border-box", marginBottom: "20px", fontSize: "13px" }}
                      />
                      <button
                        onClick={handleQuickFetchPlaces}
                        disabled={!quickQuery.trim()}
                        style={{ ...btnBase, width: "100%", padding: "14px", background: "linear-gradient(135deg, #7c3aed, #4f46e5)", color: "#fff", fontSize: "15px", fontWeight: 900, opacity: quickQuery.trim() ? 1 : 0.5 }}
                      >
                        🔍 スポット情報を自動取得
                      </button>
                    </div>
                  )}

                  {/* Step 2: ローディング */}
                  {quickStep === "loading" && (
                    <div style={{ textAlign: "center", padding: "48px 0" }}>
                      <div style={{ fontSize: "40px", marginBottom: "16px", animation: "spin 1s linear infinite" }}>⏳</div>
                      <div style={{ fontSize: "16px", fontWeight: 700, color: "#4a3034", marginBottom: "8px" }}>自動取得中...</div>
                      <div style={{ fontSize: "13px", color: "#9b7080" }}>Google Placesで場所情報を取得し、AIがコンテンツを生成しています</div>
                    </div>
                  )}

                  {/* Step 3: プレビュー */}
                  {quickStep === "preview" && quickPlace && quickAI && (
                    <div>
                      {/* 写真サムネイル */}
                      {quickPlace.photoUrls.length > 0 && (
                        <div style={{ marginBottom: "20px" }}>
                          <div style={{ fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "8px" }}>📸 写真（クリックでカバー画像に設定）</div>
                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            {quickPlace.photoUrls.map((url, i) => (
                              <div
                                key={i}
                                onClick={() => setQuickCoverUrl(url)}
                                style={{
                                  width: "100px", height: "80px", borderRadius: "10px", overflow: "hidden", cursor: "pointer",
                                  border: quickCoverUrl === url ? "3px solid #7c3aed" : "3px solid transparent",
                                  boxShadow: quickCoverUrl === url ? "0 0 0 2px #7c3aed55" : "none",
                                  transition: "all 0.15s",
                                }}
                              >
                                <img src={url} alt={`photo-${i}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              </div>
                            ))}
                          </div>
                          {quickCoverUrl && (
                            <div style={{ fontSize: "11px", color: "#7c3aed", marginTop: "6px", fontWeight: 700 }}>✓ カバー画像を選択済み</div>
                          )}
                        </div>
                      )}

                      {/* 場所情報 */}
                      <div style={{ background: "#f9f6ff", borderRadius: "12px", padding: "16px", marginBottom: "16px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 800, color: "#7c3aed", marginBottom: "10px" }}>📍 場所情報</div>
                        <div style={{ display: "grid", gap: "8px", fontSize: "13px", color: "#4a3034" }}>
                          <div><strong>スポット名:</strong>
                            <input
                              value={quickPlace.name}
                              onChange={(e) => setQuickPlace({ ...quickPlace, name: e.target.value })}
                              style={{ ...inputBase, display: "inline-block", marginLeft: "8px", padding: "4px 10px", fontSize: "13px" }}
                            />
                          </div>
                          <div><strong>住所:</strong> {quickPlace.address}</div>
                          {quickPlace.phone && <div><strong>☎ 電話:</strong> {quickPlace.phone}</div>}
                          {quickPlace.hours && <div><strong>🕐 営業時間:</strong> <span style={{ fontSize: "12px" }}>{quickPlace.hours}</span></div>}
                          {quickPlace.website && <div><strong>🌐 Web:</strong> <a href={quickPlace.website} target="_blank" rel="noopener noreferrer" style={{ color: "#7c3aed" }}>{quickPlace.website}</a></div>}
                        </div>
                      </div>

                      {/* AI生成コンテンツ */}
                      <div style={{ background: "#fff9e6", borderRadius: "12px", padding: "16px", marginBottom: "16px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 800, color: "#b45309", marginBottom: "10px" }}>✨ AIが生成したコンテンツ</div>
                        <div style={{ display: "grid", gap: "10px", fontSize: "13px", color: "#4a3034" }}>
                          <div>
                            <strong>キャッチコピー:</strong>
                            <input
                              value={quickAI.catch_copy}
                              onChange={(e) => setQuickAI({ ...quickAI, catch_copy: e.target.value })}
                              style={{ ...inputBase, display: "block", width: "100%", boxSizing: "border-box", marginTop: "4px", fontSize: "13px" }}
                            />
                          </div>
                          <div>
                            <strong>📝 説明文:</strong>
                            <textarea
                              value={quickAI.description}
                              onChange={(e) => setQuickAI({ ...quickAI, description: e.target.value })}
                              rows={4}
                              style={{ ...inputBase, display: "block", width: "100%", boxSizing: "border-box", marginTop: "4px", fontSize: "13px", resize: "vertical" }}
                            />
                          </div>
                          <div>
                            <strong>🏷 タグ</strong> <span style={{ fontWeight: 400, fontSize: "11px", color: "#888" }}>(クリックで削除)</span>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
                              {quickAI.tags.map((tag, i) => (
                                <span
                                  key={i}
                                  onClick={() => setQuickAI({ ...quickAI, tags: quickAI.tags.filter((_, idx) => idx !== i) })}
                                  style={{ background: "#ede9fe", color: "#7c3aed", fontSize: "12px", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", cursor: "pointer", userSelect: "none" }}
                                >
                                  {tag} ✕
                                </span>
                              ))}
                            </div>
                          </div>
                          {quickAI.recommended_items.length > 0 && (
                            <div>
                              <strong>おすすめ:</strong>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
                                {quickAI.recommended_items.map((item, i) => (
                                  <span key={i} style={{ background: "#fff3e0", color: "#e65100", fontSize: "12px", fontWeight: 700, padding: "4px 10px", borderRadius: "999px" }}>{item}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Supabase places 登録トグル */}
                      <div
                        onClick={() => setQuickRegisterToPlaces(p => !p)}
                        style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "12px", background: quickRegisterToPlaces ? "#edf7f0" : "#f5f5f5", border: `1.5px solid ${quickRegisterToPlaces ? "#18794e" : "#ddd"}`, cursor: "pointer", transition: "all 0.2s" }}
                      >
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setQuickRegisterToPlaces(p => !p); }}
                          style={{ width: "40px", height: "22px", borderRadius: "999px", border: "none", background: quickRegisterToPlaces ? "#18794e" : "#ccc", cursor: "pointer", position: "relative", flexShrink: 0, transition: "background 0.2s" }}
                        >
                          <span style={{ position: "absolute", top: "2px", left: quickRegisterToPlaces ? "20px" : "2px", width: "18px", height: "18px", borderRadius: "999px", background: "#fff", transition: "left 0.2s" }} />
                        </button>
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 800, color: quickRegisterToPlaces ? "#18794e" : "#666" }}>🗄 Supabase places にも登録する</div>
                          <div style={{ fontSize: "11px", color: "#999" }}>気分別ハイブリッド検索に反映されます</div>
                        </div>
                      </div>

                      {/* アクションボタン */}
                      <div style={{ display: "flex", gap: "10px" }}>
                        <button
                          onClick={handleQuickFillForm}
                          style={{ ...btnBase, flex: 1, padding: "12px", background: "#f0f0f0", color: "#4a3034", fontSize: "13px", fontWeight: 900 }}
                        >
                          ✏ 手動で修正
                        </button>
                        <button
                          onClick={handleQuickPublish}
                          disabled={quickPublishing}
                          style={{ ...btnBase, flex: 2, padding: "12px", background: "linear-gradient(135deg, #16a34a, #15803d)", color: "#fff", fontSize: "14px", fontWeight: 900 }}
                        >
                          {quickPublishing ? "公開中..." : "✅ このまま公開する"}
                        </button>
                      </div>
                      <div style={{ textAlign: "center", marginTop: "10px" }}>
                        <button
                          onClick={() => { setQuickStep("input"); setQuickPlace(null); setQuickAI(null); setQuickCoverUrl(""); }}
                          style={{ background: "none", border: "none", color: "#9b7080", fontSize: "12px", cursor: "pointer", fontFamily: font }}
                        >
                          ← 最初からやり直す
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {newSpotSuccess && (
              <div style={{ background: "#e8f5e9", border: "1px solid #c8e6c9", borderRadius: "12px", padding: "12px 16px", marginBottom: "16px", color: "#2e7d32", fontWeight: 700, fontSize: "14px" }}>
                {newSpotSuccessMsg}
              </div>
            )}
            {newSpotError && (
              <div style={{ background: "#fce4e4", border: "1px solid #f5c0c8", borderRadius: "12px", padding: "12px 16px", marginBottom: "16px", color: "#c0385a", fontWeight: 700, fontSize: "14px" }}>
                ❌ {newSpotError}
              </div>
            )}

            {/* チェーン店トグル */}
            <div style={{ marginBottom: "16px", padding: "14px", borderRadius: "14px", background: isChain ? "#eef4ff" : "#f9f5f6", border: `1px solid ${isChain ? "#b3cfff" : "#ead7db"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: isChain ? "12px" : "0" }}>
                <button
                  onClick={() => setIsChain((v) => !v)}
                  style={{ width: "44px", height: "24px", borderRadius: "999px", border: "none", background: isChain ? "#4184ff" : "#d0bfc2", cursor: "pointer", position: "relative", flexShrink: 0, transition: "background 0.2s" }}
                  aria-label="チェーン店切替"
                >
                  <span style={{ position: "absolute", top: "3px", left: isChain ? "22px" : "3px", width: "18px", height: "18px", borderRadius: "999px", background: "#fff", transition: "left 0.2s" }} />
                </button>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 900, color: "#4a3034" }}>🏪 チェーン店として登録</div>
                  <div style={{ fontSize: "11px", color: "#9b7b82", marginTop: "2px" }}>ONにすると、ユーザーの位置から最寄り店舗を自動検索して表示します</div>
                </div>
              </div>
              {isChain && (
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "6px", color: "#4a3034" }}>
                    検索クエリ <span style={{ color: "#c0385a" }}>*</span>
                    <span style={{ fontWeight: 400, color: "#9b7b82", marginLeft: "6px" }}>Google Placesで検索するチェーン名</span>
                  </label>
                  <input
                    type="text"
                    value={chainSearchQuery}
                    onChange={(e) => setChainSearchQuery(e.target.value)}
                    placeholder="例：IKEA、スターバックス、ニトリ、コストコ"
                    style={{ width: "100%", height: "44px", borderRadius: "10px", border: "1px solid #b3cfff", padding: "0 14px", fontSize: "14px", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: font }}
                  />
                  <div style={{ fontSize: "11px", color: "#6080b0", marginTop: "6px" }}>
                    💡 ユーザーが「横浜エリア」で検索すると「IKEA 横浜」として検索され、最寄り店舗が表示されます
                  </div>
                </div>
              )}
            </div>

            {/* スポット名 */}
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 800, marginBottom: "6px", color: "#4a3034" }}>
                {isChain ? "チェーン名（表示用）" : "スポット名"} <span style={{ color: "#c0385a" }}>*</span>
              </label>
              <input
                type="text"
                value={newSpot.name}
                onChange={(e) => {
                  setNewSpot((p) => ({ ...p, name: e.target.value }));
                  const v = e.target.value;
                  // デバウンス重複チェック
                  clearTimeout((window as any).__dupTimer);
                  (window as any).__dupTimer = setTimeout(() => checkDuplicate(v), 600);
                }}
                placeholder={isChain ? "例：IKEA（表示上のブランド名）" : "例：〇〇公園の秘密の展望台"}
                style={{ width: "100%", height: "48px", borderRadius: "12px", border: duplicateWarning ? "2px solid #e07040" : "1px solid #ead7db", padding: "0 14px", fontSize: "15px", outline: "none", background: "#fffaf8", boxSizing: "border-box", fontFamily: font }}
              />
              {duplicateChecking && <div style={{ fontSize: "11px", color: "#9b7b82", marginTop: "4px" }}>🔍 重複チェック中...</div>}
              {duplicateWarning && <div style={{ fontSize: "12px", color: "#c06030", marginTop: "4px", fontWeight: 700 }}>{duplicateWarning}</div>}
            </div>

            {/* 説明 */}
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 800, marginBottom: "6px", color: "#4a3034" }}>説明・おすすめポイント</label>
              <textarea
                value={newSpot.description}
                onChange={(e) => setNewSpot((p) => ({ ...p, description: e.target.value }))}
                placeholder="このスポットの魅力・特徴を書いてください"
                rows={4}
                style={{ width: "100%", borderRadius: "12px", border: "1px solid #ead7db", padding: "12px 14px", fontSize: "14px", resize: "vertical", boxSizing: "border-box", outline: "none", background: "#fffaf8", fontFamily: font }}
              />
            </div>

            {/* 住所 */}
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 800, marginBottom: "6px", color: "#4a3034" }}>住所</label>
              <input
                type="text"
                value={newSpot.address}
                onChange={(e) => setNewSpot((p) => ({ ...p, address: e.target.value }))}
                placeholder="例：神奈川県横浜市中区山下町1-1"
                style={{ width: "100%", height: "48px", borderRadius: "12px", border: "1px solid #ead7db", padding: "0 14px", fontSize: "14px", outline: "none", background: "#fffaf8", boxSizing: "border-box", fontFamily: font }}
              />
            </div>

            {/* 最寄り駅 */}
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 800, marginBottom: "6px", color: "#4a3034" }}>🚉 最寄り駅・徒歩時間</label>
              <input
                type="text"
                value={newSpot.stationInfo}
                onChange={(e) => setNewSpot((p) => ({ ...p, stationInfo: e.target.value }))}
                placeholder="例：横浜駅から徒歩8分"
                style={{ width: "100%", height: "48px", borderRadius: "12px", border: "1px solid #ead7db", padding: "0 14px", fontSize: "14px", outline: "none", background: "#fffaf8", boxSizing: "border-box", fontFamily: font }}
              />
            </div>

            {/* マップURL */}
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 800, marginBottom: "6px", color: "#4a3034" }}>🗺 マップURL（任意）</label>
              <input
                type="text"
                value={newSpot.mapUrl}
                onChange={(e) => setNewSpot((p) => ({ ...p, mapUrl: e.target.value }))}
                placeholder="GoogleマップURL または 任意のURLを貼り付け"
                style={{ width: "100%", height: "48px", borderRadius: "12px", border: "1px solid #ead7db", padding: "0 14px", fontSize: "14px", outline: "none", background: "#fffaf8", boxSizing: "border-box", fontFamily: font }}
              />
            </div>

            {/* 特徴タグ（定義済みタグから選択） */}
            <div style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <label style={{ fontSize: "13px", fontWeight: 800, color: "#4a3034" }}>
                  🏷 特徴タグ <span style={{ color: "#c0385a" }}>*</span>
                  <span style={{ fontWeight: 400, fontSize: "11px", color: "#9b7b82", marginLeft: "4px" }}>（気分タグ必須）</span>
                </label>
                <button
                  onClick={() => setTagPickerOpen((p) => !p)}
                  style={{ ...btnBase, padding: "4px 12px", height: "30px", fontSize: "12px", background: tagPickerOpen ? "#ff8f7f" : "#ffd8c8", color: tagPickerOpen ? "#fff" : "#8a4500" }}
                >
                  {tagPickerOpen ? "▲ 閉じる" : "▼ タグを選ぶ"}
                </button>
              </div>

              {/* 選択済みタグ */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px", minHeight: "28px" }}>
                {newSpotTags.length === 0 && <span style={{ fontSize: "12px", color: "#c06030", fontWeight: 700 }}>⚠️ 気分タグを含む、タグを選択してください</span>}
                {newSpotTags.map((tag, i) => {
                  const isMood = MOOD_TAGS.includes(tag);
                  return (
                    <span
                      key={i}
                      onClick={() => setNewSpotTags((prev) => prev.filter((_, j) => j !== i))}
                      style={{ padding: "4px 10px", borderRadius: "999px", background: isMood ? "#ffe0e8" : "#fff3e6", border: `1px solid ${isMood ? "#ffb0c0" : "#ffd8a8"}`, fontSize: "12px", fontWeight: 700, color: isMood ? "#c0385a" : "#8a4500", cursor: "pointer" }}
                    >
                      {tag} ✕
                    </span>
                  );
                })}
              </div>

              {/* タグピッカー */}
              {tagPickerOpen && (
                <div style={{ border: "1px solid #ead7db", borderRadius: "14px", padding: "12px", background: "#fffaf8", maxHeight: "360px", overflowY: "auto" }}>
                  {TAG_CATEGORIES.map((cat) => (
                    <div key={cat.key} style={{ marginBottom: "12px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 900, color: cat.key === "mood" ? "#c0385a" : "#6a4a50", marginBottom: "6px" }}>
                        {cat.key === "mood" ? "🎭 " : ""}{cat.label}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                        {cat.tags.map((tag) => {
                          const selected = newSpotTags.includes(tag);
                          return (
                            <span
                              key={tag}
                              onClick={() => {
                                setNewSpotTags((prev) =>
                                  selected ? prev.filter((t) => t !== tag) : [...prev, tag]
                                );
                              }}
                              style={{
                                padding: "3px 9px",
                                borderRadius: "999px",
                                fontSize: "12px",
                                fontWeight: 700,
                                cursor: "pointer",
                                background: selected ? (cat.key === "mood" ? "#ffe0e8" : "#e8f4ff") : "#f0f0f0",
                                border: `1px solid ${selected ? (cat.key === "mood" ? "#ffb0c0" : "#90c0f0") : "#d0d0d0"}`,
                                color: selected ? (cat.key === "mood" ? "#c0385a" : "#1a5080") : "#555",
                                transition: "all 0.1s",
                              }}
                            >
                              {selected ? "✓ " : ""}{tag}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 期間限定設定 */}
            <div style={{ marginBottom: "16px", padding: "14px 16px", borderRadius: "14px", background: (newSpotAvailableFrom || newSpotAvailableUntil) ? "#fff8e6" : "#f9f5f6", border: `1px solid ${(newSpotAvailableFrom || newSpotAvailableUntil) ? "#ffd480" : "#ead7db"}` }}>
              <div style={{ fontSize: "13px", fontWeight: 900, color: "#4a3034", marginBottom: "10px" }}>
                📅 期間限定公開（任意）
                <span style={{ fontWeight: 400, fontSize: "11px", color: "#9b7b82", marginLeft: "8px" }}>設定しない場合は常時表示されます</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "4px", color: "#6a4040" }}>公開開始日</label>
                  <input
                    type="date"
                    value={newSpotAvailableFrom}
                    onChange={(e) => setNewSpotAvailableFrom(e.target.value)}
                    style={{ width: "100%", height: "40px", borderRadius: "10px", border: "1px solid #ffd480", padding: "0 10px", fontSize: "13px", outline: "none", background: "#fffdf5", boxSizing: "border-box", fontFamily: font }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "4px", color: "#6a4040" }}>公開終了日</label>
                  <input
                    type="date"
                    value={newSpotAvailableUntil}
                    onChange={(e) => setNewSpotAvailableUntil(e.target.value)}
                    min={newSpotAvailableFrom || undefined}
                    style={{ width: "100%", height: "40px", borderRadius: "10px", border: "1px solid #ffd480", padding: "0 10px", fontSize: "13px", outline: "none", background: "#fffdf5", boxSizing: "border-box", fontFamily: font }}
                  />
                </div>
              </div>
              {(newSpotAvailableFrom || newSpotAvailableUntil) && (
                <div style={{ fontSize: "11px", color: "#8a6000", marginTop: "8px", background: "#fff3b0", borderRadius: "8px", padding: "6px 10px" }}>
                  🗓 {newSpotAvailableFrom ? `${newSpotAvailableFrom} から` : "即日"} {newSpotAvailableUntil ? `${newSpotAvailableUntil} まで` : "無期限"} 検索結果に表示されます
                </div>
              )}
            </div>

            {/* 画像アップロード */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 800, marginBottom: "6px", color: "#4a3034" }}>📷 画像（最大5枚）</label>
              <label
                htmlFor="admin-spot-image-input"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  height: "48px",
                  borderRadius: "14px",
                  border: "2px dashed #f0c0c8",
                  background: "#fffaf8",
                  color: "#b07080",
                  fontSize: "13px",
                  fontWeight: 800,
                  cursor: "pointer",
                  boxSizing: "border-box",
                  marginBottom: "10px",
                }}
              >
                📷 写真を選ぶ（最大5枚）
              </label>
              <input
                id="admin-spot-image-input"
                ref={newSpotFileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []).slice(0, 5);
                  setNewSpotImages(files);
                  const urls = files.map((f) => URL.createObjectURL(f));
                  setNewSpotImagePreviews(urls);
                }}
                style={{
                  position: "absolute",
                  width: "1px",
                  height: "1px",
                  opacity: 0,
                  overflow: "hidden",
                  clip: "rect(0,0,0,0)",
                  pointerEvents: "none",
                }}
              />
              {newSpotImagePreviews.length > 0 && (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                  {newSpotImagePreviews.map((url, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      <img
                        src={url}
                        alt={`preview-${i}`}
                        style={{ width: "80px", height: "80px", objectFit: "cover", borderRadius: "10px", border: "1px solid #f0dfe3" }}
                      />
                      <div style={{ fontSize: "10px", color: "#7a5860", marginTop: "2px", textAlign: "center", maxWidth: "80px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {newSpotImages[i]?.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Supabase Places 登録（常時ON） ───────────────────────── */}
            <div style={{ marginBottom: "20px", padding: "16px", borderRadius: "14px", background: "#edf7f0", border: "2px solid #18794e" }}>
              <div style={{ fontWeight: 900, color: "#18794e", fontSize: "13px", marginBottom: "12px" }}>
                🗄 Supabase places にも自動登録されます（常時ON）
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "4px", color: "#18794e" }}>緯度（任意）</label>
                    <input
                      type="number"
                      step="any"
                      value={spotLat}
                      onChange={(e) => setSpotLat(e.target.value)}
                      placeholder="例: 35.6812"
                      style={{ width: "100%", height: "38px", borderRadius: "10px", border: "1px solid #a0d4b8", padding: "0 10px", fontSize: "13px", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: font }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "4px", color: "#18794e" }}>経度（任意）</label>
                    <input
                      type="number"
                      step="any"
                      value={spotLng}
                      onChange={(e) => setSpotLng(e.target.value)}
                      placeholder="例: 139.7671"
                      style={{ width: "100%", height: "38px", borderRadius: "10px", border: "1px solid #a0d4b8", padding: "0 10px", fontSize: "13px", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: font }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "4px", color: "#18794e" }}>エリア名（任意）</label>
                    <input
                      type="text"
                      value={spotArea}
                      onChange={(e) => setSpotArea(e.target.value)}
                      placeholder="例: 東京・渋谷"
                      style={{ width: "100%", height: "38px", borderRadius: "10px", border: "1px solid #a0d4b8", padding: "0 10px", fontSize: "13px", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: font }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: "12px", color: "#18794e", background: "#d8f5e8", borderRadius: "8px", padding: "8px 12px", lineHeight: 1.6 }}>
                  📌 緯度・経度はGoogleマップで場所を開き、URLの <code>@35.xxxx,139.xxxx</code> から確認できます。<br />
                  タグは上の「気分タグ」で設定したものがそのまま使用されます。
                </div>
              </div>
            </div>

            {/* ── Supabase 重複警告 ─────────────────────────────────────────────── */}
            {newSpotDuplicate && (
              <div style={{ marginBottom: "16px", padding: "14px 16px", borderRadius: "12px", background: "#fff3e0", border: "2px solid #fb8c00" }}>
                <div style={{ fontWeight: 800, color: "#e65100", fontSize: "14px", marginBottom: "8px" }}>
                  ⚠️ Supabase places に同名スポットがすでに存在します
                </div>
                <div style={{ fontSize: "13px", color: "#4a3034", marginBottom: "10px" }}>
                  「{newSpotDuplicate.existingName}」がすでに登録されています。上書き（更新）しますか？
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => setNewSpotDuplicate(null)}
                    style={{ ...btnBase, flex: 1, padding: "8px", background: "#f5f5f5", color: "#555", fontSize: "13px" }}
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={async () => {
                      setNewSpotSubmitting(true);
                      setNewSpotError("");
                      try {
                        const plRes = await fetch("/api/admin/places-register", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            secret: ADMIN_PASSWORD,
                            name: newSpot.name.trim(),
                            address: newSpot.address.trim(),
                            nearestStation: newSpot.stationInfo.trim(),
                            lat: spotLat ? Number(spotLat) : null,
                            lng: spotLng ? Number(spotLng) : null,
                            tags: newSpotTags,
                            area: spotArea.trim() || null,
                            description: newSpot.description.trim() || null,
                            imageUrls: [],
                            force: true,
                          }),
                        });
                        const plData = await plRes.json();
                        if (!plData.ok) throw new Error(plData.error ?? "更新失敗");
                        setNewSpotDuplicate(null);
                        setNewSpotSuccessMsg((prev) => prev + " 🗄 Supabase placesも更新完了！");
                      } catch (e) {
                        setNewSpotError(`places更新エラー: ${e instanceof Error ? e.message : String(e)}`);
                      } finally {
                        setNewSpotSubmitting(false);
                      }
                    }}
                    style={{ ...btnBase, flex: 2, padding: "8px", background: "linear-gradient(135deg, #fb8c00, #e65100)", color: "#fff", fontSize: "13px", fontWeight: 900 }}
                  >
                    上書きして更新する
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={handleNewSpotSubmit}
              disabled={newSpotSubmitting}
              style={{
                ...btnBase,
                width: "100%",
                height: "52px",
                background: newSpotSubmitting ? "#ccc" : "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)",
                color: "#fff",
                fontSize: "16px",
                boxShadow: "0 8px 20px rgba(255,143,127,0.3)",
              }}
            >
              {newSpotSubmitting ? "登録中..." : "✅ スポットを追加する"}
            </button>
          </div>
        )}

        {/* ===== 一括再タグ付けボタン（add-spotタブ下部） ===== */}
        {tab === "add-spot" && (
          <div style={{ ...card, marginTop: "20px", border: "2px solid #7c3aed" }}>
            <div style={{ ...titleStyle, color: "#7c3aed" }}>🏷 既存スポットの＃タグを新タグ体系に一括更新</div>
            <div style={{ fontSize: "13px", color: "#5b21b6", marginBottom: "14px", lineHeight: 1.7 }}>
              suggestionsテーブルの全スポットのタグを、新しい定義済みタグリストでAIが再生成します。<br />
              スポット数が多い場合は数分かかります。完了後にスポット一覧が自動更新されます。
            </div>
            <button
              onClick={handleRetag}
              disabled={retagLoading}
              style={{ ...btnBase, width: "100%", padding: "14px", background: retagLoading ? "#ccc" : "linear-gradient(135deg, #7c3aed, #6d28d9)", color: "#fff", fontSize: "14px", fontWeight: 900, marginBottom: "14px" }}
            >
              {retagLoading ? "AI再タグ付け中...（しばらくお待ちください）" : "🏷 全スポットのタグを新体系に一括更新する"}
            </button>
            {retagResult && (
              <div style={{ borderRadius: "12px", background: retagResult.failed > 0 ? "#fff3e0" : "#f5f3ff", border: `1.5px solid ${retagResult.failed > 0 ? "#fb8c00" : "#7c3aed"}`, padding: "14px 16px" }}>
                <div style={{ fontWeight: 900, fontSize: "15px", color: retagResult.failed > 0 ? "#e65100" : "#7c3aed", marginBottom: "8px" }}>
                  完了: 合計 {retagResult.total} 件 / 更新成功 {retagResult.updated} 件 / 失敗 {retagResult.failed} 件
                </div>
                {retagResult.failedNames.length > 0 && (
                  <details>
                    <summary style={{ fontSize: "13px", color: "#e65100", cursor: "pointer" }}>失敗一覧（{retagResult.failedNames.length}件）</summary>
                    <div style={{ fontSize: "12px", color: "#c0385a", marginTop: "6px", lineHeight: 1.8 }}>
                      {retagResult.failedNames.map((n, i) => <div key={i}>・{n}</div>)}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== places テーブル診断（add-spotタブ） ===== */}
        {tab === "add-spot" && (
          <div style={{ ...card, marginTop: "20px", border: "2px solid #4184ff" }}>
            <div style={{ ...titleStyle, color: "#4184ff" }}>🔬 places テーブル診断</div>
            <button
              onClick={async () => {
                setDebugLoading(true);
                setDebugResult(null);
                try {
                  const res = await fetch("/api/admin/places-debug", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ secret: ADMIN_PASSWORD }),
                  });
                  const data = await res.json();
                  if (!data.ok) throw new Error(data.error);
                  setDebugResult(data);
                } catch (e) {
                  alert("診断失敗: " + String(e));
                } finally {
                  setDebugLoading(false);
                }
              }}
              disabled={debugLoading}
              style={{ ...btnBase, padding: "10px 20px", background: debugLoading ? "#ccc" : "#eef4ff", color: "#4184ff", fontWeight: 900, marginBottom: "12px" }}
            >
              {debugLoading ? "診断中..." : "🔬 今すぐ診断する"}
            </button>
            {debugResult && (
              <div style={{ fontSize: "13px", lineHeight: 1.8 }}>
                <div style={{ fontWeight: 900, marginBottom: "8px" }}>
                  📊 総件数: <span style={{ color: "#4184ff" }}>{debugResult.total}件</span>
                  　タグなし: <span style={{ color: debugResult.noTagCount > 0 ? "#c0385a" : "#18794e" }}>{debugResult.noTagCount}件</span>
                  　座標なし: <span style={{ color: debugResult.noCoordCount > 0 ? "#e65100" : "#18794e" }}>{debugResult.noCoordCount}件</span>
                </div>
                <div style={{ fontWeight: 800, marginBottom: "4px" }}>🔍 タグ検索テスト（このタグで検索するとヒットする件数）:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
                  {Object.entries(debugResult.tagTests).map(([tag, cnt]) => (
                    <span key={tag} style={{
                      padding: "3px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 700,
                      background: cnt > 0 ? "#edf7f0" : "#fce4e4",
                      color: cnt > 0 ? "#18794e" : "#c0385a",
                    }}>
                      {tag}: {cnt}件
                    </span>
                  ))}
                </div>
                <div style={{ fontWeight: 800, marginBottom: "4px" }}>🏷 タグランキング（上位20）:</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "12px" }}>
                  {debugResult.tagRanking.slice(0, 20).map(([tag, cnt]) => (
                    <span key={tag} style={{ padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 700, background: "#ede9fe", color: "#7c3aed" }}>
                      {tag} ({cnt})
                    </span>
                  ))}
                </div>
                <div style={{ fontWeight: 800, marginBottom: "4px" }}>📝 サンプルスポット:</div>
                {debugResult.sample.map((p, i) => (
                  <div key={i} style={{ marginBottom: "6px", padding: "6px 10px", background: "#f9f9f9", borderRadius: "8px" }}>
                    <div style={{ fontWeight: 800 }}>{p.name} {p.hasCoord ? "📍" : "⚠️座標なし"}</div>
                    <div style={{ fontSize: "11px", color: "#666" }}>{(p.tags ?? []).join(", ") || "タグなし"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== 一括移行ボタン（add-spotタブ下部） ===== */}
        {tab === "add-spot" && (
          <div style={{ ...card, marginTop: "20px", border: "2px solid #18794e" }}>
            <div style={{ ...titleStyle, color: "#18794e" }}>🚀 承認済みスポット → Supabase places 一括移行</div>
            <div style={{ fontSize: "13px", color: "#4a6a50", marginBottom: "14px", lineHeight: 1.7 }}>
              suggestionsテーブルの承認済み（approved）スポットを places テーブルに一括移行します。<br />
              タグなし・同名スポットはデフォルトでスキップされます。
            </div>
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
              <button
                onClick={() => handleMigrate(false)}
                disabled={migrateLoading}
                style={{ ...btnBase, flex: 1, padding: "12px 16px", background: migrateLoading ? "#ccc" : "linear-gradient(135deg, #18794e, #10b977)", color: "#fff", fontSize: "14px", fontWeight: 900 }}
              >
                {migrateLoading ? "移行中..." : "🗄 一括移行する（スキップあり）"}
              </button>
              <button
                onClick={() => handleMigrate(true)}
                disabled={migrateLoading}
                style={{ ...btnBase, flex: 1, padding: "12px 16px", background: migrateLoading ? "#ccc" : "linear-gradient(135deg, #d97706, #b45309)", color: "#fff", fontSize: "14px", fontWeight: 900 }}
              >
                {migrateLoading ? "移行中..." : "⚡ 強制上書きで一括移行"}
              </button>
            </div>
            {migrateResult && (
              <div style={{ borderRadius: "12px", background: migrateResult.failed > 0 ? "#fff3e0" : "#edf7f0", border: `1.5px solid ${migrateResult.failed > 0 ? "#fb8c00" : "#18794e"}`, padding: "14px 16px" }}>
                <div style={{ fontWeight: 900, fontSize: "15px", color: migrateResult.failed > 0 ? "#e65100" : "#18794e", marginBottom: "8px" }}>
                  移行完了: 合計 {migrateResult.total} 件 / 登録 {migrateResult.registered} 件 / スキップ {migrateResult.skipped} 件 / 失敗 {migrateResult.failed} 件
                </div>
                {migrateResult.skippedNames.length > 0 && (
                  <details style={{ marginBottom: "8px" }}>
                    <summary style={{ fontSize: "13px", color: "#888", cursor: "pointer" }}>スキップ一覧（{migrateResult.skippedNames.length}件）</summary>
                    <div style={{ fontSize: "12px", color: "#666", marginTop: "6px", lineHeight: 1.8 }}>
                      {migrateResult.skippedNames.map((n, i) => <div key={i}>・{n}</div>)}
                    </div>
                  </details>
                )}
                {migrateResult.failedNames.length > 0 && (
                  <details>
                    <summary style={{ fontSize: "13px", color: "#e65100", cursor: "pointer" }}>失敗一覧（{migrateResult.failedNames.length}件）</summary>
                    <div style={{ fontSize: "12px", color: "#c0385a", marginTop: "6px", lineHeight: 1.8 }}>
                      {migrateResult.failedNames.map((n, i) => <div key={i}>・{n}</div>)}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===== 管理者追加済みスポット一覧（add-spotタブ下部） ===== */}
        {tab === "add-spot" && (
          <div style={{ ...card, marginTop: "20px" }}>
            <div style={titleStyle}>📋 管理者が追加したスポット一覧</div>
            {adminSpotsLoading ? (
              <div style={{ textAlign: "center", padding: "24px", opacity: 0.6, fontSize: "13px" }}>読み込み中...</div>
            ) : adminSpots.length === 0 ? (
              <div style={{ fontSize: "13px", opacity: 0.6 }}>まだ管理者スポットはありません</div>
            ) : (
              <div style={{ display: "grid", gap: "14px" }}>
                {adminSpots.map((s) => {
                  const isEditing = editingSpotId === s.id;
                  return (
                    <div key={s.id} style={{
                      borderRadius: "16px",
                      padding: "16px",
                      background: "#fffaf8",
                      border: `1.5px solid ${isEditing ? "#4184ff" : s.status === "approved" ? "#c8e6c9" : s.status === "rejected" ? "#f5c0c8" : "#ead7db"}`,
                    }}>
                      {/* ヘッダー行 */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 900, fontSize: "15px", color: "#4a3034" }}>{s.spot_name}</span>
                          {s.is_chain && (
                            <span style={{ fontSize: "11px", background: "#eef4ff", color: "#4184ff", borderRadius: "999px", padding: "2px 8px", fontWeight: 700, border: "1px solid #b3cfff" }}>🏪 チェーン</span>
                          )}
                          <span style={{
                            fontSize: "11px", borderRadius: "999px", padding: "2px 8px", fontWeight: 700,
                            background: s.status === "approved" ? "#e8f5e9" : s.status === "rejected" ? "#fce4e4" : "#fff8e1",
                            color: s.status === "approved" ? "#18794e" : s.status === "rejected" ? "#c0385a" : "#b07030",
                          }}>
                            {s.status === "approved" ? "✅ 公開中" : s.status === "rejected" ? "❌ 却下" : "⏳ 審査中"}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "6px", flexShrink: 0, marginLeft: "8px" }}>
                          <span style={{ fontSize: "11px", opacity: 0.45, alignSelf: "center" }}>
                            {new Date(s.created_at).toLocaleDateString("ja-JP")}
                          </span>
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleEditSpotSubmit(s.id)}
                                disabled={editSpotSubmitting}
                                style={{ ...btnBase, padding: "5px 12px", fontSize: "12px", background: "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)", color: "#fff" }}
                              >
                                {editSpotSubmitting ? "保存中..." : "保存"}
                              </button>
                              <button
                                onClick={() => setEditingSpotId(null)}
                                style={{ ...btnBase, padding: "5px 12px", fontSize: "12px", background: "#fff", color: "#4a3034", border: "1px solid #ead7db" }}
                              >
                                キャンセル
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEditSpot(s)}
                                style={{ ...btnBase, padding: "5px 12px", fontSize: "12px", background: "#eef4ff", color: "#4184ff", border: "1px solid #b3cfff" }}
                              >
                                ✏️ 編集
                              </button>
                              <button
                                onClick={() => handleDeleteSpot(s.id)}
                                disabled={deletingSpotId === s.id}
                                style={{ ...btnBase, padding: "5px 12px", fontSize: "12px", background: "#fce4e4", color: "#c0385a", border: "1px solid #f5c0c8" }}
                              >
                                {deletingSpotId === s.id ? "削除中..." : "🗑 削除"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* 編集フォーム */}
                      {isEditing ? (
                        <div style={{ display: "grid", gap: "10px", marginTop: "8px" }}>
                          <div>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "4px", color: "#4a3034" }}>スポット名 *</label>
                            <input
                              type="text"
                              value={editSpotForm.name}
                              onChange={(e) => setEditSpotForm((p) => ({ ...p, name: e.target.value }))}
                              style={{ width: "100%", height: "40px", borderRadius: "10px", border: "1.5px solid #4184ff", padding: "0 12px", fontSize: "14px", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: font }}
                            />
                          </div>
                          <div>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "4px", color: "#4a3034" }}>説明</label>
                            <textarea
                              value={editSpotForm.description}
                              onChange={(e) => setEditSpotForm((p) => ({ ...p, description: e.target.value }))}
                              rows={3}
                              style={{ width: "100%", borderRadius: "10px", border: "1px solid #d0e0ff", padding: "10px 12px", fontSize: "13px", resize: "vertical", boxSizing: "border-box", outline: "none", fontFamily: font }}
                            />
                          </div>
                          <div>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "4px", color: "#4a3034" }}>住所</label>
                            <input
                              type="text"
                              value={editSpotForm.address}
                              onChange={(e) => setEditSpotForm((p) => ({ ...p, address: e.target.value }))}
                              style={{ width: "100%", height: "38px", borderRadius: "10px", border: "1px solid #d0e0ff", padding: "0 12px", fontSize: "13px", outline: "none", background: "#fff", boxSizing: "border-box", fontFamily: font }}
                            />
                          </div>
                          <div>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "4px", color: "#4a3034" }}>🏷 タグ</label>
                            <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
                              <input
                                type="text"
                                value={editSpotTagInput}
                                onChange={(e) => setEditSpotTagInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && editSpotTagInput.trim()) {
                                    setEditSpotForm((p) => ({ ...p, tags: [...p.tags, editSpotTagInput.trim()] }));
                                    setEditSpotTagInput("");
                                  }
                                }}
                                placeholder="タグを追加してEnter"
                                style={{ flex: 1, height: "36px", borderRadius: "8px", border: "1px solid #d0e0ff", padding: "0 10px", fontSize: "12px", outline: "none", fontFamily: font }}
                              />
                              <button
                                onClick={() => { if (editSpotTagInput.trim()) { setEditSpotForm((p) => ({ ...p, tags: [...p.tags, editSpotTagInput.trim()] })); setEditSpotTagInput(""); } }}
                                style={{ ...btnBase, padding: "0 12px", height: "36px", background: "#eef4ff", color: "#4184ff", fontSize: "12px", border: "1px solid #b3cfff" }}
                              >追加</button>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                              {editSpotForm.tags.map((tag, i) => (
                                <span
                                  key={i}
                                  onClick={() => setEditSpotForm((p) => ({ ...p, tags: p.tags.filter((_, j) => j !== i) }))}
                                  style={{ padding: "2px 8px", borderRadius: "999px", background: "#fff3e6", border: "1px solid #ffd8a8", fontSize: "11px", fontWeight: 700, color: "#8a4500", cursor: "pointer" }}
                                >
                                  {tag} ✕
                                </span>
                              ))}
                            </div>
                          </div>
                          {/* チェーン店設定 */}
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <button
                              onClick={() => setEditSpotForm((p) => ({ ...p, isChain: !p.isChain }))}
                              style={{ width: "40px", height: "22px", borderRadius: "999px", border: "none", background: editSpotForm.isChain ? "#4184ff" : "#d0bfc2", cursor: "pointer", position: "relative", flexShrink: 0 }}
                            >
                              <span style={{ position: "absolute", top: "2px", left: editSpotForm.isChain ? "19px" : "2px", width: "18px", height: "18px", borderRadius: "999px", background: "#fff", transition: "left 0.2s" }} />
                            </button>
                            <span style={{ fontSize: "12px", fontWeight: 800, color: "#4a3034" }}>🏪 チェーン店</span>
                          </div>
                          {editSpotForm.isChain && (
                            <input
                              type="text"
                              value={editSpotForm.chainSearchQuery}
                              onChange={(e) => setEditSpotForm((p) => ({ ...p, chainSearchQuery: e.target.value }))}
                              placeholder="検索クエリ（例：IKEA）"
                              style={{ width: "100%", height: "36px", borderRadius: "8px", border: "1px solid #b3cfff", padding: "0 12px", fontSize: "12px", outline: "none", fontFamily: font, boxSizing: "border-box" }}
                            />
                          )}
                          {/* 画像管理 */}
                          <div>
                            <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "8px", color: "#4a3034" }}>📸 画像</label>
                            {/* 既存画像 */}
                            {editSpotExistingImages.length > 0 && (
                              <div style={{ marginBottom: "10px" }}>
                                <div style={{ fontSize: "11px", color: "#9b7080", marginBottom: "6px" }}>現在の画像（✕で削除）</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                  {editSpotExistingImages.map((url, i) => (
                                    <div key={i} style={{ position: "relative", width: "80px", height: "64px", borderRadius: "8px", overflow: "hidden", border: "1.5px solid #d0e0ff" }}>
                                      <img src={url} alt={`img-${i}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                      <button
                                        onClick={() => setEditSpotExistingImages((prev) => prev.filter((_, j) => j !== i))}
                                        style={{ position: "absolute", top: "2px", right: "2px", width: "18px", height: "18px", borderRadius: "999px", background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", fontSize: "10px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}
                                      >✕</button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* 新規追加 */}
                            {editSpotNewPreviews.length > 0 && (
                              <div style={{ marginBottom: "10px" }}>
                                <div style={{ fontSize: "11px", color: "#9b7080", marginBottom: "6px" }}>追加する画像</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                  {editSpotNewPreviews.map((url, i) => (
                                    <div key={i} style={{ position: "relative", width: "80px", height: "64px", borderRadius: "8px", overflow: "hidden", border: "1.5px solid #b3cfff" }}>
                                      <img src={url} alt={`new-${i}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                      <button
                                        onClick={() => {
                                          setEditSpotNewImages((prev) => prev.filter((_, j) => j !== i));
                                          setEditSpotNewPreviews((prev) => prev.filter((_, j) => j !== i));
                                        }}
                                        style={{ position: "absolute", top: "2px", right: "2px", width: "18px", height: "18px", borderRadius: "999px", background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", fontSize: "10px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font }}
                                      >✕</button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <input
                              ref={editSpotFileInputRef}
                              type="file"
                              accept="image/*"
                              multiple
                              style={{ display: "none" }}
                              onChange={(e) => {
                                const files = Array.from(e.target.files ?? []).slice(0, 5 - editSpotExistingImages.length - editSpotNewImages.length);
                                if (files.length === 0) return;
                                setEditSpotNewImages((prev) => [...prev, ...files]);
                                files.forEach((f) => {
                                  const reader = new FileReader();
                                  reader.onload = (ev) => setEditSpotNewPreviews((prev) => [...prev, ev.target?.result as string]);
                                  reader.readAsDataURL(f);
                                });
                                if (editSpotFileInputRef.current) editSpotFileInputRef.current.value = "";
                              }}
                            />
                            <button
                              onClick={() => editSpotFileInputRef.current?.click()}
                              disabled={(editSpotExistingImages.length + editSpotNewImages.length) >= 5}
                              style={{ ...btnBase, padding: "7px 14px", fontSize: "12px", background: "#eef4ff", color: "#4184ff", border: "1px solid #b3cfff", opacity: (editSpotExistingImages.length + editSpotNewImages.length) >= 5 ? 0.4 : 1 }}
                            >
                              ＋ 画像を追加（最大5枚）
                            </button>
                          </div>

                          {/* 期間限定設定（編集） */}
                          <div style={{ padding: "10px 12px", borderRadius: "10px", background: "#fff8e6", border: "1px solid #ffd480" }}>
                            <div style={{ fontSize: "11px", fontWeight: 800, color: "#6a4040", marginBottom: "8px" }}>📅 期間限定公開（任意）</div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                              <div>
                                <label style={{ display: "block", fontSize: "10px", fontWeight: 700, marginBottom: "3px", color: "#8a6000" }}>公開開始日</label>
                                <input
                                  type="date"
                                  value={editSpotForm.availableFrom}
                                  onChange={(e) => setEditSpotForm((p) => ({ ...p, availableFrom: e.target.value }))}
                                  style={{ width: "100%", height: "34px", borderRadius: "8px", border: "1px solid #ffd480", padding: "0 8px", fontSize: "12px", outline: "none", background: "#fffdf5", boxSizing: "border-box", fontFamily: font }}
                                />
                              </div>
                              <div>
                                <label style={{ display: "block", fontSize: "10px", fontWeight: 700, marginBottom: "3px", color: "#8a6000" }}>公開終了日</label>
                                <input
                                  type="date"
                                  value={editSpotForm.availableUntil}
                                  min={editSpotForm.availableFrom || undefined}
                                  onChange={(e) => setEditSpotForm((p) => ({ ...p, availableUntil: e.target.value }))}
                                  style={{ width: "100%", height: "34px", borderRadius: "8px", border: "1px solid #ffd480", padding: "0 8px", fontSize: "12px", outline: "none", background: "#fffdf5", boxSizing: "border-box", fontFamily: font }}
                                />
                              </div>
                            </div>
                            {(editSpotForm.availableFrom || editSpotForm.availableUntil) && (
                              <button
                                onClick={() => setEditSpotForm((p) => ({ ...p, availableFrom: "", availableUntil: "" }))}
                                style={{ ...btnBase, marginTop: "6px", fontSize: "10px", padding: "3px 10px", background: "#fff", border: "1px solid #d0c0a0", color: "#8a6000" }}
                              >
                                🗑 期間設定を削除（常時表示に戻す）
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* 表示モード */
                        <>
                          {/* 期間限定バッジ */}
                          {(s.available_from || s.available_until) && (() => {
                            const today = new Date().toISOString().slice(0, 10);
                            const isActive = (!s.available_from || today >= s.available_from) && (!s.available_until || today <= s.available_until);
                            const isExpired = s.available_until && today > s.available_until;
                            const isUpcoming = s.available_from && today < s.available_from;
                            return (
                              <div style={{
                                display: "inline-flex", alignItems: "center", gap: "6px",
                                fontSize: "11px", fontWeight: 700, borderRadius: "8px", padding: "5px 10px",
                                marginBottom: "8px",
                                background: isExpired ? "#f5f5f5" : isUpcoming ? "#eef4ff" : "#fff8e0",
                                border: `1px solid ${isExpired ? "#d0d0d0" : isUpcoming ? "#b3cfff" : "#ffd480"}`,
                                color: isExpired ? "#999" : isUpcoming ? "#4184ff" : "#8a6000",
                              }}>
                                {isExpired ? "⏰ 期間終了" : isUpcoming ? "🔜 公開予定" : "📅 期間限定"}
                                <span style={{ fontWeight: 400 }}>
                                  {s.available_from && `${s.available_from}`}
                                  {s.available_from && s.available_until && " 〜 "}
                                  {s.available_until && `${s.available_until}`}
                                </span>
                              </div>
                            );
                          })()}
                          {s.description && (
                            <div style={{ fontSize: "13px", color: "#7a5860", lineHeight: 1.6, marginBottom: "6px" }}>{s.description}</div>
                          )}
                          {s.address && (
                            <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "6px" }}>📍 {s.address}</div>
                          )}
                          {(s.auto_tags ?? []).length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                              {(s.auto_tags ?? []).map((tag, i) => (
                                <span key={i} style={{ padding: "2px 8px", borderRadius: "999px", background: "#fff3e6", border: "1px solid #ffd8a8", fontSize: "11px", fontWeight: 700, color: "#8a4500" }}>{tag}</span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===== 一括取り込みタブ ===== */}
        {tab === "import" && (
          <div style={{ display: "grid", gap: "20px" }}>

            {/* ── Supabase スポット検索 ──────────────────────────────── */}
            <div style={card}>
              <div style={{ ...titleStyle, color: "#0891b2" }}>🔎 登録済みスポット検索</div>
              <div style={{ fontSize: "13px", color: "#164e63", marginBottom: "14px", lineHeight: 1.7 }}>
                名前・住所・キーワードでSupabaseに登録済みかどうか確認できます。
              </div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <input
                  value={spSearchKeyword}
                  onChange={e => setSpSearchKeyword(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSpSearch()}
                  placeholder="例: 旭山動物園、渋谷、#温泉..."
                  style={{ flex: 1, height: "44px", borderRadius: "10px", border: "1.5px solid #a5f3fc", padding: "0 14px", fontSize: "14px", fontFamily: font, outline: "none" }}
                />
                <button onClick={handleSpSearch} disabled={spSearchLoading || !spSearchKeyword.trim()}
                  style={{ ...btnBase, padding: "0 20px", height: "44px", background: spSearchLoading ? "#ccc" : "linear-gradient(135deg, #0891b2, #0e7490)", color: "#fff", fontSize: "14px", fontWeight: 800, whiteSpace: "nowrap" }}>
                  {spSearchLoading ? "検索中..." : "検索"}
                </button>
              </div>
              {spSearchError && <div style={{ color: "#dc2626", fontSize: "13px", fontWeight: 700 }}>❌ {spSearchError}</div>}
              {spSearchResults !== null && (
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: "#0891b2", marginBottom: "8px" }}>
                    {spSearchResults.length === 0 ? "⚠️ 該当なし（未登録）" : `✅ ${spSearchResults.length}件 登録済み（最大50件）`}
                  </div>
                  {spSearchResults.length > 0 && (
                    <div style={{ display: "grid", gap: "6px", maxHeight: "400px", overflowY: "auto" }}>
                      {spSearchResults.map(p => (
                        <div key={p.id} style={{ padding: "8px 12px", borderRadius: "8px", background: "#f0fdff", border: "1px solid #a5f3fc" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                            <span style={{ fontWeight: 800, fontSize: "13px", color: "#164e63" }}>{p.name}</span>
                            <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "999px", background: p.is_active ? "#d1fae5" : "#fee2e2", color: p.is_active ? "#065f46" : "#991b1b" }}>
                              {p.is_active ? "公開中" : "非公開"}
                            </span>
                            {p.google_place_id && <span style={{ fontSize: "10px", color: "#6b7280" }}>Google</span>}
                          </div>
                          {p.address && <div style={{ fontSize: "11px", color: "#6b7280", marginBottom: "4px" }}>📍 {p.address}</div>}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                            {(p.tags ?? []).map(tag => (
                              <span key={tag} style={{ fontSize: "10px", padding: "1px 7px", borderRadius: "999px", background: "#cffafe", color: "#0e7490", fontWeight: 700 }}>{tag}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={card}>
              <div style={{ ...titleStyle, color: "#4184ff" }}>🔍 エリア一括スポット取り込み</div>
              <div style={{ fontSize: "13px", color: "#5b6dff", marginBottom: "16px", lineHeight: 1.7 }}>
                Google Placesでキーワード検索 → AIがタグを自動生成 → 確認してからSupabaseに登録します。
              </div>

              {/* 検索フォーム */}
              <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "6px", color: "#4a3034" }}>
                    検索キーワード <span style={{ color: "#c0385a" }}>*</span>
                  </label>
                  <input
                    value={importKeyword}
                    onChange={e => setImportKeyword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleImportSearch()}
                    placeholder="例: 温泉, カフェ, 公園, 展望台, 居酒屋, サウナ..."
                    style={{ ...inputBase, width: "100%", boxSizing: "border-box", fontSize: "14px", height: "44px" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "6px", color: "#4a3034" }}>
                    検索の中心地 <span style={{ color: "#c0385a" }}>*</span>
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      value={importPlace}
                      onChange={e => setImportPlace(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleImportGeocode()}
                      placeholder="例: 横浜市金沢区、東京都渋谷区、鎌倉市..."
                      style={{ ...inputBase, flex: 1, boxSizing: "border-box", fontSize: "14px", height: "44px" }}
                    />
                    <button
                      onClick={handleImportGeocode}
                      disabled={importGeoLoading || !importPlace.trim()}
                      style={{ ...btnBase, padding: "0 14px", height: "44px", background: importGeoLoading ? "#ccc" : "#eef4ff", color: "#4184ff", fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap" }}
                    >
                      {importGeoLoading ? "取得中..." : "📍 確定"}
                    </button>
                  </div>
                  {importLat && importGeoLabel && (
                    <div style={{ fontSize: "11px", color: "#5b6dff", marginTop: "6px" }}>
                      ✅ <strong>{importGeoLabel}</strong>（{Number(importLat).toFixed(4)}, {Number(importLng).toFixed(4)}）
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "4px", color: "#4a3034" }}>半径(km)</label>
                    <input type="number" value={importRadius} onChange={e => setImportRadius(e.target.value)}
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box", height: "38px", fontSize: "13px" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, marginBottom: "4px", color: "#4a3034" }}>最大件数</label>
                    <input type="number" value={importMax} onChange={e => setImportMax(e.target.value)} min={1} max={40}
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box", height: "38px", fontSize: "13px" }} />
                  </div>
                </div>

                <div style={{ fontSize: "11px", color: "#888", background: "#f5f5f5", borderRadius: "8px", padding: "8px 12px" }}>
                  💡 場所名を入力して「📍 確定」を押すか、そのまま検索ボタンを押してください（自動でジオコーディングします）｜Googleの制限により半径は最大50kmで検索されます
                </div>

                <button
                  onClick={handleImportSearch}
                  disabled={importLoading}
                  style={{ ...btnBase, width: "100%", height: "48px", background: importLoading ? "#ccc" : "linear-gradient(135deg, #4184ff, #5b6dff)", color: "#fff", fontSize: "15px", fontWeight: 900 }}
                >
                  {importLoading ? "🔍 検索・AIタグ生成中...（1〜2分かかります）" : "🔍 スポットを検索する"}
                </button>
              </div>

              {importError && (
                <div style={{ padding: "10px 14px", borderRadius: "10px", background: "#fce4e4", color: "#c0385a", fontSize: "13px", fontWeight: 700, marginBottom: "12px" }}>
                  ❌ {importError}
                </div>
              )}
            </div>

            {/* 検索結果 */}
            {importCandidates.length > 0 && (
              <div style={card}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
                  <div style={{ ...titleStyle, marginBottom: 0 }}>
                    📋 候補スポット（{importCandidates.length}件）｜選択中: {importSelected.size}件
                    {importSkippedCount > 0 && (
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "#888", marginLeft: "10px" }}>
                        ※ 既登録 {importSkippedCount}件 を除外済み
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setImportSelected(new Set(importCandidates.map(c => c.placeId)))}
                      style={{ ...btnBase, padding: "6px 12px", background: "#eef4ff", color: "#4184ff", fontSize: "12px", fontWeight: 800 }}
                    >全選択</button>
                    <button
                      onClick={() => setImportSelected(new Set())}
                      style={{ ...btnBase, padding: "6px 12px", background: "#f5f5f5", color: "#666", fontSize: "12px", fontWeight: 800 }}
                    >全解除</button>
                  </div>
                </div>

                <div style={{ display: "grid", gap: "16px", marginBottom: "20px" }}>
                  {importCandidates.map(c => {
                    const selected = importSelected.has(c.placeId);
                    const tags = importEditTags[c.placeId] ?? c.tags;
                    return (
                      <div
                        key={c.placeId}
                        style={{
                          borderRadius: "14px", padding: "14px",
                          background: selected ? "#f0f5ff" : "#f9f9f9",
                          border: `2px solid ${selected ? "#4184ff" : "#e0e0e0"}`,
                          transition: "all 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", gap: "12px" }}>
                          {/* チェックボックス */}
                          <div
                            onClick={() => {
                              const next = new Set(importSelected);
                              if (next.has(c.placeId)) next.delete(c.placeId);
                              else next.add(c.placeId);
                              setImportSelected(next);
                            }}
                            style={{
                              width: "24px", height: "24px", borderRadius: "6px", flexShrink: 0, cursor: "pointer", marginTop: "2px",
                              background: selected ? "#4184ff" : "#fff", border: `2px solid ${selected ? "#4184ff" : "#ccc"}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            {selected && <span style={{ color: "#fff", fontSize: "14px", fontWeight: 900 }}>✓</span>}
                          </div>

                          {/* 写真 */}
                          {c.photoUrls[0] && (
                            <img src={c.photoUrls[0]} alt={c.name}
                              style={{ width: "80px", height: "80px", objectFit: "cover", borderRadius: "10px", flexShrink: 0 }} />
                          )}

                          {/* 情報 */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <a
                              href={`https://www.google.com/maps/place/?q=place_id:${c.placeId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontWeight: 900, fontSize: "15px", color: "#4184ff", marginBottom: "2px", display: "inline-block", textDecoration: "none" }}
                              title="Google Mapsで確認"
                            >
                              {c.name} <span style={{ fontSize: "11px", opacity: 0.7 }}>🔗</span>
                            </a>
                            <div style={{ fontSize: "11px", color: "#888", marginBottom: "4px" }}>
                              📍 {c.address}　|　距離: {c.distanceKm}km
                              {c.rating && <span>　⭐ {c.rating}（{c.userRatingCount}件）</span>}
                            </div>

                            {/* タグ（クリックで削除・追加） */}
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px" }}>
                              {tags.map((tag, i) => {
                                const isPredefined = ALL_PREDEFINED_TAGS.includes(tag);
                                return (
                                <span
                                  key={i}
                                  onClick={() => {
                                    const next = tags.filter((_, idx) => idx !== i);
                                    setImportEditTags(prev => ({ ...prev, [c.placeId]: next }));
                                  }}
                                  style={{
                                    background: isPredefined ? "#ede9fe" : "#fff3e0",
                                    color: isPredefined ? "#7c3aed" : "#e65100",
                                    fontSize: "11px", fontWeight: 700, padding: "3px 8px", borderRadius: "999px", cursor: "pointer", userSelect: "none",
                                    border: isPredefined ? "none" : "1px dashed #e65100",
                                  }}
                                  title={isPredefined ? "クリックで削除" : "定義済みリスト外のタグ（クリックで削除）"}
                                >
                                  {tag} ✕
                                </span>
                                );
                              })}
                              {tags.length === 0 && (
                                <span style={{ fontSize: "11px", color: "#f00", fontWeight: 700 }}>⚠️ タグなし（スキップされます）</span>
                              )}
                            </div>

                            {/* タグ追加入力 + サジェスト */}
                            {(() => {
                              const inputVal = importTagInputs[c.placeId] ?? "";
                              const query = inputVal.startsWith("#") ? inputVal.slice(1) : inputVal;
                              const suggestions = query.length > 0
                                ? ALL_PREDEFINED_TAGS.filter(t =>
                                    !tags.includes(t) &&
                                    t.replace(/^#/, "").includes(query)
                                  ).slice(0, 8)
                                : [];
                              return (
                                <div style={{ position: "relative", marginTop: "6px" }}>
                                  <input
                                    value={inputVal}
                                    placeholder="タグを検索して追加（例: 温泉、まったり）"
                                    onChange={e => setImportTagInputs(prev => ({ ...prev, [c.placeId]: e.target.value }))}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") {
                                        // サジェストが1件だけのときはそれを選択、なければ入力値をそのまま追加
                                        const tag = suggestions.length === 1
                                          ? suggestions[0]
                                          : (inputVal.startsWith("#") ? inputVal : `#${inputVal}`).trim();
                                        if (tag && tag !== "#" && ALL_PREDEFINED_TAGS.includes(tag) && !tags.includes(tag)) {
                                          setImportEditTags(prev => ({ ...prev, [c.placeId]: [...tags, tag] }));
                                        }
                                        setImportTagInputs(prev => ({ ...prev, [c.placeId]: "" }));
                                      }
                                      if (e.key === "Escape") {
                                        setImportTagInputs(prev => ({ ...prev, [c.placeId]: "" }));
                                      }
                                    }}
                                    style={{ ...inputBase, height: "30px", fontSize: "11px", width: "100%", boxSizing: "border-box" }}
                                  />
                                  {suggestions.length > 0 && (
                                    <div style={{
                                      position: "absolute", top: "32px", left: 0, right: 0, zIndex: 100,
                                      background: "#fff", border: "1.5px solid #ddd", borderRadius: "10px",
                                      boxShadow: "0 4px 16px rgba(0,0,0,0.12)", overflow: "hidden",
                                    }}>
                                      {suggestions.map(tag => (
                                        <div
                                          key={tag}
                                          onMouseDown={e => {
                                            e.preventDefault();
                                            setImportEditTags(prev => ({ ...prev, [c.placeId]: [...tags, tag] }));
                                            setImportTagInputs(prev => ({ ...prev, [c.placeId]: "" }));
                                          }}
                                          style={{
                                            padding: "7px 12px", fontSize: "12px", cursor: "pointer",
                                            color: "#4a3034", fontWeight: 700,
                                            borderBottom: "1px solid #f0f0f0",
                                          }}
                                          onMouseEnter={e => (e.currentTarget.style.background = "#fff8f0")}
                                          onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
                                        >
                                          {tag}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 登録ボタン */}
                <button
                  onClick={handleImportRegister}
                  disabled={importRegistering || importSelected.size === 0}
                  style={{ ...btnBase, width: "100%", height: "52px", background: importRegistering || importSelected.size === 0 ? "#ccc" : "linear-gradient(135deg, #18794e, #10b977)", color: "#fff", fontSize: "15px", fontWeight: 900 }}
                >
                  {importRegistering ? "登録中..." : `✅ 選択した ${importSelected.size} 件をSupabaseに登録する`}
                </button>

                {importRegResult && (
                  <div style={{ marginTop: "12px", padding: "12px 16px", borderRadius: "12px", background: "#edf7f0", border: "1.5px solid #18794e" }}>
                    <div style={{ fontWeight: 900, color: "#18794e", fontSize: "14px" }}>
                      登録完了：✅ {importRegResult.ok}件登録 / ⏭ {importRegResult.skip}件スキップ（重複・タグなし）/ ❌ {importRegResult.fail}件失敗
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── OSM全国一括取り込み ────────────────────────────────── */}
            <div style={card}>
              <div style={{ ...titleStyle, color: "#059669" }}>🗾 OSM全国一括スポット取り込み（無料・全国対応）</div>
              <div style={{ fontSize: "13px", color: "#065f46", marginBottom: "16px", lineHeight: 1.7, background: "#ecfdf5", borderRadius: "10px", padding: "12px 14px", border: "1px solid #a7f3d0" }}>
                OpenStreetMap (Overpass API) を使って<strong>無料</strong>で全国のスポットを一括取り込みします。
                写真はありませんが、名前・住所・座標・タグが自動生成されます。<br />
                ⚠️ まず <strong>「件数確認のみ（dryRun）」</strong>で規模を確認してから本登録することをおすすめします。
              </div>

              {/* 都道府県選択 */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontWeight: 900, fontSize: "13px", marginBottom: "10px", color: "#4a3034" }}>
                  📍 都道府県を選択
                  <span style={{ fontWeight: 500, fontSize: "12px", marginLeft: "8px", color: "#6b7280" }}>
                    {osmPrefectures.size}件選択中
                  </span>
                </div>
                {Object.entries(REGION_GROUPS_UI).map(([region, prefs]) => {
                  const allSelected = prefs.every(p => osmPrefectures.has(p));
                  const someSelected = prefs.some(p => osmPrefectures.has(p));
                  return (
                    <div key={region} style={{ marginBottom: "10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                        <button
                          onClick={() => handleOsmToggleRegion(prefs)}
                          style={{ ...btnBase, padding: "3px 10px", fontSize: "12px", fontWeight: 900,
                            background: allSelected ? "#059669" : someSelected ? "#d1fae5" : "#f3f4f6",
                            color: allSelected ? "#fff" : someSelected ? "#059669" : "#6b7280",
                            border: `1.5px solid ${allSelected ? "#059669" : someSelected ? "#6ee7b7" : "#e5e7eb"}` }}
                        >
                          {region}
                        </button>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingLeft: "8px" }}>
                        {prefs.map(pref => (
                          <button
                            key={pref}
                            onClick={() => handleOsmTogglePref(pref)}
                            style={{ ...btnBase, padding: "4px 10px", fontSize: "12px", fontWeight: 700,
                              background: osmPrefectures.has(pref) ? "#059669" : "#f9fafb",
                              color: osmPrefectures.has(pref) ? "#fff" : "#374151",
                              border: `1px solid ${osmPrefectures.has(pref) ? "#059669" : "#e5e7eb"}` }}
                          >
                            {pref}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* スポット種別選択 */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontWeight: 900, fontSize: "13px", marginBottom: "10px", color: "#4a3034" }}>
                  🏷️ 取り込むスポット種別
                  <button onClick={() => setOsmTypes(new Set(OSM_TYPE_OPTIONS.map(t => t.id)))}
                    style={{ ...btnBase, marginLeft: "8px", padding: "2px 8px", fontSize: "11px", background: "#ede9fe", color: "#7c3aed", border: "none" }}>全選択</button>
                  <button onClick={() => setOsmTypes(new Set())}
                    style={{ ...btnBase, marginLeft: "4px", padding: "2px 8px", fontSize: "11px", background: "#fee2e2", color: "#dc2626", border: "none" }}>全解除</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {OSM_TYPE_OPTIONS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => handleOsmToggleType(t.id)}
                      style={{ ...btnBase, padding: "5px 12px", fontSize: "12px", fontWeight: 700,
                        background: osmTypes.has(t.id) ? "#7c3aed" : "#f9fafb",
                        color: osmTypes.has(t.id) ? "#fff" : "#374151",
                        border: `1px solid ${osmTypes.has(t.id) ? "#7c3aed" : "#e5e7eb"}` }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* dryRun トグル */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", padding: "12px 14px", background: osmDryRun ? "#fefce8" : "#fef2f2", borderRadius: "10px", border: `1px solid ${osmDryRun ? "#fde68a" : "#fecaca"}` }}>
                <button
                  onClick={() => setOsmDryRun(!osmDryRun)}
                  style={{ ...btnBase, padding: "6px 16px", fontWeight: 900, fontSize: "13px",
                    background: osmDryRun ? "#d97706" : "#dc2626", color: "#fff", border: "none" }}
                >
                  {osmDryRun ? "📋 件数確認のみ（dryRun）" : "✅ 本登録モード"}
                </button>
                <span style={{ fontSize: "12px", color: osmDryRun ? "#92400e" : "#991b1b" }}>
                  {osmDryRun
                    ? "DBに書き込みません。件数確認・動作確認用です"
                    : "⚠️ 実際にSupabaseへ登録します。確認後に実行してください"}
                </span>
              </div>

              {/* 実行ボタン */}
              <button
                onClick={handleOsmImport}
                disabled={osmLoading || osmPrefectures.size === 0 || osmTypes.size === 0}
                style={{ ...btnBase, width: "100%", height: "52px",
                  background: osmLoading || osmPrefectures.size === 0 ? "#ccc"
                    : osmDryRun ? "linear-gradient(135deg, #d97706, #b45309)"
                    : "linear-gradient(135deg, #059669, #047857)",
                  color: "#fff", fontSize: "15px", fontWeight: 900 }}
              >
                {osmLoading && osmProgress
                  ? `⏳ ${osmProgress.current}/${osmProgress.total} 処理中: ${osmProgress.cityName}`
                  : osmDryRun
                    ? `🔍 ${OSM_CITY_LIST.filter(c => osmPrefectures.has(c.prefecture)).length}都市 × ${osmTypes.size}種別 を確認する`
                    : `🚀 ${OSM_CITY_LIST.filter(c => osmPrefectures.has(c.prefecture)).length}都市 × ${osmTypes.size}種別 を一括登録する`}
              </button>

              {/* エラー表示 */}
              {osmError && (
                <div style={{ marginTop: "12px", padding: "12px 16px", borderRadius: "10px", background: "#fef2f2", border: "1.5px solid #fca5a5", color: "#dc2626", fontSize: "13px", fontWeight: 700 }}>
                  ❌ {osmError}
                </div>
              )}

              {/* 進捗バー */}
              {osmLoading && osmProgress && (
                <div style={{ marginTop: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px", color: "#059669", fontWeight: 700 }}>
                    <span>🌐 {osmProgress.cityName}</span>
                    <span>{osmProgress.current}/{osmProgress.total}</span>
                  </div>
                  <div style={{ background: "#e5e7eb", borderRadius: "999px", height: "8px", overflow: "hidden" }}>
                    <div style={{ background: "linear-gradient(90deg, #059669, #10b981)", height: "100%", width: `${(osmProgress.current / osmProgress.total) * 100}%`, transition: "width 0.3s" }} />
                  </div>
                  <div style={{ marginTop: "8px", fontSize: "12px", color: "#374151" }}>
                    ✅ 現在までに登録予定: <strong>{osmTotalInserted}件</strong>　取得: {osmTotalFetched}件
                  </div>
                </div>
              )}

              {/* 結果表示（都市ごとにリアルタイム追加） */}
              {osmCityResults.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <div style={{ padding: "14px 16px", borderRadius: "12px", background: "#ecfdf5", border: "1.5px solid #6ee7b7", marginBottom: "10px" }}>
                    <div style={{ fontWeight: 900, color: "#065f46", fontSize: "15px", marginBottom: "6px" }}>
                      {osmLoading ? "⏳ 処理中..." : (osmDryRun ? "📋 dryRun完了" : "✅ 登録完了")}
                    </div>
                    <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#374151" }}>🌐 取得: <strong>{osmTotalFetched}件</strong></span>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#059669" }}>✅ {osmDryRun ? "登録予定" : "登録済"}: <strong>{osmTotalInserted}件</strong></span>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#6b7280" }}>処理済み都市: {osmCityResults.length}件</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "4px", maxHeight: "500px", overflowY: "auto" }}>
                    {osmCityResults.map((r, i) => {
                      const key = `${r.prefecture}/${r.cityName}`;
                      const expanded = osmExpandedCity === key;
                      return (
                        <div key={i} style={{ borderRadius: "8px", border: `1px solid ${r.error ? "#fca5a5" : "#e5e7eb"}`, overflow: "hidden" }}>
                          {/* 都市行（クリックで展開） */}
                          <div
                            onClick={() => setOsmExpandedCity(expanded ? null : key)}
                            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 10px", background: r.error ? "#fef2f2" : "#f9fafb", fontSize: "12px", cursor: r.spots.length > 0 ? "pointer" : "default" }}
                          >
                            <span style={{ fontWeight: 700, minWidth: "80px", color: "#374151" }}>{r.prefecture}/{r.cityName}</span>
                            <span style={{ color: "#6b7280" }}>取得 {r.fetched}</span>
                            <span style={{ color: "#059669", fontWeight: 700 }}>✅ {r.inserted}件</span>
                            <span style={{ color: "#d97706" }}>skip {r.skipped}</span>
                            {r.error && <span style={{ color: "#dc2626", fontWeight: 700 }}>⚠ {r.error}</span>}
                            {r.spots.length > 0 && (
                              <span style={{ marginLeft: "auto", color: "#7c3aed", fontWeight: 700 }}>{expanded ? "▲ 閉じる" : "▼ スポット一覧"}</span>
                            )}
                          </div>
                          {/* スポット詳細（展開時） */}
                          {expanded && r.spots.length > 0 && (
                            <div style={{ background: "#fff", borderTop: "1px solid #e5e7eb", padding: "8px 10px", display: "grid", gap: "6px" }}>
                              {r.spots.map((spot, si) => (
                                <div key={si} style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "6px 8px", borderRadius: "6px", background: "#fafafa", border: "1px solid #f3f4f6" }}>
                                  <div style={{ fontWeight: 800, fontSize: "13px", color: "#1f2937" }}>{spot.name}</div>
                                  {spot.address && <div style={{ fontSize: "11px", color: "#6b7280" }}>📍 {spot.address}</div>}
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "2px" }}>
                                    {spot.tags.map(tag => (
                                      <span key={tag} style={{ background: "#ede9fe", color: "#7c3aed", borderRadius: "999px", padding: "1px 8px", fontSize: "11px", fontWeight: 700 }}>{tag}</span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Google Places 全国一括取り込み ──────────────────────── */}
            <div style={card}>
              <div style={{ ...titleStyle, color: "#dc2626" }}>🌐 Google Places 全国一括スポット取り込み</div>
              <div style={{ fontSize: "13px", color: "#7f1d1d", marginBottom: "16px", lineHeight: 1.7, background: "#fef2f2", borderRadius: "10px", padding: "12px 14px", border: "1px solid #fca5a5" }}>
                Google Places API を使って全国のスポットを一括取り込みします。
                写真・評価・住所・AIタグが自動生成されます。<br />
                ⚠️ まず <strong>「件数確認のみ（dryRun）」</strong>で規模を確認してから本登録することをおすすめします。
              </div>

              {/* 都道府県選択 */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontWeight: 900, fontSize: "13px", marginBottom: "10px", color: "#4a3034" }}>
                  都道府県を選択 <span style={{ fontWeight: 400, color: "#9ca3af" }}>（{gbPrefectures.size}件選択中）</span>
                </div>
                {Object.entries(REGION_GROUPS_UI).map(([region, prefs]) => {
                  const allSelected = prefs.every(p => gbPrefectures.has(p));
                  const someSelected = prefs.some(p => gbPrefectures.has(p));
                  return (
                    <div key={region} style={{ marginBottom: "10px" }}>
                      <button
                        onClick={() => handleGbToggleRegion(prefs)}
                        style={{ ...btnBase, marginBottom: "6px", padding: "4px 12px", fontSize: "12px", fontWeight: 800, background: allSelected ? "#dc2626" : someSelected ? "#fecaca" : "#f9fafb", color: allSelected ? "#fff" : "#374151", border: `1px solid ${allSelected ? "#dc2626" : "#e5e7eb"}` }}
                      >{region}</button>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                        {prefs.map(pref => (
                          <button key={pref} onClick={() => handleGbTogglePref(pref)}
                            style={{ ...btnBase, padding: "3px 10px", fontSize: "12px",
                              background: gbPrefectures.has(pref) ? "#dc2626" : "#f9fafb",
                              color: gbPrefectures.has(pref) ? "#fff" : "#374151",
                              border: `1px solid ${gbPrefectures.has(pref) ? "#dc2626" : "#e5e7eb"}` }}
                          >{pref}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* プリセットボタン */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontWeight: 900, fontSize: "13px", color: "#4a3034", marginBottom: "8px" }}>クイックプリセット</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {GB_PRESETS.map(preset => (
                    <button key={preset.label} onClick={() => setGbKeywords(new Set(preset.keywords))}
                      style={{ ...btnBase, padding: "8px 18px", fontSize: "13px", fontWeight: 800, color: "#fff", background: preset.color, border: "none" }}>
                      {preset.label}
                    </button>
                  ))}
                  <button onClick={() => setGbKeywords(new Set())}
                    style={{ ...btnBase, padding: "8px 14px", fontSize: "12px", background: "#f3f4f6", color: "#6b7280" }}>クリア</button>
                </div>
              </div>

              {/* キーワード選択 */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <div style={{ fontWeight: 900, fontSize: "13px", color: "#4a3034" }}>
                    キーワードを個別選択 <span style={{ fontWeight: 400, color: "#9ca3af" }}>（{gbKeywords.size}件選択中）</span>
                  </div>
                  <button onClick={() => setGbKeywords(new Set(GOOGLE_KEYWORDS))}
                    style={{ ...btnBase, padding: "3px 10px", fontSize: "11px", background: "#f3f4f6", color: "#374151" }}>全選択</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {GOOGLE_KEYWORDS.map(kw => (
                    <button key={kw} onClick={() => handleGbToggleKeyword(kw)}
                      style={{ ...btnBase, padding: "4px 12px", fontSize: "12px",
                        background: gbKeywords.has(kw) ? "#dc2626" : "#f9fafb",
                        color: gbKeywords.has(kw) ? "#fff" : "#374151",
                        border: `1px solid ${gbKeywords.has(kw) ? "#dc2626" : "#e5e7eb"}` }}
                    >{kw}</button>
                  ))}
                </div>
              </div>

              {/* 処理済みキャッシュ管理 */}
              <div style={{ marginBottom: "14px", padding: "12px 14px", background: "#f0fdf4", borderRadius: "10px", border: "1px solid #86efac" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "13px", color: "#166534", fontWeight: 700 }}>
                    ✅ 処理済み: {gbDoneKeys.size}組み合わせ
                  </span>
                  {gbDoneKeys.size === 0 && (
                    <span style={{ fontSize: "12px", color: "#6b7280" }}>（初回 or リセット済み）</span>
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button onClick={markLegacyCitiesDone}
                      style={{ ...btnBase, padding: "5px 12px", fontSize: "12px", fontWeight: 700, background: "#166534", color: "#fff", border: "none" }}>
                      📌 旧65都市を処理済みにする（新都市のみ実行）
                    </button>
                    <button onClick={clearGbDone}
                      style={{ ...btnBase, padding: "5px 12px", fontSize: "12px", background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5" }}>
                      🔄 全リセット
                    </button>
                  </div>
                </div>
                {gbDoneKeys.size > 0 && (
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "6px" }}>
                    APIを呼ばずスキップ。新しい都市・キーワードのみ実行されます。
                  </div>
                )}
              </div>

              {/* dryRun トグル */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", padding: "12px 14px", background: gbDryRun ? "#fefce8" : "#fef2f2", borderRadius: "10px", border: `1px solid ${gbDryRun ? "#fde68a" : "#fecaca"}` }}>
                <button
                  onClick={() => setGbDryRun(!gbDryRun)}
                  style={{ ...btnBase, padding: "6px 16px", fontSize: "13px", fontWeight: 800,
                    background: gbDryRun ? "#d97706" : "#dc2626", color: "#fff", border: "none" }}
                >{gbDryRun ? "📋 件数確認のみ（dryRun）" : "✅ 本登録モード"}</button>
                <span style={{ fontSize: "12px", color: gbDryRun ? "#92400e" : "#991b1b" }}>
                  {gbDryRun ? "DBには書き込まず、取得件数のみ確認します" : "実際にSupabaseへ登録します"}
                </span>
              </div>

              {/* 実行ボタン */}
              <button
                onClick={handleGbImport}
                disabled={gbLoading || gbPrefectures.size === 0 || gbKeywords.size === 0}
                style={{ ...btnBase, width: "100%", height: "52px", fontSize: "15px", fontWeight: 900, color: "#fff",
                  background: gbLoading || gbPrefectures.size === 0 ? "#ccc"
                    : gbDryRun ? "linear-gradient(135deg, #d97706, #b45309)"
                    : "linear-gradient(135deg, #dc2626, #b91c1c)" }}
              >
                {(() => {
                  if (gbLoading && gbProgress) return `⏳ ${gbProgress.current}/${gbProgress.total} 処理中: ${gbProgress.label}`;
                  const targetCities = OSM_CITY_LIST.filter(c => gbPrefectures.has(c.prefecture));
                  const keywords = Array.from(gbKeywords);
                  const newCount = targetCities.flatMap(city => keywords.map(kw => ({ city, kw }))).filter(({ city, kw }) => !gbDoneKeys.has(gbDoneKey(city.cityName, kw))).length;
                  const doneCount = targetCities.length * keywords.length - newCount;
                  if (gbDryRun) return `🔍 ${newCount}組み合わせを確認する${doneCount > 0 ? `（${doneCount}件スキップ）` : ""}`;
                  return `🚀 ${newCount}組み合わせを登録する${doneCount > 0 ? `（${doneCount}件スキップ）` : ""}`;
                })()}
              </button>

              {gbError && (
                <div style={{ marginTop: "10px", color: "#dc2626", fontWeight: 700, fontSize: "13px" }}>❌ {gbError}</div>
              )}

              {/* プログレスバー */}
              {gbLoading && gbProgress && (
                <div style={{ marginTop: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>
                    <span>🔍 {gbProgress.label}</span>
                    <span>{gbProgress.current}/{gbProgress.total}</span>
                  </div>
                  <div style={{ background: "#f3f4f6", borderRadius: "999px", height: "8px", overflow: "hidden" }}>
                    <div style={{ background: "linear-gradient(90deg, #dc2626, #ef4444)", height: "100%", width: `${(gbProgress.current / gbProgress.total) * 100}%`, transition: "width 0.3s" }} />
                  </div>
                  <div style={{ marginTop: "6px", fontSize: "12px", color: "#6b7280" }}>
                    ✅ 現在までに登録予定: <strong>{gbTotalInserted}件</strong>　取得: {gbTotalFetched}件
                  </div>
                </div>
              )}

              {/* 結果表示 */}
              {gbResults.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <div style={{ padding: "14px 16px", borderRadius: "12px", background: "#fef2f2", border: "1.5px solid #fca5a5", marginBottom: "10px" }}>
                    <div style={{ fontWeight: 900, color: "#7f1d1d", fontSize: "15px", marginBottom: "6px" }}>
                      {gbLoading ? "⏳ 処理中..." : (gbDryRun ? "📋 dryRun完了" : "✅ 登録完了")}
                    </div>
                    <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#374151" }}>🌐 取得: <strong>{gbTotalFetched}件</strong></span>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#dc2626" }}>✅ {gbDryRun ? "登録予定" : "登録済"}: <strong>{gbTotalInserted}件</strong></span>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#6b7280" }}>処理済み: {gbResults.length}件</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "4px", maxHeight: "500px", overflowY: "auto" }}>
                    {gbResults.map((r, i) => {
                      const key = `${r.prefecture}/${r.cityName}/${r.keyword}`;
                      const expanded = gbExpandedKey === key;
                      return (
                        <div key={i} style={{ borderRadius: "8px", border: `1px solid ${r.error ? "#fca5a5" : "#e5e7eb"}`, overflow: "hidden" }}>
                          <div
                            onClick={() => setGbExpandedKey(expanded ? null : key)}
                            style={{ display: "flex", alignItems: "center", gap: "8px", padding: "7px 10px", background: r.error ? "#fef2f2" : "#f9fafb", fontSize: "12px", cursor: r.spots.length > 0 ? "pointer" : "default" }}
                          >
                            <span style={{ fontWeight: 700, minWidth: "120px", color: "#374151" }}>{r.cityName} / {r.keyword}</span>
                            <span style={{ color: "#6b7280" }}>取得 {r.fetched}</span>
                            <span style={{ color: "#dc2626", fontWeight: 700 }}>✅ {r.inserted}件</span>
                            <span style={{ color: "#d97706" }}>skip {r.skipped}</span>
                            {r.error && <span style={{ color: "#dc2626", fontWeight: 700 }}>⚠ {r.error}</span>}
                            {r.spots.length > 0 && (
                              <span style={{ marginLeft: "auto", color: "#7c3aed", fontWeight: 700 }}>{expanded ? "▲ 閉じる" : "▼ スポット一覧"}</span>
                            )}
                          </div>
                          {expanded && r.spots.length > 0 && (
                            <div style={{ background: "#fff", borderTop: "1px solid #e5e7eb", padding: "8px 10px", display: "grid", gap: "6px" }}>
                              {r.spots.map((spot, si) => (
                                <div key={si} style={{ display: "flex", gap: "10px", padding: "6px 8px", borderRadius: "6px", background: "#fafafa", border: "1px solid #f3f4f6" }}>
                                  {spot.photoUrl && (
                                    <img src={spot.photoUrl} alt={spot.name} style={{ width: "60px", height: "60px", objectFit: "cover", borderRadius: "6px", flexShrink: 0 }} />
                                  )}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 800, fontSize: "13px", color: "#1f2937" }}>{spot.name}</div>
                                    {spot.address && <div style={{ fontSize: "11px", color: "#6b7280" }}>📍 {spot.address}</div>}
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                                      {spot.tags.map(tag => (
                                        <span key={tag} style={{ background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "1px 8px", fontSize: "11px", fontWeight: 700 }}>{tag}</span>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── ゴミデータ削除 ─────────────────────────────────────── */}
            <div style={card}>
              <div style={{ ...titleStyle, color: "#dc2626" }}>🗑 登録済みスポットのクリーンアップ</div>
              <div style={{ fontSize: "13px", color: "#7f1d1d", marginBottom: "16px", lineHeight: 1.7, background: "#fef2f2", borderRadius: "10px", padding: "12px 14px", border: "1px solid #fca5a5" }}>
                名前に特定のキーワードを含むスポット、またはタグで絞り込んで一括削除できます。<br />
                ⚠️ まず <strong>「件数確認のみ」</strong> で対象を確認してから本削除してください。
              </div>

              {/* 重複・子スポット分析 */}
              <div style={{ marginBottom: "16px", padding: "14px 16px", background: "#f5f3ff", borderRadius: "12px", border: "1.5px solid #c4b5fd" }}>
                <div style={{ fontWeight: 900, fontSize: "13px", color: "#4c1d95", marginBottom: "6px" }}>🔍 重複・施設内子スポット 分析</div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "10px" }}>
                  ① 名前が完全一致する重複　② 「親施設名 + スペース + 子名」のパターンの子スポット（例: よこはまコスモワールド キッズゾーン）をグループ表示します。
                </div>
                <button onClick={handleAnalysis} disabled={analysisLoading}
                  style={{ ...btnBase, padding: "8px 20px", fontSize: "14px", fontWeight: 900, color: "#fff", background: analysisLoading ? "#ccc" : "linear-gradient(135deg, #7c3aed, #6d28d9)" }}>
                  {analysisLoading ? "⏳ 分析中（25,000件超は少し時間がかかります）..." : "🔍 分析を実行"}
                </button>

                {analysisError && <div style={{ marginTop: "10px", color: "#dc2626", fontWeight: 700, fontSize: "13px" }}>❌ {analysisError}</div>}

                {analysisResult && (
                  <div style={{ marginTop: "14px" }}>
                    <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "12px" }}>取得スポット数: {analysisResult.totalPlaces.toLocaleString()}件</div>

                    {/* ① 完全一致の重複 */}
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{ fontWeight: 900, fontSize: "13px", color: "#dc2626", marginBottom: "8px" }}>
                        🔁 完全一致の重複: {analysisResult.exactDuplicates.length}グループ
                      </div>
                      {analysisResult.exactDuplicates.length === 0
                        ? <div style={{ fontSize: "12px", color: "#059669" }}>✅ 重複なし</div>
                        : (() => {
                            const allDupeIds = analysisResult.exactDuplicates.flatMap(g => g.places.slice(1).map(p => p.id));
                            const isDeletingAll = allDupeIds.some(id => deletingIds.has(id));
                            const filtered = dupeFilter.trim()
                              ? analysisResult.exactDuplicates.filter(g => g.name.includes(dupeFilter.trim()))
                              : analysisResult.exactDuplicates;
                            return (
                              <div>
                                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
                                  <input
                                    value={dupeFilter}
                                    onChange={e => setDupeFilter(e.target.value)}
                                    placeholder="スポット名で絞り込み..."
                                    style={{ flex: 1, minWidth: "160px", padding: "6px 10px", borderRadius: "8px", border: "1px solid #fca5a5", fontSize: "12px", outline: "none" }}
                                  />
                                  <button onClick={() => handleDeleteByIds(allDupeIds)} disabled={isDeletingAll || allDupeIds.length === 0}
                                    style={{ ...btnBase, padding: "6px 14px", fontSize: "12px", fontWeight: 900, background: isDeletingAll ? "#ccc" : "linear-gradient(135deg, #dc2626, #b91c1c)", color: "#fff", whiteSpace: "nowrap" }}>
                                    {isDeletingAll ? "削除中..." : `🗑 全重複を一括削除（${allDupeIds.length}件）`}
                                  </button>
                                </div>
                                {dupeFilter && <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "6px" }}>{filtered.length}件表示中</div>}
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "500px", overflowY: "auto" }}>
                                  {filtered.map(group => {
                                    const isOpen = expandedDupe === group.name;
                                    const dupeIds = group.places.slice(1).map(p => p.id);
                                    const isDeleting = dupeIds.some(id => deletingIds.has(id));
                                    return (
                                      <div key={group.name} style={{ borderRadius: "8px", border: "1px solid #fca5a5", overflow: "hidden", flexShrink: 0 }}>
                                        <div onClick={() => setExpandedDupe(isOpen ? null : group.name)}
                                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "#fef2f2", cursor: "pointer", gap: "8px" }}>
                                          <span style={{ fontWeight: 700, fontSize: "13px", color: "#991b1b", flex: 1 }}>{group.name}</span>
                                          <span style={{ fontSize: "11px", color: "#dc2626", fontWeight: 700, whiteSpace: "nowrap" }}>{group.count}件重複</span>
                                          <span style={{ fontSize: "12px", color: "#9ca3af" }}>{isOpen ? "▲" : "▼"}</span>
                                        </div>
                                        {isOpen && (
                                          <div style={{ padding: "10px 12px", background: "#fff" }}>
                                            {group.places.map((p, i) => (
                                              <div key={p.id} style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "6px", padding: "6px 8px", borderRadius: "6px", background: i === 0 ? "#f0fdf4" : "#fef2f2" }}>
                                                <span style={{ fontSize: "13px", flexShrink: 0 }}>{i === 0 ? "✅" : "🗑"}</span>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                  <div style={{ fontSize: "11px", color: "#6b7280" }}>📍 {p.address || "住所なし"}</div>
                                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginTop: "3px" }}>
                                                    {p.tags.slice(0, 5).map(t => <span key={t} style={{ background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "1px 6px", fontSize: "10px" }}>{t}</span>)}
                                                    {p.tags.length > 5 && <span style={{ fontSize: "10px", color: "#9ca3af" }}>+{p.tags.length - 5}</span>}
                                                  </div>
                                                  <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "2px" }}>タグ: {p.tagCount}件</div>
                                                </div>
                                                {i > 0 && (
                                                  <button onClick={() => handleDeleteByIds([p.id])} disabled={deletingIds.has(p.id)}
                                                    style={{ ...btnBase, padding: "4px 10px", fontSize: "11px", fontWeight: 800, background: deletingIds.has(p.id) ? "#ccc" : "#dc2626", color: "#fff", flexShrink: 0 }}>
                                                    {deletingIds.has(p.id) ? "..." : "削除"}
                                                  </button>
                                                )}
                                              </div>
                                            ))}
                                            {dupeIds.length > 0 && (
                                              <button onClick={() => handleDeleteByIds(dupeIds)} disabled={isDeleting}
                                                style={{ ...btnBase, width: "100%", padding: "6px", fontSize: "12px", fontWeight: 900, background: isDeleting ? "#ccc" : "linear-gradient(135deg, #dc2626, #b91c1c)", color: "#fff", marginTop: "4px" }}>
                                                {isDeleting ? "削除中..." : `🗑 重複${dupeIds.length}件をまとめて削除（タグ多い方を残す）`}
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()
                      }
                    </div>

                    {/* ② 施設内の子スポット（名前プレフィックス一致） */}
                    <div>
                      <div style={{ fontWeight: 900, fontSize: "13px", color: "#d97706", marginBottom: "8px" }}>
                        🏛 施設内の子スポット（名前一致）: {analysisResult.subZones.length}グループ
                      </div>
                      {analysisResult.subZones.length === 0
                        ? <div style={{ fontSize: "12px", color: "#059669" }}>✅ 子スポットなし</div>
                        : (() => {
                            const allChildIds = analysisResult.subZones.flatMap(g => g.children.map(c => c.id));
                            const isDeletingAll = allChildIds.some(id => deletingIds.has(id));
                            const filtered = zoneFilter.trim()
                              ? analysisResult.subZones.filter(g => g.parentName.includes(zoneFilter.trim()))
                              : analysisResult.subZones;
                            return (
                              <div>
                                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
                                  <input
                                    value={zoneFilter}
                                    onChange={e => setZoneFilter(e.target.value)}
                                    placeholder="親施設名で絞り込み..."
                                    style={{ flex: 1, minWidth: "160px", padding: "6px 10px", borderRadius: "8px", border: "1px solid #fde68a", fontSize: "12px", outline: "none" }}
                                  />
                                  <button onClick={() => handleDeleteByIds(allChildIds)} disabled={isDeletingAll || allChildIds.length === 0}
                                    style={{ ...btnBase, padding: "6px 14px", fontSize: "12px", fontWeight: 900, background: isDeletingAll ? "#ccc" : "linear-gradient(135deg, #d97706, #b45309)", color: "#fff", whiteSpace: "nowrap" }}>
                                    {isDeletingAll ? "削除中..." : `🗑 全子スポットを一括削除（${allChildIds.length}件）`}
                                  </button>
                                </div>
                                {zoneFilter && <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "6px" }}>{filtered.length}件表示中</div>}
                                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "500px", overflowY: "auto" }}>
                                  {filtered.map(group => {
                                    const isOpen = expandedZone === group.parentId;
                                    const childIds = group.children.map(c => c.id);
                                    const isDeleting = childIds.some(id => deletingIds.has(id));
                                    return (
                                      <div key={group.parentId} style={{ borderRadius: "8px", border: "1px solid #fde68a", overflow: "hidden", flexShrink: 0 }}>
                                        <div onClick={() => setExpandedZone(isOpen ? null : group.parentId)}
                                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "#fffbeb", cursor: "pointer", gap: "8px" }}>
                                          <span style={{ fontWeight: 700, fontSize: "13px", color: "#92400e", flex: 1 }}>{group.parentName}</span>
                                          <span style={{ fontSize: "11px", color: "#d97706", fontWeight: 700, whiteSpace: "nowrap" }}>子{group.children.length}件</span>
                                          <span style={{ fontSize: "12px", color: "#9ca3af" }}>{isOpen ? "▲" : "▼"}</span>
                                        </div>
                                        {isOpen && (
                                          <div style={{ padding: "10px 12px", background: "#fff" }}>
                                            <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "8px", padding: "4px 8px", background: "#f0fdf4", borderRadius: "6px" }}>
                                              <span style={{ fontSize: "13px" }}>✅</span>
                                              <span style={{ fontWeight: 700, fontSize: "12px", color: "#059669" }}>{group.parentName}（親スポット・残す）</span>
                                            </div>
                                            {group.children.map(c => (
                                              <div key={c.id} style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "4px", padding: "5px 8px", borderRadius: "6px", background: "#fffbeb" }}>
                                                <span style={{ fontSize: "13px", flexShrink: 0 }}>🗑</span>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                  <div style={{ fontWeight: 600, fontSize: "12px", color: "#374151" }}>{c.name}</div>
                                                  {c.address && <div style={{ fontSize: "11px", color: "#9ca3af" }}>📍 {c.address}</div>}
                                                </div>
                                                <button onClick={() => handleDeleteByIds([c.id])} disabled={deletingIds.has(c.id)}
                                                  style={{ ...btnBase, padding: "4px 10px", fontSize: "11px", fontWeight: 800, background: deletingIds.has(c.id) ? "#ccc" : "#d97706", color: "#fff", flexShrink: 0 }}>
                                                  {deletingIds.has(c.id) ? "..." : "削除"}
                                                </button>
                                              </div>
                                            ))}
                                            <button onClick={() => handleDeleteByIds(childIds)} disabled={isDeleting}
                                              style={{ ...btnBase, width: "100%", padding: "6px", fontSize: "12px", fontWeight: 900, background: isDeleting ? "#ccc" : "linear-gradient(135deg, #d97706, #b45309)", color: "#fff", marginTop: "4px" }}>
                                              {isDeleting ? "削除中..." : `🗑 子スポット${childIds.length}件をまとめて削除`}
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()
                      }
                    </div>
                  </div>
                )}
              </div>

              {/* 全不要スポット一括削除 */}
              <div style={{ marginBottom: "16px", padding: "14px 16px", background: cleanupAllDryRun ? "#fefce8" : "#fef2f2", borderRadius: "12px", border: `1.5px solid ${cleanupAllDryRun ? "#fde68a" : "#fca5a5"}` }}>
                <div style={{ fontWeight: 900, fontSize: "13px", color: "#4a3034", marginBottom: "10px" }}>⚡ 全不要スポットを一括削除</div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "10px" }}>
                  対象: ドッグラン・ペットショップ・トリミング・動物病院・ペットホテル・バー・スナック・クラブ・株式会社・有限会社・合同会社・法人・事務所
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <button onClick={() => setCleanupAllDryRun(!cleanupAllDryRun)}
                    style={{ ...btnBase, padding: "6px 14px", fontSize: "12px", fontWeight: 800, background: cleanupAllDryRun ? "#d97706" : "#dc2626", color: "#fff", border: "none" }}>
                    {cleanupAllDryRun ? "📋 件数確認のみ" : "🗑 本削除モード"}
                  </button>
                  <button onClick={handleCleanupAll} disabled={cleanupAllLoading}
                    style={{ ...btnBase, padding: "8px 20px", fontSize: "14px", fontWeight: 900, color: "#fff",
                      background: cleanupAllLoading ? "#ccc" : cleanupAllDryRun ? "linear-gradient(135deg, #d97706, #b45309)" : "linear-gradient(135deg, #dc2626, #b91c1c)" }}>
                    {cleanupAllLoading ? "処理中..." : cleanupAllDryRun ? "🔍 全カテゴリ件数確認" : "🗑 全カテゴリ一括削除"}
                  </button>
                </div>
                {cleanupAllResult && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ fontWeight: 900, fontSize: "14px", color: cleanupAllDryRun ? "#92400e" : "#dc2626", marginBottom: "6px" }}>
                      {cleanupAllDryRun ? `📋 削除対象合計: ${cleanupAllResult.total}件` : `✅ 削除完了: ${cleanupAllResult.total}件`}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {cleanupAllResult.details.map(d => (
                        <span key={d.pattern} style={{ fontSize: "12px", padding: "2px 10px", borderRadius: "999px", background: "#fff", border: "1px solid #e5e7eb", color: "#374151" }}>
                          {d.pattern}: {d.count}件
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 施設内子スポット一括削除 */}
              <div style={{ marginBottom: "16px", padding: "14px 16px", background: subFacilityDryRun ? "#fefce8" : "#fef2f2", borderRadius: "12px", border: `1.5px solid ${subFacilityDryRun ? "#fde68a" : "#fca5a5"}` }}>
                <div style={{ fontWeight: 900, fontSize: "13px", color: "#4a3034", marginBottom: "6px" }}>🏛 施設内の子スポットを一括削除</div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "10px" }}>
                  住所が「〇〇パーク内」「〇〇シーパラダイス内」のように大きな施設の中にあるスポットを除外します。<br />
                  例: うみファーム（横浜・八景島シーパラダイス内）
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <button onClick={() => setSubFacilityDryRun(!subFacilityDryRun)}
                    style={{ ...btnBase, padding: "6px 14px", fontSize: "12px", fontWeight: 800, background: subFacilityDryRun ? "#d97706" : "#dc2626", color: "#fff", border: "none" }}>
                    {subFacilityDryRun ? "📋 件数確認のみ" : "🗑 本削除モード"}
                  </button>
                  <button onClick={handleSubFacilityCleanup} disabled={subFacilityLoading}
                    style={{ ...btnBase, padding: "8px 20px", fontSize: "14px", fontWeight: 900, color: "#fff",
                      background: subFacilityLoading ? "#ccc" : subFacilityDryRun ? "linear-gradient(135deg, #d97706, #b45309)" : "linear-gradient(135deg, #dc2626, #b91c1c)" }}>
                    {subFacilityLoading ? "処理中..." : subFacilityDryRun ? "🔍 対象を確認する" : "🗑 一括削除する"}
                  </button>
                </div>
                {subFacilityResult && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ fontWeight: 900, fontSize: "14px", color: subFacilityDryRun ? "#92400e" : "#dc2626", marginBottom: "8px" }}>
                      {subFacilityDryRun ? `📋 対象: ${subFacilityResult.count}件` : `✅ 削除完了: ${subFacilityResult.count}件`}
                    </div>
                    {subFacilityResult.names.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "3px", maxHeight: "200px", overflowY: "auto" }}>
                        {subFacilityResult.names.map((n, i) => (
                          <div key={i} style={{ fontSize: "12px", color: "#374151", padding: "2px 6px", background: "#fff", borderRadius: "4px" }}>{n}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* カテゴリ別プリセット */}
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontWeight: 900, fontSize: "13px", color: "#4a3034", marginBottom: "8px" }}>カテゴリ別に削除</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {CLEANUP_PRESETS.map(p => (
                    <button key={p.label}
                      onClick={() => { setCleanupPattern(p.pattern); setCleanupTag(p.tag ?? ""); }}
                      style={{ ...btnBase, padding: "6px 14px", fontSize: "12px", fontWeight: 700, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5" }}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 手動入力 */}
              <div style={{ display: "grid", gap: "10px", marginBottom: "14px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "4px", color: "#4a3034" }}>名前に含むキーワード</label>
                  <input value={cleanupPattern} onChange={e => setCleanupPattern(e.target.value)}
                    placeholder="例: ドッグラン、ペットショップ、動物病院"
                    style={{ width: "100%", boxSizing: "border-box", height: "40px", borderRadius: "8px", border: "1.5px solid #e5e7eb", padding: "0 12px", fontSize: "13px", fontFamily: font }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "4px", color: "#4a3034" }}>タグで絞り込み（任意）</label>
                  <input value={cleanupTag} onChange={e => setCleanupTag(e.target.value)}
                    placeholder="例: #動物カフェ、#海辺（完全一致）"
                    style={{ width: "100%", boxSizing: "border-box", height: "40px", borderRadius: "8px", border: "1.5px solid #e5e7eb", padding: "0 12px", fontSize: "13px", fontFamily: font }} />
                </div>
              </div>

              {/* dryRun トグル */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px", padding: "10px 14px", background: cleanupDryRun ? "#fefce8" : "#fef2f2", borderRadius: "10px", border: `1px solid ${cleanupDryRun ? "#fde68a" : "#fecaca"}` }}>
                <button onClick={() => setCleanupDryRun(!cleanupDryRun)}
                  style={{ ...btnBase, padding: "6px 16px", fontSize: "13px", fontWeight: 800, background: cleanupDryRun ? "#d97706" : "#dc2626", color: "#fff", border: "none" }}>
                  {cleanupDryRun ? "📋 件数確認のみ" : "🗑 本削除モード"}
                </button>
                <span style={{ fontSize: "12px", color: cleanupDryRun ? "#92400e" : "#991b1b" }}>
                  {cleanupDryRun ? "DBは変更せず、対象件数のみ表示します" : "実際にSupabaseから削除します"}
                </span>
              </div>

              <button onClick={handleCleanup} disabled={cleanupLoading || (!cleanupPattern && !cleanupTag)}
                style={{ ...btnBase, width: "100%", height: "48px", fontSize: "14px", fontWeight: 900, color: "#fff",
                  background: cleanupLoading || (!cleanupPattern && !cleanupTag) ? "#ccc" : cleanupDryRun ? "linear-gradient(135deg, #d97706, #b45309)" : "linear-gradient(135deg, #dc2626, #b91c1c)" }}>
                {cleanupLoading ? "処理中..." : cleanupDryRun ? "🔍 対象を確認する" : "🗑 削除する"}
              </button>

              {cleanupError && <div style={{ marginTop: "10px", color: "#dc2626", fontWeight: 700, fontSize: "13px" }}>❌ {cleanupError}</div>}

              {cleanupResult && (
                <div style={{ marginTop: "12px", padding: "14px 16px", borderRadius: "12px", background: cleanupDryRun ? "#fefce8" : "#fef2f2", border: `1.5px solid ${cleanupDryRun ? "#fde68a" : "#fca5a5"}` }}>
                  <div style={{ fontWeight: 900, fontSize: "14px", color: cleanupDryRun ? "#92400e" : "#dc2626", marginBottom: "8px" }}>
                    {cleanupDryRun ? `📋 対象: ${cleanupResult.count}件` : `🗑 削除完了: ${cleanupResult.count}件`}
                  </div>
                  {cleanupResult.names.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px", maxHeight: "200px", overflowY: "auto" }}>
                      {cleanupResult.names.map((n, i) => (
                        <div key={i} style={{ fontSize: "12px", color: "#374151", padding: "2px 6px", background: "#fff", borderRadius: "4px" }}>{n}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── 有名スポット 一括手動登録 ─────────────────────────────── */}
            <div style={card}>
              <div style={{ ...titleStyle, color: "#7c3aed" }}>📝 有名スポット 一括手動登録</div>
              <div style={{ fontSize: "13px", color: "#4c1d95", marginBottom: "16px", lineHeight: 1.7, background: "#f5f3ff", borderRadius: "10px", padding: "12px 14px", border: "1px solid #ddd6fe" }}>
                スポット名を1行1件でペーストすると、Google Placesで検索して自動登録します。<br />
                例：富士急ハイランド、御殿場アウトレット など30件でも一気に登録可。<br />
                すでに登録済みの場合は無条件でスキップします。
              </div>

              <textarea
                value={manualText}
                onChange={e => setManualText(e.target.value)}
                placeholder={"富士急ハイランド\n御殿場プレミアム・アウトレット\nユニバーサル・スタジオ・ジャパン\n（1行に1スポット名）"}
                style={{ width: "100%", minHeight: "180px", borderRadius: "12px", border: "1.5px solid #c4b5fd", padding: "12px 14px", fontSize: "13px", fontFamily: font, outline: "none", resize: "vertical", background: "#faf5ff", boxSizing: "border-box", lineHeight: 1.7 }}
              />

              <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "14px 0", padding: "10px 14px", background: manualDryRun ? "#fefce8" : "#f5f3ff", borderRadius: "10px", border: `1px solid ${manualDryRun ? "#fde68a" : "#ddd6fe"}` }}>
                <button onClick={() => setManualDryRun(!manualDryRun)}
                  style={{ ...btnBase, padding: "6px 16px", fontSize: "13px", fontWeight: 800, background: manualDryRun ? "#d97706" : "#7c3aed", color: "#fff", border: "none" }}>
                  {manualDryRun ? "📋 件数確認のみ" : "✅ 本登録モード"}
                </button>
                <span style={{ fontSize: "12px", color: manualDryRun ? "#92400e" : "#4c1d95" }}>
                  {manualDryRun ? "DBは変更せず、登録予定の件数を確認します" : "実際にSupabaseへ登録します"}
                </span>
              </div>

              {(() => {
                const names = manualText.split("\n").map(s => s.trim()).filter(Boolean);
                return (
                  <button onClick={handleManualRegister} disabled={manualLoading || names.length === 0}
                    style={{ ...btnBase, width: "100%", height: "48px", fontSize: "14px", fontWeight: 900, color: "#fff",
                      background: manualLoading || names.length === 0 ? "#ccc" : manualDryRun ? "linear-gradient(135deg, #d97706, #b45309)" : "linear-gradient(135deg, #7c3aed, #6d28d9)" }}>
                    {manualLoading ? "処理中..." : manualDryRun ? `🔍 ${names.length}件 確認する` : `📝 ${names.length}件 登録する`}
                  </button>
                );
              })()}

              {manualError && <div style={{ marginTop: "10px", color: "#dc2626", fontWeight: 700, fontSize: "13px" }}>❌ {manualError}</div>}

              {manualSummary && (
                <div style={{ marginTop: "14px", padding: "12px 16px", borderRadius: "12px", background: manualDryRun ? "#fefce8" : "#f5f3ff", border: `1.5px solid ${manualDryRun ? "#fde68a" : "#c4b5fd"}` }}>
                  <div style={{ fontWeight: 900, fontSize: "14px", color: manualDryRun ? "#92400e" : "#7c3aed", marginBottom: "10px" }}>
                    {manualDryRun ? "📋 確認結果" : "✅ 登録完了"}
                  </div>
                  <div style={{ display: "flex", gap: "20px", fontSize: "13px", fontWeight: 700, marginBottom: "12px" }}>
                    <span style={{ color: "#059669" }}>✅ 登録: {manualSummary.inserted}件</span>
                    <span style={{ color: "#d97706" }}>⏭ スキップ: {manualSummary.skipped}件</span>
                    <span style={{ color: "#6b7280" }}>❓ 未発見: {manualSummary.notFound}件</span>
                  </div>
                  {manualResults && manualResults.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "300px", overflowY: "auto" }}>
                      {manualResults.map((r, i) => (
                        <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start", padding: "6px 10px", borderRadius: "8px", background: r.status === "inserted" ? "#ecfdf5" : r.status === "skipped" ? "#fffbeb" : r.status === "error" ? "#fef2f2" : "#f9fafb", border: `1px solid ${r.status === "inserted" ? "#6ee7b7" : r.status === "skipped" ? "#fde68a" : r.status === "error" ? "#fca5a5" : "#e5e7eb"}` }}>
                          <span style={{ fontSize: "14px", flexShrink: 0 }}>
                            {r.status === "inserted" ? "✅" : r.status === "skipped" ? "⏭" : r.status === "not_found" ? "❓" : "❌"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: "12px", color: "#1f2937" }}>{r.name}</div>
                            {r.address && <div style={{ fontSize: "11px", color: "#6b7280" }}>📍 {r.address}</div>}
                            {r.tags && r.tags.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", marginTop: "3px" }}>
                                {r.tags.map(tag => (
                                  <span key={tag} style={{ background: "#ede9fe", color: "#7c3aed", borderRadius: "999px", padding: "1px 7px", fontSize: "10px", fontWeight: 700 }}>{tag}</span>
                                ))}
                              </div>
                            )}
                            {r.error && <div style={{ fontSize: "11px", color: "#dc2626", marginTop: "2px" }}>⚠ {r.error}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== 訪問学習データ管理タブ ===== */}
        {tab === "visited" && (
          <div style={{ display: "grid", gap: "20px" }}>
            {/* 手動追加フォーム */}
            <div style={card}>
              <div style={titleStyle}>➕ 訪問データを手動追加</div>
              <p style={{ fontSize: "13px", color: "#7a5860", marginBottom: "16px", lineHeight: 1.7 }}>
                ユーザーが実際に訪れた場所をAIの学習データとして手動で登録します。<br />
                気分・エリア・訪問場所・評価の組み合わせが学習に使われます。
              </p>

              {/* AI自動入力セクション */}
              <div style={{
                background: autoFillOpen ? "#f0f4ff" : "#f7f8ff",
                border: "1.5px solid #c0d0ff",
                borderRadius: "16px",
                padding: "14px 16px",
                marginBottom: "18px",
              }}>
                <button
                  type="button"
                  onClick={() => setAutoFillOpen((v) => !v)}
                  style={{ ...btnBase, background: "none", border: "none", width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", padding: 0, fontSize: "14px", fontWeight: 900, color: "#3060d0" }}
                >
                  <span>🔍 場所を検索してAIで自動入力</span>
                  <span style={{ fontSize: "18px", opacity: 0.6 }}>{autoFillOpen ? "▲" : "▼"}</span>
                </button>

                {autoFillOpen && (
                  <div style={{ marginTop: "12px" }}>
                    <p style={{ fontSize: "12px", color: "#6080b0", marginBottom: "10px", lineHeight: 1.6 }}>
                      場所名を検索すると、GPTが気分・エリア・雰囲気などを自動で推定してフォームに入力します。確認・修正してから登録してください。
                    </p>
                    <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                      <input
                        type="text"
                        value={autoFillQuery}
                        onChange={(e) => setAutoFillQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAutoFillSearch()}
                        placeholder="例：山下公園、スターバックス横浜元町、横浜中華街"
                        style={{ flex: 1, height: "42px", borderRadius: "10px", border: "1.5px solid #b0c8ff", padding: "0 14px", fontSize: "14px", outline: "none", background: "#fff", fontFamily: font }}
                      />
                      <button
                        onClick={handleAutoFillSearch}
                        disabled={autoFillSearching || !autoFillQuery.trim()}
                        style={{ ...btnBase, padding: "0 18px", height: "42px", background: autoFillSearching ? "#ccc" : "linear-gradient(135deg, #4184ff 0%, #2a6fe6 100%)", color: "#fff", fontSize: "13px", flexShrink: 0 }}
                      >
                        {autoFillSearching ? "検索中..." : "検索"}
                      </button>
                    </div>

                    {autoFillCandidates.length > 0 && (
                      <div style={{ display: "grid", gap: "8px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 800, color: "#4060a0", marginBottom: "2px" }}>
                          {autoFillCandidates.length}件見つかりました。選択するとAIが自動入力します：
                        </div>
                        {autoFillCandidates.map((c) => (
                          <button
                            key={c.placeId}
                            onClick={() => handleAutoFill(c)}
                            disabled={autoFillLoading}
                            style={{
                              ...btnBase,
                              width: "100%",
                              textAlign: "left",
                              padding: "10px 14px",
                              background: "#fff",
                              border: "1.5px solid #c0d4ff",
                              borderRadius: "12px",
                              cursor: autoFillLoading ? "wait" : "pointer",
                            }}
                          >
                            <div style={{ fontWeight: 900, fontSize: "14px", color: "#2040a0", marginBottom: "2px" }}>
                              {autoFillLoading ? "⏳ AI分析中..." : c.name}
                            </div>
                            <div style={{ fontSize: "12px", opacity: 0.65 }}>{c.address}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {feedbackSuccess && (
                <div style={{ background: "#e8f5e9", border: "1px solid #c8e6c9", borderRadius: "12px", padding: "12px 16px", marginBottom: "16px", color: "#2e7d32", fontWeight: 700, fontSize: "14px" }}>
                  ✅ 訪問データを登録しました
                </div>
              )}
              {feedbackError && (
                <div style={{ background: "#fce4e4", border: "1px solid #f5c0c8", borderRadius: "12px", padding: "12px 16px", marginBottom: "16px", color: "#c0385a", fontWeight: 700, fontSize: "14px" }}>
                  ❌ {feedbackError}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                {[
                  { key: "mood", label: "気分", placeholder: "例：お腹すいた、まったりしたい" },
                  { key: "area", label: "エリア", placeholder: "例：横浜、渋谷、大阪" },
                  { key: "age", label: "年代（任意）", placeholder: "例：20代" },
                  { key: "gender", label: "性別（任意）", placeholder: "例：男性、女性" },
                  { key: "companion", label: "同行者（任意）", placeholder: "例：一人、恋人、友達" },
                  { key: "atmosphere", label: "雰囲気（任意）", placeholder: "例：静か、賑やか" },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "4px", color: "#4a3034" }}>{label}</label>
                    <input
                      type="text"
                      value={newFeedback[key as keyof typeof newFeedback]}
                      onChange={(e) => setNewFeedback((p) => ({ ...p, [key]: e.target.value }))}
                      placeholder={placeholder}
                      style={{ width: "100%", height: "40px", borderRadius: "10px", border: "1px solid #ead7db", padding: "0 12px", fontSize: "13px", outline: "none", background: "#fffaf8", boxSizing: "border-box", fontFamily: font }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "4px", color: "#4a3034" }}>
                  🏠 実際に行った場所 <span style={{ color: "#c0385a" }}>*</span>
                </label>
                <input
                  type="text"
                  value={newFeedback.visitedPlace}
                  onChange={(e) => setNewFeedback((p) => ({ ...p, visitedPlace: e.target.value }))}
                  placeholder="例：ランドマークタワー展望台、マクドナルド横浜駅前店"
                  style={{ width: "100%", height: "44px", borderRadius: "10px", border: "1px solid #ead7db", padding: "0 14px", fontSize: "14px", outline: "none", background: "#fffaf8", boxSizing: "border-box", fontFamily: font }}
                />
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "4px", color: "#4a3034" }}>
                  提案されたスポット名（任意、カンマ区切り）
                </label>
                <input
                  type="text"
                  value={newFeedback.topRecommendations}
                  onChange={(e) => setNewFeedback((p) => ({ ...p, topRecommendations: e.target.value }))}
                  placeholder="例：コスモワールド、山下公園、中華街"
                  style={{ width: "100%", height: "40px", borderRadius: "10px", border: "1px solid #ead7db", padding: "0 12px", fontSize: "13px", outline: "none", background: "#fffaf8", boxSizing: "border-box", fontFamily: font }}
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, marginBottom: "6px", color: "#4a3034" }}>評価 ⭐</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      onClick={() => setNewFeedback((p) => ({ ...p, rating: String(v) }))}
                      style={{
                        ...btnBase,
                        width: "48px", height: "48px", fontSize: "18px",
                        background: newFeedback.rating === String(v) ? "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)" : "#fff",
                        color: newFeedback.rating === String(v) ? "#fff" : "#4a3034",
                        border: newFeedback.rating === String(v) ? "none" : "1px solid #ead7db",
                        boxShadow: newFeedback.rating === String(v) ? "0 4px 12px rgba(255,143,127,0.4)" : "none",
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleAddFeedback}
                disabled={feedbackSubmitting}
                style={{ ...btnBase, width: "100%", height: "48px", background: feedbackSubmitting ? "#ccc" : "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)", color: "#fff", fontSize: "15px", boxShadow: "0 6px 16px rgba(255,143,127,0.3)" }}
              >
                {feedbackSubmitting ? "登録中..." : "📝 訪問データを登録する"}
              </button>
            </div>

            {/* データ一覧 */}
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <div style={titleStyle}>📋 登録済みフィードバック一覧</div>
                <div style={{ display: "flex", gap: "6px" }}>
                  {(["visited", "all"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setVisitedFilter(f)}
                      style={{ ...btnBase, padding: "6px 14px", fontSize: "12px", background: visitedFilter === f ? "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)" : "#fff", color: visitedFilter === f ? "#fff" : "#4a3034", border: visitedFilter === f ? "none" : "1px solid #ead7db" }}
                    >
                      {f === "visited" ? "🚶 訪問あり" : "📋 全件"}
                    </button>
                  ))}
                </div>
              </div>
              {visitedLoading ? (
                <div style={{ textAlign: "center", padding: "24px", opacity: 0.6, fontSize: "13px" }}>読み込み中...</div>
              ) : (() => {
                const filtered = visitedFilter === "visited"
                  ? visitedData.filter((f) => f.visited_place)
                  : visitedData;
                if (filtered.length === 0) return (
                  <div style={{ fontSize: "13px", opacity: 0.6 }}>データがありません</div>
                );
                return (
                  <div style={{ display: "grid", gap: "10px" }}>
                    <div style={{ fontSize: "12px", opacity: 0.55, marginBottom: "4px" }}>{filtered.length}件</div>
                    {filtered.map((f) => (
                      <div key={f.id} style={{
                        borderRadius: "14px",
                        padding: "12px 14px",
                        background: "#fffaf8",
                        border: "1px solid #f0dfe3",
                        display: "grid",
                        gap: "4px",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                            {f.mood && <span style={{ fontWeight: 900, fontSize: "13px", color: "#4a3034" }}>{f.mood}</span>}
                            {f.area && <span style={{ fontSize: "12px", opacity: 0.7 }}>📍 {f.area}</span>}
                            {f.companion && <span style={{ fontSize: "12px", opacity: 0.7 }}>👤 {f.companion}</span>}
                            {f.rating !== null && (
                              <span style={{ fontSize: "12px", background: "#fff8e1", borderRadius: "999px", padding: "1px 8px", fontWeight: 700, color: "#b07030", border: "1px solid #ffe082" }}>
                                ⭐ {f.rating}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                            <span style={{ fontSize: "11px", opacity: 0.45 }}>
                              {new Date(f.created_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                            </span>
                            <button
                              onClick={() => handleDeleteFeedback(f.id)}
                              disabled={deletingId === f.id}
                              style={{ ...btnBase, padding: "4px 10px", fontSize: "11px", background: "#fce4e4", color: "#c0385a", border: "1px solid #f5c0c8" }}
                            >
                              {deletingId === f.id ? "..." : "削除"}
                            </button>
                          </div>
                        </div>
                        {f.visited_place && (
                          <div style={{ fontSize: "13px", color: "#18794e", fontWeight: 700 }}>
                            🚶 行った場所: {f.visited_place}
                          </div>
                        )}
                        {(f.top_recommendations ?? []).length > 0 && (
                          <div style={{ fontSize: "12px", opacity: 0.65 }}>
                            提案: {f.top_recommendations.slice(0, 3).join("、")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
        {/* ===== 不適切報告タブ ===== */}
        {tab === "reports" && (
          <div>
            <div style={{ fontWeight: 900, fontSize: "20px", marginBottom: "18px", color: "#4a3034" }}>
              ⚠ 不適切報告一覧
            </div>

            {/* 全体非表示リスト */}
            <div style={{ background: "#fff5f5", border: "1px solid #fecaca", borderRadius: "16px", padding: "18px 20px", marginBottom: "24px" }}>
              <div style={{ fontWeight: 900, fontSize: "15px", color: "#dc2626", marginBottom: "12px" }}>
                🚫 全体非表示リスト（{globallyBlocked.length}件）
              </div>
              {blockError && (
                <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "10px", padding: "10px 14px", marginBottom: "12px", fontSize: "13px", color: "#dc2626", fontWeight: 700 }}>
                  ⚠ {blockError}
                  <div style={{ fontSize: "11px", marginTop: "6px", fontWeight: 400, opacity: 0.8 }}>
                    globally_blocked_places テーブルが未作成の可能性があります。下記SQLをSupabaseで実行してください：<br/>
                    <code style={{ display: "block", marginTop: "4px", background: "#fff", padding: "6px 8px", borderRadius: "6px", whiteSpace: "pre-wrap" }}>
{`create table globally_blocked_places (
  id uuid primary key default gen_random_uuid(),
  spot_name text not null unique,
  spot_address text,
  reason text,
  blocked_at timestamptz default now()
);`}
                    </code>
                  </div>
                </div>
              )}
              {globallyBlocked.length === 0 ? (
                <div style={{ fontSize: "13px", color: "#9ca3af", padding: "8px 0" }}>非表示中のスポットはありません</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {globallyBlocked.map(name => (
                    <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", border: "1px solid #fecaca", borderRadius: "10px", padding: "10px 14px", gap: "12px" }}>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "#7f1d1d", flex: 1 }}>{name}</span>
                      <button
                        onClick={() => handleGlobalUnblock(name)}
                        style={{ fontSize: "12px", padding: "5px 14px", borderRadius: "999px", border: "1px solid #d1d5db", background: "#fff", color: "#6b7280", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}
                      >
                        解除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* フィルター */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px" }}>
              {([
                { key: "all",         label: "すべて" },
                { key: "irrelevant",  label: "関連度が低い" },
                { key: "dislike",     label: "好きではない" },
                { key: "misinfoinfo", label: "誤情報" },
                { key: "restricted",  label: "規制対象" },
                { key: "other",       label: "その他" },
              ] as const).map((f) => {
                const cnt = f.key === "all" ? reports.length : reports.filter((r) => r.reason === f.key).length;
                return (
                  <button
                    key={f.key}
                    onClick={() => setReportFilter(f.key)}
                    style={{
                      ...btnBase,
                      padding: "7px 16px",
                      fontSize: "13px",
                      background: reportFilter === f.key ? "linear-gradient(135deg, #ff8fa5, #ffb347)" : "#fff",
                      color: reportFilter === f.key ? "#fff" : "#4a3034",
                      boxShadow: reportFilter === f.key ? "0 4px 12px rgba(255,143,127,0.3)" : "0 1px 4px rgba(74,48,52,0.08)",
                    }}
                  >
                    {f.label} <span style={{ opacity: 0.75, marginLeft: "4px" }}>{cnt}</span>
                  </button>
                );
              })}
            </div>

            {reportsLoading ? (
              <div style={{ textAlign: "center", padding: "40px", opacity: 0.6 }}>読み込み中...</div>
            ) : reportsError ? (
              <div style={{ padding: "20px", color: "#c0385a", background: "#fff0f3", borderRadius: "16px" }}>
                ⚠ {reportsError}
                <div style={{ marginTop: "8px", fontSize: "12px", opacity: 0.7 }}>
                  Supabaseに <code>reports</code> テーブルが未作成の可能性があります。下記のSQLで作成してください。
                </div>
                <pre style={{ marginTop: "10px", fontSize: "11px", background: "#fafafa", padding: "12px", borderRadius: "10px", overflowX: "auto", border: "1px solid #f0e0e4" }}>
{`create table reports (
  id uuid primary key default gen_random_uuid(),
  spot_name text not null,
  spot_address text,
  reason text not null,
  note text,
  created_at timestamptz default now()
);`}
                </pre>
              </div>
            ) : (() => {
              const REASON_LABELS: Record<string, string> = {
                irrelevant:  "不適切な検索・関連度が低い",
                dislike:     "好きではない",
                misinfoinfo: "誤情報",
                restricted:  "規制対象の場",
                other:       "その他",
              };
              const REASON_COLORS: Record<string, string> = {
                irrelevant:  "#ffeeba",
                dislike:     "#d4edda",
                misinfoinfo: "#f8d7da",
                restricted:  "#d1ecf1",
                other:       "#e2e3e5",
              };
              const filtered = reportFilter === "all" ? reports : reports.filter((r) => r.reason === reportFilter);
              if (filtered.length === 0) {
                return (
                  <div style={{ textAlign: "center", padding: "48px 0", opacity: 0.5, fontSize: "15px" }}>
                    報告はまだありません
                  </div>
                );
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {filtered.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        background: "#fff",
                        borderRadius: "16px",
                        padding: "16px 18px",
                        boxShadow: "0 2px 10px rgba(74,48,52,0.07)",
                        border: "1px solid #f0e8ea",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
                        <div style={{ fontWeight: 900, fontSize: "16px", color: "#4a3034" }}>{r.spot_name}</div>
                        <span style={{
                          flexShrink: 0,
                          padding: "4px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 800,
                          background: REASON_COLORS[r.reason] ?? "#e2e3e5",
                          color: "#4a3034",
                        }}>
                          {REASON_LABELS[r.reason] ?? r.reason}
                        </span>
                      </div>
                      {r.spot_address && (
                        <div style={{ fontSize: "12px", color: "#9a8088", marginBottom: "6px" }}>{r.spot_address}</div>
                      )}
                      {r.note && (
                        <div style={{
                          fontSize: "13px", color: "#5a4048",
                          background: "#fdf8f9", borderRadius: "10px",
                          padding: "8px 12px", marginBottom: "8px",
                          border: "1px solid #f0e8ea",
                        }}>
                          💬 {r.note}
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "10px" }}>
                        <div style={{ fontSize: "11px", color: "#b0a0a5" }}>
                          {new Date(r.created_at).toLocaleString("ja-JP")}
                        </div>
                        {globallyBlocked.includes(r.spot_name) ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "12px", background: "#fee2e2", color: "#dc2626", borderRadius: "999px", padding: "4px 12px", fontWeight: 800 }}>🚫 全体非表示中</span>
                            <button
                              onClick={() => handleGlobalUnblock(r.spot_name)}
                              style={{ fontSize: "12px", padding: "4px 12px", borderRadius: "999px", border: "1px solid #d1d5db", background: "#fff", color: "#6b7280", cursor: "pointer", fontWeight: 700 }}
                            >解除</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleGlobalBlock(r)}
                            disabled={blockingReport === r.id}
                            style={{
                              fontSize: "13px", padding: "7px 16px", borderRadius: "999px", border: "none",
                              background: blockingReport === r.id ? "#e5e7eb" : "linear-gradient(135deg, #dc2626, #b91c1c)",
                              color: blockingReport === r.id ? "#9ca3af" : "#fff",
                              fontWeight: 900, cursor: blockingReport === r.id ? "not-allowed" : "pointer",
                            }}
                          >
                            {blockingReport === r.id ? "処理中..." : "🚫 全ユーザーに非表示"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* ===== 特集ページタブ ===== */}
        {tab === "featured" && (
          <div>
            {/* フォームエリア */}
            <div style={{ ...card, marginBottom: "24px" }}>
              <div style={{ ...titleStyle, marginBottom: "20px" }}>
                {editingFeaturedId ? "✏️ 特集ページを編集" : "⭐ 特集ページを新規作成"}
              </div>
              {featuredError && <div style={{ color: "#c0385a", marginBottom: "12px", fontSize: "13px" }}>⚠ {featuredError}</div>}
              {featuredSuccess && <div style={{ color: "#18794e", marginBottom: "12px", fontSize: "13px", fontWeight: 800 }}>{featuredSuccess}</div>}

              {/* 基本情報 */}
              <div style={{ display: "grid", gap: "14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>スラッグ（URL） <span style={{ color: "#c0385a" }}>*</span></label>
                    <input
                      value={featuredForm.slug}
                      onChange={(e) => setFeaturedForm(f => ({ ...f, slug: e.target.value.replace(/[^a-z0-9-]/g, "") }))}
                      placeholder="tokyo-cafe"
                      disabled={!!editingFeaturedId}
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box", background: editingFeaturedId ? "#f5f5f5" : undefined }}
                    />
                    <div style={{ fontSize: "11px", color: "#999", marginTop: "3px" }}>/feature/{featuredForm.slug || "スラッグ"}</div>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>提携企業・パートナー名</label>
                    <input
                      value={featuredForm.partner_name}
                      onChange={(e) => setFeaturedForm(f => ({ ...f, partner_name: e.target.value }))}
                      placeholder="株式会社〇〇"
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>スポット名 <span style={{ color: "#c0385a" }}>*</span></label>
                  <input
                    value={featuredForm.spot_name}
                    onChange={(e) => setFeaturedForm(f => ({ ...f, spot_name: e.target.value }))}
                    placeholder="〇〇カフェ"
                    style={{ ...inputBase, width: "100%", boxSizing: "border-box" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>キャッチコピー</label>
                  <input
                    value={featuredForm.catch_copy}
                    onChange={(e) => setFeaturedForm(f => ({ ...f, catch_copy: e.target.value }))}
                    placeholder="都会の中の隠れ家カフェ"
                    style={{ ...inputBase, width: "100%", boxSizing: "border-box" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>説明文</label>
                  <textarea
                    value={featuredForm.description}
                    onChange={(e) => setFeaturedForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="スポットの詳しい説明を入力..."
                    rows={5}
                    style={{ ...inputBase, width: "100%", boxSizing: "border-box", resize: "vertical" }}
                  />
                </div>

                {/* アクセス・基本情報 */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>住所</label>
                    <input
                      value={featuredForm.address}
                      onChange={(e) => setFeaturedForm(f => ({ ...f, address: e.target.value }))}
                      placeholder="東京都渋谷区..."
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>アクセス</label>
                    <input
                      value={featuredForm.access}
                      onChange={(e) => setFeaturedForm(f => ({ ...f, access: e.target.value }))}
                      placeholder="渋谷駅から徒歩5分"
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>電話番号</label>
                    <input
                      value={featuredForm.phone}
                      onChange={(e) => setFeaturedForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="03-XXXX-XXXX"
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>営業時間</label>
                    <input
                      value={featuredForm.business_hours}
                      onChange={(e) => setFeaturedForm(f => ({ ...f, business_hours: e.target.value }))}
                      placeholder="10:00〜22:00 (月曜定休)"
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>ウェブサイト</label>
                    <input
                      value={featuredForm.website}
                      onChange={(e) => setFeaturedForm(f => ({ ...f, website: e.target.value }))}
                      placeholder="https://example.com"
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>Instagram</label>
                    <input
                      value={featuredForm.instagram}
                      onChange={(e) => setFeaturedForm(f => ({ ...f, instagram: e.target.value }))}
                      placeholder="@example_cafe"
                      style={{ ...inputBase, width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                </div>

                {/* カバー画像 */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>カバー画像URL</label>
                  <input
                    value={featuredForm.cover_image_url}
                    onChange={(e) => setFeaturedForm(f => ({ ...f, cover_image_url: e.target.value }))}
                    placeholder="https://..."
                    style={{ ...inputBase, width: "100%", boxSizing: "border-box" }}
                  />
                  {featuredForm.cover_image_url && (
                    <img src={featuredForm.cover_image_url} alt="カバー" style={{ marginTop: "8px", height: "120px", objectFit: "cover", borderRadius: "8px", width: "100%" }} />
                  )}
                </div>

                {/* ギャラリー */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>ギャラリー画像URL（複数追加可）</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      value={featuredGalleryInput}
                      onChange={(e) => setFeaturedGalleryInput(e.target.value)}
                      placeholder="https://..."
                      style={{ ...inputBase, flex: 1 }}
                    />
                    <button
                      onClick={() => {
                        if (!featuredGalleryInput.trim()) return;
                        setFeaturedForm(f => ({ ...f, gallery_image_urls: [...f.gallery_image_urls, featuredGalleryInput.trim()] }));
                        setFeaturedGalleryInput("");
                      }}
                      style={{ ...btnBase, padding: "8px 16px", background: "#4a3034", color: "#fff", fontSize: "13px" }}
                    >追加</button>
                  </div>
                  {featuredForm.gallery_image_urls.length > 0 && (
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                      {featuredForm.gallery_image_urls.map((url, i) => (
                        <div key={i} style={{ position: "relative" }}>
                          <img src={url} alt="" style={{ width: "64px", height: "64px", objectFit: "cover", borderRadius: "8px" }} />
                          <button
                            onClick={() => setFeaturedForm(f => ({ ...f, gallery_image_urls: f.gallery_image_urls.filter((_, idx) => idx !== i) }))}
                            style={{ position: "absolute", top: "-6px", right: "-6px", background: "#c0385a", border: "none", color: "#fff", borderRadius: "50%", width: "18px", height: "18px", fontSize: "10px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 特徴 */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>特徴・こだわり</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      value={featuredFeatureInput}
                      onChange={(e) => setFeaturedFeatureInput(e.target.value)}
                      placeholder="例: 全席禁煙・ペット可"
                      style={{ ...inputBase, flex: 1 }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && featuredFeatureInput.trim()) {
                          setFeaturedForm(f => ({ ...f, features: [...f.features, featuredFeatureInput.trim()] }));
                          setFeaturedFeatureInput("");
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (!featuredFeatureInput.trim()) return;
                        setFeaturedForm(f => ({ ...f, features: [...f.features, featuredFeatureInput.trim()] }));
                        setFeaturedFeatureInput("");
                      }}
                      style={{ ...btnBase, padding: "8px 16px", background: "#4a3034", color: "#fff", fontSize: "13px" }}
                    >追加</button>
                  </div>
                  {featuredForm.features.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                      {featuredForm.features.map((f, i) => (
                        <span key={i} style={{ background: "#fff3e0", color: "#e65100", fontSize: "12px", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", display: "flex", alignItems: "center", gap: "6px" }}>
                          {f}
                          <button onClick={() => setFeaturedForm(ff => ({ ...ff, features: ff.features.filter((_, idx) => idx !== i) }))} style={{ background: "none", border: "none", cursor: "pointer", color: "#e65100", padding: 0, fontSize: "12px" }}>✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 混雑状況 */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>混雑状況</label>
                  <textarea
                    value={featuredForm.congestion_info}
                    onChange={(e) => setFeaturedForm(f => ({ ...f, congestion_info: e.target.value }))}
                    placeholder={"平日昼: 空いている\n土日: 混雑しやすい\nピーク: 12〜14時"}
                    rows={3}
                    style={{ ...inputBase, width: "100%", boxSizing: "border-box", resize: "vertical" }}
                  />
                </div>

                {/* おすすめ商品 */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "8px" }}>おすすめ商品・メニュー</label>
                  <div style={{ background: "#fafafa", borderRadius: "12px", padding: "14px", display: "grid", gap: "10px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      <input value={featuredItemForm.name} onChange={(e) => setFeaturedItemForm(f => ({ ...f, name: e.target.value }))} placeholder="商品名 *" style={{ ...inputBase }} />
                      <input value={featuredItemForm.price} onChange={(e) => setFeaturedItemForm(f => ({ ...f, price: e.target.value }))} placeholder="価格（例: ¥980）" style={{ ...inputBase }} />
                    </div>
                    <input value={featuredItemForm.description} onChange={(e) => setFeaturedItemForm(f => ({ ...f, description: e.target.value }))} placeholder="説明" style={{ ...inputBase, width: "100%", boxSizing: "border-box" }} />
                    <input value={featuredItemForm.image_url} onChange={(e) => setFeaturedItemForm(f => ({ ...f, image_url: e.target.value }))} placeholder="画像URL（任意）" style={{ ...inputBase, width: "100%", boxSizing: "border-box" }} />
                    <button
                      onClick={() => {
                        if (!featuredItemForm.name.trim()) return;
                        setFeaturedForm(f => ({ ...f, recommended_items: [...f.recommended_items, { ...featuredItemForm }] }));
                        setFeaturedItemForm({ name: "", description: "", price: "", image_url: "" });
                      }}
                      style={{ ...btnBase, padding: "8px 16px", background: "#ff8f7f", color: "#fff", fontSize: "13px" }}
                    >+ 商品を追加</button>
                  </div>
                  {featuredForm.recommended_items.length > 0 && (
                    <div style={{ display: "grid", gap: "8px", marginTop: "8px" }}>
                      {featuredForm.recommended_items.map((item, i) => (
                        <div key={i} style={{ background: "#fff", borderRadius: "10px", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", fontSize: "13px" }}>
                          <div>
                            <span style={{ fontWeight: 800 }}>{item.name}</span>
                            {item.price && <span style={{ color: "#ff8f7f", marginLeft: "8px" }}>{item.price}</span>}
                            {item.description && <div style={{ color: "#888", marginTop: "2px" }}>{item.description}</div>}
                          </div>
                          <button onClick={() => setFeaturedForm(f => ({ ...f, recommended_items: f.recommended_items.filter((_, idx) => idx !== i) }))} style={{ background: "none", border: "none", color: "#c0385a", cursor: "pointer", fontSize: "14px" }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* タグ */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>タグ</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      value={featuredTagInput}
                      onChange={(e) => setFeaturedTagInput(e.target.value)}
                      placeholder="例: カフェ・ペット可"
                      style={{ ...inputBase, flex: 1 }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && featuredTagInput.trim()) {
                          setFeaturedForm(f => ({ ...f, tags: [...f.tags, featuredTagInput.trim()] }));
                          setFeaturedTagInput("");
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (!featuredTagInput.trim()) return;
                        setFeaturedForm(f => ({ ...f, tags: [...f.tags, featuredTagInput.trim()] }));
                        setFeaturedTagInput("");
                      }}
                      style={{ ...btnBase, padding: "8px 16px", background: "#4a3034", color: "#fff", fontSize: "13px" }}
                    >追加</button>
                  </div>
                  {featuredForm.tags.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                      {featuredForm.tags.map((tag, i) => (
                        <span key={i} style={{ background: "#e8f4f8", color: "#1a6a8a", fontSize: "12px", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", display: "flex", alignItems: "center", gap: "6px" }}>
                          {tag}
                          <button onClick={() => setFeaturedForm(f => ({ ...f, tags: f.tags.filter((_, idx) => idx !== i) }))} style={{ background: "none", border: "none", cursor: "pointer", color: "#1a6a8a", padding: 0, fontSize: "12px" }}>✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 契約期間 */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>契約開始日</label>
                    <input type="date" value={featuredForm.contract_start} onChange={(e) => setFeaturedForm(f => ({ ...f, contract_start: e.target.value }))} style={{ ...inputBase, width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#4a3034", marginBottom: "4px" }}>契約終了日</label>
                    <input type="date" value={featuredForm.contract_end} onChange={(e) => setFeaturedForm(f => ({ ...f, contract_end: e.target.value }))} style={{ ...inputBase, width: "100%", boxSizing: "border-box" }} />
                  </div>
                </div>

                {/* 公開設定 */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#f9f9f9", padding: "14px 16px", borderRadius: "12px" }}>
                  <input
                    type="checkbox"
                    id="featured-published"
                    checked={featuredForm.is_published}
                    onChange={(e) => setFeaturedForm(f => ({ ...f, is_published: e.target.checked }))}
                    style={{ width: "18px", height: "18px", cursor: "pointer" }}
                  />
                  <label htmlFor="featured-published" style={{ fontSize: "14px", fontWeight: 800, color: "#4a3034", cursor: "pointer" }}>
                    🌐 公開する（チェックするとユーザーに表示されます）
                  </label>
                </div>

                {/* 送信ボタン */}
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    onClick={handleFeaturedSubmit}
                    disabled={featuredSubmitting}
                    style={{ ...btnBase, flex: 1, padding: "14px", background: "linear-gradient(135deg, #ffbf67, #ff8f7f)", color: "#fff", fontWeight: 900, fontSize: "15px" }}
                  >
                    {featuredSubmitting ? "保存中..." : editingFeaturedId ? "✅ 更新する" : "⭐ 特集ページを作成"}
                  </button>
                  {editingFeaturedId && (
                    <button
                      onClick={() => { setFeaturedForm(emptyFeaturedForm); setEditingFeaturedId(null); setFeaturedError(""); }}
                      style={{ ...btnBase, padding: "14px 20px", background: "#eee", color: "#4a3034", fontSize: "14px" }}
                    >キャンセル</button>
                  )}
                </div>
              </div>
            </div>

            {/* 特集ページ一覧 */}
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div style={titleStyle}>📋 特集ページ一覧</div>
                <button onClick={loadFeaturedPages} style={{ ...btnBase, padding: "8px 16px", background: "#f0f0f0", color: "#4a3034", fontSize: "13px" }}>
                  🔄 更新
                </button>
              </div>

              {featuredLoading ? (
                <div style={{ textAlign: "center", padding: "30px", opacity: 0.6 }}>読み込み中...</div>
              ) : featuredPages.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px", opacity: 0.5, fontSize: "14px" }}>
                  まだ特集ページがありません。上のフォームから作成してください。
                </div>
              ) : (
                <div style={{ display: "grid", gap: "14px" }}>
                  {featuredPages.map((p) => (
                    <div key={p.id} style={{ background: "#fafafa", borderRadius: "14px", padding: "16px 20px", display: "flex", gap: "16px", alignItems: "flex-start" }}>
                      {p.cover_image_url && (
                        <img src={p.cover_image_url} alt="" style={{ width: "80px", height: "80px", objectFit: "cover", borderRadius: "10px", flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 900, fontSize: "16px", color: "#4a3034" }}>{p.spot_name}</span>
                          <span style={{
                            background: p.is_published ? "#e6f7ee" : "#f5f5f5",
                            color: p.is_published ? "#18794e" : "#999",
                            fontSize: "11px", fontWeight: 800, padding: "3px 8px", borderRadius: "999px"
                          }}>
                            {p.is_published ? "🌐 公開中" : "🔒 非公開"}
                          </span>
                        </div>
                        <div style={{ fontSize: "12px", color: "#888", marginBottom: "6px" }}>
                          <span>📁 /feature/{p.slug}</span>
                          {p.partner_name && <span style={{ marginLeft: "10px" }}>🤝 {p.partner_name}</span>}
                          {p.contract_end && <span style={{ marginLeft: "10px" }}>📅 〜{p.contract_end}</span>}
                        </div>
                        {p.catch_copy && <div style={{ fontSize: "13px", color: "#666", marginBottom: "8px" }}>{p.catch_copy}</div>}
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <a
                            href={`/feature/${p.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ ...btnBase, padding: "6px 14px", background: "#fff3e0", color: "#e65100", fontSize: "12px", fontWeight: 700, textDecoration: "none" }}
                          >👁 プレビュー</a>
                          <button
                            onClick={() => startEditFeatured(p)}
                            style={{ ...btnBase, padding: "6px 14px", background: "#e8f0fe", color: "#1a73e8", fontSize: "12px", fontWeight: 700 }}
                          >✏️ 編集</button>
                          <button
                            onClick={() => handleFeaturedDelete(p.id)}
                            disabled={deletingFeaturedId === p.id}
                            style={{ ...btnBase, padding: "6px 14px", background: "#fce8e6", color: "#c0385a", fontSize: "12px", fontWeight: 700 }}
                          >{deletingFeaturedId === p.id ? "削除中..." : "🗑 削除"}</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== 開発ログタブ ===== */}
        {tab === "devlog" && (() => {
          const doneCount = DEVLOG_REQUESTS.filter((r) => devChecked[r.id]).length;
          return (
            <div>
              {/* ヘッダー */}
              <div style={{ marginBottom: "28px" }}>
                <div style={{ fontSize: "22px", fontWeight: 900, marginBottom: "4px" }}>📋 開発ログ</div>
                <div style={{ fontSize: "13px", opacity: 0.6, marginBottom: "12px" }}>Claudeへのリクエスト履歴と、これからやること</div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <span style={{ background: "#e8fff0", border: "1.5px solid #7ed8a0", borderRadius: "999px", padding: "4px 14px", fontSize: "12px", fontWeight: 900, color: "#1a7a4a" }}>
                    ✅ 完了 {doneCount} / {DEVLOG_REQUESTS.length}
                  </span>
                  <span style={{ background: "#fff8ee", border: "1.5px solid #ffe0a0", borderRadius: "999px", padding: "4px 14px", fontSize: "12px", fontWeight: 900, color: "#b36000" }}>
                    📌 ToDo {devTodos.filter((t) => !t.done).length}件
                  </span>
                </div>
              </div>

              {/* ===== ToDo（上） ===== */}
              <div style={{ marginBottom: "36px" }}>
                <div style={{ fontSize: "11px", fontWeight: 900, letterSpacing: "0.1em", opacity: 0.4, textTransform: "uppercase", marginBottom: "12px" }}>
                  ToDo — 自由に追加・編集できます
                </div>
                <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                  <input
                    type="text"
                    value={newTodoText}
                    onChange={(e) => setNewTodoText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addTodo(); }}
                    placeholder="新しいToDoを入力して Enter"
                    style={{ flex: 1, height: "44px", borderRadius: "12px", border: "1.5px solid #f0dfe3", padding: "0 14px", fontSize: "14px", outline: "none", background: "#fff", color: "#3a2a30", fontFamily: font }}
                  />
                  <button onClick={addTodo} style={{ ...btnBase, padding: "0 18px", height: "44px", background: "linear-gradient(135deg, #ffbf67 0%, #ff8f7f 100%)", color: "#fff", fontSize: "14px", fontWeight: 900 }}>
                    ＋ 追加
                  </button>
                </div>
                {devTodos.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "24px 0", opacity: 0.4, fontSize: "13px", border: "1.5px dashed #e0d0d8", borderRadius: "14px" }}>
                    ToDoはまだありません。上から追加してください。
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: "8px" }}>
                    {devTodos.map((t) => (
                      <div key={t.id} style={{ background: t.done ? "#f8f8f8" : "#fff", border: t.done ? "1.5px solid #e0e0e0" : "1.5px solid #f0dfe3", borderRadius: "14px", padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: "10px" }}>
                        <button onClick={() => toggleTodo(t.id)} style={{ flexShrink: 0, width: "22px", height: "22px", borderRadius: "6px", border: t.done ? "2px solid #1a7a4a" : "2px solid #d0bfc8", background: t.done ? "#1a7a4a" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginTop: "2px" }}>
                          {t.done && <span style={{ color: "#fff", fontSize: "12px", fontWeight: 900 }}>✓</span>}
                        </button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {editingTodoId === t.id ? (
                            <div style={{ display: "flex", gap: "6px" }}>
                              <input type="text" value={editingTodoText} onChange={(e) => setEditingTodoText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEditTodo(t.id); if (e.key === "Escape") setEditingTodoId(null); }} autoFocus style={{ flex: 1, height: "34px", borderRadius: "8px", border: "1.5px solid #f0dfe3", padding: "0 10px", fontSize: "13px", outline: "none", fontFamily: font, color: "#3a2a30" }} />
                              <button onClick={() => saveEditTodo(t.id)} style={{ ...btnBase, padding: "0 12px", height: "34px", fontSize: "12px", background: "#e8fff0", color: "#1a7a4a", border: "1.5px solid #a8e8c0" }}>保存</button>
                              <button onClick={() => setEditingTodoId(null)} style={{ ...btnBase, padding: "0 12px", height: "34px", fontSize: "12px" }}>×</button>
                            </div>
                          ) : (
                            <span style={{ fontSize: "14px", fontWeight: 700, color: t.done ? "#aaa" : "#3a2a30", textDecoration: t.done ? "line-through" : "none", lineHeight: 1.6, display: "block" }}>{t.text}</span>
                          )}
                        </div>
                        {editingTodoId !== t.id && (
                          <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                            <button onClick={() => startEditTodo(t)} style={{ ...btnBase, padding: "4px 10px", fontSize: "11px", background: "#f5f0ff", color: "#7c4dff", border: "1px solid #ddd0ff" }}>編集</button>
                            <button onClick={() => deleteTodo(t.id)} style={{ ...btnBase, padding: "4px 10px", fontSize: "11px", background: "#fce4e4", color: "#c0385a", border: "1px solid #f5c0c8" }}>削除</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {devTodos.some((t) => t.done) && (
                  <button onClick={() => saveDevTodos(devTodos.filter((t) => !t.done))} style={{ ...btnBase, marginTop: "10px", padding: "6px 14px", fontSize: "12px", background: "#fce4e4", color: "#c0385a", border: "1px solid #f5c0c8" }}>
                    完了済みをまとめて削除
                  </button>
                )}
              </div>

              {/* ===== リクエスト履歴チェックリスト（下） ===== */}
              <div>
                <div style={{ fontSize: "11px", fontWeight: 900, letterSpacing: "0.1em", opacity: 0.4, textTransform: "uppercase", marginBottom: "12px" }}>
                  リクエスト履歴（時系列 · タップで完了切替）
                </div>
                <div style={{ display: "grid", gap: "8px" }}>
                  {DEVLOG_REQUESTS.map((r, idx) => {
                    const checked = !!devChecked[r.id];
                    return (
                      <div key={r.id} style={{ background: checked ? "#f4fff7" : "#fff", border: checked ? "1.5px solid #a8e8c0" : "1.5px solid #f0dfe3", borderRadius: "14px", padding: "12px 14px", transition: "all 0.15s" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                          <button
                            onClick={() => saveDevChecked({ ...devChecked, [r.id]: !checked })}
                            style={{ flexShrink: 0, width: "28px", height: "28px", borderRadius: "50%", border: checked ? "2px solid #1a7a4a" : "2px solid #d0bfc8", background: checked ? "#1a7a4a" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 900, color: checked ? "#fff" : "#b0a0a8", marginTop: "1px" }}
                          >
                            {checked ? "✓" : idx + 1}
                          </button>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "5px", flexWrap: "wrap" }}>
                              <span style={{ fontSize: "11px", background: "#fff3e6", border: "1px solid #ffe0b0", borderRadius: "999px", padding: "1px 8px", fontWeight: 900, color: "#b36000" }}>{r.date}</span>
                              {checked && <span style={{ fontSize: "11px", color: "#1a7a4a", fontWeight: 900 }}>✅ 完了</span>}
                            </div>
                            <div style={{ fontWeight: 700, fontSize: "13px", lineHeight: 1.65, color: checked ? "#7a9a7a" : "#3a2a30", textDecoration: checked ? "line-through" : "none" }}>
                              {r.summary}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── 重複統合タブ ───────────────────────────────────────── */}
        {tab === "merge" && (
          <div style={{ padding: "24px 0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 900 }}>🔀 同名スポット重複統合</h2>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#888" }}>
                  {mergeLoading ? "読み込み中..." : `${mergeGroups.length} グループの重複を検出`}
                </p>
              </div>
              <button
                onClick={() => {
                  setMergeLoading(true);
                  setMergeResult("");
                  fetch("/api/admin/merge-duplicates")
                    .then(r => r.json())
                    .then(d => { if (d.ok) setMergeGroups(d.groups ?? []); })
                    .finally(() => setMergeLoading(false));
                }}
                style={{ padding: "8px 16px", borderRadius: "10px", border: "1.5px solid #ddd", background: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "13px" }}
              >
                🔄 再読み込み
              </button>
            </div>

            {mergeResult && (
              <div style={{ marginBottom: "16px", padding: "12px 16px", background: "#f0fff4", border: "1px solid #68d391", borderRadius: "12px", fontWeight: 700, color: "#276749" }}>
                ✅ {mergeResult}
              </div>
            )}

            {mergeLoading ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>読み込み中...</div>
            ) : mergeGroups.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#68d391", fontWeight: 700, fontSize: "16px" }}>
                ✅ 重複スポットはありません！
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {mergeGroups.map((group, gi) => {
                  const keepId = mergeKeep[gi] ?? group[0].id;
                  const keeper = group.find(p => p.id === keepId) ?? group[0];
                  const others = group.filter(p => p.id !== keepId);
                  // マージ後のタグ（全レコードのタグを重複排除して結合）
                  const mergedTags = [...new Set(group.flatMap(p => p.tags ?? []))];
                  const isProcessing = mergeProcessing === gi;

                  return (
                    <div key={gi} style={{ background: "#fff", border: "1.5px solid #f0dfe3", borderRadius: "18px", padding: "20px", boxShadow: "0 2px 8px rgba(74,48,52,0.06)" }}>
                      {/* ヘッダー */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
                        <div style={{ fontSize: "16px", fontWeight: 900, color: "#4a3034" }}>
                          「{group[0].name}」— {group.length} 件の重複
                        </div>
                        <button
                          onClick={async () => {
                            const deleteIds = others.map(p => p.id);
                            if (!confirm(`「${keeper.name}」を残し、他 ${deleteIds.length} 件を統合・削除します。よろしいですか？`)) return;
                            setMergeProcessing(gi);
                            const res = await fetch("/api/admin/merge-duplicates", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ keepId, deleteIds, mergedTags }),
                            });
                            const d = await res.json();
                            if (d.ok) {
                              setMergeGroups(prev => prev.filter((_, i) => i !== gi));
                              setMergeResult(`「${keeper.name}」を統合しました（${d.deleted} 件削除）`);
                            } else {
                              alert("統合失敗: " + (d.error ?? "不明"));
                            }
                            setMergeProcessing(null);
                          }}
                          disabled={isProcessing}
                          style={{
                            padding: "8px 18px", borderRadius: "12px", border: "none",
                            background: isProcessing ? "#ccc" : "linear-gradient(135deg, #ffbf67, #ff8f7f)",
                            color: "#fff", fontWeight: 900, fontSize: "13px",
                            cursor: isProcessing ? "default" : "pointer",
                          }}
                        >
                          {isProcessing ? "統合中..." : "🔀 統合する"}
                        </button>
                      </div>

                      {/* マージ後タグプレビュー */}
                      <div style={{ marginBottom: "14px", padding: "10px 14px", background: "#fffaf8", borderRadius: "10px", border: "1px solid #f0dfe3" }}>
                        <div style={{ fontSize: "11px", fontWeight: 800, color: "#b07080", marginBottom: "6px" }}>統合後のタグ（全件から重複排除）</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                          {mergedTags.map(tag => (
                            <span key={tag} style={{ padding: "3px 10px", borderRadius: "999px", background: "linear-gradient(135deg, #ffe0e8, #ffd0c8)", fontSize: "11px", fontWeight: 800, color: "#7a3040" }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* 各レコード */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {group.map(place => {
                          const isKeeper = place.id === keepId;
                          return (
                            <div
                              key={place.id}
                              onClick={() => setMergeKeep(prev => ({ ...prev, [gi]: place.id }))}
                              style={{
                                padding: "12px 14px", borderRadius: "12px", cursor: "pointer",
                                border: isKeeper ? "2px solid #ff8fa5" : "1.5px solid #ead7db",
                                background: isKeeper ? "linear-gradient(135deg, #fff0f3, #ffe8ec)" : "#fafafa",
                                transition: "all 0.15s",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ fontSize: "12px", fontWeight: 900, padding: "2px 8px", borderRadius: "6px", background: isKeeper ? "#ff8fa5" : "#ddd", color: isKeeper ? "#fff" : "#888" }}>
                                    {isKeeper ? "✓ 残す" : "削除"}
                                  </span>
                                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#4a3034" }}>{place.address}</span>
                                </div>
                                <span style={{ fontSize: "11px", color: place.lat ? "#68d391" : "#fc8181", fontWeight: 700 }}>
                                  {place.lat ? `📍 ${place.lat.toFixed(4)}, ${place.lng?.toFixed(4)}` : "📍 座標なし"}
                                </span>
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                {(place.tags ?? []).map(tag => (
                                  <span key={tag} style={{ padding: "2px 8px", borderRadius: "999px", background: "#f0e8ec", fontSize: "11px", color: "#7a3040", fontWeight: 700 }}>
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── 座標登録タブ ───────────────────────────────────────── */}
        {tab === "geocode" && (
          <div style={{ padding: "24px 0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 900 }}>📍 座標未登録スポット</h2>
                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#888" }}>
                  {geoLoading ? "読み込み中..." : `${geoPlaces.length} 件の座標未登録スポット`}
                </p>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={() => {
                    setGeoLoading(true);
                    fetch("/api/admin/geocode-missing")
                      .then(r => r.json())
                      .then(d => { if (d.ok) setGeoPlaces(d.data ?? []); })
                      .finally(() => setGeoLoading(false));
                  }}
                  style={{ padding: "8px 16px", borderRadius: "10px", border: "1.5px solid #ddd", background: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "13px" }}
                >
                  🔄 再読み込み
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`${geoPlaces.length} 件すべてをGoogleジオコードで一括登録しますか？`)) return;
                    setGeoBulkRunning(true);
                    setGeoBulkResult("");
                    const res = await fetch("/api/admin/geocode-missing", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ bulkAll: true }),
                    });
                    const d = await res.json();
                    setGeoBulkResult(`完了: ${d.succeeded ?? 0} / ${d.total ?? 0} 件成功`);
                    // リスト再取得
                    fetch("/api/admin/geocode-missing")
                      .then(r => r.json())
                      .then(d2 => { if (d2.ok) setGeoPlaces(d2.data ?? []); });
                    setGeoBulkRunning(false);
                  }}
                  disabled={geoBulkRunning || geoPlaces.length === 0}
                  style={{
                    padding: "8px 16px", borderRadius: "10px", border: "none",
                    background: geoBulkRunning || geoPlaces.length === 0 ? "#ccc" : "linear-gradient(135deg, #ffbf67, #ff8f7f)",
                    color: "#fff", fontWeight: 900, cursor: geoBulkRunning || geoPlaces.length === 0 ? "default" : "pointer", fontSize: "13px",
                  }}
                >
                  {geoBulkRunning ? "処理中..." : "⚡ 一括自動ジオコード"}
                </button>
              </div>
            </div>

            {geoBulkResult && (
              <div style={{ marginBottom: "16px", padding: "12px 16px", background: "#f0fff4", border: "1px solid #68d391", borderRadius: "12px", fontWeight: 700, color: "#276749" }}>
                ✅ {geoBulkResult}
              </div>
            )}

            {geoLoading ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#888" }}>読み込み中...</div>
            ) : geoPlaces.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#68d391", fontWeight: 700, fontSize: "16px" }}>
                ✅ 座標未登録のスポットはありません！
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {geoPlaces.map(place => {
                  const manual = geoManual[place.id] ?? { lat: "", lng: "" };
                  const isUpdating = geoUpdating === place.id;
                  return (
                    <div key={place.id} style={{ background: "#fff", border: "1.5px solid #f0dfe3", borderRadius: "16px", padding: "16px 20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                        <div>
                          <div style={{ fontSize: "15px", fontWeight: 900, color: "#4a3034" }}>{place.name}</div>
                          <div style={{ fontSize: "12px", color: "#888", marginTop: "2px" }}>{place.address}</div>
                        </div>
                        <button
                          onClick={async () => {
                            setGeoUpdating(place.id);
                            const res = await fetch("/api/admin/geocode-missing", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ placeId: place.id, address: place.address }),
                            });
                            const d = await res.json();
                            if (d.ok) {
                              setGeoPlaces(prev => prev.map(p =>
                                p.id === place.id ? { ...p, lat: d.lat, lng: d.lng } : p
                              ));
                            } else {
                              alert("ジオコード失敗: " + (d.error ?? "不明"));
                            }
                            setGeoUpdating(null);
                          }}
                          disabled={isUpdating}
                          style={{
                            padding: "7px 14px", borderRadius: "10px", border: "none",
                            background: isUpdating ? "#ccc" : "linear-gradient(135deg, #63b3ed, #4299e1)",
                            color: "#fff", fontWeight: 800, fontSize: "12px",
                            cursor: isUpdating ? "default" : "pointer", whiteSpace: "nowrap",
                          }}
                        >
                          {isUpdating ? "取得中..." : "🌐 自動取得"}
                        </button>
                      </div>

                      {/* 取得済みの場合は緑表示 */}
                      {place.lat != null && place.lng != null ? (
                        <div style={{ fontSize: "12px", color: "#276749", background: "#f0fff4", borderRadius: "8px", padding: "6px 10px", fontWeight: 700 }}>
                          ✅ lat: {place.lat.toFixed(6)}, lng: {place.lng.toFixed(6)}
                        </div>
                      ) : (
                        /* 手動入力フォーム */
                        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                          <input
                            type="number"
                            step="any"
                            placeholder="緯度 (lat) 例: 35.4437"
                            value={manual.lat}
                            onChange={e => setGeoManual(prev => ({ ...prev, [place.id]: { ...prev[place.id] ?? { lat: "", lng: "" }, lat: e.target.value } }))}
                            style={{ flex: 1, minWidth: "140px", padding: "7px 10px", borderRadius: "8px", border: "1px solid #ddd", fontSize: "13px" }}
                          />
                          <input
                            type="number"
                            step="any"
                            placeholder="経度 (lng) 例: 139.6380"
                            value={manual.lng}
                            onChange={e => setGeoManual(prev => ({ ...prev, [place.id]: { ...prev[place.id] ?? { lat: "", lng: "" }, lng: e.target.value } }))}
                            style={{ flex: 1, minWidth: "140px", padding: "7px 10px", borderRadius: "8px", border: "1px solid #ddd", fontSize: "13px" }}
                          />
                          <button
                            onClick={async () => {
                              const lat = parseFloat(manual.lat);
                              const lng = parseFloat(manual.lng);
                              if (isNaN(lat) || isNaN(lng)) { alert("緯度・経度を正しく入力してください"); return; }
                              setGeoUpdating(place.id);
                              const res = await fetch("/api/admin/geocode-missing", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ placeId: place.id, lat, lng }),
                              });
                              const d = await res.json();
                              if (d.ok) {
                                setGeoPlaces(prev => prev.map(p =>
                                  p.id === place.id ? { ...p, lat, lng } : p
                                ));
                                setGeoManual(prev => { const n = { ...prev }; delete n[place.id]; return n; });
                              } else {
                                alert("保存失敗: " + (d.error ?? "不明"));
                              }
                              setGeoUpdating(null);
                            }}
                            disabled={isUpdating || !manual.lat || !manual.lng}
                            style={{
                              padding: "7px 14px", borderRadius: "10px", border: "none",
                              background: !manual.lat || !manual.lng ? "#ccc" : "linear-gradient(135deg, #68d391, #38a169)",
                              color: "#fff", fontWeight: 800, fontSize: "12px",
                              cursor: !manual.lat || !manual.lng ? "default" : "pointer", whiteSpace: "nowrap",
                            }}
                          >
                            💾 手動保存
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── 一括タグ修正タブ ──────────────────────────────────────────────── */}
        {tab === "retag" && (
          <div style={{ padding: "24px 0" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 800, marginBottom: "8px" }}>🏷 一括タグ修正</h2>
            <p style={{ fontSize: "13px", opacity: 0.65, marginBottom: "20px" }}>
              placesテーブルの全スポットを定義済みタグで一括再タグ付けします。<br />
              気分タグ・深掘りタグを最低1つずつ必ず付け、定義外のタグを除去します。
            </p>

            {retagAllLoading && <p style={{ color: "#999", fontSize: "14px" }}>件数を確認中...</p>}

            {retagAllInfo && !retagAllLoading && (
              <div style={{ background: "#fff8f0", borderRadius: "12px", padding: "16px 20px", marginBottom: "20px", border: "1px solid #ffd8b0" }}>
                <p style={{ fontSize: "15px", fontWeight: 700, marginBottom: "6px" }}>
                  対象スポット数: <span style={{ color: "#e87040" }}>{retagAllInfo.total}</span> 件
                </p>
                <p style={{ fontSize: "13px", color: "#666" }}>
                  タグ修正が必要: <span style={{ color: "#e87040", fontWeight: 700 }}>{retagAllInfo.needsRetag}</span> 件
                  （気分タグ未付与 / 深掘りタグ未付与 / 定義外タグあり）
                </p>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={retagAllOverwrite}
                  onChange={e => setRetagAllOverwrite(e.target.checked)}
                />
                既にタグが正しいスポットも上書きする
              </label>

              <button
                onClick={async () => {
                  if (!confirm(`${retagAllOverwrite ? "全スポット" : "タグ修正が必要なスポット"}を一括再タグ付けします。時間がかかる場合があります。実行しますか？`)) return;
                  setRetagAllRunning(true);
                  setRetagAllResult(null);
                  try {
                    const res = await fetch("/api/admin/retag-all", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ secret: "moodgoadmin123", overwrite: retagAllOverwrite }),
                    });
                    const d = await res.json();
                    if (d.ok) {
                      setRetagAllResult({ updated: d.updated, skipped: d.skipped, failed: d.failed, results: d.results ?? [] });
                    } else {
                      alert("エラー: " + (d.error ?? "不明"));
                    }
                  } catch (e) {
                    alert("通信エラー: " + String(e));
                  } finally {
                    setRetagAllRunning(false);
                  }
                }}
                disabled={retagAllRunning}
                style={{
                  padding: "10px 24px", borderRadius: "12px", border: "none",
                  background: retagAllRunning ? "#ccc" : "linear-gradient(135deg, #a78bfa, #7c3aed)",
                  color: "#fff", fontWeight: 800, fontSize: "14px",
                  cursor: retagAllRunning ? "default" : "pointer",
                }}
              >
                {retagAllRunning ? "処理中... (しばらくお待ちください)" : "🏷 一括タグ修正を実行"}
              </button>
            </div>

            {retagAllResult && (
              <div>
                <div style={{
                  background: "#f0fff4", borderRadius: "12px", padding: "16px 20px",
                  marginBottom: "16px", border: "1px solid #9ae6b4",
                }}>
                  <p style={{ fontWeight: 800, fontSize: "15px", marginBottom: "6px" }}>完了</p>
                  <p style={{ fontSize: "13px" }}>
                    更新: <strong style={{ color: "#2f855a" }}>{retagAllResult.updated}</strong> 件 /
                    スキップ: <strong>{retagAllResult.skipped}</strong> 件 /
                    失敗: <strong style={{ color: "#e53e3e" }}>{retagAllResult.failed}</strong> 件
                  </p>
                </div>

                <div style={{ maxHeight: "400px", overflowY: "auto", border: "1px solid #eee", borderRadius: "12px" }}>
                  {retagAllResult.results.map((r, i) => (
                    <div key={i} style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid #f0f0f0",
                      background: r.action === "updated" ? "#f0fff4" : r.action.startsWith("failed") ? "#fff5f5" : "#fafafa",
                    }}>
                      <p style={{ fontSize: "13px", fontWeight: 700, marginBottom: "4px" }}>
                        {r.action === "updated" ? "✅" : r.action.startsWith("failed") ? "❌" : "⏭"} {r.name}
                      </p>
                      {r.tags.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                          {r.tags.map(tag => (
                            <span key={tag} style={{
                              background: "#e9d8fd", color: "#553c9a", borderRadius: "6px",
                              padding: "2px 8px", fontSize: "11px", fontWeight: 600,
                            }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {r.action.startsWith("failed") && (
                        <p style={{ fontSize: "11px", color: "#e53e3e", marginTop: "2px" }}>{r.action}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
