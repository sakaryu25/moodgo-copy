export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;   // 一括統合はカーソル継続式（1呼び出し=約40秒分・クライアントがdoneまで再呼び出し）
import { NextRequest, NextResponse } from "next/server";
import { supabase as supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, requireAdminFromReq } from "@/lib/admin-auth";
import { normalizeName } from "@/lib/normalize-name";

type DB = NonNullable<typeof supabaseAdmin>;
const chunk = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// ⚠ placesは45万行超。全件をメモリに載せる方式は成立しない（旧実装は無言で失敗し0件を返していた）。
//   name昇順でページングすると「同名は必ず隣接」するので、ストリームしながら同名ランを検出し
//   その場で統合する。呼び出しごとに時間ガードで打ち切り、nextCursor（処理済み末尾のname）を返す。
//   idx_places_name がある前提（data-integrity.sqlで作成済み）＝name>cursor のページングは索引で速い。

type Row = {
  id: string; name: string; address: string | null; tags: string[] | null;
  lat: number | null; lng: number | null; google_place_id: string | null;
};

const SELECT_COLS = "id, name, address, tags, lat, lng, google_place_id";

// 住所の緩い正規化（空白・ハイフン揺れだけ吸収。座標なし同士の同一判定用）
const normAddr = (s: string | null | undefined) =>
  (s ?? "").trim().toLowerCase().replace(/[\s　]/g, "").replace(/[‐－ー−―]/g, "-");

function distM(a: Row, b: Row): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 汎用すぎる住所を弾く。座標欠損時の住所フォールバックで「日本」「日本国」「都道府県名だけ」を
//   同一の根拠にすると、離れた別物の同名を誤統合する（実データに address="日本" が22万件ある）。
const PREF_ONLY_RE = /^(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)$/;
function isSpecificAddr(s: string | null | undefined): boolean {
  const raw = (s ?? "").trim();
  if (!raw) return false;
  const n = normAddr(raw);
  if (n === "日本" || n === "日本国" || n === "japan") return false;
  if (PREF_ONLY_RE.test(raw)) return false;
  return true;
}

// 同名グループを「本当に同じ場所」の近接クラスタに分割する。
//   ⚠同名＝同一店舗ではない（チェーン店は同名で全国に散在。例: スターバックス同名1218件）。
//   ⚠“近い別店舗”も同一ではない（渋谷の吉野家が150〜300m間隔で複数＝別物）。実データ監査では
//     旧300mの統合対象1859グループが全て150〜300m離れ＝ほぼチェーンの別支店の誤統合だった。
//     → radiusは実質「同一座標のズレ」だけを吸収する狭さにし、住所フォールバックも具体住所限定にする。
//   完全連結（クラスタ全員と近接）で判定＝単連結の推移ドリフト（A-B-C で A-C が半径超過）を防ぐ。
function clusterGroup(group: Row[], radiusM: number): Row[][] {
  const clusters: Row[][] = [];
  for (const p of group) {
    let placed = false;
    for (const c of clusters) {
      // クラスタの全員と近接している場合だけ同一クラスタに入れる（clique的＝直径を半径内に保つ）
      const near = c.every(q => {
        const d = distM(p, q);
        if (d != null) return d <= radiusM;
        // 座標が無い場合のみ住所一致で救済。ただし“具体的な住所”に限る（日本/県だけは不可）
        return isSpecificAddr(p.address) && normAddr(p.address) === normAddr(q.address);
      });
      if (near) { c.push(p); placed = true; break; }
    }
    if (!placed) clusters.push([p]);
  }
  return clusters;
}

