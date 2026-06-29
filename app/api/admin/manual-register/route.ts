import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { addUrbanTagIfNeeded } from "@/lib/urban-detector";
import { ALL_PREDEFINED_TAGS } from "@/lib/predefined-tags";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function searchPlace(query: string) {
  const params = new URLSearchParams({ query, language: "ja", key: GOOGLE_API_KEY });
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places error: ${data.status}`);
  }
  return (data.results?.[0] ?? null) as {
    place_id: string; name: string; formatted_address?: string;
    geometry?: { location: { lat: number; lng: number } };
    types?: string[];
  } | null;
}

async function generateTags(name: string, address: string): Promise<string[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return ["#まったりしたい"];
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `スポット情報のタグ付け専門AIです。以下のタグリストからのみ選んでJSON { "tags": [...] }で出力。\n${ALL_PREDEFINED_TAGS.join(", ")}` },
          { role: "user", content: `スポット名: ${name}\n住所: ${address}\n当てはまるタグを全て選んでください。` },
        ],
      }),
    });
    if (!res.ok) return ["#まったりしたい"];
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    const tags: string[] = Array.isArray(parsed.tags) ? parsed.tags : [];
    const validated = tags.filter((t: string) => ALL_PREDEFINED_TAGS.includes(t));
    return validated.length > 0 ? validated : ["#まったりしたい"];
  } catch { return ["#まったりしたい"]; }
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (!GOOGLE_API_KEY) return NextResponse.json({ ok: false, error: "Google APIキー未設定" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const names: string[] = Array.isArray(body.names) ? body.names.filter((n: string) => n.trim()) : [];
  const dryRun: boolean = body.dryRun === true;
  // 管理者が手動で指定した固定タグ（全スポットに強制付与）
  const fixedTags: string[] = Array.isArray(body.fixedTags)
    ? body.fixedTags.map((t: string) => t.trim()).filter((t: string) => t.startsWith("#") && t.length > 1)
    : [];

  if (names.length === 0) return NextResponse.json({ ok: false, error: "names が必要です" }, { status: 400 });

  // 既存スポットを全件取得（Supabase 1000件上限をページネーションで回避）
  // tags も取得して、固定タグ不足の場合に上書きできるようにする
  type ExistingPlace = { id: string; name: string; google_place_id: string | null; tags: string[] | null };
  const existingByPlaceId = new Map<string, ExistingPlace>();
  const existingByName    = new Map<string, ExistingPlace>();
  const batchSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, google_place_id, tags")
      .range(from, from + batchSize - 1);
    if (error || !data || data.length === 0) break;
    for (const p of data) {
      const ep: ExistingPlace = { id: p.id as string, name: p.name as string, google_place_id: p.google_place_id as string | null, tags: p.tags as string[] | null };
      existingByName.set(ep.name.toLowerCase().trim(), ep);
      if (ep.google_place_id) existingByPlaceId.set(ep.google_place_id, ep);
    }
    if (data.length < batchSize) break;
    from += batchSize;
  }

  const results: Array<{ name: string; status: "inserted" | "skipped" | "tag_updated" | "not_found" | "error"; address?: string; tags?: string[]; addedTags?: string[]; error?: string }> = [];
  let inserted = 0, skipped = 0, tagUpdated = 0, notFound = 0;

  for (const query of names) {
    try {
      const place = await searchPlace(query);
      if (!place) { results.push({ name: query, status: "not_found" }); notFound++; continue; }

      const existing = existingByPlaceId.get(place.place_id) ?? existingByName.get(place.name.toLowerCase().trim());
      if (existing) {
        // 既存スポット: 固定タグが指定されていて、かつ不足しているタグがあれば上書き追記
        if (fixedTags.length > 0) {
          const currentTags: string[] = existing.tags ?? [];
          const currentSet = new Set(currentTags);
          const missingTags = fixedTags.filter(t => !currentSet.has(t));
          if (missingTags.length > 0) {
            const updatedTags = [...missingTags, ...currentTags]; // 固定タグを先頭に追加
            if (!dryRun) {
              await supabase.from("places").update({ tags: updatedTags }).eq("id", existing.id);
            }
            results.push({ name: existing.name, status: "tag_updated", address: place.formatted_address, tags: updatedTags, addedTags: missingTags });
            tagUpdated++;
            continue;
          }
        }
        results.push({ name: existing.name, status: "skipped", address: place.formatted_address });
        skipped++;
        continue;
      }

      // 固定タグ(admin入力の#)があれば、それだけを使う。OpenAIの自動タグ付けは一切行わない
      //   （「adminが最初に登録した#のみ」。AIが勝手に#を足すのを防ぐ＝コストも削減）。
      //   固定タグ未指定の時だけ、空登録を避けるため OpenAI にフォールバックする。
      let finalTags: string[];
      if (fixedTags.length > 0) {
        finalTags = fixedTags;
      } else {
        const aiTags = await generateTags(place.name, place.formatted_address ?? "");
        finalTags = addUrbanTagIfNeeded(aiTags, place.geometry?.location.lat ?? 0, place.geometry?.location.lng ?? 0);
      }

      results.push({ name: place.name, status: "inserted", address: place.formatted_address, tags: finalTags });

      // dryRun問わずバッチ内重複を防ぐためにセットを更新
      existingByPlaceId.set(place.place_id, { id: "", name: place.name, google_place_id: place.place_id, tags: finalTags });
      existingByName.set(place.name.toLowerCase().trim(), { id: "", name: place.name, google_place_id: place.place_id, tags: finalTags });

      if (!dryRun) {
        await supabase.from("places").insert({
          name: place.name,
          address: place.formatted_address ?? "",
          lat: place.geometry?.location.lat ?? null,
          lng: place.geometry?.location.lng ?? null,
          google_place_id: place.place_id,
          tags: finalTags,
          description: null,
          is_active: true,
        });
      }
      inserted++;
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      results.push({ name: query, status: "error", error: String(e) });
    }
  }

  return NextResponse.json({ ok: true, dryRun, inserted, skipped, tagUpdated, notFound, results });
}
