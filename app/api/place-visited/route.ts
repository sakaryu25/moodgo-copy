export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * 行った！クレジット（2026-07-07）
 * POST /api/place-visited { deviceId, placeName, supabaseId?, placeId?, address?, action? }
 *
 * 検索結果/履歴/お気に入りの「行った！」ボタンから呼ばれる。
 * その場所に紐づく承認済み投稿（spot_posts / suggestions）を見つけ、
 * spot_post_reactions(rtype='visited') を付与/解除する＝投稿者の「行った！された回数」が増減する。
 *   - action: 'credit'(デフォルト) | 'uncredit'（ボタン再タップでの解除）
 *   - 二重付与は unique(post_id, device_id, rtype) で防止（同じ人が何度押しても1回）
 *   - suggestions の名前一致は同名別地の誤クレジット防止のため都道府県が分かる時は一致必須
 */
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CREDIT = 20;   // 1回の押下でクレジットする投稿数の上限

function prefOf(addr: unknown): string {
  const m = String(addr ?? "").match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
  return m ? m[1] : "";
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSONが不正です" }, { status: 400 }); }

  const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
  const action = body?.action === "uncredit" ? "uncredit" : body?.action === "count" ? "count" : "credit";
  const placeName = String(body?.placeName ?? "").trim().slice(0, 200);
  const supabaseId = String(body?.supabaseId ?? "").trim();
  const placeId = String(body?.placeId ?? "").trim();
  const address = String(body?.address ?? "").trim();
  // count は公開集計（deviceId不要）。credit/uncredit のみ deviceId 必須。
  if (action !== "count" && !deviceId) return NextResponse.json({ ok: false, error: "deviceIdが必要です" }, { status: 400 });
  if (!placeName && !supabaseId) return NextResponse.json({ ok: false, error: "placeName か supabaseId が必要です" }, { status: 400 });
  if (!rateLimit(`place-visited:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
  }

  try {
    const ids = new Set<string>();
    const myPref = prefOf(address);

    // ── spot_posts: place_id(UUID/GoogleID) または place_name の一致 ──
    try {
      let q = db.from("spot_posts").select("id, place_id, place_name").eq("status", "approved").limit(50);
      const ors: string[] = [];
      if (UUID_RE.test(supabaseId)) ors.push(`place_id.eq.${supabaseId}`);
      if (placeId && !placeId.includes(",")) ors.push(`place_id.eq.${placeId}`);
      if (placeName && !placeName.includes(",")) ors.push(`place_name.eq.${placeName}`);
      if (ors.length === 0) throw new Error("no-cond");
      q = q.or(ors.join(","));
      const { data } = await q;
      for (const r of (data ?? []) as Array<{ id?: string }>) if (r.id) ids.add(String(r.id));
    } catch { /* 条件なし/失敗はスキップ */ }

    // ── suggestions: スポット名の一致（都道府県が両方分かる時は一致必須）──
    if (placeName && !placeName.includes(",")) {
      try {
        const { data } = await db.from("suggestions")
          .select("id, address")
          .eq("status", "approved")
          .or(`spot_name.eq.${placeName},google_place_name.eq.${placeName}`)
          .limit(20);
        for (const r of (data ?? []) as Array<{ id?: string; address?: string }>) {
          const sPref = prefOf(r.address);
          if (myPref && sPref && myPref !== sPref) continue;   // 同名別地は除外
          if (r.id) ids.add(String(r.id));
        }
      } catch { /* スキップ */ }
    }

    const targets = Array.from(ids).slice(0, MAX_CREDIT);

    // ── 集計: この場所の全投稿への「行った!」延べ人数（distinct device）を返す（公開・読み取り）──
    if (action === "count") {
      if (targets.length === 0) return NextResponse.json({ ok: true, count: 0 });
      try {
        const { data } = await db.from("spot_post_reactions")
          .select("device_id").eq("rtype", "visited").in("post_id", targets);
        const distinct = new Set(((data ?? []) as Array<{ device_id?: string }>).map((r) => String(r.device_id ?? "")).filter(Boolean));
        return NextResponse.json({ ok: true, count: distinct.size });
      } catch { return NextResponse.json({ ok: true, count: 0 }); }
    }

    // ── 解除: 自分が付けた visited リアクションを外す ──
    if (action === "uncredit") {
      let removed = 0;
      if (targets.length > 0) {
        const { data: del } = await db.from("spot_post_reactions")
          .delete().eq("device_id", deviceId).eq("rtype", "visited").in("post_id", targets).select("id");
        removed = Array.isArray(del) ? del.length : 0;
      }
      return NextResponse.json({ ok: true, matched: ids.size, removed });
    }

    // ── 付与（unique重複は成功扱い）──
    let credited = 0;
    for (const postId of targets) {
      const { error } = await db.from("spot_post_reactions")
        .insert({ post_id: postId, device_id: deviceId, rtype: "visited" });
      if (!error) credited++;
      // 23505=付与済み・42P01=テーブル無し → どちらも黙ってスキップ
    }
    return NextResponse.json({ ok: true, matched: ids.size, credited });
  } catch (e) {
    console.error("[place-visited]", e);
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
