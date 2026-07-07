export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 投稿へのコメント（1階層・返信なし・2026-07-08）
 * POST /api/spot-comments
 *   { action:"list",   targetId, deviceId? }            … 一覧（新着順・自分のものはmine=true）
 *   { action:"create", targetId, deviceId, body }       … 追加（NGワード・1〜200文字・rate limit）
 *   { action:"delete", commentId, deviceId }            … 自分のコメント削除
 *   { action:"report", commentId, deviceId }            … 通報（3件で自動非表示）
 *
 * targetId は community-spot と同形式（suggestions=UUID / Moodログ="ml-"+UUID）。
 * テーブル未適用(42P01/PGRST205)は ready:false を返しクライアントは「準備中」を表示。
 * ⚠ コメント者は deviceHash / @handle / ハッシュ名アイコンのみ返す（生device_id不返却）。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash, iconPathFor } from "@/lib/device-hash";
import { handlesByDevice } from "@/lib/user-handles";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { findNgWord } from "@/lib/ngwords";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORT_HIDE_THRESHOLD = 3;

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
  const rawTarget = String(body?.targetId ?? "").trim();
  const postId = rawTarget.startsWith("ml-") ? rawTarget.slice(3) : rawTarget;

  try {
    // ── 一覧 ──
    if (action === "list") {
      if (!UUID_RE.test(postId)) return NextResponse.json({ ok: false, error: "targetIdが不正です" }, { status: 400 });
      const { data, error } = await db.from("spot_comments")
        .select("id, device_id, body, created_at")
        .eq("post_id", postId).eq("status", "visible")
        .order("created_at", { ascending: false }).limit(100);
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: true, ready: false, items: [] });
        throw error;
      }
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const handleMap = await handlesByDevice(db, rows.map(r => String(r.device_id ?? "")));
      const vHour = Math.floor(Date.now() / 3_600_000);
      const items = rows.map(r => {
        const dev = String(r.device_id ?? "");
        const { data: pub } = db.storage.from("user-icons").getPublicUrl(iconPathFor(dev));
        return {
          id: String(r.id),
          body: String(r.body ?? ""),
          created_at: r.created_at,
          handle: handleMap.get(dev) ?? null,
          posterId: deviceHash(dev),
          icon: `${pub.publicUrl}?v=${vHour}`,
          mine: !!deviceId && dev === deviceId,   // 本人のみ削除ボタンを出す
        };
      });
      return NextResponse.json({ ok: true, ready: true, items });
    }

    // ── 追加 ──
    if (action === "create") {
      if (!rateLimit(`spot-comment:${clientIp(req)}`, 15, 60_000)) {
        return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
      }
      if (!UUID_RE.test(postId)) return NextResponse.json({ ok: false, error: "targetIdが不正です" }, { status: 400 });
      if (!deviceId) return NextResponse.json({ ok: false, error: "deviceIdが必要です" }, { status: 400 });
      const text = String(body?.body ?? "").trim().slice(0, 200);
      if (text.length < 1) return NextResponse.json({ ok: false, error: "コメントを入力してください" }, { status: 400 });
      const ng = findNgWord(text);
      if (ng) return NextResponse.json({ ok: false, error: "不適切な表現が含まれています" }, { status: 400 });
      const { data, error } = await db.from("spot_comments")
        .insert({ post_id: postId, device_id: deviceId, body: text })
        .select("id, created_at").single();
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: false, ready: false, error: "コメント機能は準備中です" }, { status: 400 });
        throw error;
      }
      return NextResponse.json({ ok: true, id: (data as { id?: string })?.id, created_at: (data as { created_at?: string })?.created_at });
    }

    // ── 自分のコメント削除 ──
    if (action === "delete") {
      const commentId = String(body?.commentId ?? "").trim();
      if (!UUID_RE.test(commentId) || !deviceId) return NextResponse.json({ ok: false, error: "パラメータが不正です" }, { status: 400 });
      const { data: del, error } = await db.from("spot_comments")
        .delete().match({ id: commentId, device_id: deviceId }).select("id");
      if (error && isMissingTable(error)) return NextResponse.json({ ok: false, ready: false }, { status: 400 });
      return NextResponse.json({ ok: true, removed: Array.isArray(del) && del.length > 0 });
    }

    // ── 通報（閾値で自動非表示）──
    if (action === "report") {
      const commentId = String(body?.commentId ?? "").trim();
      if (!UUID_RE.test(commentId) || !deviceId) return NextResponse.json({ ok: false, error: "パラメータが不正です" }, { status: 400 });
      const { data: row } = await db.from("spot_comments").select("report_count").eq("id", commentId).maybeSingle();
      const next = ((row as { report_count?: number } | null)?.report_count ?? 0) + 1;
      const patch: Record<string, unknown> = { report_count: next };
      if (next >= REPORT_HIDE_THRESHOLD) patch.status = "hidden";
      await db.from("spot_comments").update(patch).eq("id", commentId).then(() => {}, () => {});
      return NextResponse.json({ ok: true, hidden: next >= REPORT_HIDE_THRESHOLD });
    }

    return NextResponse.json({ ok: false, error: "actionが不正です" }, { status: 400 });
  } catch (e) {
    console.error("[spot-comments]", e);
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
