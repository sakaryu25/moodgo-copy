// GET /api/featured-pages/[id]
//   アプリ用：特集ページ1件（公開中のみ）。特集詳細画面（feature/page/[id]）が使用。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!supabase) return NextResponse.json({ ok: false, error: "DB unavailable" }, { status: 503 });

  const { data, error } = await supabase
    .from("featured_pages_v2")
    .select(`*, featured_page_moods ( * ), featured_page_spots ( * )`)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // 公開期間チェック（カラム未適用DBでは undefined になり素通し＝旧挙動）
  const now = Date.now();
  const start = data.publish_start ? Date.parse(data.publish_start) : null;
  const end = data.publish_end ? Date.parse(data.publish_end) : null;
  if ((start && start > now) || (end && end <= now)) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  data.featured_page_moods?.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  data.featured_page_spots?.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return NextResponse.json({ ok: true, data });
}
