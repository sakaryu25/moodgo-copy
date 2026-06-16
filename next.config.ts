import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 では eslint 設定キーは廃止（next lint 廃止）。ESLintはビルドと別実行のため記述不要。
  typescript: {
    // 全TypeScriptエラーを解消済み（2026-06-16・#37）。ビルド時の型チェックを有効化し、
    // 以後の型崩れをデプロイ前に検出する。万一ビルドが型で止まる場合のみ一時的に true へ。
    ignoreBuildErrors: false,
  },
  // Vercel デプロイ時: VERCEL_URL 環境変数から自動的にベースURLを設定
  env: {
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  },
};

export default nextConfig;
