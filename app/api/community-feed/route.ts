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
      // "日本、" "〒XXX-XXXX" を順に除去してクリーンな住所に
      const addr = (s.address ?? "")
        .replace(/^日本[、,]\s*/, "")
        .replace(/^〒?\s*\d{3}-?\d{4}\s*/, "")
        .trim();
      // 都道府県名を正確に抽出（東京都/北海道/大阪府/京都府/○○県）
      const prefMatch = addr.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
      let prefecture = "";
      if (prefMatch) {
        prefecture = prefMatch[1]
          .replace(/[都道府県]$/, "")     // 東京都→東京、神奈川県→神奈川
          .replace(/^東京$/, "東京");
      }
      return { ...s, spot_name: name, prefecture };
    });

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("[community-feed]", e);
    return NextResponse.json({ ok: false, items: [], error: String(e) });
  }
}
