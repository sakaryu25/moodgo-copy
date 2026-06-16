// GET  /api/admin/featured-pages       → 全県の特集ページ一覧
// POST /api/admin/featured-pages       → 新規ページ作成
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const SECRET = ADMIN_SECRET;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// ── GET: 全ページ一覧（気分・スポットの件数付き）────────────────────────────
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== SECRET) return unauthorized();
  if (!supabase) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const { data, error } = await supabase
    .from("featured_pages_v2")
    .select(`
      id,
      prefecture,
      issue,
      label,
      banner_title,
      banner_description,
      banner_image_url,
      banner_icon,
      is_active,
      sort_order,
      updated_at,
      featured_page_moods ( id ),
      featured_page_spots ( id )
    `)
    .order("sort_order", { ascending: true })
    .order("prefecture", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// ── POST: 新規ページ作成 ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (body.secret !== SECRET) return unauthorized();
  if (!supabase) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const { prefecture, issue, label, banner_title, banner_description,
          banner_image_url, banner_icon, is_active, sort_order,
          moods = [], spots = [] } = body;

  if (!prefecture?.trim()) {
    return NextResponse.json({ error: "prefecture は必須です" }, { status: 400 });
  }

  // ── 1. メインページを挿入 ──────────────────────────────────────────────
  const { data: page, error: pageErr } = await supabase
    .from("featured_pages_v2")
    .insert({
      prefecture: prefecture.trim(),
      issue: issue ?? "6月号",
      label: label ?? "今月の特集",
      banner_title: banner_title ?? "",
      banner_description: banner_description ?? "",
      banner_image_url: banner_image_url ?? "",
      banner_icon: banner_icon ?? "umbrella",
      is_active: is_active ?? true,
      sort_order: sort_order ?? 0,
    })
    .select()
    .single();

  if (pageErr) return NextResponse.json({ error: pageErr.message }, { status: 500 });

  const pageId = page.id;

  // ── 2. 気分カードを挿入 ────────────────────────────────────────────────
  if (moods.length > 0) {
    await supabase.from("featured_page_moods").insert(
      moods.map((m: any, i: number) => ({ ...m, page_id: pageId, sort_order: i }))
    );
  }

  // ── 3. おすすめスポットを挿入 ──────────────────────────────────────────
  if (spots.length > 0) {
    await supabase.from("featured_page_spots").insert(
      spots.map((s: any, i: number) => ({
        page_id: pageId,
        title: s.title ?? "",
        shop_name: s.shop_name ?? "",
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
      }))
    );
  }

  return NextResponse.json({ data: page }, { status: 201 });
}
