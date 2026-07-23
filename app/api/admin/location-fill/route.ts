// ── /api/admin/location-fill ─────────────────────────────────────────────────
// 📍 位置情報補完（2026-07-15）: 旧「座標登録」(住所→座標) と「住所補完」(座標→住所) を統一。
//   位置が欠けたスポット（座標なし or 住所が空/日本/都道府県だけ）を1画面で双方向に補完する。
//   ・auto: 座標が無ければ 名前+住所 で forward geocode して座標＋完全住所を取得。
//           座標があれば reverse geocode で「県+市+区+町+丁目+番地」の完全住所に。
//   ・完全住所形式（例: 神奈川県横浜市金沢区富岡東1-44-11）で保存＝検索の距離/地名精度が上がる。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";
import { forwardGeocode as forwardFree } from "@/lib/forward-geocode";
import { yahooReverseGeocode } from "@/lib/yahoo-reverse-geocode";

const PREFS =["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];

// 住所が「未登録相当」か（空 / 日本 / 都道府県だけ）＝補完対象
function isIncompleteAddr(a: string | null | undefined): boolean {
  const t = String(a ?? "").replace(/^日本[、,\s]*/, "").trim();
  return !t || t === "日本" || t === "日本国" || PREFS.includes(t);
}
function prefOf(a: string | null | undefined): string {
  const t = String(a ?? "").replace(/^日本[、,\s]*/, "").trim();
  return PREFS.find((p) => t.startsWith(p)) ?? "";
}
// 完全住所化: 国名・郵便番号だけ除き、丁目・番地は残す（例: 神奈川県横浜市金沢区富岡東1-44-11）
function cleanFull(addr: string): string {
  return String(addr ?? "").replace(/^日本[、,]\s*/, "").replace(/〒?\s*\d{3}-?\d{4}\s*/, "").trim();
}

// 逆引き(座標→完全住所): Yahoo(無料・番地まで)のみ。Google課金は使わない（完全無料方針・2026-07-15）
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const y = await yahooReverseGeocode(lat, lng);
    if (y?.fullAddress) return cleanFull(y.fullAddress) || null;
  } catch { /* 無料で取れなければ住所なし */ }
  return null;
}
// 正引き(住所/名前→座標): 完全無料。lib forwardGeocode が GSI(国土地理院)→Yahoo の順で座標を返す（Google不使用）。
//   ※完全住所は取得した座標を上の reverseGeocode(Yahoo無料) にかけて得る＝正引きも実質無料で完結
async function forwardGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  try { return await forwardFree(q); } catch { return null; }
}

type Row = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; tags: string[] | null; table?: TableKey };

// 補完対象の3テーブル。検索プールは places(メイン)＋suggestions(承認済み投稿/企業掲載)＋
//   curated_spots(タグ別キュレーション)の合算なので、住所「日本」もこの3つに散らばる。
//   各テーブルで名前カラムと「表示中」判定条件が違うため、ここで吸収して統一的に補完する。
type TableKey = "places" | "suggestions" | "curated_spots";
const TABLES: Record<TableKey, { nameCol: string; tagCol: string; active: [string, unknown] }> = {
  places:        { nameCol: "name",      tagCol: "tags",      active: ["is_active", true] },
  suggestions:   { nameCol: "spot_name", tagCol: "auto_tags", active: ["status", "approved"] },
  curated_spots: { nameCol: "name",      tagCol: "tags",      active: ["is_active", true] },
};
const TABLE_KEYS = Object.keys(TABLES) as TableKey[];

// 補完対象の or 条件（座標なし OR 住所が空/日本/都道府県だけ）。全テーブル共通。
function incompleteOrExpr(): string {
  const eqs = ["日本", "日本国", ...PREFS, ...PREFS.map((p) => `日本、${p}`)];
  return ["lat.is.null", "lng.is.null", "address.is.null", ...eqs.map((v) => `address.eq."${v}"`)].join(",");
}

// 1件を双方向補完（座標なし→forward / 住所不完全→reverse）。戻り値=更新後の値 or null
async function autoFill(db: NonNullable<typeof supabase>, row: Row): Promise<{ lat: number | null; lng: number | null; address: string } | null> {
  let lat = row.lat, lng = row.lng, address = row.address ?? "";
  // ① 座標が無ければ forward（住所が具体的ならそれ、無ければ 名前+都道府県、最後に名前だけ）
  if (lat == null || lng == null) {
    const pref = prefOf(row.address);
    const candidates = [
      !isIncompleteAddr(row.address) ? String(row.address) : "",
      row.name ? `${row.name} ${pref}`.trim() : "",
      row.name || "",
    ].filter(Boolean);
    for (const q of candidates) {
      const g = await forwardGeocode(q);
      if (g) { lat = g.lat; lng = g.lng; break; }
    }
  }
  // ② 座標があり住所が不完全なら reverse(Yahoo無料)で完全住所を得る＝正引きも実質無料で完結
  if (lat != null && lng != null && isIncompleteAddr(address)) {
    const rev = await reverseGeocode(lat, lng);
    if (rev) address = rev;
  }
  const patch: Record<string, unknown> = {};
  if (lat != null && lng != null && (row.lat == null || row.lng == null)) { patch.lat = lat; patch.lng = lng; }
  if (address && address !== (row.address ?? "") && !isIncompleteAddr(address)) patch.address = address;
  if (Object.keys(patch).length === 0) return null;   // 何も改善できなかった
  const { error } = await db.from(row.table ?? "places").update(patch).eq("id", row.id);
  if (error) return null;
  return { lat, lng, address };
}

