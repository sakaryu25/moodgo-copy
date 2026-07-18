// ─── /api/place-detail ────────────────────────────────────────────────────────
// Google Places (New) API から場所の詳細情報を取得する (v2)
//
// GET  ?placeId=ChIJ...
// POST { placeId: string }
// POST { name: string, address?: string }  → テキスト検索で placeId を解決してから詳細取得

import { NextRequest, NextResponse, after } from "next/server";
import { supabase } from "@/lib/supabase";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 詳細キャッシュ（place_details）。30日以内ならGoogle Place Detailsを呼ばずに返す（item6）。
const DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
async function readDetailCache(placeId: string): Promise<Record<string, unknown> | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.from("place_details").select("data, checked_at").eq("place_key", placeId).maybeSingle();
    if (!data?.checked_at) return null;
    if (Date.now() - new Date(data.checked_at as string).getTime() > DETAIL_TTL_MS) return null;
    return (data.data as Record<string, unknown>) ?? null;
  } catch { return null; }
}
function writeDetailCache(placeId: string, place: Record<string, unknown>): void {
  if (!supabase) return;
  const sb = supabase;
  const run = () => sb.from("place_details").upsert({ place_key: placeId, data: place, checked_at: new Date().toISOString() }).then(() => {}, () => {});
  try { after(async () => { await run(); }); } catch { void run(); }
}

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
  // rating / userRatingCount は廃止: MoodGoはGoogle評価・口コミを取得/表示しない（Moodログ＋行った!集計に一本化・コスト減）
  "priceLevel",
  "location",
  "types",
  // "reviews" は廃止: MoodGoは独自の「みんなのMoodログ」に一本化（Google口コミは取得・表示しない＝コスト減）
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

// 写真は事前解決せずプロキシURL（遅延取得）で返すため、resolvePhotoUrls（事前に全media解決＝上流課金）は廃止。

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
  // Google Place Details(課金)の連打抑止。詳細はタップ毎なので60秒30回まで。
  if (!rateLimit(`place-detail:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "retry-after": "20" } });
  }
  const placeId = req.nextUrl.searchParams.get("placeId");
  if (!placeId) {
    return NextResponse.json({ ok: false, error: "placeId is required" }, { status: 400 });
  }
  return handleDetail(placeId, new URL(req.url).origin);
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

  return handleDetail(resolvedId, new URL(req.url).origin, apiKey);
}

async function handleDetail(placeId: string, origin: string, apiKey?: string): Promise<NextResponse> {
  const key = apiKey ?? (process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "");
  if (!key) {
    return NextResponse.json({ ok: false, error: "API key not configured" }, { status: 503 });
  }

  try {
    // キャッシュヒットならGoogleを呼ばずに返す（30日・item6）
    const cached = await readDetailCache(placeId);
    if (cached) return NextResponse.json({ ok: true, place: cached, cached: true });

    const d = await fetchPlaceDetail(placeId, key);

    // 写真URL解決
    const photoNames: string[] = (d.photos ?? [])
      .filter((p: Record<string, unknown>) => !!p?.name)
      .map((p: Record<string, unknown>) => p.name as string);
    // 写真は事前解決せず「プロキシURL（遅延取得）」で返す＝1枚目は表示時、2枚目以降はスワイプされた時にだけ
    //   Google /media（Place Photo課金）が発火する（検索カードと同じ遅延方式に統一・コスト減）。
    //   さらにプロキシは都度解決するので、30日キャッシュ中にCDN URLが失効して写真が死ぬ問題も同時に回避。
    const detailOrigin = origin;
    const photoUrls = photoNames.slice(0, 10).map(
      (name) => `${detailOrigin}/api/photo-proxy?url=${encodeURIComponent(`https://places.googleapis.com/v1/${name}/media`)}`
    );

    // 営業時間テキスト
    const hours = d.currentOpeningHours ?? d.regularOpeningHours;
    const weekdays = (hours?.weekdayDescriptions as string[] | undefined)?.filter(Boolean) ?? [];
    const openingHoursText: string | null = weekdays.length > 0 ? weekdays.join("\n") : null;

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
      checkedAt: new Date().toISOString(),  // 情報を取得した日時（鮮度表示「最終確認◯日前」用）。キャッシュに同梱され次回もこの時刻を返す
    };

    writeDetailCache(placeId, place);  // 詳細をキャッシュ→次回30日間はGoogle不要（item6）
    return NextResponse.json({ ok: true, place });
  } catch (err) {
    console.error("[/api/place-detail] error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
