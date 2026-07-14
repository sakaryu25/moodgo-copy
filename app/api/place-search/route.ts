// ── /api/place-search ─────────────────────────────────────────────────────────
// 統一投稿フォーム(/post)の「既存スポットを検索」用。名前の部分一致でactiveなplacesを返す。
//   表記ゆれ対策(B): 全角半角(NFKC)＋カタカナ↔ひらがなの変種でも引き、正規化名で並べ替える
//   （東京ドリームパーク ≈ 東京ﾄﾞﾘｰﾑﾊﾟｰｸ ≈ 東京どりーむぱーく を同じ候補として拾う）。
//   精度UP(2026-07-14): ①一致度3段階(完全一致→前方一致→部分一致) ②lat/lngが来たら
//   近い順を優先（同名チェーンは最寄り支店が上）③距離(km)を返しクライアントで表示。
//   投稿は必ずこの候補から選ぶ運用（見つからない時だけ「新しいスポットとして追加」）＝重複抑止。
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { normalizeName, distanceMeters } from "@/lib/normalize-name";

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const toKata = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const latP = Number(searchParams.get("lat"));
  const lngP = Number(searchParams.get("lng"));
  const hasCoord = Number.isFinite(latP) && Number.isFinite(lngP);
  if (q.length < 2 || !supabase) return NextResponse.json({ ok: true, places: [] });
  try {
    // 検索キーの変種（全角半角ゆれ＝NFKC、カナ↔ひらがな）を作り、.or() でまとめて部分一致。
    //   ⚠ .or() の区切りを壊す文字（カンマ/括弧/％/*/\）は各変種から除去する。
    const nfkc = q.normalize("NFKC");
    const variants = Array.from(new Set(
      [q, nfkc, toHira(nfkc), toKata(nfkc)]
        .map((v) => v.trim().replace(/[,()%*\\]/g, ""))
        .filter((v) => v.length >= 2)
    ));
    if (variants.length === 0) return NextResponse.json({ ok: true, places: [] });
    const orExpr = variants.map((v) => `name.ilike.%${v}%`).join(",");
    const { data } = await supabase
      .from("places")
      .select("id, name, address, lat, lng, open_hours, nearest_station")
      .eq("is_active", true)
      .or(orExpr)
      .limit(60);

    type Row = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; open_hours?: string | null; nearest_station?: string | null };
    const nq = normalizeName(q);
    const scored = ((data ?? []) as Row[]).map((p) => {
      const nn = normalizeName(p.name);
      // 一致度: 0=正規化完全一致 / 1=前方一致 / 2=部分一致
      const tier = nn === nq ? 0 : nn.startsWith(nq) ? 1 : 2;
      const distM = hasCoord && p.lat != null && p.lng != null
        ? distanceMeters(latP, lngP, p.lat, p.lng)
        : null;
      return { p, tier, distM };
    });
    // 並び: 一致度 → 近い順(座標のある候補を優先) → 名前の短い順（本命を上へ）
    scored.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.distM != null && b.distM != null && Math.abs(a.distM - b.distM) > 1) return a.distM - b.distM;
      if ((a.distM != null) !== (b.distM != null)) return a.distM != null ? -1 : 1;
      return String(a.p.name ?? "").length - String(b.p.name ?? "").length;
    });

    return NextResponse.json({
      ok: true,
      places: scored.slice(0, 8).map(({ p, distM }) => ({
        id: p.id, name: p.name, address: p.address,
        openHours: p.open_hours ?? null, station: p.nearest_station ?? null,   // 場所詳細の自己解決マージ用
        dist: distM != null ? Math.round((distM / 1000) * 10) / 10 : null,   // km(小数1桁)
      })),
    });
  } catch {
    return NextResponse.json({ ok: true, places: [] });
  }
}
