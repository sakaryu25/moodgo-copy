export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  ALL_PREDEFINED_TAGS,
  MANUAL_ONLY_TAGS,
  buildFacilityTaggingPrompt,
  TAG_CATEGORIES,
} from "@/lib/predefined-tags";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Google place types → 推奨タグのヒント（ルールベース補助用）
const PLACE_TYPE_HINT_TAGS: Record<string, string[]> = {
  park:                ["#自然感じたい", "#お散歩", "#大型公園"],
  restaurant:          ["#お腹すいた", "#居酒屋"],
  cafe:                ["#癒しカフェ", "#まったりしたい", "#カフェスイーツ"],
  shopping_mall:       ["#ショッピング", "#わいわい楽しみたい"],
  museum:              ["#体験型ゲーム", "#まったりしたい"],
  tourist_attraction:  ["#パワースポット", "#絶景スポット", "#遠くに行きたい"],
  amusement_park:      ["#わいわい楽しみたい", "#アミューズメントパーク", "#テーマパーク"],
  beach:               ["#海辺", "#自然感じたい", "#まったりしたい"],
  spa:                 ["#温泉", "#まったりしたい"],
  natural_feature:     ["#自然感じたい", "#絶景スポット"],
  viewpoint:           ["#絶景スポット", "#展望台", "#まったりしたい"],
  library:             ["#book場", "#勉強場", "#集中したい"],
  gym:                 ["#体動かしたい", "#ガッツリ運動"],
  stadium:             ["#スポーツ", "#体動かしたい", "#わいわい楽しみたい"],
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { spotName, description, placeTypes, placeName, secret } = body;

    if (secret !== ADMIN_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // プレイスタイプからヒントタグを収集（ルールベース）
    const hintTags = Array.from(
      new Set(
        (placeTypes as string[] ?? []).flatMap(
          (t: string) => PLACE_TYPE_HINT_TAGS[t] ?? []
        )
      )
    );

    if (!process.env.OPENAI_API_KEY || !openai) {
      // AI未設定時はルールベースでタグ生成（定義済みリストからのみ）
      const tags = generateRuleBasedPredefinedTags(description ?? "", hintTags);
      return NextResponse.json({ ok: true, tags });
    }
    const ai = openai;

    // ── AI によるタグ選別（定義済みリストから厳格に選択） ──
    const systemPrompt = buildFacilityTaggingPrompt(ALL_PREDEFINED_TAGS);

    const userMessage = `以下のスポット情報から定義済みタグを選んでください。

【スポット名】${spotName ?? "不明"}
【Googleマップ名】${placeName ?? "（なし）"}
【説明文】${description?.trim() || "（説明なし）"}
【施設タイプヒント】${hintTags.join(", ") || "（不明）"}

定義済みタグリストの中から、このスポットに確実に当てはまるタグのみを選んでください。`;

    const response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.1, // 低温度でハルシネーション抑制
      max_tokens: 400,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const rawTags: string[] = Array.isArray(parsed.tags) ? parsed.tags : [];

    // AIが定義済みリスト外のタグを出力した場合は厳格にフィルタ
    const validatedTags = rawTags.filter(tag =>
      ALL_PREDEFINED_TAGS.includes(tag)
    );

    // バリデーション後に空になった場合はルールベースにフォールバック
    const finalTagsRaw = validatedTags.length > 0
      ? validatedTags
      : generateRuleBasedPredefinedTags(description ?? "", hintTags);
    // 手動限定タグ（#心霊スポット）は自動付与しない＝最終出力からも除外
    const finalTags = finalTagsRaw.filter(t => !MANUAL_ONLY_TAGS.includes(t));

    console.log(`[generate-tags] AI出力: ${rawTags.length}件 → バリデーション後: ${validatedTags.length}件`);

    return NextResponse.json({ ok: true, tags: finalTags });
  } catch (e) {
    console.error("[generate-tags] error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

/**
 * AI 未使用時のルールベースタグ生成
 * ヒントタグ + 説明文キーワードから定義済みタグを選択する
 */
function generateRuleBasedPredefinedTags(description: string, hintTags: string[]): string[] {
  const tags = new Set<string>(hintTags);
  const d = description;

  // 誰と
  if (/一人|ソロ|おひとり/i.test(d))              tags.add("#1人");
  if (/デート|カップル|恋人/i.test(d))             tags.add("#恋人");
  if (/家族|子供|子連れ|ファミリー/i.test(d))      tags.add("#家族");
  if (/グループ|団体|大人数/i.test(d))              tags.add("#大人数");
  if (/友達|友人|仲間/i.test(d))                   tags.add("#友達");

  // 予算
  if (/無料|入場無料|タダ/i.test(d))               tags.add("#無料");
  if (/高級|プレミアム|ラグジュアリー/i.test(d))    tags.add("#10000〜");

  // 景観・環境
  if (/海|ビーチ|砂浜|湾|港/i.test(d))            tags.add("#海辺");
  if (/山|森|林|自然|緑|樹/i.test(d))              tags.add("#自然感じたい");
  if (/公園/i.test(d))                             tags.add("#大型公園");
  if (/展望|夜景|パノラマ/i.test(d))               tags.add("#展望台");
  if (/絶景/i.test(d))                             tags.add("#絶景スポット");
  if (/カフェ|コーヒー|喫茶/i.test(d))             tags.add("#癒しカフェ");
  if (/温泉|スパ/i.test(d))                        tags.add("#温泉");
  if (/銭湯/i.test(d))                             tags.add("#温泉");
  if (/サウナ/i.test(d))                           tags.add("#サウナ");
  if (/パワースポット|神社|仏閣|寺/i.test(d))      tags.add("#パワースポット");
  if (/テーマパーク|遊園地/i.test(d))              tags.add("#テーマパーク");
  if (/アミューズメント/i.test(d))                 tags.add("#アミューズメントパーク");

  // アクティビティ
  if (/散歩|ウォーキング|遊歩/i.test(d))           tags.add("#お散歩");
  if (/ショッピング|買い物|モール/i.test(d))        tags.add("#ショッピング");
  if (/読書|図書/i.test(d))                        tags.add("#book場");
  if (/勉強|受験|学習/i.test(d))                   tags.add("#勉強場");
  if (/ハイキング|登山|トレッキング/i.test(d))      tags.add("#屋外スポーツ");
  if (/スポーツ|運動/i.test(d))                    tags.add("#スポーツ");
  if (/体験|ゲーム|アクティビティ/i.test(d))       tags.add("#体験型ゲーム");

  // 飲食
  if (/ラーメン/i.test(d))                         tags.add("#ラーメン");
  if (/焼肉/i.test(d))                             tags.add("#焼肉");
  if (/韓国/i.test(d))                             tags.add("#韓国");
  if (/中華/i.test(d))                             tags.add("#中華");
  if (/スイーツ|ケーキ|パフェ/i.test(d))           tags.add("#カフェスイーツ");
  if (/食べ放題|バイキング|ビュッフェ/i.test(d))    tags.add("#食べ放題");
  if (/居酒屋|飲み屋/i.test(d))                    tags.add("#居酒屋");
  if (/うどん|そば/i.test(d))                      tags.add("#うどんそば");

  // 最終バリデーション（念のため定義済みリスト照合）
  const validTags = Array.from(tags).filter(t => ALL_PREDEFINED_TAGS.includes(t));

  return validTags.slice(0, 15);
}

/**
 * カテゴリ情報付きでタグリストを返す（管理画面向け）
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    categories: TAG_CATEGORIES.map(c => ({ key: c.key, label: c.label, tags: c.tags })),
    allTags: ALL_PREDEFINED_TAGS,
  });
}
