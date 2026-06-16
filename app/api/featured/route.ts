export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

// ─── GET: 特集ページ一覧 ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  const isAdmin = secret === ADMIN_SECRET;

  let query = supabase
    .from("featured_pages")
    .select("*")
    .order("created_at", { ascending: false });

  // 管理者でない場合は公開中のみ
  if (!isAdmin) {
    query = query.eq("is_published", true);
  }

  const { data, error } = await query;

  if (error) {
    console.error("featured_pages GET error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: data ?? [] });
}

// ─── POST: 特集ページ新規作成 ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await req.json();
  const { secret, ...fields } = body;

  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // slug の重複チェック
  const { data: existing } = await supabase
    .from("featured_pages")
    .select("id")
    .eq("slug", fields.slug)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: false, error: "このスラッグはすでに使用されています" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("featured_pages")
    .insert([{
      slug: fields.slug,
      partner_name: fields.partner_name ?? "",
      spot_name: fields.spot_name ?? "",
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
    }])
    .select()
    .single();

  if (error) {
    console.error("featured_pages POST error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data });
}
