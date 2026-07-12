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

  // ── api_cache: 期限切れ行の物理削除 ──
  //   読み側(ltCacheGetMany等)は expires_at>now でフィルタするだけで削除はどこにも無く、
  //   キー世代交代で二度と読まれない行が無限に溜まる（2026-07-06監査: 期限切れ617行滞留）。
  let cacheCleared = 0;
  try {
    const { data, error } = await supabase
      .from("api_cache")
      .delete()
      .lt("expires_at", startedAt)
      .select("cache_key");
    if (error) throw error;
    cacheCleared = data?.length ?? 0;
  } catch (e) {
    console.error("[cron/cleanup-stale-cache] api_cache 掃除エラー", e);
  }

  // ── 期間限定イベント派生スポット: 開催期間(available_until)が過ぎたものを完全削除 ──
  //   「イベント名＠元スポット」を新スポット化したもの(source_type=user・name に全角＠を含む)。
  //   親(元スポット)は別レコードなので消えない。写真(ストレージ含む)・投稿・コメント・評価・
  //   リアクションごと丸ごとハード削除する。列(available_until)未適用環境では try/catch でスキップ。
  let eventsDeleted = 0;
  try {
    const today = startedAt.slice(0, 10);   // YYYY-MM-DD（available_until は YYYY-MM-DD 保存）
    const { data: expired, error: exErr } = await supabase
      .from("places")
      .select("id")
      .eq("source_type", "user")
      .like("name", "%＠%")
      .not("available_until", "is", null)
      .lt("available_until", today);
    if (exErr) throw exErr;
    const ids = ((expired ?? []) as Array<{ id: string }>).map((r) => String(r.id));
    if (ids.length > 0) {
      // 写真ストレージ（本体＋_thumb）を先に削除
      const { data: phs } = await supabase.from("spot_photos").select("storage_path").in("place_id", ids);
      const paths = ((phs ?? []) as Array<{ storage_path?: string | null }>).map((p) => p.storage_path).filter(Boolean) as string[];
      if (paths.length > 0) {
        const allPaths = paths.flatMap((p) => [p, p.replace(/\.jpg$/, "_thumb.jpg")]);
        await supabase.storage.from("spot-photos").remove(allPaths).then(() => {}, () => {});
      }
      // 派生スポットに紐づく投稿→そのリアクション/コメントを削除
      const { data: posts } = await supabase.from("spot_posts").select("id").in("place_id", ids);
      const postIds = ((posts ?? []) as Array<{ id: string }>).map((p) => String(p.id));
      if (postIds.length > 0) {
        await supabase.from("spot_post_reactions").delete().in("post_id", postIds).then(() => {}, () => {});
        await supabase.from("spot_comments").delete().in("post_id", postIds).then(() => {}, () => {});
      }
      await supabase.from("spot_photos").delete().in("place_id", ids).then(() => {}, () => {});
      await supabase.from("spot_posts").delete().in("place_id", ids).then(() => {}, () => {});
      await supabase.from("spot_ratings").delete().in("place_id", ids).then(() => {}, () => {});
      const { data: del } = await supabase.from("places").delete().in("id", ids).select("id");
      eventsDeleted = del?.length ?? ids.length;
    }
  } catch (e) {
    console.error("[cron/cleanup-stale-cache] 期間限定イベント掃除エラー", e);
  }

  const finishedAt = new Date().toISOString();
  console.log(
    `[cron/cleanup-stale-cache] 完了: rating=${ratingCleared}, open_hours=${hoursCleared}, api_cache=${cacheCleared}, events=${eventsDeleted}`,
  );

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt,
    ttlDays: TTL_DAYS,
    cutoff,
    ratingCleared,
    hoursCleared,
    cacheCleared,
    eventsDeleted,
  });
}
