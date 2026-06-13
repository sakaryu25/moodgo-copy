// ─── /api/spot-photo ──────────────────────────────────────────────────────────
// 心霊スポット等への利用者投稿写真。
//   POST   { placeId?, placeName, address?, imageBase64, deviceId? } … 誰でも追加できる
//   GET    ?placeId=&placeName=                                       … そのスポットの写真一覧
//   GET    ?secret=...&all=1                                          … admin: 全件（削除用）
//   DELETE { secret, id }                                            … admin のみ削除可
// 画像は Storage バケット spot-photos に保存。Googleからの自動補強はしない。
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN = "moodgoadmin123";
const BUCKET = "spot-photos";

function isMissingTable(e: { code?: string } | null): boolean {
  return e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST204";
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  try {
    const body = await req.json().catch(() => null);
    const imageBase64 = String(body?.imageBase64 ?? "");
    const placeName = String(body?.placeName ?? "").trim().slice(0, 200);
    const placeId = body?.placeId ? String(body.placeId).trim().slice(0, 200) : null;
    const deviceId = body?.deviceId ? String(body.deviceId).trim().slice(0, 100) : null;
    if (!imageBase64 || (!placeName && !placeId)) {
      return NextResponse.json({ ok: false, error: "画像とスポット情報が必要です" }, { status: 400 });
    }
    if (imageBase64.length > 4_000_000) {
      return NextResponse.json({ ok: false, error: "画像が大きすぎます" }, { status: 400 });
    }

    await supabase.storage.createBucket(BUCKET, { public: true }); // 既存ならエラーは無視
    // 端末＋時刻でユニークなパス（同一スポットに複数枚OK）
    const safe = (placeId ?? placeName).replace(/[^0-9a-zA-Z]/g, "").slice(0, 24) || "spot";
    const rand = Math.abs(((deviceId ?? "x").split("").reduce((a, c) => a + c.charCodeAt(0), 0)));
    const path = `${safe}/${rand}-${Buffer.from(placeName).toString("hex").slice(0, 8)}-${imageBase64.length}.jpg`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, Buffer.from(imageBase64, "base64"), { contentType: "image/jpeg", upsert: true });
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const imageUrl = `${pub.publicUrl}?v=${Buffer.from(path).length}`;

    const { error } = await supabase.from("spot_photos").insert({
      place_id: placeId, place_name: placeName || null, image_url: imageUrl, storage_path: path, device_id: deviceId,
    });
    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({ ok: false, tableMissing: true, error: "写真投稿は準備中です（DB更新待ち）" }, { status: 400 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, url: imageUrl });
  } catch (e) {
    console.error("spot-photo POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!supabase) return NextResponse.json({ ok: true, photos: [] });
  const { searchParams } = new URL(req.url);
  try {
    // admin: 全件（削除UI用）
    if (searchParams.get("all") === "1") {
      if (searchParams.get("secret") !== ADMIN) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      const { data, error } = await supabase
        .from("spot_photos")
        .select("id, place_id, place_name, image_url, device_id, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, photos: [] }); throw error; }
      return NextResponse.json({ ok: true, photos: data ?? [] });
    }
    // 一般: スポット単位（写真一覧＋このスポットが心霊かどうか）
    const placeId = searchParams.get("placeId")?.trim();
    const placeName = searchParams.get("placeName")?.trim();
    if (!placeId && !placeName) return NextResponse.json({ ok: true, photos: [], isShinrei: false });
    let q = supabase.from("spot_photos").select("id, image_url, created_at").order("created_at", { ascending: false });
    q = placeId ? q.eq("place_id", placeId) : q.eq("place_name", placeName!);
    const { data, error } = await q;
    if (error && !isMissingTable(error)) throw error;
    const photos = (data ?? []).map(r => r.image_url);

    // places に #心霊スポット タグがあるか判定（古いお気に入り＝tag未保存でも詳細でGoogleを使わないため）
    let isShinrei = false;
    try {
      if (placeName) {
        const { data: pl } = await supabase.from("places").select("tags").eq("name", placeName).limit(1).maybeSingle();
        isShinrei = !!(pl?.tags as string[] | null)?.includes("#心霊スポット");
      }
    } catch { /* 判定失敗は false 扱い */ }

    return NextResponse.json({ ok: true, photos, isShinrei });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  try {
    const body = await req.json().catch(() => null);
    if (body?.secret !== ADMIN) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!body?.id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    // Storageからも削除
    const { data: row } = await supabase.from("spot_photos").select("storage_path").eq("id", body.id).maybeSingle();
    if (row?.storage_path) await supabase.storage.from(BUCKET).remove([row.storage_path]).catch(() => {});
    const { error } = await supabase.from("spot_photos").delete().eq("id", body.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