// クラスタ内で残す1件を選ぶ: google_place_id持ち > 座標持ち > タグ数 > 具体住所
//   ※idキーの子データ(写真/Moodログ/評価)は下の repointChildren で必ず keeper へ寄せるので、
//     どれを keeper にしても子データは失われない。ここは「places行自身の情報量」で選ぶ。
function pickKeeper(cluster: Row[]): Row {
  return [...cluster].sort((a, b) => {
    const g = Number(!!b.google_place_id) - Number(!!a.google_place_id);
    if (g !== 0) return g;
    const c = Number(b.lat != null && b.lng != null) - Number(a.lat != null && a.lng != null);
    if (c !== 0) return c;
    const t = (b.tags?.length ?? 0) - (a.tags?.length ?? 0);
    if (t !== 0) return t;
    return Number(isSpecificAddr(b.address)) - Number(isSpecificAddr(a.address));
  })[0];
}

// 統合で消える行(dupes)にぶら下がる「place_idキーの子データ」を keeper.id へ全て付け替える。
//   ⚠spot_photos だけ付け替えて spot_posts / spot_ratings を放置すると、Moodログ(気分口コミ)と
//     ★評価が詳細ページ(place_idで取得)から消える＝ユーザーが積み上げた学習データの喪失。
//     ここで全idキー子を keeper に寄せることで、統合＝学習の「合流」になり検索の材料が濃くなる。
//   ※ engagement/affinity/mood_place_ratings は place_name キーで、同名統合では名前が不変のため
//     再結合不要（別名の表記ゆれ統合は merge-variant 側で名前を寄せて合流させる）。
async function repointChildren(db: DB, keeperId: string, dupeIds: string[]): Promise<void> {
  if (dupeIds.length === 0) return;
  for (const t of ["place_photos", "spot_photos", "spot_posts", "spot_ratings"]) {
    await db.from(t).update({ place_id: keeperId }).in("place_id", dupeIds).then(() => {}, () => {});
  }
}

// 1クラスタを統合: タグ合算＋keeperの欠損補完＋写真付け替え＋重複をis_active=false
async function mergeCluster(keeper: Row, dupes: Row[]): Promise<void> {
  const db = supabaseAdmin!;
  const tagSet = new Set<string>(keeper.tags ?? []);
  for (const d of dupes) for (const t of d.tags ?? []) tagSet.add(t);
  const patch: Record<string, unknown> = { tags: [...tagSet] };
  // keeperに無い情報は重複側から補完（データを捨てない）
  if (!keeper.google_place_id) { const src = dupes.find(d => d.google_place_id); if (src) patch.google_place_id = src.google_place_id; }
  if (keeper.lat == null || keeper.lng == null) { const src = dupes.find(d => d.lat != null && d.lng != null); if (src) { patch.lat = src.lat; patch.lng = src.lng; } }
  if (!keeper.address) { const src = dupes.find(d => d.address); if (src) patch.address = src.address; }
  const { error: upErr } = await db.from("places").update(patch).eq("id", keeper.id);
  if (upErr) throw upErr;

  const ids = dupes.map(d => d.id);
  // idキーの子データ(写真/Moodログ/評価)を keeper へ全て付け替え＝統合で学習を捨てない
  await repointChildren(db, keeper.id, ids);
  const { error: delErr } = await db.from("places").update({ is_active: false }).in("id", ids);
  if (delErr) throw delErr;
}

// name昇順で1バッチ取得（cursorより後ろ・統合済みis_active=falseは除外。NULL名は先頭に来ないようgt''）
async function fetchBatch(cursorName: string): Promise<{ rows: Row[]; error: string | null }> {
  const { data, error } = await supabaseAdmin!
    .from("places")
    .select(SELECT_COLS)
    // ⚠大半の行のis_activeはNULL。neq(false)だとNULLも落ちて全滅するので not.is.false を使う
    .not("is_active", "is", false)
    .gt("name", cursorName)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(1000);
  if (error) {
    // 索引なしだと45万行の毎回フルソート＝statement timeoutになる。適用手順を案内する
    const msg = /statement timeout/i.test(error.message)
      ? "name索引が未適用です。supabase/merge-duplicates-index.sql をSupabase SQL Editorで実行してから再実行してください"
      : error.message;
    return { rows: [], error: msg };
  }
  return { rows: (data ?? []) as Row[], error: null };
}