// 1テーブルから補完対象を取得（名前カラムを name に正規化・テーブル未作成は空）
async function fetchIncomplete(db: NonNullable<typeof supabase>, table: TableKey, limit: number): Promise<Row[]> {
  const cfg = TABLES[table];
  try {
    const { data, error } = await db.from(table)
      .select(`id, ${cfg.nameCol}, address, lat, lng, ${cfg.tagCol}`)
      .eq(cfg.active[0], cfg.active[1] as never)
      .or(incompleteOrExpr()).order("id").limit(limit);
    if (error) return [];
    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id), name: String(r[cfg.nameCol] ?? ""),
      address: (r.address as string | null) ?? null,
      lat: (r.lat as number | null) ?? null, lng: (r.lng as number | null) ?? null,
      tags: (r[cfg.tagCol] as string[] | null) ?? null, table,
    }));
  } catch { return []; }
}

// 全テーブルの補完対象「真の総数」（テーブル別内訳つき）
async function countIncompleteAll(db: NonNullable<typeof supabase>): Promise<{ total: number; byTable: Record<string, number> }> {
  const byTable: Record<string, number> = {};
  let total = 0;
  for (const table of TABLE_KEYS) {
    const cfg = TABLES[table];
    try {
      const { count } = await db.from(table).select("id", { count: "exact", head: true })
        .eq(cfg.active[0], cfg.active[1] as never).or(incompleteOrExpr());
      byTable[table] = count ?? 0;
      total += count ?? 0;
    } catch { byTable[table] = 0; }
  }
  return { total, byTable };
}

export async function GET(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (new URL(req.url).searchParams.get("secret") !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().replace(/[,%()*]/g, "").slice(0, 60);
  const limit = Math.min(Number(searchParams.get("limit") ?? "300"), 1000);

  // 座標なし OR 住所不完全 のスポットを3テーブル(places/suggestions/curated_spots)から取得して統合。
  //   ⚠order は id(主キー索引)。name順は未索引ソートで statement timeout(実測)＝JSソートで対応。
  const per = q ? 800 : limit;
  const all: Row[] = [];
  for (const table of TABLE_KEYS) all.push(...await fetchIncomplete(supabase, table, per));
  let rows = all.map((r) => ({ ...r, noCoord: r.lat == null || r.lng == null, badAddr: isIncompleteAddr(r.address) }));
  if (q) rows = rows.filter((r) => String(r.name ?? "").includes(q) || String(r.address ?? "").includes(q));
  rows.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja"));  // 表示は名前順(軽い)
  rows = rows.slice(0, limit);

  // 補完対象の「真の総数」（3テーブル合算・テーブル別内訳つき）。名前絞り込み時は取得済みの件数のみ。
  let total: number | null = null;
  let byTable: Record<string, number> | undefined;
  if (!q) { const c = await countIncompleteAll(supabase); total = c.total; byTable = c.byTable; }
  return NextResponse.json({ ok: true, count: rows.length, total, byTable, places: rows });
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  const db = supabase;
  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const action = String(body?.action ?? "");

  // どのテーブルの行かを body.table で受ける（未指定は places＝旧クライアント互換）
  const table: TableKey = TABLE_KEYS.includes(body?.table) ? body.table : "places";
  const cfg = TABLES[table];

  // 手動保存（座標 and/or 住所）
  if (action === "save") {
    const id = String(body?.placeId ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "placeId必須" }, { status: 400 });
    const patch: Record<string, unknown> = {};
    if (typeof body.lat === "number" && Number.isFinite(body.lat)) patch.lat = body.lat;
    if (typeof body.lng === "number" && Number.isFinite(body.lng)) patch.lng = body.lng;
    if (typeof body.address === "string" && body.address.trim()) patch.address = body.address.trim().slice(0, 300);
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: "変更なし" }, { status: 400 });
    const { error } = await db.from(table).update(patch).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, patch });
  }

  // 1件 自動補完
  if (action === "auto") {
    const id = String(body?.placeId ?? "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "placeId必須" }, { status: 400 });
    const { data } = await db.from(table).select(`id, ${cfg.nameCol}, address, lat, lng, ${cfg.tagCol}`).eq("id", id).maybeSingle();
    if (!data) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const d = data as unknown as Record<string, unknown>;
    const row: Row = { id: String(d.id), name: String(d[cfg.nameCol] ?? ""), address: (d.address as string | null) ?? null, lat: (d.lat as number | null) ?? null, lng: (d.lng as number | null) ?? null, tags: null, table };
    const r = await autoFill(db, row);
    if (!r) return NextResponse.json({ ok: false, error: "補完できませんでした（名前/住所から特定不可）" }, { status: 200 });
    return NextResponse.json({ ok: true, ...r });
  }

  // 一括 自動補完（1呼び出し=3テーブル各25件・コスト/タイムアウト対策。クライアントがdoneまで再呼び出し）。
  //   3テーブルを毎回処理＝1テーブルの補完不能行が他テーブルの進行をブロックしない。
  if (action === "auto-batch") {
    let processed = 0, filled = 0;
    for (const t of TABLE_KEYS) {
      const rows = await fetchIncomplete(db, t, 25);
      processed += rows.length;
      for (const row of rows) { if (await autoFill(db, row)) filled++; }
    }
    // done: 全テーブルで対象が尽きた or この回で1件も改善できなかった（補完不能行だけ残った＝無限ループ回避）
    return NextResponse.json({ ok: true, processed, filled, done: processed === 0 || filled === 0 });
  }

  return NextResponse.json({ ok: false, error: "action は auto | auto-batch | save" }, { status: 400 });
}
