export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase as supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, requireAdminFromReq } from "@/lib/admin-auth";

// GET: 同名スポットをグループ化して返す
export async function GET(req: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (!requireAdminFromReq(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from("places")
    .select("id, name, address, tags, lat, lng, google_place_id, is_active")
    .order("name");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // 名前でグループ化（大文字小文字・全半角を正規化して比較）
  const normalize = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/\s+/g, " ");

  const groups: Record<string, typeof data> = {};
  for (const place of data ?? []) {
    const key = normalize(place.name);
    if (!groups[key]) groups[key] = [];
    groups[key].push(place);
  }

  // 2件以上のグループのみ返す
  const duplicates = Object.values(groups)
    .filter(g => g.length >= 2)
    .sort((a, b) => b.length - a.length);

  return NextResponse.json({ ok: true, groups: duplicates, count: duplicates.length });
}

// POST: タグをマージして重複を削除
// { keepId: string, deleteIds: string[], mergedTags: string[] }
export async function POST(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!isAdminRequest(request, body?.secret)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!body?.keepId || !Array.isArray(body.deleteIds) || !Array.isArray(body.mergedTags)) {
    return NextResponse.json({ ok: false, error: "Invalid params" }, { status: 400 });
  }

  const { keepId, deleteIds, mergedTags } = body as {
    keepId: string;
    deleteIds: string[];
    mergedTags: string[];
  };

  // 残すレコードのタグを更新
  const { error: updateErr } = await supabaseAdmin
    .from("places")
    .update({ tags: mergedTags })
    .eq("id", keepId);

  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  // 削除対象のplace_photosを残すレコードに付け替え
  if (deleteIds.length > 0) {
    await supabaseAdmin
      .from("place_photos")
      .update({ place_id: keepId })
      .in("place_id", deleteIds);

    // 重複レコードを削除（is_active = false に）
    const { error: deleteErr } = await supabaseAdmin
      .from("places")
      .update({ is_active: false })
      .in("id", deleteIds);

    if (deleteErr) {
      return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, keepId, deleted: deleteIds.length });
}
