// ─── 内蔵の軽量クラッシュ／エラー監視 ───────────────────────────────────────
// JSエラー・未処理Promise・ErrorBoundary捕捉を /api/client-error に送る（fire-and-forget）。
// Sentry を入れた場合は setSentryCapture() でフックを差し込めば二重に記録できる。
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { apiFetch } from '@/lib/api';
import { getDeviceId } from '@/lib/abtest';

type Kind = 'fatal' | 'error' | 'unhandled_rejection' | 'boundary';

// Sentry等の外部レポーターを後から差し込むためのフック（未設定なら無視）
let sentryCapture: ((error: unknown, kind: Kind) => void) | null = null;
export function setSentryCapture(fn: (error: unknown, kind: Kind) => void) {
  sentryCapture = fn;
}

const APP_VERSION =
  (Constants.expoConfig?.version as string | undefined) ?? '1.0.0';

// 同一エラーの連投を抑える（短時間の重複送信を防ぐ）
const recent = new Set<string>();

function toMessageAndStack(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message || error.name, stack: error.stack };
  if (typeof error === 'string') return { message: error };
  try { return { message: JSON.stringify(error).slice(0, 500) }; } catch { return { message: 'Unknown error' }; }
}

/** エラーを記録（送信は best-effort。例外は決して投げない） */
export function reportError(error: unknown, kind: Kind = 'error', context?: Record<string, unknown>): void {
  try {
    const { message, stack } = toMessageAndStack(error);
    if (!message) return;

    // 外部レポーター（Sentry）へも渡す
    try { sentryCapture?.(error, kind); } catch { /* noop */ }

    const dedupeKey = `${kind}:${message}`.slice(0, 200);
    if (recent.has(dedupeKey)) return;
    recent.add(dedupeKey);
    if (recent.size > 50) recent.clear();

    getDeviceId()
      .then(deviceId =>
        apiFetch('/api/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            stack,
            kind,
            deviceId,
            platform: Platform.OS,
            appVersion: APP_VERSION,
            context,
          }),
          timeoutMs: 6000,
        }),
      )
      .catch(() => { /* 監視の送信失敗は無視 */ });
  } catch { /* 監視自体で落ちない */ }
}

/**
 * グローバルなJSエラー・未処理Promiseを捕捉してreportErrorへ。
 * アプリ起動時に一度だけ呼ぶ（_layout）。
 */
export function setupGlobalErrorHandlers(): void {
  // 1) 未処理の同期エラー（ErrorUtils。RN標準のグローバルハンドラ）
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (e: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
    };
  };
  const EU = g.ErrorUtils;
  if (EU?.setGlobalHandler && EU.getGlobalHandler) {
    const prev = EU.getGlobalHandler();
    EU.setGlobalHandler((e: unknown, isFatal?: boolean) => {
      reportError(e, isFatal ? 'fatal' : 'error');
      prev?.(e, isFatal);  // 既存ハンドラ（赤画面等）も維持
    });
  }
  // 未処理Promise rejection はRN標準のトラッカーがログ化する。重大な描画エラーは
  // ErrorBoundary が、それ以外の致命的JSエラーは上記 ErrorUtils が捕捉する。
}
