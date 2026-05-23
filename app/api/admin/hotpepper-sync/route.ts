// ─── /api/admin/hotpepper-sync ───────────────────────────────────────────────
// HotPepperグルメAPIから全国の飲食店を取得し、タグ付きでSupabaseに保存する
// Admin画面から呼ばれる（1回のリクエスト = 1ジャンル × 1バッチ = 最大20地点）
//
// POST body:
//   secret      string   管理者パスワード
//   genreId     string   ジャンルID（例: "izakaya"）
//   batchIndex  number   バッチインデックス（0始まり）
//   batchSize?  number   1バッチあたりの地点数（デフォルト20）
//   dryRun?     boolean  trueの場合はDBに書き込まない

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  SYNC_GENRE_CONFIGS,
  assignTagsFromConfig,
  isKoreanShop,
  getGridBatch,
  getTotalBatches,
  type GridPoint,
} from "@/lib/hotpepper-sync-config";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "moodgoadmin123";
const HOTPEPPER_API_KEY = process.env.HOTPEPPER_API_KEY ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5分（Vercel Pro plan）

// ── HotPepper API レスポンス型 ────────────────────────────────────────────────
interface HotPepperShop {
  id: string;
  name: string;
  name_kana: string;
  address: string;
  station_name: string;
  lat: string;
  lng: string;
  genre: { code: string; name: string; catch: string };
  sub_genre?: { code: string; name: string };
  budget?: { code: string; name: string; average: string };
  catch: string;
  capacity: string;
  access: string;
  mobile_access: string;
  urls: { pc: string };
  photo: { pc: { l: string; m: string; s: string }; mobile: { l: string; s: string } };
  open: string;
  close: string;
  wifi: string;
  non_smoking: string;
  private_room: string;
  free_food: string;
  free_drink: string;
}

