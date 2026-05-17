// ─── /api/random-spots ────────────────────────────────────────────────────────
// 現在地周辺のスポットをSupabaseからランダムに返す（時間潰したい用）
//
// POST body:
//   lat        number   現在地緯度
//   lng        number   現在地経度
//   radiusKm   number   検索半径km（transport×timeで決定済み）
//   limit      number   返す件数（デフォルト: 10）
//   companion  string   誰と（恋人/友達/家族/1人 など）→ タグ優先絞り込み
//   budget     number   予算円 → 高額タグを除外
//   freeWord   string   自由ワード → OpenAIでタグ変換して絞り込み

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// タグ → キャッチコピー（OpenAI不使用・ルールベース）
function tagsToTagline(tags: string[], name: string): string {
  const has = (t: string) => tags.includes(t);

  // 温泉・サウナ系
  if (has("#天然温泉") && has("#サウナ"))  return "♨️ 天然温泉＆サウナでとことんリラックス";
  if (has("#天然温泉"))                    return "♨️ 源泉かけ流しの天然温泉でゆったり";
  if (has("#大型銭湯") && has("#サウナ"))  return "🔥 スーパー銭湯＆サウナで一日まったり";
  if (has("#大型銭湯"))                    return "🏊 岩盤浴・食事も充実のスーパー銭湯";
  if (has("#銭湯") && has("#サウナ"))      return "🔥 サウナ付き銭湯でさっぱり整う";
  if (has("#銭湯"))                        return "🛁 昔ながらの銭湯でほっとひと息";
  if (has("#温泉") && has("#サウナ"))      return "🔥 温泉＆サウナで心身ともにリフレッシュ";
  if (has("#温泉"))                        return "♨️ 温泉でゆったり癒しのひととき";
  if (has("#サウナ") && has("#岩盤浴"))    return "🔥 サウナ＆岩盤浴でデトックス";
  if (has("#サウナ"))                      return "🔥 サウナでととのう特別なひととき";
  if (has("#岩盤浴"))                      return "🌊 岩盤浴でじっくりデトックス";

  // カフェ系
  if (has("#猫カフェ"))                    return "🐱 猫たちと過ごすほっこり癒しカフェ";
  if (has("#犬カフェ"))                    return "🐶 ワンちゃんと触れあえるふわふわカフェ";
  if (has("#小動物カフェ"))               return "🦔 珍しい動物に会える動物カフェ";
  if (has("#動物カフェ"))                  return "🐾 動物と触れあいながらほっこりできるカフェ";
  if (has("#海辺カフェ"))                  return "🌊 波の音を聞きながらくつろげる海辺カフェ";
  if (has("#森林カフェ"))                  return "🌲 木々に包まれた森の隠れ家カフェ";
  if (has("#景色良いカフェ") && has("#展望台")) return "🗼 高台から絶景を眺めながらカフェタイム";
  if (has("#景色良いカフェ"))              return "🌅 絶景を眺めながらくつろげる景色自慢のカフェ";
  if (has("#ブックカフェ"))               return "📚 本に囲まれてのんびり過ごせるブックカフェ";
  if (has("#スイーツカフェ"))             return "🍰 こだわりスイーツが自慢のカフェ";
  if (has("#癒しカフェ") || has("#カフェ作業")) return "☕ ゆっくりくつろげるこだわりカフェ";

  // 自然系
  if (has("#絶景スポット") && has("#展望台")) return "🗼 360°の大パノラマが広がる絶景展望台";
  if (has("#絶景スポット") && has("#海辺"))   return "🌊 圧巻の海景色が楽しめる絶景スポット";
  if (has("#絶景スポット"))                   return "🌅 思わず息をのむ絶景スポット";
  if (has("#展望台"))                         return "🗼 街を一望できる絶好の展望スポット";
  if (has("#海辺"))                           return "🌊 潮風と波の音に癒される海辺の場所";
  if (has("#大型公園") && has("#お散歩"))     return "🌳 広々した公園でのんびりお散歩日和";
  if (has("#大型公園"))                       return "🌳 芝生でゴロゴロ、ピクニック気分の大公園";
  if (has("#自然公園") && has("#お散歩"))     return "🌲 自然豊かな公園で緑の中を散策";
  if (has("#自然公園"))                       return "🌲 深い緑に包まれた自然豊かな公園";
  if (has("#お散歩"))                         return "🚶 気ままにぶらり散歩が楽しめるスポット";

  // 観光・体験系
  if (has("#パワースポット"))              return "⛩️ 歴史と神秘に包まれたパワースポット";
  if (has("#テーマパーク"))               return "🎡 非日常的な夢の世界が広がるテーマパーク";
  if (has("#水族館"))                     return "🐠 幻想的な海の生き物たちに会える水族館";
  if (has("#動物園"))                     return "🦁 様々な動物たちと出会える楽しい動物園";
  if (has("#美術館"))                     return "🖼️ アートの世界に浸れる洗練された美術館";
  if (has("#博物館"))                     return "🏛️ 知的好奇心を刺激する展示が充実の博物館";
  if (has("#アミューズメントパーク"))     return "🎢 みんなで盛り上がれるアミューズメント施設";
  if (has("#体験型ゲーム"))              return "🎮 非日常の体験で友達とワイワイ盛り上がれる";

  // スポーツ系
  if (has("#ガッツリ運動"))              return "💪 本格的にがっつり体を動かせる施設";
  if (has("#屋外スポーツ"))              return "⛺ 自然の中でアウトドアスポーツを満喫";
  if (has("#スポーツ"))                  return "🏀 スポーツで気分爽快にリフレッシュ";
  if (has("#ボウリング"))                return "🎳 ボウリングでみんなと楽しく対決";
  if (has("#カラオケ"))                  return "🎤 思いっきり歌ってストレス発散";

  // グルメ系
  if (has("#居酒屋") && has("#居酒屋個室")) return "🍺 個室でゆっくり楽しめる居酒屋";
  if (has("#居酒屋"))                    return "🍺 美味しいお酒と料理が楽しめる居酒屋";
  if (has("#焼肉"))                      return "🥩 本格焼肉でがっつり満足できるお店";
  if (has("#海鮮") || has("#寿司"))      return "🍣 新鮮な魚介が自慢のグルメスポット";
  if (has("#ラーメン"))                  return "🍜 こだわりの一杯が楽しめるラーメン店";
  if (has("#スイーツ"))                  return "🍰 絶品スイーツが揃うとっておきのお店";
  if (has("#ご当地グルメ"))             return "🏪 地元の味が楽しめるご当地グルメスポット";
  if (has("#バーベキュー"))              return "🔥 みんなでわいわいBBQが楽しめる場所";

  // 勉強・作業系
  if (has("#勉強場"))                    return "📖 静かに集中できる勉強・作業スペース";
  if (has("#カフェ作業"))               return "💻 Wi-Fi完備で集中して作業できるカフェ";
  if (has("#ファミレス"))               return "🍳 落ち着いてゆっくり過ごせるファミレス";
  if (has("#book場"))                   return "📚 本や漫画に囲まれてこもれる快適スペース";

  // ショッピング系
  if (has("#ショッピング"))             return "🛍️ お気に入りが見つかるショッピングスポット";

  // 気分タグのみの場合の汎用
  if (has("#まったりしたい"))           return "😌 ゆったりのんびり過ごせるスポット";
  if (has("#わいわい楽しみたい"))       return "🎉 みんなで楽しく盛り上がれるスポット";
  if (has("#自然感じたい"))             return "🍀 自然を感じてリフレッシュできる場所";
  if (has("#ドライブしたい"))           return "🚗 ドライブがてら立ち寄りたいスポット";

  // デフォルト（施設名からヒント）
  if (/公園/.test(name))  return "🌳 ゆったり過ごせる公園";
  if (/温泉|湯/.test(name)) return "♨️ 温泉でほっと一息";
  if (/カフェ|cafe/i.test(name)) return "☕ のんびりできるカフェ";
  if (/神社|寺|仏/.test(name)) return "⛩️ 趣ある歴史スポット";
  if (/山|岳|峠/.test(name)) return "⛰️ 雄大な自然が広がるスポット";
  if (/海|浜|港/.test(name)) return "🌊 海の景色が楽しめるスポット";
  return `✨ ${name}で時間を過ごしてみよう`;
}

