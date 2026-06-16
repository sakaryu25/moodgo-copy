import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSubFacility(address: string): boolean {
  // 商業・エンタメ系の大型施設に限定して「〇〇内」を検出
  // 公園・センター・ガーデン等の公共施設は除外（広場・展望台等は独立スポットとして有効）
  return /[ァ-ヶー一-龥々]{2,}(シーパラダイス|ハイランド|アミューズメントパーク|テーマパーク|遊園地|アウトレット|ショッピングモール|ゆめタウン|イオンモール|サファリパーク|マリンパーク|アドベンチャーワールド)内/.test(address);
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const namePattern: string | null    = body.namePattern ?? null;
  const addressPattern: string | null = body.addressPattern ?? null;
  const tag: string | null            = body.tag ?? null;
  const subFacilityOnly: boolean      = body.subFacilityOnly === true;
  const directIds: string[] | null    = Array.isArray(body.ids) ? body.ids : null;
  const dryRun: boolean               = body.dryRun !== false;

  // IDs直接指定モード
  if (directIds) {
    const { data: targets } = await supabase.from("places").select("id, name").in("id", directIds);
    const names = (targets ?? []).map((r: { name: string }) => r.name);
    const count = directIds.length;
    if (!dryRun && count > 0) {
      const { error: delErr } = await supabase.from("places").delete().in("id", directIds);
      if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, dryRun, count, names });
  }

  if (!namePattern && !addressPattern && !tag && !subFacilityOnly) {
    return NextResponse.json({ ok: false, error: "namePattern / addressPattern / tag / subFacilityOnly のいずれかが必要です" }, { status: 400 });
  }

  // 対象スポットを検索
  let query = supabase.from("places").select("id, name, address, tags");
  if (namePattern)    query = query.ilike("name", `%${namePattern}%`);
  if (addressPattern) query = query.ilike("address", `%${addressPattern}%`);
  if (tag)            query = query.contains("tags", [tag]);
  // subFacilityOnly は全件取得してJS側でフィルタ
  if (subFacilityOnly) query = query.ilike("address", "%内%");

  const { data: rawTargets, error: selectErr } = await query;
  if (selectErr) return NextResponse.json({ ok: false, error: selectErr.message }, { status: 500 });

  // subFacilityOnly の場合はJS側で精密フィルタ
  const targets = subFacilityOnly
    ? (rawTargets ?? []).filter((r: { address: string }) => isSubFacility(r.address ?? ""))
    : (rawTargets ?? []);

  const names = targets.map((r: { name: string }) => r.name);
  const ids   = targets.map((r: { id: string }) => r.id);
  const count = ids.length;

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, count, names });
  }

  if (count === 0) {
    return NextResponse.json({ ok: true, dryRun: false, count: 0, names: [] });
  }

  const { error: deleteErr } = await supabase.from("places").delete().in("id", ids);
  if (deleteErr) return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, dryRun: false, count, names });
}
