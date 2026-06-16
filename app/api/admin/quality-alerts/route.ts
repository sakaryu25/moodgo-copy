// ─── /api/admin/quality-alerts ───────────────────────────────────────────────
// ⑥ 品質劣化の自動検知: 低評価が続く 気分×エリア や、👎が偏る気分を集計して
// adminにアラートを返す（成長の逆＝退化の早期発見）。
//
// GET ?secret=<ADMIN_SECRET>
// 判定:
//   ・feedback: 同一 気分×エリア で件数>=3 かつ 平均星<=2.5 → アラート
//   ・mood_place_ratings: 気分単位で 総数>=5 かつ 👎率>=60% → アラート

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  const alerts: Array<{ type: string; key: string; detail: string; severity: "high" | "mid" }> = [];

  // ── 星評価（検索全体への満足度）の劣化検知 ─────────────────────────────────
  try {
    const { data } = await supabase
      .from("feedback")
      .select("mood, area, rating, created_at")
      .not("rating", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    const groups = new Map<string, { sum: number; n: number }>();
    for (const row of data ?? []) {
      const key = `${row.mood ?? "?"}×${(row.area ?? "").slice(0, 12) || "エリア不明"}`;
      const g = groups.get(key) ?? { sum: 0, n: 0 };
      g.sum += Number(row.rating) || 0; g.n++;
      groups.set(key, g);
    }
    for (const [key, g] of groups) {
      const avg = g.sum / g.n;
      if (g.n >= 3 && avg <= 2.5) {
        alerts.push({
          type: "low_star",
          key,
          detail: `検索結果の星評価が平均${avg.toFixed(1)}（${g.n}件）。検索品質の確認を推奨（npm run verify:search）`,
          severity: avg <= 1.8 ? "high" : "mid",
        });
      }
    }
  } catch { /* feedbackテーブル未作成は無視 */ }

  // ── 👎率の高い気分の検知 ──────────────────────────────────────────────────
  try {
    const { data } = await supabase
      .from("mood_place_ratings")
      .select("mood, verdict")
      .limit(5000);
    const byMood = new Map<string, { good: number; bad: number }>();
    for (const row of data ?? []) {
      const m = row.mood ?? "?";
      const g = byMood.get(m) ?? { good: 0, bad: 0 };
      if (row.verdict === "good") g.good++; else if (row.verdict === "bad") g.bad++;
      byMood.set(m, g);
    }
    for (const [m, g] of byMood) {
      const total = g.good + g.bad;
      const badRate = total > 0 ? g.bad / total : 0;
      if (total >= 5 && badRate >= 0.6) {
        alerts.push({
          type: "bad_heavy_mood",
          key: m,
          detail: `「${m}」の👎率が${Math.round(badRate * 100)}%（👍${g.good}/👎${g.bad}）。この気分の検索マップ・フィルタの見直しを推奨`,
          severity: badRate >= 0.75 ? "high" : "mid",
        });
      }
    }
  } catch { /* 無視 */ }

  return NextResponse.json({ ok: true, alerts, checkedAt: new Date().toISOString() });
}
