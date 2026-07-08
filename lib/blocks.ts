// ─── blocks ──────────────────────────────────────────────────────────────────
// ブロック/ミュートの共通ヘルパー。フィード/コメント等で「閲覧者が隠すべき相手」の
// ハッシュ集合を引く。block も mute も“自分の画面から隠す”点は同じなので両方含める。
//   ⚠ 引数 deviceId は生のベアラ資格情報。内部で deviceHash 化してのみ使い、外に出さない。
//   user_blocks 未適用(42P01/PGRST205)や未指定は空集合＝従来どおり全件表示（無害）。
import { supabase } from "@/lib/supabase";
import { deviceHash } from "@/lib/device-hash";

type DB = NonNullable<typeof supabase>;

/** 閲覧者(deviceId)がブロック or ミュートした相手の deviceHash 集合 */
export async function hiddenHashesFor(db: DB, deviceId?: string | null): Promise<Set<string>> {
  const s = new Set<string>();
  const id = String(deviceId ?? "").trim();
  if (!id) return s;
  try {
    const { data, error } = await db
      .from("user_blocks")
      .select("blocked_hash")
      .eq("blocker_hash", deviceHash(id));
    if (error) return s;
    for (const r of (data ?? []) as Array<{ blocked_hash?: string }>) {
      if (r.blocked_hash) s.add(String(r.blocked_hash));
    }
  } catch {
    /* テーブル未適用などは空集合 */
  }
  return s;
}