// ── HotPepper API 検索（1地点・1ジャンル・ページング） ──────────────────────
async function fetchHotPepperShops(
  lat: number,
  lng: number,
  genreCode: string | undefined,
  keyword: string | undefined,
  start: number = 1,
  count: number = 100
): Promise<{ shops: HotPepperShop[]; resultsAvailable: number }> {
  if (!HOTPEPPER_API_KEY) return { shops: [], resultsAvailable: 0 };

  const params = new URLSearchParams({
    key: HOTPEPPER_API_KEY,
    lat: String(lat),
    lng: String(lng),
    range: "5",        // 3km
    count: String(count),
    start: String(start),
    order: "4",        // おすすめ順
    format: "json",
  });

  if (genreCode) params.set("genre", genreCode);
  if (keyword) params.set("keyword", keyword);

  try {
    const res = await fetch(
      `https://webservice.recruit.co.jp/hotpepper/gourmet/v1/?${params}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { shops: [], resultsAvailable: 0 };
    const json = await res.json();
    const results = json.results ?? {};
    return {
      shops: (results.shop ?? []) as HotPepperShop[],
      resultsAvailable: parseInt(results["results_available"] ?? "0", 10),
    };
  } catch {
    return { shops: [], resultsAvailable: 0 };
  }
}

// ── 1地点のすべての店舗を取得（ページング対応・最大300件）────────────────────
async function fetchAllShopsForPoint(
  point: GridPoint,
  genreCode: string | undefined,
  keyword: string | undefined
): Promise<HotPepperShop[]> {
  const allShops: HotPepperShop[] = [];
  const maxShops = 300; // 1地点あたりの上限（APIは最大start=900まで）
  const count = 100;

  // 1ページ目
  const first = await fetchHotPepperShops(point.lat, point.lng, genreCode, keyword, 1, count);
  allShops.push(...first.shops);

  // ページング（最大3ページ = 300件）
  const totalAvailable = Math.min(first.resultsAvailable, maxShops);
  let start = count + 1;
  while (start <= totalAvailable) {
    const next = await fetchHotPepperShops(point.lat, point.lng, genreCode, keyword, start, count);
    allShops.push(...next.shops);
    start += count;
    // APIレート制限対策
    await new Promise(r => setTimeout(r, 200));
  }

  return allShops;
}

// ── Supabase upsert（重複はhotpepper_idで判定） ───────────────────────────────
async function upsertShops(
  shops: HotPepperShop[],
  config: (typeof SYNC_GENRE_CONFIGS)[number],
  dryRun: boolean
): Promise<{ inserted: number; updated: number; skipped: number }> {
  if (!supabase) return { inserted: 0, updated: 0, skipped: 0 };

  let inserted = 0, updated = 0, skipped = 0;

  // 重複チェック用にバッチでIDを確認
  const shopIds = shops.map(s => s.id);
  const { data: existing } = await supabase
    .from("places")
    .select("id, hotpepper_id, tags")
    .in("hotpepper_id", shopIds);

  const existingMap = new Map((existing ?? []).map(e => [e.hotpepper_id, e]));

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ dbId: string; record: Record<string, unknown> }> = [];

  for (const shop of shops) {
    const lat = parseFloat(shop.lat);
    const lng = parseFloat(shop.lng);
    if (isNaN(lat) || isNaN(lng)) { skipped++; continue; }

    const shopName = shop.name ?? "";
    const catchCopy = shop.catch ?? "";
    const genreCatch = shop.genre?.catch ?? "";
    const korean = isKoreanShop(shopName, catchCopy, genreCatch);
    const tags = assignTagsFromConfig(config, shopName, catchCopy, genreCatch, korean);

    if (tags.length === 0) { skipped++; continue; } // フィルタされた（例: asianにkoreashopが来た）

    const record: Record<string, unknown> = {
      name: shopName,
      address: shop.address ?? "",
      nearest_station: shop.station_name ?? null,
      lat,
      lng,
      hotpepper_id: shop.id,
      source_type: "hotpepper",
      tags,
      area: shop.address?.split("都").shift()?.split("道").shift()?.split("府").shift()?.split("県").shift() ?? null,
      description: catchCopy || genreCatch || null,
      photo_url: shop.photo?.pc?.l ?? shop.photo?.pc?.m ?? null,
      open_hours: shop.open ?? null,
      close_day: shop.close ?? null,
      budget: shop.budget?.average ?? null,
      hotpepper_url: shop.urls?.pc ?? null,
      is_active: true,
      report_count: 0,
    };

    const existingRecord = existingMap.get(shop.id);
    if (existingRecord) {
      // タグをマージ（既存タグを上書きしない、新タグを追加）
      const mergedTags = Array.from(new Set([...(existingRecord.tags ?? []), ...tags]));
      toUpdate.push({ dbId: existingRecord.id, record: { tags: mergedTags, photo_url: record.photo_url, open_hours: record.open_hours, budget: record.budget, is_active: true } });
      updated++;
    } else {
      toInsert.push(record);
      inserted++;
    }
  }

  if (!dryRun) {
    // INSERT（バッチで50件ずつ）
    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      await supabase.from("places").insert(batch);
    }

    // UPDATE（バッチで）
    for (const { dbId, record } of toUpdate) {
      await supabase.from("places").update(record).eq("id", dbId);
    }
  }

  return { inserted, updated, skipped };
}

// ── メインハンドラ ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body?.secret !== ADMIN_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!HOTPEPPER_API_KEY) {
      return NextResponse.json({ ok: false, error: "HOTPEPPER_API_KEY が設定されていません" }, { status: 500 });
    }

    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase が設定されていません" }, { status: 500 });
    }

    const { genreId, batchIndex = 0, batchSize = 20, dryRun = false } = body;

    const config = SYNC_GENRE_CONFIGS.find(c => c.id === genreId);
    if (!config) {
      return NextResponse.json({ ok: false, error: `ジャンルID "${genreId}" が見つかりません` }, { status: 400 });
    }

    const totalBatches = getTotalBatches(batchSize);
    const gridBatch = getGridBatch(batchIndex, batchSize);

    if (gridBatch.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "全バッチ完了",
        done: true,
        totalBatches,
        results: { inserted: 0, updated: 0, skipped: 0, pointsProcessed: 0 },
      });
    }

    // 各地点の店舗を収集
    const allShopsMap = new Map<string, HotPepperShop>(); // hotpepper_id → shop（重複排除）
    let pointsProcessed = 0;

    for (const point of gridBatch) {
      const shops = await fetchAllShopsForPoint(point, config.genreCode, config.keyword);
      for (const shop of shops) {
        if (shop.id) allShopsMap.set(shop.id, shop);
      }
      pointsProcessed++;
      // レート制限対策
      await new Promise(r => setTimeout(r, 300));
    }

    const uniqueShops = Array.from(allShopsMap.values());
    const results = await upsertShops(uniqueShops, config, dryRun);

    return NextResponse.json({
      ok: true,
      dryRun,
      genreId,
      genreLabel: config.label,
      batchIndex,
      totalBatches,
      done: batchIndex >= totalBatches - 1,
      pointsProcessed,
      uniqueShopsFetched: uniqueShops.length,
      results,
    });
  } catch (error) {
    console.error("[hotpepper-sync] Error:", error);
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}

// ── GET: ジャンル一覧と進捗取得 ──────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Supabaseからジャンル別の登録数を取得
  let genreStats: Record<string, number> = {};
  if (supabase) {
    const { data } = await supabase
      .from("places")
      .select("tags")
      .eq("source_type", "hotpepper")
      .eq("is_active", true);

    for (const place of data ?? []) {
      for (const tag of place.tags ?? []) {
        genreStats[tag] = (genreStats[tag] ?? 0) + 1;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    genres: SYNC_GENRE_CONFIGS.map(c => ({
      id: c.id,
      label: c.label,
      genreCode: c.genreCode,
      keyword: c.keyword,
      baseTags: c.baseTags,
      totalBatches: getTotalBatches(20),
    })),
    totalGridPoints: (await import("@/lib/hotpepper-sync-config")).JAPAN_GRID_POINTS.length,
    genreStats,
  });
}
