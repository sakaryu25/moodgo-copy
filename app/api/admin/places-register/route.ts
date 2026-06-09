// ─── /api/admin/places-register ─────────────────────────────────────────────
// 管理者が承認したスポット・直接追加スポットを Supabase の
// places テーブルと place_photos テーブルに登録するエンドポイント。
//
// POST body (JSON):
//   secret         string     管理者パスワード（必須）
//   name           string     スポット名（必須）
//   address        string     住所
//   nearestStation string     最寄り駅情報
//   lat            number?    緯度
//   lng            number?    経度
//   googlePlaceId  string?    Google Place ID
//   tags           string[]   タグ配列（必須・#気分タグを含むこと）
//   area           string?    エリア名（例: "東京・渋谷"）
//   description    string?    説明文
//   imageUrls      string[]   写真URL配列（place_photos に保存）
//   placeId        string?    既存 places レコードID（指定時は更新、省略時は新規）

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN_PASSWORD = "moodgoadmin123";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const body = await req.json();
    const {
      secret,
      name,
      address          = "",
      nearestStation   = "",
      lat,
      lng,
      googlePlaceId    = null,
      tags             = [],
      area             = null,
      description      = null,
      imageUrls        = [],
      placeId          = null,   // 既存レコードIDを指定すると UPDATE
    } = body as {
      secret: string;
      name: string;
      address?: string;
      nearestStation?: string;
      lat?: number | null;
      lng?: number | null;
      googlePlaceId?: string | null;
      tags?: string[];
      area?: string | null;
      description?: string | null;
      imageUrls?: string[];
      placeId?: string | null;
    };

    if (secret !== ADMIN_PASSWORD) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "スポット名は必須です" }, { status: 400 });
    }
    if (!tags || tags.length === 0) {
      return NextResponse.json({ ok: false, error: "タグを1つ以上指定してください" }, { status: 400 });
    }

    // ── 重複チェック（新規登録かつ force でない場合のみ）──────────────────────
    const force: boolean = body?.force ?? false;
    if (!placeId && !force) {
      const { data: existing } = await supabase
        .from("places")
        .select("id, name")
        .ilike("name", name.trim())
        .limit(1)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({
          ok: false,
          duplicate: true,
          existingId: existing.id as string,
          existingName: existing.name as string,
        });
      }
    }

    const payload = {
      name:            name.trim(),
      address:         address.trim() || null,
      nearest_station: nearestStation.trim() || null,
      lat:             lat ?? null,
      lng:             lng ?? null,
      google_place_id: googlePlaceId || null,
      tags,
      area:            area || null,
      description:     description?.trim() || null,
      is_active:       true,
      // 手動追加スポットは source_type="manual" で明示保存し、Google自動取り込み("google")と
      // 保管区分を分ける。検索ランキングで手動を優先し「埋もれ」を防ぐ。
      source_type:     "manual",
    };

    let savedId: string;

    if (placeId) {
      // ─── 既存レコードを更新 ────────────────────────────────────────────────
      const { error } = await supabase
        .from("places")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", placeId);
      if (error) throw error;
      savedId = placeId;

      // 写真は追記（重複URLは除く）
      if (imageUrls.length > 0) {
        const { data: existingPhotos } = await supabase
          .from("place_photos")
          .select("photo_url")
          .eq("place_id", placeId);
        const existingUrls = new Set((existingPhotos ?? []).map((p: { photo_url: string }) => p.photo_url));
        const newPhotos = imageUrls
          .filter(u => u && !existingUrls.has(u))
          .map((url, i) => ({ place_id: placeId, photo_url: url, is_primary: i === 0 && existingUrls.size === 0 }));
        if (newPhotos.length > 0) {
          await supabase.from("place_photos").insert(newPhotos);
        }
      }
    } else {
      // ─── 新規レコードを作成 ────────────────────────────────────────────────
      const { data, error } = await supabase
        .from("places")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      savedId = data.id;

      // 写真を登録
      if (imageUrls.length > 0) {
        const photoRows = imageUrls
          .filter(u => !!u)
          .map((url, i) => ({ place_id: savedId, photo_url: url, is_primary: i === 0 }));
        if (photoRows.length > 0) {
          await supabase.from("place_photos").insert(photoRows);
        }
      }
    }

    return NextResponse.json({ ok: true, id: savedId });
  } catch (e) {
    console.error("[/api/admin/places-register] error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// ─── GET: places 一覧取得（管理者用）────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, address, nearest_station, lat, lng, google_place_id, tags, area, description, is_active, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return NextResponse.json({ ok: true, data: data ?? [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// ─── DELETE: places レコード削除（管理者用）──────────────────────────────────
export async function DELETE(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const body = await req.json();
    if (body?.secret !== ADMIN_PASSWORD) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!body?.id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }
    const { error } = await supabase.from("places").delete().eq("id", body.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
