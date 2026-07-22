// ── 気分/ジャンル別「装飾プレースホルダー」テーマ ─────────────────────────────
// 写真ゼロのスポットに出す“飾り”。⚠実在店の偽写真は作らない方針。気分/ジャンルを表す
//   抽象グラデ＋パターン＋アイコンの装飾に留める（誠実・Z世代のAI偽写真嫌いを避ける）。
// 各テーマは複数バリアントを持ち、スポットidをseedに安定選択＝スポットごとに一貫、全体では多彩。

export type PhIcon =
  | 'sparkles' | 'cake' | 'coffee' | 'moon' | 'shirt' | 'flame'
  | 'trees' | 'utensils' | 'shopping' | 'book' | 'waves' | 'mountain';

type Theme = { key: string; label: string; icon: PhIcon; dark?: boolean; variants: [string, string, string][] };

// テーマ本体。variants=3色グラデを複数（ランダム感）。dark=白文字が映える濃色グラデ。
const THEMES: Record<string, Theme> = {
  korean:  { key: 'korean',  label: '韓国っぽ', icon: 'sparkles', variants: [['#FFE1EC', '#FFC9DE', '#EBB8FF'], ['#FFD9E8', '#FFB6D5', '#CBB8FF'], ['#FFEAF2', '#FFCEE6', '#E0C3FF']] },
  bae:     { key: 'bae',     label: '映えカフェ', icon: 'cake', variants: [['#FFDEE9', '#F5C6EC', '#BCC6FF'], ['#FCE0FF', '#F3C2EB', '#A6C1EE'], ['#FFE3F3', '#EFC6F0', '#C6C6FF']] },
  retro:   { key: 'retro',   label: 'レトロ喫茶', icon: 'coffee', variants: [['#F6D9A8', '#E4AF7C', '#C98A5E'], ['#F3D2A0', '#DBA46E', '#B57C4E'], ['#EFCF9E', '#D19E72', '#A9744E']] },
  chill:   { key: 'chill',   label: 'チル', icon: 'waves', variants: [['#CFE7E4', '#AEC9D8', '#B7B8E0'], ['#D6E5D6', '#AEC9C4', '#9FB8D6'], ['#C9E4EA', '#A9C6D6', '#B4BCDE']] },
  furugi:  { key: 'furugi',  label: '古着・ヴィンテージ', icon: 'shirt', variants: [['#E7D8C3', '#CBB79B', '#9E8C74'], ['#DAC9B0', '#B99E80', '#8C7A63'], ['#E0D0BC', '#C0AA8B', '#94826B']] },
  sauna:   { key: 'sauna',   label: 'サウナ・銭湯', icon: 'flame', variants: [['#FFD9B0', '#FFB68A', '#F58F6E'], ['#FFCBA0', '#FF9E7A', '#E87A63'], ['#FFD3A6', '#FBA57E', '#EF8468']] },
  night:   { key: 'night',   label: '夜景・展望', icon: 'moon', dark: true, variants: [['#3A2E6E', '#5B4B9E', '#8E6FD0'], ['#2E3A6E', '#4B5B9E', '#6F8ED0'], ['#3E2E64', '#5A4392', '#8A63C4']] },
  nature:  { key: 'nature',  label: '自然・公園', icon: 'trees', variants: [['#C7E9B0', '#9FD68A', '#7BBE7A'], ['#D3ECBE', '#A9DA8E', '#82C98A'], ['#C9E7B6', '#A2D486', '#7CC182']] },
  food:    { key: 'food',    label: 'ごはん', icon: 'utensils', variants: [['#FFE0C4', '#FFC29E', '#F79E7A'], ['#FFD9B8', '#FDB088', '#E88C6A'], ['#FFE2C0', '#FBB892', '#EE9670']] },
  shopping:{ key: 'shopping', label: 'ショッピング', icon: 'shopping', variants: [['#FFE1F0', '#E9C9FF', '#C6D8FF'], ['#FFD9EC', '#DDBDFF', '#B8CCFF'], ['#FFE6F2', '#E4C6FF', '#C0D2FF']] },
  study:   { key: 'study',   label: '集中', icon: 'book', variants: [['#EAE6F7', '#D3CBEE', '#BFC6EA'], ['#E8ECF6', '#CBD4EE', '#C0C6E8'], ['#ECE7F2', '#D2CBE8', '#C4C8E6']] },
  mountain:{ key: 'mountain', label: '絶景', icon: 'mountain', variants: [['#BFE3E0', '#93C6C4', '#7FB6C9'], ['#C6E0DA', '#98C6BE', '#84BAC6'], ['#BCE0E6', '#8FC6CE', '#7EB2C8']] },
  brand:   { key: 'brand',   label: 'MoodGo', icon: 'sparkles', variants: [['#FBD3E9', '#D8B7F5', '#A9C7F5'], ['#FAC7E4', '#CDA9F0', '#9FB8F2'], ['#FDD9EE', '#DBBBF7', '#B0CBF7']] },
};

// タグ → テーマ（specific が先）。深掘りタグ→気分大タグ の順に効く。
const RULES: { any: string[]; theme: string }[] = [
  { any: ['#韓国'], theme: 'korean' },
  { any: ['#喫茶店'], theme: 'retro' },
  { any: ['#古着・ヴィンテージ', '#古着', '#服・アクセサリー', '#服アクセサリー'], theme: 'furugi' },
  { any: ['#サウナ', '#銭湯', '#温泉', '#岩盤浴'], theme: 'sauna' },
  { any: ['#夜景', '#展望台'], theme: 'night' },
  { any: ['#絶景スポット', '#絶景'], theme: 'mountain' },
  { any: ['#流行りカフェ', '#カフェスイーツ', '#フルーツ', '#甘いもの'], theme: 'bae' },
  { any: ['#ラーメン', '#焼肉', '#居酒屋', '#海鮮', '#天ぷら', '#うどんそば', '#和食', '#イタリアン', '#中華', '#アジア系統', '#各国料理', '#洋食', '#ステーキ', '#お腹すいた'], theme: 'food' },
  { any: ['#雑貨・インテリア', '#雑貨インテリア', '#コスメ美容', '#お土産ギフト', '#ショッピング'], theme: 'shopping' },
  { any: ['#自然公園', '#大型公園', '#自然感じたい', '#山_森_緑', '#海_川_湖_水辺', '#お散歩'], theme: 'nature' },
  { any: ['#カフェ作業', '#勉強場', '#book場', '#ブックカフェ', '#集中したい'], theme: 'study' },
  { any: ['#まったりしたい'], theme: 'chill' },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
function pickTheme(tags?: string[]): Theme {
  const t = tags ?? [];
  for (const r of RULES) if (r.any.some((x) => t.includes(x))) return THEMES[r.theme];
  return THEMES.brand;
}

export type MoodPlaceholder = {
  colors: [string, string, string];
  label: string;
  icon: PhIcon;
  patternIdx: number;   // 0..2 パターン装飾の種類
  dark: boolean;        // 濃色グラデ=白文字
};

/** タグ + seed(スポットid等) から装飾プレースホルダーを決める。seed同じなら常に同じ＝チラつかない。 */
export function moodPlaceholder(tags: string[] | undefined, seed: string): MoodPlaceholder {
  const theme = pickTheme(tags);
  const h = hash(seed || 'x');
  const colors = theme.variants[h % theme.variants.length];
  return { colors, label: theme.label, icon: theme.icon, patternIdx: (h >>> 5) % 3, dark: !!theme.dark };
}
