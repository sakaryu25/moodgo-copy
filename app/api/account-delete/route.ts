// ─── /api/account-delete ─────────────────────────────────────────────────────
// アプリ内アカウント/データ削除（App Store Guideline 5.1.1(v) 必須）。
// ログイン認証は無く device_id で識別するため、device_id に紐づく全UGCを削除する。
//   POST { deviceId } → suggestions/spot_posts/spot_photos(+Storage)/spot_ratings/
//     spot_post_reactions/spot_engagement/mood_group_members/mood_group_posts/
//     mood_group_reactions/reports/contacts/client_errors を削除＋user-iconsを削除。
// 各削除は個別 try/catch（テーブル未作成でも安全）。本人のデータのみ削除（他者の投稿は残す）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// device_id 列で本人データを持つテーブル
const TABLES_BY_DEVICE = [
  "suggestions", "spot_posts", "spot_post_reactions", "spot_ratings",
  "spot_engagement", "mood_group_members", "mood_group_posts", "mood_group_reactions",
  "reports", "contacts", "client_errors",
];

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (!rateLimit(`account-delete:${clientIp(req)}`, 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
  }
  const db = supabase;
  try {
    const body = await req.json().catch(() => null);
    const deviceId = String(body?.deviceId ?? "").trim();
    if (!deviceId) return NextResponse.json({ ok: false, error: "deviceId が必要です" }, { status: 400 });

    const deleted: Record<string, number | string> = {};

    // 1) spot_photos は Storage 実体も消す（先にパス取得→バケット削除→行削除）
    try {
      const { data: phRows } = await db.from("spot_photos").select("storage_path").eq("device_id", deviceId);
      const paths = (phRows ?? []).map(r => (r as { storage_path?: string }).storage_path).filter((p): p is string => !!p);
      if (paths.length > 0) await db.storage.from("spot-photos").remove(paths).then(() => {}, () => {});
      const { count } = await db.from("spot_photos").delete({ count: "exact" }).eq("device_id", deviceId);
      deleted["spot_photos"] = count ?? 0;
    } catch (e) { deleted["spot_photos"] = `skip(${String(e).slice(0, 40)})`; }

    // 2) その他の device_id 紐づきテーブルを順に削除
    for (const t of TABLES_BY_DEVICE) {
      try {
        const { count } = await db.from(t).delete({ count: "exact" }).eq("device_id", deviceId);
        deleted[t] = count ?? 0;
      } catch (e) { deleted[t] = `skip(${String(e).slice(0, 30)})`; }
    }

    // 3) プロフィール画像（user-icons/{deviceId}.jpg）
    try { await db.storage.from("user-icons").remove([`${deviceId}.jpg`]).then(() => {}, () => {}); deleted["user_icon"] = "removed"; }
    catch { deleted["user_icon"] = "skip"; }

    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    console.error("account-delete error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
