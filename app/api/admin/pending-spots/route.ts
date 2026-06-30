// ── /api/admin/pending-spots ──────────────────────────────────────────────────
// 統一投稿(spot_posts)で新スポットが投稿されると places に仮登録(source_type=user, is_active=false)される。
// これを admin が確認して承認(is_active=true=検索に出る)／却下(削除)する。
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("secret") !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) return NextResponse.json({ ok: true, places: [] });
  try {
    const { data } = await supabase
      .from("places")
      .select("id, name, address, lat, lng, tags, created_at")
      .eq("source_type", "user").eq("is_active", false)
      .order("created_at", { ascending: false }).limit(200);
    return NextResponse.json({ ok: true, places: data ?? [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const id = String(body?.id ?? "").trim();
  const action = String(body?.action ?? "");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    if (action === "approve") {
      // 承認 → is_active=true で検索に出る
      await supabase.from("places").update({ is_active: true }).eq("id", id);
    } else if (action === "reject") {
      // 却下 → 仮登録placeを削除（紐づくspot_postは残るが検索には出ない）
      await supabase.from("places").delete().eq("id", id);
    } else {
      return NextResponse.json({ ok: false, error: "action(approve|reject)が必要です" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
