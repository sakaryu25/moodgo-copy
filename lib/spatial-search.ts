// ─── lib/spatial-search.ts ───────────────────────────────────────────────────
// PostGIS RPC「find_nearby_places」を呼び出す高速空間検索ラッパー
// 温泉・テーマパーク・飲食店など全スポット種別に対応
//
// 既存の searchPlacesByTags（haversine ベース）の代替として機能し、
// PostGIS が未設定の場合は自動的に既存ロジックへフォールバックする。

import { supabase } from "@/lib/supabase";
import { calcRadiusKm } from "@/lib/calc-radius";
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
  open_hours: string | null;
  close_day: string | null;
  budget: string | null;
  hotpepper_url: string | null;
  source_type: string | null;
  report_count: number;
  last_checked_at: string | null;
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

// ─────────────────────────────────────────────────────────────────────────────
// 距離テキスト生成（transport に応じた所要時間表示）
// ─────────────────────────────────────────────────────────────────────────────
function formatDistanceFromM(distM: number, transport: string | string[]): string {
  const km = distM / 1000;
  const t = Array.isArray(transport) ? transport.join(",") : (transport ?? "");

  let speedKmh: number;
  let mode: string;
  if (t.includes("車") || t.includes("バイク") || t.includes("なんでも")) {
    speedKmh = 40; mode = "車";
  } else if (t.includes("電車") || t.includes("バス")) {
    speedKmh = 30; mode = "電車";
  } else if (t.includes("自転車")) {
    speedKmh = 12; mode = "自転車";
  } else if (t.includes("徒歩")) {
    speedKmh = 4; mode = "歩き";
  } else {
    speedKmh = 40; mode = "車";
  }

  const mins = Math.round((km / speedKmh) * 60);
  if (mins < 60) return `${mode}で約${mins}分 / ${km.toFixed(1)}km`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${mode}で約${h}時間${m > 0 ? m + "分" : ""} / ${km.toFixed(1)}km`;
}

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
    imageUrl:     row.photo_url ?? "",
    rating:       null,
    reviewCount:  null,
    address:      row.address ?? "",
    distanceInfo: formatDistanceFromM(row.distance_m, transport),
    photoUrls:    row.photo_url ? [row.photo_url] : [],
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
        // minRadiusKm なし: 全件シャッフルで毎回異なる結果
        shuffle(rows);
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
