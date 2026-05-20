export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 管理者専用: 既存の承認済みスポットを定義済みタグで一括再タグ付け
 *
 * POST /api/admin/retag
 * body: { secret: string, ids?: string[], overwrite?: boolean }
 *
 * - ids が指定されない場合はすべての承認済みスポットを対象にする
 * - overwrite=false（デフォルト）の場合、すでに有効なタグがあるスポットはスキップ
 * - overwrite=true の場合はすべて再生成
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabase } from "@/lib/supabase";
import { ALL_PREDEFINED_TAGS, buildFacilityTaggingPrompt } from "@/lib/predefined-tags";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

type SuggestionRow = {
  id: string;
  spot_name: string;
  description: string | null;
  auto_tags: string[] | null;
};

async function generateTagsForSpot(spot: SuggestionRow): Promise<string[]> {
  if (!openai) return [];
  try {
    const systemPrompt = buildFacilityTaggingPrompt(ALL_PREDEFINED_TAGS);
    const userMsg = `【スポット名】${spot.spot_name}\n【説明文】${spot.description?.trim() || "（なし）"}`;
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg },
      ],
      temperature: 0.1,
      max_tokens: 400,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    const rawTags: string[] = Array.isArray(parsed.tags) ? parsed.tags : [];
    return rawTags.filter(t => ALL_PREDEFINED_TAGS.includes(t)).slice(0, 15);
  } catch (e) {
    console.error(`[retag] error for ${spot.spot_name}:`, e);
    return [];
  }
}

export async function POST(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { secret, ids, overwrite = false } = body;

    if (secret !== "moodgoadmin123") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!openai) {
      return NextResponse.json({ ok: false, error: "OpenAI API キー未設定" }, { status: 503 });
    }

    // 対象スポットを取得
    let query = supabase
      .from("suggestions")
      .select("id, spot_name, description, auto_tags")
      .eq("status", "approved");

    if (ids && Array.isArray(ids) && ids.length > 0) {
      query = query.in("id", ids);
    }

    const { data: spots, error } = await query;
    if (error) throw error;
    if (!spots || spots.length === 0) {
      return NextResponse.json({ ok: true, message: "対象スポットなし", updated: 0 });
    }

    let updated = 0;
    let skipped = 0;
    const results: { id: string; name: string; tags: string[]; action: "updated" | "skipped" }[] = [];

    // OpenAI レート制限を考慮してシリアルに処理（1件ずつ）
    for (const spot of spots as SuggestionRow[]) {
      // overwrite=false かつ定義済みタグが既にある場合はスキップ
      const existingValidTags = (spot.auto_tags ?? []).filter(t => ALL_PREDEFINED_TAGS.includes(t));
      if (!overwrite && existingValidTags.length >= 2) {
        results.push({ id: spot.id, name: spot.spot_name, tags: existingValidTags, action: "skipped" });
        skipped++;
        continue;
      }

      const newTags = await generateTagsForSpot(spot);
      if (newTags.length > 0) {
        const { error: updateErr } = await supabase
          .from("suggestions")
          .update({ auto_tags: newTags })
          .eq("id", spot.id);

        if (updateErr) {
          console.error(`[retag] update error for ${spot.id}:`, updateErr);
        } else {
          results.push({ id: spot.id, name: spot.spot_name, tags: newTags, action: "updated" });
          updated++;
        }
      } else {
        results.push({ id: spot.id, name: spot.spot_name, tags: [], action: "skipped" });
        skipped++;
      }

      // レート制限回避のため 200ms 待機
      await new Promise(r => setTimeout(r, 200));
    }

    return NextResponse.json({
      ok: true,
      total: spots.length,
      updated,
      skipped,
      results,
    });
  } catch (e) {
    console.error("[retag] POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

/**
 * GET /api/admin/retag?secret=xxx
 * タグなし・無効タグのスポット数を返す（実行前の確認用）
 */
export async function GET(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== "moodgoadmin123") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data: spots, error } = await supabase
      .from("suggestions")
      .select("id, spot_name, auto_tags")
      .eq("status", "approved");

    if (error) throw error;

    const noTags: string[] = [];
    const invalidTags: string[] = [];
    const validTagged: string[] = [];

    for (const s of (spots ?? []) as SuggestionRow[]) {
      const tags = s.auto_tags ?? [];
      const validCount = tags.filter(t => ALL_PREDEFINED_TAGS.includes(t)).length;
      if (tags.length === 0) {
        noTags.push(s.spot_name);
      } else if (validCount === 0) {
        invalidTags.push(s.spot_name);
      } else {
        validTagged.push(s.spot_name);
      }
    }

    return NextResponse.json({
      ok: true,
      total: (spots ?? []).length,
      noTags: noTags.length,
      invalidTags: invalidTags.length,
      validTagged: validTagged.length,
      noTagSpots: noTags,
      invalidTagSpots: invalidTags,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
