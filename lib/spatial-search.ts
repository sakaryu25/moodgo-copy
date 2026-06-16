// ─── lib/spatial-search.ts ───────────────────────────────────────────────────
// PostGIS RPC「find_nearby_places」を呼び出す高速空間検索ラッパー
// 温泉・テーマパーク・飲食店など全スポット種別に対応
//
// 既存の searchPlacesByTags（haversine ベース）の代替として機能し、
// PostGIS が未設定の場合は自動的に既存ロジックへフォールバックする。

import { supabase } from "@/lib/supabase";
import { calcRadiusKm } from "@/lib/calc-radius";
import { formatDistText, haversineMeters } from "@/lib/distance";
import type { PlaceResponse } from "@/types/onsen";
import { searchPlacesByTags } from "@/lib/supabase-places";
import { scheduleBackgroundVitalityCheck } from "@/lib/place-vitality-check";

// ─────────────────────────────────────────────────────────────────────────────
// RPC レスポンス型（supabase-postgis-migration.sql の戻り値と一致）
// ─────────────────────────────────────────────────────────────────────────────
export interface NearbyPlaceRow {
  id: string;
  name: string;
  address: string;
  nearest_station: string | null;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
  tags: string[];
  area: string | null;
  description: string | null;
  photo_url: string | null;
  image_urls: string[] | null;
  open_hours: string | null;
  close_day: string | null;
  budget: string | null;
  hotpepper_url: string | null;
  source_type: string | null;
  report_count: number;
  last_checked_at: string | null;
  rating: number | null;        // place-ratings.sql 適用後に返る（未適用時はundefined）
  rating_count: number | null;
  distance_m: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// オプション型（searchPlacesByTags と同じ構造）
// ─────────────────────────────────────────────────────────────────────────────
export interface SpatialSearchOptions {
  mustTags: string[];
  fallbackTags?: string[];
  lat: number;
  lng: number;
  /** km 単位の検索半径（calcRadiusKm で算出したもの） */
  radiusKm: number;
  transport?: string | string[];
  limit?: number;
  googleApiKey?: string;
  companion?: string;
  budget?: number;
  minRadiusKm?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PostGIS RPC 呼び出し（生の行を返す）
// ─────────────────────────────────────────────────────────────────────────────
export async function findNearbyPlacesRaw(
  lat: number,
  lng: number,
  radiusM: number,
  tags: string[],
  limit: number = 60
): Promise<NearbyPlaceRow[]> {
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("find_nearby_places", {
    user_lat:     lat,
    user_lng:     lng,
    radius_m:     radiusM,
    req_tags:     tags,
    result_limit: limit,
  });

  if (error) {
    // PostGIS 未設定 or RPC未作成の場合は静かに空配列を返す
    if (error.code !== "PGRST202") {
      console.warn("[spatial-search] RPC error:", error.message);
    }
    return [];
  }

  return (data ?? []) as NearbyPlaceRow[];
}

// 距離テキストは lib/distance.ts の formatDistText に一本化（全経路で同一表示）

// ─────────────────────────────────────────────────────────────────────────────
// NearbyPlaceRow → PlaceResponse 軽量変換
// （Google Places で写真補強しない高速版）
// ─────────────────────────────────────────────────────────────────────────────
export function nearbyRowToPlaceResponse(
  row: NearbyPlaceRow,
  transport: string | string[] = "車"
): PlaceResponse {
  const categoryTag = row.tags.find(
    t => t !== "#お腹すいた" && !t.startsWith("#温泉") && t.startsWith("#")
  ) ?? row.tags[0] ?? "スポット";

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    row.name + " " + (row.address ?? "")
  )}`;

  return {
    id:           row.google_place_id ?? `sb-${row.id}`,
    name:         row.name,
    category:     categoryTag.replace(/^#/, ""),
    description:  row.description ?? `${row.name}のスポット情報`,
    imageUrl:     (row.image_urls && row.image_urls.length > 0 ? row.image_urls[0] : row.photo_url) ?? "",
    rating:       typeof row.rating === "number" ? row.rating : null,        // place-ratings.sql 適用後に反映
    reviewCount:  typeof row.rating_count === "number" ? row.rating_count : null,
    address:      row.address ?? "",
    distanceM:    row.distance_m,                                  // 精密距離[m]を保持（距離の単一ソース）
    distanceInfo: formatDistText((row.distance_m ?? 0) / 1000, transport),
    // 保存済みの複数写真があればそれを、無ければ単発photo_url（SQL未実行でも安全）
    photoUrls:    (row.image_urls && row.image_urls.length > 0) ? row.image_urls : (row.photo_url ? [row.photo_url] : []),
    openNow:      null,
    openingHours: row.open_hours ?? null,
    priceLevel:   null,
    googleMapsUrl,
    stationInfo:  row.nearest_station ?? null,
    lat:          row.lat ?? null,
    lng:          row.lng ?? null,
    tags:         row.tags,
    source:       (row.source_type as "hotpepper" | "google" | "admin" | "user" | "manual") ?? "admin",
    hotpepperUrl: row.hotpepper_url ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 自由ワード/絞り込み用: places を「名前・説明のテキスト一致」で近傍検索する。
//   気分タグ検索(find_nearby_places)と別軸で、freeWord/refinement の語に合う実在スポットを
//   Supabaseから拾う（OpenAIに架空生成させず、DBから提案するため）。返却は spatialSearch と同型。
//   bounding-box で粗く絞り→haversineで半径内＆近い順。distance_m はこちらで算出。
// ─────────────────────────────────────────────────────────────────────────────
export async function searchPlacesByText(opts: {
  keywords: string[];
  lat: number;
  lng: number;
  radiusKm: number;
  transport?: string | string[];
  limit?: number;
}): Promise<PlaceResponse[]> {
  if (!supabase) return [];
  const { lat, lng, radiusKm, transport = "車", limit = 30 } = opts;
  const kws = [...new Set((opts.keywords ?? []).filter(k => typeof k === "string" && k.trim().length >= 2))].slice(0, 4);
  if (kws.length === 0) return [];

  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  // PostgREST or 句: name/description どちらかに含む（ILIKE）。記号はサニタイズ。
  const esc = (s: string) => s.replace(/[%,()*]/g, " ").trim();
  const orClause = kws.flatMap(k => [`name.ilike.*${esc(k)}*`, `description.ilike.*${esc(k)}*`]).join(",");

  try {
    const { data, error } = await supabase
      .from("places")
      .select("id,name,address,nearest_station,lat,lng,google_place_id,tags,area,description,photo_url,image_urls,open_hours,close_day,budget,hotpepper_url,source_type,report_count,last_checked_at,rating,rating_count")
      .eq("is_active", true)
      .gte("lat", lat - dLat).lte("lat", lat + dLat)
      .gte("lng", lng - dLng).lte("lng", lng + dLng)
      .or(orClause)
      .limit(200);
    if (error || !data) return [];

    const withDist = (data as Array<Record<string, unknown>>)
      .map(r => {
        const rlat = r.lat as number | null, rlng = r.lng as number | null;
        const dm = (typeof rlat === "number" && typeof rlng === "number")
          ? haversineMeters(lat, lng, rlat, rlng) : Number.MAX_SAFE_INTEGER;
        return { r, dm };
      })
      .filter(x => x.dm <= radiusKm * 1000)
      .sort((a, b) => a.dm - b.dm)
      .slice(0, limit);

    return withDist.map(({ r, dm }) => nearbyRowToPlaceResponse({
      id: String(r.id),
      name: String(r.name ?? ""),
      address: String(r.address ?? ""),
      nearest_station: (r.nearest_station as string) ?? null,
      lat: (r.lat as number) ?? null,
      lng: (r.lng as number) ?? null,
      google_place_id: (r.google_place_id as string) ?? null,
      tags: (r.tags as string[]) ?? [],
      area: (r.area as string) ?? null,
      description: (r.description as string) ?? null,
      photo_url: (r.photo_url as string) ?? null,
      image_urls: (r.image_urls as string[]) ?? null,
      open_hours: (r.open_hours as string) ?? null,
      close_day: (r.close_day as string) ?? null,
      budget: (r.budget as string) ?? null,
      hotpepper_url: (r.hotpepper_url as string) ?? null,
      source_type: (r.source_type as string) ?? null,
      report_count: (r.report_count as number) ?? 0,
      last_checked_at: (r.last_checked_at as string) ?? null,
      rating: (r.rating as number) ?? null,
      rating_count: (r.rating_count as number) ?? null,
      distance_m: dm,
    }, transport));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// メイン：PostGIS で検索して PlaceResponse[] を返す
// PostGIS が使えない場合は既存の searchPlacesByTags にフォールバック
// ─────────────────────────────────────────────────────────────────────────────
export async function spatialSearch(opts: SpatialSearchOptions): Promise<PlaceResponse[]> {
  const {
    mustTags,
    fallbackTags = [],
    lat,
    lng,
    radiusKm,
    transport = "車",
    limit = 20,
    googleApiKey = "",
    companion,
    budget,
    minRadiusKm = 0,
  } = opts;

  const radiusM = radiusKm * 1000;
  const hasLocation = lat !== 0 || lng !== 0;

  // ── PostGIS RPC を試みる ──────────────────────────────────────────────────
  if (hasLocation) {
    // 検索半径に応じて取得数を増やす（大きな半径ほど多様性を確保するため母数を増やす）
    // RPC は近い順に返すため、遠方まで広げた場合は多めに取得してシャッフルで多様性を出す
    const fetchLimit = radiusKm > 100 ? Math.max(limit * 20, 100)
      : radiusKm > 20  ? Math.max(limit * 10, 50)
      : limit * 4;

    // ── OR semantics: mustTags が複数の場合、各タグで個別に検索して union ──
    // find_nearby_places RPC は AND 検索のため、複数タグ（わいわい系・運動系など）は
    // タグ1件ずつで検索してマージすることで OR 検索と同等の結果を得る
    const fetchWithOrSemantics = async (tags: string[], radM: number): Promise<NearbyPlaceRow[]> => {
      if (tags.length <= 1) {
        return findNearbyPlacesRaw(lat, lng, radM, tags, fetchLimit);
      }
      // 複数タグ → 各タグで個別取得して重複排除しながらマージ（OR semantics）
      const seen = new Set<string>();
      const merged: NearbyPlaceRow[] = [];
      const perTagLimit = Math.ceil(fetchLimit / tags.length) + 10;
      await Promise.all(tags.map(async (tag) => {
        const tagRows = await findNearbyPlacesRaw(lat, lng, radM, [tag], perTagLimit);
        for (const r of tagRows) {
          if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
        }
      }));
      return merged;
    };

    let rows = await fetchWithOrSemantics(mustTags, radiusM);

    // フォールバック1: タグを緩める（元の半径内で再試行）
    if (rows.length < limit && fallbackTags.length > 0) {
      const morRows = await fetchWithOrSemantics(fallbackTags, radiusM);
      // 重複排除してマージ
      const seen = new Set(rows.map(r => r.id));
      for (const r of morRows) {
        if (!seen.has(r.id)) { rows.push(r); seen.add(r.id); }
      }
    }

    // フォールバック2: far グループが足りない場合のみ半径を1.5倍に広げる
    const farCount = minRadiusKm > 0
      ? rows.filter(r => (r.distance_m / 1000) >= minRadiusKm).length
      : rows.length;
    if (farCount < limit) {
      const wideRows = await fetchWithOrSemantics(mustTags, radiusM * 1.5);
      const seen = new Set(rows.map(r => r.id));
      for (const r of wideRows) {
        if (!seen.has(r.id)) { rows.push(r); seen.add(r.id); }
      }
    }

    if (rows.length > 0) {
      // ── Fisher-Yates シャッフル（インプレース）─────────────────────────────
      const shuffle = <T>(arr: T[]): T[] => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      };

      // ── 遠端バイアス ─────────────────────────────────────────────────────────
      // 選択した距離の外縁部（minRadiusKm以上）を優先し、足りなければ近場で補完
      // far グループ: 距離降順（外縁に近いほど上位）でソートしてから毎回ランダムノイズを加える
      //   → 同距離帯でも毎回異なる結果になり、かつ遠いスポットが優先される
      if (minRadiusKm > 0) {
        const far  = rows.filter(r => (r.distance_m / 1000) >= minRadiusKm);
        const near = rows.filter(r => (r.distance_m / 1000) <  minRadiusKm);
        // far: 距離降順 + ランダムノイズで並べ替え（遠いほど上、毎回少し変わる）
        far.sort((a, b) => (b.distance_m - a.distance_m) + (Math.random() - 0.5) * 2000);
        // near: こちらも距離降順（遠い順）で補完。
        //   far が空（=選択距離に届くスポットが無い）でも、利用可能な中で最も遠いものが
        //   先頭に来るようにする。これにより「どこでも行きたい」等で近すぎる場所が
        //   上位に出る問題を防ぐ。
        near.sort((a, b) => (b.distance_m - a.distance_m) + (Math.random() - 0.5) * 2000);
        rows = [...far, ...near];
      } else {
        // minRadiusKm なし（手動エリア入力・お腹すいた等）: 完全シャッフルだと
        //   半径内の遠方スポットが先頭に来て「距離ロジックが効いていない」ように見える。
        //   → 近い順をベースに軽いランダムノイズを足し、近場優先しつつ毎回少し変える。
        //   再検索(seenPlaces除外)時も、残りの中で最も近いスポットから提案される。
        //   jitter は半径に比例（広い検索ほど入れ替わり幅を許容）。上限12km。
        void shuffle; // 純シャッフルは廃止（近い順ベースに統一）
        const jitterM = Math.min(radiusM * 0.12, 12000);
        rows.sort((a, b) => (a.distance_m - b.distance_m) + (Math.random() - 0.5) * jitterM * 2);
      }

      const sliced = rows.slice(0, limit);

      // 表示されたスポットをバックグラウンドで生存確認（UX に影響しない fire-and-forget）
      if (googleApiKey) {
        const supabaseIds = sliced
          .map(r => r.id)
          .filter(Boolean);
        if (supabaseIds.length > 0) {
          scheduleBackgroundVitalityCheck(supabaseIds, googleApiKey, 3000);
        }
      }

      return sliced.map(r => nearbyRowToPlaceResponse(r, transport));
    }
  }

  // ── PostGIS が使えない or 現在地なし → 既存の searchPlacesByTags へ ─────
  console.log("[spatial-search] Falling back to searchPlacesByTags");
  return searchPlacesByTags({
    mustTags,
    fallbackTags,
    lat,
    lng,
    radiusKm,
    transport,
    limit,
    googleApiKey,
    companion,
    budget,
    minRadiusKm,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ユーティリティ: calcRadiusKm との統合ヘルパー
// transport と time から radiusKm を自動計算して spatialSearch を呼ぶ
// ─────────────────────────────────────────────────────────────────────────────
export async function spatialSearchWithTransport(opts: {
  mustTags:     string[];
  fallbackTags?: string[];
  lat:          number;
  lng:          number;
  transport:    string | string[];
  time?:        string;
  limit?:       number;
  googleApiKey?: string;
  companion?:   string;
  budget?:      number;
}): Promise<PlaceResponse[]> {
  const { transport, time = "1~2時間", ...rest } = opts;
  const transportArr = Array.isArray(transport) ? transport : [transport];
  const radiusKm = calcRadiusKm(transportArr, time);

  return spatialSearch({ ...rest, transport, radiusKm });
}
