// ─── サーバー側エラー監視（書戻し/生成/検索フローの失敗を可視化）────────────────
// これまで recommend 等の fire-and-forget DB書込み・OpenAI生成は失敗を握りつぶしており
// （.then(()=>{}, ()=>{}) や catch{}）、本番で何が落ちているか分からなかった。
// ここに集約し、想定外の失敗だけを server_errors テーブルへベストエフォート記録する。
//   ⚠ 要 supabase/server-errors.sql 適用（未適用でも握りつぶすので安全＝no-op）。
import { supabase } from "@/lib/supabase";
import { after } from "next/server";

// 「列/テーブル未作成」「該当行なし」は想定内（SQL未適用や NULL-only 更新の空振り）。
// これらは記録しない＝ノイズで埋もれないようにする。本当に見たいのは
// ネットワーク/権限(RLS)/制約違反/OpenAIレート超過/タイムアウト等。
const BENIGN_CODES = new Set([
  "42703", // undefined_column
  "42P01", // undefined_table
  "PGRST204", // column not found in schema cache
  "PGRST205", // table not found in schema cache
  "PGRST116", // no rows (maybeSingle/single)
]);

function extract(err: unknown): { message: string; code: string | null } {
  const e = err as { message?: unknown; code?: unknown; error?: { message?: unknown; code?: unknown } } | null;
  const code = (e?.code ?? e?.error?.code) as string | undefined;
  const message = String(
    (e?.message ?? e?.error?.message ?? (typeof err === "string" ? err : "") ?? "") || "",
  ).slice(0, 600);
  return { message, code: code != null ? String(code) : null };
}

/**
 * 想定外のサーバー側失敗を1件記録する（awaitable・絶対にthrowしない）。
 * 呼び出し側が既に after() 内（応答後）で動いているケースを想定し、ここでは
 * after() で包まず直接 insert する。記録自体の失敗は握りつぶす（再帰防止）。
 */
export async function logServerError(
  scope: string,
  err: unknown,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const { message, code } = extract(err);
    if (code && BENIGN_CODES.has(code)) return; // 想定内は記録しない
    if (!message) return;
    const sb = supabase;
    if (!sb) return;
    const row = {
      scope: String(scope).slice(0, 80),
      message,
      code: code ? code.slice(0, 40) : null,
      meta: meta ?? null,
    };
    await sb.from("server_errors").insert(row).then(() => {}, () => {});
  } catch {
    /* ログは決して例外を投げない */
  }
}

/**
 * リクエスト処理中（応答前）の致命的失敗を、応答を遅らせずに記録する。
 * after() で応答後に logServerError を走らせる（Vercelの凍結を回避）。
 */
export function scheduleServerError(
  scope: string,
  err: unknown,
  meta?: Record<string, unknown>,
): void {
  try {
    after(async () => { await logServerError(scope, err, meta); });
  } catch {
    void logServerError(scope, err, meta);
  }
}
