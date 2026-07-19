// ─── lib/spatial-search.ts ───────────────────────────────────────────────────
// PostGIS RPC「find_nearby_places」を呼び出す高速空間検索ラッパー
// 温泉・テーマパーク・飲食店など全スポット種別に対応
//
// 既存の searchPlacesByTags（haversine ベース）の代替として機能し、
// PostGIS が未設定の場合は自動的に既存ロジックへフォールバックする。

import { supabase } from "@/lib/supabase";
import { calcRadiusKm } from "@/lib/calc-radius";
import { formatDistText, haversineMeters, farLeanSpread } from "@/lib/distance";
import type { PlaceResponse } from "@/types/onsen";
import { searchPlacesByTags } from "@/lib/supabase-places";
import { mergedPlacePhotos } from "@/lib/place-photos";
import { scheduleBackgroundVitalityCheck } from "@/lib/place-vitality-check";
import { isOpenNowFromWeekdayText } from "@/lib/open-hours";   // P9: DB主経路のopen_hours(曜日別テキスト)をオフライン解析

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
  limit: number = 60,
  // 遠リング取得: > 0 で内円(< minRadiusM)を除外しリング[min,radius]を遠い順で取得（大半径far-bias用）。
  minRadiusM: number = 0
): Promise<NearbyPlaceRow[]> {
  if (!supabase) return [];

  const baseArgs = {
    user_lat:     lat,
    user_lng:     lng,
    radius_m:     radiusM,
    req_tags:     tags,
    result_limit: limit,
  };
  // 近め/通常(min=0)は min_radius_m を送らない＝旧5引数RPCでも動く。far-bias(min>0)のときだけ付与。
  const args = minRadiusM > 0 ? { ...baseArgs, min_radius_m: minRadiusM } : baseArgs;

  let { data, error } = await supabase.rpc("find_nearby_places", args);

  // 後方互換: RPC未更新(min_radius_m 引数なし)環境では PGRST202 になる → min_radius_m 抜きで再試行し
  //   従来の最寄り順挙動に degrade（far-bias は add-far-ring-min-radius.sql 適用まで従来どおり動く）。
  if (error && minRadiusM > 0 && error.code === "PGRST202") {
    ({ data, error } = await supabase.rpc("find_nearby_places", baseArgs));
  }

  if (error) {
    // PostGIS 未設定 or RPC未作成の場合は静かに空配列を返す
    if (error.code !== "PGRST202") {
      console.warn("[spatial-search] RPC error:", error.message);
    }
    return [];
  }

  return await excludeOutOfPeriodRows((data ?? []) as NearbyPlaceRow[]);
}

// ── 期間限定（places.available_from/until）の期間外除外 ──────────────────────
// RPC find_nearby_places は期間列を返さないため、idバッチ1クエリで「期間外のidだけ」を
// 引いて除外する（列未作成/エラー時は素通り＝安全劣化）。フォームの約束
// 「期間を設けると期間外は検索結果に出ません」を places 経路でも保証する（2026-07-06検証で発覚）。
export async function outOfPeriodPlaceIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!supabase || uniq.length === 0) return out;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("places").select("id")
      .in("id", uniq)
      .or(`available_from.gt.${today},available_until.lt.${today}`);
    if (error || !data) return out;
    for (const d of data) out.add((d as { id: string }).id);
  } catch { /* noop */ }
  return out;
}

