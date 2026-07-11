export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAdminFromReq } from "@/lib/admin-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }
  // 連投抑止: 1IPあたり1分で10件まで
  if (!rateLimit(`reports:${clientIp(request)}`, 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいて再度お試しください" }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

    const { spot_name, spot_address, reason, note, device_id, post_id, post_kind } = body;
    if (!spot_name?.trim() || !reason?.trim()) {
      return NextResponse.json({ ok: false, error: "スポット名と理由は必須です" }, { status: 400 });
    }

    // 対象がユーザー投稿の時だけ post_id/post_kind が付く（ReportModalが判別して送る）
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const postId = typeof post_id === "string" && UUID_RE.test(post_id.trim()) ? post_id.trim() : null;
    const postKind = post_kind === "moodlog" || post_kind === "suggestion" ? String(post_kind) : null;

    // 場所（places）は「管理者レビュー用のログ」として記録するのみ。
    //   ⚠ ここで is_active を自動で落とさない（旧 increment_report_count はチェーン全店を
    //     名前一致で一括非表示にでき、かつ閉店経路と二重カウントする悪用ベクタだった）。
    //     閉店の自動掃除は /api/report-closed（id基準＋セッション重複排除＋3人闾値）に一本化。
    //     不適切系の通報は admin が確認して /api/admin/block-place で個別ブロックする。
    //   一方ユーザー投稿(spot_posts)は id 基準なので名前一致ベクタが無く、下の自動非表示が安全に効く。
    const row: Record<string, unknown> = {
      spot_name: spot_name.trim(),
      spot_address: spot_address?.trim() ?? null,
      reason: reason.trim(),
      // [post:UUID] マーカー: admin特定＋同一端末の重複通報判定に使う（下のdedupe参照）
      note: [postId ? `[post:${postId}]` : "", note?.trim() ?? ""].filter(Boolean).join(" ") || null,
    };
    // 通報者の端末ID（重複排除・悪用検知用。列が無ければ握りつぶす）
    if (typeof device_id === "string" && device_id.trim()) row.reported_device_id = device_id.trim();

    // 同一端末が同じ投稿を繰り返し通報しても自動非表示カウントを稼げないようにする
    // （1人で3回押して他人の投稿を消せるのを防ぐ。列未作成/失敗時は従来通り記録に進む）
    if (postId && row.reported_device_id) {
      try {
        const { data: dup } = await supabase.from("reports").select("id")
          .eq("reported_device_id", row.reported_device_id).ilike("note", `%[post:${postId}]%`).limit(1);
        if (dup && dup.length > 0) return NextResponse.json({ ok: true, already: true });
      } catch { /* dedupe不能でも通報自体は受け付ける */ }
    }

    let { error } = await supabase.from("reports").insert(row);
    // reported_device_id 列が未作成の環境ではその列を外して再試行
    if (error && typeof device_id === "string") {
      delete row.reported_device_id;
      ({ error } = await supabase.from("reports").insert(row));
    }
    if (error) throw error;

    // Moodログ投稿(spot_posts)への通報は自動非表示カウントも進める
    // （/api/spot-posts action=report と同じ挙動＝どの画面から通報しても効きを統一・2026-07-11）。
    // 旧suggestions投稿はログのみ（adminが確認して対応）。
    if (postId && postKind === "moodlog") {
      try {
        const { data: p } = await supabase.from("spot_posts").select("report_count").eq("id", postId).maybeSingle();
        if (p) {
          const next = ((p as { report_count?: number }).report_count ?? 0) + 1;
          const patch: Record<string, unknown> = { report_count: next };
          if (next >= 3) patch.status = "hidden";
          await supabase.from("spot_posts").update(patch).eq("id", postId).then(() => {}, () => {});
          if (next >= 3) {
            await supabase.from("spot_photos").update({ moderation_status: "hidden" }).eq("post_id", postId).then(() => {}, () => {});
          }
        }
      } catch { /* カウント失敗でも通報ログは残っている */ }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("reports POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }
  // admin専用（通報内容は個人情報を含みうるため secret 必須・ヘッダー/クエリ両対応）
  if (!requireAdminFromReq(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ ok: true, reports: data ?? [] });
  } catch (e) {
    console.error("reports GET error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
