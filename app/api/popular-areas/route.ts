// GET /api/popular-areas
//   アプリ用：特集TOPの「人気エリア」カード一覧（公開中＋掲載期間内のみ）。
//   scope_type/scope_key はクライアント側でタブ別に絞る（1回のfetchで全scope分を返す）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "DB unavailable", data: [] }, { status: 503 });
  }
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("popular_areas")
    .select("id, name, description, image_url, scope_type, scope_key, destination_type, destination_value, sort_order")
    .eq("is_active", true)
    .or(`start_at.is.null,start_at.lte.${nowIso}`)
    .or(`end_at.is.null,end_at.gt.${nowIso}`)
    .order("sort_order", { ascending: true });

  if (error) {
    // テーブル未作成（featured-scope-placement.sql 未実行）は空配列で安全に返す
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ ok: true, data: [] });
    }
    console.error("popular-areas GET error:", error);
    return NextResponse.json({ ok: false, error: error.message, data: [] }, { status: 500 });
  }
  return NextResponse.json({ ok: true, data: data ?? [] });
}
