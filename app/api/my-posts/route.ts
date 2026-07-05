export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 自分の投稿一覧（プロフィールタブ用）
 * GET /api/my-posts?deviceId=...
 * 端末IDに紐づく投稿（Moodログ=spot_posts / 穴場=suggestions / おすすめ=blog_posts）を
 * community-feed と同じ item 形で新着順に返す。
 * community-feed との違い: 承認ステータスで絞り込まず、device_id 一致のみで自分の全投稿を返す
 *   （pending / rejected も本人には見える）。id / kind の付け方は community-feed と揃え、
 *   タップ時に同じ詳細画面(/community-spot・/blog-post)へ遷移できるようにする。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash, iconPathFor } from "@/lib/device-hash";

// 旧形式 Google Maps Photo URL（Expoから直接表示できない）は除外
function isLegacyPhotoUrl(url: string): boolean {
  return url.includes("maps.googleapis.com/maps/api/place/photo");
}

// 住所文字列から都道府県を抽出（community-feed と同じ規則）
function toPref(addr: unknown): string {
  const a = String(addr ?? "")
    .replace(/^日本[、,]\s*/, "")
    .replace(/^〒?\s*\d{3}-?\d{4}\s*/, "")
    .trim();
  const m = a.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
  return m ? m[1].replace(/[都道府県]$/, "") : "";
}

// deviceId はベアラ資格情報のため、URLクエリに載せない POST(body) を正とする
// （クエリはアクセスログに残る）。旧クライアント互換で GET も当面受け付ける。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const deviceId = String(body?.deviceId ?? "").trim();
  const limit = Math.min(Number(body?.limit ?? 60), 100);
  return handle(deviceId, limit);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const deviceId = (searchParams.get("deviceId") ?? "").trim();
  const limit = Math.min(Number(searchParams.get("limit") ?? "60"), 100);
  return handle(deviceId, limit);
}

