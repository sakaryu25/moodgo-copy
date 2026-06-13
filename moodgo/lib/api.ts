// 本番 URL（Vercel にデプロイした Next.js の URL）
// ビルド前に moodgo/.env に EXPO_PUBLIC_API_BASE_URL=https://your-app.vercel.app を設定
const PROD_API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://moodgo-qvmk.vercel.app";

// 開発時: LAN IPを .env で指定 → 実機でも localhost ではなく LAN IP が必要
// 例: EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3000
const DEV_API_BASE  = process.env.EXPO_PUBLIC_API_BASE_URL ?? PROD_API_BASE;

export const API_BASE = __DEV__ ? DEV_API_BASE : PROD_API_BASE;

const DEFAULT_TIMEOUT_MS = 12000;

/**
 * fetch ラッパー。タイムアウト付き（ハング/キャプティブポータルで無限待ちを防ぐ）。
 * 返り値は素の Response のまま（既存呼び出しは変更不要）。
 * 呼び出し側で AbortSignal を渡した場合はそちらを優先。
 */
export async function apiFetch(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = options ?? {};
  // 呼び出し側が signal を渡していればそれを尊重、無ければタイムアウト用を作る
  if (signal) {
    return fetch(`${API_BASE}${path}`, { ...rest, signal });
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${API_BASE}${path}`, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * JSON を取得しつつ HTTP ステータスを検査するヘルパ。
 * 非2xx や JSON パース失敗時は例外を投げる → 呼び出し側でリトライ/失敗UIを出せる。
 * （素の空配列フォールバックでエラーを握りつぶさないための導線）
 */
export async function apiJson<T = unknown>(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    throw new Error(`API ${res.status} ${path}`);
  }
  return (await res.json()) as T;
}
