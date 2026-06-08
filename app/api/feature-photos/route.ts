export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 特集カードのサムネイル写真をまとめて取得
 * POST /api/feature-photos  { items: [{ name, area }] }
 *  → { photos: { "<name>": "<photoUrl>" } }
 * 有名スポットの実写真を Google Places から1枚ずつ取得（並列・各5秒timeout）。
 */
import { NextResponse } from "next/server";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

function buildProxyUrl(origin: string, photoName: string): string {
  const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media`;
  return `${origin}/api/photo-proxy?url=${encodeURIComponent(mediaUrl)}`;
}

async function fetchOnePhoto(origin: string, name: string, area: string): Promise<string | null> {
  const q = area && area !== "全国" ? `${area} ${name}` : name;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": "places.photos",
      },
      body: JSON.stringify({ textQuery: q, languageCode: "ja", regionCode: "JP", maxResultCount: 1 }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    const photoName = d?.places?.[0]?.photos?.[0]?.name;
    return photoName ? buildProxyUrl(origin, photoName) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  if (!GOOGLE_API_KEY) return NextResponse.json({ ok: false, photos: {} }, { status: 200 });

  let items: Array<{ name: string; area?: string }> = [];
  try {
    const body = await request.json();
    items = Array.isArray(body?.items) ? body.items : [];
  } catch {
    return NextResponse.json({ ok: false, photos: {} }, { status: 200 });
  }

  // 過剰な課金を避けるため最大18件まで
  const capped = items.filter((it) => it?.name).slice(0, 18);

  const results = await Promise.all(
    capped.map(async (it) => {
      const url = await fetchOnePhoto(origin, it.name.trim(), (it.area ?? "").trim());
      return [it.name, url] as const;
    })
  );

  const photos: Record<string, string> = {};
  for (const [name, url] of results) {
    if (url) photos[name] = url;
  }
  return NextResponse.json({ ok: true, photos });
}
