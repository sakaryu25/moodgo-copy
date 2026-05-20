export const runtime = "nodejs";
import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    if (body.secret !== "moodgoadmin123") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { placeName, address, placeTypes } = body as {
      placeName: string;
      address?: string;
      placeTypes?: string[];
    };

    if (!placeName?.trim()) {
      return NextResponse.json({ ok: false, error: "placeName is required" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ ok: false, error: "OpenAI未設定" }, { status: 503 });
    }

    // エリアは住所から抽出する（都道府県・市区町村）
    const addressHint = address
      ? `住所: ${address}`
      : "";
    const typesHint = (placeTypes ?? []).length > 0
      ? `場所のカテゴリ: ${placeTypes!.join(", ")}`
      : "";

    const prompt = `以下の場所について、お出かけアプリの学習データとして最適な情報を推定してください。

場所名: ${placeName}
${addressHint}
${typesHint}

以下のJSON形式で返してください（全て日本語）:
{
  "mood": "次のいずれか1つ → お腹すいた / まったりしたい / わいわい楽しみたい / 映えたい / ドライブしたい / 集中したい / 体を動かしたい / 遠くに行きたい",
  "area": "都市名・エリア名（例: 横浜、渋谷、大阪、京都）",
  "atmosphere": "この場所の雰囲気（例: 静か、賑やか、おしゃれ、アクティブ、ロマンティック）",
  "companion": "最も想定される同行者 → 次のいずれか1つ: 一人 / 友達 / 恋人 / 家族 / 大人数グループ",
  "priority": "この場所で優先されること（例: 映え、コスパ、楽しさ、距離、快適さ、質の高さ）",
  "rating": 4
}

注意:
- moodは場所の用途から最も自然なものを選ぶ（レストラン→「お腹すいた」、公園→「まったりしたい」「体を動かしたい」など）
- areaは住所から都市名・エリア名のみ抽出（番地は不要）
- ratingは4（良い体験）をデフォルトにしてください`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "あなたはお出かけスポット分析の専門家です。場所の情報からユーザーの行動パターン・気分・エリアを正確に推定してください。JSONのみ返答してください。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const result = JSON.parse(raw) as {
      mood?: string;
      area?: string;
      atmosphere?: string;
      companion?: string;
      priority?: string;
      rating?: number;
    };

    return NextResponse.json({
      ok: true,
      mood: result.mood ?? "",
      area: result.area ?? "",
      atmosphere: result.atmosphere ?? "",
      companion: result.companion ?? "",
      priority: result.priority ?? "",
      rating: String(result.rating ?? 4),
    });
  } catch (e) {
    console.error("auto-fill error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
