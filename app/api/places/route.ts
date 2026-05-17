// ─── /api/places ──────────────────────────────────────────────────────────────
// Supabase 優先のスポット検索エンドポイント
// お腹すいた / 任意のタグ検索で使用。見つからない場合は空配列を返し、
// 呼び出し元（page.tsx）が既存の /api/recommend にフォールバックする。
//
// POST body:
//   genreAnswer   string   食べたいジャンル選択肢テキスト（例: "居酒屋🍺"）
//   subAnswer     string   サブ選択肢テキスト（例: "焼き鳥・串焼きメイン🍡"）
//   lat           number   現在地緯度
//   lng           number   現在地経度
//   radiusKm      number?  検索半径km（デフォルト: 10）
//   transport     string | string[]?
//   companion     string?
//   budget        number?
//   area          string?  エリア名（テキスト表示用）
//   mustTags      string[]? ジャンル以外のカスタムタグ（非食事パスから呼び出す場合）
//   limit         number?  最大件数（デフォルト: 20）

import { NextRequest, NextResponse } from "next/server";
import { buildFoodSearchTags } from "@/lib/food-tag-map";
import { searchPlacesByTags } from "@/lib/supabase-places";
import { calcRadiusKm } from "@/lib/calc-radius";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      genreAnswer  = "",
      subAnswer    = "",
      lat          = 0,
      lng          = 0,
      radiusKm: bodyRadiusKm = 10,
      transport    = "",
      limit        = 20,
      mustTags: customMustTags,
      time,
      companion,
      budget,
      freeWord,
      minRadiusKm,
      preferFar,
      prefecture,
    }: {
      genreAnswer?: string;
      subAnswer?:   string;
      lat?:         number;
      lng?:         number;
      radiusKm?:    number;
      transport?:   string | string[];
      limit?:       number;
      mustTags?:    string[];
      time?:        string;
      companion?:   string;
      budget?:      number;
      freeWord?:    string;
      minRadiusKm?: number;
      preferFar?:   boolean;
      prefecture?:  string;
    } = body;

    // time + transport が揃っている場合は calcRadiusKm で上書き
    const transportArr = Array.isArray(transport) ? transport : (transport ? [transport] : []);
    const radiusKm = (time && transportArr.length > 0)
      ? calcRadiusKm(transportArr, time)
      : bodyRadiusKm;

    if (freeWord) console.log(`[/api/places] freeWord="${freeWord}"`);

    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

    // タグ構築
    let mustTags: string[];
    let fallbackTags: string[];

    if (customMustTags && customMustTags.length > 0) {
      // カスタムタグが渡された場合はそのまま使用
      mustTags     = customMustTags;
      fallbackTags = customMustTags;
    } else {
      // food_genre_new / food_sub_choice から自動構築
      const tags = buildFoodSearchTags(genreAnswer, subAnswer);
      mustTags     = tags.mustTags;
      fallbackTags = tags.fallbackTags;
    }

    if (mustTags.length === 0) {
      return NextResponse.json({ ok: true, data: [], count: 0 });
    }

    const results = await searchPlacesByTags({
      mustTags,
      fallbackTags,
      lat,
      lng,
      radiusKm,
      transport,
      limit,
      googleApiKey,
      companion,
      budget,
      minRadiusKm,
      preferFar,
      prefecture,
    });

    return NextResponse.json({
      ok:    true,
      data:  results,
      count: results.length,
      tags:  mustTags,
    });
  } catch (err) {
    console.error("[/api/places] error:", err);
    return NextResponse.json(
      { ok: false, error: "スポット検索に失敗しました", data: [] },
      { status: 500 },
    );
  }
}
