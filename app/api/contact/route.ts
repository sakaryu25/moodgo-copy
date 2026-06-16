// ─── /api/contact ──────────────────────────────────────────────────────────────
// お問い合わせフォームの受信。Expo設定画面の「お問い合わせ」から送信される。
// contacts テーブルへ保存。未作成でも「準備中」を返すだけで安全（500にしない）。
//   POST { name?, email?, message, deviceId? } → { ok }
//   GET  ?secret=... → admin用一覧
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const ADMIN = ADMIN_SECRET;

function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST204";
}

export async function POST(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }
  // 連投抑止: 1IPあたり1分で5件まで
  if (!rateLimit(`contact:${clientIp(request)}`, 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいて再度お試しください" }, { status: 429 });
  }
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

    const name = String(body.name ?? "").trim().slice(0, 50);
    const email = String(body.email ?? "").trim().slice(0, 120);
    const message = String(body.message ?? "").trim().slice(0, 2000);
    const deviceId = String(body.deviceId ?? "").trim().slice(0, 100) || null;

    if (!message) {
      return NextResponse.json({ ok: false, error: "お問い合わせ内容は必須です" }, { status: 400 });
    }

    const { error } = await supabase.from("contacts").insert({
      name: name || null,
      email: email || null,
      message,
      device_id: deviceId,
    });

    if (error) {
      if (isMissingTable(error)) {
        // テーブル未作成 → 落とさず「準備中」を返す（アプリ側で丁寧に案内）
        return NextResponse.json(
          { ok: false, tableMissing: true, error: "お問い合わせ機能は準備中です（DB更新待ち）" },
          { status: 400 },
        );
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("contact POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== ADMIN) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, name, email, message, device_id, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ ok: true, contacts: [] });
      throw error;
    }
    return NextResponse.json({ ok: true, contacts: data ?? [] });
  } catch (e) {
    console.error("contact GET error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
