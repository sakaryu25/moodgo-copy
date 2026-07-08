// ── VerifiedBadge ─────────────────────────────────────────────────────────────
// 認証(official)/店舗(store)アカウントのバッジ。account_type が 'user' や未設定なら何も出さない。
import React from 'react';
import { BadgeCheck, Store } from 'lucide-react-native';

export default function VerifiedBadge({ type, size = 15 }: { type?: string | null; size?: number }) {
  if (type === 'official') return <BadgeCheck size={size} color="#fff" fill="#1D9BF0" strokeWidth={2.4} />;
  if (type === 'store') return <Store size={size} color="#F59E0B" strokeWidth={2.6} />;
  return null;
}