async function handle(deviceId: string, limit: number) {
  if (!supabase || !deviceId) {
    return NextResponse.json({ ok: true, items: [] });
  }

  // 投稿者アイコン: user-icons/{deviceHash}.jpg の公開URL（時間でキャッシュバスト・生ID非露出）
  const vHour = Math.floor(Date.now() / 3_600_000);
  const myIcon = (() => {
    const { data: pub } = supabase.storage.from("user-icons").getPublicUrl(iconPathFor(deviceId));
    return `${pub.publicUrl}?v=${vHour}`;
  })();
  // 本人へのレスポンスでも生deviceIdは返さない（レスポンスに資格情報を含めない不変条件）
  const myPosterId = deviceHash(deviceId);

  try {
    const out: Array<Record<string, unknown>> = [];

    // ── 穴場投稿(suggestions) ───────────────────────────────────────────────
    try {
      const { data } = await supabase
        .from("suggestions")
        .select("*")
        .eq("device_id", deviceId)
        .order("created_at", { ascending: false })
        .limit(limit);
      for (const s of (data ?? []) as Array<Record<string, unknown>>) {
        const name = String((s.google_place_name ?? s.spot_name ?? "")).trim();
        const rawImgs = ((s.image_urls as string[] | null) ?? []).filter(Boolean);
        out.push({
          id: s.id,
          kind: "suggestion",
          spot_name: name,
          prefecture: toPref(s.address),
          description: s.description ?? null,
          address: (s.address as string | null) ?? null,
          image_urls: rawImgs.filter((u) => !isLegacyPhotoUrl(u)),
          auto_tags: s.auto_tags ?? [],
          lat: s.lat ?? null,
          lng: s.lng ?? null,
          created_at: s.created_at,
          status: (s.status as string | null) ?? null,
          poster_name: (s.poster_name as string | null) ?? null,
          poster_icon: myIcon,
          poster_id: myPosterId,
        });
      }
    } catch { /* suggestions 未作成でもスキップ */ }

    // ── Moodログ(spot_posts) ────────────────────────────────────────────────
    try {
      const { data: posts } = await supabase
        .from("spot_posts")
        .select("id, device_id, poster_name, place_id, place_name, caption, mood_tags, created_at, visibility, status, like_count, helpful_count")
        .eq("device_id", deviceId)
        .order("created_at", { ascending: false })
        .limit(limit);
      const plist = (posts ?? []) as Array<Record<string, unknown>>;
      if (plist.length > 0) {
        const postIds = plist.map((p) => String(p.id));
        const placeIds = [...new Set(plist.map((p) => p.place_id).filter(Boolean).map(String))];
        const placeNames = [...new Set(plist.map((p) => p.place_name).filter(Boolean).map(String))];

        // 各投稿の写真（自分の投稿なので moderation は問わず本人には見せる）
        const photoByPost = new Map<string, string[]>();
        const { data: phs } = await supabase.from("spot_photos").select("post_id, image_url").in("post_id", postIds);
        for (const ph of (phs ?? []) as Array<Record<string, unknown>>) {
          const k = String(ph.post_id);
          if (!photoByPost.has(k)) photoByPost.set(k, []);
          if (!isLegacyPhotoUrl(String(ph.image_url))) photoByPost.get(k)!.push(String(ph.image_url));
        }

        // 都道府県・座標を place_id / place_name の両方から解決
        const prefByPlace = new Map<string, string>();
        const prefByName = new Map<string, string>();
        const coordByPlace = new Map<string, { lat: number; lng: number }>();
        const coordByName = new Map<string, { lat: number; lng: number }>();
        if (placeIds.length > 0) {
          const { data: pls } = await supabase.from("places").select("id, address, lat, lng").in("id", placeIds);
          for (const pl of (pls ?? []) as Array<Record<string, unknown>>) {
            prefByPlace.set(String(pl.id), toPref(pl.address));
            if (pl.lat != null && pl.lng != null) coordByPlace.set(String(pl.id), { lat: Number(pl.lat), lng: Number(pl.lng) });
          }
        }
        if (placeNames.length > 0) {
          const { data: pls } = await supabase.from("places").select("name, address, lat, lng").in("name", placeNames);
          for (const pl of (pls ?? []) as Array<Record<string, unknown>>) {
            prefByName.set(String(pl.name), toPref(pl.address));
            if (pl.lat != null && pl.lng != null) coordByName.set(String(pl.name), { lat: Number(pl.lat), lng: Number(pl.lng) });
          }
        }

        for (const p of plist) {
          const coord = coordByPlace.get(String(p.place_id)) || coordByName.get(String(p.place_name));
          out.push({
            id: `ml-${p.id}`,
            kind: "moodlog",
            place_id: p.place_id ?? null,
            place_name: String(p.place_name ?? ""),
            spot_name: String(p.place_name ?? ""),
            prefecture: prefByPlace.get(String(p.place_id)) || prefByName.get(String(p.place_name)) || "",
            description: p.caption ?? "",
            address: null,
            image_urls: photoByPost.get(String(p.id)) ?? [],
            auto_tags: p.mood_tags ?? [],
            lat: coord?.lat ?? null,
            lng: coord?.lng ?? null,
            likes: (Number(p.like_count) || 0) + (Number(p.helpful_count) || 0),
            created_at: p.created_at,
            status: (p.status as string | null) ?? null,
            poster_name: (p.poster_name as string | null) ?? null,
            poster_icon: myIcon,
            poster_id: myPosterId,
          });
        }
      }
    } catch { /* spot_posts 未作成でもスキップ */ }

    // ── おすすめブログ(blog_posts) ───────────────────────────────────────────
    try {
      const { data: bposts } = await supabase
        .from("blog_posts")
        .select("id, device_id, poster_name, place_id, place_name, address, area, lat, lng, title, caption, mood_tags, approval_status, like_count, helpful_count, created_at")
        .eq("device_id", deviceId)
        .order("created_at", { ascending: false })
        .limit(limit);
      const blist = (bposts ?? []) as Array<Record<string, unknown>>;
      if (blist.length > 0) {
        const bIds = blist.map((b) => String(b.id));
        const photoByBlog = new Map<string, string[]>();
        const { data: bphs } = await supabase.from("blog_post_photos")
          .select("blog_post_id, photo_url, photo_order")
          .in("blog_post_id", bIds)
          .order("photo_order", { ascending: true });
        for (const ph of (bphs ?? []) as Array<Record<string, unknown>>) {
          const k = String(ph.blog_post_id);
          if (!photoByBlog.has(k)) photoByBlog.set(k, []);
          if (!isLegacyPhotoUrl(String(ph.photo_url))) photoByBlog.get(k)!.push(String(ph.photo_url));
        }
        for (const b of blist) {
          out.push({
            id: `bp-${b.id}`,
            kind: "blog",
            place_id: b.place_id ?? null,
            place_name: String(b.place_name ?? ""),
            spot_name: String(b.title || b.place_name || ""),
            prefecture: toPref(b.area || b.address),
            description: b.caption ?? "",
            address: (b.address as string | null) ?? null,
            image_urls: photoByBlog.get(String(b.id)) ?? [],
            auto_tags: b.mood_tags ?? [],
            lat: b.lat ?? null,
            lng: b.lng ?? null,
            likes: (Number(b.like_count) || 0) + (Number(b.helpful_count) || 0),
            created_at: b.created_at,
            status: (b.approval_status as string | null) ?? null,
            poster_name: (b.poster_name as string | null) ?? null,
            poster_icon: myIcon,
            poster_id: myPosterId,
          });
        }
      }
    } catch { /* blog_posts 未作成でもスキップ */ }

    // 3ソースを新着順にマージして返す
    const items = out
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .slice(0, limit);

    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("[my-posts]", e);
    return NextResponse.json({ ok: false, items: [], error: String(e) });
  }
}
