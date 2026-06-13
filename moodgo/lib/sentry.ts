// Sentry連携。EXPO_PUBLIC_SENTRY_DSN が設定されている場合のみ有効化する。
// 未設定なら Sentry のコードは一切実行しない（内蔵の軽量監視 = crashReporting.ts のみ）。
// → DSN未設定の環境（Expo Go等）で起動時に触らないよう、require は DSN ガードの後で行う。
//
// 有効化手順:
//   1) Sentryでプロジェクトを作成し DSN を取得
//   2) moodgo/.env に EXPO_PUBLIC_SENTRY_DSN=https://...ingest.sentry.io/... を設定
//   3) ネイティブビルド（EAS build / expo prebuild）で反映（Expo Goでは捕捉不可）
// ※ @sentry/react-native と app.json の config plugin は導入済み。
import { setSentryCapture } from '@/lib/crashReporting';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

let initialized = false;

export function initSentry(): void {
  if (!DSN || initialized) return;  // DSN未設定 → Sentryには一切触れない（内蔵監視のみ）
  try {
    // DSNがある時だけ読み込む（未設定環境で native を触らない）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
    Sentry.init({
      dsn: DSN,
      tracesSampleRate: 0.2,
      enabled: !__DEV__,   // 本番ビルドのみ送信
    });
    initialized = true;
    // 内蔵監視の reportError からもSentryへ二重記録できるようにフックを登録
    setSentryCapture((error) => {
      try {
        if (error instanceof Error) Sentry.captureException(error);
        else Sentry.captureMessage(String(error));
      } catch { /* noop */ }
    });
  } catch {
    // Sentry初期化に失敗しても内蔵監視は継続（アプリは落とさない）
  }
}
