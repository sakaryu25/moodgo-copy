export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { ADMIN_SECRET } from "@/lib/admin-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { spotName, address, lat, lng, secret } = body;

    if (secret !== ADMIN_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "Google Maps API key missing" }, { status: 503 });
    }

    // クエリを組み立て（スポット名 + 住所）
    const textQuery = [spotName, address].filter(Boolean).join(" ");

    const payload: Record<string, unknown> = {
      textQuery,
      languageCode: "ja",
      regionCode: "JP",
      pageSize: 5,
    };

    // GPS座標があればバイアスをかける
    if (typeof lat === "number" && typeof lng === "number") {
      payload.locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 5000,
        },
      };
    }

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.types,places.rating,places.userRatingCount",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ ok: false, error: `Places API error: ${err}` }, { status: 500 });
    }

    const data = await res.json();
    const candidates = (data.places ?? []).map((p: Record<string, unknown>) => ({
      placeId: p.id as string,
      name: (p.displayName as { text?: string })?.text ?? "",
      address: p.formattedAddress as string ?? "",
      mapsUri: p.googleMapsUri as string ?? "",
      types: (p.types as string[] ?? []).slice(0, 4),
      rating: typeof p.rating === "number" ? p.rating : null,
      userRatingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    }));

    return NextResponse.json({ ok: true, candidates });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
