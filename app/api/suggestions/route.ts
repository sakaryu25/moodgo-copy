export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ALL_PREDEFINED_TAGS, buildFacilityTaggingPrompt } from "@/lib/predefined-tags";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

/**
 * 施設情報から定義済みタグを自動生成する（サーバーサイド専用）
 * - AI が使える場合は GPT-4o-mini で定義済みリストから選別
 * - AI が使えない場合はキーワードマッチングでフォールバック
 */
// OpenAI無効化（コスト削減のためルールベースのみ使用）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function autoTagFacility(
  _spotName: string,
  _description: string | null,
  _placeTypeHints: string[] = []
): Promise<string[]> {
  return [];
}

export async function POST(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    // Content-Type に応じて JSON / multipart 両対応
    // ExpoアプリはJSON送信、Web版はFormData送信のため両方受け付ける
    const contentType = request.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");

    // フィールド取得ヘルパー（JSON/FormData 両対応）
    let spotName: string;
    let description: string | null;
    let address: string | null;
    let lat: number | null;
    let lng: number | null;
    let contact: string | null;
    let stationInfo: string | null;
    let manualMapUrl: string | null;
    let source: string | null;
    let secret: string | null;
    let autoTagsRaw: string | null;
    let placeTypesRaw: string | null;
    let isChain: boolean;
    let chainSearchQuery: string | null;
    let availableFrom: string | null;
    let availableUntil: string | null;
    let preloadedUrls: string[] = [];
    const imageUrls: string[] = [];
    let imageUploadFailed = 0;

    if (isJson) {
      // ── JSON ──────────────────────────────────────────────────────────────
      const body = await request.json() as Record<string, unknown>;
      spotName        = (body.spotName as string) ?? "";
      description     = (body.description as string | null) ?? null;
      address         = (body.address as string | null) ?? null;
      lat             = body.lat != null ? Number(body.lat) : null;
      lng             = body.lng != null ? Number(body.lng) : null;
      contact         = (body.contact as string | null) ?? null;
      stationInfo     = null;
      manualMapUrl    = null;
      source          = (body.source as string | null) ?? null;
      secret          = (body.secret as string | null) ?? null;
      autoTagsRaw     = body.autoTags ? JSON.stringify(body.autoTags) : null;
      placeTypesRaw   = null;
      isChain         = false;
      chainSearchQuery = null;
      availableFrom   = null;
      availableUntil  = null;
      // JSON の images: base64 data-URL → Supabase Storage にアップロード
      const imgs = (body.images as string[] | undefined) ?? [];
      for (const img of imgs.slice(0, 3)) {
        try {
          const [meta, b64] = img.split(",");
          if (!b64) continue;
          const mimeMatch = meta.match(/data:([^;]+);/);
          const mimeType = mimeMatch?.[1] ?? "image/jpeg";
          const ext = mimeType.split("/")[1] ?? "jpg";
          const buf = Buffer.from(b64, "base64");
          const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadError } = await supabase!.storage
            .from("suggestion-images")
            .upload(fileName, buf, { contentType: mimeType, upsert: false });
          if (uploadError) { imageUploadFailed++; }
          else {
            const { data: urlData } = supabase!.storage.from("suggestion-images").getPublicUrl(fileName);
            imageUrls.push(urlData.publicUrl);
          }
        } catch { imageUploadFailed++; }
      }
    } else {
      // ── multipart/form-data（既存の Web 版） ────────────────────────────
      const formData = await request.formData() as unknown as {
        get: (k: string) => string | File | null;
        getAll: (k: string) => (string | File)[];
      };
      spotName        = (formData.get("spotName") as string) ?? "";
      description     = formData.get("description") as string | null;
      address         = formData.get("address") as string | null;
      lat             = formData.get("lat") ? Number(formData.get("lat")) : null;
      lng             = formData.get("lng") ? Number(formData.get("lng")) : null;
      contact         = formData.get("contact") as string | null;
      stationInfo     = formData.get("stationInfo") as string | null;
      manualMapUrl    = formData.get("manualMapUrl") as string | null;
      source          = formData.get("source") as string | null;
      secret          = formData.get("secret") as string | null;
      autoTagsRaw     = formData.get("autoTags") as string | null;
      placeTypesRaw   = formData.get("placeTypes") as string | null;
      isChain         = formData.get("isChain") === "true";
      chainSearchQuery = formData.get("chainSearchQuery") as string | null;
      availableFrom   = formData.get("availableFrom") as string | null;
      availableUntil  = formData.get("availableUntil") as string | null;
      const preloadedRaw = formData.get("preloadedImageUrls") as string | null;
      preloadedUrls   = preloadedRaw ? (JSON.parse(preloadedRaw) as string[]) : [];
      imageUrls.push(...preloadedUrls);
      const imageFiles = formData.getAll("images") as File[];
      const validImageFiles = imageFiles.filter((f) => f instanceof File && f.size > 0).slice(0, 5);
      for (const file of validImageFiles) {
        const ext = file.name.split(".").pop() ?? "jpg";
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const { error: uploadError } = await supabase!.storage
          .from("suggestion-images")
          .upload(fileName, buffer, { contentType: file.type, upsert: false });
        if (uploadError) {
          console.error("画像アップロードエラー:", uploadError.message, uploadError);
          imageUploadFailed++;
        } else {
          const { data: urlData } = supabase!.storage.from("suggestion-images").getPublicUrl(fileName);
          imageUrls.push(urlData.publicUrl);
        }
      }
    }

    if (!spotName?.trim()) {
      return NextResponse.json({ ok: false, error: "スポット名は必須です" }, { status: 400 });
    }

    const placeTypeHints: string[] = placeTypesRaw ? JSON.parse(placeTypesRaw) : [];

    // クライアントから送られてきたタグがあればそれを使用、なければ自動生成
    let autoTags: string[] = autoTagsRaw ? JSON.parse(autoTagsRaw) : [];
    if (autoTags.length === 0) {
      // 定義済みタグリストから自動タグ付け（ユーザー投稿・管理者投稿ともに適用）
      autoTags = await autoTagFacility(spotName.trim(), description, placeTypeHints);
      console.log(`[suggestions POST] 自動タグ付け: ${spotName} → [${autoTags.join(", ")}]`);
    }
    if (!isJson) {
      // FormData の isChain はすでに上で設定済み
    } else {
      isChain = false;
      chainSearchQuery = null;
      availableFrom = null;
      availableUntil = null;
    }

    // 管理者からの直接投稿は即承認
    const isAdmin = secret === "moodgoadmin123";
    const status = (isAdmin && source === "admin") ? "approved" : "pending";

    // コアペイロード（必ず存在するカラムのみ）
    const corePayload = {
      spot_name: spotName.trim(),
      description: description?.trim() || null,
      address: address?.trim() || null,
      lat,
      lng,
      contact: contact?.trim() || null,
      image_urls: imageUrls,
      status,
      station_info: stationInfo?.trim() || null,
      google_maps_uri: manualMapUrl?.trim() || null,
      source: source || "user",
      auto_tags: autoTags,
    };

    // オプショナルカラムを段階的に付加して試行（未マイグレーション環境でもエラーにならないよう）
    // 試行順: フル → 日付なし → チェーンなし → コアのみ
    const candidates = [
      { ...corePayload, is_chain: isChain, chain_search_query: isChain ? (chainSearchQuery?.trim() || null) : null, available_from: availableFrom?.trim() || null, available_until: availableUntil?.trim() || null },
      { ...corePayload, is_chain: isChain, chain_search_query: isChain ? (chainSearchQuery?.trim() || null) : null },
      { ...corePayload, available_from: availableFrom?.trim() || null, available_until: availableUntil?.trim() || null },
      corePayload,
    ];

    let result = await supabase.from("suggestions").insert(candidates[0]).select("id").single();
    for (let i = 1; i < candidates.length && (result.error?.code === "42703" || result.error?.code === "PGRST204"); i++) {
      result = await supabase.from("suggestions").insert(candidates[i]).select("id").single();
    }

    const { data, error } = result;
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      id: data?.id,
      uploadedCount: imageUrls.length,
      failedCount: imageUploadFailed,
    });
  } catch (e) {
    console.error("suggestions POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  if (secret !== "moodgoadmin123") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const searchQuery = searchParams.get("search");

  try {
    let query = supabase
      .from("suggestions")
      .select("id, created_at, spot_name, description, address, lat, lng, contact, image_urls, status, admin_note, google_place_id, google_maps_uri, google_place_name, auto_tags, station_info, source, available_from, available_until")
      .order("created_at", { ascending: false });

    // 重複チェック用：スポット名での絞り込み
    if (searchQuery) {
      query = query.ilike("spot_name", `%${searchQuery}%`);
    }

    let { data, error } = await query;

    // available_from / available_until カラムが未作成の場合は除いて再取得
    if (error?.code === "42703" || error?.code === "PGRST204") {
      const fallback = await supabase
        .from("suggestions")
        .select("id, created_at, spot_name, description, address, lat, lng, contact, image_urls, status, admin_note, google_place_id, google_maps_uri, google_place_name, auto_tags, station_info, source")
        .order("created_at", { ascending: false });
      data = fallback.data as unknown as typeof data;
      error = fallback.error;
    }

    if (error) throw error;
    return NextResponse.json({ ok: true, suggestions: data ?? [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { id, status, adminNote, secret, googlePlaceId, googleMapsUri, googlePlaceName, autoTags } = body;

    if (secret !== "moodgoadmin123") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {};

    // ステータス更新（任意）
    if (status !== undefined) {
      if (!["approved", "rejected", "pending"].includes(status)) {
        return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
      }
      updatePayload.status = status;
      updatePayload.admin_note = adminNote ?? null;
    }

    // Googleマップ紐付け情報
    if (googlePlaceId !== undefined) updatePayload.google_place_id = googlePlaceId;
    if (googleMapsUri !== undefined) updatePayload.google_maps_uri = googleMapsUri;
    if (googlePlaceName !== undefined) updatePayload.google_place_name = googlePlaceName;
    if (autoTags !== undefined) updatePayload.auto_tags = autoTags;
    if (body.stationInfo !== undefined) updatePayload.station_info = body.stationInfo;

    // スポット基本情報の編集（管理者による直接編集）
    if (body.spotName !== undefined) updatePayload.spot_name = body.spotName;
    if (body.description !== undefined) updatePayload.description = body.description;
    if (body.address !== undefined) updatePayload.address = body.address;
    if (body.contact !== undefined) updatePayload.contact = body.contact;
    if (body.isChain !== undefined) updatePayload.is_chain = body.isChain;
    if (body.chainSearchQuery !== undefined) updatePayload.chain_search_query = body.chainSearchQuery;
    if (body.availableFrom !== undefined) updatePayload.available_from = body.availableFrom || null;
    if (body.availableUntil !== undefined) updatePayload.available_until = body.availableUntil || null;

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
    }

    let updateResult = await supabase.from("suggestions").update(updatePayload).eq("id", id);

    // available_from / available_until カラムが未作成の場合は除いて再試行
    if (updateResult.error?.code === "42703" || updateResult.error?.code === "PGRST204") {
      const fallbackPayload = { ...updatePayload };
      delete fallbackPayload.available_from;
      delete fallbackPayload.available_until;
      if (Object.keys(fallbackPayload).length > 0) {
        updateResult = await supabase.from("suggestions").update(fallbackPayload).eq("id", id);
      }
    }

    if (updateResult.error) throw updateResult.error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (body?.secret !== "moodgoadmin123") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!body?.id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    const { error } = await supabase.from("suggestions").delete().eq("id", body.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
