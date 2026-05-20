import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "moodgoadmin123";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Place = { id: string; name: string; address: string; tags: string[] | null; google_place_id: string | null };

async function fetchAllPlaces(): Promise<Place[]> {
  const places: Place[] = [];
  const batchSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase!
      .from("places")
      .select("id, name, address, tags, google_place_id")
      .order("created_at", { ascending: true })
      .range(from, from + batchSize - 1);
    if (error || !data || data.length === 0) break;
    places.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return places;
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const places = await fetchAllPlaces();

  // ① 完全一致の重複（名前が同じ）
  const byName = new Map<string, Place[]>();
  for (const p of places) {
    const key = p.name.trim();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(p);
  }

  const exactDuplicates = [];
  for (const [name, group] of byName) {
    if (group.length <= 1) continue;
    // タグ数が多い順にソート（先頭を「残す」候補）
    group.sort((a, b) => (b.tags?.length ?? 0) - (a.tags?.length ?? 0));
    exactDuplicates.push({
      name,
      count: group.length,
      places: group.map(p => ({
        id: p.id,
        name: p.name,
        address: p.address ?? "",
        tags: p.tags ?? [],
        tagCount: p.tags?.length ?? 0,
      })),
    });
  }

  // ② 名前プレフィックス一致の子スポット
  // 例: "よこはまコスモワールド キッズカーニバル・ゾーン" → 親 "よこはまコスモワールド"
  // 条件: 親名が6文字以上（カラオケ=4・嵐の湯=4・カラオケ館=5 などジャンル名・チェーン名を除外）

  const nameToPlace = new Map(places.map(p => [p.name.trim(), p]));
  const subZoneMap = new Map<string, { parent: Place; children: Place[] }>();

  for (const child of places) {
    const name = child.name.trim();
    // スペース区切りで左から縮めて親を探す
    for (let i = name.length - 1; i >= 2; i--) {
      const ch = name[i];
      if (ch === " " || ch === "　") {
        const prefix = name.substring(0, i);
        // 6文字未満の親名はジャンル名・チェーン名とみなしてスキップ
        if (prefix.length < 6) break;
        const parent = nameToPlace.get(prefix);
        if (parent && parent.id !== child.id) {
          if (!subZoneMap.has(parent.id)) subZoneMap.set(parent.id, { parent, children: [] });
          subZoneMap.get(parent.id)!.children.push(child);
          break;
        }
      }
    }
  }

  const subZones = [...subZoneMap.values()].map(({ parent, children }) => ({
    parentId: parent.id,
    parentName: parent.name,
    children: children.map(c => ({ id: c.id, name: c.name, address: c.address ?? "" })),
  }));

  return NextResponse.json({
    ok: true,
    totalPlaces: places.length,
    exactDuplicates,
    subZones,
  });
}
