export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ─── プッシュトークン登録（端末→push_tokens）────────────────────────────────────
//   POST {deviceId, token, platform} → token をキーに upsert（端末ごと最新を保持）。
//   将来の配信（お気に入りの近況/Moodログ反応 等）の宛先テーブル。
//   ⚠ 要 supabase/push-tokens.sql 適用（未適用でも握りつぶし＝アプリは正常動作）。
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash } from "@/lib/device-hash";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const deviceId = String(body?.deviceId ?? "").trim();
  const token = String(body?.token ?? "").trim();
  const platform = String(body?.platform ?? "").trim().slice(0, 16) || null;

  if (!deviceId || !token) {
    return NextResponse.json({ ok: false, error: "deviceId と token が必要です" }, { status: 400 });
  }
  // Expoプッシュトークン形式の軽い検証（明らかな不正値を弾く）
  if (!/^Expo(nent)?PushToken\[.+\]$/.test(token)) {
    return NextResponse.json({ ok: false, error: "token 形式が不正です" }, { status: 400 });
  }

  if (!rateLimit(`push-token:${deviceId}`, 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  if (!supabase) return NextResponse.json({ ok: false, error: "no db" }, { status: 503 });

  try {
    // token をユニークキーに upsert（端末の再インストールで新トークンになっても重複しない）
    // ⚠ supabase-js は失敗しても throw せず { error } を返す。未チェックだと push-tokens.sql
    //   未適用（テーブル/device_hash列なし）が無音で握りつぶされ配信不能に気付けない。
    const { error } = await supabase.from("push_tokens").upsert(
      { token, device_id: deviceId, device_hash: deviceHash(deviceId), platform, updated_at: new Date().toISOString() },
      { onConflict: "token" },
    );
    if (error) {
      // SQL未適用でもアプリは壊さない（ok:true）。診断用に stored:false と理由を返す
      return NextResponse.json({ ok: true, stored: false, note: "push_tokens 未適用の可能性: " + error.message });
    }
    return NextResponse.json({ ok: true, stored: true });
  } catch (e) {
    return NextResponse.json({ ok: true, stored: false, note: "push_tokens 未作成かもしれません: " + String(e) });
  }
}
