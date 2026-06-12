#!/usr/bin/env node
// ─── 検索精度の回帰テスト ─────────────────────────────────────────────────────
// 全気分×深掘りの本番(またはローカル)検索を実行し、ジャンル純度・ゴミ混入・
// 距離ロジックを自動検証する。デプロイ後に1コマンドで精度の退行を検出できる。
//
// 使い方:
//   node scripts/verify-search.mjs                       # 本番(moodgo-qvmk)に対して実行
//   BASE=http://localhost:3000 node scripts/verify-search.mjs   # ローカル
//   node scripts/verify-search.mjs --quick               # 距離検証をスキップ(高速)
//
// 合格条件: 件数>=10 / ゴミ(株式会社等)ゼロ / 上位10件のジャンル一致>=50% / 先頭<=12km
// 距離検証: 県またぎ=先頭25km以上(遠方優先) / 近場でいい=先頭6km以内

const BASE = process.env.BASE ?? "https://moodgo-qvmk.vercel.app";
const AREA = "神奈川県横浜市金沢区富岡西1丁目55-11";
const QUICK = process.argv.includes("--quick");

const JUNK = /株式会社|合同会社|有限会社|墓石|仏壇|結婚相談|携帯|ドコモ|ソフトバンク|新車|中古車|レッカー|ラブホテル|営業所|事業所|オートバイ|麻雀|ゴルフ練習/;

// (mood, 深掘りL1, ジャンル期待regex)
const COMBOS = [
  ["自然", "波の音と海風", /海|浜|ビーチ|岬|磯|湾|港|マリン|島|シーサイド|ベイ|渚|臨海/],
  ["自然", "森の中で深呼吸", /森|公園|緑|自然|渓谷|植物|園/],
  ["自然", "広い芝生でゴロゴロ", /公園|緑|植物|芝|園|広場/],
  ["自然", "圧倒的な絶景", /展望|タワー|景|岬|山|丘|デッキ|スカイ|富士|海|湖/],
  ["まったり", "サウナ・岩盤浴", /湯|温泉|サウナ|スパ|銭湯|岩盤/],
  ["まったり", "温泉施設全般", /湯|温泉|スパ|銭湯|サウナ/],
  ["まったり", "ブックカフェ・隠れカフェ", /カフェ|珈琲|喫茶|ブック|本|cafe|coffee/i],
  ["まったり", "動物カフェ", /猫|犬|うさぎ|ふくろう|ハリネズミ|アニマル|カフェ|どうぶつ|動物/],
  ["まったり", "景色良いカフェ", /カフェ|珈琲|喫茶|テラス|cafe|coffee|kitchen|キッチン|堂|tea/i],
  ["お腹すいた", "ラーメン", /ラーメン|らーめん|麺|そば(?!処)|軒|家|屋台/],
  ["お腹すいた", "高層ビル料理", /展望|スカイ|sky|タワー|tower|ルーフ|ラウンジ|高層|夜景|ホテル|テラス|ヒルズ|ガーデン|ビュー|グリル|ダイニング|レストラン/i],
  ["楽しみたい", "王道で遊ぶ", /遊園地|パーク|ランド|カラオケ|テーマ|ジョイポリ|レジャー|ワールド|キッズ|ゲーム|GiGO|ナムコ|アミューズ|ボウル|ファンタジー|大世界|プラネット/i],
  ["楽しみたい", "アクティブに遊ぶ", /ボウリング|ボウル|ゲーム|カラオケ|ビリヤード|ダーツ|謎解き|脱出|アミューズ|ラウンドワン|タイトー|GiGO|ナムコ|セガ|スポッチャ|キッズ|パーク/i],
  ["楽しみたい", "観て楽しむ", /水族館|動物園|映画|シネマ|劇場|美術館|博物館|ミュージアム|プラネタ|アクアリウム|シアター|科学館/],
  ["楽しみたい", "つくる・体験", /体験|工房|陶芸|教室|工場|ワークショップ|スタジオ|手作り|手づくり|クラフト|ものづくり|センター/],
  ["ドライブ", "海沿いを爽快に走りたい", /海|浜|ビーチ|岬|マリン|港|湾|島|シーサイド|ベイ|渚|臨海/],
  ["ドライブ", "綺麗な景色や夜景を見に行きたい", /展望|夜景|景|タワー|山|丘|公園|スカイ|デッキ/],
  ["ドライブ", "道の駅でご当地グルメ", /道の駅|市場|直売|マルシェ|物産|食堂|グルメ|漁/],
  ["ドライブ", "郊外の大型施設に行きたい", /モール|アウトレット|ららぽーと|イオン|百貨店|ショッピング|プラザ|デパート|マルイ|高島屋|髙島屋|ルミネ|パルコ|そごう/],
  ["集中", "カフェで作業・勉強したい", /カフェ|珈琲|喫茶|スタバ|スターバックス|タリーズ|ドトール|コメダ|cafe|coffee|ラウンジ|マクドナルド|ガスト/i],
  ["集中", "静かな専用スペースで集中したい", /図書|自習|コワーキング|スタディ|ラーニング|勉強|ライブラリ|文庫|センター/],
  ["運動", "がっつり運動", /ジム|フィットネス|スポーツ|ボルダリング|トランポリン|クライミング|プール|GYM|体育|カーブス|ZAP|ルネサンス|エニタイム|ジョイフィット|ティップネス|ゴールド/i],
  ["運動", "外でひろびろ", /公園|アスレチック|広場|グラウンド|スポーツ|ランニング|フィールド|テニス|野球/],
  ["運動", "室内でのんびり", /ボウリング|ボウル|バッティング|卓球|ビリヤード|ダーツ|ラウンドワン|スポッチャ|アミューズ|ゲーム|カラオケ/],
  ["運動", "ゲーム感覚で", /ボウリング|ボウル|カラオケ|ビリヤード|ダーツ|ラウンドワン|スポッチャ|トランポリン|ゲーム|アミューズ|GiGO|ランド/i],
  ["旅行", "パワースポット", /神社|神宮|大社|寺|稲荷|八幡|不動|観音|宮|院|堂/],
  ["旅行", "別世界のテーマパーク", /遊園地|パーク|ランド|テーマ|リゾート|ピューロ|シーパラ|ワールド|八景島/],
  ["旅行", "知らない街をぶらぶら", /商店街|横丁|中華街|通り|市場|街|ストリート|小町|仲見世|門前|参道|銀座|マーケット|モール|タウン|レンガ|島|港|倉庫|水族館|ミュージアム/],
  ["旅行", "息を呑む絶景", /展望|夜景|景|岬|山|タワー|湖|滝|丘|海|緑地/],
  ["ショッピング", "古着・ヴィンテージ", /古着|ヴィンテージ|ビンテージ|vintage|セカンド|セカスト|オフハウス|モードオフ|リサイクル|USED|2nd/i],
  ["ショッピング", "雑貨・インテリア", /雑貨|インテリア|家具|ロフト|ハンズ|無印|フランフラン|ニトリ|IKEA|スリーコインズ|3COINS|セリア|ダイソー|キャンドゥ|生活/i],
  ["ショッピング", "大型ショッピングモール", /モール|アウトレット|ららぽーと|イオン|百貨店|ショッピング|プラザ|デパート|マルイ|高島屋|髙島屋|ルミネ|パルコ|そごう|OUTLET/i],
];

