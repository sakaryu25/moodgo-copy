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
import { handlesByDevice, deviceByHandle } from "@/lib/user-handles";
import { hiddenHashesFor } from "@/lib/blocks";
import { sendPushToDevice } from "@/lib/push-send";
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
      // parent_id/like_count 列が無い(未適用)環境も動くよう、フル→42703で基本列にフォールバック
      const FULL = "id, device_id, body, created_at, parent_id, like_count";
      const BASE = "id, device_id, body, created_at";
      const buildList = (cols: string) => db.from("spot_comments").select(cols)
        .eq("post_id", postId).eq("status", "visible").order("created_at", { ascending: false }).limit(200);
      let { data, error } = await buildList(FULL);
      if (error && (error as { code?: string }).code === "42703") ({ data, error } = await buildList(BASE));
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: true, ready: false, items: [] });
        throw error;
      }
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      const handleMap = await handlesByDevice(db, rows.map(r => String(r.device_id ?? "")));
      const hidden = await hiddenHashesFor(db, deviceId);   // ブロック/ミュートした相手のコメントを隠す
      // 自分がいいねしたコメント
      const likedSet = new Set<string>();
      if (deviceId && rows.length) {
        try {
          const { data: lk } = await db.from("spot_comment_reactions").select("comment_id")
            .eq("device_id", deviceId).in("comment_id", rows.map(r => String(r.id)));
          for (const l of (lk ?? []) as Array<{ comment_id?: string }>) if (l.comment_id) likedSet.add(String(l.comment_id));
        } catch { /* 未適用は空 */ }
      }
      const vHour = Math.floor(Date.now() / 3_600_000);
      const items = rows.filter(r => !hidden.has(deviceHash(String(r.device_id ?? "")))).map(r => {
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
          parentId: r.parent_id ? String(r.parent_id) : null,
          likeCount: Number(r.like_count) || 0,
          liked: likedSet.has(String(r.id)),
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
      const parentId = String(body?.parentId ?? "").trim();
      const insertRow: Record<string, unknown> = { post_id: postId, device_id: deviceId, body: text };
      if (UUID_RE.test(parentId)) insertRow.parent_id = parentId;
      let { data, error } = await db.from("spot_comments").insert(insertRow).select("id, created_at").single();
      if (error && (error as { code?: string }).code === "42703" && insertRow.parent_id) {
        delete insertRow.parent_id;   // parent_id列が未適用なら通常コメントとして投稿
        ({ data, error } = await db.from("spot_comments").insert(insertRow).select("id, created_at").single());
      }
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: false, ready: false, error: "コメント機能は準備中です" }, { status: 400 });
        throw error;
      }
      // 通知: 返信なら親コメント主へ、通常なら投稿者へ（自分は除く）
      try {
        if (UUID_RE.test(parentId)) {
          const { data: parent } = await db.from("spot_comments").select("device_id").eq("id", parentId).maybeSingle();
          const pdev = (parent as { device_id?: string } | null)?.device_id;
          if (pdev && pdev !== deviceId) await sendPushToDevice(pdev, { title: "MoodGo", body: "あなたのコメントに返信がつきました", data: { type: "reply", postId: rawTarget } });
        } else {
          const isMl = rawTarget.startsWith("ml-");
          const { data: owner } = await db.from(isMl ? "spot_posts" : "suggestions").select("device_id").eq("id", postId).maybeSingle();
          const ownerId = (owner as { device_id?: string } | null)?.device_id;
          if (ownerId && ownerId !== deviceId) await sendPushToDevice(ownerId, { title: "MoodGo", body: "あなたの投稿にコメントがつきました", data: { type: "comment", postId: rawTarget } });
        }
      } catch { /* 通知失敗は無視 */ }
      // @メンション通知（本文中の @id を解決して各人へ・自分は除く）
      try {
        const mentions = [...new Set((text.match(/@([A-Za-z0-9_]{3,20})/g) ?? []).map((m) => m.slice(1).toLowerCase()))].slice(0, 5);
        for (const h of mentions) {
          const mdev = await deviceByHandle(db, h);
          if (mdev && mdev !== deviceId) await sendPushToDevice(mdev, { title: "MoodGo", body: "コメントであなたにメンションしました", data: { type: "mention", postId: rawTarget } });
        }
      } catch { /* 無視 */ }
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

    // ── コメントいいね（トグル）──
    if (action === "like") {
      const commentId = String(body?.commentId ?? "").trim();
      if (!UUID_RE.test(commentId) || !deviceId) return NextResponse.json({ ok: false, error: "パラメータが不正です" }, { status: 400 });
      try {
        const { data: ex } = await db.from("spot_comment_reactions").select("id").match({ comment_id: commentId, device_id: deviceId }).maybeSingle();
        let liked: boolean;
        if (ex) {
          await db.from("spot_comment_reactions").delete().match({ comment_id: commentId, device_id: deviceId });
          liked = false;
        } else {
          const { error } = await db.from("spot_comment_reactions").insert({ comment_id: commentId, device_id: deviceId });
          if (error) {
            if (isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
            if (String((error as { code?: string }).code) !== "23505") throw error;   // 23505=いいね済み
          }
          liked = true;
        }
        const { count } = await db.from("spot_comment_reactions").select("id", { count: "exact", head: true }).eq("comment_id", commentId);
        await db.from("spot_comments").update({ like_count: count ?? 0 }).eq("id", commentId).then(() => {}, () => {});
        return NextResponse.json({ ok: true, liked, count: count ?? 0 });
      } catch (e) {
        if (isMissingTable(e)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
        throw e;
      }
    }

    return NextResponse.json({ ok: false, error: "actionが不正です" }, { status: 400 });
  } catch (e) {
    console.error("[spot-comments]", e);
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
