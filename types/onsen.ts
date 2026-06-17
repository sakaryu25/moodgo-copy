// ── 温泉SPA機能の型定義 ─────────────────────────────────────────────────────

export type OnsenCategory =
  | "all_onsen"       // 温泉全般（天然温泉・銭湯・スーパー銭湯含む）
  | "sauna_ganban";   // サウナ・岩盤浴（本格的サウナ・岩盤浴）

// ── クライアントへ返すデータ構造（グルメ画面と同じプロパティ名）──────────────
export interface PlaceResponse {
  id: string;           // Google Place ID または Yahoo由来のID
  name: string;         // 施設名
  category: string;     // サブカテゴリ（例: "スーパー銭湯"）
  description: string;  // OpenAIが生成した提案の一言理由
  imageUrl: string;     // Google Places APIで取得した写真URL（先頭1枚）
  rating: number | null;
  reviewCount: number | null;
  address: string;
  distanceInfo: string; // 現在地からの距離・所要時間（例: "車で約15分 / 12.3km"）
  distanceM?: number | null; // 現在地からの精密距離[m]（PostGIS distance_m。距離の単一ソース）
  semanticSim?: number | null; // セマンティック検索の類似度(0-1・1-cosine距離)。意味検索由来の候補のみ付与
  // ── UIリッチ表示用の拡張フィールド ──────────────────────────────────────
  photoUrls: string[];           // 写真URL一覧（最大5枚、カルーセル用）
  openNow: boolean | null;       // 現在営業中かどうか
  openingHours: string | null;   // 営業時間テキスト（例: "月〜日 10:00〜23:00"）
  priceLevel: string | null;     // 価格帯（Google Places PriceLevel）
  googleMapsUrl: string;         // GoogleマップURL
  stationInfo: string | null;    // 最寄り駅情報（例: "渋谷駅から徒歩5分"）
  catchphrase?: string;          // ルールベースのキャッチコピー（時間潰したい用）
  tags?: string[];               // スポットのタグ一覧
  // ── ソース情報（HotPepper 由来スポットの識別）────────────────────────────
  source?: "hotpepper" | "google" | "admin" | "user" | "manual";
  hotpepperUrl?: string;
  lat?: number | null;
  lng?: number | null;
}

// ── APIリクエスト型 ────────────────────────────────────────────────────────
export interface OnsenRequest {
  category: OnsenCategory;
  lat: number;
  lng: number;
  areaLabel?: string;
  transport?: string | string[];
  time?: string;
  companion?: string;
  budget?: number;
  freeWord?: string;
}

// ── APIレスポンス型 ────────────────────────────────────────────────────────
export interface OnsenApiResponse {
  data: PlaceResponse[];         // 取得できた全件
  categoryLabel: string;
  areaLabel: string;
  aiDescription: string;
}

export interface OnsenErrorResponse {
  error: string;
}
