// ─── /api/admin/report-action ─────────────────────────────────────────────────
// 通報された「ユーザー投稿」を admin が確認して処分するAPI（adminの⚠不適切報告タブ用）。
//   通報(reports)の note に入る [post:UUID] マーカーから対象投稿を特定する。
//   POST {secret, action, postId?, reportId?}
//     inspect : 投稿の中身を返す（moodlog=spot_posts / suggestion=suggestions を自動判別）
//     hide    : 非表示（status='hidden'・写真も hidden）＝可逆
//     restore : 非表示を解除（status='approved' に戻す）
//     delete  : 完全削除（写真Storage/リアクション/コメント/通報ログまで連鎖掃除）＝不可逆
//     dismiss : 通報を却下（対応済みとして reports 行を消す・投稿は触らない）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isAdminRequest } from "@/lib/admin-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 対象投稿を moodlog(spot_posts) → suggestion(suggestions) の順で探す
async function findPost(postId: string) {
  const db = supabase!;
  const { data: ml } = await db.from("spot_posts")
    .select("id, place_id, place_name, caption, poster_name, visibility, status, rating, report_count, created_at")
    .eq("id", postId).maybeSingle();
  if (ml) return { kind: "moodlog" as const, post: ml };
  const { data: sg } = await db.from("suggestions")
    .select("id, spot_name, description, poster_name, status, image_urls, address, created_at")
    .eq("id", postId).maybeSingle();
  if (sg) return { kind: "suggestion" as const, post: sg };
  return null;
}

export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!isAdminRequest(request, body?.secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = supabase;
  const action = String(body?.action ?? "");

  try {
    // ── 通報の却下（対応済み）: reports 行を消すだけ。投稿には触らない ──────────
    if (action === "dismiss") {
      const reportId = String(body?.reportId ?? "").trim();
      if (!UUID_RE.test(reportId)) return NextResponse.json({ ok: false, error: "reportId不正" }, { status: 400 });
      const { error } = await db.from("reports").delete().eq("id", reportId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const postId = String(body?.postId ?? "").trim();
    if (!UUID_RE.test(postId)) return NextResponse.json({ ok: false, error: "postId不正" }, { status: 400 });

    // ── 投稿の中身を確認 ──────────────────────────────────────────────────────
    if (action === "inspect") {
      const found = await findPost(postId);
      if (!found) return NextResponse.json({ ok: true, kind: null });   // 既に削除済み
      let photos: string[] = [];
      if (found.kind === "moodlog") {
        const { data: phs } = await db.from("spot_photos").select("image_url, moderation_status").eq("post_id", postId);
        photos = (phs ?? []).map(p => String((p as { image_url?: string }).image_url ?? "")).filter(Boolean);
      } else {
        const iu = (found.post as { image_urls?: string[] }).image_urls;
        photos = Array.isArray(iu) ? iu.filter(u => typeof u === "string") : [];
      }
      const { count: commentCount } = await db.from("spot_comments")
        .select("id", { count: "exact", head: true }).eq("post_id", postId);
      return NextResponse.json({ ok: true, kind: found.kind, post: found.post, photos, commentCount: commentCount ?? 0 });
    }

    // ── 非表示 / 解除（可逆）──────────────────────────────────────────────────
    if (action === "hide" || action === "restore") {
      const found = await findPost(postId);
      if (!found) return NextResponse.json({ ok: false, error: "投稿が見つかりません（削除済み？）" }, { status: 404 });
      // suggestions.status はDB制約で pending/approved/rejected のみ → 非公開は "rejected" を使う
      //   （読む側は approved のみ表示なので効果は同じ。spot_posts は "hidden"）。
      const table = found.kind === "moodlog" ? "spot_posts" : "suggestions";
      const status = action === "restore" ? "approved" : (found.kind === "moodlog" ? "hidden" : "rejected");
      const { error } = await db.from(table).update({ status }).eq("id", postId);
      if (error) throw error;
      if (found.kind === "moodlog") {
        // 投稿写真も連動（スポット写真としての再利用も止める/戻す）
        await db.from("spot_photos")
          .update({ moderation_status: action === "hide" ? "hidden" : "approved" })
          .eq("post_id", postId).then(() => {}, () => {});
      }
      return NextResponse.json({ ok: true, kind: found.kind, status });
    }

    // ── 完全削除（不可逆・連鎖掃除）────────────────────────────────────────────
    if (action === "delete") {
      const found = await findPost(postId);
      if (!found) return NextResponse.json({ ok: false, error: "投稿が見つかりません（削除済み？）" }, { status: 404 });

      if (found.kind === "moodlog") {
        // 写真: Storageの実ファイル（+サムネ）→ spot_photos 行（cron/cleanup-stale-cache と同手順）
        const { data: phs } = await db.from("spot_photos").select("storage_path").eq("post_id", postId);
        const paths = (phs ?? []).map(p => String((p as { storage_path?: string }).storage_path ?? "")).filter(Boolean);
        if (paths.length > 0) {
          const withThumbs = paths.flatMap(p => [p, p.replace(/(\.[a-z0-9]+)$/i, "_thumb$1")]);
          await db.storage.from("spot-photos").remove(withThumbs).then(() => {}, () => {});
        }
        await db.from("spot_photos").delete().eq("post_id", postId).then(() => {}, () => {});
        await db.from("spot_post_reactions").delete().eq("post_id", postId).then(() => {}, () => {});
        await db.from("spot_comments").delete().eq("post_id", postId).then(() => {}, () => {});
        const { error } = await db.from("spot_posts").delete().eq("id", postId);
        if (error) throw error;
      } else {
        // 穴場投稿: リアクション/コメントも同じ post_id 空間なので連鎖削除
        await db.from("spot_post_reactions").delete().eq("post_id", postId).then(() => {}, () => {});
        await db.from("spot_comments").delete().eq("post_id", postId).then(() => {}, () => {});
        const { error } = await db.from("suggestions").delete().eq("id", postId);
        if (error) throw error;
      }
      // この投稿への通報ログも一括で対応済みに（[post:UUID] マーカーで特定）
      await db.from("reports").delete().ilike("note", `%[post:${postId}]%`).then(() => {}, () => {});
      return NextResponse.json({ ok: true, kind: found.kind, deleted: true });
    }

    return NextResponse.json({ ok: false, error: "不正なaction" }, { status: 400 });
  } catch (e) {
    console.error("report-action error:", e);
    const msg = e instanceof Error ? e.message : (typeof e === "object" ? JSON.stringify(e) : String(e));
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
