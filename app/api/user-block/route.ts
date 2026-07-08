export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * ブロック / ミュート（2026-07-08）
 * POST /api/user-block
 *   { action: "block"|"mute"|"unblock"|"unmute", deviceId, targetId }  … 付与/解除
 *   { action: "list", deviceId }                                        … 自分のブロック/ミュート一覧
 *
 * ⚠ device_id はベアラ資格情報。保存/返却は deviceHash(sha256先頭16)のみ。
 *   targetId はクライアントが持つ公開ハッシュ(poster_id)を受ける。
 *   user_blocks 未適用(42P01/PGRST205)でも安全に動く（読み=空・書き=tableMissing）。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash } from "@/lib/device-hash";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const HASH_RE = /^[0-9a-f]{16}$/;

function isMissingTable(e: unknown): boolean {
  const code = String((e as { code?: string } | null)?.code ?? "");
  return code === "42P01" || code === "PGRST205" || code === "PGRST204";
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSONが不正です" }, { status: 400 }); }

  const action = String(body?.action ?? "");
  const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
  const targetId = String(body?.targetId ?? "").trim().toLowerCase();
  if (!deviceId) return NextResponse.json({ ok: false, error: "deviceIdが必要です" }, { status: 400 });
  const me = deviceHash(deviceId);

  try {
    // ── 自分のブロック/ミュート一覧（クライアントのフィード/コメント除外に使う）──
    if (action === "list") {
      try {
        const { data, error } = await db.from("user_blocks").select("blocked_hash, kind").eq("blocker_hash", me);
        if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, blocked: [], muted: [] }); throw error; }
        const blocked: string[] = [], muted: string[] = [];
        for (const r of (data ?? []) as Array<{ blocked_hash?: string; kind?: string }>) {
          if (r.kind === "mute") muted.push(String(r.blocked_hash));
          else blocked.push(String(r.blocked_hash));
        }
        return NextResponse.json({ ok: true, blocked, muted });
      } catch { return NextResponse.json({ ok: true, blocked: [], muted: [] }); }
    }

    if (!HASH_RE.test(targetId)) return NextResponse.json({ ok: false, error: "targetIdが不正です" }, { status: 400 });
    if (me === targetId) return NextResponse.json({ ok: false, error: "自分は対象にできません" }, { status: 400 });
    if (!rateLimit(`block:${clientIp(req)}`, 40, 60_000)) {
      return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
    }

    // ── ブロック/ミュート（upsertでkindを更新）──
    if (action === "block" || action === "mute") {
      const kind = action === "block" ? "block" : "mute";
      const { error } = await db.from("user_blocks")
        .upsert({ blocker_hash: me, blocked_hash: targetId, kind }, { onConflict: "blocker_hash,blocked_hash" });
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
        throw error;
      }
      // ブロックは相互フォローを解除（審査要件の“遮断”）。ミュートは関係を保つ。
      if (kind === "block") {
        try {
          await db.from("user_follows").delete().match({ follower_hash: me, followee_hash: targetId });
          await db.from("user_follows").delete().match({ follower_hash: targetId, followee_hash: me });
        } catch { /* user_follows未適用は無視 */ }
      }
      return NextResponse.json({ ok: true, kind });
    }

    // ── 解除 ──
    if (action === "unblock" || action === "unmute") {
      const { error } = await db.from("user_blocks").delete().match({ blocker_hash: me, blocked_hash: targetId });
      if (error && isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "actionが不正です" }, { status: 400 });
  } catch (e) {
    console.error("[user-block]", e);
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
