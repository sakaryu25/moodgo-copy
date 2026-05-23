// ─── lib/place-vitality-check.ts ─────────────────────────────────────────────
// 閉店・閉業した店舗を自動排除する「自浄作用」モジュール
//
// ロジック:
//   1. last_checked_at が null or 7日以上前のスポットを対象とする
//   2. Google Places API で business_status を確認
//   3. CLOSED_PERMANENTLY なら is_active = false に更新（検索から自動排除）
//   4. 営業中なら last_checked_at を現在時刻に更新（コスト節約）
//
// 全スポット対応（飲食店・温泉・テーマパーク・お出かけスポットすべて）

import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// 設定
// ─────────────────────────────────────────────────────────────────────────────
const CHECK_INTERVAL_DAYS = 7;           // 再チェックまでの間隔
const BATCH_CONCURRENCY   = 5;           // 同時処理数（APIレート制限対策）
const API_TIMEOUT_MS      = 5000;        // Google API タイムアウト

// ─────────────────────────────────────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────────────────────────────────────
export type BusinessStatus =
  | "OPERATIONAL"
  | "CLOSED_TEMPORARILY"
  | "CLOSED_PERMANENTLY"
  | "UNKNOWN";

export interface VitalityTarget {
  id: string;
  name: string;
  google_place_id: string | null;
  hotpepper_id?: string | null;
  address: string;
  source_type: string | null;
  last_checked_at: string | null;
}

