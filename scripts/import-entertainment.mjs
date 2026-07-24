/**
 * 全国のカラオケ・ボウリング・ビリヤード・ダーツ施設を
 * Google Places Text Search API で取得して Supabase に追加
 * バー・酒場系は除外
 *
 * 実行: node scripts/import-entertainment.mjs
 */

import { createClient } from "@supabase/supabase-js";

// ⚠ 秘密情報はコードに直書きしない。環境変数から読む（未設定なら即エラー）。
//   以前ここに service_role JWT と Google APIキーが直書きされていた＝git履歴に残るため
//   該当キーは失効(ローテート)済みであること。実行時は環境変数を渡すこと:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... GOOGLE_API_KEY=... node scripts/import-entertainment.mjs
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_API_KEY) {
  console.error("✋ 環境変数が必要です: SUPABASE_URL / SUPABASE_SERVICE_KEY / GOOGLE_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 除外キーワード（バー・酒場系）
const BAR_KEYWORDS = ["バー", " bar", "Bar", "BAR", "スナック", "ナイトクラブ", "ラウンジ", "キャバ", "ホスト"];
// 除外するGoogleのタイプ
const BAR_TYPES = ["bar", "night_club", "liquor_store"];

// 検索設定
const SEARCH_CONFIGS = [
  {
    query: "カラオケ",
    tag: "#カラオケ",
    moodgoTags: ["#カラオケ", "#体験型ゲーム", "#わいわい楽しみたい", "#友達", "#大人数"],
    desc: "カラオケボックス",
    includeTypes: ["karaoke"],
  },
  {
    query: "ボウリング場",
    tag: "#ボウリング",
    moodgoTags: ["#ボウリング", "#体験型ゲーム", "#わいわい楽しみたい", "#友達", "#家族"],
    desc: "ボウリング場",
    includeTypes: ["bowling_alley"],
  },
  {
    query: "ビリヤード場",
    tag: "#ビリヤード",
    moodgoTags: ["#ビリヤード", "#体験型ゲーム", "#わいわい楽しみたい", "#友達"],
    desc: "ビリヤード場",
    includeTypes: [],
  },
  {
    query: "ダーツ専門店",
    tag: "#ダーツ",
    moodgoTags: ["#ダーツ", "#体験型ゲーム", "#わいわい楽しみたい", "#友達"],
    desc: "ダーツ施設",
    includeTypes: [],
  },
];

// 主要都市（lat, lng, 名前）
const CITIES = [
  // 北海道
  ["札幌", 43.0642, 141.3469], ["函館", 41.7688, 140.7290], ["旭川", 43.7707, 142.3651], ["釧路", 42.9849, 144.3820],
  // 東北
  ["青森", 40.8244, 140.7401], ["盛岡", 39.7036, 141.1527], ["仙台", 38.2682, 140.8694], ["秋田", 39.7186, 140.1024], ["山形", 38.2404, 140.3636], ["福島", 37.7608, 140.4748], ["郡山", 37.3941, 140.3878],
  // 関東
  ["水戸", 36.3418, 140.4468], ["宇都宮", 36.5548, 139.8830], ["前橋", 36.3893, 139.0600], ["高崎", 36.3228, 139.0030],
  ["さいたま", 35.8617, 139.6455], ["川越", 35.9255, 139.4857], ["千葉", 35.6074, 140.1065], ["柏", 35.8681, 139.9759],
  ["新宿", 35.6938, 139.7034], ["渋谷", 35.6580, 139.7016], ["池袋", 35.7295, 139.7109], ["上野", 35.7141, 139.7774],
  ["吉祥寺", 35.7034, 139.5796], ["立川", 35.6987, 139.4130], ["八王子", 35.6662, 139.3160],
  ["横浜", 35.4437, 139.6380], ["川崎", 35.5309, 139.7029], ["相模原", 35.5717, 139.3731],
  // 中部
  ["新潟", 37.9162, 139.0364], ["富山", 36.6953, 137.2113], ["金沢", 36.5613, 136.6562], ["福井", 36.0652, 136.2219],
  ["甲府", 35.6635, 138.5684], ["長野", 36.6486, 138.1947], ["松本", 36.2381, 137.9719],
  ["岐阜", 35.4231, 136.7608], ["静岡", 34.9769, 138.3831], ["浜松", 34.7108, 137.7261],
  ["名古屋", 35.1815, 136.9066], ["豊橋", 34.7695, 137.3922], ["豊田", 35.0836, 137.1560],
  // 近畿
  ["津", 34.7303, 136.5086], ["大津", 35.0045, 135.8686], ["京都", 35.0116, 135.7681],
  ["梅田", 34.7055, 135.5008], ["難波", 34.6688, 135.4990], ["堺", 34.5733, 135.4830],
  ["神戸", 34.6913, 135.1830], ["姫路", 34.8394, 134.6939], ["西宮", 34.7364, 135.3408],
  ["奈良", 34.6851, 135.8048], ["和歌山", 34.2261, 135.1675],
  // 中国・四国
  ["鳥取", 35.5011, 134.2351], ["松江", 35.4681, 133.0485], ["岡山", 34.6551, 133.9195],
  ["広島", 34.3853, 132.4553], ["福山", 34.4859, 133.3625], ["下関", 33.9542, 130.9300],
  ["徳島", 34.0658, 134.5593], ["高松", 34.3402, 134.0434], ["松山", 33.8417, 132.7657], ["高知", 33.5597, 133.5311],
  // 九州・沖縄
  ["博多", 33.5902, 130.4017], ["北九州", 33.8834, 130.8751], ["久留米", 33.3192, 130.5081],
  ["佐賀", 33.2635, 130.3009], ["長崎", 32.7503, 129.8779], ["熊本", 32.8031, 130.7079],
  ["大分", 33.2382, 131.6126], ["別府", 33.2846, 131.4923], ["宮崎", 31.9111, 131.4239],
  ["鹿児島", 31.5602, 130.5581], ["那覇", 26.2124, 127.6809],
];

function isBar(name, types = []) {
  if (BAR_TYPES.some(t => types.includes(t))) return true;
  return BAR_KEYWORDS.some(kw => name.includes(kw));
}

// Google Places Text Search (New)
async function searchGooglePlaces(textQuery, lat, lng, radiusM = 10000) {
  const url = "https://places.googleapis.com/v1/places:searchText";
  const body = {
    textQuery,
    languageCode: "ja",
    maxResultCount: 20,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusM,
      },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google API ${res.status}: ${err.slice(0, 100)}`);
  }
  const data = await res.json();
  return data.places ?? [];
}

// 既存データをロード（name で重複チェック）
async function loadExisting() {
  const existing = new Set();
  const googleIds = new Set();
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from("places")
      .select("name, google_place_id")
      .eq("is_active", true)
      .range(offset, offset + 999);
    if (!data?.length) break;
    for (const p of data) {
      existing.add(p.name.trim());
      if (p.google_place_id) googleIds.add(p.google_place_id);
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`既存: ${existing.size} 件`);
  return { existing, googleIds };
}

async function run() {
  console.log("=== 全国エンタメ施設インポート（Google Places）===\n");
  const { existing, googleIds } = await loadExisting();

  const stats = { "#カラオケ": 0, "#ボウリング": 0, "#ビリヤード": 0, "#ダーツ": 0, skipped: 0, error: 0 };
  const sessionSeen = new Set(); // 重複防止

  for (const config of SEARCH_CONFIGS) {
    console.log(`\n=== ${config.query} ===`);

    for (const [cityName, lat, lng] of CITIES) {
      process.stdout.write(`  ${cityName}... `);
      try {
        const places = await searchGooglePlaces(config.query, lat, lng, 12000);
        let added = 0;

        for (const place of places) {
          const name = place.displayName?.text?.trim();
          if (!name) continue;

          const placeId = place.id;
          const types = place.types ?? [];

          // バー系除外
          if (isBar(name, types)) { stats.skipped++; continue; }

          // 重複チェック
          if (googleIds.has(placeId) || existing.has(name) || sessionSeen.has(placeId)) {
            stats.skipped++;
            continue;
          }
          sessionSeen.add(placeId);

          const address = place.formattedAddress ?? "";
          const coord = place.location;
          if (!coord) continue;

          const { error } = await supabase.from("places").insert({
            name,
            address,
            lat: coord.latitude,
            lng: coord.longitude,
            google_place_id: placeId,
            tags: config.moodgoTags,
            description: config.desc,
            is_active: true,
            area: null,
            nearest_station: null,
          });

          if (!error) {
            added++;
            stats[config.tag] = (stats[config.tag] || 0) + 1;
            existing.add(name);
            googleIds.add(placeId);
          } else {
            stats.error++;
          }
        }
        process.stdout.write(`${added}件追加\n`);
      } catch (e) {
        process.stdout.write(`エラー: ${e.message.slice(0, 60)}\n`);
      }

      // レート制限対策
      await new Promise(r => setTimeout(r, 150));
    }
  }

  console.log("\n=== 完了 ===");
  for (const [tag, count] of Object.entries(stats)) {
    if (tag.startsWith("#")) console.log(`${tag}: ${count} 件追加`);
  }
  console.log(`スキップ(重複・バー): ${stats.skipped} 件`);
  console.log(`エラー: ${stats.error} 件`);
}

run().catch(console.error);
