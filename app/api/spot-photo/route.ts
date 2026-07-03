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
import { ADMIN_SECRET } from "@/lib/admin-auth";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const ADMIN = ADMIN_SECRET;
const BUCKET = "spot-photos";
let bucketEnsured = false; // createBucketは毎回叩かず1インスタンス1回だけ

function isMissingTable(e: { code?: string } | null): boolean {
  // テーブル/列が未作成(mood-logs.sql未適用)でも空配列で安全に返すための判定。
  return e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST204" || e?.code === "42703";
}

// 画像base64の形式・サイズ検証（任意バイト列の投入を防ぐ）
function isValidImageBase64(b64: string): boolean {
  // data URLプレフィックスは許容しつつ、jpeg/png/webp/heic のみ
  const m = b64.match(/^data:image\/(jpeg|jpg|png|webp|heic|heif);base64,/i);
  const payload = m ? b64.slice(b64.indexOf(",") + 1) : b64;
  if (payload.length < 100) return false;
  return /^[A-Za-z0-9+/=\r\n]+$/.test(payload.slice(0, 256)); // 先頭がbase64文字のみか
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  // 連投抑止: 1IPあたり1分で8枚まで
  if (!rateLimit(`spot-photo:${clientIp(req)}`, 8, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいて再度お試しください" }, { status: 429 });
  }
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
    if (!isValidImageBase64(imageBase64)) {
      return NextResponse.json({ ok: false, error: "画像の形式が不正です" }, { status: 400 });
    }

    if (!bucketEnsured) {
      await supabase.storage.createBucket(BUCKET, { public: true }).then(() => {}, () => {}); // 既存ならエラー無視
      bucketEnsured = true;
    }
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
    // reusable=1: 承認済み&再利用OKのみ（カード/詳細のヒーロー用。pending/private/非再利用は出さない）
    const reusable = searchParams.get("reusable") === "1";
    if (!placeId && !placeName) return NextResponse.json({ ok: true, photos: [], isShinrei: false });
    let q = supabase.from("spot_photos").select("id, image_url, created_at").order("is_primary", { ascending: false }).order("created_at", { ascending: false });
    q = placeId ? q.eq("place_id", placeId) : q.eq("place_name", placeName!);
    if (reusable) q = q.eq("moderation_status", "approved").eq("can_use_as_spot_photo", true);
    else q = q.neq("moderation_status", "hidden").neq("moderation_status", "rejected");   // 一般パスでも非表示/却下写真は返さない
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
