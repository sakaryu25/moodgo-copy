export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { ALL_PREDEFINED_TAGS } from "@/lib/predefined-tags";
import { addUrbanTagIfNeeded } from "@/lib/urban-detector";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

function isTikTokUrl(input: string): boolean {
  return /tiktok\.com/i.test(input);
}

// ─── TikTok oEmbed API でタイトル・説明文を取得 ───────────────────────────────
async function fetchTikTokOembed(tikTokUrl: string): Promise<{ title: string; authorName: string } | null> {
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(tikTokUrl)}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: (data.title as string | undefined) ?? "",
      authorName: (data.author_name as string | undefined) ?? "",
    };
  } catch {
    return null;
  }
}

// ─── Places Text Search ───────────────────────────────────────────────────────
async function searchPlaces(query: string) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=ja&key=${GOOGLE_PLACES_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Places Text Search failed: ${data.status} - ${data.error_message ?? ""}`);
  }
  if (!data.results || data.results.length === 0) {
    throw new Error("スポットが見つかりませんでした。別の名前で試してください。");
  }
  return data.results[0] as {
    place_id: string;
    name: string;
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  };
}

// ─── Place Details ────────────────────────────────────────────────────────────
async function getPlaceDetails(placeId: string) {
  const fields = "name,formatted_address,formatted_phone_number,opening_hours,photos,website,geometry";
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=ja&key=${GOOGLE_PLACES_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK") {
    throw new Error(`Place Details failed: ${data.status}`);
  }
  return data.result as {
    name: string;
    formatted_address?: string;
    formatted_phone_number?: string;
    opening_hours?: { weekday_text?: string[] };
    photos?: Array<{ photo_reference: string }>;
    website?: string;
    geometry?: { location: { lat: number; lng: number } };
  };
}

// ─── 写真URL生成 ───────────────────────────────────────────────────────────────
function buildPhotoUrl(photoReference: string): string {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoReference}&key=${GOOGLE_PLACES_API_KEY}`;
}

