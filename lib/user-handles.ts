// ─── user-handles helper ─────────────────────────────────────────────────────
// 投稿レスポンスに @ハンドルを添付するためのサーバー内ヘルパー（2026-07-06）。
// device_id は資格情報のため、外に出すのは handle / deviceHash / ハッシュ名アイコンURL のみ。
import type { SupabaseClient } from "@supabase/supabase-js";

/** device_id[] → Map<device_id, handle>（テーブル未適用/エラーは空Mapで安全に劣化） */
export async function handlesByDevice(
  db: SupabaseClient, deviceIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(deviceIds.filter(Boolean))];
  if (ids.length === 0) return map;
  try {
    const { data } = await db.from("user_handles").select("handle, device_id").in("device_id", ids);
    for (const r of data ?? []) {
      map.set((r as { device_id: string }).device_id, (r as { handle: string }).handle);
    }
  } catch { /* noop */ }
  return map;
}

/** device_id[] → Map<device_id, account_type>（'user'は含めない・列未適用[42703]/エラーは空Map） */
export async function accountTypesByDevice(
  db: SupabaseClient, deviceIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(deviceIds.filter(Boolean))];
  if (ids.length === 0) return map;
  try {
    const { data, error } = await db.from("user_handles").select("device_id, account_type").in("device_id", ids);
    if (error) return map;   // account_type 列未適用などは空Mapで安全に劣化
    for (const r of data ?? []) {
      const at = (r as { account_type?: string }).account_type;
      if (at === "store" || at === "official") map.set((r as { device_id: string }).device_id, at);
    }
  } catch { /* noop */ }
  return map;
}

/** device_id[] → Map<device_id, iconVer>（=user_handles.updated_at のepoch文字列）。
 *  名前/アイコン更新時に updated_at を bump するので、これをアイコンURLの ?v= に使うと
 *  「変更した時だけ」URLが変わり、他人の画面でも即再取得される（時間バケットの1hラグを解消）。
 *  列/テーブル未適用・行なしは空Map＝呼び出し側は時間バケットにフォールバック。 */
export async function iconVersionsByDevice(
  db: SupabaseClient, deviceIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(deviceIds.filter(Boolean))];
  if (ids.length === 0) return map;
  try {
    const { data, error } = await db.from("user_handles").select("device_id, updated_at").in("device_id", ids);
    if (error) return map;
    for (const r of data ?? []) {
      const u = (r as { updated_at?: string }).updated_at;
      const ms = u ? Date.parse(u) : NaN;
      if (Number.isFinite(ms)) map.set((r as { device_id: string }).device_id, String(ms));
    }
  } catch { /* noop */ }
  return map;
}

/** handle → device_id（ユーザー検索/フィルタ用。見つからなければ null） */
export async function deviceByHandle(db: SupabaseClient, handle: string): Promise<string | null> {
  const h = String(handle ?? "").trim().toLowerCase().replace(/^@+/, "");
  if (!/^[a-z0-9_]{3,20}$/.test(h)) return null;
  try {
    const { data } = await db.from("user_handles").select("device_id").eq("handle", h).maybeSingle();
    return (data?.device_id as string | undefined) ?? null;
  } catch { return null; }
}
