// ─── /api/cron/vitality-check ────────────────────────────────────────────────
// Vercel Cron が毎日自動的に呼び出す「閉業自動検知」エンドポイント
//
// ・Google Places API で businessStatus を確認
// ・CLOSED_PERMANENTLY → is_active = false（検索から自動除外）
// ・OPERATIONAL / CLOSED_TEMPORARILY → last_checked_at を更新
// ・1回あたり最大 50 件処理（Vercel の実行時間上限内に収まる量）
//
// vercel.json の crons 設定で毎朝 3:00 JST（18:00 UTC）に自動実行される

import { NextRequest, NextResponse } from "next/server";
import {
  fetchVitalityTargets,
  batchVitalityCheck,
} from "@/lib/place-vitality-check";
import { ADMIN_SECRET } from "@/lib/admin-auth";

// Vercel Cron が付与する Authorization ヘッダーの検証用
const CRON_SECRET   = process.env.CRON_SECRET   ?? "";
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const maxDuration = 300; // Vercel Pro: 最大 5 分

export async function GET(req: NextRequest) {
  // ── 認証: Vercel Cron の Authorization ヘッダー or 管理者シークレット ──
  const authHeader = req.headers.get("authorization");
  const urlSecret  = new URL(req.url).searchParams.get("secret");

  const isVercelCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  const isAdminCall  = urlSecret === ADMIN_SECRET;

  if (!isVercelCron && !isAdminCall) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!GOOGLE_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "GOOGLE_PLACES_API_KEY が未設定です。Vercel 環境変数を確認してください。" },
      { status: 500 }
    );
  }

  const startedAt = new Date().toISOString();
  console.log(`[cron/vitality-check] 開始: ${startedAt}`);

  // ── チェック対象を取得（直近 7 日以内に確認済みのスポットを除く） ──
  // closeable な source_type に限定されたため対象が大幅縮小。maxDuration=300 の範囲で
  //   1回あたりの処理量を増やしバックログ消化を加速（concurrency=5・5s timeout で十分収まる）。
  const targets = await fetchVitalityTargets(150);

  if (targets.length === 0) {
    console.log("[cron/vitality-check] チェック対象なし（全スポット確認済み）");
    return NextResponse.json({
      ok:      true,
      message: "チェック対象なし（全スポットが直近7日以内に確認済み）",
      startedAt,
      total:       0,
      deactivated: 0,
      updated:     0,
      skipped:     0,
    });
  }

  // ── Google Places API でバッチチェック ──
  const outcome = await batchVitalityCheck(targets, GOOGLE_API_KEY);

  console.log(
    `[cron/vitality-check] 完了: total=${outcome.total}, deactivated=${outcome.deactivated}, updated=${outcome.updated}`
  );

  // 閉業判定があった場合はサマリーをログに残す
  const deactivatedNames = outcome.results
    .filter(r => r.action === "deactivated")
    .map(r => r.name);
  if (deactivatedNames.length > 0) {
    console.log(`[cron/vitality-check] 閉業スポット除外: ${deactivatedNames.join(", ")}`);
  }

  return NextResponse.json({
    ok:          true,
    startedAt,
    finishedAt:  new Date().toISOString(),
    total:       outcome.total,
    deactivated: outcome.deactivated,
    updated:     outcome.updated,
    skipped:     outcome.skipped,
    deactivatedSpots: deactivatedNames,
  });
}
