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
    // やや多めに取ってから「前方一致→短い名前」順に並べ替え、被り候補の本命を上位に出す。
    const { data } = await supabase
      .from("places")
      .select("id, name, address")
      .eq("is_active", true)
      .ilike("name", `%${q}%`)
      .limit(20);
    const ql = q.toLowerCase();
    const sorted = (data ?? []).slice().sort((a, b) => {
      const an = String(a.name ?? ""), bn = String(b.name ?? "");
      const ap = an.toLowerCase().startsWith(ql) ? 0 : 1;
      const bp = bn.toLowerCase().startsWith(ql) ? 0 : 1;
      if (ap !== bp) return ap - bp;   // 打った文字で始まる名前を優先
      return an.length - bn.length;    // 次に短い名前（＝本命スポットが上）
    });
    return NextResponse.json({
      ok: true,
      places: sorted.slice(0, 8).map((p) => ({ id: p.id, name: p.name, address: p.address })),
    });
  } catch {
    return NextResponse.json({ ok: true, places: [] });
  }
}