// 同名が1000件超のラン（例: スターバックス同名1218件）の残りをid昇順で全部取り切る
async function fetchRestOfName(name: string, afterId: string): Promise<Row[]> {
  const out: Row[] = [];
  let lastId = afterId;
  while (true) {
    const { data, error } = await supabaseAdmin!
      .from("places")
      .select(SELECT_COLS)
      .not("is_active", "is", false)
      .eq("name", name)
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(1000);
    if (error || !data || data.length === 0) break;
    out.push(...(data as Row[]));
    lastId = (data[data.length - 1] as Row).id;
    if (data.length < 1000) break;
  }
  return out;
}

type GroupStat = { clusters: { keeper: Row; dupes: Row[] }[]; skippedFar: boolean };

// 同名がDB内でこの数以上＝チェーン/汎用名（吉野家/スターバックス/体育館/テニスコート等）。
//   別店舗・別施設が近接しうるので、ほぼ同一座標(<=CHAIN_RADIUS_M)でないと統合しない。
//   run（=このnameの全件・境界跨ぎ込みで集めきったもの）の件数でチェーン判定できる。
const CHAIN_MIN = 8;
const CHAIN_RADIUS_M = 25;

// 同名ラン（name完全一致・trim比較）→ 統合対象クラスタへ
function planGroup(run: Row[], radiusM: number): GroupStat {
  if (run.length < 2) return { clusters: [], skippedFar: false };
  // チェーン/汎用名はさらに厳しい半径に絞る（別支店の誤統合を防ぐ最重要ガード）
  const eff = run.length >= CHAIN_MIN ? Math.min(radiusM, CHAIN_RADIUS_M) : radiusM;
  const clusters = clusterGroup(run, eff).filter(c => c.length >= 2);
  if (clusters.length === 0) return { clusters: [], skippedFar: true };
  return {
    clusters: clusters.map(c => { const k = pickKeeper(c); return { keeper: k, dupes: c.filter(r => r.id !== k.id) }; }),
    skippedFar: false,
  };
}

// ── 学習シグナルの集計（重複が「検索に効いているか」を可視化する）─────────────
// idキー子データ(写真/Moodログ/評価)の件数を place_id 別に数える＝どの行にユーザーの積み上げがあるか。
async function countChildrenByPlace(db: DB, ids: string[]): Promise<{ photos: Map<string, number>; posts: Map<string, number>; ratings: Map<string, number> }> {
  const photos = new Map<string, number>(), posts = new Map<string, number>(), ratings = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string | null | undefined) => { if (k) m.set(k, (m.get(k) ?? 0) + 1); };
  for (const ch of chunk(ids, 150)) {
    await db.from("spot_photos").select("place_id").in("place_id", ch).neq("moderation_status", "hidden")
      .then(({ data }) => { for (const r of (data ?? []) as { place_id: string }[]) bump(photos, r.place_id); }, () => {});
    await db.from("spot_posts").select("place_id").in("place_id", ch).neq("status", "rejected")
      .then(({ data }) => { for (const r of (data ?? []) as { place_id: string }[]) bump(posts, r.place_id); }, () => {});
    await db.from("spot_ratings").select("place_id").in("place_id", ch)
      .then(({ data }) => { for (const r of (data ?? []) as { place_id: string }[]) bump(ratings, r.place_id); }, () => {});
  }
  return { photos, posts, ratings };
}

// place_name キーの学習ボリューム（recommend が読むランキング信号の大きさ）を名前(小文字)別に集計。
//   affinity(行動の事前集計)を主指標に評価件数も合算＝「検索で実際に使われている度」。
async function signalByName(db: DB, names: string[]): Promise<Map<string, number>> {
  const sig = new Map<string, number>();
  const add = (n: string | null | undefined, v: number) => { const k = String(n ?? "").toLowerCase().trim(); if (k) sig.set(k, (sig.get(k) ?? 0) + v); };
  for (const ch of chunk([...new Set(names)], 100)) {
    await db.from("place_mood_affinity").select("place_name, score").in("place_name", ch)
      .then(({ data }) => { for (const r of (data ?? []) as { place_name: string; score: number }[]) add(r.place_name, Number(r.score) || 0); }, () => {});
    await db.from("mood_place_ratings").select("place_name").in("place_name", ch)
      .then(({ data }) => { for (const r of (data ?? []) as { place_name: string }[]) add(r.place_name, 2); }, () => {});
  }
  return sig;
}

