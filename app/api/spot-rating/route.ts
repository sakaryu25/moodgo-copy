// ─── /api/spot-rating ────────────────────────────────────────────────────────
// MoodGo独自の星評価（Google評価から自前評価へ移行する受け皿）。
//   POST { placeId, placeName, deviceId, stars(1-5) } … 1ユーザー1スポット1票(更新可)
//   GET  ?placeId=&deviceId=                          … { avg, count, myStars }
// 検索/詳細の表示評価は、十分件数が貯まったら places.rating(Google保存値)からこの平均へ切替。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { rateLimit, clientIp } from "@/lib/rate-limit";

function isMissingTable(e: { code?: string } | null): boolean {
  return e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST204";
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (!rateLimit(`spot-rating:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => null);
    const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
    const stars = Math.round(Number(body?.stars));
    const placeId = body?.placeId ? String(body.placeId).trim().slice(0, 200) : null;
    const placeName = String(body?.placeName ?? "").trim().slice(0, 200);
    if (!deviceId) return NextResponse.json({ ok: false, error: "アプリの利用が必要です" }, { status: 401 });
    if (!(stars >= 1 && stars <= 5)) return NextResponse.json({ ok: false, error: "星は1〜5です" }, { status: 400 });
    if (!placeId && !placeName) return NextResponse.json({ ok: false, error: "スポット情報が必要です" }, { status: 400 });

    // 1ユーザー1スポット1票（place_id,device_id で upsert）。place_id 無しは place_name を識別子に流用。
    const key = placeId ?? placeName;
    const { error } = await supabase.from("spot_ratings")
      .upsert({ place_id: key, place_name: placeName || null, device_id: deviceId, stars, updated_at: new Date().toISOString() }, { onConflict: "place_id,device_id" });
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true, error: "評価は準備中です（DB更新待ち）" }, { status: 400 });
      throw error;
    }
    // 集計を返す
    const { data: rows } = await supabase.from("spot_ratings").select("stars").eq("place_id", key);
    const list = (rows ?? []).map(r => Number((r as { stars: number }).stars)).filter(n => n >= 1);
    const count = list.length;
    const avg = count > 0 ? Math.round((list.reduce((a, b) => a + b, 0) / count) * 10) / 10 : null;
    return NextResponse.json({ ok: true, avg, count, myStars: stars });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!supabase) return NextResponse.json({ ok: true, avg: null, count: 0, myStars: 0 });
  const { searchParams } = new URL(req.url);
  const placeId = searchParams.get("placeId")?.trim();
  const placeName = searchParams.get("placeName")?.trim();
  const deviceId = searchParams.get("deviceId")?.trim() ?? "";
  const key = placeId || placeName;
  if (!key) return NextResponse.json({ ok: true, avg: null, count: 0, myStars: 0 });
  try {
    const { data, error } = await supabase.from("spot_ratings").select("stars, device_id").eq("place_id", key);
    if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, avg: null, count: 0, myStars: 0 }); throw error; }
    const rows = (data ?? []) as Array<{ stars: number; device_id: string }>;
    const count = rows.length;
    const avg = count > 0 ? Math.round((rows.reduce((a, r) => a + Number(r.stars), 0) / count) * 10) / 10 : null;
    const mine = deviceId ? rows.find(r => r.device_id === deviceId)?.stars ?? 0 : 0;
    return NextResponse.json({ ok: true, avg, count, myStars: mine });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
