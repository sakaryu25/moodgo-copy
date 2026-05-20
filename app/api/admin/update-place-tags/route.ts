import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "moodgoadmin123";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — スポットのタグ配列を上書き保存 */
export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const id: string   = (body.id ?? "").trim();
  const tags: unknown = body.tags;

  if (!id) return NextResponse.json({ ok: false, error: "id が必要です" }, { status: 400 });
  if (!Array.isArray(tags)) return NextResponse.json({ ok: false, error: "tags は配列が必要です" }, { status: 400 });

  const cleanTags = (tags as unknown[])
    .map(t => String(t).trim())
    .filter(t => t.startsWith("#") && t.length > 1);

  const { error } = await supabase.from("places").update({ tags: cleanTags }).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, tags: cleanTags });
}
