export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * おすすめユーザー（2026-07-09）
 * POST /api/user-suggest { deviceId }
 *   → { items: [{ id(hash), handle, icon }] }
 * 最近活発な投稿者を、自分・フォロー済み・ブロック済みを除いて提示する。
 *   アイコンはハッシュから直接(user-icons/{hash}.jpg)、@IDは user_handles をハッシュ照合で解決。
 *   投稿テーブル/フォロー/ブロック未適用でも安全（空/無視）。
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deviceHash } from "@/lib/device-hash";

const LIMIT = 12;

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: true, items: [] });
  const db = supabase;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* deviceId無しでも公開情報は返せる */ }
  const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
  const me = deviceId ? deviceHash(deviceId) : "";

  try {
    // 候補: 最近の投稿者(spot_posts + suggestions)の device_id
    const posters = new Set<string>();
    try {
      const { data } = await db.from("spot_posts").select("device_id").eq("status", "approved")
        .in("visibility", ["public", "spot_public_anonymous"])   // 非公開投稿だけのユーザーを「おすすめ」に出さない
        .order("created_at", { ascending: false }).limit(300);
      for (const r of (data ?? []) as Array<{ device_id?: string }>) if (r.device_id) posters.add(String(r.device_id));
    } catch { /* 未適用は無視 */ }
    try {
      const { data } = await db.from("suggestions").select("device_id").eq("status", "approved")
        .order("created_at", { ascending: false }).limit(200);
      for (const r of (data ?? []) as Array<{ device_id?: string }>) if (r.device_id) posters.add(String(r.device_id));
    } catch { /* 無視 */ }

    // device_id → hash。自分は除外。
    const hashByDev = new Map<string, string>();
    for (const dev of posters) { const h = deviceHash(dev); if (h !== me) hashByDev.set(dev, h); }
    let candHashes = [...new Set(hashByDev.values())];

    // フォロー済み・ブロック済みを除外
    if (me) {
      try {
        const { data: fl } = await db.from("user_follows").select("followee_hash").eq("follower_hash", me);
        const followed = new Set(((fl ?? []) as Array<{ followee_hash?: string }>).map((r) => String(r.followee_hash)));
        candHashes = candHashes.filter((h) => !followed.has(h));
      } catch { /* 未適用は除外なし */ }
      try {
        const { data: bl } = await db.from("user_blocks").select("blocked_hash").eq("blocker_hash", me);
        const blocked = new Set(((bl ?? []) as Array<{ blocked_hash?: string }>).map((r) => String(r.blocked_hash)));
        candHashes = candHashes.filter((h) => !blocked.has(h));
      } catch { /* 未適用は除外なし */ }
    }

    // @ID解決（handle保持者を優先）。user_handlesをハッシュ照合。
    const handleByHash = new Map<string, string>();
    try {
      const { data: hs } = await db.from("user_handles").select("device_id, handle");
      const candSet = new Set(candHashes);
      for (const h of (hs ?? []) as Array<{ device_id?: string; handle?: string }>) {
        const dev = String(h.device_id ?? "");
        if (!dev || !h.handle) continue;
        const dh = deviceHash(dev);
        if (candSet.has(dh)) handleByHash.set(dh, String(h.handle));
      }
    } catch { /* @ID無しでも出す */ }

    // handle持ちを先、その後その他。先頭 LIMIT 件。
    const withHandle = candHashes.filter((h) => handleByHash.has(h));
    const without = candHashes.filter((h) => !handleByHash.has(h));
    const ordered = [...withHandle, ...without].slice(0, LIMIT);

    const vHour = Math.floor(Date.now() / 3_600_000);
    const items = ordered.map((h) => {
      const { data: pub } = db.storage.from("user-icons").getPublicUrl(`${h}.jpg`);
      return { id: h, handle: handleByHash.get(h) ?? null, icon: `${pub.publicUrl}?v=${vHour}` };
    });
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: true, items: [], error: String((e as { message?: string } | null)?.message ?? e) });
  }
}
