// ─── /api/admin/places-migrate ───────────────────────────────────────────────
// suggestions テーブルの承認済みスポット(approved)を
// places + place_photos テーブルに一括移行するエンドポイント。
//
// POST body:
//   secret   string   管理者パスワード
//   force    boolean  true: 同名スポットも上書き登録（デフォルト false = スキップ）

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const ADMIN_PASSWORD = "moodgoadmin123";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SuggestionRow {
  id: string;
  spot_name: string;
  description: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
  auto_tags: string[] | null;
  image_urls: string[] | null;
  station_info: string | null;
  status: string;
  source: string | null;
}

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const body = await req.json();
    if (body?.secret !== ADMIN_PASSWORD) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const force: boolean = body?.force ?? false;

    // ── 1. 承認済み + 管理者追加スポットを全て取得 ───────────────────────
    let suggestions: SuggestionRow[] = [];
    {
      const { data, error } = await supabase
        .from("suggestions")
        .select("id, spot_name, description, address, lat, lng, google_place_id, auto_tags, image_urls, station_info, status, source")
        .or("status.eq.approved,source.eq.admin")
        .order("created_at", { ascending: true });
      if (error) throw error;
      // 重複除去（source=admin かつ approved なスポットが2回入らないよう）
      const seen = new Set<string>();
      suggestions = ((data ?? []) as SuggestionRow[]).filter(s => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
    }

    // ── 2. 既に places に登録済みの名前一覧を取得 ────────────────────────────
    const { data: existingPlaces } = await supabase
      .from("places")
      .select("id, name");
    const existingNames = new Map<string, string>(); // name.lower → id
    for (const p of existingPlaces ?? []) {
      existingNames.set((p.name as string).toLowerCase().trim(), p.id as string);
    }

    // ── 3. 移行処理 ───────────────────────────────────────────────────────────
    let registered = 0;
    let skipped = 0;
    let failed = 0;
    const skippedNames: string[] = [];
    const failedNames: string[] = [];

    for (const s of suggestions) {
      const nameLower = s.spot_name.toLowerCase().trim();
      const tags = (s.auto_tags ?? []).filter(t => typeof t === "string" && t.startsWith("#"));

      // タグが無い場合はスキップ（places に入れても検索できないため）
      if (tags.length === 0) {
        skipped++;
        skippedNames.push(`${s.spot_name}（タグなし）`);
        continue;
      }

      // 既存チェック
      const existingId = existingNames.get(nameLower);
      if (existingId && !force) {
        skipped++;
        skippedNames.push(`${s.spot_name}（既に登録済み）`);
        continue;
      }

      try {
        const payload = {
          name:            s.spot_name.trim(),
          address:         s.address?.trim() || null,
          nearest_station: s.station_info?.trim() || null,
          lat:             s.lat ?? null,
          lng:             s.lng ?? null,
          google_place_id: s.google_place_id || null,
          tags,
          area:            null,
          description:     s.description?.trim() || null,
          is_active:       true,
        };

        if (existingId && force) {
          // 上書き更新
          const { error } = await supabase
            .from("places")
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq("id", existingId);
          if (error) throw error;

          // 写真を追記
          if ((s.image_urls ?? []).length > 0) {
            await supabase.from("place_photos").delete().eq("place_id", existingId);
            const photoRows = (s.image_urls ?? [])
              .filter(u => !!u)
              .map((url, i) => ({ place_id: existingId, photo_url: url, is_primary: i === 0 }));
            if (photoRows.length > 0) {
              await supabase.from("place_photos").insert(photoRows);
            }
          }
        } else {
          // 新規登録
          const { data: inserted, error } = await supabase
            .from("places")
            .insert(payload)
            .select("id")
            .single();
          if (error) throw error;

          const newId = inserted.id as string;
          existingNames.set(nameLower, newId); // 重複防止のために登録

          if ((s.image_urls ?? []).length > 0) {
            const photoRows = (s.image_urls ?? [])
              .filter(u => !!u)
              .map((url, i) => ({ place_id: newId, photo_url: url, is_primary: i === 0 }));
            if (photoRows.length > 0) {
              await supabase.from("place_photos").insert(photoRows);
            }
          }
        }

        registered++;
      } catch (e) {
        failed++;
        failedNames.push(`${s.spot_name}（${e instanceof Error ? e.message : String(e)}）`);
      }
    }

    return NextResponse.json({
      ok: true,
      total:     suggestions.length,
      registered,
      skipped,
      failed,
      skippedNames,
      failedNames,
    });
  } catch (e) {
    console.error("[/api/admin/places-migrate] error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
