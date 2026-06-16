// ─── /api/admin/describe-all ─────────────────────────────────────────────────
// places.description が NULL のスポットに、gpt-4o-mini で中立的な一言説明を一括生成・永続化する。
// 検索駆動の scheduleDescriptionGeneration(1検索20件)では 68k のバックログ消化が遅いため、
// 管理者が手動で大量消化するためのバッチ。retag-all と同じ構造（admin secret＋ページング）。
//
// GET  ?secret=...                 → 説明文未生成(description IS NULL)の残数
// POST {secret, limit?, offset?}   → limit件(既定120)を生成・保存。返り値の nextOffset で続行
//
// ⚠ description は NULL の行のみ更新（既存の手書き/生成済みは壊さない）。

import { NextResponse } from "next/server";
import { supabase as sb } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ADMIN_PASSWORD = ADMIN_SECRET;
const GROUP_SIZE = 15;  // 1回のOpenAI呼び出しに渡すスポット数（トークン上限内）

export async function GET(req: Request) {
  if (!sb) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { count, error } = await sb
    .from("places")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .is("description", null);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, remaining: count ?? 0 });
}

export async function POST(req: Request) {
  if (!sb) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await req.json().catch(() => null);
  if (body?.secret !== ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return NextResponse.json({ ok: false, error: "OPENAI_API_KEY未設定" }, { status: 503 });

  const db = sb;  // null ガード後にキャプチャ（ネストした async クロージャで narrowing を維持）
  const limit = Math.min(Math.max(Number(body?.limit) || 120, 1), 300);
  const offset = Math.max(Number(body?.offset) || 0, 0);

  // description が NULL の行を取得（id順で安定ページング）
  const { data: places, error } = await db
    .from("places")
    .select("id, name, address, tags")
    .eq("is_active", true)
    .is("description", null)
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (places ?? []) as Array<{ id: string; name: string; address: string | null; tags: string[] | null }>;
  let updated = 0, failed = 0;

  // GROUP_SIZE 件ずつ OpenAI へ（コスト/トークン制御）
  for (let i = 0; i < rows.length; i += GROUP_SIZE) {
    const group = rows.slice(i, i + GROUP_SIZE);
    const list = group.map((s, j) =>
      `${j + 1}. ${s.name}（${(s.tags ?? []).slice(0, 6).join("・") || "—"}／${String(s.address ?? "").replace(/^日本[,、]?\s*/, "").slice(0, 14)}）`
    ).join("\n");
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.5,
          response_format: { type: "json_object" },
          max_tokens: 900,
          messages: [
            { role: "system", content: `各スポットについて、その場所そのものを説明する中立的な一文（25〜45字）を書いてください。気分や推薦には言及せず、特徴・雰囲気・名物・立地だけを淡々と。事実不明な点はタグ・住所から自然に推測してよいが誇張は避ける。JSON: {"descriptions": {"番号": "説明文", ...}}（番号は入力の番号）` },
            { role: "user", content: list },
          ],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const data = await res.json();
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
      const descs = parsed.descriptions ?? {};
      await Promise.all(group.map(async (s, j) => {
        const text = descs[String(j + 1)];
        if (typeof text !== "string" || !text.trim()) { return; }
        const { error: uErr } = await db.from("places")
          .update({ description: text.trim().slice(0, 120) })
          .eq("id", s.id)
          .is("description", null);
        if (uErr) failed++; else updated++;
      }));
    } catch {
      failed += group.length;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  const hasMore = rows.length === limit;
  return NextResponse.json({
    ok: true, processed: rows.length, updated, failed,
    nextOffset: hasMore ? offset + limit : null,
    hint: hasMore ? `続行するには POST {secret, offset:${offset + limit}}` : "完了（このバッチで全件処理）",
  });
}
