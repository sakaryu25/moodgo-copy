export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

// C-1: エリア×ジャンルのSupabase登録数を返す
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    // placesテーブルからaddressとauto_tagsを全件取得
    const { data, error } = await supabase
      .from("places")
      .select("address, auto_tags")
      .eq("is_active", true)
      .limit(10000);

    if (error) throw error;

    const AREAS = ["東京", "大阪", "横浜", "名古屋", "福岡", "京都", "神戸", "札幌", "仙台", "広島", "さいたま", "千葉", "川崎"];
    const GENRES = [
      "#お腹すいた", "#ラーメン", "#居酒屋", "#和食", "#焼肉", "#カフェスイーツ",
      "#まったりしたい", "#わいわい楽しみたい", "#自然感じたい", "#ドライブしたい",
      "#集中したい", "#体動かしたい", "#温泉", "#ショッピング",
    ];

    // エリア×ジャンルのカウントを集計
    const counts: Record<string, number> = {};
    for (const row of (data ?? [])) {
      const addr = (row.address ?? "") as string;
      const tags = (row.auto_tags ?? []) as string[];

      // addressからエリアを特定
      const area = AREAS.find(a => addr.includes(a));
      if (!area) continue;

      for (const genre of GENRES) {
        if (tags.includes(genre)) {
          const key = `${area}:${genre}`;
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
    }

    // 結果を配列に変換
    const result = [];
    for (const area of AREAS) {
      for (const genre of GENRES) {
        result.push({ area, genre, count: counts[`${area}:${genre}`] ?? 0 });
      }
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    console.error("coverage GET error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
