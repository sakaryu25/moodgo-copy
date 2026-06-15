// ─── /api/engagement ─────────────────────────────────────────────────────────
// 暗黙フィードバック（地図クリック・詳細閲覧・お気に入り・行った・共有）を記録する。
// recommend の学習ランキング（fetchEngagementAgg）が10分キャッシュで集計して
// 検索結果の昇格に利用する＝検索させるたびにAIが成長する仕組みの暗黙シグナル側。
//
// POST body: { place_name: string, mood?: string, action: "map_click"|"detail_view"|"favorite"|"visited"|"share" }
// GET (admin): ?secret=moodgoadmin123 → 気分×スポット別の集計

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN_SECRET = "moodgoadmin123";
const VALID_ACTIONS = new Set(["map_click", "detail_view", "favorite", "visited", "share"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { place_name, mood, action, place_id, device_id, search_id, position } = body ?? {};
    if (!place_name || !VALID_ACTIONS.has(action)) {
      return NextResponse.json({ ok: false, error: "place_name と有効な action が必須です" }, { status: 400 });
    }
    if (!supabase) return NextResponse.json({ ok: true, skipped: true });

    const name = String(place_name).slice(0, 200);
    // ファネル計測列(place_id/device_id/search_id/position)も保存。
    //   funnel-tracking.sql 未適用(列なし)の場合は 42703/PGRST204 になるので
    //   コア列のみで再挿入し、後方互換を保つ（学習ループの記録を止めない）。
    const core = { place_name: name, mood: mood ?? null, action };
    const enriched = {
      ...core,
      place_id: place_id ? String(place_id).slice(0, 200) : null,
      device_id: device_id ? String(device_id).slice(0, 128) : null,
      search_id: search_id ? String(search_id).slice(0, 64) : null,
      position: typeof position === "number" ? position : null,
    };
    let { error } = await supabase.from("spot_engagement").insert(enriched);
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      ({ error } = await supabase.from("spot_engagement").insert(core));
    }

    // item8: 場所×気分アフィニティを加算（visited=5/favorite=3/share=3/detail=1/map=1）。
    //   協調フィルタ（似たユーザーの好み）を都度計算でなく集計テーブルで高速・高精度に。
    //   テーブル/RPC未作成でも握りつぶして安全。
    if (mood) {
      const WEIGHT: Record<string, number> = { visited: 5, favorite: 3, share: 3, detail_view: 1, map_click: 1 };
      await supabase.rpc("bump_affinity", { p_place: name, p_mood: String(mood), p_delta: WEIGHT[action] ?? 1 }).then(() => {}, () => {});
    }

    if (error) {
      // テーブル未作成（supabase/learning-tables.sql 未実行）でもエラーにしない
      return NextResponse.json({ ok: true, skipped: true });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  try {
    const { data, error } = await supabase
      .from("spot_engagement")
      .select("place_name, mood, action, created_at")
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) return NextResponse.json({ ok: true, data: [], note: "テーブル未作成（supabase/learning-tables.sql を実行してください）" });

    // 気分×スポット別に行動内訳を集計
    const map = new Map<string, { place_name: string; mood: string; map_click: number; detail_view: number; favorite: number; visited: number; share: number; total: number }>();
    for (const row of data ?? []) {
      const key = `${row.mood ?? ""}||${row.place_name}`;
      const cur = map.get(key) ?? { place_name: row.place_name, mood: row.mood ?? "", map_click: 0, detail_view: 0, favorite: 0, visited: 0, share: 0, total: 0 };
      const a = row.action as keyof typeof cur;
      if (typeof cur[a] === "number") (cur[a] as number)++;
      cur.total++;
      map.set(key, cur);
    }
    const result = [...map.values()].sort((a, b) => b.total - a.total);
    return NextResponse.json({ ok: true, data: result, total: result.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
