// ── チェーン店判定（投稿→全国支店の自動展開用）────────────────────────────────
// ユーザーが投稿した店がチェーンなら、検索時に「検索した人の近くの支店」をライブ展開する。
// ここは純粋な判定のみ（辞書＋detect）。支店取得(Yahoo/OSM)・表示は recommend 側。
// ⚠実在店の“偽データ”は作らない: 支店の住所/URL/写真は各支店の実データ(Yahoo/OSM/Google)を使う。

export type ChainGenre = 'cafe' | 'food' | 'shop';

export type ChainDef = {
  key: string;        // 一意キー
  re: RegExp;         // 投稿店名がこのチェーンか判定
  query: string;      // Yahoo/OSM で支店を探す検索語（正式ブランド名）
  brand?: string;     // OSM の brand タグ（あれば精度が上がる）
  genre: ChainGenre;  // 飲食ゲート等の補助（食べ物系か）
};

// 既存 CHAIN_BRAND_RE（route.ts）を構造化。飲食チェーン＝food/cafe、買取/古着＝shop。
export const CHAIN_DEFS: ChainDef[] = [
  // ── カフェ ──
  { key: 'starbucks',   re: /スターバックス|スタバ|starbucks/i, query: 'スターバックス', brand: 'スターバックス', genre: 'cafe' },
  { key: 'doutor',      re: /ドトール|doutor/i,               query: 'ドトール',       brand: 'ドトール',       genre: 'cafe' },
  { key: 'tullys',      re: /タリーズ|tully/i,                query: 'タリーズコーヒー', brand: 'タリーズコーヒー', genre: 'cafe' },
  { key: 'excelsior',   re: /エクセルシオール/i,              query: 'エクセルシオールカフェ', genre: 'cafe' },
  { key: 'sanmarc',     re: /サンマルク/i,                    query: 'サンマルクカフェ', genre: 'cafe' },
  { key: 'hoshino',     re: /星乃珈琲/i,                      query: '星乃珈琲店',     genre: 'cafe' },
  { key: 'komeda',      re: /コメダ/i,                        query: 'コメダ珈琲店',   brand: 'コメダ珈琲店',   genre: 'cafe' },
  { key: 'pronto',      re: /プロント|pronto/i,               query: 'プロント',       genre: 'cafe' },
  { key: 'veloce',      re: /ベローチェ|veloce/i,             query: 'カフェ・ベローチェ', genre: 'cafe' },
  { key: 'misterdonut', re: /ミスタードーナツ|ミスド|mister ?donut/i, query: 'ミスタードーナツ', brand: 'ミスタードーナツ', genre: 'cafe' },
  // ── ファストフード / 洋食チェーン ──
  { key: 'mcdonalds',   re: /マクドナルド|マック|mcdonald/i,  query: 'マクドナルド',   brand: 'マクドナルド',   genre: 'food' },
  { key: 'kfc',         re: /ケンタッキー|kfc/i,              query: 'ケンタッキーフライドチキン', brand: 'ケンタッキーフライドチキン', genre: 'food' },
  { key: 'mos',         re: /モスバーガー|mos ?burger/i,      query: 'モスバーガー',   brand: 'モスバーガー',   genre: 'food' },
  // ── ファミレス ──
  { key: 'gusto',       re: /ガスト|gusto/i,                  query: 'ガスト',         brand: 'ガスト',         genre: 'food' },
  { key: 'saizeriya',   re: /サイゼリヤ|サイゼ|saizeriya/i,   query: 'サイゼリヤ',     brand: 'サイゼリヤ',     genre: 'food' },
  { key: 'jonathan',    re: /ジョナサン/i,                    query: 'ジョナサン',     genre: 'food' },
  { key: 'royalhost',   re: /ロイヤルホスト|ロイホ/i,         query: 'ロイヤルホスト', genre: 'food' },
  // ── 牛丼 / 定食 ──
  { key: 'yoshinoya',   re: /吉野家/i,                        query: '吉野家',         brand: '吉野家',         genre: 'food' },
  { key: 'matsuya',     re: /松屋(?:フーズ)?/i,               query: '松屋',           brand: '松屋',           genre: 'food' },
  { key: 'sukiya',      re: /すき家/i,                        query: 'すき家',         brand: 'すき家',         genre: 'food' },
  { key: 'nakau',       re: /なか卯/i,                        query: 'なか卯',         genre: 'food' },
  { key: 'yayoiken',    re: /やよい軒/i,                      query: 'やよい軒',       genre: 'food' },
  { key: 'ootoya',      re: /大戸屋/i,                        query: '大戸屋',         brand: '大戸屋',         genre: 'food' },
  // ── ラーメン / 中華 ──
  { key: 'tenkaippin',  re: /天下一品/i,                      query: '天下一品',       genre: 'food' },
  { key: 'ohsho',       re: /餃子の王将/i,                    query: '餃子の王将',     genre: 'food' },
  { key: 'osakaohsho',  re: /大阪王将/i,                      query: '大阪王将',       genre: 'food' },
  { key: 'hidakaya',    re: /日高屋/i,                        query: '日高屋',         genre: 'food' },
  { key: 'kourakuen',   re: /幸楽苑/i,                        query: '幸楽苑',         genre: 'food' },
  { key: 'ringerhut',   re: /リンガーハット/i,                query: 'リンガーハット', genre: 'food' },
  // ── 焼肉 / とんかつ ──
  { key: 'gyukaku',     re: /牛角/i,                          query: '牛角',           genre: 'food' },
  { key: 'anan',        re: /安安/i,                          query: '七輪焼肉安安',   genre: 'food' },
  { key: 'jojoen',      re: /叙々苑/i,                        query: '叙々苑',         genre: 'food' },
  { key: 'saboten',     re: /さぼてん|さぼ天/i,               query: 'とんかつ新宿さぼてん', genre: 'food' },
  { key: 'wako',        re: /とんかつ和幸|和幸/i,             query: 'とんかつ和幸',   genre: 'food' },
  // ── 居酒屋 ──
  { key: 'torikizoku',  re: /鳥貴族/i,                        query: '鳥貴族',         genre: 'food' },
  { key: 'isomaru',     re: /磯丸水産/i,                      query: '磯丸水産',       genre: 'food' },
  { key: 'watami',      re: /わたみ|和民/i,                   query: '和民',           genre: 'food' },
  { key: 'shirokiya',   re: /白木屋/i,                        query: '白木屋',         genre: 'food' },
  { key: 'uotami',      re: /魚民/i,                          query: '魚民',           genre: 'food' },
  { key: 'warawara',    re: /笑笑/i,                          query: '笑笑',           genre: 'food' },
  { key: 'sennen',      re: /千年の宴/i,                      query: '千年の宴',       genre: 'food' },
  // ── 買取 / 古着 / リユース（ショッピング） ──
  { key: 'wego',        re: /\bWEGO\b/i,                      query: 'WEGO',           genre: 'shop' },
  { key: 'rinkan',      re: /\bRINKAN\b/i,                    query: 'RINKAN',         genre: 'shop' },
  { key: 'secondst',    re: /セカンドストリート|セカスト|2nd ?STREET/i, query: 'セカンドストリート', genre: 'shop' },
  { key: 'trefac',      re: /TreFacStyle|トレファク/i,        query: 'トレジャーファクトリー', genre: 'shop' },
  { key: 'bookoff',     re: /ブックオフ|BOOK ?OFF/i,          query: 'ブックオフ',     brand: 'BOOKOFF',        genre: 'shop' },
  { key: 'hardoff',     re: /ハードオフ|HARD ?OFF/i,          query: 'ハードオフ',     genre: 'shop' },
  { key: 'daikokuya',   re: /大黒屋/i,                        query: '大黒屋',         genre: 'shop' },
];

/** 店名からチェーン定義を返す（非チェーンは null）。最初にマッチした定義を採用。 */
export function detectChain(name: string | null | undefined): ChainDef | null {
  const n = String(name ?? '').trim();
  if (n.length < 2) return null;
  for (const c of CHAIN_DEFS) if (c.re.test(n)) return c;
  return null;
}

/** チェーンか否かだけを高速判定（辞書全体のOR）。 */
const ANY_CHAIN_RE = new RegExp(CHAIN_DEFS.map((c) => c.re.source).join('|'), 'i');
export function isChainName(name: string | null | undefined): boolean {
  return ANY_CHAIN_RE.test(String(name ?? ''));
}
