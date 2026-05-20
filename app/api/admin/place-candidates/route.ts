// ─── /api/admin/place-candidates ─────────────────────────────────────────────
// 指定エリア周辺のスポットをGoogle Placesで検索し、
// AIでタグを生成して候補リストとして返す（まだSupabaseには登録しない）。
//
// POST body:
//   secret    string   管理者パスワード
//   keyword   string   検索ワード（例: "温泉", "カフェ", "公園"）
//   lat       number   中心緯度（デフォルト: 横浜市金沢区 35.3328）
//   lng       number   中心経度（デフォルト: 139.6236）
//   radiusKm  number   検索半径km（デフォルト: 100）
//   maxCount  number   最大取得件数（デフォルト: 20）

import { NextRequest, NextResponse } from "next/server";
import { ALL_PREDEFINED_TAGS } from "@/lib/predefined-tags";
import { supabase } from "@/lib/supabase";
import { addUrbanTagIfNeeded } from "@/lib/urban-detector";

const ADMIN_PASSWORD = "moodgoadmin123";
const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

// 横浜市金沢区の座標
const DEFAULT_LAT = 35.3328;
const DEFAULT_LNG = 139.6236;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface PlaceCandidate {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  userRatingCount: number | null;
  photoUrls: string[];
  tags: string[];          // AIが生成したタグ
  distanceKm: number;      // 中心からの距離
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildPhotoUrl(ref: string): string {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${ref}&key=${GOOGLE_API_KEY}`;
}

async function generateTagsForSpot(name: string, address: string, description?: string): Promise<string[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return [];

  const systemPrompt = `あなたはスポット情報のタグ付け専門AIです。

【ルール】
1. スポットの特徴を漏れなく表す # タグを全て付けること。タグ数に上限はない。
2. 出力は必ず JSON 形式 { "tags": ["#タグ1", "#タグ2", ...] } のみ。
3. タグは必ず # から始めること。

【タグ付けの方針（漏れなく付けること）】
■ 気分タグ（当てはまるもの全て）
  #お腹すいた, #まったりしたい, #わいわい楽しみたい, #自然感じたい, #ドライブしたい, #集中したい, #体動かしたい, #遠くに行きたい

■ 誰とタグ（行けそうな組み合わせ全て）
  #1人, #友達, #恋人, #家族, #大人数, #先輩

■ 施設・特徴タグ（該当するもの全て。以下は例。これ以外も積極的に付けること）
  温泉系: #温泉, #天然温泉, #銭湯, #大型銭湯, #サウナ, #岩盤浴
  カフェ系: #癒しカフェ, #ブックカフェ, #動物カフェ, #景色良いカフェ, #海辺カフェ, #森林カフェ, #カフェスイーツ, #カフェ作業
  自然系: #自然感じたい, #絶景スポット, #展望台, #海辺, #自然公園, #大型公園, #お散歩
  グルメ系: #ご当地グルメ, #居酒屋, #焼肉, #寿司, #ラーメン, #スイーツ, #バーベキュー
  アクティビティ: #体験型ゲーム, #ガッツリ運動, #スポーツ, #屋外スポーツ, #ボウリング, #カラオケ
  観光系: #パワースポット, #テーマパーク, #水族館, #動物園, #美術館, #博物館
  その他: #無料, #有料駐車場, #無料駐車場, #勉強場, #ショッピング

■ 予算タグ（推測できる場合）
  #無料, #〜3000, #〜5000, #〜10000, #10000〜

【重要】施設名からわかる特徴は必ず全て付けること。
例：「○○温泉センター」→ #温泉 #銭湯 #サウナ #岩盤浴 なども検討する
例：「道の駅○○」→ #ご当地グルメ #ドライブしたい #お散歩 なども検討する`;

  const userMsg = `スポット名: ${name}\n住所: ${address}${description ? `\n説明: ${description}` : ""}\n\nこのスポットの特徴を漏れなく表すタグを全て付けてください。`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const rawTags: string[] = Array.isArray(parsed.tags) ? parsed.tags : [];
    // # から始まるタグのみ残す（フォーマット保証）
    return rawTags.filter(t => typeof t === "string" && t.startsWith("#"));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body?.secret !== ADMIN_PASSWORD) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!GOOGLE_API_KEY) {
      return NextResponse.json({ ok: false, error: "GOOGLE_PLACES_API_KEY が設定されていません" }, { status: 500 });
    }

    const keyword: string = (body.keyword ?? "").trim();
    if (!keyword) {
      return NextResponse.json({ ok: false, error: "keyword は必須です" }, { status: 400 });
    }

    const lat: number = body.lat ?? DEFAULT_LAT;
    const lng: number = body.lng ?? DEFAULT_LNG;
    const radiusKm: number = body.radiusKm ?? 100;
    const maxCount: number = Math.min(body.maxCount ?? 20, 40);

    // ── 1. Google Places Text Search（ページネーション対応）──────────────────
    // 宿泊施設を除外するキーワード（日帰り不可）
    const LODGING_NAME_KEYWORDS = [
      "旅館", "ホテル", "ペンション", "民宿", "ゲストハウス", "ホステル",
      "インン", "宿", "hotel", "inn", "resort", "lodge", "hostel",
    ];
    const LODGING_TYPES = new Set([
      "lodging", "hotel", "motel", "campground", "rv_park",
    ]);

    function isLodging(name: string, types?: string[]): boolean {
      // Google Places の types で判定
      if (types?.some(t => LODGING_TYPES.has(t))) return true;
      // 名前キーワードで判定（大文字小文字・全角半角を無視）
      const lower = name.toLowerCase();
      return LODGING_NAME_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
    }

    const allResults: Array<{
      place_id: string;
      name: string;
      formatted_address?: string;
      geometry?: { location: { lat: number; lng: number } };
      rating?: number;
      user_ratings_total?: number;
      photos?: Array<{ photo_reference: string }>;
      types?: string[];
    }> = [];

    let pageToken: string | undefined;
    let fetchCount = 0;

    while (fetchCount < Math.ceil(maxCount / 20)) {
      const params = new URLSearchParams({
        query: keyword,
        location: `${lat},${lng}`,
        radius: String(Math.min(radiusKm * 1000, 50000)), // 最大50km（Google制限）
        language: "ja",
        key: GOOGLE_API_KEY,
      });
      if (pageToken) params.set("pagetoken", pageToken);

      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        return NextResponse.json({ ok: false, error: `Google Places error: ${data.status}` }, { status: 500 });
      }

      allResults.push(...(data.results ?? []));
      pageToken = data.next_page_token;
      fetchCount++;

      if (!pageToken || allResults.length >= maxCount) break;
      // next_page_token は2秒後に有効になる
      await new Promise(r => setTimeout(r, 2000));
    }

    // ── 2. 距離フィルタ（radiusKm 以内）＆ 重複除去 ＆ 宿泊施設除外 ────────
    const seen = new Set<string>();
    const filtered = allResults.filter(p => {
      if (!p.geometry?.location || !p.place_id) return false;
      if (seen.has(p.place_id)) return false;
      seen.add(p.place_id);
      const dist = haversineKm(lat, lng, p.geometry.location.lat, p.geometry.location.lng);
      if (dist > radiusKm) return false;
      // 宿泊施設（旅館・ホテルなど日帰り不可）を除外
      if (isLodging(p.name, p.types)) return false;
      return true;
    }).slice(0, maxCount);

    // ── 2.5. 既にSupabaseのplacesに登録済みのスポットを除外 ──────────────────
    const placeIds = filtered.map(p => p.place_id).filter(Boolean);
    const names    = filtered.map(p => p.name).filter(Boolean);

    const registeredPlaceIds = new Set<string>();
    const registeredNames    = new Set<string>();

    if (supabase && (placeIds.length > 0 || names.length > 0)) {
      // google_place_id で照合
      if (placeIds.length > 0) {
        const { data: byId } = await supabase
          .from("places")
          .select("google_place_id")
          .in("google_place_id", placeIds);
        for (const row of byId ?? []) {
          if (row.google_place_id) registeredPlaceIds.add(row.google_place_id as string);
        }
      }
      // 名前で照合（大文字小文字・全角半角は問わず lower で比較）
      if (names.length > 0) {
        const { data: byName } = await supabase
          .from("places")
          .select("name")
          .in("name", names);
        for (const row of byName ?? []) {
          if (row.name) registeredNames.add((row.name as string).toLowerCase().trim());
        }
      }
    }

    const unregistered = filtered.filter(p =>
      !registeredPlaceIds.has(p.place_id) &&
      !registeredNames.has(p.name.toLowerCase().trim())
    );

    // ── 3. 各スポットにAIタグ生成 ────────────────────────────────────────────
    const candidates: PlaceCandidate[] = [];

    for (const p of unregistered) {
      const pLat = p.geometry!.location.lat;
      const pLng = p.geometry!.location.lng;
      const distanceKm = haversineKm(lat, lng, pLat, pLng);
      const photoUrls = (p.photos ?? []).slice(0, 3).map(ph => buildPhotoUrl(ph.photo_reference));
      const aiTags = await generateTagsForSpot(p.name, p.formatted_address ?? "", `${keyword}施設`);
      // 都市近傍なら #都市 を自動付与
      const tags = addUrbanTagIfNeeded(aiTags, pLat, pLng);

      candidates.push({
        placeId: p.place_id,
        name: p.name,
        address: p.formatted_address ?? "",
        lat: pLat,
        lng: pLng,
        rating: p.rating ?? null,
        userRatingCount: p.user_ratings_total ?? null,
        photoUrls,
        tags,
        distanceKm: Math.round(distanceKm * 10) / 10,
      });

      // APIレート制限対策
      await new Promise(r => setTimeout(r, 200));
    }

    // 距離順にソート
    candidates.sort((a, b) => a.distanceKm - b.distanceKm);

    const skippedCount = filtered.length - unregistered.length;
    return NextResponse.json({ ok: true, candidates, total: candidates.length, skippedAlreadyRegistered: skippedCount });
  } catch (e) {
    console.error("[/api/admin/place-candidates] error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
