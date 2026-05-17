/**
 * エリア名 → 緯度経度変換
 * GET /api/geocode?area=渋谷駅
 */
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const area = searchParams.get("area");

  if (!area) {
    return NextResponse.json({ ok: false, error: "area is required" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "GOOGLE_PLACES_API_KEY 未設定" }, { status: 503 });
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(area)}&language=ja&region=JP&key=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (data.status !== "OK" || !data.results?.[0]) {
      return NextResponse.json({ ok: false, error: `Geocode failed: ${data.status}` }, { status: 404 });
    }

    const location = data.results[0].geometry?.location;
    if (!location) {
      return NextResponse.json({ ok: false, error: "location not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, lat: location.lat, lng: location.lng });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
