// 全気分×深掘りの「DB完結 vs Google頼み」監査ハーネス（route.ts のsbQualifiedロジックを忠実に再現）。
// 実関数(extractUserTagsFromAnswers/nameMatchesGenre/GENRE_NEGATIVE_RE/canonDeepDive/DEEPDIVE_SEARCH_KEYWORDS)を
// import し、実DB(Supabase REST)に対してbounding-box近傍検索→dbGenreOk→sbQualifiedを算出。
// 出力: /tmp/audit_deepdive.json  使い方: SUPABASE_URL=.. SUPABASE_SERVICE_KEY=.. npx tsx scripts/data-import/audit_deepdive_db.mjs
import { extractUserTagsFromAnswers, MOOD_SHORT_KEY_TO_TAG, MOOD_TAG_MAP } from '../../lib/predefined-tags.ts';
import { nameMatchesGenre, GENRE_NEGATIVE_RE, GENRE_POSITIVE_REQUIRED, canonDeepDive, DEEPDIVE_SEARCH_KEYWORDS } from '../../lib/search-filters.ts';
import fs from 'fs';

const SU = process.env.SUPABASE_URL.replace(/\/$/, '');
const SK = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: SK, Authorization: 'Bearer ' + SK };

function haversineKm(la1, ln1, la2, ln2) {
  const R = 6371, d2r = Math.PI / 180;
  const dla = (la2 - la1) * d2r, dln = (ln2 - ln1) * d2r;
  const a = Math.sin(dla / 2) ** 2 + Math.cos(la1 * d2r) * Math.cos(la2 * d2r) * Math.sin(dln / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// (tag, location, radius) 単位でDB近傍取得をキャッシュ。bounding-box→haversine→近い順。
const cache = new Map();
async function nearestByTag(tag, lat, lng, radiusKm, limit) {
  const key = `${tag}|${lat}|${lng}|${radiusKm}`;
  let rows = cache.get(key);
  if (!rows) {
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
    const enc = encodeURIComponent('{"' + tag + '"}');
    const url = `${SU}/rest/v1/places?tags=cs.${enc}&is_active=eq.true`
      + `&lat=gte.${lat - dLat}&lat=lte.${lat + dLat}&lng=gte.${lng - dLng}&lng=lte.${lng + dLng}`
      + `&select=name,lat,lng,tags,source_type&limit=600`;
    let data = [];
    try { data = await (await fetch(url, { headers: H })).json(); } catch { data = []; }
    if (!Array.isArray(data)) data = [];
    rows = data
      .filter(r => typeof r.lat === 'number' && typeof r.lng === 'number')
      .map(r => ({ ...r, _d: haversineKm(lat, lng, r.lat, r.lng) }))
      .filter(r => r._d <= radiusKm)
      .sort((a, b) => a._d - b._d);
    cache.set(key, rows);
  }
  return rows.slice(0, limit);
}

const BROAD_PARK_TAGS = new Set(['#大型公園']);

// route.ts の sbQualified 算出を忠実再現（非food/foodとも）
async function auditCombo(mood, L1, L2, lat, lng, radiusKm) {
  const dynamicQs = [];
  if (L1) dynamicQs.push({ question: '深掘りカテゴリ', answer: L1 });
  if (L2) dynamicQs.push({ question: '深掘り詳細', answer: L2 });
  const answers = { mood, dynamicQs };
  const userTags = extractUserTagsFromAnswers(answers);
  const allMustTags = [...userTags.mustTags];
  const realMoodTag = MOOD_SHORT_KEY_TO_TAG[mood] ?? Object.entries(MOOD_TAG_MAP).find(([, v]) => v === mood)?.[0];
  const realDrillTags = realMoodTag ? allMustTags.filter(t => t !== realMoodTag) : allMustTags;
  // 修正後の route: sbMustTags = realDrillTags（slice(1)バグ廃止）
  const sbMustTags = realDrillTags.length > 0 ? realDrillTags : allMustTags;
  // 親ジャンルfallback（希少サブジャンルが枯れたら同ジャンル親で補う）
  const PARENT_FB = { "ラーメン":["#ラーメン"],"洋食":["#洋食"],"居酒屋":["#居酒屋"],"焼肉":["#焼肉"],
    "和食":["#和食"],"アジア系統":["#アジア系統"],"各国料理":["#各国料理"],
    "カフェスイーツ":["#カフェスイーツ"],"カフェ":["#カフェスイーツ"],"動物カフェ":["#動物カフェ"],
    "温泉スパ":["#温泉","#サウナ"] };
  const fbTags = PARENT_FB[L1] ?? [];
  const cleanL2 = (L2 && L2 !== 'こだわらない') ? L2 : '';
  const cleanL1 = (L1 && L1 !== 'こだわらない') ? L1 : '';
  const effectiveDeepDive = cleanL2 || cleanL1;
  const hasNameKw = !!(effectiveDeepDive &&
    (DEEPDIVE_SEARCH_KEYWORDS[effectiveDeepDive] || DEEPDIVE_SEARCH_KEYWORDS[canonDeepDive(effectiveDeepDive)]));
  const isApiOnlyDeepDive = !!(effectiveDeepDive && realDrillTags.length === 0 && !hasNameKw);
  const needsProminence = realDrillTags.includes('#大型公園');

  const isFood = mood === 'お腹すいた';
  // ── 候補プール: spatialSearch(sbMustTags,limit20,OR semantics) + 著名公園(#名所公園,limit20) ──
  const fetchLimit = 20;
  const perTag = sbMustTags.length > 1 ? Math.ceil(fetchLimit / sbMustTags.length) + 10 : fetchLimit;
  const poolMap = new Map();
  for (const tag of sbMustTags) {
    for (const r of await nearestByTag(tag, lat, lng, radiusKm, perTag)) poolMap.set(r.name + r.lat, r);
  }
  // route: spatialSearch は mustTags の取得が limit(20)未満のとき fallbackTags で補う
  if (poolMap.size < 20 && fbTags.length > 0) {
    for (const tag of fbTags) {
      for (const r of await nearestByTag(tag, lat, lng, radiusKm, fetchLimit)) poolMap.set(r.name + r.lat, r);
    }
  }
  if (needsProminence) {
    for (const r of await nearestByTag('#名所公園', lat, lng, radiusKm, 20)) poolMap.set(r.name + r.lat, r);
  }
  // 距離キャップ sbRadiusKm*1.15
  const cap = radiusKm * 1.15;
  const pool = [...poolMap.values()].filter(r => r._d <= cap);

  // ── dbGenreOk 再現 ──
  const BROAD_PARENT_GENRE_TAGS = new Set(["#アジア系統", "#各国料理", "#和食", "#洋食", "#カフェスイーツ", "#景色良いカフェ", "#動物カフェ", "#ラーメン"]);
  const genreTrustTags = realDrillTags.filter(t => !!t && t !== realMoodTag);
  const specificTrust = genreTrustTags.filter(t => !BROAD_PARK_TAGS.has(t) && !BROAD_PARENT_GENRE_TAGS.has(t));
  const reliableTrust = specificTrust.length > 0 ? specificTrust : genreTrustTags.filter(t => !BROAD_PARK_TAGS.has(t));
  const cdd = effectiveDeepDive ? canonDeepDive(effectiveDeepDive) : '';
  const neg = cdd ? GENRE_NEGATIVE_RE[cdd] : undefined;
  const dbGenreOk = (r) => {
    const nm = r.name ?? '';
    const tags = r.tags ?? [];
    if (neg && neg.test(nm)) return false;
    if (nameMatchesGenre(nm, effectiveDeepDive)) return true;
    if (reliableTrust.length > 0 && tags.some(t => reliableTrust.includes(t))) return true;
    if (needsProminence && tags.includes('#名所公園') && tags.some(t => BROAD_PARK_TAGS.has(t))) return true;
    return false;
  };
  // food は FINALIZE_NON_FOOD_NAME_RE 除外があるが近似のため省略（飲食店名は基本通る）
  const qualified = pool.filter(dbGenreOk);
  const rejected = pool.filter(r => !dbGenreOk(r));

  // floor: food=ジャンル別(10/5/8) / 非food=8
  let floor = 8;
  if (isFood) {
    const ddText = `${L1 || ''} ${L2 || ''}`;
    floor = /ラーメン|居酒屋|カフェ|喫茶|和食|焼肉/.test(ddText) ? 10
      : /各国|メキシコ|ブラジル|ロシア|ベトナム|タイ|インド|ネパール|エスニック|アジアン/.test(ddText) ? 5 : 8;
  }
  return {
    mood, L1: L1 || '', L2: L2 || '', effectiveDeepDive,
    sbMustTags, realDrillTags, isApiOnly: isApiOnlyDeepDive, needsProminence,
    poolSize: pool.length, sbQualified: qualified.length, floor,
    dbComplete: qualified.length >= floor,
    sampleQualified: qualified.slice(0, 6).map(r => `${r.name}〔${(r.source_type || '').replace('osm-', '')}〕`),
    sampleRejected: rejected.slice(0, 5).map(r => r.name),
    // 精度監査用: 採用スポットの詳細（名前＋タグ＋出所）を多めに
    qualifiedFull: qualified.slice(0, 15).map(r => ({
      name: r.name, src: (r.source_type || '').replace('osm-', ''),
      tags: (r.tags || []).filter(t => t && t !== '#お腹すいた'),
    })),
  };
}

// ── 全気分×深掘りマトリクス（QuizFlow DEEP_DIVE のleaf）──
const MATRIX = JSON.parse(fs.readFileSync(process.env.MATRIX_FILE || '/tmp/audit_matrix.json', 'utf8'));
const LOCATIONS = JSON.parse(fs.readFileSync(process.env.LOC_FILE || '/tmp/audit_locations.json', 'utf8'));

const results = [];
for (const combo of MATRIX) {
  const per = [];
  const precSamples = {};
  for (let li = 0; li < LOCATIONS.length; li++) {
    const loc = LOCATIONS[li];
    try {
      const r = await auditCombo(combo.mood, combo.L1, combo.L2, loc.lat, loc.lng, loc.radiusKm || 15);
      per.push({ loc: loc.label, sbQualified: r.sbQualified, floor: r.floor, dbComplete: r.dbComplete });
      if (li === 0) Object.assign(combo, { detail: r }); // 先頭locの詳細を保持
      precSamples[loc.label] = r.qualifiedFull; // 深層精度監査: 全都市の採用一覧を採取
    } catch (e) {
      per.push({ loc: loc.label, error: String(e).slice(0, 80) });
    }
  }
  combo.precSamples = precSamples;
  const completeCount = per.filter(p => p.dbComplete).length;
  results.push({
    mood: combo.mood, L1: combo.L1, L2: combo.L2,
    effectiveDeepDive: combo.detail?.effectiveDeepDive,
    sbMustTags: combo.detail?.sbMustTags, isApiOnly: combo.detail?.isApiOnly,
    needsProminence: combo.detail?.needsProminence,
    completeAt: `${completeCount}/${per.length}`,
    perLoc: per.map(p => `${p.loc}:${p.dbComplete ? '✓' : '✗'}${p.sbQualified ?? '?'}/${p.floor ?? ''}`),
    sampleQualified: combo.detail?.sampleQualified,
    sampleRejected: combo.detail?.sampleRejected,
    precSamples: combo.precSamples,
  });
  console.error(`${combo.mood}/${combo.L1}/${combo.L2}: complete ${completeCount}/${per.length}`);
}
fs.writeFileSync('/tmp/audit_deepdive.json', JSON.stringify(results, null, 2));
console.error('=== 完了: /tmp/audit_deepdive.json ===');
