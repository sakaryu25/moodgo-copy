export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 緯度経度 → 住所変換（逆ジオコーディング）
 * GET /api/reverse-geocode?lat=35.37&lng=139.62
 */
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!lat || !lng) {
    return NextResponse.json({ ok: false, error: "lat and lng are required" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "GOOGLE_PLACES_API_KEY 未設定" }, { status: 503 });
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&region=JP&key=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (data.status !== "OK" || !data.results?.[0]) {
      return NextResponse.json({ ok: false, error: `Reverse geocode failed: ${data.status}` }, { status: 404 });
    }

    const address = data.results[0].formatted_address as string;
    // "日本、〒XXX-XXXX ..." の形式から国名・郵便番号を除いた部分を返す
    const cleaned = address
      .replace(/^日本、〒[\d-]+\s*/, "")   // "日本、〒xxx-xxxx " を除去
      .replace(/^日本、/, "")               // "日本、" を除去
      .trim();

    return NextResponse.json({ ok: true, address: cleaned, fullAddress: address });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
