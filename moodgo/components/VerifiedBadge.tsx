// ── VerifiedBadge ─────────────────────────────────────────────────────────────
// 認証(official)/店舗(store)アカウントのバッジ。account_type が 'user' や未設定なら何も出さない。
//   official: 世界標準の青バッジチェック（SNS共通の認知を借りる）
//   store   : アンバー→オレンジのグラデ squircle に白い店舗アイコン（2026-07-11リデザイン。
//             以前は裸のStoreアイコンで安っぽかったため「金の紋章」風のシールに）
import React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { BadgeCheck, Store } from 'lucide-react-native';

export default function VerifiedBadge({ type, size = 15 }: { type?: string | null; size?: number }) {
  if (type === 'official') return <BadgeCheck size={size} color="#fff" fill="#1D9BF0" strokeWidth={2.4} />;
  if (type === 'store') {
    return (
      <LinearGradient
        colors={['#FBBF24', '#F59E0B', '#EA580C']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{
          width: size, height: size, borderRadius: size * 0.32,
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)',
          shadowColor: '#F59E0B', shadowOpacity: 0.35, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
        }}
      >
        <Store size={size * 0.6} color="#fff" strokeWidth={2.8} />
      </LinearGradient>
    );
  }
  return null;
}
