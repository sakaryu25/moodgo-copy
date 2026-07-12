export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;   // 一括統合はカーソル継続式（1呼び出し=約40秒分・クライアントがdoneまで再呼び出し）
import { NextRequest, NextResponse } from "next/server";
import { supabase as supabaseAdmin } from "@/lib/supabase";
import { isAdminRequest, requireAdminFromReq } from "@/lib/admin-auth";

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

// クラスタ内で残す1件を選ぶ: google_place_id持ち > 座標持ち > タグ数
function pickKeeper(cluster: Row[]): Row {
  return [...cluster].sort((a, b) => {
    const g = Number(!!b.google_place_id) - Number(!!a.google_place_id);
    if (g !== 0) return g;
    const c = Number(b.lat != null && b.lng != null) - Number(a.lat != null && a.lng != null);
    if (c !== 0) return c;
    return (b.tags?.length ?? 0) - (a.tags?.length ?? 0);
  })[0];
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
  // 写真の付け替え（運営写真place_photos＋ユーザー写真spot_photos。無テーブル/失敗は無害に continue）
  await db.from("place_photos").update({ place_id: keeper.id }).in("place_id", ids).then(() => {}, () => {});
  await db.from("spot_photos").update({ place_id: keeper.id }).in("place_id", ids).then(() => {}, () => {});
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

// GET: 同名スポットのグループ一覧（手動統合UI用）。45万行あるため先頭からのスキャンで
//   最大60グループ見つけた時点/時間切れで打ち切り、partial=true を返す。
export async function GET(req: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (!requireAdminFromReq(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
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

  return NextResponse.json({ ok: true, groups, count: groups.length, partial: !done, scanned });
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

  // 削除対象の写真を残すレコードに付け替え（運営写真＋ユーザー写真。一括統合と同挙動）
  if (deleteIds.length > 0) {
    await supabaseAdmin
      .from("place_photos")
      .update({ place_id: keepId })
      .in("place_id", deleteIds);
    await supabaseAdmin
      .from("spot_photos")
      .update({ place_id: keepId })
      .in("place_id", deleteIds)
      .then(() => {}, () => {});

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
