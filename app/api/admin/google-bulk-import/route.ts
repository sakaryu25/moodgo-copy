// ─── /api/admin/google-bulk-import ───────────────────────────────────────────
// Google Places API で 1都市×1キーワード を検索し、
// AIタグ付けして Supabase に自動登録する。
// フロントエンドが都市×キーワードの組み合わせ分だけ順番に呼ぶ。
//
// POST body:
//   secret    string   管理者パスワード
//   cityName  string   都市名（例: "新宿"）
//   lat       number   中心緯度
//   lng       number   中心経度
//   radiusKm  number   検索半径km
//   keyword   string   検索キーワード（例: "カフェ"）
//   dryRun    boolean  trueの場合はDBに書き込まない

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { addUrbanTagIfNeeded } from "@/lib/urban-detector";
import { ALL_PREDEFINED_TAGS } from "@/lib/predefined-tags";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── 宿泊施設除外 ──────────────────────────────────────────────────────────────
const LODGING_KEYWORDS = ["旅館", "ホテル", "ペンション", "民宿", "ゲストハウス", "ホステル", "宿", "hotel", "inn", "resort", "lodge"];
const LODGING_TYPES    = new Set(["lodging", "hotel", "motel", "campground"]);
function isLodging(name: string, types?: string[]): boolean {
  if (types?.some(t => LODGING_TYPES.has(t))) return true;
  const lower = name.toLowerCase();
  return LODGING_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

// ── キーワードとスポットの関連性チェック ─────────────────────────────────────
function isRelevantToKeyword(name: string, types: string[], keyword: string): boolean {
  const nm  = name.toLowerCase();
  const kw  = keyword;
  const foodTypes = new Set(["restaurant", "food", "meal_takeaway", "meal_delivery", "bakery", "bar", "cafe"]);

  // 食事場所は全キーワードで除外（居酒屋・レストランキーワード以外）
  if (!/居酒屋|レストラン|グルメ|ランチ|ディナー|カフェ|スイーツ/.test(kw)) {
    if (types.some(t => ["restaurant", "food", "meal_takeaway", "meal_delivery", "bakery"].includes(t))) return false;
    if (/レストラン|食堂|定食|ラーメン|そば|うどん|寿司|焼肉|居酒屋|ダイニング|キッチン|ビストロ|izakaya/i.test(nm)) return false;
  }

  // 企業・法人系を全キーワードで除外
  if (/株式会社|有限会社|合同会社|一般社団法人|公益財団法人|財団法人|社団法人|医療法人|学校法人|宗教法人|NPO法人|事務所|オフィス|本社|支社|営業所/.test(nm)) return false;

  // 駐車場・インフラ系を全キーワードで除外
  if (/駐車場|パーキング|コインパーキング|月極|タイムズ|リパーク|エコロパーク|バス停|バスターミナル|案内所|インフォメーション/.test(nm)) return false;

  // ポケットパーク・小規模施設（地名＋ポケットパークのような単なる休憩所）を除外
  if (/ポケットパーク|詣所|詣り所/.test(nm) && !/公園|神社|寺/.test(nm)) return false;

  // 街道・通り・道路（ショッピング街道以外）を除外
  if (/街道|通り$|〜通り/.test(nm) && !/商店街|ショッピング|アーケード/.test(nm)) return false;

  // バー・スナック系を全キーワードで除外
  if (/バー|スナック|クラブ|ナイトクラブ|ラウンジ/i.test(nm) && types.some(t => ["bar", "night_club"].includes(t))) return false;

  // 動物カフェ・猫カフェ・犬カフェ: カフェ名義でないものを除外
  if (/動物カフェ|猫カフェ|犬カフェ/.test(kw)) {
    if (/ドッグラン|ペットショップ|トリミング|ブリーダー|動物病院|ペットホテル/.test(nm)) return false;
    if (!/カフェ|cafe/i.test(nm) && !types.includes("cafe")) return false;
  }

  // 海辺・ビーチ・景勝地: 飲食店・ショップを除外、海関連の名前か自然スポット系のみ
  if (/海辺|ビーチ|海岸|景勝地/.test(kw)) {
    if (types.some(t => foodTypes.has(t))) return false;
    if (types.includes("store") || types.includes("shopping_mall")) return false;
    const hasSeaName = /海|浜|ビーチ|beach|coast|湾|岬|砂浜|灯台/.test(nm);
    const hasNatureType = types.some(t => ["natural_feature", "park", "tourist_attraction", "point_of_interest"].includes(t));
    if (!hasSeaName && !hasNatureType) return false;
  }

  // 絶景スポット・ドライブスポット・山頂: 飲食店・ショップを除外
  if (/絶景|ドライブスポット|山頂|自然スポット/.test(kw)) {
    if (types.some(t => foodTypes.has(t))) return false;
    if (types.includes("store") || types.includes("shopping_mall")) return false;
  }

  // 展望台: 展望台・タワー系の名前のみ
  if (/展望台/.test(kw)) {
    if (types.some(t => foodTypes.has(t))) return false;
    const hasViewName = /展望台|展望|タワー|tower|observatory|スカイ|sky/.test(nm);
    const hasViewType = types.some(t => ["tourist_attraction", "point_of_interest", "establishment"].includes(t));
    if (!hasViewName && !hasViewType) return false;
  }

  // ボウリング場: ボウリング関連の名前のみ
  if (/ボウリング場/.test(kw)) {
    if (!/ボウリング|bowling|ラウンドワン/i.test(nm)) return false;
  }

  return true;
}

// ── 施設内の子スポット（〇〇内）検出 ─────────────────────────────────────────
// 住所に「〇〇パーク内」「〇〇ランド内」などが含まれる場合は子施設として除外
function isSubFacility(address: string): boolean {
  // 商業・エンタメ系の大型施設に限定して「〇〇内」を検出
  // 公園・センター等の公共施設は除外（独立スポットとして有効なため）
  return /[ァ-ヶー一-龥々]{2,}(シーパラダイス|ハイランド|アミューズメントパーク|テーマパーク|遊園地|アウトレット|ショッピングモール|ゆめタウン|イオンモール|サファリパーク|マリンパーク|アドベンチャーワールド)内/.test(address);
}

// ── Google Places Text Search ─────────────────────────────────────────────────
async function searchPlaces(keyword: string, lat: number, lng: number, radiusKm: number) {
  const params = new URLSearchParams({
    query: keyword,
    location: `${lat},${lng}`,
    radius: String(Math.min(radiusKm * 1000, 50000)),
    language: "ja",
    key: GOOGLE_API_KEY,
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
  const data = await res.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places error: ${data.status} ${data.error_message ?? ""}`);
  }
  return (data.results ?? []) as Array<{
    place_id: string;
    name: string;
    formatted_address?: string;
    geometry?: { location: { lat: number; lng: number } };
    rating?: number;
    user_ratings_total?: number;
    photos?: Array<{ photo_reference: string }>;
    types?: string[];
  }>;
}

// ── AIタグ生成 ────────────────────────────────────────────────────────────────
async function generateTags(name: string, address: string, keyword: string): Promise<string[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return ruleBasedTags(name, keyword);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `スポット情報のタグ付け専門AIです。
【ルール】
1. 以下の定義済みタグリストの中からのみ選ぶこと。
2. 当てはまるタグを全て付けること（上限なし）。
3. JSON { "tags": ["#タグ1", ...] } のみ出力。
【定義済みタグリスト】
${ALL_PREDEFINED_TAGS.join(", ")}`,
          },
          {
            role: "user",
            content: `スポット名: ${name}\n住所: ${address}\nカテゴリ: ${keyword}\n\n当てはまるタグを全て選んでください。気分タグ・誰とタグも積極的に。`,
          },
        ],
      }),
    });
    if (!res.ok) return ruleBasedTags(name, keyword);
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    const tags: string[] = Array.isArray(parsed.tags) ? parsed.tags : [];
    const validated = tags.filter(t => ALL_PREDEFINED_TAGS.includes(t));
    return validated.length > 0 ? validated : ruleBasedTags(name, keyword);
  } catch {
    return ruleBasedTags(name, keyword);
  }
}

// ── ルールベースタグ（AI失敗時のフォールバック）──────────────────────────────
function ruleBasedTags(name: string, keyword: string): string[] {
  const tags = new Set<string>();
  const kw = keyword.toLowerCase();
  const nm = name.toLowerCase();

  if (/カフェ|cafe|coffee/i.test(kw) || /カフェ|cafe/i.test(nm)) {
    tags.add("#癒しカフェ"); tags.add("#まったりしたい"); tags.add("#1人"); tags.add("#恋人"); tags.add("#友達");
  }
  if (/公園|park/i.test(kw) || /公園/i.test(nm)) {
    tags.add("#大型公園"); tags.add("#自然感じたい"); tags.add("#お散歩"); tags.add("#まったりしたい"); tags.add("#無料");
  }
  if (/温泉|onsen|スパ|spa/i.test(kw) || /温泉|スパ/i.test(nm)) {
    tags.add("#温泉"); tags.add("#まったりしたい"); tags.add("#恋人"); tags.add("#友達");
  }
  if (/銭湯/i.test(kw) || /銭湯/i.test(nm)) {
    tags.add("#温泉"); tags.add("#まったりしたい"); tags.add("#1人");
  }
  if (/サウナ/i.test(kw) || /サウナ/i.test(nm)) {
    tags.add("#サウナ"); tags.add("#まったりしたい");
  }
  if (/居酒屋|バー|bar/i.test(kw) || /居酒屋/i.test(nm)) {
    tags.add("#居酒屋"); tags.add("#お腹すいた"); tags.add("#わいわい楽しみたい"); tags.add("#友達"); tags.add("#大人数");
  }
  if (/レストラン|restaurant|グルメ/i.test(kw)) {
    tags.add("#お腹すいた"); tags.add("#まったりしたい");
  }
  if (/神社|shrine|寺|temple/i.test(kw) || /神社|寺|shrine/i.test(nm)) {
    tags.add("#パワースポット"); tags.add("#まったりしたい"); tags.add("#お散歩");
  }
  if (/展望台|展望|viewpoint/i.test(kw) || /展望/i.test(nm)) {
    tags.add("#絶景スポット"); tags.add("#展望台"); tags.add("#まったりしたい");
  }
  if (/水族館|aquarium/i.test(kw) || /水族館/i.test(nm)) {
    tags.add("#水族館"); tags.add("#わいわい楽しみたい"); tags.add("#家族"); tags.add("#恋人");
  }
  if (/動物園|zoo/i.test(kw) || /動物園/i.test(nm)) {
    tags.add("#動物園"); tags.add("#わいわい楽しみたい"); tags.add("#家族");
  }
  if (/美術館|museum|博物館/i.test(kw) || /美術館|博物館/i.test(nm)) {
    tags.add("#美術館"); tags.add("#まったりしたい"); tags.add("#1人"); tags.add("#恋人");
  }
  if (/テーマパーク|遊園地|amusement/i.test(kw) || /テーマパーク|遊園地/i.test(nm)) {
    tags.add("#テーマパーク"); tags.add("#わいわい楽しみたい"); tags.add("#家族");
  }
  if (/ビーチ|海|beach/i.test(kw) || /海|浜|ビーチ/i.test(nm)) {
    tags.add("#海辺"); tags.add("#自然感じたい"); tags.add("#まったりしたい");
  }
  if (/ジム|フィットネス|gym|fitness/i.test(kw) || /ジム|フィットネス/i.test(nm)) {
    tags.add("#体動かしたい"); tags.add("#ガッツリ運動");
  }
  if (/ボウリング|bowling|ラウンドワン/i.test(kw) || /ボウリング|ラウンドワン/i.test(nm)) {
    tags.add("#ボウリング"); tags.add("#わいわい楽しみたい"); tags.add("#友達"); tags.add("#大人数");
  }
  if (/カラオケ|karaoke|ビッグエコー|ジョイサウンド|まねきねこ|バンバン|シダックス/i.test(kw) || /カラオケ|ビッグエコー|ジョイサウンド|まねきねこ/i.test(nm)) {
    tags.add("#カラオケ"); tags.add("#わいわい楽しみたい"); tags.add("#友達"); tags.add("#大人数");
  }
  if (/猫カフェ|ねこカフェ/i.test(kw) || /猫カフェ|ねこカフェ/i.test(nm)) {
    tags.add("#猫カフェ"); tags.add("#動物カフェ"); tags.add("#まったりしたい"); tags.add("#1人"); tags.add("#恋人");
  }
  if (/犬カフェ|いぬカフェ/i.test(kw) || /犬カフェ|いぬカフェ/i.test(nm)) {
    tags.add("#犬カフェ"); tags.add("#動物カフェ"); tags.add("#まったりしたい"); tags.add("#家族");
  }
  if (/動物カフェ|小動物/i.test(kw) || /動物カフェ|小動物/i.test(nm)) {
    tags.add("#動物カフェ"); tags.add("#まったりしたい"); tags.add("#友達");
  }
  if (/絶景|絶景スポット|ドライブスポット/i.test(kw) || /絶景/i.test(nm)) {
    tags.add("#絶景スポット"); tags.add("#自然感じたい"); tags.add("#ドライブしたい"); tags.add("#まったりしたい");
  }
  if (/山頂|登山|山/i.test(kw) || /山頂/i.test(nm)) {
    tags.add("#山頂"); tags.add("#絶景スポット"); tags.add("#自然感じたい"); tags.add("#体動かしたい");
  }
  if (/海辺|海岸|海|景勝地|自然スポット/i.test(kw) || /海辺|景勝地/i.test(nm)) {
    tags.add("#海辺"); tags.add("#絶景スポット"); tags.add("#自然感じたい"); tags.add("#ドライブしたい");
  }
  if (/ドライブスポット/i.test(kw)) {
    tags.add("#ドライブしたい"); tags.add("#絶景スポット"); tags.add("#自然感じたい");
  }
  if (/図書館|library/i.test(kw) || /図書館/i.test(nm)) {
    tags.add("#book場"); tags.add("#勉強場"); tags.add("#集中したい"); tags.add("#1人");
  }
  if (/ショッピング|モール|mall/i.test(kw) || /モール|ショッピング/i.test(nm)) {
    tags.add("#ショッピング"); tags.add("#わいわい楽しみたい");
  }

  const validated = Array.from(tags).filter(t => ALL_PREDEFINED_TAGS.includes(t));
  return validated.length > 0 ? validated : ["#まったりしたい"];
}

function buildPhotoUrl(ref: string): string {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${ref}&key=${GOOGLE_API_KEY}`;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── POST: 1都市×1キーワードを処理 ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }
  if (!GOOGLE_API_KEY) {
    return NextResponse.json({ ok: false, error: "GOOGLE_PLACES_API_KEY未設定" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const cityName: string  = body.cityName ?? "";
  const lat: number       = body.lat ?? 0;
  const lng: number       = body.lng ?? 0;
  const radiusKm: number  = body.radiusKm ?? 8;
  const keyword: string   = (body.keyword ?? "").trim();
  const dryRun: boolean   = body.dryRun === true;

  if (!keyword) {
    return NextResponse.json({ ok: false, error: "keyword は必須です" }, { status: 400 });
  }

  let fetched = 0, inserted = 0, skipped = 0;
  const spots: Array<{ name: string; address: string; tags: string[]; photoUrl: string }> = [];
  const errors: string[] = [];

  try {
    // ── 1. Google Places 検索 ────────────────────────────────────────────────
    const results = await searchPlaces(`${keyword} ${cityName}`, lat, lng, radiusKm);
    fetched = results.length;

    // ── 2. フィルタ（距離・宿泊施設・関連性）────────────────────────────
    const filtered = results.filter(p => {
      if (!p.geometry?.location || !p.place_id) return false;
      if (isLodging(p.name, p.types)) return false;
      if (!isRelevantToKeyword(p.name, p.types ?? [], keyword)) return false;
      if (isSubFacility(p.formatted_address ?? "")) return false;
      const dist = haversineKm(lat, lng, p.geometry.location.lat, p.geometry.location.lng);
      return dist <= radiusKm * 1.5;
    });

    // ── 3. 重複チェック（Supabase既存スポット）────────────────────────────
    const placeIds = filtered.map(p => p.place_id);
    const names    = filtered.map(p => p.name);

    const { data: existingById }   = await supabase.from("places").select("google_place_id").in("google_place_id", placeIds);
    const { data: existingByName } = await supabase.from("places").select("name").in("name", names);

    const registeredIds   = new Set((existingById   ?? []).map((r: { google_place_id: string }) => r.google_place_id));
    const registeredNames = new Set((existingByName ?? []).map((r: { name: string }) => r.name.toLowerCase().trim()));

    const newSpots = filtered.filter(p =>
      !registeredIds.has(p.place_id) &&
      !registeredNames.has(p.name.toLowerCase().trim())
    );
    skipped = filtered.length - newSpots.length;

    // ── 4. AIタグ生成 → Supabase登録 ─────────────────────────────────────
    for (const p of newSpots) {
      const pLat = p.geometry!.location.lat;
      const pLng = p.geometry!.location.lng;

      const aiTags     = await generateTags(p.name, p.formatted_address ?? "", keyword);
      const finalTags  = addUrbanTagIfNeeded(aiTags, pLat, pLng);
      const photoUrl   = p.photos?.[0] ? buildPhotoUrl(p.photos[0].photo_reference) : "";
      const photoUrls  = (p.photos ?? []).slice(0, 5).map(ph => buildPhotoUrl(ph.photo_reference));

      spots.push({ name: p.name, address: p.formatted_address ?? "", tags: finalTags, photoUrl });

      if (!dryRun) {
        const { error: insertErr } = await supabase.from("places").insert({
          name:            p.name,
          address:         p.formatted_address ?? "",
          lat:             pLat,
          lng:             pLng,
          google_place_id: p.place_id,
          tags:            finalTags,
          description:     null,
          is_active:       true,
        });
        if (insertErr) {
          errors.push(`${p.name}: ${insertErr.message}`);
          continue;
        }

      }

      inserted++;
      // OpenAI レート制限対策
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (e) {
    errors.push(String(e));
  }

  return NextResponse.json({ ok: true, dryRun, cityName, keyword, fetched, inserted, skipped, spots, errors });
}
