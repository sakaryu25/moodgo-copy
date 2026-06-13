// GET    /api/admin/featured-pages/[id]  → 1ページの全データ取得
// PUT    /api/admin/featured-pages/[id]  → 全体保存（モード・スポットも一括置換）
// DELETE /api/admin/featured-pages/[id]  → ページ削除（cascade）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const SECRET = process.env.ADMIN_SECRET ?? "moodgoadmin123";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SECRET) return unauthorized();
  if (!supabase) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const { data, error } = await supabase
    .from("featured_pages_v2")
    .select(`
      *,
      featured_page_moods ( * ),
      featured_page_spots ( * )
    `)
    .eq("id", id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // sort_order で並び替え
  data.featured_page_moods?.sort((a: any, b: any) => a.sort_order - b.sort_order);
  data.featured_page_spots?.sort((a: any, b: any) => a.sort_order - b.sort_order);

  return NextResponse.json({ data });
}

// ── PUT: バナー + 気分 + スポットを一括保存 ─────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  if (body.secret !== SECRET) return unauthorized();
  if (!supabase) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  const {
    prefecture, issue, label,
    banner_title, banner_description, banner_image_url, banner_icon,
    is_active, sort_order,
    moods = [],
    spots = [],
  } = body;

  // ── 1. バナー更新 ───────────────────────────────────────────────────────
  const { error: pageErr } = await supabase
    .from("featured_pages_v2")
    .update({
      prefecture, issue, label,
      banner_title, banner_description, banner_image_url, banner_icon,
      is_active, sort_order,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (pageErr) return NextResponse.json({ error: pageErr.message }, { status: 500 });

  // ── 2. 気分カードを全置換（delete→insert）─────────────────────────────
  await supabase.from("featured_page_moods").delete().eq("page_id", id);
  if (moods.length > 0) {
    const moodsRows = moods.map((m: any, i: number) => ({
      page_id: id,
      title: m.title ?? "",
      icon_name: m.icon_name ?? "heart",
      icon_color: m.icon_color ?? "#E56B9B",
      bg_color: m.bg_color ?? "#FCE8F0",
      sort_order: i,
    }));
    const { error: moodsErr } = await supabase
      .from("featured_page_moods")
      .insert(moodsRows);
    if (moodsErr) return NextResponse.json({ error: moodsErr.message }, { status: 500 });
  }

  // ── 3. スポットを全置換（delete→insert）──────────────────────────────
  await supabase.from("featured_page_spots").delete().eq("page_id", id);
  if (spots.length > 0) {
    const spotsRows = spots.map((s: any, i: number) => ({
      page_id: id,
      title: s.title ?? "",
      location: s.location ?? "",
      catch_copy: s.catch_copy ?? "",
      description: s.description ?? "",
      image_url: s.image_url ?? "",
      gallery_image_urls: s.gallery_image_urls ?? [],
      tags: s.tags ?? [],
      features: s.features ?? [],
      address: s.address ?? "",
      access: s.access ?? "",
      phone: s.phone ?? "",
      website: s.website ?? "",
      instagram: s.instagram ?? "",
      congestion_info: s.congestion_info ?? "",
      closed_days: s.closed_days ?? "",
      hours: s.hours ?? {},
      menu_items: s.menu_items ?? [],
      events: s.events ?? [],
      sort_order: i,
    }));
    const { error: spotsErr } = await supabase
      .from("featured_page_spots")
      .insert(spotsRows);
    if (spotsErr) return NextResponse.json({ error: spotsErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SECRET) return unauthorized();
  if (!supabase) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  // 子テーブルは ON DELETE CASCADE で自動削除
  const { error } = await supabase
    .from("featured_pages_v2")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
