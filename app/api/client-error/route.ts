// ─── /api/client-error ─────────────────────────────────────────────────────────
// Expoアプリのクラッシュ／JSエラーを受信して client_errors テーブルに保存する
// （内蔵の軽量クラッシュ監視。Sentry未設定でも動く）。
// テーブル未作成でも黙ってokを返す＝アプリ側はfire-and-forgetで送るだけ。
//   POST { message, stack?, kind?, deviceId?, platform?, appVersion?, context? }
//   GET  ?secret=... → admin用一覧
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN = "moodgoadmin123";

function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST204";
}

export async function POST(request: Request) {
  // Supabase未設定でも 200 を返す（クライアントはfire-and-forget。失敗で再送しない）
  if (!supabase) return NextResponse.json({ ok: true });
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: true });

    const message = String(body.message ?? "").trim().slice(0, 1000);
    if (!message) return NextResponse.json({ ok: true });

    const row = {
      message,
      stack: body.stack ? String(body.stack).slice(0, 6000) : null,
      kind: String(body.kind ?? "error").slice(0, 40),         // 'fatal' | 'error' | 'unhandled_rejection' | 'boundary'
      device_id: body.deviceId ? String(body.deviceId).slice(0, 100) : null,
      platform: body.platform ? String(body.platform).slice(0, 40) : null,
      app_version: body.appVersion ? String(body.appVersion).slice(0, 40) : null,
      context: body.context ? String(JSON.stringify(body.context)).slice(0, 2000) : null,
    };

    const { error } = await supabase.from("client_errors").insert(row);
    // テーブル未作成・列差異は黙殺（監視は best-effort）
    if (error && !isMissingTable(error)) console.error("client-error insert:", error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("client-error POST error:", e);
    return NextResponse.json({ ok: true });
  }
}

export async function GET(request: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== ADMIN) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { data, error } = await supabase
      .from("client_errors")
      .select("id, message, stack, kind, device_id, platform, app_version, context, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ ok: true, errors: [] });
      throw error;
    }
    return NextResponse.json({ ok: true, errors: data ?? [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
