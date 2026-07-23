// ── /api/admin/photo-harvest ─────────────────────────────────────────────────
// 📷 Wikimedia写真の一括付与（admin）。重い Wikidata SPARQL取得はブラウザ側(パネル)で行い、
//   サーバーは「写真なしスポットの一覧(GET)」と「マッチ結果の書き込み(POST apply)」だけ担当。
//   ＝Vercelのタイムアウトを回避しつつ、adminはボタンを押すだけで写真被覆を上げられる。
//   写真は Wikimedia Commons(CC/PD)。飲食(osm-foodshop)はWikidata画像がほぼ無いので対象外。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

// Wikidata画像が付きやすい映え/自然/観光系のみ（飲食等はユーザー投稿に委ねる）
const SOURCES = ["osm-nature", "osm-scenic", "osm-travel", "osm-fun", "osm-climbing", "admin", "japan47go"];

// GET: 写真なし(image_urls null かつ photo_url null)の active スポットを id 昇順で1ページ返す。
//   ブラウザ側が Wikidata索引と名前+座標で照合するため、id/name/lat/lng/source_type を返す。
export async function GET(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const cursor = (searchParams.get("cursor") ?? "").trim();   // 前ページ末尾のid（keyset）
  const limit = Math.min(Number(searchParams.get("limit") ?? "500"), 1000);
  try {
    let q = supabase.from("places").select("id, name, lat, lng, source_type")
      .in("source_type", SOURCES).eq("is_active", true)
      .is("image_urls", null).is("photo_url", null)
      .order("id", { ascending: true }).limit(limit);
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const rows = (data ?? []) as Array<{ id: string; name: string; lat: number | null; lng: number | null }>;
    return NextResponse.json({ ok: true, places: rows, nextCursor: rows.length ? rows[rows.length - 1].id : null, done: rows.length < limit });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// POST apply: ブラウザが照合した {id, url}[] を image_urls=[url] で書き込む。
//   ⚠ 既に写真がある行は上書きしない（image_urls is null 条件つき更新）。
export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const updates = Array.isArray(body?.updates) ? body.updates : [];
  if (updates.length === 0) return NextResponse.json({ ok: true, applied: 0 });
  let applied = 0;
  // Wikimedia Commonsの公開URL(https)だけ許可＝任意URL書き込みを防ぐ
  const isCommons = (u: unknown) => typeof u === "string" && /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//.test(u);
  for (const u of updates.slice(0, 1000)) {
    const id = String(u?.id ?? "").trim();
    const url = u?.url;
    if (!id || !isCommons(url)) continue;
    const { error } = await db.from("places").update({ image_urls: [url] }).eq("id", id).is("image_urls", null);
    if (!error) applied++;
  }
  return NextResponse.json({ ok: true, applied });
}
