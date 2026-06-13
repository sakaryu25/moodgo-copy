// Sentry連携。EXPO_PUBLIC_SENTRY_DSN が設定されている場合のみ有効化する。
// 未設定なら完全に no-op（内蔵の軽量クラッシュ監視 = crashReporting.ts のみ動作）。
//
// 有効化手順（DSNを後で入れるとき）:
//   1) moodgo/ で `npx expo install @sentry/react-native`
//   2) moodgo/app.json の plugins に '@sentry/react-native/expo' を追加
//   3) moodgo/.env に EXPO_PUBLIC_SENTRY_DSN=https://...ingest.sentry.io/... を設定
//   4) このファイルの initSentry 内のコメントを外して Sentry.init を有効化
import { setSentryCapture } from '@/lib/crashReporting';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initSentry(): void {
  if (!DSN) return;  // DSN未設定 → Sentryは使わない（内蔵監視のみ）

  // ── @sentry/react-native を導入したら以下を有効化 ──────────────────────────
  // import * as Sentry from '@sentry/react-native';
  // Sentry.init({ dsn: DSN, enableNative: true, tracesSampleRate: 0.2 });
  // setSentryCapture((error) => {
  //   if (error instanceof Error) Sentry.captureException(error);
  //   else Sentry.captureMessage(String(error));
  // });
  void setSentryCapture;  // 未使用警告回避（導入時に上で使用する）
}
