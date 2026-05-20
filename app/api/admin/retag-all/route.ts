import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ALL_PREDEFINED_TAGS, MOOD_TAGS } from "@/lib/predefined-tags";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ADMIN_PASSWORD = "moodgoadmin123";

// 深掘りタグ（気分タグ以外）
const DRILL_DOWN_TAGS = ALL_PREDEFINED_TAGS.filter(t => !MOOD_TAGS.includes(t));

function buildPrompt(): string {
  return `あなたはスポット情報のタグ付け専門AIです。

【絶対ルール — 違反厳禁】
1. 必ず以下の【定義済みタグリスト】の中からのみ選択すること。リスト外は絶対禁止。
2. 出力は必ず JSON 形式 { "tags": ["#タグ1", "#タグ2", ...] } のみ。
3. 必ず【気分タグ】を最低1つ含めること。
4. 必ず【深掘りタグ】を最低1つ含めること。
5. 当てはまるタグを積極的に全て付けること（少なすぎるのは厳禁）。

【気分タグ】（必ず最低1つ選ぶこと）
${MOOD_TAGS.join(", ")}

【深掘りタグ】（必ず最低1つ選ぶこと）
${DRILL_DOWN_TAGS.join(", ")}

【定義済みタグリスト（全体）】
${ALL_PREDEFINED_TAGS.join(", ")}

【選択の指針】
- 気分タグ: そのスポットへ行く動機として当てはまるもの全て付ける
- 誰とタグ: 行けそうな組み合わせを全て付ける
- 深掘りタグ: スポットの種別・特徴に合うもの全て付ける
- 予算タグ: 入場無料なら #無料 を必ず付ける
- 補足タグ: 駐車場があれば #無料駐車場 か #有料駐車場 を付ける`;
}

async function retagPlace(place: {
  id: string;
  name: string;
  address: string;
  description: string | null;
  tags: string[];
}): Promise<string[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return ensureMinimumTags(place.tags, place.name);

  const userMsg = `スポット名: ${place.name}
住所: ${place.address}
現在のタグ: ${place.tags.join(", ") || "（なし）"}
説明: ${place.description?.trim() || "（なし）"}

このスポットに当てはまる全てのタグを選んでください。気分タグを最低1つ、深掘りタグを最低1つ必ず含めること。`;

  try {
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
          { role: "system", content: buildPrompt() },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
      }),
    });

    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    const rawTags: string[] = Array.isArray(parsed.tags) ? parsed.tags : [];
    const validated = rawTags.filter(t => ALL_PREDEFINED_TAGS.includes(t));
    return ensureMinimumTags(validated, place.name);
  } catch {
    return ensureMinimumTags(place.tags, place.name);
  }
}

// 気分タグと深掘りタグが最低1つずつあることを保証
function ensureMinimumTags(tags: string[], name: string): string[] {
  const result = [...tags.filter(t => ALL_PREDEFINED_TAGS.includes(t))];

  const hasMood = result.some(t => MOOD_TAGS.includes(t));
  if (!hasMood) {
    // 名前から推測
    const n = name.toLowerCase();
    if (/カフェ|コーヒー|喫茶/.test(n)) result.push("#まったりしたい");
    else if (/温泉|スパ|銭湯/.test(n)) result.push("#まったりしたい");
    else if (/公園|自然|森|山|海/.test(n)) result.push("#自然感じたい");
    else if (/食|レストラン|居酒屋|ラーメン/.test(n)) result.push("#お腹すいた");
    else if (/ジム|スポーツ|プール/.test(n)) result.push("#体動かしたい");
    else result.push("#まったりしたい");
  }

  const hasDrill = result.some(t => DRILL_DOWN_TAGS.includes(t));
  if (!hasDrill) {
    const n = name.toLowerCase();
    if (/カフェ|喫茶/.test(n)) result.push("#癒しカフェ");
    else if (/温泉/.test(n)) result.push("#温泉");
    else if (/公園/.test(n)) result.push("#大型公園");
    else if (/海|ビーチ/.test(n)) result.push("#海辺");
    else if (/展望|タワー/.test(n)) result.push("#展望台");
    else result.push("#お散歩");
  }

  return [...new Set(result)];
}

// GET: 対象件数の確認
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("places")
    .select("id, name, tags", { count: "exact" })
    .eq("is_active", true);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const total = data?.length ?? 0;
  const needsRetag = (data ?? []).filter(p => {
    const tags: string[] = p.tags ?? [];
    const hasMood = tags.some((t: string) => MOOD_TAGS.includes(t));
    const hasDrill = tags.some((t: string) => DRILL_DOWN_TAGS.includes(t));
    const allValid = tags.every((t: string) => ALL_PREDEFINED_TAGS.includes(t));
    return !hasMood || !hasDrill || !allValid;
  }).length;

  return NextResponse.json({ ok: true, total, needsRetag });
}

// POST: 一括再タグ付け
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (body?.secret !== ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const overwrite: boolean = body?.overwrite ?? false;

  const { data: places, error } = await supabaseAdmin
    .from("places")
    .select("id, name, address, description, tags")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const targets = (places ?? []).filter(p => {
    if (overwrite) return true;
    const tags: string[] = p.tags ?? [];
    const hasMood = tags.some((t: string) => MOOD_TAGS.includes(t));
    const hasDrill = tags.some((t: string) => DRILL_DOWN_TAGS.includes(t));
    const allValid = tags.every((t: string) => ALL_PREDEFINED_TAGS.includes(t));
    return !hasMood || !hasDrill || !allValid;
  });

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const results: { name: string; tags: string[]; action: string }[] = [];

  for (const place of targets) {
    try {
      const newTags = await retagPlace(place as {
        id: string; name: string; address: string;
        description: string | null; tags: string[];
      });

      const { error: updateErr } = await supabaseAdmin
        .from("places")
        .update({ tags: newTags })
        .eq("id", place.id);

      if (updateErr) throw updateErr;
      results.push({ name: place.name, tags: newTags, action: "updated" });
      updated++;
    } catch (e) {
      results.push({ name: place.name, tags: [], action: `failed: ${String(e)}` });
      failed++;
    }

    await new Promise(r => setTimeout(r, 300));
  }

  skipped = (places?.length ?? 0) - targets.length;

  return NextResponse.json({ ok: true, total: places?.length ?? 0, updated, skipped, failed, results });
}
