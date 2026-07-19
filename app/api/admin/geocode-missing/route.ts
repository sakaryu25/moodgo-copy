export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase as supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, requireAdminFromReq } from "@/lib/admin-auth";
import { forwardGeocode } from "@/lib/forward-geocode";   // P22: 完全無料ジオコード(GSI→Yahoo)。Google Geocoding(課金)は使わない

// GET: 座標未登録のスポット一覧を返す
export async function GET(req: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (!requireAdminFromReq(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin
    .from("places")
    .select("id, name, address, lat, lng, is_active")
    .or("lat.is.null,lng.is.null")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: data ?? [], count: (data ?? []).length });
}

// POST: 住所→ジオコードして座標を保存（単体 or 一括）
export async function POST(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  if (!isAdminRequest(request, body?.secret)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // 手動座標登録: { placeId, lat, lng }
  if (body.placeId && body.lat != null && body.lng != null) {
    const { error } = await supabaseAdmin
      .from("places")
      .update({ lat: body.lat, lng: body.lng })
      .eq("id", body.placeId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, source: "manual" });
  }

  // 自動ジオコード: { placeId, address } → Google Geocoding API
  if (body.placeId && body.address) {
    const result = await geocodeAddress(body.address);
    if (!result) {
      return NextResponse.json({ ok: false, error: "ジオコードできませんでした" }, { status: 404 });
    }
    const { error } = await supabaseAdmin
      .from("places")
      .update({ lat: result.lat, lng: result.lng })
      .eq("id", body.placeId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, source: "geocode", lat: result.lat, lng: result.lng });
  }

  // 一括自動ジオコード: { bulkAll: true }
  if (body.bulkAll) {
    const { data: places, error: fetchErr } = await supabaseAdmin
      .from("places")
      .select("id, name, address")
      .or("lat.is.null,lng.is.null")
      .eq("is_active", true);

    if (fetchErr || !places) {
      return NextResponse.json({ ok: false, error: fetchErr?.message }, { status: 500 });
    }

    const results: { id: string; name: string; ok: boolean; lat?: number; lng?: number }[] = [];

    for (const place of places) {
      const result = await geocodeAddress(place.address);
      if (result) {
        await supabaseAdmin
          .from("places")
          .update({ lat: result.lat, lng: result.lng })
          .eq("id", place.id);
        results.push({ id: place.id, name: place.name, ok: true, lat: result.lat, lng: result.lng });
      } else {
        results.push({ id: place.id, name: place.name, ok: false });
      }
      // API レート制限対策
      await new Promise(r => setTimeout(r, 200));
    }

    const succeeded = results.filter(r => r.ok).length;
    return NextResponse.json({ ok: true, total: places.length, succeeded, results });
  }

  return NextResponse.json({ ok: false, error: "Invalid params" }, { status: 400 });
}

// P22: Google Geocoding(課金)を撤廃し、完全無料の forwardGeocode(国土地理院GSI→Yahoo) に置換。
//   GSIは行政区画一致で誤マッチ(横浜→青森等)を弾き、2源で特定不能な行は null 据え置き(Google再追加せず)。
//   ※lat/lng を更新すれば location(geometry) はDBトリガで同期される（find_nearby_places の検索対象になる）。
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const clean = String(address ?? "")
    .replace(/^日本[、,]\s*/, "")
    .replace(/^〒\d{3}-\d{4}\s*/, "")
    .trim();
  if (!clean) return null;
  return forwardGeocode(clean);
}
