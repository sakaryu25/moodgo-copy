export type WaiWaiSubCategory = "active" | "party" | "experience" | "food_drink";

export interface WaiWaiRequest {
  subCategory: WaiWaiSubCategory;
  lat: number;
  lng: number;
  areaLabel?: string;
  transport?: string | string[];
  age?: string;
}

export interface WaiWaiApiResponse {
  data: import("./onsen").PlaceResponse[];
  subCategoryLabel: string;
  areaLabel: string;
}
