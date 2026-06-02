export type OnsenCategory =
  | "natural_onsen"
  | "sento"
  | "super_sento"
  | "sauna_ganban"
  | "all_onsen";

export interface PlaceResponse {
  id: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  rating: number | null;
  reviewCount: number | null;
  address: string;
  distanceInfo: string;
  photoUrls: string[];
  openNow: boolean | null;
  openingHours: string | null;
  priceLevel: string | null;
  googleMapsUrl: string;
  stationInfo: string | null;
  source?: "hotpepper" | "google" | "admin" | "user";
  hotpepperUrl?: string;
  lat?: number | null;
  lng?: number | null;
  tags?: string[];
}

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

export interface OnsenApiResponse {
  data: PlaceResponse[];
  categoryLabel: string;
  areaLabel: string;
  aiDescription: string;
}
