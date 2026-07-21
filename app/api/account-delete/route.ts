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
import { iconPathFor } from "@/lib/device-hash";

// ── 永続レート制限（api_cacheテーブル利用・Vercelの複数インスタンスでも回避不可）──
//   メモリ内rateLimitはサーバーレスでインスタンス毎に分離され回避可能（監査2026-07-05）。
//   破壊的操作のここだけは api_cache を日次カウンタとして使い、IP単位で確実に制限する。
//   api_cache 未作成でも安全に素通り（graceful degradation・その場合メモリ内制限のみ）。
async function persistentDailyLimit(key: string, max: number): Promise<boolean> {
  if (!supabase) return true;
  const day = new Date().toISOString().slice(0, 10);
  const cacheKey = `ratelimit:${key}:${day}`;
  try {
    const { data } = await supabase.from("api_cache").select("data").eq("cache_key", cacheKey).maybeSingle();
    const cur = Number((data?.data as { n?: number } | null)?.n ?? 0);
    if (cur >= max) return false;
    await supabase.from("api_cache").upsert(
      { cache_key: cacheKey, data: { n: cur + 1 }, expires_at: new Date(Date.now() + 86_400_000).toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "cache_key" },
    );
    return true;
  } catch { return true; }
}

// device_id 列で本人データを持つテーブル
const TABLES_BY_DEVICE = [
  "suggestions", "spot_posts", "spot_post_reactions", "spot_ratings",
  "spot_engagement", "mood_group_members", "mood_group_posts", "mood_group_reactions",
  "reports", "contacts", "client_errors", "user_handles",
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
    // deviceId=ベアラモデル（ログイン無し）のため、資格情報の秘匿(レスポンス非露出・生成の暗号強度化)と
    // 併せて、総当たり/嫌がらせを永続カウンタで抑止: 同一IPは1日10回まで（インスタンス分離でも回避不可）。
    if (!(await persistentDailyLimit(`acctdel:${clientIp(req)}`, 10))) {
      return NextResponse.json({ ok: false, error: "本日の削除リクエスト上限に達しました" }, { status: 429 });
    }

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

    // 3) プロフィール画像（新: ハッシュ名 / 旧: 生deviceId名 の両方を削除）
    try {
      await db.storage.from("user-icons").remove([iconPathFor(deviceId), `${deviceId}.jpg`]).then(() => {}, () => {});
      deleted["user_icon"] = "removed";
    } catch { deleted["user_icon"] = "skip"; }

    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    console.error("account-delete error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
