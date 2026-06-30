// ── /api/place-search ─────────────────────────────────────────────────────────
// 統一投稿フォーム(/post)の「既存スポットを検索」用。名前の部分一致でactiveなplacesを返す。
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2 || !supabase) return NextResponse.json({ ok: true, places: [] });
  try {
    // 名前部分一致。leading wildcard はseq scanだが limit で早期打ち切り。
    const { data } = await supabase
      .from("places")
      .select("id, name, address")
      .eq("is_active", true)
      .ilike("name", `%${q}%`)
      .limit(10);
    return NextResponse.json({
      ok: true,
      places: (data ?? []).map((p) => ({ id: p.id, name: p.name, address: p.address })),
    });
  } catch {
    return NextResponse.json({ ok: true, places: [] });
  }
}
