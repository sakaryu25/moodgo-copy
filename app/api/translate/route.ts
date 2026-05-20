export const runtime = "nodejs";
import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

    const { title, reason, vibe, features, stationText, openingHoursText } = body as Record<string, string | string[]>;

    // OpenAI無効化（コスト削減）
    return NextResponse.json({ ok: false, error: "OpenAI not configured" }, { status: 503 });
    if (!process.env.OPENAI_API_KEY) { // eslint-disable-line no-unreachable
      return NextResponse.json({ ok: false, error: "OpenAI not configured" }, { status: 503 });
    }

    const inputJson = JSON.stringify({
      title,
      reason,
      vibe,
      features,
      stationText,
      openingHoursText,
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a Japanese-to-English translator for a place recommendation app.
Translate the given JSON fields from Japanese to natural English.
- "title": keep the original place name but translate any Japanese suffixes (公園→Park, 駅→Station, etc.)
- "reason": translate naturally as a recommendation reason
- "vibe": translate the atmosphere/description
- "features": translate each tag naturally (keep emoji)
- "stationText": translate as "X min walk from XX Station"
- "openingHoursText": translate hours info
Return ONLY the translated JSON object with the same keys. No extra text.`,
        },
        {
          role: "user",
          content: inputJson,
        },
      ],
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const translated = JSON.parse(raw);
    return NextResponse.json({ ok: true, translated });
  } catch (e) {
    console.error("translate error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
