import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const DIR = process.argv[2] || '/private/tmp/claude-501/-Users-ryuki-Downloads-moodgo-main/e48cdf09-88c2-44fa-818e-6177d5521f18/scratchpad/curation';
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const GENRE_TAGS = {
  baecafe: ['#まったりしたい', '#カフェスイーツ', '#流行りカフェ'],
  korean:  ['#まったりしたい', '#カフェスイーツ', '#韓国', '#流行りカフェ'],
  retro:   ['#まったりしたい', '#カフェスイーツ', '#流行りカフェ', '#喫茶店'],
  sweets:  ['#まったりしたい', '#カフェスイーツ', '#流行りカフェ'],
  book:    ['#集中したい', '#まったりしたい', '#ブックカフェ', '#カフェスイーツ'],
  izakaya: ['#お腹すいた', '#居酒屋', '#わいわい楽しみたい'],
  yakei:   ['#夜景', '#展望台', '#絶景スポット', '#まったりしたい'],
  furugi:  ['#ショッピング', '#古着・ヴィンテージ', '#服・アクセサリー'],
  zakka:   ['#ショッピング', '#雑貨・インテリア'],
  sauna:   ['#サウナ', '#銭湯', '#温泉', '#まったりしたい'],
  photo:   ['#自然感じたい', '#まったりしたい', '#絶景スポット'],
};
const GENRE_VIBE = {
  baecafe: '写真映えするおしゃれカフェ。', korean: '韓国っぽい雰囲気の映えカフェ。', retro: '昭和レトロな純喫茶。',
  sweets: '映えるスイーツが楽しめるお店。', book: '本と静かに過ごせるブックカフェ。', izakaya: 'おしゃれで賑やかな居酒屋・横丁。',
  yakei: '夜景や景色が映える展望スポット。', furugi: '古着・ヴィンテージが揃うショップ。', zakka: 'おしゃれな雑貨・セレクトショップ。',
  sauna: '整うおしゃれサウナ・銭湯。', photo: '映えるフォトスポット。',
};
const COMMON = ['#友達', '#恋人', '#1人'];

