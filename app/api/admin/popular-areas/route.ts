// 人気エリア（特集TOPの横スクロールカード）のAdmin CRUD。
//   GET    ?secret=            → 全件（is_active問わず）
//   POST   {secret, ...fields} → 新規作成
//   PUT    {secret, id, ...}   → 更新
//   DELETE {secret, id}        → 削除
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

const FIELDS = ["name", "description", "image_url", "scope_type", "scope_key",
  "destination_type", "destination_value", "sort_order", "is_active", "start_at", "end_at"] as const;

function pickFields(body: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const f of FIELDS) {
    if (body[f] !== undefined) row[f] = f === "start_at" || f === "end_at" ? (body[f] || null) : body[f];
  }
  return row;
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("secret") !== ADMIN_SECRET) return unauthorized();
  if (!supabase) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  const { data, error } = await supabase
    .from("popular_areas")
    .select("*")
    .order("scope_type", { ascending: true })
    .order("scope_key", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return NextResponse.json({ data: [], tableMissing: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (body.secret !== ADMIN_SECRET) return unauthorized();
  if (!supabase) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  if (!String(body.name ?? "").trim()) {
    return NextResponse.json({ error: "name は必須です" }, { status: 400 });
  }
  const { data, error } = await supabase.from("popular_areas").insert(pickFields(body)).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  if (body.secret !== ADMIN_SECRET) return unauthorized();
  if (!supabase) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  if (!body.id) return NextResponse.json({ error: "id は必須です" }, { status: 400 });
  const row = { ...pickFields(body), updated_at: new Date().toISOString() };
  const { error } = await supabase.from("popular_areas").update(row).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  if (body.secret !== ADMIN_SECRET) return unauthorized();
  if (!supabase) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  if (!body.id) return NextResponse.json({ error: "id は必須です" }, { status: 400 });
  const { error } = await supabase.from("popular_areas").delete().eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
