// ── /api/admin/place-edit ─────────────────────────────────────────────────────
// 🛠 場所編集タブ用: 1件取得(get) と 直接編集(update)。
//   「場所名/営業時間/最寄り駅が違う」報告への対応として、名前検索(search-places)→
//   このAPIで名前・住所・座標・営業時間・最寄り駅・公開状態を修正する。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

// 編集フォームで扱う全列（タグ/値段=budget/休業日/写真=image_urls・photo_url も含めて丸ごと見せる）
const COLS = "id, name, address, lat, lng, open_hours, nearest_station, is_active, source_type, google_place_id, tags, budget, close_day, image_urls, photo_url, rating, rating_count";

// 写真を集約: places(image_urls配列＋photo_url単体レガシー) ＋ 利用者写真(spot_photos)。重複排除。
async function placePhotos(db: NonNullable<typeof supabase>, id: string, row: { image_urls?: unknown; photo_url?: unknown }): Promise<string[]> {
  const photos: string[] = [];
  if (Array.isArray(row.image_urls)) for (const u of row.image_urls) if (typeof u === "string" && u) photos.push(u);
  if (typeof row.photo_url === "string" && row.photo_url) photos.push(row.photo_url);
  await db.from("spot_photos").select("image_url").eq("place_id", id).neq("moderation_status", "hidden").limit(24)
    .then(({ data }) => { for (const p of (data ?? []) as { image_url: string }[]) if (p.image_url) photos.push(p.image_url); }, () => {});
  return [...new Set(photos)].slice(0, 24);
}
// 値段: 利用者のMoodログ price_chip を集計（placesのbudgetは未設定が大半のため補助表示）
async function placePriceChips(db: NonNullable<typeof supabase>, id: string): Promise<string[]> {
  let chips: string[] = [];
  await db.from("spot_posts").select("price_chip").eq("place_id", id).not("price_chip", "is", null).limit(50)
    .then(({ data }) => { chips = [...new Set((data ?? []).map((r: { price_chip: string | null }) => String(r.price_chip ?? "").trim()).filter(Boolean))]; }, () => {});
  return chips.slice(0, 12);
}

// 学習シグナル: このスポットにユーザーが積み上げた資産（写真/Moodログ/評価/行動）。
//   削除前に「消していいか」を判断する材料＝検索に効いている場所を誤って消さないためのガード。
async function placeSignals(db: NonNullable<typeof supabase>, id: string, name: string | null): Promise<{ photos: number; posts: number; ratings: number; engagement: number }> {
  const out = { photos: 0, posts: 0, ratings: 0, engagement: 0 };
  await db.from("spot_photos").select("place_id", { count: "exact", head: true }).eq("place_id", id).neq("moderation_status", "hidden")
    .then((r) => { out.photos = r.count ?? 0; }, () => {});
  await db.from("spot_posts").select("place_id", { count: "exact", head: true }).eq("place_id", id).neq("status", "rejected")
    .then((r) => { out.posts = r.count ?? 0; }, () => {});
  await db.from("spot_ratings").select("place_id", { count: "exact", head: true }).eq("place_id", id)
    .then((r) => { out.ratings = r.count ?? 0; }, () => {});
  if (name) await db.from("spot_engagement").select("place_name", { count: "exact", head: true }).eq("place_name", name)
    .then((r) => { out.engagement = r.count ?? 0; }, () => {});
  return out;
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const action = String(body?.action ?? "");
  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id が必要です" }, { status: 400 });

  if (action === "get") {
    const { data, error } = await db.from("places").select(COLS).eq("id", id).maybeSingle();
    if (error || !data) return NextResponse.json({ ok: false, error: error?.message ?? "not found" }, { status: 404 });
    const row = data as { name?: string | null; image_urls?: unknown; photo_url?: unknown };
    const [signals, photos, priceChips] = await Promise.all([
      placeSignals(db, id, row.name ?? null),
      placePhotos(db, id, row),
      placePriceChips(db, id),
    ]);
    return NextResponse.json({ ok: true, place: data, signals, photos, priceChips });
  }

  // 削除＝ソフト削除(is_active=false)。検索/詳細から外れるが写真/Moodログ/評価は残り、restoreで復活可。
  if (action === "delete" || action === "restore") {
    const next = action === "restore";
    const { data, error } = await db.from("places").update({ is_active: next }).eq("id", id).select(COLS).maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, place: data });
  }

  if (action === "update") {
    const p = (body?.patch ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof p.name === "string" && p.name.trim().length >= 1) patch.name = p.name.trim().slice(0, 200);
    if (typeof p.address === "string") patch.address = p.address.trim().slice(0, 300);
    if (typeof p.open_hours === "string") patch.open_hours = p.open_hours.trim().slice(0, 400) || null;
    if (typeof p.nearest_station === "string") patch.nearest_station = p.nearest_station.trim().slice(0, 100) || null;
    if (p.lat === null) patch.lat = null;
    else if (typeof p.lat === "number" && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90) patch.lat = p.lat;
    if (p.lng === null) patch.lng = null;
    else if (typeof p.lng === "number" && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180) patch.lng = p.lng;
    if (typeof p.is_active === "boolean") patch.is_active = p.is_active;
    // タグ（配列）・値段(budget)・休業日(close_day) も編集可
    if (Array.isArray(p.tags)) patch.tags = (p.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean).slice(0, 40);
    if (typeof p.budget === "string") patch.budget = p.budget.trim().slice(0, 100) || null;
    if (typeof p.close_day === "string") patch.close_day = p.close_day.trim().slice(0, 100) || null;
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: "変更がありません" }, { status: 400 });

    const { data, error } = await db.from("places").update(patch).eq("id", id).select(COLS).maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, place: data });
  }

  return NextResponse.json({ ok: false, error: "action は get | update | delete | restore" }, { status: 400 });
}
