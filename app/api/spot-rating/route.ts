// ─── /api/spot-rating ────────────────────────────────────────────────────────
// MoodGo独自の星評価（Google評価から自前評価へ移行する受け皿）。
//   POST { placeId, placeName, deviceId, stars(1-5) } … 1ユーザー1スポット1票(更新可)
//   GET  ?placeId=&deviceId=                          … { avg, count, myStars }
// 検索/詳細の表示評価は、十分件数が貯まったら places.rating(Google保存値)からこの平均へ切替。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { rateLimit, clientIp } from "@/lib/rate-limit";

function isMissingTable(e: { code?: string } | null): boolean {
  return e?.code === "42P01" || e?.code === "PGRST205" || e?.code === "PGRST204";
}

// 総合評価の統計を一本化する。★セレクタ(spot_ratings)と投稿者のおすすめ度(spot_posts.rating)を
// 「同じ場所の1票」として device_id 単位で統合（★を優先し二重カウント防止）し、平均・件数・自分の票を返す。
async function aggregate(
  db: NonNullable<typeof supabase>, placeId: string | null, placeName: string, deviceId: string,
): Promise<{ avg: number | null; count: number; myStars: number; priceAvg: string | null; priceCount: number }> {
  const key = placeId || placeName;
  const { data: rData, error } = await db.from("spot_ratings").select("stars, device_id").eq("place_id", key);
  if (error && isMissingTable(error)) return { avg: null, count: 0, myStars: 0, priceAvg: null, priceCount: 0 };
  const rRows = (rData ?? []) as Array<{ stars: number; device_id: string }>;

  // 投稿者のおすすめ度＋値段(price_chip)も合算（place_id か place_name の一致・承認済み）。
  //   ※rating>0 で絞らない＝★無しでも値段だけ入れた投稿を値段平均に含めるため（★側はJSで v>=1 ガード済み）。
  let pRows: Array<{ rating: number; device_id: string; price_chip?: string | null }> = [];
  try {
    const ors: string[] = [];
    if (placeId && !/[,()]/.test(placeId)) ors.push(`place_id.eq.${placeId}`);
    if (placeName && !/[,()]/.test(placeName)) ors.push(`place_name.eq.${placeName}`);
    if (ors.length) {
      const { data } = await db.from("spot_posts")
        .select("rating, device_id, price_chip").eq("status", "approved").or(ors.join(","));
      pRows = (data ?? []) as Array<{ rating: number; device_id: string; price_chip?: string | null }>;
    }
  } catch { /* spot_posts未作成は★のみで集計 */ }

  // 旧形式の投稿(suggestions)のおすすめ度も合算。こちらはratingカラムが無く、説明文の
  // 【おすすめ度】★N マーカーに埋め込まれているため正規表現で取り出す（承認済みのみ）。
  //   ※これが無いと suggestions 由来の投稿（例: 富士見浜）は投稿者が★5を付けていても
  //     総合評価が「—」のままになる。
  let sRows: Array<{ rating: number; device_id: string }> = [];
  try {
    if (placeName && !/[,()]/.test(placeName)) {
      const { data } = await db.from("suggestions")
        .select("description, device_id").eq("spot_name", placeName).eq("status", "approved");
      for (const s of (data ?? []) as Array<{ description?: string | null; device_id?: string | null }>) {
        const m = (s.description ?? "").match(/【おすすめ度】\s*★?\s*(\d)/);
        const v = m ? Number(m[1]) : 0;
        if (v >= 1 && v <= 5) sRows.push({ rating: v, device_id: String(s.device_id ?? "") });
      }
    }
  } catch { /* suggestions無しでも安全 */ }

  // device_id ごとに統合。まず投稿おすすめ度（新旧）、その上に★セレクタを上書き（同一人物の最新意思＝★優先）。
  const byDevice = new Map<string, number>();
  const anon: number[] = [];
  for (const p of pRows) { const d = String(p.device_id ?? ""); const v = Number(p.rating); if (d && v >= 1) byDevice.set(d, v); }
  for (const p of sRows) {
    const d = p.device_id;
    if (d) { if (!byDevice.has(d)) byDevice.set(d, p.rating); }
    // 旧suggestionsはdevice_idがNULLの行が多い（富士見浜等）→ 識別できないが投稿者の
    // 正当な1票なので匿名票として数える（0票扱いより正確・★セレクタとの重複統合は不可）
    else anon.push(p.rating);
  }
  for (const r of rRows) {
    const d = String(r.device_id ?? ""); const v = Number(r.stars);
    if (!(v >= 1)) continue;
    if (d) byDevice.set(d, v); else anon.push(v);
  }
  const stars = [...byDevice.values(), ...anon];
  const count = stars.length;
  const avg = count > 0 ? Math.round((stars.reduce((a, b) => a + b, 0) / count) * 10) / 10 : null;
  const rSelf = deviceId ? rRows.find(r => r.device_id === deviceId)?.stars : undefined;
  const pSelf = deviceId ? pRows.find(p => p.device_id === deviceId)?.rating : undefined;
  const sSelf = deviceId ? sRows.find(p => p.device_id === deviceId)?.rating : undefined;
  const myStars = Number(rSelf ?? pSelf ?? sSelf ?? 0) || 0;

  // 値段の平均: 利用者が入れた price_chip を1人1票(device_id単位)で集計し、最寄りの段階に丸めて返す。
  //   段階=無料/〜¥500/〜¥1,000/〜¥3,000/¥3,000〜 を index 0〜4 に写像→平均→四捨五入で段階に戻す。
  const PRICE_ORDER = ["無料", "〜¥500", "〜¥1,000", "〜¥3,000", "¥3,000〜"];
  const priceByDevice = new Map<string, number>();
  const priceAnon: number[] = [];
  for (const p of pRows) {
    const idx = PRICE_ORDER.indexOf(String(p.price_chip ?? ""));
    if (idx < 0) continue;
    const d = String(p.device_id ?? "");
    if (d) priceByDevice.set(d, idx); else priceAnon.push(idx);
  }
  const priceIdxs = [...priceByDevice.values(), ...priceAnon];
  const priceCount = priceIdxs.length;
  const priceAvg = priceCount > 0 ? PRICE_ORDER[Math.round(priceIdxs.reduce((a, b) => a + b, 0) / priceCount)] : null;

  return { avg, count, myStars, priceAvg, priceCount };
}

