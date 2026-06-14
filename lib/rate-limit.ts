// ─── 簡易レート制限（メモリ内・ベストエフォート）──────────────────────────────
// 連投・フラッドの最低限の抑止。⚠ Vercelのサーバーレスはインスタンスごとに状態が
// 分離されるため完全な制限にはならない。本格運用は @upstash/ratelimit + Vercel KV を
// 推奨（それまでの暫定）。同一ウォームインスタンスへの短時間バーストは防げる。
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** key 単位で windowMs あたり limit 回まで許可。超えたら false（=ブロック）。 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  // たまにマップを掃除（メモリ肥大防止）
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** リクエスト元IP（Vercelの x-forwarded-for 先頭）。識別不能なら "unknown"。 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}
