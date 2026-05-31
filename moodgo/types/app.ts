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
  mapUrl?: string;
  rating?: number | null;
  userRatingCount?: number | null;
  photoUrl?: string;
  photoUrls?: string[];
  openingHoursText?: string;
  distanceText?: string;
  durationText?: string;
  openNow?: boolean;
  reason?: string;
  features?: string[];
  isUserSpot?: boolean;
  hasUserPhotos?: boolean;
  userPhotoCount?: number;
  priceLevel?: string;
  stationText?: string;
  routesByMode?: RouteByMode[];
  source?: 'hotpepper' | 'google' | 'admin' | 'user';
  hotpepperUrl?: string;
  /** Supabase places.id（UUID）。report-closed API で使用する閉店報告用 */
  supabaseId?: string;
};

export type FavoriteItem = {
  title: string;
  area: string;
  vibe: string;
  photoUrl?: string;
  mapUrl?: string;
  createdAt?: string;
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
