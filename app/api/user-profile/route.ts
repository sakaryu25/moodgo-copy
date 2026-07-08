export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 投稿者の公開プロフィール（2026-07-07）
 * POST /api/user-profile { targetId, viewerDeviceId? }
 *   → { name, handle, icon, postCount, followerCount, followingCount, isFollowing, posts[] }
 *
 * targetId = 公開ハッシュ(deviceHash先頭16)。ハッシュは不可逆なので、
 * 帰属可能な公開投稿（suggestions承認済み＋spot_posts公開）を新しい順に走査し、
 * サーバー内で device_id をハッシュ化して一致行を集める（生device_idは外に出さない）。
 *   ⚠ 匿名投稿(spot_public_anonymous)はプロフィールに紐づけない（匿名性の維持）。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash, iconPathFor } from "@/lib/device-hash";
import { handlesByDevice } from "@/lib/user-handles";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const HASH_RE = /^[0-9a-f]{16}$/;
const SCAN_LIMIT = 600;   // 各ソースの走査上限（現状データ量に対し十分。増えたらhash列の追加を検討）
const POSTS_MAX = 30;     // 返す投稿の上限

function isMissingTable(e: unknown): boolean {
  const code = String((e as { code?: string } | null)?.code ?? "");
  // 42P01=PostgreSQL / PGRST205,204=PostgRESTスキーマキャッシュ（spot-postsと同判定）
  return code === "42P01" || code === "PGRST205" || code === "PGRST204";
}
function isLegacyPhotoUrl(url: string): boolean {
  return url.includes("maps.googleapis.com/maps/api/place/photo");
}
function toPref(addr: unknown): string {
  const a = String(addr ?? "").replace(/^日本[、,]\s*/, "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, "");
  const m = a.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
  return m ? m[1].replace(/[都道府県]$/, "") : "";
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSONが不正です" }, { status: 400 }); }

  const targetId = String(body?.targetId ?? "").trim().toLowerCase();
  const viewerDeviceId = String(body?.viewerDeviceId ?? "").trim().slice(0, 100);
  if (!HASH_RE.test(targetId)) return NextResponse.json({ ok: false, error: "targetIdが不正です" }, { status: 400 });
  if (!rateLimit(`user-profile:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
  }

  try {
    type Row = Record<string, unknown>;
    // ── 帰属可能な公開投稿を走査してハッシュ一致を集める ──
    const [sugRes, mlRes] = await Promise.all([
      db.from("suggestions")
        .select("id, spot_name, google_place_name, address, image_urls, created_at, poster_name, device_id")
        .eq("status", "approved")
        .order("created_at", { ascending: false }).limit(SCAN_LIMIT),
      db.from("spot_posts")
        .select("id, place_name, created_at, poster_name, device_id, visibility, status")
        .eq("status", "approved").eq("visibility", "public")   // 匿名(spot_public_anonymous)は除外
        .order("created_at", { ascending: false }).limit(SCAN_LIMIT),
    ]);
    const sugs = ((sugRes.data ?? []) as Row[]).filter(r => typeof r.device_id === "string" && deviceHash(String(r.device_id)) === targetId);
    const mls  = ((mlRes.data ?? []) as Row[]).filter(r => typeof r.device_id === "string" && deviceHash(String(r.device_id)) === targetId);

    // Moodログの写真（spot_photos）
    const photoByPost = new Map<string, string>();
    if (mls.length > 0) {
      const { data: phs } = await db.from("spot_photos").select("post_id, image_url")
        .in("post_id", mls.map(m => String(m.id)))
        .neq("moderation_status", "hidden").neq("moderation_status", "rejected");
      for (const ph of (phs ?? []) as Row[]) {
        const k = String(ph.post_id), u = String(ph.image_url ?? "");
        if (u && !isLegacyPhotoUrl(u) && !photoByPost.has(k)) photoByPost.set(k, u);
      }
    }

    // ── いいね/行った！数（統一リアクション spot_post_reactions=/api/spot-like と同じ真実）──
    //   この人の帰属投稿(suggestions/spot_posts)への like/visited を集計。
    //   likeTotal=もらったいいね合計 / visitedTotal=「行った！」された合計（公開プロフィールの実績）。
    const reactIds = [...sugs.map(s => String(s.id)), ...mls.map(m => String(m.id))];
    const likeByPost = new Map<string, number>();
    const visitByPost = new Map<string, number>();
    let likeTotal = 0, visitedTotal = 0;
    if (reactIds.length > 0) {
      try {
        const { data: rx, error: rxErr } = await db.from("spot_post_reactions")
          .select("post_id, rtype").in("rtype", ["like", "visited"]).in("post_id", reactIds);
        if (!rxErr) {
          for (const r of (rx ?? []) as Array<{ post_id?: string; rtype?: string }>) {
            const k = String(r.post_id);
            if (r.rtype === "visited") { visitByPost.set(k, (visitByPost.get(k) ?? 0) + 1); visitedTotal++; }
            else { likeByPost.set(k, (likeByPost.get(k) ?? 0) + 1); likeTotal++; }
          }
        }
      } catch { /* reactions 未適用は 0 のまま */ }
    }

    const posts = [
      ...sugs.map(s => {
        const imgs = (Array.isArray(s.image_urls) ? s.image_urls as string[] : []).filter(u => typeof u === "string" && !isLegacyPhotoUrl(u));
        return {
          id: String(s.id), kind: "suggestion",
          spot_name: String(s.spot_name ?? s.google_place_name ?? ""),
          prefecture: toPref(s.address),
          image: imgs[0] ?? null,
          likes: likeByPost.get(String(s.id)) ?? 0,
          visited: visitByPost.get(String(s.id)) ?? 0,
          created_at: s.created_at,
        };
      }),
      ...mls.map(m => ({
        id: `ml-${m.id}`, kind: "moodlog",
        spot_name: String(m.place_name ?? ""),
        prefecture: "",
        image: photoByPost.get(String(m.id)) ?? null,
        likes: likeByPost.get(String(m.id)) ?? 0,
        visited: visitByPost.get(String(m.id)) ?? 0,
        created_at: m.created_at,
      })),
    ].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

    // ── 表示情報（最新の帰属投稿から。無ければ null）──
    const newest = (sugs[0] ?? mls[0]) as Row | undefined;
    let name: string | null = null, handle: string | null = null, icon: string | null = null, bio: string | null = null;
    let dev = "";
    if (newest && typeof newest.device_id === "string") {
      dev = String(newest.device_id);
      name = (newest.poster_name as string | null) ?? null;
      handle = (await handlesByDevice(db, [dev])).get(dev) ?? null;
      const { data: pub } = db.storage.from("user-icons").getPublicUrl(iconPathFor(dev));
      icon = `${pub.publicUrl}?v=${Math.floor(Date.now() / 3_600_000)}`;
      // 一言メッセージ（user_handles.bio・列未適用[42703]は無視）
      try {
        const { data: uh } = await db.from("user_handles").select("bio").eq("device_id", dev).maybeSingle();
        const b = (uh as { bio?: string } | null)?.bio;
        if (typeof b === "string" && b.trim()) bio = b.trim().slice(0, 80);
      } catch { /* bio列未適用は無視 */ }
    }

    // ── 行ったスポット（この人が「行った！」を押した場所＝勲章バッジ用）──
    //   dev が判る人のみ（ハッシュは一方向のためdev無し=取得不可）。device_idで直引き（索引あり）。
    const visitedSpots: Array<{ id: string; name: string; image: string | null; at: string | null }> = [];
    if (dev) {
      try {
        const { data: vis } = await db.from("spot_post_reactions")
          .select("post_id, created_at").eq("device_id", dev).eq("rtype", "visited")
          .order("created_at", { ascending: false }).limit(60);
        const vids = [...new Set(((vis ?? []) as Array<{ post_id?: string }>).map((v) => String(v.post_id)).filter(Boolean))];
        if (vids.length > 0) {
          const [mlR, sgR, phR] = await Promise.all([
            db.from("spot_posts").select("id, place_name").in("id", vids),
            db.from("suggestions").select("id, spot_name, google_place_name, image_urls").in("id", vids),
            db.from("spot_photos").select("post_id, image_url").in("post_id", vids).neq("moderation_status", "hidden").neq("moderation_status", "rejected"),
          ]);
          const nameBy = new Map<string, string>(), imgBy = new Map<string, string>(), atBy = new Map<string, string>();
          for (const m of (mlR.data ?? []) as Row[]) nameBy.set(String(m.id), String(m.place_name ?? ""));
          for (const sgv of (sgR.data ?? []) as Row[]) {
            nameBy.set(String(sgv.id), String(sgv.spot_name ?? sgv.google_place_name ?? ""));
            const iu = (Array.isArray(sgv.image_urls) ? sgv.image_urls as string[] : []).find((u) => typeof u === "string" && !isLegacyPhotoUrl(u));
            if (iu) imgBy.set(String(sgv.id), iu);
          }
          for (const ph of (phR.data ?? []) as Row[]) {
            const k = String(ph.post_id), u = String(ph.image_url ?? "");
            if (u && !isLegacyPhotoUrl(u) && !imgBy.has(k)) imgBy.set(k, u);
          }
          for (const v of (vis ?? []) as Array<{ post_id?: string; created_at?: string }>) {
            const k = String(v.post_id); if (!atBy.has(k)) atBy.set(k, String(v.created_at ?? ""));
          }
          for (const vid of vids) {
            const nm = nameBy.get(vid);
            if (nm) visitedSpots.push({ id: vid, name: nm, image: imgBy.get(vid) ?? null, at: atBy.get(vid) || null });
          }
        }
      } catch { /* reactions未適用は空 */ }
    }

    // ── フォロー数＋閲覧者のフォロー状態（user_follows 未適用は 0 / false）──
    let followerCount = 0, followingCount = 0, isFollowing = false;
    try {
      const [fer, fee] = await Promise.all([
        db.from("user_follows").select("id", { count: "exact", head: true }).eq("followee_hash", targetId),
        db.from("user_follows").select("id", { count: "exact", head: true }).eq("follower_hash", targetId),
      ]);
      if (!isMissingTable(fer.error) && !isMissingTable(fee.error)) {
        followerCount = fer.count ?? 0;
        followingCount = fee.count ?? 0;
        if (viewerDeviceId) {
          const { data } = await db.from("user_follows").select("id")
            .match({ follower_hash: deviceHash(viewerDeviceId), followee_hash: targetId }).maybeSingle();
          isFollowing = !!data;
        }
      }
    } catch { /* 未適用は 0 のまま */ }

    // 閲覧者自身のプロフィールか（自分はフォロー不可＝ボタンを出さない）
    const isMe = !!viewerDeviceId && deviceHash(viewerDeviceId) === targetId;

    return NextResponse.json({
      ok: true,
      profile: {
        posterId: targetId,
        name, handle, icon, isMe, bio,
        postCount: posts.length,
        likeCount: likeTotal,        // もらったいいね合計
        visitedCount: visitedTotal,  // 「行った！」された合計
        followerCount, followingCount, isFollowing,
        posts: posts.slice(0, POSTS_MAX),
        visitedSpots,                // この人が行った場所（勲章バッジ）
      },
    });
  } catch (e) {
    console.error("[user-profile]", e);
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
