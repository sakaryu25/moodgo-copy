import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";
import { normalizeName, distanceMeters } from "@/lib/normalize-name";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Place = { id: string; name: string; address: string; tags: string[] | null; google_place_id: string | null; lat: number | null; lng: number | null };

async function fetchAllPlaces(): Promise<Place[]> {
  const places: Place[] = [];
  const batchSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase!
      .from("places")
      .select("id, name, address, tags, google_place_id, lat, lng")
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

  // ① 表記ゆれ（カナ↔ひらがな・全角半角・記号ゆれ）を吸収した重複＋近接クラスタ
  //   normalizeName で束ねると「東京スカイツリー / 東京ｽｶｲﾂﾘｰ / 東京すかいつりー」が同一キーになる。
  //   ただし同名≠同一店舗（チェーンは同名で全国散在）なので、束ねた中を座標近接(≈40m)で
  //   クラスタ分割し、同一地点のクラスタだけを重複として返す＝別支店を誤って束ねない。
  //   ※日本語↔英語（東京スカイツリー vs Tokyo Skytree）は正規化では吸えない別軸。座標だけで
  //     結合すると同一ビル内の別店舗を誤結合し得るため、ここでは自動検出せず手動運用に委ねる。
  const RADIUS_M = 40;
  const byNorm = new Map<string, Place[]>();
  for (const p of places) {
    const key = normalizeName(p.name);
    if (!key) continue;
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key)!.push(p);
  }

  const exactDuplicates = [];
  for (const group of byNorm.values()) {
    if (group.length <= 1) continue;
    // 座標近接クラスタに分割（clique的＝クラスタ全員と近接する場合だけ同一クラスタに入れる）
    const clusters: Place[][] = [];
    for (const p of group) {
      let placed = false;
      if (p.lat != null && p.lng != null) {
        for (const cl of clusters) {
          if (cl.every(q => q.lat != null && q.lng != null &&
              distanceMeters(p.lat as number, p.lng as number, q.lat as number, q.lng as number) <= RADIUS_M)) {
            cl.push(p); placed = true; break;
          }
        }
      }
      // 座標なしは近接判定できない＝誤統合を避けて単独クラスタ（＝重複として報告しない）
      if (!placed) clusters.push([p]);
    }
    for (const cl of clusters) {
      if (cl.length <= 1) continue;
      // タグ数が多い順にソート（先頭を「残す」候補）
      cl.sort((a, b) => (b.tags?.length ?? 0) - (a.tags?.length ?? 0));
      exactDuplicates.push({
        name: cl[0].name,
        count: cl.length,
        places: cl.map(p => ({
          id: p.id,
          name: p.name,
          address: p.address ?? "",
          tags: p.tags ?? [],
          tagCount: p.tags?.length ?? 0,
        })),
      });
    }
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
