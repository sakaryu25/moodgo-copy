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

    // ── 迷惑報告対策（#9・必須）─────────────────────────────────────────────────
    // sessionId を必須化し、closed_reports の「異なるセッション数」で非活性化を判定する。
    // ① 同一セッションの重複報告はカウントしない（1人が連打しても1票）
    // ② 異なる 3 セッション以上が報告した場合のみ非活性化する
    //   → 単独ユーザーの悪意ある連投でスポットが消える事故を防ぐ。
    const safeSession = (typeof sessionId === "string" && sessionId.trim()) ? sessionId.trim() : "";
    if (!safeSession) {
      return NextResponse.json({ ok: false, error: "sessionId が必要です（迷惑報告対策）" }, { status: 400 });
    }

    let distinctSessions = 0;
    let alreadyReportedBySession = false;
    let closedReportsAvailable = true;
    try {
      const { data: existing, error: exErr } = await supabase
        .from("closed_reports")
        .select("user_session_id")
        .eq("place_id", place.id);
      if (exErr) {
        closedReportsAvailable = false;
      } else {
        const sessions = new Set(
          (existing ?? [])
            .map((r: { user_session_id: string | null }) => r.user_session_id)
            .filter(Boolean) as string[]
        );
        alreadyReportedBySession = sessions.has(safeSession);
        distinctSessions = sessions.size;
      }
    } catch {
      closedReportsAvailable = false;
    }

    // 同一セッションが既に報告済み → カウントせず受付のみ返す（連投無効化）
    if (closedReportsAvailable && alreadyReportedBySession) {
      return NextResponse.json({
        ok: true,
        placeName: place.name,
        alreadyReported: true,
        message: "この端末からは既に報告済みです（重複報告は無効）",
      });
    }

    // 今回の報告を closed_reports に記録（新規セッションのみ加算）
    if (closedReportsAvailable) {
      try {
        await supabase.from("closed_reports").insert({
          place_id: place.id,
          hotpepper_id: place.hotpepper_id ?? hotpepperId ?? null,
          user_session_id: safeSession,
          reported_at: new Date().toISOString(),
        });
        distinctSessions += 1;
      } catch {
        closedReportsAvailable = false;
      }
    }

    // 非活性化判定: closed_reports があれば「異なるセッション数」、無ければ従来の report_count
    const newCount = (place.report_count ?? 0) + 1;
    const effectiveCount = closedReportsAvailable ? distinctSessions : newCount;
    const shouldDeactivate = effectiveCount >= AUTO_DEACTIVATE_THRESHOLD;

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

    return NextResponse.json({
      ok: true,
      placeName: place.name,
      reportCount: effectiveCount,
      distinctSessions: closedReportsAvailable ? distinctSessions : undefined,
      deactivated: shouldDeactivate,
      message: shouldDeactivate
        ? `${effectiveCount}人の報告により「${place.name}」を閉店済みとして非表示にしました`
        : `「${place.name}」の閉店報告を受け付けました（${effectiveCount}/${AUTO_DEACTIVATE_THRESHOLD}人）`,
    });
  } catch (error) {
    console.error("[report-closed] Error:", error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
