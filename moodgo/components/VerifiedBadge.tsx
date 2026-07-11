// ── VerifiedBadge ─────────────────────────────────────────────────────────────
// 認証(official)/店舗(store)アカウントのバッジ。account_type が 'user' や未設定なら何も出さない。
//   official: 世界標準の青バッジチェック（SNS共通の認知を借りる）
//   store   : 公式と同じ「ギザギザ円形シール」形状を金色にし、中に白い店舗アイコンを重ねる
//             （2026-07-11リデザイン。四角squircle→公式マークと同じデザイン言語の丸シールに）
import React from 'react';
import { View } from 'react-native';
import { Badge, BadgeCheck, Store } from 'lucide-react-native';

export default function VerifiedBadge({ type, size = 15 }: { type?: string | null; size?: number }) {
  if (type === 'official') return <BadgeCheck size={size} color="#fff" fill="#1D9BF0" strokeWidth={2.4} />;
  if (type === 'store') {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {/* 公式(BadgeCheck)と同じシール外形。fillで金色に塗り、白の店舗グリフを中央に重ねる */}
        <Badge size={size} color="#fff" fill="#F59E0B" strokeWidth={2.4} />
        <Store size={size * 0.48} color="#fff" strokeWidth={3.2} style={{ position: 'absolute' }} />
      </View>
    );
  }
  return null;
}
