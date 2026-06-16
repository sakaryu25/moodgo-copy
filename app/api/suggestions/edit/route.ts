export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

export async function POST(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const formData = await request.formData();

    const secret = formData.get("secret") as string | null;
    if (secret !== ADMIN_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const id = formData.get("id") as string | null;
    if (!id) {
      return NextResponse.json({ ok: false, error: "id は必須です" }, { status: 400 });
    }

    const spotName = formData.get("spotName") as string | null;
    if (!spotName?.trim()) {
      return NextResponse.json({ ok: false, error: "スポット名は必須です" }, { status: 400 });
    }

    const description = (formData.get("description") as string | null)?.trim() || null;
    const address = (formData.get("address") as string | null)?.trim() || null;
    const stationInfo = (formData.get("stationInfo") as string | null)?.trim() || null;
    const autoTagsRaw = formData.get("autoTags") as string | null;
    const autoTags = autoTagsRaw ? (JSON.parse(autoTagsRaw) as string[]) : [];
    const isChain = formData.get("isChain") === "true";
    const chainSearchQuery = (formData.get("chainSearchQuery") as string | null)?.trim() || null;
    const availableFrom = (formData.get("availableFrom") as string | null)?.trim() || null;
    const availableUntil = (formData.get("availableUntil") as string | null)?.trim() || null;

    // 既存画像URL（削除済みを除いたもの）
    const existingRaw = formData.get("existingImageUrls") as string | null;
    const existingUrls: string[] = existingRaw ? (JSON.parse(existingRaw) as string[]) : [];

    // 新規ファイルをアップロード
    const newUrls: string[] = [];
    const imageFiles = formData.getAll("images") as File[];
    const validFiles = imageFiles.filter((f) => f instanceof File && f.size > 0).slice(0, 5);

    for (const file of validFiles) {
      const ext = file.name.split(".").pop() ?? "jpg";
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await supabase.storage
        .from("suggestion-images")
        .upload(fileName, buffer, { contentType: file.type, upsert: false });

      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from("suggestion-images")
          .getPublicUrl(fileName);
        newUrls.push(urlData.publicUrl);
      }
    }

    const imageUrls = [...existingUrls, ...newUrls];

    // コアペイロード
    const corePayload: Record<string, unknown> = {
      spot_name: spotName.trim(),
      description,
      address,
      station_info: stationInfo,
      auto_tags: autoTags,
      image_urls: imageUrls,
    };

    // オプションカラムを段階的に試行
    const candidates = [
      { ...corePayload, is_chain: isChain, chain_search_query: isChain ? chainSearchQuery : null, available_from: availableFrom, available_until: availableUntil },
      { ...corePayload, is_chain: isChain, chain_search_query: isChain ? chainSearchQuery : null },
      { ...corePayload, available_from: availableFrom, available_until: availableUntil },
      corePayload,
    ];

    let result = await supabase.from("suggestions").update(candidates[0]).eq("id", id).select("id").single();
    for (let i = 1; i < candidates.length && (result.error?.code === "42703" || result.error?.code === "PGRST204"); i++) {
      result = await supabase.from("suggestions").update(candidates[i]).eq("id", id).select("id").single();
    }

    const { error } = result;
    if (error) throw error;

    return NextResponse.json({ ok: true, imageUrls });
  } catch (e) {
    console.error("suggestions edit error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
