// ─── /api/blog-posts ─────────────────────────────────────────────────────────
// ユーザーおすすめブログ投稿（管理者承認制）。spot-posts のパターンを踏襲。
//   POST {action:"create"}   … 投稿作成（写真1〜10＋気分/ジャンル/誰とタグ＋本文＋権利チェック）→ 常に pending
//   POST {action:"react"}    … helpful/like/save
//   POST {action:"report"}   … 通報（理由付き・閾値で自動hidden）
//   POST {action:"moderate"} … 管理者: 承認/却下/非表示＋各フィールド編集＋is_searchable設定
//   GET  ?review=1&secret=   … 管理者: ステータス別一覧
//   GET  ?list=1&mood=&q=    … 公開ブログ一覧（approvedのみ・Insta風グリッド用）
//   GET  ?id=                … ブログ詳細（approvedのみ・本人/管理者はpendingも可）
//   GET  ?placeId=           … そのスポットの承認済みブログ（スポット詳細の「みんなのMoodログ」）
// 画像は Storage バケット spot-photos に保存。認証はログイン無し＝device_id を必須。未適用でも安全。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { findNgWord } from "@/lib/ngwords";

const BUCKET = "spot-photos";
const REPORT_HIDE_THRESHOLD = 5;          // ブログは閾値やや高め
const VALID_REACTION = new Set(["helpful", "like", "save"]);
const VALID_STATUS = new Set(["pending", "approved", "rejected", "hidden"]);
let bucketEnsured = false;

