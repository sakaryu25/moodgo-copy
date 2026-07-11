export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 住所補完（admin・2026-07-09）
 * 住所が「日本」だけ / 都道府県だけ / 空 で位置が特定できない places を抽出し、adminから補充する。
 *   GET  ?secret=&q=&limit=&offset=            … 対象一覧（id,name,address,lat,lng）
 *   POST { secret, placeId, action:"suggest" } … 座標からGoogle逆引き住所の候補を返す（保存しない）
 *   POST { secret, placeId, address }          … 住所を保存
 * ⚠ requireAdmin(ADMIN_SECRET) 必須。
 */
import { NextRequest, NextResponse } from "next/server";
import { supabase as supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, requireAdminFromReq } from "@/lib/admin-auth";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

const PREFS = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

// 「位置が特定できない住所」= 空 / 「日本」だけ / 都道府県だけ（前後の「日本、」等も許容）
function incompleteOrFilter(): string {
  const eqs = ["日本", "日本国", ...PREFS, ...PREFS.map((p) => `日本、${p}`)];
  return ["address.is.null", ...eqs.map((v) => `address.eq."${v}"`)].join(",");
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&region=jp&key=${GOOGLE_API_KEY}`;
    const res = await fetch(url);
    const d = await res.json();
    const first = d?.results?.[0];
    if (!first) return null;
    let addr = String(first.formatted_address ?? "");
    addr = addr.replace(/^日本[、,]\s*/, "").replace(/〒?\s*\d{3}-?\d{4}\s*/, "").trim();
    return addr || null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (!requireAdminFromReq(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().replace(/[,%()*]/g, "").slice(0, 60);
  const limit = Math.min(Number(searchParams.get("limit") ?? "300"), 1000);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);

  let query = supabaseAdmin
    .from("places")
    .select("id, name, address, lat, lng, tags")
    .eq("is_active", true)
    .or(incompleteOrFilter());
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, error } = await query.order("name", { ascending: true }).range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, places: data ?? [], count: (data ?? []).length });
}

export async function POST(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  if (!isAdminRequest(request, body?.secret)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const placeId = String(body?.placeId ?? "").trim();
  if (!placeId) return NextResponse.json({ ok: false, error: "placeIdが必要です" }, { status: 400 });

  // 候補取得: 座標からGoogle逆引き（保存しない）
  if (body?.action === "suggest") {
    const { data: pl } = await supabaseAdmin.from("places").select("lat, lng").eq("id", placeId).maybeSingle();
    const lat = (pl as { lat?: number } | null)?.lat, lng = (pl as { lng?: number } | null)?.lng;
    if (lat == null || lng == null) return NextResponse.json({ ok: false, error: "座標が無いため逆引きできません（先に座標登録が必要）" }, { status: 400 });
    const addr = await reverseGeocode(Number(lat), Number(lng));
    if (!addr) return NextResponse.json({ ok: false, error: "逆引きできませんでした" }, { status: 404 });
    return NextResponse.json({ ok: true, address: addr });
  }

  // 保存
  const address = String(body?.address ?? "").trim().slice(0, 300);
  if (!address) return NextResponse.json({ ok: false, error: "住所を入力してください" }, { status: 400 });
  const { error } = await supabaseAdmin.from("places").update({ address }).eq("id", placeId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