// 距離ロジック検証（[mood, dive] × 距離設定）
const FAR_COMBOS = [
  ["自然", "波の音と海風"], ["まったり", "サウナ・岩盤浴"],
  ["楽しみたい", "王道で遊ぶ"], ["旅行", "パワースポット"],
];
const NEAR_COMBOS = [["自然", "森の中で深呼吸"], ["まったり", "温泉施設全般"]];

async function search(mood, dive, feeling) {
  const answers = {
    mood, areaMode: "manual", area: AREA, companion: "友達", distanceFeeling: feeling,
    ...(dive ? { dynamicQs: [{ question: "深掘りカテゴリ", answer: dive }] } : {}),
  };
  try {
    const res = await fetch(`${BASE}/api/recommend`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
      signal: AbortSignal.timeout(110000),
    });
    const d = await res.json();
    return d.recommendations ?? [];
  } catch (e) {
    console.error(`  ⚠ リクエスト失敗: ${e.message}`);
    return [];
  }
}

const kmOf = (x) => {
  if (typeof x.distanceKm === "number") return x.distanceKm;
  const m = /\/\s*([\d.]+)\s*km/.exec(x.distanceText ?? "");
  return m ? parseFloat(m[1]) : null;
};

let pass = 0, fail = 0;
const failures = [];

console.log(`検索精度 回帰テスト — ${BASE}\n`);
console.log("==== ジャンル純度（近場でいい）====");
for (const [mood, dive, posRe] of COMBOS) {
  const r = await search(mood, dive, "近場でいい");
  const names = r.map((x) => x.title ?? x.name ?? "");
  const junk = names.filter((n) => JUNK.test(n));
  const top10 = names.slice(0, 10);
  const hit = top10.filter((n) => posRe.test(n)).length;
  const ratio = top10.length ? hit / top10.length : 0;
  const d1 = r.length ? kmOf(r[0]) : null;
  const ok = r.length >= 10 && junk.length === 0 && ratio >= 0.5 && (d1 === null || d1 <= 12);
  ok ? pass++ : fail++;
  const line = `${ok ? "✅" : "❌"} ${mood}/${dive}: ${r.length}件 一致${Math.round(ratio * 100)}% 先頭${d1?.toFixed(1) ?? "?"}km${junk.length ? " junk=" + junk.slice(0, 2).join(",") : ""}`;
  console.log(line);
  if (!ok) failures.push(line + `\n    上位: ${top10.slice(0, 5).join(" / ")}`);
}

if (!QUICK) {
  console.log("\n==== 距離: 県またぎもあり（先頭>=25km）====");
  for (const [mood, dive] of FAR_COMBOS) {
    const r = await search(mood, dive, "県またぎもあり");
    const d1 = r.length ? kmOf(r[0]) : null;
    const ok = d1 !== null && d1 >= 25;
    ok ? pass++ : fail++;
    console.log(`${ok ? "✅" : "❌"} ${mood}/${dive}: 先頭${d1?.toFixed(1) ?? "?"}km`);
    if (!ok) failures.push(`距離(遠) ${mood}/${dive}: 先頭${d1}km`);
  }
  console.log("\n==== 距離: 近場でいい（先頭<=6km）====");
  for (const [mood, dive] of NEAR_COMBOS) {
    const r = await search(mood, dive, "近場でいい");
    const d1 = r.length ? kmOf(r[0]) : null;
    const ok = d1 !== null && d1 <= 6;
    ok ? pass++ : fail++;
    console.log(`${ok ? "✅" : "❌"} ${mood}/${dive}: 先頭${d1?.toFixed(1) ?? "?"}km`);
    if (!ok) failures.push(`距離(近) ${mood}/${dive}: 先頭${d1}km`);
  }
}

console.log(`\n━━━━ 結果: ${pass}/${pass + fail} 合格 ━━━━`);
if (failures.length) {
  console.log("\n不合格の詳細:");
  for (const f of failures) console.log("  " + f);
}
process.exit(fail === 0 ? 0 : 1);
