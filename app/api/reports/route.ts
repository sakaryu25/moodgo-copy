export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

    const { spot_name, spot_address, reason, note } = body;
    if (!spot_name?.trim() || !reason?.trim()) {
      return NextResponse.json({ ok: false, error: "スポット名と理由は必須です" }, { status: 400 });
    }

    const { error } = await supabase.from("reports").insert({
      spot_name: spot_name.trim(),
      spot_address: spot_address?.trim() ?? null,
      reason: reason.trim(),
      note: note?.trim() ?? null,
    });

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("reports POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET() {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ ok: true, reports: data ?? [] });
  } catch (e) {
    console.error("reports GET error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
