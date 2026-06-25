export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

// Expo / モバイルクライアントからのリクエストを許可する CORS ヘッダー
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// 302リダイレクト用キャッシュ（描画ごとの再解決＝Place Photo再課金を防ぐ）
const REDIRECT_CACHE = "public, max-age=86400, s-maxage=604800";

// ⚠ SSRF対策: クライアント指定URLは「Google系の画像CDN/APIホスト」だけに限定する。
//   これを通らないURLは一切フェッチしない（内部IP・任意URLへのサーバー側アクセスを遮断）。
const ALLOWED_HOSTS = new Set<string>([
  "places.googleapis.com",
  "maps.googleapis.com",
  "maps.gstatic.com",
  "streetviewpixels-pa.googleapis.com",
  "commons.wikimedia.org",  // Wikimedia Commons（CC・合法）— Special:FilePath
  "upload.wikimedia.org",   // Wikimedia 実体CDN（Special:FilePathのリダイレクト先）
]);
function isAllowedHost(hostname: string): boolean {
  return (
    ALLOWED_HOSTS.has(hostname) ||
    hostname.endsWith(".googleusercontent.com") || // lh3..lh6 等の写真CDN
    hostname.endsWith(".ggpht.com")                // ストリートビュー系CDN
  );
}
// APIキーを付けてよいのは Google API ホスト“完全一致”のときだけ（部分一致だと漏洩する）
function mayAttachKey(hostname: string): boolean {
  return hostname === "places.googleapis.com" || hostname === "maps.googleapis.com";
}

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

  // ── SSRFガード: https かつ 許可ホストのみ通す（それ以外は即拒否）──────────────
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new NextResponse("invalid url", { status: 400 });
  }
  if (parsed.protocol !== "https:" || !isAllowedHost(parsed.hostname)) {
    return new NextResponse("forbidden host", { status: 400, headers: CORS_HEADERS });
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
          return NextResponse.redirect(cdnUrl, { status: 302, headers: { ...CORS_HEADERS, "Cache-Control": REDIRECT_CACHE } });
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
    return NextResponse.redirect(targetUrl, { status: 302, headers: { ...CORS_HEADERS, "Cache-Control": REDIRECT_CACHE } });
  }

  // 旧 Maps API 写真（photo_reference）
  // DBに保存された旧形式URL(maps.googleapis.com/maps/api/place/photo)を処理する。
  // photo_reference が新形式（AU_ZVEF... 等の長い文字列）の場合、旧APIに渡すと400になるため
  // Places API v1 の /v1/{photoRef}/media エンドポイントを経由して画像を取得する。
  if (targetUrl.includes("maps.googleapis.com/maps/api/place/photo")) {
    if (!GOOGLE_API_KEY) return new NextResponse("API key not configured", { status: 503 });
    try {
      const urlObj = new URL(targetUrl);
      const photoRef = urlObj.searchParams.get("photo_reference") ?? urlObj.searchParams.get("photoreference");
      const maxWidth = urlObj.searchParams.get("maxwidth") ?? urlObj.searchParams.get("maxWidth") ?? "800";
      if (photoRef) {
        // photoRef が "AU_" や "Ae" 等の新形式(Places API v1)かどうか判定
        // 旧形式は "CnR", "Cj" 等の短い文字列で始まる
        const isNewFormat = !photoRef.startsWith("C") && photoRef.length > 100;
        if (isNewFormat) {
          // Places API v1 経由: /v1/{photoRef}/media?skipHttpRedirect=true でCDN URLを取得
          const resolveUrl = `https://places.googleapis.com/v1/${photoRef}/media?maxWidthPx=${maxWidth}&skipHttpRedirect=true`;
          const res = await fetch(resolveUrl, {
            headers: { "X-Goog-Api-Key": GOOGLE_API_KEY },
            cache: "no-store",
          });
          if (res.ok) {
            const data = await res.json().catch(() => null);
            const cdnUrl = data?.photoUri as string | undefined;
            if (cdnUrl?.startsWith("https://")) {
              return NextResponse.redirect(cdnUrl, { status: 302, headers: { ...CORS_HEADERS, "Cache-Control": REDIRECT_CACHE } });
            }
          }
        } else {
          // 旧形式photo_reference: 旧APIに渡す
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
      }
    } catch { /* fallthrough */ }
  }

  // その他: サーバーサイドフェッチして転送（ホストは既に許可リストで限定済み）
  try {
    const headers: Record<string, string> = {};
    // キー付与はGoogle APIホスト“完全一致”のときだけ（部分一致での漏洩を防止）
    if (mayAttachKey(parsed.hostname) && GOOGLE_API_KEY) {
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
