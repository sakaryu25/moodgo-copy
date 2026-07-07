export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * フォロー中フィード（2026-07-08）
 * POST /api/following-feed { deviceId, limit? }
 *
 * 自分がフォローしている投稿者（user_follows.followee_hash）の公開投稿を新着順で返す。
 * ハッシュは不可逆のため、帰属可能な公開投稿（suggestions承認済み＋spot_posts公開）を
 * 新しい順に走査してサーバー内でdevice_idをハッシュ化し、フォロー集合と突き合わせる
 * （/api/user-profile と同じ方式。⚠生device_idは外に出さない・POSTなのでCDNキャッシュなし）。
 * 返す item は community-feed と同形（クライアントのカードをそのまま使える）。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash, iconPathFor } from "@/lib/device-hash";
import { handlesByDevice } from "@/lib/user-handles";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const SCAN_LIMIT = 600;

function isLegacyPhotoUrl(url: string): boolean {
  return url.includes("maps.googleapis.com/maps/api/place/photo");
}
function toPref(addr: unknown): string {
  const a = String(addr ?? "").replace(/^日本[、,]\s*/, "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, "");
  const m = a.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
  return m ? m[1].replace(/[都道府県]$/, "") : "";
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, items: [] }, { status: 503 });
  const db = supabase;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSONが不正です" }, { status: 400 }); }

  const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
  const limit = Math.min(Number(body?.limit ?? 60), 100);
  if (!deviceId) return NextResponse.json({ ok: false, error: "deviceIdが必要です" }, { status: 400 });
  if (!rateLimit(`following-feed:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
  }

  try {
    // フォロー集合（テーブル未適用は空=フォローなし表示）
    let followees = new Set<string>();
    try {
      const { data } = await db.from("user_follows").select("followee_hash")
        .eq("follower_hash", deviceHash(deviceId)).limit(500);
      followees = new Set(((data ?? []) as Array<{ followee_hash?: string }>).map(r => String(r.followee_hash)));
    } catch { /* 空のまま */ }
    if (followees.size === 0) return NextResponse.json({ ok: true, items: [], following: 0 });

    type Row = Record<string, unknown>;
    const vHour = Math.floor(Date.now() / 3_600_000);
    const iconFor = (dev: string): string => {
      const { data: pub } = db.storage.from("user-icons").getPublicUrl(iconPathFor(dev));
      return `${pub.publicUrl}?v=${vHour}`;
    };

    // 帰属可能な公開投稿を並列走査し、フォロー集合に含まれる投稿者のものだけ残す
    const [sugRes, mlRes] = await Promise.all([
      db.from("suggestions")
        .select("id, spot_name, google_place_name, description, address, image_urls, auto_tags, lat, lng, created_at, poster_name, device_id")
        .eq("status", "approved")
        .order("created_at", { ascending: false }).limit(SCAN_LIMIT),
      db.from("spot_posts")
        .select("id, place_name, caption, mood_tags, created_at, poster_name, device_id, visibility, status")
        .eq("status", "approved").eq("visibility", "public")
        .order("created_at", { ascending: false }).limit(SCAN_LIMIT),
    ]);
    const sugs = ((sugRes.data ?? []) as Row[]).filter(r => typeof r.device_id === "string" && followees.has(deviceHash(String(r.device_id))));
    const mls  = ((mlRes.data ?? []) as Row[]).filter(r => typeof r.device_id === "string" && followees.has(deviceHash(String(r.device_id))));

    // Moodログの写真
    const photoByPost = new Map<string, string[]>();
    if (mls.length > 0) {
      const { data: phs } = await db.from("spot_photos").select("post_id, image_url")
        .in("post_id", mls.map(m => String(m.id)))
        .neq("moderation_status", "hidden").neq("moderation_status", "rejected");
      for (const ph of (phs ?? []) as Row[]) {
        const k = String(ph.post_id), u = String(ph.image_url ?? "");
        if (!photoByPost.has(k)) photoByPost.set(k, []);
        if (u && !isLegacyPhotoUrl(u)) photoByPost.get(k)!.push(u);
      }
    }
    const handleMap = await handlesByDevice(db, [...sugs, ...mls].map(r => String(r.device_id ?? "")));

    const items = [
      ...sugs.map(s => {
        const imgs = (Array.isArray(s.image_urls) ? s.image_urls as string[] : []).filter(u => typeof u === "string" && !isLegacyPhotoUrl(u));
        const dev = String(s.device_id);
        return {
          id: String(s.id), kind: "suggestion",
          place_id: null, place_name: String(s.google_place_name ?? s.spot_name ?? ""),
          spot_name: String(s.spot_name ?? s.google_place_name ?? ""),
          prefecture: toPref(s.address),
          description: (s.description as string | null) ?? "", address: (s.address as string | null) ?? null,
          image_urls: imgs, auto_tags: (s.auto_tags as string[] | null) ?? [],
          lat: typeof s.lat === "number" ? s.lat : null, lng: typeof s.lng === "number" ? s.lng : null,
          created_at: s.created_at,
          poster_name: (s.poster_name as string | null) ?? null,
          poster_handle: handleMap.get(dev) ?? null,
          poster_icon: iconFor(dev),
          poster_id: deviceHash(dev),
        };
      }),
      ...mls.map(m => {
        const dev = String(m.device_id);
        return {
          id: `ml-${m.id}`, kind: "moodlog",
          place_id: null, place_name: String(m.place_name ?? ""),
          spot_name: String(m.place_name ?? ""),
          prefecture: "",
          description: (m.caption as string | null) ?? "", address: null,
          image_urls: photoByPost.get(String(m.id)) ?? [],
          auto_tags: (m.mood_tags as string[] | null) ?? [],
          lat: null, lng: null,
          created_at: m.created_at,
          poster_name: (m.poster_name as string | null) ?? null,
          poster_handle: handleMap.get(dev) ?? null,
          poster_icon: iconFor(dev),
          poster_id: deviceHash(dev),
        };
      }),
    ]
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .slice(0, limit);

    return NextResponse.json({ ok: true, items, following: followees.size });
  } catch (e) {
    console.error("[following-feed]", e);
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return NextResponse.json({ ok: false, items: [], error: msg }, { status: 500 });
  }
}