type EnrichedRow = Row & { photos: number; posts: number; ratings: number };
type EnrichedGroup = { rows: EnrichedRow[]; nameSignal: number; atStake: number; impact: number };

// GET のグループ配列に学習シグナルを付与し、検索インパクト順に並べ替える。
//   ・各行: 写真/Moodログ/評価の件数（＝どの行がユーザーに使われている「本物」か）
//   ・グループ: nameSignal(この名前がランキングで持つ重み) と atStake(消える行に載る投稿量) から
//              impact を出し降順。＝検索に効く重複から先に潰せる。
async function enrichGroups(db: DB, groups: Row[][]): Promise<EnrichedGroup[]> {
  const allIds = groups.flat().map(r => r.id);
  const allNames = groups.map(g => g[0]?.name ?? "");
  const [{ photos, posts, ratings }, sig] = await Promise.all([
    countChildrenByPlace(db, allIds),
    signalByName(db, allNames),
  ]);
  const enriched: EnrichedGroup[] = groups.map(g => {
    const keeperId = pickKeeper(g).id;
    const rows: EnrichedRow[] = g.map(r => ({ ...r, photos: photos.get(r.id) ?? 0, posts: posts.get(r.id) ?? 0, ratings: ratings.get(r.id) ?? 0 }));
    // keeper を先頭に（UI の既定選択が「残すべき情報量の多い行」になる）
    rows.sort((a, b) => Number(b.id === keeperId) - Number(a.id === keeperId));
    const nameSignal = sig.get((g[0]?.name ?? "").toLowerCase().trim()) ?? 0;
    // 消える側(keeper以外)に載っている投稿量＝統合しないと検索/詳細で分裂したままの学習
    const atStake = rows.filter(r => r.id !== keeperId).reduce((a, r) => a + r.photos * 2 + r.posts * 3 + r.ratings, 0);
    const impact = Math.round(nameSignal + atStake + rows.reduce((a, r) => a + r.photos + r.posts, 0));
    return { rows, nameSignal: Math.round(nameSignal), atStake, impact };
  });
  enriched.sort((a, b) => b.impact - a.impact);
  return enriched;
}

