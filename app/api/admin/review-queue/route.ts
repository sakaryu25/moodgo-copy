export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN_SECRET = "moodgoadmin123";

// C-2: AIタグ検証キュー
// GET  — 未レビュー(tags_reviewed=false)のスポット一覧を返す
// POST — スポットを承認(tags_reviewed=true)、必要ならタグも修正

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  const limit = Math.min(Number(searchParams.get("limit") ?? 30), 100);

  try {
    // tags_reviewed カラムでフィルタ。カラム未作成の場合はフォールバックで全件先頭を返す。
    let { data, error } = await supabase
      .from("places")
      .select("id, name, address, tags, image_url, rating, review_count")
      .eq("is_active", true)
      .eq("tags_reviewed", false)
      .limit(limit);

    // カラム未作成(42703) → フォールバック（レビューフラグなしで先頭を返す）
    let columnMissing = false;
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      columnMissing = true;
      const fb = await supabase
        .from("places")
        .select("id, name, address, tags, image_url, rating, review_count")
        .eq("is_active", true)
        .limit(limit);
      data = fb.data;
      error = fb.error;
    }

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      data: data ?? [],
      columnMissing,
      hint: columnMissing
        ? "tags_reviewed カラムが未作成です。承認状態を保存するには次のSQLを実行してください: ALTER TABLE places ADD COLUMN tags_reviewed boolean DEFAULT false;"
        : "",
    });
  } catch (e) {
    console.error("review-queue GET error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || body.secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  const id = String(body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "id が必要です" }, { status: 400 });
  }

  try {
    const update: Record<string, unknown> = { tags_reviewed: true };

    // タグ修正がある場合は同時に保存
    if (Array.isArray(body.tags)) {
      const cleanTags = (body.tags as unknown[])
        .map(t => String(t).trim())
        .filter(t => t.startsWith("#") && t.length > 1);
      update.tags = cleanTags;
    }

    let { error } = await supabase.from("places").update(update).eq("id", id);

    // tags_reviewed カラム未作成時はタグのみ更新（承認状態は保存できない）
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      if (Array.isArray(body.tags)) {
        const cleanTags = (body.tags as unknown[])
          .map(t => String(t).trim())
          .filter(t => t.startsWith("#") && t.length > 1);
        const r2 = await supabase.from("places").update({ tags: cleanTags }).eq("id", id);
        error = r2.error;
      } else {
        error = null; // 承認のみで変更なし → 成功扱い（カラムが無いだけ）
      }
    }

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("review-queue POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