// 同伴者 → 優先タグ
function companionTags(companion: string | null): string[] {
  if (!companion) return [];
  if (companion.includes("恋人"))   return ["#恋人"];
  if (companion.includes("友達"))   return ["#友達"];
  if (companion.includes("家族"))   return ["#家族"];
  if (companion.includes("大人数")) return ["#大人数"];
  if (companion.includes("一人") || companion.includes("1人")) return ["#1人"];
  if (companion.includes("先輩"))   return ["#先輩"];
  return [];
}

// 予算 → 除外タグ
function budgetExcludeTags(budget: number | null): string[] {
  if (budget === null) return [];
  if (budget <= 0)     return ["#〜3000", "#〜5000", "#〜10000", "#10000〜"];
  if (budget <= 3000)  return ["#10000〜", "#〜10000", "#〜5000"];
  if (budget <= 5000)  return ["#10000〜", "#〜10000"];
  if (budget <= 10000) return ["#10000〜"];
  return [];
}

// 自由ワードをOpenAI でタグリストに変換
async function freeWordToTags(freeWord: string): Promise<string[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || !freeWord) return [];
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: `ユーザーの自由ワードを、スポット検索タグに変換してください。
出力は JSON { "tags": ["#タグ1", "#タグ2"] } 形式のみ。
使えるタグ例: #温泉 #サウナ #カフェ #自然感じたい #絶景スポット #展望台 #海辺 #大型公園 #自然公園
#居酒屋 #焼肉 #ラーメン #スイーツ #ショッピング #体験型ゲーム #アミューズメントパーク
#まったりしたい #わいわい楽しみたい #集中したい #体動かしたい
タグは最大5個まで。#から始めること。`
          },
          { role: "user", content: `自由ワード: ${freeWord}` }
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    return (parsed.tags ?? []).filter((t: unknown) => typeof t === "string" && (t as string).startsWith("#"));
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  }

  try {
    const body = await req.json();
    const lat: number        = body.lat ?? 0;
    const lng: number        = body.lng ?? 0;
    const radiusKm: number   = body.radiusKm ?? 15;
    const limit: number      = body.limit ?? 10;
    const companion: string | null = body.companion ?? null;
    const budget: number | null    = body.budget ?? null;
    const freeWord: string | null  = body.freeWord ?? null;

    // ── 自由ワード → タグ変換（OpenAI）────────────────────────────────
    const freeWordTagsResult = freeWord ? await freeWordToTags(freeWord) : [];

    // ── Supabase から全アクティブスポットを取得（最大500件）─────────────
    let query = supabase
      .from("places")
      .select("id, name, address, lat, lng, google_place_id, tags, description, nearest_station")
      .eq("is_active", true)
      .limit(500);

    // 自由ワードタグがある場合は最初の1件で絞り込み（緩め）
    if (freeWordTagsResult.length > 0) {
      query = query.overlaps("tags", freeWordTagsResult);
    }

    const { data: allPlaces, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // ── グローバルブロック済みスポットを除外 ─────────────────────────
    const { data: globalBlocked } = await supabase
      .from("globally_blocked_places")
      .select("spot_name");
    const globalBlockedNames = new Set((globalBlocked ?? []).map((r: { spot_name: string }) => r.spot_name));
    const notGloballyBlocked = (allPlaces ?? []).filter(p => !globalBlockedNames.has(p.name));

    // ── 座標フィルタ ──────────────────────────────────────────────────
    const radiusM = radiusKm * 1000;
    const inRadius =
      lat === 0 && lng === 0
        ? notGloballyBlocked
        : notGloballyBlocked.filter(
            (p) => p.lat != null && p.lng != null && haversineM(lat, lng, p.lat, p.lng) <= radiusM,
          );

    // ── 予算フィルタ（除外タグを持つスポットを除外）──────────────────
    const excludeTags = budgetExcludeTags(budget);
    const budgetFiltered = excludeTags.length > 0
      ? inRadius.filter(p => !excludeTags.some(et => (p.tags ?? []).includes(et)))
      : inRadius;

    // ── 同伴者タグで優先順位付け → シャッフル ─────────────────────────
    const prefTags = companionTags(companion);
    let sortedPool: typeof budgetFiltered;
    if (prefTags.length > 0) {
      const preferred = budgetFiltered.filter(p =>
        prefTags.some(t => (p.tags ?? []).includes(t))
      );
      const others = budgetFiltered.filter(p =>
        !prefTags.some(t => (p.tags ?? []).includes(t))
      );
      // 優先スポットを前半に、残りを後半に（それぞれシャッフル）
      sortedPool = [...shuffle(preferred), ...shuffle(others)];
    } else {
      sortedPool = shuffle(budgetFiltered);
    }

    const selected = sortedPool.slice(0, limit);

    // ── place_photos 取得 ─────────────────────────────────────────────
    const placeIds = selected.map((p) => p.id);
    const { data: photosData } = await supabase
      .from("place_photos")
      .select("place_id, photo_url, is_primary")
      .in("place_id", placeIds);

    const photosMap = new Map<string, string[]>();
    for (const ph of (photosData ?? []).sort(
      (a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0),
    )) {
      if (!photosMap.has(ph.place_id)) photosMap.set(ph.place_id, []);
      photosMap.get(ph.place_id)!.push(ph.photo_url);
    }

    const results = selected.map((p) => {
      const distM =
        p.lat != null && p.lng != null ? haversineM(lat, lng, p.lat, p.lng) : null;
      const distKm = distM != null ? (distM / 1000).toFixed(1) : null;
      const photos = photosMap.get(p.id) ?? [];
      const mainTag =
        (p.tags ?? []).find((t: string) => !["#お腹すいた", "#まったりしたい", "#わいわい楽しみたい", "#ドライブしたい", "#集中したい", "#体動かしたい", "#遠くに行きたい", "#自然感じたい"].includes(t)) ??
        (p.tags ?? [])[0] ??
        "スポット";

      return {
        id: p.google_place_id ?? `sb-${p.id}`,
        name: p.name,
        category: mainTag,
        catchphrase: tagsToTagline(p.tags ?? [], p.name),
        description: p.description ?? "",
        imageUrl: photos[0] ?? "",
        rating: null,
        reviewCount: null,
        address: p.address,
        distanceInfo: distKm ? `約${distKm}km` : "距離不明",
        photoUrls: photos.slice(0, 5),
        openNow: null,
        openingHours: null,
        priceLevel: null,
        googleMapsUrl: p.google_place_id
          ? `https://www.google.com/maps/place/?q=place_id:${p.google_place_id}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              `${p.name} ${p.address}`,
            )}`,
        stationInfo: p.nearest_station ?? null,
        source: "admin" as const,
        tags: p.tags ?? [],
      };
    });

    return NextResponse.json({
      ok: true,
      data: results,
      total: inRadius.length,
      radiusKm,
      usedFreeWordTags: freeWordTagsResult,
    });
  } catch (e) {
    console.error("[/api/random-spots] error:", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
