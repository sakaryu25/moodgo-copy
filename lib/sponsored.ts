// ─── lib/sponsored.ts ────────────────────────────────────────────────────────
// 有料掲載（スポンサー枠）の取得ヘルパ。supabase/sponsored-listings.sql 適用後に有効化。
//   列が無い間（未適用）/該当0件の場合は空配列を返す＝recommend は完全に無改修挙動（no-op）。
//
// recommend はこの結果を「関連度(気分タグ)・距離(半径内)を満たすスポンサー枠」として
// 検索結果の最上位に最大 N 件確保し、PR/広告ラベルを付けて表示する（景表法/審査対応）。

import { supabase } from "@/lib/supabase";
import { haversineMeters } from "@/lib/distance";

export interface SponsoredPlace {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  tags: string[];
  description: string | null;
  photo_url: string | null;
  image_urls: string[] | null;
  google_place_id: string | null;
  nearest_station: string | null;
  sponsor_tier: string | null;
}

const TIER_RANK: Record<string, number> = { gold: 0, silver: 1, bronze: 2 };

// 今日有効なスポンサー枠を、現在地から radiusKm 以内・気分タグに合致する範囲で取得。
//   max: 返す最大件数（検索結果上位に確保する枠数）。
export async function fetchSponsoredPlaces(opts: {
  lat: number;
  lng: number;
  radiusKm: number;
  moodTags: string[];      // 関連度判定: この気分タグのいずれかを持つ枠のみ（無関係な広告を出さない）
  max?: number;
}): Promise<SponsoredPlace[]> {
  const { lat, lng, radiusKm, moodTags, max = 2 } = opts;
  if (!supabase || !(lat || lng)) return [];

  const today = new Date().toISOString().slice(0, 10);
  try {
    // billing_status='active' かつ 掲載期間内。tags の関連度・距離は取得後に絞る。
    const { data, error } = await supabase
      .from("places")
      .select("id, name, address, lat, lng, tags, description, photo_url, image_urls, google_place_id, nearest_station, sponsor_tier, paid_from, paid_until")
      .eq("is_active", true)
      .eq("billing_status", "active")
      .or(`paid_from.is.null,paid_from.lte.${today}`)
      .or(`paid_until.is.null,paid_until.gte.${today}`)
      .limit(200);

    // 列未作成（未適用）→ 42703/PGRST204。静かに no-op。
    if (error || !data) return [];

    const moodSet = new Set(moodTags);
    const withinAndRelevant = (data as Array<Record<string, unknown>>)
      .map((r) => {
        const rlat = typeof r.lat === "number" ? r.lat : null;
        const rlng = typeof r.lng === "number" ? r.lng : null;
        const tags = Array.isArray(r.tags) ? (r.tags as string[]) : [];
        const distM = rlat != null && rlng != null ? haversineMeters(lat, lng, rlat, rlng) : Infinity;
        return { r, rlat, rlng, tags, distM };
      })
      // 関連度: 気分タグのいずれかを持つ（moodTags空なら関連度フィルタ無し）
      .filter((x) => moodSet.size === 0 || x.tags.some((t) => moodSet.has(t)))
      // 距離: 半径内（座標不明は除外＝遠方誤掲載防止）
      .filter((x) => x.distM <= radiusKm * 1000)
      // tier→距離 の順に優先
      .sort((a, b) => {
        const ta = TIER_RANK[String((a.r as { sponsor_tier?: string }).sponsor_tier ?? "")] ?? 9;
        const tb = TIER_RANK[String((b.r as { sponsor_tier?: string }).sponsor_tier ?? "")] ?? 9;
        return ta !== tb ? ta - tb : a.distM - b.distM;
      })
      .slice(0, max);

    return withinAndRelevant.map(({ r }) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      address: (r.address as string | null) ?? null,
      lat: typeof r.lat === "number" ? r.lat : null,
      lng: typeof r.lng === "number" ? r.lng : null,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
      description: (r.description as string | null) ?? null,
      photo_url: (r.photo_url as string | null) ?? null,
      image_urls: Array.isArray(r.image_urls) ? (r.image_urls as string[]) : null,
      google_place_id: (r.google_place_id as string | null) ?? null,
      nearest_station: (r.nearest_station as string | null) ?? null,
      sponsor_tier: (r.sponsor_tier as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}
