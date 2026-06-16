import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const keyword: string = (body.keyword ?? "").trim();
  if (!keyword) return NextResponse.json({ ok: false, error: "keyword が必要です" }, { status: 400 });

  // ── 検索モード ────────────────────────────────────────────────────────────────
  //   "source:ghostmap" … source_type 完全一致（投入データの管理用）
  //   "#温泉"           … tags 配列 contains（タグ検索）
  //   それ以外          … 名前・住所 あいまい検索
  const isSourceSearch = keyword.startsWith("source:");
  const isTagSearch = !isSourceSearch && keyword.startsWith("#");

  let query = supabase
    .from("places")
    .select("id, name, address, tags, is_active, google_place_id, source_type")
    .order("name")
    .limit(2000);

  if (isSourceSearch) {
    query = query.eq("source_type", keyword.slice("source:".length).trim());
  } else if (isTagSearch) {
    query = query.contains("tags", [keyword]);
  } else {
    // ilike用に入力をサニタイズ（% _ , () を無害化＝フィルタ崩れ/注入防止）
    const safe = keyword.replace(/[%_,()]/g, " ").trim();
    query = query.or(`name.ilike.%${safe}%,address.ilike.%${safe}%`);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: (data ?? []).length, places: data ?? [], isTagSearch, isSourceSearch });
}
