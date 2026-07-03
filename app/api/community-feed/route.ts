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

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 40);
  const offset = Number(searchParams.get("offset") ?? "0");

  if (!supabase) {
    return NextResponse.json({ ok: false, items: [] }, { status: 503 });
  }

  try {
    // 投稿者アイコン: user-icons/{device_id}.jpg の公開URLを導出（写真未設定なら404→アプリ側でフォールバック）
    const vHour = Math.floor(Date.now() / 3_600_000);
    const iconFor = (deviceId: unknown): string | null => {
      if (typeof deviceId !== "string" || !deviceId) return null;
      const { data: pub } = supabase!.storage.from("user-icons").getPublicUrl(`${deviceId}.jpg`);
      return `${pub.publicUrl}?v=${vHour}`;
    };

    // ── みんなのMoodログ(spot_posts)も全国穴場フィードに合流 ────────────────────
    //   承認済み・公開(spot_public_anonymous/public)の投稿を同じカード形に整形して混ぜる。
    //   タップ時は場所詳細(/place)を開くため kind='moodlog'＋place_id を付ける。未作成でも安全。
    let moodItems: Array<Record<string, unknown>> = [];
    try {
      const { data: posts } = await supabase
        .from("spot_posts")
        .select("id, device_id, poster_name, place_id, place_name, caption, mood_tags, created_at, visibility, like_count, helpful_count")
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
        // 都道府県(places.address) を id と name の両方で引けるようにする（place_idがgoogle_id/nullでも名前で補完）
        const toPref = (addr: unknown): string => {
          const a = String(addr ?? "").replace(/^日本[、,]\s*/, "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, "");
          const m = a.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
          return m ? m[1].replace(/[都道府県]$/, "") : "";
        };
        const prefByPlace = new Map<string, string>();
        const prefByName = new Map<string, string>();
        const coordByPlace = new Map<string, { lat: number; lng: number }>();
        const coordByName = new Map<string, { lat: number; lng: number }>();
        const names2 = [...new Set(plist.map(p => p.place_name).filter(Boolean).map(String))];
        if (placeIds.length > 0) {
          const { data: pls } = await supabase.from("places").select("id, address, lat, lng").in("id", placeIds);
          for (const pl of (pls ?? []) as Array<Record<string, unknown>>) {
            prefByPlace.set(String(pl.id), toPref(pl.address));
            if (pl.lat != null && pl.lng != null) coordByPlace.set(String(pl.id), { lat: Number(pl.lat), lng: Number(pl.lng) });
          }
        }
        if (names2.length > 0) {
          const { data: pls } = await supabase.from("places").select("name, address, lat, lng").in("name", names2);
          for (const pl of (pls ?? []) as Array<Record<string, unknown>>) {
            prefByName.set(String(pl.name), toPref(pl.address));
            if (pl.lat != null && pl.lng != null) coordByName.set(String(pl.name), { lat: Number(pl.lat), lng: Number(pl.lng) });
          }
        }
        moodItems = plist.map(p => {
          const anon = p.visibility === "spot_public_anonymous";
          return {
            id: `ml-${p.id}`, kind: "moodlog",
            place_id: p.place_id ?? null, place_name: String(p.place_name ?? ""),
            spot_name: String(p.place_name ?? ""),
            prefecture: prefByPlace.get(String(p.place_id)) || prefByName.get(String(p.place_name)) || "",
            description: p.caption ?? "", address: null,
            image_urls: photoByPost.get(String(p.id)) ?? [],
            auto_tags: p.mood_tags ?? [],
            lat: (coordByPlace.get(String(p.place_id)) || coordByName.get(String(p.place_name)))?.lat ?? null,
            lng: (coordByPlace.get(String(p.place_id)) || coordByName.get(String(p.place_name)))?.lng ?? null,
            likes: (Number(p.like_count) || 0) + (Number(p.helpful_count) || 0),
            created_at: p.created_at,
            poster_name: anon ? null : ((p.poster_name as string | null) ?? null),
            poster_icon: anon ? null : iconFor(p.device_id),
            poster_id: (p.device_id as string | null) ?? null,
          };
        });
      }
    } catch { /* spot_posts未作成は穴場のみ表示 */ }

    // moodログ(spot_posts=moodログ＋新スポット投稿)のみを新着順で返す。穴場(suggestions)/ブログ(blog)の合流は停止済み。
    const merged = [...moodItems]
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .slice(0, limit);

    return NextResponse.json({ ok: true, items: merged });
  } catch (e) {
    console.error("[community-feed]", e);
    return NextResponse.json({ ok: false, items: [], error: String(e) });
  }
}
