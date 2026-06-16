export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ─── サーバー側エラーの閲覧/掃除（管理者）─────────────────────────────────────
//   GET  ?secret=&scope=&limit=  → 直近のエラー＋scope別件数（直近7日）
//   POST {action:'clear', secret, olderThanDays?} → 古いログ削除
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAdminFromReq, isValidAdminSecret } from "@/lib/admin-auth";

export async function GET(req: Request) {
  if (!requireAdminFromReq(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!supabase) return NextResponse.json({ ok: false, error: "no db" }, { status: 503 });
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);
  const scope = searchParams.get("scope")?.trim();
  try {
    let q = supabase.from("server_errors").select("*").order("created_at", { ascending: false }).limit(limit);
    if (scope) q = q.eq("scope", scope);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    // scope別の件数集計（取得分の範囲で）
    const byScope: Record<string, number> = {};
    for (const r of rows) { const s = String(r.scope ?? "?"); byScope[s] = (byScope[s] ?? 0) + 1; }
    return NextResponse.json({ ok: true, count: rows.length, byScope, errors: rows });
  } catch (e) {
    // テーブル未作成（SQL未適用）でも 200 で空を返す＝管理画面が壊れない
    return NextResponse.json({ ok: true, count: 0, byScope: {}, errors: [], note: "server_errors 未作成かもしれません: " + String(e) });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!isValidAdminSecret(body?.secret) && !requireAdminFromReq(req))
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!supabase) return NextResponse.json({ ok: false, error: "no db" }, { status: 503 });
  if (String(body?.action) !== "clear") return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  const days = Math.max(0, Number(body?.olderThanDays ?? 0));
  try {
    let q = supabase.from("server_errors").delete({ count: "exact" });
    if (days > 0) q = q.lt("created_at", new Date(Date.now() - days * 86400_000).toISOString());
    else q = q.neq("id", "00000000-0000-0000-0000-000000000000"); // 全削除
    const { count, error } = await q;
    if (error) throw error;
    return NextResponse.json({ ok: true, deleted: count ?? 0 });
  } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 500 }); }
}
