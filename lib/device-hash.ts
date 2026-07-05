// ─── device-hash ─────────────────────────────────────────────────────────────
// device_id はログイン無しモデルの「ベアラ資格情報」（これを知られると本人として投稿削除・
// アカウント削除まで可能）。よって公開APIレスポンスには生の device_id を絶対に出さず、
// この一方向ハッシュ(sha256先頭16hex)を使う。用途:
//   - poster_id 等の公開識別子（ブロック・本人判定は同ハッシュ比較で可能）
//   - プロフィールアイコンの保存ファイル名 user-icons/{hash}.jpg
//     （公開URLに生deviceIdが載る漏洩経路を塞ぐ。2026-07-05監査対応）
import { createHash } from "crypto";

export function deviceHash(deviceId: string): string {
  return createHash("sha256").update(String(deviceId ?? "")).digest("hex").slice(0, 16);
}

/** プロフィールアイコンの保存パス（user-icons バケット内） */
export function iconPathFor(deviceId: string): string {
  return `${deviceHash(deviceId)}.jpg`;
}
