export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 特集スポット詳細（名前＋エリアから Google Places で補強）
 * GET /api/feature-spot?name=清水寺&area=京都
 *  - 写真（複数）・評価・営業中・住所・営業時間・電話・公式サイト・最寄駅・地図URL を返す
 *  - 特集の仮スポット（DBに無い有名地）をタップしたときの詳細表示に使う
 */
import { NextResponse } from "next/server";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

function buildProxyUrl(origin: string, photoName: string): string {
  const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media`;
  return `${origin}/api/photo-proxy?url=${encodeURIComponent(mediaUrl)}`;
}
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const name = (searchParams.get("name") ?? "").trim();
  const area = (searchParams.get("area") ?? "").trim();
  if (!name) return NextResponse.json({ ok: false, error: "name is required" }, { status: 400 });
  if (!GOOGLE_API_KEY) return NextResponse.json({ ok: false, error: "Google API未設定" }, { status: 503 });

  const q = area && area !== "全国" ? `${area} ${name}` : name;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.googleMapsUri,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours,places.currentOpeningHours,places.rating,places.userRatingCount,places.editorialSummary",
      },
      body: JSON.stringify({ textQuery: q, languageCode: "ja", regionCode: "JP", maxResultCount: 1 }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`google ${res.status}`);
    const d = await res.json().catch(() => null);
    const p = d?.places?.[0];
    if (!p) return NextResponse.json({ ok: true, spot: null });

    const photos = ((p.photos ?? []) as Array<{ name: string }>)
      .slice(0, 8)
      .map((ph) => buildProxyUrl(origin, ph.name))
      .filter(Boolean);

    const lat = typeof p.location?.latitude === "number" ? p.location.latitude : undefined;
    const lng = typeof p.location?.longitude === "number" ? p.location.longitude : undefined;

    // 最寄駅
    let stationText = "";
    if (typeof lat === "number" && typeof lng === "number") {
      try {
        const sr = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask": "places.displayName,places.location",
          },
          body: JSON.stringify({
            includedTypes: ["train_station", "subway_station", "light_rail_station"],
            maxResultCount: 1,
            rankPreference: "DISTANCE",
            languageCode: "ja",
            locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: 3000 } },
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (sr.ok) {
          const sd = await sr.json().catch(() => null);
          const st = sd?.places?.[0];
          if (st?.location) {
            const distM = haversineM(lat, lng, st.location.latitude, st.location.longitude);
            const walkMin = Math.max(1, Math.round(distM / 80));
            const stName = (st.displayName?.text ?? "").replace(/\s*Station$/i, "").replace(/駅$/, "").trim();
            if (stName) stationText = `${stName}駅から徒歩約${walkMin}分`;
          }
        }
      } catch { /* 無視 */ }
    }

    return NextResponse.json({
      ok: true,
      spot: {
        placeId: p.id,
        name: p.displayName?.text ?? name,
        summary: p.editorialSummary?.text ?? "",
        photos,
        rating: typeof p.rating === "number" ? p.rating : null,
        reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        openNow: typeof p.currentOpeningHours?.openNow === "boolean" ? p.currentOpeningHours.openNow : null,
        address: p.formattedAddress ?? "",
        openingHoursText: (p.regularOpeningHours?.weekdayDescriptions ?? []).join("\n"),
        phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? "",
        website: p.websiteUri ?? "",
        googleMapsUri: p.googleMapsUri ?? "",
        stationText,
        lat, lng,
      },
    });
  } catch (e) {
    console.error("[feature-spot]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
