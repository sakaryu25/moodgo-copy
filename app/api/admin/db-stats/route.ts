// /api/admin/db-stats
// places テーブルの統計を返す（総件数・ソース別・タグ別全件）

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "moodgoadmin123";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 500 });
  }

  try {
    // ── 総件数 ──────────────────────────────────────────────────────────────
    const { count: total } = await supabase
      .from("places")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    // ── ソース別件数 ─────────────────────────────────────────────────────────
    const { data: sourcesRaw } = await supabase
      .from("places")
      .select("source_type")
      .eq("is_active", true);

    const sourceMap: Record<string, number> = {};
    for (const row of sourcesRaw ?? []) {
      const key = row.source_type ?? "未設定";
      sourceMap[key] = (sourceMap[key] ?? 0) + 1;
    }
    const bySource = Object.entries(sourceMap)
      .map(([source_type, count]) => ({ source_type, count }))
      .sort((a, b) => b.count - a.count);

    // ── タグ別件数（全件） ───────────────────────────────────────────────────
    const { data: tagsRaw } = await supabase
      .from("places")
      .select("tags")
      .eq("is_active", true);

    const tagMap: Record<string, number> = {};
    for (const row of tagsRaw ?? []) {
      for (const tag of row.tags ?? []) {
        tagMap[tag] = (tagMap[tag] ?? 0) + 1;
      }
    }
    const byTag = Object.entries(tagMap)
      .map(([tag, cnt]) => ({ tag, cnt }))
      .sort((a, b) => b.cnt - a.cnt);

    return NextResponse.json({ ok: true, total, bySource, byTag });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
