// GET /api/featured-pages/spot/[id]
//   アプリ用：スポット1件のリッチ詳細（メニュー・期間限定イベント・営業時間など）を返す。
//   親ページ（県・号数）情報も少し添える。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "DB unavailable" }, { status: 503 });
  }

  const { data: spot, error } = await supabase
    .from("featured_page_spots")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !spot) {
    return NextResponse.json({ ok: false, error: "スポットが見つかりません" }, { status: 404 });
  }

  // 親ページ（公開中かどうかも確認）
  const { data: page } = await supabase
    .from("featured_pages_v2")
    .select("id, prefecture, issue, label, is_active")
    .eq("id", spot.page_id)
    .maybeSingle();

  if (!page?.is_active) {
    return NextResponse.json({ ok: false, error: "このスポットは非公開です" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      ...spot,
      prefecture: page.prefecture,
      issue: page.issue,
    },
  });
}
