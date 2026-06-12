// ─── /api/mood-rating ────────────────────────────────────────────────────────
// 気分別のスポット評価（合う/合わない）を記録・集計するエンドポイント。
//
// POST body:
//   place_name  string   スポット名
//   mood        string   気分（例: "まったりしたい"）
//   verdict     string   "good" | "bad"
//
// GET (admin):
//   ?secret=moodgoadmin123  → 全集計データを返す
//   ?secret=...&threshold=20 → 合わない件数がthreshold以上のみ

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_SECRET = "moodgoadmin123";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { place_name, mood, sub_category, verdict } = body;

    if (!place_name || !verdict) {
      return NextResponse.json({ ok: false, error: "place_name と verdict は必須です" }, { status: 400 });
    }
    if (verdict !== "good" && verdict !== "bad") {
      return NextResponse.json({ ok: false, error: "verdict は good または bad のみ有効です" }, { status: 400 });
    }

    if (!supabase) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const { error } = await supabase
      .from("mood_place_ratings")
      .insert({ place_name, mood: mood ?? null, sub_category: sub_category ?? null, verdict });

    // ── ④ 成功事例のDB還元: 👍が付いたスポットを気分タグ付きで places に保存 ──
    //   AI提案(freeWord/AI相談)由来の当たりスポットも、これで構造化検索の資産になる。
    //   fire-and-forget（失敗しても評価記録には影響しない）
    if (verdict === "good" && mood) {
      // ※ Vercelサーバーレスはレスポンス返却後に凍結されるため、fire-and-forgetではなく
      //   レスポンス前にawaitする（Google1回+insert=数百msなので体感影響なし）
      await (async () => {
        try {
          const { MOOD_SHORT_KEY_TO_TAG } = await import("@/lib/predefined-tags");
          const moodTag = (MOOD_SHORT_KEY_TO_TAG as Record<string, string>)[mood]
            ?? (mood.startsWith("#") ? mood : undefined);
          const gKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
          if (!moodTag || !gKey) return;
          const gr = await fetch("https://places.googleapis.com/v1/places:searchText", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": gKey,
              "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount",
            },
            body: JSON.stringify({ textQuery: place_name, languageCode: "ja", regionCode: "JP", pageSize: 1 }),
            signal: AbortSignal.timeout(7000),
          });
          const gd = await gr.json().catch(() => null);
          const pl = gd?.places?.[0];
          if (!pl?.id || typeof pl.location?.latitude !== "number") return;
          const { scheduleGenericAutoSave } = await import("@/lib/google-places-auto-save");
          scheduleGenericAutoSave(
            [{
              googlePlaceId: String(pl.id),
              name: pl.displayName?.text ?? place_name,
              address: pl.formattedAddress ?? "",
              lat: pl.location.latitude,
              lng: pl.location.longitude,
              photoUrl: null,
              rating: typeof pl.rating === "number" ? pl.rating : null,
              openNow: null,
            }],
            [moodTag, ...(sub_category ? [`#${String(sub_category).replace(/^#/, "")}`] : [])],
          );
        } catch { /* 還元失敗は無視 */ }
      })();
    }

    if (error) {
      // テーブル未作成の場合はスキップ（エラーにしない）
      console.warn("[mood-rating] insert skipped:", error.message);
      return NextResponse.json({ ok: true, skipped: true });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[mood-rating] POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  const threshold = Number(searchParams.get("threshold") ?? "0");

  if (secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 500 });
  }

  try {
    // place_name + mood + sub_category 別に good/bad 件数を集計
    const { data, error } = await supabase
      .from("mood_place_ratings")
      .select("place_name, mood, sub_category, verdict, created_at");

    if (error) throw error;

    // クライアント側で集計（Supabase RLS でグループ集計できない場合の対応）
    const map: Record<string, { place_name: string; mood: string; sub_category: string; good: number; bad: number; last_bad_at: string }> = {};

    for (const row of data ?? []) {
      const key = `${row.place_name}||${row.mood ?? ""}||${row.sub_category ?? ""}`;
      if (!map[key]) {
        map[key] = { place_name: row.place_name, mood: row.mood ?? "", sub_category: row.sub_category ?? "", good: 0, bad: 0, last_bad_at: "" };
      }
      if (row.verdict === "good") map[key].good++;
      if (row.verdict === "bad") {
        map[key].bad++;
        if (!map[key].last_bad_at || row.created_at > map[key].last_bad_at) {
          map[key].last_bad_at = row.created_at;
        }
      }
    }

    let results = Object.values(map)
      .sort((a, b) => b.bad - a.bad); // 合わない件数降順

    if (threshold > 0) {
      results = results.filter(r => r.bad >= threshold);
    }

    return NextResponse.json({ ok: true, data: results, total: results.length });
  } catch (e) {
    console.error("[mood-rating] GET error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
