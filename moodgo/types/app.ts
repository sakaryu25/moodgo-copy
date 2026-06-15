export type RouteByMode = {
  icon: string;
  durationText: string;
  distanceText: string;
};

export type Recommendation = {
  title: string;
  vibe?: string;
  budget?: string;
  time?: string;
  address?: string;
  /** スポットのタグ（#心霊スポット 等。心霊判定に使用） */
  tags?: string[];
  mapUrl?: string;
  rating?: number | null;
  userRatingCount?: number | null;
  photoUrl?: string;
  photoUrls?: string[];
  openingHoursText?: string;
  distanceText?: string;
  durationText?: string;
  openNow?: boolean;
  openStatusBadge?: string;   // #8: 「営業中」「もうすぐ閉店（あとN分）」等の詳細バッジ
  reason?: string;
  /** AI相談フロー専用: なぜこの場所をおすすめするのか（結果画面で表示） */
  aiReason?: string;
  features?: string[];
  isUserSpot?: boolean;
  hasUserPhotos?: boolean;
  userPhotoCount?: number;
  priceLevel?: string;
  stationText?: string;
  routesByMode?: RouteByMode[];
  source?: 'hotpepper' | 'google' | 'admin' | 'user';
  /** 有料掲載（スポンサー枠）。true なら PR/広告ラベルを表示する（景表法/審査対応） */
  isSponsored?: boolean;
  /** Moodログ集計（MoodGo独自の気分ベース口コミ反応。カードのバッジ表示用） */
  moodLog?: { count: number; topMood?: string; topCompanion?: string; revisit?: number; helpful?: number };
  hotpepperUrl?: string;
  /** Supabase places.id（UUID）。report-closed API で使用する閉店報告用 */
  supabaseId?: string;
  /** Google Places API の Place ID。詳細情報取得に使用 */
  placeId?: string;
  /** 電話番号（place-detail API から取得） */
  phone?: string;
  /** 公式サイト URL（place-detail API から取得） */
  website?: string;
  /** 緯度 */
  lat?: number;
  /** 経度 */
  lng?: number;
};

export type FavoriteItem = {
  title: string;
  area: string;
  vibe: string;
  photoUrl?: string;
  mapUrl?: string;
  createdAt?: string;
  /** Google Places ID（詳細ページで追加情報取得に使用） */
  placeId?: string;
  address?: string;
  rating?: number | null;
  openingHoursText?: string;
  openNow?: boolean;
  openStatusBadge?: string;   // #8: 「営業中」「もうすぐ閉店（あとN分）」等の詳細バッジ
  photoUrls?: string[];
  stationText?: string;
  distanceText?: string;
  priceLevel?: string;
  phone?: string;
  website?: string;
  /** スポットのタグ（#心霊スポット 等。詳細での心霊判定に使用） */
  tags?: string[];
  /** Supabase places.id（UUID）。投稿写真の照合に使用 */
  supabaseId?: string;
  /** 'place'=検索結果の場所 / 'post'=みんなの穴場の投稿 */
  kind?: 'place' | 'post';
  /** 投稿(post)の場合の suggestions.id（詳細ページを開くのに使用） */
  spotId?: string;
};

export type FeedbackItem = {
  id: string;
  answers: Partial<Answers>;
  topRecommendations: string[];
  rating: number | null;
  visitedPlace: string;
  createdAt: string;
};

export type HistoryItem = {
  id: string;
  mood: string;
  area: string;
  companion: string;
  transport?: string | string[];
  budget: number;
  time?: string;
  atmosphere?: string;
  priority?: string;
  freeWord: string;
  topRecommendation: string;
  createdAt?: string;
  recommendations?: Recommendation[];
  savedAnswers?: Partial<Answers>;
};

export type Answers = {
  mood: string;
  area: string;
  age?: string;
  gender?: string;
  companion: string;
  transport?: string | string[];
  budget: number;
  budgetMin?: number;
  time?: string;
  atmosphere?: string;
  priority?: string;
  freeWord: string;
  dynamicQs?: { question: string; answer: string }[];
  radiusKm?: number;
  areaMode?: 'current_location' | 'manual';
  distanceFeeling?: string;
  originLat?: number;
  originLng?: number;
  /** AI相談フロー（自由入力→OpenAI提案）の場合 true */
  aiChat?: boolean;
};

export type DynamicQuestion = {
  key: string;
  question: string;
  options: string[];
};

export type FeaturedPageSummary = {
  id: string;
  slug: string;
  spot_name: string;
  catch_copy?: string;
  cover_image_url?: string;
  tags: string[];
  partner_name: string;
};
