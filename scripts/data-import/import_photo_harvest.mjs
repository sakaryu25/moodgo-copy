// 無料写真harvest: Wikidata P18(Commons画像)を、画像なしの自前スポットに名前+座標一致で付与。
//   Google 403に依存せず写真被覆を上げる(Z世代は写真で決める)。画像は Wikimedia Commons(CC/PD)。
//   実行: node scripts/data-import/import_photo_harvest.mjs         (DRY: マッチ数のみ)
//         APPLY=1 node scripts/data-import/import_photo_harvest.mjs (image_urls付与)
import fs from "node:fs";
// ⚠ .env.local に SUPABASE_URL / SUPABASE_SERVICE_KEY が必要（鍵ローテ後は新しい値を各自で作成）。
let env;
try { env = fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8"); }
catch { console.error("✋ .env.local が見つかりません。SUPABASE_URL / SUPABASE_SERVICE_KEY を書いて配置してください。"); process.exit(1); }
const URL_ = env.match(/SUPABASE_URL=(.+)/)[1].trim();
const KEY = env.match(/SUPABASE_SERVICE_KEY=(.+)/)[1].trim();
const H = { apikey: KEY, Authorization: "Bearer " + KEY };
const DRY = process.env.APPLY !== "1";
const UA = "MoodGo-ETL/1.0 (ryuki.m.0325@icloud.com)";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 映え/自然/観光の型(Gen Z適合)。P31/P279* で下位種も拾う。
const TYPES = [
  ["Q22698", "公園"], ["Q34038", "滝"], ["Q8502", "山"], ["Q23397", "湖"], ["Q23413", "城"],
  ["Q1107656", "庭園"], ["Q167346", "植物園"], ["Q845945", "神社"], ["Q44539", "寺"],
  ["Q33506", "博物館"], ["Q207694", "美術館"], ["Q2680521", "水族館"], ["Q43501", "動物園"],
  ["Q40080", "海岸"], ["Q194195", "遊園地"], ["Q570116", "観光地"], ["Q12518", "塔"],
  ["Q177380", "温泉"], ["Q46831", "山地"], ["Q4022", "川"], ["Q1244442", "校舎(除外用)"],
];
const SKIP = new Set(["Q1244442"]);

const normName = (s) => (s || "").normalize("NFKC").replace(/[\s　]/g, "").replace(/[（(].*?[)）]/g, "").replace(/店$|本店$/, "").toLowerCase();
const commonsUrl = (imgVal) => {
  const file = imgVal.split("/").pop();
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=800`;
};

async function sparqlType(qid) {
  const q = `SELECT ?itemLabel ?lat ?lon ?img WHERE {
    ?item wdt:P17 wd:Q17 . ?item wdt:P31/wdt:P279* wd:${qid} . ?item wdt:P18 ?img .
    ?item p:P625/psv:P625 [ wikibase:geoLatitude ?lat ; wikibase:geoLongitude ?lon ] .
    ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel)="ja")
  } LIMIT 20000`;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: { Accept: "application/sparql-results+json", "User-Agent": UA } });
      const txt = await r.text();
      if (txt.startsWith("<") || txt.startsWith("Q") || txt.startsWith("SPARQL")) { await sleep(5000 + a * 5000); continue; }
      return JSON.parse(txt).results.bindings;
    } catch { await sleep(4000); }
  }
  return [];
}

// 1) Wikidata索引を構築（normName → [{lat,lon,url}]）
const wd = new Map();
let wdTotal = 0;
for (const [qid, label] of TYPES) {
  if (SKIP.has(qid)) continue;
  const rows = await sparqlType(qid);
  for (const x of rows) {
    const nn = normName(x.itemLabel.value);
    if (nn.length < 2) continue;
    const rec = { lat: +x.lat.value, lon: +x.lon.value, url: commonsUrl(x.img.value) };
    if (!wd.has(nn)) wd.set(nn, []);
    wd.get(nn).push(rec); wdTotal++;
  }
  console.log(`  ${label}(${qid}): ${rows.length}件 (索引計 ${wd.size}名)`);
  await sleep(1500);
}
console.log(`Wikidata索引: ${wd.size}名 / ${wdTotal}画像`);

// 2) 画像なしの自前スポットを取得し、名前+座標(≤2km)一致で画像を付与
const haversine = (a, b, c, d) => { const R = 6371, r = Math.PI / 180; const dLat = (c - a) * r, dLon = (d - b) * r; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
// 写真被覆を上げる対象。絶景(osm-scenic)・登山/岩場(osm-climbing)を追加＝Wikidata画像が付きやすい
//   映え/自然/観光系。飲食(osm-foodshop)等はWikidata画像がほぼ無いのでユーザー投稿に委ねる。
const SOURCES = ["osm-nature", "osm-scenic", "osm-travel", "osm-fun", "osm-climbing", "admin", "japan47go"];
const updates = [];
for (const src of SOURCES) {
  let last = "", stalls = 0, scanned = 0;
  for (;;) {
    const kf = last ? `&id=gt.${last}` : "";
    const r = await fetch(`${URL_}/rest/v1/places?select=id,name,lat,lng&source_type=eq.${src}&is_active=eq.true&image_urls=is.null&photo_url=is.null${kf}&order=id.asc&limit=500`, { headers: H });
    const d = await r.json();
    if (!Array.isArray(d)) { if (++stalls > 6) break; await sleep(800); continue; }
    stalls = 0;
    for (const p of d) {
      const cand = wd.get(normName(p.name));
      if (!cand || typeof p.lat !== "number") continue;
      const hit = cand.find(c => haversine(p.lat, p.lng, c.lat, c.lon) <= 2);
      if (hit) updates.push({ id: p.id, url: hit.url, name: p.name });
    }
    scanned += d.length;
    if (d.length < 500) break;
    last = d[d.length - 1].id;
  }
  console.log(`  ${src}: scan ${scanned} → マッチ計 ${updates.length}`);
}
console.log(`\n=== 画像付与マッチ: ${updates.length}件 ===`);
for (const u of updates.slice(0, 12)) console.log("  ", u.name);

if (DRY) { console.log("\n[DRY-RUN] APPLY=1 で付与"); process.exit(0); }
let ok = 0, ng = 0, i = 0;
const workers = Array.from({ length: 10 }, async () => {
  while (i < updates.length) {
    const u = updates[i++];
    const r = await fetch(`${URL_}/rest/v1/places?id=eq.${u.id}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ image_urls: [u.url] }) });
    r.ok ? ok++ : ng++;
  }
});
await Promise.all(workers);
console.log(`\n[APPLIED] 画像付与 ${ok} / 失敗 ${ng}`);
