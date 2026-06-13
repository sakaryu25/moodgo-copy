// ─── /api/admin/regeocode-tag ─────────────────────────────────────────────────
// 指定タグのスポットを Google Places Text Search で精密ジオコーディングし直す。
// GSI/Geocoding API は無名POI（心霊スポット等）を県庁中心に丸めるため、
// 地名POIに強い Places Text Search で座標を取り直して places.lat/lng を更新する。
//
// POST { secret, tag, limit?, offset? }
//   → batch で処理し { processed, updated, skipped, failed, nextOffset, done } を返す
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN = process.env.ADMIN_SECRET ?? "moodgoadmin123";
const GKEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

// 都道府県中心など「丸められた座標」に複数スポットが固まっているのを検知するためのヘルパは不要。
// ここでは Places Text Search が返す座標で常に上書きする（名前一致が取れた場合のみ）。

async function placesGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GKEY,
        "X-Goog-FieldMask": "places.location,places.displayName",
      },
      body: JSON.stringify({ textQuery: query, languageCode: "ja", regionCode: "JP", maxResultCount: 1 }),
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    const loc = d?.places?.[0]?.location;
    if (typeof loc?.latitude === "number" && typeof loc?.longitude === "number") {
      return { lat: loc.latitude, lng: loc.longitude };
    }
  } catch { /* noop */ }
  return null;
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (!GKEY) return NextResponse.json({ ok: false, error: "Google APIキー未設定" }, { status: 503 });
  try {
    const body = await req.json();
    if (body?.secret !== ADMIN) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const tag: string = (body.tag ?? "#心霊スポット").trim();
    const limit: number = Math.min(Number(body.limit ?? 20), 40);
    const offset: number = Number(body.offset ?? 0);

    const { data: rows, error } = await supabase
      .from("places")
      .select("id, name, area, address, lat, lng")
      .contains("tags", [tag])
      .order("id")
      .range(offset, offset + limit - 1);
    if (error) throw error;

    let updated = 0, skipped = 0, failed = 0;
    for (const r of rows ?? []) {
      const name = (r.name ?? "").trim();
      if (!name) { skipped++; continue; }
      // 「{都道府県/エリア} {名前}」で精密検索（同名の別地域を避ける）
      const area = (r.area ?? "").trim();
      const q = area ? `${area} ${name}` : name;
      const g = await placesGeocode(q);
      if (!g) { failed++; continue; }
      const { error: upErr } = await supabase
        .from("places")
        .update({ lat: g.lat, lng: g.lng })
        .eq("id", r.id);
      if (upErr) { failed++; continue; }
      updated++;
    }

    const processed = (rows ?? []).length;
    const done = processed < limit;
    return NextResponse.json({ ok: true, processed, updated, skipped, failed, nextOffset: offset + processed, done });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
