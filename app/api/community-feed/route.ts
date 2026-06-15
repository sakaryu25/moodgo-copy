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
    // select("*"): device_id / poster_name 列が未作成のDBでもエラーにならない
    const { data, error } = await supabase
      .from("suggestions")
      .select("*")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // 投稿者アイコン: user-icons/{device_id}.jpg の公開URLを導出（写真未設定なら404→アプリ側でフォールバック）
    const vHour = Math.floor(Date.now() / 3_600_000);
    const iconFor = (deviceId: unknown): string | null => {
      if (typeof deviceId !== "string" || !deviceId) return null;
      const { data: pub } = supabase!.storage.from("user-icons").getPublicUrl(`${deviceId}.jpg`);
      return `${pub.publicUrl}?v=${vHour}`;
    };

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
        poster_name: (s.poster_name as string | null) ?? null,
        poster_icon: iconFor(s.device_id),
        poster_id: (s.device_id as string | null) ?? null,   // 投稿者ブロック用（端末ID）
      };
    });

    // ── みんなのMoodログ(spot_posts)も全国穴場フィードに合流 ────────────────────
    //   承認済み・公開(spot_public_anonymous/public)の投稿を同じカード形に整形して混ぜる。
    //   タップ時は場所詳細(/place)を開くため kind='moodlog'＋place_id を付ける。未作成でも安全。
    let moodItems: Array<Record<string, unknown>> = [];
    try {
      const { data: posts } = await supabase
        .from("spot_posts")
        .select("id, device_id, poster_name, place_id, place_name, caption, mood_tags, created_at, visibility")
        .eq("status", "approved").in("visibility", ["spot_public_anonymous", "public"])
        .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      const plist = (posts ?? []) as Array<Record<string, unknown>>;
      if (plist.length > 0) {
        const postIds = plist.map(p => String(p.id));
        const placeIds = [...new Set(plist.map(p => p.place_id).filter(Boolean).map(String))];
        // 各投稿の写真
        const photoByPost = new Map<string, string[]>();
        const { data: phs } = await supabase.from("spot_photos").select("post_id, image_url")
          .in("post_id", postIds).neq("moderation_status", "hidden").neq("moderation_status", "rejected");
        for (const ph of (phs ?? []) as Array<Record<string, unknown>>) {
          const k = String(ph.post_id); if (!photoByPost.has(k)) photoByPost.set(k, []);
          if (!isLegacyPhotoUrl(String(ph.image_url))) photoByPost.get(k)!.push(String(ph.image_url));
        }
        // place_id → 都道府県(places.address)
        const prefByPlace = new Map<string, string>();
        if (placeIds.length > 0) {
          const { data: pls } = await supabase.from("places").select("id, address").in("id", placeIds);
          for (const pl of (pls ?? []) as Array<Record<string, unknown>>) {
            const a = String(pl.address ?? "").replace(/^日本[、,]\s*/, "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, "");
            const m = a.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
            prefByPlace.set(String(pl.id), m ? m[1].replace(/[都道府県]$/, "") : "");
          }
        }
        moodItems = plist.map(p => {
          const anon = p.visibility === "spot_public_anonymous";
          return {
            id: `ml-${p.id}`, kind: "moodlog",
            place_id: p.place_id ?? null, place_name: String(p.place_name ?? ""),
            spot_name: String(p.place_name ?? ""),
            prefecture: prefByPlace.get(String(p.place_id)) ?? "",
            description: p.caption ?? "", address: null,
            image_urls: photoByPost.get(String(p.id)) ?? [],
            auto_tags: p.mood_tags ?? [], lat: null, lng: null, created_at: p.created_at,
            poster_name: anon ? null : ((p.poster_name as string | null) ?? null),
            poster_icon: anon ? null : iconFor(p.device_id),
            poster_id: (p.device_id as string | null) ?? null,
          };
        });
      }
    } catch { /* spot_posts未作成は穴場のみ表示 */ }

    // cleanAddr は内部用なので返却から除外。suggestions(kind=suggestion)＋Moodログを新着順マージ。
    const out = items.map(({ cleanAddr, ...rest }) => ({ kind: "suggestion", ...rest }));
    const merged = [...out, ...moodItems]
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .slice(0, limit);

    return NextResponse.json({ ok: true, items: merged });
  } catch (e) {
    console.error("[community-feed]", e);
    return NextResponse.json({ ok: false, items: [], error: String(e) });
  }
}
