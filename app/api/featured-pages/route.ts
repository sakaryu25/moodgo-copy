// GET /api/featured-pages
//   アプリ用：公開中（is_active）の特集ページを、気分カード・スポット（リッチ）付きで返す。
//   システムB（featured_pages_v2 / _moods / _spots）をアプリの特集データ源とする。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "DB unavailable", data: [] }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("featured_pages_v2")
    .select(`
      *,
      featured_page_moods ( * ),
      featured_page_spots ( * )
    `)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("featured-pages GET error:", error);
    return NextResponse.json({ ok: false, error: error.message, data: [] }, { status: 500 });
  }

  // 子要素を sort_order で並べ替え
  for (const page of data ?? []) {
    page.featured_page_moods?.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    page.featured_page_spots?.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  return NextResponse.json({ ok: true, data: data ?? [] });
}
