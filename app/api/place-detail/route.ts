// ─── /api/place-detail ────────────────────────────────────────────────────────
// Google Places (New) API から場所の詳細情報を取得する
//
// GET  ?placeId=ChIJ...
// POST { placeId: string }
// POST { name: string, address?: string }  → テキスト検索で placeId を解決してから詳細取得

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "currentOpeningHours",
  "regularOpeningHours",
  "photos",
  "rating",
  "userRatingCount",
  "priceLevel",
  "location",
  "types",
  "reviews",
].join(",");

async function fetchPlaceDetail(placeId: string, apiKey: string) {
  const url = `https://places.googleapis.com/v1/places/${placeId}?languageCode=ja`;
  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Places API error: ${err}`);
  }
  return res.json();
}

async function resolvePhotoUrls(photoNames: string[], apiKey: string, max = 8): Promise<string[]> {
  const names = photoNames.slice(0, max);
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        const r = await fetch(
          `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&skipHttpRedirect=true`,
          { headers: { "X-Goog-Api-Key": apiKey }, cache: "no-store" }
        );
        if (!r.ok) return null;
        const d = await r.json().catch(() => null);
        return (d?.photoUri as string) || null;
      } catch {
        return null;
      }
    })
  );
  return results.filter((u): u is string => !!u && u.startsWith("https://"));
}

async function findPlaceIdByText(name: string, address: string, apiKey: string): Promise<string | null> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({
      textQuery: [name, address].filter(Boolean).join(" "),
      languageCode: "ja",
      regionCode: "JP",
      maxResultCount: 1,
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.places?.[0]?.id ?? null;
}

const PRICE_MAP: Record<string, string> = {
  PRICE_LEVEL_FREE: "無料",
  PRICE_LEVEL_INEXPENSIVE: "¥",
  PRICE_LEVEL_MODERATE: "¥¥",
  PRICE_LEVEL_EXPENSIVE: "¥¥¥",
  PRICE_LEVEL_VERY_EXPENSIVE: "¥¥¥¥",
};

export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get("placeId");
  if (!placeId) {
    return NextResponse.json({ ok: false, error: "placeId is required" }, { status: 400 });
  }
  return handleDetail(placeId);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { placeId, name, address } = body as {
    placeId?: string; name?: string; address?: string;
  };

  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "API key not configured" }, { status: 503 });
  }

  let resolvedId = placeId;
  if (!resolvedId && name) {
    resolvedId = await findPlaceIdByText(name, address ?? "", apiKey) ?? undefined;
    if (!resolvedId) {
      return NextResponse.json({ ok: false, error: "場所が見つかりませんでした" }, { status: 404 });
    }
  }
  if (!resolvedId) {
    return NextResponse.json({ ok: false, error: "placeId or name is required" }, { status: 400 });
  }

  return handleDetail(resolvedId, apiKey);
}

async function handleDetail(placeId: string, apiKey?: string): Promise<NextResponse> {
  const key = apiKey ?? (process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "");
  if (!key) {
    return NextResponse.json({ ok: false, error: "API key not configured" }, { status: 503 });
  }

  try {
    const d = await fetchPlaceDetail(placeId, key);

    // 写真URL解決
    const photoNames: string[] = (d.photos ?? [])
      .filter((p: Record<string, unknown>) => !!p?.name)
      .map((p: Record<string, unknown>) => p.name as string);
    const photoUrls = await resolvePhotoUrls(photoNames, key, 10);

    // 営業時間テキスト
    const hours = d.currentOpeningHours ?? d.regularOpeningHours;
    const openingHoursText: string | null =
      hours?.weekdayDescriptions
        ? (hours.weekdayDescriptions as string[]).join("\n")
        : null;

    // 口コミ（Google は relevance 順 = いいね数重視で返す）
    type RawReview = {
      rating?: number;
      text?: { text?: string };
      authorAttribution?: { displayName?: string; photoUri?: string; uri?: string };
      relativePublishTimeDescription?: string;
      publishTime?: string;
    };
    const reviews = ((d.reviews ?? []) as RawReview[])
      .slice(0, 5)
      .map((r) => ({
        rating: typeof r.rating === "number" ? r.rating : null,
        text: r.text?.text ?? "",
        authorName: r.authorAttribution?.displayName ?? "Anonymous",
        authorPhoto: r.authorAttribution?.photoUri ?? null,
        relativeTime: r.relativePublishTimeDescription ?? "",
        publishTime: r.publishTime ?? null,
      }))
      .filter((r) => r.text.length > 5); // 短すぎるレビューは除外

    const place = {
      placeId,
      name: d.displayName?.text ?? "",
      address: d.formattedAddress ?? "",
      phone: d.nationalPhoneNumber ?? d.internationalPhoneNumber ?? null,
      website: d.websiteUri ?? null,
      mapUrl: d.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${placeId}`,
      rating: typeof d.rating === "number" ? d.rating : null,
      userRatingCount: typeof d.userRatingCount === "number" ? d.userRatingCount : null,
      openNow: hours?.openNow ?? null,
      openingHoursText,
      priceLevel: d.priceLevel ? (PRICE_MAP[d.priceLevel] ?? null) : null,
      photoUrls,
      lat: d.location?.latitude ?? null,
      lng: d.location?.longitude ?? null,
      reviews,
    };

    return NextResponse.json({ ok: true, place });
  } catch (err) {
    console.error("[/api/place-detail] error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
