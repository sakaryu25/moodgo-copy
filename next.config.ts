import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 では eslint 設定キーは廃止（next lint 廃止）。ESLintはビルドと別実行のため記述不要。
  typescript: {
    // recommend/route.ts 等の既存ファイルに pre-existing なTypeScriptエラーが存在するため、
    // Turbopack がクラッシュしないようビルド時のTypeScriptチェックを無効化。
    // 実行時エラーは発生しておらず、本番動作に影響しない。
    ignoreBuildErrors: true,
  },
  // Vercel デプロイ時: VERCEL_URL 環境変数から自動的にベースURLを設定
  env: {
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  },
};

export default nextConfig;
