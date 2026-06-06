export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 全国みんなの穴場 — スポット詳細（公開）
 * GET /api/community-spot?id=UUID
 * suggestions テーブルの1件を、利用者データ＋Google補強情報で返す。
 *  - 写真は利用者投稿を優先（無ければ Google から補強）
 *  - 電話・公式サイト・営業時間・最寄駅は Google Places から取得
 *  - 説明文から「目安価格」「おすすめ度★」をパースして分離
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

function isLegacyPhotoUrl(url: string): boolean {
  return url.includes("maps.googleapis.com/maps/api/place/photo");
}
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

// 説明文から 価格・おすすめ度 を分離
function parseDescription(raw: string | null): { desc: string; priceText: string; rating: number } {
  if (!raw) return { desc: "", priceText: "", rating: 0 };
  let priceText = "";
  let rating = 0;
  const lines = raw.split("\n").filter((l) => {
    const priceM = l.match(/^【目安価格】\s*(.+)$/);
    if (priceM) { priceText = priceM[1].trim(); return false; }
    const rateM = l.match(/^【おすすめ度】\s*★(\d)/);
    if (rateM) { rating = Number(rateM[1]); return false; }
    return true;
  });
  return { desc: lines.join("\n").trim(), priceText, rating };
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  try {
    const { data: s, error } = await supabase
      .from("suggestions")
      .select("id, spot_name, google_place_name, description, address, image_urls, auto_tags, lat, lng, contact, station_info, google_maps_uri, created_at")
      .eq("id", id)
      .single();
    if (error || !s) throw error ?? new Error("not found");

    const userTitle = (s.spot_name ?? "").trim();
    const placeName = (s.google_place_name ?? s.spot_name ?? "").trim();
    const { desc, priceText, rating } = parseDescription(s.description);

    // 都道府県
    const cleanAddr0 = (s.address ?? "").replace(/^日本[、,]\s*/, "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, "").trim();
    const prefMatch = cleanAddr0.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
    const prefecture = prefMatch ? prefMatch[1].replace(/[都道府県]$/, "") : "";

    // 利用者投稿写真（旧形式は除外）
    const rawImgs = (s.image_urls ?? []).filter(Boolean) as string[];
    let userPhotos = rawImgs.filter((u) => !isLegacyPhotoUrl(u));
    const hasUserPhotos = userPhotos.length > 0;

    // ── Google Places で補強 ───────────────────────────────────────────────
    let phone = "", website = "", openingHoursText = "", googleMapsUri = s.google_maps_uri ?? "";
    let address = s.address ?? "";
    let placeId: string | undefined;
    let placeLat = typeof s.lat === "number" ? s.lat : undefined;
    let placeLng = typeof s.lng === "number" ? s.lng : undefined;
    let googlePhotos: string[] = [];
    let googleRating: number | null = null;
    let reviewCount: number | null = null;
    let openNow: boolean | null = null;

    // 住所がある時のみ Google で位置特定して補強（写真・電話等）。
    // 住所が無ければ名前だけの曖昧検索で別の似た店を拾うのを防ぐため補強しない。
    if (GOOGLE_API_KEY && placeName && cleanAddr0) {
      try {
        const q = `${cleanAddr0} ${placeName}`;
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask":
              "places.id,places.formattedAddress,places.location,places.photos,places.googleMapsUri,places.internationalPhoneNumber,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours,places.currentOpeningHours,places.rating,places.userRatingCount",
          },
          body: JSON.stringify({ textQuery: q, languageCode: "ja", regionCode: "JP", maxResultCount: 1 }),
          cache: "no-store",
          signal: AbortSignal.timeout(7000),
        });
        if (res.ok) {
          const d = await res.json().catch(() => null);
          const p = d?.places?.[0];
          if (p) {
            placeId = p.id;
            phone = p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? "";
            website = p.websiteUri ?? "";
            googleMapsUri = googleMapsUri || (p.googleMapsUri ?? "");
            address = address || (p.formattedAddress ?? "");
            openingHoursText = (p.regularOpeningHours?.weekdayDescriptions ?? []).join("\n");
            googleRating = typeof p.rating === "number" ? p.rating : null;
            reviewCount = typeof p.userRatingCount === "number" ? p.userRatingCount : null;
            openNow = typeof p.currentOpeningHours?.openNow === "boolean" ? p.currentOpeningHours.openNow : null;
            if (typeof p.location?.latitude === "number") { placeLat = p.location.latitude; placeLng = p.location.longitude; }
            const photos = (p.photos ?? []) as Array<{ name: string }>;
            googlePhotos = photos.slice(0, 8).map((ph) => buildProxyUrl(origin, ph.name)).filter(Boolean);
          }
        }
      } catch { /* 補強失敗は無視 */ }
    }

    // 利用者写真が無ければ Google 写真で補強
    if (!hasUserPhotos) userPhotos = googlePhotos;

    // ── 最寄駅 + 徒歩時間 ───────────────────────────────────────────────────
    let stationText = (s.station_info ?? "").trim();
    if (!stationText && GOOGLE_API_KEY && typeof placeLat === "number" && typeof placeLng === "number") {
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
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
            locationRestriction: { circle: { center: { latitude: placeLat, longitude: placeLng }, radius: 2000 } },
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const d = await res.json().catch(() => null);
          const st = d?.places?.[0];
          if (st?.location) {
            const distM = haversineM(placeLat, placeLng, st.location.latitude, st.location.longitude);
            const walkMin = Math.max(1, Math.round(distM / 80)); // 80m/分
            const stName = (st.displayName?.text ?? "")
              .replace(/\s*Station$/i, "")   // 英語表記の Station を除去
              .replace(/駅$/, "")
              .trim();
            stationText = `${stName}駅から徒歩約${walkMin}分`;
          }
        }
      } catch { /* 無視 */ }
    }

    return NextResponse.json({
      ok: true,
      spot: {
        id: s.id,
        userTitle,            // 利用者が書いたスポット名
        placeName,            // 場所名（Google名 or 同じ）
        description: desc,    // 利用者が書いた説明（大目玉）
        priceText,            // 目安価格（利用者記入）
        rating,               // 投稿者のおすすめ度（★1-5）
        googleRating,         // Google評価（平均）
        reviewCount,          // Google口コミ件数
        openNow,              // 営業中か
        imageUrls: userPhotos,
        hasUserPhotos,
        address,
        phone,
        website,
        googleMapsUri,
        stationText,
        openingHoursText,
        prefecture,
        lat: placeLat,
        lng: placeLng,
        placeId,
        autoTags: s.auto_tags ?? [],
        createdAt: s.created_at,
      },
    });
  } catch (e) {
    console.error("[community-spot]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
