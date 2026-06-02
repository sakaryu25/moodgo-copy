export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

// Expo / モバイルクライアントからのリクエストを許可する CORS ヘッダー
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return new NextResponse("url is required", { status: 400 });

  let targetUrl: string;
  try {
    targetUrl = decodeURIComponent(raw);
  } catch {
    return new NextResponse("invalid url", { status: 400 });
  }

  // places.googleapis.com/v1/.../media → skipHttpRedirect でCDN URLに解決
  if (targetUrl.includes("places.googleapis.com/v1/") && targetUrl.includes("/media")) {
    if (!GOOGLE_API_KEY) return new NextResponse("API key not configured", { status: 503 });
    try {
      const urlObj = new URL(targetUrl);
      const photoPath = urlObj.pathname;
      const resolveUrl = `https://places.googleapis.com${photoPath}?maxWidthPx=800&skipHttpRedirect=true`;
      const res = await fetch(resolveUrl, {
        headers: { "X-Goog-Api-Key": GOOGLE_API_KEY },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const cdnUrl = data?.photoUri as string | undefined;
        if (cdnUrl?.startsWith("https://")) {
          return NextResponse.redirect(cdnUrl, { status: 302, headers: CORS_HEADERS });
        }
      }
    } catch { /* fallthrough */ }
  }

  // lh3.googleusercontent.com 等の公開CDN → そのままリダイレクト
  if (
    targetUrl.startsWith("https://lh3.googleusercontent.com") ||
    targetUrl.startsWith("https://maps.gstatic.com") ||
    targetUrl.startsWith("https://streetviewpixels-pa.googleapis.com")
  ) {
    return NextResponse.redirect(targetUrl, { status: 302, headers: CORS_HEADERS });
  }

  // 旧 Maps API 写真（photo_reference）
  if (targetUrl.includes("maps.googleapis.com/maps/api/place/photo")) {
    if (!GOOGLE_API_KEY) return new NextResponse("API key not configured", { status: 503 });
    try {
      const urlObj = new URL(targetUrl);
      const photoRef = urlObj.searchParams.get("photo_reference") ?? urlObj.searchParams.get("photoreference");
      const maxWidth = urlObj.searchParams.get("maxwidth") ?? urlObj.searchParams.get("maxWidth") ?? "800";
      if (photoRef) {
        const freshUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoRef}&key=${GOOGLE_API_KEY}`;
        const res = await fetch(freshUrl, { cache: "no-store", redirect: "follow" });
        if (res.ok) {
          const contentType = res.headers.get("content-type") ?? "image/jpeg";
          const buf = await res.arrayBuffer();
          return new NextResponse(buf, {
            status: 200,
            headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400", ...CORS_HEADERS },
          });
        }
      }
    } catch { /* fallthrough */ }
  }

  // その他: サーバーサイドフェッチして転送
  try {
    const headers: Record<string, string> = {};
    if (targetUrl.includes("googleapis.com") && GOOGLE_API_KEY) {
      headers["X-Goog-Api-Key"] = GOOGLE_API_KEY;
    }
    const res = await fetch(targetUrl, { headers, cache: "no-store", redirect: "follow" });
    if (!res.ok) return new NextResponse("fetch failed", { status: res.status });
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400", ...CORS_HEADERS },
    });
  } catch (e) {
    return new NextResponse(String(e), { status: 500 });
  }
}
