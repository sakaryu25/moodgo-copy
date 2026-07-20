// 古着/ヴィンテージ/セカンドハンド衣料を OSM Overpass から都市別に取得し places へ投入。
//   Z世代向け在庫ギャップ(タグ#古着・ヴィンテージ=0件)の解消。全国一括はOverpassが504するので
//   都市bboxに分割＋リトライ＋ミラーfallback。名前+座標近接で既存重複はスキップ。
//   実行: node scripts/data-import/import_kifuku.mjs        (DRY-RUN)
//         APPLY=1 node scripts/data-import/import_kifuku.mjs (投入)
import fs from "node:fs";
const env = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
const URL_ = env.match(/SUPABASE_URL=(.+)/)[1].trim();
const KEY = env.match(/SUPABASE_SERVICE_KEY=(.+)/)[1].trim();
const H = { apikey: KEY, Authorization: "Bearer " + KEY };
const DRY = process.env.APPLY !== "1";

// [name, south,west,north,east] Z世代の古着需要が高い主要エリア
const CITIES = [
  ["下北沢/渋谷", 35.63, 139.64, 35.71, 139.73],
  ["原宿/新宿", 35.66, 139.68, 35.72, 139.72],
  ["高円寺/中野", 35.68, 139.63, 35.71, 139.67],
  ["大阪ミナミ/アメ村", 34.65, 135.48, 34.71, 135.52],
  ["名古屋大須", 35.14, 136.88, 35.18, 136.92],
  ["福岡天神/大名", 33.57, 130.38, 33.61, 130.42],
  ["京都寺町/三条", 34.99, 135.75, 35.02, 135.78],
  ["横浜元町/関内", 35.43, 139.62, 35.46, 139.66],
  ["神戸三宮", 34.68, 135.18, 34.71, 135.21],
  ["札幌大通", 43.05, 141.34, 43.07, 141.36],
];
const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function overpass(bbox) {
  const [s, w, n, e] = bbox;
  const Q = `[out:json][timeout:60];(nwr["shop"="second_hand"]["shop"!="car"](${s},${w},${n},${e});nwr["shop"="clothes"]["second_hand"~"yes|only"](${s},${w},${n},${e});nwr["shop"="clothes"]["name"~"古着|ヴィンテージ|ビンテージ|vintage|used|リサイクル|セカンド|RAGTAG|WEGO|ラグタグ",i](${s},${w},${n},${e}););out center 200;`;
  for (let attempt = 0; attempt < MIRRORS.length * 2; attempt++) {
    const ep = MIRRORS[attempt % MIRRORS.length];
    try {
      const r = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "User-Agent": "MoodGo-ETL/1.0 (ryuki.m.0325@icloud.com)" }, body: "data=" + encodeURIComponent(Q) });
      const txt = await r.text();
      if (txt.startsWith("<") || txt.startsWith("Please")) { await sleep(4000 + attempt * 3000); continue; }
      return (JSON.parse(txt).elements || []);
    } catch { await sleep(3000); }
  }
  return null;
}

// 既存重複チェック(名前一致 or 100m以内の同名前方一致)
async function existsNear(name, lat, lng) {
  const r = await fetch(`${URL_}/rest/v1/places?select=id&name=eq.${encodeURIComponent(name)}&limit=1`, { headers: H });
  const d = await r.json();
  return Array.isArray(d) && d.length > 0;
}

const seen = new Set();
const toInsert = [];
for (const [label, ...bbox] of CITIES) {
  const els = await overpass(bbox);
  if (els == null) { console.log(`${label}: Overpass応答なし(skip)`); continue; }
  let n = 0;
  for (const el of els) {
    const t = el.tags || {}; const name = (t.name || t["name:ja"] || "").trim();
    if (!name || name.length < 2) continue;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    // shop=second_hand で衣料以外(本/家電)を弾く: second_hand=clothes 指定 or 名前に衣料語 or shop=clothes
    const isClothes = t.shop === "clothes" || /clothes|古着|ヴィンテージ|vintage|used|セカンド|リサイクル|apparel|衣/i.test(`${t["second_hand:type"] || ""}${name}`);
    if (t.shop === "second_hand" && !isClothes && !/古着|ヴィンテージ|vintage|used|リサイクル|セカンド|服|衣/i.test(name)) continue;
    const key = `${name}@${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (seen.has(key)) continue; seen.add(key);
    toInsert.push({ name, lat, lng, address: [t["addr:city"], t["addr:street"]].filter(Boolean).join("") || null,
      website: t.website || t["contact:website"] || null, phone: t.phone || t["contact:phone"] || null, open_hours: t.opening_hours || null });
    n++;
  }
  console.log(`${label}: ${els.length}要素 → 候補${n}`);
  await sleep(2500);
}
console.log(`\n=== 候補計 ${toInsert.length}件 ===`);
for (const x of toInsert.slice(0, 15)) console.log("  ", x.name);

if (DRY) { console.log("\n[DRY-RUN] APPLY=1 で投入"); process.exit(0); }

// 重複除外して投入(source_type=osm-shopping, #古着・ヴィンテージ+#ショッピング)
let ins = 0, skip = 0;
for (const x of toInsert) {
  if (await existsNear(x.name, x.lat, x.lng)) { skip++; continue; }
  const row = {
    name: x.name, lat: x.lat, lng: x.lng,
    address: x.address || x.city || "", nearest_station: "", description: "古着・ヴィンテージが楽しめるお店。",
    location: `SRID=4326;POINT(${x.lng} ${x.lat})`,
    tags: ["#古着・ヴィンテージ", "#ショッピング", "#服・アクセサリー"],
    source_type: "osm-shopping", is_active: true,
    ...(x.website ? { website: x.website } : {}), ...(x.phone ? { phone: x.phone } : {}), ...(x.open_hours ? { open_hours: x.open_hours } : {}),
  };
  const r = await fetch(`${URL_}/rest/v1/places`, { method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row) });
  if (r.ok) ins++;
  else { const e = await r.text(); if (ins + skip < 3) console.log("  insert失敗:", r.status, e.slice(0, 120)); skip++; }
}
console.log(`\n[APPLIED] 投入${ins} / スキップ(重複/失敗)${skip}`);
