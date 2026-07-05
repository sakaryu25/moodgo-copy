// ─── /api/user-icon ───────────────────────────────────────────────────────────
// 設定画面のプロフィールアイコン（写真）をSupabase Storageに保存して公開URLを返す。
// グループアイコンと同じ「deviceIdごとに1ファイル上書き」方式（画像は溜まらない）。
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { iconPathFor } from "@/lib/device-hash";

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  try {
    const body = await req.json().catch(() => null);
    const deviceId = String(body?.deviceId ?? "").trim();
    const imageBase64 = String(body?.imageBase64 ?? "");
    if (!deviceId || !imageBase64) {
      return NextResponse.json({ ok: false, error: "deviceIdとimageBase64必須" }, { status: 400 });
    }
    if (imageBase64.length > 3_000_000) {
      return NextResponse.json({ ok: false, error: "画像が大きすぎます" }, { status: 400 });
    }

    const BUCKET = "user-icons";
    await supabase.storage.createBucket(BUCKET, { public: true }); // 既存ならエラーが返るだけ（無視）
    // 公開URLに生deviceId(=ベアラ資格情報)が載る漏洩を防ぐためハッシュ名で保存（2026-07-05監査対応）。
    // 旧 {deviceId}.jpg のアイコンは404→アプリ側で頭文字フォールバック（再アップロードで移行）。
    const path = iconPathFor(deviceId);
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, Buffer.from(imageBase64, "base64"), { contentType: "image/jpeg", upsert: true });
    if (error) throw error;

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ ok: true, icon: `${pub.publicUrl}?v=${Date.now()}` });
  } catch (e) {
    console.error("user-icon POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