async function excludeOutOfPeriodRows(rows: NearbyPlaceRow[]): Promise<NearbyPlaceRow[]> {
  if (rows.length === 0) return rows;
  const out = await outOfPeriodPlaceIds(rows.map(r => r.id));
  return out.size === 0 ? rows : rows.filter(r => !out.has(r.id));
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
    imageUrl:     mergedPlacePhotos(row)[0] ?? "",
    rating:       typeof row.rating === "number" ? row.rating : null,        // place-ratings.sql 適用後に反映
    reviewCount:  typeof row.rating_count === "number" ? row.rating_count : null,
    address:      row.address ?? "",
    distanceM:    row.distance_m,                                  // 精密距離[m]を保持（距離の単一ソース）
    distanceInfo: formatDistText((row.distance_m ?? 0) / 1000, transport),
    // 写真2列(旧photo_url/新image_urls)の統合は lib/place-photos に一元化
    photoUrls:    mergedPlacePhotos(row),
    // P9: open_hours(曜日別テキスト)からJSTの今の営業中を判定（確信できた時だけtrue/false・不明はnull＝無害）。
    //   これで find_nearby_places 主経路の候補にも sortOrShuffle の営業中ボーナス／営業中バッジが効く。
    openNow:      isOpenNowFromWeekdayText(row.open_hours),
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
    const fetchWithOrSemantics = async (tags: string[], radM: number, minRadM: number = 0): Promise<NearbyPlaceRow[]> => {
      if (tags.length <= 1) {
        return findNearbyPlacesRaw(lat, lng, radM, tags, fetchLimit, minRadM);
      }
      // 複数タグ → 各タグで個別取得して重複排除しながらマージ（OR semantics）
      const seen = new Set<string>();
      const merged: NearbyPlaceRow[] = [];
      const perTagLimit = Math.ceil(fetchLimit / tags.length) + 10;
      await Promise.all(tags.map(async (tag) => {
        const tagRows = await findNearbyPlacesRaw(lat, lng, radM, [tag], perTagLimit, minRadM);
        for (const r of tagRows) {
          if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
        }
      }));
      return merged;
    };

    // 遠リング取得: far-bias(minRadiusKm>0)では内円を除外したリング[min,radius]を優先取得する。
    //   RPCは既定で最寄り順＋limit のため、密集地(渋谷等)の大半径だと limit が近場で埋まり
    //   遠方リングに届かない → min_radius_m を渡してリングを遠い順で直接取得することで解消。
    const minRadiusM = minRadiusKm > 0 ? minRadiusKm * 1000 : 0;

    const mergeInto = (dst: NearbyPlaceRow[], src: NearbyPlaceRow[]): void => {
      const seen = new Set(dst.map(r => r.id));
      for (const r of src) { if (!seen.has(r.id)) { dst.push(r); seen.add(r.id); } }
    };

    // far-bias は「サブリング分割取得」でリング全域をカバーする（2026-07-19）。
    //   RPCが最遠order+limitでも randomでも、[min,radius]を K 個の狭いサブリングに分けて各々取得すれば
    //   各サブリングが自分の帯を埋める→merge で全域(例:96〜120kmの全体)が候補に入る。
    //   単一リング取得だと limit が外縁(最遠)で埋まり内側が欠ける問題(実測:小旅行が110〜120kmに密集)を回避。
    let rows: NearbyPlaceRow[];
    if (minRadiusKm > 0) {
      const K = 3;
      const step = (radiusKm - minRadiusKm) / K;
      const subs = await Promise.all(
        Array.from({ length: K }, (_, i) => {
          const lo = minRadiusKm + step * i;
          const hi = i === K - 1 ? radiusKm : minRadiusKm + step * (i + 1);
          return fetchWithOrSemantics(mustTags, hi * 1000, lo * 1000);
        }),
      );
      rows = [];
      for (const s of subs) mergeInto(rows, s);
    } else {
      rows = await fetchWithOrSemantics(mustTags, radiusM, 0);
    }

    // フォールバック1: タグを緩める（同じリング/半径内で再試行）
    if (rows.length < limit && fallbackTags.length > 0) {
      mergeInto(rows, await fetchWithOrSemantics(fallbackTags, radiusM, minRadiusM));
    }

    // フォールバック2: far グループが足りない場合のみ半径を1.5倍に広げてリング再取得
    const farCount = minRadiusKm > 0
      ? rows.filter(r => (r.distance_m / 1000) >= minRadiusKm).length
      : rows.length;
    if (farCount < limit) {
      mergeInto(rows, await fetchWithOrSemantics(mustTags, radiusM * 1.5, minRadiusM));
    }

    // フォールバック3(遠リング補完): far-bias で遠方が依然 limit 未満＝「本当に遠方が疎」なエリア。
    //   近場(min=0)も取得して split の near 配列を確保し、結果が痩せる/0件になるのを防ぐ。
    //   （遠リングが十分あるとき＝小旅行の箱根/富士方面等はこの近場取得は走らない）
    if (minRadiusKm > 0) {
      const farNow = rows.filter(r => (r.distance_m / 1000) >= minRadiusKm).length;
      if (farNow < limit) {
        mergeInto(rows, await fetchWithOrSemantics(mustTags, radiusM, 0));
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
        // far: 層化スプレッド（遠寄りだが[min,radius]全域に散らす）。単純な距離降順だと slice(limit) で
        //   全て外縁に密集する（品質監査2026-07-19で最低スコア）→ farLeanSpread で遠バンド厚め×全域配分。
        //   リング外縁 hiKm は「取得できた最大距離」を使う（radiusM*1.5 の widen も内包）。
        const maxFarKm = far.length ? Math.max(...far.map(r => r.distance_m / 1000)) : minRadiusKm;
        const spread = farLeanSpread(far, r => r.distance_m / 1000, minRadiusKm, Math.max(maxFarKm, minRadiusKm + 1));
        far.length = 0; far.push(...spread);
        // near: 距離降順（遠い順）で補完。far が空でも利用可能な中で最も遠いものが先頭に来る。
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
