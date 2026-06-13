// ─── /api/admin/search-metrics ──────────────────────────────────────────────
// 検索メトリクスを集計し「Google 0回率」など Google依存度を可視化する（admin専用）。
//   GET ?secret=...&days=7
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN = "moodgoadmin123";

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
      .select("mood, deep_dive, google_calls, rec_count, source, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return NextResponse.json({ ok: false, tableMissing: true, error: "search_metrics 未作成（supabase/search-metrics.sql を実行）" });
      }
      throw error;
    }
    const rows = data ?? [];
    const n = rows.length;
    const zero = rows.filter(r => (r.google_calls ?? 0) === 0).length;
    const sumGoogle = rows.reduce((s, r) => s + (r.google_calls ?? 0), 0);

    // 気分別の集計
    const byMood = new Map<string, { n: number; zero: number; sumGoogle: number }>();
    for (const r of rows) {
      const k = r.mood || "(不明)";
      const e = byMood.get(k) ?? { n: 0, zero: 0, sumGoogle: 0 };
      e.n += 1;
      if ((r.google_calls ?? 0) === 0) e.zero += 1;
      e.sumGoogle += r.google_calls ?? 0;
      byMood.set(k, e);
    }
    const moods = [...byMood.entries()]
      .map(([mood, e]) => ({
        mood,
        searches: e.n,
        googleZeroRate: e.n ? Math.round((e.zero / e.n) * 1000) / 10 : 0,
        avgGoogleCalls: e.n ? Math.round((e.sumGoogle / e.n) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.searches - a.searches);

    return NextResponse.json({
      ok: true,
      days,
      totalSearches: n,
      googleZeroRate: n ? Math.round((zero / n) * 1000) / 10 : 0,   // %
      avgGoogleCallsPerSearch: n ? Math.round((sumGoogle / n) * 10) / 10 : 0,
      byMood: moods,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
