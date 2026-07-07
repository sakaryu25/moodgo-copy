export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * フォロー機能（2026-07-07）
 * POST /api/user-follows
 *   { action: "follow" | "unfollow", deviceId, targetId }   … フォロー/解除
 *   { action: "status", targetId, deviceId? }                … 対象の フォロワー/フォロー中 数＋自分がフォロー中か
 *   { action: "me", deviceId }                               … 自分の フォロワー/フォロー中 数（プロフィール用）
 *
 * ⚠ device_id はベアラ資格情報。保存・返却は deviceHash(sha256先頭16) のみ。
 *    targetId はクライアントが持つ公開ハッシュ(poster_id)を受ける。
 *    user_follows テーブル未適用(42P01)でも安全に動く（読み=0件・書き=tableMissing）。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash } from "@/lib/device-hash";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const HASH_RE = /^[0-9a-f]{16}$/;

function isMissingTable(e: unknown): boolean {
  return String((e as { code?: string } | null)?.code ?? "") === "42P01";
}

async function counts(db: NonNullable<typeof supabase>, hash: string): Promise<{ followers: number; following: number }> {
  try {
    const [fer, fee] = await Promise.all([
      db.from("user_follows").select("id", { count: "exact", head: true }).eq("followee_hash", hash),
      db.from("user_follows").select("id", { count: "exact", head: true }).eq("follower_hash", hash),
    ]);
    if (isMissingTable(fer.error) || isMissingTable(fee.error)) return { followers: 0, following: 0 };
    return { followers: fer.count ?? 0, following: fee.count ?? 0 };
  } catch { return { followers: 0, following: 0 }; }
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSONが不正です" }, { status: 400 }); }

  const action = String(body?.action ?? "");
  const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
  const targetId = String(body?.targetId ?? "").trim().toLowerCase();

  try {
    // ── 自分の数（プロフィール画面）──
    if (action === "me") {
      if (!deviceId) return NextResponse.json({ ok: false, error: "deviceIdが必要です" }, { status: 400 });
      const me = deviceHash(deviceId);
      const c = await counts(db, me);
      return NextResponse.json({ ok: true, followerCount: c.followers, followingCount: c.following });
    }

    if (!HASH_RE.test(targetId)) return NextResponse.json({ ok: false, error: "targetIdが不正です" }, { status: 400 });

    // ── 対象の数＋自分のフォロー状態 ──
    if (action === "status") {
      const c = await counts(db, targetId);
      let following = false;
      if (deviceId) {
        try {
          const { data, error } = await db.from("user_follows").select("id")
            .eq("follower_hash", deviceHash(deviceId)).eq("followee_hash", targetId).maybeSingle();
          if (!error && data) following = true;
        } catch { /* テーブル未適用は false のまま */ }
      }
      return NextResponse.json({ ok: true, following, followerCount: c.followers, followingCount: c.following });
    }

    // ── フォロー/解除（書き込み・要deviceId）──
    if (action === "follow" || action === "unfollow") {
      if (!rateLimit(`follow:${clientIp(req)}`, 30, 60_000)) {
        return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
      }
      if (!deviceId) return NextResponse.json({ ok: false, error: "deviceIdが必要です" }, { status: 400 });
      const me = deviceHash(deviceId);
      if (me === targetId) return NextResponse.json({ ok: false, error: "自分はフォローできません" }, { status: 400 });

      if (action === "follow") {
        const { error } = await db.from("user_follows").insert({ follower_hash: me, followee_hash: targetId });
        if (error) {
          if (isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
          // 23505=既にフォロー済み → 成功扱い
          if (String((error as { code?: string }).code) !== "23505") throw error;
        }
      } else {
        const { error } = await db.from("user_follows").delete()
          .match({ follower_hash: me, followee_hash: targetId });
        if (error && isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
      }
      const c = await counts(db, targetId);
      return NextResponse.json({ ok: true, following: action === "follow", followerCount: c.followers, followingCount: c.following });
    }

    return NextResponse.json({ ok: false, error: "actionが不正です" }, { status: 400 });
  } catch (e) {
    console.error("[user-follows]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
