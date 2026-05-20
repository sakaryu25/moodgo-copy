import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "moodgoadmin123";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const dryRun: boolean = body.dryRun !== false;

  // 全スポットをページネーションで全件取得（Supabaseのサーバー上限1000件を回避）
  const places: Array<{ id: string; name: string; google_place_id: string | null; tags: string[] | null; created_at: string }> = [];
  const batchSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, google_place_id, tags, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + batchSize - 1);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    places.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  const toDelete = new Set<string>();

  // ① google_place_id が同じ重複（最初の1件を残して削除）
  const byPlaceId = new Map<string, typeof places>();
  for (const p of places) {
    if (!p.google_place_id) continue;
    const key = p.google_place_id;
    if (!byPlaceId.has(key)) byPlaceId.set(key, []);
    byPlaceId.get(key)!.push(p);
  }
  for (const group of byPlaceId.values()) {
    if (group.length <= 1) continue;
    // タグ数が最多のものを残す、同数なら古い方
    group.sort((a, b) => (b.tags?.length ?? 0) - (a.tags?.length ?? 0));
    for (const dup of group.slice(1)) toDelete.add(dup.id);
  }

  // ② 名前が同じ重複（google_place_id なしも含む）
  const byName = new Map<string, typeof places>();
  for (const p of places) {
    if (toDelete.has(p.id)) continue; // すでに削除対象
    const key = p.name.toLowerCase().trim();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(p);
  }
  for (const group of byName.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => (b.tags?.length ?? 0) - (a.tags?.length ?? 0));
    for (const dup of group.slice(1)) toDelete.add(dup.id);
  }

  const deleteIds = [...toDelete];
  const deleteNames = places.filter(p => toDelete.has(p.id)).map(p => p.name);
  const count = deleteIds.length;

  if (!dryRun && count > 0) {
    const { error: delErr } = await supabase.from("places").delete().in("id", deleteIds);
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, dryRun, count, names: deleteNames, totalFetched: places.length });
}
