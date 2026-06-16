// ─── プッシュ通知の基盤（expo-notifications）────────────────────────────────────
// スコープ: 端末のExpoプッシュトークンを取得しバックエンド(push_tokens)へ登録する“基盤”。
//   実際の配信は将来（例: お気に入りスポットの近況・Moodログへの反応通知）。
// ⚠ Expo Go では remote push 非対応。実機の Dev Build / 本番ビルド（EAS）で動作する。
//   EAS の projectId 未設定時はトークン取得をスキップ＝完全 no-op（アプリ本体に影響なし）。
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { getDeviceId } from "./abtest";
import { apiFetch } from "./api";

// フォアグラウンドでも通知を表示する（SDK54: banner/list フィールド）
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function resolveProjectId(): string | undefined {
  const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
  return extra.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/**
 * 通知許可をリクエストし、Expoプッシュトークンを取得→バックエンドに登録する。
 * 失敗・未対応・未設定はすべて null を返すだけで、例外はアプリに伝播させない。
 * @returns 取得できた Expo push token（"ExponentPushToken[...]"）、無ければ null
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null; // シミュレータ/エミュレータは remote push 不可

    // Android は通知チャンネルが必須
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // 許可状態の確認＋（未許可なら）リクエスト
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return null;

    const projectId = resolveProjectId();
    if (!projectId) return null; // EAS未設定（projectId無し）ではトークン取得不可 → no-op

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    // バックエンドに登録（best-effort・失敗は無視）
    const deviceId = await getDeviceId();
    await apiFetch("/api/push-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, token, platform: Platform.OS }),
    }).catch(() => {});

    return token;
  } catch {
    return null; // 通知基盤の失敗はアプリ本体に影響させない
  }
}