// 1) collect
const files = fs.readdirSync(DIR).filter(f => /^cell_\d+\.json$/.test(f));
let raw = [];
for (const f of files) {
  try { const arr = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8')); if (Array.isArray(arr)) raw.push(...arr); } catch (e) {}
}
console.log(`ファイル ${files.length} / 生スポット ${raw.length}`);

// 2) clean + within-batch dedup
const norm = s => (s || '').normalize('NFKC').toLowerCase().replace(/(本店|支店|店|\s+)/g, '').replace(/[（）()・,.'’!！\-　]/g, '');
const seenBatch = new Set();
const clean = [];
for (const r of raw) {
  const name = (r.name || '').trim();
  const address = (r.address || '').trim();
  const genre = (r.genre || '').trim();
  if (!name || name.length < 2) continue;
  if (!address || !/[0-9０-９]/.test(address)) continue;   // 番地が無い住所は除外
  if (!GENRE_TAGS[genre]) continue;
  const key = genre + '|' + norm(name);
  if (seenBatch.has(key)) continue;
  seenBatch.add(key);
  clean.push({ name, address, feature: (r.feature || '').trim(), genre, city: (r.city || '').trim() });
}
console.log(`クリーン後(番地あり/既知ジャンル/バッチ内dedup): ${clean.length}`);

// 3) geocode (GSI) + 4) dedup vs DB (find_nearby_places RPC = GIST索引で高速)
async function gsi(addr) {
  try { const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(addr)); const j = await r.json(); if (Array.isArray(j) && j[0]?.geometry?.coordinates) { const [lng, lat] = j[0].geometry.coordinates; return { lat, lng }; } } catch (e) {}
  return null;
}
const AREA = /^(渋谷|原宿|表参道|下北沢|中目黒|新宿|新大久保|大久保|池袋|浅草|蔵前|吉祥寺|高円寺|自由が丘|清澄白河|代官山|横浜|元町|野毛|鎌倉|川越|梅田|中崎町|中崎|心斎橋|堀江|難波|なんば|京都|河原町|四条|三宮|元町|神戸|名古屋|大須|栄|天神|大名|福岡|札幌|大通|すすきの|仙台|広島|熊本|長崎|金沢|奈良|那覇|国際通り|大阪|東京|コリアンタウン|百人町)$/;
let geoFail = 0, dup = 0;
const toInsert = [];
for (let i = 0; i < clean.length; i++) {
  const s = clean[i];
  const g = await gsi(s.address);
  if (!g) { geoFail++; continue; }
  // dedup vs DB
  const { data: near } = await sb.rpc('find_nearby_places', { user_lat: g.lat, user_lng: g.lng, radius_m: 180, req_tags: [], result_limit: 60 });
  const nn = norm(s.name);
  let isDup = false;
  for (const p of (near || [])) {
    const pnRaw = (p.name || '').trim();
    if (AREA.test(pnRaw)) continue;
    const pn = norm(pnRaw);
    if (pn.length < 3 || nn.length < 3) continue;
    if (pn === nn || (Math.min(pn.length, nn.length) >= 4 && (pn.includes(nn) || nn.includes(pn)))) { isDup = true; break; }
  }
  if (isDup) { dup++; continue; }
  const tags = [...new Set([...GENRE_TAGS[s.genre], ...COMMON])];
  const desc = ((s.feature ? s.feature.replace(/。+$/, '') + '。' : '') + (GENRE_VIBE[s.genre] || '')).slice(0, 120);
  toInsert.push({ name: s.name, address: s.address, lat: g.lat, lng: g.lng, tags, description: desc, genre: s.genre, city: s.city });
  if (i % 50 === 0) process.stdout.write(`\r  geocode/dedup ${i}/${clean.length} (new=${toInsert.length} dup=${dup} geoFail=${geoFail})`);
}
console.log(`\n投入対象: ${toInsert.length} (dup=${dup}, geoFail=${geoFail})`);
if (!toInsert.length) { console.log('投入対象なし'); process.exit(0); }

// 5) insert (batches of 200)
const now = new Date().toISOString();
const base = { source_type: 'admin', is_active: true, tag_source: 'curated', tags_reviewed: true, source_license: 'curated-web-2026-07-national', created_at: now, updated_at: now };
const inserted = [];
for (let i = 0; i < toInsert.length; i += 200) {
  const chunk = toInsert.slice(i, i + 200).map(r => ({ ...base, name: r.name, address: r.address, lat: r.lat, lng: r.lng, tags: r.tags, description: r.description, area: r.city }));
  const { data, error } = await sb.from('places').insert(chunk).select('id,name,description,tags');
  if (error) { console.log('INSERT ERR:', error.message); continue; }
  inserted.push(...(data || []));
  process.stdout.write(`\r  insert ${inserted.length}/${toInsert.length}`);
}
console.log(`\n挿入: ${inserted.length}件。embedding生成中...`);

// 6) embed (OpenAI batch, chunks of 300)
function bt(r) { const name = r.name || ''; const d = r.description || ''; const tags = (r.tags || []).join(' '); return (name + '。' + d + '。' + tags).replace(/^[。 ]+|[。 ]+$/g, '').slice(0, 500); }
let emb = 0;
for (let i = 0; i < inserted.length; i += 300) {
  const chunk = inserted.slice(i, i + 300);
  const texts = chunk.map(bt);
  const er = await fetch('https://api.openai.com/v1/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.OPENAI_API_KEY }, body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }) });
  const ej = await er.json();
  if (!ej.data) { console.log('EMBED ERR:', JSON.stringify(ej).slice(0, 200)); continue; }
  for (let k = 0; k < chunk.length; k++) {
    const v = ej.data[k].embedding; const es = '[' + v.map(x => x.toFixed(6)).join(',') + ']';
    const { error } = await sb.from('places').update({ embedding: es }).eq('id', chunk[k].id);
    if (!error) emb++;
  }
  process.stdout.write(`\r  embed ${emb}/${inserted.length}`);
}
console.log(`\n=== 完了: 挿入 ${inserted.length}件 / embedding ${emb}件 ===`);