export interface VitalityResult {
  id:          string;
  name:        string;
  status:      BusinessStatus;
  action:      "deactivated" | "updated" | "skipped" | "no_place_id" | "api_error";
  errorMsg?:   string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Places API: business_status を取得
// ─────────────────────────────────────────────────────────────────────────────
async function fetchBusinessStatus(
  googlePlaceId: string,
  apiKey: string
): Promise<BusinessStatus> {
  try {
    // Google Places (New) API - Place Details
    const url = `https://places.googleapis.com/v1/places/${googlePlaceId}?fields=businessStatus&languageCode=ja`;
    const res = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "businessStatus",
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!res.ok) {
      // 404 = Place ID が無効（古い ID 等） → 安全のため UNKNOWN 扱い
      if (res.status === 404) return "UNKNOWN";
      return "UNKNOWN";
    }

    const data = await res.json();
    const status = (data.businessStatus ?? "UNKNOWN") as BusinessStatus;
    return status;
  } catch {
    return "UNKNOWN";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// google_place_id を名前+住所から検索（未登録スポット用）
// ─────────────────────────────────────────────────────────────────────────────
async function resolveGooglePlaceId(
  name: string,
  address: string,
  apiKey: string
): Promise<string | null> {
  try {
    const query = `${name} ${address}`;
    const url = `https://places.googleapis.com/v1/places:searchText`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ textQuery: query, languageCode: "ja", maxResultCount: 1 }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.places?.[0]?.id as string) ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1件のスポットを生存確認し、Supabase を更新する
// ─────────────────────────────────────────────────────────────────────────────
async function checkSinglePlace(
  place: VitalityTarget,
  apiKey: string
): Promise<VitalityResult> {
  if (!supabase) {
    return { id: place.id, name: place.name, status: "UNKNOWN", action: "skipped" };
  }

  // google_place_id が未登録なら名前+住所で検索して紐付け
  let placeId = place.google_place_id;

  if (!placeId && apiKey) {
    placeId = await resolveGooglePlaceId(place.name, place.address, apiKey);
    // 取得できた場合はDBに保存（次回以降のチェックコストを削減）
    if (placeId) {
      await supabase.from("places").update({ google_place_id: placeId }).eq("id", place.id);
    }
  }

  if (!placeId) {
    // google_place_id が取得できない場合は last_checked_at だけ更新して終了
    await supabase.from("places")
      .update({ last_checked_at: new Date().toISOString() })
      .eq("id", place.id);
    return { id: place.id, name: place.name, status: "UNKNOWN", action: "no_place_id" };
  }

  // Google Places API でステータスを取得
  const status = await fetchBusinessStatus(placeId, apiKey);

  if (status === "CLOSED_PERMANENTLY") {
    // 完全閉業 → is_active = false（検索結果から自動排除）
    await supabase.from("places")
      .update({
        is_active:       false,
        last_checked_at: new Date().toISOString(),
      })
      .eq("id", place.id);

    console.log(`[vitality] DEACTIVATED: ${place.name} (${place.id})`);
    return { id: place.id, name: place.name, status, action: "deactivated" };
  }

  // 営業中 or 一時的閉業 → last_checked_at を更新（is_active はそのまま）
  await supabase.from("places")
    .update({ last_checked_at: new Date().toISOString() })
    .eq("id", place.id);

  return { id: place.id, name: place.name, status, action: "updated" };
}

// ─────────────────────────────────────────────────────────────────────────────
// バッチ生存確認（Admin バッチ・バックグラウンド処理用）
// BATCH_CONCURRENCY 件ずつ並列処理して API レート制限を回避
// ─────────────────────────────────────────────────────────────────────────────
export async function batchVitalityCheck(
  targets: VitalityTarget[],
  apiKey: string
): Promise<{
  total: number;
  deactivated: number;
  updated: number;
  skipped: number;
  results: VitalityResult[];
}> {
  const results: VitalityResult[] = [];

  // BATCH_CONCURRENCY ずつ並列処理
  for (let i = 0; i < targets.length; i += BATCH_CONCURRENCY) {
    const batch = targets.slice(i, i + BATCH_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(p => checkSinglePlace(p, apiKey))
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        results.push({
          id: "unknown", name: "unknown",
          status: "UNKNOWN", action: "api_error",
          errorMsg: String(r.reason),
        });
      }
    }

    // レート制限対策：バッチ間に少し待機
    if (i + BATCH_CONCURRENCY < targets.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  return {
    total:       results.length,
    deactivated: results.filter(r => r.action === "deactivated").length,
    updated:     results.filter(r => r.action === "updated").length,
    skipped:     results.filter(r => r.action === "skipped" || r.action === "no_place_id").length,
    results,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase RPC で「チェック対象スポット」を取得
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchVitalityTargets(
  batchSize: number = 50
): Promise<VitalityTarget[]> {
  if (!supabase) return [];

  // RPC を試みる（PostGIS マイグレーション済みの場合）
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "find_places_needing_vitality_check",
    { batch_size: batchSize, max_age_days: CHECK_INTERVAL_DAYS }
  );

  if (!rpcErr && rpcData) {
    return rpcData as VitalityTarget[];
  }

  // RPC が使えない場合は直接クエリ
  const cutoff = new Date(Date.now() - CHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("places")
    .select("id, name, google_place_id, hotpepper_id, address, source_type, last_checked_at")
    .eq("is_active", true)
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(batchSize);

  return (data ?? []) as VitalityTarget[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 検索結果の非同期バックグラウンドチェック
// （ユーザー検索の応答速度に影響しない fire-and-forget 方式）
// 検索で返ってきた上位スポットを、レスポンス後にバックグラウンドで確認
// ─────────────────────────────────────────────────────────────────────────────
export function scheduleBackgroundVitalityCheck(
  placeIds: string[],
  apiKey: string,
  checkIntervalMs: number = 0
): void {
  if (!apiKey || placeIds.length === 0) return;

  // Next.js の waitUntil がない環境でも動作する setTimeout 方式
  setTimeout(async () => {
    if (!supabase) return;

    const cutoff = new Date(Date.now() - CHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // 対象を絞る（last_checked_at が古いもの or null のみ）
    const { data: targets } = await supabase
      .from("places")
      .select("id, name, google_place_id, hotpepper_id, address, source_type, last_checked_at")
      .in("id", placeIds)
      .eq("is_active", true)
      .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`);

    if (!targets || targets.length === 0) return;

    await batchVitalityCheck(targets as VitalityTarget[], apiKey);
  }, checkIntervalMs);
}
