export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ─── /api/user-photos ─────────────────────────────────────────────────────────
// 履歴・いいね画面用: 複数スポットの「承認済み&再利用OK」利用者投稿写真をまとめて返す。
//   POST { items: [{ name?, supabaseId? }] } → { byId: {uuid: [url...]}, byName: {name: [url...]} }
//   Google等は呼ばない（DBのspot_photosのみ・課金ゼロ）。クライアントで先頭に差し込む。
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: true, byId: {}, byName: {} });
  const body = await req.json().catch(() => null) as { items?: Array<{ name?: string; supabaseId?: string }> } | null;
  const items = Array.isArray(body?.items) ? body!.items! : [];
  const ids = [...new Set(items.map(i => i?.supabaseId).filter((x): x is string => !!x))].slice(0, 400);
  const names = [...new Set(items.map(i => i?.name).filter((x): x is string => !!x))].slice(0, 400);
  const byId: Record<string, string[]> = {};
  const byName: Record<string, string[]> = {};
  const SEL = "place_id, place_name, image_url, is_primary, score, created_at";
  const push = (m: Record<string, string[]>, k: string, u: string) => {
    if (!k || !u) return; (m[k] ??= []); if (!m[k].includes(u)) m[k].push(u);
  };
  try {
    if (ids.length > 0) {
      const { data } = await supabase.from("spot_photos").select(SEL)
        .eq("moderation_status", "approved").eq("can_use_as_spot_photo", true).in("place_id", ids)
        .order("is_primary", { ascending: false }).order("score", { ascending: false }).order("created_at", { ascending: false });
      for (const r of (data ?? []) as Array<Record<string, unknown>>) push(byId, String(r.place_id ?? ""), String(r.image_url ?? ""));
    }
    if (names.length > 0) {
      const { data } = await supabase.from("spot_photos").select(SEL)
        .eq("moderation_status", "approved").eq("can_use_as_spot_photo", true).in("place_name", names)
        .order("is_primary", { ascending: false }).order("score", { ascending: false }).order("created_at", { ascending: false });
      for (const r of (data ?? []) as Array<Record<string, unknown>>) push(byName, String(r.place_name ?? ""), String(r.image_url ?? ""));
    }
    return NextResponse.json({ ok: true, byId, byName });
  } catch {
    return NextResponse.json({ ok: true, byId: {}, byName: {} });  // spot_photos未作成でも安全
  }
}
