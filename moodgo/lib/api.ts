// 本番 URL（Vercel にデプロイした Next.js の URL）
// ビルド前に moodgo/.env に EXPO_PUBLIC_API_BASE_URL=https://your-app.vercel.app を設定
const PROD_API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://moodgo.vercel.app";

// 開発時: LAN IPを .env で指定 → 実機でも localhost ではなく LAN IP が必要
// 例: EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3000
const DEV_API_BASE  = process.env.EXPO_PUBLIC_API_BASE_URL ?? PROD_API_BASE;

export const API_BASE = __DEV__ ? DEV_API_BASE : PROD_API_BASE;

export async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, options);
  return res;
}
