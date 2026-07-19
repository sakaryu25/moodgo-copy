// ── /api/admin/limited-spots ─────────────────────────────────────────────────
// 📅 期間限定スポット管理: 一覧(list) / 編集(update) / 削除(delete) / 復活(restore)。
//   対象は places のうち available_from または available_until が入った行（＝期間限定）。
//   編集項目: 名前・住所・画像(image_urls)・タグ・公開期間(from/until)・公開状態(is_active)、
//   そして「場所詳細への転載」ON/OFF（repost_to_detail）。
//   転載OFF: /api/place-events から除外＝場所詳細に出ない。検索(recommend注入)には残る。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";
import { isLikelySamePlace } from "@/lib/normalize-name";   // 重複検出(名前ゆるふわ一致＋座標近接)

// 一覧/編集で扱う列。repost_to_detail は未適用環境(42703)ではフォールバックで外す。
const COLS_BASE = "id, name, address, lat, lng, tags, description, image_urls, photo_url, available_from, available_until, source_type, is_active, created_at";
const COLS_WITH_FLAG = `${COLS_BASE}, repost_to_detail`;

// フォールバック(列有/無で列数が変わる)で同じ変数へ再代入するため、緩い共通型に寄せる。
type Row = Record<string, unknown>;
type SingleRes = { data: Row | null; error: { code?: string; message?: string } | null };
type ListResT = { data: Row[] | null; error: { code?: string; message?: string } | null };

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
// "YYYY-MM-DD" / 空文字→null / それ以外は undefined(=変更しない)。日付列に安全に入れる。
function parseDate(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s === "") return null;
  return YMD_RE.test(s) ? s : undefined;
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const action = String(body?.action ?? "list");

  // ── 一覧: 期間限定(available_from/until のどちらかが入っている)スポットを全部返す ──
  if (action === "list") {
    // 期間限定(available_from/until のどちらかが入った)スポットを全件取得（PostgRESTの
    //   1000件上限を range で跨いで回収）。repost_to_detail 列が未適用(42703)なら列無しで再取得。
    const PAGE = 1000;
    let hasFlag = true;
    const all: Row[] = [];
    for (let offset = 0; offset < 20000; offset += PAGE) {
      const res = (await db.from("places").select(hasFlag ? COLS_WITH_FLAG : COLS_BASE)
        .or("available_from.not.is.null,available_until.not.is.null")
        .order("available_until", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })   // 安定ソート: available_until同着でもrangeページが重複/欠落しない
        .range(offset, offset + PAGE - 1)) as unknown as ListResT;
      if (res.error?.code === "42703" && hasFlag) { hasFlag = false; offset -= PAGE; continue; }  // 列未適用 → 同offsetを列無しで再取得
      if (res.error) return NextResponse.json({ ok: false, error: res.error.message }, { status: 500 });
      const batch = res.data ?? [];
      all.push(...batch);
      if (batch.length < PAGE) break;
    }
    // 保険: 万一ページ境界で重複しても id で一意化（Reactのkey重複＝重複描画を防ぐ）
    const seen = new Set<string>();
    const rows = all.filter((r) => { const id = String((r as { id?: unknown }).id ?? ""); if (!id || seen.has(id)) return false; seen.add(id); return true; })
      .map((r) => ({ ...r, repost_to_detail: hasFlag ? (r as { repost_to_detail?: boolean }).repost_to_detail ?? true : true }));
    // 投稿写真(spot_photos)を place_id で束ねて添付。＠付きMoodログ由来の期間限定スポットは写真が
    //   places.image_urls ではなく spot_photos(Storage)にあるため、これが無いと「No Image」になる。
    const ids = rows.map((r) => String((r as { id?: unknown }).id ?? "")).filter(Boolean);
    const photoMap = new Map<string, string[]>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data: ph } = await db.from("spot_photos")
        .select("place_id, image_url, is_primary, score")
        .in("place_id", ids.slice(i, i + 300))
        .eq("moderation_status", "approved").eq("can_use_as_spot_photo", true)
        .order("is_primary", { ascending: false }).order("score", { ascending: false });
      for (const p of (ph ?? []) as Array<{ place_id: string; image_url: string }>) {
        if (!p.image_url) continue;
        const k = String(p.place_id);
        const arr = photoMap.get(k) ?? [];
        if (arr.length < 10) { arr.push(p.image_url); photoMap.set(k, arr); }
      }
    }
    const rowsWithPhotos = rows.map((r) => ({ ...r, user_photos: photoMap.get(String((r as { id?: unknown }).id ?? "")) ?? [] }));
    return NextResponse.json({ ok: true, spots: rowsWithPhotos, flagReady: hasFlag });
  }

  // ── 重複検出: 期間限定スポットの中から「同じ場所らしい」クラスタ(2件以上)を返す ──────────
  //   名前ゆるふわ一致(表記ゆれ/包含)＋座標近接(≤400m)で束ねる（座標欠損は名前一致で束ねる）。
  //   同じイベントを別々に投稿した二重登録や、表記違いの重複を admin が見つけて統合できるように。
  if (action === "duplicates") {
    const PAGE = 1000; const all: Row[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = (await db.from("places").select(COLS_BASE)
        .or("available_from.not.is.null,available_until.not.is.null")
        .eq("is_active", true)   // 非公開(削除済)は重複候補にしない
        .order("id", { ascending: true }).range(offset, offset + PAGE - 1)) as unknown as ListResT;
      if (res.error) return NextResponse.json({ ok: false, error: res.error.message }, { status: 500 });
      const batch = res.data ?? []; all.push(...batch);
      if (batch.length < PAGE) break;
    }
    type S = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; available_from: string | null; available_until: string | null; tags: string[] };
    const spots: S[] = all.map((r) => ({
      id: String(r.id), name: String(r.name ?? ""), address: (r.address as string) ?? null,
      lat: typeof r.lat === "number" ? r.lat : null, lng: typeof r.lng === "number" ? r.lng : null,
      available_from: (r.available_from as string) ?? null, available_until: (r.available_until as string) ?? null,
      tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    }));
    // 貪欲クラスタリング: 各スポットを既存クラスタの誰かと isLikelySamePlace(名前ゆる一致＋≤400m) で照合。
    const clusters: S[][] = [];
    for (const s of spots) {
      let placed = false;
      for (const c of clusters) {
        if (c.some((m) => isLikelySamePlace(m.name, m.lat, m.lng, s.name, s.lat, s.lng, 400))) { c.push(s); placed = true; break; }
      }
      if (!placed) clusters.push([s]);
    }
    const dupes = clusters.filter((c) => c.length >= 2).sort((a, b) => b.length - a.length);
    return NextResponse.json({ ok: true, clusters: dupes, count: dupes.length });
  }

  // ── 統合: keeper に子データ(写真/Moodログ/評価)を寄せ、dupeIds を非公開(is_active:false)にする ──
  //   期間限定の二重登録を1件にまとめる。写真/口コミが消えないよう place_id を付け替えてから無効化。
  if (action === "merge") {
    const keepId = String(body?.keepId ?? "").trim();
    const dupeIds = Array.isArray(body?.dupeIds)
      ? (body.dupeIds as unknown[]).map((x) => String(x).trim()).filter((x) => x && x !== keepId)
      : [];
    if (!keepId || dupeIds.length === 0) return NextResponse.json({ ok: false, error: "keepId と dupeIds が必要です" }, { status: 400 });
    // 子データの place_id を keeper へ付け替え（写真/Moodログ/評価が消えないように・merge-duplicatesと同じ方針）。
    for (const t of ["place_photos", "spot_photos", "spot_posts", "spot_ratings"]) {
      await db.from(t).update({ place_id: keepId }).in("place_id", dupeIds).then(() => {}, () => {});
    }
    const { error } = await db.from("places").update({ is_active: false }).in("id", dupeIds);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, merged: dupeIds.length, keepId });
  }

  const id = String(body?.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id が必要です" }, { status: 400 });

  // ── 削除(ソフト=is_active:false) / 復活 ──────────────────────────────────
  if (action === "delete" || action === "restore") {
    const { data, error } = await db.from("places").update({ is_active: action === "restore" }).eq("id", id).select(COLS_BASE).maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, spot: data });
  }

  // ── 転載トグルだけの軽量エンドポイント（一覧のスイッチ用）──────────────────
  if (action === "set-repost") {
    const next = body?.repost_to_detail === true;
    const { data, error } = await db.from("places").update({ repost_to_detail: next }).eq("id", id).select(COLS_WITH_FLAG).maybeSingle();
    if (error?.code === "42703") {
      return NextResponse.json({ ok: false, error: "repost_to_detail 列が未適用です。supabase/add-place-repost-flag.sql を適用してください。", needsSql: true }, { status: 409 });
    }
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, spot: data });
  }

  // ── 編集(名前/住所/画像/タグ/期間/転載/公開) ─────────────────────────────
  if (action === "update") {
    const p = (body?.patch ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof p.name === "string" && p.name.trim().length >= 1) patch.name = p.name.trim().slice(0, 200);
    if (typeof p.address === "string") patch.address = p.address.trim().slice(0, 300) || null;
    if (typeof p.description === "string") patch.description = p.description.trim().slice(0, 1000) || null;
    if (Array.isArray(p.tags)) patch.tags = (p.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean).slice(0, 40);
    if (Array.isArray(p.image_urls)) patch.image_urls = (p.image_urls as unknown[]).map((u) => String(u).trim()).filter(Boolean).slice(0, 30);
    const af = parseDate(p.available_from); if (af !== undefined) patch.available_from = af;
    const au = parseDate(p.available_until); if (au !== undefined) patch.available_until = au;
    if (typeof p.is_active === "boolean") patch.is_active = p.is_active;
    const wantsFlag = typeof p.repost_to_detail === "boolean";
    if (wantsFlag) patch.repost_to_detail = p.repost_to_detail;
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: "変更がありません" }, { status: 400 });

    let res = (await db.from("places").update(patch).eq("id", id).select(COLS_WITH_FLAG).maybeSingle()) as unknown as SingleRes;
    // repost_to_detail 列が未適用 → その列だけ外して再試行し、他の編集は通す（要SQLを警告）。
    if (res.error?.code === "42703" && wantsFlag) {
      const { repost_to_detail: _omit, ...rest } = patch as { repost_to_detail?: unknown } & Record<string, unknown>;
      void _omit;
      if (Object.keys(rest).length === 0) {
        return NextResponse.json({ ok: false, error: "repost_to_detail 列が未適用です。supabase/add-place-repost-flag.sql を適用してください。", needsSql: true }, { status: 409 });
      }
      res = (await db.from("places").update(rest).eq("id", id).select(COLS_BASE).maybeSingle()) as unknown as SingleRes;
      if (res.error) return NextResponse.json({ ok: false, error: res.error.message }, { status: 500 });
      return NextResponse.json({ ok: true, spot: res.data, warning: "転載フラグ列(repost_to_detail)が未適用のため、転載ON/OFFは保存されませんでした。SQLを適用してください。", needsSql: true });
    }
    if (res.error) return NextResponse.json({ ok: false, error: res.error.message }, { status: 500 });
    return NextResponse.json({ ok: true, spot: res.data });
  }

  return NextResponse.json({ ok: false, error: "action は list | duplicates | merge | update | delete | restore | set-repost" }, { status: 400 });
}
