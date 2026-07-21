/**
 * Mood Book 共有トークン
 * プロフィールのデザイントークン(profile.tsx)と同値＋BOOK専用の「紙」パレット。
 * 方向性: フォトブック/旅の記録/雑誌の見開き（シール帳にはしない・上質に）。
 */
export const INK  = '#1E1548';
export const SUB  = '#8B88A6';
export const PINK = '#FF63A9';
export const BLUE = '#5A8DFF';
export const VIOLET = '#8B5CF6';
export const GRAD: [string, string] = [PINK, BLUE];

// 紙（クリーム寄りの白。真っ白にせず「本」の温度を出す）
export const PAPER      = '#FDFBF6';
export const PAPER_EDGE = '#F3EFE5';   // 下に重なるページの色
export const PAPER_LINE = 'rgba(30,21,72,0.08)';
export const PAGE_TEXT  = '#5B5470';
export const DATE_TEXT  = '#B4AEC8';

// 写真プレースホルダ（MyPostsGlassCardと同じ淡グラデ）
export const PH_GRAD: [string, string] = ['#EDE9FF', '#E3ECFF'];
