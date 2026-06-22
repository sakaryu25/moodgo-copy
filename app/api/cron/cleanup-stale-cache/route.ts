// ─── /api/cron/cleanup-stale-cache ───────────────────────────────────────────
// Vercel Cron が毎日呼び出す「Google由来コンテンツの30日TTL削除」エンドポイント。
//
// 【背景・ライセンス対応 2026-06-22】
//   Google Maps Platform 規約: place の rating / 営業時間 等のコンテンツは
//   最大30日までしかキャッシュできず、以後は更新 or 削除が必要。
//   検索時の writeback（route.ts schedulePlaceWriteBack）は rating_updated_at /
//   last_checked_at を都度更新して「鮮度」を保つが、検索されなくなった店の
//   キャッシュは放置すると30日を超えてしまう。本cronがその古いものを掃除する。
//   ※写真URLは writeback 自体を停止済み（恒久保存しない）。
//
//   - rating / rating_count: rating_updated_at が30日より古い行を NULL 化
//   - open_hours:            last_checked_at  が30日より古い行を NULL 化
//
//   検索で再ヒットした店は writeback がタイムスタンプを更新するため消えない
//   （＝アクティブな店の評価は鮮度を保ったまま規約準拠）。
//
// vercel.json の crons 設定で毎日 4:00 JST（19:00 UTC）に自動実行。

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TTL_DAYS = 30;

export async function GET(req: NextRequest) {
  // ── 認証: Vercel Cron の Authorization or 管理者シークレット ──
  const authHeader = req.headers.get("authorization");
  const urlSecret = new URL(req.url).searchParams.get("secret");
  const isVercelCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  const isAdminCall = urlSecret === ADMIN_SECRET;
  if (!isVercelCron && !isAdminCall) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase 未設定" }, { status: 500 });
  }

  const startedAt = new Date().toISOString();
  const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  console.log(`[cron/cleanup-stale-cache] 開始: ${startedAt} / cutoff=${cutoff}`);

  // ── 評価（Google content）: 30日より古いものを削除 ──
  let ratingCleared = 0;
  try {
    const { data, error } = await supabase
      .from("places")
      .update({ rating: null, rating_count: null, rating_updated_at: null })
      .lt("rating_updated_at", cutoff)
      .not("rating", "is", null)
      .select("id");
    if (error) throw error;
    ratingCleared = data?.length ?? 0;
  } catch (e) {
    console.error("[cron/cleanup-stale-cache] rating 掃除エラー", e);
  }

  // ── 営業時間（Google content）: 30日より古いものを削除 ──
  //   last_checked_at は閉業チェック(vitality-check)とも共有のため、
  //   vitality で更新された行は鮮度が延びる＝過剰保持の可能性は軽微（display専用情報）。
  let hoursCleared = 0;
  try {
    const { data, error } = await supabase
      .from("places")
      .update({ open_hours: null })
      .lt("last_checked_at", cutoff)
      .not("open_hours", "is", null)
      .select("id");
    if (error) throw error;
    hoursCleared = data?.length ?? 0;
  } catch (e) {
    console.error("[cron/cleanup-stale-cache] open_hours 掃除エラー", e);
  }

  const finishedAt = new Date().toISOString();
  console.log(
    `[cron/cleanup-stale-cache] 完了: rating=${ratingCleared}, open_hours=${hoursCleared}`,
  );

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt,
    ttlDays: TTL_DAYS,
    cutoff,
    ratingCleared,
    hoursCleared,
  });
}
