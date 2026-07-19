// ── /api/cron/geocode-missing (P22) ─────────────────────────────────────────
// 座標(lat/lng=location)が欠けた active places を、完全無料のforwardGeocode(GSI→Yahoo)で夜間補完する。
//   座標nullのスポットは find_nearby_places(SB-first主軸)に一切ヒットしない暗在庫＝recallの穴。
//   自己修復: 新規インポートで座標欠損が入っても翌日には検索可能化される（Google課金は使わない）。
// 認証: Vercel Cron の Bearer CRON_SECRET または ?secret=ADMIN_SECRET（手動確認は後者）。
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";
import { forwardGeocode } from "@/lib/forward-geocode";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const urlSecret = new URL(req.url).searchParams.get("secret");
  const isVercelCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  const isAdminCall = urlSecret === ADMIN_SECRET;
  if (!isVercelCron && !isAdminCall) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!supabase) return NextResponse.json({ ok: false, error: "no db" }, { status: 500 });
  const sb = supabase;

  // 1回あたりの上限（GSI/Yahooに優しく・maxDuration内に収める）。?limit= で調整可。
  const limit = Math.min(300, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 120));
  const { data: places } = await sb.from("places")
    .select("id, name, address")
    .is("lat", null).not("address", "is", null).eq("is_active", true)
    .limit(limit);
  const rows = (places ?? []) as Array<{ id: string; name: string | null; address: string | null }>;

  let ok = 0, fail = 0;
  for (const p of rows) {
    const clean = String(p.address ?? "").replace(/^日本[、,]\s*/, "").replace(/^〒\d{3}-\d{4}\s*/, "").trim();
    if (!clean) { fail++; continue; }
    const g = await forwardGeocode(clean);
    if (g) {
      // lat/lng を更新すれば location(geometry) はDBトリガで同期＝find_nearby_places の対象になる。
      const { error } = await sb.from("places").update({ lat: g.lat, lng: g.lng }).eq("id", p.id);
      if (error) fail++; else ok++;
    } else {
      fail++;   // GSI/Yahooで特定不能 → null据え置き（Google再追加はしない）
    }
    await new Promise(r => setTimeout(r, 150));   // 無料源に優しく
  }

  console.log(`[cron/geocode-missing] processed=${rows.length} ok=${ok} fail=${fail}`);
  return NextResponse.json({ ok: true, processed: rows.length, geocoded: ok, unresolved: fail });
}
