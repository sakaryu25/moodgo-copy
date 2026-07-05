// ─── /api/admin/search-metrics ──────────────────────────────────────────────
// 検索メトリクスを集計し「Google 0回率」など Google依存度を可視化する（admin専用）。
//   GET ?secret=...&days=7
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const ADMIN = ADMIN_SECRET;

// Google Places API (New) の単価 → ¥換算。recommend の FIELD_MASK は rating/営業時間/priceLevel を
// 含むため Text/Nearby は Enterprise SKU、写真は Photo SKU。約 ¥150/$（レート/為替で変動＝ここを更新）。
const YEN_PER_USD = 150;
const PRICE_YEN = {
  searchText: 0.035 * YEN_PER_USD,  // ≈ ¥5.25
  nearby:     0.035 * YEN_PER_USD,  // ≈ ¥5.25
  photo:      0.007 * YEN_PER_USD,  // ≈ ¥1.05
  detail:     0.017 * YEN_PER_USD,  // ≈ ¥2.55 Place Details Pro（★評価取得。従来計上漏れ・監査2026-07-05）
};
// 内訳列が無い旧行は google_calls から概算（検索寄りの平均単価）
const FALLBACK_YEN_PER_CALL = 4;
const costYenOf = (r: {
  google_calls?: number | null; google_searchtext?: number | null;
  google_nearby?: number | null; google_photo?: number | null; google_detail?: number | null;
}): number => {
  const st = r.google_searchtext, nb = r.google_nearby, ph = r.google_photo;
  if (st == null && nb == null && ph == null) return (r.google_calls ?? 0) * FALLBACK_YEN_PER_CALL;
  return (st ?? 0) * PRICE_YEN.searchText + (nb ?? 0) * PRICE_YEN.nearby + (ph ?? 0) * PRICE_YEN.photo
    + (r.google_detail ?? 0) * PRICE_YEN.detail;
};

export async function GET(request: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== ADMIN) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const days = Math.min(Math.max(Number(searchParams.get("days") ?? 7), 1), 90);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  try {
    const { data, error } = await supabase
      .from("search_metrics")
      // 内訳列(google_searchtext等)がSQL未適用でも 42703 で落ちないよう全列取得。
      // costYenOf は欠損列を undefined 扱いして google_calls から概算するので安全。
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) {
      // 42P01=テーブル無し / 42703=列無し → どちらも「SQL実行して」を案内（真っ白回避）
      if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703") {
        return NextResponse.json({ ok: false, tableMissing: true, error: "search_metrics のテーブル/列が未作成（supabase/search-metrics.sql を実行）" });
      }
      throw error;
    }
    const rows = data ?? [];
    const n = rows.length;
    const zero = rows.filter(r => (r.google_calls ?? 0) === 0).length;
    const sumGoogle = rows.reduce((s, r) => s + (r.google_calls ?? 0), 0);
    const totalCostYen = rows.reduce((s, r) => s + costYenOf(r), 0);

    // 気分別の集計
    const byMood = new Map<string, { n: number; zero: number; sumGoogle: number; cost: number }>();
    for (const r of rows) {
      const k = r.mood || "(不明)";
      const e = byMood.get(k) ?? { n: 0, zero: 0, sumGoogle: 0, cost: 0 };
      e.n += 1;
      if ((r.google_calls ?? 0) === 0) e.zero += 1;
      e.sumGoogle += r.google_calls ?? 0;
      e.cost += costYenOf(r);
      byMood.set(k, e);
    }
    const moods = [...byMood.entries()]
      .map(([mood, e]) => ({
        mood,
        searches: e.n,
        googleZeroRate: e.n ? Math.round((e.zero / e.n) * 1000) / 10 : 0,
        avgGoogleCalls: e.n ? Math.round((e.sumGoogle / e.n) * 10) / 10 : 0,
        costYen: Math.round(e.cost),
      }))
      .sort((a, b) => b.searches - a.searches);

    return NextResponse.json({
      ok: true,
      days,
      totalSearches: n,
      googleZeroRate: n ? Math.round((zero / n) * 1000) / 10 : 0,   // %
      avgGoogleCallsPerSearch: n ? Math.round((sumGoogle / n) * 10) / 10 : 0,
      totalCostYen: Math.round(totalCostYen),                                  // 期間合計¥
      avgCostYenPerSearch: n ? Math.round((totalCostYen / n) * 10) / 10 : 0,   // 1検索あたり¥
      byMood: moods,
    });
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
