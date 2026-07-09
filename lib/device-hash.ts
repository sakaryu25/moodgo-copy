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

/**
 * 匿名投稿(spot_public_anonymous)用の公開識別子。
 * 公開 deviceHash とは別名前空間（sha256入力に "anon:v1:" を前置）にすることで、
 * 匿名投稿の poster_id を deviceHash と一致させない。狙い:
 *   - /api/user-profile や /user/[id] は deviceHash で照合するため、この値では名前/アイコンに
 *     逆引きできない（同一人物の公開投稿・プロフィールとも突き合わせ不可＝匿名性の維持）。
 *   - それでいて端末ごとに安定 → ブロック(user_blocks は不透明ハッシュ一致)はそのまま機能する。
 * ⚠ deviceHash と同じ 16hex 形式(HASH_RE 互換)だが、前置により値は必ず異なる。
 *   残存: 同一人物の匿名投稿どうしは同じ値になる（クラスタリング可能）。これは per-user
 *   ブロックを匿名投稿でも効かせるための不可避なトレードオフ。
 */
export function anonPosterId(deviceId: string): string {
  return createHash("sha256").update("anon:v1:" + String(deviceId ?? "")).digest("hex").slice(0, 16);
}

/** プロフィールアイコンの保存パス（user-icons バケット内） */
export function iconPathFor(deviceId: string): string {
  return `${deviceHash(deviceId)}.jpg`;
}
