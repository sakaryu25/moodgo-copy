// ─── 自分の投稿ページ 共有型・ヘルパー ──────────────────────────────────────
// デザイントークン（仕様: 背景#F7F7F7 / カード#FFF / メイン#6C3BFF / 文字#222 / 補助#777 / 角丸24）
export const MP = {
  BG: '#F7F7F7',
  CARD: '#FFFFFF',
  MAIN: '#6C3BFF',
  INK: '#222222',
  SUB: '#777777',
  R: 24,
  SIDE: 16,   // 画面左右余白
  GAP: 16,    // カード間
} as const;

export type MyPost = {
  id: string;
  kind?: string;                 // 'suggestion' | 'moodlog' | 'blog'
  spot_name: string;
  prefecture: string;
  description: string | null;
  image_urls: string[] | null;
  created_at: string;
  status?: string | null;
  likes?: number;                // みんなのいいね数
  visited?: number;              // 行った！された回数（閲覧者が押した数）
  price_chip?: string | null;
  rating?: number | null;
};

// カテゴリ → キーワード（名前/説明/タグを対象にゆるく判定）
export const CATEGORIES = ['すべて', '景色', 'グルメ', '温泉', '絶景', 'カフェ', '神社仏閣', 'その他'] as const;
export type Category = (typeof CATEGORIES)[number];

const CAT_RE: Record<string, RegExp> = {
  '景色': /滝|公園|山|川|湖|海岸|浜|ビーチ|展望|夕日|庭園|渓谷|高原|森/,
  'グルメ': /食堂|レストラン|ラーメン|寿司|そば|うどん|焼|丼|カレー|パン|市場|グルメ|定食|居酒屋/,
  '温泉': /温泉|湯|銭湯|スパ|サウナ/,
  '絶景': /絶景|星空|夜景|鳥居|岬|富士|雲海|イルミ/,
  'カフェ': /カフェ|喫茶|珈琲|コーヒー|スイーツ/,
  '神社仏閣': /神社|寺|仏閣|大社|神宮|稲荷|地蔵/,
};

export function matchCategory(p: MyPost, cat: Category): boolean {
  if (cat === 'すべて') return true;
  const hay = `${p.spot_name} ${p.description ?? ''} ${(p as { auto_tags?: string[] }).auto_tags?.join(' ') ?? ''}`;
  if (cat === 'その他') return !Object.values(CAT_RE).some((re) => re.test(hay));
  return CAT_RE[cat]?.test(hay) ?? false;
}

// おすすめ度（独立カラム優先・旧投稿は説明文の【おすすめ度】★N）
export function ratingOf(p: MyPost): number {
  if (typeof p.rating === 'number' && p.rating > 0) return Math.min(5, p.rating);
  const m = p.description?.match(/【おすすめ度】\s*★?\s*(\d)/);
  return m ? Math.min(5, Math.max(1, Number(m[1]))) : 0;
}

// 目安価格 → 数値（無料=0 / 〜¥500=500 / 不明=Infinity=価格順で末尾）
export function priceOf(p: MyPost): number {
  const raw = (p.price_chip && p.price_chip.trim())
    || p.description?.match(/【目安価格】\s*([^\n【]+)/)?.[1]?.trim()
    || '';
  if (!raw) return Infinity;
  if (/無料|0円|タダ/.test(raw)) return 0;
  const m = raw.replace(/[,，]/g, '').match(/(\d+)/);
  return m ? Number(m[1]) : Infinity;
}

export type SortKey = 'popular' | 'new' | 'rating' | 'price';
export const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'popular', label: '人気順' },
  { key: 'new', label: '最新順' },
  { key: 'rating', label: '評価順' },
  { key: 'price', label: '価格順' },
];

export function sortPosts(arr: MyPost[], key: SortKey, asc: boolean): MyPost[] {
  const out = [...arr];
  const dir = asc ? 1 : -1;
  switch (key) {
    case 'popular':
      out.sort((a, b) => dir * (((b.likes ?? 0) + (b.visited ?? 0)) - ((a.likes ?? 0) + (a.visited ?? 0))));
      break;
    case 'new':
      out.sort((a, b) => dir * String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
      break;
    case 'rating':
      out.sort((a, b) => dir * (ratingOf(b) - ratingOf(a)));
      break;
    case 'price': {
      // 価格順は安い順が自然（asc反転で高い順）。不明(Infinity)は常に末尾
      out.sort((a, b) => (asc ? priceOf(b) - priceOf(a) : priceOf(a) - priceOf(b)));
      break;
    }
  }
  return out;
}

// Masonry用: idから決定的にカードのアスペクト比を選ぶ（読み込みでレイアウトが飛ばない）
const ASPECTS = [0.78, 1.0, 1.25];
export function aspectOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ASPECTS[h % ASPECTS.length];
}
