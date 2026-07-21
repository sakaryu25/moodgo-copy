export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * ─── /api/mood-books ─── Mood Book（思い出BOOK）CRUD
 * プロフィール「自分の投稿」を進化させたBOOK機能。1ページ=1スポット（=1投稿）。
 * 全て POST + body.action のRPCスタイル（本人確認は body.deviceId → deviceHash 照合）:
 *   {action:'overview', deviceId}                    → {ok, books[], primary:{book, pages[≤6]}|null}
 *   {action:'get',      deviceId, bookId, offset?, limit?} → {ok, book, pages[], total}
 *   {action:'create',   deviceId, title, description?, visibility?, postIds?[]} → {ok, book}
 *   {action:'update',   deviceId, bookId, title?, description?, visibility?, coverImageUrl?, isArchived?} → {ok, book}
 *   {action:'delete',   deviceId, bookId}            → {ok}
 *   {action:'add-pages',   deviceId, bookId, postIds[]} → {ok, added, pageCount}
 *   {action:'remove-page', deviceId, bookId, pageId}    → {ok, pageCount}
 *   {action:'reorder',     deviceId, bookId, pageIds[]} → {ok}
 *   {action:'update-page', deviceId, bookId, pageId, customTitle?, customText?} → {ok}
 * ページは元投稿（穴場=UUID / Moodログ=ml-UUID / ブログ=bp-UUID）への参照＋表示用
 * スナップショットを持ち、閲覧時に元投稿の最新値へ自動同期（削除済みは post_deleted:true）。
 * v1の閲覧は本人のみ（visibilityは保存するが公開導線は未提供）。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash } from "@/lib/device-hash";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { findNgWord } from "@/lib/ngwords";

