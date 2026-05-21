// ── 集中したい カテゴリの型定義 ─────────────────────────────────────────────────

export type FocusSubCategory =
  | "work_cafe"       // ☕ カフェ・ファミレスで作業・勉強したい（深夜OK）
  | "coworking";      // 🖥️ 静かな専用スペース・ネカフェ・図書館でこもりたい

export interface FocusRequest {
  subCategory:  FocusSubCategory;
  lat:          number;
  lng:          number;
  areaLabel?:   string;
  transport?:   string | string[];
}

export interface FocusApiResponse {
  data:             import("./onsen").PlaceResponse[];
  subCategoryLabel: string;
  areaLabel:        string;
}

export interface FocusErrorResponse {
  error: string;
}
