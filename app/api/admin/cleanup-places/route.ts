import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { ADMIN_SECRET } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;   // 会社一括削除は候補選別＋チャンク削除で時間がかかりうる

// ── 会社・事業所（お店ではない事業体）の判定 ──────────────────────────────────
// OSM/オープンデータ由来で紛れ込んだ法人拠点を対象にする。
//   対象: 法人格マーカー（株式会社/(株)等）・事業拠点（営業所/事業所/事務所/出張所/本社/支社）・
//         事業体接尾語（商事/興業/工務店/建設/運輸/製作所 等）
//   ⚠ 誤爆ガード: 店舗/観光の可能性がある語（カフェ/見学/記念館/直売/酒蔵等）を含む名前は残す。
//     「本店/支店」は飲食店名に多いので対象にしない。「工場/倉庫」も見学施設・リノベ店舗があるため対象外。
const CORP_MARKERS = [
  "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
  "（株）", "(株)", "㈱", "（有）", "(有)", "㈲", "（同）", "(同)",
  "営業所", "事業所", "事務所", "出張所", "本社", "支社",
  "商事", "興業", "興産", "工務店", "建設", "運輸", "運送", "設備", "電設", "塗装", "鉄工", "製作所",
];
const CORP_RE = new RegExp(CORP_MARKERS.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
// SAFE判定は法人マーカーを取り除いた残りで行う（「○○工務店」の店がSAFE「店」に化けるのを防ぐ）
const CORP_STRIP_RE = new RegExp(CORP_MARKERS.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
// 店舗・観光施設の可能性がある語＝残す（会社名でもユーザーが行ける場所なら消さない）。
//   実データのプレビューで見つけた誤爆から拡充: 肉汁餃子製作所(飲食)・パシフィックボウル(ボウリング)・
//   清水建設ラグビー場(スポーツ施設)・神社の「本社(もとやしろ)」・酒ミュージアム・友安製作所Cafe 等。
const SAFE_RE = new RegExp([
  // 飲食
  "カフェ", "cafe", "coffee", "珈琲", "喫茶", "茶房", "レストラン", "restaurant", "食堂", "居酒屋", "酒場", "バル", "バー", "bar", "ダイニング",
  "ラーメン", "らーめん", "らあめん", "うどん", "そば", "蕎麦", "寿司", "鮨", "焼肉", "焼き鳥", "焼鳥", "餃子", "ギョーザ", "ピザ", "pizza", "パスタ", "バーガー", "burger",
  "カレー", "丼", "定食", "弁当", "惣菜", "ベーカリー", "bakery", "パン", "スイーツ", "菓子", "ケーキ", "クレープ", "ジェラート", "アイス", "タピオカ",
  // 宿・湯
  "ホテル", "hotel", "旅館", "民宿", "ゲストハウス", "温泉", "銭湯", "湯", "サウナ", "スパ",
  // 公共・文化
  "公園", "広場", "美術館", "博物館", "記念館", "資料", "史料", "文学館", "科学館", "展示", "碑", "礎", "学校", "ミュージアム", "museum", "水族館", "動物園", "植物園",
  "劇場", "ホール", "ギャラリー", "gallery", "図書館", "文化",
  // 社寺
  "神社", "神宮", "大社", "稲荷", "八幡", "天満宮", "拝殿", "本殿", "鳥居", "寺", "observatory", "教会", "聖堂", "地蔵", "観音", "不動",
  // 体験・見学・買い物
  "見学", "体験", "工房", "醸造", "ワイナリー", "winery", "ブルワリー", "brewery", "酒蔵", "酒造", "蒸溜所", "蒸留所", "牧場", "農園", "果樹園",
  "ショールーム", "直売", "売店", "市場", "マルシェ", "ストア", "store", "ショップ", "shop", "マーケット", "market", "モール", "百貨店", "書店", "本屋",
  // スポーツ・遊び
  "スタジオ", "studio", "ジム", "gym", "フィットネス", "ゴルフ", "ボウリング", "ボーリング", "ボウル", "bowl", "カラオケ", "ビリヤード", "ダーツ",
  "テニス", "ラグビー", "サッカー", "フットサル", "野球", "球場", "競技場", "運動場", "グラウンド", "体育館", "アリーナ", "プール", "スケート",
  "バッティング", "アスレチック", "キャンプ", "グランピング", "釣り", "フィッシング", "マリーナ", "乗馬", "クラブ",
  // 全域dryRunの精査で追加: 「○○店」付き=お店(呉服店/商店/三条店等。支店は除く)・
  // 観光会社(ゴジラ岩観光=クルーズ乗り場)・菓房(菓子屋の直売)・跡/遺構/廃墟=探訪スポット・ヶ丸=山名(本社ヶ丸)
  "(?<!支)店", "観光", "菓", "跡", "遺構", "廃", "ヶ丸", "展望",
].join("|"), "i");

function isCompanyJunk(name: string, sourceType?: string | null): "corp" | "safe" | "no" {
  const n = (name ?? "").trim();
  if (!n || !CORP_RE.test(n)) return "no";
  // 心霊スポット(ghostmap由来)はキュレーション済みの行き先＝会社名っぽくても消さない
  //   （例: 前川自動車板金塗装工場(首吊り工場)・旧○○株式会社工場 等の廃墟系）
  if ((sourceType ?? "").toLowerCase().includes("ghost")) return "safe";
  // マーカー自体を除いた残りにSAFE語があるか（(株)大西鶏卵店→鶏卵「店」で残す／○○工務店→残りにSAFE無し→削除）
  const stripped = n.replace(CORP_STRIP_RE, "");
  return SAFE_RE.test(stripped) ? "safe" : "corp";
}

function isSubFacility(address: string): boolean {
  // 商業・エンタメ系の大型施設に限定して「〇〇内」を検出
  // 公園・センター・ガーデン等の公共施設は除外（広場・展望台等は独立スポットとして有効）
  return /[ァ-ヶー一-龥々]{2,}(シーパラダイス|ハイランド|アミューズメントパーク|テーマパーク|遊園地|アウトレット|ショッピングモール|ゆめタウン|イオンモール|サファリパーク|マリンパーク|アドベンチャーワールド)内/.test(address);
}

export async function POST(req: NextRequest) {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase未設定" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (body?.secret !== ADMIN_SECRET) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const namePattern: string | null    = body.namePattern ?? null;
  const addressPattern: string | null = body.addressPattern ?? null;
  const tag: string | null            = body.tag ?? null;
  const subFacilityOnly: boolean      = body.subFacilityOnly === true;
  const directIds: string[] | null    = Array.isArray(body.ids) ? body.ids : null;
  const dryRun: boolean               = body.dryRun !== false;

  // IDs直接指定モード
  if (directIds) {
    const { data: targets } = await supabase.from("places").select("id, name").in("id", directIds);
    const names = (targets ?? []).map((r: { name: string }) => r.name);
    const count = directIds.length;
    if (!dryRun && count > 0) {
      const { error: delErr } = await supabase.from("places").delete().in("id", directIds);
      if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, dryRun, count, names });
  }

  // ── 会社・事業所モード: 法人拠点らしき名前を全域から抽出して一括削除 ──────────
  //   ⚠45万行にOR-ilikeを打つとseq scanでstatement timeoutになる（実測）。
  //   → id昇順(主キー索引スキャン＝タイムアウト無縁)で素のページ走査し、判定は全部JSで行う。
  //   1呼び出し≈35秒で打ち切り nextCursor を返す。クライアントは complete:true まで再呼び出し。
  //   実行(削除)モードは走査中に見つけた対象をその場で1000件ずつ削除してからカーソルを返す。
  if (body.companiesOnly === true) {
    const startedAt = Date.now();
    const TIME_BUDGET_MS = 35_000;
    let cursorId = typeof body.cursor === "string" ? body.cursor : "";
    const corp: { id: string; name: string }[] = [];
    const sampleSafe: string[] = [];
    let excludedSafe = 0;
    let scanned = 0;
    let complete = false;

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      let q = supabase.from("places").select("id, name, source_type").order("id", { ascending: true }).limit(1000);
      if (cursorId) q = q.gt("id", cursorId);
      const { data, error } = await q;
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      const rows = (data ?? []) as { id: string; name: string; source_type?: string | null }[];
      if (rows.length === 0) { complete = true; break; }
      scanned += rows.length;
      for (const r of rows) {
        const v = isCompanyJunk(r.name, r.source_type);
        if (v === "corp") corp.push(r);
        else if (v === "safe") { excludedSafe++; if (sampleSafe.length < 15) sampleSafe.push(r.name); }
      }
      cursorId = rows[rows.length - 1].id;
      if (rows.length < 1000) { complete = true; break; }
    }

    let deleted = 0;
    if (!dryRun && corp.length > 0) {
      for (let i = 0; i < corp.length; i += 1000) {
        const chunk = corp.slice(i, i + 1000).map(r => r.id);
        const { error: delErr } = await supabase.from("places").delete().in("id", chunk);
        if (delErr) return NextResponse.json({ ok: false, error: delErr.message, deleted }, { status: 500 });
        deleted += chunk.length;
      }
    }

    return NextResponse.json({
      ok: true, dryRun, mode: "companies",
      count: corp.length, deleted, excludedSafe, scanned, complete,
      nextCursor: complete ? null : cursorId,
      names: corp.slice(0, 200).map(r => r.name), safeSamples: sampleSafe,
    });
  }

  if (!namePattern && !addressPattern && !tag && !subFacilityOnly) {
    return NextResponse.json({ ok: false, error: "namePattern / addressPattern / tag / subFacilityOnly のいずれかが必要です" }, { status: 400 });
  }

  // 対象スポットを検索
  let query = supabase.from("places").select("id, name, address, tags");
  if (namePattern)    query = query.ilike("name", `%${namePattern}%`);
  if (addressPattern) query = query.ilike("address", `%${addressPattern}%`);
  if (tag)            query = query.contains("tags", [tag]);
  // subFacilityOnly は全件取得してJS側でフィルタ
  if (subFacilityOnly) query = query.ilike("address", "%内%");

  const { data: rawTargets, error: selectErr } = await query;
  if (selectErr) return NextResponse.json({ ok: false, error: selectErr.message }, { status: 500 });

  // subFacilityOnly の場合はJS側で精密フィルタ
  const targets = subFacilityOnly
    ? (rawTargets ?? []).filter((r: { address: string }) => isSubFacility(r.address ?? ""))
    : (rawTargets ?? []);

  const names = targets.map((r: { name: string }) => r.name);
  const ids   = targets.map((r: { id: string }) => r.id);
  const count = ids.length;

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, count, names });
  }

  if (count === 0) {
    return NextResponse.json({ ok: true, dryRun: false, count: 0, names: [] });
  }

  const { error: deleteErr } = await supabase.from("places").delete().in("id", ids);
  if (deleteErr) return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, dryRun: false, count, names });
}
