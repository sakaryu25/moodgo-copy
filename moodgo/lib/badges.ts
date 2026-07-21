// ── lib/badges ──────────────────────────────────────────────────────────────
// バッジ図鑑エンジン（2026-07-21）。
//   「行った！ログ（端末ローカル・タグ/住所つき）＋承認済み写真投稿数」から
//   全バッジの獲得状況と進捗を計算する。サーバー不要・全て端末内で完結。
//   4系統: おでかけ(行った数) / ジャンル(タグ一致数) / たび(都道府県数) / 写真投稿。
//   UI規約: 絵文字禁止＝lucideアイコン（photoBadges.tsと同じ）。
//   未獲得もシルエット＋進捗で見せる「図鑑」前提の定義（earned順ではなく全件返す）。
import {
  Backpack, Bath, Cake, Coffee, Compass, Crown, Earth, Footprints,
  Leaf, Map as MapIcon, Mountain, Route, Telescope, TrainFront,
  type LucideIcon,
} from 'lucide-react-native';
import { PHOTO_BADGE_TIERS } from '@/lib/photoBadges';
import type { SpotLogItem } from '@/lib/spotLog';

export type BadgeCat = 'visit' | 'genre' | 'travel' | 'photo';

export type SpotBadgeDef = {
  key: string;          // 安定キー
  cat: BadgeCat;
  need: number;         // 必要数（行った数/タグ一致数/都道府県数/写真数）
  title: string;
  titleEn: string;
  Icon: LucideIcon;
  tags?: string[];      // genre: このいずれかのタグを含む「行った！」がカウント対象
};

export type BadgeProgress = {
  def: SpotBadgeDef;
  count: number;        // 現在値（needでクランプしない実数）
  earned: boolean;
  earnedAt?: string;    // 達成日ISO（need番目の行った日。写真系は日付なし）
};

// ── 図鑑カタログ（表示順そのまま）───────────────────────────────────────────
//   ジャンルのタグは lib/predefined-tags.ts の語彙に一致させる（#プレフィックス付き）。
//   ⚠ #穴場スポット は全投稿に自動付与されるためバッジ条件には使わない。
export const BADGE_DEFS: readonly SpotBadgeDef[] = [
  // おでかけ（行った！の合計数）
  // ⚠ 4列グリッドで省略されても写真投稿の「はじめの一歩」と見分けがつく短い名前にする
  { key: 'visit-1',  cat: 'visit', need: 1,  title: '初おでかけ',       titleEn: 'First Outing',   Icon: Footprints },
  { key: 'visit-5',  cat: 'visit', need: 5,  title: 'おでかけ好き',     titleEn: 'Outing Lover',   Icon: MapIcon },
  // ⚠ 「おでかけ好き」と先頭が同じ名前は4列グリッドの省略表示で区別不能になるため避ける
  { key: 'visit-15', cat: 'visit', need: 15, title: '行動派',           titleEn: 'Go-Getter',      Icon: Compass },
  { key: 'visit-30', cat: 'visit', need: 30, title: '冒険家',           titleEn: 'Adventurer',     Icon: Mountain },
  { key: 'visit-50', cat: 'visit', need: 50, title: 'MoodGoマスター',   titleEn: 'MoodGo Master',  Icon: Crown },
  // ジャンル（行った！スポットのタグ一致数）
  { key: 'cafe-3',   cat: 'genre', need: 3, title: 'カフェ巡り',     titleEn: 'Cafe Hopper',    Icon: Coffee,    tags: ['#カフェ'] },
  { key: 'onsen-3',  cat: 'genre', need: 3, title: '湯めぐり名人',   titleEn: 'Onsen Expert',   Icon: Bath,      tags: ['#温泉スパ'] },
  { key: 'nature-5', cat: 'genre', need: 5, title: '自然派',         titleEn: 'Nature Lover',   Icon: Leaf,      tags: ['#自然の中', '#山_森_緑', '#海_川_湖_水辺', '#広大な自然'] },
  { key: 'view-3',   cat: 'genre', need: 3, title: '絶景ハンター',   titleEn: 'View Hunter',    Icon: Telescope, tags: ['#絶景', '#街一望_パノラマ'] },
  { key: 'sweets-3', cat: 'genre', need: 3, title: 'スイーツ部',     titleEn: 'Sweets Club',    Icon: Cake,      tags: ['#甘いもの'] },
  { key: 'walk-5',   cat: 'genre', need: 5, title: 'さんぽの達人',   titleEn: 'Stroll Master',  Icon: Route,     tags: ['#散歩・街歩き'] },
  // たび（行った！スポットの都道府県数）
  { key: 'pref-2',  cat: 'travel', need: 2,  title: 'プチ旅人',   titleEn: 'Mini Traveler', Icon: Backpack },
  { key: 'pref-5',  cat: 'travel', need: 5,  title: '旅人',       titleEn: 'Traveler',      Icon: TrainFront },
  { key: 'pref-10', cat: 'travel', need: 10, title: '全国行脚',   titleEn: 'Japan Trotter', Icon: Earth },
  // 写真投稿（既存photoBadgesの段階をそのまま図鑑に統合）
  ...PHOTO_BADGE_TIERS.map((t) => ({
    key: t.key, cat: 'photo' as const, need: t.need, title: t.title, titleEn: t.titleEn, Icon: t.Icon,
  })),
] as const;

