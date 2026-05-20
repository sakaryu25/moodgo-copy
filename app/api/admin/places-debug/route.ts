// ─── /api/admin/places-debug ─────────────────────────────────────────────────
// places テーブルの中身を診断するエンドポイント

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN_PASSWORD = "moodgoadmin123";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await req.json();
  if (body?.secret !== ADMIN_PASSWORD) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // 総件数
  const { count: total } = await supabase
    .from("places")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  // 全レコードのタグを集計（最大200件）
  const { data: allPlaces } = await supabase
    .from("places")
    .select("id, name, tags, lat, lng")
    .eq("is_active", true)
    .limit(200);

  // タグ別件数
  const tagCount: Record<string, number> = {};
  for (const p of allPlaces ?? []) {
    for (const t of (p.tags ?? [])) {
      tagCount[t] = (tagCount[t] ?? 0) + 1;
    }
  }
  const tagRanking = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);

  // タグなし件数
  const noTagCount = (allPlaces ?? []).filter(p => !p.tags || p.tags.length === 0).length;

  // 座標なし件数
  const noCoordCount = (allPlaces ?? []).filter(p => p.lat == null || p.lng == null).length;

  // 代表サンプル5件
  const sample = (allPlaces ?? []).slice(0, 5).map(p => ({
    name: p.name,
    tags: p.tags,
    hasCoord: p.lat != null,
  }));

  // タグ検索テスト（主要タグ）
  const testTags = ["#温泉", "#天然温泉", "#銭湯", "#サウナ", "#癒しカフェ", "#自然の中", "#大型公園"];
  const tagTests: Record<string, number> = {};
  for (const tag of testTags) {
    const { count } = await supabase
      .from("places")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true)
      .contains("tags", [tag]);
    tagTests[tag] = count ?? 0;
  }

  return NextResponse.json({ ok: true, total, noTagCount, noCoordCount, tagRanking, sample, tagTests });
}