// ─── POST handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { mode, secret } = body as { mode?: string; secret?: string; [key: string]: unknown };

  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ─── mode: "places" ──────────────────────────────────────────────────────────
  if (mode === "places") {
    const rawQuery = (body.query as string | undefined)?.trim();
    const tikTokUrl = (body.tikTokUrl as string | undefined)?.trim() ?? "";

    if (!rawQuery) {
      return NextResponse.json({ ok: false, error: "query は必須です" }, { status: 400 });
    }
    if (!GOOGLE_PLACES_API_KEY) {
      return NextResponse.json({ ok: false, error: "GOOGLE_PLACES_API_KEY が設定されていません" }, { status: 500 });
    }

    try {
      // TikTok oEmbed を並行取得
      const tikTokPromise = tikTokUrl && isTikTokUrl(tikTokUrl)
        ? fetchTikTokOembed(tikTokUrl)
        : Promise.resolve(null);

      // Google Places 検索
      const topResult = await searchPlaces(rawQuery);
      const details = await getPlaceDetails(topResult.place_id);

      // TikTok oEmbed 結果を待つ
      const tikTokInfo = await tikTokPromise;

      // 写真URL（最大3枚）
      const photoUrls: string[] = [];
      if (details.photos && details.photos.length > 0) {
        for (const photo of details.photos.slice(0, 3)) {
          photoUrls.push(buildPhotoUrl(photo.photo_reference));
        }
      }

      const hours = details.opening_hours?.weekday_text?.join(" / ") ?? null;

      const place = {
        name: details.name ?? topResult.name,
        address: details.formatted_address ?? topResult.formatted_address,
        phone: details.formatted_phone_number ?? null,
        hours,
        photoUrls,
        website: details.website ?? null,
        lat: details.geometry?.location.lat ?? topResult.geometry.location.lat,
        lng: details.geometry?.location.lng ?? topResult.geometry.location.lng,
      };

      return NextResponse.json({ ok: true, place, tikTokInfo });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  // ─── mode: "ai_generate" ─────────────────────────────────────────────────────
  if (mode === "ai_generate") {
    const placeData = body.placeData as Record<string, unknown> | undefined;
    const adminHint = (body.adminHint as string | undefined) ?? "";
    const tikTokContext = (body.tikTokContext as string | undefined) ?? "";

    if (!placeData) {
      return NextResponse.json({ ok: false, error: "placeData は必須です" }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json({ ok: false, error: "OPENAI_API_KEY が設定されていません" }, { status: 500 });
    }

    const placeInfo = `
スポット名: ${placeData.name ?? "不明"}
住所: ${placeData.address ?? "不明"}
電話番号: ${placeData.phone ?? "なし"}
営業時間: ${placeData.hours ?? "不明"}
ウェブサイト: ${placeData.website ?? "なし"}
${tikTokContext ? `【TikTok動画の内容】\n${tikTokContext}` : ""}
${adminHint ? `【管理者メモ】\n${adminHint}` : ""}
`.trim();

    const predefinedTagList = ALL_PREDEFINED_TAGS.join(", ");

    const systemPrompt =
      "あなたは若者向け旅行・おでかけアプリのコンテンツライターです。TikTokで話題になる穴場スポットの魅力を、20代向けの言葉で紹介してください。TikTok動画の内容が提供されている場合は、そのトーンや魅力ポイントを参考にしてください。";

    const userPrompt = `
以下のスポット情報をもとに、JSONを生成してください。必ずJSONのみ返してください（コードブロック不要）。

${placeInfo}

出力形式:
{
  "catch_copy": "20字以内のキャッチコピー",
  "description": "100〜150字の紹介文（改行なし）",
  "tags": ["#タグ1","#タグ2","#タグ3"],
  "recommended_items": ["おすすめメニューや体験1","2","3"]
}

【tagsの絶対ルール】
- 必ず以下の【定義済みタグリスト】の中からのみ選択すること。リスト外のタグは絶対に使用禁止。
- このスポットに当てはまるタグを全て付けること（数の上限なし）。少なく絞りすぎないこと。
- 気分タグ（#お腹すいた, #まったりしたい, #わいわい楽しみたい, #自然感じたい, #ドライブしたい, #集中したい, #体動かしたい, #遠くに行きたい）は当てはまるもの全て付けること。
- 誰と（#1人, #友達, #恋人, #家族, #大人数, #先輩）は当てはまるもの全て付けること。
- 深掘りタグも積極的に付けること。例：山なら #自然感じたい #絶景スポット #展望台 #屋外スポーツ #お散歩 なども積極的に付ける。
- 予算・交通手段・補足タグも当てはまれば付けること。

【定義済みタグリスト】（このリスト以外は絶対使用禁止）
${predefinedTagList}

recommended_itemsはそのスポット固有のおすすめメニューや体験を3個以上。
`.trim();

    try {
      const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.7,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`OpenAI API error: ${aiRes.status} - ${errText}`);
      }

      const aiData = await aiRes.json();
      const rawContent: string = aiData.choices?.[0]?.message?.content ?? "{}";

      let parsed: Record<string, unknown>;
      try {
        const cleaned = rawContent.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error("AIの応答をJSONに変換できませんでした: " + rawContent.slice(0, 200));
      }

      // 都市近傍なら #都市 を自動付与
      const placeLat = typeof placeData.lat === "number" ? placeData.lat : null;
      const placeLng = typeof placeData.lng === "number" ? placeData.lng : null;
      if (Array.isArray(parsed.tags) && placeLat !== null && placeLng !== null) {
        parsed.tags = addUrbanTagIfNeeded(parsed.tags as string[], placeLat, placeLng);
      }

      return NextResponse.json({ ok: true, ai: parsed });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: false, error: `未知のmode: ${mode}` }, { status: 400 });
}
