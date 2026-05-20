import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "moodgoadmin123";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const keyword: string = (body.keyword ?? "").trim();
  if (!keyword) return NextResponse.json({ ok: false, error: "keyword が必要です" }, { status: 400 });

  const { data, error } = await supabase
    .from("places")
    .select("id, name, address, tags, is_active, google_place_id")
    .or(`name.ilike.%${keyword}%,address.ilike.%${keyword}%`)
    .order("name")
    .limit(50);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: (data ?? []).length, places: data ?? [] });
}
