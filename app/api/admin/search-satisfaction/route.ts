// ── /api/admin/search-satisfaction (P27) ────────────────────────────────────
// search_metrics.search_id ⋈ spot_engagement.search_id を突合し、検索1回あたりの実満足度を集計する。
//   CTR(詳細閲覧に至った検索の割合) / ゼロクリック率 / 平均クリック順位 / お気に入り・来店率 を返す。
//   これが以降のランキング変更・A/B の良否判定の土台になる（合成スコアだけでは反応が見えない）。
// 認証: requireAdminFromReq(ADMIN_SECRET)。GET ?days=7&mood=... 。
//   ⚠ search_metrics.search_id は add-search-metrics-search-id.sql 適用後に埋まり始める＝適用前の検索は集計対象外。
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAdminFromReq } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EngRow = { search_id: string | null; action: string | null; position: number | null };
type MetRow = { search_id: string | null; mood: string | null };

export async function GET(req: NextRequest) {
  if (!requireAdminFromReq(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!supabase) return NextResponse.json({ ok: false, error: "no db" }, { status: 500 });
  const sb = supabase;
  const url = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
  const moodFilter = (url.searchParams.get("mood") ?? "").trim();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    // 検索側（search_id が埋まった行のみ）
    let mq = sb.from("search_metrics").select("search_id, mood").not("search_id", "is", null).gte("created_at", since).limit(20000);
    if (moodFilter) mq = mq.eq("mood", moodFilter);
    const { data: mets } = await mq;
    const metrics = (mets ?? []) as MetRow[];
    // 反応側
    const { data: engs } = await sb.from("spot_engagement")
      .select("search_id, action, position").not("search_id", "is", null).gte("created_at", since).limit(50000);
    const engagements = (engs ?? []) as EngRow[];

    // 検索 search_id → mood
    const searchMood = new Map<string, string>();
    for (const m of metrics) if (m.search_id) searchMood.set(m.search_id, m.mood ?? "");
    const totalSearches = searchMood.size;

    // 検索ごとの反応を集計（この期間の検索に紐づくものだけ）
    const perSearch = new Map<string, { actions: Set<string>; detailPos: number[] }>();
    const actionTotals: Record<string, number> = { detail_view: 0, favorite: 0, visited: 0, map_click: 0, share: 0 };
    for (const e of engagements) {
      const sid = e.search_id ?? "";
      if (!searchMood.has(sid)) continue;   // この期間の検索に対応しない反応は無視
      const a = e.action ?? "";
      if (a in actionTotals) actionTotals[a]++;
      let rec = perSearch.get(sid);
      if (!rec) { rec = { actions: new Set(), detailPos: [] }; perSearch.set(sid, rec); }
      rec.actions.add(a);
      if (a === "detail_view" && typeof e.position === "number") rec.detailPos.push(e.position);
    }

    let withDetail = 0, withAnyAction = 0;
    const allDetailPos: number[] = [];
    for (const rec of perSearch.values()) {
      withAnyAction++;
      if (rec.actions.has("detail_view")) withDetail++;
      allDetailPos.push(...rec.detailPos);
    }
    const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
    const avg = (xs: number[]) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

    // 気分別 CTR
    const byMoodAgg = new Map<string, { searches: number; withDetail: number }>();
    for (const [sid, mood] of searchMood) {
      const key = mood || "(未指定)";
      const g = byMoodAgg.get(key) ?? { searches: 0, withDetail: 0 };
      g.searches++;
      if (perSearch.get(sid)?.actions.has("detail_view")) g.withDetail++;
      byMoodAgg.set(key, g);
    }
    const byMood = [...byMoodAgg.entries()]
      .map(([mood, g]) => ({ mood, searches: g.searches, ctr: pct(g.withDetail, g.searches) }))
      .sort((a, b) => b.searches - a.searches);

    return NextResponse.json({
      ok: true,
      windowDays: days,
      totalSearches,
      ctrDetailPct: pct(withDetail, totalSearches),          // 詳細閲覧に至った検索の割合（主要KPI）
      anyActionPct: pct(withAnyAction, totalSearches),        // 何か反応した検索の割合
      zeroClickPct: pct(totalSearches - withAnyAction, totalSearches),  // 一切反応が無かった検索の割合
      avgDetailPosition: avg(allDetailPos),                  // 詳細を開いたスポットの平均掲載順位(0始まり・小さいほど上位が刺さっている)
      favoritePerSearch: pct(actionTotals.favorite, totalSearches),
      visitedPerSearch: pct(actionTotals.visited, totalSearches),
      actionTotals,
      byMood: byMood.slice(0, 20),
      note: totalSearches === 0
        ? "この期間の search_id 付き検索がまだありません（add-search-metrics-search-id.sql 適用＋デプロイ後に蓄積されます）。"
        : undefined,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
