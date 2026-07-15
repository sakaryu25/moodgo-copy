// ── /api/admin/learning-insights ─────────────────────────────────────────────
// 🧠 学習インサイト（2026-07-15）: 今の検索ランキングが「実際に学習に使っている信号」を可視化する。
//   recommend の learnScore は place_mood_affinity（行動の原子加算）を最優先で読む。
//   従来の統計(/api/feedback mode=all)は feedback テーブル(★評価)だけで、
//   エンゲージメント/アフィニティ/Moodログ(spot_posts) は全く映っていなかった。
//   ここでは検索改善に直結する「気分×場所」の学習状態を集約して返す（読み取り専用）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const WEIGHT: Record<string, number> = { visited: 5, favorite: 3, share: 3, detail_view: 1, map_click: 1 };

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const days = Math.min(Math.max(Number(body?.days ?? 30), 1), 365);
  const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
  const out: Record<string, unknown> = { ok: true, days };

  // ① エンゲージメント: 行動別件数＋気分別ボリューム（検索の学習の一次ソース）
  try {
    const { data } = await db.from("spot_engagement")
      .select("action, mood, place_name, created_at").gte("created_at", sinceIso).limit(20000);
    const rows = (data ?? []) as Array<{ action: string; mood: string | null; place_name: string | null }>;
    const byAction: Record<string, number> = {};
    const byMood: Record<string, { count: number; weighted: number }> = {};
    for (const r of rows) {
      byAction[r.action] = (byAction[r.action] ?? 0) + 1;
      if (r.mood) {
        const m = byMood[r.mood] ?? { count: 0, weighted: 0 };
        m.count += 1; m.weighted += WEIGHT[r.action] ?? 1;
        byMood[r.mood] = m;
      }
    }
    out.engagement = {
      total: rows.length,
      byAction,
      topMoods: Object.entries(byMood).map(([mood, v]) => ({ mood, ...v }))
        .sort((a, b) => b.weighted - a.weighted).slice(0, 12),
    };
  } catch { out.engagement = null; }

  // ② アフィニティ: 気分×場所の学習済みスコア上位（recommend が最優先で読む＝ランキングの実体）
  try {
    const { data } = await db.from("place_mood_affinity")
      .select("place_name, mood, score, updated_at").order("score", { ascending: false }).limit(400);
    const rows = (data ?? []) as Array<{ place_name: string; mood: string; score: number; updated_at: string }>;
    const byMood = new Map<string, Array<{ place: string; score: number }>>();
    for (const r of rows) {
      const arr = byMood.get(r.mood) ?? [];
      if (arr.length < 5) arr.push({ place: r.place_name, score: r.score });
      byMood.set(r.mood, arr);
    }
    out.affinity = {
      rowCount: rows.length,
      byMood: [...byMood.entries()].map(([mood, top]) => ({ mood, top }))
        .sort((a, b) => (b.top[0]?.score ?? 0) - (a.top[0]?.score ?? 0)).slice(0, 12),
    };
  } catch { out.affinity = null; }

  // ③ Moodログ(spot_posts): 今のメイン投稿機能。気分タグ頻度・評価・写真率＝検索の新しい学習源
  try {
    const { data } = await db.from("spot_posts")
      .select("id, mood_tags, rating, created_at, place_name")
      .eq("status", "approved").in("visibility", ["public", "spot_public_anonymous"])
      .gte("created_at", sinceIso).limit(5000);
    const rows = (data ?? []) as Array<{ id: string; mood_tags: string[] | null; rating: number | null; place_name: string | null }>;
    const tagCount: Record<string, number> = {};
    let ratingSum = 0, ratingN = 0;
    for (const r of rows) {
      for (const t of (Array.isArray(r.mood_tags) ? r.mood_tags : [])) tagCount[String(t)] = (tagCount[String(t)] ?? 0) + 1;
      if (typeof r.rating === "number" && r.rating >= 1) { ratingSum += r.rating; ratingN += 1; }
    }
    // 写真率
    let withPhoto = 0;
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const { data: ph } = await db.from("spot_photos").select("post_id").in("post_id", ids).neq("moderation_status", "hidden");
      const hasPhoto = new Set((ph ?? []).map((x: { post_id: string }) => String(x.post_id)));
      withPhoto = rows.filter(r => hasPhoto.has(r.id)).length;
    }
    out.moodlog = {
      total: rows.length,
      avgRating: ratingN > 0 ? Math.round((ratingSum / ratingN) * 10) / 10 : null,
      photoRate: rows.length > 0 ? Math.round((withPhoto / rows.length) * 100) : 0,
      topTags: Object.entries(tagCount).map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count).slice(0, 15),
    };
  } catch { out.moodlog = null; }

  // ④ 検索パフォーマンス: コスト/速度/キャッシュ源の内訳（search_metrics）
  try {
    const { data } = await db.from("search_metrics")
      .select("google_calls, total_calls, rec_count, source, elapsed_ms, mood, created_at")
      .gte("created_at", sinceIso).limit(10000);
    const rows = (data ?? []) as Array<{ google_calls: number | null; rec_count: number | null; source: string | null; elapsed_ms: number | null }>;
    const n = rows.length || 1;
    const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
    const bySource: Record<string, number> = {};
    for (const r of rows) bySource[r.source ?? "?"] = (bySource[r.source ?? "?"] ?? 0) + 1;
    out.searchPerf = {
      searches: rows.length,
      avgGoogleCalls: Math.round((sum(r => r.google_calls ?? 0) / n) * 10) / 10,
      avgRecCount: Math.round((sum(r => r.rec_count ?? 0) / n) * 10) / 10,
      avgElapsedMs: Math.round(sum(r => r.elapsed_ms ?? 0) / n),
      bySource,
      // source=snapshot/legacy等の比率（キャッシュ活用度の目安）
    };
  } catch { out.searchPerf = null; }

  return NextResponse.json(out);
}