const VALID_VISIBILITY = new Set(["private", "friends", "public"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMissingTable(e: { code?: string } | null): boolean {
  return e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST204";
}

// 旧形式 Google Maps Photo URL（Expoから直接表示できない）は除外（my-postsと同じ規則）
function isLegacyPhotoUrl(url: string): boolean {
  return url.includes("maps.googleapis.com/maps/api/place/photo");
}

// 住所文字列から都道府県を抽出（community-feed / my-posts と同じ規則）
function toPref(addr: unknown): string {
  const a = String(addr ?? "")
    .replace(/^日本[、,]\s*/, "")
    .replace(/^〒?\s*\d{3}-?\d{4}\s*/, "")
    .trim();
  const m = a.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
  return m ? m[1].replace(/[都道府県]$/, "") : "";
}

// ユーザー入力テキストのNGワード検査（spot-posts/blog-postsと同水準の防御）
function ngCheck(...texts: Array<unknown>): string | null {
  for (const t of texts) {
    const hit = findNgWord(String(t ?? ""));
    if (hit) return hit;
  }
  return null;
}

// 元投稿のスナップショット/最新値（ページ表示に必要な最小限）
type PostSnap = {
  spot_name: string;
  area: string;
  excerpt: string;
  photo_urls: string[];
  mood_tags: string[];
  created_at: string | null;
  place_key: string;
};

// resolvePosts の結果。okKinds に入っていない kind は「取得自体に失敗」＝
// 見つからない事と区別し、post_deleted の誤判定（一時的なDB障害で削除扱い）を防ぐ。
type ResolveResult = { map: Map<string, PostSnap>; okKinds: Set<string> };

function kindOf(postId: string): string {
  return postId.startsWith("ml-") ? "moodlog" : postId.startsWith("bp-") ? "blog" : postId ? "suggestion" : "free";
}

// my-posts item id（穴場=UUID / ml-UUID / bp-UUID）→ 各テーブルから表示用データを一括解決。
// 必ず device_id 一致で絞る＝他人の投稿はBOOKに追加できない。
async function resolvePosts(deviceId: string, postIds: string[]): Promise<ResolveResult> {
  const db = supabase!;
  const out = new Map<string, PostSnap>();
  const okKinds = new Set<string>();
  const sugIds = postIds.filter((id) => UUID_RE.test(id));
  const mlIds = postIds.filter((id) => id.startsWith("ml-")).map((id) => id.slice(3)).filter((id) => UUID_RE.test(id));
  const bpIds = postIds.filter((id) => id.startsWith("bp-")).map((id) => id.slice(3)).filter((id) => UUID_RE.test(id));

  const sugP = (async () => { try {
    if (sugIds.length === 0) { okKinds.add("suggestion"); return; }
    const { data, error } = await db.from("suggestions")
      .select("id, spot_name, google_place_name, description, address, image_urls, auto_tags, created_at, google_place_id")
      .in("id", sugIds).eq("device_id", deviceId);
    if (error) throw error;
    okKinds.add("suggestion");
    for (const s of (data ?? []) as Array<Record<string, unknown>>) {
      out.set(String(s.id), {
        spot_name: String(s.google_place_name ?? s.spot_name ?? "").trim(),
        area: toPref(s.address),
        excerpt: String(s.description ?? ""),
        photo_urls: (((s.image_urls as string[] | null) ?? []).filter(Boolean)).filter((u) => !isLegacyPhotoUrl(u)),
        mood_tags: ((s.auto_tags as string[] | null) ?? []).filter(Boolean),
        created_at: (s.created_at as string | null) ?? null,
        place_key: String(s.google_place_id ?? ""),
      });
    }
  } catch { /* suggestions未作成はスキップ */ } })();

  const mlP = (async () => { try {
    if (mlIds.length === 0) { okKinds.add("moodlog"); return; }
    const { data: posts, error } = await db.from("spot_posts")
      .select("id, place_id, place_name, caption, mood_tags, created_at")
      .in("id", mlIds).eq("device_id", deviceId);
    if (error) throw error;
    okKinds.add("moodlog");
    const plist = (posts ?? []) as Array<Record<string, unknown>>;
    if (plist.length === 0) return;
    const ids = plist.map((p) => String(p.id));
    const placeIds = [...new Set(plist.map((p) => p.place_id).filter(Boolean).map(String))].filter((v) => UUID_RE.test(v));
    const [phsRes, plsRes] = await Promise.all([
      // 通報非表示/却下写真はBOOKにも出さない（spot-postsの既存規約と同じ除外）
      db.from("spot_photos").select("post_id, image_url").in("post_id", ids)
        .neq("moderation_status", "hidden").neq("moderation_status", "rejected"),
      placeIds.length > 0
        ? db.from("places").select("id, address").in("id", placeIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);
    const photoByPost = new Map<string, string[]>();
    for (const ph of (phsRes.data ?? []) as Array<Record<string, unknown>>) {
      const k = String(ph.post_id);
      if (!photoByPost.has(k)) photoByPost.set(k, []);
      if (!isLegacyPhotoUrl(String(ph.image_url))) photoByPost.get(k)!.push(String(ph.image_url));
    }
    const prefByPlace = new Map<string, string>();
    for (const pl of (plsRes.data ?? []) as Array<Record<string, unknown>>) {
      prefByPlace.set(String(pl.id), toPref(pl.address));
    }
    for (const p of plist) {
      out.set(`ml-${p.id}`, {
        spot_name: String(p.place_name ?? ""),
        area: prefByPlace.get(String(p.place_id)) ?? "",
        excerpt: String(p.caption ?? ""),
        photo_urls: photoByPost.get(String(p.id)) ?? [],
        mood_tags: ((p.mood_tags as string[] | null) ?? []).filter(Boolean),
        created_at: (p.created_at as string | null) ?? null,
        place_key: String(p.place_id ?? ""),
      });
    }
  } catch { /* spot_posts未作成はスキップ */ } })();

  const bpP = (async () => { try {
    if (bpIds.length === 0) { okKinds.add("blog"); return; }
    const { data: bposts, error } = await db.from("blog_posts")
      .select("id, place_id, place_name, title, caption, mood_tags, area, address, created_at")
      .in("id", bpIds).eq("device_id", deviceId);
    if (error) throw error;
    okKinds.add("blog");
    const blist = (bposts ?? []) as Array<Record<string, unknown>>;
    if (blist.length === 0) return;
    const ids = blist.map((b) => String(b.id));
    const photoByBlog = new Map<string, string[]>();
    const { data: bphs } = await db.from("blog_post_photos")
      .select("blog_post_id, photo_url, photo_order")
      .in("blog_post_id", ids)
      .neq("moderation_status", "hidden").neq("moderation_status", "rejected")
      .order("photo_order", { ascending: true });
    for (const ph of (bphs ?? []) as Array<Record<string, unknown>>) {
      const k = String(ph.blog_post_id);
      if (!photoByBlog.has(k)) photoByBlog.set(k, []);
      if (!isLegacyPhotoUrl(String(ph.photo_url))) photoByBlog.get(k)!.push(String(ph.photo_url));
    }
    for (const b of blist) {
      out.set(`bp-${b.id}`, {
        spot_name: String(b.title || b.place_name || ""),
        area: toPref(b.area || b.address),
        excerpt: String(b.caption ?? ""),
        photo_urls: photoByBlog.get(String(b.id)) ?? [],
        mood_tags: ((b.mood_tags as string[] | null) ?? []).filter(Boolean),
        created_at: (b.created_at as string | null) ?? null,
        place_key: String(b.place_id ?? ""),
      });
    }
  } catch { /* blog_posts未作成はスキップ */ } })();

  await Promise.all([sugP, mlP, bpP]);
  return { map: out, okKinds };
}

// ページ行＋（あれば）元投稿の最新値 → クライアント表示形。custom_* が最優先、
// 次に元投稿の最新値、最後にスナップショット（＝削除された投稿でもページは生きる）。
// post_deleted は「その種別の取得に成功したのに見つからない」時だけ true
// （一時的なDB障害を削除と誤判定してユーザーを驚かせない）。
function shapePage(row: Record<string, unknown>, resolved: ResolveResult): Record<string, unknown> {
  const postId = String(row.post_id ?? "");
  const live = resolved.map.get(postId);
  const kindResolved = resolved.okKinds.has(kindOf(postId));
  const snapPhotos = ((row.photo_urls as string[] | null) ?? []).filter(Boolean);
  const snapTags = ((row.mood_tags as string[] | null) ?? []).filter(Boolean);
  return {
    id: row.id,
    post_id: postId,
    kind: kindOf(postId),
    page_order: Number(row.page_order ?? 0),
    layout_type: String(row.layout_type ?? "auto"),
    title: String(row.custom_title || live?.spot_name || row.spot_name || ""),
    text: String(row.custom_text || live?.excerpt || row.excerpt || ""),
    area: String(live?.area || row.area || ""),
    photo_urls: (live && live.photo_urls.length > 0) ? live.photo_urls : snapPhotos,
    mood_tags: (live && live.mood_tags.length > 0) ? live.mood_tags : snapTags,
    date: (row.visited_at as string | null) ?? live?.created_at ?? (row.created_at as string | null) ?? null,
    place_key: String(live?.place_key || row.place_key || ""),
    post_deleted: Boolean(postId) && kindResolved && !live,
  };
}

function shapeBook(row: Record<string, unknown>, coverFallback?: string): Record<string, unknown> {
  return {
    id: row.id,
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    cover_image_url: String(row.cover_image_url || coverFallback || ""),
    visibility: String(row.visibility ?? "private"),
    theme_key: String(row.theme_key ?? ""),
    page_count: Number(row.page_count ?? 0),
    is_archived: Boolean(row.is_archived),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// 所有チェック付きでBOOK1冊を取得（他人のBOOKは404扱い）
async function findOwnBook(hash: string, bookId: string) {
  const db = supabase!;
  const { data, error } = await db.from("mood_books")
    .select("*").eq("id", bookId).eq("device_hash", hash).maybeSingle();
  return { book: (data as Record<string, unknown> | null) ?? null, error };
}

// ページ数の非正規化カウンタと updated_at を更新（表紙未設定なら先頭ページ写真を昇格）
async function refreshBookMeta(bookId: string) {
  const db = supabase!;
  const { count } = await db.from("mood_book_pages")
    .select("id", { count: "exact", head: true }).eq("book_id", bookId);
  const patch: Record<string, unknown> = { page_count: count ?? 0, updated_at: new Date().toISOString() };
  await db.from("mood_books").update(patch).eq("id", bookId);
  return count ?? 0;
}

export async function POST(req: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }
  const db = supabase;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: "JSONが不正です" }, { status: 400 });

  const action = String(body.action ?? "overview");
  const deviceId = String(body.deviceId ?? "").trim().slice(0, 100);
  if (!deviceId) return NextResponse.json({ ok: false, error: "deviceIdが必要です" }, { status: 400 });
  const hash = deviceHash(deviceId);

  const isWrite = action !== "overview" && action !== "get";
  if (isWrite && !rateLimit(`moodbook:${clientIp(req)}`, 40, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
  }

  try {
    // ── overview: プロフィール用（BOOK一覧＋代表BOOKの冒頭ページ）を1往復で ──
    if (action === "overview") {
      const { data: books, error } = await db.from("mood_books")
        .select("*").eq("device_hash", hash).eq("is_archived", false)
        .order("updated_at", { ascending: false }).limit(30);
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: true, books: [], primary: null });
        throw error;
      }
      const blist = (books ?? []) as Array<Record<string, unknown>>;
      if (blist.length === 0) return NextResponse.json({ ok: true, books: [], primary: null });

      // 表紙フォールバック用に各BOOKの先頭付近ページ写真をまとめて取得
      //   （page_order<=5 に絞り全ページ走査を避ける。reorder時に0..n-1へ振り直すため先頭は必ず入る）
      const ids = blist.map((b) => String(b.id));
      const { data: headPages } = await db.from("mood_book_pages")
        .select("book_id, page_order, photo_urls").in("book_id", ids)
        .lte("page_order", 5)
        .order("page_order", { ascending: true });
      const coverBy = new Map<string, string>();
      for (const p of (headPages ?? []) as Array<Record<string, unknown>>) {
        const k = String(p.book_id);
        if (coverBy.has(k)) continue;
        const ph = ((p.photo_urls as string[] | null) ?? []).filter(Boolean);
        if (ph.length > 0) coverBy.set(k, ph[0]);
      }

      // 代表BOOK（最新更新）の冒頭ページを最新値へ同期して返す
      const primaryRow = blist[0];
      const { data: pages } = await db.from("mood_book_pages")
        .select("*").eq("book_id", String(primaryRow.id))
        .order("page_order", { ascending: true }).limit(6);
      const prows = (pages ?? []) as Array<Record<string, unknown>>;
      const resolved = await resolvePosts(deviceId, prows.map((p) => String(p.post_id ?? "")).filter(Boolean));
      return NextResponse.json({
        ok: true,
        books: blist.map((b) => shapeBook(b, coverBy.get(String(b.id)))),
        primary: {
          book: shapeBook(primaryRow, coverBy.get(String(primaryRow.id))),
          pages: prows.map((p) => shapePage(p, resolved)),
        },
      });
    }

    // ── get: BOOK詳細（ページネーション＋元投稿へ自動同期）──
    if (action === "get") {
      const bookId = String(body.bookId ?? "");
      if (!UUID_RE.test(bookId)) return NextResponse.json({ ok: false, error: "bookIdが不正です" }, { status: 400 });
      const { book, error } = await findOwnBook(hash, bookId);
      if (error && isMissingTable(error)) return NextResponse.json({ ok: false, error: "BOOKが見つかりません" }, { status: 404 });
      if (!book) return NextResponse.json({ ok: false, error: "BOOKが見つかりません" }, { status: 404 });
      // NaN防御: 不正な offset/limit で .range(NaN,NaN)=500 にしない
      const rawOffset = Number(body.offset);
      const rawLimit = Number(body.limit);
      const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.floor(rawLimit)), 100) : 40;
      const [{ data: pages }, { count }] = await Promise.all([
        db.from("mood_book_pages").select("*").eq("book_id", bookId)
          .order("page_order", { ascending: true }).range(offset, offset + limit - 1),
        db.from("mood_book_pages").select("id", { count: "exact", head: true }).eq("book_id", bookId),
      ]);
      const prows = (pages ?? []) as Array<Record<string, unknown>>;
      const resolved = await resolvePosts(deviceId, prows.map((p) => String(p.post_id ?? "")).filter(Boolean));
      const shaped = prows.map((p) => shapePage(p, resolved));
      const coverFallback = shaped.find((p) => (p.photo_urls as string[]).length > 0)?.photo_urls as string[] | undefined;
      return NextResponse.json({
        ok: true,
        book: shapeBook(book, coverFallback?.[0]),
        pages: shaped,
        total: count ?? shaped.length,
      });
    }

    // ── create: BOOK作成（初期投稿を同時にページ化できる）──
    if (action === "create") {
      // 作成だけは厳しめの独立バケット＋冊数上限（BOOK量産による書き込み増幅を防ぐ）
      if (!rateLimit(`moodbook-create:${clientIp(req)}`, 6, 60_000)) {
        return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
      }
      const title = String(body.title ?? "").trim().slice(0, 60);
      if (!title) return NextResponse.json({ ok: false, error: "タイトルを入力してください" }, { status: 400 });
      const description = String(body.description ?? "").trim().slice(0, 300);
      const ng = ngCheck(title, description);
      if (ng) return NextResponse.json({ ok: false, error: `不適切な表現が含まれています（${ng}）` }, { status: 400 });
      const visibility = VALID_VISIBILITY.has(String(body.visibility)) ? String(body.visibility) : "private";
      try {
        const { count: bookCount } = await db.from("mood_books")
          .select("id", { count: "exact", head: true }).eq("device_hash", hash);
        if ((bookCount ?? 0) >= 50) {
          return NextResponse.json({ ok: false, error: "BOOKは50冊までです" }, { status: 400 });
        }
      } catch { /* countの失敗で作成は止めない */ }
      const { data: created, error } = await db.from("mood_books")
        .insert({ device_hash: hash, title, description, visibility })
        .select("*").single();
      if (error) {
        if (isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true, error: "mood-books.sql 未適用です" }, { status: 400 });
        throw error;
      }
      const book = created as Record<string, unknown>;
      const postIds = Array.isArray(body.postIds)
        ? [...new Set((body.postIds as unknown[]).map(String).filter(Boolean))].slice(0, 100) : [];
      let added = 0;
      if (postIds.length > 0) {
        const resolved = await resolvePosts(deviceId, postIds);
        const rows = postIds.filter((id) => resolved.map.has(id)).map((id, i) => {
          const s = resolved.map.get(id)!;
          return {
            book_id: String(book.id), post_id: id, place_key: s.place_key, page_order: i,
            spot_name: s.spot_name, area: s.area, excerpt: s.excerpt,
            photo_urls: s.photo_urls, mood_tags: s.mood_tags, visited_at: s.created_at,
          };
        });
        if (rows.length > 0) {
          const { error: insErr } = await db.from("mood_book_pages").insert(rows);
          if (!insErr) added = rows.length;
        }
        await refreshBookMeta(String(book.id));
      }
      return NextResponse.json({ ok: true, book: shapeBook({ ...book, page_count: added }), added });
    }

    // ── 以降は既存BOOKへの操作（所有チェック必須）──
    const bookId = String(body.bookId ?? "");
    if (!UUID_RE.test(bookId)) return NextResponse.json({ ok: false, error: "bookIdが不正です" }, { status: 400 });
    const { book, error: findErr } = await findOwnBook(hash, bookId);
    if (findErr && isMissingTable(findErr)) {
      return NextResponse.json({ ok: false, tableMissing: true, error: "mood-books.sql 未適用です" }, { status: 400 });
    }
    if (!book) return NextResponse.json({ ok: false, error: "BOOKが見つかりません" }, { status: 404 });

    // ── update: タイトル/説明/公開範囲/表紙/アーカイブ ──
    if (action === "update") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 60);
      if (typeof body.description === "string") patch.description = body.description.trim().slice(0, 300);
      if (typeof body.visibility === "string" && VALID_VISIBILITY.has(body.visibility)) patch.visibility = body.visibility;
      if (typeof body.coverImageUrl === "string") {
        // 表紙は https の画像URLのみ（任意文字列の保存＝ストアド注入を防ぐ。空=自動表紙に戻す）
        const cover = body.coverImageUrl.trim().slice(0, 500);
        if (cover === "" || /^https:\/\//.test(cover)) patch.cover_image_url = cover;
      }
      if (typeof body.isArchived === "boolean") patch.is_archived = body.isArchived;
      const ng = ngCheck(patch.title, patch.description);
      if (ng) return NextResponse.json({ ok: false, error: `不適切な表現が含まれています（${ng}）` }, { status: 400 });
      // .eq(device_hash) 併用で「所有確認→更新」の隙を無くす（atomic）
      const { data: updated, error } = await db.from("mood_books")
        .update(patch).eq("id", bookId).eq("device_hash", hash).select("*").single();
      if (error) throw error;
      return NextResponse.json({ ok: true, book: shapeBook(updated as Record<string, unknown>) });
    }

    // ── delete: BOOKとページを削除（ページ削除の失敗時は本体を残す＝孤児ページを作らない）──
    if (action === "delete") {
      const { error: pageErr } = await db.from("mood_book_pages").delete().eq("book_id", bookId);
      if (pageErr && !isMissingTable(pageErr)) throw pageErr;
      const { error } = await db.from("mood_books").delete().eq("id", bookId).eq("device_hash", hash);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // ── add-pages: 投稿をページとして追加（既存分はスキップ＝二重追加防止）──
    if (action === "add-pages") {
      const postIds = Array.isArray(body.postIds)
        ? [...new Set((body.postIds as unknown[]).map(String).filter(Boolean))].slice(0, 100) : [];
      if (postIds.length === 0) return NextResponse.json({ ok: false, error: "postIdsが必要です" }, { status: 400 });
      const { data: existing } = await db.from("mood_book_pages")
        .select("post_id, page_order").eq("book_id", bookId);
      const have = new Set(((existing ?? []) as Array<Record<string, unknown>>).map((p) => String(p.post_id)));
      const maxOrder = ((existing ?? []) as Array<Record<string, unknown>>)
        .reduce((m, p) => Math.max(m, Number(p.page_order ?? 0)), -1);
      const fresh = postIds.filter((id) => !have.has(id));
      const beforeCount = ((existing ?? []) as unknown[]).length;
      if (fresh.length > 0) {
        const resolved = await resolvePosts(deviceId, fresh);
        const rows = fresh.filter((id) => resolved.map.has(id)).map((id, i) => {
          const s = resolved.map.get(id)!;
          return {
            book_id: bookId, post_id: id, place_key: s.place_key, page_order: maxOrder + 1 + i,
            spot_name: s.spot_name, area: s.area, excerpt: s.excerpt,
            photo_urls: s.photo_urls, mood_tags: s.mood_tags, visited_at: s.created_at,
          };
        });
        if (rows.length > 0) {
          const { error: insErr } = await db.from("mood_book_pages").insert(rows);
          if (insErr && (insErr as { code?: string }).code === "23505") {
            // unique(book_id, post_id) 競合＝並行追加。バッチ全体がロールバックされるため
            // 1行ずつ再挿入し、競合行だけスキップして残りを確実に入れる
            for (const r of rows) {
              const { error: oneErr } = await db.from("mood_book_pages").insert(r);
              if (oneErr && (oneErr as { code?: string }).code !== "23505") throw oneErr;
            }
          } else if (insErr) {
            throw insErr;
          }
        }
      }
      // added は「実際に増えた件数」（挿入結果の実数。並行競合でも正確）
      const pageCount = await refreshBookMeta(bookId);
      return NextResponse.json({ ok: true, added: Math.max(0, pageCount - beforeCount), pageCount });
    }

    // ── remove-page: ページを外す（投稿自体は消えない）──
    if (action === "remove-page") {
      const pageId = String(body.pageId ?? "");
      if (!UUID_RE.test(pageId)) return NextResponse.json({ ok: false, error: "pageIdが不正です" }, { status: 400 });
      const { error } = await db.from("mood_book_pages").delete().eq("id", pageId).eq("book_id", bookId);
      if (error) throw error;
      const pageCount = await refreshBookMeta(bookId);
      return NextResponse.json({ ok: true, pageCount });
    }

    // ── reorder: ページ順の並べ替え（pageIds=新しい順序の全ID）──
    if (action === "reorder") {
      const pageIds = Array.isArray(body.pageIds)
        ? (body.pageIds as unknown[]).map(String).filter((v) => UUID_RE.test(v)).slice(0, 100) : [];
      if (pageIds.length === 0) return NextResponse.json({ ok: false, error: "pageIdsが必要です" }, { status: 400 });
      // 書き込み増幅を抑えるため10本ずつのチャンクで直列実行（.eq book_idで他BOOKのページは動かせない）
      for (let i = 0; i < pageIds.length; i += 10) {
        await Promise.all(pageIds.slice(i, i + 10).map((id, j) =>
          db.from("mood_book_pages").update({ page_order: i + j, updated_at: new Date().toISOString() })
            .eq("id", id).eq("book_id", bookId)));
      }
      await db.from("mood_books").update({ updated_at: new Date().toISOString() }).eq("id", bookId);
      return NextResponse.json({ ok: true });
    }

    // ── update-page: ページのカスタム文言（空文字で解除＝元投稿の値に戻る）──
    if (action === "update-page") {
      const pageId = String(body.pageId ?? "");
      if (!UUID_RE.test(pageId)) return NextResponse.json({ ok: false, error: "pageIdが不正です" }, { status: 400 });
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.customTitle === "string") patch.custom_title = body.customTitle.trim().slice(0, 60);
      if (typeof body.customText === "string") patch.custom_text = body.customText.trim().slice(0, 300);
      const ng = ngCheck(patch.custom_title, patch.custom_text);
      if (ng) return NextResponse.json({ ok: false, error: `不適切な表現が含まれています（${ng}）` }, { status: 400 });
      const { error } = await db.from("mood_book_pages").update(patch).eq("id", pageId).eq("book_id", bookId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: `不明なaction: ${action}` }, { status: 400 });
  } catch (e) {
    console.error("[mood-books]", e);
    return NextResponse.json({ ok: false, error: (e as { message?: string })?.message ?? String(e) }, { status: 500 });
  }
}