// ── 表記ゆれ＝学習分裂の検出（検索改善の最重要レバー）─────────────────────────
//   recommend のランキング信号は全て place_name(小文字)キー。「東京ｽｶｲﾂﾘｰ」と「東京スカイツリー」は
//   別キーになり、片方への訪問/評価がもう片方に効かない＝学習が2つに割れて検索が弱くなる。
//   学習テーブルに実在する名前集合(=小さい)だけを normalizeName で束ね、綴り違いが2つ以上あるものを
//   「分裂」として返す。45万行を舐めないので安く、かつ検索に効く重複だけを狙える。
type VariantGroup = {
  normKey: string; canonical: string; totalSignal: number;
  spellings: { name: string; signal: number; placeCount: number }[];
  places: { id: string; name: string; address: string; lat: number | null; lng: number | null; hasGoogle: boolean; tags: string[] }[];
};
async function detectVariants(db: DB): Promise<VariantGroup[]> {
  // ① 学習が乗っている名前を集める（affinity=行動集計 / spot_posts=Moodログ / mood_place_ratings=評価）
  const raw = new Map<string, number>();  // rawName -> signal
  const addName = (n: string | null | undefined, v: number) => { const k = String(n ?? "").trim(); if (k) raw.set(k, (raw.get(k) ?? 0) + v); };
  await db.from("place_mood_affinity").select("place_name, score").gt("score", 0).order("score", { ascending: false }).limit(8000)
    .then(({ data }) => { for (const r of (data ?? []) as { place_name: string; score: number }[]) addName(r.place_name, Number(r.score) || 0); }, () => {});
  await db.from("spot_posts").select("place_name").eq("status", "approved").limit(8000)
    .then(({ data }) => { for (const r of (data ?? []) as { place_name: string }[]) addName(r.place_name, 3); }, () => {});
  await db.from("mood_place_ratings").select("place_name").limit(8000)
    .then(({ data }) => { for (const r of (data ?? []) as { place_name: string }[]) addName(r.place_name, 2); }, () => {});

  // ② normalizeName で束ね、綴り違いが2つ以上あるキーだけ残す（＝表記ゆれで割れている）
  const byNorm = new Map<string, Map<string, number>>();  // normKey -> (rawName -> signal)
  for (const [name, s] of raw) {
    const nk = normalizeName(name);
    if (!nk) continue;
    if (!byNorm.has(nk)) byNorm.set(nk, new Map());
    const m = byNorm.get(nk)!;
    m.set(name, (m.get(name) ?? 0) + s);
  }

  const out: VariantGroup[] = [];
  for (const [nk, spellMap] of byNorm) {
    if (spellMap.size < 2) continue;  // 綴りが1つ＝分裂なし（チェーン店は同綴りなのでここで自然に除外）
    const spellings = [...spellMap.entries()].map(([name, signal]) => ({ name, signal })).sort((a, b) => b.signal - a.signal);
    // 実在する places行(active)を引いて統合可能にする
    const names = spellings.map(s => s.name);
    const placeRows: { id: string; name: string; address: string | null; lat: number | null; lng: number | null; google_place_id: string | null; tags: string[] | null }[] = [];
    for (const ch of chunk(names, 50)) {
      await db.from("places").select("id, name, address, lat, lng, google_place_id, tags").in("name", ch).not("is_active", "is", false)
        .then(({ data }) => { placeRows.push(...((data ?? []) as typeof placeRows)); }, () => {});
    }
    out.push({
      normKey: nk,
      canonical: spellings[0].name,   // 最も学習が乗っている綴りを正規名に
      totalSignal: Math.round(spellings.reduce((a, s) => a + s.signal, 0)),
      spellings: spellings.map(s => ({ name: s.name, signal: Math.round(s.signal), placeCount: placeRows.filter(p => p.name.trim() === s.name.trim()).length })),
      places: placeRows.map(p => ({ id: p.id, name: p.name, address: p.address ?? "", lat: p.lat, lng: p.lng, hasGoogle: !!p.google_place_id, tags: p.tags ?? [] })),
    });
  }
  out.sort((a, b) => b.totalSignal - a.totalSignal);
  return out.slice(0, 40);
}

