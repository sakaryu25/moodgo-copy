// ─── 検索時の「類似ユーザー学習」統計（/api/feedback フルスキャンの内製化）────
// 従来: 検索のたびに自分自身へ HTTP fetch(/api/feedback) → feedback全行フルスキャン＋
//       使わない統計(topPlaces/moodStats等)まで毎回計算していた。
// 変更: 必要列だけを直接1クエリで読み(新しい順・上限付き)、モジュール内キャッシュ(10分)で
//       同一インスタンスの連続検索を0クエリ化。/api/feedback 本体は admin 画面用に温存。
//
// ⚠ データ設計メモ（2026-07-06監査の結論）:
//   feedback.liked_places / map_clicked_places は spot_engagement(イベント毎) と重複記録だが、
//   ここの類似ユーザー集計には「属性(年代/性別/同行者/雰囲気)との結合」が必要で、
//   属性を持つのは feedback 行のみ ＝ この重複は意図的に保持する。
//   エンゲージメント学習(place_mood_affinity経由のlearnScore)とは役割が別。

import type { SupabaseClient } from "@supabase/supabase-js";

type FeedbackRow = {
  mood: string | null;
  age: string | null;
  gender: string | null;
  companion: string | null;
  atmosphere: string | null;
  rating: number | null;
  visited_place: string | null;
  liked_places: string[] | null;
  map_clicked_places: string[] | null;
};

export type SimilarAttrs = {
  mood?: string;
  age?: string;
  gender?: string;
  companion?: string;
  atmosphere?: string;
};

export type SimilarStats = {
  similarEngagedPlaces: { name: string; score: number }[];
  similarGoodVisited: { name: string; avgRating: number | null; goodCount: number }[];
  similarBadVisited: string[];
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_ROWS = 1000;   // 行数が増えてもスキャン量を固定（新しい順に最新1000件）
let cache: { rows: FeedbackRow[]; at: number } | null = null;

async function loadRows(db: SupabaseClient): Promise<FeedbackRow[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const { data, error } = await db
    .from("feedback")
    .select("mood, age, gender, companion, atmosphere, rating, visited_place, liked_places, map_clicked_places")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  cache = { rows: (data ?? []) as FeedbackRow[], at: Date.now() };
  return cache.rows;
}

// /api/feedback GET の類似ユーザー集計と同一のロジック（結果互換）
export async function fetchSimilarStats(db: SupabaseClient, attrs: SimilarAttrs): Promise<SimilarStats> {
  const all = await loadRows(db);
  const { mood, age, gender, companion, atmosphere } = attrs;

  const filterBy = (strictness: "strict" | "medium" | "loose") =>
    all.filter((f) => {
      const moodMatch = !mood || f.mood === mood;
      const ageMatch = !age || f.age === age;
      const genderMatch = !gender || f.gender === gender;
      const companionMatch = !companion || f.companion === companion;
      const atmosphereMatch = !atmosphere || f.atmosphere === atmosphere;
      if (strictness === "strict") return moodMatch && ageMatch && genderMatch && companionMatch && atmosphereMatch;
      if (strictness === "medium") return moodMatch && (ageMatch || genderMatch) && companionMatch;
      return moodMatch;
    });

  let similarFiltered = filterBy("strict");
  if (similarFiltered.length < 3) similarFiltered = filterBy("medium");
  if (similarFiltered.length < 3) similarFiltered = filterBy("loose");

  // ハート(♡=👍評価 weight:2) + マップクリック(weight:1)
  const engageMap = new Map<string, number>();
  for (const f of similarFiltered) {
    for (const place of f.liked_places ?? []) engageMap.set(place, (engageMap.get(place) ?? 0) + 2);
    for (const place of f.map_clicked_places ?? []) engageMap.set(place, (engageMap.get(place) ?? 0) + 1);
  }
  const similarEngagedPlaces = [...engageMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, score]) => ({ name, score }));

  // 類似ユーザーが実際に行って高評価だった場所
  type VisitScore = { scoreSum: number; count: number; goodCount: number; badCount: number };
  const visitScoreMap = new Map<string, VisitScore>();
  for (const f of similarFiltered) {
    if (!f.visited_place) continue;
    const entry = visitScoreMap.get(f.visited_place) ?? { scoreSum: 0, count: 0, goodCount: 0, badCount: 0 };
    entry.count += 1;
    if (f.rating !== null) {
      entry.scoreSum += f.rating;
      if (f.rating >= 4) entry.goodCount += 1;
      if (f.rating <= 2) entry.badCount += 1;
    }
    visitScoreMap.set(f.visited_place, entry);
  }
  const similarGoodVisited = [...visitScoreMap.entries()]
    .map(([name, s]) => ({
      name,
      avgRating: s.count > 0 ? s.scoreSum / s.count : null,
      goodCount: s.goodCount,
    }))
    .filter((p) => (p.avgRating ?? 0) >= 3.5)
    .sort((a, b) => b.goodCount * (b.avgRating ?? 0) - a.goodCount * (a.avgRating ?? 0))
    .slice(0, 8);

  // この気分では合わなかった場所（気分一致を必須に）
  const moodStrictFiltered = mood ? all.filter((f) => f.mood === mood) : similarFiltered;
  type BadScore = { scoreSum: number; count: number; badCount: number };
  const moodBadMap = new Map<string, BadScore>();
  for (const f of moodStrictFiltered) {
    if (!f.visited_place) continue;
    const entry = moodBadMap.get(f.visited_place) ?? { scoreSum: 0, count: 0, badCount: 0 };
    entry.count += 1;
    if (f.rating !== null) {
      entry.scoreSum += f.rating;
      if (f.rating <= 2) entry.badCount += 1;
    }
    moodBadMap.set(f.visited_place, entry);
  }
  const similarBadVisited = [...moodBadMap.entries()]
    .map(([name, s]) => ({ name, avgRating: s.count > 0 ? s.scoreSum / s.count : null, badCount: s.badCount }))
    .filter((p) => (p.avgRating ?? 5) <= 2.5 && p.badCount >= 1)
    .map((p) => p.name)
    .slice(0, 5);

  return { similarEngagedPlaces, similarGoodVisited, similarBadVisited };
}
