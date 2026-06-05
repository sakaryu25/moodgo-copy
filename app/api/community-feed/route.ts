export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 全国みんなの穴場フィード（公開）
 * GET /api/community-feed
 * 管理者承認済みのユーザー投稿スポットを新着順で返す
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 40);
  const offset = Number(searchParams.get("offset") ?? "0");

  if (!supabase) {
    return NextResponse.json({ ok: false, items: [] }, { status: 503 });
  }

  try {
    const { data, error } = await supabase
      .from("suggestions")
      .select(
        "id, spot_name, google_place_name, description, address, image_urls, auto_tags, lat, lng, created_at, source"
      )
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // address から都道府県を抽出
    const items = (data ?? []).map((s) => {
      const name = (s.google_place_name ?? s.spot_name ?? "").trim();
      const addr = (s.address ?? "").replace(/^日本、〒[\d-]+\s*/, "").trim();
      const prefMatch = addr.match(/^([^都道府県]+[都道府県])/);
      const prefecture = prefMatch ? prefMatch[1].replace(/[都道府県]$/, "") : "";
      return { ...s, spot_name: name, prefecture };
    });

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("[community-feed]", e);
    return NextResponse.json({ ok: false, items: [], error: String(e) });
  }
}