// GET: 同名スポットのグループ一覧（手動統合UI用）。45万行あるため先頭からのスキャンで
//   最大60グループ見つけた時点/時間切れで打ち切り、partial=true を返す。
//   ?mode=variants … 表記ゆれで学習が分裂しているスポットを返す（検索改善レバー）。
export async function GET(req: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (!requireAdminFromReq(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // 表記ゆれ＝学習分裂モード（学習テーブルの名前集合だけを走査＝安い・検索に効く重複だけ）
  if (new URL(req.url).searchParams.get("mode") === "variants") {
    try {
      const variants = await detectVariants(supabaseAdmin);
      return NextResponse.json({ ok: true, mode: "variants", variants, count: variants.length });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
    }
  }

  const startedAt = Date.now();
  const groups: Row[][] = [];
  let cursor = "";
  let scanned = 0;
  let run: Row[] = [];
  let done = false;

  while (Date.now() - startedAt < 25_000 && groups.length < 60) {
    const { rows, error } = await fetchBatch(cursor);
    if (error) return NextResponse.json({ ok: false, error }, { status: 500 });
    if (rows.length === 0) { done = true; break; }
    scanned += rows.length;
    for (const r of rows) {
      if (run.length > 0 && run[0].name.trim() === r.name.trim()) { run.push(r); continue; }
      if (run.length >= 2) groups.push(run);
      run = [r];
    }
    if (rows.length < 1000) { if (run.length >= 2) groups.push(run); done = true; break; }
    // バッチ末尾のランは次バッチへ続きうる → 取り直し（bulk側と同じ境界処理）
    const runStartIdx = rows.length - run.length;
    if (runStartIdx > 0) { cursor = rows[runStartIdx - 1].name; run = []; }
    else {
      const rest = await fetchRestOfName(run[0].name, run[run.length - 1].id);
      run.push(...rest);
      if (run.length >= 2) groups.push(run);
      cursor = run[0].name;
      run = [];
    }
  }

  // 学習シグナルを付与し検索インパクト順に並べ替え（≤60グループなので集計は数クエリで完結）
  const enriched = await enrichGroups(supabaseAdmin, groups);
  return NextResponse.json({ ok: true, groups: enriched, count: enriched.length, partial: !done, scanned });
}

// POST:
//   単体統合: { keepId, deleteIds, mergedTags } … 従来のグループ個別統合
//   一括統合: { action: "bulk", dryRun?, radiusM?, cursor? }
//     name昇順ストリームで同名ランを検出し、radiusM(既定40m＝実質同一座標のみ)以内 or 具体住所一致のクラスタだけ統合。
//     離れた同名（チェーン店の別店舗）は触らない。時間ガードで打ち切り nextCursor を返すので、
//     クライアントは done:true まで cursor を渡して再呼び出しする。dryRun=trueは件数集計のみ。
export async function POST(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (!isAdminRequest(request, body?.secret)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  if (body?.action === "bulk") {
    const startedAt = Date.now();
    const TIME_BUDGET_MS = 40_000;
    const dryRun = body?.dryRun === true;
    const radiusM = Math.min(Math.max(Number(body?.radiusM) || 40, 10), 2000);
    let cursor = typeof body?.cursor === "string" ? body.cursor : "";

    let scanned = 0, mergedClusters = 0, deleted = 0, failed = 0, skippedFarGroups = 0;
    const samples: { name: string; deleteCount: number; keepAddress: string }[] = [];
    let run: Row[] = [];
    let done = false;

    const flushRun = async () => {
      const plan = planGroup(run, radiusM);
      if (plan.skippedFar) skippedFarGroups++;
      for (const t of plan.clusters) {
        if (samples.length < 20) samples.push({ name: t.keeper.name, deleteCount: t.dupes.length, keepAddress: t.keeper.address ?? "" });
        if (dryRun) { mergedClusters++; deleted += t.dupes.length; continue; }
        try { await mergeCluster(t.keeper, t.dupes); mergedClusters++; deleted += t.dupes.length; }
        catch { failed++; }
      }
      run = [];
    };

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const { rows, error } = await fetchBatch(cursor);
      if (error) return NextResponse.json({ ok: false, error }, { status: 500 });
      if (rows.length === 0) { done = true; break; }
      scanned += rows.length;
      for (const r of rows) {
        if (run.length > 0 && run[0].name.trim() === r.name.trim()) { run.push(r); continue; }
        await flushRun();   // 直前の同名ランを確定処理（1件なら何もしない）
        run = [r];
      }
      if (rows.length < 1000) { await flushRun(); done = true; break; }

      // バッチ末尾のラン(run)は次バッチに続いている可能性がある。
      //   基本方針: runは処理せず捨て、カーソルを「ラン開始の直前の行の名前」に戻す
      //   → 次バッチが gt(cursor) でラン先頭から取り直すので、境界をまたぐ同名も丸ごと1ランで処理できる。
      const runStartIdx = rows.length - run.length;
      if (runStartIdx > 0) {
        cursor = rows[runStartIdx - 1].name;
        run = [];
      } else {
        // バッチ1000件が全部同名（例: スターバックス同名1218件）＝取り直しでは前へ進めない。
        // このランだけ name一致×id昇順の追加ページングで残りを全部取り切ってから確定処理する。
        const rest = await fetchRestOfName(run[0].name, run[run.length - 1].id);
        scanned += rest.length;
        run.push(...rest);
        cursor = run[0].name;   // gt(この名前) で次の名前へ進む
        await flushRun();
      }
    }

    return NextResponse.json({
      ok: true, dryRun, done, radiusM, scanned,
      merged: mergedClusters, deleted, failed, skippedFarGroups,
      samples, nextCursor: done ? null : cursor,
    });
  }

  // 表記ゆれ統合＝分裂した学習の再結合。canonical(正規名)へ綴りゆれの places行とidキー子を寄せ、
  //   さらに place_name キーの学習(affinity/評価/engagement/Moodログ)を canonical に合流させる。
  //   ＝「東京ｽｶｲﾂﾘｰ」と「東京スカイツリー」に割れていた学習が1キーに集まり、検索ランキングが濃くなる。
  if (body?.action === "merge-variant") {
    const db = supabaseAdmin;
    const dryRun = body?.dryRun === true;
    const canonical = String(body?.canonical ?? "").trim();
    const variantNames: string[] = Array.isArray(body?.variantNames)
      ? [...new Set((body.variantNames as unknown[]).map((s) => String(s).trim()).filter(Boolean))] : [];
    if (!canonical || variantNames.length < 1 || !variantNames.includes(canonical)) {
      return NextResponse.json({ ok: false, error: "canonical と（それを含む）variantNames が必要" }, { status: 400 });
    }
    const others = variantNames.filter((n) => n !== canonical);   // canonical以外の綴り

    // 対象の places行(active)。canonical綴りの行を keeper、それ以外の綴りの行を dupe に。
    const placeRows: Row[] = [];
    for (const ch of chunk(variantNames, 50)) {
      const { data } = await db.from("places").select(SELECT_COLS).in("name", ch).not("is_active", "is", false);
      placeRows.push(...((data ?? []) as Row[]));
    }
    const canonRows = placeRows.filter((p) => p.name.trim() === canonical);
    const keeper = canonRows.length ? pickKeeper(canonRows) : (placeRows.length ? pickKeeper(placeRows) : null);
    const dupePlaces = placeRows.filter((p) => keeper && p.id !== keeper.id);

    // 影響行数のカウント（place_name in others）
    const countName = async (table: string): Promise<number> => {
      let total = 0;
      for (const ch of chunk(others, 50)) {
        if (ch.length === 0) continue;
        const { count } = await db.from(table).select("place_name", { count: "exact", head: true }).in("place_name", ch)
          .then((r) => r, () => ({ count: 0 }));
        total += count ?? 0;
      }
      return total;
    };
    const [affinityRows, ratingRows, engagementRows, postRows] = await Promise.all([
      others.length ? countName("place_mood_affinity") : Promise.resolve(0),
      others.length ? countName("mood_place_ratings") : Promise.resolve(0),
      others.length ? countName("spot_engagement") : Promise.resolve(0),
      others.length ? countName("spot_posts") : Promise.resolve(0),
    ]);

    if (dryRun) {
      return NextResponse.json({
        ok: true, dryRun: true, canonical, otherSpellings: others,
        keeper: keeper ? { id: keeper.id, name: keeper.name, address: keeper.address ?? "" } : null,
        willHidePlaces: dupePlaces.length, affinityRows, ratingRows, engagementRows, postRows,
      });
    }
    if (!keeper) return NextResponse.json({ ok: false, error: "統合先の場所が見つかりません（places未登録の学習名のみ）" }, { status: 200 });

    // ① keeper を canonical に改名＋全綴りのタグを合算（情報を捨てない）
    const tagSet = new Set<string>(keeper.tags ?? []);
    for (const d of dupePlaces) for (const t of d.tags ?? []) tagSet.add(t);
    const keeperPatch: Record<string, unknown> = { tags: [...tagSet] };
    if (keeper.name.trim() !== canonical) keeperPatch.name = canonical;
    await db.from("places").update(keeperPatch).eq("id", keeper.id).then(() => {}, () => {});

    // ② idキー子(写真/Moodログ/評価)を keeper へ寄せ、綴りゆれの places行を非表示化
    const dupeIds = dupePlaces.map((d) => d.id);
    await repointChildren(db, keeper.id, dupeIds);
    if (dupeIds.length) await db.from("places").update({ is_active: false }).in("id", dupeIds).then(() => {}, () => {});

    // ③ place_name キーの学習を canonical に合流（recommend が1キーで全学習を読める）
    if (others.length) {
      // 単純updateでよい表（PK衝突なし）
      for (const t of ["mood_place_ratings", "spot_engagement", "spot_posts"]) {
        await db.from(t).update({ place_name: canonical }).in("place_name", others).then(() => {}, () => {});
      }
      // place_mood_affinity は PK(place_name,mood)＝単純updateはconflict。read→sum→upsert(canonical)→delete(others)
      try {
        const allNames = [canonical, ...others];
        const affRows: { place_name: string; mood: string; score: number; updated_at: string | null }[] = [];
        for (const ch of chunk(allNames, 50)) {
          const { data } = await db.from("place_mood_affinity").select("place_name, mood, score, updated_at").in("place_name", ch);
          affRows.push(...((data ?? []) as typeof affRows));
        }
        if (affRows.length) {
          const summed = new Map<string, { score: number; updated_at: string | null }>();  // mood -> 合算
          for (const r of affRows) {
            const cur = summed.get(r.mood) ?? { score: 0, updated_at: null };
            cur.score += Number(r.score) || 0;
            if (!cur.updated_at || (r.updated_at && r.updated_at > cur.updated_at)) cur.updated_at = r.updated_at ?? cur.updated_at;
            summed.set(r.mood, cur);
          }
          const nowIso = new Date().toISOString();
          const upserts = [...summed.entries()].map(([mood, v]) => ({ place_name: canonical, mood, score: v.score, updated_at: v.updated_at ?? nowIso }));
          // 先に canonical を合算値へ（データ喪失を作らない）→ 後で others を掃除
          if (upserts.length) await db.from("place_mood_affinity").upsert(upserts, { onConflict: "place_name,mood" });
          await db.from("place_mood_affinity").delete().in("place_name", others);
        }
      } catch { /* affinity再結合失敗は他を巻き込まない（ratings/engagement/postsは適用済み）*/ }
    }

    return NextResponse.json({
      ok: true, canonical, mergedInto: keeper.id, hidPlaces: dupeIds.length,
      rekeyed: { affinityRows, ratingRows, engagementRows, postRows },
    });
  }

  if (!body?.keepId || !Array.isArray(body.deleteIds) || !Array.isArray(body.mergedTags)) {
    return NextResponse.json({ ok: false, error: "Invalid params" }, { status: 400 });
  }

  const { keepId, deleteIds, mergedTags } = body as {
    keepId: string;
    deleteIds: string[];
    mergedTags: string[];
  };

  // 残すレコードのタグを更新
  const { error: updateErr } = await supabaseAdmin
    .from("places")
    .update({ tags: mergedTags })
    .eq("id", keepId);

  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  // 削除対象のidキー子データ(写真/Moodログ/評価)を残すレコードへ付け替え（一括統合と同挙動）
  if (deleteIds.length > 0) {
    await repointChildren(supabaseAdmin, keepId, deleteIds);

    // 重複レコードを削除（is_active = false に）
    const { error: deleteErr } = await supabaseAdmin
      .from("places")
      .update({ is_active: false })
      .in("id", deleteIds);

    if (deleteErr) {
      return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, keepId, deleted: deleteIds.length });
}
