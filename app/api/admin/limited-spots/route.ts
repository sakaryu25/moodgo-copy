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
    return NextResponse.json({ ok: true, spots: rows, flagReady: hasFlag });
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

  return NextResponse.json({ ok: false, error: "action は list | update | delete | restore | set-repost" }, { status: 400 });
}
