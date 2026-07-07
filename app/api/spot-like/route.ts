export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 投稿へのいいね（穴場 suggestions / Moodログ spot_posts 共通・2026-07-07）
 * POST /api/spot-like
 *   { action: "status", targetId, deviceId? }  … いいね数＋自分が押しているか
 *   { action: "like" | "unlike", targetId, deviceId }
 *
 * targetId は community-spot と同じ形式（suggestions=生UUID / Moodログ="ml-"+UUID）。
 * 実体は既存 spot_post_reactions(rtype='like') に一本化:
 *   - post_id には FK が無いため suggestion の UUID も同居できる（スキーマ変更不要）
 *   - unique(post_id, device_id, rtype) で二重いいね防止
 *   - 数は count で算出（suggestions に like_count 列を作らない）
 * Moodログは既存の spot_posts.like_count 表示と整合させるため counter も同時に増減する。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMissingTable(e: unknown): boolean {
  const code = String((e as { code?: string } | null)?.code ?? "");
  // 42P01=PostgreSQL / PGRST205,204=PostgRESTスキーマキャッシュ（spot-postsと同判定）
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
  const isMoodlog = rawTarget.startsWith("ml-");
  const postId = isMoodlog ? rawTarget.slice(3) : rawTarget;
  if (!UUID_RE.test(postId)) return NextResponse.json({ ok: false, error: "targetIdが不正です" }, { status: 400 });
  // リアクション種別: like=いいね / visited=行った！（どちらも同じ二重防止unique）
  const rtype = body?.rtype === "visited" ? "visited" : "like";

  try {
    if (action === "status") {
      // 両rtypeの数＋自分の押下状態を1往復で返す
      let count = 0, visitedCount = 0, liked = false, visited = false;
      try {
        const { data: rows, error } = await db.from("spot_post_reactions")
          .select("rtype, device_id").eq("post_id", postId).in("rtype", ["like", "visited"]);
        if (!error) {
          for (const r of (rows ?? []) as Array<{ rtype?: string; device_id?: string }>) {
            if (r.rtype === "like") { count++; if (deviceId && r.device_id === deviceId) liked = true; }
            else if (r.rtype === "visited") { visitedCount++; if (deviceId && r.device_id === deviceId) visited = true; }
          }
        }
      } catch { /* テーブル未適用は 0 / false */ }
      return NextResponse.json({ ok: true, liked, count, visited, visitedCount });
    }

    if (action !== "like" && action !== "unlike") {
      return NextResponse.json({ ok: false, error: "actionが不正です" }, { status: 400 });
    }
    if (!rateLimit(`spot-like:${clientIp(req)}`, 40, 60_000)) {
      return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
    }
    if (!deviceId) return NextResponse.json({ ok: false, error: "deviceIdが必要です" }, { status: 400 });

    if (action === "like") {
      const { error } = await db.from("spot_post_reactions").insert({ post_id: postId, device_id: deviceId, rtype });
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
        // 23505=リアクション済み → 成功扱い（カウンタは増やさない）
        if (String((error as { code?: string }).code) !== "23505") throw error;
      } else if (isMoodlog && rtype === "like") {
        // Moodログ既存表示(like_count)との整合。RPC→read+1フォールバック（spot-postsと同じ流儀）
        await db.rpc("increment_spot_post_counter", { p_post: postId, p_col: "like_count" }).then(() => {}, async () => {
          const { data } = await db.from("spot_posts").select("like_count").eq("id", postId).maybeSingle();
          const cur = (data as { like_count?: number } | null)?.like_count ?? 0;
          await db.from("spot_posts").update({ like_count: cur + 1 }).eq("id", postId).then(() => {}, () => {});
        });
      }
    } else {
      const { data: del, error } = await db.from("spot_post_reactions")
        .delete().match({ post_id: postId, device_id: deviceId, rtype }).select("id");
      if (error && isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
      if (isMoodlog && rtype === "like" && Array.isArray(del) && del.length > 0) {
        const { data } = await db.from("spot_posts").select("like_count").eq("id", postId).maybeSingle();
        const cur = (data as { like_count?: number } | null)?.like_count ?? 0;
        await db.from("spot_posts").update({ like_count: Math.max(0, cur - 1) }).eq("id", postId).then(() => {}, () => {});
      }
    }

    const { count } = await db.from("spot_post_reactions")
      .select("id", { count: "exact", head: true }).eq("post_id", postId).eq("rtype", rtype);
    return NextResponse.json({ ok: true, liked: action === "like", rtype, count: count ?? 0 });
  } catch (e) {
    console.error("[spot-like]", e);
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
