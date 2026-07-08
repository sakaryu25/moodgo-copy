export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * アカウント種別の付与（admin・2026-07-09）
 * POST { secret, handle, accountType: 'user'|'store'|'official' }
 *   → user_handles.account_type を更新（認証/店舗バッジ）。requireAdmin。
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase as db } from "@/lib/supabase";
import { isAdminRequest } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  if (!db) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await req.json().catch(() => null);
  if (!body || !isAdminRequest(req, body?.secret)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const handle = String(body?.handle ?? "").trim().toLowerCase().replace(/^@+/, "");
  const accountType = body?.accountType === "store" || body?.accountType === "official" ? body.accountType : "user";
  if (!/^[a-z0-9_]{3,20}$/.test(handle)) return NextResponse.json({ ok: false, error: "handleが不正です" }, { status: 400 });

  const { data, error } = await db.from("user_handles").update({ account_type: accountType }).eq("handle", handle).select("device_id");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const matched = Array.isArray(data) ? data.length : 0;
  return NextResponse.json({ ok: true, matched, accountType });
}