export async function POST(req: Request) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });
  if (!rateLimit(`spot-rating:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "しばらく時間をおいてください" }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => null);
    const deviceId = String(body?.deviceId ?? "").trim().slice(0, 100);
    const stars = Math.round(Number(body?.stars));
    const placeId = body?.placeId ? String(body.placeId).trim().slice(0, 200) : null;
    const placeName = String(body?.placeName ?? "").trim().slice(0, 200);
    if (!deviceId) return NextResponse.json({ ok: false, error: "アプリの利用が必要です" }, { status: 401 });
    if (!(stars >= 1 && stars <= 5)) return NextResponse.json({ ok: false, error: "星は1〜5です" }, { status: 400 });
    if (!placeId && !placeName) return NextResponse.json({ ok: false, error: "スポット情報が必要です" }, { status: 400 });

    // 1ユーザー1スポット1票（place_id,device_id で upsert）。place_id 無しは place_name を識別子に流用。
    const key = placeId ?? placeName;
    const { error } = await supabase.from("spot_ratings")
      .upsert({ place_id: key, place_name: placeName || null, device_id: deviceId, stars, updated_at: new Date().toISOString() }, { onConflict: "place_id,device_id" });
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ ok: false, tableMissing: true, error: "評価は準備中です（DB更新待ち）" }, { status: 400 });
      throw error;
    }
    // 同一人物の重複票を掃除: 同じ場所でもページ経路によって識別キーが違うことがある
    // （場所詳細=supabaseId / 投稿詳細=placeId / どちらも無ければ場所名）。同じ端末＋同じ
    // 場所名で「今回と別キー」の行が残っていると、評価し直すたびに件数が二重に数えられる
    // ため、今回の票だけ残して古いキーの自分の行を削除する（他人の票には触れない）。
    if (placeName) {
      await supabase.from("spot_ratings")
        .delete().eq("device_id", deviceId).eq("place_name", placeName).neq("place_id", key)
        .then(() => {}, () => {});   // 掃除失敗は無害（次回送信で再試行される）
    }
    // 集計を返す（★＋投稿おすすめ度を統合）。自分の票は今送信した stars。
    const agg = await aggregate(supabase, placeId, placeName, deviceId);
    return NextResponse.json({ ok: true, avg: agg.avg, count: agg.count, myStars: stars, priceAvg: agg.priceAvg, priceCount: agg.priceCount });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!supabase) return NextResponse.json({ ok: true, avg: null, count: 0, myStars: 0 });
  const { searchParams } = new URL(req.url);
  const placeId = searchParams.get("placeId")?.trim();
  const placeName = searchParams.get("placeName")?.trim();
  const deviceId = searchParams.get("deviceId")?.trim() ?? "";
  const key = placeId || placeName;
  if (!key) return NextResponse.json({ ok: true, avg: null, count: 0, myStars: 0 });
  try {
    const agg = await aggregate(supabase, placeId ?? null, placeName ?? "", deviceId);
    return NextResponse.json({ ok: true, ...agg });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
