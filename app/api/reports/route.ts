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

    const { spot_name, spot_address, reason, note, device_id } = body;
    if (!spot_name?.trim() || !reason?.trim()) {
      return NextResponse.json({ ok: false, error: "スポット名と理由は必須です" }, { status: 400 });
    }

    // 通報は「管理者レビュー用のログ」として記録するのみ。
    //   ⚠ ここで is_active を自動で落とさない（旧 increment_report_count はチェーン全店を
    //     名前一致で一括非表示にでき、かつ閉店経路と二重カウントする悪用ベクタだった）。
    //     閉店の自動掃除は /api/report-closed（id基準＋セッション重複排除＋3人闾値）に一本化。
    //     不適切系の通報は admin が確認して /api/admin/block-place で個別ブロックする。
    const row: Record<string, unknown> = {
      spot_name: spot_name.trim(),
      spot_address: spot_address?.trim() ?? null,
      reason: reason.trim(),
      note: note?.trim() ?? null,
    };
    // 通報者の端末ID（将来の重複排除・悪用検知用。列が無ければ握りつぶす）
    if (typeof device_id === "string" && device_id.trim()) row.reported_device_id = device_id.trim();

    let { error } = await supabase.from("reports").insert(row);
    // reported_device_id 列が未作成の環境ではその列を外して再試行
    if (error && typeof device_id === "string") {
      delete row.reported_device_id;
      ({ error } = await supabase.from("reports").insert(row));
    }
    if (error) throw error;

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
