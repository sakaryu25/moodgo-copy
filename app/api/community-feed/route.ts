export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 全国みんなの穴場フィード（公開）
 * GET /api/community-feed
 * 管理者承認済みのユーザー投稿スポットを新着順で返す。
 * 旧形式の画像URL（maps.googleapis.com/.../photo?photo_reference=AU_...）は
 * Expoから直接表示できないため、Google Places Text Searchで写真を再取得し
 * photo-proxy 経由URLに変換して返す。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

// 旧形式 Google Maps Photo URL か判定
function isLegacyPhotoUrl(url: string): boolean {
  return url.includes("maps.googleapis.com/maps/api/place/photo");
}

// photoName → photo-proxy 経由URL
function buildProxyUrl(origin: string, photoName: string): string {
  const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media`;
  return `${origin}/api/photo-proxy?url=${encodeURIComponent(mediaUrl)}`;
}

// Google Places Text Search でスポットの写真名を取得
async function fetchGooglePhotos(query: string): Promise<string[]> {
  if (!GOOGLE_API_KEY) return [];
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": "places.photos",
      },
      body: JSON.stringify({ textQuery: query, languageCode: "ja", pageSize: 1 }),
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const photos = (data?.places?.[0]?.photos ?? []) as Array<{ name: string }>;
    return photos.slice(0, 3).map((p) => p.name).filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 40);
  const offset = Number(searchParams.get("offset") ?? "0");

  if (!supabase) {
    return NextResponse.json({ ok: false, items: [] }, { status: 503 });
  }

  try {
    const { data, error } = await supabase
      .from("suggestions")
      .select(
        "id, spot_name, google_place_name, description, address, image_urls, auto_tags, lat, lng, created_at, source"
      )
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // 各アイテムを整形（まずは投稿画像のみ）
    const items = (data ?? []).map((s) => {
      const name = (s.google_place_name ?? s.spot_name ?? "").trim();
      // address から都道府県を抽出
      const cleanAddr = (s.address ?? "")
        .replace(/^日本[、,]\s*/, "")
        .replace(/^〒?\s*\d{3}-?\d{4}\s*/, "")
        .trim();
      const prefMatch = cleanAddr.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
      const prefecture = prefMatch ? prefMatch[1].replace(/[都道府県]$/, "") : "";

      const rawImgs = (s.image_urls ?? []).filter(Boolean);
      const image_urls: string[] = rawImgs.filter((u: string) => !isLegacyPhotoUrl(u));

      return {
        id: s.id,
        spot_name: name,
        prefecture,
        description: s.description,
        address: s.address as string | null,
        cleanAddr,
        image_urls,
        auto_tags: s.auto_tags,
        lat: s.lat,
        lng: s.lng,
        created_at: s.created_at,
      };
    });

    // タイムラインでは Google 画像補強をしない。
    // 投稿者が画像を添付していなければ画像なし（テキストカード）で表示する。
    // ※ 場所をタップした詳細(/api/community-spot)では住所からGoogle写真を補強する。

    // cleanAddr は内部用なので返却から除外
    const out = items.map(({ cleanAddr, ...rest }) => rest);

    return NextResponse.json({ ok: true, items: out });
  } catch (e) {
    console.error("[community-feed]", e);
    return NextResponse.json({ ok: false, items: [], error: String(e) });
  }
}
