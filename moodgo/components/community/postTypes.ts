// ─── 全国みんなの穴場 — Pinterest風カードの共有型・パース ─────────────────────────
import {
  Activity, Car, Cloud, Leaf, Map, MapPin, Plane, ShoppingBag, Sparkles, UtensilsCrossed,
} from 'lucide-react-native';
import type React from 'react';

export type IconComp = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number; fill?: string }>;

// APIのFeedItem（community-feed）から表示に必要な部分だけ抽出した型
export type FeedLike = {
  id: string;
  spot_name: string;
  prefecture: string;
  description: string | null;
  image_urls: string[] | null;
  auto_tags: string[] | null;
  created_at: string;
  poster_name?: string | null;
  poster_icon?: string | null;
  poster_id?: string | null;
  kind?: string;
  price_chip?: string | null;   // 新投稿(spot_posts)は独立カラム
  rating?: number | null;
  likes?: number;
};

// カードが描画に使う正規化済みデータ
export type Post = {
  id: string;
  title: string;
  description: string;      // マーカー除去済みの本文
  prefecture: string;
  image: string | null;
  price: string | null;     // 例: 無料 / 〜¥500
  rating: number;           // 0〜5（0=未評価＝星非表示）
  category: { Icon: IconComp; color: string; bg: string };
  createdAt: string;
  kind?: string;
  raw: FeedLike;            // 通報/遷移用に元データを保持
};

// カテゴリ（気分タグ）→ アイコン＋色＋淡い背景。画像なしカードの左上バッジに使う。
export function categoryStyle(tags: string[] | null): { Icon: IconComp; color: string; bg: string } {
  const M: Array<[string, IconComp, string, string]> = [
    ['#お腹すいた',        UtensilsCrossed, '#E8863C', '#FCEEE0'],
    ['#まったりしたい',    Cloud,           '#5E93B0', '#E5F0F5'],
    ['#自然感じたい',      Leaf,            '#3AA76D', '#E4F4EB'],
    ['#わいわい楽しみたい', Sparkles,        '#E0559B', '#FCE6F1'],
    ['#ドライブしたい',    Car,             '#2E86C1', '#E3F0FA'],
    ['#体動かしたい',      Activity,        '#16A085', '#E1F3EF'],
    ['#遠くに行きたい',    Plane,           '#7B68EE', '#EAE7FC'],
    ['#ショッピング',      ShoppingBag,     '#E0559B', '#FCE6F1'],
    ['#穴場スポット',      Map,             '#8A6BF0', '#EEE9FD'],
  ];
  if (tags) for (const [t, Icon, color, bg] of M) if (tags.includes(t)) return { Icon, color, bg };
  return { Icon: MapPin, color: '#8A6BF0', bg: '#EEE9FD' };
}

// 説明文に埋め込まれた 【目安価格】/【おすすめ度】 を抽出し、本文からは除去する。
//   旧投稿(suggestions)はcaptionに埋め込み・新投稿(spot_posts)は独立カラム → 両対応。
export function parsePost(item: FeedLike): Post {
  const desc = (item.description ?? '').trim();
  const priceM = desc.match(/【目安価格】\s*([^\n【]+)/);
  const ratingM = desc.match(/【おすすめ度】\s*★?\s*(\d)/);
  const price = (item.price_chip && item.price_chip.trim()) || (priceM ? priceM[1].trim() : null);
  const parsedRating = ratingM ? Math.min(5, Math.max(1, Number(ratingM[1]))) : 0;
  const rating = typeof item.rating === 'number' && item.rating > 0 ? Math.min(5, item.rating) : parsedRating;
  const clean = desc
    .replace(/【目安価格】[^\n【]*/g, '')
    .replace(/【おすすめ度】\s*★?\s*\d/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return {
    id: item.id,
    title: item.spot_name || item.prefecture || 'スポット',
    description: clean,
    prefecture: item.prefecture || '',
    image: item.image_urls?.[0] ?? null,
    price,
    rating,
    category: categoryStyle(item.auto_tags),
    createdAt: item.created_at,
    kind: item.kind,
    raw: item,
  };
}

// 相対時刻（「5分前」「昨日」「3週間前」「6/12」）
export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day === 1) return '昨日';
  if (day < 7) return `${day}日前`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}週間前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
