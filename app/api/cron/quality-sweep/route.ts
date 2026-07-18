// ── /api/cron/quality-sweep ──────────────────────────────────────────────────
// ⑪ 満足度の自動品質スイープ: 定点(気分×エリア)で /api/recommend を実行し、件数・写真被覆・薄さを採点して
//   search_quality_sweeps に保存する。毎日回すと「どの気分×エリアが弱いか」が時系列で見え、回帰(急に痩せた等)を検知できる。
//   認証: Vercel Cron の Bearer CRON_SECRET または ?secret=ADMIN_SECRET。手動確認は後者で叩ける。
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

const CRON_SECRET = process.env.CRON_SECRET ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 定点観測ケース。必ず「正規のmood文字列」を使う（moodGroupが空になりフォールバック劣化するのを避けるため）。
const CASES: Array<{ mood: string; lat: number; lng: number; area: string }> = [
  { mood: "お腹すいた",         lat: 35.681, lng: 139.767, area: "東京駅" },
  { mood: "まったりしたい",     lat: 35.681, lng: 139.767, area: "東京駅" },
  { mood: "自然感じたい",       lat: 35.625, lng: 139.243, area: "高尾" },
  { mood: "わいわい楽しみたい", lat: 35.658, lng: 139.701, area: "渋谷" },
  { mood: "体動かしたい",       lat: 35.658, lng: 139.701, area: "渋谷" },
  { mood: "集中したい",         lat: 35.681, lng: 139.767, area: "東京駅" },
  { mood: "ドライブしたい",     lat: 35.447, lng: 139.642, area: "横浜" },
  { mood: "ショッピング",       lat: 34.702, lng: 135.495, area: "大阪梅田" },
  { mood: "わいわい楽しみたい", lat: 34.668, lng: 135.501, area: "大阪難波" },
  { mood: "自然感じたい",       lat: 43.062, lng: 141.354, area: "札幌" },
];

type SweepRow = {
  swept_at: string; mood: string; area: string; lat: number; lng: number;
  count: number; photo_rate: number; score: number; thin: boolean; ok: boolean;
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const urlSecret = new URL(req.url).searchParams.get("secret");
  const isVercelCron = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
  const isAdminCall = urlSecret === ADMIN_SECRET;
  if (!isVercelCron && !isAdminCall) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const origin = new URL(req.url).origin;
  const sweptAt = new Date().toISOString();
  const rows: SweepRow[] = [];
  const weak: string[] = [];

  for (const c of CASES) {
    let count = 0, photoRate = 0, ok = false;
    try {
      const r = await fetch(`${origin}/api/recommend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: { mood: c.mood, originLat: c.lat, originLng: c.lng, radiusKm: 20, distanceFeeling: "近め", companion: "指定なし", transport: "電車" } }),
        signal: AbortSignal.timeout(30000),
      });
      const j = (await r.json().catch(() => ({}))) as { recommendations?: Array<{ photoUrls?: string[]; photoUrl?: string }> };
      const recs = Array.isArray(j.recommendations) ? j.recommendations : [];
      count = recs.length;
      const withPhoto = recs.filter((x) => (x.photoUrls?.length ?? 0) > 0 || !!x.photoUrl).length;
      photoRate = count > 0 ? Math.round((withPhoto / count) * 100) : 0;
      ok = true;
    } catch { /* タイムアウト等は count=0・ok=false で記録＝それ自体が弱点シグナル */ }

    // 簡易スコア(0-30): 件数(≤15で満点15) ＋ 写真被覆(0-15)。8件未満 or 失敗は弱点フラグ。
    const score = Math.min(count, 15) + Math.round((photoRate * 15) / 100);
    const thin = count < 8;
    rows.push({ swept_at: sweptAt, mood: c.mood, area: c.area, lat: c.lat, lng: c.lng, count, photo_rate: photoRate, score, thin, ok });
    if (thin || !ok) weak.push(`${c.mood}@${c.area}(${count}件${ok ? "" : "・失敗"})`);
    await new Promise((res) => setTimeout(res, 300));
  }

  // 保存（テーブル未作成=42P01 は握りつぶす＝supabase/add-search-quality-sweeps.sql の適用が必要）。
  let saved = false;
  if (supabase) {
    const { error } = await supabase.from("search_quality_sweeps").insert(rows);
    saved = !error;
  }

  const avg = rows.length ? Math.round((rows.reduce((a, b) => a + b.score, 0) / rows.length) * 10) / 10 : 0;
  console.log(`[cron/quality-sweep] 平均${avg}/30 弱点${weak.length}件: ${weak.join(", ")} saved=${saved}`);
  return NextResponse.json({ ok: true, sweptAt, avgScore: avg, cases: rows.length, weakSpots: weak, saved, rows });
}
