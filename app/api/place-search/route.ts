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
    const nq = normalizeName(q);
    const clean = (v: string) => v.trim().replace(/[,()%*\\]/g, "");
    // 取得を広げる: 完全変種(全角半角/カナ)＋正規化名の4文字窓(n-gram)アンカーでOR部分一致。
    //   これで「入力が長い(佐用町南光ひまわり畑)」「一語欠ける(滋賀農業ブルーメの丘←公園が抜け)」でも該当行が引ける。
    const variants = [q, nfkc, toHira(nfkc), toKata(nfkc)].map(clean).filter((v) => v.length >= 2);
    const grams: string[] = [];
    for (let i = 0; i + 4 <= nq.length; i++) grams.push(nq.slice(i, i + 4));   // 正規化名の4-gram窓
    type Row = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; open_hours?: string | null; nearest_station?: string | null };
    const SEL = "id, name, address, lat, lng, open_hours, nearest_station";
    // 2系統取得: ①精密(フル名変種)を必ず確保＝件数上限でフル一致が押し出されないように。②広域(4-gram)で一語欠け/超集合を拾う。
    const preOr = Array.from(new Set(variants.map(clean).filter((v) => v.length >= 2))).map((v) => `name.ilike.%${v}%`).join(",");
    const gramOr = Array.from(new Set(grams.map(clean).filter((v) => v.length >= 4))).slice(0, 10).map((v) => `name.ilike.%${v}%`).join(",");
    if (!preOr && !gramOr) return NextResponse.json({ ok: true, places: [] });
    const sb = supabase;
    const fetchBy = async (orExpr: string, lim: number): Promise<Row[]> => {
      if (!orExpr) return [];
      const { data } = await sb.from("places").select(SEL).eq("is_active", true).or(orExpr).limit(lim);
      return (data ?? []) as Row[];
    };
    const [preRows, gramRows] = await Promise.all([fetchBy(preOr, 30), fetchBy(gramOr, 100)]);
    const seenId = new Set<string>();
    const rowsAll = [...preRows, ...gramRows].filter((r) => { if (!r?.id || seenId.has(r.id)) return false; seenId.add(r.id); return true; });

    // 文字bigramのDice係数（挿入/欠落/語順ゆれに強い双方向類似度）。
    const bigrams = (s: string) => { const set = new Set<string>(); for (let i = 0; i + 2 <= s.length; i++) set.add(s.slice(i, i + 2)); return set; };
    const dice = (a: string, b: string) => {
      if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
      const A = bigrams(a), B = bigrams(b); let inter = 0;
      for (const g of A) if (B.has(g)) inter++;
      return (2 * inter) / (A.size + B.size);
    };
    // 類似度: 完全一致=1 / 実質同名の包含(短い名が長い名の6割以上=超集合/部分集合)=0.9 / それ以外はDice。
    //   ※短い一般名("ひまわり"が長い入力の一部)は包含でも0.9にしない＝汎用名で本命が埋もれるのを防ぐ。SIM_MIN未満は候補から外す。
    const SIM_MIN = 0.34;
    const sim = (nn: string) => {
      if (nn === nq) return 1;
      if ((nn.includes(nq) || nq.includes(nn)) && Math.min(nn.length, nq.length) / Math.max(nn.length, nq.length) >= 0.6) return 0.9;
      return dice(nq, nn);
    };
    const scored = rowsAll.map((p) => {
      const s = sim(normalizeName(p.name));
      const distM = hasCoord && p.lat != null && p.lng != null
        ? distanceMeters(latP, lngP, p.lat, p.lng)
        : null;
      return { p, s, distM };
    }).filter((x) => x.s >= SIM_MIN);
    // 並び: 類似度が高い順 → 近い順(座標のある候補を優先) → 名前の短い順（本命を上へ）
    scored.sort((a, b) => {
      if (Math.abs(a.s - b.s) > 0.001) return b.s - a.s;
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
    }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ ok: true, places: [] });
  }
}
