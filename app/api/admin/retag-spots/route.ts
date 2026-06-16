// ─── /api/admin/retag-spots ──────────────────────────────────────────────────
// suggestions テーブルの全スポットの auto_tags を
// 新しい定義済みタグリストに基づいてAIで一括再生成するエンドポイント。
//
// POST body:
//   secret   string   管理者パスワード
//   ids      string[] (任意) 特定のIDのみ再タグ付け。省略時は全件

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ALL_PREDEFINED_TAGS } from "@/lib/predefined-tags";
import { addUrbanTagIfNeeded } from "@/lib/urban-detector";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const ADMIN_PASSWORD = ADMIN_SECRET;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SuggestionRow {
  id: string;
  spot_name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  google_place_name: string | null;
}

// 積極的タグ付け用プロンプト（上限なし）
function buildAggressiveTaggingPrompt(tagList: string[]): string {
  return `あなたはスポット情報のタグ付け専門AIです。

【絶対ルール】
1. 必ず以下の【定義済みタグリスト】の中からのみ選択すること。リスト外のタグは絶対使用禁止。
2. 当てはまると思われるタグを全て付けること。タグの数に上限はない。少なく絞りすぎないこと。
3. 出力は必ず JSON 形式 { "tags": ["#タグ1", "#タグ2", ...] } のみ。

【タグ選択の方針 — 積極的に付けること】
■ 気分タグ（#お腹すいた, #まったりしたい, #わいわい楽しみたい, #自然感じたい, #ドライブしたい, #集中したい, #体動かしたい, #遠くに行きたい）
  → そのスポットに行く動機として当てはまるもの全て付ける。例えば山なら #自然感じたい #まったりしたい #体動かしたい #ドライブしたい が全て該当しうる。
■ 誰とタグ（#1人, #友達, #恋人, #家族, #大人数, #先輩）
  → 行けそうな組み合わせ全て付ける。基本的に複数該当する。
■ 深掘りタグ（#自然感じたい, #絶景スポット, #展望台, #海辺, #自然公園, #大型公園 など）
  → スポットの種類・特徴に合うもの全て付ける。
■ 予算タグ（#無料, #〜3000 など）
  → 無料施設・公園なら #無料 を必ず付ける。
■ 補足タグ（#無料駐車場, #有料駐車場）
  → 公園・観光地なら駐車場があることが多いので #有料駐車場 か #無料駐車場 を付ける。

【定義済みタグリスト】（このリスト以外は絶対使用禁止）
${tagList.join(", ")}`;
}

async function generateTagsWithAI(spot: SuggestionRow): Promise<string[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return fallbackTags(spot.description ?? "");
  }

  const systemPrompt = buildAggressiveTaggingPrompt(ALL_PREDEFINED_TAGS);

  const userMessage = `以下のスポット情報から定義済みタグを全て選んでください。

【スポット名】${spot.spot_name}
【Googleマップ名】${spot.google_place_name ?? "（なし）"}
【住所】${spot.address ?? "（不明）"}
【説明文】${spot.description?.trim() || "（説明なし）"}

このスポットに当てはまる全てのタグを付けてください。気分タグ・誰とタグは当てはまるもの全て。深掘りタグも積極的に。`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);
  const rawTags: string[] = Array.isArray(parsed.tags) ? parsed.tags : [];

  // 定義済みリスト外のタグを除去
  const validated = rawTags.filter(tag => ALL_PREDEFINED_TAGS.includes(tag));
  return validated.length > 0 ? validated : fallbackTags(spot.description ?? "");
}

function fallbackTags(description: string): string[] {
  const tags: string[] = [];
  const d = description.toLowerCase();
  if (/自然|公園|森|山|海|川/i.test(d)) tags.push("#自然感じたい");
  if (/カフェ|コーヒー|喫茶/i.test(d))  tags.push("#まったりしたい", "#癒しカフェ");
  if (/温泉|スパ/i.test(d))             tags.push("#まったりしたい", "#温泉");
  if (/食事|グルメ|レストラン/i.test(d)) tags.push("#お腹すいた");
  if (tags.length === 0)                tags.push("#まったりしたい");
  return tags;
}

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const body = await req.json();
    if (body?.secret !== ADMIN_PASSWORD) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const filterIds: string[] | undefined = Array.isArray(body?.ids) ? body.ids : undefined;

    // ── 1. 対象スポットを取得 ─────────────────────────────────────────────────
    let query = supabase
      .from("suggestions")
      .select("id, spot_name, description, address, lat, lng, google_place_name");

    if (filterIds && filterIds.length > 0) {
      query = query.in("id", filterIds);
    }

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) throw error;

    const spots = (data ?? []) as SuggestionRow[];

    // ── 2. 各スポットをAIで再タグ付け ────────────────────────────────────────
    let updated = 0;
    let failed = 0;
    const failedNames: string[] = [];

    for (const spot of spots) {
      try {
        const aiTags = await generateTagsWithAI(spot);
        // 都市近傍なら #都市 を自動付与
        const newTags = addUrbanTagIfNeeded(aiTags, spot.lat, spot.lng);

        const { error: updateError } = await supabase
          .from("suggestions")
          .update({ auto_tags: newTags })
          .eq("id", spot.id);

        if (updateError) throw updateError;
        updated++;

        // API レート制限対策: 少し待機
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (e) {
        failed++;
        failedNames.push(`${spot.spot_name}（${e instanceof Error ? e.message : String(e)}）`);
      }
    }

    return NextResponse.json({
      ok: true,
      total: spots.length,
      updated,
      failed,
      failedNames,
    });
  } catch (e) {
    console.error("[/api/admin/retag-spots] error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