// 系統ラベル（図鑑のセクション見出し）
const CAT_LABELS: Record<BadgeCat, { ja: string; en: string }> = {
  visit:  { ja: 'おでかけ',   en: 'Outings' },
  genre:  { ja: 'ジャンル',   en: 'Genres' },
  travel: { ja: 'たび',       en: 'Travel' },
  photo:  { ja: '写真投稿',   en: 'Photos' },
};
export function badgeCategoryLabel(cat: BadgeCat, lang: 'ja' | 'en'): string {
  return CAT_LABELS[cat][lang];
}
export function badgeTitle(def: SpotBadgeDef, lang: 'ja' | 'en'): string {
  return lang === 'en' ? def.titleEn : def.title;
}
export const BADGE_CATS: readonly BadgeCat[] = ['visit', 'genre', 'travel', 'photo'];

// 住所→都道府県（「たび」の同一県判定用）。
//   ⚠ 「日本、〒260-0013 千葉県…」のようなGoogle形式住所を生のままmatchすると、
//     貪欲な .{2,3}県 が県名の直前1文字（読点/空白）を巻き込み「、千葉」等になり、
//     同一県がSet上で複数キーに分裂して県数が水増しされる。必ず前置きを除去してから判定する
//     （サーバーのtoPref(app/api/my-posts)と同じ正規化）。
function prefOf(addr?: string): string {
  const a = String(addr ?? '')
    .replace(/^日本[、,]\s*/, '')
    .replace(/〒?\s*\d{3}-?\d{4}\s*/, '')
    .trim();
  const m = a.match(/(東京都|北海道|(?:大阪|京都)府|.{2,3}県)/);
  return m ? m[1].replace(/[都道府県]$/, '').replace(/^[、,\s]+/, '') : '';
}

// ── 図鑑の計算（全バッジの進捗を返す。表示順=カタログ順）─────────────────────
export function computeBadges(visited: SpotLogItem[], photoPostCount: number): BadgeProgress[] {
  // 達成日の特定のため古い順に並べる（visitedログは新しい順で保存されている）
  const asc = [...visited].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const photoN = Number.isFinite(photoPostCount) ? Math.max(0, Math.floor(photoPostCount)) : 0;

  return BADGE_DEFS.map((def) => {
    if (def.cat === 'photo') {
      return { def, count: photoN, earned: photoN >= def.need };
    }
    if (def.cat === 'visit') {
      const earned = asc.length >= def.need;
      return { def, count: asc.length, earned, earnedAt: earned ? asc[def.need - 1]?.at : undefined };
    }
    if (def.cat === 'genre') {
      const hits = asc.filter((x) => (x.tags ?? []).some((tag) => def.tags?.includes(tag)));
      const earned = hits.length >= def.need;
      return { def, count: hits.length, earned, earnedAt: earned ? hits[def.need - 1]?.at : undefined };
    }
    // travel: 都道府県のユニーク数（need到達時点の行った日を達成日に）
    const seen = new Set<string>();
    let earnedAt: string | undefined;
    for (const x of asc) {
      const p = prefOf(x.address) || (x.area ?? '');
      if (!p || seen.has(p)) continue;
      seen.add(p);
      if (seen.size === def.need) earnedAt = x.at;
    }
    return { def, count: seen.size, earned: seen.size >= def.need, earnedAt };
  });
}

// 「次に狙える」バッジ＝未獲得のうち進捗率が最も高いもの（同率なら必要数が少ない方）。
//   進捗0のみの時も、いちばん手前の未獲得（needが最小）を返して導線を切らさない。
export function nearestNextBadge(badges: BadgeProgress[]): BadgeProgress | null {
  const locked = badges.filter((b) => !b.earned);
  if (locked.length === 0) return null;
  return [...locked].sort((a, b) => {
    const ra = a.count / a.def.need;
    const rb = b.count / b.def.need;
    if (rb !== ra) return rb - ra;
    return a.def.need - b.def.need;
  })[0];
}
