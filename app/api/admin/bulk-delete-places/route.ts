// /api/admin/bulk-delete-places
// 投入データ等の一括削除（管理者専用）。
//   { ids: string[] }            … 指定IDを一括削除（検索結果の全削除に使用）
//   { source: "ghostmap",
//     confirm: "ghostmap" }      … その source_type の全件削除（confirmが一致必須＝誤操作防止）
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  if (!isAdminRequest(req, body?.secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const sb = supabase;

  // ── ① ID指定の一括削除 ──────────────────────────────────────────────────────
  if (Array.isArray(body.ids) && body.ids.length > 0) {
    const ids = body.ids.filter((x: unknown) => typeof x === "string").slice(0, 5000);
    let deleted = 0;
    // 1000件ずつ削除（URL長/タイムアウト対策）
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const { error, count } = await sb.from("places").delete({ count: "exact" }).in("id", chunk);
      if (error) return NextResponse.json({ ok: false, error: error.message, deleted }, { status: 500 });
      deleted += count ?? chunk.length;
    }
    return NextResponse.json({ ok: true, deleted });
  }

  // ── ② source_type 全件削除（confirm必須）────────────────────────────────────
  if (typeof body.source === "string" && body.source.trim()) {
    const source = body.source.trim();
    if (body.confirm !== source) {
      return NextResponse.json({ ok: false, error: `確認のため source_type「${source}」を入力してください` }, { status: 400 });
    }
    const { error, count } = await sb.from("places").delete({ count: "exact" }).eq("source_type", source);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: count ?? 0, source });
  }

  return NextResponse.json({ ok: false, error: "ids か source を指定してください" }, { status: 400 });
}
