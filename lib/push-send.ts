// ─── push-send ───────────────────────────────────────────────────────────────
// サーバーから Expo Push API へ通知を送る。宛先はユーザーの公開ハッシュ(deviceHash)。
//   通知は派生表示(/api/notifications)なので、いいね/フォロー/コメントの「発生時」にここで送る。
//   ⚠ push_tokens.device_hash 列が必要（supabase/push-tokens.sql・要再適用）。未適用/宛先不在は無害にno-op。
//   受信は実機のみ（シミュレータは Expo プッシュトークンを取得できない）。
import { supabase } from "@/lib/supabase";
import { deviceHash } from "@/lib/device-hash";

export type PushMsg = { title: string; body: string; data?: Record<string, unknown> };

async function tokensForHashes(hashes: string[]): Promise<string[]> {
  if (!supabase || hashes.length === 0) return [];
  try {
    const { data, error } = await supabase.from("push_tokens").select("token").in("device_hash", hashes);
    if (error) return [];
    return ((data ?? []) as Array<{ token?: string }>).map((r) => String(r.token ?? "")).filter(Boolean);
  } catch { return []; }
}

async function sendExpoPush(tokens: string[], msg: PushMsg): Promise<void> {
  if (tokens.length === 0) return;
  const messages = tokens.map((to) => ({
    to, title: msg.title, body: msg.body, data: msg.data ?? {}, sound: "default" as const,
  }));
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
  } catch { /* 配信失敗は本処理に影響させない */ }
}

/** 公開ハッシュ宛にプッシュ（フォロー等・相手の生device_idを知らなくても送れる）*/
export async function sendPushToHash(hash: string, msg: PushMsg): Promise<void> {
  if (!hash) return;
  await sendExpoPush(await tokensForHashes([hash]), msg);
}

/** 生device_id宛にプッシュ（投稿の持ち主が分かる いいね/コメント用）*/
export async function sendPushToDevice(deviceId: string, msg: PushMsg): Promise<void> {
  const id = String(deviceId ?? "").trim();
  if (!id) return;
  await sendPushToHash(deviceHash(id), msg);
}
