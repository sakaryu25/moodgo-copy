// ─── /api/translate ───────────────────────────────────────────────────────────
// トークのメッセージ／投稿コメント（TikTok風長押しメニュー）を翻訳する。
// 日本語↔英語を自動判定（日本語が含まれていれば英語へ、それ以外は日本語へ）。
// OpenAI を使用。未設定時は 503。
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function POST(req: Request) {
  if (!openai) return NextResponse.json({ ok: false, error: "翻訳は現在利用できません" }, { status: 503 });
  if (!rateLimit(`translate:${clientIp(req)}`, 12, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => null);
    const text = String(body?.text ?? "").trim().slice(0, 500);
    if (!text) return NextResponse.json({ ok: false, error: "textが必要です" }, { status: 400 });

    const hasJa = /[぀-ヿ㐀-鿿]/.test(text);
    const target = hasJa ? "English" : "Japanese";

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: `You are a translator. Translate the user's message into ${target}. Output only the translation, nothing else. Keep it natural and casual (it's a chat message).` },
        { role: "user", content: text },
      ],
    });
    const translated = res.choices?.[0]?.message?.content?.trim() ?? "";
    if (!translated) return NextResponse.json({ ok: false, error: "翻訳に失敗しました" }, { status: 500 });
    return NextResponse.json({ ok: true, text: translated, target });
  } catch (e) {
    console.error("translate error:", e);
    return NextResponse.json({ ok: false, error: "翻訳に失敗しました" }, { status: 500 });
  }
}
