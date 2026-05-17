// /api/admin/block-place
// 管理者が全ユーザー対象にスポットを非表示にする・解除する

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// 全体ブロック一覧取得
export async function GET() {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const { data, error } = await supabase
    .from("globally_blocked_places")
    .select("*")
    .order("blocked_at", { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, blocked: data ?? [] });
}

// 全体ブロックに追加
export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const { spot_name, spot_address, reason, report_id } = await req.json();
  if (!spot_name?.trim()) return NextResponse.json({ ok: false, error: "spot_name必須" }, { status: 400 });

  const { error } = await supabase
    .from("globally_blocked_places")
    .upsert({ spot_name: spot_name.trim(), spot_address: spot_address ?? null, reason: reason ?? null },
             { onConflict: "spot_name" });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // 対応する report を reviewed にマーク
  if (report_id) {
    await supabase.from("reports").update({ status: "blocked" }).eq("id", report_id);
  }

  return NextResponse.json({ ok: true });
}

// 全体ブロック解除
export async function DELETE(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const { spot_name } = await req.json();
  const { error } = await supabase
    .from("globally_blocked_places")
    .delete()
    .eq("spot_name", spot_name);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
