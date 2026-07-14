// ── /api/admin/place-edit ─────────────────────────────────────────────────────
// 🛠 場所編集タブ用: 1件取得(get) と 直接編集(update)。
//   「場所名/営業時間/最寄り駅が違う」報告への対応として、名前検索(search-places)→
//   このAPIで名前・住所・座標・営業時間・最寄り駅・公開状態を修正する。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const COLS = "id, name, address, lat, lng, open_hours, nearest_station, is_active, source_type, google_place_id";

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const action = String(body?.action ?? "");
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id が必要です" }, { status: 400 });

  if (action === "get") {
    const { data, error } = await supabase.from("places").select(COLS).eq("id", id).maybeSingle();
    if (error || !data) return NextResponse.json({ ok: false, error: error?.message ?? "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, place: data });
  }

  if (action === "update") {
    const p = (body?.patch ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof p.name === "string" && p.name.trim().length >= 1) patch.name = p.name.trim().slice(0, 200);
    if (typeof p.address === "string") patch.address = p.address.trim().slice(0, 300);
    if (typeof p.open_hours === "string") patch.open_hours = p.open_hours.trim().slice(0, 400) || null;
    if (typeof p.nearest_station === "string") patch.nearest_station = p.nearest_station.trim().slice(0, 100) || null;
    if (p.lat === null) patch.lat = null;
    else if (typeof p.lat === "number" && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90) patch.lat = p.lat;
    if (p.lng === null) patch.lng = null;
    else if (typeof p.lng === "number" && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180) patch.lng = p.lng;
    if (typeof p.is_active === "boolean") patch.is_active = p.is_active;
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: "変更がありません" }, { status: 400 });

    const { data, error } = await supabase.from("places").update(patch).eq("id", id).select(COLS).maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, place: data });
  }

  return NextResponse.json({ ok: false, error: "action は get | update" }, { status: 400 });
}
