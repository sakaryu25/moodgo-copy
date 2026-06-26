// ─── 管理API 認証の単一ソース ───────────────────────────────────────────────
// これまで "moodgoadmin123" が43ファイルにベタ書き＋一部はenv差し替え不可だった。
// ここに集約し、全管理ルートはこの helper を経由する（付け忘れを構造的に防ぐ）。
//
// ⚠ 運用必須: Vercel に環境変数 ADMIN_SECRET（強いランダム値）を設定してください。
//   本番(NODE_ENV=production)では env 未設定なら空文字となり、全管理リクエストを拒否します
//   （ハードコード値による無制限なGoogle呼び出し＝課金攻撃を構造的に遮断）。
//   ※ env 未設定だと本番の管理APIはロックされます＝これが安全側のデフォルトです。開発時のみフォールバックを使用。
import type { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";

// 本番は env 必須。未設定なら "" → isValidAdminSecret が提供値の length>0 必須で全入力を拒否（""同士の誤一致も起きない）。
export const ADMIN_SECRET = process.env.ADMIN_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "moodgoadmin123");

// タイミング攻撃を避けるため定数時間で比較（長さ不一致は即false）
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  try { return timingSafeEqual(ab, bb); } catch { return false; }
}

/** 既にパース済みの secret 文字列が正しいか（body.secret 等の検証用） */
export function isValidAdminSecret(secret: string | null | undefined): boolean {
  return typeof secret === "string" && secret.length > 0 && safeEqual(secret, ADMIN_SECRET);
}

/**
 * リクエストから管理者認証を確認する（body を消費しない）。
 *   優先: ヘッダー x-admin-secret（URLに残らない＝ログ漏れしない）
 *   互換: クエリ ?secret=（既存呼び出しのため当面許容・将来ヘッダーへ移行）
 * body.secret しか送らない既存POSTは、各ルートで isValidAdminSecret(body.secret) を併用する。
 */
export function requireAdminFromReq(req: NextRequest | Request): boolean {
  try {
    const header = (req.headers.get("x-admin-secret") ?? req.headers.get("X-Admin-Secret")) || undefined;
    if (isValidAdminSecret(header)) return true;
    const q = new URL(req.url).searchParams.get("secret") || undefined;
    return isValidAdminSecret(q);
  } catch {
    return false;
  }
}

/** body.secret か header/query のいずれかで認証OKなら true（POST/DELETE用の総合判定） */
export function isAdminRequest(req: NextRequest | Request, bodySecret?: string | null): boolean {
  return isValidAdminSecret(bodySecret) || requireAdminFromReq(req);
}
