// ─── /api/admin/vitality-check ───────────────────────────────────────────────
// 閉店・閉業スポットを自動排除する「自浄バッチ」エンドポイント
// Admin 画面のボタンから呼び出す（または Vercel Cron で自動実行）
//
// POST body:
//   secret      string   管理者パスワード
//   batchSize?  number   1回のチェック件数（デフォルト 30）
//   dryRun?     boolean  true なら DB 更新しない
//
// GET ?secret=... → 統計情報を返す

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  fetchVitalityTargets,
  batchVitalityCheck,
  type VitalityResult,
} from "@/lib/place-vitality-check";

const ADMIN_SECRET  = process.env.ADMIN_SECRET ?? "moodgoadmin123";
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const maxDuration = 300;

// ── POST: バッチ生存確認実行 ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body?.secret !== ADMIN_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!GOOGLE_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "GOOGLE_PLACES_API_KEY が未設定です。Vercel 環境変数を確認してください。" },
        { status: 500 }
      );
    }

    const batchSize: number = body.batchSize ?? 30;
    const dryRun: boolean   = body.dryRun ?? false;

    // 対象スポットを取得（全スポット種別: 飲食店・温泉・テーマパーク等）
    const targets = await fetchVitalityTargets(batchSize);

    if (targets.length === 0) {
      return NextResponse.json({
        ok:      true,
        message: "チェック対象なし（全スポットが最近チェック済みです）",
        total:   0,
        deactivated: 0,
        updated:     0,
        skipped:     0,
        results:     [],
      });
    }

    // ドライランの場合は DB 更新なし（プレビュー）
    let results: VitalityResult[];
    if (dryRun) {
      results = targets.map(t => ({
        id:     t.id,
        name:   t.name,
        status: "UNKNOWN" as const,
        action: "skipped" as const,
      }));
    } else {
      const outcome = await batchVitalityCheck(targets, GOOGLE_API_KEY);
      results = outcome.results;
    }

    const deactivated = results.filter(r => r.action === "deactivated").length;
    const updated     = results.filter(r => r.action === "updated").length;
    const skipped     = results.filter(r => r.action !== "deactivated" && r.action !== "updated").length;

    return NextResponse.json({
      ok:          true,
      dryRun,
      total:       targets.length,
      deactivated,
      updated,
      skipped,
      results: results.map(r => ({
        id:     r.id,
        name:   r.name,
        status: r.status,
        action: r.action,
      })),
    });
  } catch (err) {
    console.error("[vitality-check] Error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

// ── GET: 統計情報 ────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const url    = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  const [
    { count: totalActive },
    { count: totalInactive },
    { count: needsCheck },
    { count: checkedThisWeek },
  ] = await Promise.all([
    supabase.from("places").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("places").select("*", { count: "exact", head: true }).eq("is_active", false),
    supabase.from("places")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .or(`last_checked_at.is.null,last_checked_at.lt.${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()}`),
    supabase.from("places")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .gte("last_checked_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  // 最近閉業判定されたスポット（直近50件）
  const { data: recentDeactivated } = await supabase
    .from("places")
    .select("id, name, address, source_type, last_checked_at, updated_at")
    .eq("is_active", false)
    .order("updated_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    ok: true,
    stats: {
      totalActive:      totalActive ?? 0,
      totalInactive:    totalInactive ?? 0,
      needsCheck:       needsCheck ?? 0,
      checkedThisWeek:  checkedThisWeek ?? 0,
      googleApiReady:   !!GOOGLE_API_KEY,
    },
    recentDeactivated: recentDeactivated ?? [],
  });
}