function isMissingTable(e: { code?: string } | null): boolean {
  return e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST204";
}
function isValidImageBase64(b64: string): boolean {
  const m = b64.match(/^data:image\/(jpeg|jpg|png|webp|heic|heif);base64,/i);
  const payload = m ? b64.slice(b64.indexOf(",") + 1) : b64;
  if (payload.length < 100) return false;
  return /^[A-Za-z0-9+/=\r\n]+$/.test(payload.slice(0, 256));
}
function strArr(v: unknown, max = 12): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 40)).slice(0, max) : [];
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "create");

  // ── moderate（管理者: 承認/却下/非表示＋編集）─────────────────────────────────
  if (action === "moderate") {
    if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const postId = String(body?.postId ?? "").trim();
    if (!postId) return NextResponse.json({ ok: false, error: "postId が必要です" }, { status: 400 });
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    // ステータス
    if (body?.status !== undefined) {
      const status = String(body.status);
      if (!VALID_STATUS.has(status)) return NextResponse.json({ ok: false, error: "status不正" }, { status: 400 });
      patch.approval_status = status;
      if (status === "approved") { patch.approved_by = String(body?.adminName ?? "admin").slice(0, 40); patch.approved_at = new Date().toISOString(); }
      if (status === "rejected" && body?.rejectedReason) patch.rejected_reason = String(body.rejectedReason).slice(0, 500);
    }
    // 編集可能フィールド
    const F = body?.fields ?? {};
    if (typeof F.title === "string") patch.title = F.title.slice(0, 200);
    if (typeof F.caption === "string") patch.caption = F.caption.slice(0, 300);
    if (typeof F.body === "string") patch.body = F.body.slice(0, 8000);
    if (typeof F.place_name === "string") patch.place_name = F.place_name.slice(0, 200);
    if (typeof F.address === "string") patch.address = F.address.slice(0, 300);
    if (typeof F.area === "string") patch.area = F.area.slice(0, 100);
    if (typeof F.place_id === "string") patch.place_id = F.place_id.slice(0, 200);
    if (typeof F.google_place_id === "string") patch.google_place_id = F.google_place_id.slice(0, 200);
    if (F.mood_tags !== undefined) patch.mood_tags = strArr(F.mood_tags);
    if (F.scene_tags !== undefined) patch.scene_tags = strArr(F.scene_tags);
    if (F.companion_tags !== undefined) patch.companion_tags = strArr(F.companion_tags);
    if (typeof F.budget_level === "string") patch.budget_level = F.budget_level.slice(0, 40);
    if (typeof F.lat === "number") patch.lat = F.lat;
    if (typeof F.lng === "number") patch.lng = F.lng;
    if (typeof body?.isSearchable === "boolean") patch.is_searchable = body.isSearchable;
    if (typeof body?.canUseAsSpotSource === "boolean") patch.can_use_as_spot_source = body.canUseAsSpotSource;
    try {
      const { error } = await db.from("blog_posts").update(patch).eq("id", postId);
      if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, tableMissing: true }); throw error; }
      // 写真の表示可否を投稿ステータスに連動
      if (patch.approval_status) {
        await db.from("blog_post_photos").update({ moderation_status: patch.approval_status }).eq("blog_post_id", postId).then(() => {}, () => {});
      }
      if (typeof body?.canUseAsSpotPhoto === "boolean") {
        await db.from("blog_post_photos").update({ can_use_as_spot_photo: body.canUseAsSpotPhoto }).eq("blog_post_id", postId).then(() => {}, () => {});
      }
      return NextResponse.json({ ok: true });
    } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }); }
  }

  // ── react / report ───────────────────────────────────────────────────────────
  if (action === "react" || action === "report") {
    if (!rateLimit(`blog-act:${clientIp(req)}`, 40, 60_000)) return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
    const postId = String(body?.postId ?? "").trim();
    const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
    if (!postId) return NextResponse.json({ ok: false, error: "postId が必要です" }, { status: 400 });
    try {
      if (action === "react") {
        if (!deviceId) return NextResponse.json({ ok: false, error: "deviceId が必要です" }, { status: 400 });
        const rtype = String(body?.rtype ?? "");
        if (!VALID_REACTION.has(rtype)) return NextResponse.json({ ok: false, error: "rtype不正" }, { status: 400 });
        // いいね解除（トグルOFF）: 該当リアクションを削除しカウントを減算（0未満にしない）
        if (body?.undo === true) {
          const { data: del } = await db.from("blog_post_reactions").delete()
            .eq("blog_post_id", postId).eq("device_id", deviceId).eq("reaction_type", rtype).select("blog_post_id");
          if (del && del.length > 0 && (rtype === "helpful" || rtype === "like")) {
            const col = rtype === "helpful" ? "helpful_count" : "like_count";
            const { data } = await db.from("blog_posts").select(col).eq("id", postId).maybeSingle();
            const cur = (data as Record<string, number> | null)?.[col] ?? 0;
            await db.from("blog_posts").update({ [col]: Math.max(0, cur - 1) }).eq("id", postId).then(() => {}, () => {});
          }
          return NextResponse.json({ ok: true, undone: true });
        }
        const { error: insErr } = await db.from("blog_post_reactions").insert({ blog_post_id: postId, device_id: deviceId, reaction_type: rtype });
        if (insErr) {
          if (isMissingTable(insErr)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
          return NextResponse.json({ ok: true, already: true });   // 一意制約違反=既にリアクション済み
        }
        if (rtype === "helpful" || rtype === "like") {
          const col = rtype === "helpful" ? "helpful_count" : "like_count";
          await db.rpc("increment_blog_post_counter", { p_post: postId, p_col: col }).then(() => {}, async () => {
            const { data } = await db.from("blog_posts").select(col).eq("id", postId).maybeSingle();
            const cur = (data as Record<string, number> | null)?.[col] ?? 0;
            await db.from("blog_posts").update({ [col]: cur + 1 }).eq("id", postId).then(() => {}, () => {});
          });
        }
        return NextResponse.json({ ok: true });
      }
      // report（理由保持＋閾値で自動hidden）
      const reason = body?.reason ? String(body.reason).slice(0, 80) : null;
      await db.from("blog_post_reports").insert({ blog_post_id: postId, device_id: deviceId || null, reason }).then(() => {}, () => {});
      const { data: row } = await db.from("blog_posts").select("report_count").eq("id", postId).maybeSingle();
      const next = ((row as { report_count?: number } | null)?.report_count ?? 0) + 1;
      const patch: Record<string, unknown> = { report_count: next };
      if (next >= REPORT_HIDE_THRESHOLD) patch.approval_status = "hidden";
      await db.from("blog_posts").update(patch).eq("id", postId).then(() => {}, () => {});
      if (next >= REPORT_HIDE_THRESHOLD) await db.from("blog_post_photos").update({ moderation_status: "hidden" }).eq("blog_post_id", postId).then(() => {}, () => {});
      return NextResponse.json({ ok: true, hidden: next >= REPORT_HIDE_THRESHOLD });
    } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }); }
  }

  // ── create（投稿作成）→ 常に pending ──────────────────────────────────────────
  if (!rateLimit(`blog-post:${clientIp(req)}`, 4, 60_000)) return NextResponse.json({ ok: false, error: "しばらく時間をおいて再度お試しください" }, { status: 429 });
  try {
    const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
    if (!deviceId) return NextResponse.json({ ok: false, error: "投稿にはアプリの利用が必要です" }, { status: 401 });
    const title = String(body?.title ?? "").trim().slice(0, 200);
    if (!title) return NextResponse.json({ ok: false, error: "タイトルが必要です" }, { status: 400 });
    const placeName = String(body?.placeName ?? "").trim().slice(0, 200);
    if (!placeName) return NextResponse.json({ ok: false, error: "場所名/お店名が必要です" }, { status: 400 });
    if (body?.licenseDeclared !== true) return NextResponse.json({ ok: false, error: "自分で撮影した、または使用許可のある写真であることの確認が必要です" }, { status: 400 });

    const caption = String(body?.caption ?? "").trim().slice(0, 300);
    const blogBody = String(body?.body ?? "").trim().slice(0, 8000);
    for (const t of [title, caption, blogBody]) { const ng = findNgWord(t); if (ng) return NextResponse.json({ ok: false, error: "不適切な表現が含まれています" }, { status: 400 }); }

    const moodTags = strArr(body?.moodTags, 8);
    const sceneTags = strArr(body?.sceneTags, 8);
    const companionTags = strArr(body?.companionTags, 8);
    const fields = {
      device_id: deviceId,
      poster_name: body?.posterName ? String(body.posterName).trim().slice(0, 30) : null,
      place_id: body?.placeId ? String(body.placeId).trim().slice(0, 200) : null,
      title, caption: caption || null, body: blogBody || null,
      place_name: placeName,
      address: body?.address ? String(body.address).trim().slice(0, 300) : null,
      area: body?.area ? String(body.area).trim().slice(0, 100) : null,
      lat: typeof body?.lat === "number" ? body.lat : null,
      lng: typeof body?.lng === "number" ? body.lng : null,
      google_place_id: body?.googlePlaceId ? String(body.googlePlaceId).slice(0, 200) : null,
      google_maps_url: body?.googleMapsUrl ? String(body.googleMapsUrl).slice(0, 500) : null,
      official_url: body?.officialUrl ? String(body.officialUrl).slice(0, 500) : null,
      instagram_url: body?.instagramUrl ? String(body.instagramUrl).slice(0, 500) : null,
      mood_tags: moodTags, scene_tags: sceneTags, companion_tags: companionTags,
      budget_level: body?.budgetLevel ? String(body.budgetLevel).slice(0, 40) : null,
      visibility: "public",
      approval_status: "pending",      // 仕様: 必ず pending から
      is_searchable: false,
      can_use_as_spot_source: false,
    };

    const images: string[] = Array.isArray(body?.images) ? body.images.filter((s: unknown) => typeof s === "string").slice(0, 10) : [];
    for (const img of images) {
      if (img.length > 4_000_000) return NextResponse.json({ ok: false, error: "画像が大きすぎます" }, { status: 400 });
      if (!isValidImageBase64(img)) return NextResponse.json({ ok: false, error: "画像の形式が不正です" }, { status: 400 });
    }

    // 本文 insert
    const { data: post, error: postErr } = await db.from("blog_posts").insert(fields).select("id").single();
    if (postErr) { if (isMissingTable(postErr)) return NextResponse.json({ ok: false, tableMissing: true, error: "ブログ機能の準備中です" }, { status: 503 }); throw postErr; }
    const postId = (post as { id: string }).id;

    // 画像を Storage に保存 → blog_post_photos（moderation_status=pending）
    if (images.length > 0) {
      if (!bucketEnsured) { await db.storage.createBucket(BUCKET, { public: true }).then(() => {}, () => {}); bucketEnsured = true; }
      const safe = (fields.place_id ?? placeName).replace(/[^0-9a-zA-Z]/g, "").slice(0, 24) || "blog";
      const rand = Math.abs(deviceId.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
      const uploaded = (await Promise.all(images.map(async (img, i) => {
        const path = `blog/${safe}/${postId}-${i}.jpg`;
        const payload = img.includes(",") ? img.slice(img.indexOf(",") + 1) : img;
        const { error: upErr } = await db.storage.from(BUCKET).upload(path, Buffer.from(payload, "base64"), { contentType: "image/jpeg", upsert: true });
        if (upErr) return null;
        const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
        return { url: `${pub.publicUrl}?v=${rand}${i}`, path };
      }))).filter(Boolean) as { url: string; path: string }[];
      if (uploaded.length > 0) {
        await db.from("blog_post_photos").insert(uploaded.map((u, i) => ({
          blog_post_id: postId, photo_url: u.url, storage_path: u.path, photo_order: i,
          can_use_as_spot_photo: false, license_declared: true, moderation_status: "pending",
        }))).then(() => {}, () => {});
      }
    }
    return NextResponse.json({ ok: true, id: postId, status: "pending" });
  } catch (e) {
    console.error("blog-posts POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!supabase) return NextResponse.json({ ok: true, posts: [] });
  const db = supabase;
  const { searchParams } = new URL(req.url);

  // ── admin: ステータス別レビュー一覧 / 単一取得 ──
  if (searchParams.get("review") === "1") {
    if (searchParams.get("secret") !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const adminId = searchParams.get("id")?.trim();
    if (adminId) {   // 管理者: pending含め単一投稿を取得（編集画面用）
      try {
        const { data, error } = await db.from("blog_posts").select("*").eq("id", adminId).maybeSingle();
        if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: false }, { status: 404 }); throw error; }
        if (!data) return NextResponse.json({ ok: false }, { status: 404 });
        const photos = (await fetchPhotos(db, [adminId])).get(adminId) ?? [];
        return NextResponse.json({ ok: true, post: { ...data, photos } });
      } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }); }
    }
    const status = searchParams.get("status") ?? "pending";
    try {
      let q = db.from("blog_posts").select("*").order("created_at", { ascending: false }).limit(300);
      if (status === "reported") q = q.gte("report_count", 1);
      else if (status !== "all") q = q.eq("approval_status", status);
      const { data, error } = await q;
      if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, posts: [] }); throw error; }
      const ids = (data ?? []).map((p) => p.id);
      const photosByPost = await fetchPhotos(db, ids);
      return NextResponse.json({ ok: true, posts: (data ?? []).map((p) => ({ ...p, photos: photosByPost.get(p.id) ?? [] })) });
    } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }); }
  }

  const deviceId = searchParams.get("deviceId")?.trim() ?? "";

  // ── 詳細（id指定）──
  const id = searchParams.get("id")?.trim();
  if (id) {
    try {
      const { data, error } = await db.from("blog_posts").select("*").eq("id", id).maybeSingle();
      if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: false }, { status: 404 }); throw error; }
      if (!data) return NextResponse.json({ ok: false }, { status: 404 });
      const own = deviceId && data.device_id === deviceId;
      if (data.approval_status !== "approved" && !own) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      const photos = (await fetchPhotos(db, [id])).get(id) ?? [];
      return NextResponse.json({ ok: true, post: { ...data, photos, isOwn: !!own } });
    } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }); }
  }

  // ── スポット詳細の「みんなのMoodログ(ブログ)」: placeId 指定 ──
  const placeId = searchParams.get("placeId")?.trim();
  if (placeId) {
    try {
      const { data, error } = await db.from("blog_posts")
        .select("id, title, caption, mood_tags, poster_name, helpful_count, created_at")
        .eq("place_id", placeId).eq("approval_status", "approved")
        .order("helpful_count", { ascending: false }).limit(10);
      if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, posts: [] }); throw error; }
      const ids = (data ?? []).map((p) => p.id);
      const photosByPost = await fetchPhotos(db, ids);
      return NextResponse.json({ ok: true, posts: (data ?? []).map((p) => ({ ...p, photo: (photosByPost.get(p.id) ?? [])[0] ?? null })) });
    } catch (e) { return NextResponse.json({ ok: true, posts: [] }); }
  }

  // ── 公開ブログ一覧（Insta風グリッド）: approved のみ ──
  const mood = searchParams.get("mood")?.trim();
  const qtext = searchParams.get("q")?.trim();
  try {
    let q = db.from("blog_posts")
      .select("id, title, place_name, mood_tags, scene_tags, helpful_count, like_count, created_at")
      .eq("approval_status", "approved").eq("visibility", "public")
      .order("created_at", { ascending: false }).limit(60);
    if (mood) q = q.contains("mood_tags", [mood]);
    if (qtext) q = q.or(`title.ilike.%${qtext}%,place_name.ilike.%${qtext}%`);
    const { data, error } = await q;
    if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, posts: [] }); throw error; }
    const ids = (data ?? []).map((p) => p.id);
    const photosByPost = await fetchPhotos(db, ids);
    const posts = (data ?? []).map((p) => ({
      id: p.id, title: p.title, placeName: p.place_name,
      moodTags: p.mood_tags ?? [], sceneTags: p.scene_tags ?? [],
      photo: (photosByPost.get(p.id) ?? [])[0] ?? null,
      helpfulCount: p.helpful_count ?? 0, likeCount: p.like_count ?? 0,
    })).filter((p) => p.photo);   // 写真があるものだけグリッドに（Insta風）
    return NextResponse.json({ ok: true, posts });
  } catch (e) { return NextResponse.json({ ok: true, posts: [] }); }
}

// post単位の表示可能写真（order順）
async function fetchPhotos(db: NonNullable<typeof supabase>, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const { data } = await db.from("blog_post_photos")
    .select("blog_post_id, photo_url, photo_order")
    .in("blog_post_id", ids).neq("moderation_status", "hidden").neq("moderation_status", "rejected")
    .order("photo_order", { ascending: true });
  for (const r of data ?? []) {
    const k = (r as { blog_post_id: string }).blog_post_id;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push((r as { photo_url: string }).photo_url);
  }
  return map;
}
