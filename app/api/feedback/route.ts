export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

    const insertRow: Record<string, unknown> = {
      mood: body.mood ?? null,
      area: body.area ?? null,
      age: body.age ?? null,
      gender: body.gender ?? null,
      companion: body.companion ?? null,
      atmosphere: body.atmosphere ?? null,
      priority: body.priority ?? null,
      top_recommendations: body.topRecommendations ?? [],
      rating: body.rating ?? null,
      visited_place: body.visitedPlace ?? null,
      liked_places: body.likedPlaces ?? [],
      map_clicked_places: body.mapClickedPlaces ?? [],
      variant: body.variant ?? null,  // G-2: A/Bテスト variant
    };

    let { error } = await supabase.from("feedback").insert(insertRow);

    // G-2: variant カラム未作成時はカラムを除いて再挿入（後方互換）
    if (error && (error.code === "42703" || error.code === "PGRST204")) {
      delete insertRow.variant;
      const retry = await supabase.from("feedback").insert(insertRow);
      error = retry.error;
    }

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("feedback POST error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }
  try {
    const body = await request.json().catch(() => null);
    if (body?.secret !== "moodgoadmin123") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!body?.id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }
    const { error } = await supabase.from("feedback").delete().eq("id", body.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const mood = searchParams.get("mood");
  const age = searchParams.get("age");
  const gender = searchParams.get("gender");
  const companion = searchParams.get("companion");
  const atmosphere = searchParams.get("atmosphere");
  const secret = searchParams.get("secret");
  const mode = searchParams.get("mode");

  // 管理者向け：全フィードバック一覧（訪問データ管理用）
  if (mode === "all" && secret === "moodgoadmin123") {
    const { data, error } = await supabase
      .from("feedback")
      .select("id, mood, area, age, gender, companion, atmosphere, priority, top_recommendations, rating, visited_place, liked_places, map_clicked_places, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
    return NextResponse.json({ ok: true, feedback: data ?? [] });
  }

  try {
    // 全体の基本統計
    const { data: statsData } = await supabase
      .from("feedback")
      .select("rating, visited_place, mood, age, gender, companion, atmosphere, top_recommendations, liked_places, map_clicked_places, created_at");

    const allFeedback = statsData ?? [];
    const totalCount = allFeedback.length;
    const ratedFeedback = allFeedback.filter((f) => f.rating !== null);
    const avgRating =
      ratedFeedback.length > 0
        ? ratedFeedback.reduce((sum, f) => sum + f.rating, 0) / ratedFeedback.length
        : null;

    // ハート or マップクリックされた場所のみをカウント（高評価スポットランキング）
    const placeEngageMap = new Map<string, { heartCount: number; mapCount: number }>();
    for (const f of allFeedback) {
      const liked: string[] = f.liked_places ?? [];
      const mapped: string[] = f.map_clicked_places ?? [];
      for (const place of liked) {
        const entry = placeEngageMap.get(place) ?? { heartCount: 0, mapCount: 0 };
        entry.heartCount += 1;
        placeEngageMap.set(place, entry);
      }
      for (const place of mapped) {
        const entry = placeEngageMap.get(place) ?? { heartCount: 0, mapCount: 0 };
        entry.mapCount += 1;
        placeEngageMap.set(place, entry);
      }
    }

    const topPlaces = [...placeEngageMap.entries()]
      .map(([name, stats]) => ({
        name,
        heartCount: stats.heartCount,
        mapCount: stats.mapCount,
        totalEngagement: stats.heartCount + stats.mapCount,
      }))
      .sort((a, b) => b.totalEngagement - a.totalEngagement)
      .slice(0, 20);

    // 類似ユーザー（mood/age/gender/companion/atmosphereで多段階マッチング）
    // ハートやマップクリックされた場所をエンゲージメントスコアで集計
    const filterFeedback = (strictness: "strict" | "medium" | "loose") => {
      return allFeedback.filter((f) => {
        const moodMatch = !mood || f.mood === mood;
        const ageMatch = !age || f.age === age;
        const genderMatch = !gender || f.gender === gender;
        const companionMatch = !companion || f.companion === companion;
        const atmosphereMatch = !atmosphere || f.atmosphere === atmosphere;
        if (strictness === "strict") return moodMatch && ageMatch && genderMatch && companionMatch && atmosphereMatch;
        if (strictness === "medium") return moodMatch && (ageMatch || genderMatch) && companionMatch;
        return moodMatch;
      });
    };

    // 最も絞り込んだ結果が少なければ段階的に緩める
    let similarFiltered = filterFeedback("strict");
    if (similarFiltered.length < 3) similarFiltered = filterFeedback("medium");
    if (similarFiltered.length < 3) similarFiltered = filterFeedback("loose");

    // ハート(weight:2) + マップクリック(weight:1) でエンゲージメントスコア集計
    const engageMap = new Map<string, number>();
    for (const f of similarFiltered) {
      for (const place of (f.liked_places ?? []) as string[]) {
        engageMap.set(place, (engageMap.get(place) ?? 0) + 2);
      }
      for (const place of (f.map_clicked_places ?? []) as string[]) {
        engageMap.set(place, (engageMap.get(place) ?? 0) + 1);
      }
    }

    const similarEngagedPlaces = [...engageMap.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, score]) => ({ name, score }));

    // 旧形式との互換（top_recommendationsベース、高評価のみ）
    const similarUserPlaces = similarEngagedPlaces.map(p => ({
      name: p.name,
      count: p.score,
      avgRating: null as number | null,
    }));

    // 行き先の集計（全ユーザー・実際に行った場所）
    const visitedPlaces = allFeedback
      .map((f) => f.visited_place)
      .filter(Boolean)
      .reduce((acc: Record<string, number>, place: string) => {
        acc[place] = (acc[place] ?? 0) + 1;
        return acc;
      }, {});

    const topVisited = Object.entries(visitedPlaces)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // 類似ユーザーの「実際に行った場所 × 評価」を紐づけ
    // visited_placeがあるエントリはrating付きで保存されている
    type VisitScore = { scoreSum: number; count: number; goodCount: number; badCount: number };
    const visitScoreMap = new Map<string, VisitScore>();

    for (const f of similarFiltered) {
      if (!f.visited_place) continue;
      const place = f.visited_place as string;
      const entry = visitScoreMap.get(place) ?? { scoreSum: 0, count: 0, goodCount: 0, badCount: 0 };
      entry.count += 1;
      if (f.rating !== null) {
        entry.scoreSum += f.rating;
        if (f.rating >= 4) entry.goodCount += 1;
        if (f.rating <= 2) entry.badCount += 1;
      }
      visitScoreMap.set(place, entry);
    }

    // 類似ユーザーが高評価で訪れた場所（avg rating ≥ 3.5）
    const similarGoodVisited = [...visitScoreMap.entries()]
      .map(([name, s]) => ({
        name,
        avgRating: s.count > 0 ? s.scoreSum / s.count : null,
        goodCount: s.goodCount,
        badCount: s.badCount,
        totalCount: s.count,
      }))
      .filter((p) => (p.avgRating ?? 0) >= 3.5)
      .sort((a, b) => {
        // 高評価数 × 平均評価でソート
        const aScore = a.goodCount * (a.avgRating ?? 0);
        const bScore = b.goodCount * (b.avgRating ?? 0);
        return bScore - aScore;
      })
      .slice(0, 8);

    // 「この気分では合わない」評価の場所（気分コンテキスト限定・場所自体が悪いわけではない）
    // moodが一致するユーザーのフィードバックのみを使用（必ず気分一致を要求）
    const moodStrictFiltered = mood
      ? allFeedback.filter((f) => f.mood === mood)
      : similarFiltered;

    type VisitScore2 = { scoreSum: number; count: number; badCount: number };
    const moodBadMap = new Map<string, VisitScore2>();
    for (const f of moodStrictFiltered) {
      if (!f.visited_place) continue;
      const place = f.visited_place as string;
      const entry = moodBadMap.get(place) ?? { scoreSum: 0, count: 0, badCount: 0 };
      entry.count += 1;
      if (f.rating !== null) {
        entry.scoreSum += f.rating;
        if (f.rating <= 2) entry.badCount += 1;
      }
      moodBadMap.set(place, entry);
    }

    const similarBadVisited = [...moodBadMap.entries()]
      .map(([name, s]) => ({
        name,
        avgRating: s.count > 0 ? s.scoreSum / s.count : null,
        badCount: s.badCount,
      }))
      .filter((p) => (p.avgRating ?? 5) <= 2.5 && p.badCount >= 1)
      .map((p) => p.name)
      .slice(0, 5);

    // 気分別・年代別の評価分布
    const moodStats: Record<string, { count: number; avgRating: number | null }> = {};
    const ageStats: Record<string, { count: number; avgRating: number | null }> = {};

    for (const f of ratedFeedback) {
      if (f.mood) {
        if (!moodStats[f.mood]) moodStats[f.mood] = { count: 0, avgRating: 0 };
        moodStats[f.mood].count += 1;
        moodStats[f.mood].avgRating = ((moodStats[f.mood].avgRating ?? 0) * (moodStats[f.mood].count - 1) + f.rating) / moodStats[f.mood].count;
      }
      if (f.age) {
        if (!ageStats[f.age]) ageStats[f.age] = { count: 0, avgRating: 0 };
        ageStats[f.age].count += 1;
        ageStats[f.age].avgRating = ((ageStats[f.age].avgRating ?? 0) * (ageStats[f.age].count - 1) + f.rating) / ageStats[f.age].count;
      }
    }

    return NextResponse.json({
      ok: true,
      totalCount,
      avgRating,
      topPlaces,
      topVisited,
      similarUserPlaces,
      similarEngagedPlaces,
      similarGoodVisited,
      similarBadVisited,
      similarCount: similarFiltered.length,
      moodStats,
      ageStats,
      recentFeedback: allFeedback.slice(-20).reverse(),
    });
  } catch (e) {
    console.error("feedback GET error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
