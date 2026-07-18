// ── lib/photoBadges ─────────────────────────────────────────────────────────
// 「写真投稿バッジ」の共有定義（2026-07-18）。
//   獲得条件 = 本人が承認済み公開投稿を N枚達成（穴場写真/moodログ写真）。
//   枚数の真実は /api/user-profile の postCount（= 帰属可能な承認済み公開投稿数）。
//   自分のプロフィール(tabs/profile)と他人のプロフィール(user/[id])で同一の
//   定義・段階を使い、全プロフィールで見た目/条件を統一する。
//   UI規約: 絵文字禁止＝lucideアイコン。配色はホームGRAD系（淡色）。
import { Camera, Images, Trophy, type LucideIcon } from 'lucide-react-native';

export type PhotoBadgeTier = {
  key: string;         // 安定キー
  need: number;        // 必要な投稿数
  title: string;       // 日本語名
  titleEn: string;     // 英語名
  Icon: LucideIcon;    // lucideアイコン（淡色で中央に表示）
};

// 段階バッジ（1枚=はじめの一歩 / 5枚 / 10枚）
export const PHOTO_BADGE_TIERS: readonly PhotoBadgeTier[] = [
  { key: 'photo-1',  need: 1,  title: 'はじめの一歩',       titleEn: 'First Shot',    Icon: Camera },
  { key: 'photo-5',  need: 5,  title: 'スナップ職人',       titleEn: 'Snap Artisan',  Icon: Images },
  { key: 'photo-10', need: 10, title: '写真マスター',       titleEn: 'Photo Master',  Icon: Trophy },
] as const;

// 獲得済みの段階バッジ（新しい段階が後ろ）
export function earnedPhotoBadges(count: number): PhotoBadgeTier[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return PHOTO_BADGE_TIERS.filter((t) => n >= t.need);
}

// 次に狙える段階バッジ（全部獲得済みなら null）
export function nextPhotoBadge(count: number): PhotoBadgeTier | null {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return PHOTO_BADGE_TIERS.find((t) => n < t.need) ?? null;
}

// 段階名（言語別）
export function photoBadgeTitle(tier: PhotoBadgeTier, lang: 'ja' | 'en'): string {
  return lang === 'en' ? tier.titleEn : tier.title;
}
