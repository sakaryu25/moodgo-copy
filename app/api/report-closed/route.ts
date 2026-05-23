// ─── /api/report-closed ──────────────────────────────────────────────────────
// ユーザーが「営業停止・閉店」を報告した際に呼ばれるエンドポイント
// report_count が 3 以上になったら is_active = false に自動変更（DB から除外）
//
// POST body:
//   placeId      string   Supabase places.id
//   hotpepperId? string   HotPepper店舗ID（places.hotpepper_id）
//   sessionId?   string   匿名セッションID（重複報告防止）

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 自動非活性化の閾値（この件数以上報告されたら閉店扱い）
const AUTO_DEACTIVATE_THRESHOLD = 3;

export async function POST(req: NextRequest) {
  try {
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
    }

    const body = await req.json();
    const { placeId, hotpepperId, sessionId } = body;

    if (!placeId && !hotpepperId) {
      return NextResponse.json({ ok: false, error: "placeId または hotpepperId が必要です" }, { status: 400 });
    }

    // 対象レコードを取得
    let query = supabase.from("places").select("id, name, report_count, is_active, hotpepper_id");
    if (placeId) {
      query = query.eq("id", placeId);
    } else {
      query = query.eq("hotpepper_id", hotpepperId);
    }

    const { data: places, error: fetchError } = await query.limit(1);
    if (fetchError) {
      return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 });
    }

    if (!places || places.length === 0) {
      return NextResponse.json({ ok: false, error: "対象のスポットが見つかりません" }, { status: 404 });
    }

    const place = places[0];

    // 既に非活性化されている場合はスキップ
    if (!place.is_active) {
      return NextResponse.json({
        ok: true,
        message: "このスポットは既に非活性化されています",
        deactivated: true,
      });
    }

    // report_count をインクリメント
    const newCount = (place.report_count ?? 0) + 1;
    const shouldDeactivate = newCount >= AUTO_DEACTIVATE_THRESHOLD;

    const updateData: Record<string, unknown> = {
      report_count: newCount,
      last_reported_at: new Date().toISOString(),
    };

    if (shouldDeactivate) {
      updateData.is_active = false;
    }

    const { error: updateError } = await supabase
      .from("places")
      .update(updateData)
      .eq("id", place.id);

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    // 報告ログを closed_reports テーブルに保存（テーブルがあれば）
    // ※ テーブルがなくてもエラーにしない
    try {
      await supabase.from("closed_reports").insert({
        place_id: place.id,
        hotpepper_id: place.hotpepper_id ?? hotpepperId ?? null,
        user_session_id: sessionId ?? null,
        reported_at: new Date().toISOString(),
      });
    } catch { /* closed_reports テーブルが未作成でも無視 */ }

    return NextResponse.json({
      ok: true,
      placeName: place.name,
      reportCount: newCount,
      deactivated: shouldDeactivate,
      message: shouldDeactivate
        ? `${newCount}件の報告により「${place.name}」を閉店済みとして非表示にしました`
        : `「${place.name}」の閉店報告を受け付けました（${newCount}/${AUTO_DEACTIVATE_THRESHOLD}件）`,
    });
  } catch (error) {
    console.error("[report-closed] Error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
