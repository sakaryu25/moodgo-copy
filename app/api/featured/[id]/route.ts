export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const ADMIN_SECRET = "moodgoadmin123";

// ─── GET: 特集ページ詳細（slug または id で取得） ──────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // まず slug で検索、なければ id で検索
  const { data: bySlug } = await supabase
    .from("featured_pages")
    .select("*")
    .eq("slug", id)
    .maybeSingle();

  if (bySlug) return NextResponse.json({ ok: true, data: bySlug });

  const { data: byId, error } = await supabase
    .from("featured_pages")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !byId) {
    return NextResponse.json({ ok: false, error: "ページが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: byId });
}

// ─── PUT: 特集ページ更新 ───────────────────────────────────────────────────
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { secret, ...fields } = body;

  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("featured_pages")
    .update({
      partner_name: fields.partner_name,
      spot_name: fields.spot_name,
      catch_copy: fields.catch_copy ?? null,
      description: fields.description ?? null,
      access: fields.access ?? null,
      address: fields.address ?? null,
      lat: fields.lat ?? null,
      lng: fields.lng ?? null,
      phone: fields.phone ?? null,
      website: fields.website ?? null,
      instagram: fields.instagram ?? null,
      business_hours: fields.business_hours ?? null,
      recommended_items: fields.recommended_items ?? [],
      features: fields.features ?? [],
      congestion_info: fields.congestion_info ?? null,
      cover_image_url: fields.cover_image_url ?? null,
      gallery_image_urls: fields.gallery_image_urls ?? [],
      tags: fields.tags ?? [],
      contract_start: fields.contract_start ?? null,
      contract_end: fields.contract_end ?? null,
      is_published: fields.is_published ?? false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("featured_pages PUT error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}

// ─── DELETE: 特集ページ削除 ────────────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { secret } = await req.json();

  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("featured_pages")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("featured_pages DELETE error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
