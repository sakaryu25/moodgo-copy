// ── /api/admin/location-fill ─────────────────────────────────────────────────
// 📍 位置情報補完（2026-07-15）: 旧「座標登録」(住所→座標) と「住所補完」(座標→住所) を統一。
//   位置が欠けたスポット（座標なし or 住所が空/日本/都道府県だけ）を1画面で双方向に補完する。
//   ・auto: 座標が無ければ 名前+住所 で forward geocode して座標＋完全住所を取得。
//           座標があれば reverse geocode で「県+市+区+町+丁目+番地」の完全住所に。
//   ・完全住所形式（例: 神奈川県横浜市金沢区富岡東1-44-11）で保存＝検索の距離/地名精度が上がる。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
const PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];

// 住所が「未登録相当」か（空 / 日本 / 都道府県だけ）＝補完対象
function isIncompleteAddr(a: string | null | undefined): boolean {
  const t = String(a ?? "").replace(/^日本[、,\s]*/, "").trim();
  return !t || t === "日本" || t === "日本国" || PREFS.includes(t);
}
function prefOf(a: string | null | undefined): string {
  const t = String(a ?? "").replace(/^日本[、,\s]*/, "").trim();
  return PREFS.find((p) => t.startsWith(p)) ?? "";
}
// 完全住所化: 国名・郵便番号だけ除き、丁目・番地は残す（例: 神奈川県横浜市金沢区富岡東1-44-11）
function cleanFull(addr: string): string {
  return String(addr ?? "").replace(/^日本[、,]\s*/, "").replace(/〒?\s*\d{3}-?\d{4}\s*/, "").trim();
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!GOOGLE_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=ja&region=jp&key=${GOOGLE_API_KEY}`;
    const d = await (await fetch(url, { cache: "no-store" })).json();
    const first = d?.results?.[0];
    if (!first) return null;
    return cleanFull(String(first.formatted_address ?? "")) || null;
  } catch { return null; }
}
async function forwardGeocode(query: string): Promise<{ lat: number; lng: number; address: string } | null> {
  if (!GOOGLE_API_KEY || query.trim().length < 2) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query.trim())}&language=ja&region=jp&key=${GOOGLE_API_KEY}`;
    const d = await (await fetch(url, { cache: "no-store" })).json();
    const first = d?.results?.[0];
    const loc = first?.geometry?.location;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
    return { lat: Number(loc.lat), lng: Number(loc.lng), address: cleanFull(String(first.formatted_address ?? "")) };
  } catch { return null; }
}

type Row = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; tags: string[] | null };

// 1件を双方向補完（座標なし→forward / 住所不完全→reverse）。戻り値=更新後の値 or null
async function autoFill(db: NonNullable<typeof supabase>, row: Row): Promise<{ lat: number | null; lng: number | null; address: string } | null> {
  let lat = row.lat, lng = row.lng, address = row.address ?? "";
  // ① 座標が無ければ forward（住所が具体的ならそれ、無ければ 名前+都道府県、最後に名前だけ）
  if (lat == null || lng == null) {
    const pref = prefOf(row.address);
    const candidates = [
      !isIncompleteAddr(row.address) ? String(row.address) : "",
      row.name ? `${row.name} ${pref}`.trim() : "",
      row.name || "",
    ].filter(Boolean);
    for (const q of candidates) {
      const g = await forwardGeocode(q);
      if (g) { lat = g.lat; lng = g.lng; if (isIncompleteAddr(address) && g.address) address = g.address; break; }
    }
  }
  // ② 座標があり住所が不完全なら reverse で完全住所
  if (lat != null && lng != null && isIncompleteAddr(address)) {
    const rev = await reverseGeocode(lat, lng);
    if (rev) address = rev;
  }
  const patch: Record<string, unknown> = {};
  if (lat != null && lng != null && (row.lat == null || row.lng == null)) { patch.lat = lat; patch.lng = lng; }
  if (address && address !== (row.address ?? "") && !isIncompleteAddr(address)) patch.address = address;
  if (Object.keys(patch).length === 0) return null;   // 何も改善できなかった
  const { error } = await db.from("places").update(patch).eq("id", row.id);
  if (error) return null;
  return { lat, lng, address };
}

export async function GET(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (new URL(req.url).searchParams.get("secret") !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().replace(/[,%()*]/g, "").slice(0, 60);
  const limit = Math.min(Number(searchParams.get("limit") ?? "300"), 1000);

  // 座標なし OR 住所不完全 の active スポット（両問題を1リストに統合）
  let query = supabase.from("places").select("id, name, address, lat, lng, tags").eq("is_active", true);
  const incompleteEqs = ["日本", "日本国", ...PREFS, ...PREFS.map((p) => `日本、${p}`)];
  const orExpr = ["lat.is.null", "lng.is.null", "address.is.null", ...incompleteEqs.map((v) => `address.eq."${v}"`)].join(",");
  query = query.or(orExpr);
  if (q) query = query.ilike("name", `%${q}%`);
  const { data, error } = await query.order("name").limit(limit);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const rows = ((data ?? []) as Row[]).map((r) => ({
    ...r,
    noCoord: r.lat == null || r.lng == null,
    badAddr: isIncompleteAddr(r.address),
  }));
  return NextResponse.json({ ok: true, count: rows.length, places: rows });
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const action = String(body?.action ?? "");

  // 手動保存（座標 and/or 住所）
  if (action === "save") {
    const id = String(body?.placeId ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "placeId必須" }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if (typeof body.lat === "number" && Number.isFinite(body.lat)) patch.lat = body.lat;
    if (typeof body.lng === "number" && Number.isFinite(body.lng)) patch.lng = body.lng;
    if (typeof body.address === "string" && body.address.trim()) patch.address = body.address.trim().slice(0, 300);
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: "変更なし" }, { status: 400 });
    const { error } = await db.from("places").update(patch).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, patch });
  }

  // 1件 自動補完
  if (action === "auto") {
    const id = String(body?.placeId ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "placeId必須" }, { status: 400 });
    const { data } = await db.from("places").select("id, name, address, lat, lng, tags").eq("id", id).maybeSingle();
    if (!data) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const r = await autoFill(db, data as Row);
    if (!r) return NextResponse.json({ ok: false, error: "補完できませんでした（名前/住所から特定不可）" }, { status: 200 });
    return NextResponse.json({ ok: true, ...r });
  }

  // 一括 自動補完（1呼び出し=最大25件・コスト/タイムアウト対策。クライアントがdoneまで再呼び出し）
  if (action === "auto-batch") {
    const incompleteEqs = ["日本", "日本国", ...PREFS, ...PREFS.map((p) => `日本、${p}`)];
    const orExpr = ["lat.is.null", "lng.is.null", "address.is.null", ...incompleteEqs.map((v) => `address.eq."${v}"`)].join(",");
    const { data } = await db.from("places").select("id, name, address, lat, lng, tags").eq("is_active", true).or(orExpr).order("name").limit(25);
    const rows = (data ?? []) as Row[];
    let filled = 0;
    for (const row of rows) { if (await autoFill(db, row)) filled++; }
    return NextResponse.json({ ok: true, processed: rows.length, filled, done: rows.length < 25 });
  }

  return NextResponse.json({ ok: false, error: "action は auto | auto-batch | save" }, { status: 400 });
}
