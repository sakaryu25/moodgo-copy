export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 場所詳細の「開催中イベント」導線（2026-07-12）
 * GET /api/place-events?placeName=品川アクアリウム
 *   その場所で開催中/開催予定の「期間限定イベント派生スポット」を返す。
 *   派生スポットは名前が「イベント名＠元スポット名」・source_type=user（[[moodlog-feature]] 参照）。
 *   まだ終わっていない(available_until >= 今日)ものだけ。各イベントの代表投稿(ml-<id>)へ遷移させる。
 *   ※元データ(親)は無変更。写真も派生スポット側にしか付かない。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  if (!supabase) return NextResponse.json({ ok: true, events: [] });
  const db = supabase;
  const { searchParams } = new URL(req.url);
  const placeName = (searchParams.get("placeName") ?? "").trim();
  if (placeName.length < 2) return NextResponse.json({ ok: true, events: [] });

  const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
  const safe = placeName.replace(/[%_,]/g, "").slice(0, 80);   // PostgREST like/or の記号を除去

  try {
    // 「＠{元スポット名}」で終わる派生イベントで、まだ終わっていないもの
    const { data: places, error } = await db
      .from("places")
      .select("id, name, available_from, available_until")
      .eq("source_type", "user")
      .eq("is_active", true)   // 非アクティブ(削除済み)の派生イベントを導線に出さない
      .like("name", `%＠${safe}`)
      .not("available_until", "is", null)
      .gte("available_until", today)
      .limit(10);
    if (error) return NextResponse.json({ ok: true, events: [] });   // 列未適用(42703)等は空で安全に
    const rows = (places ?? []) as Array<{ id: string; name: string; available_from: string | null; available_until: string | null }>;
    if (rows.length === 0) return NextResponse.json({ ok: true, events: [] });

    // 各派生スポットの代表投稿（最古の承認済み）を1件だけ拾って遷移先にする
    const ids = rows.map((r) => r.id);
    const { data: posts } = await db.from("spot_posts")
      .select("id, place_id, created_at").in("place_id", ids)
      .eq("status", "approved").in("visibility", ["public", "spot_public_anonymous"])   // 非公開投稿を代表(遷移リンク)にしない
      .order("created_at", { ascending: true });
    const postByPlace = new Map<string, string>();
    for (const p of (posts ?? []) as Array<{ id: string; place_id: string }>) {
      if (!postByPlace.has(String(p.place_id))) postByPlace.set(String(p.place_id), String(p.id));
    }

    const events = rows.map((r) => {
      const at = r.name.lastIndexOf("＠");
      const eventName = at > 0 ? r.name.slice(0, at) : r.name;
      const postId = postByPlace.get(r.id);
      return {
        targetId: postId ? `ml-${postId}` : null,   // community-spot への遷移用
        eventName,
        from: r.available_from,
        until: r.available_until,
        upcoming: !!(r.available_from && r.available_from > today),   // まだ開始前
      };
    }).filter((e) => e.targetId);   // 表示できる投稿があるものだけ

    return NextResponse.json({ ok: true, events }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
  } catch {
    return NextResponse.json({ ok: true, events: [] });
  }
}
