// ── /api/place-search ─────────────────────────────────────────────────────────
// 統一投稿フォーム(/post)の「既存スポットを検索」用。名前の部分一致でactiveなplacesを返す。
//   表記ゆれ対策(B): 全角半角(NFKC)＋カタカナ↔ひらがなの変種でも引き、正規化名で並べ替える
//   （東京ドリームパーク ≈ 東京ﾄﾞﾘｰﾑﾊﾟｰｸ ≈ 東京どりーむぱーく を同じ候補として拾う）。
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { normalizeName } from "@/lib/normalize-name";

const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const toKata = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
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
      .select("id, name, address")
      .eq("is_active", true)
      .or(orExpr)
      .limit(40);
    // 正規化名で「前方一致→短い名前」順に並べ替え、被り候補の本命を上位に。
    const nq = normalizeName(q);
    const sorted = (data ?? []).slice().sort((a, b) => {
      const an = normalizeName(a.name), bn = normalizeName(b.name);
      const ap = an.startsWith(nq) ? 0 : 1;
      const bp = bn.startsWith(nq) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return String(a.name ?? "").length - String(b.name ?? "").length;
    });
    return NextResponse.json({
      ok: true,
      places: sorted.slice(0, 8).map((p) => ({ id: p.id, name: p.name, address: p.address })),
    });
  } catch {
    return NextResponse.json({ ok: true, places: [] });
  }
}
