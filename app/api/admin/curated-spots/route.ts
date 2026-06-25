export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

// ─── タグ別キュレーションスポット保管テーブル（curated_spots）の管理API ───────────
//   各 # タグ（#テーマパーク / #鑑賞 / #服アクセサリー 等）ごとに、運営が手動で
//   「そこにしかない」スポットを溜める専用テーブル。検索時に該当タグで優先注入される。
//
//   ★ 事前に Supabase で下記テーブルを作成すること（未作成時は ok:false で hint を返す）:
//   CREATE TABLE curated_spots (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     name text NOT NULL,
//     address text,
//     lat double precision,
//     lng double precision,
//     google_place_id text,
//     tags text[] NOT NULL DEFAULT '{}',
//     description text,
//     image_url text,
//     photo_urls text[],
//     area text,
//     station_info text,
//     is_active boolean DEFAULT true,
//     created_at timestamptz DEFAULT now(),
//     updated_at timestamptz DEFAULT now()
//   );
//   CREATE INDEX idx_curated_spots_tags ON curated_spots USING gin(tags);

const TABLE_MISSING_HINT =
  "curated_spots テーブルが未作成です。Supabase SQL Editor で CREATE TABLE curated_spots(...) を実行してください（route.ts 冒頭のSQL参照）。";

function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "PGRST204";
}

// GET — タグでフィルタした一覧（tag省略時は全件・最新順）
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  const tag = searchParams.get("tag")?.trim();
  try {
    let q = supabase
      .from("curated_spots")
      .select("id, name, address, lat, lng, google_place_id, tags, description, image_url, photo_urls, area, station_info, is_active, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (tag) q = q.contains("tags", [tag]);

    const { data, error } = await q;
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ ok: false, tableMissing: true, hint: TABLE_MISSING_HINT });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, data: data ?? [] });
  } catch (e) {
    console.error("curated-spots GET error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// POST — スポットを追加（tags は # 付き配列。気分タグ＋深掘りタグの両方を含めること）
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || body.secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  const name = String(body.name ?? "").trim();
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).map(t => String(t).trim()).filter(t => t.startsWith("#") && t.length > 1)
    : [];
  if (!name) return NextResponse.json({ ok: false, error: "name が必要です" }, { status: 400 });
  if (tags.length === 0) return NextResponse.json({ ok: false, error: "tags（#付き）が1つ以上必要です" }, { status: 400 });

  // 座標が無ければ Google Text Search で name(+address) から座標・写真・place_id を自動解決。
  let lat = typeof body.lat === "number" ? body.lat : null;
  let lng = typeof body.lng === "number" ? body.lng : null;
  let googlePlaceId = body.googlePlaceId ? String(body.googlePlaceId) : null;
  let resolvedAddress = body.address ? String(body.address).trim() : null;
  let photoUrls: string[] | null = Array.isArray(body.photoUrls) ? body.photoUrls.map(String) : null;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if ((lat == null || lng == null) && apiKey) {
    try {
      const q = resolvedAddress ? `${name} ${resolvedAddress}` : name;
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "places.id,places.formattedAddress,places.location",
        },
        body: JSON.stringify({ textQuery: q, languageCode: "ja", regionCode: "JP", pageSize: 1 }),
        cache: "no-store", signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const d = await res.json().catch(() => null);
        const p = d?.places?.[0];
        if (p) {
          lat = p.location?.latitude ?? lat;
          lng = p.location?.longitude ?? lng;
          googlePlaceId = googlePlaceId ?? p.id ?? null;
          resolvedAddress = resolvedAddress ?? p.formattedAddress ?? null;
          // 【ライセンス】Google写真は curated_spots に保存しない（永続キャッシュ不可）。
          //   座標/住所/place_idの解決だけに使う。photoUrls は管理者が明示指定したものだけ。
        }
      }
    } catch { /* 解決失敗でも保存は続行 */ }
  }

  const row = {
    name,
    address: resolvedAddress,
    lat,
    lng,
    google_place_id: googlePlaceId,
    tags,
    description: body.description ? String(body.description).trim() : null,
    image_url: photoUrls?.[0] ?? (body.imageUrl ? String(body.imageUrl) : null),
    photo_urls: photoUrls,
    area: body.area ? String(body.area).trim() : null,
    station_info: body.stationInfo ? String(body.stationInfo).trim() : null,
    is_active: true,
  };

  try {
    const { data, error } = await supabase.from("curated_spots").insert(row).select("id").maybeSingle();
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ ok: false, tableMissing: true, hint: TABLE_MISSING_HINT });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, id: data?.id });
  } catch (e) {
    console.error("curated-spots POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// DELETE — id で削除
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || body.secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id が必要です" }, { status: 400 });

  try {
    const { error } = await supabase.from("curated_spots").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("curated-spots DELETE error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
