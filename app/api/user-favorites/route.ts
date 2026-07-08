export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * お気に入り(=行きたいリスト)のサーバー同期（2026-07-09）
 * POST /api/user-favorites
 *   { action:"list",    deviceId }             … サーバー保存のお気に入り items[]
 *   { action:"replace", deviceId, items[] }    … この端末のお気に入りを丸ごと置き換え保存
 * ⚠ device_hash キー（生device_id非保存）。user_favorites 未適用でも安全(空/no-op)。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash } from "@/lib/device-hash";
import { rateLimit, clientIp } from "@/lib/rate-limit";

function isMissingTable(e: unknown): boolean {
  const code = String((e as { code?: string } | null)?.code ?? "");
  return code === "42P01" || code === "PGRST205" || code === "PGRST204";
}
function favKeyOf(item: Record<string, unknown>): string {
  return String(item?.supabaseId ?? item?.placeId ?? item?.title ?? "").trim();
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSONが不正です" }, { status: 400 }); }
  const action = String(body?.action ?? "");
  const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
  if (!deviceId) return NextResponse.json({ ok: false, error: "deviceIdが必要です" }, { status: 400 });
  const hash = deviceHash(deviceId);

  try {
    // ── 一覧（再インストール後の復元に使う）──
    if (action === "list") {
      try {
        const { data, error } = await db.from("user_favorites")
          .select("item").eq("device_hash", hash).order("saved_at", { ascending: false });
        if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: true, items: [] }); throw error; }
        const items = ((data ?? []) as Array<{ item?: unknown }>).map((r) => r.item).filter(Boolean);
        return NextResponse.json({ ok: true, items });
      } catch { return NextResponse.json({ ok: true, items: [] }); }
    }

    // ── 丸ごと置き換え（この端末のローカルが真実）──
    if (action === "replace") {
      if (!rateLimit(`fav:${clientIp(req)}`, 30, 60_000)) {
        return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
      }
      const raw = Array.isArray(body?.items) ? (body.items as Array<Record<string, unknown>>) : [];
      const byKey = new Map<string, Record<string, unknown>>();
      for (const it of raw.slice(0, 500)) { const k = favKeyOf(it); if (k) byKey.set(k, it); }   // fav_keyで重複排除
      try {
        await db.from("user_favorites").delete().eq("device_hash", hash);
        if (byKey.size > 0) {
          const rows = [...byKey.entries()].map(([fav_key, item]) => ({ device_hash: hash, fav_key, item }));
          const { error } = await db.from("user_favorites").insert(rows);
          if (error) { if (isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 }); throw error; }
        }
        return NextResponse.json({ ok: true, count: byKey.size });
      } catch (e) {
        if (isMissingTable(e)) return NextResponse.json({ ok: false, tableMissing: true }, { status: 400 });
        throw e;
      }
    }

    return NextResponse.json({ ok: false, error: "actionが不正です" }, { status: 400 });
  } catch (e) {
    console.error("[user-favorites]", e);
    return NextResponse.json({ ok: false, error: String((e as { message?: string } | null)?.message ?? e) }, { status: 500 });
  }
}
